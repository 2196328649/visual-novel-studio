import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type StoryNode, type UiComponent } from '../src/core/model';
import { flowEdgePoints, flowEdgeSegments, snapFlowPosition, storyFlowLayout } from '../src/core/story-flow';
import { nineSliceEdges } from '../src/core/ui';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';

function branching() {
  const project = createProject(), sceneId = project.scenes[0].id;
  const base = (id: string) => ({ id, name: id, sceneId, x: 0, y: 0 });
  const passage = (id: string, next?: string): StoryNode => ({ ...base(id), kind: 'passage', lines: [{ id: id + '_line', text: id, actions: [] }], next });
  project.nodes = [passage('entry', 'left'), passage('left', 'merge'), passage('right', 'merge'), passage('merge', 'end'), { ...base('end'), kind: 'end' }];
  (project.nodes[0] as Extract<StoryNode, { kind: 'passage' }>).next = 'choice';
  project.nodes.push({ ...base('choice'), kind: 'choice', textHeading: false, prompt: '', choices: [{ id: 'a', text: '左', target: 'left' }, { id: 'b', text: '右', target: 'right' }] });
  project.nodes.forEach(node => { if (node.textHeading !== false) node.flowchart = { visible: true }; });
  project.entryId = 'entry';
  return project;
}
const flow = (list: UiComponent['list'] = {}): UiComponent => ({ id: 'flow', page: 'flowchart', kind: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow', ...list } });
const axisAligned = (points: [number, number][]) => points.slice(1).every((point, index) => point[0] === points[index][0] || point[1] === points[index][1]);

test('an untouched story map keeps its automatic geometry', () => {
  const project = branching(), graph = storyFlowLayout(project, flow());
  const entry = graph.nodes.find(node => node.id === 'entry')!, left = graph.nodes.find(node => node.id === 'left')!;
  assert.equal(entry.x, 60);
  assert.equal(left.x, 60 + 450);
  // A forward connector leaves the right edge, turns at the midpoint and enters the left edge.
  const edge = graph.edges.find(item => item.to === 'left')!, sx = entry.x + 350, sy = entry.y + 40, tx = left.x, ty = left.y + 40;
  assert.deepEqual(edge.points, sy === ty ? [[sx, sy], [tx, ty]] : [[sx, sy], [(sx + tx) / 2, sy], [(sx + tx) / 2, ty], [tx, ty]]);
  assert.equal(graph.height, Math.max(project.height - 34, 3 * 80 + 2 * 90 + 80));
});

test('a hand-placed node moves alone, its connectors follow and the map grows to hold it', () => {
  const project = branching(), automatic = storyFlowLayout(project, flow());
  const graph = storyFlowLayout(project, flow({ flowPositions: { merge: { x: 3000, y: 2500 } } }));
  const moved = graph.nodes.find(node => node.id === 'merge')!;
  assert.deepEqual([moved.x, moved.y], [3000, 2500]);
  for (const node of graph.nodes.filter(item => item.id !== 'merge')) {
    const before = automatic.nodes.find(item => item.id === node.id)!;
    assert.deepEqual([node.x, node.y], [before.x, before.y]);
  }
  assert.deepEqual(graph.edges.find(edge => edge.to === 'merge')!.points.at(-1), [3000, 2540]);
  assert.deepEqual(graph.edges.find(edge => edge.from === 'merge')!.points[0], [3350, 2540]);
  assert.ok(graph.width >= 3000 + 350 + 60);
  assert.ok(graph.height >= 2500 + 80 + 60);
  // A saved position for a node that no longer exists changes nothing.
  assert.deepEqual(storyFlowLayout(project, flow({ flowPositions: { removed: { x: 9, y: 9 } } })).nodes, automatic.nodes);
});

test('a vertical map advances downwards and connects bottom to top', () => {
  const project = branching(), graph = storyFlowLayout(project, flow({ flowDirection: 'vertical' }));
  const entry = graph.nodes.find(node => node.id === 'entry')!, left = graph.nodes.find(node => node.id === 'left')!, end = graph.nodes.find(node => node.id === 'end')!;
  assert.equal(entry.y, 60);
  assert.equal(left.y, 60 + 170);
  assert.ok(end.y > left.y);
  assert.ok(end.y + end.height <= graph.height);
  for (const [index, a] of graph.nodes.entries()) for (const b of graph.nodes.slice(index + 1)) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  const edge = graph.edges.find(item => item.to === 'left')!;
  assert.deepEqual(edge.points[0], [entry.x + entry.width / 2, entry.y + entry.height]);
  assert.deepEqual(edge.points.at(-1), [left.x + left.width / 2, left.y]);
  for (const item of graph.edges) assert.ok(axisAligned(item.points));
});

test('connectors can be elbow, straight or curved, and elbows loop around a target behind them', () => {
  const from = { x: 500, y: 300, width: 200, height: 80 }, ahead = { x: 900, y: 500, width: 200, height: 80 }, behind = { x: 100, y: 100, width: 200, height: 80 };
  assert.deepEqual(flowEdgePoints(from, ahead, false, 'straight'), [[680, 380], [920, 500]]);
  const curve = flowEdgePoints(from, ahead, false, 'curve');
  assert.ok(curve.length > 4);
  assert.deepEqual(curve[0], [700, 340]);
  assert.deepEqual(curve.at(-1), [900, 540]);
  assert.ok(curve.every((point, index) => !index || point[0] >= curve[index - 1][0]));
  assert.ok(!axisAligned(curve));
  for (const vertical of [false, true]) {
    const loop = flowEdgePoints(from, behind, vertical, 'elbow');
    assert.ok(axisAligned(loop), JSON.stringify(loop));
    assert.ok(loop.length > 4);
  }
  assert.ok(axisAligned(flowEdgePoints(from, ahead, true, 'elbow')));
  assert.deepEqual(flowEdgePoints(from, ahead, true, 'straight'), [[680, 380], [920, 500]]);
});

test('straight connectors meet the facing boundary after a node is moved in any direction', () => {
  const from = { x: 500, y: 300, width: 200, height: 80 };
  const inside = (point: number[], rect: typeof from) => point[0] > rect.x + 1e-6 && point[0] < rect.x + rect.width - 1e-6 && point[1] > rect.y + 1e-6 && point[1] < rect.y + rect.height - 1e-6;
  const boundary = (point: number[], rect: typeof from) => point[0] >= rect.x && point[0] <= rect.x + rect.width && point[1] >= rect.y && point[1] <= rect.y + rect.height && !inside(point, rect);
  for (const [x, y] of [[100, 100], [100, 320], [900, 300], [900, 500], [500, 0], [500, 600], [550, 400]]) {
    const to = { x, y, width: 200, height: 80 };
    const points = flowEdgePoints(from, to, false, 'straight');
    assert.equal(points.length, 2);
    assert.ok(boundary(points[0], from) && boundary(points[1], to), JSON.stringify(points));
    assert.deepEqual(flowEdgePoints(from, to, true, 'straight'), points);
    for (let i = 1; i < 100; i++) {
      const t = i / 100, p = [points[0][0] * (1 - t) + points[1][0] * t, points[0][1] * (1 - t) + points[1][1] * t];
      assert.ok(!inside(p, from) && !inside(p, to), JSON.stringify({ from, to, p }));
    }
  }
  assert.deepEqual(flowEdgePoints(from, { ...from, x: 550 }, false, 'straight'), []);
});

test('return paths, self-loops and cross-axis hand placement stay outside both nodes and on the map', () => {
  const from = { x: 500, y: 300, width: 200, height: 80 };
  const cases = [
    [from, { x: 100, y: 100, width: 200, height: 80 }],
    [from, { x: 0, y: 0, width: 200, height: 80 }],
    [from, { x: 520, y: 430, width: 200, height: 80 }],
    [from, { x: 450, y: 160, width: 200, height: 80 }],
    [from, from],
    [{ x: 0, y: 0, width: 200, height: 80 }, { x: 0, y: 0, width: 200, height: 80 }],
  ];
  for (const [a, b] of cases) for (const vertical of [false, true]) for (const style of ['elbow', 'curve'] as const) {
    const points = flowEdgePoints(a, b, vertical, style);
    assert.ok(points.length >= 2);
    for (const segment of flowEdgeSegments(points)) for (let i = 0; i <= 40; i++) {
      const t = i / 40, x = segment.a[0] * (1 - t) + segment.b[0] * t, y = segment.a[1] * (1 - t) + segment.b[1] * t;
      assert.ok(x >= 0 && y >= 0, JSON.stringify({ a, b, vertical, style, x, y }));
      for (const rect of [a, b]) assert.ok(!(x > rect.x + 1e-6 && x < rect.x + rect.width - 1e-6 && y > rect.y + 1e-6 && y < rect.y + rect.height - 1e-6), JSON.stringify({ a, b, vertical, style, x, y }));
    }
  }
});

test('empty pieces are dropped and texture distance is continuous around every corner', () => {
  const from = { x: 0, y: 0, width: 200, height: 80 }, to = { ...from, x: 296 };
  for (const style of ['elbow', 'curve', 'straight'] as const) assert.deepEqual(flowEdgePoints(from, to, false, style), [[200, 40], [296, 40]]);
  const segments = flowEdgeSegments([[10, 10], [10, 10], [40, 10], [40, 50], [43, 54]]);
  assert.deepEqual(segments.map(segment => [segment.length, segment.distance]), [[30, 0], [40, 30], [5, 70]]);
  const project = branching();
  (project.nodes[0] as Extract<StoryNode, { kind: 'passage' }>).next = 'entry';
  const graph = storyFlowLayout(project, flow({ flowLineWidth: 80, flowPositions: { entry: { x: 2500, y: 2500 } } }));
  for (const point of graph.edges.flatMap(edge => edge.points)) assert.ok(point[0] + 40 <= graph.width && point[1] + 40 <= graph.height);
});

test('dragging snaps to nearby nodes first, then the grid, and never leaves the map', () => {
  assert.deepEqual(snapFlowPosition(203, 417, []), { x: 200, y: 420 });
  assert.deepEqual(snapFlowPosition(203, 417, [{ x: 207, y: 900 }]), { x: 207, y: 420 });
  assert.deepEqual(snapFlowPosition(203, 417, [{ x: 206, y: 413 }, { x: 201, y: 900 }]), { x: 201, y: 413 });
  assert.deepEqual(snapFlowPosition(-40, -3, []), { x: 0, y: 0 });
});

test('the flow layout options survive saving and old projects need none of them', () => {
  const project = branching();
  project.ui.components.push(flow({ flowDirection: 'vertical', flowPositions: { entry: { x: 10, y: 20 } }, flowLineStyle: 'curve', flowLockedLine: 'dim', flowLockedNode: 'hide', flowLockedCaption: '？？？' }));
  const list = projectSchema.parse(JSON.parse(JSON.stringify(project))).ui.components.at(-1)!.list!;
  assert.deepEqual([list.flowDirection, list.flowPositions, list.flowLineStyle, list.flowLockedLine, list.flowLockedNode, list.flowLockedCaption], ['vertical', { entry: { x: 10, y: 20 } }, 'curve', 'dim', 'hide', '？？？']);
  assert.equal(projectSchema.parse(JSON.parse(JSON.stringify(createProject()))).ui.components.some(item => item.list?.flowDirection), false);
});

test('node text split by ｜ stays in the script and reaches the map as parts', () => {
  const project = branching();
  const left = project.nodes.find(node => node.id === 'left')!;
  left.flowchart = { visible: true, name: '记 第一回｜醉梦' };
  const box = storyFlowLayout(project, flow()).nodes.find(node => node.id === 'left')!;
  assert.deepEqual([box.parts, box.name], [['记 第一回', '醉梦'], '记 第一回 醉梦']);
  assert.equal(storyFlowLayout(project, flow()).nodes.find(node => node.id === 'entry')!.parts, undefined);
  const text = projectToText(project);
  assert.ok(text.includes('显示名称="记 第一回｜醉梦"'), text);
  assert.equal(applyTextScript(project, text).project.nodes.find(node => node.id === 'left')!.flowchart?.name, '记 第一回｜醉梦');
});

test('a missing caption font is reported', () => {
  const project = branching();
  project.ui.components.push(flow());
  project.ui.components.at(-1)!.style = { captionParts: [{ fontAssetId: 'gone' }] };
  assert.ok(validateProject(project).some(item => item.message.includes('gone')));
});

test('nine-slice edges keep a middle to stretch when they meet', () => {
  const edges = { left: 24, top: 0, right: 24, bottom: 0 };
  assert.deepEqual(nineSliceEdges(edges, 48, 46), { left: 24, top: 0, right: 23, bottom: 0 });
  assert.deepEqual(nineSliceEdges(edges, 64, 46), edges);
  assert.deepEqual(nineSliceEdges(edges), edges);
  assert.deepEqual(nineSliceEdges({ left: 30, top: 8, right: 30, bottom: 8 }, 20, 16), { left: 19, top: 8, right: 0, bottom: 7 });
});
