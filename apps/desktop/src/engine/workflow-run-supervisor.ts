import { randomUUID } from 'node:crypto';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

/**
 * The default admission policy is deliberately conservative: one run at a
 * time, sixteen waiting runs, and drop-newest overflow. A Trigger can emit
 * indefinitely, so the queue must have a hard upper bound.
 */
export const DEFAULT_WORKFLOW_RUN_POLICY = {
    concurrency: 1,
    queueLimit: 16,
    overflow: 'drop-newest',
} as const;

export type WorkflowRunOutcome = 'succeeded' | 'failed' | 'cancelled';

export interface WorkflowRunExecutionResult {
    readonly outcome: WorkflowRunOutcome;
    readonly message?: string;
}

export interface WorkflowRunPolicy {
    readonly concurrency: number;
    readonly queueLimit: number;
    readonly overflow: 'drop-newest';
}

export interface WorkflowRunIdentity {
    readonly runId: string;
    readonly workflowId: string;
    readonly pipelineId: string;
}

export interface WorkflowRun extends WorkflowRunIdentity {
    readonly context: WorkflowContext;
    readonly signal: AbortSignal;
}

export type WorkflowRunExecutor = (
    run: WorkflowRun,
) => Promise<WorkflowRunExecutionResult | undefined>;

export type WorkflowRunLifecycleEvent =
    | {
          readonly kind: 'started';
          readonly run: WorkflowRunIdentity;
          readonly queueSize: number;
      }
    | {
          readonly kind: 'queued';
          readonly run: WorkflowRunIdentity;
          readonly queueSize: number;
      }
    | {
          readonly kind: 'dropped';
          readonly run: WorkflowRunIdentity;
          readonly queueSize: number;
          readonly reason: 'queue_full' | 'not_accepting';
      }
    | {
          readonly kind: 'cancelled';
          readonly run: WorkflowRunIdentity;
          readonly queueSize: number;
          readonly phase: 'queued' | 'running';
          readonly reason: string;
      }
    | {
          readonly kind: 'finished';
          readonly run: WorkflowRunIdentity;
          readonly queueSize: number;
          readonly outcome: WorkflowRunExecutionResult;
      };

export type WorkflowRunAdmission =
    | {
          readonly kind: 'started';
          readonly run: WorkflowRunIdentity;
          readonly queueSize: number;
      }
    | {
          readonly kind: 'queued';
          readonly run: WorkflowRunIdentity;
          readonly queueSize: number;
      }
    | {
          readonly kind: 'dropped';
          readonly run: WorkflowRunIdentity;
          readonly queueSize: number;
          readonly reason: 'queue_full' | 'not_accepting';
      };

export interface WorkflowRunSupervisorOptions {
    readonly workflowId: string;
    readonly pipelineId: string;
    readonly policy?: Readonly<Partial<WorkflowRunPolicy>>;
    readonly execute: WorkflowRunExecutor;
    readonly onEvent?: (event: WorkflowRunLifecycleEvent) => void;
    readonly createRunId?: () => string;
}

export interface WorkflowRunSupervisor {
    readonly policy: WorkflowRunPolicy;
    readonly submit: (context: WorkflowContext) => WorkflowRunAdmission;
    /** Stop accepting work, cancel queued work, abort active work, and await it. */
    readonly cancel: (reason?: string) => Promise<void>;
    /** Stop accepting work but finish the already-admitted queue. */
    readonly drain: () => Promise<void>;
    readonly waitForIdle: () => Promise<void>;
    readonly activeCount: () => number;
    readonly queuedCount: () => number;
    readonly accepting: () => boolean;
}

interface PendingRun {
    readonly run: WorkflowRun;
    readonly controller: AbortController;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function normalizeExecutionResult(
    result: WorkflowRunExecutionResult | undefined,
): WorkflowRunExecutionResult {
    return result ?? { outcome: 'succeeded' };
}

function normalizePolicy(options: WorkflowRunSupervisorOptions): WorkflowRunPolicy {
    const policy: WorkflowRunPolicy = {
        concurrency: options.policy?.concurrency ?? DEFAULT_WORKFLOW_RUN_POLICY.concurrency,
        queueLimit: options.policy?.queueLimit ?? DEFAULT_WORKFLOW_RUN_POLICY.queueLimit,
        overflow: options.policy?.overflow ?? DEFAULT_WORKFLOW_RUN_POLICY.overflow,
    };

    if (!Number.isInteger(policy.concurrency) || policy.concurrency < 1) {
        throw new Error('Workflow run concurrency must be a positive integer.');
    }
    if (!Number.isInteger(policy.queueLimit) || policy.queueLimit < 0) {
        throw new Error('Workflow run queueLimit must be a non-negative integer.');
    }
    if (policy.overflow !== 'drop-newest') {
        throw new Error(`Unsupported Workflow run overflow policy: ${policy.overflow}`);
    }

    return policy;
}

function cancellationReason(signal: AbortSignal, fallback: string): string {
    const reason: unknown = signal.reason;
    if (typeof reason === 'string' && reason.length > 0) return reason;
    if (reason instanceof Error) return reason.message;
    return fallback;
}

function toIdentity(run: WorkflowRun): WorkflowRunIdentity {
    return {
        runId: run.runId,
        workflowId: run.workflowId,
        pipelineId: run.pipelineId,
    };
}

export function createWorkflowRunSupervisor(
    options: WorkflowRunSupervisorOptions,
): WorkflowRunSupervisor {
    const policy = normalizePolicy(options);
    const queue: PendingRun[] = [];
    const active = new Map<string, PendingRun>();
    const idleWaiters = new Set<() => void>();
    let accepting = true;
    let draining = false;

    function emit(event: WorkflowRunLifecycleEvent): void {
        try {
            options.onEvent?.(event);
        } catch {
            // Lifecycle publication must not change admission or execution.
        }
    }

    function isIdle(): boolean {
        return active.size === 0 && queue.length === 0;
    }

    function resolveIdleWaiters(): void {
        if (!isIdle()) return;
        for (const resolve of idleWaiters) resolve();
        idleWaiters.clear();
    }

    function waitForIdle(): Promise<void> {
        if (isIdle()) return Promise.resolve();
        return new Promise<void>((resolve) => {
            idleWaiters.add(resolve);
        });
    }

    function finish(run: WorkflowRun, result: WorkflowRunExecutionResult): void {
        const pending = active.get(run.runId);
        if (!pending) return;
        active.delete(run.runId);

        const outcome = run.signal.aborted
            ? {
                  outcome: 'cancelled' as const,
                  message: cancellationReason(run.signal, 'Workflow run cancelled.'),
              }
            : result;
        emit({
            kind: 'finished',
            run: toIdentity(run),
            queueSize: queue.length,
            outcome,
        });

        pump();
        resolveIdleWaiters();
    }

    function start(pending: PendingRun): void {
        active.set(pending.run.runId, pending);
        emit({ kind: 'started', run: toIdentity(pending.run), queueSize: queue.length });

        let execution: Promise<WorkflowRunExecutionResult | undefined>;
        try {
            execution = options.execute(pending.run);
        } catch (error) {
            finish(
                pending.run,
                pending.run.signal.aborted
                    ? {
                          outcome: 'cancelled',
                          message: cancellationReason(
                              pending.run.signal,
                              'Workflow run cancelled.',
                          ),
                      }
                    : { outcome: 'failed', message: errorMessage(error) },
            );
            return;
        }

        void Promise.resolve(execution).then(
            (result) => finish(pending.run, normalizeExecutionResult(result)),
            (error: unknown) =>
                finish(
                    pending.run,
                    pending.run.signal.aborted
                        ? {
                              outcome: 'cancelled',
                              message: cancellationReason(
                                  pending.run.signal,
                                  'Workflow run cancelled.',
                              ),
                          }
                        : { outcome: 'failed', message: errorMessage(error) },
                ),
        );
    }

    function pump(): void {
        while ((accepting || draining) && active.size < policy.concurrency) {
            const pending = queue.shift();
            if (!pending) break;
            start(pending);
        }
    }

    function createPendingRun(context: WorkflowContext): PendingRun {
        const controller = new AbortController();
        const run: WorkflowRun = {
            runId: options.createRunId?.() ?? randomUUID(),
            workflowId: options.workflowId,
            pipelineId: options.pipelineId,
            context,
            signal: controller.signal,
        };
        return { run, controller };
    }

    function submit(context: WorkflowContext): WorkflowRunAdmission {
        const pending = createPendingRun(context);
        const identity = toIdentity(pending.run);

        if (!accepting) {
            const admission: WorkflowRunAdmission = {
                kind: 'dropped',
                run: identity,
                queueSize: queue.length,
                reason: 'not_accepting',
            };
            emit(admission);
            return admission;
        }

        if (active.size < policy.concurrency) {
            start(pending);
            return { kind: 'started', run: identity, queueSize: queue.length };
        }

        if (queue.length < policy.queueLimit) {
            queue.push(pending);
            const admission: WorkflowRunAdmission = {
                kind: 'queued',
                run: identity,
                queueSize: queue.length,
            };
            emit(admission);
            return admission;
        }

        const admission: WorkflowRunAdmission = {
            kind: 'dropped',
            run: identity,
            queueSize: queue.length,
            reason: 'queue_full',
        };
        emit(admission);
        return admission;
    }

    function cancel(reason = 'Workflow run supervisor stopped.'): Promise<void> {
        accepting = false;
        draining = false;

        const cancelled = queue.splice(0);
        for (const pending of cancelled) {
            emit({
                kind: 'cancelled',
                run: toIdentity(pending.run),
                queueSize: queue.length,
                phase: 'queued',
                reason,
            });
        }

        for (const pending of active.values()) {
            emit({
                kind: 'cancelled',
                run: toIdentity(pending.run),
                queueSize: queue.length,
                phase: 'running',
                reason,
            });
            if (!pending.controller.signal.aborted) pending.controller.abort(reason);
        }

        resolveIdleWaiters();
        return waitForIdle();
    }

    function drain(): Promise<void> {
        accepting = false;
        draining = true;
        pump();
        resolveIdleWaiters();
        return waitForIdle();
    }

    return {
        policy,
        submit,
        cancel,
        drain,
        waitForIdle,
        activeCount: () => active.size,
        queuedCount: () => queue.length,
        accepting: () => accepting,
    };
}
