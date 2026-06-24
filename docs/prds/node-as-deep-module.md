# PRD: Node as a Deep Module — Per-Layer Node Registries

## Problem Statement

Adding a new Node type currently requires edits in 7 files across 2 packages and 3 process layers (schema, engine, renderer). The compiler enforces 4 of these via `assertNever`/`satisfies`/`discriminatedUnion`. The root cause: each Node's 5 per-type concerns (config schema, output ports, default config, execute logic, UI form + metadata) are scattered across independent modules with no single registration point.

This violates the **locality** principle — understanding one Node type means bouncing between `nodes.ts`, `node-configs.ts`, `node-defaults.ts`, `node-registry.ts`, `config-forms.tsx`, `properties-panel.tsx`, and `dag-executor.ts`. Changes to one Node's shape cause shotgun surgery across disconnected files.

ADR-0002 established the pattern for cheap extensibility on the event axis ("zero engine changes per new event type — only a boundary schema"). The Node axis was never given the same treatment.

## Solution

Each Node type becomes a **deep module**: its 5 concerns are gathered into a per-layer descriptor, registered once per layer, co-located by concern. Three parallel registries (schema, engine, renderer), each keyed by `NodeType`, each generic consumer (walker, palette, property panel, validator) does a lookup instead of a switch.

Adding a new Node type becomes:

- Schema layer: one descriptor entry (config schema + output ports + default config)
- Engine layer: one handler module (execute function)
- Renderer layer: one registry entry (label, category, description, form component)

3 edits instead of ~10. Each co-located within its layer.

## User Stories

1. As a developer adding a new Node type, I want to register it in one place per layer, so that I don't have to touch 7 files to add one type.
2. As a developer adding a new Node type, I want my Node's execution logic to live in its own module, so that I can understand and test it in isolation.
3. As a developer adding a new Node type, I want my Node's config schema and default config to be co-located, so that they can't drift apart.
4. As a developer adding a new Node type, I want my Node's UI metadata and form component to live together in one registry entry, so that I don't duplicate the type dispatch.
5. As a developer maintaining an existing Node, I want all of its execution logic in one file, so that I don't need to read a switch statement to find my code.
6. As a developer writing tests for a Node, I want to test its `execute` function directly, so that I don't need to build a full pipeline to exercise one Node's logic.
7. As a developer reviewing a PR that adds a Node, I want to see one new file per layer, so that the diff is small and focused.
8. As a developer debugging a Node execution failure, I want the error to come from a dedicated handler, so that I don't have to disambiguate between 10 cases in one switch.
9. As a developer, I want the `renderForm` switch and `defaultSpecFor` switch removed, since they are pure pass-throughs that add no value.
10. As a developer, I want the dag-executor's walker to be node-type-agnostic, so that it doesn't need to change when new Nodes are added. (Completion of ADR-0002's principle on the Node axis.)
11. As a developer, I want the schema-layer Node descriptor to be the single source of truth for a Node's wire contract, so that consumers query it explicitly rather than re-parsing a discriminated union.
12. As a developer, I want `assertNever` checks in each registry consumer to catch missing entries at compile time, so that no Node type goes unregistered.
13. As a developer, I want the `Node Default` term defined in CONTEXT.md, so that there is a canonical domain understanding of the "starting configuration" for a Node type.

## Implementation Decisions

### Schema layer — Node Descriptor

Each Node type registers a descriptor in `packages/schema`:

- `configSchema`: the Zod schema for the Node's config
- `getOutputPorts(config)`: a function returning the list of output port names. Most Nodes return a static array; `switch` computes it from `config.cases`.
- `defaultConfig`: the canonical starting configuration for this Node type, always satisfying `configSchema`. Defined as a `Node Default` in the domain glossary.

The `PipelineNode` discriminated union is derived from the registered descriptors at module load time, not hand-written.

### Engine layer — Node Handler

Each Node type exports a handler satisfying the `NodeHandler` interface:

- `execute(ctx, deps) → NodeRunResult`
- `deps: { bus, sleep, resolveTemplate, evaluateCondition, matchSwitchCase }`
- Errors are thrown on failure; caught generically by the walker.
- The handler registry is a static `Record<NodeType, NodeHandler>` in one file.

The unified handler replaces both `runTriggerNode` and `runBodyNode` switches. The trigger distinction is handled at the walker level (first node in topological order).

### Renderer layer — UINodeDefinition

Each Node type registers a definition in `apps/desktop/renderer/node-registry.ts`:

- `label`, `category`, `description` (existing metadata)
- `Form`: React component for the node's config editor
- `defaultConfig`: imported from the schema layer
- `Form` receives `{ config, onChange: (config) => void }` — the re-tagging of the type is handled by a generic wrapper in the property panel.

The `renderForm` switch and `defaultSpecFor` function are deleted.

### Cross-layer coordination

Three parallel `Record<NodeType, …>` registries, one per layer. `assertNever` in each consumer ensures exhaustiveness at compile time. No shared source-of-truth layer — the schema layer is the canonical set of types in spirit, but engine and renderer may legitimately omit types (e.g. `file-watcher` has no engine handler; the Plugin subsystem handles it).

## Testing Decisions

- **Tests should exercise the module's interface, not its implementation.** A good test for a Node handler calls `handler.execute(input, deps)` and asserts on `NodeRunResult`. A good test for a form component renders it, passes a config, and asserts the change handler produces the expected config shape.

- **Schema layer**: each Node descriptor's `defaultConfig` is tested against its `configSchema` via a generic loop over all registered types (existing pattern: `node-defaults.test.ts`). Each descriptor contributes to a tested `PipelineNode` union (existing pattern: `schema.test.ts`).

- **Engine layer**: each Node handler gets a unit test for `execute`. The walker integration tests stay in `dag-executor.test.ts` (existing pattern: mini-pipeline construction). The integration tests exercise the handler registry through the walker — they are the high seam.

- **Renderer layer**: each Node's form component gets a render test that verifies it displays the correct fields and a change test that verifies it produces the right config on input. The property panel test verifies it dispatches to the correct form (via the registry). No per-form tests exist today; prior art is `builder-store.test.ts`.

- **The walker test stays as the high integration seam.** The handler unit tests are new internal tests behind the seam — they exercise the handler interface directly.

## Out of Scope

- UI for the `file-watcher` node type's plugin bridge. The `file-watcher` node currently throws "not executed directly by the DAG executor" — that error stays.
- Implementation of stubbed execution for `file-manager`, `state-get`, `state-set`. They remain "not implemented in this slice" but now have a clear place to land (a handler module).
- The `EventPayloadSchemaRegistry` floated in ADR-0002. This PRD is about the Node axis, not the Event axis.
- A shared cross-layer source-of-truth. The three parallel registries are sufficient.
- Build-time code generation. All derivation is at module load time.
- Refactoring the `condition-evaluator.ts` or `template.ts` modules. They are consumed by handlers via the deps bag.

## Further Notes

- ADR-0002 (event-shape-agnostic engine) is precedent, not obstacle. This work completes ADR-0002's principle on the Node axis.
- ADR-0001 (Pipeline execution payload and state nodes) is not touched.
- `CONTEXT.md` has been updated with the `Node Default` term.
