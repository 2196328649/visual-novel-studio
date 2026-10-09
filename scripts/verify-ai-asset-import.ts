import { openContentFilters } from './lib/ui-disclosures';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PNG } from 'pngjs';
import { expect, type Page } from '@playwright/test';
import { createProject, assetFiles } from '../src/core/model';
import { assetGroupPath } from '../src/core/asset-library';
import { defaultAiConfig } from '../src/core/ai';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openStoryMode } from './lib/story-workspace';

const root=path.resolve('.'),output=path.join(root,'artifacts/ai-asset-import',new Date().toISOString().replaceAll(':','-'));
const profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json'),sourceDir=path.join(output,'source'),folder=path.join(sourceDir,'场景');
await fs.mkdir(profile,{recursive:true});await fs.mkdir(path.join(folder,'白天'),{recursive:true});await fs.mkdir(path.join(folder,'夜晚'),{recursive:true});await fs.mkdir(path.join(sourceDir,'atlas'),{recursive:true});
const image=(r:number,g:number,b:number,alpha=255)=>{const png=new PNG({width:32,height:32});for(let i=0;i<png.data.length;i+=4)png.data.set([r,g,b,alpha],i);return PNG.sync.write(png);};
const imageA=path.join(folder,'白天','背景.png'),imageB=path.join(folder,'夜晚','背景.png'),extra=path.join(sourceDir,'新增背景.png');
await fs.writeFile(imageA,image(30,70,110));await fs.writeFile(imageB,image(80,30,100));await fs.writeFile(path.join(folder,'说明.txt'),'不是素材');await fs.writeFile(extra,image(30,50,180));
const skeleton=path.join(sourceDir,'rig.json'),atlas=path.join(sourceDir,'atlas','pack.atlas'),textureA=path.join(sourceDir,'renamed-a.png'),textureB=path.join(sourceDir,'renamed-b.png'),invalid=path.join(sourceDir,'invalid.json');
const skeletonData={skeleton:{spine:'4.2.43',x:-50,y:-50,width:100,height:100},bones:[{name:'root'}],slots:[{name:'body',bone:'root',attachment:'tile'}],skins:[{name:'default',attachments:{body:{tile:{type:'region',width:100,height:100}}}}],animations:{idle:{bones:{root:{rotate:[{value:0},{time:1,value:30}]}}}}};
await fs.writeFile(skeleton,JSON.stringify(skeletonData));await fs.writeFile(invalid,JSON.stringify({...skeletonData,skeleton:{spine:'3.8.99'}}));await fs.writeFile(atlas,'page-a.png\nsize:128,128\nfilter:Linear,Linear\npma:true\ntile\nbounds:0,0,128,128\n\npage-b.png\nsize:32,32\nfilter:Linear,Linear\npma:false\ntile-b\nbounds:0,0,32,32\n');await fs.writeFile(textureA,image(64,32,0,128));await fs.writeFile(textureB,image(30,60,90));
const sourceFiles=[imageA,imageB,path.join(folder,'说明.txt'),extra,skeleton,atlas,textureA,textureB,invalid],originalSources=await Promise.all(sourceFiles.map(file=>fs.readFile(file)));
const project=createProject('AI 文件夹与骨骼导入验收');await saveProject(projectFile,project);
const calls:any[]=[];
const commands=['importAssetFolder','importSpine','undo','redo','save','openUi','openScript','openAssets'];
const mock=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;calls.push(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({message:'可以选择文件夹或骨骼动画素材进行导入。',operations:[],editorCommands:commands})},finish_reason:'stop'}]}));});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(mock.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const app=await launchDesktopFixture({root,profile,projectFile}),page=await app.firstWindow();let assistant:Page|undefined;
const checks:string[]=[];
type Step={files?:string[];cancel?:boolean;hold?:boolean};
const choose=async(steps:Step[])=>app.evaluate((_electron,steps)=>{Object.assign((globalThis as any).assetChoice,{steps,index:0,dialogs:[],finish:undefined});},steps);
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 const before=await fs.readFile(projectFile,'utf8');await app.evaluate(({dialog})=>{
  const state:any=(globalThis as any).assetChoice={steps:[],index:0,dialogs:[]};
  dialog.showOpenDialog=async(...args:any[])=>{const options=args.at(-1),step=state.steps[state.index++];state.dialogs.push(options);if(!step)throw new Error('验收未预期的文件选择：'+options.title);const result={canceled:!!step.cancel,filePaths:step.cancel?[]:step.files??[]};if(step.hold)return await new Promise<Electron.OpenDialogReturnValue>(resolve=>{state.finish=()=>resolve(result);});return result;};
 });
 await openStoryMode(page,'text');const source=page.getByLabel('中文文本剧本',{exact:true});
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;
 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('导入素材文件夹和Spine动画，并提供撤销、重做和保存');await assistant.getByRole('button',{name:'发送',exact:true}).click();
 const buttons=assistant.locator('.ai-editor-commands').first(),status=buttons.locator('[role="status"]');
 const click=async(name:string)=>buttons.getByRole('button',{name,exact:true}).click();
 const snapshot=async()=>(await assistant!.evaluate(async()=>(await window.studio?.getAiContext?.())?.project))!;
 const initial=await snapshot();
 await choose([{cancel:true}]);await click('导入素材文件夹…');await expect(status).toContainText('已取消');expect((await snapshot()).assets).toEqual(initial.assets);
 await choose([{files:[folder],hold:true}]);await click('导入素材文件夹…');await expect.poll(()=>app.evaluate(()=>typeof (globalThis as any).assetChoice.finish)).toBe('function');await expect(status).toContainText('正在处理');await expect(buttons.getByRole('button',{name:'导入骨骼动画…',exact:true})).toBeDisabled();expect((await snapshot()).assets).toEqual(initial.assets);
 const text=(await source.inputValue())+'\n旁白：导入等待期间保留的修改。';await source.fill(text);
 await app.evaluate(()=>(globalThis as any).assetChoice.finish());await expect(status).toContainText('已导入 2 项');await expect(status).toContainText('忽略 1 个非素材文件');await expect(source).toHaveValue(text);
 const folderProject=await snapshot();expect(folderProject.assets).toHaveLength(2);expect(folderProject.assets.map(a=>assetGroupPath(folderProject,a)).sort()).toEqual(['场景 / 夜晚','场景 / 白天']);
 for(const asset of folderProject.assets)expect(await fs.readFile(path.join(path.dirname(projectFile),asset.path))).toEqual(await fs.readFile(asset.sourcePath?.startsWith('白天')?imageA:imageB));
 const dialogs=await app.evaluate(()=>(globalThis as any).assetChoice.dialogs);expect(dialogs[0].properties).toEqual(['openDirectory','multiSelections']);
 await click('撤销上次修改');await expect.poll(async()=>(await snapshot()).assets.length).toBe(0);await expect(source).toHaveValue(text);expect((await snapshot()).contentBrowser).toEqual(initial.contentBrowser);await click('重做上次修改');await expect.poll(async()=>(await snapshot()).assets.length).toBe(2);
 await choose([{files:[folder]}]);await click('导入素材文件夹…');await expect(status).toContainText('已导入 0 项');await expect(status).toContainText('跳过 2 项重复素材');expect((await snapshot()).assets).toEqual(folderProject.assets);
 await choose([{files:[extra,path.join(sourceDir,'missing')]}]);await click('导入素材文件夹…');await expect(status).toContainText('未完成');await expect(status).toContainText('已导入 1 项');await expect(status).toContainText('1 项失败');expect((await snapshot()).assets).toHaveLength(3);await click('撤销上次修改');await expect.poll(async()=>(await snapshot()).assets.length).toBe(2);
 checks.push('文件夹入口确实使用目录选择；保留同名嵌套背景、复制字节与分类；忽略非素材、重复跳过、部分失败、整批撤销重做及等待期间编辑保留');

 const rigSteps:Step[]=[{files:[skeleton]},{files:[atlas]},{files:[textureA]},{files:[textureB]}];
 for(let cancelAt=0;cancelAt<rigSteps.length;cancelAt++) {await choose([...rigSteps.slice(0,cancelAt),{cancel:true}]);await click('导入骨骼动画…');await expect(status).toContainText('已取消');expect((await snapshot()).assets).toHaveLength(2);}
 await choose([{files:[invalid]},...rigSteps.slice(1)]);await click('导入骨骼动画…');await expect(status).toContainText('当前支持 Spine 4.2');await expect(status).not.toContainText('Error invoking remote method');expect((await snapshot()).assets).toHaveLength(2);
 await choose([...rigSteps.slice(0,3),{files:[path.join(sourceDir,'missing-texture.png')]}]);await click('导入骨骼动画…');await expect(status).toContainText('找不到图集图片');expect((await snapshot()).assets).toHaveLength(2);
 await choose([...rigSteps.slice(0,3),{...rigSteps[3],hold:true}]);await click('导入骨骼动画…');await expect.poll(()=>app.evaluate(()=>typeof (globalThis as any).assetChoice.finish)).toBe('function');await expect(status).toContainText('正在处理');expect((await snapshot()).assets).toHaveLength(2);await app.evaluate(()=>(globalThis as any).assetChoice.finish());await expect(status).toContainText('已导入 1 项');
 const withSpine=await snapshot(),rig=withSpine.assets.find(a=>a.kind==='spine')!;expect(rig).toBeTruthy();expect(rig.spine?.animations).toEqual([{name:'idle',duration:1}]);expect(rig.spine?.pages).toHaveLength(2);
 const normalized=PNG.sync.read(await fs.readFile(path.join(path.dirname(projectFile),rig.spine!.pages[0].path)));expect([...normalized.data.subarray(0,4)]).toEqual([128,64,0,128]);expect(await fs.readFile(path.join(path.dirname(projectFile),rig.spine!.pages[1].path))).toEqual(await fs.readFile(textureB));expect(await fs.readFile(path.join(path.dirname(projectFile),rig.spine!.atlasPath),'utf8')).toContain('pma:false');
 await click('撤销上次修改');await expect.poll(async()=>(await snapshot()).assets.length).toBe(2);await click('重做上次修改');await expect.poll(async()=>(await snapshot()).assets.length).toBe(3);
 await click('打开素材');await openContentFilters(page);await page.getByLabel('资源类型',{exact:true}).selectOption('spine');const card=page.locator('[data-content-key="asset:'+rig.id+'"]');await card.click();await card.press('F2');const rename=page.getByRole('dialog',{name:'重命名',exact:true});await rename.getByLabel('内容名称',{exact:true}).fill('已命名的标题动画');await rename.getByRole('button',{name:'确定',exact:true}).click();
 await expect.poll(async()=>(await snapshot()).assets.find(a=>a.id===rig.id)?.name).toBe('已命名的标题动画');
 await choose(rigSteps);await click('导入骨骼动画…');await expect(status).toContainText('已导入 0 项');await expect(status).toContainText('跳过 1 项重复素材');expect((await snapshot()).assets.find(a=>a.id===rig.id)?.name).toBe('已命名的标题动画');
 // Duplicate import must not create a new history entry over the rename.
 await click('撤销上次修改');await expect.poll(async()=>(await snapshot()).assets.find(a=>a.id===rig.id)?.name).toBe('rig');await click('重做上次修改');await expect.poll(async()=>(await snapshot()).assets.find(a=>a.id===rig.id)?.name).toBe('已命名的标题动画');
 checks.push('Spine骨骼/atlas/两张配图选择逐阶段取消；版本错误与缺图失败；等待配图不提前完成；实际动画/图集/PMA转换、重复保留名称与历史、撤销重做');

 await click('打开界面编辑');await page.getByRole('button',{name:'添加组件',exact:true}).click();await page.getByLabel('添加组件菜单',{exact:true}).getByRole('button',{name:'文字',exact:true}).click();await choose([]);
 for(const name of ['导入素材文件夹…','导入骨骼动画…']) {await click(name);await expect(status).toContainText('界面有未保存');expect(await app.evaluate(()=>(globalThis as any).assetChoice.index)).toBe(0);}
 await expect(page.getByRole('button',{name:'保存界面',exact:true})).toBeEnabled();await page.locator('[data-workspace-tab="script"]').click();await page.getByRole('dialog',{name:'保存界面修改',exact:true}).getByRole('button',{name:'不保存',exact:true}).click();
 expect(await fs.readFile(projectFile,'utf8')).toBe(before);await click('保存工程');await expect(page.locator('.dirty-dot')).toHaveCount(0);const saved=JSON.parse(await fs.readFile(projectFile,'utf8'));expect(saved.assets).toHaveLength(3);expect(saved.scriptText.content).toContain('导入等待期间保留的修改。');expect(saved.assets.find((a:any)=>a.id===rig.id).name).toBe('已命名的标题动画');for(const file of assetFiles(rig))await fs.access(path.join(path.dirname(projectFile),file));
 expect(await Promise.all(sourceFiles.map(file=>fs.readFile(file)))).toEqual(originalSources);
 await choose([{cancel:true}]);await click('导入素材文件夹…');await expect(status).toContainText('已取消');await choose([{files:[invalid]},...rigSteps.slice(1)]);await click('导入骨骼动画…');await expect(status).toContainText('当前支持 Spine 4.2');await expect(status).not.toContainText('Error invoking remote method');
 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('回顾实际导入结果');await assistant.getByRole('button',{name:'发送',exact:true}).click();await expect(assistant.locator('.ai-message.assistant')).toHaveCount(2);const history=calls.at(-1).messages.filter((m:any)=>m.role==='assistant').map((m:any)=>m.content).join('\n');expect(history).toContain('importAssetFolder');expect(history).toContain('importSpine');expect(history).toContain('cancelled');expect(history).toContain('当前支持 Spine 4.2');expect(history).toContain('跳过 1 项重复素材');
 checks.push('脏UI在选择前阻止两个入口；显式保存前工程文件不变，保存后引用存在，源文件全程字节不变；后续AI请求收到实际成功/取消/失败与重复报告');
 await assistant.screenshot({path:path.join(output,'assistant.png')});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',compiled:true,externalApiCalled:false,nativeFileChoicesInjected:true,checks},null,2));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await assistant?.screenshot({path:path.join(output,'failure-assistant.png')}).catch(()=>undefined);console.error(output);throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();mock.closeAllConnections();mock.close();}
