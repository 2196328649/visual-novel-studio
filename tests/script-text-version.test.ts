import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { currentScriptText } from '../src/core/script-text';
import { createEndingPerformance } from '../src/core/builtin-performances';
import { migrateStandaloneNames } from '../src/core/standalone-performance';
import { applyTextScript } from '../src/core/text-script';
import { autosaveProject, loadProject, parseProject, saveProject } from '../src/desktop/project-store';

const modern = '@结局演出：文字=未完待续\n@独立演出：结局演出\n@返回标题界面';

test('current text survives repeated draft edits, autosave, save and reopen without growing endings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-text-version-'));
  try {
    const file = path.join(root, 'project.vns.json');
    let project = applyTextScript(createProject(), modern).project;
    for (let round = 0; round < 4; round++) {
      const content = '// 编辑 ' + round + '\n' + modern;
      project = { ...project, scriptText: currentScriptText(content, '剧本.docx') };
      await autosaveProject(file, project);
      const recovered = await loadProject(file);
      assert.equal(recovered.recovered, true);
      assert.deepEqual(recovered.project.scriptText, project.scriptText);
      await saveProject(file, recovered.project);
      project = (await loadProject(file)).project;
      assert.equal(project.scriptText!.content, content);
      assert.equal(project.scriptText!.sourceName, '剧本.docx');
      assert.equal(project.nodes.filter(node => node.kind === 'passage' && node.lines[0]?.silent).length, 1);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('versionless explicit call plus declaration is not interpreted as two calls', () => {
  const project = createProject(); project.blueprints.push(createEndingPerformance());
  project.scriptText = { format: 'vns-text-1', content: modern };
  const loaded = parseProject(project).project;
  assert.equal(loaded.scriptText!.content, modern);
  assert.equal(parseProject(loaded).migrated, false);
});

test('genuine legacy standalone calls still migrate exactly once and independently of modern modules', () => {
  const project = createProject(); project.blueprints.push(createEndingPerformance());
  project.scriptText = { format: 'vns-text-1', content: '@独立演出：结局演出\n旁白：分界\n' + modern + '\n旁白：另一处\n@独立演出：结局演出' };
  assert.equal(migrateStandaloneNames(project), true);
  assert.equal((project.scriptText.content.match(/^@结局演出/gm) ?? []).length, 3);
  const content = project.scriptText.content;
  assert.equal(migrateStandaloneNames(project), false);
  assert.equal(project.scriptText.content, content);
});

test('intentional repeated current performances are preserved without deduplication', () => {
  const source = modern.replace('\n@返回标题界面', '') + '\n' + modern;
  const project = applyTextScript(createProject(), source).project;
  project.scriptText = currentScriptText(source);
  assert.equal(parseProject(project).project.scriptText!.content, source);
  assert.equal(project.nodes.filter(node => node.kind === 'passage' && node.lines[0]?.silent).length, 2);
});

test('legacy ending migration emits exactly one caption performance before standalone migration', () => {
  const project = createProject();
  project.scriptText = { format: 'vns-text-1', content: '旁白：保留\n@结局：未完待续' };
  const loaded = parseProject(project).project;
  const calls = loaded.scriptText!.content.match(/^@结局演出[^\n]*/gm) ?? [];
  assert.equal(calls.length, 1);
  const parsed = applyTextScript(loaded, loaded.scriptText!.content);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.project.nodes.filter(node => node.kind === 'passage' && node.lines[0]?.silent).length, 1);
});

test('explicit performance version prevents the older standalone migration even if its own flag is missing', () => {
  const project = createProject(); project.blueprints.push(createEndingPerformance());
  project.scriptText = { format: 'vns-text-1', performanceSyntax: 'explicit', content: modern };
  assert.equal(migrateStandaloneNames(project), false);
  assert.equal(project.scriptText.content, modern);
  assert.equal(project.scriptText.standaloneSyntax, 'module-names');
});
