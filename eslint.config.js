// MIT License © 2026 Binary Dice Games
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Files copied from nymph keep their upstream style; they are covered by tests.
  {
    ignores: [
      'node_modules/',
      'build/',
      'dist/',
      'viewer/dist/',
      'site/',
      'site-archive/',
      'release/',
      'spikes/',
      'support-app/dist/',
      'support-app/release/',
      'packages/collab-session/collab-session.js',
      'packages/collab-whiteboard/collab-whiteboard.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    files: ['viewer/src/site/*.js'],
    languageOptions: { globals: { document: 'readonly', location: 'readonly' } },
  },
  {
    files: ['scripts/**/*.mjs', 'support-app/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
