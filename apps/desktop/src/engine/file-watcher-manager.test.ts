import { describe, expect, it } from 'vitest';

import { DEFAULT_IGNORE_PATTERNS } from '@sigil/schema/properties-file';

import { createBridge } from './bridge.js';
import { createEventBus } from './event-bus.js';
import type { BusEvent } from './event-bus.js';
import { FILE_WATCHER_PLUGIN_ID, fileWatcherManifest } from './file-watcher-plugin.js';
import {
    createFileWatcherManager,
    type CreateWatcherFn,
    type FileEvent,
    type GetFileStatsFn,
} from './file-watcher-manager.js';
import { createManifestRegistry } from './manifest-registry.js';

// ─── Test helpers ─────────────────────────────────────────────────

interface MockWatcherRecord {
    readonly path: string;
    readonly recursive: boolean;
    readonly triggerEvent: (eventType: string, filename: string | null) => void;
}

function createMockWatcher(): {
    readonly watchers: MockWatcherRecord[];
    readonly createWatcher: CreateWatcherFn;
} {
    const watchers: MockWatcherRecord[] = [];
    const createWatcher: CreateWatcherFn = (watchPath, recursive, onEvent) => {
        const record: MockWatcherRecord = {
            path: watchPath,
            recursive,
            triggerEvent: (eventType, filename) => {
                onEvent(eventType, filename);
            },
        };
        watchers.push(record);
        return { close: () => {} };
    };
    return { watchers, createWatcher };
}

const MOCK_STATS = { size: 1024 };

const MOCK_STAT_FN = () => MOCK_STATS;

function createFailingStatFn(existingFiles: readonly string[]): GetFileStatsFn {
    const existing = new Set(existingFiles.map((f) => f.replace(/\\/g, '/')));
    return (filePath: string) => {
        if (existing.has(filePath.replace(/\\/g, '/'))) {
            return { size: 1024 };
        }
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
}

function collectFileEvents(): { events: FileEvent[]; onEvent: (e: FileEvent) => void } {
    const events: FileEvent[] = [];
    return {
        events,
        onEvent: (e: FileEvent) => {
            events.push(e);
        },
    };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Bridge + Manifest validation seam', () => {
    it('delivers a declared file.created event through the bridge onto the bus', () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(fileWatcherManifest);
        const bridge = createBridge(bus, registry);
        const busEvents: BusEvent[] = [];
        bus.subscribe((e) => busEvents.push(e));

        const result = bridge.emit(FILE_WATCHER_PLUGIN_ID, {
            eventName: 'file.created',
            payload: {
                path: '/tmp/report.pdf',
                name: 'report.pdf',
                ext: 'pdf',
                size: 2048576,
                dir: '/tmp',
            },
        });

        expect(result.ok).toBe(true);
        expect(busEvents).toHaveLength(1);
        expect(busEvents[0]?.name).toBe('plugin.event');
        if (busEvents[0]?.name === 'plugin.event') {
            expect(busEvents[0].payload.pluginId).toBe(FILE_WATCHER_PLUGIN_ID);
            expect(busEvents[0].payload.eventName).toBe('file.created');
            expect(busEvents[0].payload.data).toEqual({
                path: '/tmp/report.pdf',
                name: 'report.pdf',
                ext: 'pdf',
                size: 2048576,
                dir: '/tmp',
            });
        }
    });

    it('delivers file.modified and file.deleted through the bridge', () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(fileWatcherManifest);
        const bridge = createBridge(bus, registry);
        const names: string[] = [];
        bus.subscribe((e) => {
            if (e.name === 'plugin.event') names.push(e.payload.eventName);
        });

        bridge.emit(FILE_WATCHER_PLUGIN_ID, {
            eventName: 'file.modified',
            payload: { path: '/a.txt', name: 'a.txt', ext: 'txt', size: 10, dir: '/' },
        });
        bridge.emit(FILE_WATCHER_PLUGIN_ID, {
            eventName: 'file.deleted',
            payload: { path: '/b.txt', name: 'b.txt', ext: 'txt', size: 0, dir: '/' },
        });

        expect(names).toEqual(['file.modified', 'file.deleted']);
    });

    it('blocks an undeclared event name at the bridge', () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(fileWatcherManifest);
        const bridge = createBridge(bus, registry);
        const busEvents: BusEvent[] = [];
        bus.subscribe((e) => busEvents.push(e));

        const result = bridge.emit(FILE_WATCHER_PLUGIN_ID, {
            eventName: 'evil.exfil',
            payload: {},
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.kind).toBe('undeclared');
        }
        expect(busEvents).toHaveLength(0);
    });

    it('carries FileEventPayload-shaped data to the subscriber', () => {
        const bus = createEventBus();
        const registry = createManifestRegistry();
        registry.register(fileWatcherManifest);
        const bridge = createBridge(bus, registry);
        const busEvents: BusEvent[] = [];
        bus.subscribe((e) => busEvents.push(e));

        bridge.emit(FILE_WATCHER_PLUGIN_ID, {
            eventName: 'file.created',
            payload: {
                path: '/data/photo.jpg',
                name: 'photo.jpg',
                ext: 'jpg',
                size: 512000,
                dir: '/data',
            },
        });

        const event = busEvents[0];
        expect(event?.name).toBe('plugin.event');
        if (event?.name === 'plugin.event') {
            expect(event.payload.data).toEqual({
                path: '/data/photo.jpg',
                name: 'photo.jpg',
                ext: 'jpg',
                size: 512000,
                dir: '/data',
            });
        }
    });
});

describe('FileWatcherManager — watcher deduplication', () => {
    it('creates one OS watcher per unique (path, recursive) pair', () => {
        const mock = createMockWatcher();
        const manager = createFileWatcherManager(undefined, mock.createWatcher, MOCK_STAT_FN);
        const subA = collectFileEvents();
        const subB = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'sub-a',
                path: '/watch',
                recursive: true,
                events: ['file.created'],
                ignorePatterns: [],
            },
            subA.onEvent,
        );
        manager.registerSubscriber(
            {
                id: 'sub-b',
                path: '/watch',
                recursive: true,
                events: ['file.created'],
                ignorePatterns: [],
            },
            subB.onEvent,
        );

        expect(manager.getWatcherCount()).toBe(1);
        expect(manager.getSubscriberCount()).toBe(2);
        expect(mock.watchers).toHaveLength(1);
        manager.dispose();
    });

    it('creates separate watchers for different (path, recursive) pairs', () => {
        const mock = createMockWatcher();
        const manager = createFileWatcherManager(undefined, mock.createWatcher, MOCK_STAT_FN);

        manager.registerSubscriber(
            { id: 's1', path: '/a', recursive: true, events: ['file.created'], ignorePatterns: [] },
            () => {},
        );
        manager.registerSubscriber(
            { id: 's2', path: '/b', recursive: true, events: ['file.created'], ignorePatterns: [] },
            () => {},
        );
        manager.registerSubscriber(
            {
                id: 's3',
                path: '/a',
                recursive: false,
                events: ['file.created'],
                ignorePatterns: [],
            },
            () => {},
        );

        expect(manager.getWatcherCount()).toBe(3);
        expect(mock.watchers).toHaveLength(3);
        manager.dispose();
    });

    it('closes the OS watcher when the last subscriber unregisters', () => {
        const mock = createMockWatcher();
        const closed: string[] = [];
        const createWatcher: CreateWatcherFn = (watchPath, recursive, onEvent) => {
            mock.watchers.push({
                path: watchPath,
                recursive,
                triggerEvent: onEvent,
            });
            return {
                close: () => {
                    closed.push(watchPath);
                },
            };
        };
        const manager = createFileWatcherManager(undefined, createWatcher, MOCK_STAT_FN);

        manager.registerSubscriber(
            {
                id: 's1',
                path: '/shared',
                recursive: true,
                events: ['file.created'],
                ignorePatterns: [],
            },
            () => {},
        );
        manager.registerSubscriber(
            {
                id: 's2',
                path: '/shared',
                recursive: true,
                events: ['file.created'],
                ignorePatterns: [],
            },
            () => {},
        );

        expect(manager.getWatcherCount()).toBe(1);

        manager.unregisterSubscriber('s1');
        expect(manager.getWatcherCount()).toBe(1);

        manager.unregisterSubscriber('s2');
        expect(manager.getWatcherCount()).toBe(0);
        expect(closed).toContain('/shared');
        manager.dispose();
    });
});

describe('FileWatcherManager — per-subscriber ignorePatterns filtering', () => {
    it('delivers events to subscribers whose ignorePatterns do not match', () => {
        const mock = createMockWatcher();
        const manager = createFileWatcherManager(undefined, mock.createWatcher, MOCK_STAT_FN);
        const subA = collectFileEvents();
        const subB = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'filtered',
                path: '/watch',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
                ignorePatterns: ['*.tmp', '*.part'],
            },
            subA.onEvent,
        );
        manager.registerSubscriber(
            {
                id: 'unfiltered',
                path: '/watch',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
                ignorePatterns: [],
            },
            subB.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'data.tmp');
        watcher.triggerEvent('rename', 'notes.txt');
        watcher.triggerEvent('rename', 'archive.part');
        watcher.triggerEvent('change', 'report.pdf');

        expect(subA.events).toHaveLength(2);
        expect(subA.events[0]?.eventName).toBe('file.created');
        expect(subA.events[0]?.payload.name).toBe('notes.txt');
        expect(subA.events[1]?.eventName).toBe('file.modified');
        expect(subA.events[1]?.payload.name).toBe('report.pdf');

        expect(subB.events).toHaveLength(4);

        manager.dispose();
    });

    it('filters only by events the subscriber is interested in', () => {
        const mock = createMockWatcher();
        const manager = createFileWatcherManager(undefined, mock.createWatcher, MOCK_STAT_FN);
        const sub = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'only-created',
                path: '/watch',
                recursive: true,
                events: ['file.created'],
                ignorePatterns: [],
            },
            sub.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'a.txt');
        watcher.triggerEvent('change', 'a.txt');
        watcher.triggerEvent('rename', 'b.txt');

        expect(sub.events).toHaveLength(2);
        for (const e of sub.events) {
            expect(e.eventName).toBe('file.created');
        }

        manager.dispose();
    });

    it('shared OS watcher emits raw unfiltered events; filtering is per-subscriber', () => {
        const mock = createMockWatcher();
        const manager = createFileWatcherManager(undefined, mock.createWatcher, MOCK_STAT_FN);
        const subA = collectFileEvents();
        const subB = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'no-tmp',
                path: '/shared',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
                ignorePatterns: ['*.tmp'],
            },
            subA.onEvent,
        );
        manager.registerSubscriber(
            {
                id: 'no-pdf',
                path: '/shared',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
                ignorePatterns: ['*.pdf'],
            },
            subB.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(mock.watchers).toHaveLength(1);
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'file.tmp');
        watcher.triggerEvent('rename', 'doc.pdf');
        watcher.triggerEvent('change', 'notes.txt');

        expect(subA.events).toHaveLength(2);
        expect(subA.events[0]?.payload.name).toBe('doc.pdf');
        expect(subA.events[1]?.payload.name).toBe('notes.txt');

        expect(subB.events).toHaveLength(2);
        expect(subB.events[0]?.payload.name).toBe('file.tmp');
        expect(subB.events[1]?.payload.name).toBe('notes.txt');

        manager.dispose();
    });
});

describe('FileWatcherManager — ignorePatterns resolution chain', () => {
    it('uses subscriber config ignorePatterns over properties default', () => {
        const mock = createMockWatcher();
        const manager = createFileWatcherManager(['*.default'], mock.createWatcher, MOCK_STAT_FN);
        const sub = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'sub',
                path: '/watch',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
                ignorePatterns: ['*.override'],
            },
            sub.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'file.override');
        watcher.triggerEvent('rename', 'file.default');
        watcher.triggerEvent('rename', 'file.txt');

        expect(sub.events).toHaveLength(2);
        expect(sub.events[0]?.payload.name).toBe('file.default');
        expect(sub.events[1]?.payload.name).toBe('file.txt');
        manager.dispose();
    });

    it('falls back to properties default when subscriber has no ignorePatterns', () => {
        const mock = createMockWatcher();
        const manager = createFileWatcherManager(['*.global'], mock.createWatcher, MOCK_STAT_FN);
        const sub = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'sub',
                path: '/watch',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
            },
            sub.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'file.global');
        watcher.triggerEvent('rename', 'file.txt');

        expect(sub.events).toHaveLength(1);
        expect(sub.events[0]?.payload.name).toBe('file.txt');
        manager.dispose();
    });

    it('falls back to hardcoded DEFAULT_IGNORE_PATTERNS when nothing is provided', () => {
        const mock = createMockWatcher();
        const manager = createFileWatcherManager(undefined, mock.createWatcher, MOCK_STAT_FN);
        const sub = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'sub',
                path: '/watch',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
            },
            sub.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'file.crdownload');
        watcher.triggerEvent('rename', 'file.part');
        watcher.triggerEvent('rename', 'file.tmp');
        watcher.triggerEvent('rename', 'file.download');
        watcher.triggerEvent('rename', 'file.txt');

        expect(sub.events).toHaveLength(1);
        expect(sub.events[0]?.payload.name).toBe('file.txt');
        manager.dispose();
    });

    it('DEFAULT_IGNORE_PATTERNS contains the expected patterns', () => {
        expect(DEFAULT_IGNORE_PATTERNS).toEqual(['*.crdownload', '*.part', '*.tmp', '*.download']);
    });
});

describe('FileWatcherManager — file.deleted detection', () => {
    it('emits file.deleted when rename fires on a non-existent file', () => {
        const mock = createMockWatcher();
        const statFn = createFailingStatFn(['/watch/existing.txt']);
        const manager = createFileWatcherManager(undefined, mock.createWatcher, statFn);
        const sub = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'sub',
                path: '/watch',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
            },
            sub.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'existing.txt');
        watcher.triggerEvent('rename', 'deleted.txt');
        watcher.triggerEvent('rename', 'another.txt');

        expect(sub.events).toHaveLength(3);
        expect(sub.events[0]?.eventName).toBe('file.created');
        expect(sub.events[0]?.payload.name).toBe('existing.txt');
        expect(sub.events[1]?.eventName).toBe('file.deleted');
        expect(sub.events[1]?.payload.name).toBe('deleted.txt');
        expect(sub.events[2]?.eventName).toBe('file.deleted');
        expect(sub.events[2]?.payload.name).toBe('another.txt');
        manager.dispose();
    });

    it('file.deleted respects ignorePatterns', () => {
        const mock = createMockWatcher();
        const statFn = createFailingStatFn([]);
        const manager = createFileWatcherManager(undefined, mock.createWatcher, statFn);
        const sub = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'sub',
                path: '/watch',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
                ignorePatterns: ['*.tmp'],
            },
            sub.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'report.tmp');
        watcher.triggerEvent('rename', 'report.pdf');

        expect(sub.events).toHaveLength(1);
        expect(sub.events[0]?.eventName).toBe('file.deleted');
        expect(sub.events[0]?.payload.name).toBe('report.pdf');
        manager.dispose();
    });

    it('file.deleted respects per-subscriber event filtering', () => {
        const mock = createMockWatcher();
        const statFn = createFailingStatFn([]);
        const manager = createFileWatcherManager(undefined, mock.createWatcher, statFn);
        const sub = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'sub',
                path: '/watch',
                recursive: true,
                events: ['file.deleted'],
            },
            sub.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'gone.txt');
        watcher.triggerEvent('change', 'gone.txt');

        expect(sub.events).toHaveLength(1);
        expect(sub.events[0]?.eventName).toBe('file.deleted');
        expect(sub.events[0]?.payload.name).toBe('gone.txt');
        manager.dispose();
    });

    it('file.deleted payload has size 0', () => {
        const mock = createMockWatcher();
        const statFn = createFailingStatFn([]);
        const manager = createFileWatcherManager(undefined, mock.createWatcher, statFn);
        const sub = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'sub',
                path: '/watch',
                recursive: true,
                events: ['file.deleted'],
            },
            sub.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'removed.bin');

        expect(sub.events).toHaveLength(1);
        expect(sub.events[0]?.payload.size).toBe(0);
        manager.dispose();
    });

    it('change on a non-existent file emits file.modified with size 0', () => {
        const mock = createMockWatcher();
        const statFn = createFailingStatFn([]);
        const manager = createFileWatcherManager(undefined, mock.createWatcher, statFn);
        const sub = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'sub',
                path: '/watch',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
            },
            sub.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('change', 'ghost.txt');

        expect(sub.events).toHaveLength(1);
        expect(sub.events[0]?.eventName).toBe('file.modified');
        expect(sub.events[0]?.payload.name).toBe('ghost.txt');
        expect(sub.events[0]?.payload.size).toBe(0);
        manager.dispose();
    });
});

describe('FileWatcherManager — FileEventPayload shape', () => {
    it('builds payload with ext lowercased without dot', () => {
        const mock = createMockWatcher();
        const manager = createFileWatcherManager(undefined, mock.createWatcher, MOCK_STAT_FN);
        const sub = collectFileEvents();

        manager.registerSubscriber(
            {
                id: 'sub',
                path: '/watch',
                recursive: true,
                events: ['file.created', 'file.modified', 'file.deleted'],
            },
            sub.onEvent,
        );

        const watcher = mock.watchers[0];
        expect(watcher).toBeDefined();

        watcher.triggerEvent('rename', 'Photo.JPG');

        expect(sub.events).toHaveLength(1);
        const payload = sub.events[0]?.payload;
        expect(payload).toBeDefined();
        expect(payload?.name).toBe('Photo.JPG');
        expect(payload?.ext).toBe('jpg');
        expect(payload?.size).toBe(1024);
        manager.dispose();
    });
});
