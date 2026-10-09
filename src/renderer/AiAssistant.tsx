import { AiConversationSidebar } from './AiConversationSidebar';
import { AiAgentReview } from './AiAgentReview';
import { conversationContext, type SavedAiMessage } from '../core/ai-conversations';
import { useAiConversations } from './useAiConversations';
import { AiChatContent, AiUsageLabel } from './AiChatContent';
import { uiAnimationPropertyNames } from '../core/ui-animation';
import { aiSelectedUiPage, aiSelectedUiComponent, aiSelectedUiAnimation, aiSelectedBlueprint } from '../core/ai-selection';
import type { UiPageSelection, UiAnimationSelection, BlueprintSelection } from '../core/ai-selection';
import { readEditorLayouts, editorLayoutDescription, editorLayoutLabel, type EditorLayoutAction } from '../core/editor-layout';
import { aiEditorTargetLabel, type AiEditorTarget } from '../core/ai-editor-targets';
import { savedBlueprintAction } from '../core/blueprint-authoring';
import { visualInstancePath } from '../core/visual-selection';
import { parameterSets, parameterSetFor } from '../core/parameter-sets';
import { aiEditorCommandNames, type AiEditorCommand, type AiEditorResult } from '../core/ai-editor-commands';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Copy, Pencil, RotateCcw, Download, Trash2, Pin, FolderOpen, Paperclip, Send, Settings2, Sparkles, Square, Undo2, X } from 'lucide-react';
import type { StudioBridge } from '../core/bridge';
import { aiLines, prepareAiChanges, type AiChange, type AiConfigView } from '../core/ai';
import type { AiProgress, AiWorkflowProposal } from '../core/ai-workflow';
import { aiAttachmentDescription, aiAttachmentLimit, type AiAttachment } from '../core/ai-attachments';
import { effectiveCharacter, makeId, type Project } from '../core/model';
import { AiSettings, aiError } from './AiSettings';
import { IconButton } from './components';
import type { AssetUrl } from './StageEditor';
import './ai.css';

interface Result { changes: AiChange[]; selected: Set<number>; applied: boolean }
interface ConversationMessage extends SavedAiMessage { id: string; attachments?: AiAttachment[]; editorLayouts?:EditorLayoutAction[];layoutResults?:{layout:EditorLayoutAction;result:AiEditorResult}[];editorTargets?:AiEditorTarget[]; targetResults?:{target:AiEditorTarget;result:AiEditorResult}[]; editorCommands?:AiEditorCommand[]; commandStatus?:string; commandResults?:{command:AiEditorCommand;result:AiEditorResult}[]; result?: Result; workflow?: { proposal: AiWorkflowProposal; applied: boolean } }

function savedMessage(item: ConversationMessage): SavedAiMessage {
  const context = item.result || item.workflow || item.commandResults || item.targetResults || item.layoutResults
    ? JSON.stringify({message:item.content,suggestedOperations:item.result?.changes.map(change=>change.operation),applied:item.result?.applied,appliedOperations:item.result?.applied?item.result.changes.filter((_,i)=>item.result!.selected.has(i)).map(change=>change.operation):undefined,workflowApplied:item.workflow?.applied,workflowSummary:item.workflow?.proposal.summary,editorResults:item.commandResults,targetResults:item.targetResults,layoutResults:item.layoutResults}).slice(0,30000)
    : item.context;
  const proposalNote = item.result ? (item.result.applied ? `修改建议已应用（${item.result.selected.size} 项）。` : '历史修改建议未应用；请重新生成以核对当前工程。') : item.workflow ? (item.workflow.applied ? '创作方案已应用。' : '历史创作方案未应用；请重新生成以核对当前工程。') : item.proposalNote;
  return {id:item.id,role:item.role,content:item.content,createdAt:item.createdAt,model:item.model,mode:item.mode,status:item.status,pinned:item.pinned,usage:item.usage,context,proposalNote,attachmentPaths:item.attachmentPaths??item.attachments?.map(a=>a.path)};
}

export function AiAssistant({ selectedUiPage, selectedUiAnimation, selectedParameter, selectedContentKeys, selectedBlueprint, selectedUiComponentId, project, sceneId, lineId, bridge, assetUrl, onApply, onApplyWorkflow, onLayout, onNavigate, onCommand, onClose, onLocate, onUndo, canUndo, readOnlyMessage, standalone = false }: {
  selectedUiPage?: UiPageSelection; selectedUiAnimation?: UiAnimationSelection; selectedParameter?: {setId:string;variableId?:string}; selectedContentKeys?: string[]; selectedBlueprint?: BlueprintSelection; selectedUiComponentId?: string; project: Project; sceneId?: string; lineId?: string; bridge: StudioBridge; assetUrl: AssetUrl;
  onApply: (changes: AiChange[]) => void | Promise<void>; onClose: () => void | Promise<void>; onLocate: (lineId: string) => void | Promise<void>; onUndo: () => void | Promise<void>; canUndo: boolean; readOnlyMessage?: string; standalone?: boolean;
  onLayout?: (layout:EditorLayoutAction)=>void|AiEditorResult|Promise<void|AiEditorResult>;
  onNavigate?: (target:AiEditorTarget)=>void|AiEditorResult|Promise<void|AiEditorResult>;
  onCommand?: (command:AiEditorCommand)=>void|AiEditorResult|Promise<void|AiEditorResult>;
  onApplyWorkflow?: (proposal: AiWorkflowProposal) => void | Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null), log = useRef<HTMLDivElement>(null), request = useRef<string | undefined>(undefined);
  const [scope, setScope] = useState('scene');
  const conversations=useAiConversations<ConversationMessage>(project.id,bridge,savedMessage);
  const {history,setHistory,prompt,setPrompt}=conversations;
  const replyTarget=useRef<string | undefined>(undefined);
  const writeReply=(message:ConversationMessage,target?:string)=>setHistory(current=>target
    ? current.map(item=>item.id===target?{...message,id:target,pinned:item.pinned}:item)
    : current.some(item=>item.id===message.id)?current:[...current,message]);
  const promptRef = useRef(prompt); promptRef.current = prompt;
  const [notice,setNotice]=useState('');
  const [renaming,setRenaming]=useState(false),[titleDraft,setTitleDraft]=useState(''),[confirmDelete,setConfirmDelete]=useState(false);
  const [editingId,setEditingId]=useState<string>(),[streamText,setStreamText]=useState('');
  const streamRef=useRef(''),followBottom=useRef(true),sessionLock=useRef(false),closing=useRef(false);
  const [managing,setManaging]=useState(false);
  const sessionBusy=!conversations.ready||managing;
  const manage=async(action:()=>Promise<void>)=>{try{await action();setError('');}catch(error){setError(aiError(error));}};
  const switchConversation=async(action:()=>Promise<void>)=>{if(request.current||actionPending.current||sessionLock.current)return;sessionLock.current=true;setManaging(true);try{await action();++attachmentJob.current;attachmentBusy.current=false;setAttaching(false);setAttachments([]);setAllowExternalFiles(false);setEditingId(undefined);setRenaming(false);setConfirmDelete(false);setNotice('');setError('');setStreamText('');followBottom.current=true;}finally{sessionLock.current=false;setManaging(false);}};
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [attachments, setAttachments] = useState<AiAttachment[]>([]), [attaching, setAttaching] = useState(false), [dragging, setDragging] = useState(false), [allowExternalFiles, setAllowExternalFiles] = useState(false);
  const attachmentJob = useRef(0), attachmentBusy = useRef(false), dragDepth = useRef(0);
  const [progress, setProgress] = useState<AiProgress>();
  const [settings, setSettings] = useState(false), [config, setConfig] = useState<AiConfigView>();
  const [activeAction, setActiveAction] = useState<string>();
  const actionPending = useRef(false), currentProject = useRef(project.id);
  currentProject.current = project.id;
  const previousProject = useRef(project.id);
  useEffect(() => {
    let active = true, refreshId = 0;
    const previous = document.activeElement as HTMLElement | null;
    if (!standalone) dialog.current?.showModal();
    const refresh = () => {
      const id = ++refreshId;
      void bridge.getAiConfig?.().then(config => { if (active && id === refreshId) setConfig(config); }).catch(error => { if (active) setError(aiError(error)); });
    };
    refresh();
    const unsubscribe = bridge.onAiConfig?.(config => { ++refreshId; if (active) setConfig(config); });
    window.addEventListener('focus', refresh);
    return () => { active = false; unsubscribe?.(); window.removeEventListener('focus', refresh); const id = request.current; request.current = undefined; if (id) void bridge.cancelAi?.(id); if (!standalone) previous?.focus({ preventScroll: true }); };
  }, [bridge, standalone]);
  useEffect(() => { if (previousProject.current !== project.id) { const id = request.current; request.current = undefined; if (id) void bridge.cancelAi?.(id); ++attachmentJob.current; attachmentBusy.current = false; setAttaching(false); setAttachments([]); setAllowExternalFiles(false); setDragging(false); dragDepth.current = 0; setBusy(false); setError(''); previousProject.current = project.id; } }, [project.id, bridge]);
  useEffect(()=>bridge.onAiChunk?.(chunk=>{if(chunk.id===request.current){streamRef.current=chunk.text;setStreamText(chunk.text);}}),[bridge]);
  useEffect(() => bridge.onAiProgress?.(progress => { if (progress.id === request.current) setProgress(progress); }), [bridge]);
  // Selecting an older proposal should keep it in view instead of jumping to
  // the newest reply. Scroll when messages arrive or the conversation reopens.
  useEffect(() => { if (log.current && followBottom.current) log.current.scrollTop = log.current.scrollHeight; }, [history.length, busy, settings,streamText]);
  const lines = useMemo(() => aiLines(project).filter(({ node, line }) => scope === 'all' || (scope === 'line' ? line.id === lineId : node.sceneId === sceneId)), [project, scope, sceneId, lineId]);
  const currentLine = aiLines(project, lineId ? [lineId] : [])[0]?.line;
  const selectedCharacter = selectedContentKeys?.length === 1 && selectedContentKeys[0].startsWith('character:') ? project.characters.find(c=>c.id===selectedContentKeys[0].slice(10)) : undefined;
  const selectedSet = parameterSets(project).find(set=>set.id===selectedParameter?.setId);
  const selectedVariable = project.variables.find(v=>v.id===selectedParameter?.variableId && parameterSetFor(project,v).id===selectedSet?.id);
  const animationSelection = aiSelectedUiAnimation(project, selectedUiAnimation);
  const graphSelection = aiSelectedBlueprint(project, selectedBlueprint);
  const selectedGraph = graphSelection.graph;
  const selectedGraphNode = graphSelection.nodes.find(node => node.id === selectedBlueprint?.nodeId);
  const selectedAction = selectedGraphNode && savedBlueprintAction(selectedGraphNode);
  const selectedObjectPath = selectedAction?.kind === 'visual' && selectedBlueprint?.objectInstanceId ? visualInstancePath(selectedAction,selectedBlueprint.objectInstanceId) : undefined;
  let selectedVisual = selectedAction?.kind === 'visual' && selectedObjectPath ? selectedAction : undefined;
  for(const index of selectedObjectPath??[])selectedVisual=selectedVisual?.children?.[index];
  const uiPageSelection=aiSelectedUiPage(project,selectedUiPage);
  const selectedUiComponent = aiSelectedUiComponent(project,selectedUiComponentId,selectedUiPage);
  const currentScene = project.scenes.find(scene => scene.id === sceneId);
  const addAttachments = async (paths?: string[], mode: 'files' | 'directory' = 'files') => {
    if (busy || attachmentBusy.current || !bridge.inspectAiAttachments) return;
    const job = ++attachmentJob.current, projectId = project.id;
    attachmentBusy.current = true; setAttaching(true); setError('');
    try {
      const selected = paths ?? (await bridge.chooseAiAttachments?.(mode) ?? []).map(item => item.path);
      if (!selected.length || job !== attachmentJob.current || currentProject.current !== projectId) return;
      const combined = [...new Map([...attachments.map(item => item.path), ...selected].map(file => [file.toLowerCase(), file])).values()];
      if (combined.length > aiAttachmentLimit) throw new Error(`最多引用 ${aiAttachmentLimit} 份文件或目录，请先移除部分附件。`);
      const items = await bridge.inspectAiAttachments(combined);
      if (job === attachmentJob.current && currentProject.current === projectId) setAttachments(items);
    } catch (error) { if (job === attachmentJob.current && currentProject.current === projectId) setError(aiError(error)); }
    finally { if (job === attachmentJob.current) { attachmentBusy.current = false; setAttaching(false); } }
  };
  const fileDrag = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const dragHandlers = {
    onDragEnter: (event: DragEvent) => { if (fileDrag(event)) { event.preventDefault(); if (++dragDepth.current === 1) setDragging(true); } },
    onDragOver: (event: DragEvent) => { if (fileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = busy || attaching ? 'none' : 'copy'; } },
    onDragLeave: (event: DragEvent) => { if (fileDrag(event) && --dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } },
    onDrop: (event: DragEvent) => {
      if (!fileDrag(event)) return;
      event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDragging(false);
      if (busy || attaching) return;
      try {
        const paths = Array.from(event.dataTransfer.files, file => bridge.pathForFile?.(file) ?? '');
        if (!paths.length || paths.some(file => !file)) throw new Error('请从本机文件管理器拖入文件或文件夹。');
        void addAttachments(paths);
      } catch (error) { setError(aiError(error)); }
    },
  };
  const send = async (retry?: ConversationMessage, retryReplyId?: string) => {
    const editIndex=history.findIndex(item=>item.id===(retry?.id??editingId));
    const prefix=editIndex>=0?history.slice(0,editIndex):history;
    const question = (retry?.content??prompt).trim();
    if (!bridge.requestAi || !config?.model || busy || actionPending.current || request.current || attachmentBusy.current || !question || sessionBusy) return;
    if(retry && (!retryReplyId || !history.some(item=>item.id===retryReplyId&&item.role==='assistant') || editIndex<0))return;
    if(!retry&&prefix.length>1998){setError('此会话已达到 2000 条消息上限，请导出记录并新建会话。');return;}
    const id = makeId('ai'); request.current=id; setBusy(true);
    replyTarget.current=retry?retryReplyId:undefined;
    if(editIndex>=0&&!retry){try{await conversations.fork(prefix);}catch(error){request.current=undefined;setBusy(false);setError(aiError(error));return;}}
    if(request.current!==id)return;
    setEditingId(undefined);followBottom.current=true;streamRef.current='';setStreamText('');
    setError(''); setProgress(undefined); setBusy(true);
    const snapshot = structuredClone(project), ids = lines.map(({ line }) => line.id);
    request.current = id;
    let attachmentPaths=retry ? retry.attachmentPaths??retry.attachments?.map(item=>item.path)??[] : (editingId?history[editIndex]?.attachmentPaths:undefined)??attachments.map(item=>item.path);
    let selectedAttachments = retry?.attachments ?? (retry ? [] : attachments);
    if (allowExternalFiles && bridge.inspectMentionedAiAttachments && bridge.inspectAiAttachments) {
        const job = ++attachmentJob.current, projectId = project.id;
        attachmentBusy.current = true; setAttaching(true);
        try {
          const detected = await bridge.inspectMentionedAiAttachments({ prompt: question, allowExternalFiles });
          const combined = [...new Map([...attachmentPaths, ...detected.map(item => item.path)].map(file => [file.toLowerCase(), file])).values()];
          if (combined.length > aiAttachmentLimit) throw new Error(`最多引用 ${aiAttachmentLimit} 份文件或目录，请先移除部分附件。`);
          const items = await bridge.inspectAiAttachments(combined);
          if (request.current !== id || job !== attachmentJob.current || currentProject.current !== projectId) return;
          selectedAttachments = items; setAttachments(items); attachmentPaths = items.map(item => item.path);
        } catch (error) {
          if (request.current === id) { setError(aiError(error)); request.current=undefined; setBusy(false); }
          return;
        } finally {
          if (job === attachmentJob.current) { attachmentBusy.current = false; setAttaching(false); }
        }
    }
    if (!retry && promptRef.current.trim() === question) setPrompt('');
    const context = conversationContext(prefix.map(savedMessage)).history;
    if(!prefix.length&&!editingId&&!retry&&conversations.value?.title==='新会话')conversations.change({title:question.slice(0,48)});
    const requestMode=conversations.value?.mode??'edit';
    if(!retry)setHistory([...prefix, { id: id+'_user', role: 'user', content: question, createdAt:Date.now(),mode:requestMode,attachments:[...selectedAttachments],attachmentPaths }]);
    try {
      const editorLayoutState=(()=>{try{return readEditorLayouts(localStorage);}catch{return undefined;}})();
      const response = await bridge.requestAi({ mode:requestMode, selectedUiPage, selectedUiAnimation, editorLayoutState, selectedParameter, selectedContentKeys, selectedBlueprint, selectedUiComponentId, id, prompt: question, project: snapshot, lineIds: ids, history: context, readOnly: !!readOnlyMessage, allowExternalFiles, attachmentPaths });
      if (request.current !== id) return;
      const changes = prepareAiChanges(snapshot, response.operations, ids);
      writeReply({ id: `${id}_assistant`, role: 'assistant', content: response.message, createdAt:Date.now(),model:config.model,mode:requestMode,usage:response.usage, editorLayouts:response.editorLayouts,editorTargets:response.editorTargets, editorCommands:response.editorCommands, result: changes.length ? { changes, selected: new Set(changes.map((_, i) => i)), applied: false } : undefined, workflow: response.workflow ? { proposal: response.workflow, applied: false } : undefined },retryReplyId);
    } catch (error) { if (request.current === id) {
      const message=aiError(error),stopped=/已停止/.test(message);setError(message);
      writeReply({id:id+'_assistant',role:'assistant',content:streamRef.current || message,createdAt:Date.now(),model:config.model,mode:requestMode,status:stopped?'stopped':'failed'},retryReplyId);
    } }
    finally { if (request.current === id) { request.current = undefined; setBusy(false); setStreamText(''); } }
  };
  const updateResult = (id: string, result: Result) => setHistory(current => current.map(item => item.id === id ? { ...item, result } : item));
  const perform = async (id: string, action: () => void | Promise<void>, success?: () => void) => {
    if (actionPending.current) return;
    const projectId = project.id;
    if(request.current||sessionLock.current)return;
    actionPending.current = true; setActiveAction(id); setError('');
    try { await action(); if (currentProject.current === projectId) success?.(); }
    catch (error) { if (currentProject.current === projectId) setError(aiError(error)); }
    finally { actionPending.current = false; setActiveAction(undefined); }
  };
  const apply = (id: string, result: Result) => {
    if (readOnlyMessage || !result.selected.size || result.applied) return;
    void perform(id, () => onApply(result.changes.filter((_, i) => result.selected.has(i))), () => updateResult(id, { ...result, applied: true }));
  };
  const close = () => { void (async()=>{
    if(closing.current)return;
    if(actionPending.current||sessionLock.current){setError('请等待当前操作完成后关闭助手。');return;}
    closing.current=true;
    try {
      const id=request.current;
      if(id){request.current=undefined;await bridge.cancelAi?.(id);writeReply({id:id+'_assistant',role:'assistant',content:streamRef.current||'回复已停止。',createdAt:Date.now(),model:config?.model,mode:conversations.value?.mode,status:'stopped'},replyTarget.current);setBusy(false);setStreamText('');}
      await conversations.flush();await onClose();
    }catch(error){setError(aiError(error));}finally{closing.current=false;}
  })(); };
  useEffect(()=>bridge.onAiBeforeClose?.(close));
  const applyWorkflow = (item: ConversationMessage) => {
    if (!item.workflow || item.workflow.applied || !onApplyWorkflow || readOnlyMessage) return;
    void perform(item.id, () => onApplyWorkflow(item.workflow!.proposal), () => setHistory(current => current.map(message => message.id === item.id ? { ...message, workflow: { ...message.workflow!, applied: true } } : message)));
  };
  const changeLayout=(item:ConversationMessage,layout:EditorLayoutAction)=>{void perform(item.id,async()=>{
   let result:AiEditorResult;try{result=await onLayout!(layout)??{status:'pending',message:'尚未收到布局结果。'};}catch(error){result={status:'failed',message:aiError(error)};}
   if(currentProject.current!==project.id)return;
   setHistory(current=>current.map(message=>message.id===item.id?{...message,commandStatus:result.message,layoutResults:[...(message.layoutResults??[]),{layout,result}].slice(-10)}:message));
  });};
  const navigateTarget = (item:ConversationMessage,target:AiEditorTarget) => {
    void perform(item.id,async()=>{
      let result:AiEditorResult;
      try {result=await onNavigate!(target)??{status:'pending',message:'尚未收到定位结果。'};}catch(error){result={status:'failed',message:aiError(error)};}
      if(currentProject.current!==project.id)return;
      setHistory(current=>current.map(message=>message.id===item.id?{...message,commandStatus:result.message,targetResults:[...(message.targetResults??[]),{target,result}].slice(-10)}:message));
    });
  };
  const executeCommand = (item:ConversationMessage,command:AiEditorCommand) => {
    const action=async()=>{
      setHistory(current=>current.map(message=>message.id===item.id?{...message,commandStatus:aiEditorCommandNames[command]+' · 正在处理，请查看主编辑器中的进度或文件选择窗口。'}:message));
      let result:AiEditorResult;
      try { result=await onCommand!(command)??{status:'pending',message:'尚未收到主编辑器的完成结果。'}; }
      catch(error) {result={status:'failed',message:aiError(error).slice(0,6000)};}
      if(currentProject.current!==project.id)return;
      const labels={completed:'已完成',cancelled:'已取消',failed:'未完成',pending:'待确认'};
      setHistory(current=>current.map(message=>message.id===item.id?{...message,commandStatus:aiEditorCommandNames[command]+' · '+labels[result.status]+'：'+result.message,commandResults:[...(message.commandResults??[]),{command,result}].slice(-30)}:message));
    };
    if(command==='stopPreview')void action();else void perform(item.id+'_'+command,action);
  };
  const content = <>
    {dragging && <div className="ai-drop-overlay" role="status">{busy || attaching ? '请等待当前操作完成' : '松开以添加参考文件或目录'}</div>}
    <header><Sparkles size={18} /><strong>AI 助手</strong><div className="spacer" /><IconButton title="撤销工程修改" onClick={() => void perform('undo', onUndo)} disabled={!canUndo || !!activeAction}><Undo2 size={17} /></IconButton><IconButton title="AI 服务设置" onClick={() => setSettings(!settings)} disabled={busy || !!activeAction}><Settings2 size={17} /></IconButton><IconButton title="关闭 AI 助手" onClick={close}><X size={17} /></IconButton></header>
    <div className="ai-assistant-body">
      <AiConversationSidebar list={conversations.list} activeId={conversations.value?.id} projectName={project.name} busy={busy||!!activeAction||sessionBusy}
        onCreate={()=>void manage(()=>switchConversation(async()=>{await conversations.create();setSettings(false);}))}
        onSelect={id=>void manage(()=>switchConversation(async()=>{await conversations.select(id);setSettings(false);}))}/>
      <main className="ai-session-main" aria-label="当前会话">
    {settings ? <div className="ai-settings-page"><button className="text-button" onClick={() => setSettings(false)}><ArrowLeft size={14} />返回助手</button><AiSettings bridge={bridge} onSaved={setConfig} /></div> : <>
      <div className="ai-session-bar">
        {renaming?<form onSubmit={event=>{event.preventDefault();if(titleDraft.trim()){conversations.change({title:titleDraft.trim().slice(0,120)});setRenaming(false);}}}><input aria-label="会话名称" autoFocus value={titleDraft} maxLength={120} onChange={e=>setTitleDraft(e.target.value)}/><button type="submit">保存名称</button><button type="button" onClick={()=>setRenaming(false)}>取消</button></form>:<><strong>{conversations.value?.title??'正在读取会话…'}</strong><IconButton title="重命名会话" disabled={busy||sessionBusy} onClick={()=>{setTitleDraft(conversations.value?.title??'');setRenaming(true);}}><Pencil size={14}/></IconButton><IconButton title={conversations.value?.pinned?'取消置顶会话':'置顶会话'} disabled={busy||sessionBusy} onClick={()=>conversations.change({pinned:!conversations.value?.pinned})}><Pin size={14}/></IconButton><IconButton title="导出会话 Markdown" disabled={sessionBusy||!history.length} onClick={()=>void manage(async()=>{const value=conversations.packed();if(value&&await bridge.exportAiConversation?.(value))setNotice('聊天记录已导出。');})}><Download size={14}/></IconButton><IconButton title="删除当前会话" disabled={busy||!!activeAction||sessionBusy} onClick={()=>setConfirmDelete(true)}><Trash2 size={14}/></IconButton></>}
      </div>
      {confirmDelete&&<div className="ai-delete-confirm" role="alert"><span>删除当前会话及聊天记录？工程修改不会撤销。</span><button onClick={()=>void manage(async()=>{await switchConversation(conversations.remove);setConfirmDelete(false);})}>确认删除会话</button><button onClick={()=>setConfirmDelete(false)}>取消</button></div>}
      <div className="ai-workspace-context" aria-label="当前工程上下文"><strong title={project.name}>{project.name}</strong><span>{animationSelection ? `控件动画：${animationSelection.name ?? "已失效"}${animationSelection.trackId ? ` · 轨道：${animationSelection.property ? uiAnimationPropertyNames[animationSelection.property] : "已失效"}` : ""}${animationSelection.keyId ? ` · 关键帧：${animationSelection.key?.time ?? "已失效"} 秒` : ""}` : selectedSet ? `参数集：${selectedSet.name}${selectedVariable ? ` · 参数：${selectedVariable.name}` : ''}` : selectedCharacter ? `选中角色：${selectedCharacter.name}` : selectedContentKeys?.length ? `资源管理器选中 ${selectedContentKeys.length} 项` : selectedGraph ? `蓝图：${selectedGraph.name}${(graphSelection.nodes.length > 1 || graphSelection.links.length > 0) ? ` · 选中 ${graphSelection.nodes.length} 个节点 / ${graphSelection.links.length} 条连线` : selectedGraphNode ? ` · 节点：${selectedGraphNode.name}${selectedBlueprint?.objectInstanceId ? ` · 子对象：${selectedVisual?.name || '已失效'}` : ''}` : ''}` : selectedUiComponent ? `选中组件：${selectedUiComponent.name || selectedUiComponent.text || selectedUiComponent.id}` : uiPageSelection ? '未选择控件' : currentScene?.name ?? '未选择小章节'}</span>{uiPageSelection&&<span className="ai-ui-page-context" aria-label="当前界面页面">{uiPageSelection.selectionUnavailable?'界面选择已失效':`界面：${uiPageSelection.name}${uiPageSelection.schemeName?' · '+uiPageSelection.schemeName:' · 自定义页面'} · ${uiPageSelection.mode==='events'?'事件图':'设计'}`}</span>}<p className="ai-current-line" title={uiPageSelection?undefined:currentLine?.text}>{uiPageSelection?'请描述要修改的页面设置或控件行为。':currentLine ? `${effectiveCharacter(project, currentLine.speakerId ?? '')?.name ?? '旁白'}：${currentLine.text || '（空台词）'}` : '在主编辑器选择台词，这里会跟随更新。'}</p></div>
      <div className="ai-context-bar"><select aria-label="AI 对话模式" value={conversations.value?.mode??'edit'} disabled={busy||sessionBusy} onChange={e=>conversations.change({mode:e.target.value as 'chat'|'edit'})}><option value="chat">聊天</option><option value="edit">协助编辑</option></select><span>处理范围</span><select aria-label="AI 处理范围" value={scope} disabled={busy} onChange={event => setScope(event.target.value)}><option value="line" disabled={!lineId}>当前台词</option><option value="scene">当前小章节</option><option value="all">全部台词</option></select><small>{lines.length} 句</small></div>
      <div className="ai-conversation" ref={log} onScroll={event=>{const el=event.currentTarget;followBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<70;}} aria-live="polite">
        {!history.length && <div className="ai-welcome"><button onClick={() => setPrompt('如何把几条章节演出封装为有默认参数的蓝图？')}>如何封装章节演出？</button><button onClick={() => setPrompt('请为当前范围的每句角色台词添加显示立绘演出，并结合上下文选择已有表情。')}>配置这段角色演出</button><button onClick={() => setPrompt('导入游戏剧本 "C:\\剧本\\第一章.docx"，为每个角色台词添加显示立绘的演出，并结合上下文初选表情。')}>导入剧本并配置演出</button></div>}
        {history.map(item => <article key={item.id} className={`ai-message ${item.role}`}><header><strong>{item.role === 'user' ? '你' : 'AI'}</strong><time>{new Date(item.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>{item.model&&<small>{item.model}</small>}{item.status&&item.status!=='complete'&&<small>{item.status==='stopped'?'已停止':'回复未完成'}</small>}</header><AiChatContent text={item.content}/>{item.proposalNote&&<p className="muted">{item.proposalNote}</p>}{item.usage&&<AiUsageLabel usage={item.usage}/>}<div className="ai-message-actions"><button title="复制消息" onClick={()=>void navigator.clipboard.writeText(item.content).then(()=>setNotice('消息已复制。'),()=>setError('无法复制到剪贴板。'))}><Copy size={13}/>复制</button><button aria-pressed={!!item.pinned} onClick={()=>setHistory(current=>current.map(m=>m.id===item.id?{...m,pinned:!m.pinned}:m))}><Pin size={13}/>{item.pinned?'取消固定':'固定上下文'}</button>{item.role==='user'?<button disabled={busy||!!activeAction} onClick={()=>{setEditingId(item.id);setPrompt(item.content);}}><Pencil size={13}/>编辑后重发</button>:<button disabled={busy||!!activeAction} onClick={()=>{const previous=history.slice(0,history.findIndex(m=>m.id===item.id)).reverse().find(m=>m.role==='user');if(previous)void send(previous,item.id);}}><RotateCcw size={13}/>{item.status?'重试':'重新生成'}</button>}</div>{!item.attachments?.length&&!!item.attachmentPaths?.length&&<ul className="ai-message-attachments" aria-label="本条消息引用的附件">{item.attachmentPaths.map(file=><li key={file}><Paperclip size={12}/>{file}</li>)}</ul>}{item.attachments?.length ? <ul className="ai-message-attachments" aria-label="本条消息引用的附件">{item.attachments.map(file => <li key={file.path} title={file.path}><Paperclip size={12} />{file.name}</li>)}</ul> : null}{item.result && <AiProposal result={item.result} assetUrl={assetUrl} readOnly={!!readOnlyMessage} disabled={busy||!!activeAction||sessionBusy} applying={activeAction ===item.id} onChange={result => updateResult(item.id, result)} onApply={() => apply(item.id, item.result!)} onLocate={id => void perform(`locate_${id}`, () => onLocate(id))} />}{item.editorCommands?.length&&onCommand&&<div className="ai-editor-commands">{item.editorCommands.map(command=><button key={command} disabled={!!activeAction&&command!=='stopPreview'||!!item.result&&!item.result.applied||!!item.workflow&&!item.workflow.applied&&(item.workflow.proposal.kind!=='agent'||!!item.workflow.proposal.changedFields?.length)} onClick={()=>executeCommand(item,command)}>{aiEditorCommandNames[command]}</button>)}{item.commandStatus&&<p role="status">{item.commandStatus}</p>}</div>}{item.editorTargets?.length&&onNavigate&&<div className="ai-editor-commands">{item.editorTargets.map((target,index)=><button key={index} disabled={!!activeAction||!!item.result&&!item.result.applied||!!item.workflow&&!item.workflow.applied&&(item.workflow.proposal.kind!=='agent'||!!item.workflow.proposal.changedFields?.length)} onClick={()=>navigateTarget(item,target)}>{aiEditorTargetLabel(project,target)}</button>)}{!item.editorCommands?.length&&item.commandStatus&&<p role="status">{item.commandStatus}</p>}</div>}{item.editorLayouts?.length&&onLayout&&<div className="ai-editor-commands">{item.editorLayouts.map((layout,index)=><div className="ai-layout-proposal" key={index}><button disabled={!!activeAction||!!item.result&&!item.result.applied||!!item.workflow&&!item.workflow.applied&&(item.workflow.proposal.kind!=='agent'||!!item.workflow.proposal.changedFields?.length)} onClick={()=>changeLayout(item,layout)}>{editorLayoutLabel(layout)}</button><small>{editorLayoutDescription(layout)}</small></div>)}{!item.editorTargets?.length&&!item.editorCommands?.length&&item.commandStatus&&<p role="status">{item.commandStatus}</p>}</div>}{item.workflow && <AiWorkflowReview value={item.workflow} disabled={busy||sessionBusy||!!activeAction || !!readOnlyMessage || !onApplyWorkflow} onApply={() => applyWorkflow(item)} />}</article>)}
        {busy && streamText && <article className="ai-message assistant"><strong>AI</strong><AiChatContent text={streamText}/></article>}{busy && <div className="ai-progress" role="status"><p>{progress?.message ?? 'AI 正在生成回复…'}</p>{progress?.total ? <progress value={progress.completed ?? 0} max={progress.total} /> : null}</div>}
      </div>
      <div className="ai-compose">{conversations.error&&<p role="alert" className="ai-error">{conversations.error}</p>}{notice&&<p role="status">{notice}</p>}{editingId&&<div className="ai-edit-banner">从此消息创建分支，原会话保留。<button onClick={()=>{setEditingId(undefined);setPrompt('');}}>取消编辑</button></div>}{error && <p role="alert" className="ai-error">{error}</p>}{readOnlyMessage && <p className="ai-error">{readOnlyMessage}</p>}{lines.length > 100 && <p className="muted">已启用自动分批处理，可随时停止。</p>}
        {!bridge.requestAi && <p role="alert" className="ai-error">当前是浏览器编辑模式，AI 助手和模型列表需要桌面版。工程仍可继续在浏览器中编辑和保存。</p>}
        {bridge.requestAi && !config?.model && <p>先到<button className="text-button" onClick={() => setSettings(true)}>AI 服务设置</button>填写地址和模型。</p>}
        {bridge.inspectAiAttachments && <>
          <div className="ai-attachment-toolbar"><button type="button" disabled={busy || attaching} onClick={() => void addAttachments()}><Paperclip size={14} />添加文件</button><button type="button" disabled={busy || attaching} onClick={() => void addAttachments(undefined, 'directory')}><FolderOpen size={14} />引用目录</button><small>{attaching ? '正在检查附件…' : `${attachments.length}/${aiAttachmentLimit}`}</small></div>
          {!!attachments.length && <ul className="ai-attachments" aria-label="待发送的参考附件">{attachments.map(item => <li key={item.path}><div title={item.path}><strong>{item.name}</strong><small>{aiAttachmentDescription(item)}</small></div><IconButton title={`移除附件 ${item.name}`} disabled={busy || attaching} onClick={() => setAttachments(current => current.filter(file => file.path !== item.path))}><X size={14} /></IconButton></li>)}</ul>}
          <label className="ai-external-access"><input type="checkbox" aria-label="允许访问项目外文件" checked={allowExternalFiles} disabled={busy || attaching} onChange={event => setAllowExternalFiles(event.target.checked)} />允许访问项目外文件</label>
        </>}
        <textarea aria-label="发给 AI 的内容" disabled={sessionBusy} autoFocus value={prompt} maxLength={10000} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} placeholder="例如：用现有角色和素材做一个古风重逢短篇，安排场景、配乐、立绘和两个结局…" rows={3} />
        <div><small>{config?.model ? `模型：${config.model}` : ''}</small>{busy ? <button onClick={() => { if (request.current) void bridge.cancelAi?.(request.current); }}><Square size={14} />停止生成</button> : <button className="primary" disabled={!bridge.requestAi || !config?.model || !prompt.trim() || attaching || sessionBusy} onClick={() => void send()}><Send size={14} />发送</button>}</div>
      </div>
    </>}
      </main>
    </div>
  </>;
  return standalone ? <section {...dragHandlers} className="ai-assistant ai-assistant-window" aria-label="AI 助手">{content}</section> : createPortal(<dialog {...dragHandlers} ref={dialog} className="ai-assistant ai-assistant-dialog" aria-label="AI 助手" onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => { if (['F5', 'F6'].includes(event.key)) event.stopPropagation(); }}>{content}</dialog>, document.body);
}

function AiProposal({ result, assetUrl, readOnly, disabled, applying, onChange, onApply, onLocate }: {
  result: Result; assetUrl: AssetUrl; readOnly: boolean; disabled: boolean; applying: boolean; onChange: (result: Result) => void; onApply: () => void; onLocate: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  return <section className="ai-proposal" aria-label="AI 建议修改"><header><strong>{result.applied ? '已应用修改' : `待应用修改 · ${result.changes.length} 项`}</strong>{!result.applied && <label><input type="checkbox" aria-label="选择全部 AI 建议" disabled={disabled} checked={result.selected.size === result.changes.length} onChange={event => onChange({ ...result, selected: event.target.checked ? new Set(result.changes.map((_, i) => i)) : new Set() })} />全选</label>}</header>
    {result.changes.slice(page * 40, page * 40 + 40).map((change, offset) => { const i = page * 40 + offset; return <div className="ai-change" key={i}><label><input type="checkbox" aria-label={`应用建议 ${i + 1}`} checked={result.selected.has(i)} disabled={result.applied || disabled} onChange={event => { const selected = new Set(result.selected); if (event.target.checked) selected.add(i); else selected.delete(i); onChange({ ...result, selected }); }} /><span>{change.label}</span></label><div className="ai-change-detail">{change.assetId && <img src={assetUrl(change.assetId)} alt={`建议表情：${change.after}`} />}<div><small>原内容</small><pre>{change.before}</pre><small>建议</small><pre>{change.after}</pre></div>{change.lineId && <button type="button" className="text-button" disabled={disabled} onClick={() => onLocate(change.lineId!)}>定位台词</button>}</div></div>; })}
    {result.changes.length > 40 && <div className="ai-result-pages"><button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {Math.ceil(result.changes.length / 40)}</span><button disabled={(page + 1) * 40 >= result.changes.length} onClick={() => setPage(page + 1)}>下一页</button></div>}
    <footer>{result.applied ? <span><Check size={14} />本次建议已应用；撤销使用工程的修改历史。</span> : <button className="primary" disabled={!result.selected.size || readOnly || disabled} onClick={onApply}>{applying ? '正在应用…' : `应用选中的 ${result.selected.size} 项修改`}</button>}</footer>
  </section>;
}

function AiWorkflowReview({ value, disabled, onApply }: { value: { proposal: AiWorkflowProposal; applied: boolean }; disabled: boolean; onApply: () => void }) {
  const [page, setPage] = useState(0), proposal = value.proposal, summary = proposal.summary;
  const unchanged = proposal.kind === 'agent' && !proposal.changedFields?.length;
  const incomplete = proposal.tasks?.some(task => task.status === 'incomplete');
  return <section className="ai-proposal ai-workflow-proposal" aria-label="AI 创作方案">
    <header><strong>{value.applied ? '已应用创作方案' : '待应用创作方案'}</strong></header>
    <div className="ai-workflow-counts">{summary.scenes !== undefined && <span>场景 <b>{summary.scenes}</b></span>}{summary.choices !== undefined && <span>选择 <b>{summary.choices}</b></span>}{summary.endings !== undefined && <span>结局 <b>{summary.endings}</b></span>}{summary.portraitCharacters !== undefined && <span>立绘更新 <b>{summary.portraitCharacters} 个角色</b></span>}{summary.changedLines !== undefined && <span>台词修改 <b>{summary.changedLines} 句</b></span>}<span>角色演出 <b>{summary.portraitLines}</b></span><span>表情初选 <b>{summary.expressions}</b></span><span>配音 <b>{summary.voices}</b></span></div>
    <p className="muted">检查范围：{summary.lines} 句台词</p>
    {proposal.kind === 'agent' && <p className="muted">实际改动 {summary.changes ?? 0} 处 · 新增素材 {summary.importedAssets} 个 · 章节变动 {summary.chapters ?? 0} 个</p>}
    <AiAgentReview proposal={proposal} applied={value.applied} />
    {proposal.warnings.map((warning, index) => <p className="ai-workflow-warning" key={index}>{warning}</p>)}
    {!!proposal.details.length && <details><summary>查看 {proposal.details.length} 项剧情与演出安排</summary>{proposal.details.slice(page * 30, page * 30 + 30).map((detail, index) => <div className="ai-workflow-detail" key={page * 30 + index}><strong>{detail.speaker}</strong><p>{detail.text}</p><span>{detail.action}</span>{detail.reason && <small>{detail.reason}</small>}</div>)}{proposal.details.length > 30 && <div className="ai-result-pages"><button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {Math.ceil(proposal.details.length / 30)}</span><button disabled={(page + 1) * 30 >= proposal.details.length} onClick={() => setPage(page + 1)}>下一页</button></div>}</details>}
    <footer>{value.applied ? <span><Check size={14} />已写入工程，可从标题栏撤销。</span> : unchanged ? <span>没有实际修改，无需应用。</span> : <button className="primary" disabled={disabled} onClick={onApply}>{incomplete ? '应用已完成部分' : '应用创作方案'}</button>}</footer>
  </section>;
}
