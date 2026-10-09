import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createProject,projectSchema } from '../src/core/model';
import { buildProject,runRenpy } from '../src/runtime/service';
import { pythonLiteral } from '../src/runtime/literals';

const root=path.resolve('.'),source=path.join(root,'resources/templates/aihong'),output=path.join(root,'artifacts/aihong-gallery-complete-runtime',new Date().toISOString().replaceAll(':','-')),fixture=path.join(output,'project'),game=path.join(output,'game'),sdk=path.join(root,'resources/runtime');
const template=projectSchema.parse(JSON.parse(await fs.readFile(path.join(source,'project.vns.json'),'utf8'))),project=createProject('完整模板图鉴原生验收');project.width=template.width;project.height=template.height;
project.variables=structuredClone(template.variables);project.parameterSets=structuredClone(template.parameterSets);
project.ui={...project.ui,fontAssetId:template.ui.fontAssetId,pages:{gallery:{layout:'custom'}},components:structuredClone(template.ui.components.filter(c=>c.page==='gallery'))};
for(const c of project.ui.components){delete c.events;delete c.visibleWhen;delete c.enabledWhen;delete c.selectedWhen;}
const gallery=project.ui.components.find(c=>c.id==='ai_gallery_items')!,groups=gallery.list!.galleryGroups!,references=new Set<string>();
const visit=(v:unknown)=>{if(typeof v==='string')references.add(v);else if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(project.ui);project.assets=template.assets.filter(a=>references.has(a.id));
await fs.mkdir(fixture,{recursive:true});for(const asset of project.assets){const destination=path.join(fixture,asset.path);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.link(path.join(source,asset.path),destination);}
await fs.writeFile(path.join(fixture,'project.vns.json'),JSON.stringify(projectSchema.parse(project)));const built=await buildProject({project,projectDir:fixture,outputDir:game,sdkRoot:sdk,development:true});assert.ok(built.ok,built.log);
const paths=new Map(project.assets.map(a=>[a.id,a.path]));const lines=[`init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 120.0
        $ _test.screenshot_directory = "tests/screenshots"
    teardown:
        exit
testcase complete_gallery:
    pause until eval renpy.get_screen("main_menu") is not None
    $ persistent.vn_unlocks = []
    run ShowMenu("gallery")
    assert eval not renpy.get_widget("gallery", "vn_gallery_${groups[0].id}").is_sensitive()
    $ persistent.vn_unlocks = ${pythonLiteral(groups.flatMap(g=>g.assetIds))}
${project.variables.filter(v=>v.persistent).map(v=>`    $ vn_parameter_set(${pythonLiteral(v.id)}, ${pythonLiteral(v.type==='number'?2:true)})`).join('\n')}
    $ renpy.restart_interaction()
    assert eval all(renpy.loadable(p) for p in ${pythonLiteral(groups.flatMap(g=>g.assetIds.map(id=>paths.get(id))))})
`];
for(let p=0;p<12;p++){
 const chunk=groups.slice(p*8,p*8+8);lines.push(`    click id "vn_component_ai_gallery_items_page_${p}"
    assert eval renpy.get_widget("gallery", "vn_component_ai_gallery_items_page_${p}").is_selected()
    move pos (8, 8)
    screenshot "page-${String(p+1).padStart(2,'0')}.png"
`);
 for(const group of chunk){
  lines.push(`    assert eval renpy.get_widget("gallery", "vn_gallery_${group.id}").is_sensitive()
    click id "vn_gallery_${group.id}"
    assert screen "vn_gallery_image"
    assert eval renpy.get_screen("vn_gallery_image").scope["paths"] == ${pythonLiteral(group.assetIds.map(id=>paths.get(id)))}
    assert eval renpy.get_screen("vn_gallery_image").scope["active_variant"] == 0
    keysym "K_ESCAPE"
    assert not screen "vn_gallery_image"
`);
 }
}
const last=groups.at(-1)!;lines.push(`    click id "vn_gallery_${last.id}"
`);for(let i=0;i<last.assetIds.length;i++)lines.push('    click id "vn_gallery_advance"\n');lines.push('    assert not screen "vn_gallery_image"\n    assert eval renpy.get_widget("gallery", "vn_component_ai_gallery_items_page_11").is_selected()\n');
await fs.writeFile(path.join(game,'game/testcases.rpy'),lines.join(''));const result=await runRenpy(sdk,game,['test','--report-detailed'],{savedir:path.join(output,'saves'),timeoutMs:180000,env:{SDL_VIDEO_WINDOW_POS:'2400,0'}});await fs.writeFile(path.join(output,'runtime.log'),result.log);
const passed=result.code===0&&/Test cases\s*:\s*1\s*\|\s*1 passed/.test(result.log);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:passed?'passed':'failed',groups:groups.length,variants:groups.reduce((n,g)=>n+g.assetIds.length,0),checks:['正式模板素材构建成功，381路径可加载','初始未解锁状态有效','12页截图与选中态','全部94组真实点击、完整分镜路径顺序、Esc返回','末组末张返回并保留第12页'],limitation:'原生未逐张截图全部381分镜；全部分镜实际解码由编译版桌面另行验证。默认素材候选不宣称原作版本已确认。'},null,2));console.log(output);assert.ok(passed,result.log.slice(-5000));
