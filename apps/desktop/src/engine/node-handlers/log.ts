import type { NodeHandler, NodeRunResult } from './types.js';
import { narrowNode } from './types.js';

export const logHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        const typed = narrowNode(node, 'log');
        const message = deps.resolveTemplate(typed.config.message, ctx);
        deps.bus.next({ name: 'log.output', payload: { message } });
        return { outputCtx: ctx, activePort: 'out' };
    },
};
