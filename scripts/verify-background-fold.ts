import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/background-fold', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const png = new PNG({ width: 16, height: 16 });
for (let i = 0; i < png.data.length; i += 4) png.data.set([32, 64, 96, 255], i);
await fs.writeFile(path.join(output, 'courtyard.png'), PNG.sync.write(png));
const base = createProject('独立演出后背景折叠验收');
base.assets.push({ id: 'courtyard', name: '王家大院 · 夜宴', kind: 'image', path: 'courtyard.png' });
base.blueprints.push(blueprintFromPerformance(base, [{ kind: 'pause', seconds: .2 }], '章节进入演出'));
const project = applyTextScript(base, '@章节进入演出\n@演出转场：方式=纯色，淡出=0.5，停留=0，淡入=0.5，颜色=#000000\n@独立演出：段落 1\n旁白：在解州客栈的几个月里，鸢姐姐对我很好。').project;
const originalNodes = structuredClone(project.nodes);
const dialogue = project.nodes.find(node => node.kind === 'passage' && !node.lines[0].silent)!;
assert.equal(dialogue.kind, 'passage');
const command = '@背景：王家大院 · 夜宴\n';
const source = projectToText(project);
const marker = source.lastIndexOf('@节点标记', source.indexOf('旁白：'));
project.scriptText!.content = source.slice(0, marker) + command + source.slice(marker);
const projectFile = path.join(output, 'project.vns.json');
await fs.writeFile(projectFile, JSON.stringify(project));
let app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
let page = await app.firstWindow();
const errors: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error.message));
let phase = 'launch';
try {
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await openStoryMode(page, 'text');
  let input = page.getByLabel('中文文本剧本', { exact: true });
  const selectDialogue = async () => {
    const text = await input.inputValue(), at = text.indexOf('旁白：');
    assert.ok(at >= 0);
    await input.press('Control+Home');
    for (let i = 1; i < text.slice(0, at).split('\n').length; i++) {
      await input.press('Escape');
      await input.press('ArrowDown');
    }
    await input.press('Home');
  };
  const toggle = page.getByRole('button', { name: '隐藏演出', exact: true });
  phase = 'existing hidden marker';
  await expect(input).toHaveValue(/@背景：王家大院 · 夜宴/);
  await toggle.click();
  await expect(input).not.toHaveValue(/@背景/);
  await expect(input).toHaveValue(/@独立演出：段落 1/);
  await selectDialogue();
  await expect(page.getByRole('region', { name: '所选段落演出' })).toHaveAttribute('data-node-id', dialogue.id);
  await expect(page.locator('.passage-performance-line.active')).toHaveAttribute('data-line-id', dialogue.lines[0].id);
  await expect(page.locator('.passage-performance-line.active')).toContainText('背景');
  await page.screenshot({ path: path.join(output, 'existing-background-hidden.png') });
  checks.push('已有背景写在隐藏节点标记之前时，隐藏演出将其收进后续旁白，预览参数属于正确台词。');

  phase = 'insert background in hidden mode';
  await toggle.click();
  await expect(input).toHaveValue(/@背景/);
  await input.fill((await input.inputValue()).replace(command, ''));
  await toggle.click();
  await selectDialogue();
  await page.keyboard.insertText(command);
  await expect(input).not.toHaveValue(/@背景/);
  await selectDialogue();
  await expect(page.locator('.passage-performance-line.active')).toHaveAttribute('data-line-id', dialogue.lines[0].id);
  await expect(page.locator('.passage-performance-line.active')).toContainText('背景');
  await toggle.click();
  await expect(input).toHaveValue(/@背景：王家大院 · 夜宴\n旁白：/);
  await toggle.click();
  await expect(input).not.toHaveValue(/@背景/);
  checks.push('开启隐藏演出时在首句前插入背景并换行，立即收起；显示／隐藏往返保留指令和台词身份。');

  phase = 'save and reopen';
  await page.getByRole('button', { name: '应用到项目', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved: Project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  assert.equal(saved.nodes.length, originalNodes.length);
  const savedDialogue = saved.nodes.find(node => node.id === dialogue.id);
  assert.ok(savedDialogue?.kind === 'passage');
  assert.equal(savedDialogue.lines[0].id, dialogue.lines[0].id);
  assert.deepEqual(savedDialogue.lines[0].actions, [{ kind: 'background', assetId: 'courtyard', transition: 'dissolve' }]);
  const standalone = originalNodes.find(node => node.kind === 'passage' && node.lines[0].silent)!;
  assert.deepEqual(saved.nodes.find(node => node.id === standalone.id), standalone);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()));
  await app.close();
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile') });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await openStoryMode(page, 'text');
  input = page.getByLabel('中文文本剧本', { exact: true });
  await expect(input).not.toHaveValue(/@背景/);
  await selectDialogue();
  await expect(page.locator('.passage-performance-line.active')).toHaveAttribute('data-line-id', dialogue.lines[0].id);
  await expect(page.locator('.passage-performance-line.active')).toContainText('背景');
  await page.screenshot({ path: path.join(output, 'reopened-background-hidden.png') });
  checks.push('应用、保存、完全关闭重开后仍正确隐藏；独立演出、转场、节点连接及台词编号保持不变，没有新增空白行。');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'failure-input.json'), JSON.stringify(await page.getByLabel('中文文本剧本', { exact: true }).evaluate(element => {
    const input = element as HTMLTextAreaElement;
    return { text: input.value, start: input.selectionStart, end: input.selectionEnd, active: input.ownerDocument.activeElement === input };
  }).catch(() => null), null, 2));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, errors }, null, 2));
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close();
  console.log(output);
}
