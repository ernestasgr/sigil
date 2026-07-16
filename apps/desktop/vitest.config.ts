import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import {
    coverageExcludes,
    coverageReporters,
    desktopCoverageThresholds,
} from '../../vitest.coverage.js';

export default defineConfig({
    resolve: {
        alias: {
            '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
            '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        },
    },
    test: {
        name: 'desktop',
        environment: 'node',
        testTimeout: 30_000,
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        coverage: {
            provider: 'v8',
            reporter: [...coverageReporters],
            reportsDirectory: './coverage/desktop',
            include: ['src/**/*.ts', 'src/**/*.tsx'],
            exclude: [...coverageExcludes, 'src/renderer/**'],
            thresholds: desktopCoverageThresholds,
        },
    },
});
