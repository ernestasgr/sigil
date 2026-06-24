# Sigil — TypeScript Coding Standards

Short, opinionated, and specific to this codebase. Goal: lean on the type
system instead of runtime checks, and write functional code instead of
stateful/OOP code.

## 1. Types

**No `any`. Ever.** Use `unknown` and narrow it. If you're reaching for
`any` to make a type error go away, the type is wrong — fix the type.

**Discriminated unions over enums + switch-on-string.** This is already
the shape of `PipelineNode` and `PipelineCondition` — keep using it
everywhere a value can be "one of several kinds with different data."

```typescript
// Good — the compiler knows config's shape once type is narrowed
function execute(node: PipelineNode): void {
  switch (node.type) {
    case "if-else":   return runIfElse(node.config);
    case "file-manager": return runFileManager(node.config);
    // ...
  }
}

// Bad — config is `any`-shaped until you cast it
function execute(node: { type: string; config: object }): void { ... }
```

**Exhaustiveness-check every switch over a union** with a `never`
fallthrough. This is non-negotiable for `PipelineNode["type"]` and
`PipelineCondition` — adding a 11th node type should be a compile error
everywhere it's not handled, not a silent runtime no-op.

```typescript
function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

switch (node.type) {
  case "if-else": ...
  case "switch": ...
  // ... all 10 cases
  default: return assertNever(node);
}
```

**`readonly` by default.** Function parameters, interface fields, and
arrays are `readonly` unless something genuinely needs to mutate them.
`CompiledPipeline`, `PipelineNode[]`, `WorkflowContext` — all read-only
from the executor's perspective once compiled.

```typescript
interface WorkflowContext {
    readonly event: Readonly<FileEventPayload>;
    readonly vars: Readonly<Record<string, unknown>>;
}
```

**Branded types for IDs that look like strings but aren't interchangeable.**
A `WorkflowId` and a `NodeId` are both `string` at runtime but should
never be assignable to each other.

```typescript
type NodeId = string & { readonly __brand: 'NodeId' };
type WorkflowId = string & { readonly __brand: 'WorkflowId' };
```

**Avoid as.** Type assertions should be rare and justified. The preferred place for assertions is at trust boundaries (JSON, IPC, plugins, network input), typically after runtime validation such as Zod. If you need as in business logic, first ask whether the types upstream can be improved. Assertions used to compensate for TypeScript limitations, third-party typings, branded types, or other well-documented cases are acceptable.

**Validate at the boundary, trust the type after.** Every external
input — Workflow JSON, Properties File, plugin manifest, RPC payload
crossing the worker boundary — gets a Zod schema. Derive the TypeScript
type from the schema with `z.infer<>` rather than maintaining the
interface and the schema by hand in two places.

```typescript
const FileConditionSchema = z.object({
    target: z.literal('event'),
    field: z.enum(['path', 'name', 'ext', 'dir', 'size']),
    operator: z.union([StringOperatorSchema, NumberOperatorSchema]),
    value: z.union([z.string(), z.number()]),
});
type FileCondition = z.infer<typeof FileConditionSchema>;
```

## 2. Functional style

**No classes for domain logic.** Plugins, nodes, and the executor are
functions operating on plain data, not objects with methods and
internal mutable state. Reach for a class only when wrapping a genuinely
stateful native resource (a `worker_thread` handle, a `better-sqlite3`
connection) — and even then, expose a functional API over it.

```typescript
// Good
function evaluateCondition(condition: PipelineCondition, ctx: WorkflowContext): boolean { ... }

// Avoid
class ConditionEvaluator {
  private ctx: WorkflowContext;
  evaluate(condition: PipelineCondition): boolean { ... }
}
```

**No mutation.** Don't mutate function arguments, don't push into arrays
you didn't just create, don't reassign `let` where a `const` and a new
value would do. Produce a new `WorkflowContext` rather than mutating the
one you were given — this matters concretely here because Time Travel
Debugging (Phase 3) replays past executions step by step, which is only
possible if each step's context is an immutable snapshot rather than a
shared object that later steps wrote over.

```typescript
// Good
const nextContext: WorkflowContext = {
    ...ctx,
    vars: { ...ctx.vars, [assignTo]: value },
};

// Bad — later replay can't trust this snapshot
ctx.vars[assignTo] = value;
```

**Composition over inheritance.** No base classes for node types. If
behavior is shared between nodes, extract a function, not a superclass.

**Pure functions wherever possible.** `evaluateCondition`,
`compareValues`, `resolveTemplate`, `coerceForComparison` should all be
pure: same input, same output, no I/O, no logging, no side effects.
Isolate the actually-impure parts (filesystem moves, SQLite writes, OS
notifications) into clearly named functions and keep them at the edges.

## 3. Errors

**Prefer `Result` types over throwing for expected failure.** A failed
condition coercion, an unmatched Switch case, or a file-collision policy
of `"error"` are expected outcomes of normal operation, not exceptional
states — model them as data, not exceptions, in the layers that produce
them.

```typescript
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function coerceForComparison(raw: string, expectedType: "string" | "number" | "boolean"): Result<string | number | boolean, "coercion_failed"> { ... }
```

**Reserve `throw` for genuinely unexpected/programmer errors** —
malformed Pipeline JSON that somehow passed Zod, an unreachable branch,
a broken invariant. The DAG Executor's per-node `try/catch` (per the
PRD) is the single place those exceptions are expected to surface and
get turned into a `workflow.error` event — don't let lower-level code
throw for things that are really just `Result`-shaped business outcomes.

## 4. Structure

- One module, one responsibility, named exports only. No `export default`.
- No barrel files (`index.ts` that just re-exports everything) — they
  make it too easy to create circular imports and hide where a thing
  actually lives.
- Async functions are typed explicitly (`Promise<Result<...>>`, not
  inferred); no floating/unawaited promises — if you don't need the
  result, `void somePromise()` to make the intent visible.

## 5. When in doubt

Optimize for "a future contributor with no memory of this conversation
can read the types and know what's valid" over "this was quick to
write." The type system is doing the work that comments and runtime
checks would otherwise have to do — use it.
