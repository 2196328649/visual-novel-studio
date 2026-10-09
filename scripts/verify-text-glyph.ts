import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, projectSchema } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/text-glyph', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('文字字形粒子验收');
const object = { ...createVisualObject('particles'), duration: 7 };
const graph = blueprintFromPerformance(project, [object], '文字粒子'); project.blueprints.push(graph);
graph.timelineComponent = true;
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
const app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') }), page = await app.firstWindow();
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  await page.locator('.timeline-clip').first().click();
  await page.getByRole('tab', { name: '动画与效果', exact: true }).click();
  await page.getByText('字形发射', { exact: true }).click();
  await page.getByLabel('从文字字形发射', { exact: true }).check();
  await page.getByRole('tab', { name: '基础', exact: true }).click();
  const text = page.getByLabel('片段文字内容', { exact: true }); await text.fill('第一章 春日');
  await page.getByRole('tab', { name: '动画与效果', exact: true }).click();
  await page.getByText('字形发射', { exact: true }).click();
  await page.getByLabel('字形发射开始 秒', { exact: true }).fill('0');
  await page.getByLabel('字形运动倍率', { exact: true }).fill('0');
  await page.getByLabel('字形运动倍率', { exact: true }).press('Tab');
  const seek = async () => { const slider = page.getByRole('slider', { name: '时间轴播放头', exact: true }); await slider.press('Home'); await slider.press('Shift+ArrowRight'); };
  await seek();
  const particles = page.locator('[data-glyph-particle]');
  await expect.poll(() => particles.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-glyph-error]')).toHaveCount(0);
  const surface = page.locator(`svg[data-visual-instance="${object.instanceId}"]`);
  const actual = PNG.sync.read(await surface.screenshot({ path: path.join(output, 'svg-particles.png') }));
  await surface.evaluate(element => {
    for (const circle of element.querySelectorAll<SVGCircleElement>('[data-glyph-particle]')) {
      const gradient = document.getElementById(circle.getAttribute('fill')!.slice(5, -1))!;
      const color = gradient.querySelector('stop')!.getAttribute('stop-color')!;
      const radius = circle.r.baseVal.value, legacy = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      legacy.setAttribute('data-reference-particle', ''); legacy.setAttribute('x', String(circle.cx.baseVal.value - radius)); legacy.setAttribute('y', String(circle.cy.baseVal.value - radius));
      legacy.setAttribute('width', String(radius * 2)); legacy.setAttribute('height', String(radius * 2));
      const sprite = document.createElement('div'); sprite.style.cssText = `width:100%;height:100%;background:radial-gradient(closest-side, ${color}, ${color}00);opacity:${circle.getAttribute('opacity')}`;
      legacy.append(sprite); circle.after(legacy); circle.style.display = 'none';
    }
  });
  let reference: PNG;
  try { reference = PNG.sync.read(await surface.screenshot({ path: path.join(output, 'css-reference-particles.png') })); }
  finally { await surface.evaluate(element => { element.querySelectorAll('[data-reference-particle]').forEach(e => e.remove()); element.querySelectorAll<SVGElement>('[data-glyph-particle]').forEach(e => { e.style.display = ''; }); }); }
  assert.equal(actual.width, reference.width); assert.equal(actual.height, reference.height);
  let errorSum = 0, changedPixels = 0;
  for (let i = 0; i < actual.data.length; i += 4) {
    const delta = [0, 1, 2].map(channel => Math.abs(actual.data[i + channel] - reference.data[i + channel]));
    errorSum += delta.reduce((a, b) => a + b, 0); if (Math.max(...delta) > 12) changedPixels++;
  }
  const pixelComparison = { meanError: errorSum / (actual.width * actual.height * 3), changedFraction: changedPixels / (actual.width * actual.height) };
  assert.ok(pixelComparison.meanError < 1 && pixelComparison.changedFraction < .005, JSON.stringify(pixelComparison));
  const before = await particles.evaluateAll(items => items.map(item => [item.getAttribute('cx'), item.getAttribute('cy')]));
  await page.getByRole('tab', { name: '基础', exact: true }).click();
  await text.fill('第二章'); await seek();
  await expect.poll(async () => JSON.stringify(await particles.evaluateAll(items => items.map(item => [item.getAttribute('cx'), item.getAttribute('cy')])))).not.toBe(JSON.stringify(before));
  await expect.poll(() => particles.count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const action = expandPreviewActions(saved, [{ kind: 'blueprint', blueprintId: graph.id }], previewActionContext(saved)).find(action => action.kind === 'visual');
  assert.ok(action?.kind === 'visual');
  assert.equal(action.glyphParticles?.source, 'text'); assert.equal(action.text, '第二章'); assert.equal(action.glyphParticles?.assetId, undefined);
  await page.screenshot({ path: path.join(output, 'particles.png') });
  await text.fill(''); await seek(); await expect(particles).toHaveCount(0);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', pixelComparison, checks: ['无图片素材时启用文字字形', '预览产生粒子，修改文字刷新取样', '原生 SVG 粒子与原 CSS 渐变逐像素对比', '文字模式及文本保存', '空文字无粒子'] }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined); await app.close(); console.log(output); }
