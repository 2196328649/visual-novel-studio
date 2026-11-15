import { isUiLayoutObservation } from './ui-layout';
import { uiPageLifecycleHandlers } from './ui-logic';
import { uiPageLifecyclePhases } from './ui-page-interface';
import { blueprintTaskPins, isBlueprintTaskLaunch } from './blueprint-tasks';
import { selectBlueprintChoice, blueprintChoiceDefinition, blueprintChoicePinId } from './blueprint-choice';
import { blueprintFlowControlInitial, blueprintFlowControlPageId, blueprintFlowControlScope, isBlueprintFlowControl, transitionBlueprintFlowControl } from './blueprint-flow-control';
import { uiPage, uiPageOpenProblem } from './ui-pages';
import { flowPageOpening, resolveUiPageOpening, openingInputFromModal, type UiPageOpening } from './ui-page-opening';
import { blueprintNodeDefaults, callablePins } from './blueprint';
import { rawSavedBlueprintAction } from './blueprint-authoring';
import { blueprintCapabilityNames, blueprintEnvironments, blueprintNodeCapabilities, type BlueprintCapability, type BlueprintEnvironment } from './blueprint-capability-types';
import { blueprintStaticInput, blueprintStaticOutput, staticTruth, unknownBlueprintValue as unknown, type StaticBlueprintValue as Value, type StaticValueContext } from './blueprint-static-values';
import { gameFlowRoute } from './game-flow-graph';
import { gameFlowPhaseNames, type GameFlowPhase, type GameFlowStep } from './game-flow-schema';
import { effectiveUiComponents, effectiveCharacter, type BlueprintGraph, type BlueprintNode, type Diagnostic, type Project, type StageAction, type UiComponent, type VariableValue } from './model';
import { projectGraphs } from './project-resources';
import { actionTiming } from './performance-timing';
import { visualTransitionSeconds } from './visual-transitions';
import { expandStageAction, textCommandAction } from './text-script';
import { uiActionAvailable, uiScreenPages } from './ui-availability';
import { uiControlValueType, uiTextInput } from './ui-control-events';
import { uiClickHandlers, uiEventInActiveInstance, uiGraphOnPage, uiPageComponents, uiPageShowGraphIds, standardUiEventPages } from './ui-logic';
import { uiPageNames } from './ui-names';
import { uiProperties, uiPropertyApplies, uiPropertyDefault, uiPropertyValueProblem, type UiProperty } from './ui-properties';
import { isUiControlValueProperty, isUiControlRangeProperty } from './ui-control-properties';
import { uiPropertyControlFor } from './ui-property-control';
import { blueprintUiPropertyDefinition, blueprintUiPropertyPins, type BlueprintUiPropertyRow } from './blueprint-ui-property-batch';
import { createBlueprintUiPropertyControlAnalysis } from './blueprint-ui-property-control';
import { uiLayoutProblem } from './ui-layout';

interface Session { token: number; modal: Value; parent?: string; shown: boolean; context: Context; completion: 'close' | 'auto' | 'confirm'; input?: string; closeOnEscape?: boolean }
interface Completion { reason: Value; result: Value }
interface State {
  controls: Map<string, boolean>;
  pages: Map<string, Session>;
  closed: Map<number, Completion>;
  ui: Map<string, Value>;
  events: Set<string>;
}
interface Context {
  environment?: BlueprintEnvironment;
  flow?: { phase: GameFlowPhase; step: GameFlowStep };
  origin: string;
  minigamePage?: string;
  path: string[];
  calls: string[];
  owner?: number;
  menus: string[];
  closeRequestPageId?: string;
  lifecyclePhase?: string;
}
interface Frame { graph: BlueprintGraph; inputs: Map<string, Value>; context: Context }
interface Run {
  controls: Map<string, boolean>;
  state: State;
  results: Map<string, Value>;
  outputs: Map<string, Value>;
  stop?: 'return' | 'cancelled' | 'blocked' | 'jump';
}
interface PageOutcome { state: State; reason: Value; result: Value; blocked?: boolean }
interface Handler { graphId: string; nodeId?: string }
interface EventBundle { handlers: Handler[]; component?: UiComponent; primary?: boolean; timer?: boolean; passive?: boolean; key?: string }
const cloneState = (state: State): State => ({ controls: new Map(state.controls), pages: new Map(state.pages), closed: new Map(state.closed), ui: new Map(state.ui), events: new Set(state.events) });
const cloneRun = (run: Run): Run => ({ ...run, controls: new Map(run.controls), state: cloneState(run.state), results: new Map(run.results), outputs: new Map(run.outputs) });
const emptyState = (): State => ({ controls: new Map(), pages: new Map(), closed: new Map(), ui: new Map(), events: new Set() });
const alive = (state: State, owner?: number) => owner === undefined || [...state.pages.values()].some(session => session.token === owner);
const valueKey = (value: Value) => value === unknown ? { unknown: true } : value;

export interface BlueprintCapabilitySummary { required: BlueprintCapability[]; incomplete: boolean }
export type CapabilityNode = Pick<BlueprintNode, 'type'> & Partial<Omit<BlueprintNode, 'type'>>;

/** A bounded, read-only execution analysis, not a search through every stored node. */
class BlueprintPathAnalyzer {
  private graphs: BlueprintGraph[];
  private byId: Map<string, BlueprintGraph>;
  private components: Map<string, UiComponent>;
  private propertyControls: ReturnType<typeof createBlueprintUiPropertyControlAnalysis>;
  private diagnostics: Diagnostic[] = [];
  private reported = new Set<string>();
  private required = new Set<BlueprintCapability>();
  private incomplete = false;
  private serial = 0;
  private fuel = 0;
  private readonly maxStates = 48;

  constructor(private project: Project) {
    this.graphs = projectGraphs(project);
    this.byId = new Map(this.graphs.map(graph => [graph.id, graph]));
    this.components = new Map(effectiveUiComponents(project.ui).map(component => [component.id, component]));
    for (const page of project.ui.customPages) for (const component of page.components) this.components.set(component.id, component);
    this.propertyControls = createBlueprintUiPropertyControlAnalysis(project);
  }

  analyzeGameFlow(): Diagnostic[] {
    for (const phase of ['beforeTitle', 'beforeNewGame'] as const) {
      let states = [emptyState()];
      for (const step of gameFlowRoute(this.project, phase).steps) {
        this.fuel = 24000;
        const context: Context = { environment: 'startup', flow: { phase, step }, origin: gameFlowPhaseNames[phase], path: [], calls: [], menus: [] };
        const before = states;
        if (step.kind === 'blueprint') {
          const graph = this.byId.get(step.graphId);
          if (graph) states = states.flatMap(state => this.invoke(graph, state, context, undefined, new Map(Object.entries(step.inputs ?? {}))).filter(run => !run.stop || run.stop === 'return').map(run => run.state));
        } else if (step.kind === 'page') {
          const opening = flowPageOpening(this.project, step);
          states = uiPage(this.project, step.pageId)?.template ? states.flatMap(state => this.openBuiltinPage(step.pageId, state, context)) : states.flatMap(state => this.openPage(step.pageId, opening.wait, opening.input === 'block', step.completion, state, context, undefined, opening).filter(outcome => !outcome.blocked && !(outcome.reason === 'cancelled' && step.cancel === 'title')).map(outcome => outcome.state));
        }
        if (step.allowSkip) states.push(...before.map(cloneState));
        const stateKeys = new Set<string>();
        states = this.bound(states.filter(state => {
          const key = this.stateKey(state, -1);
          if (stateKeys.has(key)) return false;
          stateKeys.add(key); return true;
        }), context);
        if (!states.length) break;
      }
      // Nonwaiting pages do not receive show/input events until an interaction.
      // The title/story handoff provides that interaction for surviving overlays.
      this.fuel = 24000;
      for (const state of states) {
        const session = [...state.pages.values()][0];
        if (session) this.settlePages(state, session.context);
      }
    }
    return this.diagnostics;
  }

  analyzeUiPages(): Diagnostic[] {
    const scheme = this.project.ui.instances?.find(instance => instance.id === this.project.ui.activeInstanceId)?.name ?? '基础界面';
    const pages = [...this.project.ui.customPages.map(page => ({ id: page.id, name: page.name })),
      ...standardUiEventPages.filter(page => !this.project.ui.disabledPages?.includes(page.name)).map(page => ({ id: page.id, name: scheme + ' / ' + uiPageNames[page.name] }))];
    for (const page of pages) {
      // Unbound legacy callable entries do not become display events. Native
      // pages without any authored blueprint hooks need no execution traversal.
      if (!uiPageShowGraphIds(this.project, page.id).length && !Object.keys(uiPageLifecyclePhases).some(phase => uiPageLifecycleHandlers(this.project, page.id, phase).length) && !this.bundles(page.id).some(bundle => bundle.handlers.length || bundle.component?.action?.startsWith('minigame'))) continue;
      this.fuel = 24000;
      const minigame = this.project.minigames.some(game => game.uiPageId === page.id);
      const context: Context = { environment: minigame ? 'minigame' : 'ui', origin: '界面 / ' + page.name,
        minigamePage: minigame ? page.id : undefined, path: [], calls: [], menus: [] };
      if (page.id.startsWith('ui:')) this.openBuiltinPage(page.id, emptyState(), context);
      else this.openPage(page.id, true, undefined, 'close', emptyState(), context);
    }
    return this.diagnostics;
  }

  analyzeCallable(graph: BlueprintGraph, inputs?: Record<string, VariableValue>): BlueprintCapabilitySummary {
    this.fuel = 24000;
    this.summarizeSurvivingPages(this.invoke(graph, emptyState(), { origin: graph.name, path: [], calls: [], menus: [] }, undefined, new Map(Object.entries(inputs ?? {}))));
    return { required: [...this.required], incomplete: this.incomplete };
  }

  analyzeNode(descriptor: CapabilityNode, callerGraph?: BlueprintGraph): BlueprintCapabilitySummary {
    this.fuel = 24000;
    const caller = callerGraph ?? (descriptor.id && this.graphs.find(graph => graph.nodes.some(node => node.id === descriptor.id)));
    const defaults = blueprintNodeDefaults(descriptor.type);
    const candidate = { ...defaults, ...descriptor, properties: { ...defaults.properties, ...descriptor.properties } };
    const target = ['callFunction', 'callMacro', 'startTask', 'debounce', 'waitTask'].includes(candidate.type) && this.byId.get(String(candidate.properties.graphId));
    if (target) candidate.pins = ['startTask', 'debounce', 'waitTask'].includes(candidate.type) ? blueprintTaskPins(candidate, target) : callablePins(target);
    // Evaluate this candidate and its dependencies only, not a caller's later
    // exec nodes. Linked runtime inputs remain unknown rather than use defaults.
    const probe: BlueprintGraph = caller ? { ...caller, requiredCapabilities: [],
      nodes: [...caller.nodes.filter(node => node.id !== candidate.id), candidate],
      links: caller.links.filter(link => link.fromNodeId !== candidate.id || !candidate.pins.some(pin => pin.id === link.fromPinId && pin.dataType === 'exec')),
    } : { id: 'capability_probe', name: '待添加节点', kind: 'function', requiredCapabilities: [], nodes: [candidate], links: [], exposedInputs: [], exposedOutputs: [] };
    this.summarizeSurvivingPages(this.invoke(probe, emptyState(), { origin: probe.name, path: [], calls: [], menus: [] }, candidate.id,
      new Map(probe.exposedInputs.map(pin => [pin.id, unknown]))));
    return { required: [...this.required], incomplete: this.incomplete };
  }

  private summarizeSurvivingPages(runs: Run[]): void {
    // A callable can leave an overlay alive after returning. Its requirements
    // include events at the next interaction, but not pages closed synchronously.
    for (const run of runs) {
      if (run.stop && run.stop !== 'return') continue;
      const session = [...run.state.pages.values()][0];
      if (session) this.settlePages(run.state, session.context);
    }
  }

  private issue(context: Context, code: string, message: string, node?: BlueprintNode, severity: Diagnostic['severity'] = 'warning', component?: UiComponent): void {
    if (['dynamicPage', 'dynamicCharacter', 'analysisLimit', 'moduleRecursion', 'menuRecursion'].includes(code)) this.incomplete = true;
    if (!context.environment) return; // Capability summaries collect requirements, not runtime diagnostics.
    if (!context.flow && !['capability', 'dynamicPage', 'dynamicCharacter', 'analysisLimit', 'moduleRecursion'].includes(code)) return;
    const fullMessage = context.origin + ' / ' + [...context.path, message].join(' → ');
    const key = JSON.stringify([context.flow?.step.id, code, node?.id, component?.id, fullMessage]);
    if (this.reported.has(key)) return;
    this.reported.add(key);
    const customPage = component && this.project.ui.customPages.find(page => page.components.some(item => item.id === component.id));
    this.diagnostics.push({ severity, code: (context.flow ? 'gameFlow.path.' : 'blueprint.path.') + code, message: fullMessage, nodeId: node?.id,
      ...(context.flow ? { gameFlow: { phase: context.flow.phase, stepId: context.flow.step.id } } : {}),
      ...(component ? { ui: { page: component.page, componentId: component.id, ...(customPage ? { customPageId: customPage.id } : this.project.ui.activeInstanceId ? { instanceId: this.project.ui.activeInstanceId } : {}) } } : {}),
    });
  }

  private limit(context: Context, node?: BlueprintNode): void {
    this.issue({ ...context, path: [] }, 'analysisLimit', '路径组合或调用深度超过静态分析上限；未分析的路径不能视为已经验证，请结合实际运行检查。', node);
  }
  private bound<T>(items: T[], context: Context): T[] {
    if (items.length > this.maxStates) this.limit(context);
    return items.slice(0, this.maxStates);
  }
  private requirements(context: Context, required: readonly BlueprintCapability[], node?: BlueprintNode): void {
    for (const capability of required) this.required.add(capability);
    const available = context.environment && blueprintEnvironments[context.environment];
    const missing = available ? required.filter(capability => !available.includes(capability)) : [];
    if (missing.length) this.issue(context, 'capability', '此执行路径需要' + missing.map(capability => blueprintCapabilityNames[capability]).join('、') + (context.flow ? '；启动流程尚未提供这些能力。' : '；当前页面运行环境不提供这些能力。'), node, 'error');
  }
  private checkNode(context: Context, node: BlueprintNode): void {
    this.requirements(context, node.type === 'showCharacter' ? ['stage'] : blueprintNodeCapabilities(node), node);
  }
  private uiValue(node: BlueprintNode, id: Value, state: State, design: boolean): Value {
    if (typeof id !== 'string') return unknown;
    const component = this.components.get(id), property = String(node.properties.property ?? 'visible');
    if (!component || !Object.hasOwn(uiProperties, property)) return unknown;
    if (design) return uiPropertyDefault(this.project, component, property as UiProperty);
    // Bound values, aliases and focus can change outside this graph; never prune
    // a capability path from a stale component-only assignment cache.
    if (uiPropertyControlFor(this.project, component, property as UiProperty) || isUiControlValueProperty(property) || isUiControlRangeProperty(property) || isUiLayoutObservation(property) || property === 'optionLabel' || property === 'focused') return unknown;
    return state.ui.get(id + ':' + property) ?? unknown;
  }
  private values(frame: Frame, run: Run): StaticValueContext {
    return { project: this.project, graph: frame.graph, inputs: frame.inputs, results: run.results,
      onRead: source => this.checkNode(frame.context, source), uiValue: (source, id, design) => this.uiValue(source, id, run.state, design) };
  }
  private read(frame: Frame, run: Run, node: BlueprintNode, pin: string): Value {
    return blueprintStaticInput(this.values(frame, run), node, pin);
  }
  private next(graph: BlueprintGraph, node: BlueprintNode, pinId?: string): { node: BlueprintNode; pin: string } | undefined {
    const link = graph.links.find(link => link.fromNodeId === node.id && (!pinId || link.fromPinId === pinId) && node.pins.some(pin => pin.id === link.fromPinId && pin.direction === 'output' && pin.dataType === 'exec'));
    const target = link && graph.nodes.find(node => node.id === link.toNodeId);
    return target && link ? { node: target, pin: link.toPinId } : undefined;
  }
  private invoke(graph: BlueprintGraph, state: State, context: Context, rootId?: string, arguments_ = new Map<string, Value>()): Run[] {
    const inputs = new Map<string, Value>(graph.exposedInputs.map(pin => [pin.id, arguments_.has(pin.id) ? arguments_.get(pin.id)! : pin.defaultValue]));
    const run: Run = { state, controls: new Map(), results: new Map(), outputs: new Map(graph.exposedOutputs.map(pin => [pin.id, pin.defaultValue])) };
    const root = rootId ? graph.nodes.find(node => node.id === rootId) : graph.nodes.find(node => node.type === 'event');
    const key = graph.id + ':' + (rootId ?? '') + ':' + (context.owner ?? '');
    const nested = { ...context, path: [...context.path, graph.name], calls: [...context.calls, key] };
    if (context.calls.includes(key)) {
      this.issue(nested, 'moduleRecursion', '此调用重新进入尚未返回的模块，无法确认完成出口。', root);
      return [{ ...run, stop: 'blocked' }];
    }
    if (--this.fuel < 0 || context.calls.length >= 48) { this.limit(context, root); return [{ ...run, stop: 'blocked' }]; }
    this.requirements(nested, graph.requiredCapabilities ?? [], root);
    for (const node of graph.nodes) {
      if (node.type === 'showUiPage') for (const pin of node.pins.filter(pin => pin.direction === 'output' && pin.dataType !== 'exec')) run.results.set(node.id + ':' + pin.id, pin.defaultValue ?? '');
      if (node.type === 'callFunction' || node.type === 'callMacro') for (const pin of this.byId.get(String(node.properties.graphId))?.exposedOutputs ?? []) run.results.set(node.id + ':out_' + pin.id, pin.defaultValue);
    }
    return root ? this.walk({ graph, inputs, context: nested }, run, root, new Set()) : [run];
  }
  private call(frame: Frame, run: Run, node: BlueprintNode, graph: BlueprintGraph, arguments_: Map<string, Value>): Run[] {
    return this.invoke(graph, run.state, frame.context, undefined, arguments_).map(called => {
      const result = { ...run, state: called.state, results: new Map(run.results), outputs: new Map(run.outputs), stop: called.stop === 'return' ? undefined : called.stop };
      for (const [id, value] of called.outputs) result.results.set(node.id + ':out_' + id, value);
      return result;
    });
  }

  private walk(frame: Frame, run: Run, node: BlueprintNode, visited: Set<string>, entryPin = 'exec_in'): Run[] {
    if (run.stop) return [run];
    if (!alive(run.state, frame.context.owner)) return [{ ...run, stop: 'cancelled' }];
    const visitKey = node.id + ':' + entryPin;
    if (visited.has(visitKey)) return [run]; // Match the compiler's entry-aware execution wires.
    if (--this.fuel < 0) { this.limit(frame.context, node); return [{ ...run, stop: 'blocked' }]; }
    const seen = new Set(visited).add(visitKey), context = frame.context;
    const read = (pin: string) => this.read(frame, run, node, pin);
    const follow = (items: Run[], pin?: string) => {
      const next = this.next(frame.graph, node, pin);
      if (this.yields(node, read)) items = this.interact(items, context);
      return this.bound(next ? items.flatMap(item => this.walk(frame, item, next.node, seen, next.pin)) : items, context);
    };
    this.checkNode(context, node);
    if (!node.pins.some(pin => pin.dataType === 'exec')) {
      // Palette probes can start at a pure expression. Use the same evaluator
      // as a real consumer instead of eagerly acquiring every input dependency.
      for (const pin of node.pins.filter(pin => pin.direction === 'output')) blueprintStaticOutput(this.values(frame, run), node, pin.id);
      return [run];
    }
    if (node.type === 'return') return [{ ...run, stop: 'return' }];
    if (node.type === 'switchScene') {
      read('sceneId');
      if (context.flow) this.issue(context, 'jump', '游戏流程中的蓝图必须完成并返回，不能在此提前跳转剧情入口。', node, 'error');
      return [{ ...run, stop: 'jump' }];
    }
    if (node.type === 'throttle') {
      for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec')) read(pin.id);
      const paths = entryPin === 'reset' ? ['updated'] : entryPin === 'exec_in' ? ['exec_out', 'blocked'] : [];
      return this.bound(paths.flatMap(pin => follow([cloneRun(run)], pin)), context);
    }
    if (isBlueprintTaskLaunch(node.type)) {
      for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec')) read(pin.id);
      const target = this.byId.get(String(node.properties.graphId));
      if (target) {
        const arguments_ = new Map<string, Value>(target.exposedInputs.map(pin => [pin.id, read('arg_' + pin.id)]));
        // Analyze requirements without claiming that asynchronous writes or
        // completion occurred in the launching call's execution order.
        this.invoke(target, cloneState(run.state), context, undefined, arguments_);
      }
      run.results.set(node.id + ':handle', unknown);
      return this.bound(['exec_out', 'blocked'].flatMap(pin => follow([cloneRun(run)], pin)), context);
    }
    if (node.type === 'waitTask') {
      read('handle'); run.results.set(node.id + ':reason', unknown);
      for (const pin of this.byId.get(String(node.properties.graphId))?.exposedOutputs ?? []) run.results.set(node.id + ':out_' + pin.id, unknown);
      return this.bound(['completed', 'cancelled', 'failed', 'missing'].flatMap(pin => follow([cloneRun(run)], pin)), context);
    }
    if (node.type === 'cancelTask') { read('handle'); run.results.set(node.id + ':cancelled', unknown); return follow([run]); }
    if (isBlueprintFlowControl(node.type)) {
      const scope = blueprintFlowControlScope(node), initial = blueprintFlowControlInitial(node);
      const pageId = scope === 'page' ? frame.graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'pageId') ? read('pageId') : read('pageId') ?? blueprintFlowControlPageId(frame.graph, node) : undefined;
      const session = typeof pageId === 'string' ? run.state.pages.get(pageId) : undefined;
      const key = scope === 'call' ? node.id : session ? session.token + ':' + frame.graph.id + ':' + node.id : undefined;
      const controls = scope === 'call' ? run.controls : run.state.controls;
      // A public module may receive an already-open page. Native menu event
      // order is not enumerated exhaustively either: never prune its live route.
      const before = key === undefined ? undefined : controls.get(key) ?? initial;
      if (before === undefined) this.incomplete = true;
      const results: Run[] = [];
      for (const state of before === undefined ? [false, true] : [before]) {
        const transition = transitionBlueprintFlowControl(node.type, entryPin, state, initial);
        if (!transition) continue;
        const next = cloneRun(run);
        if (key !== undefined) (scope === 'call' ? next.controls : next.state.controls).set(key, transition.closed);
        results.push(...follow([next], transition.output));
      }
      return this.bound(results, context);
    }
    if (node.type === 'switchValue') {
      const value = read('key'), definition = blueprintChoiceDefinition(node);
      if (definition.problems.length) { this.incomplete = true; return [run]; }
      const selected = value === unknown ? undefined : selectBlueprintChoice(node, value);
      if (selected && !selected.ok) { this.incomplete = true; return [run]; }
      const paths = selected?.ok ? [selected.pinId] : [...definition.cases!.map(item => blueprintChoicePinId(item.id)), 'default'];
      return this.bound(paths.flatMap(pin => follow([cloneRun(run)], pin)), context);
    }
    if (node.type === 'branch' || node.type === 'confirmMessage') {
      let condition: boolean | undefined;
      if (node.type === 'branch') {
        const value = read('condition');
        condition = value === undefined && node.properties.variableId ? undefined : staticTruth(value);
      } else { read('message'); }
      const pins = node.type === 'branch' ? ['true', 'false'] : ['yes', 'no'];
      const paths = condition === undefined ? pins : [pins[condition ? 0 : 1]];
      return this.bound(paths.flatMap(pin => follow([cloneRun(run)], pin)), context);
    }
    if (node.type === 'sequence') {
      let items = [run];
      for (const pin of node.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec')) items = follow(items, pin.id);
      return items;
    }
    if (node.type === 'forLoop') {
      const first = read('first_index'), last = read('last_index');
      const known = typeof first === 'number' && typeof last === 'number';
      const count = known ? Math.max(0, Math.trunc(last) - Math.trunc(first) + 1) : undefined;
      const body = this.next(frame.graph, node, 'loop_body') ?? this.next(frame.graph, node, 'loopBody');
      let items = [run];
      if (body && count !== 0) {
        if (count !== undefined && count <= 16) {
          for (let i = 0; i < count; i++) items = this.bound(items.flatMap(item => {
            item.results.set(node.id + ':index', Math.trunc(first as number) + i);
            return this.walk(frame, item, body.node, seen, body.pin);
          }), context);
        } else {
          this.limit(context, node);
          const once = cloneRun(run); once.results.set(node.id + ':index', unknown);
          items = this.walk(frame, once, body.node, seen, body.pin);
          if (count === undefined) items.push(run); // The runtime range can be empty.
        }
      }
      return follow(items, 'completed');
    }
    if (node.type === 'callFunction' || node.type === 'callMacro') {
      const graph = this.byId.get(String(node.properties.graphId));
      if (!graph) return follow([run]);
      const arguments_ = new Map(graph.exposedInputs.map((pin, index) => {
        let value = read('arg_' + pin.id);
        if (value === undefined) value = read('arg_' + index);
        return [pin.id, value === undefined ? pin.defaultValue : value] as const;
      }));
      return follow(this.call(frame, run, node, graph, arguments_));
    }
    if (node.type === 'showUiPage') {
      const id = read('pageId'), modal = read('modalMode');
      const wait = typeof id === 'string' && !Object.hasOwn(node.properties, 'wait') && !frame.graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'wait') ? resolveUiPageOpening(this.project, id, node.pageOpening).wait : staticTruth(read('wait'));
      for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.id.startsWith('arg_'))) read(pin.id);
      const typedResults = (target: Run, reason: Value) => {
        for (const pin of node.pins.filter(pin => pin.direction === 'output' && pin.id.startsWith('out_'))) target.results.set(node.id + ':' + pin.id, reason === unknown || reason === 'completed' ? unknown : pin.defaultValue);
        return target;
      };
      if (id === 'ui:save' && read('saveMode') === 'save' && (context.flow?.phase === 'beforeTitle' || context.menus.includes('ui:main'))) this.issue(context, 'saveBeforeGame', '标题宿主没有可保存的游戏进度；请选择读取存档。', node);
      if (id === unknown) {
        this.issue(context, 'dynamicPage', '页面参数来自运行时值，不能用模块默认页面替代；请在实际运行中验证目标页面的事件、能力与关闭出口。', node);
        run.results.set(node.id + ':result', unknown); run.results.set(node.id + ':reason', unknown);
        return follow([typedResults(run, unknown)]);
      }
      if (typeof id !== 'string') return follow([run]);
      const page = uiPage(this.project, id);
      if (page?.template) {
        const modeProblem = uiPageOpenProblem(this.project, id, wait, modal === unknown ? undefined : String(modal ?? 'page'));
        if (modeProblem) { this.issue(context, 'pageMode', modeProblem, node); return follow([run]); }
        if (context.menus.includes(id)) { run.results.set(node.id + ':result', ''); run.results.set(node.id + ':reason', 'alreadyOpen'); return follow([typedResults(run, 'alreadyOpen')]); }
        return follow(this.openBuiltinPage(id, run.state, context, node).map(state => {
          const result = cloneRun(run); result.state = state; result.results.set(node.id + ':result', unknown); result.results.set(node.id + ':reason', unknown); return typedResults(result, unknown);
        }));
      }
      const modes = wait === undefined ? [true, false] : [wait];
      const input = openingInputFromModal(modal);
      const outcomes = modes.flatMap(mode => this.openPage(id, mode, modal === unknown ? unknown : input === 'block' ? true : input ? false : undefined, 'close', cloneState(run.state), context, node, { ...node.pageOpening, ...(input ? { input } : {}) }));
      return follow(outcomes.map(outcome => {
        const result = cloneRun(run); result.state = outcome.state;
        result.results.set(node.id + ':result', outcome.result); result.results.set(node.id + ':reason', outcome.reason);
        if (outcome.blocked) result.stop = 'blocked';
        return typedResults(result, outcome.reason);
      }));
    }
    if (node.type === 'preventPageClose') {
      const pageId = read('pageId');
      if (typeof pageId === 'string' && context.lifecyclePhase === 'closeRequested' && context.closeRequestPageId === pageId) run.state.controls.set('closeRequest:' + pageId, true);
      return follow([run]);
    }
    if (node.type === 'closeUiPage') {
      const id = read('pageId'), value = read('result'), reason = read('reason');
      for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.id.startsWith('out_'))) read(pin.id);
      if (typeof id === 'string' && id !== context.minigamePage) return this.requestPageClose(id, reason ?? 'completed', value, run.state, context, node).flatMap(outcome => {
        const next = { ...cloneRun(run), state: outcome.state };
        return outcome.closed && context.menus.includes(id) ? [{ ...next, stop: 'cancelled' as const }] : follow([next]);
      });
      if (id === unknown) this.issue(context, 'dynamicPage', '关闭目标来自运行时页面参数，静态检查不能确认它会结束哪一个页面实例。', node);
      return follow([run]);
    }
    if (node.type === 'uiAction') {
      const screen = read('screen');
      return follow(this.openMenu(screen, run.state, context, node).map(state => ({ ...cloneRun(run), state })));
    }
    if (node.type === 'setOutput') {
      run.outputs.set(String(node.properties.outputId), read('value'));
      return follow([run]);
    }
    if (node.type === 'setUiProperty') {
      const id = read('componentId'), definition = blueprintUiPropertyDefinition(node), expected = blueprintUiPropertyPins(node);
      // All expressions observe the pre-write snapshot. Reading and writing in
      // row order would turn x <- y, y <- x into two copies of the old y.
      const writes = (definition.rows ?? []).map<BlueprintUiPropertyRow & { value: Value }>(row => ({ ...row, value: read(row.id) }));
      if (typeof id === 'string') {
        const component = this.propertyControls.component(frame.graph, node);
        // Any uncertain/rejected row prevents claiming partial success. Live
        // ranges, option lists, sources and scrolling need runtime snapshots;
        // this analysis intentionally does not simulate those snapshots.
        const uncertain = !!definition.problems.length || !expected || expected.length !== node.pins.length
          || expected.some(pin => !node.pins.some(current => current.id === pin.id && current.direction === pin.direction && current.dataType === pin.dataType))
          || !component || !!uiLayoutProblem(component) || writes.some(row => row.value === unknown || row.value === undefined
            || !Object.hasOwn(uiProperties, row.property) || !uiProperties[row.property as UiProperty].writable
            || !uiPropertyApplies(component, row.property as UiProperty, this.project)
            || !!uiPropertyValueProblem(this.project, row.property, row.value)
            || row.writeMode === 'source' || this.propertyControls.mayUsePropertySource(frame.graph, node, row.property)
            || isUiControlValueProperty(row.property) || isUiControlRangeProperty(row.property)
            || ['scrollX', 'scrollY', 'spineSkin'].includes(row.property));
        if (!definition.rows) for (const key of run.state.ui.keys()) if (key.startsWith(id + ':')) run.state.ui.set(key, unknown);
        for (const row of writes) run.state.ui.set(id + ':' + row.property, uncertain ? unknown : row.value);
        if (writes.some(row => row.property === 'spineAsset')) run.state.ui.set(id + ':spineSkin', unknown);
      } else if (id === unknown) {
        // A dynamic target can invalidate any previously cached component.
        for (const key of run.state.ui.keys()) run.state.ui.set(key, unknown);
      }
      return follow([run]);
    }
    if (node.type === 'resetUiProperty' || node.type === 'resetUiComponent') {
      const id = read('componentId');
      if (typeof id === 'string') for (const key of run.state.ui.keys()) if (node.type === 'resetUiComponent' ? key.startsWith(id + ':') : key === id + ':' + node.properties.property) run.state.ui.delete(key);
      return follow([run]);
    }
    if (node.type === 'finishMinigame') {
      if (context.minigamePage) this.closePage(run.state, context.minigamePage);
      return [{ ...run, stop: 'return' }];
    }
    if (node.type === 'savedAction' || node.type === 'sceneAction' || node.type === 'effect') {
      for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec')) read(pin.id);
      const action = node.type === 'savedAction' ? rawSavedBlueprintAction(node) : node.type === 'sceneAction' ? textCommandAction(this.project, String(node.properties.command ?? '')) : { kind: 'effect' as const, effectId: String(node.properties.effectId ?? '') };
      return follow(action ? this.action(frame, run, node, action) : [run]);
    }
    for (const pin of node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec')) read(pin.id);
    if (node.type === 'showCharacter') {
      const characterId = read('characterId');
      if (characterId === unknown && context.environment !== 'story') this.issue(context, 'dynamicCharacter', '角色参数来自运行时值；空值会使用当前台词的说话人，请确认调用时提供了明确角色。', node);
      else if (!characterId) this.requirements(context, ['dialogue'], node);
      else if (typeof characterId === 'string') return follow(this.character(frame, run, node, characterId));
    }
    return follow([run]);
  }

  private character(frame: Frame, run: Run, node: BlueprintNode, characterId: string): Run[] {
    const character = effectiveCharacter(this.project, characterId), graph = character?.blueprintId && this.byId.get(character.blueprintId);
    return graph ? this.call(frame, run, node, graph, new Map()) : [run];
  }
  private action(frame: Frame, run: Run, node: BlueprintNode, action: StageAction, depth = 0): Run[] {
    if (depth > 32) { this.limit(frame.context, node); return [run]; }
    const after = (items: Run[]) => {
      const timing = actionTiming(action);
      const linked = frame.graph.links.some(link => link.toNodeId === node.id && node.pins.some(pin => pin.id === link.toPinId && pin.dataType !== 'exec'));
      const transition = action.kind === 'visual' && action.transitionWait && (visualTransitionSeconds(action.visualTransitions?.enter) > 0 || visualTransitionSeconds(action.visualTransitions?.replace) > 0);
      return timing.wait && (timing.duration > 0 || linked) || transition ? this.interact(items, frame.context) : items;
    };
    if (action.kind === 'startDialogue') this.requirements(frame.context, ['dialogue'], node);
    if (action.kind === 'show') {
      if (!action.characterId) this.requirements(frame.context, ['dialogue'], node);
      else return after(this.character(frame, run, node, action.characterId));
    }
    if (action.kind === 'blueprint') {
      const graph = this.byId.get(action.blueprintId);
      if (graph) return this.call(frame, run, node, graph, new Map(Object.entries(action.inputs ?? {})));
    }
    if (action.kind === 'effect' || action.kind === 'characterFeature') {
      let items = [run];
      for (const nested of expandStageAction(this.project, action)) items = this.bound(items.flatMap(item => item.stop ? [item] : this.action(frame, item, node, nested, depth + 1)), frame.context);
      return items;
    }
    return after([run]);
  }

  private closePage(state: State, pageId: string, reason: Value = 'completed', result: Value = ''): void {
    const session = state.pages.get(pageId);
    if (!session) return;
    state.closed.set(session.token, { reason, result }); state.pages.delete(pageId);
    for (const key of state.controls.keys()) if (key.startsWith(session.token + ':')) state.controls.delete(key);
    for (const [childId, child] of state.pages) if (child.parent === pageId) this.closePage(state, childId, 'parentClosed', '');
    for (const event of state.events) if (event.startsWith(session.token + ':')) state.events.delete(event);
    for (const component of uiPageComponents(this.project, pageId)) for (const key of state.ui.keys()) if (key.startsWith(component.id + ':')) state.ui.delete(key);
  }

  private requestPageClose(pageId: string, reason: Value, result: Value, state: State, context: Context, node?: BlueprintNode, force = false): { state: State; closed: boolean }[] {
    const session = state.pages.get(pageId), native = context.menus.includes(pageId);
    if (!session && !native || context.closeRequestPageId === pageId && !force) return [{ state, closed: false }];
    const marker = 'closeRequest:' + pageId;
    state.controls.set(marker, false);
    const requestedContext = { ...context, owner: session?.token, closeRequestPageId: pageId, lifecyclePhase: 'closeRequested' };
    const requested = force ? [{ state, controls: new Map<string, boolean>(), results: new Map<string, Value>(), outputs: new Map<string, Value>() } as Run] : this.dispatch(uiPageLifecycleHandlers(this.project, pageId, 'closeRequested'), state, requestedContext);
    return this.bound(requested.flatMap<{ state: State; closed: boolean }>(run => {
      const prevented = run.state.controls.get(marker); run.state.controls.delete(marker);
      if (run.stop === 'blocked' || prevented && !force) return [{ state: run.state, closed: false }];
      if (session && !run.state.pages.has(pageId)) return [{ state: run.state, closed: true }];
      const losing = force ? [run] : this.dispatch(uiPageLifecycleHandlers(this.project, pageId, 'focusLost'), run.state, { ...context, owner: session?.token, closeRequestPageId: pageId, lifecyclePhase: 'focusLost' });
      return losing.flatMap(lost => {
        let finishing = [lost.state];
        for (const [childId, child] of lost.state.pages) if (child.parent === pageId) finishing = finishing.flatMap(candidate => this.requestPageClose(childId, 'parentClosed', '', candidate, child.context, node, true).map(outcome => outcome.state));
        return finishing.flatMap(candidate => {
          this.closePage(candidate, pageId, reason, result);
          return this.dispatch(uiPageLifecycleHandlers(this.project, pageId, 'closed'), candidate, { ...context, owner: undefined, closeRequestPageId: undefined, lifecyclePhase: 'closed' }).map(notified => ({ state: notified.state, closed: true }));
        });
      });
    }), context);
  }

  private bundles(pageId: string): EventBundle[] {
    const components = uiPageComponents(this.project, pageId), byId = new Map(components.map(component => [component.id, component]));
    const bundles: EventBundle[] = components.filter(component => component.kind === 'button' && (!component.action || uiActionAvailable(this.project.ui, component.action))).map(component => ({
      component, handlers: uiClickHandlers(this.project, pageId, component.id), primary: component.action !== 'blueprint',
    }));
    const grouped = new Map<string, EventBundle>();
    for (const graph of this.graphs) {
      if (!uiGraphOnPage(this.project, graph, pageId)) continue;
      for (const node of graph.nodes) {
        if (!uiEventInActiveInstance(this.project, node)) continue;
        const component = byId.get(String(node.properties.componentId));
        let key: string | undefined, timer = false;
        if ((node.type === 'eventKey' || node.type === 'eventTimer') && node.properties.pageId === pageId) {
          timer = node.type === 'eventTimer'; key = timer ? 'timer:' + node.id : 'key:' + String(node.properties.key ?? 'K_SPACE');
        } else if (node.type === 'eventButton' && component?.kind === 'button') key = component.id + ':' + String(node.properties.trigger);
        else if (node.type === 'eventValueChanged' && uiControlValueType(this.project, component)) key = component!.id + ':value';
        else if (node.type === 'eventSpine' && component?.kind === 'spine') key = component.id + ':spine:' + String(node.properties.trigger);
        else if (node.type === 'eventVideo' && component?.kind === 'video') key = component.id + ':video:' + String(node.properties.trigger);
        else if (node.type === 'eventImage' && component?.kind === 'image') key = component.id + ':image:' + String(node.properties.trigger);
        else if (node.type === 'eventTextCommitted' && uiTextInput(this.project, component)) key = component!.id + ':commit';
        else if (node.type === 'eventPage' && (node.properties.pageId || graph.uiPageId) === pageId && ['focusGained', 'focusLost'].includes(String(node.properties.phase))) key = 'lifecycle:' + node.id;
        if (!key) continue;
        let bundle = grouped.get(key);
        if (!bundle) { bundle = { handlers: [], component, timer, passive: node.type === 'eventImage' || node.type === 'eventVideo' || node.type === 'eventSpine', key: node.type === 'eventKey' ? String(node.properties.key ?? 'K_SPACE') : undefined }; grouped.set(key, bundle); }
        bundle.handlers.push({ graphId: graph.id, nodeId: node.id });
      }
    }
    return [...bundles, ...grouped.values()].filter(bundle => bundle.handlers.length || bundle.primary && bundle.component?.action);
  }
  private dispatch(handlers: Handler[], state: State, context: Context): Run[] {
    let runs: Run[] = [{ state, controls: new Map(), results: new Map(), outputs: new Map() }];
    for (const handler of handlers) {
      const graph = this.byId.get(handler.graphId);
      if (!graph) continue;
      runs = this.bound(runs.flatMap(run => {
        if (run.stop || !alive(run.state, context.owner)) return [run];
        const key = (context.owner ?? 'menu') + ':' + graph.id + ':' + (handler.nodeId ?? 'show');
        if (run.state.events.has(key)) return [run];
        run.state.events.add(key);
        return this.invoke(graph, run.state, context, handler.nodeId).map(result => {
          if (result.stop !== 'blocked') result.state.events.delete(key);
          return { ...result, stop: result.stop === 'return' ? undefined : result.stop };
        });
      }), context);
    }
    return runs;
  }
  private interactive(state: State, pageId: string): boolean {
    return this.showReady(state, pageId) && state.pages.get(pageId)?.input !== 'none';
  }
  private showReady(state: State, pageId: string): boolean {
    const pages = [...state.pages.entries()], index = pages.findIndex(([id]) => id === pageId);
    return index >= 0 && !pages.slice(index + 1).some(([, session]) => session.modal === true);
  }
  private componentInteractive(component: UiComponent, state: State, pageId: string, input = true): boolean {
    const components = uiPageComponents(this.project, pageId), seen = new Set<string>();
    let current: UiComponent | undefined = component;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (!uiPropertyControlFor(this.project, current, 'visible') && state.ui.get(current.id + ':visible') === false) return false;
      const enabled = uiPropertyControlFor(this.project, current, 'enabled') ? unknown : state.ui.get(current.id + ':enabled');
      if (input && (enabled === false || enabled === undefined && current.disabled)) return false;
      current = components.find(candidate => candidate.id === current!.parentId);
    }
    return true;
  }
  private event(bundle: EventBundle, state: State, context: Context, pageId: string): Run[] {
    const component = bundle.component;
    const nested = component ? { ...context, path: [...context.path, component.name || component.text || '控件事件'] } : context;
    let runs = this.dispatch(bundle.handlers, state, nested);
    if (!bundle.primary || !component?.action) return runs;
    runs = runs.flatMap(run => {
      if (run.stop || !alive(run.state, context.owner)) return [run];
      const action = component.action!;
      if (['start', 'mainMenu', 'rollback', 'quit'].includes(action)) {
        if (context.flow) this.issue(nested, 'jump', '此按钮会离开当前游戏流程；启动步骤应完成并返回原调用者。', undefined, 'error', component);
        return [{ ...run, stop: 'jump' as const }];
      }
      if (['minigameSuccess', 'minigameFailure', 'minigameCancel'].includes(action)) {
        this.required.add('minigame');
        if (context.environment && !blueprintEnvironments[context.environment].includes('minigame')) this.issue(nested, 'capability', '此按钮需要小游戏会话，当前页面环境不提供该会话。', undefined, 'error', component);
        else if (context.minigamePage) this.closePage(run.state, context.minigamePage);
      } else if (action === 'return' && !pageId.startsWith('ui:')) return this.requestPageClose(pageId, 'completed', '', run.state, context).map(outcome => ({ ...cloneRun(run), state: outcome.state }));
      else {
        const screen = ({ load: 'load', save: 'save', preferences: 'preferences', gallery: 'gallery', music: 'music_room', history: 'history', pause: 'pause_menu', chapterSelect: 'chapter_select', voiceCollection: 'voice_collection', flowchart: 'flowchart', staff: 'staff_roll', voiceSettings: 'voice_settings' } as Record<string, string>)[action];
        if (screen) return this.openMenu(screen, run.state, nested).map(state => ({ ...run, state }));
      }
      return [run];
    });
    return this.bound(runs, context);
  }
  private openMenu(screen: Value, state: State, context: Context, node?: BlueprintNode): State[] {
    if (screen === unknown) { this.issue(context, 'dynamicPage', '内置页面目标来自运行时参数，请验证实际显示事件与返回路径。', node); return [state]; }
    if (typeof screen !== 'string') return [state];
    if (this.project.ui.customPages.some(page => page.id === screen)) return this.openPage(screen, true, undefined, 'close', state, context, node).filter(outcome => !outcome.blocked).map(outcome => outcome.state);
    const descriptor = uiPage(this.project, screen);
    const page = descriptor?.menuScreen ? descriptor.kind : uiScreenPages[screen];
    if (!page || this.project.ui.disabledPages?.includes(page)) return [state];
    return this.openBuiltinPage('ui:' + page, state, context, node);
  }
  private openBuiltinPage(pageId: string, state: State, context: Context, node?: BlueprintNode): State[] {
    if (context.menus.includes(pageId)) {
      if (node) this.issue(context, 'menuRecursion', '内置页面在返回之前再次自动调用自身；这不是自定义页面的 alreadyOpen 复用，请检查显示事件的递归调用。', node);
      return node ? [] : [state]; // A manually revisited menu is navigation, not automatic recursion.
    }
    const nested: Context = { ...context, path: [...context.path, pageId], owner: undefined, menus: [...context.menus, pageId] };
    const shown = this.dispatch([...uiPageLifecycleHandlers(this.project, pageId, 'created'), ...uiPageShowGraphIds(this.project, pageId).map(graphId => ({ graphId }))], state, nested).filter(run => run.stop !== 'jump');
    // Created/OnShow may already have completed this menu. Do not synthesize a
    // second Return, or run interactions against an instance that has ended.
    const result = shown.flatMap(run => run.stop === 'cancelled' ? [run.state] : this.requestPageClose(pageId, 'cancelled', '', cloneState(run.state), nested, node).filter(outcome => outcome.closed).map(outcome => outcome.state));
    for (const run of shown.filter(run => !run.stop)) for (const bundle of this.bundles(pageId)) {
      if (this.fuel < 0) break;
      if (bundle.component && !this.componentInteractive(bundle.component, run.state, pageId, !bundle.passive)) continue;
      for (const outcome of this.event(bundle, cloneState(run.state), nested, pageId)) if (outcome.stop !== 'jump') { if (outcome.stop === 'cancelled') result.push(outcome.state); else result.push(...this.requestPageClose(pageId, 'cancelled', '', outcome.state, nested, node).filter(closed => closed.closed).map(closed => closed.state)); }
    }
    return this.bound(result, context);
  }
  private interact(items: Run[], context: Context): Run[] {
    return this.bound(items.flatMap(item => item.stop ? [item] : this.settlePages(item.state, context).settled.map(state => ({ ...cloneRun(item), state }))), context);
  }
  private yields(node: BlueprintNode, read: (pin: string) => Value): boolean {
    if (node.type === 'delay') return read('seconds') !== 0;
    if (node.type === 'confirmMessage' || node.type === 'uiAction') return true;
    if (['showBackground', 'showCharacter', 'hideCharacter'].includes(node.type)) return node.properties.transition !== 'none' && read('wait') !== false && read('duration') !== 0;
    return ['showChapter', 'camera', 'shake', 'animateUiProperty', 'playUiAnimation'].includes(node.type) && read('wait') !== false && read('duration') !== 0;
  }
  private stateKey(state: State, token: number): string {
    const owners = new Map([...state.pages].map(([id, session]) => [session.token, id]));
    return JSON.stringify([
      [...state.pages].map(([id, session]) => [id, valueKey(session.modal), session.input, session.closeOnEscape, session.token === token, session.parent, session.shown, session.completion]),
      [...state.controls].map(([key, value]) => [key.replace(/^([0-9]+):/, (_, id) => (owners.get(Number(id)) ?? 'closed') + ':'), value]).sort(),
      [...state.ui].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, valueKey(value)]),
      [...state.events].map(event => event.replace(/^([0-9]+):/, (_, id) => (owners.get(Number(id)) ?? 'closed') + ':')).sort(),
      state.closed.has(token) ? Object.fromEntries(Object.entries(state.closed.get(token)!).map(([key, value]) => [key, valueKey(value)])) : null,
    ]);
  }
  private openPage(pageId: string, wait: boolean, modal: Value, completion: 'close' | 'auto' | 'confirm', state: State, context: Context, node?: BlueprintNode, opening?: UiPageOpening): PageOutcome[] {
    const page = this.project.ui.customPages.find(page => page.id === pageId);
    if (!page) return [{ state, reason: unknown, result: unknown }];
    const nested: Context = { ...context, path: [...context.path, page.name] };
    if (state.pages.has(pageId)) {
      this.issue(nested, 'pageReentry', '页面已打开；本次复用已有会话并立即返回 alreadyOpen，不会再触发显示事件或建立第二个等待。', node);
      return [{ state, reason: 'alreadyOpen', result: '' }];
    }
    const settings = resolveUiPageOpening(this.project, pageId, opening);
    const token = ++this.serial, parent = settings.lifetime === 'owner' ? context.owner ? [...state.pages].find(([, session]) => session.token === context.owner)?.[0] : [...state.pages.keys()].at(-1) : undefined;
    nested.owner = token;
    state.pages.set(pageId, { token, modal: modal ?? settings.input === 'block', input: settings.input, closeOnEscape: settings.closeOnEscape, parent, shown: false, context: nested, completion: settings.autoClose > 0 ? 'auto' : completion });
    if (!wait) return [{ state, reason: 'shown', result: '' }];
    const { terminal, settled } = this.settlePages(state, nested, token);
    if ((!terminal.length || terminal.some(state => alive(state, context.owner))) && !terminal.some(state => state.closed.get(token)?.reason === 'completed')) {
      const cancellation = this.bundles(pageId).some(bundle => bundle.key === 'game_menu')
        ? '取消不等同于完成；已自定义 game_menu 按键，请另外确认取消出口。'
        : '页面可交互时可按 Esc 取消，但取消不等同于完成。';
      this.issue(nested, 'noCompletion', '静态检查没有找到可达的完成出口；' + cancellation + '请连接可执行的关闭事件，或选择自动/确认完成，并检查事件条件和嵌套页面。', node);
    }
    if (!terminal.length) return [{ state: settled[0] ?? state, reason: unknown, result: unknown, blocked: true }];
    // The wait screen polls for completion. Newly uncovered OnShow timers may
    // fire in that interaction before the original caller resumes; retain both
    // scheduling orders rather than assuming the next node is synchronous.
    const resumed = terminal.flatMap(state => [...state.pages].some(([id, session]) => !session.shown && this.showReady(state, id))
      ? [state, ...this.settlePages(cloneState(state), context, undefined, true).settled] : [state]);
    const keys = new Set<string>();
    return this.bound(resumed.filter(state => { const key = this.stateKey(state, token); if (keys.has(key)) return false; keys.add(key); return true; }), context)
      .map(state => ({ state, reason: state.closed.get(token)?.reason ?? unknown, result: state.closed.get(token)?.result ?? unknown }));
  }
  /** Explore only interactions that can actually occur while the caller yields. */
  private settlePages(state: State, context: Context, token?: number, onlyShows = false): { terminal: State[]; settled: State[] } {
    const queue: State[] = [], terminal: State[] = [], settled: State[] = [], keys = new Set<string>();
    const enqueue = (candidate: State) => {
      const key = this.stateKey(candidate, token ?? -1);
      if (keys.has(key)) return;
      keys.add(key);
      if (token !== undefined && !alive(candidate, token)) terminal.push(candidate);
      else if (queue.length < this.maxStates) queue.push(candidate);
      else this.limit(context);
    };
    enqueue(state);
    for (let index = 0; index < queue.length; index++) {
      if (this.fuel < 0) { this.limit(context); break; }
      const current = queue[index];
      // Preserve deferred shows beneath a modal, without suppressing passive pages themselves.
      const pending = [...current.pages].find(([id, session]) => !session.shown && this.showReady(current, id));
      if (pending) {
        const [pageId, session] = pending, next = cloneState(current);
        // Persist dispatch before callbacks, just like vn_ui_page_shown.
        next.pages.set(pageId, { ...session, shown: true });
        const shown = this.dispatch([...uiPageLifecycleHandlers(this.project, pageId, 'created'), ...uiPageShowGraphIds(this.project, pageId).map(graphId => ({ graphId }))], next, session.context);
        for (const run of shown) if (run.stop !== 'jump') enqueue(run.state);
        continue;
      }
      settled.push(current);
      if (onlyShows) continue;
      for (const [pageId, session] of current.pages) {
        const interactive = this.interactive(current, pageId), bundles = this.bundles(pageId);
        if (session.completion === 'auto' || session.completion === 'confirm' && interactive) {
          for (const outcome of this.requestPageClose(pageId, 'completed', '', cloneState(current), session.context)) enqueue(outcome.state);
        }
        if (interactive && session.closeOnEscape !== false && !bundles.some(bundle => bundle.key === 'game_menu')) {
          for (const outcome of this.requestPageClose(pageId, 'cancelled', '取消', cloneState(current), session.context)) enqueue(outcome.state);
        }
        for (const bundle of bundles) {
          if (!bundle.timer && !bundle.passive && !interactive || bundle.component && !this.componentInteractive(bundle.component, current, pageId, !bundle.passive)) continue;
          for (const run of this.event(bundle, cloneState(current), session.context, pageId)) if (run.stop !== 'jump') enqueue(run.state);
        }
      }
    }
    return { terminal, settled };
  }

}

export function gameFlowPathDiagnostics(project: Project): Diagnostic[] {
  return new BlueprintPathAnalyzer(project).analyzeGameFlow();
}

export function uiBlueprintPathDiagnostics(project: Project): Diagnostic[] {
  return new BlueprintPathAnalyzer(project).analyzeUiPages();
}
export function callableBlueprintCapabilities(project: Project, graph: BlueprintGraph, inputs?: Record<string, VariableValue>): BlueprintCapabilitySummary {
  return new BlueprintPathAnalyzer(project).analyzeCallable(graph, inputs);
}
export function blueprintNodeCapabilitySummary(project: Project, node: CapabilityNode, callerGraph?: BlueprintGraph): BlueprintCapabilitySummary {
  return new BlueprintPathAnalyzer(project).analyzeNode(node, callerGraph);
}
