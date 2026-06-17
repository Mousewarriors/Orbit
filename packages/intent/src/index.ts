/**
 * @orbit/intent — deterministic natural-language understanding for Root Search.
 *
 * Pipeline (deterministic-first; AI is a later, separate fallback):
 *   recogniseIntent()  → which intent + slots, or null (fall through)
 *   rankProjects/rankApps() → resolve the referenced entity
 *   proposeIntent()    → a safe action plan + display the provider dispatches
 */
export * from './types.js';
export * from './recognise.js';
export * from './resolve.js';
export * from './proposal.js';
