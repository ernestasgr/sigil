export function freezeSnapshot<T>(value: T, seen = new Set<object>()): T {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) freezeSnapshot(item, seen);
    } else {
        for (const item of Object.values(value as Record<string, unknown>)) {
            freezeSnapshot(item, seen);
        }
    }
    return Object.freeze(value);
}

export function cloneSnapshot<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    return freezeSnapshot(structuredClone(value));
}

/** Clone a Properties File snapshot so no caller can mutate its source data. */
export function immutablePropertySnapshot(
    value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
    return cloneSnapshot(value);
}
