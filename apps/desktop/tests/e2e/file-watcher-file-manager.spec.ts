import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from './fixtures.js';

test('moves a real Downloads file through a packaged File Watcher Workflow', async ({
    electron,
    workspace,
}) => {
    const page = electron.window;
    const testId = randomUUID();
    const incomingDirectory = join(workspace.workspaceDirectory, 'incoming');
    const destinationDirectory = join(workspace.workspaceDirectory, 'processed');
    const fileName = `download-${testId}.txt`;
    const fileContents = `packaged Downloads fixture ${testId}`;
    const sourcePath = join(incomingDirectory, fileName);
    const destinationPath = join(destinationDirectory, fileName);
    const workflowName = `Packaged Downloads ${testId}`;

    await mkdir(incomingDirectory);
    await mkdir(destinationDirectory);

    await expect(page.getByRole('heading', { name: 'Sigil', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '+ Create', exact: true }).click();
    await page.getByRole('textbox', { name: 'Workflow name', exact: true }).fill(workflowName);

    await page.getByRole('button', { name: 'Add File Watcher Node', exact: true }).click();
    const fileWatcherNode = page.getByRole('button', { name: 'File Watcher Node', exact: true });
    await expect(fileWatcherNode).toBeVisible();
    await page.getByLabel('Path', { exact: true }).fill(incomingDirectory);

    await page.getByRole('button', { name: 'Add File Manager Node', exact: true }).click();
    const fileManagerNode = page.getByRole('button', { name: 'File Manager Node', exact: true });
    await expect(fileManagerNode).toBeVisible();
    await page.getByLabel('Action', { exact: true }).selectOption('move');
    await page.getByLabel('Destination', { exact: true }).fill(destinationDirectory);

    await fileWatcherNode
        .getByLabel('File Watcher output out')
        .dragTo(fileManagerNode.getByLabel('File Manager input'));
    await expect(page.getByText(/Valid.*2 nodes, 1 edge/)).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText(workflowName, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
    await expect(page.getByText('1 workflow active', { exact: true })).toBeVisible();

    await writeFile(sourcePath, fileContents, 'utf8');

    await expect
        .poll(
            async () => {
                try {
                    return await readFile(destinationPath, 'utf8');
                } catch {
                    return null;
                }
            },
            { timeout: 30_000 },
        )
        .toBe(fileContents);
    await expect
        .poll(
            async () => {
                try {
                    await stat(sourcePath);
                    return true;
                } catch {
                    return false;
                }
            },
            { timeout: 10_000 },
        )
        .toBe(false);

    await page.getByRole('button', { name: 'Events', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
    const completedRun = page.locator('li').filter({ hasText: 'Workflow Completed' });
    await expect.poll(() => completedRun.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(completedRun.first()).toContainText(/workflow=.*run=.*outcome=succeeded/);
});
