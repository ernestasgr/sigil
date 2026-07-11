import type { Capability } from '@sigil/schema/manifest';

export type SandboxModuleName = 'node:fs' | 'node:net' | 'node:child_process';

type StringKey<T> = Extract<keyof T, string>;
type FsApiName = StringKey<typeof import('node:fs')>;
type NetApiName = StringKey<typeof import('node:net')>;
type ChildProcessApiName = StringKey<typeof import('node:child_process')>;

type PermissionDenied = (apiName: string) => string;

type SandboxCapabilityEntryFor<TCapability extends Capability> = TCapability extends
    | 'filesystem.read'
    | 'filesystem.write'
    ? {
          readonly capability: TCapability;
          readonly module: 'node:fs';
          readonly apiNames: readonly FsApiName[];
          readonly permissionDenied: PermissionDenied;
      }
    : TCapability extends 'network'
      ? {
            readonly capability: TCapability;
            readonly module: 'node:net';
            readonly apiNames: readonly NetApiName[];
            readonly permissionDenied: PermissionDenied;
        }
      : TCapability extends 'processes'
        ? {
              readonly capability: TCapability;
              readonly module: 'node:child_process';
              readonly apiNames: readonly ChildProcessApiName[];
              readonly permissionDenied: PermissionDenied;
          }
        : {
              readonly capability: TCapability;
              readonly module: null;
              readonly apiNames: readonly [];
              readonly permissionDenied: 'module-not-exposed';
          };

type SandboxCapabilityTable = {
    readonly [TCapability in Capability]: SandboxCapabilityEntryFor<TCapability>;
};

export type SandboxCapabilityEntry = SandboxCapabilityTable[Capability];
type ModuleCapabilityEntry = Exclude<SandboxCapabilityEntry, { readonly module: null }>;

const FS_READ_API_NAMES = [
    'readFileSync',
    'readFile',
    'readdirSync',
    'readdir',
    'existsSync',
    'statSync',
    'stat',
    'lstatSync',
    'lstat',
    'accessSync',
    'access',
    'realpathSync',
    'realpath',
    'openSync',
    'open',
    'closeSync',
    'close',
    'readSync',
    'read',
    'createReadStream',
    'ReadStream',
    'constants',
    'Dirent',
    'Stats',
] satisfies readonly FsApiName[];

const FS_WRITE_API_NAMES = [
    'writeFileSync',
    'writeFile',
    'mkdirSync',
    'mkdir',
    'renameSync',
    'rename',
    'copyFileSync',
    'copyFile',
    'unlinkSync',
    'unlink',
    'rmSync',
    'rm',
    'rmdirSync',
    'rmdir',
    'chmodSync',
    'chmod',
    'appendFileSync',
    'appendFile',
    'writeSync',
    'write',
    'createWriteStream',
    'WriteStream',
    'symlinkSync',
    'symlink',
    'linkSync',
    'link',
    'chownSync',
    'chown',
    'truncateSync',
    'truncate',
    'ftruncateSync',
    'ftruncate',
    'fchmodSync',
    'fchmod',
    'fchownSync',
    'fchown',
    'futimesSync',
    'futimes',
    'utimesSync',
    'utimes',
    'lutimesSync',
    'lutimes',
    'opendirSync',
    'opendir',
    'cpSync',
    'cp',
    'watch',
    'watchFile',
    'unwatchFile',
    'fsyncSync',
    'fsync',
    'fdatasync',
    'fdatasyncSync',
] satisfies readonly FsApiName[];

const NETWORK_API_NAMES = [
    'connect',
    'createConnection',
    'createServer',
    'isIP',
    'isIPv4',
    'isIPv6',
] satisfies readonly NetApiName[];

const PROCESS_API_NAMES = [
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
    'spawn',
    'spawnSync',
] satisfies readonly ChildProcessApiName[];

export const SANDBOX_CAPABILITY_TABLE = {
    'state.read': {
        capability: 'state.read',
        module: null,
        apiNames: [],
        permissionDenied: 'module-not-exposed',
    },
    'state.write': {
        capability: 'state.write',
        module: null,
        apiNames: [],
        permissionDenied: 'module-not-exposed',
    },
    'filesystem.read': {
        capability: 'filesystem.read',
        module: 'node:fs',
        apiNames: FS_READ_API_NAMES,
        permissionDenied: (apiName) =>
            `Permission denied: fs.${apiName} is not available. Grant 'filesystem.read' and/or 'filesystem.write' in the plugin manifest.`,
    },
    'filesystem.write': {
        capability: 'filesystem.write',
        module: 'node:fs',
        apiNames: FS_WRITE_API_NAMES,
        permissionDenied: (apiName) =>
            `Permission denied: fs.${apiName} is not available. Grant 'filesystem.read' and/or 'filesystem.write' in the plugin manifest.`,
    },
    network: {
        capability: 'network',
        module: 'node:net',
        apiNames: NETWORK_API_NAMES,
        permissionDenied: (apiName) =>
            `Permission denied: net.${apiName} is not available. Grant 'network' in the plugin manifest.`,
    },
    clipboard: {
        capability: 'clipboard',
        module: null,
        apiNames: [],
        permissionDenied: 'module-not-exposed',
    },
    processes: {
        capability: 'processes',
        module: 'node:child_process',
        apiNames: PROCESS_API_NAMES,
        permissionDenied: (apiName) =>
            `Permission denied: child_process.${apiName} is not available. Grant 'processes' in the plugin manifest.`,
    },
    display: {
        capability: 'display',
        module: null,
        apiNames: [],
        permissionDenied: 'module-not-exposed',
    },
    'keyboard.global': {
        capability: 'keyboard.global',
        module: null,
        apiNames: [],
        permissionDenied: 'module-not-exposed',
    },
    microphone: {
        capability: 'microphone',
        module: null,
        apiNames: [],
        permissionDenied: 'module-not-exposed',
    },
} satisfies SandboxCapabilityTable;

function isModuleCapabilityEntry(entry: SandboxCapabilityEntry): entry is ModuleCapabilityEntry {
    return entry.module !== null;
}

export function getSandboxModuleNames(): readonly SandboxModuleName[] {
    const moduleNames = new Set<SandboxModuleName>();
    for (const entry of Object.values(SANDBOX_CAPABILITY_TABLE)) {
        if (isModuleCapabilityEntry(entry)) {
            moduleNames.add(entry.module);
        }
    }
    return [...moduleNames];
}

export type SandboxModuleLoader = (
    moduleName: SandboxModuleName,
) => Readonly<Record<string, unknown>>;

export function buildPermissionGatedModule(
    moduleName: SandboxModuleName,
    permissions: ReadonlySet<Capability>,
    loadModule: SandboxModuleLoader,
): Record<string, unknown> {
    const realModule = loadModule(moduleName);
    const apiDefinitions = new Map<
        string,
        { readonly granted: boolean; readonly permissionDenied: PermissionDenied }
    >();

    for (const entry of Object.values(SANDBOX_CAPABILITY_TABLE)) {
        if (!isModuleCapabilityEntry(entry) || entry.module !== moduleName) continue;

        for (const apiName of entry.apiNames) {
            const key = String(apiName);
            const existing = apiDefinitions.get(key);
            apiDefinitions.set(key, {
                granted: (existing?.granted ?? false) || permissions.has(entry.capability),
                permissionDenied: existing?.permissionDenied ?? entry.permissionDenied,
            });
        }
    }

    const sandboxModule: Record<string, unknown> = {};
    for (const [apiName, definition] of apiDefinitions) {
        if (definition.granted && apiName in realModule) {
            sandboxModule[apiName] = realModule[apiName];
        } else {
            sandboxModule[apiName] = (): never => {
                throw new Error(definition.permissionDenied(apiName));
            };
        }
    }
    return sandboxModule;
}
