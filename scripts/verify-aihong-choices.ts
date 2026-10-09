import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { projectSchema } from '../src/core/model';
import { UnityUi } from './lib/unity-ui';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { buildProject, runRenpy } from '../src/runtime/service';
import { parseProject } from '../src/desktop/project-store';

const root=path.resolve('.'),output=path.join(root,'artifacts/aihong-choices',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});
const template=path.join(root,'resources/templates/aihong'),sdk=path.join(root,'resources/runtime');
const ui=await UnityUi.load(path.join(root,'artifacts/aihong-ui-inspection/2026-09-10-layout'));
const manifest=JSON.parse(await fs.readFile(path.join(root,'artifacts/aihong-ui-assets/manifest.json'),'utf8'));
const source=ui.node('UI/Selection/Content/SelectionItem'),label=ui.node('UI/Selection/Content/SelectionItem/Label');
const rect=ui.rectangle(source),labelRect=ui.rectangle(label),area=ui.rectangle(ui.node('UI/Selection'));
const list=ui.components(ui.node('UI/Selection')).find(c=>c.class==='Utage.UguiListView')!;
const prefab=ui.reference(list.file,list.data.itemPrefab)!;
const prefabRect=ui.components(prefab).find(c=>c.type==='RectTransform')!;
assert.equal(prefabRect.data.m_SizeDelta.x,rect.width);assert.equal(prefabRect.data.m_SizeDelta.y,rect.height);
const compare:any[]=[];
for(const file of ['resources/templates/aihong/project.vns.json','artifacts/aihong-template/project.vns.json']){
 const p=projectSchema.parse(JSON.parse(await fs.readFile(path.join(root,file),'utf8'))),c=p.ui.components.find(c=>c.id==='ai_story_choices')!;
 assert.equal(c.style?.textColor,'#ffffff');assert.equal(c.style?.fontSize,36);
 assert.equal(c.list?.itemHeight,rect.height);assert.equal(c.list?.gapY,10);
 for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(c[key]-area[key]/(key==='x'||key==='width'?ui.width:ui.height))<.02);
 assert.ok(c.list?.caption);assert.ok(Math.abs(c.list.caption.x-(labelRect.x-rect.x)/rect.width)<.02);
 assert.ok(Math.abs(c.list.caption.width-labelRect.width/rect.width)<.02);
 for(const [state,original]of [['idle','normal'],['hover','highlighted'],['pressed','Pressed']] as const){const sprite=ui.localizedSprite(source,original)!;assert.equal(c.skin?.[state],manifest.assets.find((a:any)=>ui.key(a.source)===ui.key(sprite))?.id);assert.equal(ui.key(ui.localizedSprite(prefab,original)!),ui.key(sprite));}
 compare.push({file,component:c,sourceItem:rect,sourceArea:area,sourceLabel:labelRect,prefab:ui.key(prefab)});
}
await fs.writeFile(path.join(output,'source-comparison.json'),JSON.stringify(compare,null,2));
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(template,'project.vns.json'),'utf8')));
const fixture=path.join(output,'editor'),projectFile=path.join(fixture,'project.vns.json');await fs.mkdir(fixture,{recursive:true});
await fs.cp(path.join(template,'assets'),path.join(fixture,'assets'),{recursive:true});
await fs.writeFile(projectFile,JSON.stringify(project,null,2));const before=await fs.readFile(projectFile,'utf8');
const app=await launchDesktopFixture({root,projectFile,profile:path.join(output,'profile')}),page=await app.firstWindow(),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});
 const open=async()=>{await page.locator('[data-workspace-tab="ui"]').click();await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '选项' });await page.locator('[data-hierarchy-id="ai_story_choices"]').click();};
 await open();const component=page.locator('[data-component-id="ai_story_choices"]'),items=component.locator('[data-choice-index]'),caption=items.first().locator('[data-choice-caption]');
 await expect(items).toHaveCount(2);await expect(page.getByLabel('选项高度',{exact:true})).toHaveValue('109');
 await expect.poll(()=>component.locator('img').evaluateAll(xs=>xs.every(e=>(e as HTMLImageElement).complete&&(e as HTMLImageElement).naturalWidth>0))).toBe(true);
 const geometry=async()=>caption.evaluate(e=>{const c=e.getBoundingClientRect(),p=e.parentElement!.getBoundingClientRect();return {x:(c.x-p.x)/p.width,width:c.width/p.width,ratio:p.width/p.height};});
 const originalGeometry=await geometry();expect(originalGeometry.x).toBeCloseTo(compare[0].component.list.caption.x,2);expect(originalGeometry.ratio).toBeCloseTo(957/109,1);
 await component.screenshot({path:path.join(output,'editor-normal.png')});
 await page.getByLabel('按钮预览状态',{exact:true}).selectOption('hover');await expect(component.locator('img').first()).toHaveAttribute('src',/ai_ui_52d3e8f52ba868a2/);await component.screenshot({path:path.join(output,'editor-hover.png')});
 await page.getByText('选项文字区域',{exact:true}).click();const x=page.getByLabel('选项文字横向 %',{exact:true});await x.fill('30');await x.press('Tab');expect((await geometry()).x).toBeCloseTo(.3,2);
 const width=page.getByLabel('选项文字宽度 %',{exact:true});await width.fill('100');await width.press('Tab');expect((await geometry()).width).toBeCloseTo(.7,2);await page.getByRole('button',{name:'撤销',exact:true}).click();
 expect(await fs.readFile(projectFile,'utf8')).toBe(before);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await geometry()).x).toBeCloseTo(originalGeometry.x,2);
 await page.getByRole('button',{name:'重做',exact:true}).click();expect((await geometry()).x).toBeCloseTo(.3,2);
 await page.getByLabel('自定义选项文字位置',{exact:true}).uncheck();expect((await geometry()).x).toBeLessThan(.03);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await geometry()).x).toBeCloseTo(.3,2);
 await page.getByRole('button',{name:'保存界面',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 const saved=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8')));expect(saved.ui.components.find(c=>c.id==='ai_story_choices')!.list!.caption!.x).toBe(.3);
 expect(saved.nodes).toEqual(parseProject(structuredClone(project)).project.nodes);expect(saved.assets).toEqual(project.assets);
 await page.reload();await expect(page.locator('.project-title strong')).toHaveText(project.name,{timeout:45000});await open();expect((await geometry()).x).toBeCloseTo(.3,2);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,768));await component.screenshot({path:path.join(output,'editor-narrow.png')});expect((await geometry()).ratio).toBeCloseTo(957/109,1);
 expect(errors).toEqual([]);await fs.writeFile(path.join(output,'editor-report.json'),JSON.stringify({status:'passed',compiledBuild:true,checks:['原模板选项比例与文字区域','悬停皮肤真实加载','编辑文字区域立即显示且保存前磁盘不变','撤销/重做/取消自定义位置','显式保存重开','1024宽度保持按钮比例'],errors},null,2));
}catch(error){await page.screenshot({path:path.join(output,'editor-failure.png')});throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>undefined);await app.close();}

project.playerDefaults={...project.playerDefaults,fullscreen:false,windowSize:'1280x720'};
const game=path.join(output,'game'),built=await buildProject({project,projectDir:template,sdkRoot:sdk,outputDir:game,development:true});await fs.writeFile(path.join(output,'compile.log'),built.log+JSON.stringify(built.diagnostics));assert.ok(built.ok);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase template_choices:
    click id "vn_component_ai_title_start"
    advance until screen "choice"
    assert eval vn_current_node == "ai_choice_wine"
    assert "记下劝告，放下酒坛"
    assert "借酒压下心事"
    assert eval vn_var_ai_caution == 0
    move pos (10, 10)
    screenshot "choices-normal.png"
    move id "vn_component_ai_story_choices_choice_0"
    screenshot "choices-hover.png"
    $ renpy.test.testmouse.press_mouse(1)
    pause 0.1
    assert screen "choice"
    screenshot "choices-pressed.png"
    move pos (10, 10)
    $ renpy.test.testmouse.release_mouse(1)
    pause 0.1
    assert screen "choice"
    assert eval vn_var_ai_caution == 0
    assert eval renpy.get_widget("choice", "vn_component_ai_story_choices_choice_0").is_sensitive()
    assert eval renpy.get_widget("choice", "vn_component_ai_story_choices_caption_0").style.color == Color("#ffffff")
    keysym "K_ESCAPE"
    assert screen "preferences"
    click id "vn_component_ai_settings_buttonback"
    assert screen "choice"
    click id "vn_component_ai_dialogue_save"
    assert screen "save"
    run FilePage("1")
    click id "vn_file_slot_2_action"
    pause until eval renpy.can_load("1-2")
    click id "vn_component_ai_save_back"
    assert screen "choice"
    click id "vn_component_ai_story_choices_choice_0"
    assert eval vn_current_node == "ai_wine_dream"
    assert eval vn_var_ai_caution == 1
    click id "vn_component_ai_dialogue_load"
    assert screen "load"
    click id "vn_file_slot_2_action"
    if screen "confirm":
        click id "vn_component_ai_confirm_yes"
    pause until screen "choice"
    assert eval vn_current_node == "ai_choice_wine"
    assert eval vn_var_ai_caution == 0
    keysym "K_RETURN" id "vn_component_ai_story_choices_choice_1"
    assert eval vn_current_node == "ai_wine_dream"
    assert eval vn_var_ai_caution == 0
    advance until screen "choice"
    assert eval vn_current_node == "ai_choice_route"
    screenshot "choices-next-branch.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);
const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log),assertions=Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',assertions,originalGameOperated:false,checks:['原作序列化布局及实际引用预制体对照','正式模板编辑器修改/保存/重开','普通、悬停与按下状态，移出松开不选择','设置往返保留选择','真实保存/读取恢复选择和变量','鼠标第一分支与Enter第二分支','下一组选项正常显示']},null,2));console.log(output);assert.ok(passed,result.log.slice(-7000));
