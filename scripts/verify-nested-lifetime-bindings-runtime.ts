import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { projectSchema } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const root=path.resolve('.'),projectFile=path.resolve(process.argv[2]),output=path.join(root,'artifacts/nested-lifetime-bindings-runtime',new Date().toISOString().replaceAll(':','-'));
const project=projectSchema.parse(JSON.parse(await fs.readFile(projectFile,'utf8'))),graph=project.blueprints.find(g=>g.timeline&&g.timeline.clips.length===1);assert.ok(graph);
await fs.mkdir(output,{recursive:true});const game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');const built=await buildProject({project,projectDir:path.dirname(projectFile),outputDir:game,sdkRoot:sdk});assert.ok(built.ok,JSON.stringify(built.diagnostics));
await fs.writeFile(path.join(game,'game/testcases.rpy'),`
init 100 python:
    qa_objects = {}
    qa_original_show = vn_show_visual
    def qa_show(data):
        qa_objects[data["instanceId"]] = data
        qa_original_show(data)
    vn_show_visual = qa_show
label qa_nested_lifetime:
    scene
    call vn_blueprint_${graph.id}(vn_bp_launch_${graph.id}=True)
    "观察组合内部的图片区间。"
    return
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase nested_lifetime_bindings:
    click id "vn_main_start"
    run Jump("qa_nested_lifetime")
    pause until "观察组合内部的图片区间。"
    assert eval qa_objects["group"]["duration"] == 9.0
    assert eval qa_objects["group"]["children"][0]["assetId"] == "blue"
    assert eval qa_objects["group"]["children"][0]["startAt"] == 1.6875
    assert eval qa_objects["group"]["children"][0]["duration"] == 2.8125
    assert eval qa_objects["group"]["children"][0]["curves"]["x"][-1]["at"] == 2.8125
    assert eval abs(vn_visual_pose(qa_objects["group"]["children"][0], 0)["x"] - 0.2) < 0.000001
    assert eval abs(vn_visual_pose(qa_objects["group"]["children"][0], 1.40625)["x"] - 0.5) < 0.000001
    assert eval qa_objects["group"]["children"][1]["text"] == "保留的文字参数"
    assert eval qa_objects["group"]["children"][1]["duration"] == 9.0
    assert eval renpy.showing("vn_visual_group", layer="master")
    pause 0.2
    screenshot "before-child.png"
    pause 2.0
    screenshot "during-child.png"
    pause 3.0
    screenshot "after-child.png"
`);
const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:60000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);
assert.ok(result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log),result.log.slice(-3500));
const shots=path.join(game,'tests/screenshots');
const find=async(dir:string,name:string):Promise<string|undefined>=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){const found=await find(file,name);if(found)return found;}else if(entry.name===name)return file;}return;};
const counts:Record<string,number>={};
for(const name of ['before-child.png','during-child.png','after-child.png']){const file=await find(shots,name);assert.ok(file);const png=PNG.sync.read(await fs.readFile(file));let blue=0;for(let i=0;i<png.data.length;i+=4)if(png.data[i]<80&&png.data[i+1]<120&&png.data[i+2]>180)blue++;counts[name]=blue;await fs.copyFile(file,path.join(output,name));}
assert.equal(counts['before-child.png'],0);assert.ok(counts['during-child.png']>1000);assert.equal(counts['after-child.png'],0);
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',source:projectFile,assertions:10,bluePixels:counts,checks:['实际桌面保存工程导出播放','子对象素材、开始、时长及动画按输入解析','外层时长和兄弟文字保持正确','图片在内部区间开始后显示、结束后消失']},null,2));console.log(output);
