# 6. Workflow Persistence Schema Versioning

Workflow files carry a `schemaVersion` so startup can distinguish data that
the persistence module understands from data that needs recovery. Version `1`
is the current format.

## Status

Accepted

## Compatibility policy

- A missing `schemaVersion` and explicit version `0` are legacy records whose
  stored fields are compatible with the current format. The Workflow Store
  migrates them in memory to version `1`.
- Version `1` is loaded as-is.
- Any other explicit version is unsupported. The record is kept visible in
  `WorkflowStore.list()` as disabled with an
  `unsupported_schema_version` diagnostic, but it is not executable. Other
  Workflow records continue loading.
- Legacy records are not rewritten during startup. The next successful write
  for that Workflow atomically persists the current version; if there is no
  write, the original file remains available for recovery.

## Recovery outcome

Workflow writes use a temporary file and atomic replacement. A failed or
interrupted replacement returns a typed persistence failure, leaves the
previous target authoritative, and does not update the in-memory Workflow.
Temporary files are not treated as Workflow records during startup.
