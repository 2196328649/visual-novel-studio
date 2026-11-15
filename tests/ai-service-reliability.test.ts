import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { aiLines, applyAiChanges, defaultAiConfig, prepareAiChanges, type AiConfig, type AiOperation, type AiRequest } from '../src/core/ai';
import { applyAiWorkflow } from '../src/core/ai-workflow';
import { exportSettingsSchema } from '../src/core/export-settings';
import { createProject, type Project } from '../src/core/model';
import { createVisualObject } from '../src/core/visual-object';
import { runAiAgent, type AiAgentOptions } from '../src/desktop/ai-agent';
import { AiService } from '../src/desktop/ai-service';

const task = (id: string, title = id, kind: 'change' | 'inspect' = 'change') => ({ id, title, kind });
const tool = (id: string, name: string, args: object = {}, taskIds: string[] = []) => ({ id, name, arguments: args, taskIds });
const edit = (id: string, field: 'width' | 'height', value: number, taskIds: string[]) => tool(id, 'editProject', { operations: [{ kind: 'editProject', path: [field], action: 'set', value }] }, taskIds);
const finish = (claims: { id: string; evidence: string[] }[]) => ({ finish: { message: '请审阅方案。', tasks: claims.map(claim => ({ ...claim, status: 'complete' })) } });
const request = (project: Project, extra: Partial<AiRequest> = {}): AiRequest => ({ id: 'reliability', prompt: '处理当前要求', project, lineIds: aiLines(project).map(({ line }) => line.id), ...extra });
type AgentMessages = { role: string; content: string }[];
type Step = object | ((messages: AgentMessages) => object);
const toolResults = (messages: AgentMessages): any[] => JSON.parse(messages.at(-1)!.content.split('\n').slice(1).join('\n'));
const options: AiAgentOptions = {
  projectDirectory: () => undefined, progress: () => {}, check: () => {},
  specialist: async () => { throw new Error('此用例不应调用专用工具。'); },
};

async function run(project: Project, steps: Step[], extra: Partial<AiRequest> = {}) {
  let calls = 0;
  const result = await runAiAgent({ agentStep: async (_id, messages) => {
    const step = steps[calls++];
    assert.ok(step, '不应继续请求模型：' + messages.at(-1)?.content);
    return JSON.stringify(typeof step === 'function' ? step(messages) : step);
  } }, request(project, extra), options);
  assert.equal(calls, steps.length);
  return result;
}

test('a rejected tool turn does not strand accepted legacy batches or replay their operations', async () => {
  const project = createProject('旧协议纠正'), original = structuredClone(project);
  const first: AiOperation = { kind: 'editProject', path: ['width'], action: 'set', value: 1600 };
  const second: AiOperation = { kind: 'editProject', path: ['height'], action: 'set', value: 900 };
  const result = await run(project, [
    { message: '先调整宽度。', operations: [first], more: true },
    { tasks: [task('wrong_protocol')], tools: [edit('must_not_run', 'width', 1800, ['wrong_protocol'])] },
    messages => {
      assert.match(messages.at(-1)!.content, /不要混用工具协议/);
      return { message: '再调整高度。', operations: [second] };
    },
  ]);
  assert.deepEqual(result.operations, [first, second]);
  assert.equal(result.workflow, undefined);
  assert.equal(result.message, '先调整宽度。\n再调整高度。');
  assert.deepEqual(project, original);
  const applied = applyAiChanges(project, prepareAiChanges(project, result.operations, request(project).lineIds));
  assert.equal(applied.width, 1600);
  assert.equal(applied.height, 900);
});

test('invalid initial envelopes do not select tool mode before a valid compatible reply', async () => {
  const project = createProject('无效回复恢复'), original = structuredClone(project);
  const operation: AiOperation = { kind: 'editProject', path: ['width'], action: 'set', value: 1600 };
  for (const invalid of [
    { tasks: [task('first')], tools: [] },
    { tasks: [task('same', '第一项'), task('same', '冲突项')], tools: [edit('unused', 'height', 900, ['same'])] },
  ]) {
    const result = await run(project, [invalid, messages => {
      assert.match(messages.at(-1)!.content, /回复校验未通过/);
      return { message: '纠正后的方案。', operations: [operation] };
    }]);
    assert.deepEqual(result.operations, [operation]);
    assert.equal(result.workflow, undefined);
  }
  assert.deepEqual(project, original);
});

test('a conflicting second task leaves neither the first task nor its tool id behind', async () => {
  const project = createProject('任务登记回滚'), original = structuredClone(project);
  const result = await run(project, [
    { tasks: [task('kept', '调整宽度')], tools: [edit('width', 'width', 1600, ['kept'])] },
    { tasks: [task('added', '拒绝的标题'), task('kept', '错误改写原任务')], tools: [edit('height', 'height', 990, ['added'])] },
    messages => {
      assert.match(messages.at(-1)!.content, /已登记的任务不能删除或改写/);
      return { tasks: [task('added', '正确的高度要求')], tools: [edit('height', 'height', 900, ['added']), tool('review', 'reviewChanges')] };
    },
    messages => {
      assert.equal(toolResults(messages)[0].ok, true);
      assert.deepEqual(toolResults(messages)[1].data.tasks.map((item: any) => [item.id, item.title]), [['kept', '调整宽度'], ['added', '正确的高度要求']]);
      return finish([{ id: 'kept', evidence: ['width'] }, { id: 'added', evidence: ['height'] }]);
    },
  ]);
  assert.deepEqual(project, original);
  const applied = applyAiWorkflow(project, result.workflow!);
  assert.equal(applied.width, 1600);
  assert.equal(applied.height, 900);
  assert.equal(result.workflow!.summary.batches, 3);
});

test('exceeding the task limit does not consume the remaining valid task slot or call id', async () => {
  const project = createProject('任务上限恢复'), original = structuredClone(project);
  const initial = Array.from({ length: 29 }, (_, index) => task('inspect_' + index, '检查 ' + index, 'inspect'));
  const result = await run(project, [
    { tasks: initial, tools: [tool('base_read', 'readProject', { kind: 'project', path: ['width'] }, initial.map(item => item.id))] },
    { tasks: [task('last', '超限时的标题', 'inspect'), task('overflow', '第31项', 'inspect')], tools: [tool('last_read', 'readProject', { kind: 'project', path: ['height'] }, ['last', 'overflow'])] },
    messages => {
      assert.match(messages.at(-1)!.content, /本次任务过多/);
      return { tasks: [task('last', '合法的第30项', 'inspect')], tools: [tool('last_read', 'readProject', { kind: 'project', path: ['height'] }, ['last']), tool('review', 'reviewChanges')] };
    },
    messages => {
      assert.equal(toolResults(messages)[0].ok, true);
      assert.equal(toolResults(messages)[1].data.tasks.length, 30);
      return finish([...initial.map(item => ({ id: item.id, evidence: ['base_read'] })), { id: 'last', evidence: ['last_read'] }]);
    },
  ], { readOnly: true });
  assert.deepEqual(project, original);
  assert.equal(result.workflow!.summary.changes, 0);
  assert.equal(result.workflow!.tasks!.length, 30);
  assert.ok(result.workflow!.tasks!.every(item => item.status === 'complete'));
});

test('accepted tool mode still requires review and finish instead of switching back to legacy operations', async () => {
  const project = createProject('工具模式保护'), original = structuredClone(project);
  const result = await run(project, [
    { tasks: [task('width')], tools: [edit('width_edit', 'width', 1600, ['width'])] },
    { message: '错误的旧协议。', operations: [{ kind: 'editProject', path: ['height'], action: 'set', value: 900 }] },
    messages => {
      assert.match(messages.at(-1)!.content, /已经进入工具任务/);
      return { tools: [tool('review', 'reviewChanges')] };
    },
    finish([{ id: 'width', evidence: ['width_edit'] }]),
  ]);
  assert.deepEqual(project, original);
  assert.equal(result.workflow!.project.width, 1600);
  assert.equal(result.workflow!.project.height, original.height);
  assert.equal(result.workflow!.summary.batches, 2);
});

// The service reads only this in-memory fixture. No user configuration, files,
// external requests or temporary directories are needed by these tests.
function service(t: TestContext, respond: (body: any) => Response, config: Partial<AiConfig> = {}, chunk?: (id: string, text: string) => void) {
  const file = path.resolve('artifacts', 'ai-assistant-review-2026-11-15', 'memory-only-config.json');
  t.mock.method(fs, 'readFile', async (actual: unknown, encoding: unknown) => {
    assert.equal(actual, file);
    assert.equal(encoding, undefined);
    return Buffer.from(JSON.stringify({ version: 1, config: { ...defaultAiConfig, baseUrl: 'https://ai-review.invalid/v1', model: 'local-fixture', rememberKey: false, ...config } }));
  });
  return new AiService({
    file, chunk,
    vault: { isEncryptionAvailable: () => false, encryptString: () => { throw new Error('不应保存密钥。'); }, decryptString: () => { throw new Error('不应读取密钥。'); } },
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://ai-review.invalid/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('Authorization'), null);
      return respond(JSON.parse(init!.body as string));
    },
  });
}
const jsonReply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
const frame = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n';
const delta = (content: string) => frame({ choices: [{ delta: { content } }] });
const streamReply = (content: string) => new Response(content, { headers: { 'Content-Type': 'text/event-stream' } });

test('empty JSON replies fail chat, connection tests and agent steps while retaining request usage', async t => {
  let content = '';
  const ai = service(t, body => { assert.equal(body.stream, false); return jsonReply(content); }, { streamChat: false });
  for (content of ['', ' \r\n\t ']) {
    for (const perform of [
      () => ai.chat(request(createProject(), { mode: 'chat' })),
      () => ai.test('reliability'),
      () => ai.agentStep('reliability', [{ role: 'user', content: '请回答。' }]),
    ]) {
      ai.beginUsage('reliability');
      await assert.rejects(perform, /空回复/);
      assert.equal(ai.takeUsage('reliability')!.requests, 1);
    }
  }
});

test('DONE without text and whitespace-only SSE cannot become successful chat replies', async t => {
  let body = '';
  const ai = service(t, request => { assert.equal(request.stream, true); return streamReply(body); });
  for (body of [
    'data: [DONE]\n\n',
    delta(' \n\t') + 'data: [DONE]\n\n',
    frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n',
  ]) await assert.rejects(ai.chat(request(createProject(), { mode: 'chat' })), /空回复/);
});

test('valid JSON content keeps its leading and trailing formatting', async t => {
  const content = '  第一行\n\n    缩进内容\n ';
  const ai = service(t, () => jsonReply(content), { streamChat: false });
  assert.equal((await ai.chat(request(createProject(), { mode: 'chat' }))).message, content);
  assert.match(await ai.test('reliability'), /连接成功/);
});

test('valid SSE content keeps formatting and still accepts DONE without a finish reason', async t => {
  const content = ' \n完整回复\n\t', chunks: string[] = [];
  const ai = service(t, () => streamReply(delta(content.slice(0, 2)) + delta(content.slice(2)) + 'data: [DONE]\n\n'), {}, (_id, text) => chunks.push(text));
  assert.equal((await ai.chat(request(createProject(), { mode: 'chat' }))).message, content);
  assert.equal(chunks.at(-1), content);
});

test('checks reject private file fields and descendants while public property paths remain usable', async () => {
  const project = createProject('检查路径'), passage = project.nodes.find(node => node.kind === 'passage')!;
  const group = createVisualObject('group'), child = createVisualObject('solid');
  group.children = [child];
  group.parameters = [{ id: 'width', name: '子对象宽度', dataType: 'number', defaultValue: 1, targets: [{ instanceId: child.instanceId, path: ['width'] }] }];
  passage.lines[0].actions = [group];
  project.assets = [{ id: 'image', name: '参考图片', kind: 'image', path: 'assets/portrait.png', externalPath: 'C:/private-fixture/portrait.png', externalFiles: { atlas: 'C:/private-fixture/portrait.atlas' } }];
  project.exportSettings = exportSettingsSchema.parse({ directory: 'C:/private-fixture/export' });
  const original = structuredClone(project);
  const base = ['nodes', { id: passage.id }, 'lines', { id: passage.lines[0].id }, 'actions', 0];
  const privatePaths = [
    ['assets', { id: 'image' }, 'externalPath'], ['assets', 0, 'externalFiles'],
    ['assets', '0', 'externalFiles', 'atlas'], ['assets', 0, 'path'],
    ['exportSettings', 'directory'],
  ];
  const result = await run(project, [
    { tasks: [task('inspect', '检查公开属性', 'inspect')], tools: privatePaths.map((path, index) => tool('private_' + index, 'checkProject', { checks: [{ path, absent: true }] }, ['inspect'])) },
    messages => {
      assert.equal(toolResults(messages).length, privatePaths.length);
      for (const result of toolResults(messages)) { assert.equal(result.ok, false); assert.match(result.error, /检查路径不在允许范围/); }
      assert.doesNotMatch(messages.at(-1)!.content, /private-fixture/);
      return { tools: [tool('public_check', 'checkProject', { checks: [
        { path: [...base, 'parameters', 0, 'targets', 0, 'path'], value: ['width'] },
      ] }, ['inspect']), tool('review', 'reviewChanges')] };
    },
    messages => {
      assert.equal(toolResults(messages)[0].ok, true);
      assert.equal(toolResults(messages)[0].data.passed, true);
      return finish([{ id: 'inspect', evidence: ['public_check'] }]);
    },
  ], { readOnly: true });
  assert.deepEqual(project, original);
  assert.equal(result.workflow!.tasks![0].status, 'complete');
});

test('parent-object edit feedback hides stored file locations but keeps the local review and project intact', async () => {
  const project = createProject('修改反馈脱敏');
  project.assets = [{ id: 'existing', name: '现有图片', kind: 'image', path: 'assets/existing.png', externalPath: 'C:/private-assets/existing.png', externalFiles: { companion: 'C:/private-assets/companion.png' } }];
  project.exportSettings = exportSettingsSchema.parse({ directory: 'C:/private-export', fileName: 'before' });
  const original = structuredClone(project), publicSettings = exportSettingsSchema.parse({ fileName: 'after' });
  const result = await run(project, [
    { tasks: [task('change')], tools: [tool('edit', 'editProject', { operations: [
      { kind: 'editProject', path: ['assets'], action: 'append', value: { id: 'new_image', name: '新图片', kind: 'image', path: 'assets/new.png' } },
      { kind: 'editProject', path: ['exportSettings'], action: 'set', value: publicSettings },
    ] }, ['change'])] },
    messages => {
      const result = toolResults(messages)[0];
      assert.equal(result.ok, true);
      assert.doesNotMatch(messages.at(-1)!.content, /private-assets|private-export|externalPath|externalFiles/);
      const assetsBefore = JSON.parse(result.data.changes[0].before), assetsAfter = JSON.parse(result.data.changes[0].after);
      assert.deepEqual(assetsBefore, [{ id: 'existing', name: '现有图片', kind: 'image' }]);
      assert.equal(assetsAfter.length, 2);
      assert.doesNotMatch(result.data.changes[1].before + result.data.changes[1].after, /"directory"\s*:/);
      assert.match(result.data.changes[1].after, /"fileName": "after"/);
      return { tools: [tool('review', 'reviewChanges')] };
    },
    finish([{ id: 'change', evidence: ['edit'] }]),
  ]);
  assert.deepEqual(project, original);
  assert.equal(result.workflow!.project.assets[0].externalPath, original.assets[0].externalPath);
  assert.match(result.workflow!.details[0].reason!, /private-assets/);
  assert.match(result.workflow!.details[1].reason!, /private-export/);
  assert.equal(applyAiWorkflow(project, result.workflow!).assets.length, 2);
});

test('private leaf edit feedback shows a readable marker and keeps removed and unset descriptions', async () => {
  const project = createProject('私密叶字段反馈');
  project.assets = [{ id: 'image', name: '图片', kind: 'image', path: 'assets/image.png', externalPath: 'C:/old-location/image.png' }];
  const original = structuredClone(project);
  const result = await run(project, [
    { tasks: [task('change')], tools: [tool('edit', 'editProject', { operations: [
      { kind: 'editProject', path: ['assets', { id: 'image' }, 'externalPath'], action: 'remove' },
      { kind: 'editProject', path: ['assets', { id: 'image' }, 'sourcePath'], action: 'set', value: 'C:/new-location/image.png' },
    ] }, ['change'])] },
    messages => {
      const result = toolResults(messages)[0];
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.changes.map(({ before, after }: any) => [before, after]), [['已隐藏文件位置', '已移除'], ['未设置', '已隐藏文件位置']]);
      assert.doesNotMatch(messages.at(-1)!.content, /old-location|new-location/);
      return { tools: [tool('review', 'reviewChanges')] };
    },
    finish([{ id: 'change', evidence: ['edit'] }]),
  ]);
  assert.deepEqual(project, original);
  assert.equal(result.workflow!.project.assets[0].sourcePath, 'C:/new-location/image.png');
});
