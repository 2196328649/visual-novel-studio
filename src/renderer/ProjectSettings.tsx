import { NumberInput } from './NumberInput';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, FileText, FolderOpen, Palette, Play, Settings2, Sparkles, X } from 'lucide-react';
import { projectSchema, type Project, type VariableValue } from '../core/model';
import type { PreviewMode, StudioBridge } from '../core/bridge';
import type { Commit } from './editor';
import { Field, IconButton, TargetSelect, ValueInput } from './components';
import { ExportSettingsPanel } from './ExportSettingsPanel';
import { AiSettings } from './AiSettings';
import { EditorAppearance } from './EditorAppearance';

export type SettingsSection = 'project' | 'resources' | 'play' | 'export' | 'ai' | 'editor';

export function ProjectSettings({ project, commit, playMode, setPlayMode, testEntry, setTestEntry, testVariables, setTestVariables, selectedNodeId, onClose, onPreview, busy, initialSection = 'project', bridge, assetUrl, onExport }: {
  project: Project; commit: Commit; playMode: PreviewMode; setPlayMode: (mode: PreviewMode) => void;
  testEntry?: string; setTestEntry: (id?: string) => void; testVariables: Record<string, VariableValue>;
  setTestVariables: (values: Record<string, VariableValue>) => void; selectedNodeId?: string;
  onClose: () => void; onPreview: () => void; busy: boolean;
  initialSection?: SettingsSection; bridge: StudioBridge; assetUrl: (id?: string) => string | undefined; onExport: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [exportReady, setExportReady] = useState(false);
  const [resourceError, setResourceError] = useState('');
  const resources = project.resourceSettings ?? { importMode: 'copy' as const, directory: 'assets', syncFolders: true };
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className="project-settings-dialog" aria-label="作品设置" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => { if (event.key === 'F5' || event.key === 'F6') event.stopPropagation(); }}>
    <header><Settings2 size={18} /><h2>作品设置</h2><div className="spacer" /><IconButton title="关闭作品设置" onClick={onClose}><X size={18} /></IconButton></header>
    <div className="project-settings-body"><nav aria-label="设置分类"><button type="button" className={section === 'project' ? 'active' : ''} aria-pressed={section === 'project'} onClick={() => setSection('project')}><FileText size={16} />作品信息</button><button type="button" className={section === 'resources' ? 'active' : ''} aria-pressed={section === 'resources'} onClick={() => setSection('resources')}><FolderOpen size={16} />资源管理</button><button type="button" className={section === 'play' ? 'active' : ''} aria-pressed={section === 'play'} onClick={() => setSection('play')}><Play size={16} />试玩设置</button><button type="button" className={section === 'export' ? 'active' : ''} aria-pressed={section === 'export'} onClick={() => setSection('export')}><ArrowDownToLine size={16} />游戏导出</button><button type="button" className={section === 'ai' ? 'active' : ''} aria-pressed={section === 'ai'} onClick={() => setSection('ai')}><Sparkles size={16} />AI 服务</button><button type="button" className={section === 'editor' ? 'active' : ''} aria-pressed={section === 'editor'} onClick={() => setSection('editor')}><Palette size={16} />编辑器外观</button></nav>
      <section className="project-settings-content">
        {section === 'project' ? <><h3>作品信息</h3><p className="muted">作品名称、画面尺寸与故事入口。</p>
          <Field label="作品名称"><input value={project.name} maxLength={120} onChange={event => commit('作品名称', draft => { draft.name = event.target.value; })} /></Field>
          <Field label="版本"><input value={project.version} maxLength={32} onChange={event => commit('作品版本', draft => { draft.version = event.target.value; })} /></Field>
          <div className="field-row"><Field label="画面宽度"><NumberInput type="number"   value={project.width} onChange={event => commit('画面宽度', draft => { draft.width = Number(event.target.value); })} /></Field><Field label="画面高度"><NumberInput type="number"   value={project.height} onChange={event => commit('画面高度', draft => { draft.height = Number(event.target.value); })} /></Field></div>
          <Field label="故事入口" hint="玩家选择开始游戏时，首先播放这里。可以选择任意段落，不要求添加 @开始。"><TargetSelect project={project} label="故事入口" value={project.entryId} onChange={id => { if (id) commit('故事入口', draft => { draft.entryId = id; }); }} /></Field>
          <details className="ui-property-group"><summary>入口指令说明</summary><p className="test-state-note"><code>@入口：开始</code> 表示从名为「开始」的段落进入；冒号后的「开始」是段落名称，可以换成其他名称。<code>@开始</code> 只创建连接下一段的流程起点，用于整理蓝图或小章节入口。普通顺序剧情通常不用手写这两条指令。</p></details>
        </> : section === 'resources' ? <><h3>资源管理</h3>
          <Field label="素材导入方式"><select aria-label="素材导入方式" value={resources.importMode} onChange={event => commit('素材导入方式', draft => { draft.resourceSettings = { ...resources, importMode: event.target.value as 'copy' | 'reference' }; })}><option value="copy">复制到项目文件夹</option><option value="reference">引用原文件路径</option></select></Field>
          <Field label="项目资源文件夹"><input key={resources.directory} aria-label="项目资源文件夹" defaultValue={resources.directory} maxLength={120} onBlur={event => { const result = projectSchema.shape.resourceSettings.safeParse({ ...resources, directory: event.target.value.replaceAll('\\', '/') }); if (!result.success) { setResourceError('请输入项目内的相对文件夹，例如 assets 或 resources/images'); return; } setResourceError(''); commit('项目资源文件夹', draft => { draft.resourceSettings = result.data; }); }} /></Field>
          <Field label="保存时同步素材文件夹"><input type="checkbox" checked={resources.syncFolders !== false} onChange={event => commit('同步素材文件夹', draft => { draft.resourceSettings = { ...resources, syncFolders: event.target.checked }; })} /></Field>
          <p className="muted">保存工程时，素材按编辑器内的分类、文件夹和显示名称同步到磁盘。重命名素材或文件夹后再次保存即可同步；同名文件自动区分，不允许的文件名字符替换为下划线。骨骼动画按名称归档，保留配套文件的内部名称。引用素材保留原文件位置，导出时一并打包。</p>
          {bridge.openResourceDirectory && <button className="small-button" onClick={() => void bridge.openResourceDirectory!(project).catch(error => setResourceError(error instanceof Error ? error.message : String(error)))}><FolderOpen size={15} />打开项目资源文件夹</button>}
          {resourceError && <p role="alert">{resourceError}</p>}
        </> : section === 'export' ? <ExportSettingsPanel project={project} commit={commit} bridge={bridge} assetUrl={assetUrl} onReady={setExportReady} /> : section === 'ai' ? <AiSettings bridge={bridge} /> : section === 'editor' ? <EditorAppearance /> : <><h3>试玩设置</h3><p className="muted">工具栏的「试玩」和 F5 使用这里的设置。</p>
          <Field label="试玩方式"><select value={playMode} onChange={event => setPlayMode(event.target.value as PreviewMode)}><option value="embedded">编辑器内试玩</option><option value="window">独立游戏窗口</option></select></Field>
          <Field label="从这里开始"><TargetSelect project={project} label="从这里开始" value={testEntry} onChange={setTestEntry} empty="作品的故事入口" /></Field>
          <div className="settings-inline-actions"><button type="button" className="small-button" disabled={!selectedNodeId} onClick={() => setTestEntry(selectedNodeId)}>使用当前段落</button><button type="button" className="text-button" onClick={() => { setTestEntry(undefined); setTestVariables({}); }}>恢复默认试玩设置</button></div>
          <details className="ui-property-group" open={Object.keys(testVariables).length > 0}><summary>测试初始状态{Object.keys(testVariables).length > 0 ? ` · 已调整 ${Object.keys(testVariables).length} 项` : ` · ${project.variables.length} 项`}</summary><div className="test-variables">{project.variables.length ? project.variables.map(variable => <Field key={variable.id} label={variable.name}><ValueInput label={variable.name} variable={variable} value={testVariables[variable.id] ?? variable.initial} onChange={value => setTestVariables({ ...testVariables, [variable.id]: value })} /></Field>) : <p className="muted">尚未创建状态，添加后可在这里指定测试值。</p>}</div></details>
          <p className="test-state-note">片段试玩从所选节点重新建立舞台。测试状态不会改写剧情中的初始值。</p>
        </>}
      </section>
    </div>
    <footer><span>{section === 'editor' ? '编辑器配色自动保存在本机' : section === 'ai' ? 'AI 配置仅保存在本机' : '作品信息和导出配置随工程保存'}</span><div className="spacer" />{section === 'play' && <button type="button" className="small-button" disabled={busy} onClick={onPreview}><Play size={14} />开始试玩</button>}{section === 'export' && <button type="button" className="primary" disabled={busy || !exportReady} onClick={onExport}><ArrowDownToLine size={14} />导出</button>}<button type="button" className={section === 'export' ? 'small-button' : 'primary'} onClick={onClose}>完成</button></footer>
  </dialog>, document.body);
}
