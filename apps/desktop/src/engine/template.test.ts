import { describe, expect, it } from 'vitest';

import type { WorkflowContext } from '@sigil/schema/workflow-context';

import { resolveTemplate } from './template.js';

const ctx: WorkflowContext = {
    event: {
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
            'Manual trigger fired for {{event.name}} ({{event.size}} bytes)',
            ctx,
        );
        expect(rendered).toBe('Manual trigger fired for report.pdf (2048576 bytes)');
    });

    it('renders other event fields', () => {
        expect(resolveTemplate('{{event.ext}} in {{event.dir}}', ctx)).toBe(
            'pdf in /Users/dev/Downloads',
        );
    });

    it('renders vars tokens', () => {
        expect(resolveTemplate('kind={{vars.kind}}', ctx)).toBe('kind=invoice');
    });

    it('leaves unknown tokens untouched', () => {
        expect(resolveTemplate('hello {{event.missing}} world', ctx)).toBe(
            'hello {{event.missing}} world',
        );
    });
});
