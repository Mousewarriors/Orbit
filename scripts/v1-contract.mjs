import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SLICE_STATUSES = new Set([
  'pending',
  'in_progress',
  'blocked_external',
  'blocked_decision',
  'review',
  'completed',
]);
const PHASE_STATUSES = new Set(['pending', 'in_progress', 'pass', 'not_applicable']);
const EVIDENCE_STATUSES = new Set([
  'pending',
  'pass',
  'fail',
  'blocked_external',
  'blocked_decision',
]);
const EVIDENCE_POLICIES = new Set([
  'automated',
  'packaged',
  'packaged_external',
  'automated_and_packaged',
]);
const EVIDENCE_TYPES = new Set(['automated', 'packaged', 'review', 'documentation']);
const PHASES = [
  'implement',
  'test',
  'independent_review',
  'fix',
  'package',
  'live_verify',
  'document',
  'commit',
];
const REQUIRED_PHASES = {
  governance: ['implement', 'test', 'independent_review', 'fix', 'document', 'commit'],
  vertical: PHASES,
  audit: ['independent_review', 'fix', 'package', 'live_verify', 'document', 'commit'],
};
const REQUIRED_AUDIT_ROLES = new Set(['architecture', 'security', 'product', 'regression']);
const REQUIRED_CONTRACT_REVIEW_ROLES = new Set(['architecture', 'security', 'product']);
const REQUIRED_CRITERION_IDS = new Set([
  'V1-GOV-001',
  'V1-GOV-002',
  'V1-GOV-003',
  'V1-GOV-004',
  'V1-GOV-005',
  'V1-CORE-001',
  'V1-CORE-002',
  'V1-CORE-003',
  'V1-NL-001',
  'V1-NL-002',
  'V1-NL-003',
  'V1-NL-004',
  'V1-NL-005',
  'V1-PROJ-001',
  'V1-PROJ-002',
  'V1-PROJ-003',
  'V1-PROJ-004',
  'V1-PROJ-005',
  'V1-PROJ-006',
  'V1-AI-001',
  'V1-AI-002',
  'V1-AI-003',
  'V1-AI-004',
  'V1-CTX-001',
  'V1-CTX-002',
  'V1-CTX-003',
  'V1-CTX-004',
  'V1-CTX-005',
  'V1-CTX-006',
  'V1-CHAT-001',
  'V1-CHAT-002',
  'V1-CHAT-003',
  'V1-MISSION-001',
  'V1-MISSION-002',
  'V1-MISSION-003',
  'V1-TOOLS-001',
  'V1-TOOLS-002',
  'V1-TOOLS-003',
  'V1-TOOLS-004',
  'V1-TOOLS-005',
  'V1-TOOLS-006',
  'V1-APPROVAL-001',
  'V1-APPROVAL-002',
  'V1-APPROVAL-003',
  'V1-EXT-001',
  'V1-EXT-002',
  'V1-EXT-003',
  'V1-QUAL-001',
  'V1-QUAL-002',
  'V1-QUAL-003',
  'V1-QUAL-004',
  'V1-REL-001',
  'V1-REL-002',
  'V1-REL-003',
  'V1-REL-004',
  'V1-REL-005',
  'V1-REL-006',
  'V1-REL-007',
  'V1-DOC-001',
  'V1-AUDIT-001',
  'V1-AUDIT-002',
]);
const LOCKED_FILES = [
  'docs/V1_SCOPE.md',
  'docs/V1_ACCEPTANCE.md',
  'docs/V1_CHANGELOG.md',
  'planning/v1-backlog.json',
  'planning/v1-criteria.json',
  'scripts/v1-contract.mjs',
  'scripts/validate-v1-backlog.mjs',
  'scripts/validate-v1-contract.test.mjs',
  'package.json',
  '.github/workflows/ci.yml',
];
const FORBIDDEN_MANUAL_COMPLETION_KEYS = new Set([
  'allCriteriaPass',
  'cleanAuditCount',
  'isComplete',
  'completionPercent',
]);
const IDENTITY_PATTERN =
  /^(agent:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|human:[A-Za-z0-9._-]+|ci:[A-Za-z0-9._/-]+)$/i;
const REVIEWER_IDENTITY_PATTERN =
  /^(agent:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|human:[A-Za-z0-9._-]+)$/i;
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value) {
  return isText(value) && !Number.isNaN(Date.parse(value));
}

function countOccurrences(text, token) {
  return text.split(token).length - 1;
}

function scanForbiddenKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MANUAL_COMPLETION_KEYS.has(key)) {
      errors.push(`${path}.${key} is forbidden; completion must be computed`);
    }
    scanForbiddenKeys(child, `${path}.${key}`, errors);
  }
}

function validateFileClaim(path, digest, repository, label, errors) {
  if (!isText(path) || !SHA256_PATTERN.test(digest ?? '')) {
    errors.push(`${label} requires a path and SHA-256`);
    return;
  }
  const actual = repository.fileHashes[path];
  if (!actual) errors.push(`${label} file does not exist: ${path}`);
  else if (actual !== digest.toLowerCase()) errors.push(`${label} SHA-256 mismatch: ${path}`);
}

function validateCommit(commit, repository, label, errors) {
  if (!FULL_COMMIT_PATTERN.test(commit ?? '')) {
    errors.push(`${label} requires a full 40-character Git commit`);
  } else if (!repository.commits.includes(commit.toLowerCase())) {
    errors.push(`${label} references a commit not present in Git: ${commit}`);
  }
}

function validateEvidenceRecord(record, itemId, repository, errors) {
  if (!EVIDENCE_TYPES.has(record.type)) errors.push(`${itemId} has invalid evidence type`);
  validateCommit(record.commit, repository, `${itemId} evidence`, errors);
  if (!isTimestamp(record.recordedAt)) errors.push(`${itemId} evidence requires recordedAt`);
  validateFileClaim(record.report, record.reportSha256, repository, `${itemId} evidence`, errors);
  if (record.type === 'packaged') {
    validateFileClaim(
      record.artifact,
      record.artifactSha256,
      repository,
      `${itemId} packaged evidence`,
      errors,
    );
    if (!isText(record.environment))
      errors.push(`${itemId} packaged evidence requires environment`);
  }
}

function validatePassingEvidence(item, definition, repository, errors) {
  if (item.status !== 'pass') return;
  if (!isTimestamp(item.verifiedAt)) errors.push(`${item.id} pass requires verifiedAt`);
  if (!IDENTITY_PATTERN.test(item.verifier ?? '')) {
    errors.push(`${item.id} pass requires an authenticated verifier identity`);
  }
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
    errors.push(`${item.id} pass requires evidence`);
    return;
  }
  item.evidence.forEach((record) => validateEvidenceRecord(record, item.id, repository, errors));
  const types = new Set(item.evidence.map((record) => record.type));
  if (definition.evidencePolicy === 'automated' && !types.has('automated')) {
    errors.push(`${item.id} requires automated evidence`);
  }
  if (
    (definition.evidencePolicy === 'packaged' ||
      definition.evidencePolicy === 'packaged_external') &&
    !types.has('packaged')
  ) {
    errors.push(`${item.id} requires packaged evidence`);
  }
  if (
    definition.evidencePolicy === 'automated_and_packaged' &&
    (!types.has('automated') || !types.has('packaged'))
  ) {
    errors.push(`${item.id} requires both automated and packaged evidence`);
  }
  const commits = new Set(item.evidence.map((record) => record.commit));
  if (commits.size !== 1) errors.push(`${item.id} evidence must target one exact commit`);
  const evidenceCommit = item.evidence[0]?.commit;
  const packagedRecord = item.evidence.find((record) => record.type === 'packaged');
  if (packagedRecord) {
    const build = item.verifiedBuild;
    if (
      !build ||
      build.commit !== evidenceCommit ||
      build.sha256 !== packagedRecord.artifactSha256 ||
      build.artifact !== packagedRecord.artifact ||
      build.environment !== packagedRecord.environment
    ) {
      errors.push(`${item.id} verifiedBuild must exactly match packaged evidence`);
    }
  } else if (item.verifiedBuild !== null) {
    errors.push(`${item.id} non-packaged evidence cannot claim a verifiedBuild`);
  }
}

function validateBlocker(slice, progress, evidenceById, repository, now, errors) {
  const isBlocked =
    progress.status === 'blocked_external' || progress.status === 'blocked_decision';
  if (!isBlocked) {
    if (progress.blocker !== null) {
      errors.push(`${slice.id} has a blocker while status is ${progress.status}`);
    }
    return;
  }
  const blocker = progress.blocker;
  if (!blocker || typeof blocker !== 'object') {
    errors.push(`${slice.id} requires a structured blocker`);
    return;
  }
  if (
    progress.status === 'blocked_external' &&
    !['credential', 'certificate'].includes(blocker.type)
  ) {
    errors.push(`${slice.id} external blocker must be credential or certificate`);
  }
  if (progress.status === 'blocked_decision' && blocker.type !== 'product_decision') {
    errors.push(`${slice.id} decision blocker must use product_decision`);
  }
  if (!IDENTITY_PATTERN.test(blocker.owner ?? ''))
    errors.push(`${slice.id} blocker has invalid owner`);
  validateFileClaim(blocker.proof, blocker.proofSha256, repository, `${slice.id} blocker`, errors);
  if (!isTimestamp(blocker.lastChecked)) errors.push(`${slice.id} blocker requires lastChecked`);
  else if (now - Date.parse(blocker.lastChecked) > 7 * 24 * 60 * 60 * 1000) {
    errors.push(`${slice.id} blocker proof is older than seven days`);
  }
  for (const field of ['unblockCondition', 'degradedBehavior']) {
    if (!isText(blocker[field])) errors.push(`${slice.id} blocker is missing ${field}`);
  }
  if (!Array.isArray(blocker.attempts) || blocker.attempts.length === 0) {
    errors.push(`${slice.id} blocker requires attempted mitigations`);
  }
  for (const attempt of blocker.attempts ?? []) {
    if (!isTimestamp(attempt.at) || !isText(attempt.action) || !isText(attempt.result)) {
      errors.push(`${slice.id} blocker has an invalid attempt record`);
    }
  }
  if (!Array.isArray(blocker.affectedCriterionIds) || blocker.affectedCriterionIds.length === 0) {
    errors.push(`${slice.id} blocker requires affectedCriterionIds`);
  }
  const expected = [...(slice.acceptanceIds ?? [])].sort();
  const actual = [...(blocker.affectedCriterionIds ?? [])].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${slice.id} blocker must list every owned criterion and no others`);
  }
  for (const id of actual) {
    const item = evidenceById.get(id);
    if (item?.status !== progress.status) {
      errors.push(`${slice.id} blocker criterion ${id} must have status ${progress.status}`);
    }
  }
}

function validateReview(review, slice, implementerIdentity, repository, errors) {
  if (!REVIEWER_IDENTITY_PATTERN.test(review.reviewer ?? '')) {
    errors.push(`${slice.id} review requires an authenticated human/agent reviewer`);
  }
  if (review.reviewer === implementerIdentity)
    errors.push(`${slice.id} reviewer cannot be implementer`);
  if (!isText(review.role) || !['pass', 'changes_requested'].includes(review.result)) {
    errors.push(`${slice.id} review has invalid role/result`);
  }
  validateCommit(review.reviewedCommit, repository, `${slice.id} review`, errors);
  validateFileClaim(review.report, review.reportSha256, repository, `${slice.id} review`, errors);
  if (!isTimestamp(review.reviewedAt)) errors.push(`${slice.id} review requires reviewedAt`);
  if (!Number.isInteger(review.critical) || !Number.isInteger(review.high)) {
    errors.push(`${slice.id} review requires integer critical/high counts`);
  }
  if (review.result === 'pass' && (review.critical !== 0 || review.high !== 0)) {
    errors.push(`${slice.id} passing review contains critical/high findings`);
  }
}

function validateCompletedSlice(slice, progress, evidenceById, repository, errors) {
  if (progress.status !== 'completed') return;
  const requiredPhases = REQUIRED_PHASES[slice.mode] ?? [];
  const phaseEvidence = new Map();
  for (const record of progress.evidence ?? []) {
    if (!record.phase) continue;
    if (phaseEvidence.has(record.phase))
      errors.push(`${slice.id} has duplicate ${record.phase} evidence`);
    phaseEvidence.set(record.phase, record);
    validateCommit(record.commit, repository, `${slice.id}.${record.phase}`, errors);
    validateFileClaim(
      record.report,
      record.reportSha256,
      repository,
      `${slice.id}.${record.phase}`,
      errors,
    );
    if (!isTimestamp(record.occurredAt))
      errors.push(`${slice.id}.${record.phase} requires occurredAt`);
    if (record.phase === 'package' || record.phase === 'live_verify') {
      validateFileClaim(
        record.artifact,
        record.artifactSha256,
        repository,
        `${slice.id}.${record.phase}`,
        errors,
      );
    }
  }
  let lastTime = -Infinity;
  for (const phase of requiredPhases) {
    if (progress.workflow?.[phase] !== 'pass')
      errors.push(`${slice.id} completed before ${phase} passed`);
    const record = phaseEvidence.get(phase);
    if (!record) {
      errors.push(`${slice.id} completed without ${phase} evidence`);
      continue;
    }
    const time = Date.parse(record.occurredAt);
    if (time < lastTime) errors.push(`${slice.id} phase evidence is out of order at ${phase}`);
    lastTime = time;
  }
  const passingReviews = (progress.reviews ?? []).filter((review) => review.result === 'pass');
  if (passingReviews.length === 0) errors.push(`${slice.id} completed without a passing review`);
  progress.reviews?.forEach((review) =>
    validateReview(review, slice, 'codex:main', repository, errors),
  );
  if (slice.mode === 'audit') {
    const roles = new Set(passingReviews.map((review) => review.role));
    for (const role of REQUIRED_AUDIT_ROLES) {
      if (!roles.has(role)) errors.push(`${slice.id} audit is missing passing ${role} review`);
    }
    if (new Set(passingReviews.map((review) => review.reviewer)).size !== passingReviews.length) {
      errors.push(`${slice.id} audit reviewers must be distinct`);
    }
  }
  for (const id of slice.acceptanceIds ?? []) {
    if (evidenceById.get(id)?.status !== 'pass') {
      errors.push(`${slice.id} completed while ${id} is not passing`);
    }
  }
}

export function validateContract(state) {
  const {
    backlog,
    progress,
    definitions,
    evidence,
    scopeText,
    acceptanceText,
    lock,
    attestation,
    lockedFileHashes,
    repository,
    now = Date.now(),
  } = state;
  const errors = [];

  scanForbiddenKeys(backlog, 'backlog', errors);
  scanForbiddenKeys(progress, 'progress', errors);
  scanForbiddenKeys(evidence, 'evidence', errors);
  if (backlog.schemaVersion !== 3) errors.push('backlog schemaVersion must be 3');
  if (progress.schemaVersion !== 1) errors.push('progress schemaVersion must be 1');
  if (definitions.schemaVersion !== 1) errors.push('criteria schemaVersion must be 1');
  if (evidence.schemaVersion !== 1) errors.push('evidence schemaVersion must be 1');
  if (lock.schemaVersion !== 2) errors.push('contract lock schemaVersion must be 2');
  if (attestation.schemaVersion !== 1) errors.push('review attestation schemaVersion must be 1');
  const versions = new Set([
    backlog.contractVersion,
    progress.contractVersion,
    definitions.contractVersion,
    evidence.contractVersion,
    lock.contractVersion,
    attestation.contractVersion,
  ]);
  if (versions.size !== 1 || versions.has(undefined))
    errors.push('contractVersion differs across files');

  const criteria = Array.isArray(definitions.criteria) ? definitions.criteria : [];
  const definitionById = new Map();
  for (const criterion of criteria) {
    if (!/^V1-[A-Z]+-\d{3}$/.test(criterion.id ?? '')) {
      errors.push(`invalid criterion id ${String(criterion.id)}`);
    }
    if (definitionById.has(criterion.id))
      errors.push(`duplicate criterion definition ${criterion.id}`);
    definitionById.set(criterion.id, criterion);
    if (!EVIDENCE_POLICIES.has(criterion.evidencePolicy)) {
      errors.push(`${criterion.id} has invalid evidence policy`);
    }
    for (const field of ['area', 'given', 'when', 'then']) {
      if (!isText(criterion[field])) errors.push(`${criterion.id} is missing ${field}`);
    }
  }
  for (const id of REQUIRED_CRITERION_IDS) {
    if (!definitionById.has(id)) errors.push(`required criterion was removed: ${id}`);
  }
  for (const id of definitionById.keys()) {
    if (!REQUIRED_CRITERION_IDS.has(id))
      errors.push(`unreviewed criterion id requires contract update: ${id}`);
    if (countOccurrences(acceptanceText, `**${id}**`) !== 1) {
      errors.push(`${id} must appear exactly once in V1_ACCEPTANCE.md`);
    }
  }
  if (!scopeText.includes('Explicitly post-v1 (v1.1 or later)')) {
    errors.push('scope must declare the post-v1 boundary');
  }
  if (!scopeText.includes('AgentOS Gateway and Hermes remote orchestration')) {
    errors.push('scope must keep Gateway/Hermes explicitly post-v1');
  }
  if (!scopeText.includes('Remote provider: Anthropic API')) {
    errors.push('scope must lock the remote provider choice');
  }

  const ledger = Array.isArray(evidence.criteria) ? evidence.criteria : [];
  const evidenceById = new Map();
  for (const item of ledger) {
    if (evidenceById.has(item.id)) errors.push(`duplicate evidence item ${item.id}`);
    evidenceById.set(item.id, item);
    if (!definitionById.has(item.id))
      errors.push(`evidence references unknown criterion ${item.id}`);
    if (!EVIDENCE_STATUSES.has(item.status)) errors.push(`${item.id} has invalid evidence status`);
    validatePassingEvidence(item, definitionById.get(item.id) ?? {}, repository, errors);
    if (item.status === 'pending' && (item.verifiedBuild || item.verifiedAt || item.verifier)) {
      errors.push(`${item.id} pending state contains verification claims`);
    }
  }
  for (const id of definitionById.keys()) {
    if (!evidenceById.has(id)) errors.push(`criterion is missing evidence state: ${id}`);
  }

  const progressById = new Map();
  for (const item of progress.slices ?? []) {
    if (progressById.has(item.id)) errors.push(`duplicate progress state ${item.id}`);
    progressById.set(item.id, item);
  }
  const slices = Array.isArray(backlog.slices) ? backlog.slices : [];
  const sliceById = new Map();
  const orders = new Set();
  const owners = new Map();
  for (const slice of slices) {
    if (!/^V1-\d{3}$/.test(slice.id ?? '')) errors.push(`invalid slice id ${String(slice.id)}`);
    if (sliceById.has(slice.id)) errors.push(`duplicate slice id ${slice.id}`);
    sliceById.set(slice.id, slice);
    if (!Number.isInteger(slice.order) || orders.has(slice.order)) {
      errors.push(`${slice.id} has invalid or duplicate order`);
    }
    orders.add(slice.order);
    if (!Object.hasOwn(REQUIRED_PHASES, slice.mode)) errors.push(`${slice.id} has invalid mode`);
    if (!Array.isArray(slice.deliverables) || slice.deliverables.length === 0) {
      errors.push(`${slice.id} has no deliverables`);
    }
    const item = progressById.get(slice.id);
    if (!item) {
      errors.push(`${slice.id} has no progress state`);
      continue;
    }
    if (!SLICE_STATUSES.has(item.status)) errors.push(`${slice.id} has invalid status`);
    const requiredPhases = new Set(REQUIRED_PHASES[slice.mode] ?? []);
    for (const phase of PHASES) {
      const phaseStatus = item.workflow?.[phase];
      if (!PHASE_STATUSES.has(phaseStatus)) errors.push(`${slice.id}.${phase} has invalid status`);
      if (requiredPhases.has(phase) && phaseStatus === 'not_applicable') {
        errors.push(`${slice.id}.${phase} is required`);
      }
      if (!requiredPhases.has(phase) && phaseStatus !== 'not_applicable') {
        errors.push(`${slice.id}.${phase} must be not_applicable for ${slice.mode}`);
      }
    }
    if (item.status === 'pending') {
      for (const phase of requiredPhases) {
        if (item.workflow?.[phase] !== 'pending')
          errors.push(`${slice.id} pending slice has started ${phase}`);
      }
    }
    for (const id of slice.acceptanceIds ?? []) {
      if (!definitionById.has(id)) errors.push(`${slice.id} owns unknown criterion ${id}`);
      if (owners.has(id))
        errors.push(`${id} has multiple owners: ${owners.get(id)} and ${slice.id}`);
      owners.set(id, slice.id);
    }
    for (const id of slice.verifiesAcceptanceIds ?? []) {
      if (!definitionById.has(id)) errors.push(`${slice.id} verifies unknown criterion ${id}`);
    }
    validateBlocker(slice, item, evidenceById, repository, now, errors);
    validateCompletedSlice(slice, item, evidenceById, repository, errors);
  }
  for (const id of progressById.keys()) {
    if (!sliceById.has(id)) errors.push(`progress references unknown slice ${id}`);
  }
  for (let order = 0; order < slices.length; order += 1) {
    if (!orders.has(order)) errors.push(`slice order is not contiguous at ${order}`);
  }
  for (const id of definitionById.keys()) {
    const owner = owners.get(id);
    if (!owner) errors.push(`${id} has no owning slice`);
    const ledgerItem = evidenceById.get(id);
    if (ledgerItem && ledgerItem.ownerSlice !== owner) {
      errors.push(
        `${id} ledger owner ${ledgerItem.ownerSlice} differs from backlog owner ${owner}`,
      );
    }
  }
  for (const slice of slices) {
    const item = progressById.get(slice.id);
    for (const dependency of slice.dependsOn ?? []) {
      const target = sliceById.get(dependency);
      if (!target) errors.push(`${slice.id} depends on missing ${dependency}`);
      else {
        if (target.order >= slice.order)
          errors.push(`${slice.id} dependency ${dependency} is not earlier`);
        if (item?.status === 'completed' && progressById.get(dependency)?.status !== 'completed') {
          errors.push(`${slice.id} completed before dependency ${dependency}`);
        }
      }
    }
    if (item?.status === 'completed') {
      const commitEvidence = (item.evidence ?? []).find((record) => record.phase === 'commit');
      for (const id of slice.verifiesAcceptanceIds ?? []) {
        const criterion = evidenceById.get(id);
        if (
          criterion?.status !== 'pass' ||
          !criterion.evidence?.every((record) => record.commit === commitEvidence?.commit)
        ) {
          errors.push(`${slice.id} did not reverify ${id} on its exact commit`);
        }
      }
    }
  }
  const active = [...progressById.values()].filter(
    (item) => item.status === 'in_progress' || item.status === 'review',
  );
  if (active.length > 1)
    errors.push(`more than one slice is active: ${active.map((item) => item.id).join(', ')}`);

  if (!sliceById.get('V1-016')?.dependsOn?.includes('V1-015')) {
    errors.push('audit pass 2 must depend on remediation V1-015');
  }
  if (!sliceById.get('V1-015')?.dependsOn?.includes('V1-014')) {
    errors.push('remediation V1-015 must depend on audit pass 1');
  }
  const audit1 = evidenceById.get('V1-AUDIT-001');
  const remediation = evidenceById.get('V1-GOV-005');
  const audit2 = evidenceById.get('V1-AUDIT-002');
  if (audit2?.status === 'pass') {
    if (audit1?.status !== 'pass' || remediation?.status !== 'pass') {
      errors.push('audit pass 2 cannot pass before audit 1 and remediation');
    }
    const times = [audit1?.verifiedAt, remediation?.verifiedAt, audit2?.verifiedAt].map(Date.parse);
    if (!(times[0] < times[1] && times[1] < times[2])) {
      errors.push('audit 1, remediation and audit 2 chronology is invalid');
    }
    const commits = [
      audit1?.evidence?.[0]?.commit,
      remediation?.evidence?.[0]?.commit,
      audit2?.evidence?.[0]?.commit,
    ];
    if (
      !repository.ancestry[`${commits[0]}..${commits[1]}`] ||
      !repository.ancestry[`${commits[1]}..${commits[2]}`]
    ) {
      errors.push('audit/remediation commits are not newer descendants');
    }
    const hashes = [
      audit1?.verifiedBuild?.sha256,
      remediation?.verifiedBuild?.sha256,
      audit2?.verifiedBuild?.sha256,
    ];
    if (new Set(hashes).size !== 3) errors.push('audit packages must have distinct SHA-256 values');
    const panel1 = new Set(
      (progressById.get('V1-014')?.reviews ?? [])
        .filter((review) => review.result === 'pass')
        .map((review) => review.reviewer),
    );
    const panel2 = (progressById.get('V1-016')?.reviews ?? [])
      .filter((review) => review.result === 'pass')
      .map((review) => review.reviewer);
    if (panel2.some((reviewer) => panel1.has(reviewer))) {
      errors.push('audit pass 2 must use a fresh reviewer panel');
    }
  }

  if (
    JSON.stringify(Object.keys(lock.files ?? {}).sort()) !==
    JSON.stringify([...LOCKED_FILES].sort())
  ) {
    errors.push('contract lock file set differs from the required enforcement surface');
  }
  for (const file of LOCKED_FILES) {
    if (lock.files?.[file] !== lockedFileHashes[file])
      errors.push(`contract hash mismatch for ${file}`);
  }
  if (attestation.status === 'pass') {
    validateCommit(attestation.reviewedCommit, repository, 'contract attestation', errors);
    if (repository.lockAtReviewedCommit !== repository.currentLockHash) {
      errors.push('contract lock differs from the independently reviewed commit');
    }
    for (const file of LOCKED_FILES) {
      if (repository.lockedAtReviewedCommit?.[file] !== lockedFileHashes[file]) {
        errors.push(`locked file changed after independent review: ${file}`);
      }
    }
    const roles = new Set();
    const reviewers = new Set();
    for (const review of attestation.reviews ?? []) {
      validateReview(
        review,
        { id: 'contract-attestation' },
        backlog.implementerIdentity,
        repository,
        errors,
      );
      if (review.result === 'pass') roles.add(review.role);
      if (reviewers.has(review.reviewer))
        errors.push('contract attestation reviewers must be distinct');
      reviewers.add(review.reviewer);
      if (review.reviewedCommit !== attestation.reviewedCommit) {
        errors.push('contract review does not target the attested commit');
      }
    }
    for (const role of REQUIRED_CONTRACT_REVIEW_ROLES) {
      if (!roles.has(role)) errors.push(`contract attestation is missing passing ${role} review`);
    }
  } else if (attestation.status !== 'pending') {
    errors.push('contract review attestation status is invalid');
  }
  if (progressById.get('V1-000')?.status === 'completed' && attestation.status !== 'pass') {
    errors.push('V1-000 cannot complete before exact-commit independent attestation');
  }

  const criteriaPassing =
    ledger.length === definitionById.size && ledger.every((item) => item.status === 'pass');
  const slicesCompleted =
    slices.length > 0 &&
    slices.every((slice) => progressById.get(slice.id)?.status === 'completed');
  const auditsClean =
    audit1?.status === 'pass' && audit2?.status === 'pass' && remediation?.status === 'pass';
  const complete =
    errors.length === 0 &&
    attestation.status === 'pass' &&
    criteriaPassing &&
    slicesCompleted &&
    auditsClean;

  return {
    errors,
    summary: {
      complete,
      criteria: definitionById.size,
      criteriaPassing: ledger.filter((item) => item.status === 'pass').length,
      slices: slices.length,
      slicesCompleted: slices.filter((slice) => progressById.get(slice.id)?.status === 'completed')
        .length,
      activeSlice: active[0]?.id ?? null,
      blockedCriteria: ledger.filter((item) => item.status.startsWith('blocked_')).length,
      cleanAudits: [audit1, audit2].filter((item) => item?.status === 'pass').length,
    },
  };
}

async function git(root, args, options = {}) {
  return execFileAsync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024, ...options });
}

async function hashPath(root, relativePath) {
  try {
    return sha256(await readFile(resolve(root, relativePath)));
  } catch {
    return null;
  }
}

function collectClaimedPaths(progress, evidence, attestation) {
  const paths = new Set();
  for (const item of evidence.criteria ?? []) {
    for (const record of item.evidence ?? []) {
      if (record.report) paths.add(record.report);
      if (record.artifact) paths.add(record.artifact);
    }
  }
  for (const item of progress.slices ?? []) {
    for (const record of item.evidence ?? []) {
      if (record.report) paths.add(record.report);
      if (record.artifact) paths.add(record.artifact);
    }
    for (const review of item.reviews ?? []) if (review.report) paths.add(review.report);
    if (item.blocker?.proof) paths.add(item.blocker.proof);
  }
  for (const review of attestation.reviews ?? []) if (review.report) paths.add(review.report);
  return paths;
}

function collectClaimedCommits(progress, evidence, attestation) {
  const commits = new Set();
  for (const item of evidence.criteria ?? []) {
    for (const record of item.evidence ?? []) if (record.commit) commits.add(record.commit);
  }
  for (const item of progress.slices ?? []) {
    for (const record of item.evidence ?? []) if (record.commit) commits.add(record.commit);
    for (const review of item.reviews ?? [])
      if (review.reviewedCommit) commits.add(review.reviewedCommit);
  }
  if (attestation.reviewedCommit) commits.add(attestation.reviewedCommit);
  for (const review of attestation.reviews ?? []) {
    if (review.reviewedCommit) commits.add(review.reviewedCommit);
  }
  return commits;
}

export async function loadContract(root) {
  const paths = {
    backlog: 'planning/v1-backlog.json',
    progress: 'planning/v1-progress.json',
    definitions: 'planning/v1-criteria.json',
    evidence: 'planning/v1-evidence.json',
    scopeText: 'docs/V1_SCOPE.md',
    acceptanceText: 'docs/V1_ACCEPTANCE.md',
    lock: 'planning/v1-contract-lock.json',
    attestation: 'planning/v1-review-attestation.json',
  };
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, relativePath]) => [
      key,
      await readFile(resolve(root, relativePath), 'utf8'),
    ]),
  );
  const raw = Object.fromEntries(entries);
  const parsed = {
    backlog: JSON.parse(raw.backlog),
    progress: JSON.parse(raw.progress),
    definitions: JSON.parse(raw.definitions),
    evidence: JSON.parse(raw.evidence),
    scopeText: raw.scopeText,
    acceptanceText: raw.acceptanceText,
    lock: JSON.parse(raw.lock),
    attestation: JSON.parse(raw.attestation),
  };
  const lockedFileHashes = Object.fromEntries(
    await Promise.all(LOCKED_FILES.map(async (file) => [file, await hashPath(root, file)])),
  );
  const claimedPaths = collectClaimedPaths(parsed.progress, parsed.evidence, parsed.attestation);
  const fileHashes = Object.fromEntries(
    await Promise.all([...claimedPaths].map(async (file) => [file, await hashPath(root, file)])),
  );
  const { stdout: commitOutput } = await git(root, ['rev-list', '--all']);
  const commits = commitOutput
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((commit) => commit.toLowerCase());
  const claimedCommits = [
    ...collectClaimedCommits(parsed.progress, parsed.evidence, parsed.attestation),
  ];
  const ancestry = {};
  for (const older of claimedCommits) {
    for (const newer of claimedCommits) {
      if (older === newer || !FULL_COMMIT_PATTERN.test(older) || !FULL_COMMIT_PATTERN.test(newer))
        continue;
      try {
        await git(root, ['merge-base', '--is-ancestor', older, newer]);
        ancestry[`${older}..${newer}`] = true;
      } catch {
        ancestry[`${older}..${newer}`] = false;
      }
    }
  }
  let lockedAtReviewedCommit = null;
  let lockAtReviewedCommit = null;
  if (
    parsed.attestation.status === 'pass' &&
    FULL_COMMIT_PATTERN.test(parsed.attestation.reviewedCommit ?? '')
  ) {
    lockedAtReviewedCommit = {};
    for (const file of LOCKED_FILES) {
      try {
        const { stdout } = await git(
          root,
          ['show', `${parsed.attestation.reviewedCommit}:${file}`],
          { encoding: 'buffer' },
        );
        lockedAtReviewedCommit[file] = sha256(stdout);
      } catch {
        lockedAtReviewedCommit[file] = null;
      }
    }
    try {
      const { stdout } = await git(
        root,
        ['show', `${parsed.attestation.reviewedCommit}:planning/v1-contract-lock.json`],
        { encoding: 'buffer' },
      );
      lockAtReviewedCommit = sha256(stdout);
    } catch {
      lockAtReviewedCommit = null;
    }
  }
  return {
    ...parsed,
    lockedFileHashes,
    repository: {
      commits,
      fileHashes,
      ancestry,
      lockedAtReviewedCommit,
      lockAtReviewedCommit,
      currentLockHash: sha256(raw.lock),
    },
  };
}
