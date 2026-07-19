import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import type { SigilAdapter } from '../../src/renderer/lib/sigil-adapter.js';
import { SigilContext } from '../../src/renderer/lib/sigil-context.js';
import type { EngineBusEventPayload } from '../../src/shared/ipc-channels.js';
import type { WorkflowSummary } from '../../src/shared/workflow.js';

export function createMockSigil(): SigilAdapter {
    return {
        rendererReady: vi.fn(async () => undefined),
        pingEngine: vi.fn(async () => null),
        fireTestEvent: vi.fn(async () => ({ ok: true as const })),
        toggleWorkflow: vi.fn(async () => ({ ok: true as const, summary: null })),
        retryWorkflow: vi.fn(async () => ({ ok: true as const, summary: null })),
        createWorkflow: vi.fn(async () => ({
            ok: false as const,
            error: 'unused in this test',
            diagnostics: [],
        })),
        updateWorkflow: vi.fn(async () => ({
            ok: false as const,
            error: 'unused in this test',
            diagnostics: [],
        })),
        deleteWorkflow: vi.fn(async () => ({
            ok: false as const,
            success: false as const,
            error: 'unused in this test',
            diagnostics: [],
        })),
        getWorkflow: vi.fn(async () => null),
        listPlugins: vi.fn(async () => []),
        setPermissionOverride: vi.fn(async () => ({ ok: true as const })),
        readProperties: vi.fn(async () => ({ properties: {} })),
        saveProperties: vi.fn(async () => ({
            ok: true as const,
            applied: {},
            restartRequired: [],
        })),
        openFileDialog: vi.fn(async () => null),
        fireManualTrigger: vi.fn(async () => ({ ok: true as const })),
        readWorkflowState: vi.fn(async () => []),
        setWorkflowStateKey: vi.fn(async () => true),
        deleteWorkflowStateKey: vi.fn(async () => true),
        onEngineLog: vi.fn((_handler: (line: string) => void) => () => undefined),
        onWorkflowsList: vi.fn(
            (_handler: (workflows: readonly WorkflowSummary[]) => void) => () => undefined,
        ),
        onBusEvent: vi.fn((_handler: (event: EngineBusEventPayload) => void) => () => undefined),
    };
}

export function withSigil(children: ReactNode, sigil: SigilAdapter): ReactElement {
    return <SigilContext.Provider value={sigil}>{children}</SigilContext.Provider>;
}
