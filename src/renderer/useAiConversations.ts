import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { StudioBridge } from '../core/bridge';
import type { AiConversation, AiConversationList, AiConversationSummary, SavedAiMessage } from '../core/ai-conversations';
import { makeId } from '../core/model';

type Session<T extends SavedAiMessage> = Omit<AiConversation, 'messages'> & { messages: T[] };
type SessionHolder<T extends SavedAiMessage> = { value: Session<T> };

export function useAiConversations<T extends SavedAiMessage>(projectId: string, bridge: StudioBridge, serialize: (message: T) => SavedAiMessage) {
  const [value, setValue] = useState<Session<T>>(), [list, setList] = useState<AiConversationList>({ items: [], unreadable: 0 });
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false), [loadAttempt, setLoadAttempt] = useState(0);
  const latest = useRef<SessionHolder<T> | undefined>(undefined), mounted = useRef(true), version = useRef(0), generation = useRef(0);
  const lastWrite = useRef<{ session: Session<T>; task: Promise<void> } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const packed = (session: Session<T>): AiConversation => ({ ...session, messages: session.messages.map(serialize) });
  const summary = (session: Session<T>): AiConversationSummary => ({ id: session.id, title: session.title, updatedAt: session.updatedAt, pinned: session.pinned, count: session.messages.length, preview: session.messages.map(item => item.content).join('\n').slice(0, 100000) });
  const fresh = (): Session<T> => ({ version: 1, id: makeId('chat'), projectId, title: '新会话', createdAt: Date.now(), updatedAt: Date.now(), mode: 'edit', includeHistory: true, draft: '', messages: [] });
  const update = (session: Session<T>) => {
    const holder = latest.current;
    if (holder && holder.value.id === session.id && holder.value.projectId === session.projectId) holder.value = session;
    else latest.current = { value: session };
    if (mounted.current) setValue(session);
  };
  const save = useCallback((session: Session<T>) => {
    if (!bridge.saveAiConversation) return Promise.resolve();
    if (lastWrite.current?.session === session) return lastWrite.current.task;
    const sequence = ++version.current, epoch = generation.current;
    if (mounted.current) setSaving(true);
    let task: Promise<void>;
    try { task = bridge.saveAiConversation({ ...session, messages: session.messages.map(serialize) }); }
    catch (error) { task = Promise.reject(error); }
    lastWrite.current = { session, task };
    void task.then(() => {
      if (mounted.current && epoch === generation.current) {
        setList(current => ({ ...current, items: [summary(session), ...current.items.filter(item => item.id !== session.id)] }));
        if (sequence === version.current) { setSaving(false); setError(''); }
      }
    }, error => {
      if (lastWrite.current?.session === session) lastWrite.current = undefined;
      if (mounted.current && epoch === generation.current && sequence === version.current) { setSaving(false); setError('聊天记录未保存：' + String(error)); }
    });
    return task;
  }, [bridge, serialize]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); if (latest.current) void save(latest.current.value).catch(() => {}); };
  }, [save]);
  useEffect(() => {
    const epoch = ++generation.current;
    let active = true;
    setReady(false); setError('');
    void (async () => {
      try {
        const result = await bridge.listAiConversations?.(projectId) ?? { items: [], unreadable: 0 };
        const session = result.activeId ? await bridge.readAiConversation?.(projectId, result.activeId) : undefined;
        if (active && epoch === generation.current) { setList(result); update((session ?? fresh()) as Session<T>); setReady(true); }
      } catch (error) { if (active && epoch === generation.current) setError('无法读取聊天记录：' + String(error)); }
    })();
    return () => { active = false; };
  }, [projectId, bridge, loadAttempt]);
  useEffect(() => {
    if (ready && value?.projectId === projectId) {
      if (lastWrite.current?.session !== value) setSaving(!!bridge.saveAiConversation);
      timer.current = setTimeout(() => { void save(value).catch(() => {}); }, 200);
    }
    return () => clearTimeout(timer.current);
  }, [ready, value, projectId, save, bridge]);
  // A running request owns its source holder even after the component unmounts.
  // Its final partial reply can never be written into a newly selected session.
  const capture = () => {
    const holder = latest.current;
    if (!holder) return undefined;
    return {
      get: () => holder.value,
      setHistory: (action: SetStateAction<T[]>) => {
        const messages = typeof action === 'function' ? action(holder.value.messages) : action;
        holder.value = { ...holder.value, messages, updatedAt: Date.now() };
        if (latest.current === holder && mounted.current) setValue(holder.value);
      },
      flush: () => { if (latest.current === holder) clearTimeout(timer.current); return save(holder.value); },
    };
  };
  const flush = async () => { clearTimeout(timer.current); if (latest.current) await save(latest.current.value); };
  const isCurrent = (holder: SessionHolder<T> | undefined, epoch: number) => mounted.current && latest.current === holder && generation.current === epoch;
  const refresh = async () => {
    const holder = latest.current, epoch = generation.current;
    await flush();
    const result = await bridge.listAiConversations?.(projectId);
    if (result && isCurrent(holder, epoch)) setList(result);
  };
  const change = (patch: Partial<Session<T>>) => { if (latest.current) update({ ...latest.current.value, ...patch, updatedAt: Date.now() }); };
  const setHistory = (action: SetStateAction<T[]>) => capture()?.setHistory(action);
  const select = async (id: string) => {
    const holder = latest.current, epoch = generation.current;
    await flush();
    if (!isCurrent(holder, epoch) || !bridge.readAiConversation) return;
    const next = await bridge.readAiConversation(projectId, id);
    if (isCurrent(holder, epoch)) update(next as Session<T>);
  };
  const create = async () => { const holder = latest.current, epoch = generation.current; await flush(); if (isCurrent(holder, epoch)) update(fresh()); };
  const fork = async (messages: T[], stillActive: () => boolean = () => true) => {
    const holder = latest.current, epoch = generation.current;
    await flush();
    if (!isCurrent(holder, epoch) || !stillActive()) return;
    const source = holder?.value;
    update({ ...fresh(), title: (source?.title ?? '会话').slice(0, 110) + ' · 分支', mode: source?.mode ?? 'edit', includeHistory: source?.includeHistory ?? true, draft: source?.draft ?? '', messages: messages.map(message => source?.messages.find(item => item.id === message.id) ?? message) });
  };
  const remove = async () => {
    const holder = latest.current, epoch = generation.current;
    await flush();
    if (!holder || !isCurrent(holder, epoch) || !bridge.deleteAiConversation) return;
    await bridge.deleteAiConversation(projectId, holder.value.id);
    const result = await bridge.listAiConversations!(projectId);
    const next = result.activeId ? await bridge.readAiConversation!(projectId, result.activeId) : fresh();
    if (isCurrent(holder, epoch)) { setList(result); update(next as Session<T>); }
  };
  const recover = async () => {
    const holder = latest.current, epoch = generation.current;
    if (!holder || !bridge.exportAiConversationBackup || !bridge.saveAiConversation) return false;
    clearTimeout(timer.current);
    const source = holder.value;
    if (!await bridge.exportAiConversationBackup(packed(source))) return false;
    if (!isCurrent(holder, epoch) || holder.value !== source) throw new Error('会话内容已变化，最新内容仍保留。请重新导出后新建。');
    const next = fresh();
    // Persist the replacement before changing selection. A failed write leaves
    // the full source, draft and successful backup available for another try.
    await save(next);
    if (!isCurrent(holder, epoch) || holder.value !== source) throw new Error('会话内容已变化，请重新导出后新建。');
    update(next);
    return true;
  };
  const visibleList = { ...list, items: (value ? [summary(value), ...list.items.filter(item => item.id !== value.id)] : list.items).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt) };
  return { value, history: value?.messages ?? [], setHistory, prompt: value?.draft ?? '', setPrompt: (draft: string) => change({ draft }), change, ready, error, saving, list: visibleList, refresh, select, create, fork, remove, recover, retryLoad: () => setLoadAttempt(attempt => attempt + 1), flush, capture, packed: () => latest.current ? packed(latest.current.value) : undefined };
}
