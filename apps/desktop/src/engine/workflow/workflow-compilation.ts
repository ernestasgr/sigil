import type { PipelineNode } from '@sigil/contracts/nodes';
import type { WorkflowCompilationOptions } from '@sigil/workflow-domain';
import type { NodeContractRegistry } from '@sigil/workflow-domain/node-contract';
import { createBuiltinNodeContractRegistry } from '@sigil/workflow-domain/nodes/catalog';

import type { NodeHandlerRegistry } from '../execution/node-registry.js';

/** Compose Engine-owned runtime support into the shared compilation seam. */
export function workflowCompilationOptions(
    handlerRegistry: NodeHandlerRegistry,
    contractRegistry: NodeContractRegistry = createBuiltinNodeContractRegistry(),
): WorkflowCompilationOptions {
    return {
        contractRegistry,
        isNodeSupported: (node: PipelineNode): boolean => handlerRegistry.has(node.type),
    };
}
