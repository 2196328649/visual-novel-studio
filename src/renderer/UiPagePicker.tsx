import { useId, useMemo, useRef } from 'react';
import { PanelsTopLeft, Clapperboard, ArrowUpRight } from 'lucide-react';
import type { Project } from '../core/model';
import { builtinUiPages, type BuiltinUiPage } from '../core/ui-page-catalog';
import { chapterEditorEntries, enableUiPage, uiPickerPages } from '../core/ui-page-authoring';
import { uiPages } from '../core/ui-pages';
import { uiPageUsageSummary, type UiPageUsage } from '../core/ui-page-usages';
import type { PerformanceTarget } from '../core/performance-workspace';
import type { Commit } from './editor';
import { UiToolbarPopover } from './UiToolbarPopover';
import './ui-page-picker.css';

interface Props {
  project: Project; selectedId?: string; advanced: boolean; commit: Commit;
  usages: ReadonlyMap<string, readonly UiPageUsage[]>;
  onSelect: (pageId: string) => void; onChapter?: (target: PerformanceTarget) => void;
}
export function UiPagePicker({ project, selectedId, advanced, commit, usages, onSelect, onChapter }: Props) {
  const picker = useRef<HTMLSelectElement>(null);
  const moreTriggerId = useId();
  const pages = uiPickerPages(project, selectedId, usages);
  const chapters = useMemo(() => chapterEditorEntries(project), [project.nodes, project.blueprints, project.timelinePresets]);
  const all = uiPages(project), current = all.find(page => page.id === selectedId);
  const value = (id: string) => advanced || !id.startsWith('ui:') ? id : id.slice(3);
  const regular = pages.filter(page => page.template), custom = pages.filter(page => !page.template);
  const select = (id: string) => { onSelect(id); requestAnimationFrame(() => picker.current?.focus()); };
  const optional = all.filter(page => page.template && (page.disabled || builtinUiPages[page.kind as BuiltinUiPage].group !== 'common'));
  return <>
    <label className="ui-blueprint-page ui-page-picker"><span>当前页面</span><select ref={picker} aria-label={advanced ? '事件图页面' : '设计页面'} title={current?.name} value={selectedId ? value(selectedId) : 'custom'} onChange={event => {
      const id = event.target.value;
      if (id === '@more') {
        event.currentTarget.value = selectedId ? value(selectedId) : 'custom';
        const trigger = document.getElementById(moreTriggerId); trigger?.focus(); trigger?.click(); return;
      }
      onSelect(advanced || !Object.hasOwn(builtinUiPages, id) ? id : 'ui:' + id);
    }}>
      {regular.map(page => <option key={page.id} value={value(page.id)}>{page.name}{page.disabled ? '（已停用）' : builtinUiPages[page.kind as BuiltinUiPage].group === 'legacy' ? '（旧版布局）' : ''}</option>)}
      {custom.length ? <optgroup label="自定义页面">{custom.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}</optgroup> : <option value="custom">自定义页面</option>}
      <option value="@more">更多内置页面 / 章节演出…</option>
    </select></label>
    <UiToolbarPopover triggerId={moreTriggerId} label="更多内置页面" icon={<PanelsTopLeft size={16} />}>
      <div className="ui-page-library">
        <section aria-label="章节演出入口"><h4><Clapperboard size={14} />章节演出</h4>
          <p>打开正在使用的演出时间轴，修改文字、布局和动画。</p>
          {chapters.length ? chapters.map(entry => <button type="button" className="ui-page-library-entry" data-close-ui-popover key={entry.id} disabled={!onChapter} onClick={() => onChapter?.(entry.target)}><span>{entry.name}<small>{entry.used ? '剧情中使用' : '演出预设'}</small></span><ArrowUpRight size={14} /></button>) : <p>还没有章节演出，可在台词上方的 @ 菜单添加“章节进入演出”。</p>}
        </section>
        <section aria-label="可选内置页面"><h4>可选页面</h4><p>打开备用页面只切换编辑对象。启用已停用的页面后，可从“使用位置”设置入口。</p>
          {optional.filter(page => builtinUiPages[page.kind as BuiltinUiPage].group !== 'legacy').map(page => <div className="ui-page-library-row" key={page.id}>
            <span>{page.name}<small>{page.disabled ? '已停用' : uiPageUsageSummary(usages.get(page.id) ?? [])}</small></span>
            <button type="button" className="small-button" data-close-ui-popover aria-label={(page.disabled ? '启用并编辑' : '编辑') + page.name} onClick={() => {
              if (page.disabled) commit('启用' + page.name, draft => enableUiPage(draft, page.kind as BuiltinUiPage), { separate: true });
              select(page.id);
            }}>{page.disabled ? '启用并编辑' : '编辑'}</button>
          </div>)}
        </section>
        <details><summary>旧版章节布局</summary><p>保留旧工程和生成默认演出所需的配置。这里的修改不会同步到已生成的时间轴。</p><button type="button" className="small-button" data-close-ui-popover onClick={() => {
          if (project.ui.disabledPages?.includes('chapterTitle')) commit('启用旧版章节布局', draft => enableUiPage(draft, 'chapterTitle'), { separate: true });
          select('ui:chapterTitle');
        }}>编辑旧版章节布局</button></details>
      </div>
    </UiToolbarPopover>
  </>;
}

export function UiPageUsageHint({ usages, onOpen }: { usages: readonly UiPageUsage[]; onOpen: () => void }) {
  return <button type="button" className="ui-page-usage-hint" aria-label="查看页面使用位置" title="查看系统入口、按钮、剧情调用和引用位置" onClick={onOpen}><span>{uiPageUsageSummary(usages)}</span><ArrowUpRight size={13} /></button>;
}
