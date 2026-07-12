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

The Renderer retains at most 500 Bus Events and uses the Engine timestamp when
indexing them. No remote metrics dependency or durable telemetry store is
introduced.
