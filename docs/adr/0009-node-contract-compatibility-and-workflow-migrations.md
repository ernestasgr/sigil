# 9. Node Contract Compatibility and Workflow Migrations

Node Contract evolution is a persistence boundary. A Workflow stores Node
identities and Edge source-port values, while the executable contract lives in
the current registry. Loading therefore needs a deterministic migration step
between structural JSON parsing and topology validation.

## Status

Accepted

## Decision

- Every Node Contract has a positive `version` and a reader compatibility
  policy. The policy declares the minimum and maximum reader versions.
  Contracts are validated when registered and whenever a serializable snapshot
  crosses a worker or Electron boundary.
- Existing contracts that omit the policy receive the current reader policy at
  the schema boundary. Future or out-of-range policies are rejected rather
  than interpreted as dynamic metadata.
- Edge `sourcePort` values are stable port IDs. A port may declare explicit
  aliases for values written by an older contract. Aliases are resolved to the
  canonical ID during Workflow loading and at runtime before downstream
  scheduling.
- Persistence first parses the structural Workflow shape, then applies the
  pure Node identity and port-alias migration, and finally validates topology
  against the current Node Contract Registry. This allows a removed port to
  produce a targeted disabled-Workflow diagnostic instead of being discarded
  by an earlier schema refinement.
- Legacy unnamespaced bundled File Watcher and File Manager Nodes migrate to
  their namespaced Plugin identities. The migration is idempotent and returns a
  deterministic audit report. Startup does not rewrite the source file; the
  next successful Workflow write persists the canonical representation.
- Descriptor output-port functions and renderer Plugin output-port adapters are
  compatibility authorities only. New topology, persistence, and runtime code
  must use the Node Contract Registry.

## Consequences

Workflow files remain recoverable when a Plugin or a future contract is not
available. A renamed port can preserve connectivity through an explicit alias;
an unknown or removed port remains visible in a structured topology diagnostic
and cannot silently skip downstream execution.
