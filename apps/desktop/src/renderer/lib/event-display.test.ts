import { describe, expect, it } from 'vitest';

import {
    extractPluginId,
    payloadPreview,
    telemetryEntryContext,
    telemetryEntryPreview,
} from './event-display.js';

describe('event display', () => {
    it('renders a valid registered payload through its schema', () => {
        expect(payloadPreview('log.output', { message: 'hello' })).toBe('hello');
    });

    it('does not extract diagnostic context from an invalid registered payload', () => {
        expect(
            telemetryEntryContext({
                id: 1,
                name: 'engine.diagnostic',
                payload: { message: 42, source: 'worker' },
                timestamp: 1700000000000,
            }),
        ).toBe('');
    });

    it('renders the nested topology target and code in diagnostic context', () => {
        const context = telemetryEntryContext({
            id: 2,
            name: 'engine.diagnostic',
            payload: {
                message: '[topology:invalid_output_port] Invalid output port.',
                source: 'engine',
                outcome: 'failed',
                diagnostic: {
                    severity: 'error',
                    code: 'invalid_output_port',
                    target: { kind: 'edge', edgeId: 'router-log', relatedNodeId: 'router' },
                    message: 'The output port is not declared.',
                },
            },
            timestamp: 1700000000000,
        });

        expect(context).toContain('target=Edge router-log');
        expect(context).toContain('Node router');
        expect(context).toContain('code=invalid_output_port');
    });

    it('keeps opaque payload formatting for unknown event names', () => {
        expect(payloadPreview('future.event', { arbitrary: ['data'] })).toBe(
            '{"arbitrary":["data"]}',
        );
    });

    it('uses the opaque formatter for an invalid registered payload', () => {
        expect(payloadPreview('log.output', { message: 42 })).toBe('{"message":42}');
    });

    it('does not extract plugin identity from an invalid registered payload', () => {
        expect(
            extractPluginId('plugin.event', {
                pluginId: 'com.example.plugin',
                eventName: 'custom',
                data: 'not-a-record',
            }),
        ).toBeUndefined();
    });

    it('presents permission transition fields without a telemetry summary', () => {
        const entry = {
            id: 1,
            name: 'plugin.permission.changed',
            payload: {
                pluginId: 'com.example.plugin',
                previous: ['filesystem.read'],
                next: ['state.write'],
                actor: 'user',
                cancelledRuns: ['run-1'],
            },
            timestamp: 1700000000000,
        };

        expect(telemetryEntryPreview(entry)).toBe(
            'plugin=com.example.plugin, previous=[filesystem.read], next=[state.write]',
        );
        expect(telemetryEntryContext(entry)).toBe(
            'plugin=com.example.plugin · actor=user · cancelledRuns=[run-1]',
        );
    });
});
