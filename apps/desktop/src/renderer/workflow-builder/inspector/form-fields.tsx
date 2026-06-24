import type { ChangeEvent, ReactElement, ReactNode } from 'react';

import { cn } from '../../lib/utils.js';

interface FieldProps {
    readonly label: string;
    readonly children: ReactNode;
}

export function Field({ label, children }: FieldProps): ReactElement {
    return (
        <label className="flex flex-col gap-1">
            <span className="font-ui text-[11px] tracking-widest text-veil uppercase">{label}</span>
            {children}
        </label>
    );
}

const INPUT_CLASS =
    'w-full border border-veil/50 bg-obsidian-ink px-3 py-2 font-ui text-sm text-parchment placeholder:text-veil/60 focus:border-gilt focus:outline-none';

interface TextInputProps {
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly placeholder?: string;
    readonly mono?: boolean;
}

export function TextInput({
    label,
    value,
    onChange,
    placeholder,
    mono,
}: TextInputProps): ReactElement {
    return (
        <Field label={label}>
            <input
                type="text"
                className={cn(INPUT_CLASS, mono && 'font-data')}
                value={value}
                placeholder={placeholder}
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
}

export function NumberInput({ label, value, onChange, min }: NumberInputProps): ReactElement {
    return (
        <Field label={label}>
            <input
                type="number"
                className={INPUT_CLASS}
                value={Number.isFinite(value) ? value : 0}
                min={min}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const parsed = Number(event.target.value);
                    onChange(Number.isFinite(parsed) ? parsed : 0);
                }}
            />
        </Field>
    );
}

interface SelectInputProps<T extends string> {
    readonly label: string;
    readonly value: T;
    readonly options: readonly { readonly value: T; readonly label: string }[];
    readonly onChange: (value: T) => void;
}

export function SelectInput<T extends string>({
    label,
    value,
    options,
    onChange,
}: SelectInputProps<T>): ReactElement {
    return (
        <Field label={label}>
            <select
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
    return (
        <label className="flex items-center gap-2">
            <input
                type="checkbox"
                className="h-4 w-4 accent-gilt"
                checked={checked}
                onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
            />
            <span className="font-ui text-sm text-parchment">{label}</span>
        </label>
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
    return (
        <Field label={label}>
            <div className="flex flex-col gap-1.5">
                {values.map((value, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                        <input
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
                            className="border-old-blood text-old-blood px-2 py-2 text-xs hover:bg-old-blood/10"
                            aria-label={`Remove ${label} entry ${index + 1}`}
                            onClick={() => onChange(values.filter((_, i) => i !== index))}
                        >
                            ×
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    className="border-gilt/50 text-gilt px-3 py-1.5 text-left font-ui text-xs tracking-widest uppercase hover:bg-gilt/10"
                    onClick={() => onChange([...values, ''])}
                >
                    + Add
                </button>
            </div>
        </Field>
    );
}
