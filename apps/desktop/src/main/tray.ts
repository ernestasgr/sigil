import { Menu, Tray, nativeImage } from 'electron';

import { assertNever } from '../shared/assert-never.js';
import type { WorkflowSummary } from '../shared/workflow.js';
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

const ACTIVE_ICON = solidColorPngDataUrl(16, 16, 0xc9, 0xa2, 0x27, 0xff);
const INACTIVE_ICON = solidColorPngDataUrl(16, 16, 0x4b, 0x45, 0x54, 0xff);

function iconForState(workflowsActive: boolean): string {
    return workflowsActive ? ACTIVE_ICON : INACTIVE_ICON;
}

function labelForItem(item: TrayMenuItem): string {
    switch (item.kind) {
        case 'workflow-toggle': {
            const check = item.workflow.enabled ? '✓ ' : '  ';
            return `${check}${item.workflow.name}`;
        }
        case 'no-workflows':
            return 'No workflows';
        case 'open-app':
            return 'Open Sigil';
        case 'separator':
            return '';
        case 'quit':
            return 'Quit Sigil';
        default:
            return assertNever(item);
    }
}

export function createTray(handlers: TrayHandlers): TrayController {
    let workflows: readonly WorkflowSummary[] = [];

    const tray = new Tray(nativeImage.createFromDataURL(iconForState(false)));
    tray.setToolTip('Sigil — Inactive');

    function dispatch(item: TrayMenuItem): void {
        switch (item.kind) {
            case 'workflow-toggle':
                handlers.onToggleWorkflow(item.workflow.id);
                return;
            case 'no-workflows':
                return;
            case 'open-app':
                handlers.onOpenApp();
                return;
            case 'quit':
                handlers.onQuit();
                return;
            case 'separator':
                return;
            default:
                assertNever(item);
        }
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
            const active = workflows.some((w) => w.enabled);
            tray.setImage(iconForState(active));
            tray.setToolTip(active ? 'Sigil — Workflows active' : 'Sigil — Inactive');
            rebuild();
        },
        destroy(): void {
            tray.destroy();
        },
    };
}
