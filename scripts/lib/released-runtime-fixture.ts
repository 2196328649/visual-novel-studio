import type { BlueprintGraph, BlueprintNode, BlueprintPin, Project, UiComponent } from '../../src/core/model';
import { uiPageHostScreens } from '../../src/core/ui-pages';

export type ReleasedScheme = 'base' | 'original' | 'derived';
export const releasedSchemes: ReleasedScheme[] = ['base', 'original', 'derived'];
export const releasedCustomPages = ['release_waiting', 'release_overlay'] as const;
export const releasedNativePages = Object.keys(uiPageHostScreens) as (keyof typeof uiPageHostScreens)[];
const pin = (id: string, direction: BlueprintPin['direction'], dataType: BlueprintPin['dataType'] = 'exec', defaultValue?: BlueprintPin['defaultValue']): BlueprintPin => ({ id, name: id, direction, dataType, required: false, ...(defaultValue === undefined ? {} : { defaultValue }) });

/** Authored compatibility inputs for the actual 0.8.0 parser/compiler. The
 * untouched archive documents are a separate axis. These cases do NOT claim
 * that the released example already contained schemes or custom pages.
 * Only node fields/types/pins present in the v0.8.0 source are constructed here;
 * the old executable must normalize, save, compile and run them before use. */
export function authorReleasedRuntimeFixture(source: Project, scheme: ReleasedScheme) {
  const project = structuredClone(source);
  const mixed: BlueprintGraph = { id: 'release_mixed', name: '历史混合调用', kind: 'ui', nodes: [], links: [],
    exposedInputs: [pin('legacy_input', 'input', 'string', '历史输入')], exposedOutputs: [pin('legacy_result', 'output', 'string', '')] };
  project.blueprints.push(mixed);
  let serial = 0;
  const node = (graph: BlueprintGraph, type: BlueprintNode['type'], properties: BlueprintNode['properties'] = {}, data: BlueprintPin[] = []) => {
    const event = type === 'event' || type === 'eventClick';
    const valueOnly = type === 'getVariable' || type === 'getInput' || type === 'math';
    const row: BlueprintNode = { id: 'release_node_' + (++serial), name: type, type, x: serial % 5 * 350, y: Math.floor(serial / 5) * 220, collapsed: false, properties,
      pins: event ? [pin('exec', 'output')] : valueOnly ? data : [pin('exec_in', 'input'), ...data, pin('exec_out', 'output')] };
    graph.nodes.push(row); return row;
  };
  const wire = (graph: BlueprintGraph, from: BlueprintNode, to: BlueprintNode, fromPin = from.type.startsWith('event') ? 'exec' : 'exec_out', toPin = 'exec_in') => graph.links.push({ id: 'release_link_' + graph.links.length + '_' + graph.id, fromNodeId: from.id, fromPinId: fromPin, toNodeId: to.id, toPinId: toPin });
  const graph = (id: string) => { const g: BlueprintGraph = { id, name: id, kind: 'function', nodes: [], links: [], exposedInputs: [], exposedOutputs: [] }; project.blueprints.push(g); node(g, 'event'); return g; };
  const increment = (g: BlueprintGraph, variableId: string) => {
    const read = node(g, 'getVariable', { variableId }, [pin('value', 'output', 'number')]);
    const add = node(g, 'math', { operation: 'add', b: 1 }, [pin('a', 'input', 'number', 0), pin('b', 'input', 'number', 1), pin('result', 'output', 'number')]);
    const set = node(g, 'setVariable', { variableId }, [pin('value', 'input', 'number')]);
    wire(g, read, add, 'value', 'a'); wire(g, add, set, 'result', 'value'); return set;
  };
  const entry = node(mixed, 'event'), input = node(mixed, 'getInput', { inputId: 'legacy_input' }, [pin('value', 'output', 'string')]);
  const output = node(mixed, 'setOutput', { outputId: 'legacy_result' }, [pin('value', 'input', 'string')]);
  wire(mixed, entry, output); wire(mixed, input, output, 'value', 'value');
  const authorPage = (key: string, page: UiComponent['page']) => {
    const valueId = 'release_' + key + '_value', touchId = 'release_' + key + '_touch', shows = 'release_' + key + '_shows';
    project.variables.push({ id: shows, name: shows, type: 'number', initial: 0, persistent: false });
    const shown = graph('release_show_' + key), step = increment(shown, shows); wire(shown, shown.nodes[0], step);
    const controls: UiComponent[] = [
      { id: valueId, name: key + ' 原始值', page, kind: 'text', text: 'design:' + key, x: .66, y: .04, width: .32, height: .09, events: { onShow: shown.id } },
      { id: touchId, name: key + ' 修改', page, kind: 'button', text: '修改 ' + key, x: .68, y: .14, width: .28, height: .10 },
    ];
    const click = node(mixed, 'eventClick', { componentId: touchId });
    const set = node(mixed, 'setUiProperty', { componentId: valueId, property: 'text', value: 'touched:' + key }, [pin('componentId', 'input', 'component'), pin('value', 'input', 'string')]); wire(mixed, click, set);
    return { key, page, controls, valueId, touchId, shows };
  };
  const native = releasedNativePages.map(page => ({ ...authorPage(page, page), screen: uiPageHostScreens[page][0] }));
  project.ui.components.push(...native.flatMap(row => row.controls));
  // The shipped runtime only attached these authored controls in custom layout.
  project.ui.pages = { ...project.ui.pages, chapterTitle: { ...project.ui.pages?.chapterTitle, layout: 'custom' }, messageBox: { ...project.ui.pages?.messageBox, layout: 'custom' } };
  project.ui.instances = [{ id: 'release_original', name: '历史原方案', components: structuredClone(project.ui.components), pages: structuredClone(project.ui.pages) },
    { id: 'release_derived', name: '历史派生方案', baseUiId: 'release_original', components: native.map(row => ({ ...row.controls[0], text: 'derived:' + row.key })) }];
  project.ui.activeInstanceId = scheme === 'base' ? undefined : 'release_' + scheme;
  const custom = releasedCustomPages.map(key => {
    const row = authorPage(key, 'custom'), closeId = key + '_close';
    row.controls.push({ id: closeId, page: 'custom', kind: 'button', text: '完成历史调用', x: .68, y: .7, width: .28, height: .12 });
    const event = node(mixed, 'eventClick', { componentId: closeId });
    wire(mixed, event, node(mixed, 'closeUiPage', { pageId: key, result: '历史结果' }, [pin('pageId', 'input', 'ui'), pin('result', 'input', 'string', '完成')]));
    project.ui.customPages.push({ id: key, name: key, modal: key === 'release_waiting', components: row.controls }); return { ...row, closeId };
  });
  project.variables.push({ id: 'release_result', name: '历史调用结果', type: 'string', initial: '', persistent: false }, { id: 'release_resumed', name: '历史调用续行', type: 'number', initial: 0, persistent: false });
  const template = project.nodes.find(row => row.kind === 'passage'); if (!template || template.kind !== 'passage' || !template.lines[0]) throw new Error('The release source needs a real passage.');
  const passage = (id: string, text: string, blueprintId?: string) => {
    const line = { ...structuredClone(template.lines[0]), id: id + '_line', text, actions: blueprintId ? [{ kind: 'blueprint' as const, blueprintId }] : [] };
    const value = { ...structuredClone(template), id, name: text, lines: [line], next: template.id }; project.nodes.push(value); return value;
  };
  const anchor = passage('release_anchor', '历史兼容锚点一。'), later = passage('release_later', '历史兼容锚点二。'); anchor.next = later.id;
  for (const row of custom) {
    const call = graph('release_open_' + row.key);
    const open = node(call, 'showUiPage', { pageId: row.key, wait: row.key === 'release_waiting' }, [pin('pageId', 'input', 'ui'), pin('wait', 'input', 'boolean', true), pin('result', 'output', 'string')]); wire(call, call.nodes[0], open);
    if (row.key === 'release_waiting') {
      const store = node(call, 'setVariable', { variableId: 'release_result' }, [pin('value', 'input', 'string')]); wire(call, open, store); wire(call, open, store, 'result', 'value'); wire(call, store, increment(call, 'release_resumed'));
    }
    const entry = passage('release_story_' + row.key, row.key === 'release_waiting' ? '历史等待已经返回。' : '历史叠加页面已打开。', call.id); entry.next = anchor.id;
  }
  return { project, native, custom, mixed, anchor, later, scheme };
}
