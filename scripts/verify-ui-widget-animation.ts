import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { createServer } from 'vite';
import { createProject, projectSchema } from '../src/core/model';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-widget-animation',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const project=createProject('事件图控件动画验收');project.ui.pages={...project.ui.pages,main:{layout:'custom'}};
project.ui.components.push(
 {id:'play',name:'播放按钮',kind:'button',page:'main',text:'移动并淡出',x:.1,y:.1,width:.25,height:.1},
 {id:'stop',name:'停止按钮',kind:'button',page:'main',text:'停止动画',x:.45,y:.1,width:.25,height:.1},
 {id:'target',name:'动画文字',kind:'text',page:'main',text:'这行文字将移动并淡出',x:.1,y:.4,width:.3,height:.1});
project.variables.push({id:'goal_x',name:'目标位置',type:'number',initial:.7,persistent:false,parameterSetId:'parameters_story'});
const original=JSON.stringify(project),projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,original);
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen();
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port}),page=await app.firstWindow();page.setDefaultTimeout(10000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const button=(name:string)=>page.getByRole('button',{name,exact:true});
const component=(id:string)=>page.locator('[data-ui-component-id="'+id+'"]');
const nodes=(type:string)=>page.locator('.react-flow__node').filter({has:page.locator('.node-kind-'+type)});
const arrange=async()=>{await button('自动排列蓝图').click();await expect(button('自动排列蓝图')).toBeEnabled();await button('框选全部节点').click();};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();
 await component('play').click();await button('点击时 · OnClicked').click();await component('target').click();await button('属性动画').click();
 const moveId=(await nodes('animateUiProperty').getAttribute('data-id'))!;
 const move=page.locator('.react-flow__node[data-id="'+moveId+'"]');
 await move.getByLabel('控件属性动画 · 动画属性',{exact:true}).selectOption('x');await move.getByLabel('控件属性动画 · 缓动',{exact:true}).selectOption('linear');
 await move.getByLabel('控件属性动画 · 持续秒数',{exact:true}).fill('2');await move.getByLabel('控件属性动画 · 等待结束',{exact:true}).selectOption('false');
 await component('target').dragTo(page.locator('.flow-container'),{targetPosition:{x:420,y:210}});
 await page.getByRole('dialog',{name:'添加蓝图节点'}).getByRole('button',{name:/^控件属性动画/}).click();
 const fade=nodes('animateUiProperty').filter({has:page.locator('[data-handleid="value"]')}).last();
 await fade.getByLabel('控件属性动画 · 缓动',{exact:true}).selectOption('linear');await fade.getByLabel('控件属性动画 · 持续秒数',{exact:true}).fill('2');
 await button('设置属性').click();const setter=nodes('setUiProperty');await setter.getByLabel('设置组件属性 · 属性值',{exact:true}).selectOption('false');
 await expect(page.locator('.react-flow__edge')).toHaveCount(3);
 await page.locator('[data-ui-variable-id="goal_x"]').dragTo(page.locator('.flow-container'),{targetPosition:{x:100,y:90}});await page.getByRole('dialog',{name:'添加蓝图节点'}).getByRole('button',{name:/^读取变量/}).click();
 await arrange();await nodes('getVariable').locator('.react-flow__handle[data-handleid="value"]').click();await move.locator('.react-flow__handle[data-handleid="value"]').click();
 await expect(page.locator('.react-flow__edge')).toHaveCount(4);
 await component('stop').click();await button('点击时 · OnClicked').click();await component('target').click();await button('停止动画').click();
 await expect(nodes('stopUiAnimation')).toBeVisible();await expect(page.locator('.react-flow__edge')).toHaveCount(5);
 await arrange();if(await button('关闭事件图提示').isVisible())await button('关闭事件图提示').click();
 await page.screenshot({path:path.join(output,'event-graph.png')});
 await button('交互预演').click();await page.getByLabel('按时间预演',{exact:true}).check();
 const preview=page.locator('.ui-logic-preview-frame'),target=preview.locator('[data-preview-component="target"]');
 const sampled=()=>target.evaluate(e=>({x:parseFloat((e as HTMLElement).style.left)/e.parentElement!.getBoundingClientRect().width,opacity:Number((e as HTMLElement).style.opacity)}));
 await preview.getByRole('button',{name:'移动并淡出',exact:true}).click();await button('推进 1 秒').click();
 const half=await sampled();assert.ok(Math.abs(half.x-.4)<.01,JSON.stringify(half));assert.ok(Math.abs(half.opacity-.5)<.01,JSON.stringify(half));
 const divider=page.getByRole('separator',{name:'调整画布与页面设置高度',exact:true});await divider.focus();for(let i=0;i<14;i++)await page.keyboard.press('ArrowUp');
 await preview.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'half-way-preview.png')});await button('推进 1 秒').click();await expect(target).toHaveCount(0);
 await button('恢复测试值').click();await expect(target).toBeVisible();await preview.getByRole('button',{name:'移动并淡出',exact:true}).click();await button('推进 0.1 秒').click();await preview.getByRole('button',{name:'停止动画',exact:true}).click();await expect(target).toHaveCount(0);
 await button('恢复测试值').click();assert.equal(await fs.readFile(projectFile,'utf8'),original);
 await button('交互预演').click();await button('保存界面').click();await expect(button('保存界面')).toBeDisabled();
 const saved=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))),graph=saved.blueprints.find(g=>g.uiPageId==='ui:main')!;
 assert.equal(graph.nodes.filter(n=>n.type==='animateUiProperty').length,2);assert.equal(graph.links.length,5);
 assert.equal(saved.ui.components.find(c=>c.id==='target')!.x,.1);assert.equal(saved.ui.components.find(c=>c.id==='target')!.style?.opacity,undefined);
 assert.ok(graph.links.some(l=>l.toNodeId===moveId&&l.toPinId==='value'));
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await expect(nodes('animateUiProperty')).toHaveCount(2);
 await arrange();await move.locator('.graph-node-title').click();await move.getByLabel('控件属性动画 · 持续秒数',{exact:true}).fill('3');await move.getByLabel('控件属性动画 · 持续秒数',{exact:true}).press('Tab');
 await button('框选全部节点').focus();await page.keyboard.press('Control+z');await expect(move.getByLabel('控件属性动画 · 持续秒数',{exact:true})).toHaveValue('2');await page.keyboard.press('Control+y');await expect(move.getByLabel('控件属性动画 · 持续秒数',{exact:true})).toHaveValue('3');
 await page.locator('[data-workspace-tab="assets"]').click();await page.getByRole('dialog',{name:'保存界面修改'}).getByRole('button',{name:'不保存',exact:true}).click();
 assert.equal(projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))).blueprints.find(g=>g.id===graph.id)!.nodes.find(n=>n.id===moveId)!.properties.duration,2);
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',checks:['左侧添加与拖入控件创建动画节点','移动目标由变量数据线提供','并行移动与淡出，等待结束后隐藏','按时间预演中间位置及透明度','停止动画释放等待后续连线','显式保存重开，设计默认值不受预演影响','节点参数撤销重做与放弃草稿']},null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+errors.join('\n'));throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();await server.close();console.log(output);}
