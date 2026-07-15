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
    schemaVersion: z.literal(1),
    policy: z.object({
        comparison: z.literal('no-lower-than-baseline'),
        source: z.string().min(1),
    }),
    packages: z.object({
        schema: BaselineMetricsSchema,
        desktop: BaselineMetricsSchema,
    }),
});

type CoverageSummary = z.infer<typeof CoverageSummarySchema>;
type CoverageBaseline = z.infer<typeof CoverageBaselineSchema>;
type PackageKey = keyof CoverageBaseline['packages'];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(repositoryRoot, 'docs/coverage-baseline.json');

const coverageTargets = [
    {
        key: 'schema',
        label: '@sigil/schema',
        reportPath: resolve(repositoryRoot, 'packages/schema/coverage/coverage-summary.json'),
    },
    {
        key: 'desktop',
        label: '@sigil/desktop',
        reportPath: resolve(repositoryRoot, 'apps/desktop/coverage/coverage-summary.json'),
    },
] as const satisfies ReadonlyArray<{
    key: PackageKey;
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
    let failed = false;

    console.log(`Coverage policy: ${baseline.policy.comparison}`);
    console.log(`Baseline source: ${baseline.policy.source}`);

    for (const target of coverageTargets) {
        const summary = await readSummary(target.reportPath);
        const packageBaseline = baseline.packages[target.key];

        for (const metric of COVERAGE_METRICS) {
            const current = summary.total[metric].pct;
            const minimum = packageBaseline[metric];
            const status = current >= minimum ? 'ok' : 'failed';

            console.log(
                `${status}: ${target.label} ${metric} ${formatPercentage(current)} ` +
                    `(baseline ${formatPercentage(minimum)})`,
            );

            if (current < minimum) {
                failed = true;
            }
        }
    }

    if (failed) {
        throw new Error(
            'Coverage policy failed: one or more measured metrics are below the committed baseline.',
        );
    }
}

checkCoverage().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`COVERAGE VERIFICATION FAILURE: ${message}`);
    process.exitCode = 1;
});
