const DEFAULT_TELEMETRY_TEXT_LIMIT = 256;
const MAX_REDACTION_DEPTH = 8;
const SENSITIVE_KEY_PATTERN =
    /(?:password|passphrase|secret|token|authorization|cookie|api[-_]?key|private[-_]?key)/i;
const SENSITIVE_TEXT_PATTERN =
    /\b((?:password|passphrase|secret|token|authorization|cookie|api[-_]?key|private[-_]?key)\s*[:=]\s*)([^\r\n,;}\]]+)/gi;

function truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSensitiveTelemetryKey(key: string): boolean {
    return SENSITIVE_KEY_PATTERN.test(key);
}

export function redactTelemetryText(
    message: string,
    maxLength: number = DEFAULT_TELEMETRY_TEXT_LIMIT,
): string {
    return truncate(
        message.replace(SENSITIVE_TEXT_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`),
        maxLength,
    );
}

function redactValue(value: unknown, depth: number): unknown {
    if (depth >= MAX_REDACTION_DEPTH) return '[TRUNCATED]';
    if (typeof value === 'string') return redactTelemetryText(value);
    if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
    if (!isRecord(value)) return value;

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        result[key] = isSensitiveTelemetryKey(key) ? '[REDACTED]' : redactValue(child, depth + 1);
    }
    return result;
}

export function redactTelemetrySummary(
    summary: string,
    maxLength: number = DEFAULT_TELEMETRY_TEXT_LIMIT,
): string {
    try {
        const parsed: unknown = JSON.parse(summary);
        const serialized = JSON.stringify(redactValue(parsed, 0));
        return serialized === undefined ? '[UNAVAILABLE]' : truncate(serialized, maxLength);
    } catch {
        return redactTelemetryText(summary, maxLength);
    }
}
