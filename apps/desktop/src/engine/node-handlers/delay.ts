import type { NodeHandler, NodeRunResult } from './types.js';
import { narrowNode } from './types.js';

export const delayHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        const typed = narrowNode(node, 'delay');
        await deps.sleep(typed.config.ms, deps.signal);
        return { outputCtx: ctx, activePort: 'out' };
    },
};
