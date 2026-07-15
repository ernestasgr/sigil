import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.ts',
    outputDir: './test-results',
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    timeout: 90_000,
    expect: {
        timeout: 10_000,
    },
    reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
});
