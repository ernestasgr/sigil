export interface QuitEvent {
    readonly preventDefault: () => void;
}

export interface QuitCoordinatorEngine {
    readonly terminate: () => Promise<unknown>;
}

export type QuitFailurePhase = 'tray' | 'engine' | 'final-quit';

export interface QuitCoordinatorOptions {
    readonly getEngine: () => QuitCoordinatorEngine | null;
    readonly destroyTray: () => void;
    readonly requestQuit: () => void;
    readonly onFailure?: (phase: QuitFailurePhase, error: unknown) => void;
}

export interface QuitCoordinator {
    readonly beforeQuit: (event: QuitEvent) => Promise<void>;
}

function reportFailure(
    onFailure: QuitCoordinatorOptions['onFailure'],
    phase: QuitFailurePhase,
    error: unknown,
): void {
    try {
        onFailure?.(phase, error);
    } catch {
        // Failure reporting must not prevent the application from quitting.
    }
}

export function createQuitCoordinator(options: QuitCoordinatorOptions): QuitCoordinator {
    let shutdownPromise: Promise<void> | undefined;
    let finalQuitPermitted = false;

    function requestFinalQuit(): void {
        finalQuitPermitted = true;
        try {
            options.requestQuit();
        } catch (error) {
            reportFailure(options.onFailure, 'final-quit', error);
        }
    }

    async function shutdown(): Promise<void> {
        try {
            try {
                options.destroyTray();
            } catch (error) {
                reportFailure(options.onFailure, 'tray', error);
            }

            let engine: QuitCoordinatorEngine | null = null;
            try {
                engine = options.getEngine();
            } catch (error) {
                reportFailure(options.onFailure, 'engine', error);
            }

            if (engine) {
                try {
                    await engine.terminate();
                } catch (error) {
                    reportFailure(options.onFailure, 'engine', error);
                }
            }
        } catch (error) {
            reportFailure(options.onFailure, 'engine', error);
        }

        requestFinalQuit();
    }

    function beforeQuit(event: QuitEvent): Promise<void> {
        if (finalQuitPermitted) return Promise.resolve();

        event.preventDefault();
        shutdownPromise ??= shutdown();
        return shutdownPromise;
    }

    return { beforeQuit };
}
