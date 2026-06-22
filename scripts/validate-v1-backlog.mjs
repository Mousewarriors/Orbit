import { resolve } from 'node:path';
import { loadContract, validateContract } from './v1-contract.mjs';

const state = await loadContract(resolve(import.meta.dirname, '..'));
const result = validateContract(state);

if (result.errors.length > 0) {
  process.stderr.write(
    `Invalid Orbit v1 contract (${result.errors.length} issue${result.errors.length === 1 ? '' : 's'}):\n`,
  );
  for (const error of result.errors) process.stderr.write(`- ${error}\n`);
  process.exit(1);
}

process.stdout.write(`Orbit v1 contract valid: ${JSON.stringify(result.summary)}\n`);
