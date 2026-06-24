import type { NodeHandler, NodeRunResult } from './types.js';

export const stateSetHandler: NodeHandler = {
    async execute(): Promise<NodeRunResult> {
        throw new Error('Node type "state-set" is not implemented in this slice');
    },
};
