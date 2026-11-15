import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

const root = path.resolve('.');
const artifactRoot = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/module-row-separators');
const relativeArtifactRoot = path.relative(root, artifactRoot);
assert.ok(relativeArtifactRoot && !relativeArtifactRoot.startsWith('..') && !path.isAbsolute(relativeArtifactRoot), 'verification artifacts must stay inside the workspace');
const output = path.join(artifactRoot, new Date().toISOString().replaceAll(':', '-'));
const projectFile = path.join(output, 'project/project.vns.json');
const project = createProject('模块台词分隔线验收'), passage = project.nodes.find(node => node.kind === 'passage')!;
assert.equal(passage.kind, 'passage');
const captions = ['第一句', '第二句', '第三句', '比起她们，我学的很慢。', '第一次洗碗，五个碗被我不小心打碎了三个……', '第一次给客人上菜，一屉包子被我失手打翻……', '第一次打扫卫生，却不小心碰倒了酒坛……', '这次“闯祸”后，鸢姐姐便只让我做些洒扫一类的轻活儿，还必须和翠儿和红儿一起。我听着鸢姐姐嘱咐的话，羞愧的低下了头。'];
passage.textHeading = false;
passage.lines = Array.from({ length: 72 }, (_, index) => ({ id: `separator_${index + 1}`, text: captions[index] ?? (index % 9 === 0 ? '较长的台词用于检查自动换行后的分隔线。'.repeat(5) : `第 ${index + 1} 句台词。`), actions: [] }));
project.nodes = [passage]; project.entryId = passage.id; delete passage.next;
await fs.mkdir(path.dirname(projectFile), { recursive: true });
await fs.writeFile(projectFile, JSON.stringify(project));
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const errors: string[] = [], checks: string[] = [], samples: unknown[] = [], spacing: Record<string, unknown> = {};

const settle = async () => page!.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => undefined)));
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});
const position = async (id = 'separator_4') => {
  await page!.locator('.script-scroll').evaluate((element, id) => {
    (document.activeElement as HTMLElement)?.blur();
    const row = document.getElementById(`line-${id}`)!;
    element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - 15;
  }, id);
  await page!.mouse.move(0, 0); await settle();
};
const color = (value: string) => value.startsWith('#') ? [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16)) : (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
async function inspect(label: string, required: boolean, screenshot = false) {
  await settle();
  const geometry = await page!.locator('.script-scroll').evaluate(element => {
    const viewport = element.getBoundingClientRect(), border = getComputedStyle(document.documentElement).getPropertyValue('--editor-border').trim();
    return { width: innerWidth, dpr: devicePixelRatio, viewport: { top: viewport.top, bottom: viewport.bottom }, rows: Array.from(element.querySelectorAll<HTMLElement>('.story-line')).flatMap(row => {
      const rect = row.getBoundingClientRect(), style = getComputedStyle(row);
      if (rect.bottom <= viewport.top + 8 || rect.bottom >= viewport.bottom - 8) return [];
      const input = row.querySelector('.dialogue-input')!.getBoundingClientRect(), speaker = row.querySelector('.line-top > select')!.getBoundingClientRect();
      return [{ id: row.id, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height, border, background: style.backgroundColor, visibility: style.contentVisibility, input: { top: input.top, height: input.height }, speaker: { top: speaker.top, height: speaker.height } }];
    }) };
  });
  // Capture the actual Electron surface: Playwright's default CSS clip crops
  // or pads it when webContents zoom differs from 100%.
  const encoded = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  const buffer = Buffer.from(encoded, 'base64'), image = PNG.sync.read(buffer), scale = geometry.dpr;
  const rows = geometry.rows.map(row => {
    assert.ok(row.bottom * scale < image.height && row.right * scale < image.width, `${label}: measured boundaries must be inside the captured surface`);
    const background = color(row.background), border = color(row.border), delta = border.map((channel, index) => channel - background[index]);
    const magnitude = delta.reduce((sum, value) => sum + value * value, 0);
    let coverage = 0, pixelY = -1;
    // Rasterized edges can round to the next physical pixel at fractional DPI.
    for (let y = Math.max(0, Math.floor((row.bottom - 3) * scale)); y <= Math.min(image.height - 1, Math.ceil(row.bottom * scale) + 1); y++) {
      let painted = 0;
      for (let step = 1; step <= 21; step++) {
        const x = Math.round((row.left + (row.right - row.left) * step / 22) * scale), at = (y * image.width + x) * 4;
        const strength = delta.reduce((sum, channel, index) => sum + (image.data[at + index] - background[index]) * channel, 0) / magnitude;
        if (strength >= .3 && strength <= 1.3) painted++;
      }
      if (painted / 21 > coverage) { coverage = painted / 21; pixelY = y; }
    }
    return { ...row, coverage, pixelY };
  });
  const missing = rows.filter(row => row.coverage < .95);
  samples.push({ label, dpr: geometry.dpr, scale, rows, missing: missing.map(row => row.id) });
  if (screenshot || missing.length) await fs.writeFile(path.join(output, `${label}.png`), buffer);
  assert.ok(rows.length >= 2, `${label}: need multiple visible row boundaries`);
  if (required) assert.deepEqual(missing, [], `${label}: every visible row must have a full-width painted separator`);
  console.log(JSON.stringify({ label, dpr: geometry.dpr, boundaries: rows.length, missing: missing.map(row => row.id) }));
  return missing.length;
}

try {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window.isMaximized()) window.unmaximize(); window.webContents.setBackgroundThrottling(false); window.setContentSize(1600, 1050); });
  await page.evaluate('globalThis.__name = value => value');
  await openStoryMode(page, 'script');
  // Same rows and browser, with only the old border rule restored for diagnosis.
  phase = 'legacy border comparison';
  const legacy = await page.addStyleTag({ content: '.text-source-panel .story-lines > .story-line { padding-bottom: 9px; border-bottom-width: 1px; box-shadow: none; }.text-source-panel .dialogue-input { align-self: stretch; min-height: 38px; padding: 7px 8px; line-height: 1.7; }.text-source-panel .line-top > select { height: auto; min-height: 26px; padding: 6px; margin-top: 4px; }.text-source-panel .line-actions { grid-row: 2; align-self: start; margin-top: 4px; }.text-source-panel .line-effects:not(.line-text-effects) { grid-column: 1 / -1; }' });
  let legacyMissing = 0;
  for (const zoom of [1, .8, 1.25, 1.5, 1.75]) {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), zoom);
    await position(); legacyMissing += await inspect(`legacy-${zoom}`, false, zoom === 1);
  }
  await legacy.evaluate(element => element.parentNode?.removeChild(element));
  phase = 'corrected borders across zoom levels';
  for (const zoom of [1, .8, 1.25, 1.5, 1.75]) {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), zoom);
    await position(); await inspect(`corrected-${zoom}`, true, zoom === 1);
    const controls = await page.locator('#line-separator_3').evaluate(row => {
      const input = row.querySelector('.dialogue-input')!.getBoundingClientRect(), speaker = row.querySelector('select')!.getBoundingClientRect();
      return { inputHeight: input.height, speakerHeight: speaker.height, inputTop: input.top, speakerTop: speaker.top };
    });
    assert.ok(Math.abs(controls.inputTop - controls.speakerTop) < 1 && Math.abs(controls.inputHeight - controls.speakerHeight) < 1, `${zoom}: single-line dialogue and speaker controls must align: ${JSON.stringify(controls)}`);
  }
  checks.push(`五档缩放下可见台词均有实际分隔线像素；同环境旧绘制漏线 ${legacyMissing} 处。`);
  checks.push('五档缩放下单行台词框和说话人下拉框上下对齐、高度一致。');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await position();
  const fifth = page.locator('#line-separator_5'), sixth = page.locator('#line-separator_6');
  const compactLayout = async (target = fifth) => target.evaluate(row => {
    const bounds = row.getBoundingClientRect(), input = row.querySelector('.dialogue-input')!.getBoundingClientRect();
    const stage = row.querySelector('.line-effects:not(.line-text-effects)')!.getBoundingClientRect(), actions = row.querySelector('.line-actions')!.getBoundingClientRect();
    return { height: bounds.height, bottomSpace: bounds.bottom - input.bottom, stageGap: actions.left - stage.right, inputGap: actions.left - input.right, actionsBottomSpace: bounds.bottom - actions.bottom, stageAboveDialogue: input.top - stage.bottom };
  });
  spacing.normal = await compactLayout();
  await fifth.hover({ position: { x: 10, y: 15 } }); await settle();
  spacing.hover = await compactLayout();
  const sameSpacing = (actual: unknown, before: unknown) => {
    for (const key of ['height', 'bottomSpace', 'stageGap', 'inputGap', 'actionsBottomSpace']) assert.ok(Math.abs((actual as Record<string, number>)[key] - (before as Record<string, number>)[key]) < .1, `${key} must not shift on hover or focus`);
  };
  sameSpacing(spacing.hover, spacing.normal);
  const compact = spacing.hover as Awaited<ReturnType<typeof compactLayout>>;
  assert.ok(compact.bottomSpace >= 6 && compact.bottomSpace <= 12, `excess space below dialogue: ${JSON.stringify(compact)}`);
  assert.ok(compact.stageGap >= 4 && compact.inputGap >= 4 && compact.actionsBottomSpace >= 6, `buttons must stay beside stage and dialogue: ${JSON.stringify(compact)}`);
  assert.ok(await fifth.locator('.line-actions > button').evaluateAll(buttons => buttons.every(button => {
    const box = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })), 'all four row actions must be reachable');
  await fifth.locator('.dialogue-input').focus(); await inspect('selected-fifth', true, true);
  spacing.focused = await compactLayout();
  sameSpacing(spacing.focused, spacing.normal);
  await sixth.locator('.dialogue-input').focus(); await inspect('selected-sixth', true);
  const viewport = await page.locator('.script-scroll').boundingBox(); assert.ok(viewport);
  await page.mouse.move(viewport.x + viewport.width - 24, viewport.y + viewport.height / 2);
  for (let index = 0; index < 10; index++) await page.mouse.wheel(0, 500);
  await expect.poll(() => page!.locator('.script-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(1500);
  await inspect('scrolled-down', true);
  await position(); await inspect('returned-fifth-sixth', true, true);
  phase = 'expanded row and editing';
  await fifth.locator('.line-expand').click();
  await expect(fifth.locator('.line-text-effects')).toBeVisible();
  await position('separator_6');
  await inspect('expanded-fifth-bottom', true, true);
  await fifth.locator('.line-expand').click(); await position();
  await sixth.getByRole('button', { name: '为第6行添加效果', exact: true }).click();
  const menu = sixth.getByRole('menu', { name: '添加本行演出', exact: true });
  await expect(menu).toBeVisible();
  assert.ok(await menu.getByRole('menuitem', { name: '显示文字', exact: true }).evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }));
  await menu.getByRole('menuitem', { name: '等待', exact: true }).click();
  await expect(sixth.getByRole('region', { name: '编辑等待', exact: true })).toBeVisible();
  await expect(sixth.getByLabel('等待 秒', { exact: true })).toHaveValue('1');
  await settle();
  spacing.stageExpanded = await compactLayout(sixth);
  const stageExpanded = spacing.stageExpanded as Awaited<ReturnType<typeof compactLayout>>;
  assert.ok(stageExpanded.stageAboveDialogue >= 4 && stageExpanded.stageGap >= 4 && stageExpanded.bottomSpace <= 12, `expanded stage stays above dialogue without overlapping the action column: ${JSON.stringify(stageExpanded)}`);
  await inspect('stage-expanded', true, true);
  await sixth.getByRole('button', { name: '收起演出编辑', exact: true }).click();
  await settle();
  spacing.stageCollapsed = await compactLayout(sixth);
  assert.ok((spacing.stageCollapsed as { bottomSpace: number }).bottomSpace <= 12, 'stage chips must not add blank space below dialogue');
  await page.getByRole('button', { name: '撤销', exact: true }).first().click();
  await expect(sixth.locator('.line-effect-chip')).toHaveCount(0);
  await fifth.locator('.dialogue-input').fill(captions[4] + '编辑检查');
  await page.getByRole('button', { name: '撤销', exact: true }).first().click();
  await expect(fifth.locator('.dialogue-input')).toHaveValue(captions[4]);
  await expect(sixth.locator('.dialogue-input')).toHaveValue(captions[5]);
  await fifth.locator('.dialogue-input').fill('第一行\n第二行\n第三行');
  const multiline = await fifth.evaluate(row => {
    const input = row.querySelector<HTMLTextAreaElement>('.dialogue-input')!, speaker = row.querySelector('select')!;
    return { height: input.getBoundingClientRect().height, speakerHeight: speaker.getBoundingClientRect().height, scrollHeight: input.scrollHeight, clientHeight: input.clientHeight };
  });
  assert.ok(multiline.height > multiline.speakerHeight * 1.5 && multiline.scrollHeight <= multiline.clientHeight + 1, `multiline dialogue must grow without clipping: ${JSON.stringify(multiline)}`);
  spacing.multiline = await compactLayout();
  assert.ok((spacing.multiline as { bottomSpace: number }).bottomSpace <= 12, 'multiline dialogue must not retain the old action-button blank space');
  await page.getByRole('button', { name: '撤销', exact: true }).first().click();
  await expect(fifth.locator('.dialogue-input')).toHaveValue(captions[4]);
  await expect(page.locator('.story-line')).toHaveCount(72);
  checks.push('第5、6句选中、滚动往返、展开后分界正常；舞台菜单可命中，台词仍可独立编辑和撤销。');
  checks.push('单行和多行台词下方只保留6～12px间距，悬停与选中不跳高；右侧四个按钮均可命中且不遮挡舞台或台词。');
  checks.push('舞台动作标签及展开的参数仍位于台词上方，与右侧操作按钮互不遮挡，收起后底部间距保持紧凑。');
  phase = 'light theme';
  await page.getByRole('button', { name: '作品设置', exact: true }).click();
  await page.getByRole('button', { name: '编辑器外观', exact: true }).click();
  await page.getByRole('button', { name: /^亮白/ }).click();
  await page.getByRole('button', { name: '关闭作品设置', exact: true }).click();
  await position(); await inspect('light-theme', true, true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 860));
  await position(); await inspect('narrow-light-theme', true, true);
  spacing.narrow = await compactLayout();
  assert.ok((spacing.narrow as { bottomSpace: number }).bottomSpace <= 12, 'narrow pane must keep compact dialogue spacing');
  checks.push('亮色主题和1180px窄窗口的分隔线仍完整，延后屏外排版策略保留。');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, spacing, samples, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, spacing, samples, errors }, null, 2)); throw error;
} finally {
  await app?.close();
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
