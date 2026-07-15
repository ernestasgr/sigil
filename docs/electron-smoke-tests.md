# Electron smoke tests

The desktop package has one Playwright smoke test that launches the production
Electron build and exercises a complete Workflow lifecycle through the renderer:

1. create a Workflow with a Manual Trigger and Log Node;
2. edit and save it;
3. enable it and verify live activation;
4. fire the Manual Trigger and observe the Log Event in the Events section; and
5. delete the Workflow.

## Run locally

From the repository root on Windows:

```powershell
pnpm test:e2e -- tests/e2e/workflow-lifecycle.spec.ts
```

The root command builds `@sigil/schema` and the desktop package first. When the
production build already exists, the shorter command can be used from the root:

```powershell
pnpm --filter @sigil/desktop test:e2e -- tests/e2e/workflow-lifecycle.spec.ts
```

The test uses the Electron executable from the desktop dependency and launches
`apps/desktop/out/main/index.js`. It creates a fresh `%TEMP%\sigil-electron-e2e-*`
directory for every test, passes its `user-data` directory through Electron's
`--user-data-dir` switch, uses its `workspace` directory as the process working
directory, and removes the temporary tree after the app exits.

## Launch path and diagnostics

Update `resolveElectronLaunchLayout()` in
`apps/desktop/tests/e2e/electron-harness.ts` if the production entry moves. The
`SIGIL_ELECTRON_ENTRY` and `SIGIL_ELECTRON_EXECUTABLE` environment variables can
temporarily override those paths while diagnosing a packaging change. Keep the
expected artifact paths in `apps/desktop/scripts/verify-production-build.ts` in
sync with any permanent output-layout change.

The harness waits for the main-process marker `[main] engine worker ready`.
An engine worker error or early process exit raises an
`ElectronEngineStartupFailureError`; a live process that never emits the marker
raises an `ElectronEngineStartupTimeoutError`. Both include actionable context
and captured application output.

On failure, the fixture preserves artifacts under `apps/desktop/test-results`,
including:

- `failure.png` — the final renderer screenshot;
- `trace.zip` — the Playwright trace; and
- `electron.log` — main-process, renderer, and Electron process output.

The Windows quality-gates workflow uploads this directory (and the Playwright
HTML report) even when the smoke step fails.

## Native dialogs

OS-bound file selection is injected through `IpcHandlerContext.nativeDialog` and
defaults to the Electron implementation in
`apps/desktop/src/main/native-dialog.ts`. The IPC handler test supplies a
deterministic fake and a temporary fixture file, so file metadata behavior is
covered without opening a Windows dialog. This is the seam to use for future
renderer tests that need file selection behavior.
