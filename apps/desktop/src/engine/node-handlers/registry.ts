import type { NodeType } from '@sigil/schema/nodes';

import type { NodeHandler } from './types.js';
import { manualTriggerHandler } from './manual-trigger.js';
import { ifElseHandler } from './if-else.js';
import { switchHandler } from './switch.js';
import { logHandler } from './log.js';
import { delayHandler } from './delay.js';
import { notificationHandler } from './notification.js';
import { fileWatcherHandler } from './file-watcher.js';
import { fileManagerHandler } from './file-manager.js';
import { stateGetHandler } from './state-get.js';
import { stateSetHandler } from './state-set.js';

const NODE_HANDLERS = {
    'manual-trigger': manualTriggerHandler,
    'if-else': ifElseHandler,
    switch: switchHandler,
    log: logHandler,
    delay: delayHandler,
    notification: notificationHandler,
    'file-watcher': fileWatcherHandler,
    'file-manager': fileManagerHandler,
    'state-get': stateGetHandler,
    'state-set': stateSetHandler,
} as const satisfies Record<NodeType, NodeHandler>;

export const nodeHandlers: Record<NodeType, NodeHandler> = NODE_HANDLERS;

export function getNodeHandler(type: NodeType): NodeHandler {
    return nodeHandlers[type];
}
