import { WorkflowIdSchema } from '@sigil/schema/ids';

import { EngineChannel, type EngineLog } from '../../shared/ipc-channels.js';
import type { WorkflowSummary } from '../../shared/workflow.js';
import type { WorkflowLifecycle } from '../workflow/workflow-lifecycle.js';

export function activateEnabledWorkflows(
    workflows: readonly WorkflowSummary[],
    lifecycle: Pick<WorkflowLifecycle, 'activateEnabled'>,
    postMessage: (message: EngineLog) => void,
): void {
    for (const workflow of workflows) {
        if (!workflow.enabled) continue;

        const workflowId = WorkflowIdSchema.safeParse(workflow.id);
        if (!workflowId.success) {
            postMessage({
                type: EngineChannel.Log,
                line: `[worker] skipped workflow ${workflow.id} (${workflow.name}) because its id is invalid: ${workflowId.error.message}`,
            });
            continue;
        }

        try {
            lifecycle.activateEnabled(workflowId.data);
        } catch (error) {
            postMessage({
                type: EngineChannel.Log,
                line: `[worker] failed to activate workflow ${workflow.id} (${workflow.name}): ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }
}
