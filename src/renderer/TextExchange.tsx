import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Project } from '../core/model';
import { currentScriptText } from '../core/script-text';
import type { StudioBridge } from '../core/bridge';
import { applyTextScript, projectToText } from '../core/text-script';
import { currentTextProject, dialogueRows, exportText, previewDialogueRevision, type ImportedText, type TextExportMode } from '../core/text-exchange';
import './text-exchange.css';

export function TextExchange({ project, imported, bridge, onClose, onApply, onNotice }: { project: Project; imported?: ImportedText; bridge: StudioBridge; onClose: () => void; onApply: (project: Project, label: string) => void; onNotice: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [importMode, setImportMode] = useState(imported?.mapping || /^@对白标记/m.test(imported?.text ?? '') && !/^@(入口|节点标记|背景|显示角色)/m.test(imported?.text ?? '') ? 'revision' : 'replace');
  const [exportMode, setExportMode] = useState<TextExportMode>('commands');
  const [allowOrder, setAllowOrder] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => previous?.focus(); }, []);
  const preview = useMemo(() => {
    try {
      if (!imported) return { exported: exportText(project, exportMode) };
      if (importMode === 'revision') return { revision: previewDialogueRevision(project, imported, allowOrder) };
      const current = currentTextProject(project), parsed = applyTextScript(current, imported.text, imported.name);
      const issues = parsed.issues.filter(issue => issue.severity === 'error');
      if (issues.length) throw new Error(issues.slice(0, 8).map(issue => `第 ${issue.sourceLine} 行：${issue.message}`).join('\n'));
      parsed.project.scriptText = currentScriptText(projectToText(parsed.project), imported.name);
      return { replacement: parsed.project };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [project, imported, importMode, allowOrder, exportMode]);
  const apply = async () => {
    setError('');
    try {
      if (imported) {
        const result = preview.revision?.project ?? preview.replacement;
        if (result) { onApply(result, preview.revision ? `更新 ${preview.revision.changes.length} 句台词` : `导入文本 ${imported.name}`); onClose(); }
      } else {
        setSaving(true);
        const destination = await bridge.exportText?.(project, exportMode);
        if (destination) { onNotice(`文本已导出：${destination}`); onClose(); }
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  return createPortal(<dialog ref={dialog} className="text-exchange-dialog" aria-label={imported ? '导入文本' : '导出文本'} onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
    <header><strong>{imported ? `导入文本 · ${imported.name}` : '导出文本'}</strong><button className="icon-button" aria-label="关闭文本交换" onClick={onClose}><X size={17} /></button></header>
    <div className="text-exchange-body">
      {imported ? <><label>导入方式<select aria-label="文本导入方式" value={importMode} onChange={event => setImportMode(event.target.value)}><option value="replace">完整导入：替换剧情与指令</option><option value="revision">仅更新台词：保留演出、配音与流程</option></select></label>
        {importMode === 'revision' ? <><p>优先通过行标识或导出时的对应表查找台词，保留角色、演出、配音、变量和分支。带标识的修订稿可只保留需要修改的句子。</p><label className="text-exchange-order"><input type="checkbox" checked={allowOrder} onChange={event => setAllowOrder(event.target.checked)} />没有行标识时，按当前对白顺序替换</label></> : <p>将替换当前剧情。已有资源、界面、角色立绘和蓝图库继续用于解析导入的指令；整次导入可撤销。</p>}
        {preview.revision && <><p role="status">已按{{ ids: '稳定行标识', mapping: '导出对应表', order: '当前对白顺序' }[preview.revision.method]}匹配，将更新 {preview.revision.changes.length} 句台词。{preview.revision.ignoredCommands > 0 && `文件内 ${preview.revision.ignoredCommands} 条指令不参与本次文本更新。`}</p><div className="text-exchange-diff">{preview.revision.changes.map(change => <div key={change.id}><strong>{change.speaker}</strong><del>{change.before || '（空台词）'}</del><ins>{change.after || '（空台词）'}</ins></div>)}</div></>}
        {preview.replacement && <><p role="status">{preview.replacement.chapters.length} 章 · {preview.replacement.scenes.length} 小章节 · {dialogueRows(preview.replacement).length} 句台词</p><pre>{imported.text.slice(0, 12000)}</pre></>}
      </> : <><label>文本格式<select aria-label="文本导出格式" value={exportMode} onChange={event => setExportMode(event.target.value as TextExportMode)}><option value="commands">完整剧本（含演出、流程指令与行标识）</option><option value="revision">对白修订稿（台词与稳定行标识）</option><option value="dialogue">纯台词（角色名与台词）</option></select></label><p>{exportMode === 'commands' ? '可重新导入当前工程，继续使用工程内的资源与蓝图。' : exportMode === 'revision' ? '可修改、重排或只保留部分台词；重新导入时选择「仅更新台词」。删除某条修订记录不会删除工程内的台词。' : '不包含演出指令。同时保存 .vns-lines.json 对应表；保留该文件，并保持对白数量和顺序，即可仅回填台词。需要增删或重排时使用带标识的修订稿。'}</p><pre>{preview.exported?.text.slice(0, 12000)}</pre></>}
      {(preview.error || error) && <p role="alert" className="text-exchange-error">{preview.error || error}</p>}
    </div><footer><button onClick={onClose}>取消</button><button className="primary" disabled={!!preview.error || saving || !imported && !bridge.exportText} onClick={() => void apply()}>{saving ? '正在保存…' : imported ? '应用导入' : '保存 TXT'}</button></footer>
  </dialog>, document.body);
}
