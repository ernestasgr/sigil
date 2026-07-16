# Knip baseline

Generated on 2026-07-16 from the initial configured run:

```text
knip --no-exit-code --reporter markdown
```

The complete file-and-symbol report is preserved in [knip-baseline-report.md](knip-baseline-report.md). It is advisory: every finding is emitted with `warn` severity and CI does not fail on the report.

## Finding categories

### Fix

- `apps/desktop/package.json:37` — `lucide-react` is declared but has no source or test reference. It is removed in this issue slice.
- `apps/desktop/src/engine/atomic-file.ts:49` — `nodeAtomicFileSystem` is used only inside its defining module; its unused public export is removed in this issue slice.

### Intentional

- `tailwindcss` and `tw-animate-css` are consumed by CSS `@import` statements in `apps/desktop/src/renderer/styles.css`, outside Knip’s TypeScript module graph.
- `lint-staged` is invoked by `.husky/pre-commit` through `pnpm exec`; the shell boundary is documented as an explicit Knip exception.
- `packages/schema/src/**/*.ts` is modeled as public entry modules because each non-test source module is exposed through `package.json#exports`.
- Electron main/preload/renderer/worker entrypoints, plugin handlers, and plugin manifests are runtime boundaries and are listed explicitly in `knip.jsonc`.

### Configuration gap / review backlog

- The initial report contains 82 unused exports, 119 unused exported types, and 4 duplicate exports in the desktop workspace. These are retained as advisory findings because they cross IPC, Plugin, test, and renderer authoring seams; each must be reviewed against its boundary before it can be removed or made blocking.
- The first unconfigured run also reported reachable renderer modules and Plugin handlers as unused. Those findings were resolved by adding the renderer entry, both worker entries, builtin handler/manifest entries, and the test/build configuration entries before this baseline was captured.

The baseline is intentionally committed as evidence for the rollout. Future slices can promote a reviewed issue type from `warn` to `error` in `knip.jsonc`.

## Maintaining the configuration

- Add every new Electron build entrypoint to the `apps/desktop` `entry` list.
- Add a new Plugin handler and manifest under `src/builtin-plugins/**`; the existing filesystem-discovery globs keep both reachable. A different discovery mechanism needs its own explicit `entry` pattern.
- Add repository or desktop TypeScript scripts to the matching `scripts/**/*.ts` entry list.
- Add a new public schema module to `package.json#exports`; the schema workspace’s non-test source glob models those public module boundaries.
- Add generated output, fixtures, or test-only helpers to the narrowest `ignoreFiles` pattern, with a comment explaining why the boundary is intentional.
