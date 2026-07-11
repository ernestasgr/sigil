import { randomUUID } from 'node:crypto';
import { FileWatcherConfigSchema } from '@sigil/schema/nodes/file-watcher';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Either } from 'effect';

import type {
    KernelDeps,
    NodeRunResult,
    TriggerHandler,
} from '../../engine/node-handlers/types.js';

const FILE_WATCHER_PLUGIN_ID = 'com.sigil.file-watcher';

export const descriptor = {
    type: 'file-watcher' as const,
    configSchema: FileWatcherConfigSchema,
    defaultConfig: { path: '/', recursive: true, events: ['file.created'] },
    getOutputPorts: () => ['out'] as const,
};

export function handler(kernel: KernelDeps): TriggerHandler {
    return {
        activate: (config, onEvent) => {
            const result = kernel.capabilityBroker.request({
                pluginId: FILE_WATCHER_PLUGIN_ID,
                capability: 'filesystem.read',
            });
            if (Either.isLeft(result)) {
                throw new Error(`Permission denied: ${result.left.capability}`);
            }

            const parsedConfig = FileWatcherConfigSchema.safeParse(config);
            if (!parsedConfig.success) {
                throw new Error(
                    `Invalid file-watcher configuration: ${parsedConfig.error.message}`,
                );
            }
            const c = parsedConfig.data;
            const subscriberId = `trigger:${randomUUID()}`;

            kernel.fileWatcherManager.registerSubscriber(
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
                        payload: { ...fileEvent.payload },
                        vars: {},
                    };
                    onEvent(seedCtx);
                },
            );

            return () => {
                kernel.fileWatcherManager.unregisterSubscriber(subscriberId);
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
