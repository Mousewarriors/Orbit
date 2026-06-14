# Threat Model

Companion to [SECURITY_MODEL.md](SECURITY_MODEL.md). Framed as attacker goals →
vectors → mitigations (implemented = ✅, planned = ⬜).

## A. Run arbitrary code on the user's machine

- **Via deeplink** (`orbit://…` from a web page). Mitigation: strict route
  allowlist, validated ids, no generic exec route ✅.
- **Via malicious extension.** Mitigation: child-process isolation + permission
  broker + signed packages ⬜; manifest hardening ✅.
- **Via calculator/expression input.** Mitigation: no `eval`; recursive-descent
  parser that can only produce numbers ✅.
- **Via shell injection** in user scripts / launch. Mitigation: never interpolate
  into a shell; OS opener with trusted indexed paths; metacharacter rejection ✅.

## B. Read files outside granted scope

- **Path traversal** in extension storage / file APIs. Mitigation: containment
  check + `..` rejection + absolute-path rejection ✅; native broker enforcement ⬜.

## C. Exfiltrate secrets

- **Secrets in logs / renderer.** Mitigation: secret vault in OS secure storage,
  redacted logs, secrets never in renderer state ⬜.
- **Clipboard secrets to AI.** Mitigation: never send clipboard to AI
  automatically; sensitive-content flag + excluded apps ⬜ (schema ✅).

## D. Tamper with updates / supply chain

- **Forged update manifest.** Mitigation: signature verification, DB backup
  before risky migrations ⬜.
- **Forged store package.** Mitigation: integrity check + review pipeline ⬜.

## E. Prompt injection / AI tool misuse

- **Instructions hidden in retrieved content.** Mitigation: treat content as
  data; tool name/arg validation; destructive-action confirmation; step/cost
  budgets; cancellation ⬜.

## F. Cross-tenant / cross-extension access

- **One extension reading another's data.** Mitigation: namespaced per-extension
  storage + broker ⬜.
- **Team data leakage.** Mitigation: tenant isolation in sync API ⬜.

## Test coverage today

`packages/validation/src/validation.test.ts` exercises malicious manifests,
traversal, unsafe deeplinks, shell metacharacters and unsafe URL schemes.
`packages/calculator` proves injection-like input cannot execute. Planned items
above are tracked in [FEATURE_MATRIX.md](../../FEATURE_MATRIX.md).
