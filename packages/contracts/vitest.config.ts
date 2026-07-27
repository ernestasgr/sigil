import { defineConfig } from 'vitest/config';

import {
    contractsCoverageThresholds,
    coverageExcludes,
    coverageReporters,
} from '../../vitest.coverage.js';

export default defineConfig({
    resolve: {
        extensions: ['.ts', '.js'],
    },
    test: {
        name: 'contracts',
        environment: 'node',
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: [...coverageReporters],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: [...coverageExcludes],
            thresholds: contractsCoverageThresholds,
        },
    },
});
