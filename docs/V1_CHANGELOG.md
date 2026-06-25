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

## 2026-06-22 - Cryptographic evidence and review round 3 response

- Added Ed25519 reviewer authorities and quorum-signed future enrollment.
- Replaced identity-shaped review trust with signature verification.
- Restricted evidence paths to canonical repository roots and rejected
  symlink/junction escapes.
- Required schema-validated machine reports, real Windows package magic/build
  manifests and GitHub OIDC artifact attestation for automated evidence.
- Enforced future-time rejection, strict phase ordering, dependency completion,
  Git ancestry and root reachability.
- Bound owned criteria and reviews to each slice's final commit and all release
  criteria to the post-audit final release anchor.
- Split approved mission execution after Approval Centre and isolated
  certificate-dependent signing into its own late slice.
- Pinned every GitHub Action to an immutable commit.

The exact-commit findings from Carver, Kuhn and Ampere are recorded in
`docs/audits/V1_CONTRACT_REVIEW_ROUND_3.md`.

## 2026-06-22 - Reachability and package-binding review round 4 response

- Split historical owner acceptance, later slice verification and final release
  reruns into distinct evidence records.
- Bound audit pass 2 to the V1-015 release-anchor package.
- Canonicalized lock hashes across LF/CRLF checkouts and added `.gitattributes`.
- Added a distinct Ed25519 implementer key and per-commit attestations.
- Derived review severity counts from structured unresolved findings.
- Rejected duplicate reviewer public keys under alias identities.
- Strengthened PE/MSI structure checks, required commit/version bytes inside the
  package, and signed the sidecar manifest digest and environment.
- Added strict telemetry details for privacy, MCP, approval, extension and
  signing checks.
- Signed the complete blocker object and constrained GitHub provenance to the
  exact CI workflow and commit.
- Removed Anthropic from the release-work dependency chain; it joins only at the
  final audit.

The exact-commit findings from Carver, Kuhn and Ampere are recorded in
`docs/audits/V1_CONTRACT_REVIEW_ROUND_4.md`.

## 2026-06-22 - Reviewer authority rotation

The prior round's private-key holders expired when the delegated model-usage
window ended. Their public keys were replaced before activation with a fresh
architecture, security and product panel. No prior failed review was converted
into a pass, and the replacement panel must review and sign the new exact
commit.

## 2026-06-22 - Review round 5 trust-edge response

- Canonicalized Ed25519 SPKI before fingerprinting to prevent trailing-byte key
  aliases.
- Required criterion evidence signatures from roles appropriate to each
  acceptance area.
- Required the final V1-000 commit to descend from the independently reviewed
  contract commit.
- Made all critical/high findings across every audit review blocking until the
  original reviewer signs a descendant-commit closure with evidence.
- Required criterion evidence to follow the claimed Git commit and verification
  to follow its evidence.
- Required all final-release reruns to precede audit pass 2 and its reviews.
- Strengthened PE/MSI structural parsing and required source-commit-bound GitHub
  OIDC provenance for reports and packages.
- Added locked CI artifact attestation generation and exact signer workflow,
  source digest and GitHub-hosted-runner verification.
- Required structured security telemetry plus hashed raw evidence.

The findings are recorded in
`docs/audits/V1_CONTRACT_REVIEW_ROUND_5.md`.

## 2026-06-22 - Review round 6 package and closure response

- Bound every audit finding closure to the audit criterion's exact remediation
  commit and package SHA-256.
- Made any critical/high finding in audit pass 2 reset the clean-audit attempt.
- Required the evidence source commit's CI workflow blob to match the locked
  workflow and added signer-digest verification.
- Raised PE/MSI structural and substantive-content requirements while retaining
  exact-source GitHub OIDC package provenance.
- Required non-empty, schema-validated and OIDC-attested raw security telemetry.
- Ordered evidence, reviews, phases and closures after their claimed commits and
  required phase commit ancestry.

The findings are recorded in
`docs/audits/V1_CONTRACT_REVIEW_ROUND_6.md`.

## 2026-06-25 - Reviewer authority rotation before activation

The previous reviewer panel expired before it could audit the exact activation
commit. Its public keys were replaced with a fresh architecture, security and
product panel before V1-000 completion. No stale review result is accepted as
activation evidence; the replacement panel must review and sign the exact
commit that activates the contract.

## 2026-06-25 - Review round 7 raw telemetry response

- Fixed the validator repository model so claimed evidence files expose byte
  sizes to required raw security telemetry checks.
- Added a regression test proving required security telemetry validation reports
  structured errors instead of crashing when raw evidence is missing or
  unattested.
- Made bootstrap-state adversarial tests independent of whether V1-000 is still
  pending or has already been activated.

The architecture reviewer finding was `ARCH-V1-000-001`.

## 2026-06-25 - V1-001 CI evidence writer

- Added a deterministic V1 CI evidence report writer for `V1-REL-001`.
- Wired the report into the push CI job before the existing GitHub OIDC
  attestation step, so the mandatory gate report can be verified by digest
  against GitHub artifact attestations.

## 2026-06-25 - Reviewer authority rotation for V1-001 contract update

The prior reviewer panel expired before it could review the CI evidence writer
commit. Its keys were replaced with a fresh architecture, security and product
panel before re-anchoring V1-000 to the updated locked contract surface.
