import { describe, expect, it } from 'vitest';

import type { PipelineCondition } from '@sigil/schema/conditions';
import type { SwitchConfig } from '@sigil/schema/node-configs';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

import { coerceForComparison, evaluateCondition, matchSwitchCase } from './condition-evaluator.js';

const ctx: WorkflowContext = {
    event: 'file.created',
    payload: {
        path: '/Users/dev/Downloads/Report.PDF',
        name: 'Report.PDF',
        ext: 'PDF',
        size: 2048576,
        dir: '/Users/dev/Downloads',
    },
    vars: { kind: 'invoice', count: 5, flagged: 'true', empty: '' },
};

describe('coerceForComparison', () => {
    it('coerces a numeric string to a number', () => {
        expect(coerceForComparison('5', 'number')).toEqual({ ok: true, value: 5 });
    });

    it('fails coercion for a non-numeric string in number context', () => {
        expect(coerceForComparison('abc', 'number')).toEqual({
            ok: false,
            error: 'coercion_failed',
        });
    });

    it('coerces the string "true" case-insensitively to boolean true', () => {
        expect(coerceForComparison('TRUE', 'boolean')).toEqual({ ok: true, value: true });
    });

    it('fails boolean coercion for a non-boolean string', () => {
        expect(coerceForComparison('yes', 'boolean')).toEqual({
            ok: false,
            error: 'coercion_failed',
        });
    });

    it('passes a real boolean through in boolean context', () => {
        expect(coerceForComparison(false, 'boolean')).toEqual({ ok: true, value: false });
    });

    it('coerces any value to a string in string context', () => {
        expect(coerceForComparison(42, 'string')).toEqual({ ok: true, value: '42' });
    });
});

describe('evaluateCondition — payload string context', () => {
    it('equals is case-insensitive', () => {
        const condition: PipelineCondition = {
            target: 'payload',
            field: 'ext',
            operator: 'equals',
            value: 'pdf',
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('not_equals is case-insensitive', () => {
        const condition: PipelineCondition = {
            target: 'payload',
            field: 'ext',
            operator: 'not_equals',
            value: 'png',
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('contains matches a substring case-insensitively', () => {
        const condition: PipelineCondition = {
            target: 'payload',
            field: 'name',
            operator: 'contains',
            value: 'PORT',
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('starts_with matches a prefix case-insensitively', () => {
        const condition: PipelineCondition = {
            target: 'payload',
            field: 'name',
            operator: 'starts_with',
            value: 'report',
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('ends_with matches a suffix case-insensitively', () => {
        const condition: PipelineCondition = {
            target: 'payload',
            field: 'name',
            operator: 'ends_with',
            value: '.pdf',
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('matches uses regex flags for case sensitivity', () => {
        const caseInsensitive: PipelineCondition = {
            target: 'payload',
            field: 'name',
            operator: 'matches',
            value: '/report/i',
        };
        expect(evaluateCondition(caseInsensitive, ctx)).toBe(true);

        const caseSensitive: PipelineCondition = {
            target: 'payload',
            field: 'name',
            operator: 'matches',
            value: 'report',
        };
        expect(evaluateCondition(caseSensitive, ctx)).toBe(false);
    });
});

describe('evaluateCondition — payload numeric context', () => {
    it('gt compares size as a number', () => {
        const condition: PipelineCondition = {
            target: 'payload',
            field: 'size',
            operator: 'gt',
            value: 1000000,
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('equals matches the exact byte count', () => {
        const condition: PipelineCondition = {
            target: 'payload',
            field: 'size',
            operator: 'equals',
            value: 2048576,
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('lt returns false when size is larger', () => {
        const condition: PipelineCondition = {
            target: 'payload',
            field: 'size',
            operator: 'lt',
            value: 1000,
        };
        expect(evaluateCondition(condition, ctx)).toBe(false);
    });
});

describe('evaluateCondition — vars contexts', () => {
    it('string context compares vars strings case-insensitively', () => {
        const condition: PipelineCondition = {
            target: 'vars',
            field: 'kind',
            operator: 'equals',
            value: 'INVOICE',
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('number context coerces a numeric vars value', () => {
        const condition: PipelineCondition = {
            target: 'vars',
            field: 'count',
            operator: 'equals',
            value: 5,
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('number context coerces a stringified numeric vars value', () => {
        const withStringVars: WorkflowContext = { ...ctx, vars: { ...ctx.vars, count: '5' } };
        const condition: PipelineCondition = {
            target: 'vars',
            field: 'count',
            operator: 'equals',
            value: 5,
        };
        expect(evaluateCondition(condition, withStringVars)).toBe(true);
    });

    it('number context treats a non-numeric vars value as a non-match', () => {
        const withBadVars: WorkflowContext = { ...ctx, vars: { ...ctx.vars, count: 'abc' } };
        const condition: PipelineCondition = {
            target: 'vars',
            field: 'count',
            operator: 'equals',
            value: 5,
        };
        expect(evaluateCondition(condition, withBadVars)).toBe(false);
    });

    it('boolean context parses the string "true" case-insensitively', () => {
        const condition: PipelineCondition = {
            target: 'vars',
            field: 'flagged',
            operator: 'equals',
            value: true,
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('boolean context treats a non-boolean string as a non-match', () => {
        const withBadVars: WorkflowContext = { ...ctx, vars: { ...ctx.vars, flagged: 'yes' } };
        const condition: PipelineCondition = {
            target: 'vars',
            field: 'flagged',
            operator: 'equals',
            value: true,
        };
        expect(evaluateCondition(condition, withBadVars)).toBe(false);
    });

    it('routes a missing vars field to false (non-match)', () => {
        const condition: PipelineCondition = {
            target: 'vars',
            field: 'does_not_exist',
            operator: 'equals',
            value: 'x',
        };
        expect(evaluateCondition(condition, ctx)).toBe(false);
    });

    it('routes a null vars field to false (non-match)', () => {
        const withNull: WorkflowContext = { ...ctx, vars: { ...ctx.vars, kind: null } };
        const condition: PipelineCondition = {
            target: 'vars',
            field: 'kind',
            operator: 'equals',
            value: 'null',
        };
        expect(evaluateCondition(condition, withNull)).toBe(false);
    });
});

describe('evaluateCondition — event name context', () => {
    it('equals matches the event name case-insensitively', () => {
        const condition: PipelineCondition = {
            target: 'event',
            operator: 'equals',
            value: 'FILE.CREATED',
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('starts_with matches an event name prefix', () => {
        const condition: PipelineCondition = {
            target: 'event',
            operator: 'starts_with',
            value: 'file.',
        };
        expect(evaluateCondition(condition, ctx)).toBe(true);
    });

    it('returns false for a non-matching event name', () => {
        const condition: PipelineCondition = {
            target: 'event',
            operator: 'equals',
            value: 'file.deleted',
        };
        expect(evaluateCondition(condition, ctx)).toBe(false);
    });
});

describe('matchSwitchCase', () => {
    it('routes to the matching case port on a payload string field', () => {
        const config: SwitchConfig = { target: 'payload', field: 'ext', cases: ['pdf', 'png'] };
        expect(matchSwitchCase(config, ctx)).toBe('pdf');
    });

    it('falls back to default when no case matches', () => {
        const config: SwitchConfig = { target: 'payload', field: 'ext', cases: ['jpg', 'png'] };
        expect(matchSwitchCase(config, ctx)).toBe('default');
    });

    it('matches payload string fields case-insensitively', () => {
        const config: SwitchConfig = { target: 'payload', field: 'ext', cases: ['pdf'] };
        expect(matchSwitchCase(config, ctx)).toBe('pdf');
    });

    it('routes to default on an unknown payload field', () => {
        const config: SwitchConfig = { target: 'payload', field: 'bogus', cases: ['x'] };
        expect(matchSwitchCase(config, ctx)).toBe('default');
    });

    it('uses numeric context for payload.size', () => {
        const config: SwitchConfig = {
            target: 'payload',
            field: 'size',
            cases: ['1024', '2048576'],
        };
        expect(matchSwitchCase(config, ctx)).toBe('2048576');
    });

    it('falls back to default when a size case is non-numeric', () => {
        const config: SwitchConfig = { target: 'payload', field: 'size', cases: ['large'] };
        expect(matchSwitchCase(config, ctx)).toBe('default');
    });

    it('matches a numeric vars value via numeric comparison', () => {
        const config: SwitchConfig = { target: 'vars', field: 'count', cases: ['5', '10'] };
        expect(matchSwitchCase(config, ctx)).toBe('5');
    });

    it('matches vars strings case-insensitively', () => {
        const config: SwitchConfig = { target: 'vars', field: 'kind', cases: ['Invoice'] };
        expect(matchSwitchCase(config, ctx)).toBe('Invoice');
    });

    it('routes a missing vars field to default', () => {
        const config: SwitchConfig = { target: 'vars', field: 'missing', cases: ['x'] };
        expect(matchSwitchCase(config, ctx)).toBe('default');
    });

    it('routes a null vars field to default', () => {
        const withNull: WorkflowContext = { ...ctx, vars: { ...ctx.vars, kind: null } };
        const config: SwitchConfig = { target: 'vars', field: 'kind', cases: ['null'] };
        expect(matchSwitchCase(config, withNull)).toBe('default');
    });

    it('routes to the matching case on the event name', () => {
        const config: SwitchConfig = { target: 'event', cases: ['file.created', 'file.deleted'] };
        expect(matchSwitchCase(config, ctx)).toBe('file.created');
    });

    it('falls back to default when no event name case matches', () => {
        const config: SwitchConfig = { target: 'event', cases: ['file.modified'] };
        expect(matchSwitchCase(config, ctx)).toBe('default');
    });
});
