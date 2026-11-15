import { z } from 'zod';
const slot=z.enum(['left','top','bottom','right']);
const dock=z.object({workspace:z.enum(['ui','timeline']),reset:z.boolean().optional(),sizes:z.object({left:z.number().min(12).max(30).optional(),right:z.number().min(15).max(32).optional(),top:z.number().min(35).max(85).optional()}).strict().optional(),swap:z.tuple([slot,slot]).optional()}).strict();
const blueprint=z.object({workspace:z.literal('blueprint'),reset:z.boolean().optional(),sizes:z.object({palette:z.number().min(140).max(500).optional(),properties:z.number().min(180).max(600).optional()}).strict().optional(),swap:z.boolean().optional()}).strict();
export const uiEventLayoutBounds={sidebarMin:280,sidebarMax:560,directoryMin:16,directoryMax:70,canvasMin:320,divider:6,rail:36} as const;
const uiEventSizes=z.object({sidebarWidth:z.number().min(uiEventLayoutBounds.sidebarMin).max(uiEventLayoutBounds.sidebarMax),directoryRatio:z.number().min(uiEventLayoutBounds.directoryMin).max(uiEventLayoutBounds.directoryMax)}).strict();
const uiEvent=z.object({workspace:z.literal('uiLogic'),reset:z.boolean().optional(),sizes:uiEventSizes.partial().optional(),sidebarCollapsed:z.boolean().optional(),directoryCollapsed:z.boolean().optional()}).strict();
export const editorLayoutSchema=z.union([dock,blueprint,uiEvent])
 .refine(v=>v.reset||v.sizes&&Object.keys(v.sizes).length>0||(v.workspace==='uiLogic'?v.sidebarCollapsed!==undefined||v.directoryCollapsed!==undefined:v.swap),'缺少布局调整内容。')
 .refine(v=>!v.reset||!v.sizes&&(v.workspace==='uiLogic'?v.sidebarCollapsed===undefined&&v.directoryCollapsed===undefined:!v.swap),'恢复默认布局不能同时指定调整。');
export type EditorLayoutAction=z.infer<typeof editorLayoutSchema>;
export const editorLayoutKeys={ui:'vns-ui-dock-v1',uiLogic:'vns-ui-logic-dock-v1',timeline:'vns-performance-dock-v1',blueprint:'vns-blueprint-panel-widths-v1'};
export const editorLayoutNames={ui:'界面',uiLogic:'界面事件图',timeline:'时间轴',blueprint:'蓝图'};
export const editorLayoutEvent='vns-editor-layout-change';
const uiPanel=z.enum(['hierarchy','canvas','settings','inspector']);
const timelinePanel=z.enum(['library','preview','timeline','inspector']);
const dimensions=z.object({left:z.number().min(12).max(30),right:z.number().min(15).max(32),top:z.number().min(35).max(85)});
const panelMap=<T extends z.ZodType<string>>(panel:T)=>z.object({left:panel,top:panel,bottom:panel,right:panel}).strict().refine(p=>new Set(Object.values(p)).size===4);
export const editorLayoutStateSchema=z.object({
 ui:dimensions.extend({panels:panelMap(uiPanel)}).strict(),
 uiLogic:uiEventSizes.extend({sidebarCollapsed:z.boolean(),directoryCollapsed:z.boolean()}).strict(),
 timeline:dimensions.extend({panels:panelMap(timelinePanel)}).strict(),
 blueprint:z.object({palette:z.number().min(140).max(500),properties:z.number().min(180).max(600),reversed:z.boolean()}).strict(),
}).strict();
export type EditorLayoutState=z.infer<typeof editorLayoutStateSchema>;
type LayoutReader=Pick<Storage,'getItem'>;
type LayoutWriter=Pick<Storage,'setItem'>;
type DockWorkspace='ui'|'timeline';
const inspectorLayoutVersion=2;
const eventSidebarVersion=1;
function storedLayout(storage:LayoutReader,key:string):unknown {try{return JSON.parse(storage.getItem(key)??'null');}catch{return null;}}
function dimension(value:unknown,fallback:number,min:number,max:number){return typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;}
export function defaultDockLayout<W extends DockWorkspace>(workspace:W,defaultTop?:number):EditorLayoutState[W]{
 const panels=workspace==='timeline'?{left:'library',top:'preview',bottom:'timeline',right:'inspector'}:{left:'hierarchy',top:'canvas',bottom:'settings',right:'inspector'};
 return {left:18,right:24,top:dimension(defaultTop,workspace==='timeline'?60:74,35,85),panels} as EditorLayoutState[W];
}
export function defaultUiEventLayout():EditorLayoutState['uiLogic']{return {sidebarWidth:340,directoryRatio:32,sidebarCollapsed:false,directoryCollapsed:false};}
function defaultBlueprintLayout():EditorLayoutState['blueprint']{return {palette:194,properties:280,reversed:true};}
export function readDockLayout<W extends DockWorkspace>(storage:LayoutReader,workspace:W,defaultTop?:number):EditorLayoutState[W]{
 const defaults=defaultDockLayout(workspace,defaultTop);
 const raw=storedLayout(storage,editorLayoutKeys[workspace]);
 const stored=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 const candidate=editorLayoutStateSchema.shape[workspace].shape.panels.safeParse(stored.panels);
 return {left:dimension(stored.left,defaults.left,12,30),right:dimension(stored.right,defaults.right,15,32),top:dimension(stored.top,defaults.top,35,85),panels:candidate.success?{...candidate.data}:{...defaults.panels}} as EditorLayoutState[W];
}
/** Read without writing. Mounting the workspace or an explicit layout change persists the migration. */
export function readUiEventLayout(storage:LayoutReader):EditorLayoutState['uiLogic']{
 const defaults=defaultUiEventLayout(),raw=storedLayout(storage,editorLayoutKeys.uiLogic);
 const stored=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 if(stored.eventSidebarVersion===eventSidebarVersion)return {
  sidebarWidth:dimension(stored.sidebarWidth,defaults.sidebarWidth,uiEventLayoutBounds.sidebarMin,uiEventLayoutBounds.sidebarMax),
  directoryRatio:dimension(stored.directoryRatio,defaults.directoryRatio,uiEventLayoutBounds.directoryMin,uiEventLayoutBounds.directoryMax),
  sidebarCollapsed:typeof stored.sidebarCollapsed==='boolean'?stored.sidebarCollapsed:defaults.sidebarCollapsed,
  directoryCollapsed:typeof stored.directoryCollapsed==='boolean'?stored.directoryCollapsed:defaults.directoryCollapsed,
 };
 const candidate=panelMap(uiPanel).safeParse(stored.panels);
 if(!candidate.success)return defaults;
 // Old percentages have no saved viewport. Use one inspector (or directory)
 // width at a stable 1440px reference; never combine the former two sidebars.
 const side=(['inspector','hierarchy'] as const).flatMap(panel=>(['left','right'] as const).filter(key=>candidate.data[key]===panel))[0];
 if(!side||typeof stored[side]!=='number'||!Number.isFinite(stored[side]))return defaults;
 const percentage=dimension(stored[side],24,side==='left'?12:15,side==='left'?30:32);
 return {...defaults,sidebarWidth:dimension(Math.round(percentage*14.4),defaults.sidebarWidth,uiEventLayoutBounds.sidebarMin,uiEventLayoutBounds.sidebarMax)};
}
/** Preserve the preferred width when a smaller window temporarily constrains the sidebar. */
export function uiEventWorkspaceWidths(preferred:number,available:number){
 const width=Number.isFinite(available)?Math.max(0,available):0;
 const requested=dimension(preferred,340,uiEventLayoutBounds.sidebarMin,uiEventLayoutBounds.sidebarMax);
 const narrow=width<uiEventLayoutBounds.sidebarMin+uiEventLayoutBounds.divider+uiEventLayoutBounds.canvasMin;
 return {narrow,sidebarWidth:narrow?Math.min(requested,Math.max(0,width-uiEventLayoutBounds.rail)):Math.min(requested,width-uiEventLayoutBounds.divider-uiEventLayoutBounds.canvasMin),maxSidebarWidth:narrow?Math.min(uiEventLayoutBounds.sidebarMax,Math.max(0,width-uiEventLayoutBounds.rail)):Math.min(uiEventLayoutBounds.sidebarMax,width-uiEventLayoutBounds.divider-uiEventLayoutBounds.canvasMin)};
}
export function readBlueprintLayout(storage:LayoutReader):EditorLayoutState['blueprint']{
 const defaults=defaultBlueprintLayout();
 const raw=storedLayout(storage,editorLayoutKeys.blueprint);
 const stored=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 let reversed=defaults.reversed;
 if(stored.inspectorLayoutVersion===inspectorLayoutVersion)try{const value=storage.getItem(editorLayoutKeys.blueprint+':reversed');if(value==='true'||value==='false')reversed=value==='true';}catch{}
 return {palette:dimension(stored.palette,defaults.palette,140,500),properties:dimension(stored.properties,defaults.properties,180,600),reversed};
}
export function writeDockLayout<W extends DockWorkspace>(storage:LayoutWriter,workspace:W,layout:EditorLayoutState[W],storageKey=editorLayoutKeys[workspace]):string{
 const state=editorLayoutStateSchema.shape[workspace].parse(layout);
 storage.setItem(storageKey,JSON.stringify(state));
 return storageKey;
}
export function writeUiEventLayout(storage:LayoutWriter,layout:EditorLayoutState['uiLogic']):string{
 const state=editorLayoutStateSchema.shape.uiLogic.parse(layout),key=editorLayoutKeys.uiLogic;
 storage.setItem(key,JSON.stringify({...state,eventSidebarVersion}));return key;
}
/** Keep the original width key and separate direction preference. */
export function writeBlueprintLayout(storage:LayoutWriter,layout:EditorLayoutState['blueprint']):string{
 const {palette,properties,reversed}=editorLayoutStateSchema.shape.blueprint.parse(layout),key=editorLayoutKeys.blueprint;
 storage.setItem(key,JSON.stringify({palette,properties,inspectorLayoutVersion}));storage.setItem(key+':reversed',String(reversed));
 return key;
}
/** Read only the four public layout preferences; never copy unrelated local storage. */
export function readEditorLayouts(storage:LayoutReader):EditorLayoutState{
 return {ui:readDockLayout(storage,'ui'),uiLogic:readUiEventLayout(storage),timeline:readDockLayout(storage,'timeline'),blueprint:readBlueprintLayout(storage)};
}
export function editorLayoutDescription(action:EditorLayoutAction){
 if(action.reset)return action.workspace==='uiLogic'?'恢复事件图左栏宽度、目录高度和展开状态':'恢复此工作区的默认尺寸和面板位置';
 const descriptions:string[]=[];
 if(action.workspace==='blueprint'){
  if(action.sizes?.palette!==undefined)descriptions.push(`节点库 ${action.sizes.palette} px`);
  if(action.sizes?.properties!==undefined)descriptions.push(`属性 ${action.sizes.properties} px`);
  if(action.swap)descriptions.push('交换左右侧栏');
 }else if(action.workspace==='uiLogic'){
  if(action.sizes?.sidebarWidth!==undefined)descriptions.push(`左栏宽度 ${action.sizes.sidebarWidth} px`);
  if(action.sizes?.directoryRatio!==undefined)descriptions.push(`目录高度 ${action.sizes.directoryRatio}%`);
  if(action.sidebarCollapsed!==undefined)descriptions.push(action.sidebarCollapsed?'收起左栏':'展开左栏');
  if(action.directoryCollapsed!==undefined)descriptions.push(action.directoryCollapsed?'收起目录':'展开目录');
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
 const action=editorLayoutSchema.parse(raw);
 if(action.workspace==='blueprint'){
  const layout=action.reset?defaultBlueprintLayout():readBlueprintLayout(storage);
  Object.assign(layout,action.sizes);if(action.swap)layout.reversed=!layout.reversed;
  return writeBlueprintLayout(storage,layout);
 }
 if(action.workspace==='uiLogic'){
  const layout=action.reset?defaultUiEventLayout():readUiEventLayout(storage);
  Object.assign(layout,action.sizes);
  if(action.sidebarCollapsed!==undefined)layout.sidebarCollapsed=action.sidebarCollapsed;
  if(action.directoryCollapsed!==undefined)layout.directoryCollapsed=action.directoryCollapsed;
  return writeUiEventLayout(storage,layout);
 }
 const layout=action.reset?defaultDockLayout(action.workspace):readDockLayout(storage,action.workspace);
 Object.assign(layout,action.sizes);if(action.swap){const [a,b]=action.swap;[layout.panels[a],layout.panels[b]]=[layout.panels[b],layout.panels[a]];}
 return writeDockLayout(storage,action.workspace,layout);
}
