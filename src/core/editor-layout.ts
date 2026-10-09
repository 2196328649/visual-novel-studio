import { z } from 'zod';
const slot=z.enum(['left','top','bottom','right']);
const dock=z.object({workspace:z.enum(['ui','uiLogic','timeline']),reset:z.boolean().optional(),sizes:z.object({left:z.number().min(12).max(30).optional(),right:z.number().min(15).max(32).optional(),top:z.number().min(35).max(85).optional()}).strict().optional(),swap:z.tuple([slot,slot]).optional()}).strict();
const blueprint=z.object({workspace:z.literal('blueprint'),reset:z.boolean().optional(),sizes:z.object({palette:z.number().min(140).max(500).optional(),properties:z.number().min(180).max(600).optional()}).strict().optional(),swap:z.boolean().optional()}).strict();
export const editorLayoutSchema=z.union([dock,blueprint]).refine(v=>v.reset||v.sizes&&Object.keys(v.sizes).length>0||v.swap,'缺少布局调整内容。').refine(v=>!v.reset||!v.sizes&&!v.swap,'恢复默认布局不能同时指定调整。');
export type EditorLayoutAction=z.infer<typeof editorLayoutSchema>;
export const editorLayoutKeys={ui:'vns-ui-dock-v1',uiLogic:'vns-ui-logic-dock-v1',timeline:'vns-performance-dock-v1',blueprint:'vns-blueprint-panel-widths-v1'};
export const editorLayoutNames={ui:'界面',uiLogic:'高级界面',timeline:'时间轴',blueprint:'蓝图'};
export const editorLayoutEvent='vns-editor-layout-change';
const uiPanel=z.enum(['hierarchy','canvas','settings','inspector']);
const timelinePanel=z.enum(['library','preview','timeline','inspector']);
const dimensions=z.object({left:z.number().min(12).max(30),right:z.number().min(15).max(32),top:z.number().min(35).max(85)});
const panelMap=<T extends z.ZodType<string>>(panel:T)=>z.object({left:panel,top:panel,bottom:panel,right:panel}).strict().refine(p=>new Set(Object.values(p)).size===4);
export const editorLayoutStateSchema=z.object({
 ui:dimensions.extend({panels:panelMap(uiPanel)}).strict(),
 uiLogic:dimensions.extend({panels:panelMap(uiPanel)}).strict(),
 timeline:dimensions.extend({panels:panelMap(timelinePanel)}).strict(),
 blueprint:z.object({palette:z.number().min(140).max(500),properties:z.number().min(180).max(600),reversed:z.boolean()}).strict(),
}).strict();
export type EditorLayoutState=z.infer<typeof editorLayoutStateSchema>;
type LayoutReader=Pick<Storage,'getItem'>;
function storedLayout(storage:LayoutReader,key:string):unknown {try{return JSON.parse(storage.getItem(key)??'null');}catch{return null;}}
function dimension(value:unknown,fallback:number,min:number,max:number){return typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;}
export function readDockLayout<W extends 'ui'|'uiLogic'|'timeline'>(storage:LayoutReader,workspace:W):EditorLayoutState[W]{
 const defaults=workspace==='timeline'?{left:'library',top:'preview',bottom:'timeline',right:'inspector'}:{left:'hierarchy',top:'canvas',bottom:'settings',right:'inspector'};
 const raw=storedLayout(storage,editorLayoutKeys[workspace]);
 const stored=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 const candidate=editorLayoutStateSchema.shape[workspace].shape.panels.safeParse(stored.panels);
 return {left:dimension(stored.left,18,12,30),right:dimension(stored.right,24,15,32),top:dimension(stored.top,workspace==='timeline'?60:74,35,85),panels:candidate.success?candidate.data:defaults} as EditorLayoutState[W];
}
export function readBlueprintLayout(storage:LayoutReader):EditorLayoutState['blueprint']{
 const raw=storedLayout(storage,editorLayoutKeys.blueprint);
 const stored=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 let reversed=false;try{reversed=storage.getItem(editorLayoutKeys.blueprint+':reversed')==='true';}catch{}
 return {palette:dimension(stored.palette,194,140,500),properties:dimension(stored.properties,280,180,600),reversed};
}
/** Read only the four public layout preferences; never copy unrelated local storage. */
export function readEditorLayouts(storage:LayoutReader):EditorLayoutState{
 return {ui:readDockLayout(storage,'ui'),uiLogic:readDockLayout(storage,'uiLogic'),timeline:readDockLayout(storage,'timeline'),blueprint:readBlueprintLayout(storage)};
}
export function editorLayoutDescription(action:EditorLayoutAction){
 if(action.reset)return '恢复此工作区的默认尺寸和面板位置';
 const descriptions:string[]=[];
 if(action.workspace==='blueprint'){
  if(action.sizes?.palette!==undefined)descriptions.push(`节点库 ${action.sizes.palette} px`);
  if(action.sizes?.properties!==undefined)descriptions.push(`属性 ${action.sizes.properties} px`);
  if(action.swap)descriptions.push('交换左右侧栏');
 }else{
  const names={left:'左侧宽度',right:'右侧宽度',top:'中间上方高度'};
  for(const axis of ['left','right','top'] as const)if(action.sizes?.[axis]!==undefined)descriptions.push(`${names[axis]} ${action.sizes[axis]}%`);
  const slots={left:'左侧',right:'右侧',top:'中间上方',bottom:'中间下方'};
  if(action.swap)descriptions.push(`交换${slots[action.swap[0]]}与${slots[action.swap[1]]}`);
 }
 return descriptions.join('；');
}
export function editorLayoutLabel(action:EditorLayoutAction){return (action.reset?'恢复默认布局：':'调整布局：')+editorLayoutNames[action.workspace];}
export function updateEditorLayout(storage:Pick<Storage,'getItem'|'setItem'>,raw:EditorLayoutAction){
 const action=editorLayoutSchema.parse(raw),key=editorLayoutKeys[action.workspace];let stored:any;
 try{stored=JSON.parse(storage.getItem(key)??'null');}catch{}
 if(action.workspace==='blueprint'){
  const widths={palette:194,properties:280};
  if(!action.reset)for(const name of ['palette','properties'] as const){const value=stored?.[name];if(Number.isFinite(value))widths[name]=Math.max(name==='palette'?140:180,Math.min(name==='palette'?500:600,value));}
  Object.assign(widths,action.sizes);const reversed=action.reset?false:(storage.getItem(key+':reversed')==='true')!==!!action.swap;
  storage.setItem(key,JSON.stringify(widths));storage.setItem(key+':reversed',String(reversed));return key;
 }
 const defaults=action.workspace==='timeline'?{left:'library',top:'preview',bottom:'timeline',right:'inspector'}:{left:'hierarchy',top:'canvas',bottom:'settings',right:'inspector'};
 const layout={left:18,right:24,top:action.workspace==='timeline'?60:74,panels:{...defaults}};
 if(!action.reset&&stored){for(const axis of ['left','right','top'] as const){const value=stored[axis];if(Number.isFinite(value))layout[axis]=Math.max(axis==='left'?12:axis==='right'?15:35,Math.min(axis==='left'?30:axis==='right'?32:85,value));}
 const slots=['left','top','bottom','right'] as const;
 if(slots.every(slot=>Object.values(defaults).includes(stored.panels?.[slot]))&&new Set(slots.map(slot=>stored.panels[slot])).size===4)layout.panels=Object.fromEntries(slots.map(slot=>[slot,stored.panels[slot]])) as typeof layout.panels;
 }
 Object.assign(layout,action.sizes);if(action.swap){const [a,b]=action.swap;[layout.panels[a],layout.panels[b]]=[layout.panels[b],layout.panels[a]];}
 storage.setItem(key,JSON.stringify(layout));return key;
}
