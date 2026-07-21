import { Either } from 'effect';
import { parseWorkflowStateValue } from '../workflow/workflow-state-value.js';
import type { NodeHandler, NodeRunResult } from './types.js';
import { narrowNode } from './types.js';

export const stateSetHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        const typed = narrowNode(node, 'state-set');
        const { key, valueTemplate, valueType } = typed.config;
        const resolvedValue = deps.resolveTemplate(valueTemplate, ctx);
        const value = parseWorkflowStateValue(resolvedValue, valueType);
        if (Either.isLeft(value)) throw new Error(value.left.message);
        deps.state.set(key, value.right);
        return { outputCtx: ctx, activePort: 'out' };
    },
};
