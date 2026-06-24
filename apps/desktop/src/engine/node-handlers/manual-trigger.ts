import type { NodeHandler, NodeRunResult } from './types.js';

export const manualTriggerHandler: NodeHandler = {
    async execute({ node }, deps): Promise<NodeRunResult> {
        if (node.type !== 'manual-trigger') {
            throw new Error(
                `Node handler registry mismatch: expected "manual-trigger", got "${node.type}"`,
            );
        }
        const { eventName, payload } = node.config;
        deps.bus.next({ name: 'manual.trigger.fired', payload });
        return {
            outputCtx: { event: eventName, payload, vars: {} },
            activePort: 'out',
        };
    },
};
