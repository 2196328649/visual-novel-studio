import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { textLineColor } from '../core/text-colors';
import { useTextPalette, speakerTextColor } from './text-palette';
import { readableColor } from './editor-theme';
import './text-code.css';
import { ChevronRight } from 'lucide-react';
import { wrappedLineOffsets } from './text-wrap-layout';

function tokens(line: string): ReactNode {
  const prefix = line.match(/^(\s*#{1,3}\s*[^:：]+[:：]?|\s*[@／/][^\s:：]+\s*[:：]?|[^:：]{1,40}[:：])/);
  if (!prefix) return line || '\u200b';
  const kind = /^\s*#/.test(prefix[0]) ? 'heading' : /^\s*[@／/]/.test(prefix[0]) ? 'command' : 'speaker';
  const tail = line.slice(prefix[0].length);
  return <><span className={`code-token-${kind}`}>{prefix[0]}</span>{tail.split(/(->|→|【[^】]*】|(?<![\w])[-+]?\d+(?:\.\d+)?)/g).map((part, index) => <span key={index} className={/^(->|→)$/.test(part) ? 'code-token-command' : /^[-+]?\d/.test(part) ? 'code-token-number' : undefined}>{part}</span>)}</>;
}

/** A virtualized paint layer keeps native text selection, IME and clipboard. */
export function TextCodeSurface({ source, inputRef, cursorLine, issues, onLine, children, folds, onFold, colorful = false, softWrap = false }: {
  source: string; inputRef: RefObject<HTMLTextAreaElement | null>; cursorLine: number;
  issues: Map<number, string>; onLine: (line: number) => void; children: ReactNode;
  folds?: Map<number, { key: string; name: string; collapsed: boolean }>; onFold?: (key: string) => void;
  colorful?: boolean;
  softWrap?: boolean;
}) {
  const [viewport, setViewport] = useState({ top: 0, left: 0, height: 720, width: 0 });
  const surface = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(() => { try { return Math.min(32, Math.max(10, Number(localStorage.getItem('vns.text.fontSize')) || 13)); } catch { return 13; } });
  const lineHeight = Math.round(fontSize * 22 / 13);
  const latestFont = useRef(fontSize); latestFont.current = fontSize;
  const zoomAnchor = useRef<{ line: number; fraction: number; y: number; left: number; font: number } | undefined>(undefined);
  const [measured, setMeasured] = useState<{source:string;width:number;fontSize:number;offsets:number[]}>();
  const { settings, palette } = useTextPalette();
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const sync = () => setViewport(previous => {
      const next = { top: input.scrollTop, left: input.scrollLeft, height: input.clientHeight, width: input.clientWidth };
      return previous.top === next.top && previous.left === next.left && previous.height === next.height && previous.width === next.width ? previous : next;
    });
    sync();
    input.addEventListener('scroll', sync);
    const observer = new ResizeObserver(sync); observer.observe(input);
    return () => { input.removeEventListener('scroll', sync); observer.disconnect(); };
  }, [inputRef]);
  const lines = source.split('\n');
  useLayoutEffect(() => {
    const element = surface.current, input = inputRef.current; if (!element || !input) return;
    const zoom = (next: number, clientY: number) => {
      const current = latestFont.current, value = Math.min(32, Math.max(10, next)); if (value === current) return;
      const offsets = wrappedLineOffsets(input, input.value.split('\n')), y = clientY - input.getBoundingClientRect().top, top = input.scrollTop + y - 14;
      let line = 0; while (line + 1 < offsets.length - 1 && offsets[line + 1] <= top) line++;
      zoomAnchor.current = { line, fraction: Math.max(0, (top - offsets[line]) / (offsets[line + 1] - offsets[line])), y, left: input.scrollLeft, font: current };
      latestFont.current = value; setFontSize(value);
    };
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey || !event.deltaY) return; event.preventDefault(); event.stopPropagation(); zoom(latestFont.current + (event.deltaY < 0 ? 1 : -1), event.clientY); };
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === '0') { event.preventDefault(); event.stopPropagation(); zoom(13, input.getBoundingClientRect().top + input.clientHeight / 2); } };
    element.addEventListener('wheel', wheel, { passive: false }); element.addEventListener('keydown', key);
    return () => { element.removeEventListener('wheel', wheel); element.removeEventListener('keydown', key); };
  }, [inputRef]);
  useLayoutEffect(() => {
    const input = inputRef.current, anchor = zoomAnchor.current;
    if (input && anchor) {
      const offsets = wrappedLineOffsets(input, source.split('\n')), line = Math.min(anchor.line, offsets.length - 2);
      input.scrollTop = Math.max(0, 14 + offsets[line] + anchor.fraction * (offsets[line + 1] - offsets[line]) - anchor.y);
      input.scrollLeft = anchor.left * fontSize / anchor.font; zoomAnchor.current = undefined;
      input.dispatchEvent(new Event('scroll'));
    }
    try { localStorage.setItem('vns.text.fontSize', String(fontSize)); } catch { /* View preferences are optional. */ }
  }, [fontSize]);
  useLayoutEffect(()=>{const input=inputRef.current;if(softWrap&&input)setMeasured({source,width:input.clientWidth,fontSize,offsets:wrappedLineOffsets(input,source.split('\n'))});},[source,softWrap,viewport.width,inputRef,fontSize]);
  const offsets=softWrap&&measured?.source===source&&measured.width===viewport.width&&measured.fontSize===fontSize?measured.offsets:lines.map((_,i)=>i*lineHeight).concat(lines.length*lineHeight);
  const lineAt=(top:number)=>{let low=0,high=lines.length;while(low<high){const mid=(low+high)>>>1;if(offsets[mid]<=top)low=mid+1;else high=mid;}return Math.max(0,low-1);};
  const first = Math.max(0, lineAt(viewport.top) - 10);
  const last = Math.min(lines.length, lineAt(viewport.top+viewport.height) + 12);
  const shown = lines.slice(first, last);
  return <div ref={surface} data-text-font-size={fontSize} className={'text-code-surface' + (colorful ? ' colorful-text' : '') + (softWrap ? ' soft-wrap' : '')} style={{ '--text-font-size': fontSize + 'px', '--text-line-height': lineHeight + 'px', '--text-gutter-font-size': Math.max(10, fontSize - 2) + 'px', '--text-background': palette.background, '--text-foreground': palette.text, '--text-selection': palette.selection, '--text-selection-foreground': readableColor(palette.text, palette.selection), '--text-heading': palette.heading, '--text-command': palette.command, '--text-comment': palette.comment } as CSSProperties}>
    <div className="text-code-gutter" aria-label="文本行号"><div style={{ paddingTop: 14 + offsets[first], transform: `translateY(${-viewport.top}px)` }}>
      {shown.map((_, index) => { const line = first + index + 1, fold = folds?.get(line); return <div className="text-gutter-row" key={line} style={{height:offsets[line]-offsets[line-1]}}><button type="button" className={`${line === cursorLine ? 'active' : ''} ${issues.has(line) ? 'has-issue' : ''}`} title={issues.get(line) ?? `转到第 ${line} 行`} aria-label={`转到第 ${line} 行`} onMouseDown={event => event.preventDefault()} onClick={() => onLine(line)}>{line}</button>{fold && <button type="button" className="text-fold-toggle" aria-label={`${fold.collapsed ? '展开' : '折叠'}${fold.name}`} aria-expanded={!fold.collapsed} onMouseDown={event => event.preventDefault()} onClick={() => onFold?.(fold.key)}><ChevronRight size={12} style={{ transform: fold.collapsed ? undefined : 'rotate(90deg)' }} /></button>}</div>; })}
    </div></div>
    <div className="text-code-body">
      <pre className="text-code-highlight" aria-hidden="true" style={{ paddingTop: 14 + offsets[first], width:softWrap?viewport.width:undefined, transform: `translate(${-viewport.left}px, ${-viewport.top}px)` }}>{shown.map((line, index) => {
        const color = colorful ? textLineColor(line) : undefined;
        return <span key={first + index} data-text-kind={color?.kind} data-speaker={color?.speaker} style={color?.speaker ? { '--text-speaker': speakerTextColor(color.speaker, settings, palette) } as CSSProperties : undefined} className={`text-code-line ${first + index + 1 === cursorLine ? 'active' : ''} ${issues.has(first + index + 1) ? 'has-issue' : ''}`}>{colorful ? tokens(line) : line || '\u200b'}</span>;
      })}</pre>
      {children}
    </div>
  </div>;
}
