import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { blueprintFromPerformance, installPerformanceBlueprint } from '../src/core/blueprint-authoring';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { stageEditedProject } from '../src/core/stage-edit';
import { performanceWorkspaceDraft } from '../src/core/performance-workspace';

test('a graph named like a command stays a call when its action is first edited', () => {
  const project = createProject();
  project.assets.push({ id: 'bg', name: '夜宴庭院', kind: 'image', path: 'bg.png' });
  const chapter = blueprintFromPerformance(project, [{ kind: 'pause', seconds: 1 }], '章节进入演出');
  chapter.performanceKind = 'standalone'; installPerformanceBlueprint(project, chapter);
  const node = project.nodes.find(item => item.kind === 'passage')!;
  assert.equal(node.kind, 'passage'); if (node.kind !== 'passage') return;
  node.name = '第一章进入动画'; node.lines[0].silent = true; node.lines[0].text = '';
  node.lines[0].actions = [{ kind: 'blueprint', blueprintId: chapter.id }, { kind: 'background', assetId: 'bg', transition: 'none' }, { kind: 'pause', seconds: 1 }];
  project.scriptText = { format: 'vns-text-1', standaloneSyntax: 'module-names', content: projectToText(project) };

  // The per-action graph is named "独立演出 1", which once parsed as the
  // "@独立演出" module command and split the module, dropping the new call.
  const workspace = performanceWorkspaceDraft(project, { nodeId: node.id, lineId: node.lines[0].id, actionIndex: 1 });
  const committed = stageEditedProject(project, draft => workspace.materialize(draft));
  assert.ok(committed);
  for (const result of [committed.project, applyTextScript(committed.project, committed.source).project]) {
    const modules = result.nodes.filter(item => item.kind === 'passage' && item.name === '第一章进入动画');
    assert.equal(modules.length, 1);
    const actions = modules[0].kind === 'passage' ? modules[0].lines[0].actions : [];
    assert.deepEqual(actions.map(action => action.kind), ['blueprint', 'blueprint', 'pause']);
    assert.equal(actions[1].kind === 'blueprint' && actions[1].blueprintId, workspace.target?.graphId);
  }
});

test('space-separated shorthand commands still parse', () => {
  const parsed = applyTextScript(createProject(), '# 段落：测试\n@等待 2\n旁白：继续');
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  const node = parsed.project.nodes.find(item => item.kind === 'passage' && item.name === '测试');
  assert.ok(node?.kind === 'passage' && node.lines[0].actions.some(action => action.kind === 'pause' && action.seconds === 2));
});
