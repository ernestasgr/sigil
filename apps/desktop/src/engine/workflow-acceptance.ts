import type { CompiledPipeline } from '@sigil/schema';
import type { PipelineNode } from '@sigil/schema/nodes';
import {
    type ExecutableWorkflow,
    validateWorkflowTopology,
    type WorkflowTopologyOptions,
    type WorkflowTopologyResult,
} from '@sigil/schema/topology';
import { Option } from 'effect';

import { isTriggerHandler } from './node-handlers/types.js';
import type { NodeHandlerRegistry } from './node-registry.js';

export type WorkflowInput = CompiledPipeline | ExecutableWorkflow;

export function isExecutableWorkflow(input: WorkflowInput): input is ExecutableWorkflow {
    return 'pipeline' in input && 'triggerId' in input && 'executionOrder' in input;
}

export function workflowTopologyOptions(
    handlerRegistry: NodeHandlerRegistry,
): WorkflowTopologyOptions {
    return {
        isNodeSupported: (node: PipelineNode): boolean => handlerRegistry.has(node.type),
        isTrigger: (node: PipelineNode): boolean => {
            const handler = handlerRegistry.get(node.type);
            return Option.isSome(handler) && isTriggerHandler(handler.value);
        },
    };
}

export function acceptWorkflow(
    input: WorkflowInput,
    handlerRegistry: NodeHandlerRegistry,
): WorkflowTopologyResult {
    const pipeline = isExecutableWorkflow(input) ? input.pipeline : input;
    return validateWorkflowTopology(pipeline, workflowTopologyOptions(handlerRegistry));
}
