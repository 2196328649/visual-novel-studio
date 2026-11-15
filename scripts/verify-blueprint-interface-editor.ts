import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlueprintInterfaceFixture } from './lib/blueprint-interface-fixture';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { fitBlueprintCanvas } from './lib/blueprint-canvas';
import { projectSchema } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { applyTextScript } from '../src/core/text-script';
import { cleanVerificationDirectories, type VerificationCleanup } from './lib/verification-cleanup';
import { openDisclosureAncestors } from './lib/ui-disclosures';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Only isolated development verification is permitted.');
const root = path.resolve('.'), output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? path.join(root, 'artifacts'), 'blueprint-interface-editor', new Date().toISOString().replaceAll(':', '-'));
const builtRenderer = process.env.VNS_VERIFY_BUILT_RENDERER === '1';
const fixture = createBlueprintInterfaceFixture(), { project, module, caller, call, other, events, pageCall } = fixture;
const projectFile = path.join(output, 'project/project.vns.json'); await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, project);
let server: ViteDevServer | undefined;
if (!builtRenderer) { server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**', '**/work/**'] } } }); await server.listen(); }
const devUrl = server ? 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port : undefined;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch', failure: string | undefined;
let cleanup: VerificationCleanup | undefined;
const checks: string[] = [], errors: string[] = [], processes: { pid?: number; alive: boolean }[] = [];
const node = (id: string) => page!.locator('.react-flow__node[data-id="' + id + '"]');
const dialog = () => page!.getByRole('dialog', { name: '确认接口修改', exact: true });
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const record = (text: string) => { checks.push(text); console.log('PASS ' + checks.length + ': ' + text); };
async function launch() {
  app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile, devUrl, sdkRoot: 'E:/Tools/renpy-8.5.3-sdk' });
  page = await app.firstWindow(); page.setDefaultTimeout(14000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
  if (builtRenderer) expect(fileURLToPath(page.url())).toBe(path.join(root, 'dist/index.html'));
}
async function close() {
  if (!app) return; const pid = app.process().pid; await app.close();
  let alive = false; if (pid) try { process.kill(pid, 0); alive = true; } catch { /* Isolated process exited. */ }
  processes.push({ pid, alive }); expect(alive).toBe(false); app = undefined;
}
async function openGraph(id: string) {
  await page!.locator('[data-workspace-tab="blueprint"]').click(); await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + id); await fitBlueprintCanvas(page!);
}
async function iface() {
  await page!.getByRole('button', { name: '输入与输出', exact: true }).click();
  await openModuleSettings();
}
async function openModuleSettings() {
  const description = page!.getByLabel('模块说明', { exact: true });
  await openDisclosureAncestors(description); await expect(description).toBeVisible();
}
const typeNames = { boolean: '开关', number: '数值', string: '文字', asset: '素材引用' } as const;
async function chooseType(owner: Locator | Page, label: string, type: keyof typeof typeNames) {
  const trigger = owner.getByRole('combobox', { name: label, exact: true });
  await expect(trigger).toHaveJSProperty('tagName', 'BUTTON'); await trigger.click();
  const options = page!.getByRole('listbox', { name: label + '选项', exact: true, includeHidden: true });
  await expect(options).toBeVisible(); await options.getByRole('option', { name: typeNames[type], exact: true }).click();
  await expect(options).toHaveCount(1); await expect(options).toBeHidden();
}
const members = (direction: 'input' | 'output') => page!.locator('[data-interface-direction="' + direction + '"]');
async function selectMember(direction: 'input' | 'output', id: string) {
  const section = members(direction), row = section.locator('[data-interface-pin-id="' + id + '"]');
  const select = row.locator('.blueprint-member-select');
  await select.click(); await expect(select).toHaveAttribute('aria-pressed', 'true');
  await expect(section.locator('[data-interface-details-id="' + id + '"]')).toBeVisible();
  await expect(section.locator('.blueprint-interface-card')).toHaveCount(1);
}
async function save(ui = false) {
  if (ui) { await page!.getByRole('button', { name: '保存界面', exact: true }).click(); await expect(page!.locator('.ui-save-status')).toHaveText('已保存'); await expect(page!.getByRole('button', { name: '保存界面', exact: true })).toBeDisabled(); }
  await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}
try {
  await launch(); await openGraph(module.id); await iface();
  phase = 'descriptions and usage inventory';
  await selectMember('input', 'amount');
  await page!.getByLabel('模块说明', { exact: true }).fill('读取数量并返回结果；允许零值。');
  await page!.getByLabel('数量的说明', { exact: true }).fill('次数，单位为个。');
  await page!.locator('.blueprint-graph-settings > summary').focus();
  const described = await save(); expect(described.scriptText?.content).toBe(project.scriptText?.content); expect(described.blueprints.find(g => g.id === module.id)?.description).toBe('读取数量并返回结果；允许零值。');
  expect(described.blueprints.find(g => g.id === caller.id)?.nodes.find(n => n.id === call.id)?.pins.find(p => p.id === 'arg_amount')?.description).toBe('次数，单位为个。');
  await expect(page!.getByRole('heading', { name: '调用与绑定 · 4', exact: true })).toBeVisible();
  await expect(page!.locator('.blueprint-properties')).toContainText('主调用入口（默认参数）运行要求');
  record('模块说明与参数说明持久化并同步调用引脚；总览同时列出两个蓝图调用、页面事件调用和剧本演出。');

  phase = 'asset browser Escape preserves member draft';
  const beforeAssetDraft = await fs.readFile(projectFile, 'utf8');
  const assetForm = members('input').getByRole('form', { name: '创建输入参数', exact: true });
  await members('input').getByRole('button', { name: '添加输入', exact: true }).click();
  await assetForm.getByLabel('新输入参数名称', { exact: true }).fill('未提交的素材输入');
  await chooseType(assetForm, '新输入参数类型', 'asset');
  const assetBrowserButton = assetForm.getByRole('button', { name: '浏览新输入参数默认值', exact: true });
  await expect(assetBrowserButton).toBeVisible();
  const assetDefault = assetForm.getByLabel('新输入参数使用默认值', { exact: true });
  await openDisclosureAncestors(assetDefault); await expect(assetDefault).not.toBeChecked(); await assetDefault.check();
  await assetBrowserButton.click();
  const assetBrowser = page!.getByRole('dialog', { name: '新输入参数默认值资源浏览器', exact: true });
  await expect(assetBrowser).toBeVisible();
  await expect.poll(() => assetBrowser.evaluate(element => element.contains(document.activeElement))).toBe(true);
  // The native dialog may initially focus its close button; exercise Escape
  // from the search field through the same click a user makes before typing.
  await assetBrowser.getByLabel('搜索可选资源', { exact: true }).click();
  await expect(assetBrowser.getByLabel('搜索可选资源', { exact: true })).toBeFocused();
  await page!.keyboard.press('Escape'); await expect(assetBrowser).toHaveCount(0);
  await expect(assetForm).toBeVisible(); await expect(assetForm.getByLabel('新输入参数名称', { exact: true })).toHaveValue('未提交的素材输入');
  await expect(assetForm.getByRole('combobox', { name: '新输入参数类型', exact: true })).toContainText('素材引用');
  await expect(assetDefault).toBeChecked(); await expect(assetBrowserButton).toBeFocused();
  await assetBrowserButton.click(); await assetBrowser.getByRole('button', { name: '使用选择素材', exact: true }).click();
  await expect(assetBrowser).toHaveCount(0); await expect(assetDefault).toBeChecked(); await expect(assetBrowserButton).toBeVisible();
  await assetDefault.uncheck(); await expect(assetDefault).not.toBeChecked(); await expect(assetBrowserButton).toBeVisible();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); expect(await fs.readFile(projectFile, 'utf8')).toBe(beforeAssetDraft);
  await assetForm.getByLabel('新输入参数名称', { exact: true }).press('Escape'); await expect(assetForm).toHaveCount(0);
  await expect(members('input').getByRole('button', { name: '添加输入', exact: true })).toBeFocused();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); expect(await fs.readFile(projectFile, 'utf8')).toBe(beforeAssetDraft);
  record('素材默认选择器在未设值时仍可用，清空引用保留默认值开关，仅取消开关移除默认；浏览器Escape保留未提交草稿，再在名称框Escape取消新项，整个过程不修改工程。');

  phase = 'member drafts, defaults and atomic creation';
  for (const direction of ['input', 'output'] as const) {
    const beforeDrafts = await fs.readFile(projectFile, 'utf8');
    const section = members(direction), label = direction === 'input' ? '输入参数' : '输出结果', short = direction === 'input' ? '输入' : '输出';
    const form = section.getByRole('form', { name: '创建' + label, exact: true });
    const originalPin = direction === 'input' ? module.exposedInputs[0] : module.exposedOutputs[0];
    await section.getByRole('button', { name: '添加' + short, exact: true }).click();
    await expect(form.getByLabel('新' + label + '名称', { exact: true })).toBeFocused();
    await expect(form.getByRole('button', { name: '创建' + short, exact: true })).toBeDisabled();
    await form.getByLabel('新' + label + '名称', { exact: true }).fill(originalPin.name);
    await expect(form.getByRole('button', { name: '创建' + short, exact: true })).toBeDisabled();
    await form.getByLabel('新' + label + '名称', { exact: true }).fill('取消的' + label);
    await form.getByLabel('新' + label + '名称', { exact: true }).press('Escape'); await expect(form).toHaveCount(0);
    await expect(page!.locator('.dirty-dot')).toHaveCount(0); expect(await fs.readFile(projectFile, 'utf8')).toBe(beforeDrafts);

    const name = direction === 'input' ? '新开关输入' : '新文字结果', type = direction === 'input' ? 'boolean' : 'string';
    const initial = direction === 'input' ? false : '';
    await section.getByRole('button', { name: '添加' + short, exact: true }).click();
    await form.getByLabel('新' + label + '名称', { exact: true }).fill(name);
    await chooseType(form, '新' + label + '类型', type);
    await expect(form.getByRole('combobox', { name: '新' + label + '类型', exact: true })).toContainText(typeNames[type]);
    await expect(form.getByLabel('新' + label + '默认值', { exact: true })).toHaveValue(String(initial));
    await form.getByRole('button', { name: '创建' + short, exact: true }).click(); await expect(form).toHaveCount(0);
    await expect(section.getByRole('button', { name: '编辑' + label + ' ' + name, exact: true })).toBeFocused();
    const created = await save(), graph = created.blueprints.find(graph => graph.id === module.id)!;
    const pin = (direction === 'input' ? graph.exposedInputs : graph.exposedOutputs).find(pin => pin.name === name)!;
    expect(pin).toMatchObject({ dataType: type, defaultValue: initial, required: false });
    for (const [graphId, nodeId] of [[caller.id, call.id], [caller.id, other.id], [events.id, pageCall.id]]) {
      const node = created.blueprints.find(graph => graph.id === graphId)!.nodes.find(node => node.id === nodeId)!;
      expect(node.pins.find(item => item.id === (direction === 'input' ? 'arg_' : 'out_') + pin.id)?.dataType).toBe(type);
    }
    await selectMember(direction, pin.id); await selectMember(direction, originalPin.id);
    await section.getByLabel('搜索' + label, { exact: true }).fill(name);
    await expect(section.locator('[data-interface-pin-id]')).toHaveCount(1);
    await expect(section.locator('[data-interface-pin-id="' + pin.id + '"]')).toBeVisible();
    await section.getByLabel('搜索' + label, { exact: true }).fill('');
    await expect(page!.locator('.dirty-dot')).toHaveCount(0);
    await page!.getByRole('button', { name: '撤销', exact: true }).click(); let restored = await save();
    expect(restored.blueprints).toEqual(described.blueprints); expect(restored.scriptText).toEqual(described.scriptText);
    await page!.getByRole('button', { name: '重做', exact: true }).click(); restored = await save(); expect(restored.blueprints).toEqual(created.blueprints);
    await page!.getByRole('button', { name: '撤销', exact: true }).click(); restored = await save(); expect(restored.blueprints).toEqual(described.blueprints);
  }
  record('输入与输出加号共用可取消新项，空名和重名不能提交；假值和空文字默认值保留，接口与调用者一次撤销重做，搜索只切换成员列表。');

  phase = 'unreferenced removal preserves member focus';
  await fitBlueprintCanvas(page!); await node(fixture.write.id).locator('.graph-node-title strong').click(); await iface();
  const nodeIdsBeforeRemoval = await page!.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')));
  const selectedBeforeRemoval = await page!.locator('.react-flow__node.selected').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')));
  expect(selectedBeforeRemoval).toEqual([fixture.write.id]);
  const outputMembers = members('output'), focusForm = outputMembers.getByRole('form', { name: '创建输出结果', exact: true });
  await outputMembers.getByRole('button', { name: '添加输出', exact: true }).click();
  await focusForm.getByLabel('新输出结果名称', { exact: true }).fill('焦点验收临时结果');
  await focusForm.getByRole('button', { name: '创建输出', exact: true }).click();
  await expect(outputMembers.getByRole('button', { name: '编辑输出结果 焦点验收临时结果', exact: true })).toBeFocused();
  const beforeRemoval = await save();
  await outputMembers.getByRole('button', { name: '删除输出结果 焦点验收临时结果', exact: true }).click();
  await expect(dialog()).toHaveCount(0);
  await expect(outputMembers.getByRole('button', { name: '编辑输出结果 焦点验收临时结果', exact: true })).toHaveCount(0);
  await expect(outputMembers.getByRole('button', { name: '编辑输出结果 结果', exact: true })).toBeFocused();
  expect(await outputMembers.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page!.keyboard.press('Delete'); await page!.keyboard.press('Control+d');
  expect(await page!.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')))).toEqual(nodeIdsBeforeRemoval);
  expect(await page!.locator('.react-flow__node.selected').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')))).toEqual(selectedBeforeRemoval);
  const afterRemoval = await save(); expect(afterRemoval.blueprints).toEqual(described.blueprints); expect(afterRemoval.scriptText).toEqual(described.scriptText);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); expect((await save()).blueprints).toEqual(beforeRemoval.blueprints);
  await page!.getByRole('button', { name: '重做', exact: true }).click(); expect((await save()).blueprints).toEqual(afterRemoval.blueprints);
  record('新增后焦点进入新成员；无引用输出删除后焦点回剩余成员，Delete/Ctrl+D不影响原画布选择，删除仍可一次撤销重做。');

  phase = 'usage navigation'; const originalBytes = await fs.readFile(projectFile, 'utf8');
  await page!.getByRole('button', { name: caller.name + ' / ' + call.name, exact: true }).click();
  await expect(node(call.id)).toHaveClass(/selected/); await expect(page!.getByLabel('蓝图资源', { exact: true })).toHaveValue('graph:' + caller.id);
  await expect(page!.locator('.blueprint-properties')).toContainText('读取数量并返回结果');
  await page!.getByRole('button', { name: '返回调用位置', exact: true }).click(); await openModuleSettings();
  await page!.getByRole('button', { name: events.name + ' / ' + pageCall.name, exact: true }).click();
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(events.id); await expect(node(pageCall.id)).toHaveClass(/selected/);
  await page!.getByRole('button', { name: '返回调用位置', exact: true }).click(); await openModuleSettings();
  expect(await fs.readFile(projectFile, 'utf8')).toBe(originalBytes); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  record('调用位置可定位到原调用节点和所属页面，并返回模块的接口页；整个查看过程不写盘、不产生撤销项。');

  phase = 'cancel destructive changes';
  await selectMember('input', 'amount');
  await page!.getByRole('button', { name: '删除输入参数 数量', exact: true }).click(); await expect(dialog()).toBeVisible();
  await expect(dialog().locator('[data-impact-kind="removedLink"]')).toHaveCount(1);
  await expect(dialog().locator('[data-impact-kind="removedValue"]')).toHaveCount(2);
  await expect(dialog().locator('[data-impact-kind="missingParameter"]')).toHaveCount(1);
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768));
  const button = (await dialog().getByRole('button', { name: '确认修改', exact: true }).boundingBox())!; expect(button.y + button.height).toBeLessThanOrEqual(768);
  expect(await page!.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page!.screenshot({ path: path.join(output, 'interface-impact-1024.png') });
  await dialog().getByRole('button', { name: '取消', exact: true }).focus(); await page!.keyboard.press('Delete'); await page!.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0); expect(await fs.readFile(projectFile, 'utf8')).toBe(originalBytes); await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
  record('删除前逐项展示将断开的连线、已填写参数与失效读取节点；1024 宽确认按钮可见，Delete/Escape 不误删，取消没有副作用。');

  phase = 'type change and one-step undo';
  await chooseType(page!, '数量的数据类型', 'boolean'); await expect(dialog()).toBeVisible();
  await expect(dialog().locator('[data-impact-kind="invalidLink"]')).toHaveCount(2);
  await expect(dialog().locator('[data-impact-kind="invalidValue"]')).toHaveCount(2);
  await dialog().getByRole('button', { name: '确认修改', exact: true }).click(); await expect(dialog()).toHaveCount(0);
  let saved = await save(), changedCaller = saved.blueprints.find(g => g.id === caller.id)!;
  expect(changedCaller.links).toEqual(caller.links); expect(changedCaller.nodes.find(n => n.id === other.id)?.properties.arg_amount).toBe(0);
  expect(changedCaller.nodes.find(n => n.id === call.id)?.pins.find(p => p.id === 'arg_amount')?.dataType).toBe('boolean');
  expect(saved.scriptText?.content).toBe(project.scriptText?.content);
  expect(compileProject(saved).diagnostics.some(d => d.severity === 'error')).toBe(true);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); expect(saved.blueprints).toEqual(described.blueprints);
  await page!.getByRole('button', { name: '重做', exact: true }).click(); saved = await save(); expect(saved.blueprints.find(g => g.id === module.id)?.exposedInputs[0].dataType).toBe('boolean');
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); await save();
  record('类型变更保留不兼容连线和显式零值并显示诊断；接口与所有调用者一次撤销/重做，不静默转换数值。');

  phase = 'delete output and restore'; await iface();
  await selectMember('output', 'answer');
  await page!.getByRole('button', { name: '删除输出结果 结果', exact: true }).click(); await expect(dialog()).toBeVisible();
  await expect(dialog().locator('[data-impact-kind="removedLink"]')).toHaveCount(1); await expect(dialog().locator('[data-impact-kind="missingParameter"]')).toHaveCount(1);
  await dialog().getByRole('button', { name: '确认修改', exact: true }).click(); saved = await save();
  expect(saved.blueprints.find(g => g.id === module.id)?.exposedOutputs).toHaveLength(0);
  expect(saved.blueprints.find(g => g.id === caller.id)?.links.some(link => link.fromPinId === 'out_answer')).toBe(false);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save(); expect(saved.blueprints).toEqual(described.blueprints);
  record('删除输出只断开其对应连线；读写旧接口的节点留下明确诊断，撤销完整恢复接口、节点和连线。');

  phase = 'delete input and preserve text'; await iface();
  await selectMember('input', 'amount');
  await page!.getByRole('button', { name: '删除输入参数 数量', exact: true }).click(); await expect(dialog()).toBeVisible();
  await dialog().getByRole('button', { name: '确认修改', exact: true }).click(); saved = await save();
  const story = saved.nodes.find(n => n.id === fixture.passage.id)!; expect(story.kind).toBe('passage');
  if (story.kind === 'passage') expect(story.lines[0].actions).toEqual([{ kind: 'blueprint', blueprintId: module.id }]);
  expect(saved.scriptText!.content).toContain('// 模块接口验收：保留作者注释与空行\n\n');
  expect(saved.scriptText!.content.endsWith('\n\n// 文本尾部')).toBe(true);
  expect(applyTextScript(saved, saved.scriptText!.content).issues.filter(issue => issue.severity === 'error')).toEqual([]);
  await page!.getByRole('button', { name: '撤销', exact: true }).click(); saved = await save();
  expect(saved.blueprints).toEqual(described.blueprints); expect(saved.scriptText).toEqual(described.scriptText);
  record('删除输入同步清理剧情实参，仅补丁修改该演出指令；作者注释、空行和台词保留，单次撤销完整恢复。');

  phase = 'reopen invalid interface and repair'; await iface();
  await selectMember('input', 'amount');
  await chooseType(page!, '数量的数据类型', 'boolean'); await expect(dialog()).toBeVisible();
  await dialog().getByRole('button', { name: '确认修改', exact: true }).click(); saved = await save();
  const invalidBytes = await fs.readFile(projectFile, 'utf8'); await close(); await launch(); await openGraph(module.id); await iface();
  await expect(page!.getByRole('combobox', { name: '数量的数据类型', exact: true })).toContainText('开关');
  expect(await fs.readFile(projectFile, 'utf8')).toBe(invalidBytes);
  await page!.getByRole('button', { name: events.name + ' / ' + pageCall.name, exact: true }).click();
  await expect(page!.getByLabel('当前页面事件图', { exact: true })).toHaveValue(events.id); await expect(node(pageCall.id)).toHaveClass(/selected/);
  await page!.getByRole('button', { name: '返回调用位置', exact: true }).click(); await openModuleSettings();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); expect(await fs.readFile(projectFile, 'utf8')).toBe(invalidBytes);
  await page!.getByLabel('模块说明', { exact: true }).fill('接口正在修复，原实参应保留。');
  saved = await save(); expect(saved.blueprints.find(g => g.id === module.id)?.description).toBe('接口正在修复，原实参应保留。');
  expect(saved.scriptText?.content).toBe(project.scriptText?.content);
  await chooseType(page!, '数量的数据类型', 'number'); await expect(dialog()).toHaveCount(0);
  await expect(page!.getByRole('combobox', { name: '数量的数据类型', exact: true })).toContainText('数值');
  await page!.getByLabel('数量的默认值', { exact: true }).fill('2');
  await page!.getByLabel('模块说明', { exact: true }).fill('读取数量并返回结果；允许零值。');
  await page!.locator('.blueprint-graph-settings > summary').focus(); saved = await save();
  expect(saved.blueprints).toEqual(described.blueprints); expect(saved.scriptText).toEqual(described.scriptText);
  expect(compileProject(saved).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  record('带失效接口与文本调用的工程可保存重开并继续编辑；修复类型后原数值实参和连线恢复有效，未改写作者文本。');

  phase = 'reopen'; const persisted = await fs.readFile(projectFile, 'utf8'); await close(); await launch(); await openGraph(module.id); await iface();
  await expect(page!.getByLabel('模块说明', { exact: true })).toHaveValue('读取数量并返回结果；允许零值。');
  await expect(page!.getByLabel('数量的说明', { exact: true })).toHaveValue('次数，单位为个。');
  await expect(page!.getByRole('heading', { name: '调用与绑定 · 4', exact: true })).toBeVisible();
  expect(await fs.readFile(projectFile, 'utf8')).toBe(persisted); expect(errors).toEqual([]);
  expect(compileProject(await read()).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  await page!.screenshot({ path: path.join(output, 'module-interface-reopened.png') });
  record('保存重开保留说明、调用列表和合法接口；查看不制造脏状态，无脚本错误，最终工程编译无错误。');
} catch (error) { failure = String(error); console.error(phase, error); await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined); }
finally {
  try { await close(); } catch (error) { failure ??= String(error); }
  try { await server?.close(); } catch (error) { failure ??= 'Server cleanup: ' + String(error); }
  try { if (app) throw new Error('Fixture is still running.'); cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); expect(cleanup.errors).toEqual([]); } catch (error) { failure ??= 'Directory cleanup: ' + String(error); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure || errors.length ? 'failed' : 'passed', renderer: builtRenderer ? 'built' : 'development', phase, checks, errors, processes, failure, projectFile, cleanup }, null, 2));
}
console.log('Report: ' + path.join(output, 'report.json')); if (failure || errors.length) process.exitCode = 1;
