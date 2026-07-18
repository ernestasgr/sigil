import assert from 'node:assert/strict';
import test from 'node:test';

import { isSupportedNodeVersion } from './node-version-contract.mjs';

const supportedRange = '>=24.15.0 <25';

test('accepts the minimum and latest pinned Node 24 versions', () => {
    assert.equal(isSupportedNodeVersion('24.15.0', supportedRange), true);
    assert.equal(isSupportedNodeVersion('v24.18.0', supportedRange), true);
});

test('rejects Node versions below the minimum and outside the supported major', () => {
    assert.equal(isSupportedNodeVersion('24.14.0', supportedRange), false);
    assert.equal(isSupportedNodeVersion('25.0.0', supportedRange), false);
    assert.equal(isSupportedNodeVersion('26.3.1', supportedRange), false);
});

test('rejects malformed Node versions and engine ranges', () => {
    assert.equal(isSupportedNodeVersion('24.15', supportedRange), false);
    assert.equal(isSupportedNodeVersion('not-a-version', supportedRange), false);
    assert.equal(isSupportedNodeVersion('24.18.0', '>=24.15.0'), false);
});
