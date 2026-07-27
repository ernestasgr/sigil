import { RE2JS } from 're2js';

/**
 * Persisted match patterns are intentionally small. The limits are measured
 * in UTF-16 code units, matching JavaScript's string length semantics.
 */
export const MAX_MATCH_PATTERN_LENGTH = 256 as const;
export const MAX_MATCH_CANDIDATE_LENGTH = 4096 as const;

/**
 * Supported persisted pattern flags. Unicode mode is always enabled by the
 * RE2 engine; `u` may be written explicitly or is added during parsing.
 * Global and sticky matching are deliberately unavailable because a
 * condition is a stateless predicate, not a stateful cursor.
 */
export const MATCH_PATTERN_SUPPORTED_FLAGS = ['i', 'm', 's', 'u'] as const;
export type MatchPatternFlag = (typeof MATCH_PATTERN_SUPPORTED_FLAGS)[number];

export interface ParsedMatchPattern {
    readonly source: string;
    readonly flags: string;
}

export type MatchPatternIssueCode =
    | 'empty-pattern'
    | 'pattern-too-long'
    | 'invalid-flags'
    | 'unsupported-syntax'
    | 'invalid-syntax'
    | 'candidate-too-long'
    | 'matcher-failed';

export interface MatchPatternIssue {
    readonly code: MatchPatternIssueCode;
    readonly message: string;
    readonly limit?: number;
}

export type MatchPatternValidation =
    | { readonly ok: true; readonly value: ParsedMatchPattern }
    | { readonly ok: false; readonly issue: MatchPatternIssue };

export interface CompiledMatchPattern {
    readonly test: (candidate: string) => boolean;
}

export type MatchPatternCompilation =
    | { readonly ok: true; readonly value: CompiledMatchPattern }
    | { readonly ok: false; readonly issue: MatchPatternIssue };

/**
 * The only execution seam for persisted `matches` patterns. Implementations
 * must compile with a linear-time engine and must not delegate user-authored
 * source to the native backtracking RegExp engine.
 */
export interface MatchPatternEngine {
    readonly compile: (pattern: ParsedMatchPattern) => MatchPatternCompilation;
}

export type MatchPatternComparison =
    | { readonly ok: true; readonly matched: boolean }
    | { readonly ok: false; readonly issue: MatchPatternIssue };

function issue(code: MatchPatternIssueCode, message: string, limit?: number): MatchPatternIssue {
    return limit === undefined ? { code, message } : { code, message, limit };
}

function findLastUnescapedSlash(value: string): number {
    let escaped = false;
    let lastSlash = -1;

    for (let index = 1; index < value.length; index += 1) {
        const character = value[index];
        if (character === undefined) continue;
        if (escaped) {
            escaped = false;
        } else if (character === '\\') {
            escaped = true;
        } else if (character === '/') {
            lastSlash = index;
        }
    }

    return lastSlash;
}

function splitPatternLiteral(value: string): ParsedMatchPattern {
    if (!value.startsWith('/')) return { source: value, flags: '' };

    const closingSlash = findLastUnescapedSlash(value);
    if (closingSlash <= 0) return { source: value, flags: '' };

    return {
        source: value.slice(1, closingSlash),
        flags: value.slice(closingSlash + 1),
    };
}

function normalizeFlags(
    rawFlags: string,
):
    | { readonly ok: true; readonly flags: string }
    | { readonly ok: false; readonly issue: MatchPatternIssue } {
    const seen = new Set<string>();

    for (const flag of rawFlags) {
        if (!MATCH_PATTERN_SUPPORTED_FLAGS.some((supportedFlag) => supportedFlag === flag)) {
            return {
                ok: false,
                issue: issue(
                    'invalid-flags',
                    `Pattern flags "${rawFlags}" are invalid. Supported flags are i, m, s, and u.`,
                ),
            };
        }
        if (seen.has(flag)) {
            return {
                ok: false,
                issue: issue('invalid-flags', `Pattern flag "${flag}" is repeated.`),
            };
        }
        seen.add(flag);
    }

    const flags = MATCH_PATTERN_SUPPORTED_FLAGS.filter((flag) => seen.has(flag)).join('');
    return { ok: true, flags: flags.includes('u') ? flags : `${flags}u` };
}

/**
 * Parses the persisted form. A bare string is a pattern source; `/source/imsu`
 * is the optional literal form. A slash at the beginning of a bare source is
 * ambiguous with the literal form, so authors can escape it as `\\/` when a
 * path-like source needs to begin with a slash.
 */
export function parseMatchPattern(value: string): MatchPatternValidation {
    const split = splitPatternLiteral(value);
    if (split.source.length === 0) {
        return {
            ok: false,
            issue: issue('empty-pattern', 'Match patterns must contain at least one character.'),
        };
    }
    if (split.source.length > MAX_MATCH_PATTERN_LENGTH) {
        return {
            ok: false,
            issue: issue(
                'pattern-too-long',
                `Match patterns may contain at most ${MAX_MATCH_PATTERN_LENGTH} UTF-16 code units.`,
                MAX_MATCH_PATTERN_LENGTH,
            ),
        };
    }

    const flags = normalizeFlags(split.flags);
    if (!flags.ok) return flags;
    return { ok: true, value: { source: split.source, flags: flags.flags } };
}

function containsUnsupportedSyntax(source: string): boolean {
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        const next = source[index + 1];
        const nextNext = source[index + 2];

        if (character === '\\') {
            if (next === 'k' && nextNext === '<') return true;
            if (next !== undefined && next >= '1' && next <= '9') return true;
            index += 1;
            continue;
        }

        if (character === '(' && next === '?' && (nextNext === '=' || nextNext === '!')) {
            return true;
        }
        if (character === '(' && next === '?' && nextNext === '<') {
            const groupMarker = source[index + 3];
            if (groupMarker !== undefined && groupMarker !== '=' && groupMarker !== '!') {
                continue;
            }
            return true;
        }
    }

    return false;
}

function engineIssue(source: string, error: unknown): MatchPatternIssue {
    if (containsUnsupportedSyntax(source)) {
        return issue(
            'unsupported-syntax',
            'This pattern uses syntax that the linear-time matcher does not support, such as lookarounds or backreferences.',
        );
    }

    const detail = error instanceof Error && error.message.length > 0 ? ` ${error.message}` : '';
    return issue('invalid-syntax', `Match pattern syntax is invalid.${detail}`);
}

export function createRe2MatchPatternEngine(): MatchPatternEngine {
    return {
        compile: (pattern): MatchPatternCompilation => {
            try {
                let flags = 0;
                if (pattern.flags.includes('i')) flags |= RE2JS.CASE_INSENSITIVE;
                if (pattern.flags.includes('m')) flags |= RE2JS.MULTILINE;
                if (pattern.flags.includes('s')) flags |= RE2JS.DOTALL;

                const compiled = RE2JS.compile(pattern.source, flags);
                return { ok: true, value: { test: (candidate) => compiled.test(candidate) } };
            } catch (error) {
                return { ok: false, issue: engineIssue(pattern.source, error) };
            }
        },
    };
}

export const DEFAULT_MATCH_PATTERN_ENGINE = createRe2MatchPatternEngine();

/**
 * Validates both the persisted literal and the syntax accepted by RE2. This
 * is used by the Zod condition schema so invalid patterns cannot be admitted
 * into a Workflow document.
 */
export function validateMatchPattern(
    value: string,
    engine: MatchPatternEngine = DEFAULT_MATCH_PATTERN_ENGINE,
): MatchPatternValidation {
    const parsed = parseMatchPattern(value);
    if (!parsed.ok) return parsed;

    const compiled = engine.compile(parsed.value);
    return compiled.ok ? parsed : compiled;
}

/**
 * Compares one bounded candidate through the same interface used for schema
 * compilation. Candidate length is checked before the engine is invoked.
 */
export function compareMatchPattern(
    pattern: string,
    candidate: string,
    engine: MatchPatternEngine = DEFAULT_MATCH_PATTERN_ENGINE,
): MatchPatternComparison {
    if (candidate.length > MAX_MATCH_CANDIDATE_LENGTH) {
        return {
            ok: false,
            issue: issue(
                'candidate-too-long',
                `Match candidates may contain at most ${MAX_MATCH_CANDIDATE_LENGTH} UTF-16 code units.`,
                MAX_MATCH_CANDIDATE_LENGTH,
            ),
        };
    }

    const parsed = parseMatchPattern(pattern);
    if (!parsed.ok) return parsed;

    const compiled = engine.compile(parsed.value);
    if (!compiled.ok) return compiled;

    try {
        return { ok: true, matched: compiled.value.test(candidate) };
    } catch {
        return {
            ok: false,
            issue: issue(
                'matcher-failed',
                'The linear-time matcher could not evaluate this pattern safely.',
            ),
        };
    }
}
