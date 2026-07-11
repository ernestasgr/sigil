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
