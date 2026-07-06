import type { NodeHandler, NodeRunResult } from './types.js';
import { narrowNode } from './types.js';

export const switchHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        const typed = narrowNode(node, 'switch');
        return { outputCtx: ctx, activePort: deps.matchSwitchCase(typed.config, ctx) };
    },
};
