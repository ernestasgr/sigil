import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type JsonRecord = Record<string, unknown>;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const expectedExports = {
    'packages/contracts': ['.', './ids', './workflow', './events', './plugins', './properties'],
    'packages/workflow-domain': ['.'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const allowedImports = {
    '@sigil/contracts': new Set([
        '.',
        './ids',
        './workflow',
        './events',
        './plugins',
        './properties',
    ]),
    '@sigil/workflow-domain': new Set(['.']),
} as const satisfies Readonly<Record<string, ReadonlySet<string>>>;

const importSpecifierPattern =
    /(?:from\s*|import\s*\(\s*)['"](@sigil\/(?:contracts|workflow-domain)(?:\/[^'"]+)?)['"]/g;
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const ignoredDirectoryNames = new Set([
    '.git',
    '.turbo',
    'coverage',
    'dist',
    'node_modules',
    'out',
    'release',
]);

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(filePath: string): Promise<unknown> {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

async function sourceFiles(root: string): Promise<readonly string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!ignoredDirectoryNames.has(entry.name)) {
                files.push(...(await sourceFiles(resolve(root, entry.name))));
            }
            continue;
        }

        const filePath = resolve(root, entry.name);
        const extension = filePath.slice(filePath.lastIndexOf('.'));
        if (sourceExtensions.has(extension)) {
            files.push(filePath);
        }
    }

    return files;
}

function packageNameForImport(specifier: string): keyof typeof allowedImports | undefined {
    if (specifier === '@sigil/contracts' || specifier.startsWith('@sigil/contracts/')) {
        return '@sigil/contracts';
    }
    if (specifier === '@sigil/workflow-domain' || specifier.startsWith('@sigil/workflow-domain/')) {
        return '@sigil/workflow-domain';
    }
    return undefined;
}

function importSubpath(packageName: keyof typeof allowedImports, specifier: string): string {
    return specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
}

async function checkPackageExports(): Promise<readonly string[]> {
    const violations: string[] = [];

    for (const [packageDirectory, expected] of Object.entries(expectedExports)) {
        const manifestPath = resolve(repositoryRoot, packageDirectory, 'package.json');
        const manifest = await readJson(manifestPath);
        if (!isRecord(manifest) || !isRecord(manifest.exports)) {
            violations.push(
                `${relative(repositoryRoot, manifestPath)} does not define an exports object`,
            );
            continue;
        }

        const actual = Object.keys(manifest.exports).sort();
        const expectedSorted = [...expected].sort();
        if (
            actual.length !== expectedSorted.length ||
            actual.some((key, index) => key !== expectedSorted[index])
        ) {
            violations.push(
                `${relative(repositoryRoot, manifestPath)} exports ${JSON.stringify(actual)}; expected ${JSON.stringify(expectedSorted)}`,
            );
        }
    }

    return violations;
}

async function checkImports(): Promise<readonly string[]> {
    const violations: string[] = [];
    const files = [
        ...(await sourceFiles(resolve(repositoryRoot, 'apps'))),
        ...(await sourceFiles(resolve(repositoryRoot, 'packages'))),
    ];

    for (const filePath of files) {
        const source = await readFile(filePath, 'utf8');
        for (const match of source.matchAll(importSpecifierPattern)) {
            const specifier = match[1];
            if (specifier === undefined) continue;

            const packageName = packageNameForImport(specifier);
            if (packageName === undefined) continue;

            const subpath = importSubpath(packageName, specifier);
            if (!allowedImports[packageName].has(subpath)) {
                violations.push(
                    `${relative(repositoryRoot, filePath)} imports ${specifier}; use one of ${JSON.stringify([...allowedImports[packageName]])}`,
                );
            }
        }
    }

    return violations;
}

async function checkForbiddenSourcePaths(): Promise<readonly string[]> {
    const retiredPaths = [
        'packages/contracts/src/nodes/catalog.ts',
        'packages/contracts/src/nodes/types.ts',
        'packages/workflow-domain/src/samples.ts',
    ] as const;

    const violations: string[] = [];
    for (const retiredPath of retiredPaths) {
        try {
            await readFile(resolve(repositoryRoot, retiredPath));
            violations.push(`${retiredPath} is a retired source path`);
        } catch (error) {
            if (!isRecord(error) || error.code !== 'ENOENT') throw error;
        }
    }
    return violations;
}

const violations = [
    ...(await checkPackageExports()),
    ...(await checkImports()),
    ...(await checkForbiddenSourcePaths()),
];

if (violations.length > 0) {
    console.error('Package architecture check failed:');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
} else {
    console.log(
        'Package architecture check passed: public exports and imports use approved façades.',
    );
}
