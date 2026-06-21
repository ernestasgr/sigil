import { describe, expect, it } from 'vitest';

import { createStubCapabilityBroker } from './capability-broker.js';

describe('createStubCapabilityBroker', () => {
    it('grants any capability request in the tracer', () => {
        const broker = createStubCapabilityBroker();

        const result = broker.request({
            pluginId: 'com.sigil.file-watcher',
            capability: 'filesystem.read',
        });

        expect(result.ok).toBe(true);
    });
});
