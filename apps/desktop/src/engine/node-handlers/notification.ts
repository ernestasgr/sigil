import type { NodeHandler, NodeRunResult } from './types.js';
import { narrowNode } from './types.js';

export const notificationHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        const typed = narrowNode(node, 'notification');
        const title = deps.resolveTemplate(typed.config.title, ctx);
        const body = deps.resolveTemplate(typed.config.body, ctx);
        deps.bus.next({ name: 'notification.show', payload: { title, body } });
        return { outputCtx: ctx, activePort: 'out' };
    },
};
