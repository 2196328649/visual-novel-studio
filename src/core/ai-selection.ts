import { projectGraphs } from './project-resources';
import { declaredUiComponents, uiPageSchema, type Project } from './model';
import { uiPageNames } from './ui-names';
import { uiPageComponents } from './ui-logic';
import { projectContent } from './content-browser';
import { z } from 'zod';

const selectionId = z.string().min(1).max(200);
export const uiPageSelectionSchema = z.object({
 pageId: selectionId, uiInstanceId: selectionId.optional(), mode: z.enum(['design','events']),
}).strict().refine(value=>value.pageId.startsWith('ui:')?!!value.uiInstanceId:!value.uiInstanceId,'普通页面需要方案身份，自定义页面不使用方案身份。');
export type UiPageSelection = z.infer<typeof uiPageSelectionSchema>;

/** A blank page is still a concrete editing target; never infer it from the story or a called graph. */
export function aiSelectedUiPage(project:Project,selected?:UiPageSelection) {
 if(!selected)return;
 const standard=selected.pageId.startsWith('ui:'),page=uiPageSchema.options.find(p=>p!=='custom'&&'ui:'+p===selected.pageId);
 const custom=project.ui.customPages.filter(p=>p.id===selected.pageId),instances=project.ui.instances?.filter(i=>i.id===selected.uiInstanceId)??[];
 const valid=standard?!!page&&selected.uiInstanceId===(project.ui.activeInstanceId??'base')&&(selected.uiInstanceId==='base'||instances.length===1):custom.length===1&&!selected.uiInstanceId;
 return {...selected,name:valid?(standard?uiPageNames[page!]:custom[0].name):undefined,
  schemeName:valid&&standard?(selected.uiInstanceId==='base'?'默认界面':instances[0].name):undefined,
  settingsPath:valid?(standard?(selected.uiInstanceId==='base'?['ui','pages',page!]:['ui','instances',{id:selected.uiInstanceId},'pages',page!]):['ui','customPages',{id:selected.pageId}]):undefined,
  selectionUnavailable:!valid};
}

export function aiSelectedUiComponent(project:Project,id?:string,selected?:UiPageSelection) {
 if(!id)return;
 if(selected)return aiSelectedUiPage(project,selected)?.selectionUnavailable?undefined:uiPageComponents(project,selected.pageId).find(c=>c.id===id);
 return declaredUiComponents(project).find(c=>c.id===id);
}

export const blueprintSelectionSchema = z.object({
 graphId: selectionId, nodeId: selectionId.optional(), objectInstanceId: selectionId.optional(),
 nodeIds: z.array(selectionId).max(512).optional(), linkIds: z.array(selectionId).max(2048).optional(),
}).strict();
export type BlueprintSelection = z.infer<typeof blueprintSelectionSchema>;

export const uiAnimationSelectionSchema = z.object({
 animationId: selectionId, trackId: selectionId.optional(), keyId: selectionId.optional(),
}).strict().refine(value => !value.keyId || !!value.trackId, '关键帧选择需要所属轨道。');
export type UiAnimationSelection = z.infer<typeof uiAnimationSelectionSchema>;

/** Resolve exact identities; stale selections must never fall back to a namesake. */
export function aiSelectedUiAnimation(project: Project, selected?: UiAnimationSelection) {
 if (!selected) return;
 const animations = project.ui.animations?.filter(a => a.id === selected.animationId) ?? [], animation = animations.length === 1 ? animations[0] : undefined;
 const tracks = animation?.tracks.filter(t => t.id === selected.trackId) ?? [], track = tracks.length === 1 ? tracks[0] : undefined;
 const keys = track?.keys.filter(k => k.id === selected.keyId) ?? [], key = keys.length === 1 ? keys[0] : undefined;
 return { ...selected, name: animation?.name, pageId: animation?.pageId, uiInstanceId: animation?.uiInstanceId,
  duration: animation?.duration, componentId: track?.componentId, property: track?.property, key,
  selectionUnavailable: !animation || !!selected.trackId && !track || !!selected.keyId && !key };
}

/** Node selection and edge selection are independent; an edge does not select its endpoints. */
export function aiSelectedBlueprint(project: Project, selected?: BlueprintSelection) {
 const graph = projectGraphs(project).find(g => g.id === selected?.graphId);
 const nodeIds = new Set(selected?.nodeIds ?? (selected?.nodeId ? [selected.nodeId] : []));
 const linkIds = new Set(selected?.linkIds ?? []);
 const nodes = graph?.nodes.filter(n => nodeIds.has(n.id)) ?? [];
 const links = graph?.links.filter(l => linkIds.has(l.id)) ?? [];
 return { graph, nodes, links, unavailable: !!selected && !graph || nodes.length !== nodeIds.size || links.length !== linkIds.size };
}

/** Resolve host-provided selection against the current (possibly staged) project. */
export function aiSelectedContent(project: Project, selectedKeys: string[] = []) {
 const keys = new Set(selectedKeys);
 return [
  ...projectContent(project).map(({key,id,kind,name})=>({key,id,kind:kind as string,name})),
  ...(project.contentBrowser?.folders??[]).map(folder=>({key:'folder:'+folder.id,id:folder.id,kind:'folder',name:folder.name})),
 ].filter(item=>keys.has(item.key));
}
