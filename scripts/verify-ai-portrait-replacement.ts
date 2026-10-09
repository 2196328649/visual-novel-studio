import { expect, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { assetFiles } from '../src/core/model';
import { aiLines, defaultAiConfig } from '../src/core/ai';
import { parseProject, assetSourcePath } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';

const argument = (name: string) => { const i = process.argv.indexOf(name); if (i < 0) throw new Error('Missing ' + name); return path.resolve(process.argv[i + 1]); };
const originalFile = argument('--project'), originalImage = argument('--image'), originalFolder = argument('--folder');
const unchanged=process.argv.includes('--unchanged');
const live = process.argv.includes('--live'), mixed = process.argv.includes('--mixed'), reference = process.argv.includes('--reference');
const root = path.resolve('.'), output = path.join(root, 'artifacts/ai-portrait-replacement', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
const attachmentRoot = path.join(output,'attachments'); await fs.mkdir(attachmentRoot);
const imageFile = path.join(attachmentRoot,path.basename(originalImage)), portraitDirectory = path.join(attachmentRoot,path.basename(originalFolder));
await fs.copyFile(originalImage,imageFile); await fs.cp(originalFolder,portraitDirectory,{recursive:true});
if(live) {
  const profile=path.join(output,'profile'); await fs.mkdir(profile,{recursive:true});
  await fs.copyFile(path.join(process.env.APPDATA!,'visual-novel-studio','ai-settings.json'),path.join(profile,'ai-settings.json'));
  await fs.copyFile(path.join(process.env.APPDATA!,'visual-novel-studio','Local State'),path.join(profile,'Local State'));
}

const bytes = await fs.readFile(originalFile), raw = JSON.parse(bytes.toString()), project = parseProject(raw.project ?? raw).project;
for (const asset of project.assets) {
  asset.externalFiles = Object.fromEntries(assetFiles(asset).map(file => [file, assetSourcePath(path.dirname(originalFile), asset, file)]));
  asset.externalPath = asset.externalFiles[asset.path];
}
const fang = project.characters.find(character => character.name === '方知宥')!, qiong = project.characters.find(character => character.name === '琼华')!;
expect(fang).toBeTruthy(); expect(qiong).toBeTruthy();
if(reference) project.resourceSettings={...project.resourceSettings,importMode:'reference'} as typeof project.resourceSettings;
const projectFile = path.join(output, 'project.vns.json'); await fs.writeFile(projectFile, JSON.stringify(project));
const sourceFiles = [imageFile, ...(await fs.readdir(portraitDirectory)).filter(name => /\.png$/i.test(name)).map(name => path.join(portraitDirectory, name))];
const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const sourceHashes = await Promise.all(sourceFiles.map(hash));
let calls = 0; const errors: string[] = [];
const mock = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls++;
    expect(body.messages[0].content).toContain('通用工具循环');
    const t=(id:string,name:string,args:object={},taskIds=['fang','qiong'])=>({id,name,arguments:args,taskIds});
    const sequence=[
      {tasks:[{id:'fang',title:'方知宥换为单张图片'},{id:'qiong',title:'琼华换为文件夹立绘'}],tools:[t('fangImport','importAssets',{sources:[imageFile],category:'portrait'},['fang']),t('qiongImport','importAssets',{sources:[portraitDirectory],category:'portrait'},['qiong'])]},
      {tools:[t('fangBind','bindPortraits',{bindings:[{characterId:fang.id,mode:'replace',importId:'fangImport'}]},['fang']),t('qiongBind','bindPortraits',{bindings:[{characterId:qiong.id,mode:'replace',importId:'qiongImport'}]},['qiong']),t('review','reviewChanges')]},
      {finish:{message:'两个角色立绘已准备，台词修改 0 句。',tasks:[{id:'fang',status:'complete',evidence:['fangBind']},{id:'qiong',status:'complete',evidence:['qiongBind']}]}}
    ];
    expect(calls).toBeLessThanOrEqual(sequence.length);
    const plan=unchanged?[
      {tasks:[{id:'check',title:'核对作品宽度'}],tools:[t('check','checkProject',{checks:[{path:['width'],value:project.width}]},['check']),t('review','reviewChanges',{},['check'])]},
      {finish:{message:'作品宽度符合要求，无需修改。',tasks:[{id:'check',status:'complete',evidence:['check']}],editorCommands:['validate']}}
    ][calls-1]:sequence[calls-1];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) }, finish_reason: 'stop' }] }));
  } catch (error) { errors.push(String(error)); res.writeHead(500); res.end('fixture failure'); }
});
mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
const app = await launchDesktopFixture({ root, profile: path.join(output, 'profile'), projectFile });
let assistant: Page | undefined, phase = 'launch';
try {
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
  if(!live) await page.evaluate(config => window.studio!.saveAiConfig!(config), { ...defaultAiConfig, baseUrl: `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`, model: 'local-portrait-fixture', rememberKey: false });
  const opened = app.waitForEvent('window'); await page.getByRole('button', { name: 'AI 助手', exact: true }).click(); assistant = await opened;
  assistant.on('pageerror', error => errors.push(error.message));
  await expect(assistant.locator('.ai-assistant-window')).toBeVisible();
  const before = (await assistant.evaluate(() => window.studio!.getAiContext!()))!.project;
  phase = 'drop image and folder';
  const cdp = await assistant.context().newCDPSession(assistant);
  const area = (await assistant.getByLabel('发给 AI 的内容', { exact: true }).boundingBox())!;
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, x: area.x + 20, y: area.y + 15, data: { items: [], files: [imageFile, portraitDirectory], dragOperationsMask: 1 } });
  await cdp.detach(); await expect(assistant.locator('.ai-attachments li')).toHaveCount(2);
  const config = await assistant.evaluate(()=>window.studio!.getAiConfig!());
  console.log(JSON.stringify({phase:'request',live,mixed,model:config.model,hasKey:config.hasKey,output}));
  if(live) expect(config.hasKey, 'Isolated profile must decrypt the configured key before calling the provider').toBe(true);
  await assistant.exposeFunction('reportAiProgress', (message: string) => console.log(JSON.stringify({progress:message})));
  await assistant.evaluate(()=>window.studio!.onAiProgress!(value=>(window as any).reportAiProgress(value.message)));
  phase = 'review';
  await assistant.getByLabel('发给 AI 的内容', { exact: true }).fill(unchanged ? '核对当前作品宽度并检查工程' : mixed ? '方知宥换这张 PNG，琼华用文件夹里她的立绘；另外把作品宽度设为1600。保留台词、演出和原表情编号。' : '把剧本中的方知宥发立绘图片改为上传的这张，琼华使用上传文件夹中的琼华的立绘');
  await assistant.getByRole('button', { name: '发送', exact: true }).click();
  const proposal = assistant.locator('.ai-workflow-proposal').last();
  await expect(proposal).toBeVisible({ timeout: live ? 900000 : 45000 });
  if(unchanged) {
    await expect(proposal).toContainText('没有实际修改，无需应用。');
    await expect(proposal).toContainText('无需修改');
    await expect(proposal.getByRole('button',{name:'应用创作方案',exact:true})).toHaveCount(0);
    await expect(assistant.locator('.ai-editor-commands button').last()).toBeEnabled();
    expect((await assistant.evaluate(()=>window.studio!.getAiContext!()))!.project).toEqual(before);
    expect(calls).toBe(2);expect(errors).toEqual([]);
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',unchanged:true,commandsEnabled:true,projectUnchanged:true},null,2));
    await assistant.screenshot({path:path.join(output,'unchanged.png')});console.log(output);
  } else {
  await expect(proposal).toContainText('立绘更新 2 个角色');
  await expect(proposal).toContainText('台词修改 0 句');
  await expect(proposal).toContainText('检查范围：');
  await expect(proposal.locator('.ai-task-review li[data-status="incomplete"]')).toHaveCount(0);
  const warnings = await proposal.locator('.ai-workflow-warning').allTextContents();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  await expect(proposal.locator('.ai-portrait-comparison')).toHaveCount(2);
  for(const name of ['方知宥','琼华']) {
    const comparison=proposal.getByLabel(name+'立绘对比',{exact:true});
    await comparison.scrollIntoViewIfNeeded();
    await expect.poll(()=>comparison.locator('img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).naturalWidth>0))).toBe(true);
    await comparison.screenshot({path:path.join(output,name+'-comparison.png')});
  }
  const qiongSelect=proposal.getByLabel('琼华对比表情',{exact:true});
  if(await qiongSelect.locator('option').count()>1) {await qiongSelect.selectOption({index:1});await expect.poll(()=>proposal.getByLabel('琼华立绘对比',{exact:true}).locator('img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).naturalWidth>0))).toBe(true);}

  const reviewText = await proposal.innerText();
  await assistant.screenshot({ path: path.join(output, 'proposal.png'), fullPage: true });
  phase = 'apply';
  await proposal.getByRole('button', { name: '应用创作方案', exact: true }).click();
  await expect(proposal).toContainText('已应用创作方案');
  await expect.poll(async () => (await assistant!.evaluate(() => window.studio!.getAiContext!()))!.project.characters.find(character => character.id === fang.id)!.expressions[0].assetId).not.toBe(before.characters.find(character => character.id === fang.id)!.expressions[0].assetId);
  const after = (await assistant.evaluate(() => window.studio!.getAiContext!()))!.project;
  expect(after.scriptText?.content).toBe(before.scriptText?.content);
  expect(aiLines(after).map(({ line }) => line)).toEqual(aiLines(before).map(({ line }) => line));
  for (const id of [fang.id, qiong.id]) {
    const prior = before.characters.find(character => character.id === id)!, changed = after.characters.find(character => character.id === id)!;
    expect(changed.defaultExpressionId).toBe(prior.defaultExpressionId);
    for (const expression of prior.expressions) expect(changed.expressions.some(item => item.id === expression.id && item.assetId !== expression.assetId)).toBe(true);
    for (const expression of changed.expressions) {
      const asset = after.assets.find(asset => asset.id === expression.assetId)!;
      expect(sourceHashes).toContain(await hash(assetSourcePath(output,asset)));
    }
  }
  expect(after.characters.filter(character => ![fang.id, qiong.id].includes(character.id))).toEqual(before.characters.filter(character => ![fang.id, qiong.id].includes(character.id)));
  if(mixed) expect(after.width).toBe(1600);
  phase = 'undo and redo';
  await assistant.getByRole('button', { name: '撤销工程修改', exact: true }).click();
  await expect.poll(async () => JSON.stringify((await assistant!.evaluate(() => window.studio!.getAiContext!()))!.project.characters)).toBe(JSON.stringify(before.characters));
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(async () => JSON.stringify((await assistant!.evaluate(() => window.studio!.getAiContext!()))!.project.characters)).toBe(JSON.stringify(after.characters));
  phase = 'save and reload';
  await page.getByRole('button', { name: '保存工程', exact: true }).click(); await expect(page.locator('.dirty-dot')).toHaveCount(0);
  expect(JSON.parse(await fs.readFile(projectFile, 'utf8')).characters).toEqual(after.characters);
  await page.reload(); await expect(page.locator('.project-title strong')).toHaveText(project.name, { timeout: 30000 });
  expect(await fs.readFile(originalFile)).toEqual(bytes);
  expect(await Promise.all(sourceFiles.map(hash))).toEqual(sourceHashes);
  expect(errors).toEqual([]); if(!live) expect(calls).toBe(3);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', externalApiCalled: live, model:config.model, mixed, reference, calls, response:reviewText, checkedLines: Number(reviewText.match(/检查范围：(\d+)/)?.[1]), availableLines: aiLines(before).length, changedLines: 0, changedCharacters: 2, imageCount: sourceFiles.length, warnings, errors }, null, 2));
  console.log(output);
  }
} catch (error) {
  await assistant?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', live, mixed, phase, error: String(error), errors, response:await assistant?.locator('.ai-messages').innerText().catch(()=>undefined) }, null, 2));
  console.error(error); console.log(output); process.exitCode = 1;
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app.close().catch(() => undefined); mock.closeAllConnections(); mock.close(); }
