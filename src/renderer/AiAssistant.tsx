import { cloneData } from "../core/project-mutation";
import { AiConversationSidebar } from './AiConversationSidebar';
import { AiProposal, AiWorkflowReview, type AiProposalResult as Result } from './AiProposalReview';
import { AiPopover } from './AiPopover';
import { aiActivityFor } from './ai-activity';
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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Copy, Pencil, RotateCcw, Download, Trash2, Pin, FolderOpen, Paperclip, Send, Settings2, Sparkles, Square, Undo2, X, MoreHorizontal, PanelLeftClose, PanelLeftOpen, ChevronDown } from 'lucide-react';
import type { StudioBridge } from '../core/bridge';
import { aiLines, prepareAiChanges, type AiChange, type AiConfigView } from '../core/ai';
import type { AiProgress, AiWorkflowProposal } from '../core/ai-workflow';
import { aiAttachmentDescription, aiAttachmentLimit, type AiAttachment } from '../core/ai-attachments';
import { effectiveCharacter, makeId, type Project } from '../core/model';
import { AiSettings, aiError } from './AiSettings';
import { IconButton } from './components';
import type { AssetUrl } from './StageEditor';
import './ai.css';

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
  const activity = aiActivityFor(bridge);
  const activityBusy = useSyncExternalStore(activity.subscribe, activity.busy, activity.busy);
  const conversations=useAiConversations<ConversationMessage>(project.id,bridge,savedMessage);
  const {history,setHistory,prompt,setPrompt}=conversations;
  type ConversationSource = NonNullable<ReturnType<typeof conversations.capture>>;
  const activeRequest=useRef<{id:string;source:ConversationSource;target?:string;model?:string;mode:'chat'|'edit';started:boolean} | undefined>(undefined);
  const writeReply=(message:ConversationMessage,target?:string,source=conversations.capture())=>source?.setHistory(current=>target
    ? current.map(item=>item.id===target?{...message,id:target,pinned:item.pinned}:item)
    : current.some(item=>item.id===message.id)?current:[...current,message]);
  const [notice,setNotice]=useState('');
  const [renaming,setRenaming]=useState(false),[titleDraft,setTitleDraft]=useState(''),[confirmDelete,setConfirmDelete]=useState(false);
  const [editingId,setEditingId]=useState<string>(),[streamText,setStreamText]=useState('');
  const streamRef=useRef(''),followBottom=useRef(true),sessionLock=useRef(false),closing=useRef(false);
  const [managing,setManaging]=useState(false),[preparingClose,setPreparingClose]=useState(false);
  const [stopping, setStopping] = useState(false), stoppingJob = useRef<Promise<void> | undefined>(undefined);
  const [sidebarVisible, setSidebarVisible] = useState(() => window.innerWidth > 700);
  const closeRequest=useRef<string | undefined>(undefined),closeTimer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined),componentMounted=useRef(true);
  const sessionBusy=!conversations.ready||managing||preparingClose||stopping||activityBusy;
  const manage=async(action:()=>Promise<void>)=>{try{await action();setError('');}catch(error){setError(aiError(error));}};
  const switchConversation=async(action:()=>Promise<unknown>)=>{if(request.current||stoppingJob.current||activity.busy()||actionPending.current||stopPreviewPending.current||sessionLock.current||closing.current)return;sessionLock.current=true;setManaging(true);try{if(await action()===false)return;++attachmentJob.current;attachmentBusy.current=false;setAttaching(false);setAttachments([]);setAllowExternalFiles(false);setEditingId(undefined);setRenaming(false);setConfirmDelete(false);setNotice('');setError('');setStreamText('');followBottom.current=true;if(window.innerWidth<=700)setSidebarVisible(false);}finally{sessionLock.current=false;setManaging(false);}};
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [attachments, setAttachments] = useState<AiAttachment[]>([]), [attaching, setAttaching] = useState(false), [dragging, setDragging] = useState(false), [allowExternalFiles, setAllowExternalFiles] = useState(false);
  const attachmentJob = useRef(0), attachmentBusy = useRef(false), dragDepth = useRef(0);
  const [progress, setProgress] = useState<AiProgress>();
  const [settings, setSettings] = useState(false), [config, setConfig] = useState<AiConfigView>();
  const [activeAction, setActiveAction] = useState<string>();
  const actionPending = useRef(false), stopPreviewPending=useRef(false), currentProject = useRef(project.id);
  currentProject.current = project.id;
  const previousProject = useRef(project.id);
  const stopRequest = (updateUi = true): Promise<void> => {
    if (stoppingJob.current) return stoppingJob.current;
    const pending = activeRequest.current, id = request.current;
    request.current = undefined; activeRequest.current = undefined;
    ++attachmentJob.current; attachmentBusy.current = false;
    if (pending?.started) writeReply({id:pending.id+'_assistant',role:'assistant',content:streamRef.current||'回复已停止。',createdAt:Date.now(),model:pending.model,mode:pending.mode,status:'stopped'},pending.target,pending.source);
    streamRef.current = '';
    if (updateUi && componentMounted.current) { setBusy(false); setStreamText(''); setProgress(undefined); setAttaching(false); setStopping(!!id); }
    // Invalidate locally before cancellation: an attachment check or fork may
    // still be awaiting I/O and has not registered a backend request yet.
    // Keep the send gate closed until both backend cleanup and local persistence
    // settle. A failed flush must not release it before cancellation finishes.
    const settle = () => Promise.allSettled([
      Promise.resolve().then(() => id ? bridge.cancelAi?.(id) : undefined),
      Promise.resolve().then(() => pending?.source.flush()),
    ]).then(results => {
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
    });
    const completion = (id || pending ? activity.run(settle) : settle()).finally(() => {
      if (stoppingJob.current === completion) {
        stoppingJob.current = undefined;
        if (componentMounted.current) setStopping(false);
      }
    });
    stoppingJob.current = completion;
    return completion;
  };
  useEffect(() => {
    componentMounted.current = true;
    setStopping(!!stoppingJob.current);
    return () => { componentMounted.current = false; clearTimeout(closeTimer.current); void stopRequest(false).catch(() => {}); };
  }, [bridge, project.id]);
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
    return () => { active = false; unsubscribe?.(); window.removeEventListener('focus', refresh); if (!standalone) previous?.focus({ preventScroll: true }); };
  }, [bridge, standalone]);
  useEffect(() => { if (previousProject.current !== project.id) { ++attachmentJob.current; attachmentBusy.current = false; setAttaching(false); setAttachments([]); setAllowExternalFiles(false); setDragging(false); dragDepth.current = 0; setBusy(false); setStreamText(''); setProgress(undefined); setError(''); previousProject.current = project.id; } }, [project.id, bridge]);
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
    if (busy || request.current || stoppingJob.current || activity.busy() || closing.current || sessionLock.current || attachmentBusy.current || !bridge.inspectAiAttachments) return;
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
    if (!bridge.requestAi || !config?.model || config.loadIssue || busy || actionPending.current || stopPreviewPending.current || request.current || stoppingJob.current || activity.busy() || attachmentBusy.current || closing.current || sessionLock.current || !question || sessionBusy) return;
    if(retry && (!retryReplyId || !history.some(item=>item.id===retryReplyId&&item.role==='assistant') || editIndex<0))return;
    if(!retry&&prefix.length>1998){setError('此会话已达到 2000 条消息上限，请导出记录并新建会话。');return;}
    let source = conversations.capture();
    if (!source) return;
    const id = makeId('ai'), projectId = project.id;
    const active = () => request.current === id && componentMounted.current && currentProject.current === projectId;
    const ownsSession = () => active() && conversations.capture()?.get().id === source!.get().id;
    request.current=id; setBusy(true); streamRef.current=''; setStreamText(''); setError(''); setProgress(undefined);
    const pending={id,source,target:retry?retryReplyId:undefined,model:config.model,mode:source.get().mode,started:false};
    activeRequest.current=pending;
    if(editIndex>=0&&!retry){
      try{await conversations.fork(prefix,active);}
      catch(error){if(active()){request.current=undefined;activeRequest.current=undefined;setBusy(false);setError(aiError(error));}return;}
      if(!active())return;
      source=conversations.capture();
      if(!source||source.get().projectId!==projectId)return;
      pending.source=source;pending.mode=source.get().mode;
    }
    if(!ownsSession())return;
    setEditingId(undefined);followBottom.current=true;
    const snapshot = cloneData(project), ids = lines.map(({ line }) => line.id);
    let attachmentPaths=retry ? retry.attachmentPaths??retry.attachments?.map(item=>item.path)??[] : (editingId?history[editIndex]?.attachmentPaths:undefined)??attachments.map(item=>item.path);
    let selectedAttachments = retry?.attachments ?? (retry ? [] : attachments);
    if (allowExternalFiles && bridge.inspectMentionedAiAttachments && bridge.inspectAiAttachments) {
        const job = ++attachmentJob.current;
        attachmentBusy.current = true; setAttaching(true);
        try {
          const detected = await bridge.inspectMentionedAiAttachments({ prompt: question, allowExternalFiles });
          if (!ownsSession() || job !== attachmentJob.current) return;
          const combined = [...new Map([...attachmentPaths, ...detected.map(item => item.path)].map(file => [file.toLowerCase(), file])).values()];
          if (combined.length > aiAttachmentLimit) throw new Error(`最多引用 ${aiAttachmentLimit} 份文件或目录，请先移除部分附件。`);
          const items = await bridge.inspectAiAttachments(combined);
          if (!ownsSession() || job !== attachmentJob.current) return;
          selectedAttachments = items; setAttachments(items); attachmentPaths = items.map(item => item.path);
        } catch (error) {
          if (ownsSession()) { setError(aiError(error)); request.current=undefined; activeRequest.current=undefined; setBusy(false); }
          return;
        } finally {
          if (job === attachmentJob.current) { attachmentBusy.current = false; setAttaching(false); }
        }
    }
    if (!ownsSession()) return;
    if (!retry && source.get().draft.trim() === question) setPrompt('');
    const currentPrefix = editIndex >= 0 ? source.get().messages.slice(0,editIndex) : source.get().messages;
    const context = conversationContext(currentPrefix.map(savedMessage)).history;
    if(!currentPrefix.length&&!editingId&&!retry&&source.get().title==='新会话')conversations.change({title:question.slice(0,48)});
    const requestMode=source.get().mode;
    pending.mode=requestMode;
    if(!retry)source.setHistory(current=>[...(editIndex>=0?current.slice(0,editIndex):current), { id: id+'_user', role: 'user', content: question, createdAt:Date.now(),mode:requestMode,attachments:[...selectedAttachments],attachmentPaths }]);
    try {
      const editorLayoutState=(()=>{try{return readEditorLayouts(localStorage);}catch{return undefined;}})();
      pending.started=true;
      const response = await bridge.requestAi({ mode:requestMode, selectedUiPage, selectedUiAnimation, editorLayoutState, selectedParameter, selectedContentKeys, selectedBlueprint, selectedUiComponentId, id, prompt: question, project: snapshot, lineIds: ids, history: context, readOnly: !!readOnlyMessage, allowExternalFiles, attachmentPaths });
      if (!ownsSession()) return;
      const changes = prepareAiChanges(snapshot, response.operations, ids);
      writeReply({ id: `${id}_assistant`, role: 'assistant', content: response.message, createdAt:Date.now(),model:config.model,mode:requestMode,usage:response.usage, editorLayouts:response.editorLayouts,editorTargets:response.editorTargets, editorCommands:response.editorCommands, result: changes.length ? { changes, selected: new Set(changes.map((_, i) => i)), applied: false } : undefined, workflow: response.workflow ? { proposal: response.workflow, applied: false } : undefined },retryReplyId,source);
    } catch (error) { if (ownsSession()) {
      const message=aiError(error),stopped=/已停止/.test(message);setError(message);
      writeReply({id:id+'_assistant',role:'assistant',content:streamRef.current || message,createdAt:Date.now(),model:config.model,mode:requestMode,status:stopped?'stopped':'failed'},retryReplyId,source);
    } }
    finally { if (request.current === id) { request.current = undefined; activeRequest.current=undefined; streamRef.current=''; setBusy(false); setStreamText(''); } }
  };
  const updateResult = (id: string, result: Result) => setHistory(current => current.map(item => item.id === id ? { ...item, result } : item));
  const perform = async (id: string, action: () => void | Promise<void>, success?: () => void) => {
    if (actionPending.current) return;
    const projectId = project.id;
    if(request.current||stoppingJob.current||activity.busy()||stopPreviewPending.current||sessionLock.current||closing.current)return;
    actionPending.current = true; setActiveAction(id); setError('');
    try { await action(); if (currentProject.current === projectId) success?.(); }
    catch (error) { if (currentProject.current === projectId) setError(aiError(error)); }
    finally { actionPending.current = false; setActiveAction(undefined); }
  };
  const apply = (id: string, result: Result) => {
    if (readOnlyMessage || !result.selected.size || result.applied) return;
    void perform(id, () => onApply(result.changes.filter((_, i) => result.selected.has(i))), () => updateResult(id, { ...result, applied: true }));
  };
  const releaseClose = (id: string) => {
    if (closeRequest.current !== id) return;
    clearTimeout(closeTimer.current); closeRequest.current=undefined; closing.current=false;
    if (componentMounted.current) setPreparingClose(false);
  };
  const prepareClose = (requestId?: string) => { void (async()=>{
    if(closing.current||actionPending.current||stopPreviewPending.current||sessionLock.current){
      const message='请等待当前操作完成后关闭助手。';
      setError(message);
      if(requestId)await bridge.completeAiClose?.(requestId,message).catch(()=>{});
      return;
    }
    if(requestId&&!conversations.ready){
      const message='聊天记录仍在读取，请稍后再关闭编辑器。';setError(message);
      await bridge.completeAiClose?.(requestId,message).catch(()=>{});return;
    }
    const id=requestId??makeId('close'),source=conversations.capture();
    closing.current=true;closeRequest.current=id;setPreparingClose(true);
    if(!requestId)closeTimer.current=setTimeout(()=>{if(closeRequest.current===id){releaseClose(id);setError('聊天记录未能及时保存，窗口保持打开。请稍后重试。');}},30000);
    try {
      await stopRequest();
      await activity.stopAll();
      await source?.flush();
      if(closeRequest.current!==id||!componentMounted.current)return;
      if(source&&conversations.capture()?.get()!==source.get())throw new Error('会话已变化，请重新关闭助手。');
      if(requestId){
        const accepted=await bridge.completeAiClose?.(requestId);
        if(!accepted){releaseClose(id);return;}
        clearTimeout(closeTimer.current);
        // The editor still has work before its final close. Keep all inputs
        // frozen after acknowledging until it closes or explicitly cancels.
      }else{await onClose();releaseClose(id);}
    }catch(error){
      if(closeRequest.current===id){setError(aiError(error));releaseClose(id);}
      if(requestId)await bridge.completeAiClose?.(requestId,aiError(error).slice(0,6000)).catch(()=>{});
    }
  })(); };
  const close=()=>prepareClose();
  useEffect(()=>bridge.onAiBeforeClose?.(prepareClose));
  useEffect(()=>bridge.onAiCloseCancelled?.(releaseClose));
  useEffect(()=>{
    if(!standalone)return;
    void bridge.readyAiClose?.(project.id,true).catch(error=>{if(componentMounted.current)setError(aiError(error));});
    return()=>{void bridge.readyAiClose?.(project.id,false).catch(()=>{});};
  },[bridge,standalone,project.id]);
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
    const source=conversations.capture();
    if(!source)return;
    const action=async()=>{
      source.setHistory(current=>current.map(message=>message.id===item.id?{...message,commandStatus:aiEditorCommandNames[command]+' · 正在处理，请查看主编辑器中的进度或文件选择窗口。'}:message));
      let result:AiEditorResult;
      try { result=await onCommand!(command)??{status:'pending',message:'尚未收到主编辑器的完成结果。'}; }
      catch(error) {result={status:'failed',message:aiError(error).slice(0,6000)};}
      const labels={completed:'已完成',cancelled:'已取消',failed:'未完成',pending:'待确认'};
      source.setHistory(current=>current.map(message=>message.id===item.id?{...message,commandStatus:aiEditorCommandNames[command]+' · '+labels[result.status]+'：'+result.message,commandResults:[...(message.commandResults??[]),{command,result}].slice(-30)}:message));
      await source.flush();
    };
    if(closing.current||sessionLock.current)return;
    if(command==='stopPreview'){
      if(stopPreviewPending.current)return;
      stopPreviewPending.current=true;
      void action().catch(error=>{if(componentMounted.current&&currentProject.current===project.id)setError(aiError(error));}).finally(()=>{stopPreviewPending.current=false;});
    }else void perform(item.id+'_'+command,action);
  };
  const selectionLabel = animationSelection
    ? `控件动画：${animationSelection.name ?? '已失效'}${animationSelection.trackId ? ` · ${animationSelection.property ? uiAnimationPropertyNames[animationSelection.property] : '已失效轨道'}` : ''}${animationSelection.keyId ? ` · ${animationSelection.key?.time ?? '已失效'} 秒` : ''}`
    : selectedSet ? `参数集：${selectedSet.name}${selectedVariable ? ` · ${selectedVariable.name}` : ''}`
    : selectedCharacter ? `角色：${selectedCharacter.name}`
    : selectedContentKeys?.length ? `已选 ${selectedContentKeys.length} 项资源`
    : selectedGraph ? `蓝图：${selectedGraph.name}${graphSelection.nodes.length > 1 || graphSelection.links.length > 0 ? ` · ${graphSelection.nodes.length} 节点 / ${graphSelection.links.length} 连线` : selectedGraphNode ? ` · ${selectedGraphNode.name}${selectedBlueprint?.objectInstanceId ? ` · ${selectedVisual?.name || '已失效子对象'}` : ''}` : ''}`
    : selectedUiComponent ? `控件：${selectedUiComponent.name || selectedUiComponent.text || selectedUiComponent.id}`
    : uiPageSelection ? `界面：${uiPageSelection.name}` : currentScene?.name ?? '未选择小章节';
  const referenceIsObject = !!(animationSelection || selectedSet || selectedCharacter || selectedContentKeys?.length || selectedGraph || uiPageSelection || selectedUiComponent);
  const referenceDetails = <div className="ai-workspace-context" aria-label="当前工程上下文">
    <strong>{project.name}</strong><span>{selectionLabel}</span>
    {uiPageSelection && <span className="ai-ui-page-context" aria-label="当前界面页面">{uiPageSelection.selectionUnavailable ? '界面选择已失效' : `界面：${uiPageSelection.name}${uiPageSelection.schemeName ? ' · ' + uiPageSelection.schemeName : ' · 自定义页面'} · ${uiPageSelection.mode === 'events' ? '事件图' : '设计'}`}</span>}
    {!referenceIsObject && <p className="ai-current-line">{currentLine ? `${effectiveCharacter(project, currentLine.speakerId ?? '')?.name ?? '旁白'}：${currentLine.text || '（空台词）'}` : '在主编辑器中选择要讨论的内容。'}</p>}
    <label className="ai-scope-field"><span>台词范围</span><select aria-label="AI 处理范围" value={scope} disabled={busy || sessionBusy} onChange={event => setScope(event.target.value)}><option value="line" disabled={!lineId}>当前台词</option><option value="scene">当前小章节</option><option value="all">全部台词</option></select><small>{lines.length} 句</small></label>
    <small>跟随主编辑器的选择。台词范围限制对白修改，其他内容以请求和方案为准。</small>
  </div>;
  const content = <>
    {dragging && <div className="ai-drop-overlay" role="status">{busy || attaching ? '请等待当前操作完成' : '松开以添加参考文件或目录'}</div>}
    <header><IconButton title={sidebarVisible ? '收起会话列表' : '显示会话列表'} aria-expanded={sidebarVisible} onClick={() => setSidebarVisible(!sidebarVisible)}>{sidebarVisible ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</IconButton><Sparkles size={17} /><strong>AI 助手</strong><div className="spacer" /><IconButton title="撤销工程修改" onClick={() => void perform('undo', onUndo)} disabled={!canUndo || !!activeAction || busy || sessionBusy}><Undo2 size={17} /></IconButton><IconButton title="AI 服务设置" onClick={() => setSettings(!settings)} disabled={busy || !!activeAction || stopping}><Settings2 size={17} /></IconButton><IconButton title="关闭 AI 助手" onClick={close}><X size={17} /></IconButton></header>
    <div className="ai-assistant-body">
      {sidebarVisible && <AiConversationSidebar list={conversations.list} activeId={conversations.value?.id} projectName={project.name} busy={busy||!!activeAction||sessionBusy}
        onCreate={()=>void manage(()=>switchConversation(async()=>{await conversations.create();setSettings(false);}))}
        onSelect={id=>void manage(()=>switchConversation(async()=>{await conversations.select(id);setSettings(false);}))}/>}
      <main className="ai-session-main" aria-label="当前会话">
    {settings ? <div className="ai-settings-page"><button className="text-button" onClick={() => setSettings(false)}><ArrowLeft size={14} />返回助手</button><AiSettings bridge={bridge} onSaved={setConfig} /></div> : <>
      <div className="ai-session-bar">
        {renaming ? <form onSubmit={event => { event.preventDefault(); if (titleDraft.trim()) { conversations.change({ title: titleDraft.trim().slice(0, 120) }); setRenaming(false); } }}><input aria-label="会话名称" autoFocus value={titleDraft} maxLength={120} onChange={event => setTitleDraft(event.target.value)} /><button type="submit">保存名称</button><button type="button" onClick={() => setRenaming(false)}>取消</button></form>
          : <><strong title={conversations.value?.title}>{conversations.value?.pinned && <Pin size={12} aria-label="已置顶" />}{conversations.value?.title ?? '正在读取会话…'}</strong>
            <AiPopover label="会话操作" className="icon-button" trigger={<MoreHorizontal size={17} />} disabled={busy || !!activeAction || sessionBusy}>
              <button type="button" data-ai-close-popover onClick={() => { setTitleDraft(conversations.value?.title ?? ''); setRenaming(true); }}><Pencil size={14} />重命名会话</button>
              <button type="button" data-ai-close-popover onClick={() => conversations.change({ pinned: !conversations.value?.pinned })}><Pin size={14} />{conversations.value?.pinned ? '取消置顶会话' : '置顶会话'}</button>
              <button type="button" data-ai-close-popover disabled={!history.length} onClick={() => void manage(async () => { const value = conversations.packed(); if (value && await bridge.exportAiConversation?.(value)) setNotice('聊天记录已导出。'); })}><Download size={14} />导出会话 Markdown</button>
              <button type="button" data-ai-close-popover onClick={() => setConfirmDelete(true)}><Trash2 size={14} />删除当前会话</button>
            </AiPopover>
          </>}
      </div>
      {confirmDelete&&<div className="ai-delete-confirm" role="alert"><span>删除当前会话及聊天记录？工程修改不会撤销。</span><button onClick={()=>void manage(async()=>{await switchConversation(conversations.remove);setConfirmDelete(false);})}>确认删除会话</button><button onClick={()=>setConfirmDelete(false)}>取消</button></div>}
      <div className="ai-reference-bar"><AiPopover label="参考信息" trigger={<><span className="ai-reference-caption">参考</span><span className="ai-reference-selection">{selectionLabel}</span><ChevronDown size={13} /></>}>{referenceDetails}</AiPopover><span className="ai-scope-summary">{scope === 'all' ? '全部台词' : scope === 'line' ? '当前台词' : '当前小章节'} · {lines.length} 句</span></div>
      <div className="ai-conversation" ref={log} onScroll={event=>{const el=event.currentTarget;followBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<70;}} aria-live="polite">
        {!history.length && <div className="ai-welcome"><strong>从当前内容开始</strong><p>讨论剧情，或让助手准备可审阅的修改。</p><div><button onClick={() => setPrompt('请检查当前内容，指出需要改进的地方，先给出建议。')}>检查当前内容</button><button onClick={() => setPrompt('请为当前范围的角色台词配置显示立绘演出，并结合上下文选择已有表情。')}>配置角色演出</button><button onClick={() => setPrompt('如何把几条演出封装成可复用的蓝图？')}>了解编辑器用法</button></div></div>}
        {history.map(item => <article key={item.id} className={`ai-message ${item.role}`}><header><strong>{item.role === 'user' ? '你' : 'AI'}</strong><time>{new Date(item.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>{item.model&&<small>{item.model}</small>}{item.pinned&&<Pin size={12} aria-label="已固定上下文" />}{item.status&&item.status!=='complete'&&<small>{item.status==='stopped'?'已停止':'回复未完成'}</small>}</header><AiChatContent text={item.content}/>{item.proposalNote&&<p className="muted">{item.proposalNote}</p>}{item.usage&&<AiUsageLabel usage={item.usage}/>}<div className="ai-message-actions"><button title="复制消息" onClick={()=>void navigator.clipboard.writeText(item.content).then(()=>setNotice('消息已复制。'),()=>setError('无法复制到剪贴板。'))}><Copy size={13}/>复制</button><AiPopover label="消息操作" className="icon-button" active={!!item.pinned} trigger={<MoreHorizontal size={14} />} disabled={sessionBusy}><button type="button" data-ai-close-popover aria-pressed={!!item.pinned} onClick={() => setHistory(current => current.map(message => message.id === item.id ? { ...message, pinned: !message.pinned } : message))}><Pin size={13} />{item.pinned ? '取消固定' : '固定上下文'}</button></AiPopover>{item.role==='user'?<button disabled={busy||sessionBusy||!!activeAction} onClick={()=>{setEditingId(item.id);setPrompt(item.content);}}><Pencil size={13}/>编辑后重发</button>:<button disabled={busy||sessionBusy||!!activeAction} onClick={()=>{const previous=history.slice(0,history.findIndex(m=>m.id===item.id)).reverse().find(m=>m.role==='user');if(previous)void send(previous,item.id);}}><RotateCcw size={13}/>{item.status==='failed'||item.status==='stopped'?'重试':'重新生成'}</button>}</div>{!item.attachments?.length&&!!item.attachmentPaths?.length&&<ul className="ai-message-attachments" aria-label="本条消息引用的附件">{item.attachmentPaths.map(file=><li key={file}><Paperclip size={12}/>{file}</li>)}</ul>}{item.attachments?.length ? <ul className="ai-message-attachments" aria-label="本条消息引用的附件">{item.attachments.map(file => <li key={file.path} title={file.path}><Paperclip size={12} />{file.name}</li>)}</ul> : null}{item.result && <AiProposal result={item.result} assetUrl={assetUrl} readOnly={!!readOnlyMessage} disabled={busy||!!activeAction||sessionBusy} applying={activeAction ===item.id} onChange={result => updateResult(item.id, result)} onApply={() => apply(item.id, item.result!)} onLocate={id => void perform(`locate_${id}`, () => onLocate(id))} />}{item.editorCommands?.length&&onCommand&&<div className="ai-editor-commands">{item.editorCommands.map(command=><button key={command} disabled={!!activeAction&&command!=='stopPreview'||!!item.result&&!item.result.applied||!!item.workflow&&!item.workflow.applied&&(item.workflow.proposal.kind!=='agent'||!!item.workflow.proposal.changedFields?.length)} onClick={()=>executeCommand(item,command)}>{aiEditorCommandNames[command]}</button>)}{item.commandStatus&&<p role="status">{item.commandStatus}</p>}</div>}{item.editorTargets?.length&&onNavigate&&<div className="ai-editor-commands">{item.editorTargets.map((target,index)=><button key={index} disabled={!!activeAction||!!item.result&&!item.result.applied||!!item.workflow&&!item.workflow.applied&&(item.workflow.proposal.kind!=='agent'||!!item.workflow.proposal.changedFields?.length)} onClick={()=>navigateTarget(item,target)}>{aiEditorTargetLabel(project,target)}</button>)}{!item.editorCommands?.length&&item.commandStatus&&<p role="status">{item.commandStatus}</p>}</div>}{item.editorLayouts?.length&&onLayout&&<div className="ai-editor-commands">{item.editorLayouts.map((layout,index)=><div className="ai-layout-proposal" key={index}><button disabled={!!activeAction||!!item.result&&!item.result.applied||!!item.workflow&&!item.workflow.applied&&(item.workflow.proposal.kind!=='agent'||!!item.workflow.proposal.changedFields?.length)} onClick={()=>changeLayout(item,layout)}>{editorLayoutLabel(layout)}</button><small>{editorLayoutDescription(layout)}</small></div>)}{!item.editorTargets?.length&&!item.editorCommands?.length&&item.commandStatus&&<p role="status">{item.commandStatus}</p>}</div>}{item.workflow && <AiWorkflowReview value={item.workflow} disabled={busy||sessionBusy||!!activeAction || !!readOnlyMessage || !onApplyWorkflow} onApply={() => applyWorkflow(item)} />}</article>)}
        {busy && streamText && <article className="ai-message assistant"><strong>AI</strong><AiChatContent text={streamText}/></article>}{busy && <div className="ai-progress" role="status"><p>{progress?.message ?? 'AI 正在生成回复…'}</p>{progress?.total ? <progress value={progress.completed ?? 0} max={progress.total} /> : null}</div>}
      </div>
      <div className="ai-compose">{conversations.error&&<div role="alert" className="ai-error"><p>{conversations.error}</p>{!conversations.ready?<button type="button" onClick={conversations.retryLoad}>重新读取聊天记录</button>:bridge.exportAiConversationBackup&&<><button type="button" disabled={busy||sessionBusy||!!activeAction} onClick={()=>void manage(()=>switchConversation(conversations.recover))}>导出并新建会话</button><small>完整备份包含最新回复和未发送草稿；导出成功后才新建会话。</small></>}</div>}{notice&&<p role="status">{notice}</p>}{editingId&&<div className="ai-edit-banner">从此消息创建分支，原会话保留。<button onClick={()=>{setEditingId(undefined);setPrompt('');}}>取消编辑</button></div>}{error && <p role="alert" className="ai-error">{error}</p>}{readOnlyMessage && <p className="ai-error">{readOnlyMessage}</p>}{lines.length > 100 && <p className="muted">已启用自动分批处理，可随时停止。</p>}
        {!bridge.requestAi && <p role="alert" className="ai-error">当前是浏览器编辑模式，AI 助手和模型列表需要桌面版。工程仍可继续在浏览器中编辑和保存。</p>}
        {bridge.requestAi && config?.loadIssue && <div className="ai-config-hint" role="alert"><span>{config.loadIssue.message}</span><button type="button" className="text-button" onClick={() => setSettings(true)}>处理 AI 配置</button></div>}
        {bridge.requestAi && !config?.model && !config?.loadIssue && <p>先到<button className="text-button" onClick={() => setSettings(true)}>AI 服务设置</button>填写地址和模型。</p>}
        {bridge.inspectAiAttachments && <>
          {!!attachments.length && <ul className="ai-attachments" aria-label="待发送的参考附件">{attachments.map(item => <li key={item.path}><div title={item.path}><strong>{item.name}</strong><small>{aiAttachmentDescription(item)}</small></div><IconButton title={`移除附件 ${item.name}`} disabled={busy || attaching} onClick={() => setAttachments(current => current.filter(file => file.path !== item.path))}><X size={14} /></IconButton></li>)}</ul>}
        </>}
        <textarea aria-label="发给 AI 的内容" disabled={!conversations.ready || managing || preparingClose} autoFocus value={prompt} maxLength={10000} onChange={event => {if(!closing.current&&!sessionLock.current)setPrompt(event.target.value);}} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} placeholder="描述想讨论或修改的内容…" rows={3} />
        <div className="ai-compose-toolbar">
          <div className="ai-compose-options">
            {bridge.inspectAiAttachments && <AiPopover label="添加参考" trigger={<><Paperclip size={15} />{attachments.length > 0 && <span>{attachments.length}</span>}</>} disabled={busy || attaching || sessionBusy} active={allowExternalFiles || !!attachments.length}>
              <button type="button" data-ai-close-popover onClick={() => void addAttachments()}><Paperclip size={14} />添加文件</button>
              <button type="button" data-ai-close-popover onClick={() => void addAttachments(undefined, 'directory')}><FolderOpen size={14} />引用目录</button>
              <p className="ai-popover-note">也可拖入文件或目录；发送时才读取内容。</p>
              <label className="ai-external-access"><input type="checkbox" aria-label="允许访问项目外文件" checked={allowExternalFiles} onChange={event => setAllowExternalFiles(event.target.checked)} />允许访问项目外文件</label>
              <small className="ai-popover-note">开启后可读取问题中写明的本机路径；每个会话单独开启。</small>
            </AiPopover>}
            <select aria-label="AI 对话模式" title={(conversations.value?.mode ?? 'edit') === 'chat' ? '只讨论和解释，不提出工程修改' : '准备修改方案，由你审阅后应用'} value={conversations.value?.mode ?? 'edit'} disabled={busy || sessionBusy} onChange={event => conversations.change({ mode: event.target.value as 'chat' | 'edit' })}><option value="chat">聊天</option><option value="edit">协助编辑</option></select>
            {allowExternalFiles && <span className="ai-access-indicator">路径访问已开启</span>}
            {attaching && <small role="status">正在检查附件…</small>}
          </div>
          {stopping ? <button disabled><Square size={14} />正在停止…</button> : activityBusy ? <button disabled>正在完成操作…</button> : busy ? <button onClick={() => {void stopRequest().catch(error=>setError(aiError(error)));}}><Square size={14} />停止生成</button> : <button className="primary" disabled={!bridge.requestAi || !config?.model || !!config.loadIssue || !prompt.trim() || attaching || sessionBusy || !!activeAction} onClick={() => void send()}><Send size={14} />发送</button>}
        </div>
        <div className="ai-compose-meta"><small title={config?.model}>{config?.model ?? ''}</small><small>Ctrl + Enter 发送</small></div>
      </div>
    </>}
      </main>
    </div>
  </>;
  const freezeHandlers = { inert: preparingClose||managing, onClickCapture: (event:MouseEvent) => {if(closing.current||sessionLock.current){event.preventDefault();event.stopPropagation();}} };
  return standalone ? <section {...dragHandlers} {...freezeHandlers} className="ai-assistant ai-assistant-window" aria-label="AI 助手">{content}</section> : createPortal(<dialog {...dragHandlers} {...freezeHandlers} ref={dialog} className="ai-assistant ai-assistant-dialog" aria-label="AI 助手" onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => { if (['F5', 'F6'].includes(event.key)) event.stopPropagation(); }}>{content}</dialog>, document.body);
}
