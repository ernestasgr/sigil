# 4. Zod at the Inter-Process Envelope Layer

Every cross-process message — Engine worker ↔ Main process, Engine ↔ Plugin worker — is now validated at its receive site with a Zod schema. The message envelope (the `type`/`kind` discriminator plus routing fields) is parsed with `safeParse` before dispatch, so that malformed or unknown messages produce a structured error or a logged drop rather than a crash or silent discard. The content payloads inside messages were already validated (Manifest, CompiledPipeline, Properties File, plugin `event.emit` payload, plugin `workerData`); the envelope layer closes the remaining gap.

## Status

Accepted

## Decision

### Schema location

Every existing TypeScript message union now has a corresponding Zod schema co-located in the same module. The TypeScript type is derived from the schema via `z.infer<>` (single source of truth):

- `apps/desktop/src/shared/ipc-channels.ts` — `EnginePingSchema`, `EnginePongSchema`, …, `EngineMessageSchema`, `WorkerInboundSchema`, `EngineReadySchema`, `WorkflowIdSchema`.
- `apps/desktop/src/engine/plugin-rpc.ts` — `PluginRpcRequestSchema`, `PluginRpcResponseSchema`, `PluginToEngineMessageSchema`, `EngineToPluginMessageSchema`.

### Receive-site discipline

Each `worker.on('message')`, `port.on('message')`, or `ipcMain.handle` receive site accepts `raw: unknown` and calls `safeParse` before dispatching. On parse failure:

| Site                                   | Behaviour                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `worker.ts` (Engine worker)            | Emits a `log.output` bus event and drops the message. Replaces the previous `assertNever` crash.                                 |
| `engine-client.ts` (Main process)      | Logs a `console.error` and drops the message. Replaces the previous silent-drop.                                                 |
| `plugin-loader.ts` (Engine)            | Responds to the plugin worker with a `PluginRpcResponse` carrying `error: 'invalid_message'`. Does not reach `handleRpcRequest`. |
| `plugin-worker.ts` (Plugin worker)     | Rejects the pending RPC promise (or logs if no matching requestId). Replaces the previous silent-ignore.                         |
| `main/index.ts` (`ToggleWorkflow` IPC) | Uses `WorkflowIdSchema.safeParse` instead of a manual `typeof` guard.                                                            |

### Composes with existing seams, does not replace them

The envelope validation, the Bridge's emission contract, and the Capability Broker's permission check are three independent layers that compose at different depths:

1. **Envelope validation** (this ADR) — validates message shape at the transport boundary. Runs first.
2. **Bridge `manifest.emits` check** — mediates the event-name contract for `event.emit` RPCs. Runs inside `handleRpcRequest`.
3. **Capability Broker permission check** — mediates `manifest.permissions` for privileged RPCs (`state.read`/`state.write`). Runs inside `handleRpcRequest`.

None replaces another; all three must pass for a privileged RPC to succeed.

### No change to ADR-0002

ADR-0002 deferred the `EventPayloadSchemaRegistry` until it has a real consumer. This ADR validates message _envelopes_ (the `type`/`kind` discriminator and transport fields), not event _payload_ shapes, and does not contradict ADR-0002.

## Considered Options

- **TypeScript-only unions with `assertNever`** — The previous approach. A message with an unknown `type` crashes the worker (in `worker.ts`) or is silently dropped (in `engine-client.ts`). Rejected because it fails the deletion test — removing the type annotation changes zero runtime behaviour — and the README's "Zod at every process boundary" claim was unfalsifiable at these sites.
- **Zod-only at the content layer, keep envelopes as casts** — The previous half-application. Rejected because the process boundaries the README enumerates (Renderer↔Main, Main→Renderer, Engine↔Plugins, Engine worker_thread) all have envelope-only receive sites that do not validate.
- **Single `z.discriminatedUnion` for all message unions** — Used for `PluginToEngineMessage` (unique `kind` values) but not for `EngineMessage` where `EngineGetWorkflowResultFound` and `EngineGetWorkflowResultNotFound` share the same `type` literal and are discriminated by `found`. In the Engine message case `z.union` is used instead; the sub-union for `EngineGetWorkflowResult` uses `z.discriminatedUnion('found', [...])`.
