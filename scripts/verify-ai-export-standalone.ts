import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve('.'),fixture=path.resolve(process.argv[2]),distribution=path.join(fixture,'distribution');
const archive=path.join(distribution,(await fs.readdir(distribution)).find(file=>file.endsWith('.zip'))!);
const before=createHash('sha256').update(await fs.readFile(archive)).digest('hex');
const destination=path.join(fixture,'standalone');await fs.mkdir(destination,{recursive:true});
execFileSync(path.join(root,'resources/runtime/lib/py3-windows-x86_64/python.exe'),['-c','import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,destination],{windowsHide:true});
const game=path.join(destination,(await fs.readdir(destination,{withFileTypes:true})).find(entry=>entry.isDirectory())!.name);
const executable=path.join(game,(await fs.readdir(game)).find(file=>file.endsWith('.exe')&&!file.includes('-32'))!);
const exportedAssets=await fs.readdir(path.join(game,'game','assets'));
const expected=await fs.readFile(path.join(fixture,'input-art.png'));
let picture:string|undefined;for(const name of exportedAssets){if((await fs.readFile(path.join(game,'game','assets',name))).equals(expected)){picture=name;break;}}assert.ok(picture,JSON.stringify(exportedAssets));
assert.deepEqual(await fs.readFile(path.join(game,'game','assets',picture)),await fs.readFile(path.join(fixture,'input-art.png')));
await fs.writeFile(path.join(game,'game','testcases.rpy'),`testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ preferences.text_cps = 0
    teardown:
        exit

testcase ai_export_standalone:
    assert screen "main_menu"
    assert eval config.screen_width == 1600
    assert eval renpy.loadable("assets/${picture}")
    click id "vn_main_start"
    pause until screen "say"
    run FileSave("ai_export", confirm=False, slot=True)
    assert eval renpy.can_load("ai_export")
    run FileLoad("ai_export", confirm=False, slot=True)
    assert screen "say"
`);
const result=await new Promise<{code:number;log:string}>((resolve,reject)=>{
 const env={...process.env,PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',SDL_VIDEO_WINDOW_POS:'2400,0'};
 for(const key of ['PYTHONHOME','PYTHONPATH','RENPY_BASE','ELECTRON_RUN_AS_NODE'])delete (env as any)[key];
 const child=spawn(executable,['--savedir',path.join(fixture,'standalone-saves'),game,'test','--report-detailed'],{cwd:game,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';const timer=setTimeout(()=>child.kill(),60000);child.stdout.on('data',data=>log+=data.toString());child.stderr.on('data',data=>log+=data.toString());child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve({code:code??1,log});});
});
await fs.writeFile(path.join(fixture,'standalone.log'),result.log);assert.equal(result.code,0,result.log.slice(-4500));assert.match(result.log,/Test cases\s*:\s*1\s*\|\s*1 passed/);
const after=createHash('sha256').update(await fs.readFile(archive)).digest('hex');assert.equal(after,before);
await fs.writeFile(path.join(fixture,'standalone-report.json'),JSON.stringify({status:'passed',archive,sha256:before,checks:['AI动作导出的Windows程序独立启动','修改后的1600宽度生效','导入图片字节一致且原生可加载','开始剧情并真实存取档','原始ZIP未被测试改写']}));console.log(fixture);
