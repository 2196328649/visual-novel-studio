import { app, net, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AiService } from '../../src/desktop/ai-service';
import { AiAuthoringService } from '../../src/desktop/ai-authoring';
import { aiLines } from '../../src/core/ai';
import { applyAiWorkflow } from '../../src/core/ai-workflow';
import { parseProject, assetSourcePath } from '../../src/desktop/project-store';
import { assetFiles } from '../../src/core/model';
import { currentTextProject } from '../../src/core/text-exchange';
import { conversationContext } from '../../src/core/ai-conversations';

async function main() {
const output=process.env.VNS_AGENT_LIVE_OUTPUT!;
app.setPath('userData',path.join(output,'profile'));
await app.whenReady();
const reports: unknown[]=[];
try {
  const input=JSON.parse(await fs.readFile(path.join(output,'input.json'),'utf8'));
  const bytes=await fs.readFile(input.project), raw=JSON.parse(bytes.toString()), project=currentTextProject(parseProject(raw.project??raw).project);
  for(const asset of project.assets) {
    asset.externalFiles=Object.fromEntries(assetFiles(asset).map(file=>[file,assetSourcePath(path.dirname(input.project),asset,file)]));
    asset.externalPath=asset.externalFiles[asset.path];
  }
  const attachments=path.join(output,'attachments');await fs.mkdir(attachments);
  const image=path.join(attachments,path.basename(input.image)), folder=path.join(attachments,path.basename(input.folder));
  await fs.copyFile(input.image,image);await fs.cp(input.folder,folder,{recursive:true});
  const hash=async(file:string)=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const images=[image,...(await fs.readdir(folder)).filter(name=>/\.png$/i.test(name)).map(name=>path.join(folder,name))];
  const hashes=await Promise.all(images.map(hash));
  let requests=0;
  const service=new AiService({file:path.join(output,'profile','ai-settings.json'),vault:safeStorage,fetch:(url,init)=>{requests++;return net.fetch(url instanceof URL?url.toString():url,init);}});
  let config=await service.getConfig();assert.ok(config.hasKey,'Cannot decrypt the saved configuration');
  if(input.model){const {hasKey,keyStorage,...settings}=config;config=await service.saveConfig({...settings,model:input.model});}
  console.log(JSON.stringify({model:config.model,hasKey:config.hasKey,output}));
  const prompts=input.mixedOnly?['方知宥换这张 PNG，琼华用文件夹里她的立绘；另外把作品宽度设为1600。保留台词、演出和原表情编号。']:['把剧本中的方知宥发立绘图片改为上传的这张，琼华使用上传文件夹中的琼华的立绘','方知宥换这张 PNG，琼华用文件夹里她的立绘；另外把作品宽度设为1600。保留台词、演出和原表情编号。'];
  if(input.originalOnly)prompts.splice(1);
  const history=input.conversation?conversationContext(JSON.parse(await fs.readFile(input.conversation,'utf8')).messages.slice(0,-2)).history:undefined;
  const agentStep=service.agentStep.bind(service);
  for(let index=0;index<prompts.length;index++) {
    const mixed=input.mixedOnly||index===1, directory=path.join(output,'case_'+index);await fs.mkdir(directory);
    const before=structuredClone(project), original=JSON.stringify(before), id='live_'+index;
    let tracedMessages=0, step=0;
    service.agentStep=async(requestId,messages)=>{
      const incoming=messages.slice(tracedMessages);tracedMessages=messages.length;
      // Diagnostic model/tool content only; never record HTTP headers or credentials.
      await fs.appendFile(path.join(directory,'trace.jsonl'),JSON.stringify({step:++step,messages:incoming})+'\n');
      const content=await agentStep(requestId,messages);
      await fs.appendFile(path.join(directory,'trace.jsonl'),JSON.stringify({step,response:content})+'\n');
      return content;
    };
    const author=new AiAuthoringService(service,{projectDirectory:()=>directory,progress:value=>console.log(JSON.stringify({case:index,progress:value.message}))});
    service.beginUsage(id);const start=Date.now(), initialRequests=requests;
    const response=await author.request({id,prompt:prompts[index],project:before,lineIds:aiLines(before).map(({line})=>line.id),attachmentPaths:[image,folder],history});
    const usage=service.takeUsage(id), proposal=response.workflow;
    const report:any={case:index,prompt:prompts[index],model:config.model,mixed,requests:requests-initialRequests,elapsedMs:Date.now()-start,usage,message:response.message,summary:proposal?.summary,tasks:proposal?.tasks,warnings:proposal?.warnings,status:'pending'};
    reports.push(report);await fs.writeFile(path.join(output,'report.json'),JSON.stringify(reports,null,2));
    assert.ok(proposal,'Model did not produce an agent proposal');
    assert.equal(JSON.stringify(before),original);assert.equal(proposal.summary.changedLines,0);assert.equal(proposal.summary.portraitCharacters,2);
    assert.ok(proposal.tasks?.length && proposal.tasks.every(task=>task.status==='complete'), 'Changed requirements must be complete, not unchanged or incomplete');
    const after=applyAiWorkflow(before,proposal);assert.deepEqual(aiLines(after),aiLines(before));assert.equal(after.scriptText?.content,before.scriptText?.content);
    for(const name of ['方知宥','琼华']) {
      const old=before.characters.find(character=>character.name===name)!, next=after.characters.find(character=>character.id===old.id)!;
      assert.equal(next.defaultExpressionId,old.defaultExpressionId);
      for(const expression of old.expressions)assert.ok(next.expressions.some(item=>item.id===expression.id&&item.assetId!==expression.assetId));
      for(const expression of next.expressions) {
        const asset=after.assets.find(asset=>asset.id===expression.assetId)!;const actual=await hash(assetSourcePath(directory,asset));
        assert.ok((name==='方知宥'?hashes.slice(0,1):hashes.slice(1)).includes(actual));
      }
    }
    assert.deepEqual(after.characters.filter(c=>!['方知宥','琼华'].includes(c.name)),before.characters.filter(c=>!['方知宥','琼华'].includes(c.name)));
    if(mixed)assert.equal(after.width,1600);
    await fs.writeFile(path.join(directory,'proposal.vns.json'),JSON.stringify(after));
    assert.deepEqual(await fs.readFile(input.project),bytes);assert.deepEqual(await Promise.all(images.map(hash)),hashes);
    report.status='passed';await fs.writeFile(path.join(output,'report.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(report));
  }
} catch(error) {
  const last=reports.at(-1) as any;if(last?.status==='pending'){last.status='failed';last.error=String(error);}else reports.push({status:'failed',error:String(error)});
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(reports,null,2));console.error(String(error));process.exitCode=1;
} finally { app.exit(Number(process.exitCode??0)); }
}
void main().catch(error=>{console.error(String(error));app.exit(1);});
