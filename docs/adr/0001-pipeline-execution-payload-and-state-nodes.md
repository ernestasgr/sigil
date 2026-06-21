# 1. Pipeline Execution Payload and State Nodes

We decided to support generic state read and write operations via `state-get` and `state-set` nodes, rather than keeping state management purely system-managed. To prevent subsequent nodes from losing access to the trigger's file metadata (e.g., `FileEventPayload`) when utility or state nodes are chained, we introduce a structured `WorkflowContext` containing both `event` (trigger metadata) and `vars` (transient in-memory variables) namespaces. This naming strictly disambiguates persistent "Workflow State" (SQLite) from the transient "Workflow Variables" (`vars`) passed along during execution. Downstream conditions (e.g., `If/Else`) and switch matching are extended to evaluate both namespaces using type-aware comparisons.

## Status

Accepted

## Considered Options

- **Purely System-Managed State**: Keep state read-only for workflows, tracking only execution statistics. Rejected because it drops the "deduplicate files" user story from the MVP.
- **Direct Value Replacement**: Let each node's output replace the execution payload completely. Rejected because chaining state operations would destroy the original event metadata needed by action nodes.
