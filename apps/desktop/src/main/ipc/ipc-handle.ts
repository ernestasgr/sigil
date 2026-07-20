import { ipcMain } from 'electron';
import { z } from 'zod';
import type {
    RendererCommandContract,
    RendererCommandName,
    RendererRequest,
    RendererResponse,
} from '../../shared/command-contracts.js';

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

export function ipcHandleCommand<C extends RendererCommandName>(
    contract: RendererCommandContract<C>,
    handler: (args: RendererRequest<C>) => RendererResponse<C> | Promise<RendererResponse<C>>,
): void {
    ipcMain.handle(contract.channel, async (_event, ...args: unknown[]): Promise<unknown> => {
        const isTuple = contract.requestSchema instanceof z.ZodTuple;
        const normalized = !isTuple && args.length <= 1 ? args[0] : args;
        const parsedRequest = contract.requestSchema.safeParse(normalized);
        if (!parsedRequest.success) {
            throw new Error(
                `Invalid arguments for ${contract.channel}: ${parsedRequest.error.message}`,
            );
        }

        // The request schema is selected from the same command contract as
        // RendererRequest<C>; safeParse cannot retain that indexed relation.
        const response = await handler(parsedRequest.data as RendererRequest<C>);
        const parsedResponse = contract.responseSchema.safeParse(response);
        if (!parsedResponse.success) {
            const detail = parsedResponse.error.issues
                .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                .join('; ');
            throw new Error(`Invalid response for ${contract.channel}: ${detail}`);
        }
        // The response schema is selected from the same command contract as
        // RendererResponse<C>; safeParse cannot retain that indexed relation.
        return parsedResponse.data as RendererResponse<C>;
    });
}
