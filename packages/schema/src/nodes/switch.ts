import { z } from 'zod';

import { NodeOutputPortIdSchema, SwitchCaseIdSchema } from '../ids.js';

export type { SwitchCaseId } from '../ids.js';
export { SwitchCaseIdSchema } from '../ids.js';

import {
    type DeclarativeOutputPortResolution,
    fixedOutputPort,
    type NodeContractIssue,
    type NodeOutputPortInput,
    type NodeOutputPortSpec,
    type OutputPortStrategy,
} from '../node-contract.js';
import { defineBuiltinNode } from './types.js';

export const SWITCH_DEFAULT_PORT = 'default' as const;

export const SwitchCaseSchema = z
    .object({
        /** Structural identity used by Edges and React Flow handles. */
        id: SwitchCaseIdSchema,
        /** User-editable value used by the executor when matching a Context. */
        value: z.string(),
    })
    .strict()
    .readonly();

export type SwitchCase = z.infer<typeof SwitchCaseSchema>;

const SwitchCasesSchema = z.array(SwitchCaseSchema).readonly();

const EventNameSwitchSchema = z
    .object({
        target: z.literal('event'),
        cases: SwitchCasesSchema,
    })
    .strict()
    .readonly();

const FieldSwitchSchema = z
    .object({
        target: z.enum(['payload', 'vars']),
        field: z.string().min(1),
        cases: SwitchCasesSchema,
    })
    .strict()
    .readonly();

const SwitchConfigShapeSchema = z.union([EventNameSwitchSchema, FieldSwitchSchema]);

/**
 * Values are intentionally not constrained here. The Builder must be able to
 * hold an empty/intermediate value while the author is typing; topology
 * validation reports whether the current draft is saveable.
 */
export const SwitchConfigSchema = SwitchConfigShapeSchema;

export type SwitchConfig = z.infer<typeof SwitchConfigSchema>;

export const SWITCH_DIAGNOSTIC_CODES = [
    'duplicate_match_value',
    'empty_match_value',
    'reserved_match_value',
    'invalid_match_value',
    'duplicate_case_id',
    'reserved_case_id',
] as const;

export type SwitchDiagnosticCode = (typeof SWITCH_DIAGNOSTIC_CODES)[number];

export interface SwitchDiagnostic {
    readonly code: SwitchDiagnosticCode;
    readonly caseId: string;
    readonly caseIndex: number;
    readonly value: string;
    readonly message: string;
    readonly repairHint: string;
}

function diagnostic(
    code: SwitchDiagnosticCode,
    switchCase: SwitchCase,
    caseIndex: number,
    message: string,
    repairHint: string,
): SwitchDiagnostic {
    return {
        code,
        caseId: switchCase.id,
        caseIndex,
        value: switchCase.value,
        message,
        repairHint,
    };
}

function containsControlCharacter(value: string): boolean {
    return [...value].some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    });
}

/** Validate the editor-facing Switch invariants without changing the draft. */
export function validateSwitchConfig(config: SwitchConfig): readonly SwitchDiagnostic[] {
    const diagnostics: SwitchDiagnostic[] = [];
    const ids = new Map<string, number[]>();
    const values = new Map<string, number[]>();

    config.cases.forEach((switchCase, caseIndex) => {
        const idIndexes = ids.get(switchCase.id) ?? [];
        ids.set(switchCase.id, [...idIndexes, caseIndex]);

        const trimmedValue = switchCase.value.trim();
        if (switchCase.id === SWITCH_DEFAULT_PORT) {
            diagnostics.push(
                diagnostic(
                    'reserved_case_id',
                    switchCase,
                    caseIndex,
                    `Switch case ${switchCase.id} uses the reserved output-port identity "${SWITCH_DEFAULT_PORT}".`,
                    'Keep "default" for the fallback output and use a different case identity.',
                ),
            );
        }

        if (trimmedValue.length === 0) {
            diagnostics.push(
                diagnostic(
                    'empty_match_value',
                    switchCase,
                    caseIndex,
                    `Switch case ${switchCase.id} has an empty match value.`,
                    'Enter a non-empty match value or remove this case.',
                ),
            );
        } else if (trimmedValue.toLowerCase() === SWITCH_DEFAULT_PORT) {
            diagnostics.push(
                diagnostic(
                    'reserved_match_value',
                    switchCase,
                    caseIndex,
                    `Switch case ${switchCase.id} uses the reserved match value "${SWITCH_DEFAULT_PORT}".`,
                    'Choose another match value; "default" is reserved for the fallback output.',
                ),
            );
        }

        if (trimmedValue.length > 0 && containsControlCharacter(switchCase.value)) {
            diagnostics.push(
                diagnostic(
                    'invalid_match_value',
                    switchCase,
                    caseIndex,
                    `Switch case ${switchCase.id} contains control characters in its match value.`,
                    'Use printable text for the match value.',
                ),
            );
        }

        if (
            trimmedValue.length > 0 &&
            trimmedValue.toLowerCase() !== SWITCH_DEFAULT_PORT &&
            !containsControlCharacter(switchCase.value)
        ) {
            const valueIndexes = values.get(switchCase.value.toLowerCase()) ?? [];
            values.set(switchCase.value.toLowerCase(), [...valueIndexes, caseIndex]);
        }
    });

    for (const indexes of ids.values()) {
        if (indexes.length < 2) continue;
        for (const caseIndex of indexes) {
            const switchCase = config.cases[caseIndex];
            if (!switchCase) continue;
            diagnostics.push(
                diagnostic(
                    'duplicate_case_id',
                    switchCase,
                    caseIndex,
                    `Switch case identity "${switchCase.id}" is used more than once.`,
                    'Give every Switch case a unique identity so connected Edges have one stable port.',
                ),
            );
        }
    }

    for (const indexes of values.values()) {
        if (indexes.length < 2) continue;
        const firstCase = config.cases[indexes[0] ?? -1];
        if (!firstCase) continue;
        for (const caseIndex of indexes) {
            const switchCase = config.cases[caseIndex];
            if (!switchCase) continue;
            diagnostics.push(
                diagnostic(
                    'duplicate_match_value',
                    switchCase,
                    caseIndex,
                    `Switch case ${switchCase.id} duplicates the match value "${firstCase.value}".`,
                    'Give each Switch case a unique match value or remove the duplicate case.',
                ),
            );
        }
    }

    return diagnostics;
}

export function switchOutputPortSpec(
    defaultPort: NodeOutputPortInput = fixedOutputPort(SWITCH_DEFAULT_PORT),
): Extract<NodeOutputPortSpec, { readonly kind: 'config-derived' }> {
    return {
        kind: 'config-derived',
        strategy: 'switch-cases',
        defaultPort: fixedOutputPort(defaultPort.id, defaultPort.label),
    };
}

function switchConfigIssues(config: SwitchConfig): readonly NodeContractIssue[] {
    return validateSwitchConfig(config).map((diagnostic) => ({
        code: 'invalid_configuration',
        diagnosticCode: diagnostic.code,
        caseId: diagnostic.caseId,
        path:
            diagnostic.code === 'duplicate_case_id' || diagnostic.code === 'reserved_case_id'
                ? `cases[${diagnostic.caseIndex}].id`
                : `cases[${diagnostic.caseIndex}].value`,
        message: diagnostic.message,
        repairHint: diagnostic.repairHint,
    }));
}

function reservedDefaultPortIssues(
    spec: Extract<Parameters<OutputPortStrategy>[0], { readonly kind: 'config-derived' }>,
    config: SwitchConfig,
): readonly NodeContractIssue[] {
    if (spec.defaultPort.id === SWITCH_DEFAULT_PORT) return [];

    return config.cases.flatMap((switchCase, caseIndex) =>
        switchCase.id === spec.defaultPort.id
            ? [
                  {
                      code: 'invalid_configuration' as const,
                      diagnosticCode: 'reserved_case_id',
                      caseId: switchCase.id,
                      path: `cases[${caseIndex}].id`,
                      message:
                          `Switch case identity "${switchCase.id}" is reserved for the ` +
                          'default output port.',
                      repairHint:
                          'Use a different case identity so the fallback output remains stable.',
                  },
              ]
            : [],
    );
}

export const switchOutputPortStrategy: OutputPortStrategy = (spec, config) => {
    const parsed = SwitchConfigSchema.safeParse(config);
    if (!parsed.success) {
        return {
            ok: false,
            issues: parsed.error.issues.map((issue) => ({
                code: 'invalid_configuration' as const,
                path: issue.path.map(String).join('.'),
                message: issue.message,
            })),
        };
    }

    const issues = [
        ...switchConfigIssues(parsed.data),
        ...reservedDefaultPortIssues(spec, parsed.data),
    ];
    const outputPorts = [
        fixedOutputPort(spec.defaultPort.id, spec.defaultPort.label),
        ...parsed.data.cases.map((switchCase) => ({
            id: NodeOutputPortIdSchema.parse(switchCase.id),
            label: switchCase.value || '(empty)',
        })),
    ];
    if (issues.length > 0) {
        const hasUnresolvableIdentity = issues.some((issue) => issue.path.endsWith('.id'));
        return {
            ok: false,
            issues,
            ...(hasUnresolvableIdentity ? {} : { outputPorts }),
        };
    }

    return { ok: true, value: outputPorts };
};

function resolveBuiltinSwitchOutputPorts(config: SwitchConfig): DeclarativeOutputPortResolution {
    return switchOutputPortStrategy(switchOutputPortSpec(), config);
}

export const SwitchNode = defineBuiltinNode({
    type: 'switch',
    configSchema: SwitchConfigSchema,
    defaultConfig: SwitchConfigSchema.parse({
        target: 'event',
        cases: [{ id: 'case-1', value: 'file.created' }],
    }),
    contract: {
        identity: { namespace: 'builtin', type: 'switch' },
        version: 1,
        role: 'action',
        outputPorts: switchOutputPortSpec(),
        display: {
            label: 'Switch',
            description:
                'Routes the flow to one of several cases (plus default) by event name or field value.',
            category: 'logic',
        },
    },
    resolveOutputPorts: resolveBuiltinSwitchOutputPorts,
});

export const SwitchDescriptor = SwitchNode.descriptor;
export const SwitchContractRegistration = SwitchNode.registration;
