import type { PipelineCondition } from '@sigil/schema/conditions';
import type { BooleanOperator, NumberOperator, StringOperator } from '@sigil/schema/operators';
import type { SwitchConfig } from '@sigil/schema/nodes/switch';
import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Either, Match } from 'effect';

export type ComparisonContext = 'string' | 'number' | 'boolean';
export type CoercionError = 'coercion_failed';

const COERCION_FAILED: CoercionError = 'coercion_failed';

export function coerceForComparison(
    raw: unknown,
    context: 'string',
): Either.Either<string, CoercionError>;
export function coerceForComparison(
    raw: unknown,
    context: 'number',
): Either.Either<number, CoercionError>;
export function coerceForComparison(
    raw: unknown,
    context: 'boolean',
): Either.Either<boolean, CoercionError>;
export function coerceForComparison(
    raw: unknown,
    context: ComparisonContext,
): Either.Either<string | number | boolean, CoercionError> {
    return Match.value(context).pipe(
        Match.when('string', () => Either.right(String(raw))),
        Match.when('number', () => {
            const n = Number(raw);
            if (Number.isNaN(n)) return Either.left(COERCION_FAILED);
            return Either.right(n);
        }),
        Match.when('boolean', () => {
            if (typeof raw === 'boolean') return Either.right(raw);
            if (typeof raw === 'string') {
                const lower = raw.toLowerCase();
                if (lower === 'true') return Either.right(true);
                if (lower === 'false') return Either.right(false);
            }
            return Either.left(COERCION_FAILED);
        }),
        Match.exhaustive,
    );
}

function parseRegexLiteral(value: string): { readonly pattern: string; readonly flags: string } {
    const match = /^\/(.+)\/([gimsuy]*)$/.exec(value);
    if (match) {
        return { pattern: match[1], flags: match[2] };
    }
    return { pattern: value, flags: '' };
}

function compareString(operator: StringOperator, left: string, right: string): boolean {
    return Match.value(operator).pipe(
        Match.when('equals', () => left.toLowerCase() === right.toLowerCase()),
        Match.when('not_equals', () => left.toLowerCase() !== right.toLowerCase()),
        Match.when('contains', () => left.toLowerCase().includes(right.toLowerCase())),
        Match.when('not_contains', () => !left.toLowerCase().includes(right.toLowerCase())),
        Match.when('starts_with', () => left.toLowerCase().startsWith(right.toLowerCase())),
        Match.when('ends_with', () => left.toLowerCase().endsWith(right.toLowerCase())),
        Match.when('matches', () => {
            const { pattern, flags } = parseRegexLiteral(right);
            try {
                return new RegExp(pattern, flags).test(left);
            } catch {
                return false;
            }
        }),
        Match.exhaustive,
    );
}

function compareNumber(operator: NumberOperator, left: number, right: number): boolean {
    return Match.value(operator).pipe(
        Match.when('equals', () => left === right),
        Match.when('not_equals', () => left !== right),
        Match.when('gt', () => left > right),
        Match.when('lt', () => left < right),
        Match.when('gte', () => left >= right),
        Match.when('lte', () => left <= right),
        Match.exhaustive,
    );
}

function compareBoolean(operator: BooleanOperator, left: boolean, right: boolean): boolean {
    return Match.value(operator).pipe(
        Match.when('equals', () => left === right),
        Match.when('not_equals', () => left !== right),
        Match.exhaustive,
    );
}

type StringCondition = Extract<PipelineCondition, { value: string }>;
type NumberCondition = Extract<PipelineCondition, { value: number }>;
type BooleanCondition = Extract<PipelineCondition, { value: boolean }>;

function compareStringCondition(raw: unknown, condition: StringCondition): boolean {
    const left = coerceForComparison(raw, 'string');
    if (Either.isLeft(left)) return false;

    const right = coerceForComparison(condition.value, 'string');
    if (Either.isLeft(right)) return false;

    return compareString(condition.operator, left.right, right.right);
}

function compareNumberCondition(raw: unknown, condition: NumberCondition): boolean {
    const left = coerceForComparison(raw, 'number');
    if (Either.isLeft(left)) return false;

    const right = coerceForComparison(condition.value, 'number');
    if (Either.isLeft(right)) return false;

    return compareNumber(condition.operator, left.right, right.right);
}

function compareBooleanCondition(raw: unknown, condition: BooleanCondition): boolean {
    const left = coerceForComparison(raw, 'boolean');
    if (Either.isLeft(left)) return false;

    const right = coerceForComparison(condition.value, 'boolean');
    if (Either.isLeft(right)) return false;

    return compareBoolean(condition.operator, left.right, right.right);
}

function compareWithCondition(raw: unknown, condition: PipelineCondition): boolean {
    if (raw === undefined || raw === null) return false;

    if (typeof condition.value === 'string') {
        return compareStringCondition(raw, condition);
    }
    if (typeof condition.value === 'number') {
        return compareNumberCondition(raw, condition);
    }
    return compareBooleanCondition(raw, condition);
}

export function evaluateCondition(condition: PipelineCondition, ctx: WorkflowContext): boolean {
    return Match.value(condition).pipe(
        Match.when({ target: 'event' }, (c) => compareWithCondition(ctx.event, c)),
        Match.when({ target: 'payload' }, (c) => compareWithCondition(ctx.payload[c.field], c)),
        Match.when({ target: 'vars' }, (c) => compareWithCondition(ctx.vars[c.field], c)),
        Match.exhaustive,
    );
}

function matchStringCase(cases: readonly string[], raw: unknown): string {
    if (raw === undefined || raw === null) return 'default';
    const fieldStr = String(raw).toLowerCase();
    return cases.find((c) => c.toLowerCase() === fieldStr) ?? 'default';
}

function matchNumberCase(cases: readonly string[], raw: number): string {
    return (
        cases.find((c) => {
            const caseNum = Number(c);
            return !Number.isNaN(caseNum) && caseNum === raw;
        }) ?? 'default'
    );
}

function matchFieldCase(cases: readonly string[], raw: unknown): string {
    if (typeof raw === 'number') return matchNumberCase(cases, raw);
    return matchStringCase(cases, raw);
}

export function matchSwitchCase(config: SwitchConfig, ctx: WorkflowContext): string {
    return Match.value(config).pipe(
        Match.when({ target: 'event' }, (c) => matchStringCase(c.cases, ctx.event)),
        Match.when({ target: 'payload' }, (c) => matchFieldCase(c.cases, ctx.payload[c.field])),
        Match.when({ target: 'vars' }, (c) => matchFieldCase(c.cases, ctx.vars[c.field])),
        Match.exhaustive,
    );
}
