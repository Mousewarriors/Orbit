//! The permission broker's decision logic (pure). The host calls this before
//! performing any [`Effect`] an extension requests; an effect whose required
//! permission isn't declared in the manifest is dropped, never executed.

use crate::protocol::Effect;

/// The permission an effect requires to run.
pub fn effect_required_permission(effect: &Effect) -> &'static str {
    match effect {
        Effect::OpenUrl { .. } => "network",
        Effect::Copy { .. } => "clipboard.write",
        Effect::OpenPath { .. } => "files.read",
    }
}

/// Whether `effect` is allowed given the extension's declared `permissions`.
pub fn effect_allowed(effect: &Effect, permissions: &[String]) -> bool {
    let required = effect_required_permission(effect);
    permissions.iter().any(|p| p == required)
}

/// Filter a list of effects down to the allowed ones.
pub fn allowed_effects(effects: Vec<Effect>, permissions: &[String]) -> Vec<Effect> {
    effects
        .into_iter()
        .filter(|e| effect_allowed(e, permissions))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_effects_to_permissions() {
        assert_eq!(
            effect_required_permission(&Effect::OpenUrl { url: "x".into() }),
            "network"
        );
        assert_eq!(
            effect_required_permission(&Effect::Copy { text: "x".into() }),
            "clipboard.write"
        );
        assert_eq!(
            effect_required_permission(&Effect::OpenPath { path: "x".into() }),
            "files.read"
        );
    }

    #[test]
    fn allows_only_declared() {
        let perms = vec!["clipboard.write".to_string()];
        assert!(effect_allowed(&Effect::Copy { text: "x".into() }, &perms));
        assert!(!effect_allowed(&Effect::OpenUrl { url: "x".into() }, &perms));
    }

    #[test]
    fn filters_disallowed_effects() {
        let perms = vec!["clipboard.write".to_string()];
        let effects = vec![
            Effect::Copy { text: "ok".into() },
            Effect::OpenUrl { url: "https://evil".into() },
            Effect::OpenPath { path: "/etc".into() },
        ];
        let kept = allowed_effects(effects, &perms);
        assert_eq!(kept, vec![Effect::Copy { text: "ok".into() }]);
    }
}
