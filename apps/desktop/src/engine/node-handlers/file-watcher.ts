import type { NodeHandler, NodeRunResult } from './types.js';

export const fileWatcherHandler: NodeHandler = {
    async execute(): Promise<NodeRunResult> {
        throw new Error(
            'Node type "file-watcher" is a plugin and is not executed directly by the DAG executor',
        );
    },
};
