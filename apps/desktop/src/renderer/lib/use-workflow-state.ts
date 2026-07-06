import { useCallback, useEffect, useState } from 'react';

import type { WorkflowStateEntry } from '../../shared/ipc-channels.js';
import type { SigilAdapter } from './sigil-adapter.js';
import { createSigilAdapter } from './sigil-adapter.js';

export interface UseWorkflowStateResult {
    readonly entries: readonly WorkflowStateEntry[];
    readonly loading: boolean;
    readonly error: unknown;
    readonly refresh: () => void;
}

export function useWorkflowState(workflowId: string, sigil?: SigilAdapter): UseWorkflowStateResult {
    const adapter = sigil ?? createSigilAdapter();
    const [entries, setEntries] = useState<readonly WorkflowStateEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<unknown>(undefined);

    const refresh = useCallback(() => {
        setLoading(true);
        setError(undefined);
        adapter
            .readWorkflowState(workflowId)
            .then(setEntries)
            .catch((err: unknown) => {
                setEntries([]);
                setError(err);
            })
            .finally(() => setLoading(false));
    }, [workflowId, adapter]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { entries, loading, error, refresh };
}
