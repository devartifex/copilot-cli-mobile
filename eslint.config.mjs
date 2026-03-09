// @ts-check
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

/** @type {import('@typescript-eslint/eslint-plugin').RuleMetaData} */
const namingConventionBase = [
  'warn',
  {
    selector: 'variable',
    format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
    leadingUnderscore: 'allowDouble',
  },
  {
    selector: 'parameter',
    format: ['camelCase'],
    leadingUnderscore: 'allow',
  },
  {
    selector: 'function',
    format: ['camelCase'],
    leadingUnderscore: 'allow',
  },
  {
    selector: 'typeLike',
    format: ['PascalCase'],
  },
];

export default [
  js.configs.recommended,
  // Server-side TypeScript (Node.js environment)
  {
    files: [
      'src/*.ts',
      'src/auth/**/*.ts',
      'src/routes/**/*.ts',
      'src/copilot/**/*.ts',
      'src/ws/**/*.ts',
      'src/types/**/*.ts',
      'src/security-log.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json'],
      },
      globals: {
        ...globals.node,
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/naming-convention': namingConventionBase,
      'eqeqeq': ['warn', 'always', { null: 'ignore' }],
    },
  },
  // Client-side TypeScript (browser environment)
  {
    files: ['src/client/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.client.json'],
      },
      globals: {
        ...globals.browser,
        // CDN globals (marked, DOMPurify, hljs declared in globals.d.ts)
        marked: 'readonly',
        DOMPurify: 'readonly',
        hljs: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/naming-convention': namingConventionBase,
      'eqeqeq': ['warn', 'always', { null: 'ignore' }],
    },
  },
  {
    // Ignore generated files
    ignores: ['dist/**', 'node_modules/**', 'public/js/bundle.js'],
  },
];
