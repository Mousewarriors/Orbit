//! orbit-core — local persistence and domain primitives shared by the Tauri
//! shell and (potentially) headless tooling. Keeps all SQLite/migration logic
//! out of the UI and out of `src-tauri/main.rs`.

pub mod clipboard;
pub mod db;
pub mod files;
pub mod migrations;
pub mod notes;
pub mod quicklinks;
pub mod snippets;

pub use clipboard::ClipboardEntry;
pub use files::{FileFilters, FileInput, FileRecord};
pub use notes::Note;
pub use quicklinks::Quicklink;
pub use snippets::Snippet;

pub use db::{
    get_setting, open, open_in_memory, record_command_usage, set_setting, usage_snapshot, DbError,
};
pub use migrations::{current_version, run as run_migrations, target_version};
