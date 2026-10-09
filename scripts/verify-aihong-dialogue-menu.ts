import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { UnityUi } from './lib/unity-ui';
import { projectSchema } from '../src/core/model';
import { buildProject,runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),output=path.join(root,'artifacts/aihong-dialogue-menu',new Date().toISOString().replaceAll(':','-'));
await fs.mkdir(output,{recursive:true});const template=path.join(root,'resources/templates/aihong'),sdk=path.join(root,'resources/runtime'),game=path.join(output,'game');
const ui=await UnityUi.load(path.join(root,'artifacts/aihong-ui-inspection/2026-09-10-layout'));
const manifest=JSON.parse(await fs.readFile(path.join(root,'artifacts/aihong-ui-assets/manifest.json'),'utf8'));
const assets=new Map<string,string>(manifest.assets.map((a:any)=>[ui.key(a.source),a.id]));
const entries=[['PlotMap','plotmap','flowchart','OnClickPlotMap','流程图(A)'],['Save','save','save','OnTapSave','保存进度'],['Load','load','load','OnTapLoad','读取存档'],['Auto','auto','auto','OnTapAuto','自动播放'],['Skip','skip','skip','OnTapSkip','跳过'],['History','history','history','OnClickHistory','对话历史'],['Config','config','preferences','OnTapConfig','设置'],['HideUI','hideui','hideInterface','OnClickHide','隐藏界面']] as const;
const evidence:any[]=[];
for(const file of ['resources/templates/aihong/project.vns.json','artifacts/aihong-template/project.vns.json']){
 const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(root,file),'utf8')));assert.equal(project.ui.menuShortcutPage,'preferences');assert.equal(project.ui.pages?.say?.showQuickMenu,false);
 const rows=entries.map(([name,suffix,action,method])=>{
  const node=ui.node('Canvas-AdvUI/MainGame/Buttons/'+name),rect=ui.rectangle(node),component=project.ui.components.find(c=>c.id==='ai_dialogue_'+suffix)!;
  assert.ok(component);assert.equal(component.page,'say');assert.equal(component.kind,'button');assert.equal(component.action,action);assert.equal(node.data.m_IsActive,true);
  const methods=ui.components(node).filter(c=>c.class==='UnityEngine.UI.Button').flatMap(c=>(c.data.m_OnClick?.m_PersistentCalls?.m_Calls??[]).map((call:any)=>call.m_MethodName));assert.ok(methods.includes(method),name+': '+JSON.stringify(methods));
  const expected={x:rect.x/ui.width,y:rect.y/ui.height,width:rect.width/ui.width,height:rect.height/ui.height};
  // Broad normalized geometry, not a pixel-difference threshold.
  for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(component[key]-expected[key])<.02,name+' '+key);
  for(const [state,original] of [['idle','normal'],['hover','highlighted'],['pressed','Pressed']] as const){const sprite=ui.localizedSprite(node,original);if(sprite)assert.equal(component.skin?.[state],assets.get(ui.key(sprite)),name+' '+state);}
  return {id:component.id,action,originalCallback:method,originalRect:rect,componentRect:{x:component.x,y:component.y,width:component.width,height:component.height}};
 });
 assert.ok(rows.every((row,index)=>!index||row.componentRect.x>rows[index-1].componentRect.x));
 evidence.push({file,menuShortcutPage:project.ui.menuShortcutPage,buttons:rows});
}
await fs.writeFile(path.join(output,'source-comparison.json'),JSON.stringify(evidence,null,2));
const project=projectSchema.parse(JSON.parse(await fs.readFile(path.join(template,'project.vns.json'),'utf8'))),opening=project.nodes.find(n=>n.id==='opening');assert.ok(opening?.kind==='passage'&&opening.lines.length>3);const target=opening.lines[3];
// Keep all authored menu controls/assets/story actions. Only test window preferences differ.
project.playerDefaults={...project.playerDefaults,fullscreen:false,windowSize:'1280x720'};
const built=await buildProject({project,projectDir:template,sdkRoot:sdk,outputDir:game,development:true});await fs.writeFile(path.join(output,'compile.log'),built.log+JSON.stringify(built.diagnostics));assert.ok(built.ok);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        $ preferences.afm_time = 1000
        $ config.skip_delay = 600000
    teardown:
        exit

testcase dialogue_menu_functions:
    click id "vn_component_ai_title_start"
    advance until ${JSON.stringify(target.text)}
    assert screen "say"
    assert eval _game_menu_screen == "preferences"
    keysym "K_ESCAPE"
    assert screen "preferences"
    assert not screen "pause_menu"
    keysym "K_ESCAPE"
    assert ${JSON.stringify(target.text)}
${entries.map(([,suffix,,,tooltip])=>`    move id "vn_component_ai_dialogue_${suffix}"
    pause 0.1
    assert eval GetTooltip() == ${JSON.stringify(tooltip)}
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_${suffix}").is_sensitive()`).join('\n')}
    move id "vn_component_ai_dialogue_plotmap"
    screenshot "dialogue-toolbar.png"
    click id "vn_component_ai_dialogue_plotmap"
    assert screen "flowchart"
    click id "vn_component_ai_flowchart_back"
    assert ${JSON.stringify(target.text)}
    keysym "K_a"
    assert screen "flowchart"
    click id "vn_component_ai_flowchart_back"
    assert ${JSON.stringify(target.text)}
    click id "vn_component_ai_dialogue_auto"
    assert eval preferences.afm_enable
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_auto").is_selected()
    screenshot "auto-active.png"
    click id "vn_component_ai_dialogue_auto"
    assert eval not preferences.afm_enable
    $ preferences.skip_unseen = True
    click id "vn_component_ai_dialogue_skip"
    assert eval config.skipping == "slow"
    assert screen "skip_indicator"
    assert eval renpy.get_widget("say", "vn_component_ai_dialogue_skip").is_selected()
    screenshot "skip-active.png"
    click id "vn_component_ai_dialogue_skip"
    assert eval not config.skipping
    assert not screen "skip_indicator"
    assert ${JSON.stringify(target.text)}
    click id "vn_component_ai_dialogue_history"
    assert screen "history"
    assert eval any(entry.what == ${JSON.stringify(target.text)} for entry in _history_list)
    click id "vn_component_ai_history_back"
    assert ${JSON.stringify(target.text)}
    click id "vn_component_ai_dialogue_config"
    assert screen "preferences"
    click id "vn_component_ai_settings_buttonback"
    assert ${JSON.stringify(target.text)}
    click id "vn_component_ai_dialogue_hideui"
    assert eval _windows_hidden
    screenshot "interface-hidden.png"
    click pos (800, 400)
    assert eval not _windows_hidden
    assert ${JSON.stringify(target.text)}
    click id "vn_component_ai_dialogue_save"
    assert screen "save"
    run FilePage("1")
    click id "vn_file_slot_1_action"
    pause until eval renpy.can_load("1-1")
    assert eval ${JSON.stringify(target.text)} in FileJson(1, "vn_ui_excerpt")
    screenshot "saved-slot.png"
    click id "vn_file_slot_1_action"
    assert screen "confirm"
    click id "vn_component_ai_confirm_no"
    assert screen "save"
    click id "vn_component_ai_save_back"
    assert ${JSON.stringify(target.text)}
    click id "vn_component_ai_dialogue_load"
    assert screen "load"
    click id "vn_file_slot_1_action"
    if screen "confirm":
        click id "vn_component_ai_confirm_yes"
    pause until screen "say"
    assert ${JSON.stringify(target.text)}
    assert eval vn_current_node == "opening"
    screenshot "loaded-dialogue.png"
    $ preferences.afm_time = 0.1
    click id "vn_component_ai_dialogue_auto"
    pause until screen "choice"
    assert screen "choice"
    $ preferences.afm_enable = False
    run FileLoad(1, page="1", confirm=False)
    pause until screen "say"
    assert ${JSON.stringify(target.text)}
    $ config.skip_delay = 5
    $ preferences.skip_unseen = True
    click id "vn_component_ai_dialogue_skip"
    pause until screen "choice"
    assert screen "choice"
    pause 0.2
    assert screen "choice"
    screenshot "skip-stops-at-choice.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:90000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);
const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log),assertions=Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]);
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',assertions,sourceTemplates:evidence.map(e=>e.file),originalGameOperated:false,checks:['原始层级回调、八项按钮顺序/大致布局和图片状态来源','Esc进入设置并返回原对白','八项悬停提示','流程图按钮与A键、设置和历史往返','自动和跳过真实开关、选中态及实际推进到选择处','隐藏界面点击恢复且不推进剧情','真实存档、覆盖取消、读档回到当前对白'],testAdjustments:['隔离窗口偏好','先延长自动与跳过等待以观察选中态，再缩短等待验证实际推进','跳过测试临时开启未读跳过','第二次程序化读档仅重置自动/跳过推进测试的起点']},null,2));console.log(output);assert.ok(passed,result.log.slice(-6000));
