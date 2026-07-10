import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Either } from 'effect';

import type { PipelineNode } from '@sigil/schema/nodes';
import type { CollisionSuffixStyle } from '@sigil/schema/properties-file';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import type { CapabilityBroker } from '../capability-broker.js';
import { createEventBus } from '../event-bus.js';
import type { NodeHandlerDeps } from './types.js';

function tmpDir(): string {
    const dir = join(tmpdir(), 'sigil-file-manager-test', randomUUID());
    mkdirSync(dir, { recursive: true });
    return dir;
}

function touch(path: string, content = ''): void {
    writeFileSync(path, content, 'utf-8');
}

function fileManagerNode(
    overrides?: Partial<PipelineNode & { type: 'file-manager' }>,
): PipelineNode {
    return {
        id: 'fm',
        type: 'file-manager',
        config: { action: 'move', destination: '/tmp', onConflict: 'skip' },
        ...overrides,
    } as PipelineNode;
}

type FileManagerTestDeps = NodeHandlerDeps & {
    readonly collisionSuffixStyle: CollisionSuffixStyle;
};

function buildDeps(overrides?: Partial<FileManagerTestDeps>): FileManagerTestDeps {
    return {
        bus: createEventBus(),
        sleep: vi.fn(),
        resolveTemplate: vi.fn((t: string) => t),
        evaluateCondition: vi.fn(),
        matchSwitchCase: vi.fn(),
        state: { get: vi.fn(), set: vi.fn(), flush: vi.fn() },
        capabilityBroker: { request: vi.fn().mockReturnValue(Either.right(undefined)) },
        collisionSuffixStyle: 'windows',
        ...overrides,
    };
}

function ctx(overrides?: Partial<WorkflowContext>): WorkflowContext {
    return {
        event: 'file.created',
        payload: {
            path: '/original/path/file.txt',
            name: 'file.txt',
            ext: 'txt',
            size: 100,
            dir: '/original/path',
        },
        vars: {},
        ...overrides,
    };
}

describe('file-manager handler', () => {
    describe('move action', () => {
        it('moves a file to the target directory', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'source');
            const dstDir = join(dir, 'dest');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'report.pdf');
            touch(srcPath, 'hello');

            const node = fileManagerNode({
                config: { action: 'move', destination: dstDir, onConflict: 'overwrite' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'report.pdf', ext: 'pdf', size: 5, dir: srcDir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            const result = await fileManagerHandler.execute({ node, ctx: context }, buildDeps());

            expect(existsSync(srcPath)).toBe(false);
            const dstPath = join(dstDir, 'report.pdf');
            expect(existsSync(dstPath)).toBe(true);
            expect(readFileSync(dstPath, 'utf-8')).toBe('hello');

            expect(result.activePort).toBe('out');
            expect(result.outputCtx.payload.path).toBe(dstPath);
            expect(result.outputCtx.payload.dir).toBe(dstDir);
            expect(result.outputCtx.payload.name).toBe('report.pdf');
            expect(result.outputCtx.payload.ext).toBe('pdf');
        });

        it('creates the target directory recursively', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'source');
            const dstDir = join(dir, 'deep', 'nested', 'dest');
            mkdirSync(srcDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'data');

            const node = fileManagerNode({
                config: { action: 'move', destination: dstDir, onConflict: 'overwrite' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'file.txt', ext: 'txt', size: 4, dir: srcDir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            await fileManagerHandler.execute({ node, ctx: context }, buildDeps());

            expect(existsSync(join(dstDir, 'file.txt'))).toBe(true);
        });
    });

    describe('copy action', () => {
        it('copies a file to the target directory', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'source');
            const dstDir = join(dir, 'dest');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'content');

            const node = fileManagerNode({
                config: { action: 'copy', destination: dstDir, onConflict: 'overwrite' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'file.txt', ext: 'txt', size: 7, dir: srcDir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            const result = await fileManagerHandler.execute({ node, ctx: context }, buildDeps());

            expect(existsSync(srcPath)).toBe(true);
            expect(existsSync(join(dstDir, 'file.txt'))).toBe(true);
            expect(readFileSync(join(dstDir, 'file.txt'), 'utf-8')).toBe('content');
            expect(result.activePort).toBe('out');
        });
    });

    describe('rename action', () => {
        it('renames a file to a new name in the same directory', async () => {
            const dir = tmpDir();
            const srcPath = join(dir, 'old-name.txt');
            touch(srcPath, 'data');

            const node = fileManagerNode({
                config: { action: 'rename', destination: 'new-name.txt', onConflict: 'overwrite' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'old-name.txt', ext: 'txt', size: 4, dir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            const result = await fileManagerHandler.execute({ node, ctx: context }, buildDeps());

            expect(existsSync(srcPath)).toBe(false);
            const dstPath = join(dir, 'new-name.txt');
            expect(existsSync(dstPath)).toBe(true);
            expect(result.outputCtx.payload.path).toBe(dstPath);
            expect(result.outputCtx.payload.dir).toBe(dir);
            expect(result.outputCtx.payload.name).toBe('new-name.txt');
            expect(result.outputCtx.payload.ext).toBe('txt');
        });
    });

    describe('collision policies', () => {
        it('skip: leaves original file untouched when destination exists', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'src');
            const dstDir = join(dir, 'dst');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'new');
            const dstPath = join(dstDir, 'file.txt');
            touch(dstPath, 'existing');

            const node = fileManagerNode({
                config: { action: 'move', destination: dstDir, onConflict: 'skip' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'file.txt', ext: 'txt', size: 3, dir: srcDir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            const result = await fileManagerHandler.execute({ node, ctx: context }, buildDeps());

            expect(existsSync(srcPath)).toBe(true);
            expect(readFileSync(dstPath, 'utf-8')).toBe('existing');
            expect(result.outputCtx.payload.path).toBe(srcPath);
            expect(result.outputCtx.payload.dir).toBe(srcDir);
        });

        it('overwrite: replaces destination file', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'src');
            const dstDir = join(dir, 'dst');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'new');
            const dstPath = join(dstDir, 'file.txt');
            touch(dstPath, 'existing');

            const node = fileManagerNode({
                config: { action: 'move', destination: dstDir, onConflict: 'overwrite' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'file.txt', ext: 'txt', size: 3, dir: srcDir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            const result = await fileManagerHandler.execute({ node, ctx: context }, buildDeps());

            expect(existsSync(srcPath)).toBe(false);
            expect(readFileSync(dstPath, 'utf-8')).toBe('new');
            expect(result.outputCtx.payload.path).toBe(dstPath);
        });

        it('error: throws when destination exists', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'src');
            const dstDir = join(dir, 'dst');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'new');
            const dstPath = join(dstDir, 'file.txt');
            touch(dstPath, 'existing');

            const node = fileManagerNode({
                config: { action: 'move', destination: dstDir, onConflict: 'error' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'file.txt', ext: 'txt', size: 3, dir: srcDir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            await expect(
                fileManagerHandler.execute({ node, ctx: context }, buildDeps()),
            ).rejects.toThrow(/destination exists/i);
        });
    });

    describe('auto-rename suffix styles', () => {
        it('windows style: file (2).ext', async () => {
            const dir = tmpDir();
            const srcPath = join(dir, 'source.txt');
            const dstCollision = join(dir, 'target.txt');
            const dstAuto = join(dir, 'target (2).txt');
            touch(srcPath, 'new');
            touch(dstCollision, 'existing');

            const node = fileManagerNode({
                config: { action: 'rename', destination: 'target.txt', onConflict: 'auto-rename' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'source.txt', ext: 'txt', size: 3, dir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            const result = await fileManagerHandler.execute(
                { node, ctx: context },
                buildDeps({ collisionSuffixStyle: 'windows' }),
            );

            expect(existsSync(srcPath)).toBe(false);
            expect(existsSync(dstAuto)).toBe(true);
            expect(result.outputCtx.payload.name).toBe('target (2).txt');
        });

        it('underscore style: file_2.ext', async () => {
            const dir = tmpDir();
            const srcPath = join(dir, 'source.txt');
            const dstCollision = join(dir, 'target.txt');
            const dstAuto = join(dir, 'target_2.txt');
            touch(srcPath, 'new');
            touch(dstCollision, 'existing');

            const node = fileManagerNode({
                config: { action: 'rename', destination: 'target.txt', onConflict: 'auto-rename' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'source.txt', ext: 'txt', size: 3, dir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            const result = await fileManagerHandler.execute(
                { node, ctx: context },
                buildDeps({ collisionSuffixStyle: 'underscore' }),
            );

            expect(existsSync(srcPath)).toBe(false);
            expect(existsSync(dstAuto)).toBe(true);
            expect(result.outputCtx.payload.name).toBe('target_2.txt');
        });

        it('hyphen style: file-2.ext', async () => {
            const dir = tmpDir();
            const srcPath = join(dir, 'source.txt');
            const dstCollision = join(dir, 'target.txt');
            const dstAuto = join(dir, 'target-2.txt');
            touch(srcPath, 'new');
            touch(dstCollision, 'existing');

            const node = fileManagerNode({
                config: { action: 'rename', destination: 'target.txt', onConflict: 'auto-rename' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'source.txt', ext: 'txt', size: 3, dir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            const result = await fileManagerHandler.execute(
                { node, ctx: context },
                buildDeps({ collisionSuffixStyle: 'hyphen' }),
            );

            expect(existsSync(srcPath)).toBe(false);
            expect(existsSync(dstAuto)).toBe(true);
            expect(result.outputCtx.payload.name).toBe('target-2.txt');
        });

        it('auto-rename increments the counter until it finds a free name', async () => {
            const dir = tmpDir();
            const srcPath = join(dir, 'source.txt');
            touch(srcPath, 'new');
            touch(join(dir, 'target.txt'), 'existing');
            touch(join(dir, 'target (2).txt'), 'existing2');
            touch(join(dir, 'target (3).txt'), 'existing3');

            const node = fileManagerNode({
                config: { action: 'rename', destination: 'target.txt', onConflict: 'auto-rename' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'source.txt', ext: 'txt', size: 3, dir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            const result = await fileManagerHandler.execute(
                { node, ctx: context },
                buildDeps({ collisionSuffixStyle: 'windows' }),
            );

            expect(existsSync(join(dir, 'target (4).txt'))).toBe(true);
            expect(result.outputCtx.payload.name).toBe('target (4).txt');
        });
    });

    describe('Capability Broker permission enforcement', () => {
        it('requests filesystem.read and filesystem.write before the operation', async () => {
            const dir = tmpDir();
            const srcPath = join(dir, 'file.txt');
            touch(srcPath);
            const dstDir = join(dir, 'dest');
            mkdirSync(dstDir);

            const request = vi.fn().mockReturnValue(Either.right(undefined));
            const broker: CapabilityBroker = { request };

            const node = fileManagerNode({
                config: { action: 'move', destination: dstDir, onConflict: 'overwrite' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'file.txt', ext: 'txt', size: 0, dir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            await fileManagerHandler.execute(
                { node, ctx: context },
                buildDeps({ capabilityBroker: broker }),
            );

            expect(request).toHaveBeenCalledWith({
                pluginId: 'com.sigil.file-manager',
                capability: 'filesystem.read',
            });
            expect(request).toHaveBeenCalledWith({
                pluginId: 'com.sigil.file-manager',
                capability: 'filesystem.write',
            });
        });

        it('throws when the Broker denies filesystem.write', async () => {
            const dir = tmpDir();
            const srcPath = join(dir, 'file.txt');
            touch(srcPath);
            const dstDir = join(dir, 'dest');
            mkdirSync(dstDir);

            const request = vi
                .fn()
                .mockImplementation(({ capability }: { capability: string }) =>
                    capability === 'filesystem.write'
                        ? Either.left({ kind: 'denied' as const, capability })
                        : Either.right(undefined),
                );
            const broker: CapabilityBroker = { request };

            const node = fileManagerNode({
                config: { action: 'move', destination: dstDir, onConflict: 'overwrite' },
            });
            const context = ctx({
                payload: { path: srcPath, name: 'file.txt', ext: 'txt', size: 0, dir },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            await expect(
                fileManagerHandler.execute(
                    { node, ctx: context },
                    buildDeps({ capabilityBroker: broker }),
                ),
            ).rejects.toThrow(/denied/);
        });
    });

    describe('WorkflowContext payload update', () => {
        it('preserves unrelated payload keys after the action', async () => {
            const dir = tmpDir();
            const srcPath = join(dir, 'file.txt');
            touch(srcPath);

            const node = fileManagerNode({
                config: { action: 'rename', destination: 'renamed.txt', onConflict: 'overwrite' },
            });
            const context = ctx({
                payload: {
                    path: srcPath,
                    name: 'file.txt',
                    ext: 'txt',
                    size: 42,
                    dir,
                },
            });

            const { handler: fileManagerHandler } =
                await import('../../builtin-plugins/file-manager/handler.js');
            const result = await fileManagerHandler.execute({ node, ctx: context }, buildDeps());

            expect(result.outputCtx.payload.size).toBe(42);
        });
    });
});
