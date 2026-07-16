import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import {
    coverageExcludes,
    coverageReporters,
    rendererCoverageThresholds,
} from '../../vitest.coverage.js';

export default defineConfig({
    resolve: {
        alias: {
            '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
            '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        },
    },
    test: {
        name: 'renderer',
        environment: 'jsdom',
        setupFiles: ['./tests/renderer/setup.ts'],
        testTimeout: 30_000,
        include: ['tests/renderer/**/*.test.ts', 'tests/renderer/**/*.test.tsx'],
        clearMocks: true,
        restoreMocks: true,
        coverage: {
            provider: 'v8',
            reporter: [...coverageReporters],
            reportsDirectory: './coverage/renderer',
            include: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
            exclude: [...coverageExcludes],
            thresholds: rendererCoverageThresholds,
        },
    },
});
