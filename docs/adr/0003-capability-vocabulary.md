# 3. Plugin Capability Vocabulary for Privileged RPC Mediation

Every privileged RPC a Plugin makes across the Bridge is re-checked by the Capability Broker against the Plugin's Manifest permissions on every call. This ADR records the capability vocabulary: which manifest permissions guard which RPC kinds, and which operations are unprivileged.

## Status

Accepted

## Decision

### Permissions that guard RPC kinds

| Permission        | Guards                                                                              | Rationale                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `state.read`      | `state.get`                                                                         | Reading per-Workflow State is a privileged data access that must be declared.             |
| `state.write`     | `state.set`, `state.flush`                                                         | Writing or persisting Workflow State is a privileged data mutation that must be declared. |
| `filesystem.read` | `fileWatcherManager.registerSubscriber`, `fileWatcherManager.unregisterSubscriber` | File watcher access can observe filesystem activity and must be declared.                 |

`state.read` and `state.write` are separate permissions so that a plugin can be granted read-only or write-only access independently.

### Operations that do NOT require a manifest permission

- **`event.emit`** — Authorized by the Bridge's declared-`emits` contract, not by a manifest permission. The `emits` array in the manifest is the authorization; the Bridge enforces it per-call. Adding a redundant `event.emit` permission would create two parallel authorization paths for the same operation without adding security value.
- **`log`** — Writing to the visible log stream is unprivileged. Log output is informational and does not expose system data or cause side effects beyond the log itself.

### Layering rule

The Bridge and the Capability Broker have distinct responsibilities that compose, neither replaces the other:

- **Bridge** — mediates the _event-name contract_: a plugin may only emit event names it declared in `manifest.emits`.
- **Broker** — mediates the _permission contract_: a Plugin may only perform a privileged RPC if its Manifest permissions include the operation's explicit capability mapping.

When both apply (for example, an operation that reads the filesystem and emits an Event), the two checks are independent — both must pass for the operation to succeed.

### Permission Overrides are a narrowing surface

A Permission Override can revoke capabilities declared by a Plugin's Manifest,
but it can never expand the Plugin's reach. When an override exists, the
Capability Broker's **Effective Capability View** is:

```
Manifest permissions ∩ stored override
```

When no override exists, the Effective Capability View is the Manifest's
permission set. The Engine plugin listing and the Settings permission card use
this same view, so the Renderer never presents an undeclared capability as
granted or toggleable.

The Permission Override Store preserves the user's stored selection verbatim,
including capabilities not currently declared by the Manifest. Those selections
remain available if a future version of the Plugin expands its Manifest; the
Broker continues to enforce the intersection until that expansion occurs.

## Considered Options

- **Single `state` permission** — One `state` capability guarding both read and write. Rejected because it prevents granting read-only access (e.g. allow a plugin to read its own state but not mutate it).
- **Permission for `event.emit`** — Add a manifest permission for emitting events alongside the declared-`emits` contract. Rejected because the declared-`emits` list already serves as the authorization; a second check would be redundant and would require synchronising two authorisation sources.
- **Permission for `log`** — Guard log access behind a permission. Rejected because log output from a plugin writing into its own sandbox has no security boundary value; requiring a permission for logging would add friction without a threat model justification.
