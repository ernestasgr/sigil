import type { CompiledPipeline } from '@sigil/schema';
import type { NodeContractRegistry } from '@sigil/schema/node-contract';
import type { PipelineNode } from '@sigil/schema/nodes';
import { createBuiltinNodeContractRegistry } from '@sigil/schema/nodes/catalog';
import {
    type ExecutableWorkflow,
    validateWorkflowTopology,
    type WorkflowTopologyOptions,
    type WorkflowTopologyResult,
} from '@sigil/schema/topology';
import type { NodeHandlerRegistry } from '../execution/node-registry.js';

export type WorkflowInput = CompiledPipeline | ExecutableWorkflow;

export function isExecutableWorkflow(input: WorkflowInput): input is ExecutableWorkflow {
    return 'pipeline' in input && 'triggerId' in input && 'executionOrder' in input;
}

export function workflowTopologyOptions(
    handlerRegistry: NodeHandlerRegistry,
    contractRegistry: NodeContractRegistry = createBuiltinNodeContractRegistry(),
): WorkflowTopologyOptions {
    return {
        contractRegistry,
        isNodeSupported: (node: PipelineNode): boolean => handlerRegistry.has(node.type),
    };
}

export function acceptWorkflow(
    input: WorkflowInput,
    handlerRegistry: NodeHandlerRegistry,
    contractRegistry: NodeContractRegistry = createBuiltinNodeContractRegistry(),
): WorkflowTopologyResult {
    const pipeline = isExecutableWorkflow(input) ? input.pipeline : input;
    return validateWorkflowTopology(pipeline, {
        ...workflowTopologyOptions(handlerRegistry, contractRegistry),
        requireNodeContracts: true,
    });
}
