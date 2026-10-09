import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject } from '../src/core/model';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { isStandaloneNode } from '../src/core/standalone-performance';
import { renameBlueprint } from '../src/core/blueprint-names';
import { parseProject } from '../src/desktop/project-store';

test('独立演出声明命名并收拢上方动作，与前后台词分属不同模块', () => {
  const parsed = applyTextScript(createProject(), '# 小章节：庭院\n# 段落：正文\n旁白：之前\n@等待：2\n@震动：横向\n@独立演出：第一章进入动画\n旁白：之后');
  assert.deepEqual(parsed.issues, []);
  const module = parsed.project.nodes.find(isStandaloneNode)!;
  assert.equal(module.name, '第一章进入动画');
  assert.deepEqual(module.lines[0].actions.map(action => action.kind), ['pause', 'shake']);
  const before = parsed.project.nodes.find(node => node.kind === 'passage' && node.lines[0].text === '之前')!;
  const after = parsed.project.nodes.find(node => node.kind === 'passage' && node.lines[0].text === '之后')!;
  assert.equal('next' in before && before.next, module.id); assert.equal(module.next, after.id);
  const source = projectToText(parsed.project);
  assert.match(source, /@等待：2\n@震动.*\n@独立演出：第一章进入动画/);
  assert.deepEqual(applyTextScript(parsed.project, source).project.nodes, parsed.project.nodes);
});

test('模块名称不会暗中调用同名蓝图，蓝图重命名也不修改模块名', () => {
  const base = createProject();
  const graph = blueprintFromPerformance(base, [{ kind: 'pause', seconds: 3 }], '动画'); base.blueprints.push(graph);
  const empty = applyTextScript(base, '@独立演出：动画');
  assert.deepEqual(empty.issues, []);
  assert.deepEqual(empty.project.nodes.find(isStandaloneNode)!.lines[0].actions, []);
  const called = applyTextScript(base, '@动画\n@独立演出：动画');
  const module = called.project.nodes.find(isStandaloneNode)!;
  assert.deepEqual(module.lines[0].actions, [{ kind: 'blueprint', blueprintId: graph.id }]);
  renameBlueprint(called.project, graph.id, { name: '章节进入演出' });
  assert.match(called.project.scriptText!.content, /@章节进入演出【/);
  assert.match(called.project.scriptText!.content, /@独立演出：动画/);
});

test('章节标题后追加等待等指令仍属于命名的同一个独立模块', () => {
  const parsed = applyTextScript(createProject(), '@章节进入演出文字版：标题=第一章，右侧字=副标题，时长=7\n@等待：1\n@独立演出：第一章进入动画\n旁白：正文');
  assert.deepEqual(parsed.issues, []);
  const standalone = parsed.project.nodes.filter(isStandaloneNode);
  assert.equal(standalone.length, 1);
  assert.equal(standalone[0].name, '第一章进入动画');
  assert.deepEqual(standalone[0].lines[0].actions.map(action => action.kind), ['blueprint', 'pause']);
  assert.deepEqual(JSON.parse(JSON.stringify(applyTextScript(parsed.project, projectToText(parsed.project)).project.nodes)), JSON.parse(JSON.stringify(parsed.project.nodes)));
});

test('旧存档的独立蓝图调用迁移一次，新命名语法保存后不被重新解释', () => {
  const base = createProject();
  const graph = blueprintFromPerformance(base, [{ kind: 'pause', seconds: 3 }], '动画'); base.blueprints.push(graph);
  base.scriptText = { format: 'vns-text-1', content: '@独立演出：动画' };
  const old = parseProject(base);
  assert.equal(old.migrated, true);
  assert.equal(old.project.scriptText!.content, '@动画\n@独立演出：动画');
  const modern = applyTextScript(base, '@独立演出：动画').project;
  const loaded = parseProject(JSON.parse(JSON.stringify(modern)));
  assert.equal(loaded.migrated, false);
  assert.equal(loaded.project.scriptText!.content, '@独立演出：动画');
  assert.deepEqual(loaded.project.nodes.find(isStandaloneNode)!.lines[0].actions, []);
});
