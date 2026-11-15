import { selectUiDesignScheme } from './lib/ui-design-controls';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { createProject, projectSchema } from '../src/core/model';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Scheme acceptance uses the isolated development editor.');
const root = path.resolve('.'), output = path.resolve('artifacts/ui-scheme-editor', new Date().toISOString().replaceAll(':', '-'));
const project = createProject('方案事件图编辑验收');
project.ui.instances = [
  { id: 'scheme_a', name: '方案A', components: [{ id: 'title_probe', kind: 'text', page: 'main', text: '方案A标题', x: .1, y: .1, width: .5, height: .1 }] },
  { id: 'scheme_b', name: '方案B', components: [{ id: 'title_b', kind: 'text', page: 'main', text: '方案B标题', x: .1, y: .1, width: .5, height: .1 }] },
];
project.ui.activeInstanceId = 'scheme_a';
const projectFile = path.join(output, 'project/project.vns.json');
let app: ElectronApplication | undefined, page: Page | undefined, server: ViteDevServer | undefined;
const errors: string[] = [], checks: string[] = [];
const report: Record<string, unknown> = { status: 'running', errors, checks };
const read = async () => projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8')));
const mode = (name: string) => page!.getByLabel('界面编辑模式').getByRole('button', { name, exact: true });
async function openScheme(id: string) {
  await page!.locator('[data-workspace-tab="ui"]').click(); await mode('设计').click();
  await selectUiDesignScheme(page!, id); await mode('事件图').click();
}
async function create() {
  await page!.getByRole('button', { name: '创建页面事件图', exact: true }).click();
  await page!.getByRole('button', { name: '＋ 定时事件', exact: true }).click();
  await expect(page!.locator('.react-flow__node')).toHaveCount(2);
}
async function save() {
  await page!.getByRole('button', { name: '保存界面', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0); return read();
}
try {
  await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, project);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/work/**', '**/resources/**', '**/release/**'] } } }); await server.listen();
  app = await launchDesktopFixture({ root, projectFile, profile: path.join(output, 'profile'), devUrl: 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await openScheme('scheme_a'); await create(); assert.equal((await read()).blueprints.length, 0);
  await page.locator('[data-workspace-tab="script"]').click();
  await page.getByRole('dialog', { name: '保存界面修改' }).getByRole('button', { name: '不保存', exact: true }).click();
  await openScheme('scheme_a'); await expect(page.getByRole('button', { name: '创建页面事件图', exact: true })).toBeVisible();
  assert.equal((await read()).blueprints.length, 0); checks.push('未保存退出丢弃方案事件图，不写入磁盘。');
  const graphIds = new Map<string, string>();
  for (const id of ['scheme_a', 'scheme_b']) {
    await openScheme(id); await create(); const saved = await save();
    const graph = saved.blueprints.find(graph => graph.uiInstanceId === id)!; assert.ok(graph); graphIds.set(id, graph.id);
    assert.equal(graph.uiPageId, 'ui:main');
    const timer = graph.nodes.find(node => node.type === 'eventTimer')!;
    assert.equal(timer.properties.uiInstanceId, id); assert.equal(timer.properties.pageId, 'ui:main');
    checks.push(id + ' 通过当前事件图入口创建，图和定时事件绑定同一页面及方案。');
  }
  assert.equal((await read()).blueprints.length, 2);
  for (const id of ['scheme_a', 'scheme_b', 'scheme_a']) {
    await openScheme(id); await expect(page.getByLabel('当前页面事件图', { exact: true })).toHaveValue(graphIds.get(id)!);
  }
  await save();
  checks.push('往返切换两套方案只显示各自事件图，返回后图 ID 保持。');
  await page.screenshot({ path: path.join(output, 'scheme-events.png') });
  await mode('设计').click(); await expect(page.locator('.ui-canvas')).toBeVisible();
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 45000 });
  await openScheme('scheme_a'); await expect(page.getByLabel('当前页面事件图', { exact: true })).toHaveValue(graphIds.get('scheme_a')!);
  await mode('设计').click(); await expect(page.locator('.ui-canvas')).toBeVisible();
  checks.push('保存重开与返回设计模式保留方案、图及页面绑定。');
  assert.deepEqual(errors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app?.close().catch(() => undefined); await server?.close();
  const cleanup = await cleanVerificationDirectories(output, ['project', 'profile']); report.cleanup = cleanup;
  if (cleanup.errors.length) { report.status = 'failed'; process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(path.join(output, 'report.json'));
  if (report.error) console.error(report.error);
}
