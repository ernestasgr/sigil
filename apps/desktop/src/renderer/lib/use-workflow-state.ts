import { useCallback, useEffect, useState } from 'react';

import type { WorkflowStateEntry } from '../../shared/ipc-channels.js';

export interface UseWorkflowStateResult {
    readonly entries: readonly WorkflowStateEntry[];
    readonly loading: boolean;
    readonly error: unknown;
    readonly refresh: () => void;
}

export function useWorkflowState(workflowId: string): UseWorkflowStateResult {
    const [entries, setEntries] = useState<readonly WorkflowStateEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<unknown>(undefined);

    const refresh = useCallback(() => {
        setLoading(true);
        setError(undefined);
        window.sigil
            .readWorkflowState(workflowId)
            .then(setEntries)
            .catch((err: unknown) => {
                setEntries([]);
                setError(err);
            })
            .finally(() => setLoading(false));
    }, [workflowId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { entries, loading, error, refresh };
}
