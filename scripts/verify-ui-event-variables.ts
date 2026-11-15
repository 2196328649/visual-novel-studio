import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { expect, type Locator } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { createProject, type BlueprintVariable } from '../src/core/model';
import { createBlueprintGraph, synchronizeBlueprintSignatures } from '../src/core/blueprint';
import { BLUEPRINT_MEMBER_MIME } from '../src/core/blueprint-member-access';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { openUiPreviewForTest } from './lib/ui-preview-window';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
if (process.env.VNS_INSTALLED_EXE) throw new Error('Use only the isolated development editor.');
const root=path.resolve('.'),output=path.resolve(process.env.VNS_ARTIFACT_ROOT??path.join(root,'artifacts'),'ui-event-variables',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const builtRenderer = process.env.VNS_VERIFY_BUILT_RENDERER === '1';
// Screenshots stay out of the project folder: the editor imports new media found there, changing the project mid-test.
const shots=path.join(output,'shots');await fs.mkdir(shots,{recursive:true});
const project=createProject('控件事件与变量验收'),callback=createBlueprintGraph('function','原点击回调'),primary=createBlueprintGraph('function','原按钮蓝图');project.blueprints.push(callback,primary);
project.ui.pages={...project.ui.pages,main:{layout:'custom'}};project.ui.components.push(
 {id:'legacy',kind:'button',page:'main',name:'旧按钮',text:'已有逻辑',x:.1,y:.1,width:.2,height:.1,events:{onClick:callback.id},action:'blueprint',blueprintId:primary.id},
 {id:'preset',kind:'button',page:'main',name:'设置按钮',text:'设置',action:'preferences',x:.4,y:.1,width:.2,height:.1},
 {id:'manual',kind:'button',page:'main',name:'变量按钮',text:'通过变量隐藏',x:.1,y:.45,width:.3,height:.1},
 {id:'target',kind:'text',page:'main',name:'目标文字',text:'由变量控制的内容',x:.1,y:.3,width:.5,height:.1});
synchronizeBlueprintSignatures(project);const original=JSON.stringify(project),projectFile=path.join(output,'project/project.vns.json');await fs.mkdir(path.dirname(projectFile), { recursive: true });await fs.writeFile(projectFile,original);
let server: ViteDevServer | undefined;
if (!builtRenderer) { server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/resources/**','**/release/**']}}});await server.listen(); }
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile'),devUrl:server?'http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port:undefined}),editor=await app.firstWindow();let page=editor;page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const checks: string[] = [], report: Record<string, unknown> = { status: 'running', renderer: builtRenderer ? 'built' : 'development', checks, errors };
const variables = () => editor.locator('.ui-event-library .blueprint-state-panel');
const selectComponent=(id:string)=>page.locator('[data-ui-component-id="'+id+'"]').click();
const mode=(name:string)=>page.getByLabel('界面编辑模式').getByRole('button',{name,exact:true}).click();
const node=(name:string)=>page.locator('.react-flow__node').filter({has:page.locator('.graph-node-title strong',{hasText:name})});
const arrange=async()=>{const button=page.getByRole('button',{name:'自动排列蓝图',exact:true});await button.click();await expect(button).toBeEnabled();await page.getByRole('button',{name:'框选全部节点',exact:true}).click();};
const stateTypeNames: Record<BlueprintVariable['type'], string> = { boolean: '开关', number: '数值', string: '文字' };
async function chooseStateType(area: Locator, label: string, type: BlueprintVariable['type']) {
 await area.getByRole('combobox', { name: label, exact: true }).click();
 const options = area.getByRole('listbox', { name: label + '选项', exact: true }); await expect(options).toBeVisible();
 await options.getByRole('option', { name: stateTypeNames[type], exact: true }).click(); await expect(options).toBeHidden();
}
type VariableDragEvidence = { types: string[]; mime: string; trusted: boolean };
const dragVariable=async(choice:'read'|'write')=>{
 await variables().getByLabel('状态列表作用域', { exact: true }).selectOption('project');
 const source=variables().locator('.blueprint-member-select').and(variables().getByRole('button',{name:'编辑变量 显示内容',exact:true}));
 await expect(source).toHaveCount(1);await expect(source).toHaveAttribute('draggable','true');
 const variableId=await source.evaluate(element=>element.closest('[data-state-variable-id]')!.getAttribute('data-state-variable-id'));
 await source.evaluate(element=>{
  const state=window as unknown as {__uiEventVariableDrag?:VariableDragEvidence};state.__uiEventVariableDrag=undefined;
  // Read after React's delegated handler has populated the real drag payload.
  element.closest('#root')!.addEventListener('dragstart',event=>{const drag=event as DragEvent,transfer=drag.dataTransfer;state.__uiEventVariableDrag=transfer?{types:[...transfer.types],mime:transfer.getData('application/vns-blueprint-member'),trusted:drag.isTrusted}:undefined;},{once:true});
 });
 await source.dragTo(editor.locator('.flow-container'),{targetPosition:{x:340,y:170}});
 const evidence=await editor.evaluate(()=>(window as unknown as {__uiEventVariableDrag?:VariableDragEvidence}).__uiEventVariableDrag);
 assert.ok(evidence);assert.equal(evidence.trusted,true);assert.ok(evidence.types.includes(BLUEPRINT_MEMBER_MIME));
 const reference=JSON.parse(evidence.mime);assert.equal(reference.version,1);assert.equal(reference.projectId,project.id);assert.equal(reference.id,variableId);assert.equal(reference.kind,'variable');assert.equal(reference.scope,'project');
 const menu=editor.getByRole('dialog',{name:'蓝图成员操作',exact:true});await expect(menu).toBeVisible();
 const action=menu.locator('[data-node-picker-item="'+choice+'-member"]');await expect(action).toBeEnabled();await action.click();await expect(menu).toHaveCount(0);
};
const wire=async(from:Locator,to:Locator)=>{await from.click();await to.click();};
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});if (builtRenderer) assert.equal(fileURLToPath(page.url()),path.join(root,'dist/index.html'));await page.locator('[data-workspace-tab="ui"]').click();await mode('事件图');await selectComponent('legacy');
 await expect(page.getByLabel('按钮执行顺序').locator('li')).toHaveText(['绑定事件：原点击回调','调用：原按钮蓝图']);
 await page.getByRole('button',{name:'点击时 · OnClicked',exact:true}).click();await expect(page.getByLabel('当前页面事件图')).toHaveValue(callback.id);await expect(node('事件开始')).toHaveClass(/selected/);await expect(page.getByRole('button',{name:'保存界面',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'调用：原按钮蓝图',exact:true}).click();await expect(page.getByLabel('当前页面事件图')).toHaveValue(primary.id);
 await selectComponent('preset');await expect(page.getByLabel('按钮执行顺序')).toContainText('预设动作：设置');await page.getByRole('button',{name:'编辑按钮行为',exact:true}).click();
 const interaction=page.locator('.ui-inspector-view:not([hidden]) [data-ui-inspector-group="interaction"]');
 await expect(interaction).toHaveCount(1);if(await interaction.getAttribute('open')===null)await interaction.locator(':scope > summary').click();
 await expect(page.getByLabel('点击行为',{exact:true})).toHaveValue('preferences');await mode('事件图');await selectComponent('legacy');
 await page.getByRole('button',{name:'＋ 添加独立点击事件',exact:true}).click();await expect(page.locator('.react-flow__node')).toHaveCount(2);await expect(page.getByLabel('按钮执行顺序').locator('li')).toHaveCount(3);
 // Shared variables belong to their real parameter set; creation can be cancelled without a placeholder definition.
 await variables().getByLabel('状态列表作用域').selectOption('project');
 await variables().getByRole('button',{name:'新建变量',exact:true}).click();const form=variables().getByRole('form',{name:'创建状态变量'});
 await expect(form.getByLabel('变量名称',{exact:true})).toBeFocused();await expect(form.getByRole('button',{name:'创建变量',exact:true})).toBeDisabled();
 await form.getByLabel('变量名称',{exact:true}).fill('取消的共享参数');await form.getByRole('button',{name:'取消',exact:true}).click();await expect(form).toHaveCount(0);await expect(variables().locator('[data-state-variable-id]')).toHaveCount(0);
 await variables().getByRole('button',{name:'新建变量',exact:true}).click();await form.getByLabel('变量名称',{exact:true}).fill('显示内容');await chooseStateType(form,'变量类型','boolean');await form.getByLabel('变量初始值',{exact:true}).selectOption('true');await expect(form.getByLabel('变量所属参数集',{exact:true})).toHaveValue('parameters_story');await form.getByRole('button',{name:'创建变量',exact:true}).click();
 await expect(page.locator('[data-ui-variable-id]')).toHaveCount(1);assert.equal(await fs.readFile(projectFile,'utf8'),original);
 await variables().getByRole('button',{name:'新建变量',exact:true}).click();await form.getByLabel('变量名称',{exact:true}).fill('显示内容');await expect(form.getByRole('button',{name:'创建变量',exact:true})).toBeDisabled();await form.getByRole('button',{name:'取消',exact:true}).click();
 await variables().getByLabel('搜索变量',{exact:true}).fill('不存在');await expect(variables().locator('[data-state-variable-id]')).toHaveCount(0);await variables().getByLabel('搜索变量',{exact:true}).fill('内容');await expect(variables().locator('[data-ui-variable-id]')).toHaveText('显示内容');await variables().getByLabel('搜索变量',{exact:true}).fill('');
 await page.locator('.react-flow__node').last().locator('.graph-node-title strong').click();
 const member=variables().locator('.blueprint-member-select').and(variables().getByRole('button',{name:'编辑变量 显示内容',exact:true}));await member.click();await expect(member).toHaveAccessibleName('编辑变量 显示内容');await expect(member).toHaveAttribute('aria-pressed','true');await expect(variables().locator('.blueprint-state-definition')).toHaveCount(1);await expect(variables().locator('.blueprint-state-shared-summary')).toContainText('故事状态');
 for(const action of ['读取','设置'])await expect(variables().getByRole('button',{name:action+' 显示内容',exact:true})).toBeEnabled();
 const selectedNodes=await page.locator('.react-flow__node.selected').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-id'))),nodeIds=await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-id')));
 assert.equal(selectedNodes.length,1);
 await member.focus();await member.press('Delete');await member.press('Control+d');await expect.poll(()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-id')))).toEqual(nodeIds);expect(await page.locator('.react-flow__node.selected').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-id')))).toEqual(selectedNodes);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(variables().locator('[data-state-variable-id]')).toHaveCount(0);await page.getByRole('button',{name:'重做',exact:true}).click();await expect(variables().locator('[data-ui-variable-id]')).toHaveText('显示内容');
 checks.push('共享参数先选择真实参数集，一次创建/撤销/重做；取消与搜索无占位定义，成员上的Delete/Ctrl+D不改画布节点');
 await selectComponent('manual');await page.getByRole('button',{name:'点击时 · OnClicked',exact:true}).click();await expect(page.locator('.react-flow__node')).toHaveCount(3);await dragVariable('write');await node('设置状态').getByLabel('设置状态 · 新值',{exact:true}).selectOption('false');
 await selectComponent('target');await page.getByRole('button',{name:'设置属性',exact:true}).click();await dragVariable('read');await expect(page.locator('.react-flow__node')).toHaveCount(6);await arrange();
 // A variable getter is drawn as a pill titled with the variable, not the node name.
 await wire(page.locator('.react-flow__node .blueprint-getter-node [data-handleid="value"]'),node('设置组件属性').locator('[data-handleid="value"]'));await expect(page.locator('.react-flow__edge')).toHaveCount(3);
 page=await openUiPreviewForTest(app,editor,errors);page.setDefaultTimeout(10000);const frame=page.locator('.ui-logic-preview-frame');await expect(frame.getByText('由变量控制的内容',{exact:true})).toBeVisible();await frame.getByRole('button',{name:'通过变量隐藏',exact:true}).click();await expect(frame.getByText('由变量控制的内容',{exact:true})).toHaveCount(0);await expect(page.getByLabel('预演参数 显示内容',{exact:true})).toHaveValue('false');
 page=editor;await page.getByRole('button',{name:'保存界面',exact:true}).click();await expect(page.locator('.ui-save-status')).toHaveText('已保存');await expect(page.getByRole('button',{name:'保存界面',exact:true})).toBeDisabled();const saved=JSON.parse(await fs.readFile(projectFile,'utf8'));assert.deepEqual(saved.blueprints.slice(0,2),project.blueprints);assert.deepEqual(saved.ui.components,project.ui.components);assert.equal(saved.variables[0].initial,true);assert.equal(saved.variables[0].type,'boolean');for(const n of saved.blueprints.at(-1).nodes.filter((n:any)=>['getVariable','setVariable'].includes(n.type)))assert.equal(n.pins.find((p:any)=>p.id==='value').dataType,'boolean');
 await arrange();if(await page.getByRole('button',{name:'关闭事件图提示',exact:true}).isVisible())await page.getByRole('button',{name:'关闭事件图提示',exact:true}).click();await page.screenshot({path:path.join(shots,'variables.png')});await page.getByRole('button',{name:'保存界面',exact:true}).click();
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await page.locator('[data-workspace-tab="ui"]').click();await mode('事件图');await page.locator('.ui-event-library').getByLabel('状态列表作用域').selectOption('project');await expect(page.locator('[data-ui-variable-id]')).toHaveText('显示内容');await expect(page.locator('.react-flow__edge')).toHaveCount(3);
 assert.deepEqual(errors,[]);checks.push('旧回调与主动作按执行顺序展示','点击时定位已有图且不改草稿','预设动作中文显示并回到设计编辑','追加事件不改原绑定图','图内新建开关变量及重复名称拦截','变量拖入选择读取和设置','变量设置与控件属性数据连线生效','保存重开且变量初始值不受预演影响');report.status='passed';
}catch(error){report.status='failed';report.failure=error instanceof Error?error.stack:String(error);process.exitCode=1;await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>undefined);}
finally{
 let exited=false;
 try{const child=app.process();await app.close();exited=child.exitCode!==null||child.signalCode!==null;report.process={pid:child.pid,exited};assert.equal(exited,true);}catch(error){report.status='failed';report.closeError=String(error);process.exitCode=1;}
 try{await server?.close();}catch(error){report.status='failed';report.serverError=String(error);process.exitCode=1;}
 try{if(!exited)throw new Error('Fixture is still running.');const cleanup=await cleanVerificationDirectories(output,['project','profile']);report.cleanup=cleanup;assert.deepEqual(cleanup.errors,[]);}catch(error){report.status='failed';report.cleanupError=String(error);process.exitCode=1;}
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(output);
}
