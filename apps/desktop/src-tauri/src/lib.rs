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
mod file_index;
mod snippet_watcher;
mod window_mgmt;

use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use commands::{AppState, DEFAULT_HOTKEY};

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
    let settings_i = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit Orbit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_i, &settings_i, &sep, &quit_i])?;

    let mut builder = TrayIconBuilder::with_id("orbit-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Orbit")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => toggle_launcher(app),
            "settings" => {
                let _ = commands::open_settings(app.clone());
            }
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    // Match against the user's configured shortcut (held in state
                    // so it can be re-bound at runtime from Settings).
                    if let Some(state) = app.try_state::<AppState>() {
                        if let Ok(active) = state.active_shortcut.lock() {
                            if active.as_ref() == Some(shortcut) {
                                toggle_launcher(app);
                            }
                        }
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

            // Resolve the activation shortcut from settings (default Alt+Space),
            // falling back gracefully if a stored value can't be parsed.
            let stored_hotkey = orbit_core::get_setting(&conn, "general.hotkey")
                .ok()
                .flatten();
            let shortcut = stored_hotkey
                .as_deref()
                .and_then(|s| s.parse::<Shortcut>().ok())
                .or_else(|| DEFAULT_HOTKEY.parse::<Shortcut>().ok());

            app.manage(AppState {
                db: Mutex::new(conn),
                apps: Mutex::new(apps),
                last_foreground: Mutex::new(0),
                active_shortcut: Mutex::new(shortcut),
                index: file_index::IndexState::default(),
            });

            // Register the global activation shortcut.
            if let Some(sc) = shortcut {
                if let Err(e) = app.global_shortcut().register(sc) {
                    eprintln!("[orbit] failed to register global shortcut: {e}");
                }
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
                    // Refresh the file index in the background if the user has
                    // enabled it (no-op / no disk scan otherwise).
                    if file_index::is_enabled(&conn) {
                        drop(conn);
                        file_index::rebuild(handle.clone());
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
            commands::open_settings,
            commands::set_activation_shortcut,
            commands::diagnostics,
            commands::open_data_dir,
            commands::note_list,
            commands::note_create,
            commands::note_update,
            commands::note_delete,
            commands::note_set_pinned,
            commands::quicklink_list,
            commands::quicklink_create,
            commands::quicklink_update,
            commands::quicklink_delete,
            commands::file_search,
            commands::file_index_status,
            commands::file_index_set_enabled,
            commands::file_index_rebuild,
            commands::reveal_path,
            commands::hide_launcher,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Orbit");
}
