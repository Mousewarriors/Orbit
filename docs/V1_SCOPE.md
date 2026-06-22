# Orbit v1 Scope

Status: active completion contract

Orbit v1 is a Windows-first, keyboard-first command centre for launching local
applications, finding files and projects, using AI safely, continuing work
through Relay, and supervising bounded tool-driven missions.

An item is complete only when its criterion in
[`planning/v1-criteria.json`](../planning/v1-criteria.json) has passing evidence
for the tested commit and, where required, the packaged Windows build.

## Required v1 outcomes

### Launcher and local control

- `Alt+Space` opens the installed app.
- Root Search remains useful with AI and networking disabled.
- Applications, calculations, Notes, Quicklinks, snippets, indexed files and
  projects use typed native capabilities and report native failures honestly.
- Deterministic natural-language requests use registered, schema-validated
  tools. Ambiguous or unsupported requests never become invented success.

### Projects and Relay

- Relay discovery preserves canonical project identity and honest recent-use
  metadata.
- Project details expose repository state, context, sessions, Build Brief
  metadata and the latest valid handoff.
- Continue Project gathers context, recommends an available agent, previews the
  plan and risks, requires confirmation, launches through Relay, and supervises
  the exact resulting session.

### AI, context and privacy

- Quick AI supports selected-text workflows, visible context and destination,
  streaming, cancellation, Copy, and confirmed Paste/Replace.
- Chat is durable and supports bounded, audited native and MCP tool calls.
- Ollama and Anthropic API are verified honestly. A missing Anthropic credential
  may block only its late real-account verification slice while local work
  continues.
- Provider and MCP credentials use operating-system secure storage.
- One deny-by-default policy controls provider, Relay, MCP, extension,
  diagnostic, crash-report and export egress.
- Local-only mode prevents remote transmission by construction.

### Missions, tools and approvals

- Missions persist their objective, project, plan, steps, tools, approvals,
  outputs, verification and final result across restart.
- All capabilities have stable identities, schemas, risk, health and bounded
  output.
- Approvals are atomically consumed at the native boundary and bind the exact
  tool version, provider/server instance, executable or package hash, endpoint,
  canonical arguments, requester, project, destination, working directory,
  environment, configuration, expiry and use count.
- No renderer, model, MCP server or extension receives unrestricted shell
  access.

### Extension and index safety

- Production builds either sandbox extensions with tested process, filesystem
  and network confinement, or disable every extension-controlled lifecycle
  entry point, including install/update hooks, migrations, activation, native
  helpers and persisted workers.
- Package integrity, permissions, lifecycle audit and safe uninstall are
  enforced natively.
- File indexing updates incrementally without requiring a full rescan.

### Release quality

- CI runs the contract validator, lint, strict typecheck, JS/Rust tests and
  production builds.
- Accessibility, crash recovery and measured startup/search budgets pass.
- MSI and NSIS clean install, upgrade, shortcuts, single instance,
  launch-at-login, restart, uninstall and retention behavior are verified.
- Every production executable and installer validates to the expected trusted
  Orbit Authenticode publisher chain with an RFC3161 timestamp; signing keys are
  protected and auditable, and updates reject wrong/revoked trust roots,
  tampering, replay and downgrade.
- Artifacts are tied to an immutable commit and include SHA-256, SBOM,
  dependency, secret and malware scan evidence.
- Documentation describes the packaged product accurately.
- Two consecutive independent full audits, separated by a completed
  remediation/rebuild iteration, report no critical or high findings.

## Explicitly post-v1 (v1.1 or later)

These directions do not block Orbit v1:

- AgentOS Gateway and Hermes remote orchestration.
- Model Intelligence Gateway route previews.
- Browser companion and webpage capture.
- Voice input and transcription.
- Automation authoring, scheduling and unattended execution.
- Profile and AI-generated memory.
- Vault writing and knowledge synchronization.
- Chat images, citations and rich attachments.
- Advanced local-model download/deletion management.
- Agent Studio and project previews.
- Cloud sync, accounts, teams, billing and shared libraries.
- Public extension marketplace, mobile clients and cross-platform parity.
- One-click deployment of the current branch.

Orbit may retain disabled foundation code for post-v1 features, but the UI and
documentation must label it honestly and it cannot satisfy a v1 criterion.

## Locked external choices and fixtures

- Remote provider: Anthropic API.
- Local provider: Ollama.
- Project execution: the bundled, hash-certified Orbit Relay protocol v1.1
  sidecar plus its deterministic test sidecar.
- Clean-machine baseline: Windows 11 x64 with current WebView2.

## Blockers

`blocked_external` is limited to the selected Anthropic real-account credential
or the trusted Authenticode signing credential/service. It requires hashed
proof, owner, dated attempt history, a last-checked time no more than seven days
old, unblock condition, complete affected-criterion list and degraded behavior.
`blocked_decision` requires a hashed explicit user decision record.

Blocked criteria remain failing and prevent v1 completion. Unaffected slices
continue.

## Change control

The scope and criterion definitions are hash-locked. A change requires:

1. a rationale in `docs/V1_CHANGELOG.md`;
2. updated definitions and dependencies;
3. a new contract lock;
4. independent security/product review tied to the reviewed files;
5. no weakening of security, privacy, signing, evidence or honesty gates merely
   to declare completion.
