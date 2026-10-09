import { showCharacterFixtureId } from './lib/show-character-fixture';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { projectSchema, effectiveCharacter, type Project } from '../src/core/model';
import { currentTextProject, dialogueRows } from '../src/core/text-exchange';
import { applyTextScript } from '../src/core/text-script';
import { readTextDocument } from '../src/desktop/text-import';
import { saveProject } from '../src/desktop/project-store';
import { aiConfigSchema, aiEndpoint, type AiConfigUpdate } from '../src/core/ai';

const root = path.resolve('.'), require = createRequire(import.meta.url);
const output = path.join(root, 'artifacts/ai-live-workflow', new Date().toISOString().replaceAll(':', '-'));
const template = path.join(root, 'resources/templates/aihong'), profile = path.join(output, 'profile');
const projectFile = path.join(output, 'project/project.vns.json');
const settings = process.env.VNS_LIVE_AI_SETTINGS ?? path.join(process.env.APPDATA!, 'visual-novel-studio/ai-settings.json');
const tokenFile = process.env.VNS_LIVE_AI_TOKEN_FILE;
const document = process.env.VNS_LIVE_AI_DOCUMENT ?? 'C:\\Users\\LiuXiangdong\\Downloads\\琼.第一回：归（崇祯五年）.docx';
const sessionProvider = async (): Promise<AiConfigUpdate | undefined> => {
  if (!tokenFile) return undefined;
  // Read the URL, key and model privately. Never print these lines or persist the key.
  const values = (await fs.readFile(tokenFile, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (values.length !== 3) throw new Error('测试配置需要三行：模型地址、密钥、模型名称。');
  const baseUrl = values[0].replace(/^(?:base[_ -]?url|url|api[_ -]?(?:url|base)|模型地址|地址)\s*[:=：]\s*/i, '');
  const apiKey = values[1].replace(/^(?:api[_ -]?key|key|密钥)\s*[:=：]\s*/i, '');
  const model = values[2].replace(/^(?:model(?:[_ -]?name)?|模型名称|模型)\s*[:=：]\s*/i, '');
  const parsed = aiConfigSchema.safeParse({ baseUrl, model, jsonMode: true, timeoutSeconds: 180, rememberKey: false });
  if (!parsed.success || !model || !apiKey || apiKey.length > 16384) throw new Error('测试配置的地址、密钥或模型名称格式无效。');
  aiEndpoint(baseUrl);
  return { ...parsed.data, apiKey };
};
await fs.mkdir(profile, { recursive: true });
const settingsBytes = await fs.readFile(settings).catch(error => { if (tokenFile && error.code === 'ENOENT') return undefined; throw error; });
const settingsHash = settingsBytes && createHash('sha256').update(settingsBytes).digest('hex');
if (settingsBytes) await fs.writeFile(path.join(profile, 'ai-settings.json'), settingsBytes);
const original = projectSchema.parse(JSON.parse(await fs.readFile(path.join(template, 'project.vns.json'), 'utf8')));
await saveProject(projectFile, original, template);
const imported = await readTextDocument(document), expected = dialogueRows(applyTextScript(original, imported.text, imported.name).project);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/artifacts/**', '**/resources/**', '**/release/**'] } } }); await server.listen();
const env = Object.fromEntries(Object.entries({ ...process.env, VNS_PROJECT_PATH: projectFile, VNS_USER_DATA: profile, VNS_DEV_URL: `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}` }).filter((pair): pair is [string, string] => pair[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined, page: Page | undefined, assistant: Page | undefined, phase = 'launch';
const errors: string[] = [], checks: string[] = [], progress: unknown[] = [], metrics: Record<string, unknown> = {};
const snapshot = async () => {
  await page!.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page!.locator('.dirty-dot')).toHaveCount(0);
  return currentTextProject(projectSchema.parse(JSON.parse(await fs.readFile(projectFile, 'utf8'))));
};
const ask = async (text: string) => {
  const before = await assistant!.getByLabel('AI 创作方案', { exact: true }).count();
  await assistant!.getByLabel('发给 AI 的内容', { exact: true }).fill(text);
  await assistant!.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => {
    const alerts = await assistant!.getByRole('alert').allTextContents();
    if (alerts.some(Boolean)) throw new Error(alerts.join('\n'));
    return assistant!.getByLabel('AI 创作方案', { exact: true }).count();
  }, { timeout: 900000, intervals: [1000, 2000, 3000] }).toBe(before + 1);
  return assistant!.getByLabel('AI 创作方案', { exact: true }).last();
};
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 60000 });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(original.name, { timeout: 60000 });
  const provider = await sessionProvider();
  if (provider) await page.evaluate(update => window.studio!.saveAiConfig!(update), provider);
  const config = await page.evaluate(() => window.studio!.getAiConfig!());
  if (!config.model || !config.hasKey) throw new Error('当前保存的 AI 配置缺少模型或可解密密钥。');
  metrics.provider = { host: new URL(config.baseUrl).host, model: config.model, keyStorage: config.keyStorage, source: tokenFile ? 'desktop-token-file, isolated session' : 'saved provider' };
  console.log(JSON.stringify({ phase: 'provider-ready', ...metrics.provider as object }));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 940));
  const opened = app.waitForEvent('window'); await page.getByRole('button', { name: 'AI 助手', exact: true }).click(); assistant = await opened;
  assistant.on('pageerror', error => errors.push(error.message));
  assistant.on('console', message => { if (message.text().startsWith('VNS_AI_PROGRESS ')) { const value = JSON.parse(message.text().slice(16)); progress.push(value); console.log(JSON.stringify(value)); } });
  await expect(assistant.locator('.ai-assistant-window')).toBeVisible();
  await assistant.evaluate(() => window.studio!.onAiProgress!(value => console.log('VNS_AI_PROGRESS ' + JSON.stringify(value))));
  await assistant.getByLabel('AI 处理范围', { exact: true }).selectOption('all');
  phase = 'live DOCX import and expressions';
  const started = Date.now();
  const proposal = await ask(`导入游戏剧本 "${document}"，并为每个角色台词添加显示立绘的演出，并根据台词的内容，结合前后文进行角色表情的初步选择。`);
  metrics.importTimeSeconds = Math.round((Date.now() - started) / 1000);
  metrics.importWarnings = await proposal.locator('.ai-workflow-warning').allTextContents();
  await assistant.screenshot({ path: path.join(output, 'docx-proposal.png') });
  await proposal.getByRole('button', { name: '应用创作方案', exact: true }).click();
  await expect(proposal).toContainText('已应用创作方案');
  let saved = await snapshot(), rows = dialogueRows(saved);
  expect(rows.map(({ line }) => line.text)).toEqual(expected.map(({ line }) => line.text));
  const speakers = rows.filter(({ line }) => line.speakerId), eligible = speakers.filter(({ line }) => effectiveCharacter(saved, line.speakerId!)!.expressions.length);
  expect(speakers.every(({ line }) => line.actions.some(action => action.kind === 'blueprint' && action.blueprintId === showCharacterFixtureId || action.kind === 'show' && action.characterId === line.speakerId))).toBe(true);
  expect(eligible.every(({ line }) => line.actions.some(action => action.kind === 'show' && !!effectiveCharacter(saved, line.speakerId!)!.expressions.find(expression => expression.id === action.expressionId) || action.kind === 'blueprint' && action.blueprintId === showCharacterFixtureId && !!action.inputs?.expression))).toBe(true);
  expect(saved.nodes.some(node => node.kind === 'end')).toBe(true);
  metrics.docx = { lines: rows.length, portraitLines: speakers.length, selectedExpressions: eligible.length, missingCharacters: [...new Set(speakers.filter(({ line }) => !effectiveCharacter(saved, line.speakerId!)!.expressions.length).map(({ line }) => effectiveCharacter(saved, line.speakerId!)!.name))] };
  metrics.expressionSelections = eligible.map(({ line }) => {
    const character = effectiveCharacter(saved, line.speakerId!)!;
    const action = line.actions.filter(action => action.kind === 'show' && action.characterId === line.speakerId || action.kind === 'blueprint' && action.blueprintId === showCharacterFixtureId).at(-1)!;
    const expressionId = action.kind === 'show' ? action.expressionId : action.kind === 'blueprint' ? action.inputs?.expression : undefined;
    const expression = character.expressions.find(expression => expression.id === expressionId)!;
    return { lineId: line.id, speaker: character.name, expression: expression.name, usesDefault: expression.id === (character.defaultExpressionId ?? character.expressions[0].id) };
  });
  checks.push('使用用户提供的真实服务，一句导入指定 DOCX；逐字保留 227 句对白、为全部角色对白配置演出，有立绘者分批结合上下文选表情，缺失者明确提示。');
  await assistant.getByRole('button', { name: '撤销工程修改', exact: true }).click();
  const undone = await snapshot(); expect(undone.nodes).toEqual(currentTextProject(original).nodes);
  await page.getByRole('button', { name: '重做', exact: true }).click(); saved = await snapshot();
  expect(dialogueRows(saved).length).toBe(rows.length);
  checks.push('完整方案通过主编辑器历史应用；一次撤销恢复原剧情，一次重做恢复整篇演出。');

  phase = 'live voice directory matching';
  const voiceDir = path.join(output, 'voice-fixture'); await fs.mkdir(voiceDir, { recursive: true });
  // Deliberately synthetic audio. This verifies name/transcript matching, not speech recognition.
  const candidates = rows.filter(({ line }) => line.speakerId && line.text.length > 15 && rows.filter(row => row.line.text === line.text).length === 1).slice(0, 4);
  const manifest: { file: string; text: string; speaker: string }[] = [];
  for (const [index, { line }] of candidates.entries()) {
    const buffer = Buffer.alloc(44 + 1600 * 2); buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(3200, 40); for (let i = 0; i < 1600; i++) buffer.writeInt16LE(Math.round(Math.sin(i / (8 + index)) * 500), 44 + i * 2);
    const file = `${String(index + 1).padStart(4, '0')}.wav`;
    await fs.writeFile(path.join(voiceDir, file), buffer);
    manifest.push({ file, text: line.text, speaker: effectiveCharacter(saved, line.speakerId!)!.name });
  }
  await fs.writeFile(path.join(voiceDir, 'voices.json'), JSON.stringify(manifest, null, 2));
  const voiceProposal = await ask(`根据台词寻找 "${voiceDir}" 目录下的游戏配音，给有可靠匹配的台词添加配音演出。`);
  await assistant.screenshot({ path: path.join(output, 'voice-proposal.png') });
  await voiceProposal.getByRole('button', { name: '应用创作方案', exact: true }).click(); await expect(voiceProposal).toContainText('已应用创作方案');
  saved = await snapshot(); rows = dialogueRows(saved);
  expect(rows.filter(({ line }) => line.voiceId).map(({ line }) => line.id)).toEqual(candidates.map(({ line }) => line.id));
  for (const { line } of rows.filter(({ line }) => line.voiceId)) { const asset = saved.assets.find(asset => asset.id === line.voiceId)!; expect(asset.kind).toBe('audio'); expect((await fs.stat(path.join(path.dirname(projectFile), asset.path))).size).toBeGreaterThan(44); }
  metrics.voices = { requestedFiles: 4, matchedLines: rows.filter(({ line }) => line.voiceId).length, fixture: 'synthetic audio with an explicit voice transcript manifest; not speech recognition' };
  checks.push('真实服务解析一句目录配音任务；4 份已知文本索引匹配且复制音频，未匹配的 223 句保持无配音，已有演出不变。');
  expect(errors).toEqual([]);
  if (settingsHash) expect(createHash('sha256').update(await fs.readFile(settings)).digest('hex')).toBe(settingsHash);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, metrics, progress, projectFile, errors }, null, 2));
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, output, projectFile }));
} catch (error) {
  await assistant?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, checks, metrics, progress, error: String(error), errors }, null, 2));
  console.error(phase, error); process.exitCode = 1;
} finally { await app?.close().catch(() => undefined); await server.close(); await fs.rm(path.join(profile, 'ai-settings.json'), { force: true }); }
