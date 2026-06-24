import type { NodeHandler, NodeRunResult } from './types.js';

export const stateGetHandler: NodeHandler = {
    async execute(): Promise<NodeRunResult> {
        throw new Error('Node type "state-get" is not implemented in this slice');
    },
};
