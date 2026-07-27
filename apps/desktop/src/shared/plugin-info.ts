import type { Capability, Manifest } from '@sigil/contracts/manifest';

export interface PluginInfo {
    readonly manifest: Manifest;
    readonly grantedPermissions: readonly Capability[];
}
