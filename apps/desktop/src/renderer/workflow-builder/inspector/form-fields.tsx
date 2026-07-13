import type { SwitchCase } from '@sigil/schema/nodes/switch';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';

import { cn } from '../../lib/utils.js';

interface FieldProps {
    readonly label: string;
    readonly htmlFor?: string;
    readonly children: ReactNode;
}

export function Field({ label, htmlFor, children }: FieldProps): ReactElement {
    return (
        <div className="flex flex-col gap-1">
            <label
                htmlFor={htmlFor}
                className="font-ui text-veil-foreground text-[11px] tracking-widest uppercase"
            >
                {label}
            </label>
            {children}
        </div>
    );
}

const INPUT_CLASS =
    'w-full border border-veil/50 bg-obsidian-ink px-3 py-2 font-ui text-sm text-parchment placeholder:text-veil-foreground/60 focus:border-gilt focus-visible:outline-2 focus-visible:outline-gilt focus-visible:outline-offset-2';

interface TextInputProps {
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly placeholder?: string;
    readonly mono?: boolean;
    readonly id?: string;
    readonly invalid?: boolean;
    readonly descriptionId?: string;
}

export function TextInput({
    label,
    value,
    onChange,
    placeholder,
    mono,
    id,
    invalid,
    descriptionId,
}: TextInputProps): ReactElement {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
        <Field label={label} htmlFor={inputId}>
            <input
                id={inputId}
                data-inspector-control="true"
                type="text"
                className={cn(INPUT_CLASS, mono && 'font-data')}
                value={value}
                placeholder={placeholder}
                aria-invalid={invalid || undefined}
                aria-describedby={descriptionId}
                onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
            />
        </Field>
    );
}

interface NumberInputProps {
    readonly label: string;
    readonly value: number;
    readonly onChange: (value: number) => void;
    readonly min?: number;
    readonly id?: string;
}

export function NumberInput({ label, value, onChange, min, id }: NumberInputProps): ReactElement {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const [draftValue, setDraftValue] = useState(() => String(value));
    const [isFocused, setIsFocused] = useState(false);
    const parsedValue = Number(draftValue);
    const invalid = isFocused && (draftValue.trim().length === 0 || !Number.isFinite(parsedValue));

    useEffect(() => {
        if (!isFocused) setDraftValue(String(value));
    }, [isFocused, value]);

    return (
        <Field label={label} htmlFor={inputId}>
            <input
                id={inputId}
                data-inspector-control="true"
                type="number"
                className={INPUT_CLASS}
                value={draftValue}
                min={min}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${inputId}-hint` : undefined}
                onFocus={() => setIsFocused(true)}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const rawValue = event.target.value;
                    const nextValue = Number(rawValue);
                    setDraftValue(rawValue);
                    if (rawValue.trim().length > 0 && Number.isFinite(nextValue)) {
                        onChange(nextValue);
                    }
                }}
                onBlur={() => {
                    setIsFocused(false);
                    if (invalid) setDraftValue(String(value));
                }}
            />
            {invalid ? (
                <span
                    id={`${inputId}-hint`}
                    className="font-data text-old-blood-foreground text-[10px]"
                >
                    Enter a finite number.
                </span>
            ) : null}
        </Field>
    );
}

interface SelectInputProps<T extends string> {
    readonly label: string;
    readonly value: T;
    readonly options: readonly { readonly value: T; readonly label: string }[];
    readonly onChange: (value: T) => void;
    readonly id?: string;
}

export function SelectInput<T extends string>({
    label,
    value,
    options,
    onChange,
    id,
}: SelectInputProps<T>): ReactElement {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    return (
        <Field label={label} htmlFor={selectId}>
            <select
                id={selectId}
                data-inspector-control="true"
                className={INPUT_CLASS}
                value={value}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    const option = options.find((entry) => entry.value === event.target.value);
                    if (option) onChange(option.value);
                }}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </Field>
    );
}

interface CheckboxProps {
    readonly label: string;
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
}

export function Checkbox({ label, checked, onChange }: CheckboxProps): ReactElement {
    const inputId = useId();
    return (
        <div className="flex items-center gap-2">
            <input
                id={inputId}
                data-inspector-control="true"
                type="checkbox"
                className="h-4 w-4 accent-gilt focus-visible:outline-2 focus-visible:outline-gilt focus-visible:outline-offset-2"
                checked={checked}
                onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
            />
            <label htmlFor={inputId} className="font-ui text-sm text-parchment">
                {label}
            </label>
        </div>
    );
}

interface StringListProps {
    readonly label: string;
    readonly values: readonly string[];
    readonly onChange: (values: string[]) => void;
    readonly placeholder?: string;
}

export function StringList({
    label,
    values,
    onChange,
    placeholder,
}: StringListProps): ReactElement {
    const listId = useId();
    return (
        <fieldset className="flex flex-col gap-1.5">
            <legend className="font-ui text-veil-foreground text-[11px] tracking-widest uppercase">
                {label}
            </legend>
            <div className="flex flex-col gap-1.5">
                {values.map((value, index) => {
                    const inputId = `${listId}-${index}`;
                    return (
                        <div
                            // biome-ignore lint/suspicious/noArrayIndexKey: Ordered list items that don't reorder
                            key={index}
                            className="flex items-center gap-1.5"
                        >
                            <label htmlFor={inputId} className="sr-only">
                                {label} entry {index + 1}
                            </label>
                            <input
                                id={inputId}
                                data-inspector-control="true"
                                type="text"
                                className={cn(INPUT_CLASS, 'font-data')}
                                value={value}
                                placeholder={placeholder}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                    const next = [...values];
                                    next[index] = event.target.value;
                                    onChange(next);
                                }}
                            />
                            <button
                                type="button"
                                className="border-old-blood-foreground text-old-blood-foreground focus-visible:outline-2 focus-visible:outline-gilt focus-visible:outline-offset-2 px-2 py-2 text-xs hover:bg-old-blood/10"
                                aria-label={`Remove ${label} entry ${index + 1}`}
                                onClick={() => onChange(values.filter((_, i) => i !== index))}
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
                <button
                    type="button"
                    className="border-gilt/50 text-gilt focus-visible:outline-2 focus-visible:outline-gilt focus-visible:outline-offset-2 px-3 py-1.5 text-left font-ui text-xs tracking-widest uppercase hover:bg-gilt/10"
                    aria-label={`Add ${label} entry`}
                    onClick={() => onChange([...values, ''])}
                >
                    + Add
                </button>
            </div>
        </fieldset>
    );
}

interface SwitchCaseListProps {
    readonly label: string;
    readonly values: readonly SwitchCase[];
    readonly onChange: (values: SwitchCase[]) => void;
    readonly placeholder?: string;
}

export function SwitchCaseList({
    label,
    values,
    onChange,
    placeholder,
}: SwitchCaseListProps): ReactElement {
    const listId = useId();
    return (
        <fieldset className="flex flex-col gap-1.5">
            <legend className="font-ui text-veil-foreground text-[11px] tracking-widest uppercase">
                {label}
            </legend>
            <div className="flex flex-col gap-1.5">
                {values.map((switchCase, index) => {
                    const inputId = `${listId}-${index}`;
                    return (
                        <div key={switchCase.id} className="flex items-center gap-1.5">
                            <label htmlFor={inputId} className="sr-only">
                                {label} entry {index + 1}
                            </label>
                            <input
                                id={inputId}
                                data-inspector-control="true"
                                type="text"
                                className={cn(INPUT_CLASS, 'font-data')}
                                value={switchCase.value}
                                placeholder={placeholder}
                                aria-label={`${label} entry ${index + 1}`}
                                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                    onChange(
                                        values.map((entry) =>
                                            entry.id === switchCase.id
                                                ? { ...entry, value: event.target.value }
                                                : entry,
                                        ),
                                    )
                                }
                            />
                            <button
                                type="button"
                                className="border-old-blood-foreground text-old-blood-foreground focus-visible:outline-2 focus-visible:outline-gilt focus-visible:outline-offset-2 px-2 py-2 text-xs hover:bg-old-blood/10"
                                aria-label={`Remove ${label} entry ${index + 1}`}
                                onClick={() =>
                                    onChange(values.filter((entry) => entry.id !== switchCase.id))
                                }
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
                <button
                    type="button"
                    className="border-gilt/50 text-gilt focus-visible:outline-2 focus-visible:outline-gilt focus-visible:outline-offset-2 px-3 py-1.5 text-left font-ui text-xs tracking-widest uppercase hover:bg-gilt/10"
                    aria-label={`Add ${label} entry`}
                    onClick={() => onChange([...values, { id: crypto.randomUUID(), value: '' }])}
                >
                    + Add
                </button>
            </div>
        </fieldset>
    );
}
