import type { StateSetValueType } from '@sigil/schema/nodes';
import { Either } from 'effect';

import type { WorkflowStatePrimitive } from '../../shared/ipc-channels.js';

export type WorkflowStateValueParseResult = Either.Either<
    WorkflowStatePrimitive,
    { readonly message: string }
>;

function invalidValue(valueType: StateSetValueType, value: string): WorkflowStateValueParseResult {
    if (valueType === 'number') {
        return Either.left({
            message: `State Set value must be a finite number; received "${value}".`,
        });
    }

    return Either.left({
        message: `State Set value must be true or false; received "${value}".`,
    });
}

function assertNever(value: never): never {
    throw new Error(`Unhandled State Set value type: ${JSON.stringify(value)}`);
}

export function parseWorkflowStateValue(
    value: string,
    valueType: StateSetValueType | undefined,
): WorkflowStateValueParseResult {
    const resolvedType = valueType ?? 'string';
    switch (resolvedType) {
        case 'string':
            return Either.right(value);
        case 'number': {
            if (value.trim() === '') return invalidValue('number', value);
            const parsed = Number(value);
            return Number.isFinite(parsed) ? Either.right(parsed) : invalidValue('number', value);
        }
        case 'boolean': {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') return Either.right(true);
            if (normalized === 'false') return Either.right(false);
            return invalidValue('boolean', value);
        }
        default:
            return assertNever(resolvedType);
    }
}
