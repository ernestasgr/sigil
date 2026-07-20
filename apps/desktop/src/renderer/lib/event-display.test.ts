import { describe, expect, it } from 'vitest';

import { extractPluginId, payloadPreview, telemetryEntryContext } from './event-display.js';

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
});
