import assert from 'node:assert/strict';
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
  item.verifier = 'human:self';
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
