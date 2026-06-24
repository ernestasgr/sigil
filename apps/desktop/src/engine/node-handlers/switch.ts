import type { NodeHandler, NodeRunResult } from './types.js';

export const switchHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        if (node.type !== 'switch') {
            throw new Error(
                `Node handler registry mismatch: expected "switch", got "${node.type}"`,
            );
        }
        return { outputCtx: ctx, activePort: deps.matchSwitchCase(node.config, ctx) };
    },
};
