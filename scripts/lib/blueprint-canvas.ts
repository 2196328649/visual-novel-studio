import { expect, type Page } from '@playwright/test';

/** Wait for measured nodes and the fit animation, not an assumed machine speed. */
export async function fitBlueprintCanvas(page: Page) {
  // A repaired pin/variable can resize a node after React Flow's first fit.
  // Retry the actual fit command, never force pointer input past offscreen nodes.
  const measuredAndVisible = () => page.evaluate(async () => {
    const pane = document.querySelector('.blueprint-workspace .react-flow');
    const viewport = pane?.querySelector('.react-flow__viewport');
    if (!pane || !viewport) return false;
    const transform = getComputedStyle(viewport).transform;
    for (let frame = 0; frame < 4; frame++) {
      if (frame) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!viewport.isConnected || getComputedStyle(viewport).transform !== transform) return false;
      const bounds = pane.getBoundingClientRect();
      const nodes = [...pane.querySelectorAll('.react-flow__node')];
      if (!nodes.length || !nodes.every(node => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left >= bounds.left - 1 && box.top >= bounds.top - 1 && box.right <= bounds.right + 1 && box.bottom <= bounds.bottom + 1;
      })) return false;
    }
    return true;
  });
  await expect(async () => {
    await page.getByRole('button', { name: '框选全部节点', exact: true }).click();
    await expect.poll(measuredAndVisible, { timeout: 2500, message: 'All blueprint nodes must be measured, visible and stationary before pointer input.' }).toBe(true);
  }).toPass({ timeout: 14000, intervals: [100, 250, 500] });
}

/** Secondary graph settings live in the compact command bar's top-layer panel. */
export async function openBlueprintOptions(page: Page) {
  const panel = page.getByRole('dialog', { name: '蓝图选项', exact: true });
  if (!await panel.isVisible()) await page.getByRole('button', { name: '蓝图选项', exact: true }).click();
  await expect(panel).toBeVisible(); return panel;
}
export async function closeBlueprintOptions(page: Page) {
  const panel = page.getByRole('dialog', { name: '蓝图选项', exact: true });
  if (await panel.isVisible()) await panel.getByRole('button', { name: '关闭蓝图选项', exact: true }).click();
}
export async function setBlueprintOption(page: Page, name: string, checked: boolean) {
  const panel = await openBlueprintOptions(page);
  await panel.getByRole('checkbox', { name, exact: true }).setChecked(checked);
  await closeBlueprintOptions(page);
}
