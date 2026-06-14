//! orbit-input — native text injection (SendInput) and the pure keyword
//! trigger-matcher that powers system-wide snippet expansion.
//!
//! Two clearly separated halves:
//!   - [`trigger`] is platform-free, deterministic and unit-tested. It owns the
//!     decision of *when* a typed keyword should expand and *how many characters*
//!     to delete. The OS keyboard hook feeds it characters; it never touches the
//!     OS itself.
//!   - [`platform`] performs the actual effect (synthesise Backspace + Unicode
//!     keystrokes). On non-Windows targets it returns a graceful error.

pub mod lifecycle;
pub mod platform;
pub mod trigger;

pub use lifecycle::{Lifecycle, Transition};
pub use trigger::{Expansion, TriggerMatcher};

/// Marker stamped into `dwExtraInfo` of every event Orbit synthesises, so the
/// low-level keyboard hook can recognise and ignore its own injected input and
/// avoid an expansion feedback loop. ("ORBI" in ASCII.)
pub const ORBIT_INJECT_SIGNATURE: usize = 0x4F52_4249;
