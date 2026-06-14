//! Pure window-layout geometry for Orbit's window manager.
//!
//! This crate is deliberately platform-independent and side-effect-free: given a
//! monitor work area and a desired [`Layout`], it computes the target rectangle.
//! The OS-specific part (reading the work area, moving the window) lives in the
//! Tauri app. Keeping the maths here makes every layout unit-testable.

use std::str::FromStr;

/// A rectangle in physical pixels (origin top-left).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// The set of built-in window layouts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    LeftHalf,
    RightHalf,
    TopHalf,
    BottomHalf,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
    Maximize,
    AlmostMaximize,
    ReasonableSize,
    FirstThird,
    CenterThird,
    LastThird,
    FirstTwoThirds,
    LastTwoThirds,
}

impl FromStr for Layout {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, ()> {
        Ok(match s {
            "left-half" => Layout::LeftHalf,
            "right-half" => Layout::RightHalf,
            "top-half" => Layout::TopHalf,
            "bottom-half" => Layout::BottomHalf,
            "top-left" => Layout::TopLeft,
            "top-right" => Layout::TopRight,
            "bottom-left" => Layout::BottomLeft,
            "bottom-right" => Layout::BottomRight,
            "center" => Layout::Center,
            "maximize" => Layout::Maximize,
            "almost-maximize" => Layout::AlmostMaximize,
            "reasonable-size" => Layout::ReasonableSize,
            "first-third" => Layout::FirstThird,
            "center-third" => Layout::CenterThird,
            "last-third" => Layout::LastThird,
            "first-two-thirds" => Layout::FirstTwoThirds,
            "last-two-thirds" => Layout::LastTwoThirds,
            _ => return Err(()),
        })
    }
}

/// Fractional tile (all values in [0,1]) within the work area.
struct Frac {
    fx: f64,
    fy: f64,
    fw: f64,
    fh: f64,
}

impl Layout {
    fn frac(self) -> Frac {
        let t = 1.0 / 3.0;
        let (fx, fy, fw, fh) = match self {
            Layout::LeftHalf => (0.0, 0.0, 0.5, 1.0),
            Layout::RightHalf => (0.5, 0.0, 0.5, 1.0),
            Layout::TopHalf => (0.0, 0.0, 1.0, 0.5),
            Layout::BottomHalf => (0.0, 0.5, 1.0, 0.5),
            Layout::TopLeft => (0.0, 0.0, 0.5, 0.5),
            Layout::TopRight => (0.5, 0.0, 0.5, 0.5),
            Layout::BottomLeft => (0.0, 0.5, 0.5, 0.5),
            Layout::BottomRight => (0.5, 0.5, 0.5, 0.5),
            Layout::Maximize => (0.0, 0.0, 1.0, 1.0),
            Layout::AlmostMaximize => (0.05, 0.05, 0.9, 0.9),
            Layout::Center | Layout::ReasonableSize => (0.2, 0.15, 0.6, 0.7),
            Layout::FirstThird => (0.0, 0.0, t, 1.0),
            Layout::CenterThird => (t, 0.0, t, 1.0),
            Layout::LastThird => (2.0 * t, 0.0, t, 1.0),
            Layout::FirstTwoThirds => (0.0, 0.0, 2.0 * t, 1.0),
            Layout::LastTwoThirds => (t, 0.0, 2.0 * t, 1.0),
        };
        Frac { fx, fy, fw, fh }
    }

    /// True for layouts that should NOT have a gap applied (full maximize).
    fn ignores_gap(self) -> bool {
        matches!(self, Layout::Maximize)
    }
}

/// Compute the target rectangle for `layout` within `work_area`, applying a
/// uniform `gap` (in px) inset on every side of the tile.
pub fn compute(layout: Layout, work_area: Rect, gap: i32) -> Rect {
    let f = layout.frac();
    let g = if layout.ignores_gap() { 0 } else { gap.max(0) };

    let raw_x = work_area.x + (f.fx * work_area.w as f64).round() as i32;
    let raw_y = work_area.y + (f.fy * work_area.h as f64).round() as i32;
    let raw_w = (f.fw * work_area.w as f64).round() as i32;
    let raw_h = (f.fh * work_area.h as f64).round() as i32;

    let rect = Rect {
        x: raw_x + g,
        y: raw_y + g,
        w: (raw_w - 2 * g).max(1),
        h: (raw_h - 2 * g).max(1),
    };
    rect
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect { x: 0, y: 0, w: 1920, h: 1080 };

    #[test]
    fn left_half_no_gap() {
        assert_eq!(compute(Layout::LeftHalf, AREA, 0), Rect { x: 0, y: 0, w: 960, h: 1080 });
    }

    #[test]
    fn right_half_no_gap() {
        assert_eq!(compute(Layout::RightHalf, AREA, 0), Rect { x: 960, y: 0, w: 960, h: 1080 });
    }

    #[test]
    fn quarters_tile_the_screen() {
        assert_eq!(compute(Layout::TopLeft, AREA, 0), Rect { x: 0, y: 0, w: 960, h: 540 });
        assert_eq!(compute(Layout::BottomRight, AREA, 0), Rect { x: 960, y: 540, w: 960, h: 540 });
    }

    #[test]
    fn thirds_sum_to_full_width() {
        let a = compute(Layout::FirstThird, AREA, 0);
        let b = compute(Layout::CenterThird, AREA, 0);
        let c = compute(Layout::LastThird, AREA, 0);
        assert_eq!(a.w + b.w + c.w, 1920);
        assert_eq!(a.x, 0);
        assert_eq!(c.x + c.w, 1920);
    }

    #[test]
    fn maximize_ignores_gap() {
        assert_eq!(compute(Layout::Maximize, AREA, 20), Rect { x: 0, y: 0, w: 1920, h: 1080 });
    }

    #[test]
    fn gap_insets_each_tile() {
        // Left half with a 10px gap: inset on all sides.
        assert_eq!(compute(Layout::LeftHalf, AREA, 10), Rect { x: 10, y: 10, w: 940, h: 1060 });
    }

    #[test]
    fn respects_work_area_offset() {
        // Work area starting below a top bar.
        let area = Rect { x: 0, y: 40, w: 1920, h: 1040 };
        let r = compute(Layout::TopHalf, area, 0);
        assert_eq!(r, Rect { x: 0, y: 40, w: 1920, h: 520 });
    }

    #[test]
    fn parses_layout_names() {
        assert_eq!("left-half".parse::<Layout>(), Ok(Layout::LeftHalf));
        assert_eq!("first-two-thirds".parse::<Layout>(), Ok(Layout::FirstTwoThirds));
        assert!("nonsense".parse::<Layout>().is_err());
    }
}
