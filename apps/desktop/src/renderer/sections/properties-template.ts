export function propertiesTemplateFromDefaults(
    defaults: Readonly<Record<string, unknown>>,
): string {
    return JSON.stringify(defaults, null, 4);
}
