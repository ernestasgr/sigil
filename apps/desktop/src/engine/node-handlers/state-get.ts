import type { NodeHandler, NodeRunResult } from './types.js';
import { narrowNode } from './types.js';

export const stateGetHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        const typed = narrowNode(node, 'state-get');
        const { key, assignTo } = typed.config;
        const value = deps.state.get(key);
        return {
            outputCtx: { ...ctx, vars: { ...ctx.vars, [assignTo]: value } },
            activePort: 'out',
        };
    },
};
