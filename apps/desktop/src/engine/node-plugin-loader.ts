import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseManifest } from '@sigil/schema/manifest';
import type { Manifest } from '@sigil/schema/manifest';
import type { NodeDescriptor } from '@sigil/schema/nodes';

import type { ManifestRegistry } from './manifest-registry.js';
import type { NodeHandlerRegistry } from './node-registry.js';
import type { NodeHandler, NodePluginModule } from './node-handlers/types.js';

export type NodePluginLoadError =
    | { readonly kind: 'invalid_manifest'; readonly dir: string; readonly error: string }
    | { readonly kind: 'missing_manifest'; readonly dir: string }
    | { readonly kind: 'missing_handler'; readonly dir: string }
    | { readonly kind: 'missing_node_type'; readonly dir: string }
    | { readonly kind: 'invalid_handler_module'; readonly dir: string; readonly error: string }
    | {
          readonly kind: 'type_mismatch';
          readonly dir: string;
          readonly manifestType: string;
          readonly descriptorType: string;
      }
    | { readonly kind: 'duplicate'; readonly dir: string; readonly pluginId: string }
    | { readonly kind: 'duplicate_type'; readonly dir: string; readonly nodeType: string }
    | { readonly kind: 'import_error'; readonly dir: string; readonly error: string };

export type NodePluginLoadResult =
    | {
          readonly ok: true;
          readonly manifest: Manifest;
          readonly descriptor: NodeDescriptor<string, unknown>;
          readonly handler: NodeHandler;
      }
    | { readonly ok: false; readonly error: NodePluginLoadError };

export interface NodePluginLoaderDeps {
    readonly manifestRegistry: ManifestRegistry;
    readonly handlerRegistry: NodeHandlerRegistry;
}

function isNodePluginModule(value: unknown): value is NodePluginModule {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    if (
        typeof obj.descriptor !== 'object' ||
        obj.descriptor === null ||
        typeof (obj.descriptor as Record<string, unknown>).type !== 'string'
    ) {
        return false;
    }
    const configSchema = (obj.descriptor as Record<string, unknown>).configSchema;
    if (
        typeof configSchema !== 'object' ||
        configSchema === null ||
        typeof (configSchema as Record<string, unknown>).safeParse !== 'function'
    ) {
        return false;
    }
    return (
        typeof obj.handler === 'object' &&
        obj.handler !== null &&
        typeof (obj.handler as Record<string, unknown>).execute === 'function'
    );
}

function resolveHandlerPath(pluginDir: string): string | undefined {
    const jsPath = join(pluginDir, 'handler.js');
    if (existsSync(jsPath)) return jsPath;
    const tsPath = join(pluginDir, 'handler.ts');
    if (existsSync(tsPath)) return tsPath;
    return undefined;
}

export async function loadNodePlugin(
    pluginDir: string,
    deps: NodePluginLoaderDeps,
): Promise<NodePluginLoadResult> {
    const manifestPath = join(pluginDir, 'plugin.manifest.json');
    if (!existsSync(manifestPath)) {
        return { ok: false, error: { kind: 'missing_manifest', dir: pluginDir } };
    }

    let rawManifest: unknown;
    try {
        rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
        return {
            ok: false,
            error: {
                kind: 'invalid_manifest',
                dir: pluginDir,
                error: err instanceof Error ? err.message : String(err),
            },
        };
    }
    const parsed = parseManifest(rawManifest);
    if (!parsed.ok) {
        return {
            ok: false,
            error: { kind: 'invalid_manifest', dir: pluginDir, error: parsed.error },
        };
    }
    const manifest = parsed.value;

    if (!manifest.nodeType) {
        return { ok: false, error: { kind: 'missing_node_type', dir: pluginDir } };
    }

    if (deps.manifestRegistry.has(manifest.id)) {
        return { ok: false, error: { kind: 'duplicate', dir: pluginDir, pluginId: manifest.id } };
    }

    if (deps.handlerRegistry.has(manifest.nodeType)) {
        return {
            ok: false,
            error: { kind: 'duplicate_type', dir: pluginDir, nodeType: manifest.nodeType },
        };
    }

    const handlerPath = resolveHandlerPath(pluginDir);
    if (!handlerPath) {
        return { ok: false, error: { kind: 'missing_handler', dir: pluginDir } };
    }

    let module: unknown;
    try {
        const fileUrl = pathToFileURL(resolvePath(handlerPath)).href;
        module = await import(fileUrl);
    } catch (err) {
        return {
            ok: false,
            error: {
                kind: 'import_error',
                dir: pluginDir,
                error: err instanceof Error ? err.message : String(err),
            },
        };
    }

    if (!isNodePluginModule(module)) {
        return {
            ok: false,
            error: {
                kind: 'invalid_handler_module',
                dir: pluginDir,
                error: 'Module must export { descriptor, handler } where descriptor has type/configSchema and handler has execute',
            },
        };
    }

    if (module.descriptor.type !== manifest.nodeType) {
        return {
            ok: false,
            error: {
                kind: 'type_mismatch',
                dir: pluginDir,
                manifestType: manifest.nodeType,
                descriptorType: module.descriptor.type,
            },
        };
    }

    const registerResult = deps.manifestRegistry.register(manifest);
    if (!registerResult.ok) {
        return { ok: false, error: { kind: 'duplicate', dir: pluginDir, pluginId: manifest.id } };
    }

    deps.handlerRegistry.register(module.descriptor.type, module.handler);

    return {
        ok: true,
        manifest,
        descriptor: module.descriptor,
        handler: module.handler,
    };
}

export async function loadNodePlugins(
    pluginsDir: string,
    deps: NodePluginLoaderDeps,
): Promise<readonly NodePluginLoadResult[]> {
    if (!existsSync(pluginsDir)) return [];

    const entries = readdirSync(pluginsDir, { withFileTypes: true });
    const pluginDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(pluginsDir, entry.name));

    const results: NodePluginLoadResult[] = [];
    for (const dir of pluginDirs) {
        const result = await loadNodePlugin(dir, deps);
        results.push(result);
    }
    return results;
}
