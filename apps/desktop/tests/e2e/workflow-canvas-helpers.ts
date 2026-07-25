import type { Locator, Page } from '@playwright/test';

import { expect } from './fixtures.js';

type CanvasBox = {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
};

function isInsideCanvas(box: CanvasBox, canvasBox: CanvasBox): boolean {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    return (
        centerX >= canvasBox.x &&
        centerX <= canvasBox.x + canvasBox.width &&
        centerY >= canvasBox.y &&
        centerY <= canvasBox.y + canvasBox.height
    );
}

export async function waitForCanvasHandlesToSettle(
    page: Page,
    handles: readonly Locator[],
): Promise<void> {
    const canvas = page.getByRole('region', { name: 'Workflow canvas', exact: true });
    let previousSignature: string | undefined;

    await expect
        .poll(
            async () => {
                const [canvasBox, ...handleBoxes] = await Promise.all([
                    canvas.boundingBox(),
                    ...handles.map((handle) => handle.boundingBox()),
                ]);
                const boxes = handleBoxes.filter(
                    (box): box is NonNullable<typeof box> => box !== null,
                );
                if (!canvasBox || boxes.length !== handles.length) {
                    previousSignature = undefined;
                    return false;
                }

                const signature = boxes
                    .map((box) => [box.x, box.y, box.width, box.height].map(Math.round).join(':'))
                    .join('|');
                const settled = signature === previousSignature;
                previousSignature = signature;
                return settled && boxes.every((box) => isInsideCanvas(box, canvasBox));
            },
            { timeout: 5_000, intervals: [50, 100, 200] },
        )
        .toBe(true);
}

export async function connectCanvasHandles(
    page: Page,
    source: Locator,
    target: Locator,
    expectedEdgeCount: number,
): Promise<void> {
    await waitForCanvasHandlesToSettle(page, [source, target]);

    const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
    if (!sourceBox || !targetBox) {
        throw new Error('Workflow canvas handles disappeared before connection drag.');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
        steps: 12,
    });
    await page.mouse.up();

    await expect(page.locator('.react-flow__edge')).toHaveCount(expectedEdgeCount);
}
