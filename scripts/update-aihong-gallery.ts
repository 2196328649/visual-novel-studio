import { promises as fs, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { projectSchema } from '../src/core/model';
import { validateProject } from '../src/core/validate';
import { applyTextScript,projectToText } from '../src/core/text-script';
import { aihongGalleryDefaults,populateAihongGallery,type GallerySourceManifest } from './lib/aihong-gallery';

const root=path.resolve('.'),source=path.join(root,'artifacts/aihong-gallery-source'),output=path.join(root,'artifacts/aihong-gallery-import',new Date().toISOString().replaceAll(':','-'));
const manifest:GallerySourceManifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));assert.equal(manifest.groupCount,94);assert.equal(manifest.variantCount,381);
await fs.mkdir(output,{recursive:true});const reports=[];
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
for(const [name,directory] of [['bundled','resources/templates/aihong'],['generated','artifacts/aihong-template']] as const){
 const destination=path.join(root,directory),file=path.join(destination,'project.vns.json'),before=await fs.readFile(file,'utf8'),project=projectSchema.parse(JSON.parse(before));assert.equal(project.id,'project_aihong_ui_template');
 await fs.writeFile(path.join(output,name+'-before.vns.json'),before);const preserved=JSON.stringify({nodes:project.nodes,scenes:project.scenes,blueprints:project.blueprints,scriptText:project.scriptText,characters:project.characters,variables:project.variables,components:project.ui.components.filter(c=>c.id!=='ai_gallery_items')});
 const result=populateAihongGallery(project,manifest),valid=projectSchema.parse(project);assert.deepEqual(validateProject(valid).filter(d=>d.severity==='error'),[]);
 assert.equal(JSON.stringify({nodes:valid.nodes,scenes:valid.scenes,blueprints:valid.blueprints,scriptText:valid.scriptText,characters:valid.characters,variables:valid.variables,components:valid.ui.components.filter(c=>c.id!=='ai_gallery_items')}),preserved);
 const text=projectToText(valid);assert.deepEqual(applyTextScript(valid,text).issues.filter(d=>d.severity==='error'),[]);valid.scriptText={format:'vns-text-1',content:text};
 const hashes:Record<string,string>={};
 for(const asset of result.assets){
  const from=path.resolve(source,asset.path),to=path.resolve(destination,asset.path);assert.ok(from.startsWith(source+path.sep)&&to.startsWith(destination+path.sep));
  const bytes=await fs.readFile(from);hashes[asset.id]=digest(bytes);let existing:Buffer|undefined;try{existing=await fs.readFile(to);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(existing)assert.equal(digest(existing),hashes[asset.id],'现有素材内容冲突：'+to);
  else {await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(from,to,constants.COPYFILE_EXCL);}
 }
 await fs.writeFile(file+'.gallery-tmp',JSON.stringify(valid,null,2)+'\n');await fs.rename(file+'.gallery-tmp',file);
 const reopened=projectSchema.parse(JSON.parse(await fs.readFile(file,'utf8'))),again=structuredClone(reopened);populateAihongGallery(again,manifest);assert.deepEqual(again,reopened);
 reports.push({name,file,groups:result.groups.length,variants:result.groups.reduce((n,g)=>n+g.assetIds.length,0),selectedAssets:result.selected,retainedAlternatives:result.alternatives,hashes});
}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({status:'passed',choices:aihongGalleryDefaults,choiceBasis:'模板按 ResourceManager 登记顺序选首候选；未声称原游戏实际使用版本已确认。',reports},null,2));console.log(output);
