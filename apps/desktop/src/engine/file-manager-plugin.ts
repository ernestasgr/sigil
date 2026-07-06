import type { Manifest } from '@sigil/schema/manifest';

export const FILE_MANAGER_PLUGIN_ID = 'com.sigil.file-manager';

export const fileManagerManifest: Manifest = {
    id: FILE_MANAGER_PLUGIN_ID,
    version: '0.0.1',
    permissions: ['state.write', 'filesystem.read', 'filesystem.write'],
    emits: ['file-manager.completed'],
};
