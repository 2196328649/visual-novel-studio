import { NumberInput } from './NumberInput';
import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Download, Folder, FolderOpen, Info, LoaderCircle, Monitor, RefreshCw, Smartphone, Square } from 'lucide-react';
import type { Project } from '../core/model';
import type { ExportCheck, ExportSetupProgress, ExportTool, StudioBridge } from '../core/bridge';
import { exportDiagnostics, exportSettings, exportSettingsSchema, joinExportLocation, splitExportLocation, type ExportSettings } from '../core/export-settings';
import type { Commit } from './editor';
import { Field, IconButton } from './components';
import { UiAssetSelect } from './AssetPicker';
import { GameIconPreview } from './GameIconPreview';

export function ExportSettingsPanel({ project, commit, bridge, assetUrl, onReady }: {
  project: Project; commit: Commit; bridge: StudioBridge; assetUrl: (id?: string) => string | undefined; onReady: (ready: boolean) => void;
}) {
  const settings = exportSettings(project);
  const appearance = settings[settings.platform];
  const locationSource = (directory: string, fileName: string) => JSON.stringify([project.id, project.name, settings.platform, directory, fileName]);
  const [locationDraft, setLocationDraft] = useState<{ source: string; text: string }>();
  const locationInput = useRef<HTMLInputElement>(null);
  const [selectLocation, setSelectLocation] = useState<string>();
  const source = locationSource(settings.directory, project.exportSettings?.fileName ?? '');
  const location = locationDraft?.source === source ? locationDraft.text : settings.platform === 'windows'
    ? settings.directory ? joinExportLocation(settings.directory, settings.fileName) : project.exportSettings?.fileName ?? ''
    : settings.directory;
  useEffect(() => {
    const input = locationInput.current;
    if (!input || !selectLocation || location !== selectLocation) return;
    input.focus(); input.setSelectionRange(Math.max(location.lastIndexOf('/'), location.lastIndexOf('\\')) + 1, location.length); input.scrollLeft = input.scrollWidth;
    setSelectLocation(undefined);
  }, [location, selectLocation]);
  const [environment, setEnvironment] = useState<ExportCheck>();
  const [checking, setChecking] = useState(true);
  const [revision, refresh] = useState(0);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [setup, setSetup] = useState<ExportSetupProgress>();
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const configuring = starting || !!setup?.running;
  useEffect(() => {
    let active = true, received = false;
    const unsubscribe = bridge.onExportSetupProgress?.(progress => { received = true; if (active) setSetup(progress); });
    void bridge.exportSetupStatus?.().then(progress => { if (active && !received) setSetup(progress); }).catch(() => undefined);
    return () => { active = false; unsubscribe?.(); };
  }, [bridge]);
  useEffect(() => { setAccepted(false); }, [settings.platform]);
  const needsSpine = project.assets.some(asset => asset.kind === 'spine');
  const diagnostics = exportDiagnostics(project);
  const configurationValid = !diagnostics.length;
  useEffect(() => {
    let active = true;
    if (!configurationValid || configuring) { setChecking(false); return; }
    setChecking(true); setError('');
    bridge.checkExport(project).then(result => { if (active) setEnvironment(result); }, reason => { if (active) { setEnvironment(undefined); setError(String(reason)); } }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [bridge, project.id, settings.platform, settings.windows.format, needsSpine, revision, configurationValid, configuring]);
  const ready = !configuring && !checking && !diagnostics.length && environment?.platform === settings.platform && environment.ready;
  const needsConsent = settings.platform === 'android' && (environment?.platform !== 'android' || environment.checks.some(item => ['androidSdk', 'androidBuildTools'].includes(item.id) && item.status !== 'ready'));
  const visibleSetup = setup?.platform === settings.platform && setup.phase !== 'idle' ? setup : undefined;
  useEffect(() => onReady(!!ready), [onReady, ready]);
  const update = (label: string, edit: (settings: ExportSettings) => void) => commit(label, draft => {
    const next = exportSettingsSchema.parse(draft.exportSettings ?? {}); edit(next); draft.exportSettings = next;
  });
  const openTool = async (tool: ExportTool) => {
    setOpening(true); setError('');
    try { await bridge.openExportTool?.(tool, project); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setOpening(false); }
  };
  const configure = async () => {
    if (!bridge.setupExport) return;
    setStarting(true); setCancelling(false); setError('');
    try {
      const result = await bridge.setupExport(project, { acceptAndroidLicense: accepted });
      if (result.check) setEnvironment(result.check);
      if (!result.ok && !result.cancelled) setError(result.error ?? '环境配置未完成，请查看详细记录。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setStarting(false); setCancelling(false); refresh(value => value + 1); }
  };
  const cancel = async () => {
    setCancelling(true);
    try { await bridge.cancelExportSetup?.(); }
    catch (reason) { setError(String(reason)); setCancelling(false); }
  };
  return <>
    <h3>游戏导出</h3><p className="muted">配置随工程保存。点击「导出」开始构建游戏。</p>
    <fieldset className="export-fields" disabled={configuring}>
    <div className="export-platforms" role="group" aria-label="导出平台">
      <button type="button" aria-pressed={settings.platform === 'windows'} onClick={() => update('导出平台', next => { next.platform = 'windows'; })}><Monitor size={23} /><span><strong>Windows</strong><small>64 位 · ZIP / 单 EXE</small></span></button>
      <button type="button" aria-pressed={settings.platform === 'android'} onClick={() => update('导出平台', next => { next.platform = 'android'; })}><Smartphone size={23} /><span><strong>Android</strong><small>APK 安装包 / AAB</small></span></button>
    </div>
    <div className="field-row">
      {settings.platform === 'windows' && <Field label="Windows 打包格式"><select aria-label="Windows 打包格式" value={settings.windows.format} onChange={event => update('Windows 打包格式', next => { next.windows.format = event.target.value as 'zip' | 'exe'; })}><option value="zip">ZIP · 解压后运行</option><option value="exe">单 EXE · 双击运行</option></select></Field>}
      <Field label="游戏版本" hint="与作品信息中的版本同步，例如 1.0.0。"><input value={project.version} maxLength={32} onChange={event => commit('作品版本', draft => { draft.version = event.target.value; })} /></Field>
      {settings.platform === 'android' && <Field label="安装包格式"><select value={settings.android.format} onChange={event => update('Android 安装包格式', next => { next.android.format = event.target.value as 'apk' | 'aab'; })}><option value="apk">APK · 直接安装到手机</option><option value="aab">AAB · 提交 Google Play</option></select></Field>}
    </div>
    {settings.platform === 'windows' && settings.windows.format === 'exe' && <p className="muted">只需分发一个 EXE。每次启动会将引擎和素材释放到临时目录，游戏退出后清理；需要额外磁盘空间，启动比 ZIP 版稍慢。存档保存在用户目录，退出后仍保留。</p>}
    <div className="export-location-row">
      <Field label="导出文件位置" hint={settings.platform === 'windows' ? '填写“文件夹路径\\导出名称”，末尾是文件名，不用填写扩展名；名称留空使用作品名。' : '选择导出文件夹；未选择时，点击导出会先选择位置。'}><input ref={locationInput} value={location} title={location} placeholder={settings.platform === 'windows' ? `选择文件夹\\${settings.fileName}` : '选择导出文件夹'} onBlur={() => setLocationDraft(undefined)} onChange={event => {
        const text = event.target.value, parts = settings.platform === 'windows' ? splitExportLocation(text) : { directory: text, fileName: project.exportSettings?.fileName ?? '' };
        setLocationDraft({ source: locationSource(parts.directory, parts.fileName), text });
        update('导出文件位置', next => { Object.assign(next, parts); });
      }} /></Field>
      <IconButton title="选择位置" disabled={!bridge.chooseExportDirectory} onClick={async () => { try { const directory = await bridge.chooseExportDirectory?.(settings.directory); if (directory) {
        setLocationDraft(undefined); update('导出文件位置', next => { next.directory = directory; });
        if (settings.platform === 'windows') setSelectLocation(joinExportLocation(directory, settings.fileName));
      } } catch (reason) { setError(String(reason)); } }}><Folder size={18} /></IconButton>
      <IconButton title="打开位置" disabled={!settings.directory.trim() || !bridge.openExportDirectory} onClick={async () => { try { await bridge.openExportDirectory?.(settings.directory.trim()); } catch (reason) { setError(String(reason)); } }}><FolderOpen size={18} /></IconButton>
    </div>
    <Field label="游戏图标" hint="选择 PNG 图片，建议使用正方形图标。Windows 图标和 Android 启动图标会自动生成。"><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" category="all" allowedIds={project.assets.filter(asset => /\.png$/i.test(asset.path)).map(asset => asset.id)} importExtensions={["png"]} label="游戏图标" value={settings.iconAssetId} empty="使用默认图标" onChange={id => update('游戏图标', next => { next.iconAssetId = id; })} /></Field>
    <fieldset className="icon-appearance-fields"><legend>{settings.platform === 'windows' ? 'Windows' : 'Android'} 图标调整</legend>
      <div className="field-row">
        <Field label="图标缩放 %"><NumberInput type="number" min={10} max={200} value={appearance.iconScale * 100} onChange={event => update('图标缩放', next => { next[next.platform].iconScale = Math.max(.1, Math.min(2, Number(event.target.value) / 100)); })} /></Field>
        <Field label="图标水平位置 %" hint="0 为居中，正值向右。"><NumberInput type="number" min={-100} max={100} value={appearance.iconX * 100} onChange={event => update('图标水平位置', next => { next[next.platform].iconX = Math.max(-1, Math.min(1, Number(event.target.value) / 100)); })} /></Field>
        <Field label="图标垂直位置 %" hint="0 为居中，正值向下。"><NumberInput type="number" min={-100} max={100} value={appearance.iconY * 100} onChange={event => update('图标垂直位置', next => { next[next.platform].iconY = Math.max(-1, Math.min(1, Number(event.target.value) / 100)); })} /></Field>
      </div>
      <div className="field-row">
        <Field label="图标背景"><select value={appearance.iconBackgroundMode} onChange={event => update('图标背景', next => { next[next.platform].iconBackgroundMode = event.target.value as 'transparent' | 'solid'; })}><option value="transparent">透明</option><option value="solid">纯色</option></select></Field>
        {appearance.iconBackgroundMode === 'solid' && <Field label="图标背景颜色"><input type="color" value={appearance.iconBackground} onChange={event => update('图标背景颜色', next => { next[next.platform].iconBackground = event.target.value; })} /></Field>}
        <button type="button" className="small-button" onClick={() => update('重置图标位置和大小', next => { Object.assign(next[next.platform], { iconScale: 1, iconX: 0, iconY: 0 }); })}>重置大小与位置</button>
      </div>
      {settings.platform === 'android' && <p className="muted">虚线表示图案安全区域。超出后可能被桌面裁切；透明背景的最终显示由手机桌面决定。</p>}
    </fieldset>
    <GameIconPreview source={assetUrl(settings.iconAssetId)} settings={settings} />
    {settings.platform === 'windows' ? <p className="export-output-preview">输出：<code>{settings.fileName}-{project.version}-win.zip</code><small>解压后运行 {settings.fileName}.exe，无需另外安装运行时。</small></p> : <>
      <Field label="Android 包名" hint="应用的唯一标识，例如 com.example.mystory；发布后保持不变。"><input value={project.exportSettings?.android.packageName ?? ''} placeholder={`com.vns.${project.id}`} maxLength={180} spellCheck={false} onChange={event => update('Android 包名', next => { next.android.packageName = event.target.value; })} /></Field>
      <div className="field-row">
        <Field label="屏幕方向"><select value={settings.android.orientation} onChange={event => update('Android 屏幕方向', next => { next.android.orientation = event.target.value as ExportSettings['android']['orientation']; })}><option value="landscape">横屏</option><option value="portrait">竖屏</option><option value="auto">跟随设备旋转</option></select></Field>
        <Field label="版本代码下限" hint="Ren’Py 会取此值与构建时间戳的较大值。"><NumberInput type="number"   step={1} value={settings.android.versionCode} onChange={event => update('Android 版本代码', next => { next.android.versionCode = Number(event.target.value); })} /></Field>
      </div>
      <div className="field-row">
        <Field label="允许联网" hint="启用后申请网络权限。"><input type="checkbox" checked={settings.android.internet} onChange={event => update('Android 网络权限', next => { next.android.internet = event.target.checked; })} /></Field>
      </div>
    </>}
    </fieldset>
    {diagnostics.length > 0 && <ul className="export-errors" role="alert">{diagnostics.map(d => <li key={d.message}>{d.message}</li>)}</ul>}
    <div className="export-check-heading"><h4>导出环境</h4><button type="button" className="small-button" disabled={checking || configuring} onClick={() => refresh(value => value + 1)}>{checking ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}{checking ? '检查中' : '重新检查'}</button></div>
    {bridge.setupExport && <div className="export-setup">
      <p>{settings.platform === 'windows' ? 'Windows 运行时已随编辑器提供。点击一次即可检查并修复，完成后直接导出。' : '自动准备 Android 导出所需工具。首次配置和首次导出需要联网，已下载的工具可以复用。'}</p>
      {needsConsent && <label className="export-license"><input type="checkbox" checked={accepted} disabled={configuring} onChange={event => setAccepted(event.target.checked)} /><span>我已阅读并同意 <button type="button" className="text-button" onClick={() => void openTool('androidLicense')}>Android SDK 许可协议</button>，允许下载所需工具。</span></label>}
      <div className="settings-inline-actions">
        <button type="button" className="primary" disabled={checking || configuring || !configurationValid || (needsConsent && !accepted)} onClick={() => void configure()}>{configuring ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}{configuring ? '正在配置…' : visibleSetup?.phase === 'failed' || visibleSetup?.phase === 'cancelled' ? '重试配置' : '一键配置'}</button>
        {configuring && <button type="button" className="small-button" disabled={cancelling} onClick={() => void cancel()}><Square size={13} />{cancelling ? '正在取消…' : '取消配置'}</button>}
        {ready && <span className="export-ready"><Check size={15} />可以导出</span>}
      </div>
      {visibleSetup && <div className="export-setup-progress" role="status" aria-live="polite">
        <span>{visibleSetup.message}</span>
        {configuring && <progress aria-label="环境配置进度" max={visibleSetup.totalBytes ?? 1} value={visibleSetup.totalBytes ? visibleSetup.receivedBytes ?? 0 : undefined} />}
        {configuring && visibleSetup.totalBytes && <small>{((visibleSetup.receivedBytes ?? 0) / 1048576).toFixed(1)} / {(visibleSetup.totalBytes / 1048576).toFixed(1)} MB</small>}
      </div>}
      {visibleSetup?.log && <details className="export-setup-log"><summary>详细记录</summary><pre>{visibleSetup.log}</pre></details>}
    </div>}
    {!checking && environment?.platform === settings.platform && <ul className="export-checks" aria-label="导出环境检查">{environment.checks.map(check => <li key={check.id} data-status={check.status}>{check.status === 'ready' ? <Check size={16} /> : check.status === 'missing' ? <CircleAlert size={16} /> : <Info size={16} />}<span><strong>{check.label}</strong><small>{check.detail}</small></span></li>)}</ul>}
    {settings.platform === 'android' && bridge.openExportTool && <details className="export-advanced"><summary>高级工具与帮助</summary><div className="settings-inline-actions export-tools"><button type="button" className="small-button" disabled={opening || configuring} onClick={() => void openTool('androidSetup')}>打开 Ren’Py 启动器</button><button type="button" className="small-button" disabled={opening} onClick={() => void openTool('signing')}>打开签名文件夹</button><button type="button" className="text-button" disabled={opening} onClick={() => void openTool('androidHelp')}>Android 安装说明</button></div></details>}
    {error && <p className="export-errors" role="alert">{error}</p>}
  </>;
}
