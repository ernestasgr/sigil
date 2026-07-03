import type { Manifest } from '@sigil/schema/manifest';

export const FILE_MANAGER_PLUGIN_ID = 'com.sigil.file-manager';

export const fileManagerManifest: Manifest = {
    id: FILE_MANAGER_PLUGIN_ID,
    version: '0.0.1',
    permissions: ['filesystem.read', 'filesystem.write'],
    emits: ['file-manager.completed'],
};

export const fileManagerPluginCode = `
async function start() {
    await log('file-manager plugin starting');
    await state.set('managerVersion', '0.0.1');
}

start().catch(function(err) {
    log('file-manager startup error: ' + err.message);
});
`;
