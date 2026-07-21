import { Match } from 'effect';
import { Menu, nativeImage, Tray } from 'electron';

import type { WorkflowSummary } from '../../shared/workflow.js';
import { isWorkflowActive, workflowActivationLabel } from '../../shared/workflow.js';
import { solidColorPngDataUrl } from './tray-icon.js';
import { buildTrayMenu, type TrayMenuItem } from './tray-menu.js';

export interface TrayHandlers {
    readonly onToggleWorkflow: (id: string) => void;
    readonly onOpenApp: () => void;
    readonly onQuit: () => void;
}

export interface TrayController {
    readonly updateWorkflows: (workflows: readonly WorkflowSummary[]) => void;
    readonly destroy: () => void;
}

const ACTIVE_ICON = nativeImage.createFromDataURL(
    solidColorPngDataUrl(16, 16, 0xc9, 0xa2, 0x27, 0xff),
);
const INACTIVE_ICON = nativeImage.createFromDataURL(
    solidColorPngDataUrl(16, 16, 0x4b, 0x45, 0x54, 0xff),
);

function iconForState(workflowsActive: boolean): Electron.NativeImage {
    return workflowsActive ? ACTIVE_ICON : INACTIVE_ICON;
}

function labelForItem(item: TrayMenuItem): string {
    return Match.value(item).pipe(
        Match.when({ kind: 'workflow-toggle' }, (i) => {
            const marker = isWorkflowActive(i.workflow) ? '✓ ' : i.workflow.enabled ? '• ' : '  ';
            return `${marker}${i.workflow.name} — ${workflowActivationLabel(i.workflow.activation)}`;
        }),
        Match.when({ kind: 'no-workflows' }, () => 'No workflows'),
        Match.when({ kind: 'open-app' }, () => 'Open Sigil'),
        Match.when({ kind: 'separator' }, () => ''),
        Match.when({ kind: 'quit' }, () => 'Quit Sigil'),
        Match.exhaustive,
    );
}

export function createTray(handlers: TrayHandlers): TrayController {
    let workflows: readonly WorkflowSummary[] = [];

    const tray = new Tray(iconForState(false));
    tray.setToolTip('Sigil — Inactive');

    function dispatch(item: TrayMenuItem): void {
        Match.value(item).pipe(
            Match.when({ kind: 'workflow-toggle' }, (i) =>
                handlers.onToggleWorkflow(i.workflow.id),
            ),
            Match.when({ kind: 'no-workflows' }, () => {}),
            Match.when({ kind: 'open-app' }, () => handlers.onOpenApp()),
            Match.when({ kind: 'quit' }, () => handlers.onQuit()),
            Match.when({ kind: 'separator' }, () => {}),
            Match.exhaustive,
        );
    }

    function rebuild(): void {
        const model = buildTrayMenu(workflows);
        const template = model.items.map((item) => {
            if (item.kind === 'separator') {
                return { type: 'separator' as const };
            }
            if (item.kind === 'no-workflows') {
                return { label: labelForItem(item), enabled: false };
            }
            return { label: labelForItem(item), click: () => dispatch(item) };
        });
        tray.setContextMenu(Menu.buildFromTemplate(template));
    }

    rebuild();

    return {
        updateWorkflows(nextWorkflows: readonly WorkflowSummary[]): void {
            workflows = nextWorkflows;
            const active = workflows.some(isWorkflowActive);
            tray.setImage(iconForState(active));
            tray.setToolTip(active ? 'Sigil — Workflows active' : 'Sigil — Inactive');
            rebuild();
        },
        destroy(): void {
            tray.destroy();
        },
    };
}
