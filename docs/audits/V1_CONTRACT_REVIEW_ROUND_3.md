# V1 Completion Contract - Independent Review Round 3

Date: 2026-06-22
Reviewed commit: `ad781fa2abb10a1dff45c1498ef56efc8fb82b18`
Outcome: changes requested

## Carver - architecture

- Evidence could use unrelated files and invented reviewers.
- Completion lacked one final release commit/package anchor.
- Started slices did not require completed dependencies.
- Audits were not bound to their reviewed package/commit.
- Future timestamps and disconnected graph branches were accepted.

## Kuhn - security

- Evidence/report contents and Windows artifact types were not authenticated.
- Reviewer UUIDs were not cryptographic identities.
- Artifact provenance, path containment and security-specific checks were
  insufficient.
- Blockers could be future-dated and CI actions used mutable tags.

## Ampere - product

- Mission execution preceded the Approval Centre.
- Certificate-dependent signing shared a slice with unrelated release work.
- Global release evidence did not refresh every relevant criterion.

## Required response

Use signed machine-readable evidence, locked reviewer public keys, canonical
paths, real package validation, exact commit/package freshness, strict graph
chronology, and isolated external slices.
