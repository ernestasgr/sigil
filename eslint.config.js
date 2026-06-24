import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/out/**',
            '**/node_modules/**',
            '**/release/**',
            '**/coverage/**',
            '**/.turbo/**',
            '**/*.d.ts',
            '.sandcastle/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.strict,
    {
        files: ['**/*.{ts,tsx,js,mjs,cjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
    },
    {
        files: [
            'apps/desktop/src/main/**/*.{ts,tsx}',
            'apps/desktop/src/preload/**/*.{ts,tsx}',
            'packages/schema/**/*.{ts,tsx}',
            'apps/desktop/electron.vite.config.ts',
            '**/*.config.{ts,js,mjs}',
        ],
        languageOptions: {
            globals: { ...globals.node },
        },
    },
    {
        files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
        plugins: {
            react: reactPlugin,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        languageOptions: {
            globals: { ...globals.browser },
            parserOptions: { ecmaFeatures: { jsx: true } },
        },
        settings: { react: { version: 'detect' } },
        rules: {
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'react/jsx-key': 'warn',
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        },
    },
);
