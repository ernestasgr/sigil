# Sigil

> A local-first desktop automation platform that reacts to system events by executing user-defined workflows.

Sigil watches your filesystem (and, in future phases, other sources) and runs **Workflows** — visual, node-graph automations you build by dragging and connecting nodes on a canvas. The MVP use case: stop manually sorting your Downloads folder. A File Watcher fires when a file appears → If/Else and Switch nodes route by extension, size, or name → a File Manager node moves it where it belongs. Workflows run in the background from the system tray, and a Live Event Inspector shows every Event flowing through the system in real time.

## Status

**Phase 1 (MVP).** Windows only. Sigil is a personal tool and learning project, not a product launch — the architecture is intentionally ambitious relative to the use case because Plugin isolation, reactive pipelines, and visual graph editing are learning goals in their own right. See [`docs/adr/`](docs/adr) for architectural decisions.

## Architecture

Three fully isolated layers, each with a distinct responsibility:

```
┌─────────────────────────────────────────────────────┐
│                Electron Shell (main)                  │
│  Window | Tray | IPC routing | engine-client         │
│  Intentionally thin — owns NO application logic      │
└────────────────────┬────────────────────────────────┘
                     │ postMessage IPC
┌────────────────────▼────────────────────────────────┐
│              Automation Engine (worker_thread)        │
│  Event Bus │ Bridge │ Capability Broker              │
│  Manifest Registry │ Condition Evaluator             │
│  Template Resolver │ DAG Executor                    │
│  Node Plugin Loader │ Workflow Store                 │
│  Workflow Activator │ Workflow Lifecycle             │
│  Dispatch │ File Watcher Manager                     │
└──────┬───────────────────────────────────────────────┘
       │ postMessage RPC
┌──────▼──────────────────────────────────────────────┐
│     Plugin Worker (worker_thread + vm.Context)       │
│  PluginSandbox (no require/process/fs/net)           │
│  RPC bridge for privileged operations                │
└─────────────────────────────────────────────────────┘
```

### Electron Shell (`apps/desktop/src/main/`)

The shell manages the window, system tray, and IPC routing. It owns no domain logic.

**Boot sequence** (`apps/desktop/src/main/index.ts:140`):

1. `spawnEngine()` spins up a `Worker` running the Engine
2. IPC handlers are wired (`ipcMain.handle` for pong, fire-test-event, toggle-workflow)
3. Engine logs and workflow lists are forwarded to all renderer windows
4. System tray is created with workflow-toggle/open/quit menu
5. Main `BrowserWindow` is created (loads React renderer or dev URL)
6. On `before-quit`, tray is destroyed and engine worker is terminated

### Automation Engine (`apps/desktop/src/engine/`)

Runs as an isolated `worker_thread` so crashed workflows cannot take down the UI.

**Event Bus** — a single in-memory RxJS `Subject<BusEvent>` through which all Events flow. BusEvent is a discriminated union of 8 event types:

- `workflow.started` / `workflow.completed` / `workflow.error` — pipeline lifecycle
- `manual.trigger.fired` — manual trigger node fired
- `log.output` — a log line
- `notification.show` — request to show an OS notification
- `plugin.event` — plugin emitted an event onto the bus
- `engine.diagnostic` — internal diagnostics (topology errors, activation failures, plugin load failures)

**Bridge** — the cross-thread serialization layer. Validates every plugin emission against its Manifest (event names must be declared), then pushes onto the Event Bus. Returns an Effect `Either<void, EmissionError>`.

**Capability Broker** — mediates every privileged operation by re-checking the plugin's Manifest `permissions` array on every call, not just at load time.

**Manifest Registry** — in-memory store of plugin Manifests. All returned manifests are deep-cloned via `structuredClone` to prevent mutation.

**Plugin Loader** — loads a plugin from raw manifest + source code:

1. Parses manifest with Zod
2. Checks for duplicate plugin ID
3. Registers the manifest
4. Spawns a `Worker` pointing at `plugin-worker.js`
5. Waits for `plugin:ready` (30s timeout), cleans up on failure

Plugin code evaluation inside `vm.Context` has a separate 5-second timeout.

**DAG Executor** — runs a compiled pipeline in topological order (Kahn's algorithm). For each node: evaluates conditions (If/Else, Switch), resolves templates (`{{payload.*}}` / `{{vars.*}}`), emits log/notification events, and sleeps on Delay nodes. On error, emits `workflow.error` + optional notification.

**Condition Evaluator** — evaluates `PipelineCondition` with type coercion. String operators: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `matches` (regex). Number operators: `equals`, `not_equals`, `gt`, `lt`, `gte`, `lte`. Boolean operators: `equals`, `not_equals`. Case-insensitive by default.

### Plugins

Plugins are double-sandboxed modules. Each runs in its own `worker_thread`, with plugin code evaluated inside a `vm.Context` that has no ambient `require`, `process`, `fs`, `Buffer`, `setTimeout`, `setInterval`, or `net`. Only safe globals are exposed: `JSON`, `Math`, `Date`, `Promise`, `Array`, `Object`, `String`, `Number`, `Boolean`, `Map`, `Set`, `Error`, `RegExp`, and a restricted API surface (`event.emit()`, `state.get()`, `state.set()`, `log()`).

Code generation (`eval`, `Function`, WebAssembly) is explicitly disabled. Execution has a 5-second timeout.

All privileged operations cross the Bridge via `postMessage` RPC and are re-checked by the Capability Broker against the plugin's Manifest permissions on every call.

## Process Architecture & IPC

Three distinct IPC mechanisms:

| Channel        | Between          | Mechanism                               | Purpose              |
| -------------- | ---------------- | --------------------------------------- | -------------------- |
| **IPC**        | Renderer ↔ Main  | `ipcMain.handle` / `ipcRenderer.invoke` | UI actions           |
| **IPC (push)** | Main → Renderer  | `webContents.send` / `ipcRenderer.on`   | Logs, workflow lists |
| **Bridge**     | Engine ↔ Plugins | `worker_thread.postMessage` RPC         | Plugin events, state |

The Electron preload (`apps/desktop/src/preload/index.ts`) uses `contextBridge.exposeInMainWorld` to expose a safe `window.sigil` API — no direct Node.js access from the renderer.

## End-to-End Event Flow

Example: Manual Trigger → Log workflow ("Fire test event" button):

```
User clicks "Fire test event"
  → renderer: window.sigil.fireTestEvent()
  → ipcRenderer.invoke → main: engine.fireTestEvent()
  → Worker.postMessage → worker: engine.execute(samplePipeline)

DAG Executor:
  1. Topological sort → ['trigger', 'log']
  2. Run trigger (manual-trigger):
     → emits 'manual.trigger.fired' on Event Bus
     → returns WorkflowContext { event, payload, vars }
  3. Schedule downstream from port 'out' → log node queued
  4. Run log node:
     → resolves "Manual trigger fired for {{payload.name}}"
     → emits 'log.output' on Event Bus
  5. Emit 'workflow.completed'

Event Bus subscriptions:
  → worker.ts forwards 'log.output' to main via postMessage
  → main forwards to renderer via webContents.send
  → renderer appends to Zustand store → HomeSection displays it
```

## Security Model (Defense in Depth)

| Layer                 | Protection                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Electron**          | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`                                         |
| **Preload**           | Only `window.sigil` API surface via `contextBridge`                                                         |
| **Engine isolation**  | Separate `worker_thread` — independent heap, no shared state                                                |
| **Plugin isolation**  | Own `worker_thread` + `vm.Context` with no Node.js globals                                                  |
| **Plugin sandbox**    | Code generation disabled (`strings: false`, `wasm: false`); 5s eval timeout, 30s worker ready timeout |
| **Permission model**  | Manifest declares capabilities; Bridge checks `emits`; Capability Broker checks `permissions` on every call |
| **Schema validation** | Zod validates all data at every process boundary                                                            |

## MVP Node Types

Ten node types, grouped by category. Eight are builtin handlers; File Watcher and File Manager are plugins loaded via the Node Plugin Loader in separate worker threads.

| Category  | Node           | Loaded as    | Purpose                                                        |
| --------- | -------------- | ------------ | -------------------------------------------------------------- |
| Triggers  | File Watcher   | Plugin       | Subscribes to `file.created`/`modified`/`deleted` on a path.   |
| Triggers  | Manual Trigger | Builtin      | Fires on click with a static `FileEventPayload` for testing.   |
| Logic     | If/Else        | Builtin      | Evaluates a `PipelineCondition`, branches to `true`/`false`.   |
| Logic     | Switch         | Builtin      | Routes to one of N case ports (or `default`) by field value.   |
| System    | File Manager   | Plugin       | `move`/`copy`/`rename` with a collision policy.                |
| System    | Notification   | Builtin      | OS notification with `{{event.*}}`/`{{vars.*}}` interpolation. |
| State     | State Get      | Builtin      | Reads a SQLite key into `vars`.                                |
| State     | State Set      | Builtin      | Writes a value to SQLite (coalesced, flushed on interval).     |
| Utilities | Log            | Builtin      | Outputs a templated message to the Variable Inspector.         |
| Utilities | Delay          | Builtin      | Pauses execution for a duration in milliseconds.               |

## MVP Plugins

- **File Watcher** (Trigger) — emits `file.created`, `file.modified`, `file.deleted`. One underlying watcher per unique `(path, recursive)` pair, shared across subscribers. Ignores `*.crdownload`, `*.part`, `*.tmp`, `*.download` by default.
- **File Manager** (Action) — `move`, `copy`, or `rename` with a collision policy of `skip`, `overwrite`, `auto-rename`, or `error`. Requires `filesystem.read`, `filesystem.write`, and `state.write` permissions.

## UI

- **React 19** renderer with **Zustand 5** state, **React Flow** canvas, **Zod** validation, and **Tailwind CSS 4** styling.
- Five sections: **Home** (active Workflows + recent Events), **Workflows** (create/edit/enable/disable), **Events** (Live Event Inspector), **Plugins** (installed Plugins + permissions), **Settings** (permissions + Properties File editor).
- System tray with status indicator and a quick-action menu to enable/disable Workflows and open the app.
- Visual design: "machine-age ritual" — Obsidian, Parchment, Gilt, Old Blood, Verdigris, Veil. See [`UI_STYLE_GUIDANCE.md`](UI_STYLE_GUIDANCE.md).

## Tech Stack

TypeScript 6 · Electron 42 · React 19 · Zustand 5 · @xyflow/react 12 · Zod 4 · RxJS 7 · Effect 3 · better-sqlite3 12 · Drizzle ORM · Tailwind CSS 4 · Biome · Vitest 4

## Repository Layout

```
sigil/
├── apps/
│   └── desktop/            # @sigil/desktop — Electron shell, engine worker, React renderer
│       └── src/
│           ├── main/       # Electron main process: tray, IPC, engine client
│           ├── preload/    # Electron preload bridge
│           ├── engine/     # Automation Engine: event bus, bridge, capability broker, DAG executor
│           ├── renderer/   # React UI: sections, components, store, workflow builder
│           ├── shared/     # Cross-process types and IPC channels (Zod-validated)
│           └── builtin-plugins/  # File Watcher and File Manager plugins
├── packages/
│   └── schema/             # @sigil/schema — Zod schemas for the Pipeline JSON type system
└── docs/
    ├── adr/                # Architecture Decision Records
    └── agents/             # Agent-specific documentation
```

The shared contract: `@sigil/schema` defines `CompiledPipeline`, `PipelineNode` (discriminated union of 10 builtin types, plus `PluginPipelineNode`), `WorkflowContext`, `PipelineCondition`, `Manifest`, and operator schemas — all validated with Zod at every boundary.

## Prerequisites

- **Node.js** `>= 22.12.0`
- **pnpm** `11.8.0` (enforced via `packageManager`)

## Getting Started

```bash
pnpm install
pnpm dev          # builds @sigil/schema, then launches the Electron app with HMR
```

### Scripts (root)

| Script              | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `pnpm dev`          | Build `@sigil/schema`, then run the desktop app with HMR. |
| `pnpm build`        | Build `@sigil/schema` and the desktop app for production. |
| `pnpm preview`      | Preview the built desktop app.                            |
| `pnpm typecheck`    | Run `tsc --noEmit` across every workspace package.        |
| `pnpm lint`         | Lint the whole repo with Biome.                           |
| `pnpm lint:fix`     | Lint and auto-fix with Biome.                             |
| `pnpm format`       | Format the repo with Biome.                               |
| `pnpm format:check` | Check formatting without writing.                         |
| `pnpm test`         | Run tests across every workspace package (Vitest).        |
| `pnpm test:watch`   | Watch tests for `@sigil/schema`.                          |
| `pnpm clean`        | Remove `dist`/`out`/`.turbo`/cache from every package.    |

## Testing

Tests target architectural seams — feeding input into one side of a boundary and asserting what comes out the other — rather than internal implementation details. The highest-value seams:

- **Capability Broker** — the trust model: permitted RPCs pass, calls exceeding Manifest permissions or undeclared Events are rejected.
- **DAG Executor** — feed a compiled Pipeline + trigger payload, assert node sequence, branching, outputs, error handling, and State mutations.
- **Event Bus + Bridge** — Events arrive with correct payloads, undeclared emissions are blocked, subscribers receive matching Events.

Run the suite with `pnpm test`.

## Project Docs

- [`CONTEXT.md`](CONTEXT.md) — the domain glossary. Canonical vocabulary for Event, Plugin, Workflow, Node, Pipeline, Workflow State, Context, and more.
- [`CODING_STANDARDS.md`](CODING_STANDARDS.md) — TypeScript conventions: no `any`, discriminated unions with exhaustive switches, `readonly` by default, branded IDs, Zod at boundaries, functional style with Effect (`Either`, `Option`, `Match`), `Result` types over throwing.
- [`UI_STYLE_GUIDANCE.md`](UI_STYLE_GUIDANCE.md) — visual language and color system.
- [`docs/adr/`](docs/adr) — Architecture Decision Records.
- [`docs/agents/`](docs/agents) — Agent-specific documentation (domain, issue tracker, triage labels).

## Roadmap

Phase 1 is the MVP. Later phases (scoped separately when the time comes):

- **Phase 2** — Parallel branch execution, Debounce/Rate Limiter/Queue nodes, Cron scheduler, command palette, global hotkeys, more Plugins.
- **Phase 3** — Context Engine with incremental dependency graph and hysteresis, Time Travel Debugging, State Machine and Transaction/Rollback nodes.
- **Phase 4** — AI nodes (Summarize, Classify, Sentiment, Decision Router, Vision), integration Plugins (Discord, Spotify, Obsidian…), natural-language Workflow creation.
- **Phase 5** — Plugin marketplace, signing and trust tiers, multi-device sync, cross-platform support (macOS, Linux).
