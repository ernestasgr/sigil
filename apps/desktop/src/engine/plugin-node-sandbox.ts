import type { Capability } from '@sigil/schema/manifest';

export type SandboxModuleName = 'node:fs' | 'node:net' | 'node:child_process';
export type UnconditionalSandboxModuleName = 'node:path' | 'node:url' | 'node:crypto';

type StringKey<T> = Extract<keyof T, string>;
type FsApiName = StringKey<typeof import('node:fs')>;
type NetApiName = StringKey<typeof import('node:net')>;
type ChildProcessApiName = StringKey<typeof import('node:child_process')>;
type PathApiName = StringKey<typeof import('node:path')> | '_makeLong';
type UrlApiName = StringKey<typeof import('node:url')> | 'Url' | 'resolveObject';
type CryptoApiName = 'randomUUID';

export type SandboxGlobalEntry =
    | {
          readonly kind: 'literal';
          readonly value: unknown;
          readonly rationale: string;
      }
    | {
          readonly kind: 'thunk';
          readonly create: () => unknown;
          readonly rationale: string;
      };

type UnconditionalSandboxModuleEntryFor<TModule extends UnconditionalSandboxModuleName> =
    TModule extends 'node:path'
        ? {
              readonly module: TModule;
              readonly apiNames: readonly PathApiName[];
              readonly rationale: string;
          }
        : TModule extends 'node:url'
          ? {
                readonly module: TModule;
                readonly apiNames: readonly UrlApiName[];
                readonly rationale: string;
            }
          : {
                readonly module: TModule;
                readonly apiNames: readonly CryptoApiName[];
                readonly rationale: string;
            };

type UnconditionalSandboxModuleTable = {
    readonly [TModule in UnconditionalSandboxModuleName]: UnconditionalSandboxModuleEntryFor<TModule>;
};

export type PluginSandboxSurfaceRuntime = {
    readonly globalObject: Record<string, unknown>;
    readonly resolveModule: (moduleName: string) => unknown;
};

export type PluginSandboxSurface = {
    readonly globals: Readonly<Record<string, SandboxGlobalEntry>>;
    readonly unconditionalModules: UnconditionalSandboxModuleTable;
    readonly codeGeneration: {
        readonly strings: false;
        readonly wasm: false;
    };
};

export type SandboxModuleLoader = (
    moduleName: SandboxModuleName | UnconditionalSandboxModuleName,
) => Readonly<Record<string, unknown>>;

const PATH_API_NAMES = [
    '_makeLong',
    'basename',
    'delimiter',
    'dirname',
    'extname',
    'format',
    'isAbsolute',
    'join',
    'matchesGlob',
    'normalize',
    'parse',
    'posix',
    'relative',
    'resolve',
    'sep',
    'toNamespacedPath',
    'win32',
] satisfies readonly PathApiName[];

const URL_API_NAMES = [
    'URL',
    'URLPattern',
    'URLSearchParams',
    'Url',
    'domainToASCII',
    'domainToUnicode',
    'fileURLToPath',
    'fileURLToPathBuffer',
    'format',
    'parse',
    'pathToFileURL',
    'resolve',
    'resolveObject',
    'urlToHttpOptions',
] satisfies readonly UrlApiName[];

const CRYPTO_API_NAMES = ['randomUUID'] satisfies readonly CryptoApiName[];

function literal(value: unknown, rationale: string): SandboxGlobalEntry {
    return { kind: 'literal', value, rationale };
}

function thunk(create: () => unknown, rationale: string): SandboxGlobalEntry {
    return { kind: 'thunk', create, rationale };
}

export function createPluginSandboxSurface(
    runtime: PluginSandboxSurfaceRuntime,
): PluginSandboxSurface {
    return {
        globals: {
            require: thunk(
                () => runtime.resolveModule,
                'Resolves only unconditional and permission-gated modules declared by the sandbox surface.',
            ),
            console: literal(
                console,
                'Provides worker-scoped diagnostics without exposing host process APIs.',
            ),
            process: thunk(
                () => ({ env: {} }),
                'Provides an inert process shape without environment, lifecycle, or host access.',
            ),
            global: thunk(
                () => runtime.globalObject,
                'Provides a sandbox self-reference without exposing the worker global object.',
            ),
            globalThis: thunk(
                () => runtime.globalObject,
                'Provides the standard sandbox self-reference without exposing the worker global object.',
            ),
            Buffer: thunk(
                () => Buffer,
                'Supports binary encoding and decoding for plugin data handling.',
            ),
            setTimeout: thunk(
                () => setTimeout,
                'Allows plugins to schedule asynchronous work inside their worker.',
            ),
            clearTimeout: thunk(
                () => clearTimeout,
                'Allows plugins to cancel timers they created inside their worker.',
            ),
            setInterval: thunk(
                () => setInterval,
                'Allows trigger plugins to schedule recurring work inside their worker.',
            ),
            clearInterval: thunk(
                () => clearInterval,
                'Allows plugins to cancel recurring timers they created inside their worker.',
            ),
            URL: thunk(
                () => URL,
                'Provides standards-based URL parsing without exposing network access.',
            ),
            URLSearchParams: thunk(
                () => URLSearchParams,
                'Provides standards-based URL query-string handling without network access.',
            ),
            TextEncoder: thunk(
                () => TextEncoder,
                'Provides standard UTF-8 encoding for plugin data handling.',
            ),
            TextDecoder: thunk(
                () => TextDecoder,
                'Provides standard UTF-8 decoding for plugin data handling.',
            ),
            structuredClone: thunk(
                () => structuredClone,
                'Provides structured data cloning without exposing host resources.',
            ),
            btoa: thunk(() => btoa, 'Provides standard base64 encoding for plugin data handling.'),
            atob: thunk(() => atob, 'Provides standard base64 decoding for plugin data handling.'),
        },
        unconditionalModules: {
            'node:path': {
                module: 'node:path',
                apiNames: PATH_API_NAMES,
                rationale: 'Provides pure path parsing and formatting without filesystem access.',
            },
            'node:url': {
                module: 'node:url',
                apiNames: URL_API_NAMES,
                rationale: 'Provides pure URL parsing and formatting without network access.',
            },
            'node:crypto': {
                module: 'node:crypto',
                apiNames: CRYPTO_API_NAMES,
                rationale:
                    'Provides opaque identifiers while withholding unrelated cryptographic APIs.',
            },
        },
        codeGeneration: {
            strings: false,
            wasm: false,
        },
    };
}

export function buildSandboxGlobalObject(
    globals: Readonly<Record<string, SandboxGlobalEntry>>,
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(globals).map(([name, entry]) => [
            name,
            entry.kind === 'literal' ? entry.value : entry.create(),
        ]),
    );
}

type PermissionDenied = (apiName: string) => string;

type SandboxCapabilityEntryFor<TCapability extends Capability> =
    TCapability extends 'filesystem.read'
        ? {
              readonly capability: TCapability;
              readonly module: 'node:fs';
              readonly apiNames: readonly FsApiName[];
              readonly flagGuardedApiNames: readonly FsApiName[];
              readonly permissionDenied: PermissionDenied;
          }
        : TCapability extends 'filesystem.write'
          ? {
                readonly capability: TCapability;
                readonly module: 'node:fs';
                readonly apiNames: readonly FsApiName[];
                readonly flagGuardedApiNames: readonly [];
                readonly permissionDenied: PermissionDenied;
            }
          : TCapability extends 'network'
            ? {
                  readonly capability: TCapability;
                  readonly module: 'node:net';
                  readonly apiNames: readonly NetApiName[];
                  readonly flagGuardedApiNames: readonly [];
                  readonly permissionDenied: PermissionDenied;
              }
            : TCapability extends 'processes'
              ? {
                    readonly capability: TCapability;
                    readonly module: 'node:child_process';
                    readonly apiNames: readonly ChildProcessApiName[];
                    readonly flagGuardedApiNames: readonly [];
                    readonly permissionDenied: PermissionDenied;
                }
              : {
                    readonly capability: TCapability;
                    readonly module: null;
                    readonly apiNames: readonly [];
                    readonly permissionDenied: 'module-not-exposed';
                };

/*
 * These APIs accept an fs flag that can turn a nominally read-only import into
 * a write-capable operation. Keep the guard at the export boundary so every
 * call is checked before reaching Node's fs implementation.
 */
const FS_READ_FLAG_GUARDED_API_NAMES = [
    'readFileSync',
    'readFile',
    'openSync',
    'open',
    'createReadStream',
    'ReadStream',
] satisfies readonly FsApiName[];

const FS_WRITE_FLAG_CONSTANT_NAMES = [
    'O_WRONLY',
    'O_RDWR',
    'O_CREAT',
    'O_TRUNC',
    'O_APPEND',
] as const;

type FsReadFlagGuardedApiName = (typeof FS_READ_FLAG_GUARDED_API_NAMES)[number];

type FsModule = Readonly<Record<string, unknown>>;

type FsCallable = (this: unknown, ...args: unknown[]) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isCallable(value: unknown): value is FsCallable {
    return typeof value === 'function';
}

function getWriteFlagMask(realModule: FsModule): number {
    const constants = realModule.constants;
    if (!isRecord(constants)) return 0;

    return FS_WRITE_FLAG_CONSTANT_NAMES.reduce((mask, name) => {
        const value = constants[name];
        return typeof value === 'number' ? mask | value : mask;
    }, 0);
}

function assertReadOnlyFlag(
    apiName: FsReadFlagGuardedApiName,
    flag: unknown,
    writeFlagMask: number,
): void {
    const isWriteCapable =
        (typeof flag === 'string' && flag !== 'r' && flag !== 'rs') ||
        (typeof flag === 'number' && Number.isInteger(flag) && (flag & writeFlagMask) !== 0);

    if (isWriteCapable) {
        throw new Error(
            `Permission denied: fs.${apiName} does not allow write-capable flags without 'filesystem.write'.`,
        );
    }
}

function assertReadOnlyOptions(
    apiName: FsReadFlagGuardedApiName,
    options: unknown,
    writeFlagMask: number,
): void {
    if (!isRecord(options)) return;
    if ('flag' in options) {
        assertReadOnlyFlag(apiName, options.flag, writeFlagMask);
    }
    if ('flags' in options) {
        assertReadOnlyFlag(apiName, options.flags, writeFlagMask);
    }
}

function wrapReadOnlyFsExport(
    apiName: FsReadFlagGuardedApiName,
    value: unknown,
    realModule: FsModule,
    permissions: ReadonlySet<Capability>,
): unknown {
    if (!isCallable(value)) return value;
    const writeFlagMask = getWriteFlagMask(realModule);
    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
        if (!permissions.has('filesystem.write')) {
            if (apiName === 'openSync' || apiName === 'open') {
                assertReadOnlyFlag(apiName, args[1], writeFlagMask);
            } else {
                assertReadOnlyOptions(apiName, args[1], writeFlagMask);
            }
        }

        return new.target ? Reflect.construct(value, args) : Reflect.apply(value, this, args);
    };
    return wrapped;
}

type SandboxCapabilityTable = {
    readonly [TCapability in Capability]: SandboxCapabilityEntryFor<TCapability>;
};

export type SandboxCapabilityEntry = SandboxCapabilityTable[Capability];
type ModuleCapabilityEntry = Exclude<SandboxCapabilityEntry, { readonly module: null }>;

/*
 * The remaining table entries are deliberately defined after the fs helpers
 * so the flag-guarded API list stays next to the implementation that uses it.
 */

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
        flagGuardedApiNames: FS_READ_FLAG_GUARDED_API_NAMES,
        permissionDenied: (apiName) =>
            `Permission denied: fs.${apiName} is not available. Grant 'filesystem.read' and/or 'filesystem.write' in the plugin manifest.`,
    },
    'filesystem.write': {
        capability: 'filesystem.write',
        module: 'node:fs',
        apiNames: FS_WRITE_API_NAMES,
        flagGuardedApiNames: [],
        permissionDenied: (apiName) =>
            `Permission denied: fs.${apiName} is not available. Grant 'filesystem.read' and/or 'filesystem.write' in the plugin manifest.`,
    },
    network: {
        capability: 'network',
        module: 'node:net',
        apiNames: NETWORK_API_NAMES,
        flagGuardedApiNames: [],
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
        flagGuardedApiNames: [],
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

function pickDeclaredModuleApis(
    entry: UnconditionalSandboxModuleEntryFor<UnconditionalSandboxModuleName>,
    loadModule: SandboxModuleLoader,
): Record<string, unknown> {
    const realModule = loadModule(entry.module);
    const sandboxModule: Record<string, unknown> = {};

    for (const apiName of entry.apiNames) {
        if (!(apiName in realModule)) {
            throw new Error(
                `Sandbox surface API "${entry.module}.${apiName}" is not available in the host module.`,
            );
        }
        sandboxModule[apiName] = realModule[apiName];
    }

    return sandboxModule;
}

export function buildUnconditionalSandboxModules(
    surface: PluginSandboxSurface,
    loadModule: SandboxModuleLoader,
): Record<string, Record<string, unknown>> {
    const modules: Record<string, Record<string, unknown>> = {};

    for (const entry of Object.values(surface.unconditionalModules)) {
        modules[entry.module] = pickDeclaredModuleApis(entry, loadModule);
    }

    return modules;
}

export function createSandboxRequire(
    getModules: () => Readonly<Record<string, unknown>>,
    permissions: ReadonlySet<Capability>,
): (moduleName: string) => unknown {
    return (moduleName) => {
        const modules = getModules();
        if (Object.hasOwn(modules, moduleName)) {
            return modules[moduleName];
        }

        throw new Error(
            `Module "${moduleName}" is not available in the plugin sandbox. ` +
                `Check plugin manifest permissions (available: ${[...permissions].join(', ') || 'none'}).`,
        );
    };
}

export function buildPermissionGatedModule(
    moduleName: SandboxModuleName,
    permissions: ReadonlySet<Capability>,
    loadModule: SandboxModuleLoader,
): Record<string, unknown> {
    const realModule = loadModule(moduleName);
    const apiDefinitions = new Map<
        string,
        {
            readonly granted: boolean;
            readonly flagGuarded: boolean;
            readonly permissionDenied: PermissionDenied;
        }
    >();

    for (const entry of Object.values(SANDBOX_CAPABILITY_TABLE)) {
        if (!isModuleCapabilityEntry(entry) || entry.module !== moduleName) continue;

        for (const apiName of entry.apiNames) {
            const key = String(apiName);
            const existing = apiDefinitions.get(key);
            apiDefinitions.set(key, {
                granted: (existing?.granted ?? false) || permissions.has(entry.capability),
                flagGuarded:
                    (existing?.flagGuarded ?? false) ||
                    entry.flagGuardedApiNames.some((guardedApiName) => guardedApiName === apiName),
                permissionDenied: existing?.permissionDenied ?? entry.permissionDenied,
            });
        }
    }

    const sandboxModule: Record<string, unknown> = {};
    for (const [apiName, definition] of apiDefinitions) {
        if (definition.granted && apiName in realModule) {
            const value = realModule[apiName];
            sandboxModule[apiName] = definition.flagGuarded
                ? wrapReadOnlyFsExport(
                      apiName as FsReadFlagGuardedApiName,
                      value,
                      realModule,
                      permissions,
                  )
                : value;
        } else {
            sandboxModule[apiName] = (): never => {
                throw new Error(definition.permissionDenied(apiName));
            };
        }
    }
    return sandboxModule;
}
