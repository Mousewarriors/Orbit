#![cfg_attr(test, allow(dead_code, unused_imports))]

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
mod extension_host;
mod file_index;
mod launcher;
mod relay_manifest;
mod relay_protocol;
mod relay_supervisor;
mod snippet_watcher;
mod window_mgmt;

use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use commands::{AppState, DEFAULT_HOTKEY};

const LAUNCHER_LABEL: &str = "launcher";
const SETTINGS_LABEL: &str = "settings";

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

/// Bring the launcher to the foreground (used when a second instance is launched
/// — we surface the existing instance rather than starting a new one).
fn focus_launcher(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LAUNCHER_LABEL) {
        position_upper_centre(&win);
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn shutdown_relay(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        let _ = state.relay.shutdown(app.clone());
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
            "quit" => {
                shutdown_relay(app);
                app.exit(0);
            }
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

#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST be the first plugin: if Orbit is already running, a
        // second launch fires this callback in the existing instance (instead of
        // starting a new one) and we simply surface the launcher.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_launcher(app);
        }))
        // Launch-at-login support; toggled from Settings → General via the
        // get_autostart/set_autostart commands (the manager API, so no extra
        // frontend capability is needed). No args; on Windows the macOS launcher
        // argument is ignored.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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

            // Application index. Use the fast, dependency-free Start Menu `.lnk`
            // scan synchronously so startup isn't blocked; the full scan (which
            // also enumerates UWP / Store apps via PowerShell) runs in the
            // background below and replaces this list.
            let apps = apps::scan_lnk_apps();

            // Resolve the activation shortcut from settings (default Alt+Space),
            // falling back gracefully if a stored value can't be parsed.
            let stored_hotkey = orbit_core::get_setting(&conn, "general.hotkey")
                .ok()
                .flatten();
            let shortcut = stored_hotkey
                .as_deref()
                .and_then(|s| s.parse::<Shortcut>().ok())
                .or_else(|| DEFAULT_HOTKEY.parse::<Shortcut>().ok());

            // Read the first-run flag before `conn` is moved into AppState.
            let need_bundled = orbit_core::get_setting(&conn, "extensions.bundled_installed")
                .ok()
                .flatten()
                .is_none();

            // Register managed state BEFORE any potentially slow work so that
            // the packaged-build webview (which loads bundled assets directly
            // from the binary with no dev-server round-trip) cannot invoke IPC
            // commands before manage() has run.  Previously manage() was called
            // after install_bundled(), which does file I/O on first launch and
            // caused a race that surfaced as "state not managed" in the
            // installed release while development (Vite dev-server latency)
            // always completed manage() first.
            app.manage(AppState {
                db: Mutex::new(conn),
                apps: Mutex::new(apps),
                last_foreground: Mutex::new(0),
                active_shortcut: Mutex::new(shortcut),
                index: file_index::IndexState::default(),
                ext_host: extension_host::ExtensionHost::default(),
                relay: relay_supervisor::RelaySupervisor::default(),
            });

            // First run only: install the bundled sample extensions (Developer
            // Utilities, AgentOS Controller) so they're discoverable without a
            // manual "Developer folders" setup. Gated by a one-time flag so a
            // deliberate uninstall (deleting the folder) isn't silently undone
            // on the next launch. Runs after manage() so this file I/O cannot
            // race with the webview's startup IPC calls in the packaged build.
            if need_bundled {
                extension_host::install_bundled(&handle);
                let _ = app
                    .state::<AppState>()
                    .db
                    .lock()
                    .map(|conn| {
                        orbit_core::set_setting(&conn, "extensions.bundled_installed", "true")
                    });
            }

            // Register the global activation shortcut.
            if let Some(sc) = shortcut {
                if let Err(e) = app.global_shortcut().register(sc) {
                    eprintln!("[orbit] failed to register global shortcut: {e}");
                }
            }

            // Discover extensions (filesystem-only — no child process spawned)
            // so any installed/bundled extensions are searchable immediately,
            // without requiring a manual visit to Settings → Extensions.
            {
                let state = app.state::<AppState>();
                let roots = {
                    let conn = state.db.lock().map_err(|e| {
                        std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
                    })?;
                    extension_host::roots(&handle, &conn)
                };
                state.ext_host.reload(&roots);
            }

            // Augment the fast `.lnk` index with UWP / Store apps in the
            // background (this spawns PowerShell, so it must not block startup).
            {
                let handle = handle.clone();
                std::thread::spawn(move || {
                    let full = apps::scan_applications();
                    if let Some(state) = handle.try_state::<AppState>() {
                        if let Ok(mut apps) = state.apps.lock() {
                            *apps = full;
                        }
                    }
                });
            }

            build_tray(&handle)?;

            // Start the certified Relay sidecar in the background. Orbit startup
            // must remain usable even if Relay is missing, slow or degraded.
            if let Some(state) = app.try_state::<AppState>() {
                if let Err(error) = state.relay.start(handle.clone()) {
                    eprintln!("[orbit] relay startup failed: {error}");
                }
            }

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
                    let file_indexing = file_index::is_enabled(&conn);
                    // Discover installed extensions.
                    let ext_roots = extension_host::roots(&handle, &conn);
                    drop(conn);
                    if file_indexing {
                        file_index::rebuild(handle.clone());
                    }
                    state.ext_host.reload(&ext_roots);
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

            // The Settings window is declared in tauri.conf.json (created at startup
            // like the launcher, so it reliably loads the app — unlike a webview
            // created at runtime, which strands on about:blank in dev). Keep it
            // alive across closes: hide it on close instead of destroying it, so
            // `open_settings` can always re-show this same, already-loaded window.
            if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
                let win_for_event = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
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
            commands::get_home_dir,
            commands::diagnostics,
            commands::open_data_dir,
            commands::note_list,
            commands::note_create,
            commands::note_update,
            commands::note_delete,
            commands::note_set_pinned,
            commands::extension_list,
            commands::extension_commands,
            commands::extension_run,
            commands::extension_set_enabled,
            commands::extension_reload,
            commands::extension_reload_one,
            commands::extension_install_bundled,
            commands::extension_errors,
            commands::extension_get_dev_paths,
            commands::extension_set_dev_paths,
            commands::quicklink_list,
            commands::quicklink_create,
            commands::quicklink_update,
            commands::quicklink_delete,
            commands::file_search,
            commands::file_index_status,
            commands::file_index_set_enabled,
            commands::file_index_rebuild,
            commands::file_index_clear,
            commands::reveal_path,
            commands::hide_launcher,
            commands::get_autostart,
            commands::set_autostart,
            commands::relay_status,
            commands::relay_health,
            commands::relay_capabilities,
            commands::relay_list_agents,
            commands::relay_get_agent,
            commands::relay_scan_projects,
            commands::relay_inspect_project,
            commands::relay_create_launch_plan,
            commands::relay_execute_launch,
            commands::relay_list_sessions,
            commands::relay_get_session,
            commands::relay_stop_session,
            commands::relay_create_handoff,
            commands::relay_validate_handoff,
            commands::relay_list_events,
            commands::relay_restart,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Orbit")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                shutdown_relay(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build an `AppState` equivalent to the one created in `run()` but using an
    /// in-memory SQLite database, so the test is hermetic and has no filesystem
    /// side-effects. Mirrors the exact field set that `app.manage()` receives.
    fn make_state() -> commands::AppState {
        let conn = orbit_core::open_in_memory().expect("in-memory db");
        commands::AppState {
            db: Mutex::new(conn),
            apps: Mutex::new(Vec::new()),
            last_foreground: Mutex::new(0),
            active_shortcut: Mutex::new(None),
            index: file_index::IndexState::default(),
            ext_host: extension_host::ExtensionHost::default(),
            relay: relay_supervisor::RelaySupervisor::default(),
        }
    }

    /// Every command-required managed type must be constructible via the same
    /// path used in both `tauri dev` and the packaged release (no
    /// cfg(debug_assertions) guard around AppState construction).
    #[test]
    fn app_state_constructs_without_panicking() {
        let state = make_state();
        assert!(state.db.lock().is_ok(), "db mutex must be accessible");
        assert!(state.apps.lock().is_ok(), "apps mutex must be accessible");
        assert!(state.last_foreground.lock().is_ok());
        assert!(state.active_shortcut.lock().is_ok());
    }

    /// Simulate what `list_applications` does: lock the apps mutex and clone.
    /// This must succeed immediately after construction — confirming the command
    /// would work from the very first IPC call in a packaged release.
    #[test]
    fn list_applications_succeeds_immediately_after_construction() {
        let state = make_state();
        let apps = state.apps.lock().expect("apps mutex").clone();
        assert!(apps.is_empty(), "fresh state starts with an empty app index");
    }

    /// The database must be migrated and queryable the instant AppState is
    /// constructed — commands that access `state.db.lock()` on the very first
    /// IPC call must not see an uninitialised schema.
    #[test]
    fn db_is_migrated_and_queryable_at_construction() {
        let state = make_state();
        let conn = state.db.lock().expect("db mutex");
        let result = orbit_core::get_setting(&conn, "extensions.bundled_installed");
        assert!(result.is_ok(), "settings table must exist immediately after construction");
        assert_eq!(result.unwrap(), None, "fresh db has no bundled_installed flag");
    }

    /// Verify the first-run flag lifecycle: absent at construction, present after
    /// set_setting — matching what startup writes after install_bundled().
    #[test]
    fn bundled_install_flag_readable_and_settable_via_state() {
        let state = make_state();
        {
            let conn = state.db.lock().expect("db mutex");
            let before =
                orbit_core::get_setting(&conn, "extensions.bundled_installed").unwrap();
            assert_eq!(before, None, "flag must be absent before first install");
            orbit_core::set_setting(&conn, "extensions.bundled_installed", "true").unwrap();
        }
        let conn = state.db.lock().expect("db mutex");
        let after = orbit_core::get_setting(&conn, "extensions.bundled_installed").unwrap();
        assert_eq!(after, Some("true".to_string()), "flag must persist after set");
    }

    /// Confirm that the need_bundled check (reading the flag before conn is moved
    /// into AppState) and the subsequent flag write (via state.db after manage())
    /// round-trip correctly — the exact sequence executed by the fixed startup path.
    #[test]
    fn need_bundled_flag_follows_fixed_startup_sequence() {
        let conn = orbit_core::open_in_memory().expect("in-memory db");

        // Phase 1: read flag before move (mirrors pre-manage() code path)
        let need_bundled = orbit_core::get_setting(&conn, "extensions.bundled_installed")
            .ok()
            .flatten()
            .is_none();
        assert!(need_bundled, "first launch: bundled_installed is absent");

        // Phase 2: move conn into state (mirrors app.manage())
        let state = commands::AppState {
            db: Mutex::new(conn),
            apps: Mutex::new(Vec::new()),
            last_foreground: Mutex::new(0),
            active_shortcut: Mutex::new(None),
            index: file_index::IndexState::default(),
            ext_host: extension_host::ExtensionHost::default(),
            relay: relay_supervisor::RelaySupervisor::default(),
        };

        // Phase 3: write flag via state (mirrors post-manage() code path)
        if need_bundled {
            if let Ok(c) = state.db.lock() {
                orbit_core::set_setting(&c, "extensions.bundled_installed", "true").unwrap();
            }
        }

        // Verify subsequent launches would not re-install
        let conn2 = state.db.lock().expect("db mutex");
        let need_again = orbit_core::get_setting(&conn2, "extensions.bundled_installed")
            .ok()
            .flatten()
            .is_none();
        assert!(!need_again, "second launch: bundled_installed present, skip install");
    }
}
