import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, type Project } from '../src/core/model';
import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';
import { storyContentId, storyScopeKey } from '../src/core/story-graph';
import { storySceneNodeId } from '../src/core/story-groups';
import { saveProject } from '../src/desktop/project-store';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/blueprint-selection-editor', 'selection-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const projectFile = path.join(output, 'project/project.vns.json');
const project = createProject('蓝图框选与参数验收'), graph = createBlueprintGraph('function', '框选测试'), other = createBlueprintGraph('function', '另一张图');
graph.nodes = [];
const event = blueprintNodeDefaults('event'), delay = blueprintNodeDefaults('delay'), finish = blueprintNodeDefaults('return'), random = blueprintNodeDefaults('random'), math = blueprintNodeDefaults('math');
for (const [node, id, x, y] of [[event, 'event', 0, 0], [delay, 'delay', 650, 0], [finish, 'finish', 1300, 0], [random, 'random', 0, 420], [math, 'math', 650, 420]] as const) { Object.assign(node, { id, x, y }); graph.nodes.push(node); }
connectBlueprintPins(graph, event.id, 'exec', delay.id, 'exec_in');
connectBlueprintPins(graph, delay.id, 'exec_out', finish.id, 'exec_in');
connectBlueprintPins(graph, random.id, 'value', math.id, 'a');
project.blueprints = [graph, other];
const sceneId = project.scenes[0].id;
project.entryId = 'story_start';
project.nodes = [
  { id: 'story_start', name: '开始', kind: 'start', sceneId, x: 0, y: 0, next: 'story_a' },
  { id: 'story_a', name: '段落甲', kind: 'passage', sceneId, x: 650, y: 0, next: 'story_end', lines: [{ id: 'line_a', text: '测试对白甲。', actions: [] }] },
  { id: 'story_end', name: '结局甲', kind: 'end', sceneId, x: 1300, y: 0 },
  { id: 'story_b', name: '段落乙', kind: 'passage', sceneId, x: 0, y: 420, next: 'story_end_b', lines: [{ id: 'line_b', text: '测试对白乙。', actions: [] }] },
  { id: 'story_end_b', name: '结局乙', kind: 'end', sceneId, x: 650, y: 420 },
];
await fs.mkdir(path.dirname(projectFile), { recursive: true }); await saveProject(projectFile, project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } }); await server.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: path.join(output, 'profile'), VNS_TEST_ROOT: path.join(output, 'created-projects'), VNS_DEV_URL: process.env.VNS_SELECTION_DIST === '1' ? '' : `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch';
const errors: string[] = [], checks: string[] = [];
type Point = { x: number; y: number };
const node = (id: string) => page!.locator(`.react-flow__node[data-id="${id}"]`);
const edge = (id: string) => page!.locator(`.react-flow__edge[data-id="${id}"]`);
const record = (message: string) => { checks.push(message); console.log(`PASS ${checks.length}: ${message}`); };
const launch = async () => {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env: { ...env, VNS_TEST_DISCARD_ON_CLOSE: '1' }, timeout: 60000 });
  page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1700, 1100));
};
const save = async () => { await page!.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page!.locator('.dirty-dot')).toHaveCount(0); return JSON.parse(await fs.readFile(projectFile, 'utf8')) as Project; };
const undo = () => page!.getByRole('button', { name: '撤销', exact: true }).click();
const redo = () => page!.getByRole('button', { name: '重做', exact: true }).click();
const savedGraph = (saved: Project) => saved.blueprints.find(item => item.id === graph.id)!;
// Read hit testing to find real pane space outside nodes, wires and the multi-selection overlay.
const clear = async () => {
  let point: Point | undefined;
  await expect.poll(async () => {
    point = await page!.evaluate(() => {
      const pane = document.querySelector('.flow-container .react-flow__pane'); if (!pane) return undefined;
      const bounds = pane.getBoundingClientRect(), left = Math.max(0, bounds.left) + 12, top = Math.max(0, bounds.top) + 12;
      const right = Math.min(innerWidth, bounds.right) - 12, bottom = Math.min(innerHeight, bounds.bottom) - 12;
      for (let y = top; y < bottom; y += 24) for (let x = left; x < right; x += 24) if (document.elementFromPoint(x, y) === pane) return { x, y };
      return undefined;
    });
    return !!point;
  }, { message: 'Clearing selection requires an unobstructed canvas pane point.' }).toBe(true);
  expect(await page!.evaluate(at => document.elementFromPoint(at.x, at.y)?.classList.contains('react-flow__pane'), point!)).toBe(true);
  await page!.mouse.click(point!.x, point!.y);
  await expect(page!.locator('.react-flow__node.selected')).toHaveCount(0); await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(0);
};
const fit = async (story = false) => {
  if (story) await page!.locator('.react-flow__controls-fitview').click(); else await page!.getByRole('button', { name: '框选全部节点', exact: true }).click();
  await page!.waitForTimeout(260);
};
const openGraph = async (id = graph.id) => {
  await page!.locator('[data-workspace-tab="blueprint"]').click();
  await page!.getByLabel('蓝图资源', { exact: true }).selectOption('graph:' + id); await fit();
};
const marquee = async (from: Point, to: Point) => {
  await page!.mouse.move(from.x, from.y); await page!.mouse.down(); await page!.mouse.move(to.x, to.y, { steps: 16 }); await page!.mouse.up();
};
const partialNode = async (id: string) => {
  const box = (await node(id).boundingBox())!;
  await marquee({ x: box.x - 18, y: box.y - 16 }, { x: box.x + 16, y: box.y + 12 });
  await expect(node(id)).toHaveClass(/selected/); await expect(page!.locator('.react-flow__node.selected')).toHaveCount(1);
};
const wirePoint = async (id: string, fraction = 0.5): Promise<Point> => page!.evaluate(`(() => {
  const path = document.querySelector('.react-flow__edge[data-id="' + ${JSON.stringify(id)} + '"] .react-flow__edge-path');
  const point = path.getPointAtLength(path.getTotalLength() * ${fraction}), at = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
  return { x: at.x, y: at.y };
})()`) as Promise<Point>;
const selectWireBox = async (id: string) => { const point = await wirePoint(id); await marquee({ x: point.x - 20, y: point.y - 18 }, { x: point.x + 20, y: point.y + 18 }); await expect(edge(id)).toHaveClass(/selected/); await expect(page!.locator('.react-flow__node.selected')).toHaveCount(0); };
const groupDrag = async (ids: string[], story = false) => {
  await clear(); await node(ids[0]).locator('.graph-node-title').click(); await page!.keyboard.down('Control');
  for (const id of ids.slice(1)) await node(id).locator('.graph-node-title').click();
  await page!.keyboard.up('Control'); await expect(page!.locator('.react-flow__node.selected')).toHaveCount(ids.length);
  const positions = (saved: Project) => (story ? saved.nodes : savedGraph(saved).nodes).filter(node => ids.includes(node.id)).map(node => ({ id: node.id, x: node.x, y: node.y }));
  const before = positions(await save()), box = (await node(ids[0]).locator('.graph-node-title').boundingBox())!;
  await page!.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page!.mouse.down(); await page!.mouse.move(box.x + box.width / 2 + 75, box.y + box.height / 2 + 36, { steps: 30 }); await page!.mouse.up();
  const after = positions(await save()); expect(after).not.toEqual(before);
  for (let i = 0; i < after.length; i++) { expect(after[i].x - before[i].x).toBeCloseTo(after[0].x - before[0].x, 3); expect(after[i].y - before[i].y).toBeCloseTo(after[0].y - before[0].y, 3); }
  await undo(); expect(positions(await save())).toEqual(before); await redo(); expect(positions(await save())).toEqual(after);
};
const allBox = async () => {
  const box = await page!.evaluate(`(() => { const boxes = [...document.querySelectorAll('.react-flow__node')].map(node => node.getBoundingClientRect()); return { left: Math.min(...boxes.map(box => box.left)), top: Math.min(...boxes.map(box => box.top)), right: Math.max(...boxes.map(box => box.right)), bottom: Math.max(...boxes.map(box => box.bottom)) }; })()`) as { left: number; top: number; right: number; bottom: number };
  await marquee({ x: box.left - 10, y: box.top - 10 }, { x: box.right + 10, y: box.bottom + 10 });
};

try {
  await launch(); await openGraph(); await clear();
  phase = 'partial node selection'; await partialNode(delay.id);
  record('节点只与框选区域相交即可选中，无需全部包住。');

  phase = 'node-only marquee delete'; await clear();
  const upper = (await node(event.id).boundingBox())!, lower = (await node(random.id).boundingBox())!;
  await marquee({ x: upper.x - 16, y: upper.y - 16 }, { x: lower.x + 16, y: lower.y + 20 });
  await expect(page!.locator('.react-flow__node.selected')).toHaveCount(2); await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(0);
  const beforeNodesDelete = savedGraph(await save()); await page!.keyboard.press('Delete');
  const deletedNodes = savedGraph(await save()); expect(deletedNodes.nodes.map(node => node.id).sort()).toEqual([delay.id, finish.id, math.id].sort());
  expect(deletedNodes.links.map(link => link.id)).toEqual([graph.links[1].id]);
  await undo(); expect(savedGraph(await save())).toEqual(beforeNodesDelete); await redo(); expect(savedGraph(await save())).toEqual(deletedNodes); await undo(); await save();
  record('只框到多个节点时 Del 会删除整组及关联连线，保留其他节点；一次撤销与重做均完整恢复。');

  phase = 'independent wire marquee'; await clear(); await selectWireBox(graph.links[0].id);
  await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(1);
  const beforeWireDelete = savedGraph(await save()); await page!.keyboard.press('Delete');
  let current = savedGraph(await save()); expect(current.nodes).toEqual(beforeWireDelete.nodes); expect(current.links.length).toBe(beforeWireDelete.links.length - 1);
  await undo(); expect(savedGraph(await save())).toEqual(beforeWireDelete);
  await clear();
  const top = await wirePoint(graph.links[0].id), bottom = await wirePoint(graph.links[2].id);
  await marquee({ x: top.x - 16, y: Math.min(top.y, bottom.y) - 15 }, { x: bottom.x + 16, y: Math.max(top.y, bottom.y) + 15 });
  await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(2); await expect(page!.locator('.react-flow__node.selected')).toHaveCount(0);
  await expect(page!.getByText('已选中 2 条连线：按 Delete 断开，拖动端点可改接。', { exact: true })).toBeVisible();
  await page!.screenshot({ path: path.join(output, 'wire-marquee.png') });
  // Wires keep a wide click area; a drag that starts on the wire itself still draws a marquee.
  await clear(); const onWire = await wirePoint(graph.links[0].id);
  await marquee(onWire, { x: onWire.x + 30, y: onWire.y + 24 });
  await expect(edge(graph.links[0].id)).toHaveClass(/selected/); await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(1); await expect(page!.locator('.react-flow__node.selected')).toHaveCount(0);
  record('框选能独立选中一条或多条连线，端点在选框外也有效，从连线上起拖同样框选；单线删除和一次撤销通过。');

  phase = 'mixed selection and undo'; await clear(); await partialNode(finish.id);
  await page!.keyboard.down('Control'); const mixed = await wirePoint(graph.links[2].id); await page!.mouse.click(mixed.x, mixed.y); await page!.keyboard.up('Control');
  await expect(node(finish.id)).toHaveClass(/selected/); await expect(edge(graph.links[2].id)).toHaveClass(/selected/);
  const beforeMixed = savedGraph(await save()); await page!.keyboard.press('Delete'); current = savedGraph(await save());
  expect(current.nodes.some(node => node.id === finish.id)).toBe(false); expect(current.links.some(link => link.id === graph.links[2].id)).toBe(false);
  await undo(); expect(savedGraph(await save())).toEqual(beforeMixed); await redo(); expect(savedGraph(await save())).toEqual(current); await undo(); await save();
  await clear(); await fit(); await allBox(); await expect(page!.locator('.react-flow__node.selected')).toHaveCount(graph.nodes.length); await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(graph.links.length);
  await page!.keyboard.press('Delete'); expect(savedGraph(await save()).nodes.length).toBe(0); await undo(); expect(savedGraph(await save())).toEqual(beforeMixed);
  record('Ctrl 可混选节点和连线；框选全图后删除可一次撤销，混合删除也可整体重做。');

  phase = 'multi node drag'; await fit(); await groupDrag([random.id, math.id]);
  record('多选拖动会保存所有节点的位置，撤销和重做同时恢复整组节点。');

  phase = 'parameter collapse and handle geometry'; await clear(); await fit();
  const beforeCollapse = savedGraph(await save()), height = (await node(math.id).boundingBox())!.height;
  const handles = await node(math.id).locator('.react-flow__handle').count();
  await node(math.id).getByRole('button', { name: '收起节点参数', exact: true }).click();
  await expect(node(math.id).getByRole('button', { name: '展开节点参数', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(node(math.id).locator('input, select')).toHaveCount(0); expect(await node(math.id).locator('.react-flow__handle').count()).toBe(handles);
  expect((await node(math.id).boundingBox())!.height).toBeLessThan(height);
  await expect.poll(async () => {
    const endpoint = await wirePoint(graph.links[2].id, 1), handle = (await node(math.id).locator('.react-flow__handle[data-handleid="a"]').boundingBox())!;
    // React Flow attaches a left-side wire at the outside of its handle.
    return Math.hypot(endpoint.x - handle.x, endpoint.y - handle.y - handle.height / 2);
  }).toBeLessThan(2);
  expect(savedGraph(await save())).toEqual(beforeCollapse);
  await page!.getByRole('button', { name: '收起全部节点参数', exact: true }).click(); await expect(page!.locator('.blueprint-graph-node:not(.parameters-collapsed)')).toHaveCount(0);
  await page!.screenshot({ path: path.join(output, 'collapsed-parameters.png') });
  await openGraph(other.id); await openGraph(); await expect(page!.locator('.blueprint-graph-node:not(.parameters-collapsed)')).toHaveCount(0);
  await page!.getByRole('button', { name: '展开全部节点参数', exact: true }).click(); await expect(node(math.id).getByLabel(`${math.name} · 运算`, { exact: true })).toBeVisible();
  expect(savedGraph(await save())).toEqual(beforeCollapse);
  record('单个与全部参数可收起/展开，端口始终保留并随节点尺寸更新；切图保留偏好且不改作品数据。');

  phase = 'wire hit testing at normal and low zoom'; await clear(); await fit();
  for (const delta of [-240, 900]) {
    const point = await wirePoint(graph.links[0].id); await page!.mouse.move(point.x, point.y); await page!.mouse.wheel(0, delta); await page!.waitForTimeout(300); await clear();
    const at = await wirePoint(graph.links[0].id); await page!.mouse.click(at.x, at.y + 9); await expect(edge(graph.links[0].id)).toHaveClass(/selected/);
  }
  record('正常与缩小视图中，离细线 9 像素仍能点中，连线点击区域不随缩放变窄。');

  phase = 'story graph marquee and atomic undo'; await page!.locator('[data-workspace-tab="flowchart"]').click(); await fit(true); await clear();
  const flowWorkspace = page!.locator('.unified-flow-workspace'); await expect(flowWorkspace).toHaveAttribute('data-flow-scope', 'game');
  // Built-in game flow and story contents now live in separate canvas scopes.
  const builtInIds = await page!.locator('.react-flow__node-gameFlow').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')!)); expect(builtInIds.length).toBeGreaterThan(0);
  const beforeBuiltInDelete = await save(); expect(beforeBuiltInDelete.gameFlow?.beforeTitle.steps ?? []).toHaveLength(0); expect(beforeBuiltInDelete.gameFlow?.beforeNewGame ?? []).toHaveLength(0);
  await allBox(); await expect(page!.locator('.react-flow__node-gameFlow.selected')).toHaveCount(builtInIds.length); await expect(node(storyContentId)).toHaveClass(/selected/);
  // Select protected nodes without their editable wires, then verify Delete preserves the whole project.
  await clear(); await node(builtInIds[0]).locator('.graph-node-title').click(); await page!.keyboard.down('Control');
  for (const id of [...builtInIds.slice(1), storyContentId]) await node(id).locator('.graph-node-title').click();
  await page!.keyboard.up('Control'); await expect(page!.locator('.react-flow__node.selected')).toHaveCount(builtInIds.length + 1); await expect(page!.locator('.react-flow__edge.selected')).toHaveCount(0);
  await page!.keyboard.press('Delete'); expect(await save()).toEqual(beforeBuiltInDelete); await expect(page!.locator('.react-flow__node-gameFlow')).toHaveCount(builtInIds.length); await expect(node(storyContentId)).toBeVisible();
  await clear(); await node(storyContentId).locator('.graph-node-title strong').dblclick(); await expect(flowWorkspace).toHaveAttribute('data-flow-scope', 'content');
  await node(storySceneNodeId(sceneId)).locator('.graph-node-title strong').dblclick(); const sceneScopeKey = storyScopeKey({ kind: 'scene', sceneId }); await expect(flowWorkspace).toHaveAttribute('data-flow-scope', sceneScopeKey);
  await fit(true); await clear(); await expect(page!.locator('.react-flow__node-story')).toHaveCount(project.nodes.length); await expect(page!.locator('.react-flow__node-gameFlow')).toHaveCount(0);
  await partialNode('story_a'); await clear(); await selectWireBox('story_start:next');
  await page!.keyboard.press('Delete'); expect((await save()).nodes.find(node => node.id === 'story_start')).not.toHaveProperty('next'); await undo(); await save();
  await clear(); await fit(true); await groupDrag(['story_b', 'story_end_b'], true); await clear(); await fit(true);
  // Story-entry and return references are selected with the stories; Delete preserves the entry reference.
  const references = await page!.locator('.react-flow__node-storyContainer').count(), entryReference = 'story:ref:' + sceneScopeKey + ':in:entry'; expect(references).toBeGreaterThan(0); await expect(node(entryReference)).toBeVisible();
  const beforeStory = (await save()).nodes; await allBox(); await expect(page!.locator('.react-flow__node.selected')).toHaveCount(project.nodes.length + references);
  await expect(page!.locator('.react-flow__node-story.selected')).toHaveCount(project.nodes.length);
  await expect(page!.locator('.react-flow__node-storyContainer.selected')).toHaveCount(references);
  await page!.keyboard.press('Delete'); await expect(page!.locator('.react-flow__node-story')).toHaveCount(1); await expect(page!.locator('.react-flow__node-storyContainer')).toHaveCount(1); await expect(node(entryReference)).toBeVisible(); expect((await save()).nodes.map(node => node.id)).toEqual([project.entryId]);
  await expect(page!.locator('[data-workspace-tab="flowchart"]')).toHaveClass(/active/);
  await page!.screenshot({ path: path.join(output, 'story-cleared-entry.png') });
  await undo(); expect((await save()).nodes).toEqual(beforeStory); await expect(page!.locator('.react-flow__node-storyContainer')).toHaveCount(references);
  await redo(); await expect(page!.locator('.react-flow__node-story')).toHaveCount(1); await expect(node(entryReference)).toBeVisible(); expect((await save()).nodes.map(node => node.id)).toEqual([project.entryId]);
  await undo(); expect((await save()).nodes).toEqual(beforeStory); await expect(page!.locator('.react-flow__node-storyContainer')).toHaveCount(references);
  await page!.getByLabel('流程图位置', { exact: true }).getByRole('button', { name: '流程图', exact: true }).click(); await expect(flowWorkspace).toHaveAttribute('data-flow-scope', 'game'); await expect(page!.locator('.react-flow__node-gameFlow')).toHaveCount(builtInIds.length);
  record('分层剧情流程支持部分相交、独立框选连线和整组移动；剧情与引用混选删除一次撤销重做，开始节点、入口引用与顶层内置流程受保护。');

  phase = 'restart preference persistence'; await openGraph(); await node(math.id).getByRole('button', { name: '收起节点参数', exact: true }).click(); await save();
  await app!.close(); app = undefined; await launch(); await openGraph();
  await expect(node(math.id).getByRole('button', { name: '展开节点参数', exact: true })).toBeVisible();
  await expect(node(delay.id).getByRole('button', { name: '收起节点参数', exact: true })).toBeVisible(); expect(errors).toEqual([]);
  record('重启后各节点参数折叠状态保留，编辑器无未捕获异常。');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors, renderer: process.env.VNS_SELECTION_DIST === '1' ? 'dist' : 'vite', packaged: false, userProjectModified: false }, null, 2)); console.log(output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, errors, error: String(error) }, null, 2)); console.error(error); console.log(output); process.exitCode = 1;
} finally { await app?.close(); await server.close(); }
