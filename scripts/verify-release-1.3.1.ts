import assert from 'node:assert/strict';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve('.'), version = '1.3.1', release = path.join(root, 'release');
const json = async (file: string) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const digest = async (file: string) => { const hash = createHash('sha256'); for await (const data of createReadStream(file)) hash.update(data); return hash.digest('hex'); };
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
async function walk(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const item of await fs.readdir(path.join(directory, prefix), {withFileTypes:true})) {
    const relative = path.join(prefix, item.name);
    if (item.isDirectory()) result.push(...await walk(directory, relative)); else if (item.isFile()) result.push(relative);
  }
  return result;
}
assert.equal((await json('package.json')).version, version);
const installationFile = path.join(root, 'artifacts/installation-content-1.3.1-1790645478626.json');
const installation = await json(installationFile);
assert.equal(installation.passed, true); assert.deepEqual(installation.mismatches, []);
assert.equal(await digest(installation.installer), installation.installerSha256);
assert.equal(await digest(installation.projectFile), installation.before);
const packed = path.join(release, 'win-unpacked'), installed = installation.destination;
const binaries = {executable:await digest(path.join(packed, 'Visual Novel Studio.exe')), asar:await digest(path.join(packed, 'resources/app.asar'))};
assert.equal(binaries.asar, installation.asar);
for (const file of await walk(packed)) assert.equal(await digest(path.join(packed,file)), await digest(path.join(installed,file)), 'Installed mismatch: '+file);

const require = createRequire(import.meta.url), builderRequire = createRequire(require.resolve('electron-builder'));
const appRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = appRequire('@electron/asar') as {extractFile(file:string, member:string):Buffer};
const archive = path.join(packed,'resources/app.asar');
let codeFiles = 0, contentFiles = 0;
for (const folder of ['dist','dist-desktop']) for (const file of await walk(folder)) {
  const member = folder+'/'+file.replaceAll('\\','/');
  // asar traverses nested members using the host platform's path separator.
  assert.equal(sha(asar.extractFile(archive, path.join(folder, file))),await digest(path.join(root,member)),member); codeFiles++;
}
assert.equal(JSON.parse(asar.extractFile(archive,'package.json').toString()).version,version);
for (const folder of ['resources','docs']) for (const file of await walk(folder)) {
  const normal = file.replaceAll('\\','/');
  if(folder==='resources' && normal.startsWith('runtime/') && (normal.startsWith('runtime/tmp/') || /(?:^|\/)(?:__pycache__|cache|saves)\//.test(normal) || /(?:^|\/)(?:log|traceback|errors)\.txt$/.test(normal))) continue;
  assert.equal(await digest(path.join(root,folder,file)),await digest(path.join(packed,'resources',folder,file)),folder+'/'+file); contentFiles++;
}
assert.equal(await digest('README.md'),await digest(path.join(packed,'resources/README.md')));
const sdkFixtures: Record<string,string> = {
  'resources/runtime/gui/game/testcases.rpy':'ae5ed4a22924760bc0f34206aa5010caa13bc16868a70afdd61f7a782b32d357',
  'resources/runtime/launcher/game/testcases.rpy':'91c587a0d933ce8f50115950dbe733ebb6141946647815ff027239a7ca826e18',
  'resources/runtime/launcher/game/testcases.rpyc':'9b6f07138aac28e7c3e58155d9031d275d8ed17baece04d3d4a53822c08ca748',
};
for(const file of await walk(path.join(packed,'resources'))) if(/(?:^|[/\\])(?:token\.txt|ai-settings\.json|testcases\.rpyc?|\.env|saves)(?:$|[/\\])|\.autosave$/i.test(file)) {
  const known=sdkFixtures[file.replaceAll('\\','/')]; assert.ok(known,'Unexpected private/test file: '+file);
  assert.equal(await digest(path.join(packed,'resources',file)),known);
}
const equivalenceFile = path.join(root, 'artifacts/style-only-package-1.3.1.json'), equivalence = await json(equivalenceFile);
assert.equal(equivalence.status, 'passed'); assert.deepEqual(equivalence.currentBinaries, binaries);
assert.equal(await digest(equivalence.previousArchive), equivalence.previousBinaries.asar);
const evidence: Record<string,unknown> = {installation:installationFile, styleOnlyRebuild:equivalenceFile};
for (const relative of ['module-theme/2026-09-29T01-37-33.193Z','chapter-workspace/2026-09-29T01-37-51.182Z','ai-attachments/2026-09-28T22-14-00.232Z','export-setup/2026-09-28T22-55-23.709Z']) {
  const directory=path.join(root,'artifacts',relative), data=await json(path.join(directory,'report.json')), tested=await json(path.join(directory,'tested-app.json'));
  const reused = relative.startsWith('ai-attachments/') || relative.startsWith('export-setup/');
  assert.equal(data.status,'passed'); assert.equal(tested.packaged,true); assert.equal(tested.version,version); assert.deepEqual(tested.binaries,reused ? equivalence.previousBinaries : binaries);
  evidence[relative.split('/')[0]]={report:path.join(directory,'report.json'),testedApp:path.join(directory,'tested-app.json'),validation:reused ? 'Earlier installed build; identical executable code and runtime resources, see styleOnlyRebuild. The changed theme was retested on the final installer.' : 'Final installed binaries'};
}
const portableFile=path.join(root,'artifacts/portable-verification/2026-09-29T01-37-43.581Z/report.json');
const portable=await json(portableFile); assert.equal(portable.status,'passed');
assert.equal(await digest(portable.zip),portable.zipSha256); assert.equal(portable.portable.asar,binaries.asar); assert.equal(await digest(portable.game.zip),portable.game.sha256);
const manifestFile=path.join(root,'artifacts/portable-package/1.3.1-39342e96/manifest.json');
const manifest=await json(manifestFile);
for(const item of manifest.files) assert.equal(await digest(path.join(portable.portable.directory,item.path)),item.sha256,'Portable mismatch: '+item.path);
evidence.portable={report:portableFile,manifest:manifestFile,files:manifest.files.length};
const flowDirectory=path.join(root,'artifacts/game-flow/2026-09-28T21-49-41.177Z');
assert.equal((await json(path.join(flowDirectory,'report.json'))).status,'passed');
assert.match(await fs.readFile(path.join(flowDirectory,'run.log'),'utf8'),/Assertions\s*:\s*20\s*\|\s*20 passed/);
evidence.gameFlow={report:path.join(flowDirectory,'report.json'),assertions:20,screenshots:path.join(flowDirectory,'game/tests/screenshots')};
const tests=path.join(root,'artifacts/full-tests-1.3.1-font-final.log'), testLog=await fs.readFile(tests,'utf8');
assert.match(testLog,/tests 299/); assert.match(testLog,/pass 299/); assert.match(testLog,/fail 0/); evidence.unitTests={file:tests,passed:299};

const androidDirectory='E:/VNSAndroid-Vd9UcK/installed-final-6tqJUW';
const android=await json(path.join(androidDirectory,'report.json')), androidApp=await json(path.join(androidDirectory,'tested-app.json'));
assert.equal(android.status,'passed'); assert.deepEqual(androidApp.binaries,equivalence.previousBinaries);
for(const item of android.files) assert.equal(await digest(item.file),item.sha256);
const signature=await fs.readFile(path.join(androidDirectory,'signature.txt'),'utf8');
assert.match(signature,/Verified using v2 scheme.*true/); assert.match(signature,/8d927f58dbeeafe136e88334f8e98d8cadc6dfeefb2909c1ccea16c6df121be9/);
const assetsFile='E:/VNSAndroid-Vd9UcK/device-asset-audit-1790636166873/report.json', assets=await json(assetsFile);
assert.equal(assets.status,'passed'); assert.equal(assets.files,280); assert.equal(assets.lookups,380);
const device=await json(path.join(androidDirectory,'device-report.json')); assert.equal(device.status,'passed'); assert.equal(device.apkSha256,android.files[0].sha256);
const nativeLibraries=await json(path.join(androidDirectory,'apk-native-report.json'));
assert.equal(nativeLibraries.status,'passed'); assert.equal(nativeLibraries.libraries.length,3);
for(const library of nativeLibraries.libraries) {
  assert.equal(await digest(path.join(root,'resources/spine/android',library.abi,'libvns_spine.so')),library.sha256);
  assert.ok(library.loadAlignments.length); assert.ok(library.loadAlignments.every((value:number)=>value>=16384));
}
for(const [name,hash] of Object.entries(device.screenshots)) assert.equal(await digest(path.join(androidDirectory,name)),hash,'Android screenshot: '+name);
evidence.android={export:path.join(androidDirectory,'report.json'),assets:assetsFile,device:path.join(androidDirectory,'device-report.json'),signature:path.join(androidDirectory,'signature.txt'),nativeLibraries:path.join(androidDirectory,'apk-native-report.json'),validation:'APK built and device-tested before the final editor stylesheet correction. Export code and game resources are byte-identical; see styleOnlyRebuild.'};
const protectedFiles=await json(path.join(root,'artifacts/protected-files-1.3.1.json'));
for(const item of protectedFiles) assert.equal(await digest(item.path),item.sha256,'Protected file changed: '+item.path);
const previous=await json(path.join(release,'verification-1.3.0.json'));
for(const item of previous.files.filter((item:any)=>!item.file.startsWith('win-unpacked/'))) assert.equal(await digest(path.join(release,item.file)),item.sha256,'Previous release changed: '+item.file);
evidence.protectedFiles={baseline:path.join(root,'artifacts/protected-files-1.3.1.json'),checked:protectedFiles.length,unchanged:true};
evidence.previousRelease=path.join(release,'verification-1.3.0.json');
evidence.nativeDesktop=path.join(root,'artifacts/native-desktop-1.3.1.json');
const files=[];
for(const file of [installation.installer,portable.zip,...android.files.map((item:any)=>item.file)]) files.push({file,bytes:(await fs.stat(file)).size,sha256:await digest(file)});
const report={status:'passed_with_limits',version,generatedAt:new Date().toISOString(),binaries,codeFiles,contentFiles,evidence,files,
  checks:['安装器实际安装，安装文件与打包目录一致；便携包移位、重启与独立游戏三个结局通过。','最终安装版的亮白等主题、资源浏览器和5000句章节编辑、保存、重开通过。AI文件引用、导入撤销、一键配置和Windows/Android导出沿用相同代码的实测证据，见styleOnlyRebuild。','流程图取消已读标记，未见节点锁定；标题使用游戏内附燕书体，长标题适配；悬停与双向滚动实测通过。','APK签名、中文资源加载、标题动画、触控分支与存读档通过。','发行代码和资源与当前构建一致，用户工程与旧发行文件哈希保持不变。'],
  limits:['原游戏和独立游戏的Windows桌面捕获接口持续超时；本轮未完成该接口的外部键鼠及原游戏窗口目视核对。样式比对使用原游戏提取的界面数据、图片与字体；导出游戏使用引擎截图及Android截图验收。','Android实测设备为AEHD加速的Android35 x86_64模拟器；未做物理ARM设备实测或音频试听。内置读档确认提示仍为英文。','AI附件验收使用本机模拟服务；图片、音频仅引用名称与路径，不做视觉或语音识别；本轮未重复付费生成。','原游戏流程标题是预制图片，编辑器使用原游戏内附字体呈现可编辑名称；粒子随机细节不保证逐帧相同。','Windows安装器未进行代码签名。']};
await fs.writeFile(path.join(release,'verification-1.3.1.json'),JSON.stringify(report,null,2)+'\n');
await fs.writeFile(path.join(release,'SHA256SUMS-1.3.1.txt'),files.map(item=>item.sha256+'  '+item.file.replaceAll('\\','/')).join('\n')+'\n');
console.log(JSON.stringify({status:report.status,codeFiles,contentFiles,portableFiles:manifest.files.length,files,report:path.join(release,'verification-1.3.1.json')},null,2));
