import { createProject, type BlueprintNode, type Project, type UiComponent } from '../../src/core/model';
import { blueprintNodeDefaults, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';

export const blueprintPerformanceSizes = [50, 200, 500] as const;
function stableProject(id: string, name: string): Project {
  const project = createProject(name); project.id = id;
  project.chapters = [{ id: 'perf_chapter', name: '性能章节' }];
  project.scenes = [{ id: 'perf_scene', chapterId: 'perf_chapter', name: '性能场景' }];
  project.entryId = 'perf_start';
  project.nodes = [
    { id: 'perf_start', kind: 'start', sceneId: 'perf_scene', name: '开始', x: 0, y: 0, next: 'perf_passage' },
    { id: 'perf_passage', kind: 'passage', sceneId: 'perf_scene', name: '性能结果', x: 240, y: 0, next: 'perf_end', lines: [{ id: 'perf_line', text: '性能执行完成。', actions: [] }] },
    { id: 'perf_end', kind: 'end', sceneId: 'perf_scene', name: '返回标题', x: 480, y: 0 },
  ];
  return project;
}
const checkSize = (count: number) => { if (!Number.isInteger(count) || count < 8 || count > 512) throw new Error('Fixture node count must be 8–512.'); };
export function createBlueprintPerformanceFixture(count: number) {
  checkSize(count);
  const project = stableProject('blueprint_perf_' + count, '蓝图性能 · ' + count);
  const graph = createBlueprintGraph('function', count + ' 节点编辑基线'); graph.id = 'perf_edit_graph';
  graph.nodes[0].id = 'perf_entry'; graph.nodes[0].x = 0; graph.nodes[0].y = -260;
  const source = blueprintNodeDefaults('literal'); source.id = 'perf_source'; source.name = '性能来源'; source.properties = { value: 4 }; source.pins[0].dataType = 'number'; source.x = 0; source.y = 0;
  const editable = blueprintNodeDefaults('math'); editable.id = 'perf_edit'; editable.name = '性能输入'; editable.x = 320; editable.y = 0;
  const target = blueprintNodeDefaults('math'); target.id = 'perf_target'; target.name = '性能接线'; target.x = 640; target.y = 0;
  graph.nodes.push(source, editable, target);
  for (let index = graph.nodes.length; index < count; index++) {
    const node = blueprintNodeDefaults('math'); node.id = 'perf_node_' + index; node.name = '计算 ' + index; node.properties = { operation: 'add', a: index, b: 1 };
    node.x = (index % 8) * 320; node.y = (Math.floor(index / 8) + 1) * 260; graph.nodes.push(node);
    if (index > 4 && index % 4 !== 0) graph.links.push({ id: 'perf_wire_' + index, fromNodeId: graph.nodes[index - 1].id, fromPinId: 'result', toNodeId: node.id, toPinId: 'a' });
  }
  const other = createBlueprintGraph('function', '无关资源'); other.id = 'perf_other'; other.nodes[0].id = 'perf_other_entry';
  other.nodes.push(...Array.from({ length: 49 }, (_, index) => { const node = blueprintNodeDefaults('math'); node.id = 'perf_other_' + index; node.properties.b = index; return node; }));
  project.blueprints = [graph, other]; project.timelinePresets = []; synchronizeBlueprintSignatures(project);
  return { project, graph, source, editable, target, other };
}

/** Identical authored source for preview and native execution. Each action adds
 * exactly one; observing the final count detects skipped or duplicated actions. */
export function createBlueprintExecutionPerformanceFixture(count: number) {
  checkSize(count);
  const project = stableProject('blueprint_execution_perf_' + count, '蓝图运行性能 · ' + count);
  project.variables.push({ id: 'perf_result', name: '运行结果', type: 'number', initial: 0, persistent: false });
  const graph = createBlueprintGraph('function', count + ' 节点执行'); graph.id = 'perf_execute_' + count; graph.nodes[0].id = 'perf_exec_entry_' + count;
  const read = blueprintNodeDefaults('getVariable'); read.id = 'perf_read_' + count; read.properties = { scope: 'project', variableId: 'perf_result' };
  const add = blueprintNodeDefaults('math'); add.id = 'perf_add_' + count; add.properties = { operation: 'add', b: 1 };
  graph.nodes.push(read, add);
  graph.links.push({ id: 'perf_read_wire_' + count, fromNodeId: read.id, fromPinId: 'value', toNodeId: add.id, toPinId: 'a' });
  let previous: BlueprintNode = graph.nodes[0];
  for (let index = graph.nodes.length; index < count; index++) {
    const node = blueprintNodeDefaults('setVariable'); node.id = 'perf_exec_' + count + '_' + index; node.properties = { scope: 'project', variableId: 'perf_result', value: 0 }; node.x = index * 220; node.y = 0;
    graph.nodes.push(node);
    graph.links.push({ id: 'exec_wire_' + count + '_' + index, fromNodeId: previous.id, fromPinId: previous.type === 'event' ? 'exec' : 'exec_out', toNodeId: node.id, toPinId: 'exec_in' },
      { id: 'value_wire_' + count + '_' + index, fromNodeId: add.id, fromPinId: 'result', toNodeId: node.id, toPinId: 'value' });
    previous = node;
  }
  const button: UiComponent = { id: 'perf_run', name: '执行性能图', kind: 'button', page: 'custom', text: '执行性能图', x: .15, y: .3, width: .7, height: .2 };
  const page = { id: 'perf_page', name: '预演性能', modal: true, components: [button] }; project.ui.customPages = [page];
  const events = createBlueprintGraph('ui', '性能入口'); events.id = 'perf_page_events'; events.uiPageId = page.id; events.nodes[0].id = 'perf_page_show';
  const click = blueprintNodeDefaults('eventClick'); click.id = 'perf_click'; click.properties = { componentId: button.id };
  const reset = blueprintNodeDefaults('setVariable'); reset.id = 'perf_reset'; reset.properties = { scope: 'project', variableId: 'perf_result', value: 0 };
  const call = blueprintNodeDefaults('callFunction'); call.id = 'perf_call'; call.properties = { graphId: graph.id };
  events.nodes.push(click, reset, call); events.links = [
    { id: 'perf_click_reset', fromNodeId: click.id, fromPinId: 'exec', toNodeId: reset.id, toPinId: 'exec_in' },
    { id: 'perf_reset_call', fromNodeId: reset.id, fromPinId: 'exec_out', toNodeId: call.id, toPinId: 'exec_in' },
  ];
  project.blueprints = [graph, events]; project.timelinePresets = [];
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  if (passage.kind !== 'passage') throw new Error('Passage fixture construction failed.');
  passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: graph.id }];
  synchronizeBlueprintSignatures(project);
  return { project, graph, expected: count - 3, page, button };
}

export function editPerformanceNode(project: Project, id: string, change: (node: BlueprintNode) => void) {
  const node = project.blueprints[0].nodes.find(node => node.id === id); if (!node) throw new Error('Missing fixture node: ' + id); change(node);
}