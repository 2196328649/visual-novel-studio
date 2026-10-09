import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, projectSchema } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.'), output = path.join(root, 'artifacts/default-font', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const project = createProject('默认字体验收');
const object = { ...createVisualObject('text'), text: '第一章 春日\nChapter 1', duration: 5 };
const graph = blueprintFromPerformance(project, [object], '文字字体'); project.blueprints.push(graph);
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(projectSchema.parse(project)));
await fs.writeFile(path.join(output, 'probe.txt'), 'project asset');
const sdkRoot = path.resolve('..');
const app = await launchDesktopFixture({ root, projectFile, sdkRoot, profile: path.join(output, 'profile') });
const page = await app.firstWindow();
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await page.locator('[data-workspace-tab="blueprint"]').click();
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  await page.getByRole('button', { name: '时间轴', exact: true }).click();
  await expect(page.locator('[data-visual-text]').first()).toContainText('第一章');
  const result = await page.evaluate(async () => {
    const url = window.studio!.defaultFontUrl!();
    const response = await fetch(url), bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
    const fonts = await document.fonts.load('32px vns_runtime_default', '第一章');
    const family = getComputedStyle(document.querySelector('[data-visual-text]')!).fontFamily;
    const denied = [];
    for (const target of ['studio-asset://runtime/renpy.py', 'studio-asset://runtime/%2e%2e%2frenpy.py', 'studio-asset://unknown/probe.txt', 'studio-asset://project/%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json']) denied.push((await fetch(target)).status);
    const projectAsset = await (await fetch(window.studio!.assetUrl('probe.txt'))).text();
    return { status: response.status, type: response.headers.get('content-type'), hash, family, fontStatus: fonts.map(font => font.status), denied, projectAsset };
  });
  assert.equal(result.status, 200); assert.equal(result.type, 'font/ttf');
  assert.equal(result.hash, createHash('sha256').update(await fs.readFile(path.join(sdkRoot, 'sdk-fonts/SourceHanSansLite.ttf'))).digest('hex'));
  assert.match(result.family, /vns_runtime_default/); assert.deepEqual(result.fontStatus, ['loaded']);
  assert.deepEqual(result.denied, [404, 404, 404, 404]); assert.equal(result.projectAsset, 'project asset');
  await page.screenshot({ path: path.join(output, 'text.png') });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', result }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); throw error; }
finally { await app.close(); console.log(output); }
