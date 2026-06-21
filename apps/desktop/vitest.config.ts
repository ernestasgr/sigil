import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@renderer': new URL('./src/renderer', import.meta.url).pathname,
            '@shared': new URL('./src/shared', import.meta.url).pathname,
        },
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
});
