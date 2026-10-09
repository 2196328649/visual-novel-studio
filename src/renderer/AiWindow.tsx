import { useEffect, useState } from 'react';
import type { AiEditorAction, AiWorkspaceContext } from '../core/bridge';
import { AiAssistant } from './AiAssistant';
import { aiError } from './AiSettings';

const studio = window.studio;

export function AiWindow() {
  const [context, setContext] = useState<AiWorkspaceContext>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true, receivedUpdate = false;
    const unsubscribe = studio?.onAiContext?.(next => {
      receivedUpdate = true;
      if (active) { setContext(next); setError(''); }
    });
    void studio?.getAiContext?.().then(initial => {
      if (active && !receivedUpdate && initial) setContext(initial);
    }).catch(error => { if (active) setError(aiError(error)); });
    return () => { active = false; unsubscribe?.(); };
  }, []);
  useEffect(() => { document.title = context ? `AI 助手 · ${context.project.name}` : 'AI 助手 · 叙事工坊'; }, [context?.project.name]);
  if (!studio || !context) return <main className="ai-window-loading" role="status">{error || '正在连接主编辑器…'}</main>;
  const run = async (action: AiEditorAction) => {
    if (!studio.runAiEditorAction) throw new Error('无法连接主编辑器，请重新打开助手。');
    return studio.runAiEditorAction(action);
  };
  return <AiAssistant key={context.project.id} {...context} standalone bridge={studio}
    assetUrl={id => { const asset = context.project.assets.find(asset => asset.id === id); return asset ? studio.assetUrl(asset.path) : undefined; }}
    onApply={async changes => { await run({ projectId: context.project.id, kind: 'apply', changes }); }}
    onApplyWorkflow={async proposal => { await run({ projectId: context.project.id, kind: 'workflow', proposal }); }}
    onLayout={layout=>run({projectId:context.project.id,kind:'layout',layout})}
    onNavigate={target=>run({projectId:context.project.id,kind:'navigate',target})}
    onCommand={command=>run({projectId:context.project.id,kind:'command',command})}
    onUndo={async () => { await run({ projectId: context.project.id, kind: 'undo' }); }}
    onLocate={async lineId => { await run({ projectId: context.project.id, kind: 'locate', lineId }); }}
    onClose={() => studio.closeAiWindow?.()} />;
}
