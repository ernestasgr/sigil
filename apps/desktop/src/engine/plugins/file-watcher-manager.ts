import { watch as fsWatch, realpathSync, statSync } from 'node:fs';
import { join, parse } from 'node:path';
import { FileEventNameSchema } from '@sigil/schema/event-catalog';
import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import { FileEventPayloadSchema } from '@sigil/schema/file-event-payload';
import { DEFAULT_IGNORE_PATTERNS } from '@sigil/schema/properties-file';
import { Option } from 'effect';
import { z } from 'zod';

export interface WatcherHandle {
    readonly close: () => void;
}

export type CreateWatcherFn = (
    watchPath: string,
    recursive: boolean,
    onEvent: (eventType: string, filename: string | null) => void,
) => WatcherHandle;

export type GetFileStatsFn = (filePath: string) => { readonly size: number };

export const SubscriberRegistrationSchema = z
    .object({
        id: z.string().min(1),
        path: z.string().min(1),
        recursive: z.boolean(),
        events: z.array(FileEventNameSchema).readonly(),
        ignorePatterns: z.array(z.string()).readonly().optional(),
    })
    .readonly();
export type SubscriberRegistration = z.infer<typeof SubscriberRegistrationSchema>;

export const FileEventSchema = z
    .object({
        eventName: FileEventNameSchema,
        payload: FileEventPayloadSchema,
    })
    .readonly();
export type FileEvent = z.infer<typeof FileEventSchema>;

export type FileEventCallback = (event: FileEvent) => void;

interface SubscriberEntry {
    readonly config: SubscriberRegistration;
    readonly onEvent: FileEventCallback;
    readonly ownerPluginId?: string;
}

interface WatcherEntry {
    readonly handle: WatcherHandle;
    readonly subscribers: Map<string, SubscriberEntry>;
}

export interface FileWatcherManager {
    readonly registerSubscriber: (
        config: SubscriberRegistration,
        onEvent: FileEventCallback,
        ownerPluginId?: string,
    ) => void | Promise<void>;
    readonly unregisterSubscriber: (id: string, ownerPluginId?: string) => void | Promise<void>;
    readonly unregisterSubscribersByOwner: (ownerPluginId: string) => void | Promise<void>;
    readonly getSubscriberIdsByOwner: (ownerPluginId: string) => readonly string[];
    readonly getWatcherCount: () => number;
    readonly getSubscriberCount: () => number;
    readonly setDefaultIgnorePatterns: (patterns: readonly string[]) => void;
    readonly dispose: () => void;
}

function watcherKey(path: string, recursive: boolean): string {
    return `${path}::${recursive}`;
}

function subscriberKey(id: string, ownerPluginId: string | undefined): string {
    return JSON.stringify([ownerPluginId ?? null, id]);
}

function resolveWatcherPath(path: string): string {
    if (process.platform !== 'win32') {
        return path;
    }

    try {
        return realpathSync.native(path);
    } catch {
        // Preserve fs.watch's existing error for paths that do not exist.
        return path;
    }
}

function matchesGlob(filename: string, pattern: string): boolean {
    const regex = new RegExp(
        `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
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
    if (propertiesDefault !== undefined) {
        return propertiesDefault;
    }
    return DEFAULT_IGNORE_PATTERNS;
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

export function createFileWatcherManager(
    defaultIgnorePatterns?: readonly string[],
    createWatcher?: CreateWatcherFn,
    getFileStats?: GetFileStatsFn,
): FileWatcherManager {
    let resolvedDefaultPatterns = defaultIgnorePatterns ?? DEFAULT_IGNORE_PATTERNS;
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
        const resolvedPath = resolveWatcherPath(path);
        const key = watcherKey(resolvedPath, recursive);
        const existing = watchers.get(key);
        if (existing) {
            return existing;
        }
        const subscribers = new Map<string, SubscriberEntry>();
        const handle = resolvedCreateWatcher(resolvedPath, recursive, (eventType, filename) => {
            const entry = watchers.get(key);
            if (!entry) return;

            const subscribersList = Array.from(entry.subscribers.values());
            if (subscribersList.length === 0) return;

            if (filename === null) return;

            const fullPath = join(resolvedPath, filename);

            let stats: Option.Option<{ readonly size: number }> = Option.none();
            try {
                stats = Option.some(resolvedGetFileStats(fullPath));
            } catch {
                // stat failed — event may be a deletion or a race
            }

            let eventName: 'file.created' | 'file.modified' | 'file.deleted';
            if (eventType === 'change') {
                eventName = 'file.modified';
            } else if (Option.isSome(stats)) {
                eventName = 'file.created';
            } else {
                eventName = 'file.deleted';
            }

            const size = Option.getOrUndefined(stats)?.size ?? 0;
            const payload = buildFileEventPayload(fullPath, size);

            for (const sub of subscribersList) {
                const patterns = resolveIgnorePatterns(
                    sub.config.ignorePatterns,
                    resolvedDefaultPatterns,
                );
                if (shouldIgnore(filename, patterns)) {
                    continue;
                }

                if (!sub.config.events.includes(eventName)) {
                    continue;
                }

                sub.onEvent({ eventName, payload });
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

    function removeMatchingSubscribers(predicate: (subscriber: SubscriberEntry) => boolean): void {
        for (const [key, entry] of watchers) {
            for (const [id, subscriber] of entry.subscribers) {
                if (predicate(subscriber)) {
                    entry.subscribers.delete(id);
                }
            }
            removeWatcherIfEmpty(key);
        }
    }

    return {
        registerSubscriber: (config, onEvent, ownerPluginId) => {
            removeMatchingSubscribers(
                (subscriber) =>
                    subscriber.config.id === config.id &&
                    subscriber.ownerPluginId === ownerPluginId,
            );
            const entry = ensureWatcher(config.path, config.recursive);
            entry.subscribers.set(subscriberKey(config.id, ownerPluginId), {
                config,
                onEvent,
                ownerPluginId,
            });
        },

        unregisterSubscriber: (id, ownerPluginId) => {
            removeMatchingSubscribers(
                (subscriber) =>
                    subscriber.config.id === id &&
                    (ownerPluginId === undefined || subscriber.ownerPluginId === ownerPluginId),
            );
        },

        unregisterSubscribersByOwner: (ownerPluginId) => {
            removeMatchingSubscribers((subscriber) => subscriber.ownerPluginId === ownerPluginId);
        },

        getSubscriberIdsByOwner: (ownerPluginId) => {
            const subscriberIds: string[] = [];
            for (const entry of watchers.values()) {
                for (const subscriber of entry.subscribers.values()) {
                    if (subscriber.ownerPluginId === ownerPluginId) {
                        subscriberIds.push(subscriber.config.id);
                    }
                }
            }
            return subscriberIds;
        },

        getWatcherCount: () => watchers.size,

        getSubscriberCount: () =>
            Array.from(watchers.values()).reduce(
                (count, entry) => count + entry.subscribers.size,
                0,
            ),

        setDefaultIgnorePatterns: (patterns) => {
            resolvedDefaultPatterns = patterns;
        },

        dispose: () => {
            for (const entry of watchers.values()) {
                entry.handle.close();
            }
            watchers.clear();
        },
    };
}
