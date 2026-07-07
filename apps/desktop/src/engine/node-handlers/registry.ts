import type { NodeHandler } from './types.js';
import { manualTriggerHandler } from './manual-trigger.js';
import { ifElseHandler } from './if-else.js';
import { switchHandler } from './switch.js';
import { logHandler } from './log.js';
import { delayHandler } from './delay.js';
import { notificationHandler } from './notification.js';
import { stateGetHandler } from './state-get.js';
import { stateSetHandler } from './state-set.js';

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
