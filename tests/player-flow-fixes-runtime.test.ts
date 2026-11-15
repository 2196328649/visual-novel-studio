import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { createScreens, playerFlowRuntimeData } from '../src/runtime/screens';
import { pythonLiteral } from '../src/runtime/literals';

test('story action captions stay raw through both map modes and legacy directory data', () => {
  const project = createProject('原始重玩标题');
  const title = '章节 [missing_name] {b} [[原样方括号]] {{原样花括号}}';
  project.chapters[0].name = title;
  const component: UiComponent = { id: 'map', kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout: 'flow' } };
  const script = playerFlowRuntimeData(project, component);
  assert.equal(script.flowEntries[0][1], title);
  assert.equal(script.flowLooks[project.entryId].node.name, title);
  component.list!.flowContent = { mode: 'custom', custom: { entries: [{ nodeId: project.entryId, name: title, action: 'replay' }] } };
  const custom = playerFlowRuntimeData(project, component);
  assert.equal(custom.flowEntries[0][1], title);
  assert.equal(custom.flowLooks[project.entryId].node.name, title);
  project.ui.components = [component];
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  const screens = createScreens(reopened);
  const directory = (name: string) => screens.split(name + ' = [\n')[1]?.split('\n    ]')[0];
  assert.ok(directory('vn_chapter_entries')?.includes(`(${pythonLiteral(project.chapters[0].id)}, ${pythonLiteral(title)}, ${pythonLiteral('vn_node_' + project.entryId)})`));
  assert.ok(directory('vn_flow_entries')?.includes(`(${pythonLiteral(project.entryId)}, ${pythonLiteral(title)}, ${pythonLiteral('vn_node_' + project.entryId)})`));
  assert.deepEqual(playerFlowRuntimeData(reopened, reopened.ui.components[0]).flowEntries, custom.flowEntries);
});
