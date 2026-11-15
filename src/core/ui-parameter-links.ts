import { blueprintInputValue } from './blueprint';
import { blueprintUiPropertyDefinition, type BlueprintUiPropertyRow } from './blueprint-ui-property-batch';
import { blueprintCommandReference } from './blueprint-names';
import { effectiveUiComponents, variableAssetKind, type BlueprintGraph, type BlueprintNode, type BlueprintPin, type Project } from './model';
import { graphResourceKey, projectGraphs, setProjectGraphs } from './project-resources';
import { uiProperties, uiPropertyApplies, uiPropertyPinType, type UiProperty } from './ui-properties';
import { uiControlPropertyAssignmentProblem } from './ui-control-authoring';

/** Stored on the start node so existing project readers preserve the ownership record. */
export const uiParameterBindingMarker = 'uiParameterBinding';

export interface UiParameterBindingInfo {
  graphId: string;
  graphName: string;
  componentId: string;
  property: UiProperty;
  variableId?: string;
  sourceMissing: boolean;
  managed: boolean;
  origin: 'marked' | 'legacy' | 'custom';
  /** Unmanaged graphs remain available for editing in their original blueprint. */
  reason?: string;
}

interface BindingShape {
  componentId: string;
  property: UiProperty;
  variableId: string;
  start: BlueprintNode;
  timer: BlueprintNode;
  reader: BlueprintNode;
  initial: BlueprintNode;
  update: BlueprintNode;
}

const graphFields = new Set(['id', 'name', 'kind', 'uiPageId', 'uiInstanceId', 'nodes', 'links', 'exposedInputs', 'exposedOutputs']);
const nodeFields = new Set(['id', 'type', 'name', 'x', 'y', 'pins', 'properties', 'collapsed']);
const pinFields = new Set(['id', 'name', 'description', 'direction', 'dataType', 'required', 'defaultValue']);
const linkFields = new Set(['id', 'fromNodeId', 'fromPinId', 'toNodeId', 'toPinId']);
const onlyFields = (value: object, allowed: ReadonlySet<string>) => Object.entries(value).every(([key, item]) => item === undefined || allowed.has(key));
const propertiesAre = (node: BlueprintNode, keys: string[]) => Object.keys(node.properties).length === keys.length && keys.every(key => Object.hasOwn(node.properties, key));
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

type PinShape = [id: string, direction: BlueprintPin['direction'], dataType: BlueprintPin['dataType'], defaultValue?: BlueprintPin['defaultValue']];
function pinsAre(node: BlueprintNode, expected: PinShape[]): boolean {
  return node.pins.length === expected.length && new Set(node.pins.map(pin => pin.id)).size === expected.length && expected.every(([id, direction, dataType, defaultValue]) => {
    const pin = node.pins.find(pin => pin.id === id);
    return !!pin && onlyFields(pin, pinFields) && pin.direction === direction && pin.dataType === dataType && !pin.required && pin.defaultValue === defaultValue;
  });
}

/** The full generated program, not merely a reader connected to a setter. */
function bindingShape(graph: BlueprintGraph): BindingShape | undefined {
  if (graph.kind !== 'ui' || !graph.uiPageId || !onlyFields(graph, graphFields)
    || graph.exposedInputs.length || graph.exposedOutputs.length || graph.nodes.length !== 5 || graph.links.length !== 4
    || new Set(graph.nodes.map(node => node.id)).size !== 5 || new Set(graph.links.map(link => link.id)).size !== 4
    || graph.nodes.some(node => !onlyFields(node, nodeFields)) || graph.links.some(link => !onlyFields(link, linkFields))) return;
  const starts = graph.nodes.filter(node => node.type === 'event'), timers = graph.nodes.filter(node => node.type === 'eventTimer');
  const readers = graph.nodes.filter(node => node.type === 'getVariable'), setters = graph.nodes.filter(node => node.type === 'setUiProperty');
  if (starts.length !== 1 || timers.length !== 1 || readers.length !== 1 || setters.length !== 2) return;
  if (setters.some(node => !blueprintUiPropertyDefinition(node).legacy)) return;
  const [start] = starts, [timer] = timers, [reader] = readers;
  const marked = Object.hasOwn(start.properties, uiParameterBindingMarker);
  const standard = graph.uiPageId.startsWith('ui:');
  if (standard ? !graph.uiInstanceId : graph.uiInstanceId !== undefined) return;
  if (!propertiesAre(start, marked ? [uiParameterBindingMarker] : [])
    || !propertiesAre(timer, standard ? ['pageId', 'interval', 'repeat', 'uiInstanceId'] : ['pageId', 'interval', 'repeat'])
    || timer.properties.pageId !== graph.uiPageId || timer.properties.interval !== .05 || timer.properties.repeat !== true
    || timer.properties.uiInstanceId !== graph.uiInstanceId || !propertiesAre(reader, ['variableId'])
    || typeof reader.properties.variableId !== 'string' || !reader.properties.variableId) return;
  const property = setters[0].properties.property;
  if (typeof property !== 'string' || !Object.hasOwn(uiProperties, property)) return;
  const key = property as UiProperty, info = uiProperties[key], type = uiPropertyPinType(key)!;
  const componentId = setters[0].properties.componentId;
  if (!info.writable || !info.bindable || typeof componentId !== 'string' || !componentId
    || setters.some(node => !propertiesAre(node, ['componentId', 'property', 'value'])
      || node.properties.componentId !== componentId || node.properties.property !== property
      || typeof node.properties.value !== info.type || typeof node.properties.value === 'number' && !Number.isFinite(node.properties.value))
    || setters[0].properties.value !== setters[1].properties.value) return;
  if (!pinsAre(start, [['exec', 'output', 'exec']]) || !pinsAre(timer, [['exec', 'output', 'exec']])
    || !pinsAre(reader, [['value', 'output', type]])
    || setters.some(node => !pinsAre(node, [['exec_in', 'input', 'exec'], ['componentId', 'input', 'component'],
      ['value', 'input', type, type === 'boolean' ? true : info.initial], ['exec_out', 'output', 'exec']]))) return;
  const initialLink = graph.links.find(link => link.fromNodeId === start.id && link.fromPinId === 'exec' && link.toPinId === 'exec_in');
  const updateLink = graph.links.find(link => link.fromNodeId === timer.id && link.fromPinId === 'exec' && link.toPinId === 'exec_in');
  const initial = setters.find(node => node.id === initialLink?.toNodeId), update = setters.find(node => node.id === updateLink?.toNodeId);
  if (!initial || !update || initial === update) return;
  const edges = [[start.id, 'exec', initial.id, 'exec_in'], [timer.id, 'exec', update.id, 'exec_in'],
    [reader.id, 'value', initial.id, 'value'], [reader.id, 'value', update.id, 'value']];
  if (!edges.every(([fromNodeId, fromPinId, toNodeId, toPinId]) => graph.links.some(link =>
    link.fromNodeId === fromNodeId && link.fromPinId === fromPinId && link.toNodeId === toNodeId && link.toPinId === toPinId))) return;
  return { componentId, property: key, variableId: reader.properties.variableId, start, timer, reader, initial, update };
}

/** Layout and captions can change; the stored executable program must remain identical. */
function bindingSignature(graph: BlueprintGraph): string {
  return JSON.stringify({ version: 1, id: graph.id, kind: graph.kind, pageId: graph.uiPageId, instanceId: graph.uiInstanceId,
    nodes: [...graph.nodes].sort((a, b) => compareId(a.id, b.id)).map(node => ({ id: node.id, type: node.type,
      properties: Object.entries(node.properties).filter(([key]) => key !== uiParameterBindingMarker).sort(([a], [b]) => compareId(a, b)),
      pins: [...node.pins].sort((a, b) => compareId(a.id, b.id)).map(pin => ({ id: pin.id, direction: pin.direction, dataType: pin.dataType,
        required: !!pin.required, ...(pin.defaultValue === undefined ? {} : { defaultValue: pin.defaultValue }) })),
    })),
    links: [...graph.links].sort((a, b) => compareId(a.id, b.id)).map(link => [link.id, link.fromNodeId, link.fromPinId, link.toNodeId, link.toPinId]),
  });
}

/** Call only after the automatic graph's pins and connections have been completed. */
export function markUiParameterBindingGraph(graph: BlueprintGraph): void {
  const shape = bindingShape(graph);
  if (!shape) throw new Error('只有完整的自动参数联动图才能标记。');
  shape.start.properties[uiParameterBindingMarker] = bindingSignature(graph);
}

function legacyBinding(project: Project, graph: BlueprintGraph, shape: BindingShape): boolean {
  // Older versions wrote no marker. Require all original naming, geometry, IDs,
  // values and pin captions as well as the complete program before adopting one.
  if (!/^界面参数联动(?: (?:[2-9]|[1-9]\d+))?$/.test(graph.name) || !/^blueprint_[0-9a-f]{32}$/.test(graph.id)
    || graph.nodes.some(node => !/^bpnode_[0-9a-f]{32}$/.test(node.id) || node.collapsed)
    || graph.links.some(link => !/^bplink_[0-9a-f]{32}$/.test(link.id))) return false;
  const ordered = [shape.start, shape.timer, shape.reader, shape.initial, shape.update];
  const captions = ['事件开始', '定时触发', '读取状态', '设置组件属性', '设置组件属性'];
  const positions = [[80, 80], [0, 350], [0, 650], [450, 0], [450, 350]];
  const pinNames = [['开始'], ['触发时'], ['值'], ['执行', '界面组件', '属性值', '完成'], ['执行', '界面组件', '属性值', '完成']];
  if (!ordered.every((node, index) => graph.nodes[index] === node && node.name === captions[index]
    && node.x === positions[index][0] && node.y === positions[index][1]
    && node.pins.every((pin, pinIndex) => pin.name === pinNames[index][pinIndex] && !pin.description))) return false;
  const source = project.variables.find(variable => variable.id === shape.variableId);
  return !source || source.type === uiPropertyPinType(shape.property) && source.initial === shape.initial.properties.value;
}

/** Reserve generated graphs when choosing a default home for unrelated events.
 * A marker survives custom edits; this predicate does not authorize rewriting. */
export function isUiParameterBindingGraph(project: Project, graph: BlueprintGraph): boolean {
  if (graph.nodes.some(node => Object.hasOwn(node.properties, uiParameterBindingMarker))) return true;
  const shape = bindingShape(graph);
  return !!shape && legacyBinding(project, graph, shape);
}

function scopeIsActive(project: Project, scope: string | undefined): boolean {
  if (!scope) return true;
  if (scope === 'base') return !project.ui.activeInstanceId;
  let id = project.ui.activeInstanceId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    if (id === scope) return true;
    seen.add(id); id = project.ui.instances?.find(instance => instance.id === id)?.baseUiId;
  }
  return false;
}

function componentOnPage(project: Project, componentId: string, pageId: string) {
  return pageId.startsWith('ui:') ? effectiveUiComponents(project.ui).find(component => component.id === componentId && 'ui:' + component.page === pageId)
    : project.ui.customPages.find(page => page.id === pageId)?.components.find(component => component.id === componentId);
}

function ownershipProblem(project: Project, graph: BlueprintGraph, pageId: string): string | undefined {
  if (graph.uiPageId !== pageId) return '这张蓝图属于其他页面或由多个页面共用，请在原蓝图中编辑。';
  if (pageId.startsWith('ui:')) {
    if (graph.uiInstanceId !== (project.ui.activeInstanceId ?? 'base')) return '这项联动来自其他界面方案，请到所属方案或原蓝图中编辑。';
    if (project.ui.activeInstanceId && !project.ui.instances?.some(instance => instance.id === project.ui.activeInstanceId)) return '当前界面方案已不存在。';
  } else if (graph.uiInstanceId !== undefined || !project.ui.customPages.some(page => page.id === pageId)) return '页面或界面方案的归属已改变，请在原蓝图中编辑。';
}

/** One traversal per listing keeps many bound properties from rescanning the story. */
function externallyReferencedGraphs(project: Project): Set<string> {
  const graphs = projectGraphs(project), ids = new Set(graphs.map(graph => graph.id)), used = new Set<string>();
  // Also retain dormant authored fields and literal references which can become
  // live again (for example a temporarily disabled button or a saved action).
  const skip = new Set(['id', 'name', 'text', 'subtitle', 'description', 'sourcePath', 'path', 'scriptText', 'contentBrowser', uiParameterBindingMarker]);
  const inspect = (value: unknown, key = ''): void => {
    if (skip.has(key)) return;
    if (typeof value === 'string') {
      if (ids.has(value)) used.add(value);
      for (const match of value.matchAll(/【([a-z][a-z0-9_]{0,63})】/g)) if (ids.has(match[1])) used.add(match[1]);
      if (key === 'action') { try { inspect(JSON.parse(value)); } catch { /* Invalid saved actions stay in diagnostics. */ } }
    } else if (Array.isArray(value)) value.forEach(item => inspect(item));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => inspect(item, name));
  };
  inspect(project);
  // Unsynchronized text can be the only remaining caller, including old names
  // without a stable-ID suffix. Use the same resolver as resource deletion.
  const sources = [project.scriptText?.content ?? '', ...project.effects.flatMap(effect => effect.commands),
    ...graphs.flatMap(graph => graph.nodes.flatMap(node => node.type === 'sceneAction' && typeof node.properties.command === 'string' ? [node.properties.command] : []))];
  for (const source of sources) for (const row of source.split(/\r?\n/)) {
    const called = blueprintCommandReference(graphs, row);
    if (called) used.add(called.id);
    if (/^\s*[@／/](?!\/)/.test(row)) inspect(row);
    // The text parser also accepts "@蓝图 名称". The shared legacy resolver
    // handles colon syntax, so normalize this known command spelling locally.
    const spaced = row.match(/^\s*([@／/])(蓝图|通用蓝图|场景蓝图)\s+(.+)$/);
    if (spaced) {
      const reference = blueprintCommandReference(graphs, spaced[1] + spaced[2] + '：' + spaced[3]);
      if (reference) used.add(reference.id);
    }
  }
  return used;
}

function inspectBinding(project: Project, graph: BlueprintGraph, pageId: string, references: () => ReadonlySet<string> = () => externallyReferencedGraphs(project)) {
  const shape = bindingShape(graph);
  const marker = graph.nodes.find(node => node.type === 'event')?.properties[uiParameterBindingMarker];
  const origin: UiParameterBindingInfo['origin'] = marker !== undefined ? 'marked' : shape && legacyBinding(project, graph, shape) ? 'legacy' : 'custom';
  const reason = ownershipProblem(project, graph, pageId)
    ?? (projectGraphs(project).filter(item => item.id === graph.id).length !== 1 ? '蓝图标识重复，请先在原蓝图中修复。' : undefined)
    ?? (!shape || origin === 'custom' || origin === 'marked' && marker !== bindingSignature(graph) ? '这张蓝图包含自定义或已修改的逻辑，请在原蓝图中编辑。' : undefined)
    ?? (references().has(graph.id) ? '这张蓝图还被其他内容引用，请在原蓝图中编辑。' : undefined);
  return { shape, origin, reason };
}

type PropertyWrite = { node: BlueprintNode; row: BlueprintUiPropertyRow };
function directSource(graph: BlueprintGraph, setters: PropertyWrite[]): string | undefined {
  const sources = setters.map(({ node, row }) => {
    const wires = graph.links.filter(link => link.toNodeId === node.id && link.toPinId === row.id);
    if (wires.length !== 1 || wires[0].fromPinId !== 'value') return;
    const reader = graph.nodes.find(node => node.id === wires[0].fromNodeId && node.type === 'getVariable');
    if (!reader || reader.properties.scope && !['project', 'player'].includes(String(reader.properties.scope))) return;
    return typeof reader.properties.variableId === 'string' && reader.properties.variableId ? reader.properties.variableId : undefined;
  });
  return sources[0] && sources.every(id => id === sources[0]) ? sources[0] : undefined;
}

/** Custom/shared bindings are listed for navigation, never silently converted. */
export function listUiParameterBindings(project: Project, componentId: string, pageId: string, property?: UiProperty): UiParameterBindingInfo[] {
  if (!componentOnPage(project, componentId, pageId)) return [];
  const result: UiParameterBindingInfo[] = [];
  let referenceIds: ReadonlySet<string> | undefined;
  const references = () => referenceIds ??= externallyReferencedGraphs(project);
  for (const graph of projectGraphs(project)) {
    if (graph.uiPageId && graph.uiPageId !== pageId || !scopeIsActive(project, graph.uiInstanceId)) continue;
    const dynamicTargets = new Set(graph.links.filter(link => link.toPinId === 'componentId').map(link => link.toNodeId));
    const setters = graph.nodes.flatMap<PropertyWrite>(node => node.type === 'setUiProperty' && !dynamicTargets.has(node.id) && blueprintInputValue(node, 'componentId') === componentId
      ? (blueprintUiPropertyDefinition(node).rows ?? []).filter(row => Object.hasOwn(uiProperties, row.property) && (property === undefined || row.property === property)).map(row => ({ node, row })) : []);
    if (!setters.length) continue;
    const inspection = inspectBinding(project, graph, pageId, references);
    for (const key of new Set(setters.map(({ row }) => row.property as UiProperty))) {
      const variableId = directSource(graph, setters.filter(({ row }) => row.property === key));
      result.push({ graphId: graph.id, graphName: graph.name, componentId, property: key, variableId,
        sourceMissing: !!variableId && !project.variables.some(variable => variable.id === variableId),
        managed: !inspection.reason, origin: inspection.origin, reason: inspection.reason });
    }
  }
  return result;
}

/** Used before creation to avoid adding a second timer for the same link. */
export function findUiParameterBinding(project: Project, componentId: string, property: UiProperty, variableId: string, pageId: string): BlueprintGraph | undefined {
  const binding = listUiParameterBindings(project, componentId, pageId, property).find(item => item.managed && item.variableId === variableId && !item.sourceMissing);
  return binding && projectGraphs(project).find(graph => graph.id === binding.graphId);
}

function managedBinding(project: Project, graphId: string, pageId: string) {
  const graph = projectGraphs(project).find(item => item.id === graphId);
  if (!graph) throw new Error('这项参数联动已不存在。');
  const inspection = inspectBinding(project, graph, pageId);
  if (inspection.reason || !inspection.shape) throw new Error(inspection.reason ?? '请在原蓝图中编辑这项联动。');
  return { graph, shape: inspection.shape };
}

/** Keep graph/node/link identities and the existing 0.05-second polling cadence. */
export function replaceUiParameterBinding(project: Project, graphId: string, variableId: string, pageId: string): BlueprintGraph {
  const { graph, shape } = managedBinding(project, graphId, pageId);
  const component = componentOnPage(project, shape.componentId, pageId), variable = project.variables.find(item => item.id === variableId);
  if (!component || !variable || !uiPropertyApplies(component, shape.property, project) || variable.type !== uiPropertyPinType(shape.property)
    || variable.type === 'asset' && variableAssetKind(variable) !== uiProperties[shape.property].resource) throw new Error('组件属性与参数类型不匹配。');
  const problem = uiControlPropertyAssignmentProblem(project, component, shape.property, variable.initial);
  if (problem) throw new Error(problem);
  if (shape.variableId === variableId) return graph;
  shape.reader.properties.variableId = variableId;
  shape.initial.properties.value = variable.initial;
  shape.update.properties.value = variable.initial;
  markUiParameterBindingGraph(graph);
  return graph;
}

/** Delete only an owned automatic graph, preserving the source parameter. */
export function detachUiParameterBinding(project: Project, graphId: string, pageId: string): boolean {
  if (!projectGraphs(project).some(graph => graph.id === graphId)) return false;
  const { graph } = managedBinding(project, graphId, pageId), key = graphResourceKey(graph);
  setProjectGraphs(project, projectGraphs(project).filter(item => item.id !== graphId));
  if (project.contentBrowser) {
    delete project.contentBrowser.assignments[key];
    project.contentBrowser.favorites = project.contentBrowser.favorites.filter(item => item !== key);
  }
  return true;
}
