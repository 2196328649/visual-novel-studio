import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Layers, ListTree, PanelLeftClose, PanelLeftOpen, Plus, Search, Trash2 } from 'lucide-react';
import type { Project } from '../core/model';
import { IconButton } from './components';
import { searchStory, storySearchIndex, type StorySearchEntry } from '../core/story-search';

export function StoryDirectory({ project, open, toggle, sceneId, nodeId, selectScene, selectNode, addScene, addChapter, renameScene, removeScene, removeChapter }: {
  project: Project; open: boolean; toggle: () => void; sceneId: string; nodeId?: string;
  selectScene: (id: string) => void; selectNode: (id: string, lineId?: string) => void;
  addScene: () => void; addChapter: () => void; renameScene: (id: string) => void; removeScene: (id: string) => void; removeChapter: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [showContent, setShowContent] = useState(false);
  useEffect(() => { setQuery(''); setCollapsed([]); }, [project.id]);
  const searching = !!query.trim();
  const index = useMemo(() => open && searching ? storySearchIndex(project) : [], [open, searching, project.chapters, project.scenes, project.nodes, project.characters]);
  const results = useMemo(() => searchStory(index, query), [index, query]);
  const selectResult = (entry: StorySearchEntry) => entry.nodeId ? selectNode(entry.nodeId, entry.lineId) : selectScene(entry.sceneId);
  if (!open) return <aside className="story-directory-rail" aria-label="剧情目录已收起"><IconButton title="展开剧情目录" onClick={toggle}><PanelLeftOpen size={16} /></IconButton><span>剧情目录</span></aside>;
  const normalized = query.trim().toLocaleLowerCase();
  return <aside className="sidebar story-directory" aria-label="剧情目录">
    <div className="story-directory-heading"><BookOpen size={15} /><strong>剧情目录</strong><div className="spacer" /><IconButton title="收起剧情目录" onClick={toggle}><PanelLeftClose size={16} /></IconButton></div>
    <div className="sidebar-search"><Search size={14} /><input aria-label="搜索剧情目录" placeholder="章节、对白、角色或选项…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); setQuery(''); }
      if (event.key === 'Enter' && results.entries[0]) { event.preventDefault(); selectResult(results.entries[0]); }
    }} />{query && <button className="story-search-clear" aria-label="清除剧情搜索" onClick={() => setQuery('')}>×</button>}</div>
    <div className="sidebar-heading"><span>{project.chapters.length} 章 · {project.scenes.length} 小章节</span><div className="spacer" /><IconButton title="显示未命名的对白和演出" aria-pressed={showContent} onClick={() => setShowContent(value => !value)}><ListTree size={14} /></IconButton><IconButton title="添加章节" onClick={addChapter}><BookOpen size={14} /></IconButton><IconButton title="添加小章节" onClick={addScene}><Plus size={15} /></IconButton></div>
    <div className="sidebar-scroll">
      {normalized ? <div className="story-search-results" aria-label="剧情搜索结果">
        <p className="story-search-count" role="status">{results.total ? `${results.total} 条匹配${results.total > results.entries.length ? ` · 显示前 ${results.entries.length} 条` : ''}` : '没有找到匹配内容'}</p>
        {!results.total && <p className="story-search-hint">可搜索对白、发言角色、选项或章节名，用空格组合关键词。</p>}
        {results.entries.map(entry => <button key={entry.key} className="story-search-result" onClick={() => selectResult(entry)} title={entry.label}>
          <small>{entry.kind} · {entry.context}</small><span>{entry.label}</span>
        </button>)}
        {results.total > results.entries.length && <p className="story-search-hint">添加章节或角色名可缩小范围。</p>}
      </div> : project.chapters.map(chapter => {
        const scenes = project.scenes.filter(scene => scene.chapterId === chapter.id && (!normalized || `${chapter.name} ${scene.name}`.toLocaleLowerCase().includes(normalized) || project.nodes.some(node => node.sceneId === scene.id && node.name.toLocaleLowerCase().includes(normalized))));
        if (normalized && !scenes.length) return null;
        const expanded = !!normalized || !collapsed.includes(chapter.id);
        return <div className="chapter-tree" key={chapter.id}>
          <div className="chapter-row"><button className="chapter-label" aria-expanded={expanded} onClick={() => setCollapsed(previous => previous.includes(chapter.id) ? previous.filter(id => id !== chapter.id) : [...previous, chapter.id])}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<BookOpen size={14} /><span>{chapter.name}</span></button><IconButton title="删除章节" disabled={project.chapters.length <= 1 || project.nodes.some(node => node.id === project.entryId && scenes.some(scene => scene.id === node.sceneId))} onClick={() => removeChapter(chapter.id)}><Trash2 size={12} /></IconButton></div>
          {expanded && scenes.map(scene => <div key={scene.id}>
            <div className={`scene-row ${scene.id === sceneId ? 'active' : ''}`}><button onClick={() => selectScene(scene.id)} onDoubleClick={() => renameScene(scene.id)}><Layers size={14} /><span>{scene.name}</span><small>{project.nodes.filter(node => node.sceneId === scene.id).length}</small></button><IconButton title="删除小章节" disabled={project.scenes.length <= 1 || project.nodes.some(node => node.id === project.entryId && node.sceneId === scene.id)} onClick={() => removeScene(scene.id)}><Trash2 size={12} /></IconButton></div>
            {(scene.id === sceneId || normalized) && project.nodes.filter(node => node.sceneId === scene.id && (showContent || !!normalized || node.textHeading !== false) && (!normalized || `${chapter.name} ${scene.name} ${node.name}`.toLocaleLowerCase().includes(normalized))).map(node => <button className={`tree-node ${node.id === nodeId ? 'active' : ''}`} key={node.id} onClick={() => selectNode(node.id)}><span className={`node-dot ${node.kind}`} /><span>{node.textHeading === false && node.kind === 'passage' ? node.lines.find(line => line.text.trim())?.text.slice(0, 24) ?? '演出' : node.textHeading === false && node.kind === 'choice' ? '选择：' + node.prompt : node.name}</span></button>)}
          </div>)}
        </div>;
      })}
    </div>
  </aside>;
}
