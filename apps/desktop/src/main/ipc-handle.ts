import { ipcMain } from 'electron';
import { z } from 'zod';

export function ipcHandle<T extends z.ZodTypeAny>(
    channel: string,
    argSchema: T,
    handler: (args: z.output<T>) => unknown,
): void {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => {
        const isTuple = argSchema instanceof z.ZodTuple;
        const normalized = !isTuple && args.length <= 1 ? args[0] : args;
        const parsed = argSchema.safeParse(normalized);
        if (!parsed.success) {
            throw new Error(`Invalid arguments for ${channel}: ${parsed.error.message}`);
        }
        return handler(parsed.data);
    });
}
