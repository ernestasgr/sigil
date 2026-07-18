import { readFileSync } from 'node:fs';
import process from 'node:process';

import { isSupportedNodeVersion } from './node-version-contract.mjs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const nodeEngineRange = packageJson.engines?.node;
const recommendedNodeVersion = readFileSync(
    new URL('../.node-version', import.meta.url),
    'utf8',
).trim();

if (
    typeof nodeEngineRange !== 'string' ||
    !isSupportedNodeVersion(process.versions.node, nodeEngineRange)
) {
    console.error(
        `NODE VERSION FAILURE: Node.js ${String(nodeEngineRange)} is required because Electron embeds Node.js 24.x. ` +
            `Detected ${process.version}. Install Node.js ${recommendedNodeVersion} from .node-version ` +
            'or another supported 24.x release, then restart your shell and rerun the command.',
    );
    process.exitCode = 1;
} else {
    console.log(`NODE VERSION OK: ${process.version} satisfies Node.js ${nodeEngineRange}.`);
}
