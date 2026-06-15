import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Desktop .tsx modules rely on the automatic JSX runtime (they don't import
  // React directly), so transform JSX with it when those files are pulled into
  // a test (e.g. the Settings render smoke test).
  esbuild: { jsx: 'automatic' },
  test: {
    globals: false,
    environment: 'node',
    // The extension-CLI e2e compiles @orbit/api and spawns Node per template, so
    // give tests headroom beyond the 5s default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Builds @orbit/api to JS once before collection (the CLI + generated
    // extensions resolve it as built JS). See vitest.globalSetup.ts.
    globalSetup: ['./vitest.globalSetup.ts'],
    include: [
      'packages/**/src/**/*.{test,spec}.ts',
      'apps/desktop/src/**/*.{test,spec}.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**/*.ts'],
      exclude: ['packages/**/src/**/*.{test,spec}.ts', 'packages/**/src/**/index.ts'],
    },
  },
});
