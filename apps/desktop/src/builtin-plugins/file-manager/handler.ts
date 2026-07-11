import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { basename, dirname, join, parse } from 'node:path';
import { FileManagerConfigSchema } from '@sigil/schema/nodes/file-manager';
import type { CollisionSuffixStyle } from '@sigil/schema/properties-file';
import { Either } from 'effect';

import type { CapabilityBroker } from '../../engine/capability-broker.js';
import type { NodeHandler, NodeRunResult } from '../../engine/node-handlers/types.js';
import { narrowNode } from '../../engine/node-handlers/types.js';

const FILE_MANAGER_PLUGIN_ID = 'com.sigil.file-manager';

type FileAction = 'move' | 'copy' | 'rename';
type ConflictPolicy = 'skip' | 'overwrite' | 'auto-rename' | 'error';

interface DestinationInfo {
    readonly fullPath: string;
    readonly dir: string;
    readonly name: string;
    readonly ext: string;
}

function computeRenameDest(sourcePath: string, newName: string): DestinationInfo {
    const srcDir = dirname(sourcePath);
    const fullPath = join(srcDir, newName);
    const parsed = parse(fullPath);
    return {
        fullPath,
        dir: parsed.dir,
        name: parsed.base,
        ext: parsed.ext.slice(1),
    };
}

function computeMoveCopyDest(sourcePath: string, targetDir: string): DestinationInfo {
    const originalName = basename(sourcePath);
    const fullPath = join(targetDir, originalName);
    const parsed = parse(fullPath);
    return {
        fullPath,
        dir: targetDir,
        name: parsed.base,
        ext: parsed.ext.slice(1),
    };
}

function computeDest(action: FileAction, sourcePath: string, destination: string): DestinationInfo {
    if (action === 'rename') {
        return computeRenameDest(sourcePath, destination);
    }
    return computeMoveCopyDest(sourcePath, destination);
}

function generateAutoRenamePath(
    originalPath: string,
    style: CollisionSuffixStyle,
    counter: number,
): string {
    const parsed = parse(originalPath);
    const separator = style === 'windows' ? ' (' : style === 'underscore' ? '_' : '-';
    const close = style === 'windows' ? ')' : '';
    return join(parsed.dir, `${parsed.name}${separator}${counter}${close}${parsed.ext}`);
}

const MAX_AUTO_RENAME_ATTEMPTS = 10_000;

function findAvailablePath(originalPath: string, style: CollisionSuffixStyle): string {
    let counter = 2;
    let candidate = generateAutoRenamePath(originalPath, style, counter);
    while (existsSync(candidate)) {
        if (counter >= MAX_AUTO_RENAME_ATTEMPTS) {
            throw new Error(
                `Auto-rename exhausted after ${MAX_AUTO_RENAME_ATTEMPTS} attempts for: ${originalPath}`,
            );
        }
        counter++;
        candidate = generateAutoRenamePath(originalPath, style, counter);
    }
    return candidate;
}

function checkPermissions(broker: CapabilityBroker, pluginId: string): void {
    const readResult = broker.request({ pluginId, capability: 'filesystem.read' });
    if (Either.isLeft(readResult)) {
        throw new Error(`Permission denied: ${readResult.left.capability}`);
    }
    const writeResult = broker.request({ pluginId, capability: 'filesystem.write' });
    if (Either.isLeft(writeResult)) {
        throw new Error(`Permission denied: ${writeResult.left.capability}`);
    }
}

function ensureDir(dirPath: string): void {
    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
    }
}

function handleConflict(
    destPath: string,
    onConflict: ConflictPolicy,
    style: CollisionSuffixStyle | undefined,
): { resolvedPath: string; shouldSkip: boolean } {
    if (!existsSync(destPath)) {
        return { resolvedPath: destPath, shouldSkip: false };
    }

    switch (onConflict) {
        case 'skip':
            return { resolvedPath: destPath, shouldSkip: true };
        case 'overwrite':
            return { resolvedPath: destPath, shouldSkip: false };
        case 'auto-rename': {
            if (style === undefined) {
                throw new Error(
                    'File-manager: collisionSuffixStyle is required when onConflict is "auto-rename"',
                );
            }
            const resolvedPath = findAvailablePath(destPath, style);
            return { resolvedPath, shouldSkip: false };
        }
        case 'error':
            throw new Error(`Destination exists: ${destPath}`);
        default:
            throw new Error(`Unknown conflict policy: ${onConflict}`);
    }
}

function performAction(action: FileAction, sourcePath: string, destPath: string): void {
    if (action === 'copy') {
        copyFileSync(sourcePath, destPath);
    } else if (action === 'move' || action === 'rename') {
        renameSync(sourcePath, destPath);
    }
}

function updatePayload(
    ctx: {
        readonly event: string;
        readonly payload: Readonly<Record<string, unknown>>;
        readonly vars: Readonly<Record<string, unknown>>;
    },
    info: DestinationInfo,
): {
    readonly event: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly vars: Readonly<Record<string, unknown>>;
} {
    return {
        event: ctx.event,
        payload: {
            ...ctx.payload,
            path: info.fullPath,
            dir: info.dir,
            name: info.name,
            ext: info.ext,
        },
        vars: ctx.vars,
    };
}

export const descriptor = {
    type: 'file-manager' as const,
    configSchema: FileManagerConfigSchema,
    defaultConfig: { action: 'move', destination: '/', onConflict: 'skip' },
    getOutputPorts: () => ['out'] as const,
};

export const handler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        const typedNode = narrowNode(node, 'file-manager');

        const { action, destination, onConflict } = typedNode.config;
        const sourcePath = ctx.payload.path;
        if (typeof sourcePath !== 'string' || sourcePath === '') {
            throw new Error('File-manager: payload.path is missing or empty');
        }

        const { collisionSuffixStyle } = deps;

        checkPermissions(deps.capabilityBroker, FILE_MANAGER_PLUGIN_ID);

        const destInfo = computeDest(action, sourcePath, destination);

        ensureDir(destInfo.dir);

        const { resolvedPath, shouldSkip } = handleConflict(
            destInfo.fullPath,
            onConflict,
            collisionSuffixStyle,
        );

        if (shouldSkip) {
            return { outputCtx: ctx, activePort: 'out' };
        }

        performAction(action, sourcePath, resolvedPath);

        const parsed = parse(resolvedPath);
        const destinationInfo: DestinationInfo = {
            fullPath: resolvedPath,
            dir: parsed.dir,
            name: parsed.base,
            ext: parsed.ext.slice(1),
        };

        const outputCtx = updatePayload(ctx, destinationInfo);
        return { outputCtx, activePort: 'out' };
    },
};
