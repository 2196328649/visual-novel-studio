import { effectiveUiComponents, effectiveUiTheme, type BlueprintNode, type Project } from './model';
import { blueprintExecutionOutputs } from './blueprint-execution-ports';
import { blueprintStatePageId, blueprintStateScope } from './blueprint-state';
import { blueprintStaticInput, unknownBlueprintValue, type StaticValueContext } from './blueprint-static-values';
import { gameFlowPhaseNames, type GameFlowPhase } from './game-flow-schema';
import { flowNodeName, flowStepNodeId, gameFlowConnections, gameFlowRoute, gameFlowSteps } from './game-flow-graph';
import { projectGraphs } from './project-resources';
import { uiClickHandlers, uiPageShowGraphIds, uiPageLifecycleHandlers, uiPageComponents } from './ui-logic';
import { uiPageLifecyclePhases } from './ui-page-interface';
import { uiPages, uiGameOverEnabled } from './ui-pages';
import { builtinUiPageId, builtinUiPages, uiActionPages, uiMainButtons, uiMenuButtons, uiQuickButtons, uiPauseButtons, uiPauseWidgetButtons, type BuiltinUiPage } from './ui-page-catalog';
import { uiActionAvailable, uiMenuShortcut } from './ui-availability';
import { preferenceInfo, replacesStandardPreferences } from './preferences';
import { replacesMainButton } from './ui-native-main';

export interface UiPageUsage {
  key: string; label: string;
  phase?: GameFlowPhase; stepId?: string; graphId?: string; nodeId?: string;
  storyNodeId?: string; lineId?: string; componentId?: string; pageId?: string; instanceId?: string;
  /** References alone do not open a page. Unknown runtime targets stay explicit. */
  reference?: boolean; dynamic?: boolean; inactive?: boolean; system?: boolean; setting?: 'menuShortcut';
}

export function pageButtonProject(project: Project, instanceId?: string): Project {
  if (instanceId !== undefined && instanceId !== 'base' && !project.ui.instances?.some(i => i.id === instanceId)) throw new Error('按钮所属的界面方案已不存在。');
  return instanceId === undefined ? project : { ...project, ui: { ...project.ui, activeInstanceId: instanceId === 'base' ? undefined : instanceId } };
}
export function pageConnectionButtons(project: Project, includeDisabled = false) {
  const enabled = (page: string) => includeDisabled || !project.ui.disabledPages?.some(id => page === 'ui:' + id);
  return [
    ...[{ id: 'base', name: '基础界面' }, ...(project.ui.instances ?? [])].flatMap(scheme =>
      effectiveUiComponents(pageButtonProject(project, scheme.id).ui).filter(c => c.kind === 'button' && enabled('ui:' + c.page)).map(component => ({
        key: scheme.id + ':' + component.id, pageId: 'ui:' + component.page, instanceId: scheme.id, component,
        label: scheme.name + ' / ' + (builtinUiPages[component.page as BuiltinUiPage]?.name ?? component.page) + ' / ' + (component.name || component.text || component.id),
      }))),
    ...project.ui.customPages.flatMap(page => page.components.filter(c => c.kind === 'button').map(component => ({ key: page.id + ':' + component.id, pageId: page.id, instanceId: undefined, component, label: page.name + ' / ' + (component.name || component.text || component.id) }))),
  ];
}

/** One pass over all pages, then a reverse call graph. This is an inventory of
 * configured entry points, not a claim that every branch executes at runtime. */
export function collectUiPageUsages(project: Project): Map<string, UiPageUsage[]> {
  const result = new Map(uiPages(project).map(page => [page.id, [] as UiPageUsage[]]));
  const add = (pageId: string, use: UiPageUsage) => {
    if (!result.has(pageId)) result.set(pageId, []);
    const list = result.get(pageId)!;
    if (!list.some(item => item.key === use.key)) list.push(use);
  };
  const enabled = (page: BuiltinUiPage) => !project.ui.disabledPages?.includes(page);
  const theme = effectiveUiTheme(project.ui), components = effectiveUiComponents(theme);
  const authored = (page: BuiltinUiPage) => components.filter(c => c.page === page);
  const native = (page: BuiltinUiPage) => enabled(page) && theme.pages?.[page]?.layout !== 'custom';
  const system = (page: BuiltinUiPage, key: string, label: string, extra: Partial<UiPageUsage> = {}) => {
    if (enabled(page)) add('ui:' + page, { key: 'system:' + key, label, system: true, ...extra });
  };
  system('main', 'launch', '游戏启动 → 标题', { phase: 'beforeTitle' });
  system('say', 'dialogue', '剧情对白时自动显示');
  system('choice', 'choice', '剧情出现选项时自动显示');
  system('messageBox', 'confirmation', '退出、覆盖存档等系统确认');
  if (uiGameOverEnabled(project)) system('gameOver', 'ending', '剧情结束时显示');
  const shortcut = uiMenuShortcut(theme), shortcutPage = shortcut && uiActionPages[shortcut];
  if (shortcutPage) system(shortcutPage, 'shortcut', 'Esc / 鼠标右键打开' + (theme.menuShortcutPage && theme.menuShortcutPage !== shortcut ? '（原菜单已停用，使用可用菜单）' : ''), { setting: 'menuShortcut' });
  const nativeButtons = (from: BuiltinUiPage, buttons: typeof uiMainButtons, label: string, replace = false) => {
    for (const [action] of buttons) {
      const target = uiActionPages[action];
      if (!target || !uiActionAvailable(theme, action) || replace && authored(from).some(c => from === 'main' ? replacesMainButton(c, action) : c.kind === 'button' && c.action === action)) continue;
      system(target, from + ':' + label + ':' + action, builtinUiPages[from].name + ' · ' + label, { pageId: 'ui:' + from });
    }
  };
  if (native('main')) nativeButtons('main', uiMainButtons, '系统菜单按钮', true);
  if (enabled('say') && theme.pages?.say?.showQuickMenu !== false) nativeButtons('say', uiQuickButtons, '底部快捷菜单');
  for (const [page, definition] of Object.entries(builtinUiPages)) if (definition.menu && native(page as BuiltinUiPage)) nativeButtons(page as BuiltinUiPage, uiMenuButtons, '系统导航按钮');
  if (native('pause') && !authored('pause').some(c => c.kind === 'pauseMenu')) nativeButtons('pause', uiPauseButtons, '暂停菜单按钮');
  for (const page of Object.keys(builtinUiPages) as BuiltinUiPage[]) if (enabled(page) && authored(page).some(c => c.kind === 'pauseMenu')) nativeButtons(page, uiPauseWidgetButtons, '暂停菜单控件');
  if (native('preferences') && !replacesStandardPreferences(authored('preferences')) && preferenceInfo(project, 'characterVolume').visible) nativeButtons('preferences', [['voiceSettings', '角色音量']], '角色音量入口', true);

  const graphs = projectGraphs(project), byId = new Map(graphs.map(graph => [graph.id, graph]));
  const destinations = new Map<string, Set<string>>(), callers = new Map<string, Set<string>>();
  const direct: { graphId: string; node: BlueprintNode; pageId: string }[] = [], dynamic: UiPageUsage[] = [];
  const nodeTargets = new Map<string, Map<string, string>>(), nodeCalls = new Map<string, Map<string, string>>();
  const execution = new Map(graphs.map(graph => {
    const links = new Map<string, typeof graph.links>();
    for (const link of graph.links) { if (!links.has(link.fromNodeId)) links.set(link.fromNodeId, []); links.get(link.fromNodeId)!.push(link); }
    return [graph.id, { nodes: new Map(graph.nodes.map(node => [node.id, node])), links }];
  }));
  for (const graph of graphs) {
    const targets = new Map<string, string>(), calls = new Map<string, string>();
    nodeTargets.set(graph.id, targets); nodeCalls.set(graph.id, calls);
    const context: StaticValueContext = { project, graph, inputs: new Map(), results: new Map(), onRead: () => {}, uiValue: () => unknownBlueprintValue };
    for (const node of graph.nodes) {
      const pin = node.type === 'showUiPage' ? 'pageId' : node.type === 'uiAction' ? 'screen' : undefined;
      let target: string | undefined;
      if (pin) {
        const value = blueprintStaticInput(context, node, pin);
        if (value === unknownBlueprintValue) dynamic.push({ key: 'dynamic:' + graph.id + ':' + node.id, label: '动态页面调用 · ' + graph.name + '（目标在运行时决定）', graphId: graph.id, nodeId: node.id, reference: true, dynamic: true });
        else if (typeof value === 'string') target = node.type === 'uiAction' ? builtinUiPageId(value) ?? value : value;
      } else if (node.type === 'showChapter') target = 'ui:chapterTitle';
      else if (node.type === 'confirmMessage') target = 'ui:messageBox';
      let callee = ['callFunction', 'callMacro', 'startTask', 'debounce'].includes(node.type) ? String(node.properties.graphId ?? '') : '';
      if (node.type === 'savedAction') {
        try {
          const action = JSON.parse(String(node.properties.action));
          if (action.kind === 'blueprint') callee = action.blueprintId;
          if (action.kind === 'chapter') target = 'ui:chapterTitle';
        } catch { /* Invalid serialized actions remain diagnostic data. */ }
      }
      if (callee && byId.has(callee)) calls.set(node.id, callee);
      if (target) {
        targets.set(node.id, target); direct.push({ graphId: graph.id, node, pageId: target });
      }
    }
  }
  // Follow execution wires from the actual callback. Disconnected nodes remain
  // references; another button's event in the same graph is not this callback.
  const localCache = new Map<string, { pages: Set<string>; calls: Set<string> }>();
  const local = (graphId: string, nodeId?: string) => {
    const key = graphId + ':' + (nodeId ?? '@call'), cached = localCache.get(key);
    if (cached) return cached;
    const found = { pages: new Set<string>(), calls: new Set<string>() }; localCache.set(key, found);
    const graph = byId.get(graphId), index = execution.get(graphId);
    if (!graph || !index) return found;
    const roots = nodeId ? [nodeId] : graph.nodes.filter(node => node.type === 'event').map(node => node.id);
    const queue = roots.map(id => ({ id, pin: 'exec_in' })), seen = new Set<string>();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const step = queue[cursor], signature = step.id + ':' + step.pin, node = index.nodes.get(step.id);
      if (!node || seen.has(signature)) continue;
      seen.add(signature);
      const page = nodeTargets.get(graphId)?.get(node.id), callee = nodeCalls.get(graphId)?.get(node.id);
      if (page) found.pages.add(page); if (callee) found.calls.add(callee);
      const outputs = blueprintExecutionOutputs(node, step.pin);
      for (const link of index.links.get(node.id) ?? []) if (outputs.includes(link.fromPinId)) queue.push({ id: link.toNodeId, pin: link.toPinId });
    }
    return found;
  };
  for (const graph of graphs) {
    const found = local(graph.id); destinations.set(graph.id, new Set(found.pages));
    for (const callee of found.calls) { if (!callers.has(callee)) callers.set(callee, new Set()); callers.get(callee)!.add(graph.id); }
  }
  const queue = [...destinations.keys()];
  for (let index = 0; index < queue.length; index++) for (const caller of callers.get(queue[index]) ?? []) {
    if (!destinations.has(caller)) destinations.set(caller, new Set());
    const pages = destinations.get(caller)!; let changed = false;
    for (const pageId of destinations.get(queue[index])!) if (!pages.has(pageId)) { pages.add(pageId); changed = true; }
    if (changed) queue.push(caller);
  }
  const call = (graphId: string | undefined, use: UiPageUsage) => {
    if (!graphId) return;
    const found = local(graphId, use.nodeId);
    for (const pageId of found.pages) add(pageId, use);
    for (const callee of found.calls) for (const pageId of destinations.get(callee) ?? []) add(pageId, use);
  };
  const connections = gameFlowConnections(project);
  for (const phase of ['beforeTitle', 'beforeNewGame'] as const) {
    const connected = new Set(gameFlowRoute(project, phase).steps.map(step => step.id));
    for (const step of gameFlowSteps(project, phase)) {
      const next = connections[flowStepNodeId(step.id)], inactive = !connected.has(step.id);
      const use = { key: step.id, label: '流程蓝图 · ' + gameFlowPhaseNames[phase] + ' → ' + (inactive ? '尚未连接入口，不会执行' : next ? '完成后进入 ' + flowNodeName(project, next) : '尚未连接完成出口'), phase, stepId: step.id, inactive };
      if (step.kind === 'page') add(step.pageId, use);
      else if (step.kind === 'blueprint') call(step.graphId, use);
    }
  }
  for (const node of project.nodes) {
    if (node.kind === 'chapterTitle') add('ui:chapterTitle', { key: 'chapter:' + node.id, label: '旧章节 · ' + node.name, storyNodeId: node.id });
    if (node.kind === 'passage') for (const line of node.lines) line.actions.forEach((action, index) => {
      const use = { key: line.id + ':' + index, label: '剧情 · ' + node.name + ' / ' + (line.text.slice(0, 24) || '演出'), storyNodeId: node.id, lineId: line.id };
      if (action.kind === 'blueprint') call(action.blueprintId, { ...use, graphId: action.blueprintId });
      if (action.kind === 'chapter') add('ui:chapterTitle', use);
    });
  }
  for (const scene of project.scenes) {
    call(scene.blueprintId, { key: scene.id, label: '场景入口 · ' + scene.name, graphId: scene.blueprintId });
    scene.entryActions?.forEach((action, index) => {
      if (action.kind === 'blueprint') call(action.blueprintId, { key: scene.id + ':' + index, label: '场景进入演出 · ' + scene.name, graphId: action.blueprintId });
    });
  }
  for (const target of pageConnectionButtons(project, true)) {
    const scoped = pageButtonProject(project, target.instanceId), disabled = target.pageId.startsWith('ui:') && !enabled(target.pageId.slice(3) as BuiltinUiPage);
    const other = target.instanceId !== undefined && target.instanceId !== (project.ui.activeInstanceId ?? 'base');
    const buttonDisabled = target.component.disabled || target.component.action && !uiActionAvailable(theme, target.component.action);
    const use = { key: target.key, label: '按钮 · ' + target.label + (disabled ? '（来源页面已停用）' : other ? '（其他方案）' : buttonDisabled ? '（按钮已停用）' : ''), componentId: target.component.id, pageId: target.pageId, instanceId: target.instanceId, inactive: !!(disabled || other || buttonDisabled) };
    const actionPage = target.component.action && uiActionPages[target.component.action];
    if (actionPage) add('ui:' + actionPage, { ...use, key: target.key + ':action' });
    for (const handler of uiClickHandlers(scoped, target.pageId, target.component.id)) call(handler.graphId, { ...use, key: target.key + ':' + handler.graphId + ':' + (handler.nodeId ?? handler.source), graphId: handler.graphId, nodeId: handler.nodeId });
  }
  for (const scheme of [{ id: 'base', name: '基础界面' }, ...(project.ui.instances ?? [])]) {
    const scoped = pageButtonProject(project, scheme.id), other = scheme.id !== (project.ui.activeInstanceId ?? 'base');
    for (const page of uiPages(project).filter(page => page.template || !other)) {
      const label = '页面事件 · ' + (page.template ? scheme.name + ' / ' : '') + page.name;
      const use = { key: scheme.id + ':' + page.id, label, pageId: page.id, instanceId: page.template ? scheme.id : undefined, inactive: page.disabled || page.template && other };
      for (const graphId of uiPageShowGraphIds(scoped, page.id)) call(graphId, { ...use, key: use.key + ':show:' + graphId, label: label + ' / 显示时', graphId });
      for (const [phase, info] of Object.entries(uiPageLifecyclePhases)) for (const handler of uiPageLifecycleHandlers(scoped, page.id, phase)) call(handler.graphId, { ...use, key: use.key + ':' + handler.nodeId, label: label + ' / ' + info.name, graphId: handler.graphId, nodeId: handler.nodeId });
      if (!page.template && uiPageComponents(scoped, page.id).some(c => c.kind === 'pauseMenu')) {
        for (const [action] of uiPauseWidgetButtons) if (uiActionPages[action] && uiActionAvailable(theme, action)) add('ui:' + uiActionPages[action], { ...use, key: use.key + ':pause:' + action, label: page.name + ' · 暂停菜单控件' });
      }
    }
  }
  for (const { graphId, node, pageId } of direct) add(pageId, { key: graphId + ':' + node.id, label: '蓝图引用 · ' + byId.get(graphId)!.name + ' / ' + node.name, graphId, nodeId: node.id, reference: true });
  for (const graph of graphs) for (const node of graph.nodes) {
    if (!['getVariable', 'setVariable'].includes(node.type) || blueprintStateScope(project, node) !== 'page') continue;
    const pageId = blueprintStatePageId(graph, node);
    if (!pageId || graph.uiPageId === pageId) continue;
    add(pageId, { key: 'state:' + graph.id + ':' + node.id, label: '页面状态 · ' + graph.name + ' / ' + node.name, graphId: graph.id, nodeId: node.id, reference: true });
  }
  for (const pageId of result.keys()) for (const use of dynamic) add(pageId, use);
  return result;
}

export function uiPageUsages(project: Project, pageId: string) { return collectUiPageUsages(project).get(pageId) ?? []; }
export function uiPageUsageSummary(usages: readonly UiPageUsage[]) {
  const entries = usages.filter(use => !use.reference && !use.inactive);
  if (entries.some(use => use.setting === 'menuShortcut')) return 'Esc / 右键打开';
  if (entries.some(use => use.componentId)) return '菜单按钮打开';
  if (entries.some(use => use.storyNodeId || use.phase && !use.system)) return '剧情 / 流程接入';
  if (entries.some(use => use.system)) return '系统自动 / 菜单入口';
  if (entries.length) return '已配置入口';
  if (usages.some(use => use.dynamic)) return '存在动态调用';
  if (usages.length) return '仅引用 / 其他方案';
  return '尚未接入';
}
