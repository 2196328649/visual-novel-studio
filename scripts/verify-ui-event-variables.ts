import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect, type Locator } from '@playwright/test';
import { createServer } from 'vite';
import { createProject } from '../src/core/model';
import { createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),output=path.join(root,'artifacts/ui-event-variables',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('控件事件与变量验收'),callback=createBlueprintGraph('function','原点击回调'),primary=createBlueprintGraph('function','原按钮蓝图');project.blueprints.push(callback,primary);
project.ui.pages={...project.ui.pages,main:{layout:'custom'}};project.ui.components.push(
 {id:'legacy',kind:'button',page:'main',name:'旧按钮',text:'已有逻辑',x:.1,y:.1,width:.2,height:.1,events:{onClick:callback.id},action:'blueprint',blueprintId:primary.id},
 {id:'preset',kind:'button',page:'main',name:'设置按钮',text:'设置',action:'preferences',x:.4,y:.1,width:.2,height:.1},
 {id:'manual',kind:'button',page:'main',name:'变量按钮',text:'通过变量隐藏',x:.1,y:.45,width:.3,height:.1},
 {id:'target',kind:'text',page:'main',name:'目标文字',text:'由变量控制的内容',x:.1,y:.3,width:.5,height:.1});
synchronizeBlueprintSignatures(project);const original=JSON.stringify(project),projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,original);
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const selectComponent=(id:string)=>page.locator('[data-ui-component-id="'+id+'"]').click();
const mode=(name:string)=>page.getByLabel('界面编辑模式').getByRole('button',{name,exact:true}).click();
const node=(name:string)=>page.locator('.react-flow__node').filter({has:page.locator('.graph-node-title strong',{hasText:name})});
const arrange=async()=>{const button=page.getByRole('button',{name:'自动排列蓝图',exact:true});await button.click();await expect(button).toBeEnabled();await page.getByRole('button',{name:'框选全部节点',exact:true}).click();};
const dragVariable=async(choice:'读取变量'|'设置变量')=>{await page.locator('[data-ui-variable-id]').dragTo(page.locator('.flow-container'),{targetPosition:{x:340,y:170}});await page.getByRole('dialog',{name:'添加蓝图节点'}).getByRole('button',{name:new RegExp('^'+choice)}).click();};
const wire=async(from:Locator,to:Locator)=>{await from.click();await to.click();};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await mode('事件图');await selectComponent('legacy');
 await expect(page.getByLabel('按钮执行顺序').locator('li')).toHaveText(['绑定事件：原点击回调','调用：原按钮蓝图']);
 await page.getByRole('button',{name:'点击时 · OnClicked',exact:true}).click();await expect(page.getByLabel('当前页面事件图')).toHaveValue(callback.id);await expect(node('事件开始')).toHaveClass(/selected/);await expect(page.getByRole('button',{name:'保存界面',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'调用：原按钮蓝图',exact:true}).click();await expect(page.getByLabel('当前页面事件图')).toHaveValue(primary.id);
 await selectComponent('preset');await expect(page.getByLabel('按钮执行顺序')).toContainText('预设动作：设置');await page.getByRole('button',{name:'编辑按钮行为',exact:true}).click();await expect(page.getByLabel('点击行为',{exact:true})).toHaveValue('preferences');await mode('事件图');await selectComponent('legacy');
 await page.getByRole('button',{name:'＋ 添加独立点击事件',exact:true}).click();await expect(page.locator('.react-flow__node')).toHaveCount(2);await expect(page.getByLabel('按钮执行顺序').locator('li')).toHaveCount(3);
 await page.getByRole('button',{name:'新建变量',exact:true}).click();const form=page.getByRole('form',{name:'创建界面图变量'});await expect(form.getByRole('button',{name:'创建变量',exact:true})).toBeDisabled();await page.getByLabel('变量名称',{exact:true}).fill('显示内容');await page.getByLabel('变量初始值',{exact:true}).selectOption('true');await form.getByRole('button',{name:'创建变量',exact:true}).click();
 await expect(page.locator('[data-ui-variable-id]')).toHaveCount(1);assert.equal(await fs.readFile(projectFile,'utf8'),original);
 await page.getByRole('button',{name:'新建变量',exact:true}).click();await page.getByLabel('变量名称',{exact:true}).fill('显示内容');await expect(page.getByRole('form',{name:'创建界面图变量'}).getByRole('button',{name:'创建变量',exact:true})).toBeDisabled();await page.getByRole('form',{name:'创建界面图变量'}).getByRole('button',{name:'取消',exact:true}).click();
 await selectComponent('manual');await page.getByRole('button',{name:'点击时 · OnClicked',exact:true}).click();await expect(page.locator('.react-flow__node')).toHaveCount(3);await dragVariable('设置变量');await node('设置状态').getByLabel('设置状态 · 新值',{exact:true}).selectOption('false');
 await selectComponent('target');await page.getByRole('button',{name:'设置属性',exact:true}).click();await dragVariable('读取变量');await expect(page.locator('.react-flow__node')).toHaveCount(6);await arrange();
 await wire(node('读取状态').locator('[data-handleid="value"]'),node('设置组件属性').locator('[data-handleid="value"]'));await expect(page.locator('.react-flow__edge')).toHaveCount(3);
 await page.getByRole('button',{name:'交互预演',exact:true}).click();const frame=page.locator('.ui-logic-preview-frame');await expect(frame.getByText('由变量控制的内容',{exact:true})).toBeVisible();await frame.getByRole('button',{name:'通过变量隐藏',exact:true}).click();await expect(frame.getByText('由变量控制的内容',{exact:true})).toHaveCount(0);await expect(page.getByLabel('预演参数 显示内容',{exact:true})).toHaveValue('false');
 await page.getByRole('button',{name:'交互预演',exact:true}).click();await page.getByRole('button',{name:'保存界面',exact:true}).click();await expect(page.getByRole('button',{name:'保存界面',exact:true})).toBeDisabled();const saved=JSON.parse(await fs.readFile(projectFile,'utf8'));assert.deepEqual(saved.blueprints.slice(0,2),project.blueprints);assert.deepEqual(saved.ui.components,project.ui.components);assert.equal(saved.variables[0].initial,true);assert.equal(saved.variables[0].type,'boolean');for(const n of saved.blueprints.at(-1).nodes.filter((n:any)=>['getVariable','setVariable'].includes(n.type)))assert.equal(n.pins.find((p:any)=>p.id==='value').dataType,'boolean');
 await arrange();if(await page.getByRole('button',{name:'关闭事件图提示',exact:true}).isVisible())await page.getByRole('button',{name:'关闭事件图提示',exact:true}).click();await page.screenshot({path:path.join(output,'variables.png')});await page.getByRole('button',{name:'保存界面',exact:true}).click();
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await mode('事件图');await expect(page.locator('[data-ui-variable-id]')).toHaveText('显示内容');await expect(page.locator('.react-flow__edge')).toHaveCount(3);
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['旧回调与主动作按执行顺序展示','点击时定位已有图且不改草稿','预设动作中文显示并回到设计编辑','追加事件不改原绑定图','图内新建开关变量及重复名称拦截','变量拖入选择读取和设置','变量设置与控件属性数据连线生效','保存重开且变量初始值不受预演影响']}));console.log(output);
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+errors.join('\n'));console.log(output);throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();}
