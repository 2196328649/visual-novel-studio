import { encapsulateBlueprintSelection, inspectBlueprintEncapsulation } from '../../src/core/blueprint-encapsulation';
import { createBlueprintInvocationFixture } from './blueprint-invocation-fixture';

export function createBlueprintEncapsulationFixture() {
  const fixture = createBlueprintInvocationFixture();
  const { project, cache, root } = fixture;
  const selections = [fixture.snapshot, fixture.cache, fixture.loops, fixture.pages].map(graph => ({ graphId: graph.id, name: graph.name + ' · 用户节点', nodeIds: graph.nodes.filter(node => !['event', 'getInput', 'setOutput', 'return'].includes(node.type)).map(node => node.id) }));
  const events = project.blueprints.find(graph => graph.uiPageId === root.id)!;
  const close = events.nodes.find(node => node.type === 'closeUiPage')!;
  selections.push({ graphId: events.id, name: '页面关闭用户节点', nodeIds: [close.id] });
  // Layout for real mouse selection; test logic is the same as the native re-entry fixture.
  const positions: Record<string, { x: number; y: number }> = { event: { x: 0, y: 0 }, callFunction: { x: 450, y: 0 }, getVariable: { x: 450, y: 300 }, math: { x: 900, y: 300 }, setVariable: { x: 900, y: 0 }, delay: { x: 1350, y: 0 }, setOutput: { x: 1800, y: 0 } };
  let inputIndex = 0;
  for (const node of cache.nodes) Object.assign(node, node.type === 'getInput' ? { x: 0, y: 300 + 250 * inputIndex++ } : positions[node.type]);
  for (const [index, node] of events.nodes.entries()) Object.assign(node, { x: 440 * (index % 3), y: 260 * Math.floor(index / 3) });
  for (const selection of selections) {
    const plan = inspectBlueprintEncapsulation(project, selection.graphId, selection.nodeIds);
    if (!plan.ok) throw new Error(selection.name + ': ' + plan.message);
  }
  return { ...fixture, events, close, selections };
}

export function encapsulateInvocationFixture(fixture: ReturnType<typeof createBlueprintEncapsulationFixture>) {
  return fixture.selections.map(selection => encapsulateBlueprintSelection(fixture.project, selection.graphId, selection.nodeIds, selection.name));
}
