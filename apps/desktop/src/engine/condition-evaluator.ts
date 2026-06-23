import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import type { PipelineCondition } from '@sigil/schema/conditions';
import type { BooleanOperator, NumberOperator, StringOperator } from '@sigil/schema/operators';
import type { SwitchConfig } from '@sigil/schema/node-configs';
import type { WorkflowContext } from '@sigil/schema/workflow-context';

import { assertNever } from '../shared/assert-never.js';

export type ComparisonContext = 'string' | 'number' | 'boolean';
export type CoercionError = 'coercion_failed';

export function coerceForComparison(
    raw: unknown,
    context: 'string',
):
    | { readonly ok: true; readonly value: string }
    | { readonly ok: false; readonly error: CoercionError };
export function coerceForComparison(
    raw: unknown,
    context: 'number',
):
    | { readonly ok: true; readonly value: number }
    | { readonly ok: false; readonly error: CoercionError };
export function coerceForComparison(
    raw: unknown,
    context: 'boolean',
):
    | { readonly ok: true; readonly value: boolean }
    | { readonly ok: false; readonly error: CoercionError };
export function coerceForComparison(
    raw: unknown,
    context: ComparisonContext,
):
    | { readonly ok: true; readonly value: string | number | boolean }
    | { readonly ok: false; readonly error: CoercionError } {
    switch (context) {
        case 'string':
            return { ok: true, value: String(raw) };
        case 'number': {
            const n = Number(raw);
            if (Number.isNaN(n)) return { ok: false, error: 'coercion_failed' };
            return { ok: true, value: n };
        }
        case 'boolean': {
            if (typeof raw === 'boolean') return { ok: true, value: raw };
            if (typeof raw === 'string') {
                const lower = raw.toLowerCase();
                if (lower === 'true') return { ok: true, value: true };
                if (lower === 'false') return { ok: true, value: false };
            }
            return { ok: false, error: 'coercion_failed' };
        }
        default:
            return assertNever(context);
    }
}

function parseRegexLiteral(value: string): { readonly pattern: string; readonly flags: string } {
    const match = /^\/(.+)\/([gimsuy]*)$/.exec(value);
    if (match) {
        return { pattern: match[1], flags: match[2] };
    }
    return { pattern: value, flags: '' };
}

function compareString(operator: StringOperator, left: string, right: string): boolean {
    switch (operator) {
        case 'equals':
            return left.toLowerCase() === right.toLowerCase();
        case 'not_equals':
            return left.toLowerCase() !== right.toLowerCase();
        case 'contains':
            return left.toLowerCase().includes(right.toLowerCase());
        case 'not_contains':
            return !left.toLowerCase().includes(right.toLowerCase());
        case 'starts_with':
            return left.toLowerCase().startsWith(right.toLowerCase());
        case 'ends_with':
            return left.toLowerCase().endsWith(right.toLowerCase());
        case 'matches': {
            const { pattern, flags } = parseRegexLiteral(right);
            return new RegExp(pattern, flags).test(left);
        }
        default:
            return assertNever(operator);
    }
}

function compareNumber(operator: NumberOperator, left: number, right: number): boolean {
    switch (operator) {
        case 'equals':
            return left === right;
        case 'not_equals':
            return left !== right;
        case 'gt':
            return left > right;
        case 'lt':
            return left < right;
        case 'gte':
            return left >= right;
        case 'lte':
            return left <= right;
        default:
            return assertNever(operator);
    }
}

function compareBoolean(operator: BooleanOperator, left: boolean, right: boolean): boolean {
    switch (operator) {
        case 'equals':
            return left === right;
        case 'not_equals':
            return left !== right;
        default:
            return assertNever(operator);
    }
}

function compareWithCondition(raw: unknown, condition: PipelineCondition): boolean {
    if (raw === undefined || raw === null) return false;

    if (typeof condition.value === 'string') {
        const field = coerceForComparison(raw, 'string');
        const value = coerceForComparison(condition.value, 'string');
        if (!field.ok || !value.ok) return false;
        return compareString(condition.operator, field.value, value.value);
    }
    if (typeof condition.value === 'number') {
        const field = coerceForComparison(raw, 'number');
        const value = coerceForComparison(condition.value, 'number');
        if (!field.ok || !value.ok) return false;
        return compareNumber(condition.operator, field.value, value.value);
    }
    const field = coerceForComparison(raw, 'boolean');
    const value = coerceForComparison(condition.value, 'boolean');
    if (!field.ok || !value.ok) return false;
    return compareBoolean(condition.operator, field.value, value.value);
}

export function evaluateCondition(condition: PipelineCondition, ctx: WorkflowContext): boolean {
    switch (condition.target) {
        case 'event':
            return compareWithCondition(ctx.event[condition.field], condition);
        case 'vars':
            return compareWithCondition(ctx.vars[condition.field], condition);
        default:
            return assertNever(condition);
    }
}

function readEventField(event: FileEventPayload, field: string): unknown {
    switch (field) {
        case 'path':
            return event.path;
        case 'name':
            return event.name;
        case 'ext':
            return event.ext;
        case 'dir':
            return event.dir;
        case 'size':
            return event.size;
        default:
            return undefined;
    }
}

function matchStringCase(cases: readonly string[], raw: unknown): string {
    if (raw === undefined || raw === null) return 'default';
    const fieldStr = String(raw).toLowerCase();
    for (const caseValue of cases) {
        if (caseValue.toLowerCase() === fieldStr) return caseValue;
    }
    return 'default';
}

export function matchSwitchCase(config: SwitchConfig, ctx: WorkflowContext): string {
    switch (config.target) {
        case 'event': {
            if (config.field === 'size') {
                const sizeNum = ctx.event.size;
                for (const caseValue of config.cases) {
                    const caseNum = Number(caseValue);
                    if (!Number.isNaN(caseNum) && caseNum === sizeNum) return caseValue;
                }
                return 'default';
            }
            return matchStringCase(config.cases, readEventField(ctx.event, config.field));
        }
        case 'vars':
            return matchStringCase(config.cases, ctx.vars[config.field]);
        default:
            return assertNever(config.target);
    }
}
