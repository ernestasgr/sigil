import { Menu, Tray, nativeImage } from 'electron';

import { assertNever } from '../shared/assert-never.js';
import { solidColorPngDataUrl } from './tray-icon.js';
import { buildTrayMenu, type TrayMenuItem } from './tray-menu.js';

export interface TrayHandlers {
    readonly onEnableWorkflows: () => void;
    readonly onDisableWorkflows: () => void;
    readonly onOpenApp: () => void;
    readonly onQuit: () => void;
}

export interface TrayController {
    readonly updateWorkflowsActive: (active: boolean) => void;
    readonly destroy: () => void;
}

const ACTIVE_ICON = solidColorPngDataUrl(16, 16, 0xc9, 0xa2, 0x27, 0xff);
const INACTIVE_ICON = solidColorPngDataUrl(16, 16, 0x4b, 0x45, 0x54, 0xff);

function iconForState(workflowsActive: boolean): string {
    return workflowsActive ? ACTIVE_ICON : INACTIVE_ICON;
}

function labelForItem(item: TrayMenuItem): string {
    switch (item.kind) {
        case 'enable-workflows':
            return 'Enable Workflows';
        case 'disable-workflows':
            return 'Disable Workflows';
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
    let workflowsActive = false;

    const tray = new Tray(nativeImage.createFromDataURL(iconForState(workflowsActive)));
    tray.setToolTip('Sigil — Inactive');

    function dispatch(item: TrayMenuItem): void {
        switch (item.kind) {
            case 'enable-workflows':
                handlers.onEnableWorkflows();
                return;
            case 'disable-workflows':
                handlers.onDisableWorkflows();
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
        const model = buildTrayMenu(workflowsActive);
        const template = model.items.map((item) =>
            item.kind === 'separator'
                ? { type: 'separator' as const }
                : { label: labelForItem(item), click: () => dispatch(item) },
        );
        tray.setContextMenu(Menu.buildFromTemplate(template));
    }

    rebuild();

    return {
        updateWorkflowsActive(active: boolean): void {
            workflowsActive = active;
            tray.setImage(iconForState(active));
            tray.setToolTip(active ? 'Sigil — Workflows active' : 'Sigil — Inactive');
            rebuild();
        },
        destroy(): void {
            tray.destroy();
        },
    };
}
