# Structural checks

Sigil uses ast-grep for syntax-aware checks at the TypeScript architecture
seams. The CLI is pinned as a workspace dev dependency, so the commands work
through pnpm on the supported Windows runner and on other supported platforms.

## Commands

```bash
pnpm structure:check
pnpm structure:check:json
pnpm structure:test
pnpm structure:codemod
pnpm structure:codemod:write
```

`pnpm structure:check` is the default local and CI report. It is read-only and
prints warning-level findings with the rule name, file, line, message, and
remediation note. The current rules are intentionally advisory while existing
occurrences are being catalogued.

`pnpm structure:check:json` emits a compact, deterministic JSON array for
agent tooling and CI artifacts. Each finding includes `ruleId`, `file`, a
zero-based `range`, `message`, `note`, and rule `metadata` including the
remediation hint.

`pnpm structure:test` runs the rule fixtures and their checked-in snapshots.
The fixtures live under [`tools/ast-grep/rule-tests`](../tools/ast-grep/rule-tests)
and contain both matching and nearby non-matching examples for every guard.

The codemod commands are separate from the guard scan. The first command only
previews the `codemod-*` recipes. Only `pnpm structure:codemod:write` passes
ast-grep's `--update-all` flag and may mutate source files. After applying a
recipe, inspect the diff and run the typecheck:

```bash
pnpm structure:codemod:write
git diff --check
pnpm typecheck
```

The initial recipe removes only the redundant intermediate `unknown` from a
double assertion. It keeps the final assertion in place, so the resulting diff
is small and still requires a reviewer to confirm the trust boundary.

## Current guards

| Rule | Protected seam |
| --- | --- |
| `guard-raw-message-cast` | Bridge and IPC envelope validation instead of raw message-like casts |
| `guard-reflective-rpc` | Typed adapter calls instead of reflective invocation |
| `guard-direct-console` | Structured logging and Event Bus diagnostics instead of direct production console calls |
| `guard-direct-console-tsx` | The same console invariant for Renderer TSX files |
| `guard-double-assertion` | Validated boundary types instead of `as unknown as` |
| `guard-unapproved-worker` | Reviewed Worker adapters with explicit lifecycle and message validation |
| `guard-unsafe-filesystem` | Capability-checked Action Plugin and atomic Workflow persistence seams |

The Worker guard allows only the Main Engine client and Engine Plugin loader.
The filesystem guard allows only the atomic writer, file-manager Action Plugin,
and Workflow Store deletion seam. These are path-level exceptions in the rule
files, with comments explaining why they are reviewed. They are deliberately
narrow; do not replace them with a repository-wide ignore.

## Adding a rule

When a new architectural invariant is introduced:

1. Record the invariant in the relevant ADR or domain documentation first.
2. Add a `guard-<invariant>.yml` file under
   [`tools/ast-grep/rules`](../tools/ast-grep/rules). Scope it to production
   `src` globs and exclude test files explicitly.
3. Add a rule test under
   [`tools/ast-grep/rule-tests`](../tools/ast-grep/rule-tests) with at least
   one match and one nearby non-match. Review the generated snapshot as part
   of the change.
4. Run `pnpm structure:test`, `pnpm structure:check`, and
   `pnpm structure:check:json`.
5. If a mechanical migration is safe, use a separate `codemod-*` rule with a
   `fix`. Preview it first, apply it only with the explicit write command, and
   review the resulting diff and typecheck.

An unavoidable exception must name the rule. Put a short reason immediately
above the code and use a narrow suppression such as:

```typescript
// Intentional: this Main diagnostic forwards an OS-level worker failure.
// ast-grep-ignore: guard-direct-console
console.error(message);
```

Do not use a bare `ast-grep-ignore` or disable a rule globally. The check
command enables ast-grep's unused-suppression and no-suppress-all diagnostics
so stale or broad suppressions remain visible.
