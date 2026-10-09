import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, type Diagnostic } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { textDocument, visibleTextLine } from '../src/core/text-document';
import { diagnosticLocation, diagnosticSourceLine, uniqueDiagnostics } from '../src/core/diagnostic-location';
import { validateProject } from '../src/core/validate';
import { blueprintNodeDefaults, createBlueprintGraph } from '../src/core/blueprint';

function fixture() {
  const source = "@入口：开场【main】\n# 章节：第一章【chapter】\n# 小章节：主线【main_scene】\n# 段落：开场【main】\n@对白标记：main_line\n旁白：从这里开始。\n@跳转：结束【ending】\n# 小章节：备用【unused_scene】\n# 段落：回忆【unused】\n@对白标记：unused_line\n@等待：0.2\n旁白：这一句不会从开场进入。\n@对白标记：second_line\n旁白：这是第二句。\n# 段落：结束【ending】\n@返回标题界面";
  const parsed = applyTextScript(createProject(), source);
  assert.deepEqual(parsed.issues, []);
  return { source, parsed, project: parsed.project, document: textDocument(source, parsed.sourceMap) };
}

test('unreachable warnings identify the paragraph, explain the current entry, and locate its visible heading', () => {
  const { source, parsed, project, document } = fixture();
  const warnings = validateProject(project).filter(issue => issue.code === 'unreachable-node');
  assert.equal(warnings.length, 1);
  const issue = warnings[0];
  assert.equal(issue.nodeId, 'unused');
  assert.match(issue.message, /回忆/);
  assert.match(issue.help!, /当前故事入口是“开场”/);
  assert.match(issue.help!, /@跳转.*选项.*蓝图.*不阻止试玩/);
  const line = diagnosticSourceLine(issue, parsed)!;
  assert.equal(source.split('\n')[line - 1], '# 段落：回忆【unused】');
  assert.equal(document.text.split('\n')[visibleTextLine(document, line) - 1], '# 段落：回忆');
  assert.deepEqual(diagnosticLocation(project, issue, parsed), { label: '第一章 / 备用 / 回忆', destination: { kind: 'story', nodeId: 'unused', lineId: undefined, sourceLine: line } });
});

test('same-message errors on different dialogue lines remain distinct and locate dialogue rather than hidden IDs or effects', () => {
  const { source, parsed, project, document } = fixture();
  const node = project.nodes.find(node => node.id === 'unused');
  assert.ok(node?.kind === 'passage');
  node.lines.forEach(line => { line.speakerId = 'missing'; });
  const issues = validateProject(project).filter(issue => issue.message === '对白角色不存在。');
  assert.equal(issues.length, 2);
  assert.equal(uniqueDiagnostics([...issues, ...issues]).length, 2);
  issues.forEach((issue, index) => {
    const line = diagnosticSourceLine(issue, parsed)!;
    assert.match(source.split('\n')[line - 1], /^旁白：/);
    assert.equal(document.text.split('\n')[visibleTextLine(document, line) - 1], source.split('\n')[line - 1]);
    assert.match(diagnosticLocation(project, issue, parsed).label, new RegExp('第 ' + (index + 1) + ' 句对白'));
  });
});

test('explicit parser locations win, while node-only and generated-node diagnostics have useful fallbacks', () => {
  const { parsed, project } = fixture();
  const issue: Diagnostic = { severity: 'error', message: '参数错误', nodeId: 'unused', sourceLine: 11 };
  assert.equal(diagnosticSourceLine(issue, parsed), 11);
  const generated = applyTextScript(createProject(), '旁白：没有手写起点。');
  const start: Diagnostic = { severity: 'warning', message: '起点', nodeId: generated.project.entryId };
  assert.equal(diagnosticSourceLine(start, generated), undefined);
  assert.equal(diagnosticLocation(generated.project, start, generated).destination?.kind, 'story');
  assert.equal(diagnosticLocation(project, { severity: 'error', message: '第 3 行错误', sourceLine: 3 }, parsed).destination?.kind, 'text');
});

test('missing entry opens entry settings without flooding every paragraph with unreachable warnings', () => {
  const { project } = fixture();
  project.entryId = 'deleted_entry';
  const issues = validateProject(project);
  assert.equal(issues.filter(issue => issue.code === 'unreachable-node').length, 0);
  const entry = issues.find(issue => issue.code === 'missing-entry')!;
  assert.ok(entry);
  assert.deepEqual(diagnosticLocation(project, entry).destination, { kind: 'settings', section: 'entry' });
});

test('resource problems locate an existing asset; missing locations are never fabricated', () => {
  const { project } = fixture();
  project.assets.push({ id: 'music', name: '夜雨', kind: 'audio', category: 'bgm', path: 'night.ogg' });
  assert.deepEqual(diagnosticLocation(project, { severity: 'error', message: '文件找不到', assetId: 'music' }), { label: '素材 / 夜雨', destination: { kind: 'asset', assetId: 'music' } });
  assert.equal(diagnosticLocation(project, { severity: 'error', message: '作品级问题' }).destination, undefined);
  assert.equal(diagnosticLocation(project, { severity: 'error', message: '旧节点', nodeId: 'deleted' }).destination, undefined);
});

test('UI warnings identify exact pages, components and inherited overrides without merging them', () => {
  const project = createProject();
  const base = { id: 'button_one', name: '打开背包', kind: 'button' as const, page: 'say' as const, text: '背包', x: 0, y: 0, width: 100, height: 40 };
  project.ui.components = [base];
  project.ui.instances = [{ id: 'ui_override', name: '夜间界面', components: [{ ...base }] }];
  project.ui.customPages = [{ id: 'inventory', name: '背包', modal: true, components: [{ ...base, id: 'button_two', name: '关闭背包', page: 'custom' }] }];
  const original = structuredClone(project);
  const issues = validateProject(project).filter(issue => issue.code === 'ui.button.unbound');
  assert.equal(issues.length, 3);
  assert.equal(uniqueDiagnostics([...issues, ...issues]).length, 3);
  assert.deepEqual(issues.map(issue => issue.ui), [
    { page: 'say', componentId: 'button_one' },
    { page: 'say', componentId: 'button_one', instanceId: 'ui_override' },
    { page: 'custom', componentId: 'button_two', customPageId: 'inventory' },
  ]);
  assert.deepEqual(issues.map(issue => diagnosticLocation(project, issue).label), ['界面 / 主题默认 / 对话 / 打开背包', '界面 / 夜间界面 / 对话 / 打开背包', '界面 / 背包 / 自定义页面 / 关闭背包']);
  for (const issue of issues) { assert.equal(diagnosticLocation(project, issue).destination?.kind, 'ui'); assert.match(issue.help!, /点击行为.*点击事件蓝图/); }
  assert.deepEqual(project, original);
});

test('click-event graph bindings count as valid actions; bad resource errors also retain UI context', () => {
  const project = createProject();
  project.ui.components = [{ id: 'button_one', kind: 'button', page: 'main', text: '开始', x: 0, y: 0, width: 100, height: 40, skin: { idle: 'missing_asset' } }];
  const graph = createBlueprintGraph('function', '按钮响应');
  const click = blueprintNodeDefaults('eventClick'); click.properties.componentId = 'button_one'; graph.nodes.push(click); project.blueprints.push(graph);
  const issues = validateProject(project);
  assert.equal(issues.some(issue => issue.code === 'ui.button.unbound'), false);
  const resource = issues.find(issue => issue.message.includes('missing_asset'))!;
  assert.deepEqual(resource.ui, { page: 'main', componentId: 'button_one' });
  assert.equal(diagnosticLocation(project, resource).destination?.kind, 'ui');
});
