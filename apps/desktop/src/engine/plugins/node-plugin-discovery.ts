import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import type { Manifest } from '@sigil/schema/manifest';
import { parseManifest } from '@sigil/schema/manifest';
import { Option } from 'effect';

export type DiscoveredPluginManifest = Manifest & { readonly nodeType: string };

export type NodePluginDiscoveryError =
    | { readonly kind: 'invalid_manifest'; readonly dir: string; readonly error: string }
    | { readonly kind: 'missing_manifest'; readonly dir: string }
    | { readonly kind: 'missing_handler'; readonly dir: string }
    | { readonly kind: 'missing_node_type'; readonly dir: string };

export interface DiscoveredNodePlugin {
    readonly dir: string;
    readonly manifest: DiscoveredPluginManifest;
    readonly handlerPath: string;
}

export type NodePluginDiscoveryResult =
    | { readonly ok: true; readonly plugin: DiscoveredNodePlugin }
    | { readonly ok: false; readonly error: NodePluginDiscoveryError };

function resolveHandlerPath(pluginDir: string): Option.Option<string> {
    const tsPath = join(pluginDir, 'handler.ts');
    if (existsSync(tsPath)) return Option.some(tsPath);
    const jsPath = join(pluginDir, 'handler.js');
    if (existsSync(jsPath)) return Option.some(jsPath);
    return Option.none();
}

function manifestWithNodeType(manifest: Manifest): DiscoveredPluginManifest | undefined {
    return manifest.nodeType === undefined || manifest.nodeType.length === 0
        ? undefined
        : { ...manifest, nodeType: manifest.nodeType };
}

/**
 * Read the on-disk Plugin declaration without registering anything or starting
 * a worker. The returned value is the complete input for preparation.
 */
export function discoverNodePlugin(pluginDir: string): NodePluginDiscoveryResult {
    const manifestPath = join(pluginDir, 'plugin.manifest.json');
    if (!existsSync(manifestPath)) {
        return { ok: false, error: { kind: 'missing_manifest', dir: pluginDir } };
    }

    let rawManifest: unknown;
    try {
        rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (error) {
        return {
            ok: false,
            error: {
                kind: 'invalid_manifest',
                dir: pluginDir,
                error: error instanceof Error ? error.message : String(error),
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

    const manifest = manifestWithNodeType(parsed.value);
    if (!manifest) {
        return { ok: false, error: { kind: 'missing_node_type', dir: pluginDir } };
    }

    const handlerPath = Option.getOrUndefined(resolveHandlerPath(pluginDir));
    if (!handlerPath) {
        return { ok: false, error: { kind: 'missing_handler', dir: pluginDir } };
    }

    return {
        ok: true,
        plugin: {
            dir: pluginDir,
            manifest,
            handlerPath: resolvePath(handlerPath),
        },
    };
}

/**
 * Enumerate Plugin directories and discover each declaration. This function
 * deliberately knows nothing about registries, workers, or runtime state.
 */
export function discoverNodePlugins(pluginsDir: string): readonly NodePluginDiscoveryResult[] {
    if (!existsSync(pluginsDir)) return [];

    const entries = readdirSync(pluginsDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => discoverNodePlugin(join(pluginsDir, entry.name)));
}
