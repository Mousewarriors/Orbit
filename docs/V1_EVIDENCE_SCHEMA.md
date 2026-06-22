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
attestation/OIDC provenance. Security-critical criteria also require the
specific negative-test IDs encoded by the validator.

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
packaged criterion must reference that exact package SHA-256. Audit pass 2 is
bound to the same package.
