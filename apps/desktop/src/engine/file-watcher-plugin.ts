import type { Manifest } from '@sigil/schema/manifest';

export const FILE_WATCHER_PLUGIN_ID = 'com.sigil.file-watcher';

export const fileWatcherManifest: Manifest = {
    id: FILE_WATCHER_PLUGIN_ID,
    version: '0.0.1',
    permissions: ['filesystem.read'],
    emits: ['file.created', 'file.modified', 'file.deleted'],
};

export const fileWatcherPluginCode = `
async function start() {
    await log('file-watcher plugin starting');
    await state.set('watcherVersion', '0.0.1');
}

start().catch(function(err) {
    throw err;
});
`;
