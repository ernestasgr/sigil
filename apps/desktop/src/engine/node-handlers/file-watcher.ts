import { randomUUID } from 'node:crypto';

import type { FileWatcherConfig } from '@sigil/schema/nodes';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

import type { CapabilityBroker } from '../capability-broker.js';
import { FILE_WATCHER_PLUGIN_ID } from '../file-watcher-plugin.js';
import type { FileWatcherManager } from '../file-watcher-manager.js';
import type { TriggerHandler, NodeRunResult } from './types.js';

export function createFileWatcherHandler(
    manager: FileWatcherManager,
    capabilityBroker: CapabilityBroker,
): TriggerHandler {
    return {
        activate: (config, onEvent) => {
            const result = capabilityBroker.request({
                pluginId: FILE_WATCHER_PLUGIN_ID,
                capability: 'filesystem.read',
            });
            if (!result.ok) {
                throw new Error(`Permission denied: ${result.error.capability}`);
            }

            const c = config as FileWatcherConfig;
            const subscriberId = `trigger:${randomUUID()}`;

            manager.registerSubscriber(
                {
                    id: subscriberId,
                    path: c.path,
                    recursive: c.recursive,
                    events: c.events,
                    ignorePatterns: c.ignorePatterns,
                },
                (fileEvent) => {
                    const seedCtx: WorkflowContext = {
                        event: fileEvent.eventName,
                        payload: fileEvent.payload as Record<string, unknown>,
                        vars: {},
                    };
                    onEvent(seedCtx);
                },
            );

            return () => {
                manager.unregisterSubscriber(subscriberId);
            };
        },
        async execute({ ctx }): Promise<NodeRunResult> {
            if (!ctx.event) {
                throw new Error(
                    'Node type "file-watcher" requires an external event context — execute the pipeline with a seed context',
                );
            }
            return { outputCtx: ctx, activePort: 'out' };
        },
    };
}
