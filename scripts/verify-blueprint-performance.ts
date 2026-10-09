import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Project } from '../src/core/model';
import { addInteractionBlueprintExample } from '../src/core/blueprint-examples';
import { saveProject } from '../src/desktop/project-store';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const run = process.argv[2] ?? 'current';
const onlyParameters = process.argv.includes('--parameters-only');
const output = path.join(root, 'artifacts/blueprint-performance', `${run}-${new Date().toISOString().replaceAll(':', '-')}`);
const projectFile = path.join(output, 'project/project.vns.json');
const template = path.join(root, 'resources/templates/aihong');
const project: Project = JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8'));
project.name = '蓝图流畅度验证';
const sample = addInteractionBlueprintExample(project);
const graph = project.blueprints.find(graph => graph.id === sample.graphId)!;
await fs.mkdir(path.dirname(projectFile), { recursive: true });
// Reuse read-only bundled resources; all edits and autosaves stay in this fixture.
await fs.symlink(path.join(template, 'assets'), path.join(path.dirname(projectFile), 'assets'), 'junction');
await saveProject(projectFile, project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } });
await server.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile'), VNS_TEST_ROOT: path.join(output, 'created-projects'), VNS_DEV_URL: `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined;
const errors: string[] = [], phases: Record<string, unknown> = {};
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 60000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1560, 1000));
  await page.locator('.view-tabs').getByRole('button', { name: '蓝图', exact: true }).click();
  await page.getByLabel('蓝图类型', { exact: true }).selectOption('graph');
  await page.getByLabel('演出目标', { exact: true }).selectOption('graph:' + graph.id);
  await expect(page.locator('.generic-blueprint-workspace .react-flow__node')).toHaveCount(graph.nodes.length);
  await page.waitForTimeout(700);
  await page.evaluate(`(() => {
    window.__vnsPerf = { active: false, frames: [], tasks: [], last: 0 };
    new PerformanceObserver(list => { if (window.__vnsPerf.active) for (const entry of list.getEntries()) window.__vnsPerf.tasks.push(entry.duration); }).observe({ type: 'longtask' });
    const frame = now => { const p = window.__vnsPerf; if (p.active && p.last) p.frames.push(now - p.last); p.last = now; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  })()`);
  const cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable');
  const settle = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const measure = async (name: string, action: () => Promise<void>) => {
    await settle();
    await page.evaluate('Object.assign(window.__vnsPerf, { active: true, frames: [], tasks: [], last: 0 })');
    await cdp.send('Profiler.start');
    const started = performance.now(); await action(); await settle();
    const elapsed = performance.now() - started;
    const metrics = await page.evaluate(`(() => {
      const p = window.__vnsPerf; p.active = false;
      const frames = p.frames.slice().sort((a, b) => a - b);
      return { frames: frames.length, frameP95Ms: frames[Math.floor(frames.length * 0.95)] || 0, worstFrameMs: frames.at(-1) || 0, longTasks: p.tasks.length, longTaskTotalMs: p.tasks.reduce((a, b) => a + b, 0), longestTaskMs: Math.max(0, ...p.tasks) };
    })()`) as { frames: number; frameP95Ms: number; worstFrameMs: number; longTasks: number; longTaskTotalMs: number; longestTaskMs: number };
    const { profile } = await cdp.send('Profiler.stop');
    await fs.writeFile(path.join(output, `${name}.cpuprofile`), JSON.stringify(profile));
    phases[name] = { elapsedMs: elapsed, ...metrics };
    console.log(`${name}: ${JSON.stringify(phases[name])}`);
  };
  const visibleNodes = await page.evaluate(`(() => {
    const pane = document.querySelector('.generic-blueprint-workspace .flow-container').getBoundingClientRect();
    return [...document.querySelectorAll('.generic-blueprint-workspace .react-flow__node')].filter(node => {
      const r = node.querySelector('.graph-node-title').getBoundingClientRect();
      return r.left > pane.left + 12 && r.right < pane.right - 12 && r.top > pane.top + 12 && r.bottom < pane.bottom - 12;
    }).map(node => node.dataset.id);
  })()`) as string[];
  expect(visibleNodes.length).toBeGreaterThan(6);
  const title = (id: string) => page.locator(`.react-flow__node[data-id="${id}"] .graph-node-title`);
  if (!onlyParameters) {
  await measure('selection', async () => {
    for (const id of visibleNodes.slice(0, 10)) { await title(id).click({ force: true }); await settle(); }
  });
  const draggable = visibleNodes[3];
  await title(draggable).click({ force: true }); await settle();
  const beforeDrag = { x: graph.nodes.find(node => node.id === draggable)!.x, y: graph.nodes.find(node => node.id === draggable)!.y };
  await measure('drag', async () => {
    const r = (await title(draggable).boundingBox())!;
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + 110, r.y + r.height / 2 + 65, { steps: 80 });
    await page.mouse.up();
  });
  const canvas = (await page.locator('.generic-blueprint-workspace .flow-container').boundingBox())!;
  await measure('pan', async () => {
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(canvas.x + canvas.width / 2 - 170, canvas.y + canvas.height / 2 + 70, { steps: 80 });
    await page.mouse.up({ button: 'middle' });
  });
  await measure('zoom', async () => {
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, i < 4 ? -120 : 120); await page.waitForTimeout(80); }
    await page.waitForTimeout(250);
  });
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved: Project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  const moved = saved.blueprints.find(item => item.id === graph.id)!.nodes.find(item => item.id === draggable)!;
  expect({ x: moved.x, y: moved.y }).not.toEqual(beforeDrag);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const undone: Project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  const restored = undone.blueprints.find(item => item.id === graph.id)!.nodes.find(item => item.id === draggable)!;
  expect({ x: restored.x, y: restored.y }).toEqual(beforeDrag);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '框选全部节点', exact: true }).click(); await page.waitForTimeout(250);
  const editable = graph.nodes.find(node => node.type === 'random')!;
  await page.locator('.blueprint-toolbar .blueprint-title').click(); await page.keyboard.press('Escape');
  await page.locator('.blueprint-node-outline').getByRole('button', { name: editable.name, exact: true }).first().click(); await page.waitForTimeout(250);
  const number = page.locator(`.react-flow__node[data-id="${editable.id}"]`).getByLabel(`${editable.name} · ${editable.pins.find(pin => pin.id === 'min')!.name}`, { exact: true });
  await measure('parameters', async () => {
    for (const value of ['1', '12', '123', '-2.75']) { await number.fill(value); await settle(); }
  });
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'blueprint.png') });
  expect(errors).toEqual([]);
  const report = { status: 'passed', run, project: { blueprints: project.blueprints.length, assets: project.assets.length, components: project.ui.components?.length ?? 0, graphNodes: graph.nodes.length, graphLinks: graph.links.length }, phases, errors, packaged: false, userProjectModified: false };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output);
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phases, errors, error: String(error) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally {
  await app?.close().catch(() => {}); await server.close();
}
