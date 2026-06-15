import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build `@orbit/api` to JS before the suite runs.
 *
 * The extension-CLI e2e test imports the CLI (which imports `@orbit/api`) and
 * spawns generated extensions under plain Node — both need the SDK as built JS
 * (`dist/index.js`), and module resolution happens at collection time, before any
 * per-test hook. Orbit otherwise consumes TS source directly, so nothing else
 * builds this package; we do it here, once, and idempotently.
 */
export default function setup(): void {
  const root = dirname(fileURLToPath(import.meta.url));
  const apiDir = join(root, 'packages', 'api');
  if (existsSync(join(apiDir, 'dist', 'index.js'))) return;
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '-p', join(apiDir, 'tsconfig.build.json')], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to build @orbit/api for tests:\n${result.stdout}\n${result.stderr}`);
  }
}
