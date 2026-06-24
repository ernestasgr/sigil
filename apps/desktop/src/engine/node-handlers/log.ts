import type { NodeHandler, NodeRunResult } from './types.js';

export const logHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        if (node.type !== 'log') {
            throw new Error(`Node handler registry mismatch: expected "log", got "${node.type}"`);
        }
        const message = deps.resolveTemplate(node.config.message, ctx);
        deps.bus.next({ name: 'log.output', payload: { message } });
        return { outputCtx: ctx, activePort: 'out' };
    },
};
