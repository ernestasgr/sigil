import type { NodeHandler, NodeRunResult } from './types.js';

export const ifElseHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        if (node.type !== 'if-else') {
            throw new Error(
                `Node handler registry mismatch: expected "if-else", got "${node.type}"`,
            );
        }
        const activePort = deps.evaluateCondition(node.config.condition, ctx) ? 'true' : 'false';
        return { outputCtx: ctx, activePort };
    },
};
