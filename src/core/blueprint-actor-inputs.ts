import { blueprintInputSource, blueprintInputValue } from './blueprint';
import { blueprintStaticInput, unknownBlueprintValue, type StaticBlueprintValue, type StaticValueContext } from './blueprint-static-values';
import { isBlueprintNumericType } from './blueprint-numeric';
import { characterDisplayPreset } from './character-presets';
import { effectiveCharacter, type BlueprintGraph, type BlueprintNode, type Character, type Project } from './model';

export interface BlueprintActorInputProblem {
  pinId: 'characterId' | 'expressionId' | 'presetId';
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

/** Authoring can resolve pure expressions, but external inputs and live state
 * must stay unknown. A connected node's saved fallback is never its live value. */
export function blueprintActorInputs(project: Project, graph: BlueprintGraph, node: BlueprintNode) {
  const uncertainValue = Symbol('actor input analysis unknown');
  let readsRemaining = 256;
  const unsafeNumber = (value: unknown) => typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value));
  const context: StaticValueContext = {
    project, graph, inputs: new Map(), results: new Map(), uiValue: () => unknownBlueprintValue,
    onRead: source => {
      if (--readsRemaining < 0) throw uncertainValue;
      // Python math can retain integer precision or produce different modulo
      // rounding. Do not turn that estimate into a blocking actor diagnosis.
      if (source.type === 'math' || isBlueprintNumericType(source.type)) throw uncertainValue;
      if (source.type === 'literal' && unsafeNumber(source.properties.value ?? source.properties.text ?? source.pins.find(pin => pin.direction === 'output')?.defaultValue)) throw uncertainValue;
      for (const pin of source.pins) {
        if (pin.direction !== 'input' || graph.links.some(link => link.toNodeId === source.id && link.toPinId === pin.id)) continue;
        if (unsafeNumber(blueprintInputValue(source, pin.id))) throw uncertainValue;
      }
    },
  };
  const read = (pinId: string): StaticBlueprintValue => {
    try { return blueprintStaticInput(context, node, pinId); }
    catch (error) { if (error === uncertainValue) return unknownBlueprintValue; throw error; }
  };
  const connected = (pinId: string) => graph.links.some(link => link.toNodeId === node.id && link.toPinId === pinId);
  const characterValue = read('characterId'), expressionValue = read('expressionId'), presetValue = read('presetId');
  const characterLinked = connected('characterId'), presetLinked = connected('presetId');
  const characterId = typeof characterValue === 'string' && characterValue ? characterValue : undefined;
  const character: Character | undefined = characterId ? effectiveCharacter(project, characterId) : undefined;
  const runtimeCharacter = characterValue === unknownBlueprintValue || node.type === 'showCharacter' && (characterValue === undefined || characterValue === '');
  const sourceLabel = characterLinked ? blueprintInputSource(project, graph, node.id, 'characterId')?.label ?? '角色输入' : undefined;
  const characterDescription = character
    ? `实际角色：${character.name}${sourceLabel ? `；来自：${sourceLabel}` : ''}`
    : runtimeCharacter ? sourceLabel ? `角色来自：${sourceLabel}，执行时确定。` : '角色沿用执行时的当前台词角色。'
    : `角色引用不可用：${String(characterValue)}。`;
  const problems: BlueprintActorInputProblem[] = [];
  const problem = (pinId: BlueprintActorInputProblem['pinId'], severity: BlueprintActorInputProblem['severity'], code: string, message: string) => problems.push({ pinId, severity, code, message });
  if (!runtimeCharacter && !character) problem('characterId', 'error', 'blueprint-actor-character', `实际角色“${String(characterValue)}”不存在或类型无效，请修复角色输入。`);
  if (node.type === 'showCharacter') {
    if (character && expressionValue !== unknownBlueprintValue && expressionValue !== undefined && expressionValue !== '') {
      if (typeof expressionValue !== 'string' || !character.expressions.some(expression => expression.id === expressionValue || expression.name === expressionValue)) {
        problem('expressionId', 'error', 'blueprint-actor-expression', `表情“${String(expressionValue)}”不属于实际角色“${character.name}”。原表情已保留；请选择该角色的表情、输入有效表情名称，或留空使用角色默认表情。`);
      }
    } else if (runtimeCharacter && expressionValue !== unknownBlueprintValue && expressionValue !== undefined && expressionValue !== '') {
      problem('expressionId', 'warning', 'blueprint-actor-expression-runtime', `${characterDescription}表情“${String(expressionValue)}”会原样匹配实际角色；请保证此引用或名称适用于可能的角色，或留空使用角色默认表情。`);
    }
    if (character && presetValue !== unknownBlueprintValue && presetValue !== undefined && presetValue !== '' && (typeof presetValue !== 'string' || !characterDisplayPreset(project, character.id, presetValue))) {
      problem('presetId', 'error', 'blueprint-actor-preset', `站位预设“${String(presetValue)}”不属于实际角色“${character.name}”。原预设已保留，请修复预设输入。`);
    }
  }
  return {
    character, characterId, characterValue, runtimeCharacter, characterLinked, characterDescription,
    expressionValue, presetValue, presetLinked,
    presetSourceLabel: presetLinked ? blueprintInputSource(project, graph, node.id, 'presetId')?.label ?? '站位预设输入' : undefined,
    problems,
  };
}

/** Use only within an analysis or with an immutable renderer snapshot. */
export function createBlueprintActorInputAnalysis(project: Project) {
  const graphs = new WeakMap<BlueprintGraph, WeakMap<BlueprintNode, ReturnType<typeof blueprintActorInputs>>>();
  return (graph: BlueprintGraph, node: BlueprintNode) => {
    let nodes = graphs.get(graph);
    if (!nodes) { nodes = new WeakMap(); graphs.set(graph, nodes); }
    let result = nodes.get(node);
    if (!result) { result = blueprintActorInputs(project, graph, node); nodes.set(node, result); }
    return result;
  };
}

/** Resolve an authored ID or name without replacing the author's expression. */
export function blueprintActorExpression(character: Character, value: StaticBlueprintValue) {
  if (typeof value !== 'string' || !value) return undefined;
  // Runtime accepts names before IDs; later entries own repeated names.
  const named = character.expressions.filter(expression => expression.name === value);
  return named[named.length - 1] ?? character.expressions.find(expression => expression.id === value);
}

/** Option labels follow the same name-before-ID resolution as the player. */
export function blueprintActorExpressionChoices(character: Character, value: StaticBlueprintValue) {
  const choices = character.expressions.map(expression => {
    const resolved = blueprintActorExpression(character, expression.id)!;
    return {
      value: expression.id,
      label: resolved.id === expression.id ? expression.name : `${resolved.name}（名称优先 · ${resolved.id}；原值 ${expression.id}）`,
    };
  });
  if (value !== unknownBlueprintValue && value !== undefined && value !== '' && !choices.some(choice => choice.value === value)) {
    const resolved = blueprintActorExpression(character, value);
    choices.unshift({ value: String(value), label: resolved ? `${resolved.name}（表情名称引用 · ${resolved.id}）` : `不属于当前角色 · ${String(value)}` });
  }
  return choices;
}
