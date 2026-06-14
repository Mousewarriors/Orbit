//! Native fuzzy matching for Orbit's Root Search.
//!
//! This mirrors the scoring philosophy of the TypeScript `@orbit/search-engine`
//! matcher so that whichever side runs (the renderer for small sets, the Rust
//! core for tens of thousands of files/apps) produces consistent ordering.
//!
//! The hot path runs per keystroke over large candidate sets, so it avoids
//! allocation where possible and uses byte/char scans rather than regex.

/// The kind of match found, in descending strength.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchKind {
    Exact,
    Prefix,
    Acronym,
    Substring,
    Subsequence,
    Typo,
    None,
}

/// A scored match against a target string.
#[derive(Debug, Clone)]
pub struct MatchResult {
    pub score: f64,
    pub kind: MatchKind,
    pub indices: Vec<usize>,
}

impl MatchResult {
    fn none() -> Self {
        MatchResult { score: 0.0, kind: MatchKind::None, indices: Vec::new() }
    }
}

/// Lowercase and strip common diacritics. Returns a `Vec<char>` so callers can
/// index by character position for highlight ranges.
pub fn normalize(input: &str) -> Vec<char> {
    input
        .chars()
        .filter_map(|c| {
            let lower = c.to_ascii_lowercase();
            match strip_diacritic(lower) {
                Some(stripped) => Some(stripped),
                None => Some(lower),
            }
        })
        .collect()
}

fn strip_diacritic(c: char) -> Option<char> {
    match c {
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => Some('a'),
        'é' | 'è' | 'ê' | 'ë' => Some('e'),
        'í' | 'ì' | 'î' | 'ï' => Some('i'),
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' => Some('o'),
        'ú' | 'ù' | 'û' | 'ü' => Some('u'),
        'ç' => Some('c'),
        'ñ' => Some('n'),
        _ => None,
    }
}

fn is_boundary(c: char) -> bool {
    matches!(c, ' ' | '-' | '_' | '.' | '/' | ':')
}

fn word_starts(target: &[char]) -> Vec<usize> {
    let mut starts = Vec::new();
    for i in 0..target.len() {
        let c = target[i];
        if i == 0 && !is_boundary(c) {
            starts.push(i);
        } else if i > 0 && is_boundary(target[i - 1]) && !is_boundary(c) {
            starts.push(i);
        }
    }
    starts
}

/// Levenshtein distance with an early-exit ceiling.
pub fn bounded_edit_distance(a: &[char], b: &[char], max: usize) -> usize {
    let (alen, blen) = (a.len(), b.len());
    if alen.abs_diff(blen) > max {
        return max + 1;
    }
    let mut prev: Vec<usize> = (0..=blen).collect();
    let mut curr: Vec<usize> = vec![0; blen + 1];
    for i in 1..=alen {
        curr[0] = i;
        let mut row_min = curr[0];
        for j in 1..=blen {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            let v = (prev[j] + 1).min(curr[j - 1] + 1).min(prev[j - 1] + cost);
            curr[j] = v;
            row_min = row_min.min(v);
        }
        if row_min > max {
            return max + 1;
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[blen]
}

fn acronym_match(query: &[char], target: &[char]) -> MatchResult {
    let starts = word_starts(target);
    if query.len() > starts.len() {
        return MatchResult::none();
    }
    let mut indices = Vec::new();
    let mut qi = 0;
    for &s in &starts {
        if qi >= query.len() {
            break;
        }
        if target[s] == query[qi] {
            indices.push(s);
            qi += 1;
        }
    }
    if qi != query.len() {
        return MatchResult::none();
    }
    let coverage = query.len() as f64 / starts.len() as f64;
    MatchResult { score: 0.82 + 0.1 * coverage, kind: MatchKind::Acronym, indices }
}

fn subsequence_match(query: &[char], target: &[char]) -> MatchResult {
    let mut indices = Vec::new();
    let mut ti = 0;
    let mut contiguous = 0usize;
    let mut max_contiguous = 0usize;
    let mut boundary_hits = 0usize;
    let mut last_idx: isize = -2;
    for &qc in query {
        let mut found: isize = -1;
        while ti < target.len() {
            if target[ti] == qc {
                found = ti as isize;
                break;
            }
            ti += 1;
        }
        if found == -1 {
            return MatchResult::none();
        }
        let f = found as usize;
        indices.push(f);
        if found == last_idx + 1 {
            contiguous += 1;
        } else {
            contiguous = 1;
        }
        max_contiguous = max_contiguous.max(contiguous);
        if f == 0 || is_boundary(target[f - 1]) {
            boundary_hits += 1;
        }
        last_idx = found;
        ti = f + 1;
    }
    let coverage = query.len() as f64 / target.len() as f64;
    let contiguity_ratio = max_contiguous as f64 / query.len() as f64;
    let boundary_ratio = boundary_hits as f64 / query.len() as f64;
    let score = 0.4 + 0.25 * contiguity_ratio + 0.2 * boundary_ratio + 0.15 * coverage;
    MatchResult { score: score.min(0.79), kind: MatchKind::Subsequence, indices }
}

fn range(start: usize, len: usize) -> Vec<usize> {
    (start..start + len).collect()
}

fn starts_with(target: &[char], query: &[char]) -> bool {
    target.len() >= query.len() && target[..query.len()] == *query
}

fn find_sub(target: &[char], query: &[char]) -> Option<usize> {
    if query.is_empty() || query.len() > target.len() {
        return None;
    }
    for start in 0..=(target.len() - query.len()) {
        if target[start..start + query.len()] == *query {
            return Some(start);
        }
    }
    None
}

/// Score a normalised query against a normalised target.
pub fn match_normalized(query: &[char], target: &[char]) -> MatchResult {
    if query.is_empty() {
        return MatchResult { score: 0.0001, kind: MatchKind::Subsequence, indices: Vec::new() };
    }
    if target.is_empty() {
        return MatchResult::none();
    }
    if query == target {
        return MatchResult { score: 1.0, kind: MatchKind::Exact, indices: range(0, target.len()) };
    }
    if starts_with(target, query) {
        let ratio = query.len() as f64 / target.len() as f64;
        return MatchResult {
            score: 0.9 + 0.08 * ratio,
            kind: MatchKind::Prefix,
            indices: range(0, query.len()),
        };
    }
    if let Some(idx) = find_sub(target, query) {
        let at_boundary = idx == 0 || is_boundary(target[idx - 1]);
        let base = if at_boundary { 0.86 } else { 0.8 };
        let ratio = query.len() as f64 / target.len() as f64;
        return MatchResult {
            score: base + 0.05 * ratio,
            kind: MatchKind::Substring,
            indices: range(idx, query.len()),
        };
    }
    if query.len() >= 2 {
        let acro = acronym_match(query, target);
        if acro.kind != MatchKind::None {
            return acro;
        }
    }
    let sub = subsequence_match(query, target);
    if sub.kind != MatchKind::None {
        return sub;
    }
    let max_dist = if query.len() <= 4 { 1 } else { 2 };
    let dist = bounded_edit_distance(query, target, max_dist);
    if dist <= max_dist {
        let score = 0.5 * (1.0 - dist as f64 / (max_dist as f64 + 1.0));
        return MatchResult { score, kind: MatchKind::Typo, indices: Vec::new() };
    }
    MatchResult::none()
}

/// Convenience wrapper that normalises both operands.
pub fn match_str(query: &str, target: &str) -> MatchResult {
    match_normalized(&normalize(query), &normalize(target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_match_scores_top() {
        let r = match_str("chrome", "chrome");
        assert_eq!(r.kind, MatchKind::Exact);
        assert_eq!(r.score, 1.0);
    }

    #[test]
    fn prefix_beats_substring_beats_subsequence() {
        let p = match_str("chr", "Chrome").score;
        let s = match_str("rom", "Chrome").score;
        let q = match_str("cme", "Chrome").score;
        assert!(p > s, "prefix {p} should beat substring {s}");
        assert!(s > q, "substring {s} should beat subsequence {q}");
    }

    #[test]
    fn acronym_across_boundaries() {
        let r = match_str("vsc", "Visual Studio Code");
        assert_eq!(r.kind, MatchKind::Acronym);
        assert_eq!(r.indices, vec![0, 7, 14]);
        assert_eq!(match_str("mwl", "move-window-left").kind, MatchKind::Acronym);
    }

    #[test]
    fn typo_tolerance_for_substitution() {
        let r = match_str("chrime", "Chrome");
        assert_eq!(r.kind, MatchKind::Typo);
        assert!(r.score > 0.0);
    }

    #[test]
    fn dropped_char_is_subsequence() {
        assert_eq!(match_str("chrme", "Chrome").kind, MatchKind::Subsequence);
    }

    #[test]
    fn unrelated_is_none() {
        assert_eq!(match_str("xyzzy", "Chrome").kind, MatchKind::None);
    }

    #[test]
    fn diacritics_are_stripped() {
        assert_eq!(match_str("cafe", "Café").kind, MatchKind::Exact);
    }

    #[test]
    fn best_of_app_list() {
        let apps = ["Google Chrome", "Visual Studio Code", "Calculator", "Discord"];
        let best = |q: &str| -> &str {
            apps.iter()
                .map(|a| (a, match_str(q, a).score))
                .max_by(|x, y| x.1.partial_cmp(&y.1).unwrap())
                .unwrap()
                .0
        };
        assert_eq!(best("chr"), "Google Chrome");
        assert_eq!(best("vsc"), "Visual Studio Code");
        assert_eq!(best("calc"), "Calculator");
        assert_eq!(best("disc"), "Discord");
    }
}
