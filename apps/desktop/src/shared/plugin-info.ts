import type { Manifest, Capability } from '@sigil/schema/manifest';

export interface PluginInfo {
    readonly manifest: Manifest;
    readonly grantedPermissions: readonly Capability[];
}
