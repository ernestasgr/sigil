import type { NodeType, PipelineNode } from '@sigil/schema/nodes';

import { assertNever } from '../../shared/assert-never.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type NodeSpec = DistributiveOmit<PipelineNode, 'id'>;

export function defaultSpecFor(type: NodeType): NodeSpec {
    switch (type) {
        case 'file-watcher':
            return {
                type: 'file-watcher',
                config: { path: '/', recursive: true, events: ['file.created'] },
            };
        case 'manual-trigger':
            return {
                type: 'manual-trigger',
                config: {
                    eventName: 'file.created',
                    payload: { path: '/', name: 'file', ext: 'txt', size: 0, dir: '/' },
                },
            };
        case 'if-else':
            return {
                type: 'if-else',
                config: {
                    condition: { target: 'event', operator: 'equals', value: 'file.created' },
                },
            };
        case 'switch':
            return { type: 'switch', config: { target: 'event', cases: ['file.created'] } };
        case 'file-manager':
            return {
                type: 'file-manager',
                config: { action: 'move', destination: '/', onConflict: 'skip' },
            };
        case 'notification':
            return { type: 'notification', config: { title: 'Notification', body: 'Body' } };
        case 'log':
            return { type: 'log', config: { message: 'Log message' } };
        case 'delay':
            return { type: 'delay', config: { ms: 1000 } };
        case 'state-get':
            return { type: 'state-get', config: { key: 'key', assignTo: 'value' } };
        case 'state-set':
            return { type: 'state-set', config: { key: 'key', valueTemplate: '' } };
        default:
            return assertNever(type);
    }
}
