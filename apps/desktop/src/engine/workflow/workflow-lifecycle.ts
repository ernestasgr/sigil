import { Option } from 'effect';

import type { WorkflowSummary } from '../../shared/workflow.js';
import type { AtomicWriteFailure } from '../persistence/atomic-file.js';
import type { WorkflowActivator } from './workflow-activator.js';
import { isWorkflowPersistenceError, type WorkflowStore } from './workflow-store.js';

const MAX_COMPENSATION_DIAGNOSTICS = 4;
const MAX_COMPENSATION_MESSAGE_LENGTH = 512;

export interface WorkflowLifecycle {
    readonly enable: (workflowId: string) => Option.Option<WorkflowSummary>;
    readonly retry: (workflowId: string) => Option.Option<WorkflowSummary>;
    readonly disable: (workflowId: string) => Option.Option<WorkflowSummary>;
    readonly toggle: (workflowId: string) => Option.Option<WorkflowSummary>;
    readonly activateEnabled: (workflowId: string) => Option.Option<WorkflowSummary>;
    readonly update: (workflowId: string, save: () => WorkflowSummary) => WorkflowSummary;
    readonly updateAndDrain: (
        workflowId: string,
        save: () => WorkflowSummary,
    ) => Promise<WorkflowSummary>;
    readonly waitForRuns: (workflowId: string) => Promise<void>;
}

export function createWorkflowLifecycle(
    store: WorkflowStore,
    activator: WorkflowActivator,
): WorkflowLifecycle {
    function errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    function boundedMessage(message: string): string {
        return message.length > MAX_COMPENSATION_MESSAGE_LENGTH
            ? `${message.slice(0, MAX_COMPENSATION_MESSAGE_LENGTH - 1)}…`
            : message;
    }

    function restorePreviousActivation(workflowId: string, wasActive: boolean): void {
        if (wasActive) {
            if (!activator.isActive(workflowId) && !activator.activate(workflowId)) {
                throw new Error(
                    `Workflow activation compensation returned false for ${workflowId}.`,
                );
            }
            return;
        }
        if (activator.isActive(workflowId)) activator.deactivate(workflowId);
        if (activator.isActive(workflowId)) {
            throw new Error(`Workflow deactivation compensation left ${workflowId} active.`);
        }
    }

    function collectRestoreFailures(
        workflowId: string,
        previousEnabled: boolean,
        wasActive: boolean,
    ): unknown[] {
        const failures: unknown[] = [];
        try {
            restorePreviousActivation(workflowId, wasActive);
        } catch (error) {
            failures.push(error);
        }
        try {
            const restored = store.setEnabled(workflowId, previousEnabled);
            if (Option.isNone(restored)) {
                throw new Error(`Workflow ${workflowId} disappeared during compensation.`);
            }
        } catch (error) {
            failures.push(error);
        }
        return failures;
    }

    function cloneErrorWithMessage(error: Error, message: string): Error {
        const clone = new Error(message, { cause: error });
        Object.setPrototypeOf(clone, Object.getPrototypeOf(error));
        for (const key of Reflect.ownKeys(error)) {
            if (key === 'cause' || key === 'message' || key === 'stack') continue;
            const descriptor = Object.getOwnPropertyDescriptor(error, key);
            if (descriptor === undefined) continue;
            Object.defineProperty(clone, key, descriptor);
        }
        return clone;
    }

    function rethrowWithCompensation(
        primary: unknown,
        workflowId: string,
        failures: readonly unknown[],
    ): never {
        const primaryError = primary instanceof Error ? primary : new Error(errorMessage(primary));
        const context = failures
            .slice(0, MAX_COMPENSATION_DIAGNOSTICS)
            .map((failure) => boundedMessage(errorMessage(failure)));
        const suffix = boundedMessage(
            `Workflow compensation failed for ${workflowId}: ${context.join(' | ')}`,
        );
        const compensatedError = cloneErrorWithMessage(
            primaryError,
            boundedMessage(`${primaryError.message}; ${suffix}`),
        );
        Object.defineProperty(compensatedError, 'compensationDiagnostics', {
            configurable: true,
            enumerable: true,
            value: context,
        });

        if (isWorkflowPersistenceError(compensatedError)) {
            const compensatedDiagnostics = Array.isArray(compensatedError.diagnostics)
                ? compensatedError.diagnostics
                : [];
            const diagnostics = failures.flatMap((failure) =>
                isWorkflowPersistenceError(failure) && Array.isArray(failure.diagnostics)
                    ? failure.diagnostics
                    : [],
            );
            Object.defineProperty(compensatedError, 'diagnostics', {
                configurable: true,
                enumerable: true,
                value: [...compensatedDiagnostics, ...diagnostics].slice(
                    0,
                    MAX_COMPENSATION_DIAGNOSTICS,
                ),
            });
        }

        throw compensatedError;
    }

    function restorePreviousState(
        workflowId: string,
        previousEnabled: boolean,
        wasActive: boolean,
        primary: unknown,
    ): never {
        const failures = collectRestoreFailures(workflowId, previousEnabled, wasActive);
        if (failures.length > 0) rethrowWithCompensation(primary, workflowId, failures);
        throw primary;
    }

    function restoreFailedActivation(
        workflowId: string,
        previousEnabled: boolean,
        wasActive: boolean,
        activation: WorkflowSummary['activation'],
    ): Option.Option<WorkflowSummary> {
        const failures = collectRestoreFailures(workflowId, previousEnabled, wasActive);
        if (activation.kind === 'failed') {
            try {
                const restored = store.setActivation(workflowId, activation);
                if (Option.isNone(restored)) {
                    throw new Error(`Workflow ${workflowId} disappeared during compensation.`);
                }
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length > 0) {
            rethrowWithCompensation(
                createActivationFailure(
                    workflowId,
                    activation.kind === 'failed' ? activation.message : 'unknown reason',
                ),
                workflowId,
                failures,
            );
        }
        return store.getSummary(workflowId);
    }

    function createActivationFailure(workflowId: string, message: string): Error {
        const diagnostic: AtomicWriteFailure = {
            kind: 'persistence',
            operation: 'write',
            phase: 'write',
            path: workflowId,
            message,
            code: 'workflow_activation',
        };
        return Object.assign(new Error(`Could not activate Workflow "${workflowId}": ${message}`), {
            name: 'WorkflowActivationError',
            kind: 'workflow_persistence' as const,
            operation: 'set_activation' as const,
            workflowId,
            diagnostic,
            diagnostics: [diagnostic],
        });
    }

    function activationFailure(workflowId: string): Error {
        const summary = store.getSummary(workflowId);
        const message =
            Option.isSome(summary) && summary.value.activation.kind === 'failed'
                ? summary.value.activation.message
                : 'Workflow activation failed.';
        return createActivationFailure(workflowId, message);
    }

    function restoreUpdatedWorkflow(
        workflowId: string,
        previous: Option.Option<{
            readonly pipeline: Parameters<WorkflowStore['save']>[2];
            readonly name: string;
            readonly positions: Parameters<WorkflowStore['save']>[3];
        }>,
        previousSummary: WorkflowSummary,
        wasActive: boolean,
        primary: unknown,
    ): never {
        const failures: unknown[] = [];
        try {
            if (activator.isActive(workflowId)) activator.deactivate(workflowId);
            if (activator.isActive(workflowId)) {
                throw new Error(`Workflow ${workflowId} remained active during update rollback.`);
            }
        } catch (error) {
            failures.push(error);
        }
        if (Option.isSome(previous)) {
            try {
                store.save(
                    workflowId,
                    previous.value.name,
                    previous.value.pipeline,
                    previous.value.positions,
                );
            } catch (error) {
                failures.push(error);
            }
        }
        failures.push(...collectRestoreFailures(workflowId, previousSummary.enabled, wasActive));
        if (!wasActive && previousSummary.activation.kind === 'failed') {
            try {
                const restored = store.setActivation(workflowId, previousSummary.activation);
                if (Option.isNone(restored)) {
                    throw new Error(`Workflow ${workflowId} disappeared during update rollback.`);
                }
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length > 0) rethrowWithCompensation(primary, workflowId, failures);
        throw primary;
    }

    function activateAndCommitIntent(workflowId: string): Option.Option<WorkflowSummary> {
        const current = store.getSummary(workflowId);
        if (Option.isNone(current)) return Option.none();

        const wasActive = activator.isActive(workflowId);

        // The Trigger transition runs first. The persisted enabled intent is
        // committed only after that transition has produced either active or
        // failed activation state.
        try {
            const activated = activator.activate(workflowId);
            if (!activated) {
                const failed = store.getSummary(workflowId);
                const activation =
                    Option.isSome(failed) && failed.value.activation.kind === 'failed'
                        ? failed.value.activation
                        : { kind: 'failed' as const, message: 'Workflow activation failed.' };
                return restoreFailedActivation(
                    workflowId,
                    current.value.enabled,
                    wasActive,
                    activation,
                );
            }
            const committed = store.setEnabled(workflowId, true);
            if (Option.isNone(committed)) {
                throw new Error(`Workflow ${workflowId} disappeared while enabling.`);
            }
            return committed;
        } catch (error) {
            return restorePreviousState(workflowId, current.value.enabled, wasActive, error);
        }
    }

    function disableWorkflow(workflowId: string): Option.Option<WorkflowSummary> {
        const current = store.getSummary(workflowId);
        if (Option.isNone(current)) return Option.none();

        const wasActive = activator.isActive(workflowId);
        try {
            activator.deactivate(workflowId);
            const committed = store.setEnabled(workflowId, false);
            if (Option.isNone(committed)) {
                throw new Error(`Workflow ${workflowId} disappeared while disabling.`);
            }
            return committed;
        } catch (error) {
            return restorePreviousState(workflowId, current.value.enabled, wasActive, error);
        }
    }

    function toggleWorkflow(workflowId: string): Option.Option<WorkflowSummary> {
        const current = store.getSummary(workflowId);
        if (Option.isNone(current)) return Option.none();
        return current.value.enabled
            ? disableWorkflow(workflowId)
            : activateAndCommitIntent(workflowId);
    }

    return {
        enable: activateAndCommitIntent,

        retry: activateAndCommitIntent,

        disable: disableWorkflow,

        toggle: toggleWorkflow,

        activateEnabled(workflowId: string): Option.Option<WorkflowSummary> {
            const current = store.getSummary(workflowId);
            if (Option.isNone(current) || !current.value.enabled) return current;
            activator.activate(workflowId);
            return store.getSummary(workflowId);
        },

        update(workflowId: string, save: () => WorkflowSummary): WorkflowSummary {
            const current = store.getSummary(workflowId);
            if (Option.isNone(current)) return save();

            const wasEnabled = current.value.enabled;
            const wasActive = activator.isActive(workflowId);
            const previous = store.get(workflowId);

            try {
                if (wasActive) activator.deactivate(workflowId);
                const saved = save();
                if (!wasEnabled) return saved;

                if (!activator.activate(workflowId)) throw activationFailure(workflowId);
                const reactivated = store.setEnabled(workflowId, true);
                if (Option.isNone(reactivated)) {
                    throw new Error(`Workflow ${workflowId} disappeared during update.`);
                }
                return reactivated.value;
            } catch (error) {
                return restoreUpdatedWorkflow(
                    workflowId,
                    previous,
                    current.value,
                    wasActive,
                    error,
                );
            }
        },

        async updateAndDrain(
            workflowId: string,
            save: () => WorkflowSummary,
        ): Promise<WorkflowSummary> {
            const current = store.getSummary(workflowId);
            if (Option.isNone(current)) return save();

            const wasEnabled = current.value.enabled;
            const wasActive = activator.isActive(workflowId);
            const previous = store.get(workflowId);

            try {
                if (wasActive) activator.deactivate(workflowId);
                if (activator.hasInFlightRuns(workflowId)) {
                    await activator.waitForRuns(workflowId);
                }
                const saved = save();
                if (!wasEnabled) return saved;

                if (!activator.activate(workflowId)) throw activationFailure(workflowId);
                const reactivated = store.setEnabled(workflowId, true);
                if (Option.isNone(reactivated)) {
                    throw new Error(`Workflow ${workflowId} disappeared during update.`);
                }
                return reactivated.value;
            } catch (error) {
                return restoreUpdatedWorkflow(
                    workflowId,
                    previous,
                    current.value,
                    wasActive,
                    error,
                );
            }
        },

        waitForRuns(workflowId: string): Promise<void> {
            return activator.waitForRuns(workflowId);
        },
    };
}
