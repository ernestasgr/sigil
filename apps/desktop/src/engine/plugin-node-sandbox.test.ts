import { createRequire } from 'node:module';
import { CapabilitySchema } from '@sigil/schema/manifest';
import { describe, expect, it } from 'vitest';

import {
    buildPermissionGatedModule,
    buildSandboxGlobalObject,
    buildUnconditionalSandboxModules,
    createPluginSandboxSurface,
    getSandboxModuleNames,
    SANDBOX_CAPABILITY_TABLE,
} from './plugin-node-sandbox.js';

const nodeRequire = createRequire(import.meta.url);

function createTestSurface() {
    const globalObject: Record<string, unknown> = {};
    return createPluginSandboxSurface({
        globalObject,
        resolveModule: () => undefined,
    });
}

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
    it('declares the complete ambient surface, unconditional modules, and code-generation policy', () => {
        const surface = createTestSurface();

        expect(Object.keys(surface.globals).sort()).toEqual([
            'Buffer',
            'TextDecoder',
            'TextEncoder',
            'URL',
            'URLSearchParams',
            'atob',
            'btoa',
            'clearInterval',
            'clearTimeout',
            'console',
            'global',
            'globalThis',
            'process',
            'require',
            'setInterval',
            'setTimeout',
            'structuredClone',
        ]);
        expect(Object.values(surface.globals).every((entry) => entry.rationale.length > 0)).toBe(
            true,
        );
        expect(
            Object.fromEntries(
                Object.entries(surface.globals).map(([name, entry]) => [name, entry.kind]),
            ),
        ).toEqual({
            require: 'thunk',
            console: 'literal',
            process: 'thunk',
            global: 'thunk',
            globalThis: 'thunk',
            Buffer: 'thunk',
            setTimeout: 'thunk',
            clearTimeout: 'thunk',
            setInterval: 'thunk',
            clearInterval: 'thunk',
            URL: 'thunk',
            URLSearchParams: 'thunk',
            TextEncoder: 'thunk',
            TextDecoder: 'thunk',
            structuredClone: 'thunk',
            btoa: 'thunk',
            atob: 'thunk',
        });
        expect(Object.keys(surface.unconditionalModules).sort()).toEqual([
            'node:crypto',
            'node:path',
            'node:url',
        ]);
        expect(
            Object.values(surface.unconditionalModules).every(
                (entry) => entry.rationale.length > 0,
            ),
        ).toBe(true);
        expect(surface.unconditionalModules['node:crypto'].apiNames).toEqual(['randomUUID']);
        expect(surface.codeGeneration).toEqual({ strings: false, wasm: false });
    });

    it('materializes fresh thunk globals and only the APIs declared by unconditional modules', () => {
        const surface = createTestSurface();
        const firstGlobals = buildSandboxGlobalObject(surface.globals);
        const secondGlobals = buildSandboxGlobalObject(surface.globals);
        const fakeModules: Record<string, Record<string, unknown>> = {};

        for (const entry of Object.values(surface.unconditionalModules)) {
            fakeModules[entry.module] = Object.fromEntries(
                [...entry.apiNames, 'notDeclared'].map((apiName) => [apiName, apiName]),
            );
        }

        const modules = buildUnconditionalSandboxModules(
            surface,
            (moduleName) => fakeModules[moduleName] ?? {},
        );

        expect(firstGlobals.process).not.toBe(secondGlobals.process);
        expect(Object.keys(modules['node:crypto'] ?? {})).toEqual(['randomUUID']);
        expect(modules['node:crypto']?.randomBytes).toBeUndefined();
        expect(modules['node:path']?.notDeclared).toBeUndefined();
    });

    it('keeps unconditional module API allowlists synchronized with host exports', () => {
        const surface = createTestSurface();

        for (const entry of Object.values(surface.unconditionalModules)) {
            const moduleValue: unknown = nodeRequire(entry.module);
            if (typeof moduleValue !== 'object' || moduleValue === null) {
                throw new Error(`Expected ${entry.module} to export an object`);
            }
            if (entry.module === 'node:crypto') {
                expect(Object.keys(moduleValue)).toEqual(
                    expect.arrayContaining([...entry.apiNames]),
                );
                continue;
            }
            expect(Object.keys(moduleValue).sort()).toEqual([...entry.apiNames].sort());
        }
    });

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
