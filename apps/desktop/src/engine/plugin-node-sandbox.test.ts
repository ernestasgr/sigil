import { CapabilitySchema } from '@sigil/schema/manifest';
import { describe, expect, it } from 'vitest';

import {
    buildPermissionGatedModule,
    getSandboxModuleNames,
    SANDBOX_CAPABILITY_TABLE,
} from './plugin-node-sandbox.js';

function createFakeModules(): Record<string, Record<string, unknown>> {
    const modules: Record<string, Record<string, unknown>> = {};
    for (const entry of Object.values(SANDBOX_CAPABILITY_TABLE)) {
        if (entry.module === null) continue;
        let module = modules[entry.module];
        if (!module) {
            module = {};
            modules[entry.module] = module;
        }
        for (const apiName of entry.apiNames) {
            module[apiName] = `${entry.module}.${apiName}`;
        }
    }
    return modules;
}

describe('sandbox capability table', () => {
    it('represents every manifest capability, including capabilities without a Node module', () => {
        const capabilities = CapabilitySchema.options;
        const tableCapabilities = Object.keys(SANDBOX_CAPABILITY_TABLE);

        expect(tableCapabilities).toHaveLength(capabilities.length);
        expect(tableCapabilities).toEqual(expect.arrayContaining(capabilities));

        for (const capability of capabilities) {
            const entry = SANDBOX_CAPABILITY_TABLE[capability];
            if (entry.module === null) {
                expect(entry.apiNames).toHaveLength(0);
                expect(entry.permissionDenied).toBe('module-not-exposed');
            }
        }
    });

    it('exposes only the APIs granted by each capability entry', () => {
        const fakeModules = createFakeModules();

        for (const entry of Object.values(SANDBOX_CAPABILITY_TABLE)) {
            if (entry.module === null) continue;

            const granted = buildPermissionGatedModule(
                entry.module,
                new Set([entry.capability]),
                (moduleName) => fakeModules[moduleName] ?? {},
            );

            for (const apiName of entry.apiNames) {
                expect(granted[apiName]).toBe(fakeModules[entry.module]?.[apiName]);
            }

            const grantedApiNames = new Set(entry.apiNames.map(String));
            for (const apiName of Object.keys(fakeModules[entry.module] ?? {})) {
                if (grantedApiNames.has(apiName)) continue;

                const value = granted[apiName];
                expect(value).toBeTypeOf('function');
                expect(() => (value as () => never)()).toThrow('Permission denied');
            }
        }
    });

    it('rejects write-capable flags from filesystem.read APIs', () => {
        const fakeModules = createFakeModules();
        const fsModule = fakeModules['node:fs'];
        if (!fsModule) throw new Error('missing fake fs module');

        const constants = {
            O_WRONLY: 1,
            O_RDWR: 2,
            O_CREAT: 64,
            O_TRUNC: 512,
            O_APPEND: 1024,
        };
        fsModule.constants = constants;
        for (const apiName of [
            'readFileSync',
            'readFile',
            'openSync',
            'open',
            'createReadStream',
        ]) {
            fsModule[apiName] = (...args: unknown[]) => args;
        }
        fsModule.ReadStream = class FakeReadStream {};

        const granted = buildPermissionGatedModule(
            'node:fs',
            new Set(['filesystem.read']),
            (moduleName) => fakeModules[moduleName] ?? {},
        );
        const call = (value: unknown, args: readonly unknown[]): unknown => {
            if (typeof value !== 'function') throw new Error('expected callable fake API');
            return Reflect.apply(value, undefined, [...args]);
        };
        const construct = (value: unknown, args: readonly unknown[]): unknown => {
            if (typeof value !== 'function') throw new Error('expected constructible fake API');
            return Reflect.construct(value, [...args]);
        };

        expect(() => call(granted.readFileSync, ['file', { flag: 'r' }])).not.toThrow();
        expect(() => call(granted.openSync, ['file', 'r'])).not.toThrow();
        expect(() => call(granted.createReadStream, ['file', { flags: 'rs' }])).not.toThrow();
        expect(() => construct(granted.ReadStream, ['file', { flags: 'r' }])).not.toThrow();

        for (const flag of ['w', 'a', 'r+', 'a+']) {
            expect(() => call(granted.readFileSync, ['file', { flag }])).toThrow(
                'filesystem.write',
            );
            expect(() => call(granted.openSync, ['file', flag])).toThrow('filesystem.write');
            expect(() => call(granted.createReadStream, ['file', { flags: flag }])).toThrow(
                'filesystem.write',
            );
            expect(() => construct(granted.ReadStream, ['file', { flags: flag }])).toThrow(
                'filesystem.write',
            );
        }

        for (const flag of Object.values(constants)) {
            expect(() => call(granted.readFileSync, ['file', { flag }])).toThrow(
                'filesystem.write',
            );
            expect(() => call(granted.openSync, ['file', flag])).toThrow('filesystem.write');
            expect(() => call(granted.createReadStream, ['file', { flags: flag }])).toThrow(
                'filesystem.write',
            );
            expect(() => construct(granted.ReadStream, ['file', { flags: flag }])).toThrow(
                'filesystem.write',
            );
        }
    });

    it('uses the declared denial behavior for every gated API when permission is absent', () => {
        const fakeModules = createFakeModules();

        for (const moduleName of getSandboxModuleNames()) {
            const denied = buildPermissionGatedModule(
                moduleName,
                new Set(),
                (requestedModule) => fakeModules[requestedModule] ?? {},
            );

            for (const [apiName, value] of Object.entries(denied)) {
                expect(value).toBeTypeOf('function');
                expect(() => (value as () => never)()).toThrow(
                    `Permission denied: ${moduleName.slice('node:'.length)}.${apiName}`,
                );
            }
        }
    });
});
