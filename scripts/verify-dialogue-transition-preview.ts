import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.'), output = path.resolve('artifacts/dialogue-transition-preview', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const source = '# 段落：测试\n旁白：这句对白在演出转场期间保持显示。\n@等待：0.3\n@演出转场：纯色，0.5，0.2，0.5\n@独立演出：转场\n旁白：转场结束后显示下一句。';
const parsed = applyTextScript(createProject('对白转场预览验收'), source);
assert.deepEqual(parsed.issues, []);
const projectFile = path.join(output, 'project.vns.json');
await fs.writeFile(projectFile, JSON.stringify(parsed.project));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('.project-title strong')).toHaveText(parsed.project.name, { timeout: 45000 });
  await openStoryMode(page, 'text');
  await page.getByRole('button', { name: '转到第 5 行', exact: true }).click();
  const performance = parsed.project.nodes.find(node => node.kind === 'passage' && node.lines.some(line => line.silent))!;
  assert.ok(performance.kind === 'passage');
  await expect(page.locator('.story-preview-content')).toHaveAttribute('data-preview-key', `${performance.id}/${performance.lines[0].id}`);
  const seek = page.getByLabel('定位演出时间（秒）', { exact: true });
  const metrics = [];
  for (const time of [.55, .9, 1.25, 1.6]) {
    await seek.fill(String(time)); await seek.press('Tab');
    const overlay = page.locator('.preview-performance-transition');
    await expect(overlay).toBeVisible();
    const dialogue = overlay.locator('.ui-dialogue-preview');
    await expect(dialogue).toContainText(time < 1.5 ? '这句对白在演出转场期间保持显示。' : '转场结束后显示下一句。');
    const result = await dialogue.evaluate(element => {
      const cover = element.parentElement!.querySelector('.preview-performance-cover');
      const bounds = element.getBoundingClientRect();
      const ancestors = [];
      for (let node: Element | null = element; node; node = node.parentElement) ancestors.push(Number(getComputedStyle(node).opacity));
      return { ancestors, coverOpacity: cover ? Number(getComputedStyle(cover).opacity) : 0, width: bounds.width, height: bounds.height,
        separate: !!cover && cover.parentElement !== element.parentElement && !cover.parentElement!.contains(element) };
    });
    assert.ok(result.ancestors.every(value => value === 1));
    if (time < 1.5) assert.ok(result.separate, 'dialogue is outside the fading stage');
    if (time === .9) assert.equal(result.coverOpacity, 1);
    metrics.push({ time, ...result });
    await page.locator('.preview-stage-viewport').screenshot({ path: path.join(output, `preview-${time}.png`) });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', metrics, errors }, null, 2));
  console.log(output);
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app.close();
}
