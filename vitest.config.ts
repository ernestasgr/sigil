import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: [
            'packages/contracts/vitest.config.ts',
            'packages/workflow-domain/vitest.config.ts',
            'apps/desktop/vitest.config.ts',
            'apps/desktop/vitest.renderer.config.ts',
        ],
    },
});
