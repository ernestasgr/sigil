export const coverageReporters = ['text-summary', 'json-summary', 'lcov'] as const;

/**
 * Coverage is intentionally limited to production source. Keep generated
 * output, test support, fixtures, and vendor code out of every project.
 */
export const coverageExcludes = [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/*.d.ts',
    '**/{test,test-utils,tests,test-support}/**',
    '**/{fixture,fixtures,mock,mocks,mock-data}/**',
    '**/{dist,out,release,coverage,node_modules,vendor}/**',
] as const;

/**
 * These are deliberately per-file floors for the highest-risk seams. Values
 * are rounded down from the current project reports, so changing a seam or
 * its tests requires an explicit review of the resulting coverage policy.
 */
export const schemaCoverageThresholds = {
    'src/topology.ts': {
        statements: 88,
        branches: 76,
        functions: 90,
        lines: 88,
    },
} as const;

export const desktopCoverageThresholds = {
    // Plugin authentication and command dispatch.
    'src/engine/persistence/capability-broker.ts': {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
    },
    'src/engine/core/dispatch.ts': {
        statements: 80,
        branches: 68,
        functions: 95,
        lines: 81,
    },
    // Workflow persistence.
    'src/engine/workflow/workflow-state.ts': {
        statements: 98,
        branches: 100,
        functions: 96,
        lines: 98,
    },
    'src/engine/workflow/workflow-store.ts': {
        statements: 93,
        branches: 85,
        functions: 100,
        lines: 94,
    },
    // Workflow lifecycle admission and run supervision.
    'src/engine/workflow/workflow-lifecycle.ts': {
        statements: 47,
        branches: 29,
        functions: 62,
        lines: 55,
    },
    'src/engine/workflow/workflow-run-supervisor.ts': {
        statements: 84,
        branches: 70,
        functions: 87,
        lines: 86,
    },
} as const;

export const rendererCoverageThresholds = {
    // Renderer state transitions.
    'src/renderer/store/app-store.ts': {
        statements: 45,
        branches: 0,
        functions: 45,
        lines: 47,
    },
    'src/renderer/workflow-builder/builder-store.ts': {
        statements: 56,
        branches: 29,
        functions: 55,
        lines: 59,
    },
} as const;
