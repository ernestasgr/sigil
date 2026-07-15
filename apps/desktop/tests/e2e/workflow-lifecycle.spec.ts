import { expect, test } from './fixtures.js';

test('completes a Workflow lifecycle through the Electron UI', async ({ electron }) => {
    const page = electron.window;

    await expect(page.getByRole('heading', { name: 'Sigil', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '+ Create', exact: true }).click();
    const workflowName = page.getByRole('textbox', { name: 'Workflow name', exact: true });
    await expect(workflowName).toBeVisible();
    await workflowName.fill('Smoke Workflow');

    await page.getByRole('button', { name: 'Add Manual Trigger Node', exact: true }).click();
    const triggerNode = page.getByRole('button', { name: 'Manual Trigger Node', exact: true });
    await expect(triggerNode).toBeVisible();
    await page.getByLabel(/Payload.*name/).fill('smoke-file.txt');

    await page.getByRole('button', { name: 'Add Log Node', exact: true }).click();
    const logNode = page.getByRole('button', { name: 'Log Node', exact: true });
    await expect(logNode).toBeVisible();
    await page.getByLabel('Message', { exact: true }).fill('Smoke run: {{payload.name}}');

    await triggerNode
        .getByLabel('Manual Trigger output out')
        .dragTo(logNode.getByLabel('Log input'));
    await expect(page.getByText(/Valid.*2 nodes, 1 edge/)).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Smoke Workflow', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(workflowName).toHaveValue('Smoke Workflow');
    await workflowName.fill('Smoke Workflow edited');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Smoke Workflow edited', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
    await expect(page.getByText('1 workflow active', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Manual Trigger Node', exact: true }).click();
    await page.getByRole('button', { name: 'Fire', exact: true }).click();

    await page.getByRole('button', { name: 'Events', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
    await expect(page.getByText('Smoke run: smoke-file.txt', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await expect(page.getByText('Smoke Workflow edited', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
        page.getByText('No workflows yet. Create one to get started.', { exact: true }),
    ).toBeVisible();
});
