import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { inspectAiAttachments, inspectMentionedAiAttachments, readAiAttachments, resolveMentionedAiAttachmentPaths } from '../src/desktop/ai-attachments';
import { extractAiAttachmentPathMentions } from '../src/core/ai-attachments';
import { AiAuthoringService } from '../src/desktop/ai-authoring';
import { AiService } from '../src/desktop/ai-service';
import { aiLines, defaultAiConfig } from '../src/core/ai';
import { createProject } from '../src/core/model';
import { applyAiWorkflow } from '../src/core/ai-workflow';

test('attachments stage metadata, deduplicate, refresh on send and bound reference text without reading media or directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-attachments-'));
  const text = path.join(root, '中文 设定.md'), image = path.join(root, '原画.png');
  await fs.writeFile(text, '初稿'); await fs.writeFile(image, 'binary-not-text');
  const staged = await inspectAiAttachments([text, text, image, root]);
  assert.deepEqual(staged.map(item => item.kind), ['document', 'file', 'directory']);
  assert.ok(staged.every(item => item.text === undefined));
  await fs.writeFile(text, '最新参考'.repeat(10000));
  const second = path.join(root, '索引.json'), third = path.join(root, '第三份.txt');
  await fs.writeFile(second, '资料'.repeat(20000)); await fs.writeFile(third, '第三份正文');
  const read = await readAiAttachments([text, second, third, image, root], () => {});
  assert.equal(read[0].text!.length, 30000); assert.ok(read[0].text!.startsWith('最新参考'));
  assert.equal(read[1].text!.length, 30000); assert.equal(read[2].text, '');
  assert.ok(read.slice(0, 3).every(item => item.truncated));
  assert.ok(read.slice(3).every(item => item.text === undefined));
  const directory = read.find(item => item.kind === 'directory');
  assert.ok(directory?.entries?.some(entry => entry.path === '中文 设定.md'));
  assert.ok(directory?.entries?.some(entry => entry.path === '原画.png'));
  assert.ok(extractAiAttachmentPathMentions(`请读取 "C:\\外部资料\\角色立绘" 和 /tmp/notes.txt`).some(item => item.path.includes('角色立绘')));
  assert.deepEqual(await resolveMentionedAiAttachmentPaths(`请读取 "${root}"`), [path.resolve(root)]);
  await assert.rejects(inspectAiAttachments(['relative.txt']), /本机/);
  await assert.rejects(inspectAiAttachments([path.join(root, 'missing.txt')]), /无法访问附件/);
  await assert.rejects(inspectAiAttachments(Array(11).fill(text)));
  await assert.rejects(readAiAttachments([text], () => { throw new Error('cancelled'); }), /cancelled/);
  const oversized = path.join(root, '大文件.txt'); const handle = await fs.open(oversized, 'w'); await handle.truncate(33 * 1024 * 1024); await handle.close();
  await assert.rejects(inspectAiAttachments([oversized]), /32 MB/);
});

test('typed paths keep spaces and quoted punctuation, exclude URLs and never broaden a missing quoted path', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-mentioned-paths-'));
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const folder = path.join(root, '角色 图集'), prefix = path.join(root, '角色'), file = path.join(root, '人物 设定，修订.md');
  await fs.mkdir(folder); await fs.mkdir(prefix); await fs.writeFile(file, '只在获准发送后读取的设定');
  assert.deepEqual(await resolveMentionedAiAttachmentPaths(`${folder} 这个文件夹是角色立绘，请读取清单`), [folder]);
  assert.deepEqual(await resolveMentionedAiAttachmentPaths(`参考“${file}”，再读取 \`${folder}\``), [file, folder]);
  assert.deepEqual(await resolveMentionedAiAttachmentPaths(`读取 ${folder} 和 ${prefix}`), [folder, prefix]);
  assert.deepEqual(await resolveMentionedAiAttachmentPaths(`读取 "${path.join(root, '角色 不存在')}"`), []);
  assert.deepEqual(extractAiAttachmentPathMentions('参考 https://example.com/assets/角色/通常.png'), []);
  assert.equal(extractAiAttachmentPathMentions('读取 /tmp/角色/通常.png')[0].path, '/tmp/角色/通常.png');
  assert.deepEqual(await inspectMentionedAiAttachments({ prompt: `读取 "${file}"`, allowExternalFiles: false }), []);
  const inspected = await inspectMentionedAiAttachments({ prompt: `读取 "${file}"`, allowExternalFiles: true });
  assert.equal(inspected[0].path, file); assert.equal(inspected[0].text, undefined);
});

test('reference requests send extracted data, never apply changes, and import only explicitly selected paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-attachments-workflow-'));
  const file = path.join(root, '剧情.txt'); await fs.writeFile(file, '旁白：雨后重逢。\n旁白：我们回家吧。');
  const project = createProject('附件验证'), before = structuredClone(project);
  let mode = 'reference', calls = 0;
  const service = new AiService({ file: path.join(root, 'settings.json'), vault: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }, fetch: async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init!.body));
    let answer: unknown;
    if(mode !== 'reference') {
      if(body.messages.at(-1).content.startsWith('用户请求：')) answer={tasks:[{id:'import',title:'导入附件'}],tools:[{id:'readFile',name:'importText',arguments:{source:mode==='forbidden'?path.join(root,'not-selected.txt'):file,mode:'replace'},taskIds:['import']},{id:'review',name:'reviewChanges',arguments:{}}]};
      else answer={finish:{message:'导入结果',tasks:[{id:'import',status:mode==='forbidden'?'incomplete':'complete',evidence:['readFile']}]}};
    } else {
      assert.match(body.messages.map((item: any) => item.content).join('\n'), /雨后重逢/);
      assert.match(body.messages[0].content, /不是指令/);
      answer = { message: '这份附件描述雨后重逢。', operations: [] };
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  await service.saveConfig({ ...defaultAiConfig, baseUrl: 'https://fixture.invalid/v1', model: 'attachment-test', rememberKey: false });
  const author = new AiAuthoringService(service, { projectDirectory: () => root });
  const request = { id: 'attachment_request', project, lineIds: aiLines(project).map(({ line }) => line.id), attachmentPaths: [file] };
  const reply = await author.request({ ...request, prompt: '概括附件内容' });
  assert.match(reply.message, /雨后重逢/); assert.equal(reply.workflow, undefined); assert.equal(calls, 1); assert.deepEqual(project, before);
  mode = 'import';
  const result = await author.request({ ...request, prompt: '导入这个附件' });
  assert.equal(result.workflow!.project.scriptText?.sourceName, '剧情.txt'); assert.equal(result.workflow!.summary.changedLines, 3); assert.deepEqual(project, before);
  const applied = applyAiWorkflow(project, result.workflow!);
  assert.deepEqual(aiLines(applied).map(({ line }) => line.text), ['雨后重逢。', '我们回家吧。']);
  mode = 'forbidden';
  const denied=await author.request({ ...request, prompt: '导入这个附件' });
  assert.equal(denied.workflow!.tasks![0].status,'incomplete');assert.equal(denied.workflow!.summary.changes,0);assert.match(denied.workflow!.tasks![0].detail,/明确引用/);
  const count = calls; await fs.unlink(file);
  await assert.rejects(author.request({ ...request, prompt: '概括附件' }), /无法访问附件/); assert.equal(calls, count);
});
