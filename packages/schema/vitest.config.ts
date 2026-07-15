import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        extensions: ['.ts', '.js'],
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text-summary', 'json-summary', 'lcov'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts'],
        },
    },
});
