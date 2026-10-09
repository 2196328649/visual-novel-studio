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
const root=path.resolve('.'),output=path.join(root,'artifacts/ai-ui-workflow',new Date().toISOString().replaceAll(':','-')),profile=path.join(output,'profile'),projectFile=path.join(output,'project/project.vns.json');
await fs.mkdir(profile,{recursive:true});
const project=createProject('组合动作原工程');await saveProject(projectFile,project);let requests=0;
const mock=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
 const planned=body.messages[0].content.includes('规划器');
 const result=planned?{createStory:true,editorCommands:['undo','redo','save']}:{title:'组合动作新故事',entry:'start',scenes:[{key:'home',name:'故乡'}],beats:[{key:'start',sceneKey:'home',name:'相逢',lines:[{text:'新的故事开始了。'}],ending:'相逢'}]};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
await fs.writeFile(path.join(profile,'ai-settings.json'),JSON.stringify({version:1,config:{...defaultAiConfig,baseUrl:'http://127.0.0.1:'+(mock.address() as {port:number}).port+'/v1',model:'local-mock',rememberKey:false}}));
const server=await createViteServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,profile,projectFile,sdkRoot:path.resolve(root,'..'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port});const page=await app.firstWindow();let assistant:Page|undefined;
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});const before=await fs.readFile(projectFile,'utf8');
 await page.locator('[data-workspace-tab="ui"]').click();await page.getByRole('button',{name:'添加组件',exact:true}).click();await page.getByLabel('添加组件菜单',{exact:true}).getByRole('button',{name:'文字',exact:true}).click();const componentId=await page.locator('[data-hierarchy-id]').getAttribute('data-hierarchy-id');
 const opened=app.waitForEvent('window');await page.getByRole('button',{name:'AI 助手',exact:true}).click();assistant=await opened;
 await assistant.getByLabel('发给 AI 的内容',{exact:true}).fill('生成一个简短故事框架，然后检查工程、保存、试玩，并提供停止试玩、打开剧情脚本和导入素材按钮');await assistant.getByRole('button',{name:'发送',exact:true}).click();
 await expect(assistant.getByRole('button',{name:'应用创作方案',exact:true})).toBeVisible({timeout:45000});
 for(const name of ['撤销上次修改','重做上次修改'])await expect(assistant.getByRole('button',{name,exact:true})).toBeDisabled();
 await assistant.getByRole('button',{name:'应用创作方案',exact:true}).click();await expect(assistant.locator('.ai-workspace-context > strong')).toHaveText('组合动作新故事');await expect(page.locator('.project-title strong')).toHaveText(project.name);expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await assistant.getByRole('button',{name:'撤销上次修改',exact:true}).click();await expect(assistant.locator('.ai-workspace-context > strong')).toHaveText(project.name);await expect(page.locator('[data-hierarchy-id]')).toHaveCount(1);
 await assistant.getByRole('button',{name:'重做上次修改',exact:true}).click();await expect(assistant.locator('.ai-workspace-context > strong')).toHaveText('组合动作新故事');
 await assistant.getByRole('button',{name:'保存工程',exact:true}).click();await expect(assistant.locator('.ai-editor-commands')).toContainText('保存工程 · 已完成');await expect(page.locator('.dirty-dot')).toHaveCount(0);await expect(page.locator('.project-title strong')).toHaveText('组合动作新故事');
 const saved=JSON.parse(await fs.readFile(projectFile,'utf8'));expect(saved.name).toBe('组合动作新故事');expect(saved.ui.components.some((c:any)=>c.id===componentId)).toBe(true);expect(saved.nodes.some((n:any)=>n.kind==='passage'&&n.lines.some((l:any)=>l.text==='新的故事开始了。'))).toBe(true);
 await page.locator('[data-workspace-tab="assets"]').click();await expect(page.getByRole('dialog',{name:'保存界面修改',exact:true})).toHaveCount(0);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',externalApiCalled:false,checks:['UI内整批创作写草稿不提前保存','撤销AI方案保留先前手动组件','重做恢复方案','AI保存合并手动UI和完整剧情','保存后离开不再询问']}));console.log(output);
} catch(error){await page.screenshot({path:path.join(output,'failure.png')});await assistant?.screenshot({path:path.join(output,'failure-assistant.png')});throw error;}
finally {await page.evaluate(()=>window.studio?.controlPreview?.('stop')).catch(()=>undefined);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();mock.closeAllConnections();mock.close();}
