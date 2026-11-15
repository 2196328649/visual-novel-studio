import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectSchema, type StoryNode } from '../src/core/model';
import { validateProject } from '../src/core/validate';

function fixture() {
  const project = createProject();
  const sceneId = project.scenes[0].id;
  const source: StoryNode = { id: 'source', kind: 'start', name: '出发', sceneId, x: 0, y: 0, next: 'destination' };
  const destination: StoryNode = { id: 'destination', kind: 'end', name: '结束', sceneId, x: 300, y: 0 };
  project.entryId = source.id;
  project.nodes = [source, destination];
  return { project, source, sceneId };
}

test('ordinary and configured connected exits introduce no transition diagnostics', () => {
  const { project, source } = fixture();
  assert.deepEqual(validateProject(project).filter(item => item.code?.startsWith('flow-transition-')), []);
  source.transitions = { next: { mode: 'dissolve', duration: 0.8 } };
  assert.deepEqual(validateProject(project).filter(item => item.code?.startsWith('flow-transition-')), []);
});

test('an obsolete port remains saved with a warning that locates its owning module', () => {
  const { project, source } = fixture();
  source.transitions = { old_option: { mode: 'dissolve', duration: 0.8 } };
  const parsed = projectSchema.parse(project);
  const before = JSON.stringify(parsed);
  const issues = validateProject(parsed).filter(item => item.code?.startsWith('flow-transition-'));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'flow-transition-port');
  assert.equal(issues[0].severity, 'warning');
  assert.equal(issues[0].nodeId, source.id);
  assert.match(issues[0].message, /old_option/);
  assert.equal(JSON.stringify(parsed), before, 'diagnosing an orphan does not silently remove authored settings');
});

test('a disconnected optional exit retains its setting without blocking compilation', () => {
  const { project, sceneId } = fixture();
  project.nodes[0] = {
    id: 'source', kind: 'interaction', name: '查看周围', sceneId, x: 0, y: 0,
    prompt: '', showHints: true, timeoutSeconds: 0,
    hotspots: [{ id: 'inspect', name: '查看', x: 0, y: 0, width: 0.5, height: 0.5, target: 'destination' }],
    transitions: { cancel: { mode: 'none' } },
  };
  const issues = validateProject(project);
  assert.equal(issues.some(item => item.severity === 'error'), false);
  const inactive = issues.find(item => item.code === 'flow-transition-inactive');
  assert.equal(inactive?.nodeId, 'source');
  assert.match(inactive?.message ?? '', /取消.*尚未连接/);
  project.nodes[0].cancel = 'destination';
  assert.deepEqual(validateProject(project).filter(item => item.code?.startsWith('flow-transition-')), []);
  assert.deepEqual(project.nodes[0].transitions, { cancel: { mode: 'none' } });
});

test('timeout and dynamic return exits explain why retained settings cannot execute', () => {
  const { project, sceneId } = fixture();
  const interaction: StoryNode = {
    id: 'source', kind: 'interaction', name: '观察', sceneId, x: 0, y: 0,
    prompt: '', showHints: true, timeoutSeconds: 0, timeout: 'destination',
    hotspots: [{ id: 'inspect', name: '查看', x: 0, y: 0, width: 0.5, height: 0.5, target: 'destination' }],
    transitions: { timeout: { mode: 'none' } },
  };
  project.nodes[0] = interaction;
  assert.match(validateProject(project).find(item => item.code === 'flow-transition-inactive')?.message ?? '', /尚未启用超时/);
  interaction.timeoutSeconds = 2;
  assert.deepEqual(validateProject(project).filter(item => item.code?.startsWith('flow-transition-')), []);
  project.nodes[0] = { id: 'source', kind: 'return', name: '返回调用处', sceneId, x: 0, y: 0, transitions: { next: { mode: 'none' } } };
  const retained = validateProject(project).find(item => item.code === 'flow-transition-port');
  assert.equal(retained?.severity, 'warning');
  assert.equal(retained?.nodeId, 'source');
  assert.match(retained?.help ?? '', /动态导航/);
});

test('direct in-memory callers receive an error for unsafe transition values', () => {
  const { project, source } = fixture();
  source.transitions = { next: { mode: 'dissolve', duration: Infinity } };
  const issue = validateProject(project).find(item => item.code === 'flow-transition-value');
  assert.equal(issue?.severity, 'error');
  assert.equal(issue?.nodeId, source.id);
  assert.match(issue?.help ?? '', /有限/);
});
