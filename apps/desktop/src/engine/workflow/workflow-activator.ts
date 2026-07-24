import { isPluginNode } from '@sigil/schema/nodes';
import type { ExecutableWorkflow } from '@sigil/schema/topology';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Option } from 'effect';

import type { WorkflowActivationState } from '../../shared/workflow.js';
import type { Engine } from '../core/engine.js';
import type { PermissionTransitionRunReconciler } from '../core/permission-transition.js';
import { createRunTelemetry } from '../events/telemetry.js';
import type { NodeHandlerRegistry } from '../execution/node-registry.js';
import { isTriggerHandler } from '../node-handlers/types.js';
import { acceptWorkflow } from './workflow-acceptance.js';
import {
    createWorkflowRunSupervisor,
    WORKFLOW_RUN_PERMISSION_REVOKED_REASON,
    type WorkflowRunLifecycleEvent,
    type WorkflowRunPolicy,
    type WorkflowRunSupervisor,
} from './workflow-run-supervisor.js';
import type { WorkflowStore } from './workflow-store.js';

export interface WorkflowActivator {
    readonly activate: (workflowId: string) => boolean;
    readonly deactivate: (workflowId: string) => boolean;
    readonly isActive: (workflowId: string) => boolean;
    readonly activeWorkflowIds: () => readonly string[];
    readonly hasInFlightRuns: (workflowId: string) => boolean;
    readonly waitForRuns: (workflowId: string) => Promise<void>;
    readonly waitForAllRuns: () => Promise<void>;
    readonly dispose: () => void;
}

export interface WorkflowActivatorOptions {
    readonly runPolicy?: Readonly<Partial<WorkflowRunPolicy>>;
}

type WorkflowEventCallback = (ctx: WorkflowContext) => void;

interface ActiveActivation {
    readonly token: number;
    readonly onEvent: WorkflowEventCallback;
    readonly teardown: () => void;
    readonly supervisor: WorkflowRunSupervisor;
    readonly executable: ExecutableWorkflow;
}

const deactivationHooks = new WeakMap<WorkflowEventCallback, (reason?: string) => void>();

export function getDeactivationHook(
    onEvent: WorkflowEventCallback,
): Option.Option<(reason?: string) => void> {
    return Option.fromNullable(deactivationHooks.get(onEvent));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function disabledState(): WorkflowActivationState {
    return { kind: 'disabled' };
}

export function createWorkflowActivator(
    engine: Engine,
    store: WorkflowStore,
    handlerRegistry: NodeHandlerRegistry,
    onStateChange?: () => void,
    options?: WorkflowActivatorOptions,
): WorkflowActivator {
    const active = new Map<string, ActiveActivation>();
    const stoppedRuns = new Map<
        string,
        readonly {
            readonly supervisor: WorkflowRunSupervisor;
            readonly promise: Promise<void>;
            readonly executable: ExecutableWorkflow;
        }[]
    >();
    let nextToken = 0;

    function setActivation(workflowId: string, activation: WorkflowActivationState): void {
        store.setActivation(workflowId, activation);
    }

    function emitDiagnostic(message: string, kind?: string): void {
        engine.bus.next({
            name: 'engine.diagnostic',
            payload: kind ? { kind, message } : { message },
        });
    }

    function recordFailure(
        workflowId: string,
        message: string,
        diagnostic: string,
        publishStateChange: boolean,
    ): void {
        setActivation(workflowId, { kind: 'failed', message });
        emitDiagnostic(diagnostic, 'workflow_activation');
        if (publishStateChange) onStateChange?.();
    }

    function teardownSafely(workflowId: string, name: string, teardown: () => void): void {
        try {
            teardown();
        } catch (error) {
            emitDiagnostic(
                `[activator] teardown failed for "${name}" (${workflowId}): ${errorMessage(error)}`,
                'workflow_activation',
            );
        }
    }

    function publishRunLifecycleEvent(
        event: WorkflowRunLifecycleEvent,
        supervisor: WorkflowRunSupervisor,
    ): void {
        const telemetry =
            event.kind === 'started' || event.kind === 'finished'
                ? undefined
                : createRunTelemetry(engine.bus, event.run);
        switch (event.kind) {
            case 'queued':
                telemetry?.emit(
                    {
                        name: 'workflow.queued',
                        payload: {
                            ...event.run,
                            queueSize: event.queueSize,
                            policy: supervisor.policy,
                            outcome: 'queued',
                        },
                    },
                    { kind: 'queue', outcome: 'queued' },
                );
                return;
            case 'dropped':
                telemetry?.emit(
                    {
                        name: 'workflow.dropped',
                        payload: {
                            ...event.run,
                            queueSize: event.queueSize,
                            policy: supervisor.policy,
                            reason: event.reason,
                            outcome: 'dropped',
                        },
                    },
                    { kind: 'queue', outcome: 'dropped', severity: 'warn' },
                );
                return;
            case 'cancelled':
                // An active run publishes its cancellation from the executor;
                // queued work has no executor to publish that terminal event.
                if (event.phase === 'queued') {
                    telemetry?.emit(
                        {
                            name: 'workflow.cancelled',
                            payload: {
                                ...event.run,
                                phase: event.phase,
                                reason: event.reason,
                                outcome: 'cancelled',
                            },
                        },
                        { kind: 'outcome', outcome: 'cancelled' },
                    );
                }
                return;
            case 'started':
            case 'finished':
                return;
            default:
                assertNever(event);
        }
    }

    function rememberStoppedRuns(
        workflowId: string,
        supervisor: WorkflowRunSupervisor,
        executable: ExecutableWorkflow,
        pending: Promise<readonly string[]>,
    ): void {
        const guarded = pending
            .then(() => undefined)
            .catch((error: unknown) => {
                emitDiagnostic(
                    `[activator] run supervisor shutdown failed for ${workflowId}: ${errorMessage(error)}`,
                    'workflow_run',
                );
            });
        const entry = { supervisor, promise: guarded, executable };
        stoppedRuns.set(workflowId, [...(stoppedRuns.get(workflowId) ?? []), entry]);
        void guarded.then(() => {
            const current = stoppedRuns.get(workflowId);
            if (!current) return;
            const remaining = current.filter((candidate) => candidate !== entry);
            if (remaining.length === 0) {
                stoppedRuns.delete(workflowId);
            } else {
                stoppedRuns.set(workflowId, remaining);
            }
        });
    }

    function stopRuns(
        workflowId: string,
        supervisor: WorkflowRunSupervisor,
        executable: ExecutableWorkflow,
        reason: string,
    ): Promise<readonly string[]> {
        const pending = supervisor.cancel(reason);
        rememberStoppedRuns(workflowId, supervisor, executable, pending);
        return pending;
    }

    const reconcilePermissionChange: PermissionTransitionRunReconciler = async (
        pluginId,
        manifestPermissions,
        effectivePermissions,
    ): Promise<readonly string[]> => {
        if (manifestPermissions.every((permission) => effectivePermissions.includes(permission))) {
            return [];
        }

        const supervisors = new Map<
            WorkflowRunSupervisor,
            { readonly workflowId: string; readonly executable: ExecutableWorkflow }
        >();
        for (const [workflowId, activation] of active) {
            supervisors.set(activation.supervisor, {
                workflowId,
                executable: activation.executable,
            });
        }
        for (const [workflowId, entries] of stoppedRuns) {
            for (const entry of entries) {
                supervisors.set(entry.supervisor, {
                    workflowId,
                    executable: entry.executable,
                });
            }
        }

        const affected = [...supervisors.entries()].filter(([, { executable }]) =>
            executable.pipeline.nodes.some(
                (node) => isPluginNode(node) && node.pluginId === pluginId,
            ),
        );
        const cancelled = await Promise.all(
            affected.map(([supervisor, { workflowId, executable }]) =>
                stopRuns(
                    workflowId,
                    supervisor,
                    executable,
                    WORKFLOW_RUN_PERMISSION_REVOKED_REASON,
                ),
            ),
        );
        return [...new Set(cancelled.flat())];
    };

    const unregisterPermissionTransitionReconciler =
        engine.registerPermissionTransitionReconciler(reconcilePermissionChange);

    function assertNever(value: never): never {
        throw new Error(`Unhandled Workflow run lifecycle event: ${JSON.stringify(value)}`);
    }

    return {
        activate(workflowId: string): boolean {
            if (active.has(workflowId)) return true;

            const data = store.get(workflowId);
            if (Option.isNone(data)) return false;

            setActivation(workflowId, { kind: 'activating' });

            const accepted = acceptWorkflow(
                data.value.executable,
                handlerRegistry,
                engine.contractRegistry,
            );
            if (!accepted.ok) {
                for (const diagnostic of accepted.diagnostics) {
                    engine.bus.next({
                        name: 'engine.diagnostic',
                        payload: {
                            kind: 'workflow_topology',
                            message: `[activator][topology:${diagnostic.code}] ${diagnostic.message}`,
                        },
                    });
                }
                const firstDiagnostic = accepted.diagnostics[0];
                recordFailure(
                    workflowId,
                    firstDiagnostic?.message ?? 'Workflow topology validation failed.',
                    `[activator] failed to activate workflow "${data.value.name}" (${workflowId}): workflow topology is invalid`,
                    false,
                );
                return false;
            }

            const executable = accepted.value;
            const trigger = executable.pipeline.nodes.find(
                (node) => node.id === executable.triggerId,
            );
            if (!trigger) {
                recordFailure(
                    workflowId,
                    'The executable Workflow has no Trigger node.',
                    `[activator] failed to activate workflow "${data.value.name}" (${workflowId}): trigger node is missing`,
                    false,
                );
                return false;
            }

            const handler = handlerRegistry.get(trigger.type);
            if (Option.isNone(handler)) {
                const message = `No handler registered for trigger type "${trigger.type}".`;
                recordFailure(
                    workflowId,
                    message,
                    `[activator] no handler registered for trigger type "${trigger.type}" on "${data.value.name}" (${workflowId}) — cannot activate`,
                    false,
                );
                return false;
            }

            if (!isTriggerHandler(handler.value)) {
                const message = `Node type "${trigger.type}" is not a Trigger.`;
                recordFailure(
                    workflowId,
                    message,
                    `[activator] node type "${trigger.type}" on "${data.value.name}" (${workflowId}) is not a trigger — cannot activate`,
                    false,
                );
                return false;
            }

            const token = nextToken++;
            let supervisor: WorkflowRunSupervisor | undefined;
            const onEvent: WorkflowEventCallback = (ctx): void => {
                supervisor?.submit(ctx);
            };

            supervisor = createWorkflowRunSupervisor({
                workflowId,
                pipelineId: executable.pipeline.id,
                policy: options?.runPolicy,
                onEvent: (event) => {
                    if (supervisor) publishRunLifecycleEvent(event, supervisor);
                },
                execute: (run) =>
                    engine.execute(executable, run.context, {
                        runId: run.runId,
                        workflowId,
                        signal: run.signal,
                    }),
            });

            engine.bus.next({
                name: 'engine.diagnostic',
                payload: {
                    kind: 'workflow_run_policy',
                    message: `[activator] workflow "${data.value.name}" (${workflowId}) run policy: ${supervisor.policy.concurrency === 1 ? 'serial' : 'parallel'} admission with concurrency=${supervisor.policy.concurrency}, queueLimit=${supervisor.policy.queueLimit}, overflow=${supervisor.policy.overflow}`,
                },
            });

            const handleActivationFailure = (reason?: string): void => {
                const current = active.get(workflowId);
                if (!current || current.token !== token) return;

                active.delete(workflowId);
                deactivationHooks.delete(onEvent);
                stopRuns(
                    workflowId,
                    current.supervisor,
                    current.executable,
                    reason ?? 'Trigger activation failed.',
                );
                teardownSafely(workflowId, data.value.name, current.teardown);
                try {
                    recordFailure(
                        workflowId,
                        reason ?? 'The Trigger worker failed during activation.',
                        `[activator] trigger "${trigger.type}" disabled for "${data.value.name}" (${workflowId}) — activation failed in worker${reason ? `: ${reason}` : ''}`,
                        true,
                    );
                } catch (failure) {
                    emitDiagnostic(
                        `[activator] failed to persist asynchronous activation failure for "${data.value.name}" (${workflowId}): ${errorMessage(failure)}`,
                        'workflow_activation',
                    );
                }
            };
            deactivationHooks.set(onEvent, handleActivationFailure);

            let teardown: (() => void) | undefined;
            try {
                teardown = handler.value.activate(trigger.config, onEvent);
                active.set(workflowId, { token, onEvent, teardown, supervisor, executable });
                setActivation(workflowId, { kind: 'active' });
                emitDiagnostic(
                    `[activator] trigger "${trigger.type}" active for "${data.value.name}" (${workflowId})`,
                    'workflow_activation',
                );
                return true;
            } catch (err) {
                const current = active.get(workflowId);
                active.delete(workflowId);
                deactivationHooks.delete(onEvent);
                stopRuns(workflowId, supervisor, executable, 'Trigger activation failed.');
                if (current) {
                    teardownSafely(workflowId, data.value.name, current.teardown);
                } else if (teardown) {
                    teardownSafely(workflowId, data.value.name, teardown);
                }
                try {
                    recordFailure(
                        workflowId,
                        errorMessage(err),
                        `[activator] failed to activate trigger "${trigger.type}" for "${data.value.name}" (${workflowId}): ${errorMessage(err)}`,
                        false,
                    );
                } catch (failure) {
                    emitDiagnostic(
                        `[activator] failed to persist activation failure for "${data.value.name}" (${workflowId}): ${errorMessage(failure)}`,
                        'workflow_activation',
                    );
                }
                return false;
            }
        },

        deactivate(workflowId: string): boolean {
            const activation = active.get(workflowId);
            if (activation) {
                active.delete(workflowId);
                deactivationHooks.delete(activation.onEvent);
                stopRuns(
                    workflowId,
                    activation.supervisor,
                    activation.executable,
                    'Workflow disabled.',
                );
                teardownSafely(workflowId, workflowId, activation.teardown);
                setActivation(workflowId, disabledState());
                return true;
            }

            const summary = store.getSummary(workflowId);
            if (Option.isSome(summary) && summary.value.activation.kind !== 'disabled') {
                setActivation(workflowId, disabledState());
            }
            return false;
        },

        isActive(workflowId: string): boolean {
            return active.has(workflowId);
        },

        activeWorkflowIds(): readonly string[] {
            return [...active.keys()];
        },

        hasInFlightRuns(workflowId: string): boolean {
            const activation = active.get(workflowId);
            if (
                activation &&
                (activation.supervisor.activeCount() > 0 || activation.supervisor.queuedCount() > 0)
            ) {
                return true;
            }
            return (stoppedRuns.get(workflowId) ?? []).some(
                (entry) => entry.supervisor.activeCount() > 0 || entry.supervisor.queuedCount() > 0,
            );
        },

        waitForRuns(workflowId: string): Promise<void> {
            const activation = active.get(workflowId);
            const pending = stoppedRuns.get(workflowId) ?? [];
            return Promise.all([
                ...(activation ? [activation.supervisor.waitForIdle()] : []),
                ...pending.map((entry) => entry.promise),
            ]).then(() => undefined);
        },

        async waitForAllRuns(): Promise<void> {
            await Promise.all([
                ...[...active.values()].map((activation) => activation.supervisor.waitForIdle()),
                ...[...stoppedRuns.values()].flatMap((entries) =>
                    entries.map((entry) => entry.promise),
                ),
            ]);
        },

        dispose(): void {
            for (const workflowId of [...active.keys()]) {
                const activation = active.get(workflowId);
                if (activation) {
                    active.delete(workflowId);
                    deactivationHooks.delete(activation.onEvent);
                    stopRuns(
                        workflowId,
                        activation.supervisor,
                        activation.executable,
                        'Engine shutting down.',
                    );
                    teardownSafely(workflowId, workflowId, activation.teardown);
                }
                setActivation(workflowId, disabledState());
            }
            unregisterPermissionTransitionReconciler();
        },
    };
}
