## Agent skills

### Issue tracker

Issues and PRDs live in GitHub Issues. External PRs are not treated as a request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Using canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context project layout using `CONTEXT-MAP.md` and context-specific `CONTEXT.md` files. See `docs/agents/domain.md`.

### Testing native SQLite

The desktop package uses Node's built-in `node:sqlite` driver. Run the complete suite from the repository root:

```powershell
pnpm -r test
```

If Vitest/esbuild or pnpm reports `EPERM` / `Access is denied` while traversing pnpm-linked paths or the pnpm store, rerun the same command with elevated filesystem access. The supported runtime is enforced by `pnpm check:node`.

```powershell
pnpm check:node
```
