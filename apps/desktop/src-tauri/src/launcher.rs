//! Native application & path launching.
//!
//! The renderer's `open-path` action funnels through the `launch_path` IPC
//! command into here. On Windows we deliberately do **not** use the opener
//! plugin for the critical app-launch path; we call `ShellExecuteW` ourselves,
//! because:
//!
//!   * `.lnk` shortcuts are resolved by COM-based shell handlers, so COM must be
//!     initialised on the *calling* thread. Tauri runs synchronous commands on a
//!     runtime worker thread that has no COM apartment, which makes the plugin's
//!     `ShellExecuteEx` launch silently unreliable for shortcuts — the root cause
//!     of "application results appear but do not launch".
//!   * We inspect the returned `HINSTANCE` code and turn any failure into a clear
//!     error message, so a failed launch is never swallowed (the renderer shows
//!     it and does not record usage or hide).
//!
//! UWP / Microsoft Store apps and other shell items (`shell:AppsFolder\<AUMID>`)
//! are activated through Explorer, which is the supported way to launch them. The
//! target is always passed as a single argument — never through a shell — so
//! there is no command-injection surface. Paths come from Orbit's own index.

#[cfg(windows)]
pub mod platform {
    use std::os::windows::process::CommandExt;
    use std::path::Path;
    use std::process::Command;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        ApplicationActivationManager, IApplicationActivationManager, IShellItem, IShellItemArray,
        SHCreateItemFromParsingName, SHCreateShellItemArrayFromShellItem, ShellExecuteW,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    /// Don't flash a console window when spawning Explorer.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn wide(s: &str) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// Is `target` a shell moniker (e.g. `shell:AppsFolder\<AUMID>`) rather than a
    /// filesystem path? Those are activated via Explorer, not `ShellExecuteW`.
    pub fn is_shell_item(target: &str) -> bool {
        target.len() > "shell:".len() && target[.."shell:".len()].eq_ignore_ascii_case("shell:")
    }

    fn apps_folder_aumid(target: &str) -> Option<&str> {
        const PREFIX: &str = r"shell:AppsFolder\";
        if target.len() <= PREFIX.len() || !target[..PREFIX.len()].eq_ignore_ascii_case(PREFIX) {
            return None;
        }
        Some(&target[PREFIX.len()..])
    }

    /// Map a failing `ShellExecute` `HINSTANCE` code to a human-readable reason.
    /// (Legacy ShellExecute reports errors as a small integer return value.)
    pub fn shell_error(code: isize) -> String {
        let reason = match code {
            0 => "the system is out of memory or resources",
            2 => "the file was not found",
            3 => "the path was not found",
            5 => "access was denied",
            8 => "there was not enough memory to complete the operation",
            26 => "a sharing violation occurred",
            27 => "the filename association is incomplete or invalid",
            31 => "there is no application associated with this file",
            32 => "the associated application failed to start",
            _ => "the application could not be started",
        };
        format!("launch failed: {reason} (code {code})")
    }

    fn regular_windows_path(path: &str) -> String {
        if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else if let Some(rest) = path.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            path.to_string()
        }
    }

    /// Launch an application, file, folder, shortcut, or shell item.
    ///
    /// Returns `Ok(())` only when the OS reports the launch actually started.
    pub fn launch(target: &str) -> Result<(), String> {
        let target = target.trim();
        if target.is_empty() {
            return Err("empty path".into());
        }

        // UWP / Store apps and other AppsFolder items: Explorer activates them.
        if is_shell_item(target) {
            return Command::new("explorer.exe")
                .arg(target)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("launch failed: could not start Explorer ({e})"));
        }

        // A real filesystem path that no longer exists (stale index, deleted or
        // moved file) should fail with a clear message, not a vague code.
        if !Path::new(target).exists() {
            return Err(format!("launch failed: '{target}' no longer exists"));
        }

        // `ShellExecuteW` may delegate to COM shell handlers (notably to resolve a
        // `.lnk` shortcut), which require COM on this thread. Initialise an
        // apartment here; a benign error if one already exists on the thread.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }

        // Keep the wide buffers alive for the duration of the call.
        let verb = wide("open");
        let file = wide(target);
        let hinst = unsafe {
            ShellExecuteW(
                HWND::default(),
                PCWSTR(verb.as_ptr()),
                PCWSTR(file.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        // `ShellExecuteW` returns an `HINSTANCE`; a value greater than 32 means the
        // launch succeeded, anything else is an error code.
        let code = hinst.0 as isize;
        if code > 32 {
            Ok(())
        } else {
            Err(shell_error(code))
        }
    }

    /// Launch an indexed desktop application with one filesystem path argument.
    /// This is intentionally narrower than arbitrary argv: callers cannot pass
    /// switches, multiple arguments, or a command line.
    pub fn launch_with_path(target: &str, path: &str) -> Result<(), String> {
        let target = target.trim();
        let path = path.trim();
        if target.is_empty() || path.is_empty() {
            return Err("launch target and project path are required".into());
        }
        if is_shell_item(target) {
            return Err("this application type cannot accept a project path".into());
        }
        if !Path::new(target).exists() {
            return Err(format!("launch failed: '{target}' no longer exists"));
        }
        let argument = Path::new(path);
        if !argument.is_absolute() || !argument.is_dir() {
            return Err("project path must be an existing absolute directory".into());
        }

        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        let verb = wide("open");
        let file = wide(target);
        // Windows paths cannot contain a quote, so one quoted path is an
        // unambiguous single command-line argument.
        let parameters = wide(&format!("\"{}\"", regular_windows_path(path)));
        let hinst = unsafe {
            ShellExecuteW(
                HWND::default(),
                PCWSTR(verb.as_ptr()),
                PCWSTR(file.as_ptr()),
                PCWSTR(parameters.as_ptr()),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        let code = hinst.0 as isize;
        if code > 32 {
            Ok(())
        } else {
            Err(shell_error(code))
        }
    }

    fn shell_item_array_for_file(path: &str) -> Result<IShellItemArray, String> {
        let path_wide = wide(path);
        let item: IShellItem =
            unsafe { SHCreateItemFromParsingName(PCWSTR(path_wide.as_ptr()), None) }
                .map_err(|e| format!("launch failed: could not resolve file shell item ({e})"))?;
        unsafe { SHCreateShellItemArrayFromShellItem(&item) }
            .map_err(|e| format!("launch failed: could not create file activation item ({e})"))
    }

    fn activate_app_for_file(aumid: &str, path: &str) -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        let app_id = wide(aumid);
        let verb = wide("open");
        let items = shell_item_array_for_file(path)?;
        let manager: IApplicationActivationManager = unsafe {
            CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)
        }
        .map_err(|e| format!("launch failed: could not create app activation manager ({e})"))?;
        unsafe {
            manager
                .ActivateForFile(PCWSTR(app_id.as_ptr()), &items, PCWSTR(verb.as_ptr()))
                .map(|_| ())
        }
        .map_err(|e| format!("launch failed: app file activation failed ({e})"))
    }

    /// Launch an indexed desktop application with one filesystem file argument.
    /// Classic apps receive a single quoted path argument via `ShellExecuteW`;
    /// Windows Store/AppX AppsFolder entries use `IApplicationActivationManager`
    /// file activation. Both paths are narrower than arbitrary argv.
    pub fn launch_with_file(target: &str, path: &str) -> Result<(), String> {
        let target = target.trim();
        let path = path.trim();
        if target.is_empty() || path.is_empty() {
            return Err("launch target and file path are required".into());
        }
        let argument = Path::new(path);
        if !argument.is_absolute() || !argument.is_file() {
            return Err("file path must be an existing absolute file".into());
        }
        if let Some(aumid) = apps_folder_aumid(target) {
            return activate_app_for_file(aumid, path);
        }
        if is_shell_item(target) {
            return Err("this shell item type cannot accept a file path".into());
        }
        if !Path::new(target).exists() {
            return Err(format!("launch failed: '{target}' no longer exists"));
        }

        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        let verb = wide("open");
        let file = wide(target);
        let parameters = wide(&format!("\"{}\"", regular_windows_path(path)));
        let hinst = unsafe {
            ShellExecuteW(
                HWND::default(),
                PCWSTR(verb.as_ptr()),
                PCWSTR(file.as_ptr()),
                PCWSTR(parameters.as_ptr()),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        let code = hinst.0 as isize;
        if code > 32 {
            Ok(())
        } else {
            Err(shell_error(code))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn empty_target_errors() {
            assert!(launch("   ").is_err());
        }

        #[test]
        fn missing_path_reports_a_clear_error() {
            let err = launch(r"C:\orbit\definitely\does\not\exist.lnk").unwrap_err();
            assert!(err.contains("no longer exists"), "unexpected error: {err}");
        }

        #[test]
        fn shell_item_detection() {
            assert!(is_shell_item(
                r"shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
            ));
            assert!(is_shell_item("SHELL:Foo"));
            assert!(!is_shell_item(r"C:\Windows\notepad.exe"));
            assert!(!is_shell_item("shell:")); // prefix only, nothing to launch
            assert!(!is_shell_item("shell"));
        }

        #[test]
        fn apps_folder_aumid_is_extracted_case_insensitively() {
            assert_eq!(
                apps_folder_aumid(r"shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App"),
                Some("Microsoft.Paint_8wekyb3d8bbwe!App")
            );
            assert_eq!(
                apps_folder_aumid(r"SHELL:APPSFOLDER\Microsoft.Paint_8wekyb3d8bbwe!App"),
                Some("Microsoft.Paint_8wekyb3d8bbwe!App")
            );
            assert_eq!(apps_folder_aumid("shell:AppsFolder\\"), None);
            assert_eq!(apps_folder_aumid(r"shell:Other\Thing"), None);
        }

        #[test]
        fn error_messages_are_descriptive() {
            assert!(shell_error(2).contains("not found"));
            assert!(shell_error(31).contains("no application"));
            assert!(shell_error(5).contains("access"));
        }

        #[test]
        fn project_launch_rejects_missing_target() {
            let err = launch_with_path(r"C:\orbit\definitely\does\not\exist.lnk", r"C:\orbit")
                .unwrap_err();
            assert!(err.contains("no longer exists"), "unexpected error: {err}");
        }

        #[test]
        fn file_launch_rejects_missing_target() {
            let path = std::env::temp_dir().join("orbit-launch-test-map.png");
            std::fs::write(&path, b"not really an image").unwrap();
            let err = launch_with_file(
                r"C:\orbit\definitely\does\not\exist.lnk",
                path.to_str().unwrap(),
            )
            .unwrap_err();
            let _ = std::fs::remove_file(path);
            assert!(err.contains("no longer exists"), "unexpected error: {err}");
        }

        #[test]
        fn project_arguments_drop_the_verbatim_path_prefix() {
            assert_eq!(
                regular_windows_path(r"\\?\C:\Users\Simon\Orbit"),
                r"C:\Users\Simon\Orbit"
            );
            assert_eq!(
                regular_windows_path(r"\\?\UNC\server\share\Orbit"),
                r"\\server\share\Orbit"
            );
        }

        /// Real end-to-end launch — opt-in because it actually opens a window.
        /// Targets `$ORBIT_LAUNCH_TEST_PATH` if set (use it to exercise the
        /// `.lnk`/`ShellExecuteW` branch with a real shortcut), otherwise the
        /// Calculator AppsFolder moniker (the Explorer branch). Run with:
        /// `cargo test -p orbit-desktop --lib -- --ignored launches_real_target`
        #[test]
        #[ignore]
        fn launches_real_target() {
            let target = std::env::var("ORBIT_LAUNCH_TEST_PATH").unwrap_or_else(|_| {
                r"shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App".to_string()
            });
            launch(&target).unwrap();
        }

        /// Real file-activation smoke â€” opt-in because it opens Paint/a window.
        /// Defaults to modern Store Paint and a temporary 1x1 BMP, proving the
        /// AppsFolder `ActivateForFile` path used by "open this map in Paint".
        /// Run with:
        /// `cargo test -p orbit-desktop --lib -- --ignored launches_real_file_target`
        #[test]
        #[ignore]
        fn launches_real_file_target() {
            let target = std::env::var("ORBIT_FILE_LAUNCH_TEST_APP").unwrap_or_else(|_| {
                r"shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App".to_string()
            });
            let path = std::env::var("ORBIT_FILE_LAUNCH_TEST_FILE").unwrap_or_else(|_| {
                let path = std::env::temp_dir().join("orbit-paint-file-activation-smoke.bmp");
                let bmp_1x1_red: [u8; 58] = [
                    0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00, 0x00,
                    0x00, 0x28, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
                    0x01, 0x00, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x13,
                    0x0b, 0x00, 0x00, 0x13, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0xff, 0x00,
                ];
                std::fs::write(&path, bmp_1x1_red).unwrap();
                path.to_string_lossy().to_string()
            });
            launch_with_file(&target, &path).unwrap();
        }
    }
}

#[cfg(not(windows))]
pub mod platform {
    /// Non-Windows callers fall back to the opener plugin (see `commands.rs`).
    pub fn launch(_target: &str) -> Result<(), String> {
        Err("the native launcher is implemented on Windows only".into())
    }

    pub fn is_shell_item(_target: &str) -> bool {
        false
    }

    pub fn launch_with_path(_target: &str, _path: &str) -> Result<(), String> {
        Err("opening a project in an application is implemented on Windows only".into())
    }

    pub fn launch_with_file(_target: &str, _path: &str) -> Result<(), String> {
        Err("opening a file in an application is implemented on Windows only".into())
    }
}
