//! OS text injection via synthesised keystrokes.
//!
//! Windows uses `SendInput` with `KEYEVENTF_UNICODE`, which types arbitrary
//! Unicode without depending on the current keyboard layout and without
//! clobbering the clipboard. Every synthesised event is stamped with
//! [`crate::ORBIT_INJECT_SIGNATURE`] so the snippet hook ignores its own output.

/// Type `text` into the active application as Unicode keystrokes. Newlines are
/// sent as Enter and tabs as Tab so multi-line snippets land correctly.
#[cfg(windows)]
pub fn send_text(text: &str) -> Result<(), String> {
    platform::send_text(text)
}

/// Delete `count` characters before the caret (synthesised Backspace presses).
#[cfg(windows)]
pub fn send_backspaces(count: usize) -> Result<(), String> {
    platform::send_backspaces(count)
}

#[cfg(not(windows))]
pub fn send_text(_text: &str) -> Result<(), String> {
    Err("Text injection is currently implemented on Windows only".into())
}

#[cfg(not(windows))]
pub fn send_backspaces(_count: usize) -> Result<(), String> {
    Err("Text injection is currently implemented on Windows only".into())
}

#[cfg(windows)]
mod platform {
    use std::mem::size_of;

    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, VIRTUAL_KEY, VK_BACK, VK_RETURN, VK_TAB,
    };

    use crate::ORBIT_INJECT_SIGNATURE;

    fn key_event(vk: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: ORBIT_INJECT_SIGNATURE,
                },
            },
        }
    }

    /// A down+up pair for a virtual-key code (e.g. Enter, Tab, Backspace).
    fn vk_press(vk: VIRTUAL_KEY, out: &mut Vec<INPUT>) {
        out.push(key_event(vk.0, 0, KEYBD_EVENT_FLAGS(0)));
        out.push(key_event(vk.0, 0, KEYEVENTF_KEYUP));
    }

    /// A down+up pair for a single UTF-16 code unit typed as Unicode.
    fn unicode_press(unit: u16, out: &mut Vec<INPUT>) {
        out.push(key_event(0, unit, KEYEVENTF_UNICODE));
        out.push(key_event(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
    }

    fn dispatch(inputs: &[INPUT]) -> Result<(), String> {
        if inputs.is_empty() {
            return Ok(());
        }
        let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
        if sent as usize != inputs.len() {
            return Err("SendInput failed to inject all events".into());
        }
        Ok(())
    }

    pub fn send_text(text: &str) -> Result<(), String> {
        let mut inputs: Vec<INPUT> = Vec::with_capacity(text.len() * 2);
        let mut prev_cr = false;
        for ch in text.chars() {
            match ch {
                // Collapse CRLF to a single Enter; lone CR/LF also become Enter.
                '\r' => {
                    vk_press(VK_RETURN, &mut inputs);
                    prev_cr = true;
                    continue;
                }
                '\n' => {
                    if !prev_cr {
                        vk_press(VK_RETURN, &mut inputs);
                    }
                }
                '\t' => vk_press(VK_TAB, &mut inputs),
                _ => {
                    let mut buf = [0u16; 2];
                    for unit in ch.encode_utf16(&mut buf) {
                        unicode_press(*unit, &mut inputs);
                    }
                }
            }
            prev_cr = false;
        }
        dispatch(&inputs)
    }

    pub fn send_backspaces(count: usize) -> Result<(), String> {
        let mut inputs: Vec<INPUT> = Vec::with_capacity(count * 2);
        for _ in 0..count {
            vk_press(VK_BACK, &mut inputs);
        }
        dispatch(&inputs)
    }
}
