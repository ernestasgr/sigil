import type { NodeHandler, NodeRunResult } from './types.js';

export const fileManagerHandler: NodeHandler = {
    async execute(): Promise<NodeRunResult> {
        throw new Error('Node type "file-manager" is not implemented in this slice');
    },
};
