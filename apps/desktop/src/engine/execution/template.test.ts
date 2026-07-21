import type { WorkflowContext } from '@sigil/schema/workflow-context';
import { describe, expect, it } from 'vitest';

import { resolveTemplate } from './template.js';

const ctx: WorkflowContext = {
    event: 'file.created',
    payload: {
        path: '/Users/dev/Downloads/report.pdf',
        name: 'report.pdf',
        ext: 'pdf',
        size: 2048576,
        dir: '/Users/dev/Downloads',
    },
    vars: { kind: 'invoice' },
};

describe('resolveTemplate', () => {
    it('renders the sample manual-trigger -> log message', () => {
        const rendered = resolveTemplate(
            'Manual trigger fired for {{payload.name}} ({{payload.size}} bytes)',
            ctx,
        );
        expect(rendered).toBe('Manual trigger fired for report.pdf (2048576 bytes)');
    });

    it('renders the event name', () => {
        expect(resolveTemplate('Event: {{event}}', ctx)).toBe('Event: file.created');
    });

    it('renders other payload fields', () => {
        expect(resolveTemplate('{{payload.ext}} in {{payload.dir}}', ctx)).toBe(
            'pdf in /Users/dev/Downloads',
        );
    });

    it('renders vars tokens', () => {
        expect(resolveTemplate('kind={{vars.kind}}', ctx)).toBe('kind=invoice');
    });

    it('leaves unknown tokens untouched', () => {
        expect(resolveTemplate('hello {{payload.missing}} world', ctx)).toBe(
            'hello {{payload.missing}} world',
        );
    });

    it('leaves {{event.field}} untouched (event is a string, not a record)', () => {
        expect(resolveTemplate('hello {{event.name}} world', ctx)).toBe(
            'hello {{event.name}} world',
        );
    });

    it('leaves {{payload}} without a field untouched', () => {
        expect(resolveTemplate('hello {{payload}} world', ctx)).toBe('hello {{payload}} world');
    });
});
