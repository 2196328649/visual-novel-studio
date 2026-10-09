import { useLayoutEffect, useRef } from 'react';
import type { Project } from '../core/model';
import { dialogueLayout } from '../core/ui';
import { uiFontFamily } from './UiAppearance';

export function UiConfirmationText({ message, scale }: { message: string; scale: number }) {
 const box = useRef<HTMLDivElement>(null), text = useRef<HTMLDivElement>(null);
 useLayoutEffect(() => {
  const outer = box.current, inner = text.current; if (!outer || !inner) return;
  const measure = () => {
   const size = parseFloat(getComputedStyle(outer).fontSize), normal = Math.max(1, size / scale), minimum = Math.min(normal, Math.max(18, Math.floor(normal * .65)));
   let low = minimum, high = Math.floor(normal), fitted = minimum;
   while (low <= high) { const candidate = Math.floor((low + high) / 2); inner.style.fontSize = candidate * scale + 'px'; if (inner.scrollHeight <= outer.clientHeight + 1) { fitted = candidate; low = candidate + 1; } else high = candidate - 1; }
   inner.style.fontSize = fitted * scale + 'px'; inner.style.marginBlock = inner.scrollHeight <= outer.clientHeight + 1 ? 'auto' : '0';
  };
  measure(); const observer = new ResizeObserver(measure); observer.observe(outer);
  let cancelled = false; void document.fonts.ready.then(() => { if (!cancelled) measure(); });
  return () => { cancelled = true; observer.disconnect(); };
 }, [message, scale]);
 return <div ref={box} className="ui-confirmation-preview-text" tabIndex={0} aria-label="确认提示" style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', pointerEvents: 'auto' }}><div ref={text} style={{ flex: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message}</div></div>;
}

export function UiConfirmationPreview({ project, message, scale, onAnswer }: { project: Project; message: string; scale: number; onAnswer: (value: boolean) => void }) {
 const { contentWidth } = dialogueLayout(project.width, project.height, project.ui);
 return <div className="ui-confirmation-preview" role="group" aria-label="标准确认框预演" style={{ position: 'absolute', inset: 0, background: '#000000aa', display: 'grid', placeItems: 'center', pointerEvents: 'auto', color: project.ui.textColor, fontSize: Math.min(24, project.ui.fontSize) * scale, fontFamily: uiFontFamily(project.ui.fontAssetId) }}>
  <div style={{ background: project.ui.background, width: Math.min(720, contentWidth) * scale, maxHeight: project.height * scale * .9, minHeight: 0, boxSizing: 'border-box', padding: 24 * scale, display: 'flex', flexDirection: 'column', gap: 24 * scale }}>
   <div aria-label="确认提示" tabIndex={0} style={{ minHeight: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'auto' }}>{message}</div>
   <div style={{ display: 'flex', flexShrink: 0, gap: 20 * scale }}><button type="button" onClick={() => onAnswer(true)}>确认</button><button type="button" onClick={() => onAnswer(false)}>取消</button></div>
  </div>
 </div>;
}
