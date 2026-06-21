## Problem Statement

I manually sort files in my Downloads folder every day — installers, PDFs, images, archives, project files — all dumped into one directory. Existing tools either require cloud accounts (Zapier, n8n), are limited to simple folder rules (Windows built-in), or don't give me the programmable depth I want. There's no local-first, visual, event-driven automation tool for Windows that lets me define reactive workflows with real branching logic and persistent state.

## Solution

Build Sigil Phase 1 (MVP): a local-first Electron desktop app that watches the filesystem for events and executes user-defined Workflows through a visual node-graph builder. The MVP ships with enough built-in Plugins and Node types to solve the download-sorting use case end-to-end, while establishing the full architectural foundation (Event Bus, Plugin isolation, DAG executor, persistent Workflow State) that future phases build on.

The user creates a Workflow in the visual builder by connecting Nodes: a File Watcher Trigger emits an Event when a file appears in ~/Downloads → If/Else and Switch Nodes route by extension, size, or name pattern → a File Manager Action Node moves the file to the right folder. The Workflow runs in the background via the system tray. The Live Event Inspector shows every Event flowing through the Bus in real time for debugging.

## User Stories

1. As a developer, I want to watch a directory for new files, so that I can trigger automations when files appear in my Downloads folder
2. As a developer, I want to define routing rules visually using If/Else and Switch nodes, so that I can sort files by extension, name pattern, or size without writing scripts
3. As a developer, I want to move and rename files as a Workflow action, so that downloads are automatically organized into target folders
4. As a developer, I want to see a desktop notification when a Workflow completes, so that I know my files were sorted without checking manually
5. As a developer, I want to create Workflows by dragging and connecting Nodes on a visual canvas, so that I can build automations without writing code
6. As a developer, I want to configure each Node's behavior through a property panel, so that I can set watch paths, file patterns, and destination folders
7. As a developer, I want to enable and disable Workflows without deleting them, so that I can pause automations temporarily
8. As a developer, I want Workflows to persist across app restarts, so that my automations survive reboots
9. As a developer, I want to see all Events flowing through the Event Bus in real time, so that I can debug why a Workflow did or didn't fire
10. As a developer, I want to filter the Event Inspector by event type and Plugin, so that I can focus on relevant events during debugging
11. As a developer, I want the app to run in the system tray, so that it's always active without cluttering my taskbar
12. As a developer, I want a tray icon that indicates whether Workflows are active, so that I can tell at a glance if Sigil is running
13. As a developer, I want a quick-action menu from the tray icon, so that I can enable/disable Workflows and open the app without hunting for it
14. As a developer, I want Workflow State to persist across executions, so that I can deduplicate files and track how many files I've sorted
15. As a developer, I want to inspect and edit Workflow State from the UI, so that I can debug and reset counters or last-run timestamps
16. As a developer, I want a manual trigger Node, so that I can test any Workflow by firing it by hand without waiting for a real event
17. As a developer, I want a Log Node, so that I can output debug messages at any point in the Workflow
18. As a developer, I want a Delay Node, so that I can pause execution between steps (e.g., wait before moving a file that might still be downloading)
19. As a developer, I want Plugins to run in isolated worker threads, so that a broken Plugin can't crash the app
20. As a developer, I want Plugins to declare their required permissions in a Manifest, so that I know exactly what each Plugin can access
21. As a developer, I want to grant or revoke Plugin permissions from the Settings panel, so that I control what the app can touch on my system
22. As a developer, I want Workflows to handle errors gracefully, so that a failed file move doesn't crash the entire pipeline
23. As a developer, I want to see which Workflows are currently active from the Home section, so that I have an overview of what's running
24. As a developer, I want to see recent Events on the Home section, so that I can quickly check what happened without opening the full inspector
25. As a developer, I want Workflow definitions stored as JSON, so that they're portable and inspectable outside the app
26. As a developer, I want the Workflow Builder canvas to support zooming and panning, so that I can work with large Workflows comfortably
27. As a developer, I want to delete connections between Nodes, so that I can restructure Workflows without rebuilding them from scratch
28. As a developer, I want the Event Bus to validate that a Plugin only emits Events it declared in its Manifest, so that Plugins can't emit arbitrary events
29. As a developer, I want state writes to be coalesced and flushed on an interval, so that noisy Triggers don't stall the engine with constant SQLite writes

## Implementation Decisions

### Architecture

- **Three-layer architecture:** Electron Shell (IPC, tray, permissions) → Automation Engine (Event Bus, Plugin Loader, DAG Executor, State Manager) → Plugins (Trigger and Action modules). The Shell is intentionally thin and owns no application logic.
- **Engine runs as an isolated Node.js worker process**, separate from the Electron renderer. A crashed Workflow cannot take down the UI.
- **Event Bus is a typed RxJS Subject** on the engine's main thread. All system communication goes through the Bus — nothing communicates point-to-point.

### Plugin Isolation

- **Full isolation from day one**, not deferred. Each Plugin runs in its own `worker_thread` with its code evaluated inside a `vm.Context`.
- **Three-layer isolation model:** `worker_threads` for crash/thread containment → `vm.Context` for ambient API restriction (no `require`, `process`, `fs`, `net`) → Capability Broker on the main thread for actual permission enforcement via postMessage RPC.
- **Cross-thread Bridge:** Plugin calls to `event.emit()`, `state.get()`, `state.set()`, and `log()` are RPC stubs that serialize across the worker boundary. The Bridge Listener on the main thread validates every emission against the Plugin's Manifest `emits` list before calling `bus.next()`.
- **Manifest-driven permissions:** The Broker re-checks the calling Plugin's Manifest permissions on every privileged call, not just at load time.

### MVP Plugin Set

- **File Watcher** (Trigger Plugin): emits `file.created`, `file.modified`, `file.deleted`. Configurable watch path and recursive flag. The engine maintains at most one File Watcher per unique (path, recursive) pair. Multiple Workflows subscribing to the same path share the underlying watcher instance. File Watcher ignores files matching patterns specified in the Properties File (default: `["*.crdownload", "*.part", "*.tmp", "*.download"]`) or overridden by node configuration. The shared underlying watcher instance always emits raw, unfiltered events, and the `ignorePatterns` filtering is applied per-subscriber/node within the Engine before triggering the Workflow.
- **File Manager** (Action Plugin): move, rename, and organize files by rule. Requires `filesystem.read` and `filesystem.write` permissions. Configurable action (`move`, `copy`, `rename`) and destination, as well as a filename collision policy: `skip`, `overwrite`, `auto-rename`, or `error` (which halts execution and stops the workflow via the executor's standard error handling). For `action: "rename"`, the `destination` is a new filename (same directory). For `action: "move"` or `"copy"`, `destination` is a target directory path (retaining the current filename, created recursively if it doesn't exist).

### MVP Node Types (10 total)

- **Triggers:**
    - **File Watcher**: Subscribes to filesystem events.
    - **Manual Trigger**: Triggers execution on click, using a pre-configured `FileEventPayload` static payload and a file picker shortcut to easily load properties of a real file.
- **Logic:**
    - **If/Else**: Evaluates a strongly-typed `PipelineCondition` against `WorkflowContext` and branches to a `true` or `false` port. Single condition only for MVP. Standard string operators (`equals`, `contains`, `starts_with`, `ends_with`) are case-insensitive by default. The `matches` operator performs regex matches where case sensitivity is determined by regex flags.
    - **Switch**: Evaluates a single field on `WorkflowContext` (event or vars) against dynamic case values using type-aware matching, routing to case-specific ports (derived from case values) or a required `default` port.
- **System:**
    - **File Manager**: Executes move, rename, or copy with chosen collision policy. Updates file properties in `WorkflowContext` event metadata upon completion.
    - **Notification**: Standard OS notifications with mustache-style `{{event.field}}` or `{{vars.field}}` template interpolation for `title` and `body`.
- **State:**
    - **State Get**: Reads a key from persistent SQLite state and assigns it to a transient key in `WorkflowContext` `vars`.
    - **State Set**: Writes a value to persistent SQLite state.
- **Utilities:**
    - **Log**: Outputs logs to the Variable Inspector or console, supporting mustache template interpolation (`{{event.field}}`, `{{vars.field}}`).
    - **Delay**: Delays execution for a specified duration in milliseconds.

### Properties File

- **Global Properties File (`sigil.properties.json`):** An app-wide JSON file containing default configuration values for plugins and settings for the engine.
- **Resolution Order:** Node config (explicit) → Properties File → Hardcoded fallback.
- **Engine settings:** E.g., `notifyOnWorkflowError` (boolean, defaults to true).
- **Plugin settings:** E.g., `file-watcher.ignorePatterns` (defaults to `["*.crdownload", "*.part", "*.tmp", "*.download"]`), `file-manager.defaultOnConflict` (defaults to `auto-rename`), and `file-manager.collisionSuffixStyle` (defaults to `"windows"`, supporting `"windows"`, `"underscore"`, or `"hyphen"` for naming suffixes during auto-renames).
- **Accessibility:** Accessible and editable directly by power users, and managed visually through the Settings panel in the UI.

### DAG Executor

- **Sequential execution** with **branching** (If/Else and Switch route to one of N downstream paths). No parallel branch execution in MVP.
- **Basic error handling** at the executor level: try/catch around each Node execution. On an unhandled error, fire a `workflow.error` event onto the Bus, display a default system desktop notification (silenceable via `notifyOnWorkflowError` in the Properties File), and stop the Workflow gracefully. No Error Boundary Nodes yet.
- **Topological-sort evaluation:** Nodes execute in dependency order.
- **Context Pass-Through:** Each Node receives the `WorkflowContext` (containing `event` and `vars` fields) as input and passes it along on its output port. Action and utility nodes (`File Manager`, `Notification`, `Log`, `Delay`, `State Set`) pass the context through unchanged, except for `File Manager` which updates the `event` properties (`path`, `dir`, `name`, `ext`) to reflect the file's new state on disk, and `State Get` which merges the retrieved value into `vars`.
- **Fan-Out Support:** A single output port on any node can connect to multiple downstream nodes. The executor schedules all active downstream paths to run sequentially in topological order.
- **Type Coercion Rules:** All condition and case values are compared as case-insensitive strings unless a numeric or boolean context is explicitly determined. A numeric context is established when checking a statically declared numeric field (e.g., `event.size`) or when evaluating a `vars` condition with a `NumberOperator`; in these cases, both sides are coerced via `Number()`, and any coercion producing `NaN` is treated as a non-match. A boolean context is established when evaluating a `vars` condition with a `BooleanOperator`; the strings `"true"` and `"false"` are parsed case-insensitively, and any other value is treated as a non-match. Switch comparisons targeting `vars` are always executed as string comparisons since the Switch node has no operator to declare numeric or boolean intent. Any non-match causes `If/Else` to route to the `false` branch and `Switch` to fall through to the `default` port.

### UI Architecture

- **React** for the renderer, **Zustand** for state management, **React Flow** for the Workflow Builder canvas, **Zod** for schema validation.
- **Five sections:** Home (active Workflows + recent Events), Workflows (create/edit/enable/disable), Events (Live Event Inspector), Plugins (installed Plugins + permissions), Settings (permissions management and Properties File settings editor).
- **System tray** with status indicator and quick-action menu.
- **Tailwind CSS** for styling.

### Persistent Workflow State

- **SQLite via better-sqlite3**, exposed as a per-Workflow key-value namespace.
- **Write coalescing:** `state.set()` calls are buffered in an in-memory map and flushed to SQLite on a 250ms interval or at Workflow completion. `state.get()` reads the pending buffer first, then SQLite.
- **Variable Inspector** panel in the Workflow Builder for debugging state values.

### Platform

- **Windows only** for MVP. Use Node.js cross-platform APIs (`path`, `fs.watch`, Electron APIs) to avoid hard Windows lock-in, but don't spend time testing other platforms.

### Workflow Storage & Pipeline JSON Schema

Workflows are stored as JSON files. The Workflow Builder compiles the visual node graph to this format; the Engine reads it to produce the executable Pipeline.

#### Type Definitions

```typescript
// ── File Event Payload ────────────────────────────────────

interface FileEventPayload {
    path: string;
    name: string;
    ext: string; // without dot, lowercased
    size: number; // bytes
    dir: string;
}

// ── Workflow Context ──────────────────────────────────────

interface WorkflowContext {
    event: FileEventPayload;
    vars: Record<string, any>; // Transient in-memory variables populated via state-get
}

// ── Condition Types ───────────────────────────────────────

type StringOperator =
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'not_contains'
    | 'starts_with'
    | 'ends_with'
    | 'matches';
type NumberOperator = 'equals' | 'not_equals' | 'gt' | 'lt' | 'gte' | 'lte';
type BooleanOperator = 'equals' | 'not_equals';

interface BaseCondition<Target extends 'event' | 'vars', Field extends string, Op, Val> {
    target: Target;
    field: Field;
    operator: Op;
    value: Val;
}

type FileCondition =
    | BaseCondition<'event', 'path' | 'name' | 'ext' | 'dir', StringOperator, string>
    | BaseCondition<'event', 'size', NumberOperator, number>;

type VarCondition =
    | BaseCondition<'vars', string, StringOperator, string>
    | BaseCondition<'vars', string, NumberOperator, number>
    | BaseCondition<'vars', string, BooleanOperator, boolean>;

type PipelineCondition = FileCondition | VarCondition;

// ── Node Configurations ───────────────────────────────────

interface FileWatcherConfig {
    path: string;
    recursive: boolean;
    events: ('file.created' | 'file.modified' | 'file.deleted')[];
    ignorePatterns?: string[];
}

interface ManualTriggerConfig {
    payload: FileEventPayload;
}

interface IfElseConfig {
    condition: PipelineCondition;
}

interface SwitchConfig {
    target: 'event' | 'vars';
    field: string;
    cases: string[]; // Case values (port names are derived directly from these)
}

interface FileManagerConfig {
    action: 'move' | 'rename' | 'copy';
    destination: string;
    onConflict: 'skip' | 'overwrite' | 'auto-rename' | 'error';
}

interface NotificationConfig {
    title: string;
    body: string;
}

interface LogConfig {
    message: string;
}

interface DelayConfig {
    ms: number;
}

interface StateGetConfig {
    key: string;
    assignTo: string; // Writes to context.vars[assignTo]
}

interface StateSetConfig {
    key: string;
    valueTemplate: string; // Interpolates context.event or context.vars values
}

// ── Discriminated Node Union ──────────────────────────────

type PipelineNode =
    | { id: string; type: 'file-watcher'; config: FileWatcherConfig }
    | { id: string; type: 'manual-trigger'; config: ManualTriggerConfig }
    | { id: string; type: 'if-else'; config: IfElseConfig }
    | { id: string; type: 'switch'; config: SwitchConfig }
    | { id: string; type: 'file-manager'; config: FileManagerConfig }
    | { id: string; type: 'notification'; config: NotificationConfig }
    | { id: string; type: 'log'; config: LogConfig }
    | { id: string; type: 'delay'; config: DelayConfig }
    | { id: string; type: 'state-get'; config: StateGetConfig }
    | { id: string; type: 'state-set'; config: StateSetConfig };

// ── Edges ─────────────────────────────────────────────────

interface NodeOutputPorts {
    'file-watcher': 'out';
    'manual-trigger': 'out';
    'if-else': 'true' | 'false';
    switch: string; // Equal to one of the config.cases values, or "default"
    'file-manager': 'out';
    notification: 'out';
    log: 'out';
    delay: 'out';
    'state-get': 'out';
    'state-set': 'out';
}

interface PipelineEdge {
    id: string;
    source: string; // Node ID
    target: string; // Node ID
    sourcePort: string; // Validated against NodeOutputPorts at runtime via Zod
}

// ── Compiled Pipeline Schema ──────────────────────────────

interface CompiledPipeline {
    id: string;
    workflowId: string;
    schemaVersion: 1;
    nodes: PipelineNode[];
    edges: PipelineEdge[];
}
```

## Testing Decisions

### What makes a good test

Tests should verify external behavior at architectural boundaries, not internal implementation details. A good test feeds input into one side of a seam and asserts what comes out the other side. Tests should not depend on the internal structure of modules, private methods, or intermediate state.

### Testing seams

**1. Capability Broker (highest-value seam)**

- Feed simulated Plugin RPC calls (event emissions, state operations) through the Broker
- Assert: permitted calls pass through; calls exceeding Manifest permissions are rejected; events not in the Plugin's `emits` list are blocked
- This seam validates the entire trust model without requiring Electron or a running UI

**2. DAG Executor**

- Feed a compiled Pipeline (JSON) + a trigger payload into the Executor
- Assert: correct Node execution sequence, correct branching decisions, correct final outputs, graceful error handling on Node failure, correct Workflow State mutations
- This seam validates all Workflow logic as pure computation

**3. Event Bus + Bridge**

- Emit Events through simulated worker_thread boundaries
- Assert: Events arrive on the Bus with correct payloads, validation rejects undeclared events, subscribers receive events matching their filters
- This seam validates the reactive pipeline foundation

### Not tested via automated tests in MVP

- Electron Shell (tray, IPC, window management) — validated by manual use
- React Flow UI (visual builder interactions) — validated by manual use
- Platform-specific behavior — Windows only, validated by running the app

## Out of Scope

The following are explicitly deferred from this MVP and will be addressed in future phases:

- **Phase 2 — Richer execution:** Parallel branch execution, Debounce/Rate Limiter/Queue nodes, Cron scheduler, Command palette, global hotkeys, additional Plugins (App Watcher, Shell Runner, Clipboard Manager, Keyboard Shortcut)
- **Phase 3 — Context Engine + Developer Tools:** Ambient condition evaluation with incremental dependency graph and hysteresis, Time Travel Debugging, State Machine and Transaction/Rollback Nodes
- **Phase 4 — AI + Integrations:** AI Nodes (Summarize, Classify, Sentiment, Decision Router, Vision), Integration Plugins (Discord, Spotify, Obsidian, etc.), natural language Workflow creation
- **Phase 5 — Product-grade (if/when):** Plugin marketplace, Plugin signing and trust tiers, multi-device sync, cross-machine Events, cross-platform support (macOS, Linux), Workflow sharing/export

## Further Notes

- This is a **personal tool and learning project**, not a product launch. The architecture is intentionally ambitious relative to the use case because the engineering challenges (Plugin isolation, reactive pipelines, visual graph editing) are learning goals in their own right.
- The phase ordering is driven by **learning interest and personal utility**, not market requirements. Phases 2–4 will be grilled separately when the time comes.
- The original [idea.md](./idea.md) spec (v2) contains the full long-term vision including all deferred features. This PRD scopes only Phase 1.
