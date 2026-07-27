# 11. Bounded Linear-Time Pattern Matching

User-authored `matches` conditions are persisted Workflow data and may be
evaluated against values produced by Events or Workflow Context. A native
JavaScript `RegExp` would make the Engine's event-loop availability depend on
the authored pattern and candidate value because the native engine uses
backtracking for some inputs.

## Status

Accepted

## Decision

Persisted `matches` conditions use one `MatchPatternEngine` interface backed by
the pure-JavaScript RE2JS port. RE2's automata-based matcher provides linear-time
matching for the accepted regular-language syntax. The schema validates a pattern by
compiling it through the same interface before the Workflow is admitted, and
the Engine evaluates it through `compareMatchPattern` rather than constructing
a native `RegExp`.

The persisted value may be either a bare pattern source or a slash-delimited
literal such as `/^report\\.pdf$/i`. The supported syntax is RE2 syntax:

- literals and escaped literals;
- character classes and ranges;
- grouping, alternation, anchors, and bounded or unbounded repetition;
- Unicode character classes and code points.

Lookahead, lookbehind, backreferences, and other syntax rejected by RE2 are
unsupported. Captures are allowed by the engine but are ignored because a
condition is only a boolean predicate.

Supported flags are `i` (case-insensitive), `m` (multiline), `s` (dot matches
line terminators), and `u` (Unicode). Unicode mode is always enabled by the
engine, so `u` is optional in the persisted literal and is normalized into the
compiled flags. Global and sticky flags are rejected because condition
evaluation must be stateless.

Pattern source is limited to 256 UTF-16 code units. Candidate values are
limited to 4,096 UTF-16 code units. The candidate limit is checked at the
condition-evaluation seam before the matcher compiles or evaluates the
pattern; an over-limit candidate is a deterministic non-match.

## Consequences

- Invalid syntax, unsupported syntax, invalid flags, and over-limit patterns
  are reported by the condition schema and surface as field-targeted Workflow
  Builder compilation diagnostics.
- Every persisted pattern is checked before execution, while the candidate
  bound protects the Engine even when a typed Pipeline was assembled outside
  the normal authoring path.
- The `matches` operator has documented Unicode semantics and no stateful
  `lastIndex` behavior.
- The application carries a zero-dependency RE2JS implementation in the shared
  schema package so Renderer authoring and Engine execution use identical
  matching semantics without a native or WebAssembly runtime dependency.

## Rejected Options

- Native JavaScript `RegExp` was rejected because syntax validation or a
  heuristic such as `safe-regex` does not make the native backtracking engine
  linear-time.
- A custom regular-expression interpreter was rejected because maintaining
  Unicode semantics and the supported syntax would duplicate a mature
  linear-time engine inside Sigil.
