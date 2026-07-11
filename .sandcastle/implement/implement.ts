import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as sandcastle from '@ai-hero/sandcastle';
import { noSandbox } from '@ai-hero/sandcastle/sandboxes/no-sandbox';

const ISSUE_NUMBER = required('ISSUE_NUMBER');
const ISSUE_TITLE = required('ISSUE_TITLE');
const BRANCH = required('BRANCH');
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? '/tmp';

const MODEL = process.env.OPENCODE_MODEL ?? 'opencode-go/glm-5.2';

let result: sandcastle.RunResult | undefined;
try {
    result = await sandcastle.run({
        name: `implement-#${ISSUE_NUMBER}`,
        agent: sandcastle.opencode(MODEL, {
            env: {
                OPENCODE_API_KEY: required('OPENCODE_API_KEY'),
            },
        }),
        sandbox: noSandbox(),
        logging: { type: 'stdout' },
        promptFile: path.join(import.meta.dirname, 'prompt.md'),
        promptArgs: {
            ISSUE_NUMBER,
            ISSUE_TITLE,
            BRANCH,
        },
    });
} catch (error) {
    console.error(`\nAgent run threw: ${error}`);
    console.log('Checking for commits made before the failure...');
}

const commitsAhead = Number(
    execSync('git rev-list --count main..HEAD', { encoding: 'utf8' }).trim(),
);
if (!Number.isFinite(commitsAhead) || commitsAhead === 0) {
    console.log('\nNo commits were made. The issue can be retried.');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'has_commits.txt'), 'false');
    process.exit(0);
}

console.log(`\nImplementation produced ${commitsAhead} commit(s) on ${BRANCH}.`);
if (result) {
    console.log(`  commits this run: ${result.commits.length}`);
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'has_commits.txt'), 'true');

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing required env var: ${name}`);
        process.exit(1);
    }
    return value;
}

function fail(message: string): never {
    console.error(`\nFAILED: ${message}`);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'failure_reason.txt'), message);
    process.exit(1);
}
