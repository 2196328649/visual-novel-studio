import { blueprintInputValue, blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph } from '../../src/core/blueprint';
/** Ordinary authored blueprint fixture. Production commands use the show action directly. */
export const showCharacterFixtureId = 'fixture_show_character';
export function createShowCharacterFixture() {
 const graph = createBlueprintGraph('effect', '跟随发言人测试'); graph.id = showCharacterFixtureId;
 const node = blueprintNodeDefaults('showCharacter'); node.x = 420; node.y = 260;
 node.pins.find(p => p.id === 'useDefaultFraming')!.defaultValue = true;
 graph.nodes.push(node); connectBlueprintPins(graph, graph.nodes[0].id, 'exec', node.id, 'exec_in');
 for (const [index, pin] of node.pins.filter(p => p.direction === 'input' && p.dataType !== 'exec' && p.id !== 'characterId').entries()) {
  const id = ({ instanceId: 'instance', expressionId: 'expression', hideOthers: 'hide_others', useDefaultFraming: 'default_framing', presetId: 'preset' } as Record<string,string>)[pin.id] ?? pin.id;
  graph.exposedInputs.push({ ...pin, id, defaultValue: blueprintInputValue(node, pin.id) ?? '' });
  const read = blueprintNodeDefaults('getInput'); read.properties.inputId = id; read.name = '输入 · ' + pin.name; read.x = 50; read.y = index * 150; read.pins[0].dataType = pin.dataType;
  graph.nodes.push(read); connectBlueprintPins(graph, read.id, 'value', node.id, pin.id);
 }
 return graph;
}
