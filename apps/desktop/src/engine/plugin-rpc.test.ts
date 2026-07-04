import { describe, expect, it } from 'vitest';

import {
    PluginLifecycleKind,
    PluginRpcKind,
    PluginRpcRequestSchema,
    PluginRpcResponseSchema,
    PluginToEngineMessageSchema,
    EngineToPluginMessageSchema,
    type PluginToEngineMessage,
    type EngineToPluginMessage,
} from './plugin-rpc.js';

describe('PluginToEngineMessageSchema', () => {
    it('accepts a well-formed event.emit request', () => {
        const message: PluginToEngineMessage = {
            kind: PluginRpcKind.EventEmit,
            requestId: 'r1',
            pluginId: 'com.example.plugin',
            eventName: 'test.event',
            payload: { data: 42 },
        };
        const result = PluginToEngineMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('accepts a plugin:ready lifecycle message', () => {
        const message: PluginToEngineMessage = {
            kind: PluginLifecycleKind.Ready,
            pluginId: 'com.example.plugin',
        };
        const result = PluginToEngineMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('accepts a plugin:error lifecycle message', () => {
        const message: PluginToEngineMessage = {
            kind: PluginLifecycleKind.Error,
            pluginId: 'com.example.plugin',
            message: 'something went wrong',
        };
        const result = PluginToEngineMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('rejects a message with an unknown kind', () => {
        const message = { kind: 'plugin:unknown', requestId: 'r1' };
        const result = PluginToEngineMessageSchema.safeParse(message);
        expect(result.success).toBe(false);
    });

    it('rejects a message missing required fields', () => {
        const message = { kind: PluginRpcKind.EventEmit };
        const result = PluginToEngineMessageSchema.safeParse(message);
        expect(result.success).toBe(false);
    });

    it('rejects null', () => {
        const result = PluginToEngineMessageSchema.safeParse(null);
        expect(result.success).toBe(false);
    });
});

describe('EngineToPluginMessageSchema (PluginRpcResponseSchema)', () => {
    it('accepts a well-formed success response', () => {
        const message: EngineToPluginMessage = {
            kind: PluginLifecycleKind.Result,
            requestId: 'r1',
            ok: true,
            value: { result: 'ok' },
        };
        const result = EngineToPluginMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('accepts a well-formed error response', () => {
        const message: EngineToPluginMessage = {
            kind: PluginLifecycleKind.Result,
            requestId: 'r1',
            ok: false,
            error: 'invalid_payload',
        };
        const result = EngineToPluginMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
    });

    it('rejects a response without ok field', () => {
        const message = { kind: PluginLifecycleKind.Result, requestId: 'r1' };
        const result = EngineToPluginMessageSchema.safeParse(message);
        expect(result.success).toBe(false);
    });

    it('rejects a response with wrong literal kind', () => {
        const message = {
            kind: PluginLifecycleKind.Ready,
            requestId: 'r1',
            ok: true,
            value: null,
        };
        const result = EngineToPluginMessageSchema.safeParse(message);
        expect(result.success).toBe(false);
    });
});

describe('PluginRpcRequestSchema', () => {
    it('accepts a well-formed state.get request', () => {
        const result = PluginRpcRequestSchema.safeParse({
            kind: PluginRpcKind.StateGet,
            requestId: 'r1',
            pluginId: 'com.example.plugin',
            key: 'counter',
        });
        expect(result.success).toBe(true);
    });

    it('accepts a well-formed log request', () => {
        const result = PluginRpcRequestSchema.safeParse({
            kind: PluginRpcKind.Log,
            requestId: 'r1',
            pluginId: 'com.example.plugin',
            message: 'hello',
        });
        expect(result.success).toBe(true);
    });

    it('rejects a lifecycle message in PluginRpcRequestSchema', () => {
        const result = PluginRpcRequestSchema.safeParse({
            kind: PluginLifecycleKind.Ready,
            pluginId: 'com.example.plugin',
        });
        expect(result.success).toBe(false);
    });
});

describe('PluginRpcResponseSchema', () => {
    it('accepts invalid_message as a valid error string', () => {
        const result = PluginRpcResponseSchema.safeParse({
            kind: PluginLifecycleKind.Result,
            requestId: '',
            ok: false,
            error: 'invalid_message',
        });
        expect(result.success).toBe(true);
    });

    it('rejects a response with ok: true but missing value', () => {
        const result = PluginRpcResponseSchema.safeParse({
            kind: PluginLifecycleKind.Result,
            requestId: 'r1',
            ok: true,
        });
        expect(result.success).toBe(false);
    });
});
