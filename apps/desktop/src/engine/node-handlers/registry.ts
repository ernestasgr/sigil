import type { NodeType } from '@sigil/schema/nodes';

import type { FileWatcherManager } from '../file-watcher-manager.js';
import type { NodeHandler } from './types.js';
import { manualTriggerHandler } from './manual-trigger.js';
import { createFileWatcherHandler } from './file-watcher.js';
import { ifElseHandler } from './if-else.js';
import { switchHandler } from './switch.js';
import { logHandler } from './log.js';
import { delayHandler } from './delay.js';
import { notificationHandler } from './notification.js';
import { fileManagerHandler } from './file-manager.js';
import { stateGetHandler } from './state-get.js';
import { stateSetHandler } from './state-set.js';

export interface BuiltinHandlerDeps {
    readonly fileWatcherManager: FileWatcherManager;
}

export function createBuiltinHandlers(
    deps: BuiltinHandlerDeps,
): Readonly<Record<NodeType, NodeHandler>> {
    return {
        'manual-trigger': manualTriggerHandler,
        'file-watcher': createFileWatcherHandler(deps.fileWatcherManager),
        'if-else': ifElseHandler,
        switch: switchHandler,
        log: logHandler,
        delay: delayHandler,
        notification: notificationHandler,
        'file-manager': fileManagerHandler,
        'state-get': stateGetHandler,
        'state-set': stateSetHandler,
    } as const satisfies Record<NodeType, NodeHandler>;
}
