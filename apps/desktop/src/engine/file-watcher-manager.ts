import { statSync, watch as fsWatch } from 'node:fs';
import { join, parse } from 'node:path';

import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import { DEFAULT_IGNORE_PATTERNS } from '@sigil/schema/properties-file';

// ─── Types ───────────────────────────────────────────────────────

export interface WatcherHandle {
    readonly close: () => void;
}

export type CreateWatcherFn = (
    watchPath: string,
    recursive: boolean,
    onEvent: (eventType: string, filename: string | null) => void,
) => WatcherHandle;

export type GetFileStatsFn = (filePath: string) => { readonly size: number };

export interface SubscriberRegistration {
    readonly id: string;
    readonly path: string;
    readonly recursive: boolean;
    readonly events: readonly string[];
    readonly ignorePatterns?: readonly string[] | undefined;
}

export interface FileEvent {
    readonly eventName: 'file.created' | 'file.modified' | 'file.deleted';
    readonly payload: FileEventPayload;
}

export type FileEventCallback = (event: FileEvent) => void;

interface SubscriberEntry {
    readonly config: SubscriberRegistration;
    readonly onEvent: FileEventCallback;
}

interface WatcherEntry {
    readonly handle: WatcherHandle;
    readonly subscribers: Map<string, SubscriberEntry>;
}

export interface FileWatcherManager {
    readonly registerSubscriber: (
        config: SubscriberRegistration,
        onEvent: FileEventCallback,
    ) => void;
    readonly unregisterSubscriber: (id: string) => void;
    readonly getWatcherCount: () => number;
    readonly getSubscriberCount: () => number;
    readonly dispose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────

function watcherKey(path: string, recursive: boolean): string {
    return `${path}::${recursive}`;
}

function matchesGlob(filename: string, pattern: string): boolean {
    const regex = new RegExp(
        '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
        'i',
    );
    return regex.test(filename);
}

function shouldIgnore(filename: string, patterns: readonly string[]): boolean {
    return patterns.length > 0 && patterns.some((pattern) => matchesGlob(filename, pattern));
}

function resolveIgnorePatterns(
    subscriberConfig: readonly string[] | undefined,
    propertiesDefault: readonly string[] | undefined,
): readonly string[] {
    if (subscriberConfig !== undefined) {
        return subscriberConfig;
    }
    if (propertiesDefault !== undefined && propertiesDefault.length > 0) {
        return propertiesDefault;
    }
    return DEFAULT_IGNORE_PATTERNS;
}

function eventTypeToFileEventName(
    eventType: string,
): 'file.created' | 'file.modified' | 'file.deleted' {
    if (eventType === 'change') {
        return 'file.modified';
    }
    return 'file.created';
}

function buildFileEventPayload(filePath: string, size: number): FileEventPayload {
    const parsed = parse(filePath);
    return {
        path: filePath,
        name: parsed.base,
        ext: parsed.ext.length > 1 ? parsed.ext.slice(1).toLowerCase() : '',
        size,
        dir: parsed.dir,
    };
}

// ─── Factory ─────────────────────────────────────────────────────

export function createFileWatcherManager(
    defaultIgnorePatterns?: readonly string[],
    createWatcher?: CreateWatcherFn,
    getFileStats?: GetFileStatsFn,
): FileWatcherManager {
    const resolvedDefaultPatterns = defaultIgnorePatterns ?? DEFAULT_IGNORE_PATTERNS;
    const resolvedCreateWatcher: CreateWatcherFn =
        createWatcher ??
        ((watchPath, recursive, onEvent) => {
            const watcher = fsWatch(watchPath, { recursive }, (eventType, filename) => {
                onEvent(eventType, filename);
            });
            return { close: () => watcher.close() };
        });
    const resolvedGetFileStats: GetFileStatsFn =
        getFileStats ??
        ((fp) => {
            const stats = statSync(fp);
            return { size: stats.size };
        });

    const watchers = new Map<string, WatcherEntry>();

    function ensureWatcher(path: string, recursive: boolean): WatcherEntry {
        const key = watcherKey(path, recursive);
        const existing = watchers.get(key);
        if (existing) {
            return existing;
        }
        const subscribers = new Map<string, SubscriberEntry>();
        const handle = resolvedCreateWatcher(path, recursive, (eventType, filename) => {
            const entry = watchers.get(key);
            if (!entry) return;

            const subscribersList = Array.from(entry.subscribers.values());
            if (subscribersList.length === 0) return;

            for (const sub of subscribersList) {
                const patterns = resolveIgnorePatterns(
                    sub.config.ignorePatterns,
                    resolvedDefaultPatterns,
                );
                if (filename !== null && shouldIgnore(filename, patterns)) {
                    continue;
                }

                const eventName = eventTypeToFileEventName(eventType);
                if (!sub.config.events.includes(eventName)) {
                    continue;
                }

                const fullPath = filename !== null ? join(path, filename) : path;
                try {
                    const stats = resolvedGetFileStats(fullPath);
                    const payload = buildFileEventPayload(fullPath, stats.size);
                    sub.onEvent({ eventName, payload });
                } catch {
                    if (eventName === 'file.created') {
                        return;
                    }
                    const payload = buildFileEventPayload(fullPath, 0);
                    sub.onEvent({ eventName, payload });
                }
            }
        });
        const entry: WatcherEntry = { handle, subscribers };
        watchers.set(key, entry);
        return entry;
    }

    function removeWatcherIfEmpty(key: string): void {
        const entry = watchers.get(key);
        if (entry && entry.subscribers.size === 0) {
            entry.handle.close();
            watchers.delete(key);
        }
    }

    return {
        registerSubscriber: (config, onEvent) => {
            const entry = ensureWatcher(config.path, config.recursive);
            entry.subscribers.set(config.id, { config, onEvent });
        },

        unregisterSubscriber: (id) => {
            for (const [key, entry] of watchers) {
                if (entry.subscribers.has(id)) {
                    entry.subscribers.delete(id);
                    removeWatcherIfEmpty(key);
                    return;
                }
            }
        },

        getWatcherCount: () => watchers.size,

        getSubscriberCount: () => {
            let count = 0;
            for (const entry of watchers.values()) {
                count += entry.subscribers.size;
            }
            return count;
        },

        dispose: () => {
            for (const entry of watchers.values()) {
                entry.handle.close();
            }
            watchers.clear();
        },
    };
}
