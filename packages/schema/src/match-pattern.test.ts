import { describe, expect, it } from 'vitest';

import {
    compareMatchPattern,
    MAX_MATCH_CANDIDATE_LENGTH,
    MAX_MATCH_PATTERN_LENGTH,
    type MatchPatternEngine,
    validateMatchPattern,
} from './match-pattern.js';

describe('match pattern validation', () => {
    it('accepts a Unicode-aware linear-time pattern', () => {
        const result = validateMatchPattern('/^\\p{L}+$/u');

        expect(result).toMatchObject({
            ok: true,
            value: { source: '^\\p{L}+$', flags: 'u' },
        });
    });

    it('normalizes supported flags and keeps matching stateless', () => {
        const result = validateMatchPattern('/report/mi');

        expect(result).toMatchObject({ ok: true, value: { source: 'report', flags: 'imu' } });
    });

    it('rejects global and unknown flags', () => {
        expect(validateMatchPattern('/report/g')).toMatchObject({
            ok: false,
            issue: { code: 'invalid-flags' },
        });
        expect(validateMatchPattern('/report/z')).toMatchObject({
            ok: false,
            issue: { code: 'invalid-flags' },
        });
    });

    it('rejects invalid RE2 syntax', () => {
        expect(validateMatchPattern('[a')).toMatchObject({
            ok: false,
            issue: { code: 'invalid-syntax' },
        });
    });

    it('rejects backtracking-only lookahead syntax', () => {
        const result = validateMatchPattern('(?=report)');

        expect(result).toMatchObject({
            ok: false,
            issue: { code: 'unsupported-syntax' },
        });
    });

    it('rejects patterns over the documented source-length limit', () => {
        const result = validateMatchPattern('a'.repeat(MAX_MATCH_PATTERN_LENGTH + 1));

        expect(result).toMatchObject({
            ok: false,
            issue: {
                code: 'pattern-too-long',
                limit: MAX_MATCH_PATTERN_LENGTH,
            },
        });
    });

    it('returns a supported pattern match through the comparison interface', () => {
        expect(compareMatchPattern('^(report|invoice)\\.pdf$', 'invoice.pdf')).toEqual({
            ok: true,
            matched: true,
        });
    });

    it('applies multiline and dotall flags', () => {
        expect(compareMatchPattern('/^report$/m', 'invoice\nreport')).toEqual({
            ok: true,
            matched: true,
        });
        expect(compareMatchPattern('/^a.b$/s', 'a\nb')).toEqual({
            ok: true,
            matched: true,
        });
    });

    it('rejects an over-limit candidate before compiling the pattern', () => {
        let compileCalls = 0;
        const engine: MatchPatternEngine = {
            compile: () => {
                compileCalls += 1;
                return { ok: true, value: { test: () => true } };
            },
        };

        expect(
            compareMatchPattern('a+', 'a'.repeat(MAX_MATCH_CANDIDATE_LENGTH + 1), engine),
        ).toMatchObject({
            ok: false,
            issue: {
                code: 'candidate-too-long',
                limit: MAX_MATCH_CANDIDATE_LENGTH,
            },
        });
        expect(compileCalls).toBe(0);
    });
});
