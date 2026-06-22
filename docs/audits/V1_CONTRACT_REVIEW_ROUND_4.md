# V1 Completion Contract - Independent Review Round 4

Date: 2026-06-22
Reviewed commit: `56d7b533816f4817309f4880b3ae6e7bb8de2df9`
Outcome: changes requested

## Carver - architecture

- Historical slice evidence and final release freshness were contradictory.
- The release anchor was not bound to remediation phases or audit pass 2.
- Review finding counts could contradict open findings.
- Package checks were shallow and signed evidence omitted environment/manifest.
- CI provenance and reviewer key distinctness needed stronger constraints.

## Kuhn - security

- Fake PE/MSI headers and mutable sidecars could satisfy package validation.
- Security check labels lacked validated telemetry.
- Audit pass 2 was forced onto a different package.
- Passing reviews could contain open high/critical findings.
- Implementer identity was self-declared; blocker signatures and CI workflow
  constraints were incomplete.

## Ampere - product

- Completion was logically impossible under one mutable evidence commit.
- Audit pass 2 did not inspect the declared release package.
- Worktree hashing failed on normal Windows CRLF checkouts.
- Anthropic credentials transitively blocked unrelated release work.
