//! orbit-extensions — the pure, host-side core of Orbit's extension runtime.
//!
//! This crate owns the *decisions*, not the OS plumbing: manifest parsing &
//! validation ([`manifest`]), the versioned RPC wire format ([`protocol`]), the
//! permission broker's allow/deny logic ([`permission`]), crash-loop protection
//! ([`crash`]) and on-disk discovery ([`discovery`]). The desktop crate spawns
//! the child process and moves bytes; everything that decides what is *allowed*
//! lives here and is unit-tested.

pub mod crash;
pub mod discovery;
pub mod manifest;
pub mod permission;
pub mod protocol;

pub use crash::CrashTracker;
pub use discovery::{discover_in, Discovered, DiscoveryError};
pub use manifest::{CommandDef, Manifest};
pub use permission::{allowed_effects, effect_allowed, effect_required_permission};
pub use protocol::{
    parse_response, Effect, InvokeRequest, InvokeResponse, ResponseItem, PROTOCOL_VERSION,
};
