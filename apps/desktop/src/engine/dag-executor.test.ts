import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledPipeline } from '@sigil/schema';
import type { PipelineEdge } from '@sigil/schema/edges';
import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import type { PipelineNode } from '@sigil/schema/nodes';
import { sampleManualTriggerToLog } from '@sigil/schema/samples';
import Database from 'better-sqlite3';
import { Either, Option } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CapabilityBroker } from './capability-broker.js';
import { type ExecutorSettings, executePipeline } from './dag-executor.js';
import type { BusEvent } from './event-bus.js';
import { createEventBus } from './event-bus.js';
import { createBuiltinHandlers } from './node-handlers/registry.js';
import { createNodeHandlerRegistry } from './node-registry.js';
import { createWorkflowStateStore } from './workflow-state.js';

function captureEvents(bus: ReturnType<typeof createEventBus>): BusEvent[] {
    const events: BusEvent[] = [];
    bus.subscribe((event) => {
        events.push(event);
    });
    return events;
}

const payload: FileEventPayload = {
    path: '/Users/dev/Downloads/report.pdf',
    name: 'report.pdf',
    ext: 'pdf',
    size: 2048576,
    dir: '/Users/dev/Downloads',
};

const trigger = (id = 'trigger'): PipelineNode => ({
    id,
    type: 'manual-trigger',
    config: { eventName: 'file.created', payload },
});
const log = (id: string, message: string): PipelineNode => ({
    id,
    type: 'log',
    config: { message },
});
const edge = (id: string, source: string, target: string, sourcePort: string): PipelineEdge => ({
    id,
    source,
    target,
    sourcePort,
});
const pipeline = (
    nodes: readonly PipelineNode[],
    edges: readonly PipelineEdge[],
): CompiledPipeline => ({
    id: 'test-pipeline',
    workflowId: 'test-workflow',
    schemaVersion: 1,
    nodes: [...nodes],
    edges: [...edges],
});

describe('dag-executor', () => {
    let handlerRegistry: ReturnType<typeof createNodeHandlerRegistry>;

    beforeEach(() => {
        handlerRegistry = createNodeHandlerRegistry(createBuiltinHandlers());
    });

    describe('executePipeline — tracer sample', () => {
        it('emits a log.output event with the rendered sample message', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(sampleManualTriggerToLog, bus, handlerRegistry);

            const logEvent = events.find((event) => event.name === 'log.output');
            expect(logEvent).toBeDefined();
            expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
                'Manual trigger fired for report.pdf (2048576 bytes)',
            );
        });

        it('emits workflow lifecycle and trigger events in order', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(sampleManualTriggerToLog, bus, handlerRegistry);

            expect(events.map((event) => event.name)).toEqual([
                'workflow.started',
                'manual.trigger.fired',
                'log.output',
                'workflow.completed',
            ]);
        });

        it('fires the manual trigger with the payload from the node config', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(sampleManualTriggerToLog, bus, handlerRegistry);

            const triggerEvent = events.find((event) => event.name === 'manual.trigger.fired');
            expect(triggerEvent?.name === 'manual.trigger.fired' && triggerEvent.payload).toEqual(
                payload,
            );
        });
    });

    describe('executePipeline — if/else branching', () => {
        const branchPipeline = (conditionValue: string): CompiledPipeline =>
            pipeline(
                [
                    trigger(),
                    {
                        id: 'branch',
                        type: 'if-else',
                        config: {
                            condition: {
                                target: 'payload',
                                field: 'ext',
                                operator: 'equals',
                                value: conditionValue,
                            },
                        },
                    },
                    log('true-log', 'took the TRUE branch'),
                    log('false-log', 'took the FALSE branch'),
                ],
                [
                    edge('t-to-branch', 'trigger', 'branch', 'out'),
                    edge('branch-to-true', 'branch', 'true-log', 'true'),
                    edge('branch-to-false', 'branch', 'false-log', 'false'),
                ],
            );

        it('runs only the true branch when the condition matches', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(branchPipeline('pdf'), bus, handlerRegistry);

            const messages = events
                .filter((event) => event.name === 'log.output')
                .map((event) => (event.name === 'log.output' ? event.payload.message : ''));
            expect(messages).toEqual(['took the TRUE branch']);
        });

        it('runs only the false branch when the condition does not match', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(branchPipeline('png'), bus, handlerRegistry);

            const messages = events
                .filter((event) => event.name === 'log.output')
                .map((event) => (event.name === 'log.output' ? event.payload.message : ''));
            expect(messages).toEqual(['took the FALSE branch']);
        });
    });

    describe('executePipeline — switch branching', () => {
        const switchPipeline = (cases: readonly string[]): CompiledPipeline =>
            pipeline(
                [
                    trigger(),
                    {
                        id: 'sw',
                        type: 'switch',
                        config: { target: 'payload', field: 'ext', cases: [...cases] },
                    },
                    log('pdf-log', 'routed to PDF'),
                    log('png-log', 'routed to PNG'),
                    log('default-log', 'routed to DEFAULT'),
                ],
                [
                    edge('t-to-sw', 'trigger', 'sw', 'out'),
                    ...cases.map((caseLabel, index) =>
                        edge(
                            `sw-to-${caseLabel}`,
                            'sw',
                            index === 0 ? 'pdf-log' : 'png-log',
                            caseLabel,
                        ),
                    ),
                    edge('sw-to-default', 'sw', 'default-log', 'default'),
                ],
            );

        it('routes to the matching case port', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(switchPipeline(['pdf', 'png']), bus, handlerRegistry);

            const messages = events
                .filter((event) => event.name === 'log.output')
                .map((event) => (event.name === 'log.output' ? event.payload.message : ''));
            expect(messages).toEqual(['routed to PDF']);
        });

        it('falls through to the default port when no case matches', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(switchPipeline(['jpg', 'png']), bus, handlerRegistry);

            const messages = events
                .filter((event) => event.name === 'log.output')
                .map((event) => (event.name === 'log.output' ? event.payload.message : ''));
            expect(messages).toEqual(['routed to DEFAULT']);
        });
    });

    describe('executePipeline — fan-out', () => {
        it('schedules every downstream node on a single output port, in topological order', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [trigger(), log('log-a', 'A'), log('log-b', 'B'), log('log-c', 'C')],
                    [
                        edge('t-to-a', 'trigger', 'log-a', 'out'),
                        edge('t-to-b', 'trigger', 'log-b', 'out'),
                        edge('a-to-c', 'log-a', 'log-c', 'out'),
                    ],
                ),
                bus,
                handlerRegistry,
            );

            const messages = events
                .filter((event) => event.name === 'log.output')
                .map((event) => (event.name === 'log.output' ? event.payload.message : ''));
            expect(messages).toEqual(['A', 'B', 'C']);
        });
    });

    describe('executePipeline — delay', () => {
        it('awaits the configured delay before continuing', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);
            const sleepCalls: number[] = [];
            const fakeSleep = (ms: number): Promise<void> => {
                sleepCalls.push(ms);
                return Promise.resolve();
            };

            await executePipeline(
                pipeline(
                    [
                        trigger(),
                        { id: 'wait', type: 'delay', config: { ms: 50 } },
                        log('after', 'ran after delay'),
                    ],
                    [
                        edge('t-to-wait', 'trigger', 'wait', 'out'),
                        edge('wait-to-after', 'wait', 'after', 'out'),
                    ],
                ),
                bus,
                handlerRegistry,
                undefined,
                fakeSleep,
            );

            expect(sleepCalls).toEqual([50]);
            expect(events.map((event) => event.name)).toEqual([
                'workflow.started',
                'manual.trigger.fired',
                'log.output',
                'workflow.completed',
            ]);
        });
    });

    describe('executePipeline — notification', () => {
        it('emits a notification.show event with interpolated title and body', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [
                        trigger(),
                        {
                            id: 'notify',
                            type: 'notification',
                            config: {
                                title: 'Sorted {{payload.name}}',
                                body: 'Moved {{payload.size}} bytes',
                            },
                        },
                    ],
                    [edge('t-to-notify', 'trigger', 'notify', 'out')],
                ),
                bus,
                handlerRegistry,
            );

            const notificationEvent = events.find((event) => event.name === 'notification.show');
            expect(notificationEvent).toBeDefined();
            expect(
                notificationEvent?.name === 'notification.show' && notificationEvent.payload,
            ).toEqual({ title: 'Sorted report.pdf', body: 'Moved 2048576 bytes' });
        });
    });

    describe('executePipeline — context pass-through', () => {
        it('carries the event context through if-else and delay unchanged to a downstream log', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);
            const fakeSleep = (): Promise<void> => Promise.resolve();

            await executePipeline(
                pipeline(
                    [
                        trigger(),
                        {
                            id: 'branch',
                            type: 'if-else',
                            config: {
                                condition: {
                                    target: 'payload',
                                    field: 'ext',
                                    operator: 'equals',
                                    value: 'pdf',
                                },
                            },
                        },
                        { id: 'wait', type: 'delay', config: { ms: 1 } },
                        log('final', 'file is {{payload.name}} ({{payload.ext}})'),
                    ],
                    [
                        edge('t-to-branch', 'trigger', 'branch', 'out'),
                        edge('branch-to-wait', 'branch', 'wait', 'true'),
                        edge('wait-to-final', 'wait', 'final', 'out'),
                    ],
                ),
                bus,
                handlerRegistry,
                undefined,
                fakeSleep,
            );

            const logEvent = events.find((event) => event.name === 'log.output');
            expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
                'file is report.pdf (pdf)',
            );
        });
    });

    describe('executePipeline — error handling', () => {
        const errorPipeline = (): CompiledPipeline =>
            pipeline(
                [
                    trigger(),
                    { id: 'wait', type: 'delay', config: { ms: 50 } },
                    log('after', 'should not run'),
                ],
                [
                    edge('t-to-wait', 'trigger', 'wait', 'out'),
                    edge('wait-to-after', 'wait', 'after', 'out'),
                ],
            );

        const failingSleep = (): Promise<void> => Promise.reject(new Error('delay failed'));

        it('fires a workflow.error event and stops gracefully when a node throws', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(errorPipeline(), bus, handlerRegistry, undefined, failingSleep);

            const errorEvent = events.find((event) => event.name === 'workflow.error');
            expect(errorEvent).toBeDefined();
            expect(errorEvent?.name === 'workflow.error' && errorEvent.payload.nodeId).toBe('wait');

            expect(
                events.some(
                    (event) =>
                        event.name === 'log.output' && event.payload.message === 'should not run',
                ),
            ).toBe(false);
            expect(events[events.length - 1]?.name).toBe('workflow.completed');
        });

        it('emits a default error notification when notifyOnWorkflowError is true', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);
            const settings: ExecutorSettings = {
                notifyOnWorkflowError: true,
                collisionSuffixStyle: 'windows',
            };

            await executePipeline(errorPipeline(), bus, handlerRegistry, settings, failingSleep);

            const notificationEvent = events.find((event) => event.name === 'notification.show');
            expect(notificationEvent).toBeDefined();
        });

        it('suppresses the error notification when notifyOnWorkflowError is false', async () => {
            const bus = createEventBus();
            const events = captureEvents(bus);
            const settings: ExecutorSettings = {
                notifyOnWorkflowError: false,
                collisionSuffixStyle: 'windows',
            };

            await executePipeline(errorPipeline(), bus, handlerRegistry, settings, failingSleep);

            expect(events.some((event) => event.name === 'notification.show')).toBe(false);
            expect(events.some((event) => event.name === 'workflow.error')).toBe(true);
        });
    });

    describe('executePipeline — workflow state', () => {
        const stateSet = (id: string, key: string, valueTemplate: string): PipelineNode => ({
            id,
            type: 'state-set',
            config: { key, valueTemplate },
        });
        const stateGet = (id: string, key: string, assignTo: string): PipelineNode => ({
            id,
            type: 'state-get',
            config: { key, assignTo },
        });

        it('makes a buffered state-set visible to a state-get within the same run', async () => {
            const database = new Database(':memory:');
            const store = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [
                        trigger(),
                        stateSet('set', 'last-file', '{{payload.name}}'),
                        stateGet('get', 'last-file', 'remembered'),
                        log('recall', 'remembered {{vars.remembered}}'),
                    ],
                    [
                        edge('t-to-set', 'trigger', 'set', 'out'),
                        edge('set-to-get', 'set', 'get', 'out'),
                        edge('get-to-recall', 'get', 'recall', 'out'),
                    ],
                ),
                bus,
                handlerRegistry,
                undefined,
                undefined,
                store,
            );

            const logEvent = events.find((event) => event.name === 'log.output');
            expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
                'remembered report.pdf',
            );

            store.dispose();
            database.close();
        });

        it('persists state across executions via flush-on-completion', async () => {
            const database = new Database(':memory:');
            const store = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [trigger(), stateSet('set', 'counter', '{{payload.name}}')],
                    [edge('t-to-set', 'trigger', 'set', 'out')],
                ),
                bus,
                handlerRegistry,
                undefined,
                undefined,
                store,
            );

            const reader = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });
            expect(Option.getOrThrow(reader.forWorkflow('test-workflow').get('counter'))).toBe(
                'report.pdf',
            );
            reader.dispose();

            await executePipeline(
                pipeline(
                    [
                        trigger(),
                        stateGet('get', 'counter', 'loaded'),
                        log('recall', 'loaded {{vars.loaded}}'),
                    ],
                    [
                        edge('t-to-get', 'trigger', 'get', 'out'),
                        edge('get-to-recall', 'get', 'recall', 'out'),
                    ],
                ),
                bus,
                handlerRegistry,
                undefined,
                undefined,
                store,
            );

            const recall = events.find((event) => event.name === 'log.output');
            expect(recall?.name === 'log.output' && recall.payload.message).toBe(
                'loaded report.pdf',
            );

            store.dispose();
            database.close();
        });

        it('preserves payload metadata downstream of a state-get', async () => {
            const database = new Database(':memory:');
            const store = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });
            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [
                        trigger(),
                        stateSet('set', 'last-file', '{{payload.name}}'),
                        stateGet('get', 'last-file', 'remembered'),
                        log('both', '{{payload.name}} -> {{vars.remembered}}'),
                    ],
                    [
                        edge('t-to-set', 'trigger', 'set', 'out'),
                        edge('set-to-get', 'set', 'get', 'out'),
                        edge('get-to-both', 'get', 'both', 'out'),
                    ],
                ),
                bus,
                handlerRegistry,
                undefined,
                undefined,
                store,
            );

            const logEvent = events.find((event) => event.name === 'log.output');
            expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
                'report.pdf -> report.pdf',
            );

            store.dispose();
            database.close();
        });

        it('flushes buffered writes on completion even when a downstream node errors', async () => {
            const database = new Database(':memory:');
            const store = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });
            const bus = createEventBus();
            const events = captureEvents(bus);
            const failingSleep = (): Promise<void> => Promise.reject(new Error('delay failed'));

            await executePipeline(
                pipeline(
                    [
                        trigger(),
                        stateSet('set', 'counter', '{{payload.name}}'),
                        { id: 'wait', type: 'delay', config: { ms: 1 } },
                        log('after', 'should not run'),
                    ],
                    [
                        edge('t-to-set', 'trigger', 'set', 'out'),
                        edge('set-to-wait', 'set', 'wait', 'out'),
                        edge('wait-to-after', 'wait', 'after', 'out'),
                    ],
                ),
                bus,
                handlerRegistry,
                undefined,
                failingSleep,
                store,
            );

            expect(events.some((event) => event.name === 'workflow.error')).toBe(true);
            const reader = createWorkflowStateStore(database, { flushIntervalMs: 60_000 });
            expect(Option.getOrThrow(reader.forWorkflow('test-workflow').get('counter'))).toBe(
                'report.pdf',
            );
            reader.dispose();

            store.dispose();
            database.close();
        });
    });

    describe('executePipeline — file-manager', () => {
        beforeEach(async () => {
            if (!handlerRegistry.has('file-manager')) {
                const mod = await import('../builtin-plugins/file-manager/handler.js');
                handlerRegistry.register('file-manager', mod.handler);
            }
        });

        function tmpDir(): string {
            const dir = join(tmpdir(), 'sigil-fm-dag-test', randomUUID());
            mkdirSync(dir, { recursive: true });
            return dir;
        }

        function touch(path: string, content = ''): void {
            writeFileSync(path, content, 'utf-8');
        }

        function allowAllBroker(): CapabilityBroker {
            return { request: () => Either.right(undefined) };
        }

        const fileManager = (
            id: string,
            action: 'move' | 'copy' | 'rename',
            destination: string,
            onConflict: 'skip' | 'overwrite' | 'auto-rename' | 'error',
        ): PipelineNode => ({
            id,
            type: 'file-manager',
            config: { action, destination, onConflict },
        });

        const triggerWithPayload = (payload: FileEventPayload, id = 'trigger'): PipelineNode => ({
            id,
            type: 'manual-trigger',
            config: { eventName: 'file.created' as const, payload },
        });

        it('moves a file through the DAG', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'src');
            const dstDir = join(dir, 'dst');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'moved-content');

            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [
                        triggerWithPayload({
                            path: srcPath,
                            name: 'file.txt',
                            ext: 'txt',
                            size: 12,
                            dir: srcDir,
                        }),
                        fileManager('fm', 'move', dstDir, 'overwrite'),
                    ],
                    [edge('t-to-fm', 'trigger', 'fm', 'out')],
                ),
                bus,
                handlerRegistry,
                undefined,
                undefined,
                undefined,
                allowAllBroker(),
            );

            expect(existsSync(srcPath)).toBe(false);
            expect(existsSync(join(dstDir, 'file.txt'))).toBe(true);
            expect(events.map((e) => e.name)).toEqual([
                'workflow.started',
                'manual.trigger.fired',
                'workflow.completed',
            ]);
        });

        it('copies a file through the DAG', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'src');
            const dstDir = join(dir, 'dst');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'copy-content');

            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [
                        triggerWithPayload({
                            path: srcPath,
                            name: 'file.txt',
                            ext: 'txt',
                            size: 12,
                            dir: srcDir,
                        }),
                        fileManager('fm', 'copy', dstDir, 'overwrite'),
                    ],
                    [edge('t-to-fm', 'trigger', 'fm', 'out')],
                ),
                bus,
                handlerRegistry,
                undefined,
                undefined,
                undefined,
                allowAllBroker(),
            );

            expect(existsSync(srcPath)).toBe(true);
            expect(existsSync(join(dstDir, 'file.txt'))).toBe(true);
            expect(events.map((e) => e.name)).toEqual([
                'workflow.started',
                'manual.trigger.fired',
                'workflow.completed',
            ]);
        });

        it('renames a file through the DAG', async () => {
            const dir = tmpDir();
            const srcPath = join(dir, 'old-name.txt');
            touch(srcPath, 'rename-content');

            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [
                        triggerWithPayload({
                            path: srcPath,
                            name: 'old-name.txt',
                            ext: 'txt',
                            size: 14,
                            dir,
                        }),
                        fileManager('fm', 'rename', 'new-name.txt', 'overwrite'),
                    ],
                    [edge('t-to-fm', 'trigger', 'fm', 'out')],
                ),
                bus,
                handlerRegistry,
                undefined,
                undefined,
                undefined,
                allowAllBroker(),
            );

            expect(existsSync(srcPath)).toBe(false);
            expect(existsSync(join(dir, 'new-name.txt'))).toBe(true);
            expect(events.map((e) => e.name)).toEqual([
                'workflow.started',
                'manual.trigger.fired',
                'workflow.completed',
            ]);
        });

        it('skip collision policy: keeps destination untouched through the DAG', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'src');
            const dstDir = join(dir, 'dst');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'new-content');
            const dstPath = join(dstDir, 'file.txt');
            touch(dstPath, 'existing-content');

            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [
                        triggerWithPayload({
                            path: srcPath,
                            name: 'file.txt',
                            ext: 'txt',
                            size: 11,
                            dir: srcDir,
                        }),
                        fileManager('fm', 'move', dstDir, 'skip'),
                    ],
                    [edge('t-to-fm', 'trigger', 'fm', 'out')],
                ),
                bus,
                handlerRegistry,
                undefined,
                undefined,
                undefined,
                allowAllBroker(),
            );

            expect(existsSync(srcPath)).toBe(true);
            expect(existsSync(dstPath)).toBe(true);
            expect(events.map((e) => e.name)).toEqual([
                'workflow.started',
                'manual.trigger.fired',
                'workflow.completed',
            ]);
        });

        it('error collision policy: emits workflow.error when destination exists', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'src');
            const dstDir = join(dir, 'dst');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'new-content');
            const dstPath = join(dstDir, 'file.txt');
            touch(dstPath, 'existing-content');

            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [
                        triggerWithPayload({
                            path: srcPath,
                            name: 'file.txt',
                            ext: 'txt',
                            size: 11,
                            dir: srcDir,
                        }),
                        fileManager('fm', 'move', dstDir, 'error'),
                    ],
                    [edge('t-to-fm', 'trigger', 'fm', 'out')],
                ),
                bus,
                handlerRegistry,
                undefined,
                undefined,
                undefined,
                allowAllBroker(),
            );

            const errorEvent = events.find((e) => e.name === 'workflow.error');
            expect(errorEvent).toBeDefined();
            expect(errorEvent?.name === 'workflow.error' && errorEvent.payload.nodeId).toBe('fm');
        });

        it('auto-rename collision policy: renames file through the DAG using collisionSuffixStyle from settings', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'src');
            const dstDir = join(dir, 'dst');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'auto-rename-content');
            const dstPath = join(dstDir, 'file.txt');
            touch(dstPath, 'existing-content');

            const bus = createEventBus();
            const events = captureEvents(bus);

            const settings: ExecutorSettings = {
                notifyOnWorkflowError: true,
                collisionSuffixStyle: 'underscore',
            };

            await executePipeline(
                pipeline(
                    [
                        triggerWithPayload({
                            path: srcPath,
                            name: 'file.txt',
                            ext: 'txt',
                            size: 19,
                            dir: srcDir,
                        }),
                        fileManager('fm', 'move', dstDir, 'auto-rename'),
                    ],
                    [edge('t-to-fm', 'trigger', 'fm', 'out')],
                ),
                bus,
                handlerRegistry,
                settings,
                undefined,
                undefined,
                allowAllBroker(),
            );

            expect(existsSync(srcPath)).toBe(false);
            expect(existsSync(dstPath)).toBe(true);
            expect(existsSync(join(dstDir, 'file_2.txt'))).toBe(true);
            expect(events.map((e) => e.name)).toEqual([
                'workflow.started',
                'manual.trigger.fired',
                'workflow.completed',
            ]);
        });

        it('default deny-all capability broker blocks file operations through the DAG', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'src');
            const dstDir = join(dir, 'dst');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'content');

            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [
                        triggerWithPayload({
                            path: srcPath,
                            name: 'file.txt',
                            ext: 'txt',
                            size: 7,
                            dir: srcDir,
                        }),
                        fileManager('fm', 'move', dstDir, 'overwrite'),
                    ],
                    [edge('t-to-fm', 'trigger', 'fm', 'out')],
                ),
                bus,
                handlerRegistry,
            );

            const errorEvent = events.find((e) => e.name === 'workflow.error');
            expect(errorEvent).toBeDefined();
            expect(errorEvent?.name === 'workflow.error' && errorEvent.payload.nodeId).toBe('fm');
        });

        it('propagates updated payload downstream through the DAG', async () => {
            const dir = tmpDir();
            const srcDir = join(dir, 'src');
            const dstDir = join(dir, 'dst');
            mkdirSync(srcDir);
            mkdirSync(dstDir);
            const srcPath = join(srcDir, 'file.txt');
            touch(srcPath, 'payload-test');

            const bus = createEventBus();
            const events = captureEvents(bus);

            await executePipeline(
                pipeline(
                    [
                        triggerWithPayload({
                            path: srcPath,
                            name: 'file.txt',
                            ext: 'txt',
                            size: 12,
                            dir: srcDir,
                        }),
                        fileManager('fm', 'move', dstDir, 'overwrite'),
                        log('log', 'new path is {{payload.path}}'),
                    ],
                    [
                        edge('t-to-fm', 'trigger', 'fm', 'out'),
                        edge('fm-to-log', 'fm', 'log', 'out'),
                    ],
                ),
                bus,
                handlerRegistry,
                undefined,
                undefined,
                undefined,
                allowAllBroker(),
            );

            const logEvent = events.find((e) => e.name === 'log.output');
            expect(logEvent).toBeDefined();
            expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
                `new path is ${join(dstDir, 'file.txt')}`,
            );
        });
    });
});
