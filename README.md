# Sigil

> A local-first desktop automation platform that reacts to system events by executing user-defined workflows.

Sigil watches your filesystem (and, in future phases, other sources) and runs
**Workflows** — visual, node-graph automations you build by dragging and
connecting nodes on a canvas. The MVP use case: stop manually sorting your
Downloads folder. A File Watcher fires when a file appears → If/Else and Switch
nodes route by extension, size, or name → a File Manager node moves it where it
belongs. Workflows run in the background from the system tray, and a Live Event
Inspector shows every Event flowing through the system in real time.

## Status

**Phase 1 (MVP).** Windows only. Sigil is a personal tool and learning project,
not a product launch — the architecture is intentionally ambitious relative to
the use case because Plugin isolation, reactive pipelines, and visual graph
editing are learning goals in their own right. See
[`docs/prd-phase1-mvp.md`](docs/prd-phase1-mvp.md) for the full PRD and
[`docs/adr/`](docs/adr) for architectural decisions.

## How it works

1. A **Trigger Plugin** (e.g. File Watcher) watches an external source and emits
   an **Event** onto the **Event Bus**.
2. A **Workflow** subscribes to that Event. The Engine compiles it into a
   **Pipeline** (a DAG) and the **DAG Executor** runs it in topological order.
3. **Nodes** along the graph evaluate conditions (If/Else, Switch), transform
   data (State Get/Set, Log, Delay), and produce side effects (File Manager,
   Notification).
4. Each Node receives a **Workflow Context** (`event` metadata + transient `vars`)
   and passes it downstream. Persistent values live in per-Workflow **Workflow
   State** backed by SQLite.

## Architecture

Three layers, each isolated from the next:

- **Electron Shell** (`apps/desktop/src/main`, `apps/desktop/src/preload`) —
  window, system tray, IPC. Intentionally thin; owns no application logic.
- **Automation Engine** (`apps/desktop/src/engine`) — the **Event Bus** (a typed
  RxJS Subject), Plugin Loader, **DAG Executor**, and **State Manager**. Runs as
  an isolated Node.js worker process so a crashed Workflow can't take down the
  UI.
- **Plugins** — isolated modules running in their own `worker_thread`, evaluated
  inside a `vm.Context` with no ambient `require`/`process`/`fs`/`net`. Every
  privileged call crosses the **Bridge** via `postMessage` RPC and is re-checked
  by the **Capability Broker** against the Plugin's **Manifest** permissions on
  every call, not just at load time.

## MVP node types

Ten node types, grouped by category:

| Category  | Node           | Purpose                                                        |
| --------- | -------------- | -------------------------------------------------------------- |
| Triggers  | File Watcher   | Subscribes to `file.created`/`modified`/`deleted` on a path.   |
| Triggers  | Manual Trigger | Fires on click with a static `FileEventPayload` for testing.   |
| Logic     | If/Else        | Evaluates a `PipelineCondition`, branches to `true`/`false`.   |
| Logic     | Switch         | Routes to one of N case ports (or `default`) by field value.   |
| System    | File Manager   | `move`/`copy`/`rename` with a collision policy.                |
| System    | Notification   | OS notification with `{{event.*}}`/`{{vars.*}}` interpolation. |
| State     | State Get      | Reads a SQLite key into `vars`.                                |
| State     | State Set      | Writes a value to SQLite (coalesced, flushed on interval).     |
| Utilities | Log            | Outputs a templated message to the Variable Inspector.         |
| Utilities | Delay          | Pauses execution for a duration in milliseconds.               |

## MVP plugins

- **File Watcher** (Trigger) — emits `file.created`, `file.modified`,
  `file.deleted`. One underlying watcher per unique `(path, recursive)` pair,
  shared across subscribers. Ignores `*.crdownload`, `*.part`, `*.tmp`,
  `*.download` by default (configurable via the Properties File).
- **File Manager** (Action) — `move`, `copy`, or `rename` with a collision
  policy of `skip`, `overwrite`, `auto-rename`, or `error`. Requires
  `filesystem.read` and `filesystem.write` permissions.

## UI

- **React** renderer with **Zustand** state, **React Flow** canvas, **Zod**
  validation, and **Tailwind CSS** styling.
- Five sections: **Home** (active Workflows + recent Events), **Workflows**
  (create/edit/enable/disable), **Events** (Live Event Inspector), **Plugins**
  (installed Plugins + permissions), **Settings** (permissions + Properties File
  editor).
- System tray with status indicator and a quick-action menu to
  enable/disable Workflows and open the app.

See [`UI_STYLE_GUIDANCE.md`](UI_STYLE_GUIDANCE.md) for the visual language
(machine-age ritual: Obsidian, Parchment, Gilt, Old Blood, Verdigris, Veil).

## Tech stack

TypeScript · Electron · React · Zustand · @xyflow/react · Zod · RxJS ·
better-sqlite3 · Tailwind CSS · Vitest

## Repository layout

```
sigil/
├── apps/
│   └── desktop/            # @sigil/desktop — Electron shell, engine worker, React renderer
│       └── src/
│           ├── main/       # Electron main process: tray, IPC, engine client
│           ├── preload/    # Electron preload bridge
│           ├── engine/     # Automation Engine: event bus, bridge, capability broker, DAG executor
│           ├── renderer/   # React UI: sections, components, store
│           └── shared/     # Cross-process types and IPC channels
├── packages/
│   └── schema/             # @sigil/schema — Zod schemas for the Pipeline JSON type system
└── docs/
    ├── prd-phase1-mvp.md   # Phase 1 PRD
    └── adr/                # Architecture Decision Records
```

## Prerequisites

- **Node.js** `>= 22.12.0`
- **pnpm** `11.8.0` (enforced via `packageManager`)

## Getting started

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
| `pnpm lint`         | Lint the whole repo with ESLint.                          |
| `pnpm lint:fix`     | Lint and auto-fix.                                        |
| `pnpm format`       | Format the repo with Prettier.                            |
| `pnpm format:check` | Check formatting without writing.                         |
| `pnpm test`         | Run tests across every workspace package (Vitest).        |
| `pnpm test:watch`   | Watch tests for `@sigil/schema`.                          |
| `pnpm clean`        | Remove `dist`/`out`/`.turbo`/cache from every package.    |

## Testing

Tests target architectural seams — feeding input into one side of a boundary
and asserting what comes out the other — rather than internal implementation
details. The highest-value seams:

- **Capability Broker** — the trust model: permitted RPCs pass, calls exceeding
  Manifest permissions or undeclared Events are rejected.
- **DAG Executor** — feed a compiled Pipeline + trigger payload, assert node
  sequence, branching, outputs, error handling, and State mutations.
- **Event Bus + Bridge** — Events arrive with correct payloads, undeclared
  emissions are blocked, subscribers receive matching Events.

Electron Shell, React Flow interactions, and platform-specific behavior are
validated manually. Run the suite with `pnpm test`.

## Project docs

- [`CONTEXT.md`](CONTEXT.md) — the domain glossary. Canonical vocabulary for
  Event, Plugin, Workflow, Node, Pipeline, Workflow State, Context, and more.
  Use these terms verbatim; the glossary lists terms to avoid.
- [`CODING_STANDARDS.md`](CODING_STANDARDS.md) — TypeScript conventions: no
  `any`, discriminated unions with exhaustive switches, `readonly` by default,
  branded IDs, Zod at boundaries, functional style, `Result` types over
  throwing.
- [`UI_STYLE_GUIDANCE.md`](UI_STYLE_GUIDANCE.md) — visual language and color
  system.
- [`docs/prd-phase1-mvp.md`](docs/prd-phase1-mvp.md) — the Phase 1 PRD (user
  stories, implementation decisions, type definitions, testing strategy).
- [`docs/adr/`](docs/adr) — Architecture Decision Records.

## Roadmap

Phase 1 is the MVP. Later phases (scoped separately when the time comes):

- **Phase 2** — Parallel branch execution, Debounce/Rate Limiter/Queue nodes,
  Cron scheduler, command palette, global hotkeys, more Plugins.
- **Phase 3** — Context Engine with incremental dependency graph and
  hysteresis, Time Travel Debugging, State Machine and Transaction/Rollback
  nodes.
- **Phase 4** — AI nodes (Summarize, Classify, Sentiment, Decision Router,
  Vision), integration Plugins (Discord, Spotify, Obsidian…), natural-language
  Workflow creation.
- **Phase 5** — Plugin marketplace, signing and trust tiers, multi-device sync,
  cross-platform support (macOS, Linux).
