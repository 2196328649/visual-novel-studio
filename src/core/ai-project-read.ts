import { aiSelectedContent, aiSelectedBlueprint, type BlueprintSelection } from './ai-selection';
import { validateProject } from './validate';
import { z } from 'zod';
import { projectSchema, type Project } from './model';
import { blueprintCatalog, blueprintNodeDefaults } from './blueprint';
import { editableProjectFields } from './ai-project-edit';

const field = z.enum(editableProjectFields);
const segment = z.union([z.string().min(1).max(200), z.number().int().nonnegative(), z.object({id:z.string().min(1).max(200)}).strict()]);
export const aiReadSchema = z.discriminatedUnion('kind', [
 z.object({kind:z.literal('selectedBlueprint'),elements:z.enum(['nodes','links']),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(30)}).strict(),
 z.object({kind:z.literal('selectedContent'),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(30),query:z.string().max(200).optional()}).strict(),
 z.object({kind:z.literal('diagnostics'),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(30),severity:z.enum(['error','warning']).optional()}).strict(),
 z.object({kind:z.literal('schema'),field}).strict(),
 z.object({kind:z.literal('blueprintNode'),type:z.enum(Object.keys(blueprintCatalog) as [keyof typeof blueprintCatalog,...(keyof typeof blueprintCatalog)[]])}).strict(),
 z.object({kind:z.literal('project'),path:z.array(segment).min(1).max(24),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(30),query:z.string().max(200).optional()}).strict(),
]);
export const aiReadResponseSchema=z.object({message:z.string().max(30000).optional(),operations:z.array(z.never()).max(0).optional(),read:z.array(aiReadSchema).min(1).max(4)}).strict();
export const aiReadGuide = `需要更完整的数据或真实字段时，先返回 {"read":[...],"operations":[]}，收到结果后再提出修改。可用读取：{"kind":"selectedBlueprint","elements":"nodes","offset":0,"limit":100} 分页读取本次请求开始时实际选中的蓝图节点；elements="links"读取实际选中的连线。返回graphId、total、items和nextOffset；节点与连线选择独立，不能擅自把连线端点视为选中节点。返回selectionUnavailable时有选择在暂存修改中失效，不要猜测替代对象。{"kind":"selectedContent","offset":0,"limit":100} 分页读取用户实际选中的资源和文件夹，可用 query 按 key/id/name 搜索；初始 selectedContent 只显示前100项，selectedContentTotal 是有效选择总数，selectedContentPartial 表示需要继续读取，不能将未显示的选择当成未选中。{"kind":"diagnostics","offset":0,"limit":30} 检查当前工程及暂存修改，返回错误／警告和节点、台词或界面控件定位；可用 severity 筛选 error 或 warning。非本次范围的台词问题会省略，省略数量不代表工程无错。{"kind":"schema","field":"ui"} 获取该工程字段的 JSON Schema；{"kind":"blueprintNode","type":"getVariable"} 获取该节点真实默认结构；{"kind":"project","path":["blueprints",{"id":"已有ID"}],"offset":0,"limit":30} 读取工程局部。path 和 editProject 相同，可继续深入属性；列表可用 query 按 id/name/text 检索，offset/limit 分页。长字符串正文按最多30000个 UTF-16 单元分页，offset 是正文偏移，沿用 nextOffset 继续读取；limit/query 仅用于列表。返回 total/nextOffset 时继续读取需要的页；过大对象会返回字段目录，须深入相应属性。最多12轮读取，不重复索取相同内容。读取不修改工程。未在首次上下文中显示不代表不存在。节点模板的 id 是占位值，创建时换成唯一合法ID，pins等字段保留真实结构。schema是字段约束，新增引用仍需检查工程中已有ID。nodes中的台词仅可读取本次允许范围。`;
const blocked = new Set(['__proto__','prototype','constructor']);
export function scrubAiProject(value: unknown): any {
 return JSON.parse(JSON.stringify(value, (key, item) => ['path','sourcePath','scriptText'].includes(key) ? undefined : item) ?? 'null');
}
export function readAiProject(project:Project, lineIds:string[], raw:unknown, selectedContentKeys:string[] = [], selectedBlueprint?: BlueprintSelection):unknown {
 const read=aiReadSchema.parse(raw);
 if(read.kind==='selectedBlueprint') {
  const selection = aiSelectedBlueprint(project, selectedBlueprint);
  const elements = read.elements === 'nodes' ? selection.nodes : selection.links;
  const items = elements.slice(read.offset, read.offset + read.limit).map(item => bounded(scrubAiProject(item), Math.floor(30000 / read.limit)));
  return { graphId: selection.graph?.id, selectionUnavailable: selection.unavailable, total: elements.length, offset: read.offset, nextOffset: read.offset + items.length < elements.length ? read.offset + items.length : undefined, items };
 }
 if(read.kind==='selectedContent') {
  const query=read.query?.toLocaleLowerCase();
  const matching=aiSelectedContent(project,selectedContentKeys).filter(item=>!query||[item.key,item.id,item.name].some(value=>value.toLocaleLowerCase().includes(query)));
  const items=matching.slice(read.offset,read.offset+read.limit);
  return {total:matching.length,offset:read.offset,nextOffset:read.offset+items.length<matching.length?read.offset+items.length:undefined,items};
 }
 if(read.kind==='diagnostics') {
  const allowed=new Set(lineIds),all=validateProject(project);
  const visible=all.filter(issue=>!issue.lineId||allowed.has(issue.lineId));
  const matching=visible.filter(issue=>!read.severity||issue.severity===read.severity);
  const items=matching.slice(read.offset,read.offset+read.limit).map(issue=>({...issue,message:issue.message.slice(0,1500),help:issue.help?.slice(0,1000)}));
  return {total:matching.length,offset:read.offset,nextOffset:read.offset+items.length<matching.length?read.offset+items.length:undefined,omittedLineDiagnostics:all.length-visible.length,items};
 }
 if(read.kind==='schema') return {field:read.field,schema:z.toJSONSchema(projectSchema.shape[read.field],{io:'input',unrepresentable:'any'})};
 if(read.kind==='blueprintNode') {const node=blueprintNodeDefaults(read.type);node.id='new_node';return {...blueprintCatalog[read.type],template:node};}
 if(!editableProjectFields.includes(read.path[0] as any)) throw new Error('不能读取此工程字段。');
 const allowed=new Set(lineIds);
 let value:any = read.path[0]==='nodes' ? {...project,nodes:project.nodes.map(node=>node.kind==='passage'?{...node,lines:node.lines.filter(line=>allowed.has(line.id))}:node)} : project;
 for(const part of read.path){
  if(typeof part==='string'&&(blocked.has(part)||['path','sourcePath','scriptText'].includes(part)))throw new Error('读取路径无效。');
  if(typeof part==='object'){
   if(!Array.isArray(value))throw new Error('ID定位只能用于列表。');
   const matches=value.filter(item=>item?.id===part.id);if(matches.length!==1)throw new Error('找不到唯一对象。');value=matches[0];
  } else {if(!value||typeof value!=='object'||!Object.hasOwn(value,part))throw new Error('读取路径不存在。');value=value[part];}
 }
 value=scrubAiProject(value);
 if(Array.isArray(value)){
  const query=read.query?.toLocaleLowerCase();
  const matches=query?value.filter(item=>[item?.id,item?.name,item?.text].some(text=>typeof text==='string'&&text.toLocaleLowerCase().includes(query))):value;
  const items=matches.slice(read.offset,read.offset+read.limit).map(item=>bounded(item, Math.floor(30000 / read.limit)));
  return {path:read.path,total:matches.length,offset:read.offset,nextOffset:read.offset+items.length<matches.length?read.offset+items.length:undefined,items};
 }
 if(typeof value==='string'&&(JSON.stringify(value).length>30000||read.offset>0)) {
  let end=Math.min(value.length,read.offset+30000);
  // Keep surrogate pairs together when the next page starts.
  if(end<value.length&&end>read.offset&&/[\uD800-\uDBFF]/.test(value[end-1])&&/[\uDC00-\uDFFF]/.test(value[end]))end--;
  return {path:read.path,value:value.slice(read.offset,end),total:value.length,offset:read.offset,nextOffset:end<value.length?end:undefined};
 }
 return {path:read.path,value:bounded(value)};
}
function bounded(value:any, budget=30000):any {
 if(JSON.stringify(value).length<=budget)return value;
 return {partial:true,id:value?.id,name:value?.name,fields:Object.entries(value).map(([name,item])=>({name,type:Array.isArray(item)?'array':typeof item,count:Array.isArray(item)?item.length:undefined})),hint:'对象过大，请继续读取具体属性。'};
}
