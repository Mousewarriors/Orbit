# Orbit v1 Evidence Schema

The validator in `scripts/v1-contract.mjs` is authoritative. This page explains
the files it accepts.

## Paths

- Reports: `evidence/reports/**/*.json`
- Blocker proofs: `evidence/blockers/**/*.json`
- Windows artifacts: `evidence/artifacts/**/*.msi` or `.exe`
- Artifact manifest: `<artifact>.manifest.json`

Absolute paths, `..`, symlinks, junction escapes and files outside these roots
are rejected.

## Criterion report

```json
{
  "schemaVersion": 1,
  "kind": "automated",
  "status": "pass",
  "subjectIds": ["V1-TOOLS-001"],
  "commit": "<40 hex>",
  "generatedAt": "<UTC ISO-8601>",
  "producer": "ci:github-actions:<run id>",
  "ci": {
    "repository": "Mousewarriors/Orbit",
    "runUrl": "https://github.com/Mousewarriors/Orbit/actions/runs/<run id>",
    "conclusion": "success"
  },
  "checks": [{ "id": "stable-id-enumeration", "status": "pass" }]
}
```

Non-governance automated reports require verifiable GitHub artifact
attestation/OIDC provenance bound to the exact source commit, locked CI
workflow and a GitHub-hosted runner. Security-critical criteria also require
the specific negative-test IDs encoded by the validator. Each negative check
records its target, input SHA-256, observed result and a hashed raw-evidence
file; boolean labels alone are rejected.

The source commit's actual `.github/workflows/ci.yml` blob must match the
contract-locked workflow hash. This prevents a temporary malicious workflow
from generating evidence and then being reverted.

Packaged reports use `"kind": "packaged"` and add:

```json
{
  "artifact": {
    "path": "evidence/artifacts/orbit.msi",
    "sha256": "<64 hex>",
    "commit": "<40 hex>"
  }
}
```

The artifact must have Windows package magic and a sidecar manifest:

```json
{
  "schemaVersion": 1,
  "packageType": "msi",
  "version": "1.0.0",
  "commit": "<40 hex>",
  "sha256": "<64 hex>",
  "environment": "Windows 11 x64; WebView2 <version>"
}
```

The validator parses PE section layout or MSI compound-file structure, requires
the commit/version inside the package, signs the manifest digest and
environment as part of criterion evidence, and verifies GitHub OIDC provenance
for the package against the exact source commit.

## Review report

```json
{
  "schemaVersion": 1,
  "kind": "review",
  "reviewer": "agent:<uuid>",
  "role": "security",
  "result": "pass",
  "reviewedCommit": "<40 hex>",
  "reviewedAt": "<UTC ISO-8601>",
  "critical": 0,
  "high": 0,
  "artifactSha256": null,
  "findings": []
}
```

The matching attestation contains an Ed25519 signature over the canonical
review payload. Public keys and authorized roles live in the hash-locked
authority registry. New reviewers require quorum signatures from existing
authorities.

Passing severity counts are derived from unresolved structured findings. The
implementer uses a separate locked key and signs each completed slice commit, so
reviewer independence is checked by key fingerprint.

For audit slices, every critical/high finding from every review remains blocking
until the original reviewer signs a structured closure tied to a descendant
remediation commit, the exact audited package SHA-256 and passing closure
evidence. A separate clean review cannot hide another review's open finding.
Audit pass 2 is strictly clean: discovering any critical/high finding resets the
release anchor and requires remediation, final reruns and a new pass-2 audit.

## Slice phase report

```json
{
  "schemaVersion": 1,
  "kind": "phase",
  "status": "pass",
  "sliceId": "V1-002",
  "phase": "test",
  "commit": "<40 hex>",
  "generatedAt": "<UTC ISO-8601>",
  "checks": [{ "id": "unit-tests", "status": "pass" }]
}
```

Required phases have strictly increasing timestamps. The final commit must
descend from every dependency commit, and a signed passing review must target
the final slice commit.

## Final release freshness

After audit pass 1, V1-015 creates the final release anchor. Every
non-governance/non-audit criterion must be rerun on that exact commit; every
packaged criterion must reference that exact package SHA-256. These reruns live
in `planning/v1-release-evidence.json`, preserving historical owner evidence.
Audit pass 2 is bound to the same final package.
