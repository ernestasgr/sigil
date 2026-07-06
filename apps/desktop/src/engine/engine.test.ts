import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sampleManualTriggerToLog } from '@sigil/schema/samples';

import type { BusEvent } from './event-bus.js';
import { createEngine } from './engine.js';

describe('createEngine', () => {
    it('exposes the event bus, stub bridge, and stub capability broker', () => {
        const engine = createEngine();

        expect(engine.bus).toBeDefined();
        expect(engine.bridge).toBeDefined();
        expect(engine.capabilityBroker).toBeDefined();
    });

    it('runs the sample pipeline through execute and emits log.output on the bus', async () => {
        const engine = createEngine();
        const events: BusEvent[] = [];
        engine.bus.subscribe((event) => {
            events.push(event);
        });

        await engine.execute(sampleManualTriggerToLog);

        const logEvent = events.find((event) => event.name === 'log.output');
        expect(logEvent).toBeDefined();
        expect(logEvent?.name === 'log.output' && logEvent.payload.message).toBe(
            'Manual trigger fired for report.pdf (2048576 bytes)',
        );
    });

    it('defaults notifyOnWorkflowError to true when no properties are provided', () => {
        const engine = createEngine();
        expect(engine.settings.notifyOnWorkflowError).toBe(true);
    });

    it('reads notifyOnWorkflowError from the provided properties file content', () => {
        const engine = createEngine({ properties: { notifyOnWorkflowError: false } });
        expect(engine.settings.notifyOnWorkflowError).toBe(false);
    });

    it('falls back to the hardcoded default when the properties content is malformed', () => {
        const engine = createEngine({ properties: { notifyOnWorkflowError: 'not-a-boolean' } });
        expect(engine.settings.notifyOnWorkflowError).toBe(true);
    });

    it('uses :memory: for the database when no databasePath is provided', () => {
        const engine = createEngine();
        expect(engine.workflowStateStore).toBeDefined();
        engine.dispose();
    });

    it('exposes a handler registry with all builtin handlers', () => {
        const engine = createEngine();

        expect(engine.handlerRegistry.has('manual-trigger')).toBe(true);
        expect(engine.handlerRegistry.has('file-watcher')).toBe(true);
        expect(engine.handlerRegistry.has('file-manager')).toBe(true);
        expect(engine.handlerRegistry.has('log')).toBe(true);
        engine.dispose();
    });

    it('registerBuiltinManifests registers file-watcher and file-manager manifests', () => {
        const engine = createEngine();

        expect(engine.registry.has('com.sigil.file-watcher')).toBe(false);
        expect(engine.registry.has('com.sigil.file-manager')).toBe(false);

        engine.registerBuiltinManifests();

        expect(engine.registry.has('com.sigil.file-watcher')).toBe(true);
        expect(engine.registry.has('com.sigil.file-manager')).toBe(true);
        engine.dispose();
    });

    it('registerBuiltinManifests is idempotent', () => {
        const engine = createEngine();

        engine.registerBuiltinManifests();
        engine.registerBuiltinManifests();

        expect(engine.registry.all()).toHaveLength(2);
        engine.dispose();
    });
});

describe('createEngine — databasePath from properties', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sigil-engine-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('opens the SQLite file at the databasePath from properties', () => {
        const dbPath = join(tempDir, 'from-properties.db');
        const engine = createEngine({ properties: { databasePath: dbPath } });
        engine.workflowStateStore.forWorkflow('wf').set('k', 'persisted');
        engine.workflowStateStore.flushAll();
        engine.dispose();

        const reader = createEngine({ properties: { databasePath: dbPath } });
        expect(reader.workflowStateStore.forWorkflow('wf').get('k')).toBe('persisted');
        reader.dispose();
    });

    it('falls back to defaultDatabasePath when properties omit databasePath', () => {
        const dbPath = join(tempDir, 'from-default.db');
        const engine = createEngine({
            properties: {},
            defaultDatabasePath: dbPath,
        });
        engine.workflowStateStore.forWorkflow('wf').set('k', 'default-used');
        engine.workflowStateStore.flushAll();
        engine.dispose();

        const reader = createEngine({
            properties: {},
            defaultDatabasePath: dbPath,
        });
        expect(reader.workflowStateStore.forWorkflow('wf').get('k')).toBe('default-used');
        reader.dispose();
    });

    it('an explicit databasePath in properties wins over defaultDatabasePath', () => {
        const explicit = join(tempDir, 'explicit.db');
        const fallback = join(tempDir, 'fallback.db');
        const engine = createEngine({
            properties: { databasePath: explicit },
            defaultDatabasePath: fallback,
        });
        engine.workflowStateStore.forWorkflow('wf').set('k', 'explicit-wins');
        engine.workflowStateStore.flushAll();
        engine.dispose();

        const fromExplicit = createEngine({ properties: { databasePath: explicit } });
        expect(fromExplicit.workflowStateStore.forWorkflow('wf').get('k')).toBe('explicit-wins');
        fromExplicit.dispose();

        const fromFallback = createEngine({ properties: { databasePath: fallback } });
        expect(fromFallback.workflowStateStore.forWorkflow('wf').get('k')).toBeUndefined();
        fromFallback.dispose();
    });
});
