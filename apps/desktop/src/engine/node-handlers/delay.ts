import type { NodeHandler, NodeRunResult } from './types.js';

export const delayHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        if (node.type !== 'delay') {
            throw new Error(`Node handler registry mismatch: expected "delay", got "${node.type}"`);
        }
        await deps.sleep(node.config.ms);
        return { outputCtx: ctx, activePort: 'out' };
    },
};
