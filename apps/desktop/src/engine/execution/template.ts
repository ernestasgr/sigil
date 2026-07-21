import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { Option, pipe } from 'effect';

const TEMPLATE_TOKEN = /\{\{\s*(event|payload|vars)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\s*\}\}/g;

export function resolveTemplate(template: string, ctx: WorkflowContext): string {
    return template.replace(TEMPLATE_TOKEN, (match, target: string, field: string | undefined) => {
        if (target === 'event') {
            return field === undefined ? ctx.event : match;
        }
        return pipe(
            Option.fromNullable(field),
            Option.map((f) => (target === 'payload' ? ctx.payload : ctx.vars)[f]),
            Option.flatMap(Option.fromNullable),
            Option.map((val) => (typeof val === 'string' ? val : JSON.stringify(val))),
            Option.getOrElse(() => match),
        );
    });
}
