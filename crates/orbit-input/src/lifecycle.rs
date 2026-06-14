//! Pure, platform-free lifecycle state machine for the snippet-expansion watcher.
//!
//! The OS keyboard hook and its threads live in `apps/desktop` (they need Win32),
//! but the *decision logic* — is the watcher running? does a `start`/`stop`
//! request actually need to (un)install the hook, or is it a redundant call? — is
//! pure and therefore unit-testable here. The platform code holds one of these
//! behind a mutex and only touches the OS when a transition method returns
//! [`Transition::Changed`].
//!
//! Both `start` and `stop` are idempotent: calling `start` twice installs the
//! hook once; calling `stop` when already stopped does nothing.

/// The result of a requested lifecycle transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transition {
    /// The state changed; the caller must perform the side effect (install or
    /// uninstall the OS hook).
    Changed,
    /// The watcher was already in the requested state; nothing to do.
    NoChange,
}

impl Transition {
    /// True when the caller must perform the corresponding side effect.
    pub fn changed(self) -> bool {
        matches!(self, Transition::Changed)
    }
}

/// Tracks whether the system-wide watcher is currently running.
#[derive(Debug, Default, Clone, Copy)]
pub struct Lifecycle {
    running: bool,
}

impl Lifecycle {
    /// A fresh, stopped lifecycle.
    pub fn new() -> Self {
        Lifecycle { running: false }
    }

    /// Whether the watcher is currently running.
    pub fn is_running(&self) -> bool {
        self.running
    }

    /// Request the watcher start. Returns [`Transition::Changed`] only on the
    /// first start (so the caller installs the hook exactly once).
    pub fn start(&mut self) -> Transition {
        if self.running {
            Transition::NoChange
        } else {
            self.running = true;
            Transition::Changed
        }
    }

    /// Request the watcher stop. Returns [`Transition::Changed`] only when it was
    /// actually running (so the caller uninstalls the hook exactly once).
    pub fn stop(&mut self) -> Transition {
        if self.running {
            self.running = false;
            Transition::Changed
        } else {
            Transition::NoChange
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_stopped() {
        let lc = Lifecycle::new();
        assert!(!lc.is_running());
    }

    #[test]
    fn first_start_changes_then_idempotent() {
        let mut lc = Lifecycle::new();
        assert_eq!(lc.start(), Transition::Changed);
        assert!(lc.is_running());
        // A second start is a no-op — the hook must not be installed twice.
        assert_eq!(lc.start(), Transition::NoChange);
        assert!(lc.is_running());
    }

    #[test]
    fn stop_only_changes_when_running() {
        let mut lc = Lifecycle::new();
        // Stopping an already-stopped watcher does nothing.
        assert_eq!(lc.stop(), Transition::NoChange);
        lc.start();
        assert_eq!(lc.stop(), Transition::Changed);
        assert!(!lc.is_running());
        assert_eq!(lc.stop(), Transition::NoChange);
    }

    #[test]
    fn restart_cycles_cleanly() {
        let mut lc = Lifecycle::new();
        assert!(lc.start().changed());
        assert!(lc.stop().changed());
        assert!(lc.start().changed());
        assert!(lc.is_running());
    }

    #[test]
    fn changed_helper_matches_variant() {
        assert!(Transition::Changed.changed());
        assert!(!Transition::NoChange.changed());
    }
}
