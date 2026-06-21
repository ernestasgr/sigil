export const EngineChannel = {
    Ping: 'engine:ping',
    Pong: 'engine:pong',
    FireTestEvent: 'engine:fire-test-event',
    Log: 'engine:log',
} as const;

export type EnginePing = { id: string; type: typeof EngineChannel.Ping };
export type EnginePong = { id: string; type: typeof EngineChannel.Pong; receivedAt: number };
export type EngineFireTestEvent = { type: typeof EngineChannel.FireTestEvent };
export type EngineLog = { type: typeof EngineChannel.Log; line: string };

export type EngineMessage = EnginePing | EnginePong | EngineFireTestEvent | EngineLog;

export const RendererChannel = {
    EnginePong: 'renderer:engine-pong',
    FireTestEvent: 'renderer:fire-test-event',
    EngineLog: 'renderer:engine-log',
} as const;
