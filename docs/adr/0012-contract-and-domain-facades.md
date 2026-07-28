# 12. Contract and Workflow Domain Facades

## Status

Accepted

## Context

The contracts and Workflow domain packages had accumulated filesystem-shaped
entrypoints for individual schemas, Nodes, registrations, descriptors, and
sample Pipelines. Those entrypoints let consumers bypass the lifecycle seam,
duplicate Node assembly, and import implementation details that were not part
of the persisted or wire contract.

## Decision

`@sigil/contracts` publishes only use-case-oriented facades:

- `@sigil/contracts` for the complete compatibility surface;
- `@sigil/contracts/ids` for branded identifiers;
- `@sigil/contracts/workflow` for Workflow, Pipeline, condition, operator, and
  built-in Node configuration contracts;
- `@sigil/contracts/events` for Event catalog and payload contracts;
- `@sigil/contracts/plugins` for Manifest and Node Contract wire contracts; and
- `@sigil/contracts/properties` for the Properties File contract.

The package does not publish per-Node modules, registration arrays, descriptor
aliases, or helper-only schema modules. Persisted and wire contracts do not
assemble runtime registries at import time.

`@sigil/workflow-domain` publishes only its root facade. It owns Workflow
compilation, topology admission, Node Contract resolution, and the curated
built-in authoring and switch behavior needed by consumers. Built-in Node
definitions, registration arrays, and assembly details remain private to the
domain package. The Engine remains responsible for mutable runtime registries,
handlers, and process-boundary composition.

The architecture gate checks package export keys and rejects workspace imports
that bypass these facades. Dependency Cruiser continues to enforce process and
dependency direction, while package and domain tests exercise the public
admission seams.

## Consequences

- Consumers depend on stable use cases rather than the source tree layout.
- A persisted `PipelineNode` is validated by contracts, then admitted through
  `compileWorkflow` and Node Contract resolution before execution.
- Renderer authoring uses the curated built-in catalog and plugin adapters
  without owning a second built-in registration source.
- Internal files can evolve without creating compatibility obligations.
- New public package surfaces require an explicit export, import-guard, Knip,
  and documentation update.

## Reopening criteria

Add a new facade only when a distinct persisted, wire, or domain use case has a
real consumer and its dependency direction is covered by the architecture
gate. Do not add a facade solely to expose an implementation file.
