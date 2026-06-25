import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import { loadContract, validateContract } from './v1-contract.mjs';

const root = resolve(import.meta.dirname, '..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('the checked-in v1 contract is structurally valid', async () => {
  const state = await loadContract(root);
  assert.deepEqual(validateContract(state).errors, []);
});

test('manual completion claims are rejected', async () => {
  const state = await loadContract(root);
  state.backlog.allCriteriaPass = true;
  assert.match(validateContract(state).errors.join('\n'), /allCriteriaPass is forbidden/);
});

test('removing a required criterion is rejected', async () => {
  const state = await loadContract(root);
  state.definitions.criteria = state.definitions.criteria.filter(
    (item) => item.id !== 'V1-EXT-001',
  );
  assert.match(
    validateContract(state).errors.join('\n'),
    /required criterion was removed: V1-EXT-001/,
  );
});

test('duplicate criterion ownership is rejected', async () => {
  const state = await loadContract(root);
  state.backlog.slices[1].acceptanceIds.push('V1-GOV-001');
  assert.match(validateContract(state).errors.join('\n'), /V1-GOV-001 has multiple owners/);
});

test('a completed slice without phase and criterion evidence is rejected', async () => {
  const state = await loadContract(root);
  state.progress.slices[0].status = 'completed';
  assert.match(validateContract(state).errors.join('\n'), /completed before test passed/);
  assert.match(
    validateContract(state).errors.join('\n'),
    /completed while V1-GOV-001 is not passing/,
  );
});

test('an external blocker cannot be a bare waiver', async () => {
  const state = await loadContract(root);
  const progress = state.progress.slices.find((item) => item.id === 'V1-017');
  progress.status = 'blocked_external';
  progress.blocker = { type: 'credential' };
  state.evidence.criteria.find((item) => item.id === 'V1-AI-002').status = 'blocked_external';
  assert.match(validateContract(state).errors.join('\n'), /blocker has invalid owner/);
  assert.match(validateContract(state).errors.join('\n'), /requires affectedCriterionIds/);
});

test('contract definition edits invalidate the lock', async () => {
  const state = clone(await loadContract(root));
  state.scopeText += '\nweakened';
  state.lockedFileHashes['docs/V1_SCOPE.md'] = '0'.repeat(64);
  assert.match(validateContract(state).errors.join('\n'), /contract hash mismatch/);
});

test('audit pass 2 cannot bypass remediation', async () => {
  const state = await loadContract(root);
  state.backlog.slices.find((item) => item.id === 'V1-016').dependsOn = ['V1-014'];
  assert.match(
    validateContract(state).errors.join('\n'),
    /audit pass 2 must depend on remediation/,
  );
});

test('nonexistent reports, artifacts and commits cannot forge passing evidence', async () => {
  const state = await loadContract(root);
  const item = state.evidence.criteria.find((criterion) => criterion.id === 'V1-AI-001');
  item.status = 'pass';
  item.verifiedAt = '2026-06-22T15:00:00Z';
  item.verifier = 'agent:019eefae-a68e-7c01-a14c-36146ac0b03f';
  item.verifiedBuild = {
    artifact: 'artifacts/invented.msi',
    sha256: 'a'.repeat(64),
    commit: 'd'.repeat(40),
    environment: 'invented',
  };
  item.evidence = [
    {
      type: 'packaged',
      commit: 'd'.repeat(40),
      recordedAt: '2026-06-22T15:00:00Z',
      report: 'reports/invented.json',
      reportSha256: 'b'.repeat(64),
      artifact: 'artifacts/invented.msi',
      artifactSha256: 'a'.repeat(64),
      environment: 'invented',
      signatures: [],
    },
  ];
  const result = validateContract(state);
  assert.equal(result.summary.complete, false);
  assert.match(result.errors.join('\n'), /commit not present in Git/);
  assert.match(result.errors.join('\n'), /file does not exist/);
});

test('self-review and a refreshed mutable lock cannot activate the contract', async () => {
  const state = await loadContract(root);
  state.attestation.status = 'pass';
  state.attestation.reviewedCommit = 'd'.repeat(40);
  state.attestation.reviews = [
    {
      reviewer: 'human:self',
      role: 'architecture',
      result: 'pass',
      reviewedCommit: 'd'.repeat(40),
      report: 'reports/fake.md',
      reportSha256: 'a'.repeat(64),
      reviewedAt: '2026-06-22T15:00:00Z',
      critical: 0,
      high: 0,
    },
  ];
  state.lockedFileHashes['docs/V1_SCOPE.md'] = 'c'.repeat(64);
  state.lock.files['docs/V1_SCOPE.md'] = 'c'.repeat(64);
  const errors = validateContract(state).errors.join('\n');
  assert.match(errors, /commit not present in Git/);
  assert.match(errors, /lock differs from the independently reviewed commit/);
  assert.match(errors, /missing passing security review/);
});

test('the lock must cover the full enforcement surface', async () => {
  const state = await loadContract(root);
  delete state.lock.files['scripts/v1-contract.mjs'];
  assert.match(
    validateContract(state).errors.join('\n'),
    /contract lock file set differs from the required enforcement surface/,
  );
});

test('completed phase evidence must be chronological', async () => {
  const state = await loadContract(root);
  const progress = state.progress.slices[0];
  progress.status = 'completed';
  for (const phase of ['implement', 'test', 'independent_review', 'fix', 'document', 'commit']) {
    progress.workflow[phase] = 'pass';
    progress.evidence.push({
      phase,
      commit: 'b2d7655fd01ef6199aa7ef88dd19c9ccd2d575f4',
      report: 'docs/audits/V1_CONTRACT_REVIEW_ROUND_1.md',
      reportSha256: state.repository.fileHashes['docs/audits/V1_CONTRACT_REVIEW_ROUND_1.md'],
      occurredAt: phase === 'test' ? '2026-06-22T14:00:00Z' : '2026-06-22T15:00:00Z',
    });
  }
  assert.match(validateContract(state).errors.join('\n'), /phase evidence is out of order/);
});

test('evidence paths cannot escape dedicated repository roots', async () => {
  const state = await loadContract(root);
  const item = state.evidence.criteria.find((criterion) => criterion.id === 'V1-GOV-001');
  item.status = 'pass';
  item.verifiedAt = '2026-06-22T15:00:00Z';
  item.verifier = 'agent:019eefae-a68e-7c01-a14c-36146ac0b03f';
  item.evidence = [
    {
      type: 'automated',
      commit: 'ad781fa2abb10a1dff45c1498ef56efc8fb82b18',
      recordedAt: '2026-06-22T15:00:00Z',
      report: '../outside.json',
      reportSha256: 'a'.repeat(64),
      signatures: [],
    },
  ];
  assert.match(validateContract(state).errors.join('\n'), /uses an unsafe path/);
});

test('prose or schema-free JSON cannot masquerade as a passing report', async () => {
  const state = await loadContract(root);
  const item = state.evidence.criteria.find((criterion) => criterion.id === 'V1-GOV-001');
  item.status = 'pass';
  item.verifiedAt = '2026-06-22T15:00:00Z';
  item.verifier = 'agent:019eefae-a68e-7c01-a14c-36146ac0b03f';
  item.evidence = [
    {
      type: 'automated',
      commit: 'ad781fa2abb10a1dff45c1498ef56efc8fb82b18',
      recordedAt: '2026-06-22T15:00:00Z',
      report: 'evidence/reports/fake.json',
      reportSha256: 'a'.repeat(64),
      signatures: [],
    },
  ];
  state.repository.pathSafety[item.evidence[0].report] = true;
  state.repository.fileHashes[item.evidence[0].report] = 'a'.repeat(64);
  state.repository.reports[item.evidence[0].report] = { hello: 'world' };
  assert.match(
    validateContract(state).errors.join('\n'),
    /report is not valid schema-version-1 JSON/,
  );
});

test('future timestamps are rejected', async () => {
  const state = await loadContract(root);
  const progress = state.progress.slices.find((item) => item.id === 'V1-017');
  progress.status = 'blocked_external';
  progress.blocker = {
    type: 'credential',
    owner: 'human:simon',
    proof: 'evidence/blockers/anthropic.json',
    proofSha256: 'a'.repeat(64),
    lastChecked: '2099-01-01T00:00:00Z',
    unblockCondition: 'credential supplied',
    degradedBehavior: 'Anthropic disabled',
    attempts: [{ at: '2099-01-01T00:00:00Z', action: 'checked', result: 'missing' }],
    affectedCriterionIds: ['V1-AI-002'],
    signatures: [],
  };
  state.evidence.criteria.find((item) => item.id === 'V1-AI-002').status = 'blocked_external';
  assert.match(validateContract(state).errors.join('\n'), /cannot be future-dated/);
});

test('a slice cannot start before every dependency completes', async () => {
  const state = await loadContract(root);
  state.progress.slices.find((item) => item.id === 'V1-001').status = 'in_progress';
  assert.match(
    validateContract(state).errors.join('\n'),
    /V1-001 started before dependency V1-000 completed/,
  );
});

test('every slice must remain reachable from V1-000', async () => {
  const state = await loadContract(root);
  state.backlog.slices.find((item) => item.id === 'V1-002').dependsOn = [];
  assert.match(validateContract(state).errors.join('\n'), /V1-002 is disconnected from V1-000/);
});

test('a final release anchor rejects stale criterion evidence', async () => {
  const state = await loadContract(root);
  state.releaseEvidence.anchor = {
    commit: 'ad781fa2abb10a1dff45c1498ef56efc8fb82b18',
    artifact: 'evidence/artifacts/orbit.msi',
    sha256: 'a'.repeat(64),
  };
  assert.match(
    validateContract(state).errors.join('\n'),
    /V1-CORE-001 is not fresh on the final release commit/,
  );
});

test('review severity counts are derived from unresolved findings', async () => {
  const state = await loadContract(root);
  const reportPath = 'evidence/reports/fake-review.json';
  state.attestation.status = 'pass';
  state.attestation.reviewedCommit = '56d7b533816f4817309f4880b3ae6e7bb8de2df9';
  state.attestation.reviews = [
    {
      reviewer: 'agent:019eefae-a68e-7c01-a14c-36146ac0b03f',
      role: 'architecture',
      result: 'pass',
      reviewedCommit: '56d7b533816f4817309f4880b3ae6e7bb8de2df9',
      report: reportPath,
      reportSha256: 'a'.repeat(64),
      reviewedAt: '2026-06-22T15:00:00Z',
      critical: 0,
      high: 0,
      signature: 'invalid',
    },
  ];
  state.repository.pathSafety[reportPath] = true;
  state.repository.fileHashes[reportPath] = 'a'.repeat(64);
  state.repository.documents[reportPath] = {
    schemaVersion: 1,
    kind: 'review',
    reviewer: state.attestation.reviews[0].reviewer,
    role: 'architecture',
    result: 'pass',
    reviewedCommit: state.attestation.reviewedCommit,
    reviewedAt: '2026-06-22T15:00:00Z',
    critical: 0,
    high: 0,
    artifactSha256: null,
    findings: [{ id: 'F-1', title: 'Open bypass', severity: 'critical', status: 'open' }],
  };
  assert.match(
    validateContract(state).errors.join('\n'),
    /review counts\/result do not match unresolved findings/,
  );
});

test('review authorities cannot alias the same public key', async () => {
  const state = await loadContract(root);
  const duplicate = clone(state.authorities.authorities[0]);
  duplicate.identity = 'agent:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  state.authorities.authorities.push(duplicate);
  assert.match(validateContract(state).errors.join('\n'), /duplicates an existing review key/);
});

test('noncanonical DER cannot alias an existing review key', async () => {
  const state = await loadContract(root);
  const authority = state.authorities.authorities[0];
  const aliasedBytes = Buffer.concat([
    Buffer.from(authority.publicKeySpkiBase64, 'base64'),
    Buffer.from([0]),
  ]);
  authority.publicKeySpkiBase64 = aliasedBytes.toString('base64');
  authority.sha256Fingerprint = createHash('sha256').update(aliasedBytes).digest('hex');
  assert.match(validateContract(state).errors.join('\n'), /key is not canonical DER/);
});

test('criterion evidence must follow its claimed commit and use an authorized role', async () => {
  const state = await loadContract(root);
  const item = state.evidence.criteria.find((criterion) => criterion.id === 'V1-TOOLS-005');
  const reportPath = 'evidence/reports/security-role.json';
  item.status = 'pass';
  item.verifiedAt = '2026-06-22T15:01:00Z';
  item.verifier = 'agent:019ef142-0941-7da3-a6aa-91543a805b16';
  item.evidence = [
    {
      type: 'automated',
      commit: '972d687441875731b2c9082a77222658c1e00667',
      recordedAt: '2020-01-01T00:00:00Z',
      report: reportPath,
      reportSha256: 'a'.repeat(64),
      signatures: [],
    },
  ];
  state.repository.pathSafety[reportPath] = true;
  state.repository.fileHashes[reportPath] = 'a'.repeat(64);
  state.repository.reports[reportPath] = {
    schemaVersion: 1,
    kind: 'automated',
    status: 'pass',
    subjectIds: ['V1-TOOLS-005'],
    commit: item.evidence[0].commit,
    generatedAt: item.evidence[0].recordedAt,
    producer: 'ci:github-actions:1',
    ci: {
      repository: 'Mousewarriors/Orbit',
      runUrl: 'https://github.com/Mousewarriors/Orbit/actions/runs/1',
      conclusion: 'success',
      workflow: 'Mousewarriors/Orbit/.github/workflows/ci.yml',
      commit: item.evidence[0].commit,
    },
    checks: [],
  };
  const errors = validateContract(state).errors.join('\n');
  assert.match(errors, /evidence predates its claimed commit/);
  assert.match(errors, /lacks a trusted security signature/);
});

test('an audit cannot hide another review open high finding', async () => {
  const state = await loadContract(root);
  const progress = state.progress.slices.find((item) => item.id === 'V1-014');
  const reportPath = 'evidence/reports/audit-open-high.json';
  progress.status = 'completed';
  progress.reviews = [
    {
      reviewer: 'agent:019ef142-312a-7771-bc42-11fb141b1961',
      role: 'product',
      result: 'changes_requested',
      reviewedCommit: '972d687441875731b2c9082a77222658c1e00667',
      report: reportPath,
      reportSha256: 'b'.repeat(64),
      reviewedAt: '2026-06-22T21:40:58.820Z',
      critical: 0,
      high: 1,
      signature: 'invalid',
    },
  ];
  state.repository.pathSafety[reportPath] = true;
  state.repository.fileHashes[reportPath] = 'b'.repeat(64);
  state.repository.documents[reportPath] = {
    schemaVersion: 1,
    kind: 'review',
    reviewer: progress.reviews[0].reviewer,
    role: 'product',
    result: 'changes_requested',
    reviewedCommit: progress.reviews[0].reviewedCommit,
    reviewedAt: progress.reviews[0].reviewedAt,
    critical: 0,
    high: 1,
    artifactSha256: null,
    findings: [{ id: 'P-1', title: 'Open high', severity: 'high', status: 'open' }],
  };
  assert.match(validateContract(state).errors.join('\n'), /has unresolved high finding/);
});

test('audit pass 2 is not clean if any review finds a high issue', async () => {
  const state = await loadContract(root);
  const progress = state.progress.slices.find((item) => item.id === 'V1-016');
  const reportPath = 'evidence/reports/audit2-high.json';
  progress.status = 'completed';
  progress.reviews = [
    {
      reviewer: 'agent:019ef142-312a-7771-bc42-11fb141b1961',
      role: 'product',
      result: 'changes_requested',
      reviewedCommit: '10fd3312b29547eb065a8bfdd5d674baf56e1695',
      report: reportPath,
      reportSha256: 'c'.repeat(64),
      reviewedAt: '2026-06-22T21:52:34.716Z',
      critical: 0,
      high: 1,
      signature: 'invalid',
    },
  ];
  state.repository.pathSafety[reportPath] = true;
  state.repository.fileHashes[reportPath] = 'c'.repeat(64);
  state.repository.documents[reportPath] = {
    schemaVersion: 1,
    kind: 'review',
    reviewer: progress.reviews[0].reviewer,
    role: 'product',
    result: 'changes_requested',
    reviewedCommit: progress.reviews[0].reviewedCommit,
    reviewedAt: progress.reviews[0].reviewedAt,
    critical: 0,
    high: 1,
    artifactSha256: null,
    findings: [{ id: 'P-2', title: 'Release defect', severity: 'high', status: 'open' }],
  };
  assert.match(validateContract(state).errors.join('\n'), /is not a clean audit/);
});

test('automated evidence cannot use a different historical CI workflow', async () => {
  const state = await loadContract(root);
  const item = state.evidence.criteria.find((criterion) => criterion.id === 'V1-TOOLS-005');
  const reportPath = 'evidence/reports/workflow-mismatch.json';
  item.status = 'pass';
  item.verifiedAt = '2026-06-22T21:45:00Z';
  item.verifier = 'agent:019ef142-1d1f-78f1-87d5-353c7ec7eea9';
  item.evidence = [
    {
      type: 'automated',
      commit: '972d687441875731b2c9082a77222658c1e00667',
      recordedAt: '2026-06-22T21:44:00Z',
      report: reportPath,
      reportSha256: 'd'.repeat(64),
      signatures: [],
    },
  ];
  state.repository.pathSafety[reportPath] = true;
  state.repository.fileHashes[reportPath] = 'd'.repeat(64);
  state.repository.reports[reportPath] = {
    schemaVersion: 1,
    kind: 'automated',
    status: 'pass',
    subjectIds: ['V1-TOOLS-005'],
    commit: item.evidence[0].commit,
    generatedAt: item.evidence[0].recordedAt,
    producer: 'ci:github-actions:1',
    ci: {
      repository: 'Mousewarriors/Orbit',
      runUrl: 'https://github.com/Mousewarriors/Orbit/actions/runs/1',
      conclusion: 'success',
      workflow: 'Mousewarriors/Orbit/.github/workflows/ci.yml',
      commit: item.evidence[0].commit,
    },
    checks: [],
  };
  state.repository.githubAttestations[reportPath] = true;
  state.repository.workflowHashesByCommit[item.evidence[0].commit] = '0'.repeat(64);
  assert.match(validateContract(state).errors.join('\n'), /used an unlocked CI workflow/);
});

test('required raw security telemetry evidence is size-checked without crashing', async () => {
  const state = await loadContract(root);
  const item = state.evidence.criteria.find((criterion) => criterion.id === 'V1-TOOLS-005');
  const reportPath = 'evidence/reports/security-raw-telemetry.json';
  const rawPath = 'evidence/reports/security-raw-telemetry-raw.json';
  const report = {
    schemaVersion: 1,
    kind: 'automated',
    status: 'pass',
    subjectIds: ['V1-TOOLS-005'],
    commit: '972d687441875731b2c9082a77222658c1e00667',
    generatedAt: '2026-06-22T21:44:00Z',
    producer: 'ci:github-actions:1',
    ci: {
      repository: 'Mousewarriors/Orbit',
      runUrl: 'https://github.com/Mousewarriors/Orbit/actions/runs/1',
      conclusion: 'success',
      workflow: 'Mousewarriors/Orbit/.github/workflows/ci.yml',
      commit: '972d687441875731b2c9082a77222658c1e00667',
    },
    checks: [
      {
        id: 'redirect',
        status: 'pass',
        details: {
          target: 'http://127.0.0.1/redirect',
          inputSha256: 'e'.repeat(64),
          observed: 'blocked',
          rawEvidencePath: rawPath,
          rawEvidenceSha256: 'f'.repeat(64),
        },
      },
    ],
  };
  item.status = 'pass';
  item.verifiedAt = '2026-06-22T21:45:00Z';
  item.verifier = 'agent:019efdd5-527a-7571-bfab-28c1d50ea51f';
  item.evidence = [
    {
      type: 'automated',
      commit: report.commit,
      recordedAt: report.generatedAt,
      report: reportPath,
      reportSha256: 'd'.repeat(64),
      signatures: [],
    },
  ];
  state.repository.pathSafety[reportPath] = true;
  state.repository.fileHashes[reportPath] = item.evidence[0].reportSha256;
  state.repository.reports[reportPath] = report;
  state.repository.documents[reportPath] = report;
  const errors = validateContract(state).errors.join('\n');
  assert.match(errors, /check redirect raw evidence is invalid or unattested/);
});
