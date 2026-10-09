import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { createProject, projectSchema, type UiComponent } from '../src/core/model';
import { compileProject } from '../src/runtime/compiler';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root=path.resolve('.'),output=path.join(root,'artifacts/ui-control-value',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const project=createProject('控件值读写验收');project.ui.pages={...project.ui.pages,preferences:{layout:'custom'}};
project.playerDefaults={musicVolume:.7};
project.variables.push({id:'var_flag',name:'说明开关',type:'boolean',initial:true,persistent:false},{id:'var_name',name:'玩家姓名',type:'string',initial:'原名字',persistent:false});
project.characters.push({id:'char_hero',name:'小雨',color:'#ffffff',expressions:[]},{id:'char_other',name:'另一角色',color:'#ffffff',expressions:[]});
const controls:Partial<UiComponent>[]=[
 {id:'volume',name:'音乐滑块',text:'音乐音量',preference:'musicVolume'},
 {id:'copy',name:'同源音乐滑块',text:'同源音乐音量',preference:'musicVolume'},
 {id:'flag',name:'说明开关',text:'显示说明',parameterId:'var_flag'},
 {id:'name',name:'姓名输入框',text:'玩家姓名',parameterId:'var_name'},
 {id:'hero',name:'小雨音量',text:'小雨音量',preference:'characterVolume',preferenceCharacterId:'char_hero'},
 {id:'other',name:'另一角色音量',text:'另一角色音量',preference:'characterVolume',preferenceCharacterId:'char_other'},
];
project.ui.components.push(...controls.map((c,i)=>({kind:'preference',page:'preferences',x:.08+(i%2)*.48,y:.1+Math.floor(i/2)*.2,width:.4,height:.12,...c} as UiComponent)),
 {id:'apply',kind:'button',page:'preferences',name:'应用按钮',text:'应用测试值',x:.08,y:.77,width:.3,height:.12},
 {id:'progress',kind:'progress',page:'preferences',name:'音乐进度',text:'',value:1,x:.56,y:.8,width:.4,height:.06});
const original=JSON.stringify(project),projectFile=path.join(output,'project.vns.json');await fs.writeFile(projectFile,original);
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow();page.setDefaultTimeout(10000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const button=(name:string)=>page.getByRole('button',{name,exact:true}),control=(id:string)=>page.locator('[data-ui-component-id="'+id+'"]');
const mode=async()=>{await page.getByLabel('界面编辑模式').getByRole('button',{name:'事件图',exact:true}).click();await page.getByLabel('事件图页面').selectOption('ui:preferences');};
const arrange=async()=>{await button('自动排列蓝图').click();await expect(button('自动排列蓝图')).toBeEnabled();await button('框选全部节点').click();};
try {
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await mode();
 await control('apply').click();await button('点击时 · OnClicked').click();
 await control('volume').click();await expect(page.getByLabel('控件值绑定')).toContainText('音乐音量（玩家设置）');await button('设置值').click();
 const music=page.locator('.node-kind-setPlayerPreference').first();await expect(music.getByLabel('设置玩家选项 · 设置值',{exact:true})).toHaveValue('0.7');await music.getByLabel('设置玩家选项 · 设置值',{exact:true}).fill('0.25');await page.keyboard.press('Tab');
 await control('flag').click();await expect(page.getByLabel('控件值绑定')).toContainText('说明开关（变量）');await button('设置值').click();await page.locator('.node-kind-setVariable').last().getByLabel('设置状态 · 新值',{exact:true}).selectOption('false');
 await control('name').click();await button('设置值').click();await page.locator('.node-kind-setVariable').last().getByLabel('设置状态 · 新值',{exact:true}).fill('新名字');await page.keyboard.press('Tab');
 await control('hero').dragTo(page.locator('.flow-container'),{targetPosition:{x:200,y:180}});await expect(page.getByRole('dialog',{name:'添加蓝图节点'})).toContainText('小雨 · 角色音量（玩家设置）');await page.getByRole('dialog',{name:'添加蓝图节点'}).getByRole('button',{name:/^设置控件值/}).click();
 const hero=page.locator('.node-kind-setPlayerPreference').last();await hero.getByLabel('设置玩家选项 · 设置值',{exact:true}).fill('0.4');await page.keyboard.press('Tab');await expect(hero.locator('.graph-node-detail')).toHaveText('小雨 · 角色音量');
 await control('progress').click();await expect(page.getByLabel('控件值绑定')).toHaveCount(0);await button('设置属性').click();const progress=page.locator('.node-kind-setUiProperty');await progress.getByLabel('设置组件属性 · 组件属性',{exact:true}).selectOption('value');
 await control('volume').dragTo(page.locator('.flow-container'),{targetPosition:{x:200,y:180}});await page.getByRole('dialog',{name:'添加蓝图节点'}).getByRole('button',{name:/^读取控件值/}).click();await arrange();
 await page.locator('.node-kind-getPlayerPreference [data-handleid="value"]').click();await progress.locator('[data-handleid="value"]').click();await expect(page.locator('.react-flow__edge')).toHaveCount(6);
 await button('框选全部节点').focus();await page.keyboard.press('Control+z');await expect(page.locator('.react-flow__edge')).toHaveCount(5);await page.keyboard.press('Control+y');await expect(page.locator('.react-flow__edge')).toHaveCount(6);
 if(await button('关闭事件图提示').isVisible())await button('关闭事件图提示').click();await control('hero').click();await page.screenshot({path:path.join(output,'graph.png')});
 await button('交互预演').click();const divider=page.getByRole('separator',{name:'调整画布与页面设置高度',exact:true});await divider.focus();for(let i=0;i<15;i++)await page.keyboard.press('ArrowUp');
 const preview=page.locator('.ui-logic-preview-frame');await expect(preview.getByLabel('音乐音量',{exact:true})).toHaveValue('0.7');await preview.getByRole('button',{name:'应用测试值',exact:true}).click();
 for(const name of ['音乐音量','同源音乐音量'])await expect(preview.getByLabel(name,{exact:true})).toHaveValue('0.25');
 await expect(preview.getByLabel('显示说明',{exact:true})).not.toBeChecked();await expect(preview.getByLabel('玩家姓名',{exact:true})).toHaveValue('新名字');await expect(preview.getByLabel('小雨音量',{exact:true})).toHaveValue('0.4');await expect(preview.getByLabel('另一角色音量',{exact:true})).toHaveValue('1');await expect(preview.locator('[data-preview-component="progress"] .ui-progress-preview span')).toHaveAttribute('style',/width: 25%/);
 assert.equal(await fs.readFile(projectFile,'utf8'),original);await page.screenshot({path:path.join(output,'preview.png')});
 await button('交互预演').click();await button('保存界面').click();await expect(page.locator('.workspace-toolbar').getByText('已保存',{exact:true})).toBeVisible();
 const saved=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8')));assert.deepEqual(saved.variables,project.variables);assert.deepEqual(saved.ui.components,project.ui.components);assert.deepEqual(compileProject(saved).diagnostics.filter(d=>d.severity==='error'),[]);assert.equal(saved.blueprints[0].links.length,6);
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await mode();await expect(page.locator('.react-flow__edge')).toHaveCount(6);await control('hero').click();await expect(page.getByLabel('控件值绑定')).toContainText('小雨 · 角色音量（玩家设置）');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,768));await page.getByLabel('控件值绑定').scrollIntoViewIfNeeded();await expect(button('读取值')).toBeInViewport();await expect(button('设置值')).toBeInViewport();assert.ok(await page.locator('.ui-event-library').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:path.join(output,'narrow.png')});
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',renderer:'dist',checks:['控件面板直接创建带绑定身份的读写节点','数值、开关、文字设置及按钮执行线','拖入控件选择读取或设置，角色身份保留','真实数据连线、撤销重做及进度更新','同源控件同步，其他角色音量不变','预演不写工程，显式保存重开与编译校验','1024宽度绑定信息展示']},null,2));
} catch(error) {await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);await fs.writeFile(path.join(output,'failure.txt'),String(error)+'\n'+errors.join('\n'));throw error;}
finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();console.log(output);}
