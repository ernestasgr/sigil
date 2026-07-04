# 3. Plugin Capability Vocabulary for Privileged RPC Mediation

Every privileged RPC a Plugin makes across the Bridge is re-checked by the Capability Broker against the Plugin's Manifest permissions on every call. This ADR records the capability vocabulary: which manifest permissions guard which RPC kinds, and which operations are unprivileged.

## Status

Accepted

## Decision

### Permissions that guard RPC kinds

| Permission    | Guards                   | Rationale                                                                               |
| ------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `state.read`  | `PluginRpcKind.StateGet` | Reading per-plugin in-memory state is a privileged data access that must be declared.   |
| `state.write` | `PluginRpcKind.StateSet` | Writing per-plugin in-memory state is a privileged data mutation that must be declared. |

`state.read` and `state.write` are separate permissions so that a plugin can be granted read-only or write-only access independently.

### Operations that do NOT require a manifest permission

- **`event.emit`** — Authorized by the Bridge's declared-`emits` contract, not by a manifest permission. The `emits` array in the manifest is the authorization; the Bridge enforces it per-call. Adding a redundant `event.emit` permission would create two parallel authorization paths for the same operation without adding security value.
- **`log`** — Writing to the visible log stream is unprivileged. Log output is informational and does not expose system data or cause side effects beyond the log itself.

### Layering rule

The Bridge and the Capability Broker have distinct responsibilities that compose, neither replaces the other:

- **Bridge** — mediates the _event-name contract_: a plugin may only emit event names it declared in `manifest.emits`.
- **Broker** — mediates the _permission contract_: a plugin may only perform a privileged RPC if its `manifest.permissions` includes the matching capability.

When both apply (e.g. a hypothetical future `filesystem.read` RPC would be checked by the Broker for the `filesystem.read` permission; an attempted `event.emit` is checked by the Bridge only), the two checks are independent — both must pass.

## Considered Options

- **Single `state` permission** — One `state` capability guarding both read and write. Rejected because it prevents granting read-only access (e.g. allow a plugin to read its own state but not mutate it).
- **Permission for `event.emit`** — Add a manifest permission for emitting events alongside the declared-`emits` contract. Rejected because the declared-`emits` list already serves as the authorization; a second check would be redundant and would require synchronising two authorisation sources.
- **Permission for `log`** — Guard log access behind a permission. Rejected because log output from a plugin writing into its own sandbox has no security boundary value; requiring a permission for logging would add friction without a threat model justification.
