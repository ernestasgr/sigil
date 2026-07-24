# 7. Correlated Execution Telemetry

## Status

Accepted

## Decision

Execution telemetry is published at the Engine Event Bus seam. The Engine
creates a run identity (`workflowId`, `pipelineId`, and `runId`) before the
first lifecycle Event and preserves it for workflow, Node, queue, Plugin, and
outcome Events. Each telemetry-bearing Event also carries an Engine timestamp,
Event identity, kind, severity, and an optional outcome or duration.

Node handlers keep their existing dependency interface. During execution the
Engine supplies a Node-scoped Event sink and emits `node.started` and
`node.completed` around every handler invocation. Worker-backed Plugin
emissions use the same sink after Bridge authorization, so Plugin Events are
correlated with the owning run and Node without trusting Plugin-supplied
identity.

Queue admission Events use the same vocabulary: `queued`, `dropped`, and
`cancelled` are distinct outcomes. A failed Node publishes a failed
`workflow.error` and failed `workflow.completed` outcome; it never publishes a
successful completion for that run.

## Bounded and safe detail

Telemetry metadata contains only a bounded summary of the Event payload. The
summary limits strings, object keys, array items, and nesting depth, and
replaces values beneath keys such as `token`, `secret`, `password`, and
`authorization` with `[REDACTED]`. Error text is bounded and applies the same
assignment-style redaction. Domain payloads remain available to Engine Event
consumers for their existing contracts, but adapters and the Renderer use the
telemetry summary for display.

The Renderer retains at most 500 Bus Events in its telemetry index, including
unscoped Engine and Plugin Worker diagnostics. When the cap is reached, the
oldest entry is evicted before the newest entry is appended. Workflow, run,
failure, and diagnostic views all derive from that same bounded buffer, so an
evicted Event cannot remain in a secondary index. The index uses the Engine
timestamp when indexing entries; renderer receipt time is only a fallback for
legacy Events without an Engine timestamp.

### Permission-transition Events

Engine-owned Permission Transitions publish exactly one
`plugin.permission.changed` Event after the atomic override write succeeds,
live File Watcher and Workflow reconciliation settles, and the Plugin worker
has received its Effective Capability View. Unknown Plugins and failed writes
do not publish an Event. A superseded concurrent transition does not publish a
second authoritative Event after a newer transition has taken ownership of the
Plugin's live state.

The payload is a strict, bounded audit record rather than a raw override or
payload summary:

- `pluginId` identifies the affected Plugin.
- `previous` and `next` are Effective Capability Views, each limited to the
  closed Capability vocabulary and at most one entry per vocabulary member.
- `actor` is one of `user`, `properties_file`, or `startup_recovery`.
- `cancelledRuns` is a readonly list of every run identity cancelled while the
  transition reconciled active Workflow runs; it is `[]` when none were
  cancelled.

The Renderer indexes this Event in the existing 500-entry buffer and presents
these parsed fields directly. It does not require a telemetry `summary` and
does not add a durable transition-history store. Support exports retain only
the bounded structured fields and continue to omit the raw payload.

Plugin and worker diagnostics carry a source, outcome, and any available
Plugin, Workflow, Pipeline, run, or Node identity. A support export contains
only those structured fields and bounded summaries: raw Event payloads are
omitted, and summaries are redacted again at the Renderer boundary. No remote
metrics dependency or durable telemetry store is introduced.
