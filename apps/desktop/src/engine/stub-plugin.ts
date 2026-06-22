import type { Manifest } from '@sigil/schema/manifest';

export const stubPingManifest: Manifest = {
    id: 'com.sigil.stub-ping',
    version: '0.0.1',
    permissions: [],
    emits: ['stub.ping'],
};

export const stubPingCode = `
async function start() {
    await log('stub-ping plugin starting');
    await state.set('lastRun', 12345);
    var result = await state.get('lastRun');
    var lastRun = result.ok ? result.value : null;
    await event.emit('stub.ping', { message: 'hello from stub plugin', lastRun: lastRun });
}

start().catch(function(err) {
    throw err;
});
`;
