import type { WorkflowContext } from '@sigil/schema/workflow-context';

const TEMPLATE_TOKEN = /\{\{\s*(event|payload|vars)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\s*\}\}/g;

function resolveRecordField(
    record: Readonly<Record<string, unknown>>,
    field: string,
): string | null {
    const value = record[field];
    if (value === undefined || value === null) return null;
    return typeof value === 'string' ? value : JSON.stringify(value);
}

export function resolveTemplate(template: string, ctx: WorkflowContext): string {
    return template.replace(TEMPLATE_TOKEN, (match, target: string, field: string | undefined) => {
        if (target === 'event') {
            return field === undefined ? ctx.event : match;
        }
        if (field === undefined) return match;
        const record = target === 'payload' ? ctx.payload : ctx.vars;
        const resolved = resolveRecordField(record, field);
        return resolved === null ? match : resolved;
    });
}
