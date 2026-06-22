# Orbit v1 Acceptance Contract

The authoritative binary definitions are in
[`planning/v1-criteria.json`](../planning/v1-criteria.json). Mutable status and
evidence live separately in
[`planning/v1-evidence.json`](../planning/v1-evidence.json). The validator
derives completion; there is no editable `allCriteriaPass` flag.

`pass` requires the evidence policy named by the criterion. A blocked criterion
is not a pass. Installed-app evidence identifies the commit, package SHA-256,
Windows environment, verifier and verification time.

Evidence policies:

- `automated` requires a real CI/test report file, report SHA-256 and exact
  40-character Git commit.
- `packaged` requires a real live-verification report plus an existing package
  whose SHA-256 and embedded commit match the evidence.
- `automated_and_packaged` requires both evidence types for the same commit.
- `packaged_external` has the packaged requirements and may be
  `blocked_external` only for the locked credential/certificate choices.

Reports are schema-validated JSON under `evidence/reports`; packages are real
`.msi`/`.exe` files under `evidence/artifacts` with validated magic, build
manifest and SHA-256. Reviewer attestations use Ed25519 keys in the locked
authority registry (or quorum-signed later enrollment), and reviewers cannot
equal the implementer. Every slice binds owned criteria to its final commit.
Later slice verification is stored separately from historical owner acceptance.
Every non-governance/non-audit criterion is then rerun in the final-release
ledger against the release anchor after audit-1 remediation.

## Governance

- **V1-GOV-001** - The versioned completion contract passes its adversarial validator.
- **V1-GOV-002** - Contract changes are hash-locked, justified and independently reviewed.
- **V1-GOV-003** - Blockers are evidenced, current and never counted as passing.
- **V1-GOV-004** - Every vertical slice follows implement, test, independent review, fix, package, live verification, documentation and commit.
- **V1-GOV-005** - Audit pass 2 follows a completed remediation/rebuild iteration and a newer package.

## Core and natural-language control

- **V1-CORE-001** - Clean-install launch and `Alt+Space` open the same installed executable.
- **V1-CORE-002** - The required local launcher journeys work with AI and network disabled.
- **V1-CORE-003** - Native failures remain visible and are not recorded as success.
- **V1-NL-001** - `Open Visual Studio Code` launches the indexed app.
- **V1-NL-002** - `Open Orbit in Visual Studio Code` opens the canonical repository.
- **V1-NL-003** - `Find the document that mentioned Leonard` returns only indexed matches.
- **V1-NL-004** - `Show failed agent sessions` opens a truly filtered session list.
- **V1-NL-005** - Unknown and ambiguous requests are represented honestly.

## Projects and Relay

- **V1-PROJ-001** - Relay scan persists canonical projects without inventing recent use.
- **V1-PROJ-002** - Project details show repository, context, session, brief and handoff facts.
- **V1-PROJ-003** - Continue Project gathers context, recommends an available agent and previews a confirmable plan.
- **V1-PROJ-004** - Confirmed continuation delivers the objective and selected context to Relay.
- **V1-PROJ-005** - Orbit opens and supervises the exact newly launched Relay session.
- **V1-PROJ-006** - Native ownership and stop rules cannot be bypassed by untrusted input.

## AI, context and privacy

- **V1-AI-001** - Ollama streams real output and native cancellation stops work.
- **V1-AI-002** - One named remote/BYOK provider passes real-account verification.
- **V1-AI-003** - Provider capabilities are enforced and text-only models cannot claim tool execution.
- **V1-AI-004** - Selected-text Quick AI previews transmission and requires confirmation before Paste/Replace.
- **V1-CTX-001** - Every outbound context item shows source, preview, size, sensitivity, destination and removal.
- **V1-CTX-002** - Sensitive clipboard, selection, repository and credential content is never silently uploaded.
- **V1-CTX-003** - Local-only mode emits no remote provider or cloud MCP traffic.
- **V1-CTX-004** - Cross-application Paste/Replace always requires explicit confirmation.
- **V1-CTX-005** - Every egress path uses one deny-by-default retention/deletion policy.
- **V1-CTX-006** - Adversarial secrets are absent from renderer state, logs, diagnostics, reports and exports.

## Chat, missions, tools and approvals

- **V1-CHAT-001** - Required chat operations survive restart.
- **V1-CHAT-002** - Tool-call cards persist complete bounded audit data.
- **V1-CHAT-003** - One native and one MCP Chat tool journey execute exactly as approved and persist.
- **V1-MISSION-001** - Mission lifecycle and verification data survives restart.
- **V1-MISSION-002** - Objective-bearing work never launches an untasked agent.
- **V1-MISSION-003** - A bounded local mission completes, verifies and recovers end to end.
- **V1-TOOLS-001** - All capabilities use stable IDs and one schema/risk/health vocabulary.
- **V1-TOOLS-002** - Invalid arguments, identities, commands and unbounded output fail safely.
- **V1-TOOLS-003** - Stdio MCP cannot launch arbitrary programs, scripts, argv or working directories.
- **V1-TOOLS-004** - MCP and provider secrets remain only in OS secure storage.
- **V1-TOOLS-005** - HTTP MCP resists redirect, SSRF and DNS-rebinding attacks.
- **V1-TOOLS-006** - Tool work has byte, time, step and cost limits with native cancellation.
- **V1-APPROVAL-001** - Live approval requests appear in one actionable queue.
- **V1-APPROVAL-002** - Once, mission, project, deny and cancel scopes are enforced safely.
- **V1-APPROVAL-003** - Native approval binding rejects any mutation, expiry or overuse.

## Extensions, indexing and quality

- **V1-EXT-001** - Production extensions are OS-sandboxed or third-party/developer execution is disabled.
- **V1-EXT-002** - Extension integrity and deny-by-default permissions resist path escapes.
- **V1-EXT-003** - Extension lifecycle is audited and uninstall removes executable remnants and secrets.
- **V1-QUAL-001** - Keyboard and screen-reader acceptance passes in the packaged app.
- **V1-QUAL-002** - Crash/restart recovery preserves durable state without an infinite retry loop.
- **V1-QUAL-003** - Measured cold-start and local-search latency remain within the declared budgets.
- **V1-QUAL-004** - File create, change, rename and delete appear through incremental indexing.

## Release, documentation and audits

- **V1-REL-001** - CI runs the mandatory contract, JS, Rust and Windows build gates.
- **V1-REL-002** - Every mandatory gate passes for the release commit.
- **V1-REL-003** - Install, upgrade, restart and uninstall lifecycle passes on clean Windows.
- **V1-REL-004** - Diagnostics expose exact build and degraded-dependency identity.
- **V1-REL-005** - Signing and verified-update configuration fail closed when credentials are absent.
- **V1-REL-006** - Production artifacts are signed/timestamped and updates reject tamper, replay and downgrade.
- **V1-REL-007** - Artifacts have immutable commit, SHA-256, SBOM and scan evidence.
- **V1-DOC-001** - User, feature and security documentation matches the package.
- **V1-AUDIT-001** - Independent full audit pass 1 has zero critical/high findings.
- **V1-AUDIT-002** - Independent full audit pass 2 has zero critical/high findings on the newer package.
