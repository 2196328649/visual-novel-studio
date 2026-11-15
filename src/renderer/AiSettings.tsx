import { NumberInput } from './NumberInput';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import type { StudioBridge } from '../core/bridge';
import { defaultAiConfig, type AiConfig, type AiConfigView } from '../core/ai';
import { makeId } from '../core/model';
import { Field } from './components';
import { AiModelInput } from './AiModelInput';
import { aiActivityFor } from './ai-activity';
import './ai.css';

export { errorMessage as aiError } from '../core/error-message';
import { errorMessage as aiError } from '../core/error-message';

export function AiSettings({ bridge, onSaved }: { bridge: StudioBridge; onSaved?: (config: AiConfigView) => void }) {
  const desktopAi = !!bridge.getAiConfig;
  const activity = aiActivityFor(bridge);
  const activityBusy = useSyncExternalStore(activity.subscribe, activity.busy, activity.busy);
  const [config, setConfig] = useState<AiConfig>({ ...defaultAiConfig });
  const [saved, setSaved] = useState<AiConfigView>();
  const [apiKey, setKey] = useState(''), [clearKey, setClearKey] = useState(false);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]), [loadingModels, setLoadingModels] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false), [loading, setLoading] = useState(true);
  const [outdated, setOutdated] = useState(false);
  const [operation, setOperation] = useState<'save' | 'test' | 'models' | 'reset'>();
  const request = useRef<{ id: string; cancelled: boolean; kind: 'save' | 'test' | 'models' | 'reset' } | undefined>(undefined), loadVersion = useRef(0);
  const mounted = useRef(false), dirty = useRef(false), savedView = useRef<AiConfigView | undefined>(undefined);
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  const editConfig = (value: AiConfig) => { dirty.current = true; setConfig(value); };
  const acceptView = (view: AiConfigView) => {
    const { hasKey: _hasKey, keyStorage: _keyStorage, loadIssue: _loadIssue, ...value } = view;
    savedView.current = view; dirty.current = false;
    setConfig(value); setSaved(view); setKey(''); setClearKey(false); setModels([]); setReady(true); setConfirmReset(false); setOutdated(false);
    onSavedRef.current?.(view);
  };
  const receiveView = (view: AiConfigView, broadcast = false) => {
    if (!broadcast && JSON.stringify(view) === JSON.stringify(savedView.current)) return;
    if (!dirty.current) { acceptView(view); return; }
    savedView.current = view; setSaved(view); setReady(true); setConfirmReset(false); setOutdated(!view.loadIssue);
    onSavedRef.current?.(view);
  };
  const refreshStatus = async () => {
    if (!bridge.getAiConfig) return;
    const version = ++loadVersion.current;
    try {
      const view = await bridge.getAiConfig();
      if (mounted.current && version === loadVersion.current) {
        const changed = JSON.stringify(view) !== JSON.stringify(savedView.current);
        receiveView(view); return changed;
      }
    }
    catch { /* The original operation error and the reload action remain visible. */ }
  };
  const readConfig = async () => {
    if (!bridge.getAiConfig || request.current) return;
    const version = ++loadVersion.current;
    setLoading(true); setError(''); setMessage('');
    try {
      const view = await bridge.getAiConfig();
      if (mounted.current && version === loadVersion.current) acceptView(view);
    } catch (error) { if (mounted.current && version === loadVersion.current) { setReady(false); setError(aiError(error)); } }
    finally { if (mounted.current && version === loadVersion.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true;
    if (bridge.getAiConfig) void readConfig();
    else setLoading(false);
    const unsubscribe = bridge.onAiConfig?.(view => {
      if (!mounted.current || request.current && request.current.kind !== 'models') return;
      ++loadVersion.current; setLoading(false); receiveView(view, true);
    });
    return () => {
      mounted.current = false; ++loadVersion.current; unsubscribe?.();
      if (request.current) void activity.stopAll().catch(() => undefined);
    };
  }, [bridge]);
  const save = async (test: boolean) => {
    const saveConfig = bridge.saveAiConfig;
    if (!saveConfig || !ready || loading || outdated || request.current || activity.busy()) return;
    const pending = { id: makeId('ai_test'), cancelled: false, kind: test ? 'test' as const : 'save' as const }; request.current = pending;
    const current = () => mounted.current && request.current === pending;
    let configSaved = false;
    setBusy(true); setOperation(test ? 'test' : 'save'); setError(''); setMessage('');
    await activity.run(async () => { try {
      const view = await saveConfig({ ...config, apiKey: apiKey || undefined, clearKey });
      configSaved = true;
      if (!current()) return;
      acceptView(view);
      if (!current()) return;
      if (pending.cancelled) { setMessage('AI 配置已保存，连接测试已停止。'); return; }
      setMessage('AI 配置已保存。');
      if (test && bridge.testAi && current()) {
        const result = await bridge.testAi(pending.id);
        if (current()) setMessage(pending.cancelled ? 'AI 配置已保存，连接测试已停止。' : result);
      }
    } catch (error) {
      if (current()) {
        if (pending.cancelled && configSaved) setMessage('AI 配置已保存，连接测试已停止。');
        else { setMessage(''); setError(aiError(error)); await refreshStatus(); }
      }
      if (!configSaved) throw error;
    }
    finally {
      if (current() && await refreshStatus() && configSaved && test && !pending.cancelled) setMessage('连接设置已在其他窗口更新，请重新测试当前设置。');
      if (request.current === pending) { request.current = undefined; if (mounted.current) { setBusy(false); setOperation(undefined); } }
    }
    }, () => { pending.cancelled = true; return test ? bridge.cancelAi?.(pending.id) : undefined; }, { requireSuccessToClose: true }).catch(() => undefined);
  };
  const fetchModels = async () => {
    const listModels = bridge.listAiModels;
    if (!listModels || !ready || loading || outdated || request.current || activity.busy()) return;
    const pending = { id: makeId('ai_models'), cancelled: false, kind: 'models' as const }; request.current = pending;
    const current = () => mounted.current && request.current === pending;
    setBusy(true); setOperation('models'); setLoadingModels(true); setModels([]); setError(''); setMessage('');
    await activity.run(async () => { try {
      const available = await listModels(pending.id, { ...config, apiKey: apiKey || undefined, clearKey });
      if (!current()) return;
      if (pending.cancelled) { setMessage('模型列表请求已停止。'); return; }
      setModels(available);
      setMessage(available.length ? `已获取 ${available.length} 个模型，请选择或输入模型名称。` : '服务没有返回可用模型，仍可手动填写模型名称。');
    } catch (error) { if (current()) { if (pending.cancelled) setMessage('模型列表请求已停止。'); else { const message = aiError(error); setError(message.includes('手动填写') ? message : `${message} 仍可手动填写模型名称。`); await refreshStatus(); } } }
    finally { if (request.current === pending) { request.current = undefined; if (mounted.current) { setBusy(false); setLoadingModels(false); setOperation(undefined); } } }
    }, () => { pending.cancelled = true; return bridge.cancelAi?.(pending.id); });
  };
  const stopRequest = () => {
    const pending = request.current;
    if (!pending || pending.cancelled) return;
    setMessage('正在停止请求…'); setError('');
    void activity.stopAll().catch(error => { if (mounted.current) setError(aiError(error)); });
  };
  const reset = async () => {
    const resetConfig = bridge.resetAiConfig, recoveryId = saved?.loadIssue?.recoveryId;
    if (!resetConfig || !recoveryId || request.current || loading || activity.busy()) return;
    const pending = { id: makeId('ai_reset'), cancelled: false, kind: 'reset' as const }; request.current = pending;
    setBusy(true); setOperation('reset'); setError(''); setMessage('');
    await activity.run(async () => { try {
      const result = await resetConfig(recoveryId);
      if (mounted.current && request.current === pending) { acceptView(result.config); setMessage(`原配置已备份为 ${result.backupName}，可以重新填写。`); }
    } catch (error) { if (mounted.current && request.current === pending) { setError(aiError(error)); await refreshStatus(); } throw error; }
    finally {
      if (mounted.current && request.current === pending) await refreshStatus();
      if (request.current === pending) { request.current = undefined; if (mounted.current) { setBusy(false); setOperation(undefined); } }
    }
    }, undefined, { requireSuccessToClose: true }).catch(() => undefined);
  };
  const issue = saved?.loadIssue;
  const blocked = !!issue && issue.kind !== 'keyUnavailable';
  const editable = desktopAi && ready && !loading && !busy && !activityBusy && !blocked;
  const canSave = editable && !outdated && (issue?.kind !== 'keyUnavailable' || !!apiKey.trim() || clearKey);
  return <div className="ai-settings"><div className="ai-settings-heading"><h3>AI 服务</h3>{desktopAi && <button type="button" className="text-button" aria-label="重新读取配置" title="重新读取配置，会替换这里尚未保存的输入" disabled={busy || loading || activityBusy} onClick={() => void readConfig()}><RefreshCw size={13} />重新读取</button>}</div><p className="muted">填写地址、密钥和模型即可使用，支持 OpenAI 兼容接口和本地服务。</p>
    {!desktopAi && <div className="ai-mode-notice" role="alert"><strong>请在桌面版使用 AI</strong><p>浏览器模式仍可编辑和保存工程。</p></div>}
    {loading && <p role="status">正在读取 AI 配置…</p>}
    {outdated && <p className="ai-config-conflict" role="alert">配置已在其他窗口更新。这里未保存的输入已保留，请先复制需要的内容，再点“重新读取”后保存。</p>}
    {desktopAi && (issue || !ready && !loading) && <div className="ai-config-recovery" role="alert">
      <strong>{issue?.kind === 'keyUnavailable' ? '需要重新设置密钥' : 'AI 配置暂时不可用'}</strong>
      <p>{issue?.message ?? '读取失败，请重试。'}</p>
      {issue?.kind === 'keyUnavailable' && <p>重新填写密钥后保存；无密钥的服务可在“更多连接设置”中移除旧密钥。</p>}
      {issue?.canReset && bridge.resetAiConfig && !confirmReset && <div className="ai-recovery-actions"><button type="button" disabled={busy || loading || activityBusy} onClick={() => setConfirmReset(true)}>备份并重新配置</button></div>}
      {confirmReset && <div className="ai-reset-confirm"><p>先保留原配置文件，再恢复默认连接设置。聊天记录与工程不受影响。</p>
        <div className="ai-recovery-actions"><button type="button" disabled={busy || loading} onClick={() => void reset()}>{operation === 'reset' ? '正在备份…' : '确认备份并重置'}</button><button type="button" disabled={busy || loading} onClick={() => setConfirmReset(false)}>取消</button></div>
      </div>}
    </div>}
    <fieldset disabled={!editable}>
      <Field label="API 地址" hint="填写服务商提供的 API 根地址（例如 https://api.openai.com/v1），也可填写完整的 /chat/completions 地址。"><input aria-label="AI API 地址" value={config.baseUrl} onChange={event => { editConfig({ ...config, baseUrl: event.target.value }); setModels([]); }} spellCheck={false} /></Field>
      <Field label="API 密钥" hint={saved?.hasKey ? '已设置。留空保留现有密钥；更换服务域名时需要重新填写。' : '本地服务若不需要密钥，可以留空。'}><input type="password" autoComplete="off" aria-label="AI API 密钥" value={apiKey} onChange={event => { dirty.current = true; setKey(event.target.value); setClearKey(false); setModels([]); }} placeholder={saved?.hasKey && !clearKey ? '已设置，留空保留' : '按服务商要求填写'} /></Field>
      <div className="ai-model-section">
        <div className="ai-model-heading"><strong>模型</strong><button type="button" className="text-button" disabled={!bridge.listAiModels || !config.baseUrl.trim() || !!issue || outdated} onClick={() => void fetchModels()}><RefreshCw size={14} aria-hidden="true" />{loadingModels ? '正在获取模型…' : '获取模型列表'}</button></div>
        <AiModelInput value={config.model} models={models} disabled={!editable} onChange={model => editConfig({ ...config, model })} />
      </div>
      <details className="ai-connection-details"><summary>更多连接设置</summary>
      <div className="ai-setting-checks"><label><input type="checkbox" checked={config.rememberKey} onChange={event => editConfig({ ...config, rememberKey: event.target.checked })} />在本机安全保存密钥</label>{(saved?.hasKey || issue?.kind === 'keyUnavailable') && <label><input type="checkbox" checked={clearKey} onChange={event => { dirty.current = true; setClearKey(event.target.checked); setModels([]); }} />移除已保存的密钥</label>}</div>
      <div className="field-row"><Field label="请求超时（秒）"><NumberInput type="number"   value={config.timeoutSeconds} onChange={event => editConfig({ ...config, timeoutSeconds: Number(event.target.value) })} /></Field><Field label="回复格式"><select value={String(config.jsonMode)} onChange={event => editConfig({ ...config, jsonMode: event.target.value === 'true' })}><option value="true">JSON 模式（推荐）</option><option value="false">仅用提示约束 JSON</option></select></Field></div>
      <p className="muted">只有服务不支持 JSON 格式时才需更改回复格式。</p>
      <div className="ai-setting-checks"><label><input type="checkbox" checked={config.streamChat ?? true} onChange={event=>editConfig({...config,streamChat:event.target.checked})} />聊天流式回复</label></div><p className="muted">逐步显示回复；服务不支持时可关闭。</p>
      </details>
    </fieldset>
    <p className="ai-storage-note">{!desktopAi ? '密钥仅在桌面版中设置。' : saved?.keyStorage === 'session' ? '当前密钥仅本次打开有效，退出后需重新输入。' : saved?.keyStorage === 'encrypted' ? '密钥已在本机加密保存，不进入工程和游戏。' : '尚未保存密钥；本地服务可留空。'}</p>
    <div className="ai-setting-actions"><button type="button" className="small-button" disabled={!canSave} onClick={() => void save(false)}>{operation === 'save' ? '正在保存…' : '保存 AI 配置'}</button><button type="button" className="primary" disabled={!canSave || !config.model.trim()} onClick={() => void save(true)}>{operation === 'test' ? '正在连接…' : '保存并测试连接'}</button>{busy && (operation === 'test' || operation === 'models') && <button type="button" className="small-button" disabled={request.current?.cancelled} onClick={stopRequest}>停止请求</button>}</div>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="ai-error">{error}</p>}
  </div>;
}
