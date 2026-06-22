import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
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
  'docs/V1_EVIDENCE_SCHEMA.md',
  'planning/v1-backlog.json',
  'planning/v1-criteria.json',
  'planning/v1-implementer-authority.json',
  'planning/v1-review-authorities.json',
  'scripts/v1-contract.mjs',
  'scripts/validate-v1-backlog.mjs',
  'scripts/validate-v1-contract.test.mjs',
  'package.json',
  '.github/workflows/ci.yml',
  '.gitattributes',
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
const ALLOWED_REPORT_ROOT = `evidence${sep}reports${sep}`;
const ALLOWED_ARTIFACT_ROOT = `evidence${sep}artifacts${sep}`;
const ALLOWED_BLOCKER_ROOT = `evidence${sep}blockers${sep}`;
const REQUIRED_SECURITY_CHECKS = {
  'V1-CTX-003': ['whole-process-capture', 'non-loopback-egress-zero'],
  'V1-CTX-006': ['renderer-secret-scan', 'log-secret-scan', 'deletion-verification'],
  'V1-TOOLS-003': ['arbitrary-executable', 'inline-script', 'argv-injection', 'working-directory'],
  'V1-TOOLS-004': ['sqlite-scan', 'settings-scan', 'log-scan', 'diagnostics-scan'],
  'V1-TOOLS-005': ['redirect', 'ssrf-private-address', 'dns-rebinding', 'invalid-tls'],
  'V1-TOOLS-006': ['byte-limit', 'time-limit', 'step-limit', 'cost-limit', 'native-cancellation'],
  'V1-APPROVAL-003': ['mutation-matrix', 'atomic-nonce', 'replay', 'toctou', 'timeout-deny'],
  'V1-EXT-001': [
    'install-hook',
    'update-hook',
    'migration',
    'activation',
    'native-helper',
    'persisted-worker',
  ],
  'V1-EXT-002': ['tampered-package', 'traversal', 'symlink', 'junction', 'permission-revoke'],
  'V1-EXT-003': ['disabled-lifecycle', 'uninstall-remnants', 'secret-removal', 'bounded-output'],
  'V1-REL-006': [
    'authenticode-chain',
    'rfc3161',
    'wrong-root',
    'revoked',
    'tamper',
    'replay',
    'downgrade',
  ],
};
const EVIDENCE_ROLES_BY_AREA = {
  governance: ['architecture', 'security'],
  core: ['product'],
  natural_language: ['product'],
  projects: ['product'],
  ai: ['product'],
  privacy: ['security'],
  chat: ['product'],
  missions: ['architecture'],
  tools: ['security'],
  approvals: ['security'],
  extensions: ['security'],
  quality: ['product'],
  release: ['security'],
  documentation: ['product'],
  audit: ['architecture'],
};

function validateSecurityCheck(itemId, check, repository, errors) {
  if (!(REQUIRED_SECURITY_CHECKS[itemId] ?? []).includes(check.id)) return;
  const details = check.details;
  if (!details || typeof details !== 'object') {
    errors.push(`${itemId} check ${check.id} requires structured details`);
    return;
  }
  if (
    !isText(details.target) ||
    !SHA256_PATTERN.test(details.inputSha256 ?? '') ||
    !isText(details.observed)
  ) {
    errors.push(`${itemId} check ${check.id} lacks target/input/observed details`);
  }
  validateFileClaim(
    details.rawEvidencePath,
    details.rawEvidenceSha256,
    repository,
    `${itemId} check ${check.id}`,
    errors,
  );
  if (itemId === 'V1-CTX-003' && check.id === 'whole-process-capture') {
    if (
      !Array.isArray(details.processes) ||
      details.processes.length === 0 ||
      !Number.isInteger(details.durationMs) ||
      details.durationMs <= 0 ||
      !SHA256_PATTERN.test(details.captureSha256 ?? '')
    ) {
      errors.push(`${itemId} whole-process capture details are invalid`);
    }
    return;
  }
  if (itemId === 'V1-CTX-003' && check.id === 'non-loopback-egress-zero') {
    if (details.nonLoopbackRequests !== 0 || !Array.isArray(details.loopbackAllowlist)) {
      errors.push(`${itemId} non-loopback egress details are invalid`);
    }
    return;
  }
  if (itemId === 'V1-APPROVAL-003') {
    if (details.attempted !== true || details.denied !== true || details.nativeSideEffects !== 0) {
      errors.push(`${itemId} approval check ${check.id} did not prove fail-closed behavior`);
    }
    return;
  }
  if (itemId.startsWith('V1-EXT-')) {
    if (
      details.attempted !== true ||
      details.blocked !== true ||
      (check.id === 'disabled-lifecycle' && details.extensionCodeExecuted !== false)
    ) {
      errors.push(`${itemId} extension check ${check.id} has invalid telemetry`);
    }
    return;
  }
  if (itemId === 'V1-REL-006') {
    const expectedAccepted = ['authenticode-chain', 'rfc3161'].includes(check.id);
    if (details.attempted !== true || details.accepted !== expectedAccepted) {
      errors.push(`${itemId} signing check ${check.id} has an invalid outcome`);
    }
    if (
      check.id === 'authenticode-chain' &&
      (!isText(details.publisher) || !isText(details.thumbprint))
    ) {
      errors.push(`${itemId} Authenticode check lacks publisher identity`);
    }
    return;
  }
  if (details.attempted !== true || details.blocked !== true || details.nativeSideEffects !== 0) {
    errors.push(
      `${itemId} security check ${check.id} did not prove a blocked side-effect-free result`,
    );
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value) {
  return isText(value) && !Number.isNaN(Date.parse(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateTimestamp(value, now, label, errors) {
  if (!isTimestamp(value)) {
    errors.push(`${label} requires a valid timestamp`);
    return null;
  }
  const parsed = Date.parse(value);
  if (parsed > now + 5 * 60 * 1000) errors.push(`${label} cannot be future-dated`);
  return parsed;
}

function reviewSignaturePayload(review) {
  return [
    'orbit-v1-review-v1',
    review.reviewer,
    review.role,
    review.result,
    review.reviewedCommit,
    review.reportSha256,
    review.artifactSha256 ?? '-',
    review.reviewedAt,
    String(review.critical),
    String(review.high),
  ].join('\n');
}

function evidenceSignaturePayload(record, subjectId) {
  return [
    'orbit-v1-evidence-v1',
    subjectId,
    record.type,
    record.commit,
    record.reportSha256,
    record.artifactSha256 ?? '-',
    record.manifestSha256 ?? '-',
    record.environment ?? '-',
    record.recordedAt,
  ].join('\n');
}

function enrollmentSignaturePayload(enrollment) {
  return [
    'orbit-v1-review-enrollment-v1',
    enrollment.identity,
    [...enrollment.roles].sort().join(','),
    enrollment.publicKeySpkiBase64,
    enrollment.sha256Fingerprint,
    enrollment.enrolledAt,
  ].join('\n');
}

function blockerSignaturePayload(blocker, sliceId) {
  const { signatures: _signatures, ...unsigned } = blocker;
  return ['orbit-v1-blocker-v1', sliceId, canonicalJson(unsigned)].join('\n');
}

function closureSignaturePayload(closure) {
  return [
    'orbit-v1-finding-closure-v1',
    closure.findingId,
    closure.reviewReportSha256,
    closure.reviewer,
    closure.remediationCommit,
    closure.closedAt,
    closure.evidenceReportSha256,
  ].join('\n');
}

function implementerSignaturePayload(attestation) {
  return [
    'orbit-v1-implementation-v1',
    attestation.identity,
    attestation.commit,
    attestation.signedAt,
  ].join('\n');
}

function verifyAuthoritySignature(authority, payload, signature) {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(authority.publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verifySignature(null, Buffer.from(payload), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
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

function buildAuthorityMap(authorities, enrollments, now, errors) {
  const map = new Map();
  const fingerprints = new Set();
  if (authorities.schemaVersion !== 1 || authorities.algorithm !== 'Ed25519') {
    errors.push('review authority registry has an invalid schema or algorithm');
  }
  for (const authority of authorities.authorities ?? []) {
    if (!REVIEWER_IDENTITY_PATTERN.test(authority.identity ?? '')) {
      errors.push(`invalid review authority identity ${String(authority.identity)}`);
      continue;
    }
    const keyBytes = Buffer.from(authority.publicKeySpkiBase64 ?? '', 'base64');
    let canonicalKey = null;
    try {
      canonicalKey = createPublicKey({ key: keyBytes, format: 'der', type: 'spki' }).export({
        format: 'der',
        type: 'spki',
      });
    } catch {
      errors.push(`${authority.identity} review authority key is invalid`);
    }
    if (!canonicalKey?.equals(keyBytes)) {
      errors.push(`${authority.identity} review authority key is not canonical DER`);
    }
    if (sha256(canonicalKey ?? keyBytes) !== authority.sha256Fingerprint) {
      errors.push(`${authority.identity} review authority fingerprint mismatch`);
    }
    if (fingerprints.has(authority.sha256Fingerprint)) {
      errors.push(`${authority.identity} duplicates an existing review key`);
    }
    fingerprints.add(authority.sha256Fingerprint);
    if (!Array.isArray(authority.roles) || authority.roles.length === 0) {
      errors.push(`${authority.identity} review authority has no roles`);
    }
    if (map.has(authority.identity))
      errors.push(`duplicate review authority ${authority.identity}`);
    map.set(authority.identity, authority);
  }
  if (enrollments.schemaVersion !== 1) errors.push('review enrollment schemaVersion must be 1');
  for (const enrollment of enrollments.enrollments ?? []) {
    if (map.has(enrollment.identity)) {
      errors.push(`review enrollment duplicates authority ${enrollment.identity}`);
      continue;
    }
    validateTimestamp(enrollment.enrolledAt, now, `${enrollment.identity} enrollment`, errors);
    const keyBytes = Buffer.from(enrollment.publicKeySpkiBase64 ?? '', 'base64');
    let canonicalKey = null;
    try {
      canonicalKey = createPublicKey({ key: keyBytes, format: 'der', type: 'spki' }).export({
        format: 'der',
        type: 'spki',
      });
    } catch {
      errors.push(`${enrollment.identity} enrollment key is invalid`);
    }
    if (!canonicalKey?.equals(keyBytes)) {
      errors.push(`${enrollment.identity} enrollment key is not canonical DER`);
    }
    if (sha256(canonicalKey ?? keyBytes) !== enrollment.sha256Fingerprint) {
      errors.push(`${enrollment.identity} enrollment fingerprint mismatch`);
    }
    if (fingerprints.has(enrollment.sha256Fingerprint)) {
      errors.push(`${enrollment.identity} enrollment duplicates an existing review key`);
      continue;
    }
    const validSigners = new Set();
    const payload = enrollmentSignaturePayload(enrollment);
    for (const signature of enrollment.signatures ?? []) {
      const signer = map.get(signature.signer);
      if (
        signer &&
        verifyAuthoritySignature(signer, payload, signature.signature) &&
        signature.signer !== enrollment.identity
      ) {
        validSigners.add(signature.signer);
      }
    }
    if (validSigners.size < authorities.enrollmentQuorum) {
      errors.push(`${enrollment.identity} enrollment lacks authority quorum`);
      continue;
    }
    map.set(enrollment.identity, enrollment);
    fingerprints.add(enrollment.sha256Fingerprint);
  }
  return map;
}

function buildImplementerAttestationMap(authority, attestations, repository, now, errors) {
  const map = new Map();
  if (
    authority.schemaVersion !== 1 ||
    authority.algorithm !== 'Ed25519' ||
    !isText(authority.identity)
  ) {
    errors.push('implementer authority has an invalid schema');
    return map;
  }
  const keyBytes = Buffer.from(authority.publicKeySpkiBase64 ?? '', 'base64');
  let canonicalKey = null;
  try {
    canonicalKey = createPublicKey({ key: keyBytes, format: 'der', type: 'spki' }).export({
      format: 'der',
      type: 'spki',
    });
  } catch {
    errors.push('implementer authority key is invalid');
  }
  if (!canonicalKey?.equals(keyBytes)) {
    errors.push('implementer authority key is not canonical DER');
  }
  if (sha256(canonicalKey ?? keyBytes) !== authority.sha256Fingerprint) {
    errors.push('implementer authority fingerprint mismatch');
  }
  if (attestations.schemaVersion !== 1) {
    errors.push('implementer attestation schemaVersion must be 1');
  }
  for (const attestation of attestations.attestations ?? []) {
    validateCommit(attestation.commit, repository, 'implementer attestation', errors);
    validateTimestamp(
      attestation.signedAt,
      now,
      `${attestation.commit} implementer attestation`,
      errors,
    );
    if (
      attestation.identity !== authority.identity ||
      !verifyAuthoritySignature(
        authority,
        implementerSignaturePayload(attestation),
        attestation.signature ?? '',
      )
    ) {
      errors.push(`${attestation.commit} implementer attestation signature is invalid`);
    }
    if (map.has(attestation.commit)) {
      errors.push(`duplicate implementer attestation for ${attestation.commit}`);
    }
    map.set(attestation.commit, attestation);
  }
  return map;
}

function validateFileClaim(path, digest, repository, label, errors) {
  if (!isText(path) || !SHA256_PATTERN.test(digest ?? '')) {
    errors.push(`${label} requires a path and SHA-256`);
    return;
  }
  const actual = repository.fileHashes[path];
  if (repository.pathSafety[path] !== true) errors.push(`${label} uses an unsafe path: ${path}`);
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

function validateEvidenceRecord(record, item, definition, repository, authorityMap, now, errors) {
  const itemId = item.id;
  if (!EVIDENCE_TYPES.has(record.type)) errors.push(`${itemId} has invalid evidence type`);
  validateCommit(record.commit, repository, `${itemId} evidence`, errors);
  validateTimestamp(record.recordedAt, now, `${itemId} evidence`, errors);
  validateFileClaim(record.report, record.reportSha256, repository, `${itemId} evidence`, errors);
  const report = repository.reports[record.report];
  if (!report || report.schemaVersion !== 1) {
    errors.push(`${itemId} evidence report is not valid schema-version-1 JSON`);
  } else {
    if (report.kind !== record.type || report.status !== 'pass') {
      errors.push(`${itemId} evidence report kind/status mismatch`);
    }
    if (report.commit !== record.commit || report.generatedAt !== record.recordedAt) {
      errors.push(`${itemId} evidence report commit/timestamp mismatch`);
    }
    if (!Array.isArray(report.subjectIds) || !report.subjectIds.includes(itemId)) {
      errors.push(`${itemId} evidence report does not name the criterion`);
    }
    if (
      !Array.isArray(report.checks) ||
      report.checks.length === 0 ||
      report.checks.some((check) => !isText(check.id) || check.status !== 'pass')
    ) {
      errors.push(`${itemId} evidence report requires non-empty passing checks`);
    }
    for (const checkId of REQUIRED_SECURITY_CHECKS[itemId] ?? []) {
      if (!report.checks?.some((check) => check.id === checkId && check.status === 'pass')) {
        errors.push(`${itemId} evidence report is missing required check ${checkId}`);
      }
    }
    for (const check of report.checks ?? []) {
      validateSecurityCheck(itemId, check, repository, errors);
    }
    if (
      record.type === 'automated' &&
      definition.area !== 'governance' &&
      !/^ci:github-actions:[1-9]\d*$/.test(report.producer ?? '')
    ) {
      errors.push(`${itemId} automated report must come from a GitHub Actions run`);
    }
    if (record.type === 'automated' && definition.area !== 'governance') {
      const producerRunId = report.producer?.split(':').at(-1);
      const urlRunId = report.ci?.runUrl?.match(/\/runs\/([1-9]\d*)$/)?.[1];
      if (
        !report.ci ||
        report.ci.repository !== 'Mousewarriors/Orbit' ||
        !/^https:\/\/github\.com\/Mousewarriors\/Orbit\/actions\/runs\/[1-9]\d*$/.test(
          report.ci.runUrl ?? '',
        ) ||
        report.ci.conclusion !== 'success' ||
        producerRunId !== urlRunId ||
        report.ci.workflow !== 'Mousewarriors/Orbit/.github/workflows/ci.yml' ||
        report.ci.commit !== record.commit
      ) {
        errors.push(`${itemId} automated report lacks trusted CI run metadata`);
      }
      if (repository.githubAttestations[record.report] !== true) {
        errors.push(`${itemId} automated report lacks verified GitHub OIDC provenance`);
      }
    }
  }
  const validSigners = new Set();
  const validSignerRoles = new Set();
  const payload = evidenceSignaturePayload(record, itemId);
  for (const signature of record.signatures ?? []) {
    const authority = authorityMap.get(signature.signer);
    if (
      authority &&
      signature.signer !== 'codex:main' &&
      verifyAuthoritySignature(authority, payload, signature.signature)
    ) {
      validSigners.add(signature.signer);
      for (const role of authority.roles ?? []) validSignerRoles.add(role);
    }
  }
  const requiredRoles = EVIDENCE_ROLES_BY_AREA[definition.area] ?? [];
  const requiredSignatures = requiredRoles.length;
  if (validSigners.size < requiredSignatures) {
    errors.push(`${itemId} evidence lacks ${requiredSignatures} trusted reviewer signature(s)`);
  }
  for (const role of requiredRoles) {
    if (!validSignerRoles.has(role)) {
      errors.push(`${itemId} evidence lacks a trusted ${role} signature`);
    }
  }
  if (!validSigners.has(item.verifier)) errors.push(`${itemId} verifier did not sign its evidence`);
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
    const artifact = repository.artifacts[record.artifact];
    if (!artifact?.isWindowsPackage) {
      errors.push(`${itemId} packaged evidence is not a valid Windows .msi/.exe artifact`);
    } else if (
      artifact.manifest?.commit !== record.commit ||
      artifact.manifest?.sha256 !== record.artifactSha256 ||
      artifact.manifest?.environment !== record.environment ||
      artifact.manifestSha256 !== record.manifestSha256 ||
      artifact.containsCommit !== true
    ) {
      errors.push(`${itemId} package build manifest does not match evidence`);
    }
    if (repository.githubAttestations[record.artifact] !== true) {
      errors.push(`${itemId} package lacks source-bound GitHub OIDC provenance`);
    }
    if (
      report?.artifact?.path !== record.artifact ||
      report?.artifact?.sha256 !== record.artifactSha256 ||
      report?.artifact?.commit !== record.commit ||
      report?.artifact?.manifestSha256 !== record.manifestSha256
    ) {
      errors.push(`${itemId} packaged report does not bind the artifact`);
    }
  }
}

function validatePassingEvidence(item, definition, repository, authorityMap, now, errors) {
  if (item.status !== 'pass') return;
  const verifiedAt = validateTimestamp(item.verifiedAt, now, `${item.id} pass`, errors);
  if (!authorityMap.has(item.verifier)) {
    errors.push(`${item.id} pass requires a trusted verifier identity`);
  }
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
    errors.push(`${item.id} pass requires evidence`);
    return;
  }
  item.evidence.forEach((record) =>
    validateEvidenceRecord(record, item, definition, repository, authorityMap, now, errors),
  );
  for (const record of item.evidence) {
    const recordedAt = Date.parse(record.recordedAt);
    const committedAt = repository.commitTimes[record.commit];
    if (!Number.isFinite(committedAt) || recordedAt < committedAt) {
      errors.push(`${item.id} evidence predates its claimed commit`);
    }
    if (verifiedAt !== null && verifiedAt < recordedAt) {
      errors.push(`${item.id} verification predates its evidence`);
    }
  }
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

function validateBlocker(
  slice,
  progress,
  definitions,
  evidenceById,
  repository,
  authorityMap,
  now,
  errors,
) {
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
  const checkedAt = validateTimestamp(
    blocker.lastChecked,
    now,
    `${slice.id} blocker lastChecked`,
    errors,
  );
  if (checkedAt !== null && now - checkedAt > 7 * 24 * 60 * 60 * 1000) {
    errors.push(`${slice.id} blocker proof is older than seven days`);
  }
  for (const field of ['unblockCondition', 'degradedBehavior']) {
    if (!isText(blocker[field])) errors.push(`${slice.id} blocker is missing ${field}`);
  }
  if (!Array.isArray(blocker.attempts) || blocker.attempts.length === 0) {
    errors.push(`${slice.id} blocker requires attempted mitigations`);
  }
  for (const attempt of blocker.attempts ?? []) {
    if (
      validateTimestamp(attempt.at, now, `${slice.id} blocker attempt`, errors) === null ||
      !isText(attempt.action) ||
      !isText(attempt.result)
    ) {
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
    if (
      progress.status === 'blocked_external' &&
      definitions.get(id)?.evidencePolicy !== 'packaged_external'
    ) {
      errors.push(`${slice.id} can externally block only packaged_external criteria`);
    }
  }
  const proof = repository.documents[blocker.proof];
  if (
    !proof ||
    proof.schemaVersion !== 1 ||
    proof.kind !== 'blocker' ||
    proof.status !== progress.status ||
    proof.sliceId !== slice.id ||
    proof.type !== blocker.type ||
    proof.lastChecked !== blocker.lastChecked ||
    JSON.stringify([...(proof.affectedCriterionIds ?? [])].sort()) !== JSON.stringify(actual)
  ) {
    errors.push(`${slice.id} blocker proof content does not match blocker state`);
  }
  const validSigners = new Set();
  const payload = blockerSignaturePayload(blocker, slice.id);
  for (const signature of blocker.signatures ?? []) {
    const authority = authorityMap.get(signature.signer);
    if (authority && verifyAuthoritySignature(authority, payload, signature.signature)) {
      validSigners.add(signature.signer);
    }
  }
  if (validSigners.size === 0) {
    errors.push(`${slice.id} blocker lacks a trusted reviewer signature`);
  }
}

function validateReview(review, slice, implementerIdentity, repository, authorityMap, now, errors) {
  const authority = authorityMap.get(review.reviewer);
  if (!authority) errors.push(`${slice.id} review requires a trusted reviewer`);
  if (review.reviewer === implementerIdentity)
    errors.push(`${slice.id} reviewer cannot be implementer`);
  if (!isText(review.role) || !['pass', 'changes_requested'].includes(review.result)) {
    errors.push(`${slice.id} review has invalid role/result`);
  }
  if (authority && !authority.roles.includes(review.role)) {
    errors.push(`${slice.id} reviewer is not authorized for role ${review.role}`);
  }
  validateCommit(review.reviewedCommit, repository, `${slice.id} review`, errors);
  validateFileClaim(review.report, review.reportSha256, repository, `${slice.id} review`, errors);
  validateTimestamp(review.reviewedAt, now, `${slice.id} review`, errors);
  if (!Number.isInteger(review.critical) || !Number.isInteger(review.high)) {
    errors.push(`${slice.id} review requires integer critical/high counts`);
  }
  if (review.result === 'pass' && (review.critical !== 0 || review.high !== 0)) {
    errors.push(`${slice.id} passing review contains critical/high findings`);
  }
  const report = repository.documents[review.report];
  const findingSchemaValid =
    Array.isArray(report?.findings) &&
    report.findings.every(
      (finding) =>
        isText(finding.id) &&
        isText(finding.title) &&
        ['critical', 'high', 'medium', 'low'].includes(finding.severity) &&
        ['open', 'resolved', 'accepted'].includes(finding.status),
    );
  const unresolved = findingSchemaValid
    ? report.findings.filter((finding) => finding.status === 'open')
    : [];
  const derivedCritical = unresolved.filter((finding) => finding.severity === 'critical').length;
  const derivedHigh = unresolved.filter((finding) => finding.severity === 'high').length;
  if (
    !report ||
    report.schemaVersion !== 1 ||
    report.kind !== 'review' ||
    report.reviewer !== review.reviewer ||
    report.role !== review.role ||
    report.result !== review.result ||
    report.reviewedCommit !== review.reviewedCommit ||
    report.reviewedAt !== review.reviewedAt ||
    report.critical !== review.critical ||
    report.high !== review.high ||
    (review.artifactSha256 ?? null) !== (report.artifactSha256 ?? null) ||
    !findingSchemaValid
  ) {
    errors.push(`${slice.id} review report content does not match the attestation`);
  }
  if (
    review.critical !== derivedCritical ||
    review.high !== derivedHigh ||
    (review.result === 'pass' &&
      unresolved.some((finding) => ['critical', 'high'].includes(finding.severity)))
  ) {
    errors.push(`${slice.id} review counts/result do not match unresolved findings`);
  }
  if (
    !authority ||
    !verifyAuthoritySignature(authority, reviewSignaturePayload(review), review.signature ?? '')
  ) {
    errors.push(`${slice.id} review signature is invalid`);
  }
}

function validateCompletedSlice(
  slice,
  progress,
  definitions,
  evidenceById,
  repository,
  authorityMap,
  implementerMap,
  implementerIdentity,
  now,
  errors,
) {
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
    validateTimestamp(record.occurredAt, now, `${slice.id}.${record.phase}`, errors);
    const report = repository.documents[record.report];
    if (
      !report ||
      report.schemaVersion !== 1 ||
      report.kind !== 'phase' ||
      report.status !== 'pass' ||
      report.sliceId !== slice.id ||
      report.phase !== record.phase ||
      report.commit !== record.commit ||
      report.generatedAt !== record.occurredAt ||
      !Array.isArray(report.checks) ||
      report.checks.length === 0 ||
      report.checks.some((check) => check.status !== 'pass')
    ) {
      errors.push(`${slice.id}.${record.phase} report content is invalid`);
    }
    if (record.phase === 'package' || record.phase === 'live_verify') {
      validateFileClaim(
        record.artifact,
        record.artifactSha256,
        repository,
        `${slice.id}.${record.phase}`,
        errors,
      );
      if (!repository.artifacts[record.artifact]?.isWindowsPackage) {
        errors.push(`${slice.id}.${record.phase} artifact is not a Windows package`);
      }
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
    if (time <= lastTime) errors.push(`${slice.id} phase evidence is out of order at ${phase}`);
    lastTime = time;
  }
  const commitEvidence = phaseEvidence.get('commit');
  if (!implementerMap.has(commitEvidence?.commit)) {
    errors.push(`${slice.id} final commit lacks a valid implementer attestation`);
  }
  const passingReviews = (progress.reviews ?? []).filter((review) => review.result === 'pass');
  if (passingReviews.length === 0) errors.push(`${slice.id} completed without a passing review`);
  progress.reviews?.forEach((review) =>
    validateReview(review, slice, implementerIdentity, repository, authorityMap, now, errors),
  );
  const auditedCriterion = slice.mode === 'audit' ? evidenceById.get(slice.acceptanceIds[0]) : null;
  const reviewedCommit =
    slice.mode === 'audit' ? auditedCriterion?.verifiedBuild?.commit : commitEvidence?.commit;
  for (const review of passingReviews) {
    if (review.reviewedCommit !== reviewedCommit) {
      errors.push(`${slice.id} passing review does not target the required commit`);
    }
    if (
      slice.mode !== 'audit' &&
      Date.parse(review.reviewedAt) < Date.parse(commitEvidence?.occurredAt)
    ) {
      errors.push(`${slice.id} passing review predates the final slice commit`);
    }
  }
  if (slice.mode === 'audit') {
    const roles = new Set(passingReviews.map((review) => review.role));
    for (const role of REQUIRED_AUDIT_ROLES) {
      if (!roles.has(role)) errors.push(`${slice.id} audit is missing passing ${role} review`);
    }
    if (
      new Set(passingReviews.map((review) => authorityMap.get(review.reviewer)?.sha256Fingerprint))
        .size !== passingReviews.length
    ) {
      errors.push(`${slice.id} audit reviewers must be distinct`);
    }
    const findings = new Map();
    for (const review of progress.reviews ?? []) {
      const report = repository.documents[review.report];
      for (const finding of report?.findings ?? []) {
        const key = `${review.reportSha256}:${finding.id}`;
        if (findings.has(key)) errors.push(`${slice.id} contains duplicate finding ${key}`);
        findings.set(key, { finding, review });
      }
    }
    const validClosures = new Set();
    for (const closure of progress.findingClosures ?? []) {
      const key = `${closure.reviewReportSha256}:${closure.findingId}`;
      const source = findings.get(key);
      if (!source) {
        errors.push(`${slice.id} closure references unknown finding ${key}`);
        continue;
      }
      const authority = authorityMap.get(closure.reviewer);
      validateCommit(closure.remediationCommit, repository, `${slice.id} finding closure`, errors);
      validateTimestamp(closure.closedAt, now, `${slice.id} finding closure`, errors);
      validateFileClaim(
        closure.evidenceReport,
        closure.evidenceReportSha256,
        repository,
        `${slice.id} finding closure`,
        errors,
      );
      const closureReport = repository.documents[closure.evidenceReport];
      if (
        closure.reviewer !== source.review.reviewer ||
        !authority ||
        !verifyAuthoritySignature(
          authority,
          closureSignaturePayload(closure),
          closure.signature ?? '',
        ) ||
        !repository.ancestry[`${source.review.reviewedCommit}..${closure.remediationCommit}`] ||
        Date.parse(closure.closedAt) <= Date.parse(source.review.reviewedAt) ||
        closureReport?.schemaVersion !== 1 ||
        closureReport?.kind !== 'finding-closure' ||
        closureReport?.status !== 'pass' ||
        closureReport?.findingId !== closure.findingId ||
        closureReport?.reviewReportSha256 !== closure.reviewReportSha256 ||
        closureReport?.remediationCommit !== closure.remediationCommit ||
        !Array.isArray(closureReport?.checks) ||
        closureReport.checks.length === 0 ||
        closureReport.checks.some((check) => check.status !== 'pass')
      ) {
        errors.push(`${slice.id} finding closure ${key} is invalid`);
      } else {
        validClosures.add(key);
      }
    }
    for (const [key, { finding }] of findings) {
      if (['critical', 'high'].includes(finding.severity) && !validClosures.has(key)) {
        errors.push(`${slice.id} has unresolved ${finding.severity} finding ${key}`);
      }
    }
    const auditCriterion = evidenceById.get(slice.acceptanceIds[0]);
    for (const review of passingReviews) {
      if (
        !SHA256_PATTERN.test(review.artifactSha256 ?? '') ||
        review.artifactSha256 !== auditCriterion?.verifiedBuild?.sha256
      ) {
        errors.push(`${slice.id} audit review is not bound to the audited package`);
      }
    }
  }
  for (const id of slice.acceptanceIds ?? []) {
    const criterion = evidenceById.get(id);
    if (criterion?.status !== 'pass') {
      errors.push(`${slice.id} completed while ${id} is not passing`);
    }
    const criterionCommit =
      slice.mode === 'audit' ? criterion?.verifiedBuild?.commit : commitEvidence?.commit;
    if (!criterion?.evidence?.every((record) => record.commit === criterionCommit)) {
      errors.push(`${slice.id} criterion ${id} is not bound to the required commit`);
    }
  }
  const verifications = new Map(
    (progress.verifications ?? []).map((verification) => [verification.criterionId, verification]),
  );
  if (verifications.size !== (progress.verifications ?? []).length) {
    errors.push(`${slice.id} contains duplicate verification records`);
  }
  for (const id of slice.verifiesAcceptanceIds ?? []) {
    const verification = verifications.get(id);
    if (!verification) {
      errors.push(`${slice.id} is missing release-independent verification for ${id}`);
      continue;
    }
    const verificationItem = {
      id,
      status: 'pass',
      verifiedBuild: verification.verifiedBuild ?? null,
      evidence: verification.evidence,
      verifiedAt: verification.verifiedAt,
      verifier: verification.verifier,
    };
    validatePassingEvidence(
      verificationItem,
      definitions.get(id),
      repository,
      authorityMap,
      now,
      errors,
    );
    if (!verification.evidence?.every((record) => record.commit === commitEvidence?.commit)) {
      errors.push(`${slice.id} verification for ${id} is not bound to the final slice commit`);
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
    authorities,
    enrollments,
    implementerAuthority,
    implementerAttestations,
    releaseEvidence,
    lockedFileHashes,
    repository,
    now = Date.now(),
  } = state;
  const errors = [];

  scanForbiddenKeys(backlog, 'backlog', errors);
  scanForbiddenKeys(progress, 'progress', errors);
  scanForbiddenKeys(evidence, 'evidence', errors);
  const authorityMap = buildAuthorityMap(authorities, enrollments, now, errors);
  const implementerMap = buildImplementerAttestationMap(
    implementerAuthority,
    implementerAttestations,
    repository,
    now,
    errors,
  );
  for (const authority of authorityMap.values()) {
    if (authority.sha256Fingerprint === implementerAuthority.sha256Fingerprint) {
      errors.push(`${authority.identity} reviewer key duplicates the implementer key`);
    }
  }
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
    authorities.contractVersion,
    enrollments.contractVersion,
    implementerAuthority.contractVersion,
    implementerAttestations.contractVersion,
    releaseEvidence.contractVersion,
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
    validatePassingEvidence(
      item,
      definitionById.get(item.id) ?? {},
      repository,
      authorityMap,
      now,
      errors,
    );
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
    validateBlocker(
      slice,
      item,
      definitionById,
      evidenceById,
      repository,
      authorityMap,
      now,
      errors,
    );
    validateCompletedSlice(
      slice,
      item,
      definitionById,
      evidenceById,
      repository,
      authorityMap,
      implementerMap,
      backlog.implementerIdentity,
      now,
      errors,
    );
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
    if (slice.id === 'V1-000' && (slice.dependsOn ?? []).length !== 0) {
      errors.push('V1-000 must be the unique dependency root');
    }
    if (slice.id !== 'V1-000' && (slice.dependsOn ?? []).length === 0) {
      errors.push(`${slice.id} is disconnected from V1-000`);
    }
    for (const dependency of slice.dependsOn ?? []) {
      const target = sliceById.get(dependency);
      if (!target) errors.push(`${slice.id} depends on missing ${dependency}`);
      else {
        if (target.order >= slice.order)
          errors.push(`${slice.id} dependency ${dependency} is not earlier`);
        if (item?.status !== 'pending' && progressById.get(dependency)?.status !== 'completed') {
          errors.push(`${slice.id} started before dependency ${dependency} completed`);
        }
        if (item?.status === 'completed') {
          const dependencyCommit = (progressById.get(dependency)?.evidence ?? []).find(
            (record) => record.phase === 'commit',
          );
          const sliceCommit = (item.evidence ?? []).find((record) => record.phase === 'commit');
          const firstPhase = (REQUIRED_PHASES[slice.mode] ?? [])
            .map((phase) => (item.evidence ?? []).find((record) => record.phase === phase))
            .find(Boolean);
          if (
            !repository.ancestry[`${dependencyCommit?.commit ?? ''}..${sliceCommit?.commit ?? ''}`]
          ) {
            errors.push(`${slice.id} final commit is not a descendant of ${dependency}`);
          }
          if (Date.parse(firstPhase?.occurredAt) <= Date.parse(dependencyCommit?.occurredAt)) {
            errors.push(`${slice.id} phase chronology overlaps dependency ${dependency}`);
          }
        }
      }
    }
  }
  const reachesRoot = (id, seen = new Set()) => {
    if (id === 'V1-000') return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (sliceById.get(id)?.dependsOn ?? []).some((dependency) =>
      reachesRoot(dependency, new Set(seen)),
    );
  };
  for (const slice of slices) {
    if (!reachesRoot(slice.id)) errors.push(`${slice.id} is not reachable from V1-000`);
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
    if (!repository.ancestry[`${commits[0]}..${commits[1]}`] || commits[2] !== commits[1]) {
      errors.push('audit 1 must precede remediation and audit 2 must target remediation');
    }
    const hashes = [
      audit1?.verifiedBuild?.sha256,
      remediation?.verifiedBuild?.sha256,
      audit2?.verifiedBuild?.sha256,
    ];
    if (hashes[0] === hashes[1] || hashes[2] !== hashes[1]) {
      errors.push('audit 1 must differ from, and audit 2 must equal, the final package');
    }
    const panel1 = new Set(
      (progressById.get('V1-014')?.reviews ?? [])
        .filter((review) => review.result === 'pass')
        .map((review) => authorityMap.get(review.reviewer)?.sha256Fingerprint),
    );
    const panel2 = (progressById.get('V1-016')?.reviews ?? [])
      .filter((review) => review.result === 'pass')
      .map((review) => authorityMap.get(review.reviewer)?.sha256Fingerprint);
    if (panel2.some((fingerprint) => panel1.has(fingerprint))) {
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
    if (backlog.implementerIdentity !== implementerAuthority.identity) {
      errors.push('backlog implementer identity differs from the signed implementer authority');
    }
    if (!implementerMap.has(attestation.reviewedCommit)) {
      errors.push('contract reviewed commit lacks a valid implementer attestation');
    }
    if (repository.lockAtReviewedCommit !== repository.currentLockHash) {
      errors.push('contract lock differs from the independently reviewed commit');
    }
    for (const file of LOCKED_FILES) {
      if (repository.lockedAtReviewedCommit?.[file] !== lockedFileHashes[file]) {
        errors.push(`locked file changed after independent review: ${file}`);
      }
    }
    const roles = new Set();
    const reviewerFingerprints = new Set();
    for (const review of attestation.reviews ?? []) {
      validateReview(
        review,
        { id: 'contract-attestation' },
        backlog.implementerIdentity,
        repository,
        authorityMap,
        now,
        errors,
      );
      if (review.result === 'pass') roles.add(review.role);
      const fingerprint = authorityMap.get(review.reviewer)?.sha256Fingerprint;
      if (reviewerFingerprints.has(fingerprint))
        errors.push('contract attestation reviewers must be distinct');
      reviewerFingerprints.add(fingerprint);
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
  if (progressById.get('V1-000')?.status === 'completed') {
    const rootCommit = (progressById.get('V1-000')?.evidence ?? []).find(
      (record) => record.phase === 'commit',
    )?.commit;
    if (
      rootCommit !== attestation.reviewedCommit &&
      !repository.ancestry[`${attestation.reviewedCommit}..${rootCommit}`]
    ) {
      errors.push('V1-000 final commit is not descended from the reviewed contract commit');
    }
  }

  if (releaseEvidence.schemaVersion !== 1) {
    errors.push('release evidence schemaVersion must be 1');
  }
  const releaseAnchor = releaseEvidence.anchor;
  const requiredReleaseIds = [...definitionById]
    .filter(([, definition]) => !['governance', 'audit'].includes(definition.area))
    .map(([id]) => id);
  const releaseById = new Map();
  for (const item of releaseEvidence.criteria ?? []) {
    if (releaseById.has(item.id)) errors.push(`duplicate final release evidence ${item.id}`);
    releaseById.set(item.id, item);
    if (!requiredReleaseIds.includes(item.id)) {
      errors.push(`final release evidence contains non-release criterion ${item.id}`);
      continue;
    }
    validatePassingEvidence(
      item,
      definitionById.get(item.id),
      repository,
      authorityMap,
      now,
      errors,
    );
  }
  if (releaseAnchor === null && releaseById.size !== 0) {
    errors.push('final release evidence cannot exist before the release anchor');
  }
  if (releaseAnchor !== null) {
    validateCommit(releaseAnchor.commit, repository, 'release anchor', errors);
    validateFileClaim(
      releaseAnchor.artifact,
      releaseAnchor.sha256,
      repository,
      'release anchor',
      errors,
    );
    if (!repository.artifacts[releaseAnchor.artifact]?.isWindowsPackage) {
      errors.push('release anchor is not a valid Windows package');
    }
    const remediationCommit = (progressById.get('V1-015')?.evidence ?? []).find(
      (record) => record.phase === 'commit',
    );
    const remediationPackage = (progressById.get('V1-015')?.evidence ?? []).find(
      (record) => record.phase === 'package',
    );
    const remediationLive = (progressById.get('V1-015')?.evidence ?? []).find(
      (record) => record.phase === 'live_verify',
    );
    if (
      progressById.get('V1-015')?.status !== 'completed' ||
      remediationCommit?.commit !== releaseAnchor.commit ||
      remediationPackage?.artifact !== releaseAnchor.artifact ||
      remediationPackage?.artifactSha256 !== releaseAnchor.sha256 ||
      remediationLive?.artifact !== releaseAnchor.artifact ||
      remediationLive?.artifactSha256 !== releaseAnchor.sha256 ||
      remediation?.verifiedBuild?.artifact !== releaseAnchor.artifact ||
      remediation?.verifiedBuild?.sha256 !== releaseAnchor.sha256 ||
      remediation?.verifiedBuild?.commit !== releaseAnchor.commit
    ) {
      errors.push('release anchor must exactly match the completed V1-015 rebuild evidence');
    }
    for (const id of requiredReleaseIds) {
      const definition = definitionById.get(id);
      const item = releaseById.get(id);
      if (
        item?.status !== 'pass' ||
        !item.evidence?.every((record) => record.commit === releaseAnchor.commit)
      ) {
        errors.push(`${id} is not fresh on the final release commit`);
      }
      if (
        definition.evidencePolicy.includes('packaged') &&
        item?.verifiedBuild?.sha256 !== releaseAnchor.sha256
      ) {
        errors.push(`${id} is not verified against the final release package`);
      }
    }
    const releaseTimes = [...releaseById.values()].flatMap((item) => [
      Date.parse(item.verifiedAt),
      ...(item.evidence ?? []).map((record) => Date.parse(record.recordedAt)),
    ]);
    const latestReleaseTime = Math.max(...releaseTimes);
    if (
      audit2?.status === 'pass' &&
      (Date.parse(audit2.verifiedAt) <= latestReleaseTime ||
        (progressById.get('V1-016')?.reviews ?? [])
          .filter((review) => review.result === 'pass')
          .some((review) => Date.parse(review.reviewedAt) <= latestReleaseTime))
    ) {
      errors.push('audit pass 2 must occur after every final release verification');
    }
    if (audit1?.status === 'pass' && audit1.verifiedBuild?.sha256 === releaseAnchor.sha256) {
      errors.push('audit pass 1 must precede and differ from the final release package');
    }
    if (
      audit2?.status === 'pass' &&
      (audit2.verifiedBuild?.sha256 !== releaseAnchor.sha256 ||
        audit2.verifiedBuild?.commit !== releaseAnchor.commit ||
        audit2.verifiedBuild?.artifact !== releaseAnchor.artifact)
    ) {
      errors.push('audit pass 2 must review the exact final release anchor');
    }
  }
  if (audit2?.status === 'pass' && releaseAnchor === null) {
    errors.push('audit pass 2 requires a final release anchor');
  }

  const criteriaPassing =
    ledger.length === definitionById.size && ledger.every((item) => item.status === 'pass');
  const releaseCriteriaPassing =
    releaseAnchor !== null &&
    requiredReleaseIds.every((id) => releaseById.get(id)?.status === 'pass');
  const slicesCompleted =
    slices.length > 0 &&
    slices.every((slice) => progressById.get(slice.id)?.status === 'completed');
  const auditsClean =
    audit1?.status === 'pass' && audit2?.status === 'pass' && remediation?.status === 'pass';
  const complete =
    errors.length === 0 &&
    attestation.status === 'pass' &&
    releaseAnchor !== null &&
    criteriaPassing &&
    releaseCriteriaPassing &&
    slicesCompleted &&
    auditsClean;

  return {
    errors,
    summary: {
      complete,
      criteria: definitionById.size,
      criteriaPassing: ledger.filter((item) => item.status === 'pass').length,
      releaseCriteria: requiredReleaseIds.length,
      releaseCriteriaPassing: [...releaseById.values()].filter((item) => item.status === 'pass')
        .length,
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

async function hashLockedPath(root, relativePath) {
  try {
    const text = await readFile(resolve(root, relativePath), 'utf8');
    return sha256(text.replace(/\r\n/g, '\n'));
  } catch {
    return null;
  }
}

function normalizeEvidencePath(relativePath) {
  if (!isText(relativePath) || isAbsolute(relativePath)) return null;
  const normalized = relativePath.replace(/[\\/]+/g, sep);
  if (normalized.split(sep).includes('..')) return null;
  if (
    !normalized.startsWith(ALLOWED_REPORT_ROOT) &&
    !normalized.startsWith(ALLOWED_ARTIFACT_ROOT) &&
    !normalized.startsWith(ALLOWED_BLOCKER_ROOT)
  ) {
    return null;
  }
  return normalized;
}

async function inspectClaimedPath(root, claimedPath) {
  const normalized = normalizeEvidencePath(claimedPath);
  if (!normalized) return { safe: false, hash: null, document: null, artifact: null };
  const absoluteRoot = await realpath(root);
  const absolute = resolve(root, normalized);
  const relativeToRoot = relative(absoluteRoot, absolute);
  if (relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
    return { safe: false, hash: null, document: null, artifact: null };
  }
  try {
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) {
      return { safe: false, hash: null, document: null, artifact: null };
    }
    const actual = await realpath(absolute);
    const actualRelative = relative(absoluteRoot, actual);
    if (actualRelative.startsWith('..') || isAbsolute(actualRelative)) {
      return { safe: false, hash: null, document: null, artifact: null };
    }
    const bytes = await readFile(actual);
    let document = null;
    if (
      normalized.startsWith(ALLOWED_REPORT_ROOT) ||
      normalized.startsWith(ALLOWED_BLOCKER_ROOT) ||
      extname(normalized).toLowerCase() === '.json'
    ) {
      try {
        document = JSON.parse(bytes.toString('utf8'));
      } catch {
        document = null;
      }
    }
    let artifact = null;
    if (normalized.startsWith(ALLOWED_ARTIFACT_ROOT)) {
      const extension = extname(normalized).toLowerCase();
      let isExe = false;
      if (
        extension === '.exe' &&
        bytes.length >= 65_536 &&
        bytes[0] === 0x4d &&
        bytes[1] === 0x5a
      ) {
        const peOffset = bytes.readUInt32LE(0x3c);
        if (peOffset >= 0x40 && peOffset + 26 < bytes.length) {
          const machine = bytes.readUInt16LE(peOffset + 4);
          const sections = bytes.readUInt16LE(peOffset + 6);
          const optionalHeaderSize = bytes.readUInt16LE(peOffset + 20);
          const optionalMagic = bytes.readUInt16LE(peOffset + 24);
          const sectionTable = peOffset + 24 + optionalHeaderSize;
          const entryRva = bytes.readUInt32LE(peOffset + 24 + 16);
          let sectionLayoutValid =
            sections >= 2 &&
            sections <= 96 &&
            optionalHeaderSize >= 0x60 &&
            sectionTable + sections * 40 <= bytes.length;
          let entryMapped = false;
          for (let index = 0; sectionLayoutValid && index < sections; index += 1) {
            const offset = sectionTable + index * 40;
            const virtualSize = bytes.readUInt32LE(offset + 8);
            const virtualAddress = bytes.readUInt32LE(offset + 12);
            const rawSize = bytes.readUInt32LE(offset + 16);
            const rawPointer = bytes.readUInt32LE(offset + 20);
            if (rawSize > 0 && (rawPointer < 512 || rawPointer + rawSize > bytes.length)) {
              sectionLayoutValid = false;
            }
            if (
              entryRva >= virtualAddress &&
              entryRva < virtualAddress + Math.max(virtualSize, rawSize)
            ) {
              entryMapped = true;
            }
          }
          isExe =
            bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from('PE\0\0')) &&
            [0x14c, 0x8664, 0xaa64].includes(machine) &&
            [0x10b, 0x20b].includes(optionalMagic) &&
            sectionLayoutValid &&
            entryMapped;
        }
      }
      const msiMagic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      const sectorShift = bytes.length >= 34 ? bytes.readUInt16LE(0x1e) : 0;
      const sectorSize = 2 ** sectorShift;
      const fatSectors = bytes.length >= 48 ? bytes.readUInt32LE(0x2c) : 0;
      const firstDirectorySector = bytes.length >= 52 ? bytes.readUInt32LE(0x30) : 0xffffffff;
      const firstFatSector = bytes.length >= 80 ? bytes.readUInt32LE(0x4c) : 0xffffffff;
      const sectorCount = sectorSize > 0 ? bytes.length / sectorSize - 1 : 0;
      const isMsi =
        extension === '.msi' &&
        bytes.length >= 4096 &&
        bytes.subarray(0, 8).equals(msiMagic) &&
        bytes.readUInt16LE(0x1c) === 0xfffe &&
        [9, 12].includes(sectorShift) &&
        bytes.readUInt16LE(0x20) === 6 &&
        bytes.length % sectorSize === 0 &&
        fatSectors > 0 &&
        fatSectors < sectorCount &&
        firstDirectorySector < sectorCount &&
        firstFatSector < sectorCount;
      let manifest = null;
      let manifestSha256 = null;
      const manifestPath = `${absolute}.manifest.json`;
      try {
        const manifestInfo = await lstat(manifestPath);
        if (manifestInfo.isFile() && !manifestInfo.isSymbolicLink()) {
          const manifestBytes = await readFile(manifestPath);
          manifestSha256 = sha256(manifestBytes);
          manifest = JSON.parse(manifestBytes.toString('utf8'));
        }
      } catch {
        manifest = null;
      }
      artifact = {
        isWindowsPackage: isExe || isMsi,
        manifest:
          manifest?.schemaVersion === 1 &&
          ['exe', 'msi'].includes(manifest.packageType) &&
          manifest.packageType === extension.slice(1)
            ? manifest
            : null,
        manifestSha256,
        containsCommit:
          isText(manifest?.commit) &&
          isText(manifest?.version) &&
          bytes.includes(Buffer.from(manifest.commit)) &&
          bytes.includes(Buffer.from(manifest.version)),
      };
    }
    return { safe: true, hash: sha256(bytes), document, artifact };
  } catch {
    return { safe: true, hash: null, document: null, artifact: null };
  }
}

function collectClaimedPaths(progress, evidence, attestation, releaseEvidence) {
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
    for (const closure of item.findingClosures ?? []) {
      if (closure.evidenceReport) paths.add(closure.evidenceReport);
    }
    for (const verification of item.verifications ?? []) {
      for (const record of verification.evidence ?? []) {
        if (record.report) paths.add(record.report);
        if (record.artifact) paths.add(record.artifact);
      }
    }
    if (item.blocker?.proof) paths.add(item.blocker.proof);
  }
  for (const review of attestation.reviews ?? []) if (review.report) paths.add(review.report);
  for (const item of releaseEvidence.criteria ?? []) {
    for (const record of item.evidence ?? []) {
      if (record.report) paths.add(record.report);
      if (record.artifact) paths.add(record.artifact);
    }
  }
  if (releaseEvidence.anchor?.artifact) paths.add(releaseEvidence.anchor.artifact);
  return paths;
}

function collectClaimedCommits(progress, evidence, attestation, releaseEvidence) {
  const commits = new Set();
  for (const item of evidence.criteria ?? []) {
    for (const record of item.evidence ?? []) if (record.commit) commits.add(record.commit);
  }
  for (const item of progress.slices ?? []) {
    for (const record of item.evidence ?? []) if (record.commit) commits.add(record.commit);
    for (const review of item.reviews ?? [])
      if (review.reviewedCommit) commits.add(review.reviewedCommit);
    for (const closure of item.findingClosures ?? []) {
      if (closure.remediationCommit) commits.add(closure.remediationCommit);
    }
    for (const verification of item.verifications ?? []) {
      for (const record of verification.evidence ?? [])
        if (record.commit) commits.add(record.commit);
    }
  }
  if (attestation.reviewedCommit) commits.add(attestation.reviewedCommit);
  if (releaseEvidence.anchor?.commit) commits.add(releaseEvidence.anchor.commit);
  for (const item of releaseEvidence.criteria ?? []) {
    for (const record of item.evidence ?? []) if (record.commit) commits.add(record.commit);
  }
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
    authorities: 'planning/v1-review-authorities.json',
    enrollments: 'planning/v1-review-enrollments.json',
    implementerAuthority: 'planning/v1-implementer-authority.json',
    implementerAttestations: 'planning/v1-implementer-attestations.json',
    releaseEvidence: 'planning/v1-release-evidence.json',
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
    authorities: JSON.parse(raw.authorities),
    enrollments: JSON.parse(raw.enrollments),
    implementerAuthority: JSON.parse(raw.implementerAuthority),
    implementerAttestations: JSON.parse(raw.implementerAttestations),
    releaseEvidence: JSON.parse(raw.releaseEvidence),
  };
  const lockedFileHashes = Object.fromEntries(
    await Promise.all(LOCKED_FILES.map(async (file) => [file, await hashLockedPath(root, file)])),
  );
  const claimedPaths = collectClaimedPaths(
    parsed.progress,
    parsed.evidence,
    parsed.attestation,
    parsed.releaseEvidence,
  );
  let inspectedEntries = await Promise.all(
    [...claimedPaths].map(async (file) => [file, await inspectClaimedPath(root, file)]),
  );
  const rawEvidencePaths = new Set();
  for (const [, result] of inspectedEntries) {
    for (const check of result.document?.checks ?? []) {
      if (check.details?.rawEvidencePath) rawEvidencePaths.add(check.details.rawEvidencePath);
    }
  }
  const newRawPaths = [...rawEvidencePaths].filter((file) => !claimedPaths.has(file));
  if (newRawPaths.length > 0) {
    inspectedEntries = [
      ...inspectedEntries,
      ...(await Promise.all(
        newRawPaths.map(async (file) => [file, await inspectClaimedPath(root, file)]),
      )),
    ];
  }
  const fileHashes = Object.fromEntries(
    inspectedEntries.map(([file, result]) => [file, result.hash]),
  );
  const pathSafety = Object.fromEntries(
    inspectedEntries.map(([file, result]) => [file, result.safe]),
  );
  const documents = Object.fromEntries(
    inspectedEntries.map(([file, result]) => [file, result.document]),
  );
  const artifacts = Object.fromEntries(
    inspectedEntries.map(([file, result]) => [file, result.artifact]),
  );
  const githubAttestations = {};
  for (const [file, result] of inspectedEntries) {
    const sourceCommit =
      result.document?.kind === 'automated'
        ? result.document.commit
        : result.artifact?.manifest?.commit;
    if (
      (result.document?.kind === 'automated' &&
        /^ci:github-actions:[1-9]\d*$/.test(result.document.producer ?? '')) ||
      result.artifact?.isWindowsPackage
    ) {
      try {
        await execFileAsync(
          'gh',
          [
            'attestation',
            'verify',
            resolve(root, file),
            '--repo',
            'Mousewarriors/Orbit',
            '--signer-workflow',
            'Mousewarriors/Orbit/.github/workflows/ci.yml',
            '--source-digest',
            sourceCommit,
            '--deny-self-hosted-runners',
          ],
          { cwd: root, maxBuffer: 16 * 1024 * 1024 },
        );
        githubAttestations[file] = true;
      } catch {
        githubAttestations[file] = false;
      }
    }
  }
  const { stdout: commitOutput } = await git(root, ['log', '--all', '--format=%H|%cI']);
  const commitRows = commitOutput.trim().split(/\r?\n/).filter(Boolean);
  const commits = commitRows.map((row) => row.split('|', 1)[0].toLowerCase());
  const commitTimes = Object.fromEntries(
    commitRows.map((row) => {
      const separator = row.indexOf('|');
      return [row.slice(0, separator).toLowerCase(), Date.parse(row.slice(separator + 1))];
    }),
  );
  const claimedCommits = [
    ...collectClaimedCommits(
      parsed.progress,
      parsed.evidence,
      parsed.attestation,
      parsed.releaseEvidence,
    ),
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
        lockedAtReviewedCommit[file] = sha256(stdout.toString('utf8').replace(/\r\n/g, '\n'));
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
      lockAtReviewedCommit = sha256(stdout.toString('utf8').replace(/\r\n/g, '\n'));
    } catch {
      lockAtReviewedCommit = null;
    }
  }
  return {
    ...parsed,
    lockedFileHashes,
    repository: {
      commits,
      commitTimes,
      fileHashes,
      pathSafety,
      reports: documents,
      documents,
      artifacts,
      githubAttestations,
      ancestry,
      lockedAtReviewedCommit,
      lockAtReviewedCommit,
      currentLockHash: sha256(raw.lock.replace(/\r\n/g, '\n')),
    },
  };
}
