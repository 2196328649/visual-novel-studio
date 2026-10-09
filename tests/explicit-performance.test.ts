import { addProjectGraphs, projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema } from '../src/core/model';
import { applyTextScript, projectToText, textCommandAction } from '../src/core/text-script';
import { isStandaloneNode } from '../src/core/standalone-performance';
import { availablePerformanceBlueprints } from '../src/core/builtin-performances';
import { createChapterPerformance } from '../src/core/chapter-performances';
import { performanceTargetAt } from '../src/core/performance-workspace';
import { performanceFromText, blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { performanceTiming } from '../src/core/performance-timing';
import { commandSignature } from '../src/core/command-parameters';
import { parseProject } from '../src/desktop/project-store';
import { compileProject } from '../src/runtime/compiler';
import { blueprintNodeDefaults, blueprintPin, callablePins, connectBlueprintPins, createBlueprintGraph } from '../src/core/blueprint';

test('only a standalone declaration creates a separate module for builtin and custom calls', () => {
  const base = createProject();
  const graph = blueprintFromPerformance(base, [{ kind: 'pause', seconds: .2 }], '自定义'); graph.performanceKind = 'standalone'; addProjectGraphs(base, graph);
  for (const call of ['@章节进入演出文字版：标题=一，时长=1', '@章节进入演出图片版', '@结局演出', '@自定义']) {
    for (const ending of ['\n旁白：下一句', '\n@返回标题界面', '']) {
      const parsed = applyTextScript(base, call + ending);
      assert.deepEqual(parsed.issues, []);
      assert.equal(parsed.project.nodes.filter(isStandaloneNode).length, 0, call + ending);
      assert.ok(parsed.project.nodes.some(node => node.kind === 'passage' && node.lines.some(line => !line.silent && line.actions.length)));
    }
    for (const declaration of ['@独立演出', '@独立演出：开章']) {
      const parsed = applyTextScript(base, '旁白：之前\n' + call + '\n' + declaration + '\n旁白：之后');
      assert.deepEqual(parsed.issues, []);
      const nodes = parsed.project.nodes.filter(node => node.kind === 'passage');
      assert.deepEqual(nodes.map(node => node.lines.map(line => [!!line.silent, line.text])), [[[false, '之前']], [[true, '']], [[false, '之后']]]);
      assert.deepEqual(applyTextScript(parsed.project, projectToText(parsed.project)).project.nodes, parsed.project.nodes);
    }
  }
});

test('consecutive calls share one explicit module; without the declaration they share the dialogue', () => {
  for (const declaration of ['', '@独立演出\n']) {
    const parsed = applyTextScript(createProject(), '@结局演出\n@章节进入演出文字版\n' + declaration + '旁白：正文');
    assert.deepEqual(parsed.issues, []);
    const passage = parsed.project.nodes.find(node => node.kind === 'passage')!;
    assert.equal(passage.lines[0].actions.length, 2);
    assert.equal(!!passage.lines[0].silent, !!declaration);
  }
});

test('retired chapter commands are absent from completion, parsing and encapsulation', () => {
  for (const name of ['章节标题', '章节背景', '章节题图', '章节配乐', '章节动效', '章节演出']) {
    assert.equal(commandSignature(name), undefined);
    assert.equal(textCommandAction(createProject(), '@' + name + '：一'), undefined);
    assert.ok(applyTextScript(createProject(), '@' + name + '：一').issues.some(issue => issue.severity === 'error'));
    assert.throws(() => performanceFromText(createProject(), '@' + name + '：一'));
  }
});

test('chapter calls resolve to a logic blueprint with every input wired to its child timeline', () => {
  const base = createProject(), before = structuredClone(base);
  const parsed = applyTextScript(base, '@章节进入演出文字版：标题="第，二章"，右侧字="归途"，时长=1.2\n@独立演出：进入\n旁白：正文');
  assert.deepEqual(base, before); assert.deepEqual(parsed.issues, []);
  const target = performanceTargetAt(parsed, 1)!;
  const graph = projectGraphs(parsed.project).find(graph => graph.id === target.graphId)!;
  assert.equal(graph.timeline, undefined); assert.equal(graph.timelineComponent, undefined);
  const call = graph.nodes.find(node => node.type === 'callFunction')!;
  const child = projectGraphs(parsed.project).find(graph => graph.id === call.properties.graphId)!;
  assert.equal(child.timelineComponent, true); assert.ok(child.timeline!.clips.length > 0);
  for (const input of graph.exposedInputs) {
    const reader = graph.nodes.find(node => node.type === 'getInput' && node.properties.inputId === input.id)!;
    assert.ok(graph.links.some(link => link.fromNodeId === reader.id && link.toNodeId === call.id && link.toPinId === 'arg_' + input.id));
  }
  const line = parsed.project.nodes.find(isStandaloneNode)!.lines[0];
  const context = previewActionContext(parsed.project), actions = expandPreviewActions(parsed.project, line.actions, context);
  assert.equal(context.incomplete, false);
  assert.equal(performanceTiming(actions).until, 1.2);
  assert.ok(JSON.stringify(actions).includes('第，二章'));
  assert.deepEqual(compileProject(parsed.project).diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(parseProject(projectSchema.parse(parsed.project)).project, parsed.project);
});

test('existing chapter tracks and public call identity survive the wrapper migration exactly once', () => {
  const project = createProject();
  const graph = createChapterPerformance(project, 'text'); graph.name = '用户改过名称';
  graph.exposedInputs.find(pin => pin.id === 'title')!.defaultValue = '用户标题';
  addProjectGraphs(project, graph);
  const before = structuredClone(graph);
  const loaded = parseProject(project);
  const owner = projectGraphs(loaded.project).find(item => item.id === graph.id)!;
  assert.equal(owner.name, before.name); assert.equal(owner.timeline, undefined);
  const child = projectGraphs(loaded.project).find(item => item.id === owner.nodes.find(node => node.type === 'callFunction')!.properties.graphId)!;
  assert.deepEqual(child.timeline, before.timeline); assert.deepEqual(child.nodes, before.nodes); assert.deepEqual(child.links, before.links);
  assert.deepEqual(owner.exposedInputs, before.exposedInputs);
  assert.equal(parseProject(loaded.project).migrated, false);
});

test('old chapter text migrates on file load without rewriting surrounding drafts', () => {
  const project = createProject();
  project.assets.push({ id: 'art', name: '题图，含标点', kind: 'image', path: 'art.png' });
  const before = '// 注释\n旁白：未应用的改写\n';
  const after = '\n旁白：后续草稿\n@尚未写完';
  project.scriptText = { format: 'vns-text-1', content: before + '@章节标题：第一章｜副标题｜2\n@章节题图：题图="题图，含标点"\n@章节动效：无' + after };
  const loaded = parseProject(project), source = loaded.project.scriptText!.content;
  assert.ok(source.startsWith(before)); assert.ok(source.endsWith(after));
  assert.doesNotMatch(source, /@章节(?:标题|题图|动效)/); assert.match(source, /@独立演出/);
  assert.equal(parseProject(loaded.project).migrated, false);
  const parsed = applyTextScript(loaded.project, source.replace('\n@尚未写完', ''));
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.project.nodes.filter(isStandaloneNode).length, 1);
});

test('chapter wrapper forwards authored outputs to callers after the timeline finishes', () => {
  const project = createProject(), source = createChapterPerformance(project, 'text');
  source.exposedOutputs = [blueprintPin('result', '结果', 'output', 'number', 0)];
  const output = blueprintNodeDefaults('setOutput'); output.properties = { outputId: 'result', value: 42 }; output.pins.find(pin => pin.id === 'value')!.dataType = 'number'; source.nodes.push(output);
  connectBlueprintPins(source, source.timeline!.tailNodeId!, 'exec_out', output.id, 'exec_in');
  const caller = createBlueprintGraph('effect', '读取章节结果');
  const call = blueprintNodeDefaults('callFunction'); call.properties.graphId = source.id; call.pins = callablePins(source);
  const set = blueprintNodeDefaults('setVariable'); set.properties.variableId = 'chapter_result'; set.pins.find(pin => pin.id === 'value')!.dataType = 'number';
  caller.nodes.push(call, set);
  connectBlueprintPins(caller, caller.nodes[0].id, 'exec', call.id, 'exec_in');
  connectBlueprintPins(caller, call.id, 'exec_out', set.id, 'exec_in');
  connectBlueprintPins(caller, call.id, 'out_result', set.id, 'value');
  project.variables.push({ id: 'chapter_result', name: '章节结果', type: 'number', initial: 0, persistent: false });
  addProjectGraphs(project, source, caller);
  const loaded = parseProject(project).project, context = previewActionContext(loaded);
  expandPreviewActions(loaded, [{ kind: 'blueprint', blueprintId: caller.id, inputs: {} }], context);
  assert.equal(context.incomplete, false); assert.equal(context.variables.chapter_result, 42);
  assert.deepEqual(compileProject(loaded).diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.equal(parseProject(loaded).migrated, false);
});

test('old unapplied builtin chapter calls receive one explicit declaration on load', () => {
  const project = createProject();
  project.scriptText = { format: 'vns-text-1', content: '@章节进入演出文字版：标题=草稿\n旁白：保留正文' };
  const loaded = parseProject(project).project;
  assert.match(loaded.scriptText!.content, /@章节进入演出文字版：标题=草稿\n@独立演出：章节进入演出文字版\n旁白：保留正文/);
  assert.equal(parseProject(loaded).migrated, false);
  const fresh = applyTextScript(createProject(), project.scriptText.content).project;
  assert.doesNotMatch(parseProject(fresh).project.scriptText!.content, /@独立演出/);
});
