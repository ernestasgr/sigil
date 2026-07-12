import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { describe, expect, it, vi } from 'vitest';

import {
    createWorkflowRunSupervisor,
    type WorkflowRunExecutionResult,
    type WorkflowRunLifecycleEvent,
} from './workflow-run-supervisor.js';

const context: WorkflowContext = { event: 'file.created', payload: {}, vars: {} };

function deferred<T>(): {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
} {
    let resolvePromise: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

function successful(): WorkflowRunExecutionResult {
    return { outcome: 'succeeded' };
}

describe('Workflow run supervisor', () => {
    it('runs serially and bounds a burst with a queue limit', async () => {
        const first = deferred<WorkflowRunExecutionResult>();
        const second = deferred<WorkflowRunExecutionResult>();
        const executions: string[] = [];
        const events: WorkflowRunLifecycleEvent[] = [];
        const supervisor = createWorkflowRunSupervisor({
            workflowId: 'workflow-1',
            pipelineId: 'pipeline-1',
            policy: { concurrency: 1, queueLimit: 1 },
            onEvent: (event) => events.push(event),
            execute: async ({ runId }) => {
                executions.push(runId);
                return executions.length === 1 ? first.promise : second.promise;
            },
            createRunId: (() => {
                let next = 1;
                return () => `run-${next++}`;
            })(),
        });

        const admitted = supervisor.submit(context);
        const queued = supervisor.submit(context);
        const dropped = supervisor.submit(context);

        expect(admitted.kind).toBe('started');
        expect(queued.kind).toBe('queued');
        expect(dropped).toMatchObject({ kind: 'dropped', reason: 'queue_full' });
        expect(executions).toEqual(['run-1']);
        expect(supervisor.activeCount()).toBe(1);
        expect(supervisor.queuedCount()).toBe(1);

        first.resolve(successful());
        await vi.waitFor(() => {
            expect(executions).toEqual(['run-1', 'run-2']);
        });

        expect(executions).toEqual(['run-1', 'run-2']);
        expect(supervisor.activeCount()).toBe(1);

        second.resolve(successful());
        await supervisor.waitForIdle();

        expect(supervisor.activeCount()).toBe(0);
        expect(supervisor.queuedCount()).toBe(0);
        expect(events.map((event) => event.kind)).toEqual([
            'started',
            'queued',
            'dropped',
            'finished',
            'started',
            'finished',
        ]);
    });

    it('cancels queued work immediately and aborts the active run', async () => {
        const events: WorkflowRunLifecycleEvent[] = [];
        let activeSignal: AbortSignal | undefined;
        const supervisor = createWorkflowRunSupervisor({
            workflowId: 'workflow-1',
            pipelineId: 'pipeline-1',
            policy: { concurrency: 1, queueLimit: 1 },
            onEvent: (event) => events.push(event),
            execute: ({ signal }) => {
                activeSignal = signal;
                return new Promise<WorkflowRunExecutionResult>((resolve) => {
                    signal.addEventListener(
                        'abort',
                        () => resolve({ outcome: 'cancelled', message: 'disabled' }),
                        { once: true },
                    );
                });
            },
            createRunId: (() => {
                let next = 1;
                return () => `run-${next++}`;
            })(),
        });

        supervisor.submit(context);
        supervisor.submit(context);
        const stopping = supervisor.cancel('disabled');

        expect(activeSignal?.aborted).toBe(true);
        expect(supervisor.accepting()).toBe(false);
        expect(supervisor.submit(context)).toMatchObject({
            kind: 'dropped',
            reason: 'not_accepting',
        });

        await stopping;

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'cancelled', phase: 'queued', reason: 'disabled' }),
                expect.objectContaining({
                    kind: 'finished',
                    outcome: expect.objectContaining({ outcome: 'cancelled' }),
                }),
            ]),
        );
        expect(supervisor.activeCount()).toBe(0);
        expect(supervisor.queuedCount()).toBe(0);
    });

    it('drains already-admitted work without accepting new events', async () => {
        const first = deferred<WorkflowRunExecutionResult>();
        const second = deferred<WorkflowRunExecutionResult>();
        const executions: string[] = [];
        const supervisor = createWorkflowRunSupervisor({
            workflowId: 'workflow-1',
            pipelineId: 'pipeline-1',
            policy: { concurrency: 1, queueLimit: 1 },
            execute: async ({ runId }) => {
                executions.push(runId);
                return executions.length === 1 ? first.promise : second.promise;
            },
            createRunId: (() => {
                let next = 1;
                return () => `run-${next++}`;
            })(),
        });

        supervisor.submit(context);
        supervisor.submit(context);
        const draining = supervisor.drain();

        expect(supervisor.accepting()).toBe(false);
        expect(supervisor.submit(context)).toMatchObject({
            kind: 'dropped',
            reason: 'not_accepting',
        });

        first.resolve(successful());
        await vi.waitFor(() => {
            expect(executions).toEqual(['run-1', 'run-2']);
        });

        second.resolve(successful());
        await draining;

        expect(supervisor.activeCount()).toBe(0);
        expect(supervisor.queuedCount()).toBe(0);
    });
});
