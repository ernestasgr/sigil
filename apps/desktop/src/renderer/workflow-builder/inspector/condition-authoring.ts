import type { PipelineCondition } from '@sigil/schema/conditions';
import { type EventCatalog, findEventField } from '@sigil/schema/event-catalog';

export type FieldCondition = Extract<PipelineCondition, { target: 'payload' | 'vars' }>;

export function updateFieldCondition(
    condition: FieldCondition,
    field: string,
    catalog: EventCatalog,
): FieldCondition {
    if (condition.target !== 'payload') return { ...condition, field };

    const metadata = findEventField(catalog, field);
    if (!metadata) return { ...condition, field };

    if (metadata.kind === 'number') {
        return typeof condition.value === 'number'
            ? { ...condition, field }
            : { target: condition.target, field, operator: 'equals', value: 0 };
    }
    if (metadata.kind === 'boolean') {
        return typeof condition.value === 'boolean'
            ? { ...condition, field }
            : { target: condition.target, field, operator: 'equals', value: false };
    }
    return typeof condition.value === 'string'
        ? { ...condition, field }
        : { target: condition.target, field, operator: 'equals', value: '' };
}
