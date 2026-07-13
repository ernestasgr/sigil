const NUMBER_INPUT_ERROR_MESSAGE = 'Enter a finite number.';

function isNumberInputInvalid(draftValue: string, isFocused: boolean): boolean {
    const parsedValue = Number(draftValue);
    return isFocused && (draftValue.trim().length === 0 || !Number.isFinite(parsedValue));
}

export function getNumberInputId(providedId: string | undefined, generatedId: string): string {
    return providedId ?? generatedId;
}

export function getNumberInputChange(rawValue: string): {
    readonly draftValue: string;
    readonly value: number | null;
} {
    const nextValue = Number(rawValue);
    return {
        draftValue: rawValue,
        value: rawValue.trim().length > 0 && Number.isFinite(nextValue) ? nextValue : null,
    };
}

export function getNumberInputValidation(
    draftValue: string,
    isFocused: boolean,
    inputId: string,
): {
    readonly invalid: boolean;
    readonly describedBy: string | undefined;
    readonly errorMessage: string | undefined;
} {
    const invalid = isNumberInputInvalid(draftValue, isFocused);
    return {
        invalid,
        describedBy: invalid ? `${inputId}-hint` : undefined,
        errorMessage: invalid ? NUMBER_INPUT_ERROR_MESSAGE : undefined,
    };
}

export function getNumberInputBlurDraft(
    draftValue: string,
    value: number,
    invalid: boolean,
): string {
    return invalid ? String(value) : draftValue;
}
