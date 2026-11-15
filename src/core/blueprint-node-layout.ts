import { isBlueprintNumericType } from './blueprint-numeric';
import { blueprintUiPropertyDefinition } from './blueprint-ui-property-batch';
import { blueprintAssetNodeKind } from './blueprint-asset-node';
import type { BlueprintNode, BlueprintPin } from './model';

export interface BlueprintNodeLayoutOptions {
  /** Hides value editors and short property fields, not the pins themselves. */
  parametersCollapsed?: boolean;
  advancedExpanded?: boolean;
  connectedInputs?: ReadonlySet<string>;
  hasProblem?: boolean;
}

export interface BlueprintNodeLayoutRow { input?: BlueprintPin; output?: BlueprintPin }
export interface BlueprintNodeSize { width: number; height: number }
export interface BlueprintNodeLayout {
  executionRows: BlueprintNodeLayoutRow[];
  dataRows: BlueprintNodeLayoutRow[];
  hiddenInputs: BlueprintPin[];
  advancedInputs: BlueprintPin[];
  /** Original pin order, suitable for checking connection handles. */
  visiblePinIds: string[];
  signature: string;
  /** Conservative fallback until the renderer has measured the node. */
  estimatedSize: BlueprintNodeSize;
}

// Only these explicit presentation choices may hide an unchanged data input.
// Optional inputs on all other nodes, including dynamic interfaces, stay visible.
const advancedInputIds: Partial<Record<BlueprintNode['type'], readonly string[]>> = {
  showCharacter: ['instanceId', 'useDefaultFraming', 'x', 'y', 'scale', 'layer'],
  showChapter: ['backgroundId', 'titleImageId', 'soundId', 'effect'],
  camera: ['rotation'],
};
const referenceTypes = new Set<BlueprintPin['dataType']>(['asset', 'scene', 'character', 'ui', 'component']);

/** Keep the property lookup identical to blueprintInputValue without importing
 * the graph mutation module (and its runtime dependency graph) into layout. */
function inputValue(node: BlueprintNode, pin: BlueprintPin): unknown {
  const key = pin.id === 'first_index' ? 'firstIndex' : pin.id === 'last_index' ? 'lastIndex' : pin.id;
  return node.properties[key] ?? pin.defaultValue;
}

function validValue(pin: BlueprintPin, value: unknown): boolean {
  if (pin.dataType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (pin.dataType === 'boolean') return typeof value === 'boolean';
  if (pin.dataType === 'any') return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
  return (pin.dataType === 'string' || referenceTypes.has(pin.dataType)) && typeof value === 'string';
}

function rows(inputs: BlueprintPin[], outputs: BlueprintPin[]): BlueprintNodeLayoutRow[] {
  return Array.from({ length: Math.max(inputs.length, outputs.length) }, (_, index) => ({
    ...(inputs[index] ? { input: inputs[index] } : {}),
    ...(outputs[index] ? { output: outputs[index] } : {}),
  }));
}

function getterNode(node: BlueprintNode): boolean {
  return ['getVariable', 'getInput', 'getPlayerPreference', 'getMinigameValue'].includes(node.type)
    && !node.pins.some(pin => pin.direction === 'input')
    && node.pins.filter(pin => pin.direction === 'output').length === 1;
}

function compactValueNode(node: BlueprintNode): boolean {
  return !node.type.startsWith('event') && node.type !== 'comment'
    && !['callFunction', 'callMacro', 'startTask', 'debounce', 'waitTask'].includes(node.type)
    && node.pins.every(pin => pin.dataType !== 'exec')
    && (isBlueprintNumericType(node.type) || ['not', 'and', 'or', 'xor', 'math', 'compare', 'select', 'selectByKey', 'literal'].includes(node.type));
}

function estimatedSize(node: BlueprintNode, options: BlueprintNodeLayoutOptions, executionRows: BlueprintNodeLayoutRow[], dataRows: BlueprintNodeLayoutRow[], advancedInputs: BlueprintPin[]): BlueprintNodeSize {
  if (blueprintAssetNodeKind(node)) return { width: 232, height: 72 };
  if (getterNode(node)) return { width: 240, height: 40 };
  if (node.type === 'setUiProperty') {
    const definition = blueprintUiPropertyDefinition(node);
    const extraModes = options.parametersCollapsed ? 0 : (definition.rows ?? []).filter(row => ['numberValue', 'stringValue', 'booleanValue', 'normalizedValue', 'optionIndex'].includes(row.property)
      || row.writeMode !== 'override').length;
    // Dedicated rows show the property selector beside each input. Reserve the
    // add control, two lines of status and per-control write mode before first
    // measurement so insertion and automatic arrangement have enough room.
    return { width: 320, height: 32 + executionRows.length * 32 + dataRows.length * 28 + extraModes * 26 + (options.parametersCollapsed ? 0 : 64) + 8 };
  }
  if (node.type === 'comment') {
    // The note body wraps and scrolls above 240px. Allow roughly 22 full-width
    // characters per line so the unmeasured fallback also covers Chinese prose.
    const lines = String(node.properties.text ?? '').split(/\r\n|\r|\n/)
      .reduce((count, line) => count + Math.max(1, Math.ceil(Array.from(line).length / 22)), 0);
    return { width: 280, height: 32 + executionRows.length * 26 + dataRows.length * 28 + Math.min(240, 14 + lines * 16) + 8 };
  }
  const dataPins = dataRows.flatMap(row => [row.input, row.output].filter((pin): pin is BlueprintPin => !!pin));
  const compact = compactValueNode(node);
  const smallAction = (node.type.startsWith('event') || node.type === 'return' || node.type === 'startDialogue') && dataPins.length <= 1;
  const hasBothSides = dataRows.some(row => row.input) && dataRows.some(row => row.output);
  const longReference = dataPins.some(pin => {
    const value = inputValue(node, pin);
    return pin.dataType === 'any' || referenceTypes.has(pin.dataType)
      && (pin.name.length > 16 || typeof value === 'string' && value.length > 24);
  });
  const width = hasBothSides && longReference ? 280 : compact ? 232 : smallAction ? 224 : 264;
  const shortFields = options.parametersCollapsed ? 0 : ['math', 'round'].includes(node.type) ? 28 : ['compare', 'literal'].includes(node.type) ? 56 : 0;
  // Resource selectors and multiline values can exceed the standard data row.
  const complexRows = options.parametersCollapsed ? 0 : dataRows.filter(row => {
    const pin = row.input;
    if (!pin || options.connectedInputs?.has(pin.id)) return false;
    const value = inputValue(node, pin);
    return referenceTypes.has(pin.dataType) || pin.dataType === 'any' || typeof value === 'string' && (value.length > 24 || value.includes('\n'));
  }).length;
  return {
    width,
    height: 32 + executionRows.length * 26 + dataRows.length * 28 + 28 + shortFields + (advancedInputs.length ? 24 : 0) + complexRows * 12 + 8,
  };
}

/** Partition existing pins for display only. Never synchronize, reconstruct, or
 * mutate the node: execution ports, outputs and unknown inputs remain available. */
export function blueprintNodeLayout(node: BlueprintNode, options: BlueprintNodeLayoutOptions = {}): BlueprintNodeLayout {
  const advancedIds = advancedInputIds[node.type] ?? [];
  const advancedInputs = node.pins.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec' && advancedIds.includes(pin.id));
  const hiddenInputs = advancedInputs.filter(pin => {
    if (options.advancedExpanded || options.hasProblem || pin.required || options.connectedInputs?.has(pin.id) || pin.defaultValue === undefined) return false;
    const value = inputValue(node, pin);
    return validValue(pin, pin.defaultValue) && validValue(pin, value) && Object.is(value, pin.defaultValue);
  });
  const hidden = new Set(hiddenInputs);
  const visible = node.pins.filter(pin => !hidden.has(pin));
  const executionRows = rows(visible.filter(pin => pin.direction === 'input' && pin.dataType === 'exec'), visible.filter(pin => pin.direction === 'output' && pin.dataType === 'exec'));
  const dataRows = rows(visible.filter(pin => pin.direction === 'input' && pin.dataType !== 'exec'), visible.filter(pin => pin.direction === 'output' && pin.dataType !== 'exec'));
  const size = estimatedSize(node, options, executionRows, dataRows, advancedInputs);
  const signature = JSON.stringify([
    node.type, !!options.parametersCollapsed, !!options.advancedExpanded, !!options.hasProblem,
    node.pins.map(pin => [pin.id, pin.direction, pin.dataType, pin.name, !hidden.has(pin), pin.direction === 'input' && !!options.connectedInputs?.has(pin.id)]),
    size.width, size.height,
  ]);
  return { executionRows, dataRows, hiddenInputs, advancedInputs, visiblePinIds: visible.map(pin => pin.id), signature, estimatedSize: size };
}

/** React Flow measurements win independently for each dimension, even when a
 * real node is smaller than the conservative fallback. */
export function blueprintMeasuredNodeSize(node: BlueprintNode, options: BlueprintNodeLayoutOptions = {}, measured?: Partial<BlueprintNodeSize>): BlueprintNodeSize {
  const fallback = blueprintNodeLayout(node, options).estimatedSize;
  return {
    width: typeof measured?.width === 'number' && Number.isFinite(measured.width) && measured.width > 0 ? measured.width : fallback.width,
    height: typeof measured?.height === 'number' && Number.isFinite(measured.height) && measured.height > 0 ? measured.height : fallback.height,
  };
}
