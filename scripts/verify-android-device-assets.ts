import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { loadProject } from '../src/desktop/project-store';
import { exportSettings } from '../src/core/export-settings';
import { androidAssets } from '../src/runtime/android-assets';
import { pythonLiteral } from '../src/runtime/literals';

const execute = promisify(execFile);
const root = 'E:/VNSAndroid-Vd9UcK', serial = 'emulator-5556';
const adb = path.join(root, 'profile/export-tools/android-sdk/platform-tools/adb.exe');
const projectFile = path.join(root, 'spine-project/project.vns.json');
const project = (await loadProject(projectFile, path.resolve('resources/templates/aihong'))).project, mapping = androidAssets(project);
const packageName = exportSettings(project).android.packageName;
assert.match(packageName, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
const stamp = Date.now(), output = path.join(root, `device-asset-audit-${stamp}`);
await fs.mkdir(output);
const run = (...args: string[]) => execute(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 60000, maxBuffer: 4_000_000 });
const digest = async (file: string) => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); };
const expected = [];
for (const file of mapping.files) expected.push({ ...file, sha256: await digest(path.join(path.dirname(projectFile), file.source)) });
const moduleName = `zz_vns_asset_audit_${stamp}`, resultName = `vns-asset-audit-${stamp}.json`;
const remote = `/data/user/0/${packageName}/files/game`, source = path.join(output, `${moduleName}.rpy`);
await fs.writeFile(source, `init 999 python:
    import hashlib
    import json
    import os
    vns_audit_results = []
    for item in ${pythonLiteral(expected)}:
        for name in set([item["source"], item["destination"]]):
            try:
                assert renpy.loadable(name), "not loadable"
                digest = hashlib.sha256()
                with renpy.file(name) as source:
                    for chunk in iter(lambda: source.read(1048576), b""):
                        digest.update(chunk)
                assert digest.hexdigest() == item["sha256"], "byte mismatch"
                vns_audit_results.append(dict(path=name, passed=True, sha256=digest.hexdigest()))
            except Exception as error:
                vns_audit_results.append(dict(path=name, passed=False, error=str(error)))
    with open(os.path.join(config.gamedir, ${pythonLiteral(resultName)}), "w", encoding="utf-8") as report:
        json.dump(vns_audit_results, report, ensure_ascii=False)
`);
await run('shell', 'am', 'force-stop', packageName);
try {
  await run('push', source, `${remote}/${moduleName}.rpy`);
  await run('shell', 'chmod', '644', `${remote}/${moduleName}.rpy`);
  await run('shell', 'am', 'start', '-n', `${packageName}/org.renpy.android.PythonSDLActivity`);
  let results: { path: string; passed: boolean; sha256?: string; error?: string }[] | undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { results = JSON.parse((await run('shell', 'cat', `${remote}/${resultName}`)).stdout); break; } catch { await new Promise(resolve => setTimeout(resolve, 2000)); }
  }
  assert.ok(results, 'Android did not write the asset audit result');
  const report = { status: results.every(item => item.passed) ? 'passed' : 'failed', serial, packageName, files: expected.length, lookups: results.length, aliases: Object.keys(mapping.aliases).length,
    method: 'Temporary diagnostic module reads every packaged resource and every original-path alias through the actual Android RenPy loader; SHA256 compared with source files. Module removed after audit.', results };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(results.filter(item => !item.passed), []);
  console.log(JSON.stringify({ status: report.status, files: report.files, lookups: report.lookups, aliases: report.aliases, output }));
} finally {
  await run('shell', 'am', 'force-stop', packageName);
  await run('shell', 'rm', '-f', `${remote}/${moduleName}.rpy`, `${remote}/${moduleName}.rpyc`, `${remote}/${resultName}`);
  await run('shell', 'am', 'start', '-n', `${packageName}/org.renpy.android.PythonSDLActivity`);
}
