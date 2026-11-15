import { evaluateBlueprintChoice, blueprintChoiceDefinition, blueprintChoicePinId, validBlueprintChoiceValue } from './blueprint-choice';
import { evaluateBlueprintNumeric, isBlueprintNumericType } from './blueprint-numeric';
import { blueprintInputValue } from './blueprint';
import type { BlueprintGraph, BlueprintNode, Project, VariableValue } from './model';

/** Unknown runtime data is different from an absent argument (which may use a default). */
export const unknownBlueprintValue = Symbol('unknown blueprint value');
export type StaticBlueprintValue = VariableValue | undefined | typeof unknownBlueprintValue;
type Value = StaticBlueprintValue;
const unknown: typeof unknownBlueprintValue = unknownBlueprintValue;
export const staticTruth = (value: Value): boolean | undefined => value === unknown ? undefined : !!value;
const pyString = (value: Exclude<Value, typeof unknown>) => value === undefined ? 'None' : typeof value === 'boolean' ? value ? 'True' : 'False' : String(value);
const numeric = (value: Value) => typeof value === 'number' || typeof value === 'boolean' ? Number(value) : undefined;

export interface StaticValueContext {
  project: Project;
  graph: BlueprintGraph;
  inputs: ReadonlyMap<string, Value>;
  results: ReadonlyMap<string, Value>;
  /** Called only for a value expression that the player actually evaluates. */
  onRead(node: BlueprintNode): void;
  uiValue(node: BlueprintNode, componentId: Value, designDefault: boolean): Value;
}

/** No eval, project mutation, or use of a variable's initial value as its live value. */
export function blueprintStaticInput(context: StaticValueContext, node: BlueprintNode, pinId: string, visited = new Set<string>()): Value {
  const { graph } = context;
  const incoming = graph.links.find(link => link.toNodeId === node.id && link.toPinId === pinId);
  if (!incoming) return blueprintInputValue(node, pinId);
  const source = graph.nodes.find(node => node.id === incoming.fromNodeId);
  return source ? blueprintStaticOutput(context, source, incoming.fromPinId, visited) : unknown;
}

/** Evaluate a value expression, including short-circuiting, without running exec wires. */
export function blueprintStaticOutput(context: StaticValueContext, source: BlueprintNode, pinId: string, visited = new Set<string>()): Value {
  const { inputs, results } = context;
  const key = source.id + ':' + pinId;
  if (visited.has(key)) return unknown;
  const next = new Set(visited).add(key);
  const read = (pin: string) => blueprintStaticInput(context, source, pin, next);
  context.onRead(source);
  if (isBlueprintNumericType(source.type)) {
    const result = evaluateBlueprintNumeric(source.type, read, source.properties.mode ?? 'nearest');
    return result.ok ? result.value : unknown;
  }
  switch (source.type) {
    case 'literal': return source.properties.value ?? source.properties.text ?? source.pins.find(pin => pin.id === pinId)?.defaultValue;
    case 'getInput': return inputs.has(String(source.properties.inputId)) ? inputs.get(String(source.properties.inputId))! : unknown;
    case 'getPageInput': case 'getPageOutput': read('pageId'); return unknown;
    case 'getVariable': case 'getMinigameValue': case 'eventPage': case 'eventValueChanged': case 'eventTextCommitted': case 'eventImage': case 'eventVideo': case 'eventSpine': return unknown;
    case 'focusUiComponent': case 'startTask': case 'debounce': case 'cancelTask': case 'waitTask': case 'callFunction': case 'callMacro': case 'showUiPage': case 'forLoop':
      // Reading an output does not execute the source node or its module.
      return results.has(key) ? results.get(key)! : unknown;
    case 'taskStatus': read('handle'); return unknown;
    case 'getUiControlOption': read('componentId'); read('index'); return unknown;
    case 'not': case 'and': case 'or': case 'xor': {
      const a = read('a');
      if (source.type === 'not') return typeof a === 'boolean' ? !a : unknown;
      if (source.type === 'and' && a === false || source.type === 'or' && a === true) return a;
      const b = read('b');
      if (typeof a !== 'boolean' || typeof b !== 'boolean') {
        if (a === unknown && typeof b === 'boolean' && (source.type === 'and' && !b || source.type === 'or' && b)) return b;
        return unknown;
      }
      return source.type === 'xor' ? a !== b : b;
    }
    case 'selectByKey': {
      const key = read('key');
      if (key === unknown) {
        // Unknown keys may select any value. Read all possible dependencies,
        // but never pretend an invalid configuration is a known result.
        const definition = blueprintChoiceDefinition(source); if (definition.problems.length) return unknown;
        const values = [...definition.cases!.map(item => read(blueprintChoicePinId(item.id))), read('default')];
        return validBlueprintChoiceValue(definition.valueType!, values[0]) && values.every(value => value === values[0]) ? values[0] : unknown;
      }
      const result = evaluateBlueprintChoice(source, pin => pin === 'key' ? key : read(pin));
      return result.ok ? result.value : unknown;
    }
    case 'select': {
      const condition = staticTruth(read('condition'));
      if (condition !== undefined) return read(condition ? 'true_value' : 'false_value');
      const yes = read('true_value'), no = read('false_value');
      return yes === no ? yes : unknown;
    }
    case 'compare': {
      const a = read('a'), b = read('b');
      if (a === unknown || b === unknown) return unknown;
      const na = numeric(a), nb = numeric(b), operator = String(source.properties.operator ?? 'eq');
      const equal = na !== undefined && nb !== undefined ? na === nb : a === b;
      if (operator === 'eq') return equal;
      if (operator === 'ne') return !equal;
      // Keep unsupported Python comparisons dynamic rather than prune a real route.
      if (na === undefined || nb === undefined) return unknown;
      return operator === 'gt' ? na > nb : operator === 'gte' ? na >= nb : operator === 'lt' ? na < nb : operator === 'lte' ? na <= nb : unknown;
    }
    case 'math': {
      const a = numeric(read('a')), b = numeric(read('b'));
      if (a === undefined || b === undefined) return unknown;
      const op = String(source.properties.operation ?? source.properties.operator ?? 'add');
      let value: number;
      if (['subtract', 'sub', '-'].includes(op)) value = a - b;
      else if (['multiply', 'mul', '*'].includes(op)) value = a * b;
      else if (['divide', 'div', '/'].includes(op)) value = b ? a / b : NaN;
      else if (['modulo', 'mod', '%'].includes(op)) value = b ? ((a % b) + b) % b : NaN;
      else if (op === 'min') value = Math.min(a, b);
      else if (op === 'max') value = Math.max(a, b);
      else value = a + b;
      return Number.isFinite(value) ? value : unknown;
    }
    case 'random': { const min = read('min'), max = read('max'); return typeof min === 'number' && min === max ? min : unknown; }
    case 'formatText': {
      const format = read('format'), value = read('value');
      if (format === unknown || value === unknown) return unknown;
      // This abstraction does not retain Python's int/float distinction: 1 / 1
      // formats as '1.0', unlike JavaScript's String(1). Never prune on that guess.
      if (typeof format === 'number' || typeof value === 'number') return unknown;
      return pyString(format).replaceAll('{value}', pyString(value));
    }
    case 'getUiProperty': case 'getUiDefault': return context.uiValue(source, read('componentId'), source.type === 'getUiDefault');
    case 'getPlayerPreference': read('characterId'); return unknown;
    default: return unknown;
  }
}
