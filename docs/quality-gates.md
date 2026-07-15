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

## Scope decisions

| Check | Included | Explicitly excluded |
| --- | --- | --- |
| Biome lint and format | Repository source, configuration, and documentation files that Biome understands | `node_modules`, `dist`, `out`, `release`, `coverage`, `.turbo`, `.sandcastle`, generated database/log/typecheck files, and user-owned `assets`, `learning-records`, `reference`, and `lessons` trees |
| Dependency Cruiser | Production `.ts`/`.tsx` dependencies below `apps/desktop/src` and `packages/schema/src` | Tests, generated output, declaration output, `node_modules`, and agent tooling |

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
