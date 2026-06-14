//! System-wide snippet expansion via a low-level keyboard hook (Windows).
//!
//! A dedicated thread installs a `WH_KEYBOARD_LL` hook and pumps its own message
//! loop. Each non-injected key-down is translated to a character and fed to the
//! pure [`orbit_input::TriggerMatcher`]; when a keyword completes, the (already
//! tested) matcher reports how many characters to delete and which snippet to
//! insert. The actual injection runs on a separate worker thread (you must not
//! call `SendInput` from inside the hook), and Orbit ignores its own synthesised
//! events via the [`orbit_input::ORBIT_INJECT_SIGNATURE`] marker so expansion
//! can't feed back on itself.
//!
//! The watcher has a controllable lifecycle ([`start`], [`stop`], [`restart`],
//! [`status`]). Both `start` and `stop` are idempotent — the pure
//! [`orbit_input::Lifecycle`] decides whether a request actually needs to
//! (un)install the hook. Stopping cleanly unhooks: we `PostThreadMessage(WM_QUIT)`
//! to the hook thread, whose `GetMessage` loop then exits and calls
//! `UnhookWindowsHookEx`. The injection worker is started once and parked on its
//! channel across restarts.
//!
//! The keyword/content maps are shared behind a `Mutex` so snippet edits take
//! effect live via [`set_snippets`]. Expansion is opt-in (a setting); when the
//! hook thread isn't started, [`set_snippets`] still maintains state cheaply.

#[cfg(windows)]
pub use platform::{restart, set_snippets, start, status, stop};

#[cfg(not(windows))]
pub use stub::{restart, set_snippets, start, status, stop};

/// Runtime status of the expansion watcher, surfaced to the Settings UI.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct WatcherStatus {
    /// Whether the OS keyboard hook is currently installed and listening.
    pub running: bool,
    /// Number of snippet keywords currently registered for expansion.
    pub keyword_count: usize,
    /// Whether this platform supports system-wide expansion at all.
    pub supported: bool,
}

#[cfg(not(windows))]
mod stub {
    use super::WatcherStatus;
    use std::collections::HashMap;

    pub fn set_snippets(_pairs: Vec<(String, String)>, _content: HashMap<String, String>) {}
    pub fn start() {}
    pub fn stop() {}
    pub fn restart() {}
    pub fn status() -> WatcherStatus {
        WatcherStatus {
            running: false,
            keyword_count: 0,
            supported: false,
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::WatcherStatus;
    use std::collections::HashMap;
    use std::sync::mpsc::{self, Sender};
    use std::sync::{Mutex, OnceLock};
    use std::thread;
    use std::time::Duration;

    use orbit_input::{platform as inject, Lifecycle, TriggerMatcher, ORBIT_INJECT_SIGNATURE};
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyboardState, MapVirtualKeyW, ToUnicode, MAPVK_VK_TO_VSC, VK_BACK, VK_DELETE, VK_DOWN,
        VK_END, VK_ESCAPE, VK_HOME, VK_LEFT, VK_RETURN, VK_RIGHT, VK_TAB, VK_UP,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
        TranslateMessage, UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN,
    };

    struct WatcherState {
        matcher: TriggerMatcher,
        content: HashMap<String, String>,
    }

    /// Controllable lifecycle plus the hook thread's id (so [`stop`] can post it
    /// `WM_QUIT`). Held behind its own mutex, separate from the keyword state.
    struct Control {
        lifecycle: Lifecycle,
        hook_thread_id: u32,
    }

    /// Work item handed to the injection thread.
    struct Job {
        backspaces: usize,
        text: String,
    }

    static STATE: OnceLock<Mutex<WatcherState>> = OnceLock::new();
    static CONTROL: OnceLock<Mutex<Control>> = OnceLock::new();
    static EXPANDER: OnceLock<Sender<Job>> = OnceLock::new();

    fn state() -> &'static Mutex<WatcherState> {
        STATE.get_or_init(|| {
            Mutex::new(WatcherState {
                matcher: TriggerMatcher::default(),
                content: HashMap::new(),
            })
        })
    }

    fn control() -> &'static Mutex<Control> {
        CONTROL.get_or_init(|| {
            Mutex::new(Control {
                lifecycle: Lifecycle::new(),
                hook_thread_id: 0,
            })
        })
    }

    /// Replace the keyword→snippet and snippet→content maps. Cheap; safe to call
    /// before [`start`] and on every snippet mutation.
    pub fn set_snippets(pairs: Vec<(String, String)>, content: HashMap<String, String>) {
        if let Ok(mut s) = state().lock() {
            s.matcher.set_keywords(pairs);
            s.content = content;
        }
    }

    /// Translate a virtual-key code to the character it would produce given the
    /// current modifier/lock state. Returns None for non-text keys.
    fn vk_to_char(vk: u32) -> Option<char> {
        unsafe {
            let mut keystate = [0u8; 256];
            if GetKeyboardState(&mut keystate).is_err() {
                return None;
            }
            let scan = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
            let mut buf = [0u16; 8];
            let n = ToUnicode(vk, scan, Some(&keystate), &mut buf, 0);
            if n == 1 {
                char::from_u32(buf[0] as u32)
            } else {
                None
            }
        }
    }

    fn process_key(vk: u32) {
        let v = vk as u16;
        let mut guard = match state().lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if !guard.matcher.is_active() {
            return;
        }
        if v == VK_BACK.0 {
            guard.matcher.on_backspace();
            return;
        }
        // Navigation / commit keys break typing continuity.
        if matches!(
            v,
            x if x == VK_RETURN.0
                || x == VK_TAB.0
                || x == VK_ESCAPE.0
                || x == VK_LEFT.0
                || x == VK_RIGHT.0
                || x == VK_UP.0
                || x == VK_DOWN.0
                || x == VK_HOME.0
                || x == VK_END.0
                || x == VK_DELETE.0
        ) {
            guard.matcher.reset();
            return;
        }
        let Some(c) = vk_to_char(vk) else {
            return;
        };
        if let Some(exp) = guard.matcher.on_char(c) {
            if let Some(text) = guard.content.get(&exp.snippet_id).cloned() {
                if let Some(tx) = EXPANDER.get() {
                    let _ = tx.send(Job {
                        backspaces: exp.backspaces,
                        text,
                    });
                }
            }
        }
    }

    extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let msg = wparam.0 as u32;
            if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                let kb = unsafe { *(lparam.0 as *const KBDLLHOOKSTRUCT) };
                // Ignore the keystrokes we synthesised ourselves.
                if kb.dwExtraInfo != ORBIT_INJECT_SIGNATURE {
                    process_key(kb.vkCode);
                }
            }
        }
        unsafe { CallNextHookEx(HHOOK::default(), code, wparam, lparam) }
    }

    /// Start the injection worker exactly once. The worker parks on its channel
    /// and survives watcher stop/restart cycles.
    fn ensure_worker() {
        let (tx, rx) = mpsc::channel::<Job>();
        if EXPANDER.set(tx).is_err() {
            return; // already started
        }
        thread::spawn(move || {
            while let Ok(job) = rx.recv() {
                // Let the triggering keystroke land first, then rewrite it.
                thread::sleep(Duration::from_millis(8));
                let _ = inject::send_backspaces(job.backspaces);
                let _ = inject::send_text(&job.text);
            }
        });
    }

    /// Spawn the hook thread and block until it has installed the hook (or
    /// failed). Returns the thread id on success so [`stop`] can post it WM_QUIT.
    fn spawn_hook_thread() -> Option<u32> {
        let (tx, rx) = mpsc::channel::<Option<u32>>();
        thread::spawn(move || unsafe {
            let tid = GetCurrentThreadId();
            let hmod = GetModuleHandleW(None).unwrap_or_default();
            let hook =
                match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), HINSTANCE(hmod.0), 0) {
                    Ok(h) => h,
                    Err(_) => {
                        let _ = tx.send(None);
                        return;
                    }
                };
            let _ = tx.send(Some(tid));
            // Message loop is required by WH_KEYBOARD_LL; it ends on WM_QUIT.
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            // Clean up so a later restart installs a fresh hook.
            let _ = UnhookWindowsHookEx(hook);
        });
        rx.recv().ok().flatten()
    }

    /// Install the keyboard hook and begin expanding. Idempotent: a second call
    /// while already running is a no-op.
    pub fn start() {
        let Ok(mut ctrl) = control().lock() else {
            return;
        };
        if !ctrl.lifecycle.start().changed() {
            return; // already running
        }
        ensure_worker();
        match spawn_hook_thread() {
            Some(id) => ctrl.hook_thread_id = id,
            None => {
                // Hook failed to install — roll the lifecycle back so status is
                // honest and a later retry can try again.
                ctrl.lifecycle.stop();
                ctrl.hook_thread_id = 0;
            }
        }
    }

    /// Uninstall the keyboard hook. Idempotent: a second call while already
    /// stopped is a no-op.
    pub fn stop() {
        let Ok(mut ctrl) = control().lock() else {
            return;
        };
        if !ctrl.lifecycle.stop().changed() {
            return; // already stopped
        }
        let id = ctrl.hook_thread_id;
        ctrl.hook_thread_id = 0;
        if id != 0 {
            unsafe {
                let _ = PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }
    }

    /// Stop then start, picking up any keyword/content changes.
    pub fn restart() {
        stop();
        // Give the hook thread a beat to unwind before reinstalling.
        thread::sleep(Duration::from_millis(20));
        start();
    }

    /// Current running state and registered keyword count.
    pub fn status() -> WatcherStatus {
        let running = control()
            .lock()
            .map(|c| c.lifecycle.is_running())
            .unwrap_or(false);
        let keyword_count = state()
            .lock()
            .map(|s| s.matcher.keyword_count())
            .unwrap_or(0);
        WatcherStatus {
            running,
            keyword_count,
            supported: true,
        }
    }
}
