/**
 * @orbit/shared-types — the canonical domain vocabulary shared by the renderer,
 * the command engine, the search engine and (mirrored) the Rust core.
 *
 * These types are intentionally free of runtime dependencies so they can be
 * imported everywhere cheaply. Runtime validation lives in @orbit/validation.
 */

export * from './command.js';
export * from './search.js';
export * from './action.js';
export * from './permission.js';
export * from './icon.js';
