import type { BlueprintGraph, BlueprintNode, Project, VariableValue } from './model';
import { blueprintInputSource, blueprintInputValue, blueprintOutputLabel } from './blueprint';
import { blueprintChoiceDefinition, blueprintChoicePinId } from './blueprint-choice';
import { blueprintExecutionOutputs } from './blueprint-execution-ports';
import { builtinUiPageId } from './ui-page-catalog';
import { blueprintPageOpeningOverrides, resolveUiPageOpening, uiPageOpeningSummary } from './ui-page-opening';
import { uiPage } from './ui-pages';
import { projectGraphs } from './project-resources';
import { canLaunchTimeline } from './timeline-launch';
import type { UiFlowEvent, UiFlowRoute } from './ui-page-flow';

export interface UiFlowRouteStep {
  kind: 'trigger' | 'operation' | 'call' | 'condition' | 'sequence' | 'wait' | 'async' | 'loop' | 'dynamic';
  label: string;
  graphId?: string;
  nodeId?: string;
  pinId?: string;
  order?: number;
}
export interface UiFlowRoutePath {
  steps: UiFlowRouteStep[];
  conditional?: boolean;
  sequential?: boolean;
  asynchronous?: boolean;
  dynamic?: boolean;
  repeated?: boolean;
  limited?: boolean;
}
export interface UiFlowRouteAnalysis { limited: boolean }

const maxPaths = 4, maxSteps = 32, maxVisits = 2048;
const literal = (value: VariableValue | undefined) => value === undefined ? '未设置' : typeof value === 'boolean' ? value ? '开启' : '关闭' : typeof value === 'string' ? value ? '“' + value.slice(0, 160) + (value.length > 160 ? '…' : '') + '”' : '空文字' : String(value);

function append(path: UiFlowRoutePath, step: UiFlowRouteStep): UiFlowRoutePath {
  const steps = [...path.steps, step], limited = path.limited || steps.length > maxSteps;
  return { ...path, steps: steps.length > maxSteps ? [steps[0], ...steps.slice(1 - maxSteps)] : steps,
    conditional: path.conditional || step.kind === 'condition', sequential: path.sequential || step.kind === 'sequence' || step.order !== undefined,
    asynchronous: path.asynchronous || step.kind === 'async', dynamic: path.dynamic || step.kind === 'dynamic',
    repeated: path.repeated || step.kind === 'loop', limited };
}

/** Describe connected expressions without evaluating them or using a stale default. */
function inputDescription(project: Project, graph: BlueprintGraph, node: BlueprintNode, pin: string, depth = 0): string {
  const source = blueprintInputSource(project, graph, node.id, pin);
  if (!source) return literal(blueprintInputValue(node, pin));
  const link = graph.links.find(link => link.toNodeId === node.id && link.toPinId === pin)!;
  const value = graph.nodes.find(item => item.id === link.fromNodeId);
  if (!value || depth >= 3) return source.label;
  const read = (id: string) => inputDescription(project, graph, value, id, depth + 1);
  if (value.type === 'compare') {
    const operator = ({ eq: '等于', ne: '不等于', gt: '大于', gte: '大于或等于', lt: '小于', lte: '小于或等于' } as Record<string, string>)[String(value.properties.operator ?? 'eq')] ?? '比较';
    return read('a') + ' ' + operator + ' ' + read('b');
  }
  if (value.type === 'not') return '不满足（' + read('a') + '）';
  if (value.type === 'and' || value.type === 'or') return '（' + read('a') + '）' + (value.type === 'and' ? '并且' : '或者') + '（' + read('b') + '）';
  return blueprintOutputLabel(project, graph, value, link.fromPinId);
}

function branchDescription(project: Project, graph: BlueprintGraph, node: BlueprintNode, pin: string): string {
  if (node.type === 'branch') {
    const variable = blueprintInputValue(node, 'condition') === undefined && !graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'condition') && project.variables.find(item => item.id === node.properties.variableId);
    const condition = variable ? variable.name + ' 等于 ' + literal(node.properties.value ?? variable.initial) : inputDescription(project, graph, node, 'condition');
    return (pin === 'true' ? '满足时：' : '不满足时：') + condition;
  }
  if (node.type === 'switchValue') {
    const definition = blueprintChoiceDefinition(node), choice = definition.cases?.find(item => blueprintChoicePinId(item.id) === pin);
    return choice ? inputDescription(project, graph, node, 'key') + ' 等于 ' + literal(choice.key) + ' · ' + choice.name : '未匹配其他分支时';
  }
  if (node.type === 'confirmMessage') return '等待玩家' + (pin === 'yes' ? '确定' : '取消') + '：' + inputDescription(project, graph, node, 'message');
  if (node.type === 'waitTask') return '等待任务后：' + (node.pins.find(item => item.id === pin)?.name ?? pin);
  return node.name + ' · ' + (node.pins.find(item => item.id === pin)?.name ?? pin);
}

/** Build only a bounded explanation of authored execution wires. It neither runs
 * blueprints nor replaces their validation, dispatch, or editable source. */
export function createUiFlowRouteAnalyzer(project: Project) {
  const graphs = new Map(projectGraphs(project).map(graph => [graph.id, graph]));
  const indexes = new Map<string, { nodes: Map<string, BlueprintNode>; outgoing: Map<string, BlueprintGraph['links']> }>();
  const index = (graph: BlueprintGraph) => {
    let result = indexes.get(graph.id);
    if (!result) {
      const outgoing = new Map<string, BlueprintGraph['links']>();
      for (const link of graph.links) { const rows = outgoing.get(link.fromNodeId) ?? []; rows.push(link); outgoing.set(link.fromNodeId, rows); }
      result = { nodes: new Map(graph.nodes.map(node => [node.id, node])), outgoing }; indexes.set(graph.id, result);
    }
    return result;
  };
  return (graphId: string, rootId: string | undefined, trigger: UiFlowRouteStep): { routes: UiFlowRoute[]; analysis: UiFlowRouteAnalysis } => {
    const routes: UiFlowRoute[] = [], byTarget = new Map<string, UiFlowRoute>(), analysis = { limited: false };
    let visits = 0;
    const add = (route: UiFlowRoute, path: UiFlowRoutePath) => {
      const key = JSON.stringify([route.target, route.graphId, route.nodeId]), old = byTarget.get(key);
      if (old) {
        if (old.paths!.some(item => JSON.stringify(item) === JSON.stringify(path))) return;
        if (old.paths!.length < maxPaths) old.paths!.push(path);
        else { old.pathsLimited = true; analysis.limited = true; }
      } else { const next = { ...route, paths: [path] }; routes.push(next); byTarget.set(key, next); }
      if (path.limited) analysis.limited = true;
    };
    const walk = (id: string, root: string | undefined, start: UiFlowRoutePath, calls: Set<string>) => {
      const graph = graphs.get(id), entry = root ? graph?.nodes.find(node => node.id === root) : graph?.nodes.find(node => node.type === 'event');
      const signature = id + ':' + (entry?.id ?? root ?? '');
      if (!graph || calls.has(signature) || calls.size >= 32) {
        const label = !graph ? '调用的蓝图已不存在' : calls.has(signature) ? '递归调用，后续去向需在原事件图确认' : '调用层级较多，后续去向需在原事件图确认';
        if (graph) analysis.limited = true;
        add({ target: { kind: 'logic', graphId: id, nodeId: entry?.id ?? root, dynamic: true }, label, graphId: id, nodeId: entry?.id ?? root },
          append(start, { kind: 'dynamic', label, graphId: id, nodeId: entry?.id ?? root }));
        return;
      }
      if (!entry) {
        add({ target: { kind: 'logic', graphId: id, nodeId: root, dynamic: true }, label: '调用入口已不存在', graphId: id, nodeId: root }, append(start, { kind: 'dynamic', label: '调用入口已不存在', graphId: id, nodeId: root }));
        return;
      }
      const ancestors = new Set([...calls, signature]), { nodes, outgoing } = index(graph);
      const queue = [{ id: entry.id, pin: 'exec_in', path: start, trail: new Set<string>() }], seen = new Map<string, Set<string>>();
      for (let cursor = 0; cursor < queue.length; cursor++) {
        if (++visits > maxVisits) { analysis.limited = true; return; }
        const current = queue[cursor], node = nodes.get(current.id), key = current.id + ':' + current.pin;
        if (!node || current.trail.has(key)) { analysis.limited = true; continue; }
        const variants = seen.get(key) ?? new Set<string>(), pathKey = JSON.stringify(current.path);
        if (variants.has(pathKey)) continue;
        if (variants.size >= maxPaths) { analysis.limited = true; continue; }
        variants.add(pathKey); seen.set(key, variants);
        const location = { graphId: id, nodeId: node.id }, step = (kind: UiFlowRouteStep['kind'], label: string, pinId?: string) => ({ kind, label, ...location, ...(pinId ? { pinId } : {}) });
        const wired = (pin: string) => graph.links.some(link => link.toNodeId === node.id && link.toPinId === pin);
        let path = current.path;
        if (node.type === 'showUiPage' || node.type === 'uiAction') {
          const pin = node.type === 'showUiPage' ? 'pageId' : 'screen', value = String(blueprintInputValue(node, pin) ?? ''), pageId = builtinUiPageId(value) ?? value;
          const dynamic = wired(pin) || !pageId || pageId === 'ui:save' && wired('saveMode');
          const opening = !dynamic ? node.type === 'showUiPage' ? blueprintPageOpeningOverrides(node) : { wait: true } : undefined;
          let here = path;
          if (dynamic) here = append(here, step('dynamic', wired(pin) ? '页面由输入决定：' + inputDescription(project, graph, node, pin) : pageId === 'ui:save' ? '存读档用途由输入决定：' + inputDescription(project, graph, node, 'saveMode') : '目标页面尚未指定'));
          if (node.type === 'showUiPage') for (const field of ['wait', 'modalMode']) if (wired(field)) here = append(here, step('dynamic', (field === 'wait' ? '继续时机' : '底层输入') + '由输入决定：' + inputDescription(project, graph, node, field)));
          const route: UiFlowRoute = { target: dynamic ? { kind: 'logic', graphId: id, nodeId: node.id, dynamic: true } : { kind: 'page', pageId, saveMode: blueprintInputValue(node, 'saveMode') === 'save' || value === 'save' ? 'save' : 'load' }, label: node.name, ...location, ...(opening ? { opening } : {}) };
          add(route, here);
          path = here;
          const name = dynamic ? '该页面' : uiPage(project, pageId)?.name ?? '该页面';
          const dynamicWait = node.type === 'showUiPage' && (wired('wait') || wired(pin) && typeof blueprintPageOpeningOverrides(node).wait !== 'boolean');
          if (dynamicWait) path = append(path, step('dynamic', wired('wait') ? '打开页面后的继续时机由输入决定：' + inputDescription(project, graph, node, 'wait') : '继续时机使用运行时目标页面的默认打开设置'));
          else {
            const waits = node.type === 'uiAction' || resolveUiPageOpening(project, pageId, blueprintPageOpeningOverrides(node)).wait;
            path = append(path, step(waits ? 'wait' : 'sequence', waits ? '“' + name + '”关闭并返回后继续；已打开时直接返回' : '“' + name + '”显示后继续，不等待关闭'));
            path = { ...path, sequential: true };
          }
        } else if (node.type === 'closeUiPage') {
          const pageId = String(blueprintInputValue(node, 'pageId') || graph.uiPageId || ''), dynamic = wired('pageId');
          const reason = wired('reason') ? undefined : String(blueprintInputValue(node, 'reason') ?? 'completed');
          const closeTarget = dynamic ? '要关闭的页面由输入决定：' + inputDescription(project, graph, node, 'pageId') : '请求关闭“' + (uiPage(project, pageId)?.name ?? '当前页面') + '”';
          const closeReason = wired('reason') ? '关闭原因由输入决定：' + inputDescription(project, graph, node, 'reason') : reason === 'completed' ? '完成' : reason === 'cancelled' ? '取消' : reason;
          const here = append(path, step(dynamic || wired('reason') ? 'dynamic' : 'operation', closeTarget + ' · ' + closeReason));
          add({ target: dynamic ? { kind: 'logic', graphId: id, nodeId: node.id, dynamic: true } : { kind: 'system', action: 'return', reason }, label: node.name, ...location }, here);
          path = append(here, step('condition', '关闭请求未中断当前调用时，才继续后续操作'));
        } else if (['callFunction', 'callMacro', 'startTask', 'debounce'].includes(node.type)) {
          const target = String(node.properties.graphId ?? ''), called = graphs.get(target), name = called?.name ?? '未指定模块';
          const background = node.type === 'startTask' || node.type === 'debounce', timeline = !background && node.properties.wait === false && !!called && canLaunchTimeline(project, called);
          const asynchronous = background || timeline;
          const launched = append(path, step(asynchronous ? 'async' : 'call', background ? (node.type === 'debounce' ? '后台防抖任务：' : '后台任务：') + name + '；不等待完成' : timeline ? '启动时间轴“' + name + '”；不等待播放完成' : '调用“' + name + '”'));
          if (!timeline) walk(target, undefined, launched, ancestors);
          path = append(path, step(asynchronous ? 'async' : 'call', background ? '尝试安排“' + name + '”；是否启动见后续出口' : timeline ? '时间轴“' + name + '”启动后继续，不等待播放完成' : '“' + name + '”正常返回后继续'));
          if (!asynchronous) path = { ...path, sequential: true };
        } else if (node.type === 'return' || node.type === 'finishMinigame' || node.type === 'switchScene') continue;
        else if (node.type === 'waitTask') path = append(path, step('wait', '等待任务：' + inputDescription(project, graph, node, 'handle')));
        else if (!node.type.startsWith('event') && !['branch', 'switchValue', 'sequence', 'forLoop', 'confirmMessage', 'waitTask', 'gate', 'doOnce', 'throttle'].includes(node.type)) {
          path = append(path, step(node.type === 'delay' ? 'wait' : 'operation', node.type === 'delay' ? '等待 ' + inputDescription(project, graph, node, 'seconds') + ' 秒后继续' : node.name));
        }
        const outputs = blueprintExecutionOutputs(node, current.pin), trail = new Set([...current.trail, key]);
        const connected = new Set<string>();
        for (const link of outgoing.get(node.id) ?? []) {
          if (!outputs.includes(link.fromPinId)) continue;
          // One execution outlet has one actual continuation. Damaged duplicate
          // wires remain in the source graph, but must not invent extra routes.
          if (connected.has(link.fromPinId)) { analysis.limited = true; continue; }
          connected.add(link.fromPinId);
          let next = path;
          if (node.type === 'sequence') next = append(next, { ...step('sequence', node.name + ' · ' + (node.pins.find(pin => pin.id === link.fromPinId)?.name ?? '步骤') + (outputs.indexOf(link.fromPinId) > 0 ? '；前面的步骤完成且调用未提前结束时继续' : ''), link.fromPinId), order: outputs.indexOf(link.fromPinId) + 1 });
          else if (node.type === 'forLoop') next = append(next, step(link.fromPinId === 'completed' ? 'sequence' : 'loop', link.fromPinId === 'completed' ? '循环全部结束后继续；调用提前结束时不再进入' : '循环体：可能执行多次，也可能跳过', link.fromPinId));
          else if (['gate', 'doOnce', 'throttle'].includes(node.type) && current.pin !== 'exec_in') next = append(next, step('operation', node.name + ' · ' + (node.pins.find(pin => pin.id === current.pin)?.name ?? current.pin) + '完成后继续', link.fromPinId));
          else if (['branch', 'switchValue', 'confirmMessage', 'waitTask', 'gate', 'doOnce', 'throttle', 'startTask', 'debounce'].includes(node.type)) next = append(next, step('condition', branchDescription(project, graph, node, link.fromPinId), link.fromPinId));
          else if (outputs.length > 1) next = append(next, step('dynamic', node.name + ' · ' + (node.pins.find(pin => pin.id === link.fromPinId)?.name ?? link.fromPinId), link.fromPinId));
          queue.push({ id: link.toNodeId, pin: link.toPinId, path: next, trail });
        }
      }
    };
    walk(graphId, rootId, append({ steps: [] }, trigger), new Set());
    return { routes, analysis };
  };
}

export function uiFlowRouteBadges(route: UiFlowRoute): string[] {
  const paths = route.paths ?? [];
  return [paths.some(path => path.conditional) && '按条件', paths.some(path => path.asynchronous) && '异步步骤', paths.some(path => path.repeated) && '循环',
    (route.target.kind === 'logic' && route.target.dynamic || paths.some(path => path.dynamic)) && '运行时决定', paths.some(path => path.sequential) && '有先后顺序'].filter((label): label is string => !!label);
}

export function uiFlowEventRouteSummary(event: UiFlowEvent): { title: string; description: string } {
  const badges = new Set(event.routes.flatMap(uiFlowRouteBadges));
  const modes = [badges.has('按条件') && '条件分支', badges.has('异步步骤') && '异步步骤', badges.has('运行时决定') && (event.routes.some(route => route.target.kind === 'logic' && route.target.dynamic) ? '动态去向' : '运行时输入'), badges.has('循环') && '循环'].filter(Boolean);
  if (event.routeAnalysis?.limited) return { title: '部分路线可追踪', description: '路线较复杂，这里只列出有限的来源路径；其余步骤请在原事件图查看。' };
  if (modes.length) return { title: modes.join(' · '), description: '按原图接线列出可能去向，不表示这些页面都会依次打开。展开路径可查看条件、来源和继续时机。' };
  if (badges.has('有先后顺序')) return { title: '含顺序步骤', description: '按原图指定的步骤继续；等待、取消或提前结束仍遵循原事件。下方按去向展示，先后关系见各自路径。' };
  if (event.routes.length > 1) return { title: '多个可能去向', description: '这些去向来自同一个按钮的处理逻辑；执行顺序与条件请查看原事件图。' };
  return { title: event.routes[0]?.target.kind === 'logic' ? '由事件图处理' : event.routes.length ? '单一去向' : '未连接', description: '来源路径仅解释原按钮与事件，查看不会执行或修改它们。' };
}

export function uiFlowRouteOpeningSummary(project: Project, route: UiFlowRoute): string | undefined {
  if (route.target.kind !== 'page') return;
  const graph = route.graphId ? projectGraphs(project).find(graph => graph.id === route.graphId) : undefined;
  const node = graph?.nodes.find(node => node.id === route.nodeId);
  if (graph && node) {
    const dynamic = ['wait', 'modalMode'].filter(pin => graph.links.some(link => link.toNodeId === node.id && link.toPinId === pin));
    if (dynamic.length) return dynamic.map(pin => (pin === 'wait' ? '继续时机' : '底层输入') + '由输入决定：' + inputDescription(project, graph, node, pin)).join('；');
  }
  return uiPageOpeningSummary(resolveUiPageOpening(project, route.target.pageId, route.opening));
}
