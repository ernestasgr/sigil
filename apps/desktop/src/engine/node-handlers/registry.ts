import { delayHandler } from './delay.js';
import { ifElseHandler } from './if-else.js';
import { logHandler } from './log.js';
import { manualTriggerHandler } from './manual-trigger.js';
import { notificationHandler } from './notification.js';
import { stateGetHandler } from './state-get.js';
import { stateSetHandler } from './state-set.js';
import { switchHandler } from './switch.js';
import type { NodeHandler } from './types.js';

export function createBuiltinHandlers(): Readonly<Record<string, NodeHandler>> {
    return {
        'manual-trigger': manualTriggerHandler,
        'if-else': ifElseHandler,
        switch: switchHandler,
        log: logHandler,
        delay: delayHandler,
        notification: notificationHandler,
        'state-get': stateGetHandler,
        'state-set': stateSetHandler,
    };
}
