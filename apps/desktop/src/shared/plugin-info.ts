import type { Capability, Manifest } from '@sigil/contracts/plugins';

export interface PluginInfo {
    readonly manifest: Manifest;
    readonly grantedPermissions: readonly Capability[];
}
