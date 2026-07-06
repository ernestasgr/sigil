import type { NodeHandler, NodeRunResult } from './types.js';
import { narrowNode } from './types.js';

export const stateSetHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        const typed = narrowNode(node, 'state-set');
        const { key, valueTemplate } = typed.config;
        const value = deps.resolveTemplate(valueTemplate, ctx);
        deps.state.set(key, value);
        return { outputCtx: ctx, activePort: 'out' };
    },
};
