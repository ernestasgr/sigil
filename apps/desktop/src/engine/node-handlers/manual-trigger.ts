import type { TriggerHandler, NodeRunResult } from './types.js';
import { narrowNode } from './types.js';

export const manualTriggerHandler: TriggerHandler = {
    activate: () => {
        return () => {};
    },
    async execute({ node }, deps): Promise<NodeRunResult> {
        const typed = narrowNode(node, 'manual-trigger');
        const { eventName, payload } = typed.config;
        deps.bus.next({ name: 'manual.trigger.fired', payload });
        return {
            outputCtx: { event: eventName, payload, vars: {} },
            activePort: 'out',
        };
    },
};
