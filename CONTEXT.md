# Sigil

A local-first desktop automation platform that reacts to system events by executing user-defined workflows.

## Language

**Event:**
A typed message with a name and payload, emitted onto the Event Bus. Every observable occurrence in Sigil is an Event.
_Avoid_: signal, notification (in the internal sense), message

**Event Bus:**
The single in-memory RxJS Subject through which all Events flow. Plugins emit into it; Workflows subscribe to it. Nothing communicates point-to-point.
_Avoid_: message queue, event loop, dispatcher

**Plugin:**
An isolated module running in its own worker_thread that either emits Events (Trigger Plugin) or consumes them to produce side effects (Action Plugin).
_Avoid_: extension, add-on, module

**Trigger Plugin:**
A Plugin that watches an external source (filesystem, OS state, timer) and emits Events into the Bus when something happens.
_Avoid_: listener, watcher (as a plugin type name), source

**Action Plugin:**
A Plugin that receives Event data from a Workflow and produces a side effect (move a file, show a notification, run a shell command).
_Avoid_: handler, sink, executor

**Manifest:**
A Plugin's declaration of its identity, version, required permissions, and the Events it emits. The Engine refuses to load a Plugin whose runtime behavior exceeds its Manifest.
_Avoid_: config, descriptor, metadata

**Capability Broker:**
The main-thread component that mediates every privileged operation a Plugin requests. It re-checks the Plugin's Manifest permissions on every call, not just at load time.
_Avoid_: permission manager, gatekeeper, proxy

**Bridge:**
The cross-thread serialization layer between a Plugin's worker_thread and the Engine's main thread. Every Event emission and state call crosses the Bridge via postMessage.
_Avoid_: channel, pipe, IPC (reserved for Electron's renderer ↔ main IPC)

**Workflow:**
A user-defined automation composed of Nodes arranged in a directed acyclic graph. Stored as JSON. Created and edited in the Workflow Builder.
_Avoid_: flow, automation (as a noun for a single workflow), pipeline (internal term for the compiled form)

**Node:**
A single unit of logic within a Workflow — a trigger, condition, transformation, or action. Each Node receives upstream output as input and passes its output downstream.
_Avoid_: step, block, component

**Pipeline:**
The compiled DAG representation of a Workflow that the Engine executes. Users interact with Workflows; the Engine executes Pipelines.
_Avoid_: graph (when referring to the executable form)

**Workflow State:**
Per-Workflow persistent key-value storage backed by SQLite. Allows Workflows to remember values across executions.
_Avoid_: memory, variables (when referring to the persistence layer)

**Workflow Context:**
The transient, in-memory object (containing `event` metadata and local `vars` dictionary) passed along edges between nodes during a pipeline execution run.
_Avoid_: payload, input data, pipeline values

**Workflow Variables (vars):**
The transient, in-memory key-value dictionary within a Workflow Context used to store temporary values loaded from Workflow State or computed during execution.
_Avoid_: local state, transient state, local variables

**Context:**
A set of conditions evaluated simultaneously that activates when all conditions are true and deactivates when any becomes false. Distinct from a single-event Trigger.
_Avoid_: mode, profile, scene

**Properties File:**
The app-wide configuration file (JSON) containing plugin defaults and engine-level preferences. Resolution order for properties: node config (explicit) → Properties File → hardcoded fallback.
_Avoid_: settings registry, config store
