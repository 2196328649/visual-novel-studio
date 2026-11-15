import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
const root=path.resolve('.'),output=path.resolve(process.env.VNS_ARTIFACT_ROOT??'artifacts/menu-right-click','menu-return-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8));
const relative=path.relative(root,output);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Acceptance output must stay inside the workspace.');
await fs.mkdir(output,{recursive:true});
const report:Record<string,unknown>={status:'running'},previousSaves=process.env.RENPY_PATH_TO_SAVES;
const sdk=path.resolve(process.env.VNS_RENPY_SDK??'resources/runtime'),game=path.join(output,'game');
let failure:unknown;
try {
await isolateRenpySaves(output);
const p=createProject('Menu return');p.width=800;p.height=450;p.playerDefaults={textSpeed:0};
const node=p.nodes.find(n=>n.kind==='passage')!;node.lines=[{id:'first',text:'Return to this line.',actions:[]},{id:'second',text:'Next line.',actions:[]}];
const built=await buildProject({project:p,projectDir:output,outputDir:game,sdkRoot:sdk});await fs.writeFile(path.join(output,'compile.log'),built.log+'\n'+JSON.stringify(built.diagnostics,null,2));assert.ok(built.ok,built.log);
// The removed more-settings screen redirects now; its compatibility case is
// covered by verify-ui-more-settings-runtime, not a normal navigation endpoint.
const pages=['preferences','history','flowchart','voice_settings','load','gallery','music_room','chapter_select','voice_collection','staff_roll'];
const cases=pages.flatMap((menu,index)=>['title','game'].map(origin=>`
testcase ${origin}_${menu}:
${origin==='game'?'    click id "vn_main_start"\n    pause until "Return to this line."':''}
    run ShowMenu(${JSON.stringify(menu)})
    pause until screen "${menu}"
    assert eval main_menu == ${origin==='title'?'True':'False'}
${menu==='preferences'?'    screenshot "'+origin+'-preferences-before-return.png"':''}
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
const testcases=`
default qa_menu = "preferences"
screen qa_open():
    zorder 10000
    textbutton "Open" id "qa_open_button" action [Hide("qa_open"), ShowMenu(qa_menu)]
testsuite global:
    before testcase:
        $ _test.timeout = 10
        $ _test.transition_timeout = .1
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
${cases.join('\n')}
`;
await fs.writeFile(path.join(output,'testcases.rpy'),testcases);await fs.writeFile(path.join(game,'game/testcases.rpy'),testcases);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:120000,onData:text=>process.stdout.write(text),env:{RENPY_RENDERER:'gl2',PYTHONUNBUFFERED:'1'}});
await fs.writeFile(path.join(output,'runtime.log'),result.log);
Object.assign(report,{code:result.code,pages,origins:['title','game'],expectedCases:cases.length,expectedAssertions:testcases.split('\n').filter(line=>line.trim().startsWith('assert ')).length,cases:Number(result.log.match(/Test cases\s*:\s*(\d+)/)?.[1]??NaN),assertions:Number(result.log.match(/Assertions\s*:\s*(\d+)/)?.[1]??NaN)});
assert.equal(result.code,0,result.log.slice(-5000));assert.match(result.log,/Status: PASSED/);assert.equal(report.cases,report.expectedCases);assert.equal(report.assertions,report.expectedAssertions);report.status='passed';
} catch(error){failure=error;report.status='failed';report.error=String(error);}
finally {
  if(previousSaves===undefined)delete process.env.RENPY_PATH_TO_SAVES;else process.env.RENPY_PATH_TO_SAVES=previousSaves;
  let preserved=false;
  try {
    for(const directory of [path.join(game,'tests/screenshots'),path.join(game,'game/tests/screenshots')])if(await fs.stat(directory).then(stat=>stat.isDirectory()).catch(()=>false))await fs.cp(directory,path.join(output,'screenshots'),{recursive:true});
    for(const filename of ['errors.txt','traceback.txt','log.txt'])if(await fs.stat(path.join(game,filename)).then(stat=>stat.isFile()).catch(()=>false))await fs.copyFile(path.join(game,filename),path.join(output,filename));
    preserved=true;
  }catch(error){failure??=error;report.status='failed';report.evidenceError=String(error);}
  try {
    if(!preserved)throw new Error('Evidence preservation failed; retained this run for review.');
    report.cleanup=await cleanVerificationDirectories(output,['game','saves','renpy-saves']);assert.deepEqual((report.cleanup as {errors:unknown[]}).errors,[]);
  }catch(error){failure??=error;report.status='failed';report.cleanupError=String(error);}
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(output);
}
if(failure)throw failure;
