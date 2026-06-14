//! Pure keyword trigger-matching for system-wide snippet expansion.
//!
//! The matcher keeps a small rolling buffer of the most recently typed
//! characters. After each character it asks: does the buffer now *end* with a
//! registered keyword, and is that occurrence a real trigger (not the tail of a
//! longer word)? If so it reports the snippet to expand and how many characters
//! to delete (the keyword length).
//!
//! Boundary rules (chosen to match user expectations and avoid accidental
//! expansion mid-word):
//!   - A keyword whose first character is a "word" character (alphanumeric or
//!     `_`) only triggers when the character *before* it is a boundary
//!     (whitespace/punctuation) or the start of input — so `mailaddr` does not
//!     fire the `addr` keyword.
//!   - A keyword whose first character is punctuation (e.g. `;sig`, `:date`)
//!     triggers anywhere, since the punctuation prefix is itself the boundary —
//!     this is the common "prefix snippet" style.
//!
//! Matching is case-sensitive and longest-keyword-wins, both for determinism.

use std::collections::HashMap;

/// A completed keyword match: expand `snippet_id`, after deleting `backspaces`
/// characters (the keyword itself) from the active application.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expansion {
    pub snippet_id: String,
    pub keyword: String,
    /// Number of characters to delete before injecting the expansion.
    pub backspaces: usize,
}

/// Stateful matcher fed one keystroke at a time. Cheap to clone/reset.
#[derive(Debug, Default)]
pub struct TriggerMatcher {
    buffer: String,
    keywords: HashMap<String, String>,
    max_len: usize,
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

impl TriggerMatcher {
    /// Build a matcher from `(keyword, snippet_id)` pairs. Empty keywords are
    /// ignored so a snippet with no keyword never auto-expands.
    pub fn new<I, K, V>(pairs: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        let mut m = TriggerMatcher::default();
        m.set_keywords(pairs);
        m
    }

    /// Replace the keyword set (e.g. after the user edits their snippets).
    pub fn set_keywords<I, K, V>(&mut self, pairs: I)
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        self.keywords.clear();
        self.max_len = 0;
        for (k, v) in pairs {
            let k = k.into();
            if k.is_empty() {
                continue;
            }
            self.max_len = self.max_len.max(k.chars().count());
            self.keywords.insert(k, v.into());
        }
        self.reset();
    }

    /// Forget the typed buffer (call on focus change, Enter into a new field,
    /// navigation keys, etc. — anywhere continuity is broken).
    pub fn reset(&mut self) {
        self.buffer.clear();
    }

    /// Whether any keyword is registered (lets callers skip work when idle).
    pub fn is_active(&self) -> bool {
        !self.keywords.is_empty()
    }

    /// Handle a Backspace: drop the last buffered character.
    pub fn on_backspace(&mut self) {
        self.buffer.pop();
    }

    /// Feed one typed character. Returns `Some(Expansion)` when a keyword has
    /// just been completed; the buffer is cleared on a match so the expansion
    /// can't immediately re-trigger.
    pub fn on_char(&mut self, c: char) -> Option<Expansion> {
        if self.max_len == 0 {
            return None;
        }
        self.buffer.push(c);
        // Keep only as many trailing chars as the longest keyword needs (+1 so a
        // preceding boundary character is still visible for the word-edge test).
        let cap = self.max_len + 1;
        let count = self.buffer.chars().count();
        if count > cap {
            self.buffer = self.buffer.chars().skip(count - cap).collect();
        }

        let chars: Vec<char> = self.buffer.chars().collect();
        // Longest keyword first → deterministic when one is a suffix of another.
        let mut candidates: Vec<(&String, &String)> = self.keywords.iter().collect();
        candidates.sort_by(|a, b| b.0.chars().count().cmp(&a.0.chars().count()));

        for (keyword, id) in candidates {
            let klen = keyword.chars().count();
            if klen > chars.len() {
                continue;
            }
            let tail_start = chars.len() - klen;
            let tail: String = chars[tail_start..].iter().collect();
            if &tail != keyword {
                continue;
            }
            let first = keyword.chars().next().unwrap();
            let boundary_ok = if !is_word_char(first) {
                // Punctuation-prefixed keyword: always a valid trigger.
                true
            } else if tail_start == 0 {
                // Keyword at the very start of the buffer — treat as a boundary.
                true
            } else {
                !is_word_char(chars[tail_start - 1])
            };
            if boundary_ok {
                let expansion = Expansion {
                    snippet_id: id.clone(),
                    keyword: keyword.clone(),
                    backspaces: klen,
                };
                self.reset();
                return Some(expansion);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(m: &mut TriggerMatcher, s: &str) -> Option<Expansion> {
        let mut last = None;
        for c in s.chars() {
            last = m.on_char(c);
        }
        last
    }

    #[test]
    fn expands_word_keyword_at_start() {
        let mut m = TriggerMatcher::new([("addr", "snip-1")]);
        let exp = feed(&mut m, "addr").unwrap();
        assert_eq!(exp.snippet_id, "snip-1");
        assert_eq!(exp.keyword, "addr");
        assert_eq!(exp.backspaces, 4);
    }

    #[test]
    fn expands_after_boundary() {
        let mut m = TriggerMatcher::new([("addr", "snip-1")]);
        assert!(feed(&mut m, "hello ").is_none());
        let exp = feed(&mut m, "addr").unwrap();
        assert_eq!(exp.backspaces, 4);
    }

    #[test]
    fn does_not_expand_mid_word() {
        let mut m = TriggerMatcher::new([("addr", "snip-1")]);
        // "mailaddr" — the keyword is the tail of a longer word, so no trigger.
        assert!(feed(&mut m, "mailaddr").is_none());
    }

    #[test]
    fn punctuation_prefixed_keyword_triggers_anywhere() {
        let mut m = TriggerMatcher::new([(";sig", "snip-2")]);
        let exp = feed(&mut m, "regards;sig").unwrap();
        assert_eq!(exp.snippet_id, "snip-2");
        assert_eq!(exp.backspaces, 4);
    }

    #[test]
    fn backspace_unwinds_buffer() {
        let mut m = TriggerMatcher::new([("addr", "snip-1")]);
        assert!(feed(&mut m, "add").is_none());
        m.on_backspace(); // buffer: "ad"
        assert!(m.on_char('d').is_none()); // "add"
        let exp = m.on_char('r').unwrap(); // "addr"
        assert_eq!(exp.backspaces, 4);
    }

    #[test]
    fn longest_keyword_wins() {
        let mut m = TriggerMatcher::new([("sig", "short"), (";sig", "long")]);
        // Typing ";sig": both "sig" and ";sig" end here; the longer one wins.
        let exp = feed(&mut m, " ;sig").unwrap();
        assert_eq!(exp.snippet_id, "long");
        assert_eq!(exp.backspaces, 4);
    }

    #[test]
    fn resets_after_match() {
        let mut m = TriggerMatcher::new([("hi", "snip")]);
        assert!(feed(&mut m, "hi").is_some());
        // Buffer cleared; "hi" must be retyped from a boundary to fire again.
        assert!(m.on_char('x').is_none());
    }

    #[test]
    fn no_keywords_never_triggers() {
        let mut m = TriggerMatcher::new(Vec::<(String, String)>::new());
        assert!(!m.is_active());
        assert!(feed(&mut m, "anything at all").is_none());
    }

    #[test]
    fn empty_keyword_is_ignored() {
        let mut m = TriggerMatcher::new([("", "ghost"), ("ok", "real")]);
        assert!(m.is_active());
        let exp = feed(&mut m, "ok").unwrap();
        assert_eq!(exp.snippet_id, "real");
    }

    #[test]
    fn unicode_keyword_counts_chars_not_bytes() {
        let mut m = TriggerMatcher::new([(":café", "snip-u")]);
        let exp = feed(&mut m, "say :café").unwrap();
        // 4 visible chars after the boundary-prefix colon: c a f é → 5 incl ':'.
        assert_eq!(exp.backspaces, 5);
    }
}
