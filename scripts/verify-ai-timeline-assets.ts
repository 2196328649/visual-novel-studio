import { blueprintFromPerformance, performanceInputs, exposePerformanceInputs } from '../src/core/blueprint-authoring';
import { createBlueprintGraph, blueprintNodeDefaults, callablePins, connectBlueprintPins } from '../src/core/blueprint';
import { performanceTimeline, arrangePerformanceTimeline } from '../src/core/performance-timeline';
import { expandPreviewActions, previewActionContext } from '../src/core/preview-actions';
import { createUiParameterBinding } from '../src/core/ui-logic';
import { previewUiLogic } from '../src/core/ui-logic-preview';
import { compileProject } from '../src/runtime/compiler';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, type Page } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import { createProject } from '../src/core/model';
import { defaultAiConfig } from '../src/core/ai';
import { saveProject } from '../src/desktop/project-store';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),output=path.join(root,'artifacts/ai-timeline-assets',new Date().toISOString().replaceAll(':','-')),profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json');
await fs.mkdir(profile,{recursive:true});
const project=createProject('组合动作原工程');project.assets.push({id:'default_image',name:'默认图片',kind:'image',path:'pixel.png'},{id:'other_image',name:'覆盖图片',kind:'image',path:'pixel.png'});await saveProject(projectFile,project);await fs.writeFile(path.join(path.dirname(projectFile),'pixel.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=','base64'));let requests=0;
const draft=structuredClone(project),child=blueprintFromPerformance(draft,[{kind:'background',assetId:'default_image',transition:'none',duration:0,wait:false}],'通用时间轴');child.timelineComponent=true;draft.blueprints.push(child);
exposePerformanceInputs(child,performanceInputs(child).filter(f=>f.pinId==='assetId'));const model=performanceTimeline(draft,child);arrangePerformanceTimeline(draft,child,model.clips.map(c=>({...c,at:.5})),model.tracks);
const caller=createBlueprintGraph('function','素材参数调用');caller.exposedInputs=[{id:'image_input',name:'图片',direction:'input',dataType:'asset',required:false,defaultValue:''}];const read=blueprintNodeDefaults('getInput');read.properties.inputId='image_input';const call=blueprintNodeDefaults('callFunction');call.properties.graphId=child.id;call.pins=callablePins(child);caller.nodes.push(read,call);connectBlueprintPins(caller,caller.nodes[0].id,'exec',call.id,'exec_in');connectBlueprintPins(caller,read.id,'value',call.id,'arg_'+child.exposedInputs[0].id);
const operations=[{kind:'editProject',path:['blueprints'],action:'append',value:caller},{kind:'editProject',path:['blueprints'],action:'append',value:child}];
const mock=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
 const result={message:'准备建立素材时间轴',operations,editorCommands:['save','openBlueprint']};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(mock.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const server=await createViteServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,profile,projectFile,sdkRoot:path.resolve(root,'..'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port});const page=await app.firstWindow();let assistant:Page|undefined;
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const before=await fs.readFile(projectFile,'utf8');
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;
 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('创建一个可复用素材时间轴，在普通蓝图中调用它，空输入使用默认图片，传入图片则覆盖，然后提供保存和蓝图按钮');await assistant.getByRole('button',{name:'发送',exact:true}).click();
 const proposal=assistant.locator('.ai-proposal').last();await expect(proposal.getByRole('button',{name:'应用选中的 2 项修改',exact:true})).toBeVisible({timeout:45000});
 await expect(assistant.getByRole('button',{name:'保存工程',exact:true})).toBeDisabled();expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await proposal.getByRole('button',{name:'应用选中的 2 项修改',exact:true}).click();await expect(proposal).toContainText('已应用修改');
 await assistant.getByRole('button',{name:'保存工程',exact:true}).click();await expect(assistant.locator('.ai-editor-commands')).toContainText('保存工程 · 已完成');
 const saved=JSON.parse(await fs.readFile(projectFile,'utf8'));
 expect(performanceTimeline(saved,saved.blueprints.find((g:any)=>g.id===child.id)).clips[0].at).toBe(.5);
 for(const [input,expected] of [['','default_image'],['other_image','other_image']]) {const context=previewActionContext(saved),actions=expandPreviewActions(saved,[{kind:'blueprint',blueprintId:caller.id,inputs:{image_input:input}}],context);expect(context.incomplete).toBe(false);expect(actions.find(a=>a.kind==='background')?.assetId).toBe(expected);}
 expect(compileProject(saved).files['game/story.rpy']).toBeTruthy();
 await assistant.getByRole('button',{name:'打开蓝图',exact:true}).click();await expect(page.locator('[data-workspace-tab="blueprint"]')).toHaveClass(/active/);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByRole('button',{name:'保存工程',exact:true}).click();await expect(page.locator('.dirty-dot')).toHaveCount(0);
 const undone=JSON.parse(await fs.readFile(projectFile,'utf8'));expect(undone.blueprints.length).toBe(0);expect(undone.assets).toEqual(project.assets);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',externalApiCalled:false,checks:['AI窗口创建时间轴与调用图','应用前磁盘不变','保存保留素材参数及时间位置','空输入默认素材与传入覆盖均有效','编译成功','打开蓝图','一次撤销移除两图且保留原素材'],requests},null,2));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});await assistant?.screenshot({path:path.join(output,'failure-assistant.png')});throw error;}
finally {await page.evaluate(()=>window.studio?.controlPreview?.('stop')).catch(()=>undefined);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();mock.closeAllConnections();mock.close();}
