import type { Page } from '@playwright/test';

import { type ElectronApplicationExit, launchElectron } from './electron-harness.js';
import { expect, test } from './fixtures.js';

const WORKFLOW_STATE_KEY = 'restart-marker';
const WORKFLOW_STATE_VALUE = 'restart-seed';
const RESTART_DIAGNOSTIC_PATTERN =
    /database(?:[\s\S]{0,32})lock|duplicate(?:[\s\S]{0,32})(?:hook|activation)|dirty[- ]exit/i;

function completedRuns(page: Page) {
    return page.locator('li').filter({ hasText: 'Workflow Completed' });
}

function assertCleanExit(exit: ElectronApplicationExit): void {
    expect(exit.code).toBe(0);
    expect(exit.signal).toBeNull();
    expect(exit.forced).toBe(false);
}

async function openWorkflows(page: Page): Promise<void> {
    await expect(page.getByRole('heading', { name: 'Sigil', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
}

async function createRestartWorkflow(page: Page, workflowName: string): Promise<void> {
    await openWorkflows(page);
    await page.getByRole('button', { name: '+ Create', exact: true }).click();
    await page.getByRole('textbox', { name: 'Workflow name', exact: true }).fill(workflowName);

    await page.getByRole('button', { name: 'Add Manual Trigger Node', exact: true }).click();
    const triggerNode = page.getByRole('button', { name: 'Manual Trigger Node', exact: true });
    await expect(triggerNode).toBeVisible();
    await page.getByLabel(/Payload.*name/).fill(WORKFLOW_STATE_VALUE);

    await page.getByRole('button', { name: 'Add State Get Node', exact: true }).click();
    const stateGetNode = page.getByRole('button', { name: 'State Get Node', exact: true });
    await expect(stateGetNode).toBeVisible();
    await page.getByLabel('State key', { exact: true }).fill(WORKFLOW_STATE_KEY);
    await page.getByLabel('Assign to variable', { exact: true }).fill('restoredMarker');

    await page.getByRole('button', { name: 'Add Log Node', exact: true }).click();
    const logNode = page.getByRole('button', { name: 'Log Node', exact: true });
    await expect(logNode).toBeVisible();
    await page.getByLabel('Message', { exact: true }).fill('restored={{vars.restoredMarker}}');

    await page.getByRole('button', { name: 'Add State Set Node', exact: true }).click();
    const stateSetNode = page.getByRole('button', { name: 'State Set Node', exact: true });
    await expect(stateSetNode).toBeVisible();
    await page.getByLabel('State key', { exact: true }).fill(WORKFLOW_STATE_KEY);
    await page.getByLabel('Value template', { exact: true }).fill('{{payload.name}}');

    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await triggerNode
        .getByLabel('Manual Trigger output out')
        .dragTo(stateGetNode.getByLabel('State Get input'));
    await stateGetNode.getByLabel('State Get output out').dragTo(logNode.getByLabel('Log input'));
    await logNode.getByLabel('Log output out').dragTo(stateSetNode.getByLabel('State Set input'));

    await expect(page.getByText(/Valid.*4 nodes, 3 edges/)).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(workflowName, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
    await expect(page.getByText('1 workflow active', { exact: true })).toBeVisible();
}

async function fireWorkflowOnce(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Manual Trigger Node', exact: true }).click();
    await page.getByRole('button', { name: 'Fire', exact: true }).click();
    await page.getByRole('button', { name: 'Events', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
    await expect.poll(() => completedRuns(page).count(), { timeout: 20_000 }).toBe(1);
}

test('relaunches a packaged Workflow with Workflow State intact', async ({
    electron,
    workspace,
}) => {
    const workflowName = `Restart Persistence ${Date.now()}`;

    await createRestartWorkflow(electron.window, workflowName);
    await fireWorkflowOnce(electron.window);

    const firstExit = await electron.close();
    assertCleanExit(firstExit);
    expect(electron.applicationLog()).not.toMatch(RESTART_DIAGNOSTIC_PATTERN);

    const relaunched = await launchElectron({ workspace });
    let secondExit: ElectronApplicationExit | undefined;
    try {
        const page = relaunched.window;
        await openWorkflows(page);
        await expect(page.getByText(workflowName, { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
        await expect(page.getByText('1 workflow active', { exact: true })).toBeVisible();

        await fireWorkflowOnce(page);
        const restoredLog = page.locator('li').filter({ hasText: 'restored=restart-seed' });
        await expect(restoredLog).toHaveCount(1);
    } finally {
        secondExit = await relaunched.close();
    }

    expect(secondExit).toBeDefined();
    if (secondExit === undefined)
        throw new Error('Relaunched Electron did not produce an exit result.');
    assertCleanExit(secondExit);
    expect(relaunched.applicationLog()).not.toMatch(RESTART_DIAGNOSTIC_PATTERN);
});
