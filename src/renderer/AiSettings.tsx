import { NumberInput } from './NumberInput';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { StudioBridge } from '../core/bridge';
import { defaultAiConfig, type AiConfig, type AiConfigView } from '../core/ai';
import { makeId } from '../core/model';
import { Field } from './components';
import './ai.css';

export { errorMessage as aiError } from '../core/error-message';
import { errorMessage as aiError } from '../core/error-message';

export function AiSettings({ bridge, onSaved }: { bridge: StudioBridge; onSaved?: (config: AiConfigView) => void }) {
  const desktopAi = !!bridge.getAiConfig;
  const [config, setConfig] = useState<AiConfig>({ ...defaultAiConfig });
  const [saved, setSaved] = useState<AiConfigView>();
  const [apiKey, setKey] = useState(''), [clearKey, setClearKey] = useState(false);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]), [loadingModels, setLoadingModels] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const request = useRef<string | undefined>(undefined);
  useEffect(() => {
    let mounted = true;
    if (!bridge.getAiConfig) { setError('当前是浏览器编辑模式，AI 助手和模型列表需要桌面版。'); return; }
    void bridge.getAiConfig().then(view => { if (mounted) { const { hasKey, keyStorage, ...config } = view; setConfig(config); setSaved(view); setReady(true); } }).catch(error => { if (mounted) setError(aiError(error)); });
    return () => { mounted = false; if (request.current) void bridge.cancelAi?.(request.current); };
  }, [bridge]);
  const save = async (test: boolean) => {
    if (!bridge.saveAiConfig) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const view = await bridge.saveAiConfig({ ...config, apiKey: apiKey || undefined, clearKey });
      setSaved(view); setKey(''); setClearKey(false); onSaved?.(view);
      setMessage('AI 配置已保存。');
      if (test && bridge.testAi) { const id = makeId('ai_test'); request.current = id; setMessage(await bridge.testAi(id)); }
    } catch (error) { setError(aiError(error)); }
    finally { request.current = undefined; setBusy(false); }
  };
  const fetchModels = async () => {
    if (!bridge.listAiModels || busy) return;
    const id = makeId('ai_models'); request.current = id;
    setBusy(true); setLoadingModels(true); setModels([]); setError(''); setMessage('');
    try {
      const available = await bridge.listAiModels(id, { ...config, apiKey: apiKey || undefined, clearKey });
      setModels(available);
      setMessage(available.length ? `已获取 ${available.length} 个模型，请选择或输入模型名称。` : '服务没有返回可用模型，仍可手动填写模型名称。');
    } catch (error) { const message = aiError(error); setError(message.includes('手动填写') ? message : `${message} 仍可手动填写模型名称。`); }
    finally { request.current = undefined; setBusy(false); setLoadingModels(false); }
  };
  return <div className="ai-settings"><h3>AI 服务</h3><p className="muted">使用你自己的 API 服务与模型。当前接口为 OpenAI 兼容的 Chat Completions，也支持本地服务。</p>
    {!desktopAi && <div className="ai-mode-notice" role="alert"><strong>当前是浏览器编辑模式</strong><p>浏览器模式可以继续编辑和保存工程，但不会读取或保存 API 密钥，也不能调用 AI。请运行桌面版后，在这里使用“获取模型列表”。</p></div>}
    <fieldset disabled={!desktopAi || !ready || busy}>
      <Field label="API 地址" hint="填写服务商提供的 API 根地址（例如 https://api.openai.com/v1），也可填写完整的 /chat/completions 地址。"><input aria-label="AI API 地址" value={config.baseUrl} onChange={event => { setConfig({ ...config, baseUrl: event.target.value }); setModels([]); }} spellCheck={false} /></Field>
      <Field label="API 密钥" hint={saved?.hasKey ? '已设置。留空保留现有密钥；更换服务域名时需要重新填写。' : '本地服务若不需要密钥，可以留空。'}><input type="password" autoComplete="off" aria-label="AI API 密钥" value={apiKey} onChange={event => { setKey(event.target.value); setClearKey(false); setModels([]); }} placeholder={saved?.hasKey && !clearKey ? '已设置，留空保留' : '按服务商要求填写'} /></Field>
      <div className="ai-model-section">
        <div className="ai-model-heading"><strong>模型列表</strong><button type="button" className="small-button" disabled={!bridge.listAiModels || !config.baseUrl.trim()} onClick={() => void fetchModels()}><RefreshCw size={15} aria-hidden="true" />{loadingModels ? '正在获取模型…' : '获取模型列表'}</button></div>
        <select aria-label="可用模型" disabled={!models.length} value={models.includes(config.model) ? config.model : ''} onChange={event => { if (event.target.value) setConfig({ ...config, model: event.target.value }); }}><option value="">{loadingModels ? '正在获取模型…' : models.length ? `选择模型（${models.length} 个）` : '暂无模型，请先点击“获取模型列表”'}</option>{models.map(model => <option key={model} value={model}>{model}</option>)}</select>
        <p className="muted">填好 API 地址和密钥即可获取，无需先保存。选择后会填入下方模型名称，也可以手动填写。</p>
      </div>
      <Field label="模型名称"><input aria-label="AI 模型名称" value={config.model} onChange={event => setConfig({ ...config, model: event.target.value })} placeholder="从上方列表选择，或手动填写模型 ID" spellCheck={false} /></Field>
      <div className="ai-setting-checks"><label><input type="checkbox" checked={config.rememberKey} onChange={event => setConfig({ ...config, rememberKey: event.target.checked })} />在本机安全保存密钥</label>{saved?.hasKey && <label><input type="checkbox" checked={clearKey} onChange={event => { setClearKey(event.target.checked); setModels([]); }} />移除已保存的密钥</label>}</div>
      <div className="field-row"><Field label="请求超时（秒）"><NumberInput type="number"   value={config.timeoutSeconds} onChange={event => setConfig({ ...config, timeoutSeconds: Number(event.target.value) })} /></Field><Field label="回复格式"><select value={String(config.jsonMode)} onChange={event => setConfig({ ...config, jsonMode: event.target.value === 'true' })}><option value="true">JSON 模式（推荐）</option><option value="false">仅用提示约束 JSON</option></select></Field></div>
      <p className="muted">如果服务不支持 response_format，选择“仅用提示约束 JSON”。测试连接只发送测试短句。</p>
      <div className="ai-setting-checks"><label><input type="checkbox" checked={config.streamChat ?? true} onChange={event=>setConfig({...config,streamChat:event.target.checked})} />聊天流式回复</label></div><p className="muted">逐步显示聊天回复。若兼容服务不支持 stream 或 stream_options，请关闭。</p>
    </fieldset>
    <p className="ai-storage-note">{!desktopAi ? '浏览器模式不会读取或保存 API 密钥。' : saved?.keyStorage === 'session' ? '密钥仅保留在本次编辑器会话；退出后需要重新输入。' : '密钥使用系统加密保存在本机，不进入工程、自动保存或导出的游戏。'}</p>
    <div className="ai-setting-actions"><button type="button" className="small-button" disabled={!ready || busy} onClick={() => void save(false)}>保存 AI 配置</button><button type="button" className="primary" disabled={!ready || busy || !config.model.trim()} onClick={() => void save(true)}>{busy && !loadingModels ? '正在连接…' : '保存并测试连接'}</button>{busy && <button type="button" className="small-button" onClick={() => { if (request.current) void bridge.cancelAi?.(request.current); }}>停止请求</button>}</div>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="ai-error">{error}</p>}
  </div>;
}
