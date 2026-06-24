import type { NodeHandler, NodeRunResult } from './types.js';

export const stateSetHandler: NodeHandler = {
    async execute({ node, ctx }, deps): Promise<NodeRunResult> {
        if (node.type !== 'state-set') {
            throw new Error(
                `Node handler registry mismatch: expected "state-set", got "${node.type}"`,
            );
        }
        const { key, valueTemplate } = node.config;
        const value = deps.resolveTemplate(valueTemplate, ctx);
        deps.state.set(key, value);
        return { outputCtx: ctx, activePort: 'out' };
    },
};
