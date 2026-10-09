import { projectGraphs } from '../src/core/project-resources';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { createTextScriptReader } from '../src/core/text-script-cache';
import { performanceTextDocument } from '../src/core/text-performance';
import { availablePerformanceBlueprints, installPerformanceBlueprint } from '../src/core/builtin-performances';

test('折叠、文本提交、目录和诊断复用一次解析，保留错误与源码映射', () => {
  const project = createProject();
  let calls = 0;
  const read = createTextScriptReader((...args) => { calls++; return applyTextScript(...args); });
  const source = '@等待：0.1\n旁白：新台词';
  const document = performanceTextDocument(project, source, true, undefined, undefined, read);
  assert.equal(document.text, '旁白：新台词');
  const committed = { ...project, scriptText: { format: 'vns-text-1' as const, content: source } };
  const parsed = read(committed, source);
  assert.equal(read(project, source), parsed);
  assert.equal(calls, 1);
  assert.deepEqual(parsed, applyTextScript(committed, source));
  const invalid = read(committed, '@等待：无效\n旁白：草稿');
  assert.ok(invalid.issues.length);
  assert.equal(read(committed, '@等待：无效\n旁白：草稿'), invalid);
  assert.equal(read(committed, source), parsed);
  assert.equal(calls, 2);
});

test('作品、素材、蓝图和设置变动使解析缓存失效，不能复用旧资源或身份', () => {
  const project = createProject();
  const source = '@背景：庭院\n旁白：正文';
  const read = createTextScriptReader();
  const missing = read(project, source);
  assert.ok(missing.issues.length);
  const next = { ...project, assets: [...project.assets, { id: 'bg', name: '庭院', kind: 'image' as const, path: 'bg.png' }] };
  const valid = read(next, source);
  assert.deepEqual(valid.issues, []);
  for (const patch of [{ width: 800 }, { blueprints: [...projectGraphs(next)] }, { nodes: [...next.nodes] }, { ui: { ...next.ui } }, { id: 'other_project' }]) {
    const changed = { ...next, ...patch };
    assert.notEqual(read(changed, source), valid);
    assert.deepEqual(read(changed, source), applyTextScript(changed, source));
  }
});

test('解析缓存保留来源名称，限制为最近两份文本', () => {
  const project = createProject(), read = createTextScriptReader();
  const first = read(project, '旁白：一', '甲.txt');
  const renamed = read(project, '旁白：一', '乙.txt');
  assert.notEqual(first, renamed);
  assert.equal(renamed.project.scriptText?.sourceName, '乙.txt');
  read(project, '旁白：二'); read(project, '旁白：三');
  assert.notEqual(read(project, '旁白：一', '甲.txt'), first);
});

test('已验证的舞台提交可复用解析结果，下一次文本或素材修改仍重新解析', () => {
  const project = createProject(), source = '@等待：0.2\n旁白：修改后的演出';
  const verified = applyTextScript(project, source);
  let calls = 0;
  const read = createTextScriptReader((...args) => { calls++; return applyTextScript(...args); });
  read.remember(verified.project, source, verified);
  assert.equal(read(verified.project, source), verified); assert.equal(calls, 0);
  assert.deepEqual(read(verified.project, source).sourceMap, verified.sourceMap);
  const changed = { ...verified.project, assets: [...verified.project.assets] };
  assert.notEqual(read(changed, source), verified); assert.equal(calls, 1);
  assert.ok(read(changed, '@等待：错误\n旁白：草稿').issues.length); assert.equal(calls, 2);
});

test('查询内置演出复用预设，安装后修改蓝图不会污染预设或其他作品', () => {
  const project = createProject();
  const first = availablePerformanceBlueprints(project);
  const second = availablePerformanceBlueprints(project);
  assert.equal(first.find(graph => graph.id === 'fixture_show_character'), second.find(graph => graph.id === 'fixture_show_character'));
  const ending = first.find(graph => graph.id === 'builtin_ending_performance')!;
  assert.equal(ending, second.find(graph => graph.id === ending.id));
  const before = structuredClone(ending);
  installPerformanceBlueprint(project, ending);
  const installed = projectGraphs(project).find(graph => graph.id === ending.id)!;
  installed.name = '用户结局'; installed.nodes[0].name = '用户节点';
  assert.deepEqual(ending, before);
  assert.equal(availablePerformanceBlueprints(project).find(graph => graph.id === ending.id), installed);
  assert.notEqual(availablePerformanceBlueprints(createProject()).find(graph => graph.id === ending.id), ending);
});
