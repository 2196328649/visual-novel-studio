import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
const output=path.resolve('artifacts/menu-right-click',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(output,{recursive:true});
const p=createProject('Menu return');p.width=800;p.height=450;p.playerDefaults={textSpeed:0};
const node=p.nodes.find(n=>n.kind==='passage')!;node.lines=[{id:'first',text:'Return to this line.',actions:[]},{id:'second',text:'Next line.',actions:[]}];
const sdk=path.resolve('resources/runtime'),game=path.join(output,'game');
const built=await buildProject({project:p,projectDir:output,outputDir:game,sdkRoot:sdk});assert.ok(built.ok,built.log);
const pages=['preferences','history','flowchart','voice_settings','vn_parameter_settings_menu','load','gallery','music_room','chapter_select','voice_collection','staff_roll'];
const cases=pages.flatMap((menu,index)=>['title','game'].map(origin=>`
testcase ${origin}_${menu}:
${origin==='game'?'    click id "vn_main_start"\n    pause until "Return to this line."':''}
    run ShowMenu(${JSON.stringify(menu)})
    pause until screen "${menu}"
    assert eval main_menu == ${origin==='title'?'True':'False'}
    $ renpy.test.testmouse.click_mouse(3, 600, 180)
    pause until eval not renpy.get_screen("${menu}")
${origin==='title'?'    assert screen "main_menu"':'    assert eval vn_current_line == "first"\n    assert eval not main_menu\n    assert eval renpy.get_widget("say", "what") is not None\n    run MainMenu(confirm=False)\n    pause until screen "main_menu"'}
`));
for(const origin of ['title','game']) cases.push(`
testcase ${origin}_gallery_popup:
${origin==='game'?'    click id "vn_main_start"\n    pause until "Return to this line."':''}
    run ShowMenu("gallery")
    pause until screen "gallery"
    run Show("vn_gallery_image")
    pause until screen "vn_gallery_image"
    $ renpy.test.testmouse.click_mouse(3, 600, 180)
    pause until eval not renpy.get_screen("vn_gallery_image") and not renpy.get_screen("gallery")
${origin==='title'?'    assert screen "main_menu"':'    assert eval vn_current_line == "first"\n    assert eval not main_menu\n    run MainMenu(confirm=False)\n    pause until screen "main_menu"'}
`);
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
default qa_menu = "preferences"
screen qa_open():
    zorder 10000
    textbutton "Open" id "qa_open_button" action [Hide("qa_open"), ShowMenu(qa_menu)]
testsuite global:
    before testcase:
        $ _test.timeout = 10
        $ _test.transition_timeout = .1
    teardown:
        exit
${cases.join('\n')}
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:120000,onData:text=>process.stdout.write(text),env:{RENPY_RENDERER:'gl2',PYTHONUNBUFFERED:'1'}});
await fs.writeFile(path.join(output,'runtime.log'),result.log);assert.equal(result.code,0,result.log.slice(-5000));await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',pages,origins:['title','game'],cases:cases.length},null,2));console.log(output);
