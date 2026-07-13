# 2. Event-Shape-Agnostic Engine

The engine evaluates conditions, matches switch cases, and interpolates templates against an opaque `Record<string, unknown>` payload. It has zero per-event-type knowledge — no field-name enums, no hardcoded `field === 'size'` branches, no per-type narrowing. Per-event-type knowledge (field names, field types, validation) lives in Zod schemas at the boundary where events enter the system (manual trigger config, plugin emission). The `WorkflowContext` carries three flat fields: `event` (the event name as a string), `payload` (the validated event payload as an opaque record), and `vars` (transient working data from state-get). Numeric context in Switch is detected via `typeof raw === 'number'` at runtime, unified across both `payload` and `vars` targets.

## Status

Accepted

## Decision

The engine is a generic predicate evaluator and template renderer. It operates on opaque records and uses `typeof` for type detection. Adding a new event type requires zero engine changes — only a new Zod payload schema in the package that owns the event type and a boundary validation at the event source.

### Context shape

```
WorkflowContext = { event: string, payload: Record<string, unknown>, vars: Record<string, unknown> }
```

- `event` — the event name (e.g. `'file.created'`). A string, not a payload object. Carried for `target: 'event'` conditions/switches (compare or route on the event name) and future features (event-type display in the inspector, per-type validation at the engine boundary).
- `payload` — the validated event payload. Opaque to the engine. Mutable by File Manager (updates `payload.path/dir/name/ext` to reflect the file's new state on disk).
- `vars` — transient working data from state-get. Separate namespace from `payload` to prevent collision between event fields and state-get assignments.

### Condition and Switch targets

- `target: 'event'` — compare or switch on the event name (string). No field. Uses string operators/comparison.
- `target: 'payload'` — compare or switch on a payload field. Has field. Conditions dispatch on `typeof condition.value` (operator-value tying). Switch uses `typeof` on the resolved value (numeric if number, else string).
- `target: 'vars'` — compare or switch on a vars field. Has field. Same coercion as `payload`.

### Coercion change

The PRD previously specified "Switch comparisons targeting `vars` are always executed as string comparisons." This is changed to: Switch on `vars` uses `typeof` (numeric if the resolved value is a number, else string), unified with `payload`. Rationale: with an opaque payload, the "statically declared numeric field" rule can't be enforced by the engine — it's enforced at the boundary schema. Using `typeof` at runtime is the consistent reading for both `payload` and `vars`.

## Considered Options

- **Typed envelope** — `event: { name: string; payload: Record<string, unknown> }`. Rejected because `FileEventPayload` already has a `name` field (the filename), making `{{event.name}}` ambiguous (event name vs filename). The envelope requires `{{event.payload.field}}` verbosity or a shorthand rule with a collision exception. The three-field model avoids the collision entirely — `{{event}}` is the name, `{{payload.name}}` is the filename.

- **Two-field collapse** — `event: string, vars: Record<string, unknown>` (event payload merged into vars). Rejected because it creates a namespace collision (state-get with `assignTo: 'path'` silently overwrites the event's `path`) and requires changing the PRD's coercion rules (Switch on vars would need `typeof` to preserve numeric behavior for formerly-event fields, but the PRD's "vars always string" rule would break `event.size` numeric Switch). The three-field model preserves separation with no coercion rule changes beyond the unified `typeof` for Switch.

- **Discriminated union of typed payloads** — `event: FileEventPayload | AppEventPayload | ...`. Rejected because the engine's job (indexing payload by an arbitrary field name) requires narrowing on the event name to access the typed payload, re-introducing per-event-type shape knowledge in the engine — the exact problem we're solving. Also requires a schema-package change for every new event type.

- **EventPayloadSchemaRegistry now** — a map from event name to Zod payload schema, introduced in this slice with one member (`file.*` → `FileEventPayloadSchema`). Rejected as an Engine dependency because the Engine doesn't need schema introspection. The Workflow Builder is now a real consumer, so the schema package exposes a separate authoring Event catalog with built-in field metadata and opaque Plugin/unknown fallbacks. The generic evaluator does not import or consult that catalog.

- **valueType hint on SwitchConfig** — `SwitchConfig` gains `valueType?: 'string' | 'number'`. Rejected because it pushes the "which fields are numeric" knowledge to the workflow author rather than the event type. With `typeof` at runtime, the value's type IS the declaration — the boundary schema ensured `size` is a number, and the engine sees it at runtime. No hint needed.
