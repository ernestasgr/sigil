import type { NodeHandler, NodeRunResult } from './types.js';

export const fileWatcherHandler: NodeHandler = {
    async execute({ node, ctx }): Promise<NodeRunResult> {
        if (node.type !== 'file-watcher') {
            throw new Error(
                `Node handler registry mismatch: expected "file-watcher", got "${node.type}"`,
            );
        }
        if (!ctx.event) {
            throw new Error(
                'Node type "file-watcher" requires an external event context — execute the pipeline with a seed context',
            );
        }
        return { outputCtx: ctx, activePort: 'out' };
    },
};
