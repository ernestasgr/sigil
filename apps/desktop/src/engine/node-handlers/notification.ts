import type { NodeHandler, NodeRunResult } from './types.js';

export const notificationHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        if (node.type !== 'notification') {
            throw new Error(
                `Node handler registry mismatch: expected "notification", got "${node.type}"`,
            );
        }
        const title = deps.resolveTemplate(node.config.title, ctx);
        const body = deps.resolveTemplate(node.config.body, ctx);
        deps.bus.next({ name: 'notification.show', payload: { title, body } });
        return { outputCtx: ctx, activePort: 'out' };
    },
};
