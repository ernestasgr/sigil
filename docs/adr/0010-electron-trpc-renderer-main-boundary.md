# ADR-0010: Typed renderer-to-main boundary with electron-trpc

## Status

Accepted

## Context

The Electron renderer previously crossed into the main process through a hand-written `contextBridge` API, `ipcMain.handle` registrations, and separately maintained request/response and push-channel contracts. That duplicated the boundary surface and allowed the renderer method signatures, main handlers, and serialized payloads to drift.

The engine remains a separate `worker_thread`. Its message envelope is already validated with Zod and must remain independent of Electron IPC because `electron-trpc` is designed for the renderer-to-main Electron process boundary.

## Decision

Use `electron-trpc` with a single tRPC `AppRouter` as the renderer-to-main contract:

- `apps/desktop/src/main/trpc/router.ts` owns main-process procedures and their dependencies.
- `apps/desktop/src/shared/trpc-contracts.ts` owns boundary input/output schemas shared by the router and renderer adapter.
- The preload exposes only `exposeElectronTRPC()`.
- The renderer uses `ipcLink<AppRouter>()` and a small ergonomic adapter for UI callers.
- Logs, workflow-list updates, and engine bus events use tRPC subscriptions with explicit teardown.
- The worker-thread boundary continues to use the existing Zod-validated command envelopes.

The renderer adapter parses returned values and subscription emissions with the same shared Zod schemas. This keeps runtime validation at the serialization boundary while `AppRouter` supplies compile-time inference for procedure names, inputs, outputs, and subscriptions.

## Consequences

There is one typed source of truth for renderer-to-main procedures, and adding a procedure requires changing the router contract rather than manually synchronizing channel constants, preload methods, and main handlers. The adapter preserves the renderer's existing ergonomic method calls while keeping transport details out of UI components.

The project is intentionally pinned to the tRPC 10 API supported by the current `electron-trpc` release. The worker and plugin bridges remain separate because they have different transport lifecycles and isolation requirements.
