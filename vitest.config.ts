import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Desktop .tsx modules rely on the automatic JSX runtime (they don't import
  // React directly), so transform JSX with it when those files are pulled into
  // a test (e.g. the Settings render smoke test).
  esbuild: { jsx: 'automatic' },
  test: {
    globals: false,
    environment: 'node',
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
