//! Orbit desktop shell — the native Tauri application.
//!
//! Responsibilities kept in Rust (never in the renderer):
//!   - global hotkey registration & launcher toggle
//!   - system tray with open/quit
//!   - launcher window lifecycle (show centred, focus, hide on blur)
//!   - local SQLite database (opened & migrated via orbit-core)
//!   - the IPC command surface (see `commands.rs`)

mod apps;
mod clipboard_monitor;
mod commands;
mod snippet_watcher;
mod window_mgmt;

use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use commands::AppState;

const LAUNCHER_LABEL: &str = "launcher";

/// Show the launcher if hidden, hide it if visible.
fn toggle_launcher(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LAUNCHER_LABEL) {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            let _ = win.hide();
        } else {
            // Capture the window the user was in BEFORE Orbit takes focus, so
            // window-management commands target it (not Orbit itself).
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut last) = state.last_foreground.lock() {
                    *last = window_mgmt::platform::foreground_window();
                }
            }
            position_upper_centre(&win);
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// Place the window horizontally centred and ~18% from the top of the active
/// monitor — the classic launcher position.
fn position_upper_centre(win: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = win.current_monitor() {
        let screen = monitor.size();
        if let Ok(size) = win.outer_size() {
            let x = (screen.width as i32 - size.width as i32) / 2;
            let y = (screen.height as f64 * 0.18) as i32;
            let _ = win.set_position(tauri::PhysicalPosition::new(x.max(0), y.max(0)));
        }
    } else {
        let _ = win.center();
    }
}

fn init_database(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db_path = dir.join("orbit.sqlite");
    orbit_core::open(&db_path.to_string_lossy()).map_err(|e| e.to_string())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};

    let open_i = MenuItem::with_id(app, "open", "Open Orbit", true, Some("Alt+Space"))?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit Orbit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_i, &sep, &quit_i])?;

    let mut builder = TrayIconBuilder::with_id("orbit-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Orbit")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => toggle_launcher(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                toggle_launcher(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Alt+Space is the Windows default; configurable later via settings.
    let activation = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    let activation_for_handler = activation.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &activation_for_handler
                        && event.state() == ShortcutState::Pressed
                    {
                        toggle_launcher(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let handle = app.handle().clone();

            // Database (opened + migrated by orbit-core).
            let conn = init_database(&handle).map_err(|e| {
                eprintln!("[orbit] database init failed: {e}");
                std::io::Error::new(std::io::ErrorKind::Other, e)
            })?;

            // Application index (best-effort; empty on permission denial).
            let apps = apps::scan_applications();

            app.manage(AppState {
                db: Mutex::new(conn),
                apps: Mutex::new(apps),
                last_foreground: Mutex::new(0),
            });

            // Register the global activation shortcut.
            if let Err(e) = app.global_shortcut().register(activation.clone()) {
                eprintln!("[orbit] failed to register global shortcut: {e}");
            }

            build_tray(&handle)?;

            // Start watching the clipboard for history.
            clipboard_monitor::spawn(handle.clone());

            // Seed the snippet-expansion watcher from the DB, then start the
            // system-wide keyword hook only if the user has opted in. Toggling
            // the setting takes effect on next launch.
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(conn) = state.db.lock() {
                    commands::refresh_watcher(&conn);
                    let enabled = orbit_core::get_setting(&conn, "snippets.expansion.enabled")
                        .ok()
                        .flatten()
                        .as_deref()
                        == Some("true");
                    if enabled {
                        snippet_watcher::start();
                    }
                }
            }

            // Hide the launcher when it loses focus (unless devtools is open).
            if let Some(win) = app.get_webview_window(LAUNCHER_LABEL) {
                let win_for_event = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = win_for_event.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_applications,
            commands::reindex_applications,
            commands::get_setting,
            commands::set_setting,
            commands::record_command_usage,
            commands::usage_snapshot,
            commands::launch_path,
            commands::open_url,
            commands::manage_window,
            commands::clipboard_list,
            commands::clipboard_delete,
            commands::clipboard_clear,
            commands::clipboard_pin,
            commands::clipboard_set,
            commands::snippet_list,
            commands::snippet_create,
            commands::snippet_update,
            commands::snippet_delete,
            commands::snippet_record_use,
            commands::snippet_watcher_status,
            commands::snippet_watcher_set_enabled,
            commands::snippet_watcher_restart,
            commands::paste_text,
            commands::hide_launcher,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Orbit");
}
