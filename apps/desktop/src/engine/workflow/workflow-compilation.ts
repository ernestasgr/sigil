import type { WorkflowCompilationOptions } from '@sigil/schema';
import type { NodeContractRegistry } from '@sigil/schema/node-contract';
import type { PipelineNode } from '@sigil/schema/nodes';
import { createBuiltinNodeContractRegistry } from '@sigil/schema/nodes/catalog';

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
