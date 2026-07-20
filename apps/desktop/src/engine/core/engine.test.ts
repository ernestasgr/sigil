import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CompiledPipeline, parsePipeline } from '@sigil/schema';
import type { FileWatcherConfig } from '@sigil/schema/nodes/file-watcher';
import { sampleManualTriggerToLog } from '@sigil/schema/samples';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusEvent } from '../events/event-bus.js';
import { isTriggerHandler } from '../node-handlers/types.js';
import { createEngine, type Engine } from './engine.js';

async function activateFileWatcher(
    engine: Engine,
    config: FileWatcherConfig,
    contexts: WorkflowContext[],
): Promise<() => void> {
    await engine.loadBuiltinPlugins();

    const handler = engine.handlerRegistry.get('file-watcher');
    if (Option.isNone(handler)) throw new Error('file-watcher handler was not loaded');
    if (!isTriggerHandler(handler.value)) throw new Error('file-watcher handler is not a Trigger');

    const teardown = handler.value.activate(config, (context) => {
        contexts.push(context);
    });
    await vi.waitFor(() => {
        expect(engine.fileWatcherManager.getSubscriberCount()).toBe(1);
    });
    return teardown;
}

async function waitForFileWatcherQuiescence(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
    });
}

function fileManagerWorkflow(
    sourcePath: string,
    sourceName: string,
    sourceDir: string,
    config: Readonly<Record<string, unknown>>,
): unknown {
    return {
        id: 'file-manager-properties',
        workflowId: 'file-manager-properties',
        schemaVersion: 1,
        nodes: [
            {
                id: 'trigger',
                type: 'manual-trigger',
                config: {
                    eventName: 'file.created',
                    payload: {
                        path: sourcePath,
                        name: sourceName,
                        ext: 'txt',
                        size: 0,
                        dir: sourceDir,
                    },
                },
            },
            {
                id: 'file-manager',
                type: 'file-manager',
                config,
            },
        ],
        edges: [
            {
                id: 'trigger-to-file-manager',
                source: 'trigger',
                target: 'file-manager',
                sourcePort: 'out',
            },
        ],
    };
}

describe('createEngine', () => {
    it('exposes the event bus, stub bridge, and stub capability broker', () => {
        const engine = createEngine();

        expect(engine.bus).toBeDefined();
        expect(engine.bridge).toBeDefined();
        expect(engine.capabilityBroker).toBeDefined();
        engine.dispose();
    });

    it('awaits plugin worker termination during graceful shutdown', async () => {
        const engine = createEngine();
        const results = await engine.loadBuiltinPlugins();
        const loaded = results.find((result) => result.ok);

        expect(loaded).toBeDefined();
        if (!loaded?.ok) {
            await engine.shutdown();
            return;
        }

        await engine.shutdown();
        await expect(
            loaded.handler.execute(
                {
                    node: {
                        id: 'shutdown-node',
                        type: loaded.descriptor.type,
                        pluginId: loaded.manifest.id,
                        config: {},
                    },
                    ctx: { event: '', payload: {}, vars: {} },
                },
                {} as never,
            ),
        ).rejects.toThrow(/stopped unexpectedly|shut down/i);
    });

    it('runs the sample pipeline through execute and emits log.output on the bus', async () => {
        const engine = createEngine();
        const events: BusEvent[] = [];
        engine.bus.subscribe((event) => {
            events.push(event);
        });

        await engine.execute(sampleManualTriggerToLog);

        const logEvent = events.find((event) => event.name === 'log.output');
        expect(logEvent).toBeDefined();
        expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
            'Manual trigger fired for report.pdf (2048576 bytes)',
        );
    });

    it('rejects an invalid topology at the Engine acceptance seam', async () => {
        const engine = createEngine();
        const events: BusEvent[] = [];
        engine.bus.subscribe((event) => {
            events.push(event);
        });
        const invalidPipeline: CompiledPipeline = {
            ...sampleManualTriggerToLog,
            nodes: [],
            edges: [],
        };

        await expect(engine.execute(invalidPipeline)).rejects.toMatchObject({
            kind: 'workflow_topology',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({ code: 'empty_pipeline' }),
            ]),
        });
        expect(events.some((event) => event.name === 'engine.diagnostic')).toBe(true);
        engine.dispose();
    });

    it('rejects unsupported Node handlers before execution begins', async () => {
        const engine = createEngine();
        const events: BusEvent[] = [];
        engine.bus.subscribe((event) => {
            events.push(event);
        });
        const unsupportedPipeline: CompiledPipeline = {
            ...sampleManualTriggerToLog,
            nodes: [
                ...sampleManualTriggerToLog.nodes,
                {
                    id: 'missing',
                    type: 'missing-node',
                    pluginId: 'com.example.missing',
                    config: {},
                },
            ],
            edges: [
                ...sampleManualTriggerToLog.edges,
                { id: 'log-missing', source: 'log', target: 'missing', sourcePort: 'out' },
            ],
        };

        await expect(engine.execute(unsupportedPipeline)).rejects.toMatchObject({
            kind: 'workflow_topology',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    code: 'unsupported_node_handler',
                    nodeId: 'missing',
                    target: { kind: 'node', nodeId: 'missing' },
                }),
            ]),
        });
        expect(events.some((event) => event.name === 'workflow.started')).toBe(false);
        engine.dispose();
    });

    it('executes a validated Trigger-rooted fan-out', async () => {
        const engine = createEngine();
        const events: BusEvent[] = [];
        engine.bus.subscribe((event) => {
            events.push(event);
        });
        const trigger = sampleManualTriggerToLog.nodes[0];
        if (!trigger) throw new Error('sample trigger missing');
        const fanOut: CompiledPipeline = {
            ...sampleManualTriggerToLog,
            nodes: [
                trigger,
                { id: 'log-a', type: 'log', config: { message: 'a' } },
                { id: 'log-b', type: 'log', config: { message: 'b' } },
            ],
            edges: [
                { id: 'trigger-a', source: trigger.id, target: 'log-a', sourcePort: 'out' },
                { id: 'trigger-b', source: trigger.id, target: 'log-b', sourcePort: 'out' },
            ],
        };

        await engine.execute(fanOut);

        expect(
            events
                .filter((event) => event.name === 'log.output')
                .map((event) => (event.name === 'log.output' ? event.payload.message : '')),
        ).toEqual(['a', 'b']);
        engine.dispose();
    });

    it('defaults notifyOnWorkflowError to true when no properties are provided', () => {
        const engine = createEngine();
        expect(engine.settings.notifyOnWorkflowError).toBe(true);
    });

    it('reads notifyOnWorkflowError from the provided properties file content', () => {
        const engine = createEngine({ properties: { notifyOnWorkflowError: false } });
        expect(engine.settings.notifyOnWorkflowError).toBe(false);
    });

    it('accepts documented builtin plugin defaults while resolving engine settings', () => {
        const engine = createEngine({
            properties: {
                notifyOnWorkflowError: false,
                'file-watcher.ignorePatterns': ['*.user-defined'],
                'file-manager.defaultOnConflict': 'skip',
                'file-manager.collisionSuffixStyle': 'hyphen',
            },
        });

        expect(engine.settings.notifyOnWorkflowError).toBe(false);
        engine.dispose();
    });

    it('falls back to the hardcoded default when the properties content is malformed', () => {
        const engine = createEngine({ properties: { notifyOnWorkflowError: 'not-a-boolean' } });
        expect(engine.settings.notifyOnWorkflowError).toBe(true);
    });

    it('validates Properties before applying hot values to the running Engine', () => {
        const engine = createEngine({ properties: { notifyOnWorkflowError: true } });

        const validation = engine.validateProperties({ notifyOnWorkflowError: false });
        expect(validation).toMatchObject({ ok: true });
        expect(engine.settings.notifyOnWorkflowError).toBe(true);

        if (!validation.ok) throw new Error(validation.error);
        const status = engine.applyProperties(validation.properties);

        expect(status).toEqual({
            applied: { notifyOnWorkflowError: false },
            restartRequired: [],
        });
        expect(engine.settings.notifyOnWorkflowError).toBe(false);
        engine.dispose();
    });

    it('keeps restart-required values unchanged in-process while reporting them', () => {
        const engine = createEngine({ properties: { databasePath: ':memory:' } });

        const validation = engine.validateProperties({
            databasePath: 'C:/sigil-after-restart.db',
            notifyOnWorkflowError: false,
        });
        expect(validation.ok).toBe(true);
        if (!validation.ok) throw new Error(validation.error);

        const status = engine.applyProperties(validation.properties);

        expect(status).toEqual({
            applied: { notifyOnWorkflowError: false },
            restartRequired: ['databasePath'],
        });
        expect(engine.settings.notifyOnWorkflowError).toBe(false);
        expect(engine.settings.properties?.databasePath).toBe(':memory:');
        engine.dispose();
    });

    it('reports invalid Properties without changing the running Engine', () => {
        const engine = createEngine({ properties: { notifyOnWorkflowError: true } });

        const validation = engine.validateProperties({ notifyOnWorkflowError: 'not-a-boolean' });

        expect(validation).toMatchObject({
            ok: false,
            kind: 'validation',
        });
        expect(engine.settings.notifyOnWorkflowError).toBe(true);
        engine.dispose();
    });

    it('uses :memory: for the database when no databasePath is provided', () => {
        const engine = createEngine();
        expect(engine.workflowStateStore).toBeDefined();
        engine.dispose();
    });

    it('exposes a handler registry with built-in Plugin handlers after loadBuiltinPlugins', async () => {
        const engine = createEngine();

        expect(engine.handlerRegistry.has('manual-trigger')).toBe(true);
        expect(engine.handlerRegistry.has('file-watcher')).toBe(false);
        expect(engine.handlerRegistry.has('file-manager')).toBe(false);

        await engine.loadBuiltinPlugins();

        expect(engine.handlerRegistry.has('file-watcher')).toBe(true);
        expect(engine.handlerRegistry.has('file-manager')).toBe(true);
        expect(engine.registry.has('com.sigil.file-watcher')).toBe(true);
        expect(engine.registry.has('com.sigil.file-manager')).toBe(true);
        engine.dispose();
    });

    it('loadBuiltinPlugins is idempotent (duplicate_type rejection)', async () => {
        const engine = createEngine();

        const first = await engine.loadBuiltinPlugins();
        expect(first.filter((r) => r.ok)).toHaveLength(2);

        const second = await engine.loadBuiltinPlugins();
        expect(second.filter((r) => r.ok)).toHaveLength(0);

        expect(engine.registry.all()).toHaveLength(2);
        engine.dispose();
    });
});

describe('createEngine — databasePath from properties', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-engine-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('opens the SQLite file at the databasePath from properties', () => {
        const dbPath = join(tempDir, 'from-properties.db');
        const engine = createEngine({ properties: { databasePath: dbPath } });
        engine.workflowStateStore.forWorkflow('wf').set('k', 'persisted');
        engine.workflowStateStore.flushAll();
        engine.dispose();

        const reader = createEngine({ properties: { databasePath: dbPath } });
        expect(Option.getOrThrow(reader.workflowStateStore.forWorkflow('wf').get('k'))).toBe(
            'persisted',
        );
        reader.dispose();
    });

    it('falls back to defaultDatabasePath when properties omit databasePath', () => {
        const dbPath = join(tempDir, 'from-default.db');
        const engine = createEngine({
            properties: {},
            defaultDatabasePath: dbPath,
        });
        engine.workflowStateStore.forWorkflow('wf').set('k', 'default-used');
        engine.workflowStateStore.flushAll();
        engine.dispose();

        const reader = createEngine({
            properties: {},
            defaultDatabasePath: dbPath,
        });
        expect(Option.getOrThrow(reader.workflowStateStore.forWorkflow('wf').get('k'))).toBe(
            'default-used',
        );
        reader.dispose();
    });

    it('preserves defaultDatabasePath when properties validation fails', () => {
        const dbPath = join(tempDir, 'from-default-after-invalid-properties.db');
        const engine = createEngine({
            properties: { databasePath: 42 },
            defaultDatabasePath: dbPath,
        });
        engine.workflowStateStore.forWorkflow('wf').set('k', 'default-used');
        engine.workflowStateStore.flushAll();
        engine.dispose();

        const reader = createEngine({ properties: {}, defaultDatabasePath: dbPath });
        expect(Option.getOrThrow(reader.workflowStateStore.forWorkflow('wf').get('k'))).toBe(
            'default-used',
        );
        reader.dispose();
    });

    it('an explicit databasePath in properties wins over defaultDatabasePath', () => {
        const explicit = join(tempDir, 'explicit.db');
        const fallback = join(tempDir, 'fallback.db');
        const engine = createEngine({
            properties: { databasePath: explicit },
            defaultDatabasePath: fallback,
        });
        engine.workflowStateStore.forWorkflow('wf').set('k', 'explicit-wins');
        engine.workflowStateStore.flushAll();
        engine.dispose();

        const fromExplicit = createEngine({ properties: { databasePath: explicit } });
        expect(Option.getOrThrow(fromExplicit.workflowStateStore.forWorkflow('wf').get('k'))).toBe(
            'explicit-wins',
        );
        fromExplicit.dispose();

        const fromFallback = createEngine({ properties: { databasePath: fallback } });
        expect(Option.isNone(fromFallback.workflowStateStore.forWorkflow('wf').get('k'))).toBe(
            true,
        );
        fromFallback.dispose();
    });

    it('resolves builtinPluginsDir and loads file-manager and file-watcher', async () => {
        const engine = createEngine();

        const results = await engine.loadBuiltinPlugins();

        const successes = results.filter((r) => r.ok);
        expect(successes.length).toBeGreaterThanOrEqual(2);

        expect(engine.handlerRegistry.has('file-manager')).toBe(true);
        expect(engine.handlerRegistry.has('file-watcher')).toBe(true);
        expect(engine.registry.has('com.sigil.file-manager')).toBe(true);
        expect(engine.registry.has('com.sigil.file-watcher')).toBe(true);

        const manifests = engine.registry.all();
        const ids = manifests.map((m) => m.id);
        expect(ids).toContain('com.sigil.file-manager');
        expect(ids).toContain('com.sigil.file-watcher');

        engine.dispose();
    });
});

describe('createEngine — file-watcher Properties File defaults', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-file-watcher-properties-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('uses explicit Node ignorePatterns over the Properties File and applies the Properties File when omitted', async () => {
        const engine = createEngine({
            properties: { 'file-watcher.ignorePatterns': ['*.properties'] },
        });
        let teardown: (() => void) | undefined;

        try {
            const contexts: WorkflowContext[] = [];
            teardown = await activateFileWatcher(
                engine,
                {
                    path: tempDir,
                    recursive: false,
                    events: ['file.created'],
                    ignorePatterns: ['*.explicit'],
                },
                contexts,
            );

            writeFileSync(join(tempDir, 'ignored.explicit'), 'ignored');
            writeFileSync(join(tempDir, 'accepted.properties'), 'accepted');
            await vi.waitFor(() => {
                expect(contexts.map((context) => context.payload.name)).toContain(
                    'accepted.properties',
                );
            });
            await waitForFileWatcherQuiescence();
            expect(contexts.map((context) => context.payload.name)).not.toContain(
                'ignored.explicit',
            );

            teardown();
            teardown = undefined;
            await vi.waitFor(() => {
                expect(engine.fileWatcherManager.getSubscriberCount()).toBe(0);
            });

            const omittedConfigContexts: WorkflowContext[] = [];
            teardown = await activateFileWatcher(
                engine,
                { path: tempDir, recursive: false, events: ['file.created'] },
                omittedConfigContexts,
            );

            writeFileSync(join(tempDir, 'ignored.properties'), 'ignored');
            writeFileSync(join(tempDir, 'accepted.txt'), 'accepted');
            await vi.waitFor(() => {
                expect(omittedConfigContexts.map((context) => context.payload.name)).toContain(
                    'accepted.txt',
                );
            });
            await waitForFileWatcherQuiescence();
            expect(omittedConfigContexts.map((context) => context.payload.name)).not.toContain(
                'ignored.properties',
            );
        } finally {
            teardown?.();
            engine.dispose();
        }
    });

    it('uses the hardcoded fallback when the Properties File is absent and applies a changed value after Engine recreation', async () => {
        const firstEngine = createEngine({ properties: {} });
        let firstTeardown: (() => void) | undefined;

        try {
            const firstContexts: WorkflowContext[] = [];
            firstTeardown = await activateFileWatcher(
                firstEngine,
                { path: tempDir, recursive: false, events: ['file.created'] },
                firstContexts,
            );

            writeFileSync(join(tempDir, 'ignored.tmp'), 'ignored');
            writeFileSync(join(tempDir, 'accepted.txt'), 'accepted');
            await vi.waitFor(() => {
                expect(firstContexts.map((context) => context.payload.name)).toContain(
                    'accepted.txt',
                );
            });
            await waitForFileWatcherQuiescence();
            expect(firstContexts.map((context) => context.payload.name)).not.toContain(
                'ignored.tmp',
            );

            firstTeardown();
            firstTeardown = undefined;
            await vi.waitFor(() => {
                expect(firstEngine.fileWatcherManager.getSubscriberCount()).toBe(0);
            });
        } finally {
            firstTeardown?.();
            firstEngine.dispose();
        }

        const secondEngine = createEngine({
            properties: { 'file-watcher.ignorePatterns': ['*.custom'] },
        });
        let secondTeardown: (() => void) | undefined;

        try {
            const secondContexts: WorkflowContext[] = [];
            secondTeardown = await activateFileWatcher(
                secondEngine,
                { path: tempDir, recursive: false, events: ['file.created'] },
                secondContexts,
            );

            writeFileSync(join(tempDir, 'accepted.tmp'), 'accepted');
            writeFileSync(join(tempDir, 'ignored.custom'), 'ignored');
            await vi.waitFor(() => {
                expect(secondContexts.map((context) => context.payload.name)).toContain(
                    'accepted.tmp',
                );
            });
            await waitForFileWatcherQuiescence();
            expect(secondContexts.map((context) => context.payload.name)).not.toContain(
                'ignored.custom',
            );
        } finally {
            secondTeardown?.();
            secondEngine.dispose();
        }
    });
});

describe('createEngine — file-manager Properties File defaults', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-file-manager-properties-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('applies defaultOnConflict when the Node omits onConflict', async () => {
        const sourceDir = join(tempDir, 'source');
        const destinationDir = join(tempDir, 'destination');
        mkdirSync(sourceDir);
        mkdirSync(destinationDir);
        const sourcePath = join(sourceDir, 'report.txt');
        const destinationPath = join(destinationDir, 'report.txt');
        writeFileSync(sourcePath, 'new content');
        writeFileSync(destinationPath, 'existing content');

        const engine = createEngine({
            properties: { 'file-manager.defaultOnConflict': 'skip' },
        });

        try {
            await engine.loadBuiltinPlugins();

            const parsed = parsePipeline(
                fileManagerWorkflow(sourcePath, 'report.txt', sourceDir, {
                    action: 'move',
                    destination: destinationDir,
                }),
            );

            expect(parsed.ok).toBe(true);
            if (!parsed.ok) return;

            const result = await engine.execute(parsed.value);

            expect(result.outcome).toBe('succeeded');
            expect(existsSync(sourcePath)).toBe(true);
            expect(readFileSync(destinationPath, 'utf-8')).toBe('existing content');
        } finally {
            engine.dispose();
        }
    });

    it('lets an explicit Node conflict policy override the Properties File', async () => {
        const sourceDir = join(tempDir, 'source');
        const destinationDir = join(tempDir, 'destination');
        mkdirSync(sourceDir);
        mkdirSync(destinationDir);
        const sourcePath = join(sourceDir, 'report.txt');
        const destinationPath = join(destinationDir, 'report.txt');
        writeFileSync(sourcePath, 'new content');
        writeFileSync(destinationPath, 'existing content');

        const engine = createEngine({
            properties: { 'file-manager.defaultOnConflict': 'skip' },
        });

        try {
            await engine.loadBuiltinPlugins();
            const parsed = parsePipeline(
                fileManagerWorkflow(sourcePath, 'report.txt', sourceDir, {
                    action: 'move',
                    destination: destinationDir,
                    onConflict: 'error',
                }),
            );

            expect(parsed.ok).toBe(true);
            if (!parsed.ok) return;

            const result = await engine.execute(parsed.value);

            expect(result.outcome).toBe('failed');
            expect(existsSync(sourcePath)).toBe(true);
            expect(readFileSync(destinationPath, 'utf-8')).toBe('existing content');
        } finally {
            engine.dispose();
        }
    });

    it('uses the hardcoded conflict fallback when the Node and Properties File omit it', async () => {
        const sourceDir = join(tempDir, 'source');
        const destinationDir = join(tempDir, 'destination');
        mkdirSync(sourceDir);
        mkdirSync(destinationDir);
        const sourcePath = join(sourceDir, 'report.txt');
        const destinationPath = join(destinationDir, 'report.txt');
        writeFileSync(sourcePath, 'new content');
        writeFileSync(destinationPath, 'existing content');

        const engine = createEngine({ properties: {} });

        try {
            await engine.loadBuiltinPlugins();
            const parsed = parsePipeline(
                fileManagerWorkflow(sourcePath, 'report.txt', sourceDir, {
                    action: 'move',
                    destination: destinationDir,
                }),
            );

            expect(parsed.ok).toBe(true);
            if (!parsed.ok) return;

            const result = await engine.execute(parsed.value);

            expect(result.outcome).toBe('failed');
            expect(existsSync(sourcePath)).toBe(true);
            expect(readFileSync(destinationPath, 'utf-8')).toBe('existing content');
        } finally {
            engine.dispose();
        }
    });

    it('uses the file-manager suffix style over the engine-wide style for auto-rename', async () => {
        const sourceDir = join(tempDir, 'source');
        mkdirSync(sourceDir);
        const sourcePath = join(sourceDir, 'source.txt');
        const collisionPath = join(sourceDir, 'target.txt');
        const scopedPath = join(sourceDir, 'target-2.txt');
        writeFileSync(sourcePath, 'new content');
        writeFileSync(collisionPath, 'existing content');

        const engine = createEngine({
            properties: {
                collisionSuffixStyle: 'underscore',
                'file-manager.collisionSuffixStyle': 'hyphen',
            },
        });

        try {
            await engine.loadBuiltinPlugins();
            const parsed = parsePipeline(
                fileManagerWorkflow(sourcePath, 'source.txt', sourceDir, {
                    action: 'rename',
                    destination: 'target.txt',
                    onConflict: 'auto-rename',
                }),
            );

            expect(parsed.ok).toBe(true);
            if (!parsed.ok) return;

            const result = await engine.execute(parsed.value);

            expect(result.outcome).toBe('succeeded');
            expect(existsSync(sourcePath)).toBe(false);
            expect(existsSync(scopedPath)).toBe(true);
            expect(existsSync(join(sourceDir, 'target_2.txt'))).toBe(false);
        } finally {
            engine.dispose();
        }
    });

    it('uses the engine-wide suffix style when the file-manager style is absent', async () => {
        const sourceDir = join(tempDir, 'source');
        mkdirSync(sourceDir);
        const sourcePath = join(sourceDir, 'source.txt');
        const collisionPath = join(sourceDir, 'target.txt');
        const engineStylePath = join(sourceDir, 'target_2.txt');
        writeFileSync(sourcePath, 'new content');
        writeFileSync(collisionPath, 'existing content');

        const engine = createEngine({
            properties: { collisionSuffixStyle: 'underscore' },
        });

        try {
            await engine.loadBuiltinPlugins();
            const parsed = parsePipeline(
                fileManagerWorkflow(sourcePath, 'source.txt', sourceDir, {
                    action: 'rename',
                    destination: 'target.txt',
                    onConflict: 'auto-rename',
                }),
            );

            expect(parsed.ok).toBe(true);
            if (!parsed.ok) return;

            const result = await engine.execute(parsed.value);

            expect(result.outcome).toBe('succeeded');
            expect(existsSync(engineStylePath)).toBe(true);
            expect(existsSync(join(sourceDir, 'target (2).txt'))).toBe(false);
        } finally {
            engine.dispose();
        }
    });
});
