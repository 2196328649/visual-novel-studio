import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';

const argument=(name:string)=>{const index=process.argv.indexOf(name);if(index<0)throw new Error('Missing '+name);return path.resolve(process.argv[index+1]);};
const output=path.resolve('artifacts/ai-agent-live',new Date().toISOString().replaceAll(':','-')), profile=path.join(output,'profile');
await fs.mkdir(profile,{recursive:true});
for(const name of ['ai-settings.json','Local State'])await fs.copyFile(path.join(process.env.APPDATA!,'visual-novel-studio',name),path.join(profile,name));
await fs.writeFile(path.join(output,'input.json'),JSON.stringify({project:argument('--project'),image:argument('--image'),folder:argument('--folder'),mixedOnly:process.argv.includes('--mixed-only'),originalOnly:process.argv.includes('--original-only'),conversation:process.argv.includes('--conversation')?argument('--conversation'):undefined,model:process.argv.includes('--model')?process.argv[process.argv.indexOf('--model')+1]:undefined}));
const bundle=path.join(output,'runner.cjs');
// Electron's main process runs the real desktop services without opening windows.
await build({entryPoints:['scripts/lib/ai-agent-live-runner.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:bundle});
const env:NodeJS.ProcessEnv={...process.env,VNS_AGENT_LIVE_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(createRequire(import.meta.url)('electron'),[bundle],{env,windowsHide:true,stdio:'inherit'});
const code=await new Promise<number>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
for(const name of ['ai-settings.json','Local State'])await fs.unlink(path.join(profile,name)).catch(()=>{});
console.log(output);process.exitCode=code;
