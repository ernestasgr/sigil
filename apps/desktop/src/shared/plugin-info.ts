import type { Manifest } from '@sigil/schema/manifest';
import type { Capability } from '@sigil/schema/manifest';

export interface PluginInfo {
    readonly manifest: Manifest;
    readonly grantedPermissions: readonly Capability[];
}
