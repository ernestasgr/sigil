import { z } from 'zod';

import { defineNode } from './types.js';

export const SWITCH_DEFAULT_PORT = 'default' as const;

export const SwitchCaseSchema = z
    .object({
        /** Structural identity used by Edges and React Flow handles. */
        id: z.string().min(1),
        /** User-editable value used by the executor when matching a Context. */
        value: z.string(),
    })
    .readonly();

export type SwitchCase = z.infer<typeof SwitchCaseSchema>;

const SwitchCasesSchema = z.array(SwitchCaseSchema).readonly();

const EventNameSwitchSchema = z.object({
    target: z.literal('event'),
    cases: SwitchCasesSchema,
});

const FieldSwitchSchema = z.object({
    target: z.enum(['payload', 'vars']),
    field: z.string().min(1),
    cases: SwitchCasesSchema,
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function legacyCaseId(value: string, index: number): string {
    // Legacy Edges used the match value as their sourcePort. Reusing a valid
    // value as the migrated identity keeps those Edges connected after load.
    if (value.length > 0 && value !== SWITCH_DEFAULT_PORT) return value;
    return `legacy-case-${index + 1}`;
}

function normalizeLegacySwitchCases(input: unknown): unknown {
    if (!isRecord(input) || !isStringArray(input.cases)) return input;

    return {
        ...input,
        cases: input.cases.map((value, index) => ({
            id: legacyCaseId(value, index),
            value,
        })),
    };
}

const SwitchConfigShapeSchema = z.union([EventNameSwitchSchema, FieldSwitchSchema]);

/**
 * Values are intentionally not constrained here. The Builder must be able to
 * hold an empty/intermediate value while the author is typing; topology
 * validation reports whether the current draft is saveable.
 */
export const SwitchConfigSchema = z.preprocess(normalizeLegacySwitchCases, SwitchConfigShapeSchema);

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

export function switchPortLabel(config: SwitchConfig, port: string): string {
    if (port === SWITCH_DEFAULT_PORT) return SWITCH_DEFAULT_PORT;
    return config.cases.find((switchCase) => switchCase.id === port)?.value || '(empty)';
}

export const SwitchDescriptor = defineNode({
    type: 'switch',
    configSchema: SwitchConfigSchema,
    defaultConfig: {
        target: 'event',
        cases: [{ id: 'case-1', value: 'file.created' }],
    },
    getOutputPorts: (config) => {
        return [SWITCH_DEFAULT_PORT, ...config.cases.map((switchCase) => switchCase.id)];
    },
});
