# Orbit v1 Contract Change Log

## 2026-06-22 - Establish local-first v1 boundary

Rationale:

- Separate immutable criterion definitions from mutable execution evidence.
- Move AgentOS Gateway, Hermes and Model Intelligence Gateway integration to
  v1.1 because their external contracts are unavailable and they are not needed
  for a coherent local-first Orbit release.
- Add binary Quick AI, secure credential, extension confinement, privacy,
  accessibility, recovery, performance, incremental-index, signing and
  artifact-provenance criteria.
- Put CI and security foundations before feature consumers.
- Insert an explicit remediation/rebuild iteration between the two final audits.

Independent first-round reviewers:

- Singer - architecture
- Bohr - security
- Turing - product

All three requested changes. Their findings are recorded in
`docs/audits/V1_CONTRACT_REVIEW_ROUND_1.md`. A second independent review is
required before the contract lock becomes active and V1-000 can complete.

## 2026-06-22 - Harden evidence and resolve review round 2

Rationale:

- Split immutable backlog definitions from mutable progress.
- Require existing full Git commits, real report/artifact paths and matching
  SHA-256 values for passing evidence.
- Bind contract activation to a reviewed Git commit and hash-lock the validator,
  mutation tests, backlog, criteria, scope, acceptance, package scripts and CI.
- Require authenticated independent reviewer identities, report hashes, ordered
  phase timestamps and four distinct roles for each final audit.
- Move capability contracts before executable natural-language actions.
- Add end-to-end Mission and Chat criteria and strengthen Quick AI, local-only,
  approval provenance, extension lifecycle and trusted-signing criteria.
- Isolate Anthropic real-account verification into a late slice so a missing
  credential cannot freeze local implementation.

Review-round-2 changes requested by Dewey (architecture), Tesla (security) and
Boyle (product) are captured in
`docs/audits/V1_CONTRACT_REVIEW_ROUND_2.md`. A fresh exact-commit review is
required after these corrections.
