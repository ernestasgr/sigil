import { Either } from 'effect';
import { describe, expect, it } from 'vitest';

import {
    EngineDiagnosticPayloadSchema,
    EventPayloadSchemaRegistry,
    LogOutputPayloadSchema,
    NotificationShowPayloadSchema,
    PluginBusEventPayloadSchema,
    safeParsePayload,
    validateBusEventPayload,
    WorkflowErrorPayloadSchema,
    WorkflowRunPayloadSchema,
} from './event-payload-schemas.js';

describe('EventPayloadSchemaRegistry', () => {
    it('registers every expected engine-emitted event name', () => {
        const expectedNames = [
            'workflow.started',
            'workflow.completed',
            'workflow.error',
            'manual.trigger.fired',
            'log.output',
            'notification.show',
            'plugin.event',
            'engine.diagnostic',
        ];
        for (const name of expectedNames) {
            expect(EventPayloadSchemaRegistry[name]).toBeDefined();
        }
    });

    it.each([
        ['workflow.started', { pipelineId: 'p1' }],
        ['workflow.completed', { pipelineId: 'p1' }],
        ['workflow.error', { pipelineId: 'p1', nodeId: 'log', message: 'boom' }],
        [
            'manual.trigger.fired',
            { path: '/dl/foo.txt', name: 'foo.txt', ext: 'txt', size: 1024, dir: '/dl' },
        ],
        ['log.output', { message: 'hello' }],
        ['notification.show', { title: 'Sigil', body: 'Done' }],
        ['plugin.event', { pluginId: 'com.example', eventName: 'custom', data: { key: 'val' } }],
        ['engine.diagnostic', { message: 'watcher active' }],
    ])('accepts a valid payload for %s', (name, payload) => {
        const result = safeParsePayload(name, payload);
        expect(Either.isRight(result)).toBe(true);
    });

    it.each([
        ['log.output', { message: 'hello' }, { message: 'hello' }],
        ['notification.show', { title: 'Sigil', body: 'Done' }, { title: 'Sigil', body: 'Done' }],
        [
            'engine.diagnostic',
            { message: 'watcher active', kind: 'activation' },
            { message: 'watcher active', kind: 'activation' },
        ],
    ])('returns typed data via safeParsePayload for %s', (name, payload, expected) => {
        const result = safeParsePayload(name, payload);
        expect(Either.isRight(result)).toBe(true);
        if (Either.isRight(result)) {
            expect(result.right).toEqual(expected);
        }
    });

    it.each([
        ['workflow.started', {}],
        ['workflow.completed', { pipelineId: 42 }],
        ['workflow.error', { pipelineId: 'p1' }],
        ['manual.trigger.fired', { path: '' }],
        ['log.output', {}],
        ['notification.show', { title: 123 }],
        ['plugin.event', { pluginId: 'com.example' }],
        ['engine.diagnostic', { message: 42 }],
    ])('rejects an invalid payload for %s', (name, payload) => {
        const result = safeParsePayload(name, payload);
        expect(Either.isLeft(result)).toBe(true);
    });

    it('returns an error for an unknown event name', () => {
        const result = safeParsePayload('nonexistent.event', { message: 'x' });
        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left).toContain('Unknown event name');
        }
    });

    it('provides a label for every registered event', () => {
        for (const entry of Object.values(EventPayloadSchemaRegistry)) {
            expect(entry.label).toBeDefined();
            expect(entry.label.length).toBeGreaterThan(0);
        }
    });

    it('provides a color for every registered event', () => {
        for (const entry of Object.values(EventPayloadSchemaRegistry)) {
            expect(entry.color).toBeDefined();
            expect(entry.color.length).toBeGreaterThan(0);
        }
    });
});

describe('WorkflowRunPayloadSchema', () => {
    it('accepts a pipelineId string', () => {
        const result = WorkflowRunPayloadSchema.safeParse({ pipelineId: 'p1' });
        expect(result.success).toBe(true);
    });

    it('rejects a missing pipelineId', () => {
        const result = WorkflowRunPayloadSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('WorkflowErrorPayloadSchema', () => {
    it('accepts pipelineId, nodeId, and message', () => {
        const result = WorkflowErrorPayloadSchema.safeParse({
            pipelineId: 'p1',
            nodeId: 'log',
            message: 'boom',
        });
        expect(result.success).toBe(true);
    });

    it('rejects a missing message', () => {
        const result = WorkflowErrorPayloadSchema.safeParse({
            pipelineId: 'p1',
            nodeId: 'log',
        });
        expect(result.success).toBe(false);
    });
});

describe('LogOutputPayloadSchema', () => {
    it('accepts a message string', () => {
        const result = LogOutputPayloadSchema.safeParse({ message: 'hello' });
        expect(result.success).toBe(true);
    });

    it('rejects a missing message', () => {
        const result = LogOutputPayloadSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('NotificationShowPayloadSchema', () => {
    it('accepts title and body', () => {
        const result = NotificationShowPayloadSchema.safeParse({
            title: 'Sigil',
            body: 'Done',
        });
        expect(result.success).toBe(true);
    });

    it('rejects a missing body', () => {
        const result = NotificationShowPayloadSchema.safeParse({ title: 'Sigil' });
        expect(result.success).toBe(false);
    });
});

describe('PluginBusEventPayloadSchema', () => {
    it('accepts pluginId, eventName, and data', () => {
        const result = PluginBusEventPayloadSchema.safeParse({
            pluginId: 'com.example',
            eventName: 'custom',
            data: { key: 'val' },
        });
        expect(result.success).toBe(true);
    });

    it('rejects a missing eventName', () => {
        const result = PluginBusEventPayloadSchema.safeParse({
            pluginId: 'com.example',
            data: {},
        });
        expect(result.success).toBe(false);
    });
});

describe('EngineDiagnosticPayloadSchema', () => {
    it('accepts a message string', () => {
        const result = EngineDiagnosticPayloadSchema.safeParse({
            message: 'watcher active',
        });
        expect(result.success).toBe(true);
    });

    it('accepts message with optional kind', () => {
        const result = EngineDiagnosticPayloadSchema.safeParse({
            message: 'watcher active',
            kind: 'activation',
        });
        expect(result.success).toBe(true);
    });

    it('rejects a missing message', () => {
        const result = EngineDiagnosticPayloadSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('validateBusEventPayload', () => {
    it('returns Right for a valid payload', () => {
        const result = validateBusEventPayload('log.output', { message: 'hi' });
        expect(Either.isRight(result)).toBe(true);
    });

    it('returns Left with error for an invalid payload', () => {
        const result = validateBusEventPayload('log.output', {});
        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left).toContain('Invalid payload');
        }
    });

    it('returns Left with error for an unknown event name', () => {
        const result = validateBusEventPayload('unknown.event', { message: 'x' });
        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            expect(result.left).toContain('Unknown event name');
        }
    });
});
