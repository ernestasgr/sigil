import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTION_PIN_PATTERN = /^[0-9a-f]{40}$/;
const ACTION_VERSION_COMMENT_PATTERN = /^v\d+(?:\.\d+){0,2}$/;
const OPENCODE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GITHUB_CREDENTIAL_NAMES = new Set([
    'AGENT_PAT',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'GITHUB_TOKEN_FALLBACK',
]);

interface WorkflowSource {
    readonly path: string;
    readonly source: string;
}

interface WorkflowStep {
    readonly name: string;
    readonly lines: readonly string[];
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function indentation(line: string): number {
    return line.length - line.trimStart().length;
}

function parseSteps(source: string): readonly WorkflowStep[] {
    const lines = source.split(/\r?\n/);
    const starts = lines
        .map((line, index) => ({ index, line }))
        .filter(({ line }) => indentation(line) === 12 && /^\s+- (?:name|uses):/.test(line));

    return starts.map(({ index, line }, position) => {
        const end = starts[position + 1]?.index ?? lines.length;
        return {
            name: line.trim().replace(/^- (?:name|uses):\s*/, ''),
            lines: lines.slice(index, end),
        };
    });
}

function usesGitHubCli(step: WorkflowStep): boolean {
    return step.lines.some((line) => {
        const content = line.trim();
        return !content.startsWith('#') && /\bgh\s+(?:api|issue|label|pr)\b/.test(content);
    });
}

function hasStepCredential(step: WorkflowStep): boolean {
    return step.lines.some((line) => {
        const match = line.match(/^\s+(\w+):\s*\${{\s*(.+)\s*}}\s*$/);
        return (
            match !== null &&
            GITHUB_CREDENTIAL_NAMES.has(match[1]) &&
            /secrets\.(?:AGENT_PAT|GITHUB_TOKEN)\b/.test(match[2])
        );
    });
}

function validateActionPins(workflows: readonly WorkflowSource[]): readonly string[] {
    const failures: string[] = [];

    for (const workflow of workflows) {
        for (const [index, line] of workflow.source.split(/\r?\n/).entries()) {
            const match = line.match(
                /^\s*(?:-\s+)?uses:\s*([^\s@]+)@([^\s#]+)(?:\s+#\s+(\S+))?\s*$/,
            );
            if (match === null) {
                continue;
            }

            const [, action, revision, versionComment] = match;
            if (!ACTION_PIN_PATTERN.test(revision)) {
                failures.push(
                    `${basename(workflow.path)}:${index + 1} ${action} must use a 40-character commit SHA.`,
                );
            }
            if (
                versionComment === undefined ||
                !ACTION_VERSION_COMMENT_PATTERN.test(versionComment)
            ) {
                failures.push(
                    `${basename(workflow.path)}:${index + 1} ${action} must include a readable version comment.`,
                );
            }
        }
    }

    return failures;
}

function validateCredentialScope(workflows: readonly WorkflowSource[]): readonly string[] {
    const failures: string[] = [];

    for (const workflow of workflows) {
        const lines = workflow.source.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const envIndentation = indentation(lines[index]);
            if ((envIndentation !== 0 && envIndentation !== 8) || lines[index].trim() !== 'env:') {
                continue;
            }

            for (let envIndex = index + 1; envIndex < lines.length; envIndex += 1) {
                const line = lines[envIndex];
                if (line.trim() === '' || indentation(line) > envIndentation) {
                    const match = line.match(/^\s+(\w+):\s*(.+)$/);
                    if (
                        match !== null &&
                        (GITHUB_CREDENTIAL_NAMES.has(match[1]) ||
                            /secrets\.(?:AGENT_PAT|GITHUB_TOKEN)\b/.test(match[2]))
                    ) {
                        failures.push(
                            `${basename(workflow.path)}:${envIndex + 1} exposes ${match[1]} at workflow or job scope.`,
                        );
                    }
                    continue;
                }
                break;
            }
        }

        for (const step of parseSteps(workflow.source)) {
            const requiresGitHubCredential =
                usesGitHubCli(step) ||
                step.lines.some(
                    (line) =>
                        line.includes('npx tsx .sandcastle/') ||
                        line.includes('bash .github/scripts/push-agent-branch.sh'),
                );
            if (requiresGitHubCredential && !hasStepCredential(step)) {
                failures.push(
                    `${basename(workflow.path)} step "${step.name}" needs a step-scoped GitHub credential.`,
                );
            }
            if (
                step.lines.some((line) => line.includes('uses: actions/checkout@')) &&
                !step.lines.some((line) => line.trim() === 'persist-credentials: false')
            ) {
                failures.push(
                    `${basename(workflow.path)} step "${step.name}" must disable persisted checkout credentials.`,
                );
            }
            if (
                step.lines.some((line) => line.includes('uses: actions/checkout@')) &&
                step.lines.some((line) => line.includes('secrets.AGENT_PAT'))
            ) {
                failures.push(
                    `${basename(workflow.path)} step "${step.name}" must not expose the agent PAT during checkout.`,
                );
            }
        }

        const rawPushLine = lines.findIndex((line) => {
            const content = line.trim();
            return !content.startsWith('#') && /(?:^|\s)git\s+push\b/.test(content);
        });
        if (rawPushLine >= 0) {
            failures.push(
                `${basename(workflow.path)}:${rawPushLine + 1} must use the step-scoped authenticated push helper.`,
            );
        }
    }

    return failures;
}

async function validateInstaller(root: string): Promise<readonly string[]> {
    const installerPath = resolve(root, '.github/scripts/install-opencode.sh');
    const failures: string[] = [];
    let source: string;

    try {
        source = await readFile(installerPath, 'utf8');
    } catch {
        return ['Missing shared OpenCode installer at .github/scripts/install-opencode.sh.'];
    }

    const version = source.match(/readonly OPENCODE_VERSION='([^']+)'/)?.[1];
    const checksum = source.match(/readonly OPENCODE_SHA256='([^']+)'/)?.[1];
    if (version === undefined || !OPENCODE_VERSION_PATTERN.test(version)) {
        failures.push('OpenCode installer must pin a complete immutable release version.');
    }
    if (checksum === undefined || !SHA256_PATTERN.test(checksum)) {
        failures.push('OpenCode installer must pin a lowercase SHA-256 checksum.');
    }
    if (!/\/releases\/download\/v\$\{OPENCODE_VERSION\}\//.test(source)) {
        failures.push('OpenCode installer must download from its pinned versioned release URL.');
    }
    if (!source.includes('sha256sum --check --status')) {
        failures.push('OpenCode installer must verify the archive checksum before extraction.');
    }
    if (source.indexOf('sha256sum --check --status') > source.indexOf('tar -xzf')) {
        failures.push('OpenCode installer must verify the archive before extracting it.');
    }
    if (!/opencode["}]?\s+--version/.test(source)) {
        failures.push('OpenCode installer must verify the installed executable version.');
    }

    return failures;
}

export async function validateAgentWorkflows(root: string): Promise<readonly string[]> {
    const workflowDirectory = resolve(root, '.github/workflows');
    const workflowNames = (await readdir(workflowDirectory))
        .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
        .sort();
    const workflows = await Promise.all(
        workflowNames.map(async (name): Promise<WorkflowSource> => {
            const path = resolve(workflowDirectory, name);
            return { path, source: await readFile(path, 'utf8') };
        }),
    );
    const agentWorkflows = workflows.filter(
        ({ path, source }) =>
            basename(path).startsWith('agent-') || source.includes('OPENCODE_API_KEY'),
    );
    const opencodeWorkflows = agentWorkflows.filter(({ source }) =>
        source.includes('OPENCODE_API_KEY'),
    );
    const failures = [
        ...validateActionPins(workflows),
        ...validateCredentialScope(agentWorkflows),
        ...(await validateInstaller(root)),
    ];

    for (const workflow of opencodeWorkflows) {
        const installCalls = workflow.source.match(
            /run:\s*bash\s+\.github\/scripts\/install-opencode\.sh/g,
        );
        if (installCalls?.length !== 1) {
            failures.push(
                `${basename(workflow.path)} must invoke the shared verified OpenCode installer exactly once.`,
            );
        }
        if (/opencode\.ai\/install|curl[^\n|]*\|\s*(?:ba)?sh/.test(workflow.source)) {
            failures.push(`${basename(workflow.path)} contains an unverified remote install pipe.`);
        }
    }

    const qualityGates = workflows.find(({ path }) => basename(path) === 'quality-gates.yml');
    if (qualityGates === undefined || !qualityGates.source.includes('pnpm workflows:check')) {
        failures.push('quality-gates.yml must run pnpm workflows:check.');
    }

    try {
        const documentation = await readFile(resolve(root, 'docs/agent-toolchain.md'), 'utf8');
        if (
            !documentation.includes('.github/scripts/install-opencode.sh') ||
            !documentation.includes('40-character commit SHA')
        ) {
            failures.push(
                'Agent toolchain documentation must explain where both pin types are updated.',
            );
        }
    } catch {
        failures.push('Missing agent toolchain update documentation at docs/agent-toolchain.md.');
    }

    if (agentWorkflows.length === 0 || opencodeWorkflows.length === 0) {
        failures.push('Agent workflow discovery did not find any variants to validate.');
    }

    return failures;
}

validateAgentWorkflows(repositoryRoot)
    .then((failures) => {
        if (failures.length > 0) {
            for (const failure of failures) {
                console.error(`WORKFLOW VALIDATION FAILURE: ${failure}`);
            }
            process.exitCode = 1;
            return;
        }

        console.log('Agent workflow validation passed.');
    })
    .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`WORKFLOW VALIDATION FAILURE: ${message}`);
        process.exitCode = 1;
    });
