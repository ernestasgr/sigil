import type { WorkflowContext } from '@sigil/schema/workflow-context';

const TEMPLATE_TOKEN = /\{\{\s*(event|vars)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function resolveEventField(event: WorkflowContext['event'], field: string): string | null {
    switch (field) {
        case 'path':
            return event.path;
        case 'name':
            return event.name;
        case 'ext':
            return event.ext;
        case 'size':
            return String(event.size);
        case 'dir':
            return event.dir;
        default:
            return null;
    }
}

function resolveVar(vars: WorkflowContext['vars'], field: string): string | null {
    const value = vars[field];
    if (value === undefined || value === null) {
        return null;
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
}

export function resolveTemplate(template: string, ctx: WorkflowContext): string {
    return template.replace(TEMPLATE_TOKEN, (match, target: string, field: string) => {
        const resolved =
            target === 'event' ? resolveEventField(ctx.event, field) : resolveVar(ctx.vars, field);
        return resolved === null ? match : resolved;
    });
}
