import { stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { WorkflowDocumentSchema } from '@sigil/schema';
import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import type { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { EngineBusEventPayload } from '../../shared/ipc-channels.js';
import { PersistenceDiagnosticSchema } from '../../shared/persistence.js';
import type {
    CommandExecutionOutcome,
    PermissionOverrideOutcome,
    PropertiesReadOutput,
    PropertiesSaveOutcome,
    WorkflowActionOutcome,
    WorkflowDeleteOutcome,
    WorkflowWriteOutcome,
} from '../../shared/trpc-contracts.js';
import {
    CommandExecutionOutcomeSchema,
    DeleteWorkflowStateKeyInputSchema,
    GetWorkflowOutputSchema,
    ListPluginsOutputSchema,
    OpenFileDialogOutputSchema,
    PermissionOverrideInputSchema,
    PermissionOverrideOutcomeSchema,
    PingEngineOutputSchema,
    PropertiesReadOutputSchema,
    PropertiesSaveInputSchema,
    PropertiesSaveOutcomeSchema,
    ReadWorkflowStateOutputSchema,
    SetWorkflowStateKeyInputSchema,
    WorkflowActionOutcomeSchema,
    WorkflowDeleteOutcomeSchema,
    WorkflowIdInputSchema,
    WorkflowUpdateInputSchema,
    WorkflowWriteInputSchema,
    WorkflowWriteOutcomeSchema,
} from '../../shared/trpc-contracts.js';
import type { WorkflowSummary } from '../../shared/workflow.js';
import type { EngineHandle } from '../engine-client.js';
import { electronNativeDialogAdapter, type NativeDialogAdapter } from '../native-dialog.js';

const t = initTRPC.create();
const procedure = t.procedure;

export interface AppRouterDependencies {
    readonly getEngine: () => EngineHandle | null;
    readonly getMainWindow: () => BrowserWindow | null;
    readonly getWorkflows: () => readonly WorkflowSummary[];
    readonly nativeDialog?: NativeDialogAdapter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function persistenceFailure(error: unknown, fallbackPath: string): PermissionOverrideOutcome {
    const record = isRecord(error) ? error : undefined;
    const diagnostics = record?.diagnostics;
    if (Array.isArray(diagnostics)) {
        const diagnostic = diagnostics
            .map((candidate) => PersistenceDiagnosticSchema.safeParse(candidate))
            .find((result) => result.success);
        if (diagnostic?.success) {
            return {
                ok: false,
                kind: 'persistence',
                error: errorMessage(error),
                diagnostic: diagnostic.data,
            };
        }
    }

    const message = errorMessage(error);
    return {
        ok: false,
        kind: 'persistence',
        error: message,
        diagnostic: {
            kind: 'persistence',
            operation: 'write',
            phase: 'write',
            path: fallbackPath,
            message,
        },
    };
}

function propertiesSaveFailure(error: unknown, fallbackPath: string): PropertiesSaveOutcome {
    const message = errorMessage(error);
    return {
        ok: false,
        kind: 'write',
        error: message,
        diagnostic: {
            kind: 'persistence',
            operation: 'write',
            phase: 'write',
            path: fallbackPath,
            message,
        },
    };
}

function workflowFailure(error: unknown): WorkflowWriteOutcome {
    return {
        ok: false,
        error: errorMessage(error),
        diagnostics: [],
    };
}

function workflowActionFailure(error: unknown): WorkflowActionOutcome {
    return {
        ok: false,
        error: errorMessage(error),
        diagnostics: [],
    };
}

function workflowDeleteFailure(error: unknown): WorkflowDeleteOutcome {
    return {
        ok: false,
        success: false,
        error: errorMessage(error),
        diagnostics: [],
    };
}

function executionFailure(error: unknown): CommandExecutionOutcome {
    return { ok: false as const, error: errorMessage(error) };
}

function subscribeToEngine<TValue>(
    getEngine: () => EngineHandle | null,
    subscribe: (engine: EngineHandle, emit: (value: TValue) => void) => (() => void) | undefined,
) {
    return observable<TValue>((emit) => {
        const engine = getEngine();
        if (!engine) {
            emit.error(new Error('Engine not ready'));
            return;
        }
        return subscribe(engine, (value) => emit.next(value));
    });
}

export function createAppRouter(deps: AppRouterDependencies) {
    const nativeDialog = deps.nativeDialog ?? electronNativeDialogAdapter;

    return t.router({
        pingEngine: procedure.output(PingEngineOutputSchema).query(async () => {
            const engine = deps.getEngine();
            if (!engine) return null;
            try {
                return await engine.ping();
            } catch (error) {
                console.error('[main] engine ping failed:', error);
                return null;
            }
        }),

        fireTestEvent: procedure.output(CommandExecutionOutcomeSchema).mutation(async () => {
            const engine = deps.getEngine();
            if (!engine) return executionFailure(new Error('Engine not ready'));
            try {
                return await engine.fireTestEvent();
            } catch (error) {
                console.error('[main] fireTestEvent failed:', error);
                return executionFailure(error);
            }
        }),

        toggleWorkflow: procedure
            .input(WorkflowIdInputSchema)
            .output(WorkflowActionOutcomeSchema)
            .mutation(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return workflowActionFailure(new Error('Engine not ready'));
                try {
                    return await engine.toggleWorkflow({ id: input.id });
                } catch (error) {
                    console.error('[main] toggleWorkflow failed:', error);
                    return workflowActionFailure(error);
                }
            }),

        retryWorkflow: procedure
            .input(WorkflowIdInputSchema)
            .output(WorkflowActionOutcomeSchema)
            .mutation(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return workflowActionFailure(new Error('Engine not ready'));
                try {
                    return await engine.retryWorkflow({ id: input.id });
                } catch (error) {
                    console.error('[main] retryWorkflow failed:', error);
                    return workflowActionFailure(error);
                }
            }),

        createWorkflow: procedure
            .input(WorkflowWriteInputSchema)
            .output(WorkflowWriteOutcomeSchema)
            .mutation(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return workflowFailure(new Error('Engine not ready'));
                try {
                    return await engine.createWorkflow(input);
                } catch (error) {
                    console.error('[main] createWorkflow failed:', error);
                    return workflowFailure(error);
                }
            }),

        updateWorkflow: procedure
            .input(WorkflowUpdateInputSchema)
            .output(WorkflowWriteOutcomeSchema)
            .mutation(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return workflowFailure(new Error('Engine not ready'));
                try {
                    return await engine.updateWorkflow(input);
                } catch (error) {
                    console.error('[main] updateWorkflow failed:', error);
                    return workflowFailure(error);
                }
            }),

        deleteWorkflow: procedure
            .input(WorkflowIdInputSchema)
            .output(WorkflowDeleteOutcomeSchema)
            .mutation(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return workflowDeleteFailure(new Error('Engine not ready'));
                try {
                    return await engine.deleteWorkflow({ id: input.id });
                } catch (error) {
                    console.error('[main] deleteWorkflow failed:', error);
                    return workflowDeleteFailure(error);
                }
            }),

        getWorkflow: procedure
            .input(WorkflowIdInputSchema)
            .output(GetWorkflowOutputSchema)
            .query(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return null;
                try {
                    return await engine.getWorkflow(input.id);
                } catch (error) {
                    console.error('[main] getWorkflow failed:', error);
                    throw error;
                }
            }),

        listPlugins: procedure.output(ListPluginsOutputSchema).query(async () => {
            const engine = deps.getEngine();
            if (!engine) return [];
            try {
                return await engine.listPlugins();
            } catch (error) {
                console.error('[main] listPlugins failed:', error);
                throw error;
            }
        }),

        setPermissionOverride: procedure
            .input(PermissionOverrideInputSchema)
            .output(PermissionOverrideOutcomeSchema)
            .mutation(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return persistenceFailure(new Error('Engine not ready'), 'engine');
                try {
                    return await engine.setPermissionOverride(input);
                } catch (error) {
                    console.error('[main] setPermissionOverride failed:', error);
                    return persistenceFailure(error, 'permission-overrides.json');
                }
            }),

        readProperties: procedure.output(PropertiesReadOutputSchema).query(async () => {
            const engine = deps.getEngine();
            if (!engine) return { properties: {} } satisfies PropertiesReadOutput;
            try {
                return await engine.readProperties();
            } catch (error) {
                console.error('[main] readProperties failed:', error);
                throw error;
            }
        }),

        saveProperties: procedure
            .input(PropertiesSaveInputSchema)
            .output(PropertiesSaveOutcomeSchema)
            .mutation(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return propertiesSaveFailure(new Error('Engine not ready'), 'engine');
                try {
                    return await engine.saveProperties({ properties: input });
                } catch (error) {
                    console.error('[main] saveProperties failed:', error);
                    return propertiesSaveFailure(error, 'sigil.properties.json');
                }
            }),

        openFileDialog: procedure.output(OpenFileDialogOutputSchema).mutation(async () => {
            const mainWindow = deps.getMainWindow();
            if (!mainWindow) return null;
            try {
                const result = await nativeDialog.showOpenFileDialog(mainWindow);
                if (result.canceled || result.filePaths.length === 0) return null;
                const filePath = result.filePaths[0];
                if (!filePath) return null;
                const stats = await stat(filePath);
                return {
                    path: filePath,
                    name: basename(filePath),
                    ext: extname(filePath).replace('.', ''),
                    size: stats.size,
                    dir: dirname(filePath),
                };
            } catch (error) {
                console.error('[main] openFileDialog failed:', error);
                return null;
            }
        }),

        fireManualTrigger: procedure
            .input(WorkflowDocumentSchema)
            .output(CommandExecutionOutcomeSchema)
            .mutation(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return executionFailure(new Error('Engine not ready'));
                try {
                    return await engine.fireManualTrigger({ document: input });
                } catch (error) {
                    console.error('[main] fireManualTrigger failed:', error);
                    return executionFailure(error);
                }
            }),

        readWorkflowState: procedure
            .input(WorkflowIdInputSchema)
            .output(ReadWorkflowStateOutputSchema)
            .query(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return [];
                try {
                    return await engine.readWorkflowState(input.id);
                } catch (error) {
                    console.error('[main] readWorkflowState failed:', error);
                    throw error;
                }
            }),

        setWorkflowStateKey: procedure
            .input(SetWorkflowStateKeyInputSchema)
            .output(z.boolean())
            .mutation(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return false;
                try {
                    return await engine.setWorkflowStateKey(input);
                } catch (error) {
                    console.error('[main] setWorkflowStateKey failed:', error);
                    return false;
                }
            }),

        deleteWorkflowStateKey: procedure
            .input(DeleteWorkflowStateKeyInputSchema)
            .output(z.boolean())
            .mutation(async ({ input }) => {
                const engine = deps.getEngine();
                if (!engine) return false;
                try {
                    return await engine.deleteWorkflowStateKey(input);
                } catch (error) {
                    console.error('[main] deleteWorkflowStateKey failed:', error);
                    return false;
                }
            }),

        // electron-trpc 0.7 targets tRPC 10, whose subscription builder does not compose
        // with an output parser. Keep the Observable generic explicit and validate emissions
        // in the renderer adapter with the shared schemas.
        onEngineLog: procedure.subscription(() =>
            subscribeToEngine<string>(deps.getEngine, (engine, emit) => engine.onLog(emit)),
        ),

        onWorkflowsList: procedure.subscription(() =>
            subscribeToEngine<readonly WorkflowSummary[]>(deps.getEngine, (engine, emit) => {
                emit(deps.getWorkflows());
                return engine.onWorkflowsList(emit);
            }),
        ),

        onBusEvent: procedure.subscription(() =>
            subscribeToEngine<EngineBusEventPayload>(deps.getEngine, (engine, emit) =>
                engine.onBusEvent(emit),
            ),
        ),
    });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
