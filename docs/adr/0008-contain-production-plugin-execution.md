# 8. Contain Production Plugin Execution to Source-Controlled Built-ins

Sigil's Plugin worker evaluates bundled Plugin code in a `node:vm` context. A worker thread,
restricted module surface, Bridge validation, and Capability Broker checks reduce accidental
access and constrain expected operations, but they do not create a security boundary for code an
attacker controls. In particular, `node:vm` isolates JavaScript contexts within the same Node.js
process; it is not an isolation mechanism for hostile code.

## Status

Accepted

## Decision

Production loads and executes only the source-controlled Plugins shipped from
`apps/desktop/src/builtin-plugins`:

- The Engine interface exposes `loadBuiltinPlugins()` and accepts no runtime Plugin directory.
- The Engine worker does not inspect `<userData>/plugins` or any other user-writable location.
- The directory-based loader remains an internal implementation and test seam. Production startup
  supplies only the source-controlled built-in directory.

Built-in Plugins continue to run in dedicated worker threads and the existing defense-in-depth
controls remain mandatory:

1. Plugin code is evaluated through the restricted `node:vm` surface inside its Plugin worker.
2. Bridge envelopes and declared Event names are validated at every crossing.
3. The Capability Broker re-checks Manifest permissions for every privileged request.

Those controls protect the application from mistakes and limit trusted built-in behavior. They
must not be described or relied upon as containment for an untrusted Plugin.

## Reopening Criteria

External Plugin discovery may return only after a new ADR records evidence that all of the
following are true:

1. **Independent isolation:** Plugin code runs behind an OS-enforced process or equivalent
   isolation boundary whose filesystem, network, process, native-code, and host-runtime access is
   denied independently of JavaScript cooperation and `node:vm`.
2. **Explicit threat model:** The design covers malicious source, dependency and module-resolution
   attacks, native add-ons, resource exhaustion, cross-Plugin access, persistence, and escape into
   Sigil or the host account.
3. **Adversarial verification:** Automated tests demonstrate that escape attempts cannot bypass
   the isolation boundary or Capability Broker on every supported production platform, including
   permission revocation and malformed Bridge traffic.
4. **Independent review:** The implementation and threat model receive a security review whose
   release-blocking findings are resolved and recorded.
5. **Controlled provenance and rollback:** Installation verifies Plugin identity and integrity,
   isolates mutable state, supports revocation, and provides a tested way to disable or remove a
   compromised Plugin.

Worker threads, a restricted import list, additional `node:vm` hardening, or capability checks
alone do not satisfy the independent-isolation criterion.

## Consequences

- A writable Plugin copied into the application data directory is ignored by production.
- Source-controlled built-ins retain the existing worker, Bridge, and Capability Broker execution
  path.
- Development of the low-level loader and sandbox can continue under tests without presenting it
  as a production trust boundary.
- Reintroducing external Plugins is an architecture and security decision, not a configuration
  toggle.

## Considered Options

- **Continue external discovery and rely on `node:vm`:** Rejected because the VM context shares the
  Node.js process and is not a hostile-code security boundary.
- **Keep discovery but require user confirmation:** Rejected because consent does not contain a VM
  escape or protect the host after execution begins.
- **Remove the worker, Bridge, or Capability Broker for built-ins:** Rejected because those layers
  still provide fault isolation, contract validation, and least-privilege enforcement for trusted
  code.
