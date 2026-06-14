//! Crash-loop protection (pure). Each loaded extension owns a [`CrashTracker`];
//! the host records a failure whenever an invocation crashes, times out, or
//! returns garbage. Once too many failures happen inside a short window the
//! extension is "tripped" and the host stops invoking it until reloaded — so a
//! misbehaving extension can't be spawned in a hot loop.

/// Failures within this window count toward the trip threshold.
const DEFAULT_WINDOW_MS: i64 = 60_000;
/// Number of failures within the window that trips the breaker.
const DEFAULT_THRESHOLD: usize = 3;

#[derive(Debug, Clone)]
pub struct CrashTracker {
    failures: Vec<i64>,
    window_ms: i64,
    threshold: usize,
    tripped: bool,
}

impl Default for CrashTracker {
    fn default() -> Self {
        CrashTracker {
            failures: Vec::new(),
            window_ms: DEFAULT_WINDOW_MS,
            threshold: DEFAULT_THRESHOLD,
            tripped: false,
        }
    }
}

impl CrashTracker {
    pub fn new(window_ms: i64, threshold: usize) -> Self {
        CrashTracker {
            failures: Vec::new(),
            window_ms,
            threshold,
            tripped: false,
        }
    }

    /// Record a failed invocation at `now` (epoch ms). Trips the breaker if the
    /// number of recent failures reaches the threshold.
    pub fn record_failure(&mut self, now: i64) {
        let cutoff = now - self.window_ms;
        self.failures.retain(|&t| t >= cutoff);
        self.failures.push(now);
        if self.failures.len() >= self.threshold {
            self.tripped = true;
        }
    }

    /// Record a successful invocation — clears the recent-failure history (but
    /// not a manual reset of a tripped breaker; use [`reset`] for that).
    pub fn record_success(&mut self) {
        self.failures.clear();
    }

    /// Whether the breaker is tripped (the host should refuse to invoke).
    pub fn is_tripped(&self) -> bool {
        self.tripped
    }

    /// Clear failures and untrip (e.g. on reload / user re-enable).
    pub fn reset(&mut self) {
        self.failures.clear();
        self.tripped = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trips_after_threshold_within_window() {
        let mut t = CrashTracker::new(60_000, 3);
        t.record_failure(1_000);
        t.record_failure(2_000);
        assert!(!t.is_tripped());
        t.record_failure(3_000);
        assert!(t.is_tripped(), "3 failures in window should trip");
    }

    #[test]
    fn old_failures_expire_and_do_not_trip() {
        let mut t = CrashTracker::new(10_000, 3);
        t.record_failure(0);
        t.record_failure(1_000);
        // This one is far outside the window of the first two.
        t.record_failure(100_000);
        assert!(!t.is_tripped(), "expired failures should not count");
    }

    #[test]
    fn success_clears_history() {
        let mut t = CrashTracker::new(60_000, 3);
        t.record_failure(1_000);
        t.record_failure(2_000);
        t.record_success();
        t.record_failure(3_000);
        assert!(!t.is_tripped());
    }

    #[test]
    fn reset_untrips() {
        let mut t = CrashTracker::new(60_000, 2);
        t.record_failure(1);
        t.record_failure(2);
        assert!(t.is_tripped());
        t.reset();
        assert!(!t.is_tripped());
    }
}
