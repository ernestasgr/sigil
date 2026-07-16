# Quality gates

The supported local command for the fast quality gate is:

```bash
pnpm check:fast
```

It runs the following checks in order:

1. `pnpm lint`
2. `pnpm format:check`
3. `pnpm architecture:check`
4. `pnpm typecheck`
5. `pnpm test:fast`

The renderer-only DOM project is available as
`pnpm --filter @sigil/desktop test:renderer:dom`. It runs the tests under
`apps/desktop/tests/renderer/` in jsdom without the desktop package's native
SQLite setup. `pnpm --filter @sigil/desktop test:renderer` runs those tests
alongside the existing Node-oriented renderer tests; `pnpm test` runs the
complete workspace suite, including both desktop test projects.

The supported local command for the full native coverage gate is:

```bash
pnpm check:coverage
```

It builds the shared schema package, prepares and checks the native SQLite binding, runs the schema, desktop, and renderer Vitest projects with V8 coverage, and compares all three reports with the committed baseline. `pnpm coverage` is a short alias for the report-only command.

## Scope decisions

| Check | Included | Explicitly excluded |
| --- | --- | --- |
| Biome lint and format | Repository source, configuration, and documentation files that Biome understands | `node_modules`, `dist`, `out`, `release`, `coverage`, `.turbo`, `.sandcastle`, generated database/log/typecheck files, and user-owned `assets`, `learning-records`, `reference`, and `lessons` trees |
| Dependency Cruiser | Production `.ts`/`.tsx` dependencies below `apps/desktop/src` and `packages/schema/src` | Tests, generated output, declaration output, `node_modules`, and agent tooling |
| Vitest coverage | Production `.ts`/`.tsx` source in the schema, desktop, and renderer project roots | Test files, declarations, generated output, fixtures, mock data, vendor code, and ignored coverage output |

The committed `sigil.properties.json` is a small example configuration and remains in the Biome scope. Runtime `sigil.db*` files are user-owned and ignored.

## Architecture rules

`pnpm architecture:check` treats these as blocking violations:

- runtime dependency cycles;
- new Engine dependency cycles;
- Renderer runtime imports from Engine, Main, or Preload;
- Engine or Preload imports from Renderer; and
- shared schema imports from the desktop application.

Two existing relationships are intentionally visible as warnings rather than hidden:

- `engine.ts → node-plugin-loader.ts → workflow-activator.ts → engine.ts` is a type-only Engine contract cycle. Engine construction owns activation, while activation receives the Engine contract to publish diagnostics.
- `renderer/lib/event-display.ts → engine/event-payload-schemas.ts` uses the Engine's pure event metadata registry. It remains a one-file exception until that registry has a neutral home.

Both exceptions are encoded narrowly in [`.dependency-cruiser.json`](../.dependency-cruiser.json), so unrelated cycles or process-boundary imports still fail the check.

## Coverage policy

Coverage includes production TypeScript source under `packages/schema/src`, non-renderer desktop source under `apps/desktop/src`, and renderer source under `apps/desktop/src/renderer`. Test files and declaration files are excluded. The schema project writes a human-readable summary plus `coverage-summary.json` and LCOV output under `packages/schema/coverage`; the desktop and renderer projects write separate reports under `apps/desktop/coverage/desktop` and `apps/desktop/coverage/renderer`.

The measured baseline is recorded in [`coverage-baseline.json`](coverage-baseline.json). `pnpm coverage:check` requires statements, branches, functions, and lines for the schema, desktop, and renderer projects to be at least their committed baseline. This is a trend policy derived from the current measured suite, rather than an arbitrary round-number threshold. If production source is added without corresponding tests, the affected metric falls below the baseline and the gate fails; update the baseline only alongside an intentional, reviewed coverage-policy change.

The per-file seam floors live in the root [`vitest.coverage.ts`](../vitest.coverage.ts) policy module. They cover topology compilation; Plugin authentication and command dispatch; Workflow persistence; Workflow lifecycle supervision; and renderer state transitions. Each floor is rounded down from the current report for that seam, while the aggregate baseline prevents the rest of the source tree from regressing unnoticed.

## CI quality gate

The `Quality gates (Windows)` job runs every required check sequentially on a fresh `windows-latest` runner:

1. install the frozen workspace dependencies with lifecycle scripts disabled;
2. build the shared schema package;
3. run lint, formatting, architecture, typecheck, pure schema/renderer tests, and the dedicated renderer DOM interaction tests;
4. prepare and preflight `better-sqlite3`;
5. run the schema, desktop, and renderer test projects with coverage;
6. enforce the measured project baselines and per-file seam thresholds;
7. build the production Electron output; and
8. verify the production artifacts and startup marker.

The single job keeps the quality contract easy to find and preserves the intended order: fast static and pure checks run before native setup, while build and release verification run only after tests and coverage pass.

Bootstrap steps are explicitly named and call [`.github/scripts/verify-windows-bootstrap.ps1`](../.github/scripts/verify-windows-bootstrap.ps1). Missing Node.js, pnpm, Python, or the Visual Studio C++ toolchain is reported as `BOOTSTRAP FAILURE`; static checks, native tests, coverage, build, and production-startup failures are reported by their `Fast`, `Native`, `Build`, or `Release` gate. This keeps environment failures distinguishable from product failures for both humans and AI agents.

## Production artifact checks

`pnpm verify:production` checks that the build contains the main process entry, worker bundles, preload bundle, renderer entry, and every local JavaScript/CSS asset referenced by the renderer HTML. It then launches the built Electron entry and requires the existing `[main] engine worker ready` marker within 30 seconds before terminating the verification process.

For a local release-oriented check, run:

```bash
pnpm build
pnpm verify:production
```

When a gate fails, start with the first failed stage: `Bootstrap` indicates prerequisites or dependency setup, `Fast` indicates static/pure checks, `Native` indicates the Windows native test/coverage path, `Build` indicates production compilation, and `Release` indicates artifact completeness or startup viability.
