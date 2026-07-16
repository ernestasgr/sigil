import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: [
            'packages/schema/vitest.config.ts',
            'apps/desktop/vitest.config.ts',
            'apps/desktop/vitest.renderer.config.ts',
        ],
    },
});
