import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const COVERAGE_METRICS = ['statements', 'branches', 'functions', 'lines'] as const;

const CoverageValueSchema = z.object({ pct: z.number() });
const CoverageSummarySchema = z.object({
    total: z.object({
        statements: CoverageValueSchema,
        branches: CoverageValueSchema,
        functions: CoverageValueSchema,
        lines: CoverageValueSchema,
    }),
});

const BaselineMetricsSchema = z.object({
    statements: z.number().min(0).max(100),
    branches: z.number().min(0).max(100),
    functions: z.number().min(0).max(100),
    lines: z.number().min(0).max(100),
});

const CoverageBaselineSchema = z.object({
    schemaVersion: z.literal(2),
    policy: z.object({
        comparison: z.literal('no-lower-than-baseline'),
        source: z.string().min(1),
    }),
    projects: z.object({
        schema: BaselineMetricsSchema,
        desktop: BaselineMetricsSchema,
        renderer: BaselineMetricsSchema,
    }),
});

type CoverageSummary = z.infer<typeof CoverageSummarySchema>;
type CoverageBaseline = z.infer<typeof CoverageBaselineSchema>;
type ProjectKey = keyof CoverageBaseline['projects'];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(repositoryRoot, 'docs/coverage-baseline.json');

const coverageTargets = [
    {
        key: 'schema',
        label: 'schema',
        reportPath: resolve(repositoryRoot, 'packages/schema/coverage/coverage-summary.json'),
    },
    {
        key: 'desktop',
        label: 'desktop',
        reportPath: resolve(repositoryRoot, 'apps/desktop/coverage/desktop/coverage-summary.json'),
    },
    {
        key: 'renderer',
        label: 'renderer',
        reportPath: resolve(repositoryRoot, 'apps/desktop/coverage/renderer/coverage-summary.json'),
    },
] as const satisfies ReadonlyArray<{
    key: ProjectKey;
    label: string;
    reportPath: string;
}>;

async function readJson(filePath: string): Promise<unknown> {
    const raw = await readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed;
}

async function readSummary(filePath: string): Promise<CoverageSummary> {
    return CoverageSummarySchema.parse(await readJson(filePath));
}

async function readBaseline(): Promise<CoverageBaseline> {
    return CoverageBaselineSchema.parse(await readJson(baselinePath));
}

function formatPercentage(value: number): string {
    return `${value.toFixed(2)}%`;
}

async function checkCoverage(): Promise<void> {
    const baseline = await readBaseline();
    const failures: string[] = [];

    console.log(`Coverage policy: ${baseline.policy.comparison}`);
    console.log(`Baseline source: ${baseline.policy.source}`);

    for (const target of coverageTargets) {
        const summary = await readSummary(target.reportPath);
        const projectBaseline = baseline.projects[target.key];

        for (const metric of COVERAGE_METRICS) {
            const current = summary.total[metric].pct;
            const minimum = projectBaseline[metric];
            const status = current >= minimum ? 'ok' : 'failed';

            console.log(
                `${status}: ${target.label} ${metric} ${formatPercentage(current)} ` +
                    `(baseline ${formatPercentage(minimum)})`,
            );

            if (current < minimum) {
                failures.push(`${target.label} ${metric}`);
            }
        }
    }

    if (failures.length > 0) {
        throw new Error(`Coverage policy failed for: ${failures.join(', ')}.`);
    }
}

checkCoverage().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`COVERAGE VERIFICATION FAILURE: ${message}`);
    process.exitCode = 1;
});
