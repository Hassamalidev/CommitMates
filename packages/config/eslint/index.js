import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { TEST_FILE_GLOBS, restrictedImportBlocks, restrictedPathZones } from './boundaries.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const TS_FILES = ['**/*.ts', '**/*.tsx'];
const REACT_FILES = ['packages/ui/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'];

export default tseslint.config(
  {
    name: 'commitmates/ignores',
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      'supabase/**',
      '**/__snapshots__/**',
    ],
  },
  js.configs.recommended,
  {
    name: 'commitmates/base',
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: [`${repoRoot}/packages/*/tsconfig.json`, `${repoRoot}/apps/*/tsconfig.json`],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: {
      'import-x/no-restricted-paths': ['error', { basePath: repoRoot, zones: restrictedPathZones() }],
      'import-x/no-default-export': 'error',
      'import-x/no-duplicates': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    name: 'commitmates/typescript',
    files: TS_FILES,
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: repoRoot },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
  },
  {
    name: 'commitmates/react',
    files: REACT_FILES,
    extends: [
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    settings: { react: { version: '19' } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react/prop-types': 'off',
    },
  },
  {
    name: 'commitmates/tests',
    files: TEST_FILE_GLOBS,
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // Frameworks and tools require default exports in these files (CLAUDE.md §10.1).
    name: 'commitmates/default-export-allowed',
    files: [
      '**/*.config.{js,ts,mjs,mts}',
      'packages/config/**',
      'apps/web/src/app/**/{page,layout,loading,error,global-error,not-found,template,default,route,sitemap,robots,manifest,opengraph-image,icon}.{ts,tsx}',
      'apps/web/middleware.ts',
      'apps/web/src/middleware.ts',
      'apps/web/src/proxy.ts',
    ],
    rules: { 'import-x/no-default-export': 'off' },
  },
  {
    name: 'commitmates/scripts',
    files: ['scripts/**', 'apps/worker/src/main.ts'],
    rules: { 'no-console': 'off', 'import-x/no-default-export': 'off' },
  },
  ...restrictedImportBlocks(),
  prettier,
);
