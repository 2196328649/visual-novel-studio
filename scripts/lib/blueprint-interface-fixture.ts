import { blueprintNodeDefaults, blueprintPin, callablePins, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createCustomUiPage } from '../../src/core/game-flow';
import { createProject } from '../../src/core/model';
import { currentScriptText } from '../../src/core/script-text';
import { projectToText } from '../../src/core/text-script';

export function createBlueprintInterfaceFixture() {
  const project = createProject(), module = createBlueprintGraph('macro', '接口验收模块'), caller = createBlueprintGraph('function', '调用模块的流程');
  project.name = '模块接口与调用位置验收';
  module.exposedInputs = [blueprintPin('amount', '数量', 'input', 'number', 2)];
  module.exposedOutputs = [blueprintPin('answer', '结果', 'output', 'number', 0)];
  const read = blueprintNodeDefaults('getInput'), write = blueprintNodeDefaults('setOutput');
  read.properties.inputId = 'amount'; write.properties.outputId = 'answer'; module.nodes.push(read, write);
  const call = blueprintNodeDefaults('callMacro'); call.name = '已连线的模块调用'; call.properties = { graphId: module.id }; call.pins = callablePins(module);
  const other = blueprintNodeDefaults('callMacro'); other.name = '显式零值调用'; other.properties = { graphId: module.id, arg_amount: 0 }; other.pins = callablePins(module);
  const value = blueprintNodeDefaults('literal'); value.properties.value = 5; value.pins[0].dataType = 'number';
  const consumer = blueprintNodeDefaults('delay'); caller.nodes.push(call, value, consumer, other); project.blueprints = [module, caller];
  const page = createCustomUiPage(project, '接口测试页'), events = project.blueprints.find(graph => graph.uiPageId === page.id)!;
  const pageCall = blueprintNodeDefaults('callMacro'); pageCall.name = '页面中的模块调用'; pageCall.properties.graphId = module.id; pageCall.pins = callablePins(module); events.nodes.push(pageCall);
  synchronizeBlueprintSignatures(project);
  connectBlueprintPins(module, module.nodes[0].id, 'exec', write.id, 'exec_in'); connectBlueprintPins(module, read.id, 'value', write.id, 'value');
  connectBlueprintPins(caller, caller.nodes[0].id, 'exec', call.id, 'exec_in'); connectBlueprintPins(caller, value.id, 'value', call.id, 'arg_amount');
  connectBlueprintPins(caller, call.id, 'exec_out', consumer.id, 'exec_in'); connectBlueprintPins(caller, call.id, 'out_answer', consumer.id, 'seconds');
  const closeLink = events.links[0], old = closeLink.toNodeId; closeLink.toNodeId = pageCall.id; closeLink.toPinId = 'exec_in'; connectBlueprintPins(events, pageCall.id, 'exec_out', old, 'exec_in');
  const passage = project.nodes.find(node => node.kind === 'passage')!;
  if (passage.kind !== 'passage') throw new Error('Missing passage');
  passage.lines[0].text = '模块接口回归台词'; passage.lines[0].actions = [{ kind: 'blueprint', blueprintId: module.id, inputs: { amount: 3 } }];
  for (const graph of project.blueprints) for (const [index, node] of graph.nodes.entries()) { node.x = (index % 3) * 450; node.y = Math.floor(index / 3) * 520; }
  project.scriptText = currentScriptText('// 模块接口验收：保留作者注释与空行\n\n' + projectToText(project) + '\n\n// 文本尾部');
  return { project, module, caller, call, other, read, write, page, events, pageCall, passage };
}
