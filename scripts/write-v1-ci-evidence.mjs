import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repository = process.env.GITHUB_REPOSITORY ?? 'Mousewarriors/Orbit';
const runId = process.env.GITHUB_RUN_ID;
const commit = process.env.GITHUB_SHA;

if (!/^[1-9]\d*$/.test(runId ?? '')) {
  throw new Error('GITHUB_RUN_ID is required to write V1 CI evidence');
}
if (!/^[0-9a-f]{40}$/i.test(commit ?? '')) {
  throw new Error('GITHUB_SHA must be a full 40-character commit');
}

const workflowPath = resolve(root, '.github/workflows/ci.yml');
const workflow = readFileSync(workflowPath, 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const requiredWorkflowTokens = [
  ['contract-validation-in-ci', 'npm run v1:validate'],
  ['lint-in-ci', 'npm run lint'],
  ['strict-typecheck-in-ci', 'npm run typecheck --workspaces --if-present'],
  ['js-tests-in-ci', 'npm test'],
  ['windows-renderer-build-in-ci', 'npm run build:vite --workspace @orbit/desktop'],
  [
    'rust-tests-in-ci',
    'cargo test -p orbit-core -p orbit-search -p orbit-window-manager -p orbit-files',
  ],
  ['windows-native-build-in-ci', 'npm run build --workspace @orbit/desktop'],
  ['all-mandatory-jobs-needed', 'needs: [js, rust-libs, windows-desktop]'],
  ['v1-report-written-after-needs', 'node scripts/write-v1-ci-evidence.mjs'],
  ['v1-report-attested-in-ci', 'subject-path: evidence/reports/v1-001/ci-gates.json'],
  [
    'evidence-attestation-in-ci',
    'actions/attest@281a49d4cbb0a72c9575a50d18f6deb515a11deb',
  ],
];

for (const [id, token] of requiredWorkflowTokens) {
  if (!workflow.includes(token)) {
    throw new Error(`CI workflow is missing ${id}: ${token}`);
  }
}

if (!String(packageJson.scripts?.test ?? '').includes('scripts/validate-v1-contract.test.mjs')) {
  throw new Error('npm test must include the v1 contract mutation tests');
}

const commitDate = execFileSync('git', ['show', '-s', '--format=%cI', commit], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const generatedAt = new Date(commitDate).toISOString();
const outputPath = resolve(root, 'evidence/reports/v1-001/ci-gates.json');

const report = {
  schemaVersion: 1,
  kind: 'automated',
  status: 'pass',
  subjectIds: ['V1-REL-001'],
  commit,
  generatedAt,
  producer: `ci:github-actions:${runId}`,
  ci: {
    repository,
    runUrl: `https://github.com/${repository}/actions/runs/${runId}`,
    conclusion: 'success',
    workflow: `${repository}/.github/workflows/ci.yml`,
    commit,
  },
  checks: requiredWorkflowTokens.map(([id, token]) => ({
    id,
    status: 'pass',
    details: { requiredToken: token },
  })),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
