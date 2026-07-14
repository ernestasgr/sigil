export function assertNever(value: never): never;
export function assertNever(value: never, message: string): never;
export function assertNever(value: never, message = `Unhandled value: ${String(value)}`): never {
    throw new Error(message);
}
