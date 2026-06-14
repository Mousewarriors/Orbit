// Flat ESLint config for the Orbit monorepo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/target/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Node-targeted scripts and build configs run outside the DOM.
    files: ['scripts/**/*.{js,mjs,ts}', '**/*.config.{js,ts}'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // Extensions + SDK are Node child-process modules (one-shot stdin/stdout).
    files: ['extensions/**/*.{js,mjs}', 'packages/extension-sdk/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        crypto: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        globalThis: 'readonly',
      },
    },
  },
);
