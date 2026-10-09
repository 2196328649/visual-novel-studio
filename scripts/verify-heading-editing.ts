import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createProject, type Project } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';
import { saveProject } from '../src/desktop/project-store';
import { enterFixtureProject, launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root = path.resolve('.');
const output = path.resolve('artifacts/heading-editing', new Date().toISOString().replaceAll(':', '-'));
const file = path.join(output, 'project/project.vns.json');
const firstText = '所幸可以写信，我打定主意，待我寻到爹娘，一定要写信给他俩，如若可以，希望能给她们寻个更好的去处。';
const secondText = '盐池里解州并不算远，不过几日光景，我们到了盐池的一处客栈。';
const source = `@入口：开始【entry】
#章节：第一章【chapter_first】
#小章节：开场【scene_first】
@节点标记：开始【entry】
@开始
@节点标记：正文【passage】
@对白标记：line_one
旁白：${firstText}
@对白标记：line_two
旁白：${secondText}
#章节：第二章【chapter_second】
#小章节：余波【scene_second】
@节点标记：结尾【ending】
@返回标题界面
`;
const initial = applyTextScript(createProject('章节改名与参数提示验收'), source);
assert.deepEqual(initial.issues, []);
await saveProject(file, initial.project);
const app = await launchDesktopFixture({ root, projectFile: file, profile: path.join(output, 'profile') });
const page = await app.firstWindow(), checks: string[] = [], errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
let phase = 'launch';
const input = page.getByLabel('中文文本剧本', { exact: true });
const labels = page.locator('.story-directory .chapter-label > span');
const menu = page.getByRole('listbox', { name: '文本补全建议' });
const note = page.getByRole('note', { name: '目录参数提示' });
const choose = async (name: string) => menu.getByRole('option').getByText(name, { exact: true }).click();
const select = async (marker: string, length = 0, after = 0) => {
  await input.evaluate((element, { marker, length, after }) => {
    const textarea = element as HTMLTextAreaElement, found = textarea.value.indexOf(marker);
    if (found < 0) throw new Error(`Missing marker: ${marker}`);
    textarea.focus({ preventScroll: true }); textarea.setSelectionRange(found + after, found + after + length);
    textarea.scrollTop = Math.max(0, (textarea.value.slice(0, found).split('\n').length - 4) * parseFloat(getComputedStyle(textarea).lineHeight));
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    textarea.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, { marker, length, after });
};
const save = async () => {
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const stored = JSON.parse(await fs.readFile(file, 'utf8')) as Project;
  // Saving retains a text draft; applying it is a separate authoring action.
  const parsed = applyTextScript(stored, stored.scriptText!.content), saved = parsed.project;
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(saved.chapters.map(chapter => chapter.id), ['chapter_first', 'chapter_second']);
  assert.equal(saved.scenes.find(scene => scene.id === 'scene_first')?.chapterId, 'chapter_first');
  assert.deepEqual(saved.nodes.map(node => node.id), initial.project.nodes.map(node => node.id));
  assert.deepEqual(saved.nodes.find(node => node.id === 'passage'), initial.project.nodes.find(node => node.id === 'passage'));
  assert.deepEqual(compileProject(saved).diagnostics.filter(issue => issue.severity === 'error'), []);
  return saved;
};
try {
  await expect(page.locator('.project-title strong')).toHaveText(initial.project.name, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1440, 960); window.show(); window.focus(); });
  await openStoryMode(page, 'text');
  await expect(labels).toHaveText(['第一章', '第二章']);
  expect(await input.inputValue()).toContain('#章节：第一章');
  expect(await input.inputValue()).not.toContain('第二章');

  phase = 'clear and rename';
  await select('第一章', '第一章'.length); await input.press('Backspace');
  expect(await input.inputValue()).not.toContain('【');
  await page.keyboard.insertText('归');
  await expect(labels).toHaveText(['归', '第二章']);
  let saved = await save();
  assert.ok(saved.scriptText!.content.includes('#章节：归【chapter_first】'));
  checks.push('清空旧章节名后输入新名，目录立即更新；保存保留章节、小章节、节点和台词的身份。');

  phase = 'typing parentheses';
  await select('：归'); await page.keyboard.insertText('(');
  expect(await input.inputValue()).toContain('#章节(：归');
  expect(await input.inputValue()).not.toContain('第二章');
  expect(await input.inputValue()).not.toContain('【');
  await expect(note.locator('strong')).toHaveText('#章节');
  await expect(menu.locator('strong')).toHaveText(['流程图', '显示名称']);
  await page.keyboard.insertText(')'); await input.press('ArrowLeft');
  await expect(menu.locator('strong')).toHaveText(['流程图', '显示名称']);
  await page.screenshot({ path: path.join(output, 'heading-parameter-names.png') });
  await choose('流程图');
  await expect(menu.locator('strong')).toHaveText(['是', '否']);
  await page.screenshot({ path: path.join(output, 'heading-parameter-values.png') });
  await choose('否');
  expect(await input.inputValue()).toContain('#章节(流程图=否)：归');
  await expect(labels).toHaveText(['归', '第二章']);
  checks.push('逐字输入括号不切换当前章节、不显示隐藏编号；括号中提示参数名和“是／否”。');

  phase = 'parameter buttons and quoted punctuation';
  await note.getByRole('button', { name: '填写显示名称' }).click();
  await page.keyboard.insertText('"酒醒, A)B: C"');
  expect(await input.inputValue()).toContain('#章节(流程图=否，显示名称="酒醒, A)B: C")：归');
  expect(await input.inputValue()).toContain(secondText);
  await expect(labels).toHaveText(['归', '第二章']);
  await expect(page.locator('.text-issue.error')).toHaveCount(0);
  saved = await save();
  assert.deepEqual(saved.chapters[0].flowchart, { visible: false, name: '酒醒, A)B: C' });
  checks.push('参数按钮在闭括号前插入字段，引号内逗号、括号、冒号不影响标题和正文。');

  phase = 'replace entire heading';
  const heading = (await input.inputValue()).split('\n')[0];
  await select(heading, heading.length); await page.keyboard.insertText('#章节(流程图=是，显示名称="归章"):归途');
  await expect(labels).toHaveText(['归途', '第二章']);
  saved = await save();
  assert.ok(saved.scriptText!.content.includes(':归途【chapter_first】'));
  checks.push('整行替换章节声明仍修改原章节，不生成旧章节残留。');

  phase = 'Chinese parentheses on subchapter';
  await select('#小章节：开场', '#小章节：开场'.length); await page.keyboard.insertText('#小章节（）：开场');
  await select('（）：开场', 0, 1); await input.press('ArrowRight'); await input.press('ArrowLeft');
  await expect(note.locator('strong')).toHaveText('#小章节');
  await choose('显示名称'); await page.keyboard.insertText('"客栈"');
  await expect(page.locator('.text-issue.error')).toHaveCount(0);
  saved = await save();
  assert.equal(saved.scenes.find(scene => scene.id === 'scene_first')?.flowchart?.name, '客栈');
  const editedText = await input.inputValue();
  checks.push('小章节的中文括号可直接补全，保持其名称与章节归属。');

  phase = 'save and reopen';
  await page.reload(); await enterFixtureProject(page, file);
  await expect(page.locator('.project-title strong')).toHaveText(initial.project.name);
  await openStoryMode(page, 'text');
  await expect(input).toHaveValue(editedText);
  await expect(labels).toHaveText(['归途', '第二章']);
  await page.getByRole('button', { name: '应用到项目', exact: true }).click();
  await save();
  const applied: Project = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(applied.chapters.map(chapter => [chapter.id, chapter.name]), [['chapter_first', '归途'], ['chapter_second', '第二章']]);
  assert.deepEqual(applied.chapters[0].flowchart, { visible: true, name: '归章' });
  await page.screenshot({ path: path.join(output, 'renamed-directory.png') });
  await openStoryMode(page, 'script');
  const first = page.locator('#line-line_one'), second = page.locator('#line-line_two');
  await expect(first.locator('textarea')).toHaveValue(firstText);
  await expect(second.locator('textarea')).toHaveValue(secondText);
  assert.equal(await first.evaluate(element => element.nextElementSibling?.id), 'line-line_two');
  assert.equal(await first.evaluate(element => element.closest('.passage-section') === document.getElementById('line-line_two')?.closest('.passage-section')), true);
  checks.push('保存重开后新章节名和参数保持；两句连续正文仍是同一模块内相邻的两行。');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, file }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), errors, checks, text: await input.inputValue().catch(() => undefined), directory: await labels.allTextContents().catch(() => undefined) }, null, 2));
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
  await app.close().catch(() => undefined); console.log(output);
}
