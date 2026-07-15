import { type BrowserWindow, dialog } from 'electron';

export interface NativeOpenDialogResult {
    readonly canceled: boolean;
    readonly filePaths: readonly string[];
}

export interface NativeDialogAdapter {
    readonly showOpenFileDialog: (ownerWindow: BrowserWindow) => Promise<NativeOpenDialogResult>;
}

export const electronNativeDialogAdapter: NativeDialogAdapter = {
    showOpenFileDialog: (ownerWindow) =>
        dialog.showOpenDialog(ownerWindow, {
            properties: ['openFile'],
        }),
};
