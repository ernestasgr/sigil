export function eventNameLabel(name: string): string {
    switch (name) {
        case 'workflow.started':
            return 'Workflow Started';
        case 'workflow.completed':
            return 'Workflow Completed';
        case 'workflow.error':
            return 'Workflow Error';
        case 'manual.trigger.fired':
            return 'Manual Trigger';
        case 'log.output':
            return 'Log';
        case 'notification.show':
            return 'Notification';
        case 'plugin.event':
            return 'Plugin Event';
        default:
            return name;
    }
}

export function eventColor(name: string): string {
    switch (name) {
        case 'workflow.started':
            return 'text-gilt';
        case 'workflow.completed':
            return 'text-verdigris';
        case 'workflow.error':
            return 'text-old-blood';
        case 'manual.trigger.fired':
            return 'text-gilt';
        case 'log.output':
            return 'text-veil';
        case 'notification.show':
            return 'text-gilt';
        case 'plugin.event':
            return 'text-veil';
        default:
            return 'text-veil';
    }
}

export function payloadPreview(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return String(payload);
    const obj = payload as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.pipelineId === 'string') parts.push(`pipeline=${obj.pipelineId}`);
    if (typeof obj.pluginId === 'string') parts.push(`plugin=${obj.pluginId}`);
    if (typeof obj.eventName === 'string') parts.push(`event=${obj.eventName}`);
    if (typeof obj.path === 'string') parts.push(`path=${obj.path}`);
    if (typeof obj.name === 'string') parts.push(`name=${obj.name}`);
    if (typeof obj.nodeId === 'string') parts.push(`node=${obj.nodeId}`);
    if (typeof obj.title === 'string') parts.push(`title=${obj.title}`);
    if (parts.length === 0) return JSON.stringify(payload).slice(0, 80);
    return parts.join(', ');
}

export function extractPluginId(payload: unknown): string | undefined {
    if (payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;
        if (typeof obj.pluginId === 'string') return obj.pluginId;
    }
    return undefined;
}

export function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}
