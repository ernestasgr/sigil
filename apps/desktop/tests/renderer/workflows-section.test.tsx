import type { CompiledPipeline } from '@sigil/schema';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowsSection } from '../../src/renderer/sections/workflows-section.js';
import { useAppStore } from '../../src/renderer/store/app-store.js';
import { createTelemetryIndex } from '../../src/renderer/store/telemetry-index.js';
import { useBuilderStore } from '../../src/renderer/workflow-builder/builder-store.js';
import { DEFAULT_NODE_CATALOG } from '../../src/renderer/workflow-builder/node-catalog.js';
import type { RendererResponse } from '../../src/shared/command-contracts.js';

import { createMockSigil, withSigil } from './test-support.js';

type WorkflowLoadResult = RendererResponse<'getWorkflow'>;

interface Deferred<TValue> {
    readonly promise: Promise<TValue>;
    readonly resolve: (value: TValue) => void;
}

function createDeferred<TValue>(): Deferred<TValue> {
    let resolvePromise: ((value: TValue) => void) | undefined;
    const promise = new Promise<TValue>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: (value) => resolvePromise?.(value),
    };
}

function createPipeline(): CompiledPipeline {
    return {
        id: 'pipeline-fixture',
        workflowId: 'workflow-fixture',
        schemaVersion: 1,
        nodes: [
            {
                id: 'trigger',
                type: 'manual-trigger',
                config: {
                    eventName: 'file.created',
                    payload: {
                        path: '/',
                        name: 'fixture.txt',
                        ext: 'txt',
                        size: 0,
                        dir: '/',
                    },
                },
            },
        ],
        edges: [],
    };
}

describe('Workflows section renderer behavior', () => {
    beforeEach(() => {
        useAppStore.setState({
            activeSection: 'workflows',
            workflows: [],
            logs: [],
            busEvents: [],
            telemetryIndex: createTelemetryIndex(),
            workflowView: 'list',
            editingWorkflowId: null,
        });
        useBuilderStore.getState().setNodeCatalog(DEFAULT_NODE_CATALOG);
        useBuilderStore.getState().clear();
    });

    it('shows loading feedback and then opens the loaded Workflow in the Builder', async () => {
        const user = userEvent.setup();
        const sigil = createMockSigil();
        const pending = createDeferred<WorkflowLoadResult>();
        vi.spyOn(sigil, 'getWorkflow').mockReturnValue(pending.promise);
        useAppStore.getState().setWorkflows([
            {
                id: 'workflow-fixture',
                name: 'Stored Workflow',
                enabled: false,
                activation: { kind: 'disabled' },
            },
        ]);

        render(withSigil(<WorkflowsSection />, sigil));

        await user.click(screen.getByRole('button', { name: 'Edit' }));
        expect(screen.getByText('Loading workflow...')).toBeInTheDocument();

        pending.resolve({
            name: 'Loaded Workflow',
            pipeline: createPipeline(),
            positions: { trigger: { x: 40, y: 40 } },
        });

        await waitFor(() => {
            expect(screen.getByRole('textbox', { name: 'Workflow name' })).toHaveValue(
                'Loaded Workflow',
            );
            expect(screen.getByRole('status', { name: 'Workflow save status' })).toHaveTextContent(
                'Saved',
            );
        });
    });
});
