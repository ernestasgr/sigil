import type { Manifest } from '@sigil/schema/manifest';

export const FILE_WATCHER_PLUGIN_ID = 'com.sigil.file-watcher';

export const fileWatcherManifest: Manifest = {
    id: FILE_WATCHER_PLUGIN_ID,
    version: '0.0.1',
    permissions: ['state.write', 'filesystem.read'],
    emits: ['file.created', 'file.modified', 'file.deleted'],
};
