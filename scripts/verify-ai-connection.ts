import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';

const output=path.resolve('artifacts/ai-connection',new Date().toISOString().replaceAll(':','-')), profile=path.join(output,'profile');
await fs.mkdir(profile,{recursive:true});
try {
  for(const name of ['ai-settings.json','Local State'])await fs.copyFile(path.join(process.env.APPDATA!,'visual-novel-studio',name),path.join(profile,name));
  const bundle=path.join(output,'runner.cjs');
  await build({entryPoints:['scripts/lib/ai-connection-runner.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:bundle});
  const env:NodeJS.ProcessEnv={...process.env,VNS_AI_DIAGNOSTICS:output,VNS_AI_CHECK_STREAM:process.argv.includes('--stream-only')?'1':'0'};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(createRequire(import.meta.url)('electron'),[bundle],{env,windowsHide:true,stdio:'inherit'});
  process.exitCode=await new Promise<number>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
} finally {
  for(const name of ['ai-settings.json','Local State'])await fs.unlink(path.join(profile,name)).catch(()=>{});
  console.log(output);
}
