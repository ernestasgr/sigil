import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { runDevelopment } from './dev.mjs';

function createFakeChild(pid) {
    const child = new EventEmitter();
    child.pid = pid;
    child.exitCode = null;
    child.signalCode = null;
    child.close = (code, signal) => {
        child.exitCode = code;
        child.signalCode = signal;
        child.emit('close', code, signal);
    };
    return child;
}

function createHarness() {
    const children = [];
    const terminated = [];
    const signalSource = new EventEmitter();

    const spawnProcess = (command, args, options) => {
        const child = createFakeChild(children.length + 1);
        children.push({ args, child, command, options });
        return child;
    };

    const terminateProcessTree = async (record) => {
        terminated.push(record.name);
        if (record.running) {
            record.child.close(null, 'SIGTERM');
        }
    };

    return { children, signalSource, spawnProcess, terminated, terminateProcessTree };
}

async function nextTurn() {
    await new Promise((resolve) => setImmediate(resolve));
}

test('builds the schema before starting both development processes', async () => {
    const harness = createHarness();
    const development = runDevelopment({
        platform: 'linux',
        signalSource: harness.signalSource,
        spawnProcess: harness.spawnProcess,
        terminateProcessTree: harness.terminateProcessTree,
    });

    assert.equal(harness.children.length, 1);
    assert.deepEqual(harness.children[0].args, ['--filter', '@sigil/schema', 'build']);

    harness.children[0].child.close(0, null);
    await nextTurn();

    assert.deepEqual(
        harness.children.map(({ args }) => args),
        [
            ['--filter', '@sigil/schema', 'build'],
            ['--filter', '@sigil/schema', 'dev'],
            ['--filter', '@sigil/desktop', 'dev'],
        ],
    );

    harness.children[1].child.close(1, null);

    assert.equal(await development, 1);
    assert.deepEqual(harness.terminated, ['desktop']);
});

test('returns the build failure without starting long-running processes', async () => {
    const harness = createHarness();
    const development = runDevelopment({
        platform: 'linux',
        signalSource: harness.signalSource,
        spawnProcess: harness.spawnProcess,
        terminateProcessTree: harness.terminateProcessTree,
    });

    harness.children[0].child.close(7, null);

    assert.equal(await development, 7);
    assert.equal(harness.children.length, 1);
    assert.deepEqual(harness.terminated, []);
});

test('terminates both development process trees on Ctrl+C', async () => {
    const harness = createHarness();
    const development = runDevelopment({
        platform: 'win32',
        signalSource: harness.signalSource,
        spawnProcess: harness.spawnProcess,
        terminateProcessTree: harness.terminateProcessTree,
    });

    harness.children[0].child.close(0, null);
    await nextTurn();
    harness.signalSource.emit('SIGINT');

    assert.equal(await development, 130);
    assert.deepEqual(harness.terminated, ['schema', 'desktop']);
});

test('treats an unexpected clean watcher exit as a development failure', async () => {
    const harness = createHarness();
    const development = runDevelopment({
        platform: 'linux',
        signalSource: harness.signalSource,
        spawnProcess: harness.spawnProcess,
        terminateProcessTree: harness.terminateProcessTree,
    });

    harness.children[0].child.close(0, null);
    await nextTurn();
    harness.children[1].child.close(0, null);

    assert.equal(await development, 1);
    assert.deepEqual(harness.terminated, ['desktop']);
});

test('uses Windows process-tree termination for a failed watcher', async () => {
    const harness = createHarness();
    const taskkillCalls = [];
    const development = runDevelopment({
        executeFile: async (command, args, options) => {
            taskkillCalls.push({ args, command, options });
            const pid = Number(args[1]);
            const child = harness.children.find(
                ({ child: candidate }) => candidate.pid === pid,
            )?.child;
            child?.close(null, 'SIGTERM');
        },
        platform: 'win32',
        signalSource: harness.signalSource,
        spawnProcess: harness.spawnProcess,
    });

    assert.equal(harness.children[0].command, process.env.ComSpec ?? 'cmd.exe');
    assert.deepEqual(harness.children[0].args, [
        '/d',
        '/s',
        '/c',
        'pnpm.cmd',
        '--filter',
        '@sigil/schema',
        'build',
    ]);

    harness.children[0].child.close(0, null);
    await nextTurn();
    harness.children[1].child.close(3, null);

    assert.equal(await development, 3);
    assert.deepEqual(taskkillCalls, [
        {
            args: ['/PID', '3', '/T', '/F'],
            command: 'taskkill',
            options: { windowsHide: true },
        },
    ]);
});
