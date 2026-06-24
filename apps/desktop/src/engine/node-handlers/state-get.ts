import type { NodeHandler, NodeRunResult } from './types.js';

export const stateGetHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        if (node.type !== 'state-get') {
            throw new Error(
                `Node handler registry mismatch: expected "state-get", got "${node.type}"`,
            );
        }
        const { key, assignTo } = node.config;
        const value = deps.state.get(key);
        return {
            outputCtx: { ...ctx, vars: { ...ctx.vars, [assignTo]: value } },
            activePort: 'out',
        };
    },
};
