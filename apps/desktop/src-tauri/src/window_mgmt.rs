//! OS-specific window management. The geometry is computed by the pure
//! `orbit-window-manager` crate; this module only reads the monitor work area
//! and moves the target window. Windows is the first-class implementation.

#[cfg(windows)]
pub mod platform {
    use std::ffi::c_void;
    use std::mem::size_of;

    use orbit_window_manager::{compute, Layout, Rect};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, IsZoomed, SetForegroundWindow, SetWindowPos, ShowWindow, HWND_TOP,
        SWP_NOACTIVATE, SWP_NOZORDER, SW_RESTORE,
    };

    /// Capture the current foreground window as a raw handle (isize is Send).
    pub fn foreground_window() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }

    /// Bring the window identified by `hwnd_raw` to the foreground so synthesised
    /// keystrokes land in it. No-op for a null handle.
    pub fn focus_window(hwnd_raw: isize) {
        if hwnd_raw == 0 {
            return;
        }
        let hwnd = HWND(hwnd_raw as *mut c_void);
        unsafe {
            let _ = SetForegroundWindow(hwnd);
        }
    }

    /// Apply `layout` to the window identified by `hwnd_raw` on its monitor.
    pub fn apply(hwnd_raw: isize, layout: Layout, gap: i32) -> Result<(), String> {
        if hwnd_raw == 0 {
            return Err("no target window".into());
        }
        let hwnd = HWND(hwnd_raw as *mut c_void);
        unsafe {
            // Un-maximize first, otherwise SetWindowPos is ignored.
            if IsZoomed(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut mi = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut mi).as_bool() {
                return Err("failed to read monitor info".into());
            }
            // rcWork excludes the taskbar/docked toolbars.
            let wa = mi.rcWork;
            let area = Rect {
                x: wa.left,
                y: wa.top,
                w: wa.right - wa.left,
                h: wa.bottom - wa.top,
            };
            let r = compute(layout, area, gap);
            SetWindowPos(
                hwnd,
                HWND_TOP,
                r.x,
                r.y,
                r.w,
                r.h,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// No foreground capture on non-Windows platforms yet.
#[cfg(not(windows))]
pub mod platform {
    use orbit_window_manager::Layout;

    pub fn foreground_window() -> isize {
        0
    }

    pub fn focus_window(_hwnd_raw: isize) {}

    pub fn apply(_hwnd_raw: isize, _layout: Layout, _gap: i32) -> Result<(), String> {
        Err("Window management is currently implemented on Windows only".into())
    }
}
