import { app, net, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AiService } from '../../src/desktop/ai-service';

async function main() {
  const output=process.env.VNS_AI_DIAGNOSTICS!;
  app.setPath('userData',path.join(output,'profile'));await app.whenReady();
  const requests:unknown[]=[], report:Record<string,unknown>={};
  try {
    const service=new AiService({file:path.join(output,'profile','ai-settings.json'),vault:safeStorage,fetch:async(url,init)=>{
      const start=Date.now(), endpoint=new URL(url instanceof URL?url.toString():String(url));
      const response=await net.fetch(endpoint.href,init);
      const row={path:endpoint.pathname,status:response.status,elapsedMs:Date.now()-start,server:response.headers.get('server'),requestId:response.headers.get('x-request-id')??response.headers.get('x-oneapi-request-id'),ray:response.headers.get('cf-ray'),contentType:response.headers.get('content-type')};
      requests.push(row);console.log(JSON.stringify(row));return response;
    }});
    const view=await service.getConfig();if(!view.hasKey)throw new Error('Saved key is unavailable in isolated profile');
    const {hasKey:_key,keyStorage:_storage,...config}=view;
    Object.assign(report,{host:new URL(config.baseUrl).host,model:config.model,timeoutSeconds:config.timeoutSeconds,requests});
    console.log(JSON.stringify({host:report.host,model:config.model,timeout:config.timeoutSeconds}));
    try {const models=await service.listModels('connection_models',config);report.models={count:models.length,currentModelListed:models.includes(config.model)};console.log(JSON.stringify(report.models));}catch(error){report.modelsError=String(error);console.log(String(error));}
    report.testMode=process.env.VNS_AI_CHECK_STREAM==='1'?'stream':'non-stream';
    try {report.test=process.env.VNS_AI_CHECK_STREAM==='1'
      ? await service['complete']('connection_stream',[{role:'user',content:'请只回复：连接成功。'}],false,true)
      : await service.test('connection_test');console.log(JSON.stringify({test:report.test}));}catch(error){report.testError=String(error);console.log(String(error));}
  } catch(error) {report.error=String(error);process.exitCode=1;}
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));app.exit(Number(process.exitCode??0));
}
void main().catch(error=>{console.error(String(error));app.exit(1);});
