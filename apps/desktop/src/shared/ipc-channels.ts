export const EngineChannel = {
    Ping: 'engine:ping',
    Pong: 'engine:pong',
} as const;

export type EnginePing = { id: string; type: typeof EngineChannel.Ping };
export type EnginePong = { id: string; type: typeof EngineChannel.Pong; receivedAt: number };

export type EngineMessage = EnginePing | EnginePong;

export const RendererChannel = {
    EnginePong: 'renderer:engine-pong',
} as const;
