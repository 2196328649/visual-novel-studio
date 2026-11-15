import { NumberInput } from './NumberInput';
import { useEffect, useRef, useState } from 'react';
import { AnimationState, AnimationStateData, AtlasAttachmentLoader, GLTexture, Physics, SceneRenderer, Skeleton, SkeletonJson, TextureAtlas } from '@esotericsoftware/spine-webgl';
import type { Asset, SpinePlayback } from '../core/model';
import { uiSpineSpeedProblem, uiSpineSpeedRange, type UiSpineRequest, type UiSpineReport } from '../core/ui-spine';
import { spinePlacement } from '../core/spine';
import { browserBridge } from './browserBridge';
import { Field } from './components';
import { useSpineSpeedInput } from './SpineSpeedInput';

export interface UiSpineFeedback { request: UiSpineRequest; onReport: (report: UiSpineReport) => void }
/** One real runtime per component. Skin/loop/placement changes never replace its
 * track. Only a new source, animation or explicit restart resets the pose. */
export function SpinePreview({ asset, settings = {}, width = 640, height = 360, paused, restart = 0, feedback }: {
  asset?: Asset; settings?: SpinePlayback; width?: number; height?: number; paused?: boolean; restart?: number; feedback?: UiSpineFeedback;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ settings, paused, feedback, width, height }); current.current = { settings, paused, feedback, width, height };
  const [error, setError] = useState('');
  useEffect(() => {
    const element = canvas.current;
    if (!element || !asset?.spine) return;
    let cancelled = false, frame = 0, sample = 0, reportKey = '', reportStatus = '', lastReport = -Infinity;
    let renderer: SceneRenderer | undefined;
    const textures: GLTexture[] = [];
    element.dataset.spineState = 'loading'; setError('');
    const url = (relative: string) => (window.studio ?? browserBridge).assetUrl(relative);
    const report = (status: UiSpineReport['status'], position: number, duration: number, durationKnown: boolean, message = '', now = performance.now()) => {
      const owner = current.current.feedback, r = owner?.request;
      if (!owner || !r || r.assetId !== asset.id || cancelled) return;
      const key = [r.pageInstance, r.sourceSequence, r.sequence].join(':');
      if (key !== reportKey) { reportKey = key; reportStatus = ''; sample = r.lastSample; lastReport = -Infinity; }
      const changed = status !== reportStatus;
      if (!changed && (status !== 'playing' || now - lastReport < 200)) return;
      sample = Math.max(sample, r.lastSample) + 1; lastReport = now;
      const kind = !changed && status === 'playing' ? 'progress' : status; reportStatus = status;
      owner.onReport({ pageInstance: r.pageInstance, assetId: r.assetId, sourceSequence: r.sourceSequence, sequence: r.sequence, sample, animation: r.animation, status: kind, position, duration, durationKnown, error: message });
    };
    const fail = (reason: unknown) => {
      if (cancelled) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      element.dataset.spineState = 'failed'; setError(message); report('failed', 0, 0, false, message);
    };
    const load = async () => {
      const gl = element.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: true });
      if (!gl) throw new Error('此设备未能创建动画预览，请检查显卡加速设置。');
      renderer = new SceneRenderer(element, gl, true);
      const loadText = async (relative: string) => {
        const response = await fetch(url(relative));
        if (!response.ok) throw new Error('骨骼素材配套文件读取失败。');
        return response.text();
      };
      const [atlasText, json] = await Promise.all([loadText(asset.spine!.atlasPath), loadText(asset.path)]);
      if (cancelled) return;
      const atlas = new TextureAtlas(atlasText);
      for (const page of atlas.pages) {
        const metadata = asset.spine!.pages.find(item => item.name === page.name);
        if (!metadata) throw new Error('缺少图集图片：' + page.name);
        const image = new window.Image(); image.crossOrigin = 'anonymous'; image.src = url(metadata.path); await image.decode();
        if (cancelled) return;
        const texture = new GLTexture(gl, image); textures.push(texture); page.setTexture(texture);
      }
      const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(json));
      const skeleton = new Skeleton(data), state = new AnimationState(new AnimationStateData(data));
      let source = '', activeSkin: string | undefined, last: number | undefined, completed = false, command = '', speedError = '';
      state.addListener({ complete: entry => { if (!entry.loop && entry === state.getCurrent(0)) completed = true; } });
      const draw = (now: number) => {
        if (cancelled || !renderer) return;
        try {
          const c = current.current, s = c.settings, r = c.feedback?.request;
          if (r && r.assetId !== asset.id) { frame = requestAnimationFrame(draw); return; }
          const animation = r?.animation ?? s.animation ?? data.animations[0]?.name ?? '';
          const skin = r?.skin ?? s.skin ?? '', loop = r?.loop ?? s.loop ?? true, speed = r?.speed ?? s.speed ?? 1;
          const speedProblem = uiSpineSpeedProblem(speed);
          if (speedProblem) {
            // Invalid older data remains editable. Keep the current track and
            // frame subscription so correcting the speed resumes without replay.
            last = undefined;
            if (speedError !== speedProblem) { speedError = speedProblem; fail(speedProblem); }
            frame = requestAnimationFrame(draw); return;
          }
          if (speedError) { speedError = ''; setError(''); last = undefined; }
          const nextSource = JSON.stringify([r?.pageInstance, r?.sourceSequence, animation]);
          if (source !== nextSource) {
            source = nextSource; state.clearTracks(); skeleton.setToSetupPose(); completed = false; activeSkin = undefined; last = undefined;
            if (animation) {
              const track = state.setAnimation(0, animation, loop);
              // Save restoration is internal, not an author-visible seek operation.
              const duration = track.animationEnd - track.animationStart;
              track.trackTime = duration > 0 ? loop ? (r?.position ?? 0) % duration : Math.min(r?.position ?? 0, duration) : 0;
            }
          }
          if (skin !== activeSkin) {
            const selected = skin ? data.findSkin(skin) : data.defaultSkin;
            if (skin && !selected) throw new Error('当前骨骼素材没有所选皮肤。');
            skeleton.setSkin(selected); skeleton.setSlotsToSetupPose(); activeSkin = skin;
          }
          const track = state.getCurrent(0);
          if (track && track.loop !== loop && !completed) {
            const at = track.getAnimationTime() - track.animationStart;
            track.trackTime = at; track.trackLast = at; track.nextTrackLast = at;
            track.animationLast = track.getAnimationTime(); track.nextAnimationLast = track.animationLast;
            track.loop = loop;
          }
          const nextCommand = r ? [r.pageInstance, r.sourceSequence, r.sequence].join(':') : '';
          if (command !== nextCommand) { command = nextCommand; last = undefined; }
          const stopped = !!(c.paused ?? (r ? r.paused || r.suspended : !(s.autoplay ?? true))) || speed === 0;
          const delta = stopped || completed || last === undefined ? 0 : Math.min(.1, Math.max(0, (now - last) / 1000)) * speed;
          last = now;
          state.update(delta); state.apply(skeleton); skeleton.update(delta); skeleton.updateWorldTransform(Physics.update);
          const w = Math.max(1, c.width), h = Math.max(1, c.height);
          renderer.camera.position.set(w / 2, h / 2, 0); renderer.camera.setViewport(w, h); renderer.camera.update();
          const p = spinePlacement(asset, s, w, h), angle = p.rotation * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
          gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          renderer.begin();
          renderer.drawSkeleton(skeleton, false, -1, -1, (vertices, length, stride) => {
            for (let i = 0; i < length; i += stride) {
              const x = vertices[i] * p.scaleX, y = -vertices[i + 1] * p.scaleY;
              vertices[i] = p.x + x * cosine - y * sine;
              vertices[i + 1] = h - (p.y + x * sine + y * cosine);
            }
          });
          renderer.end();
          const duration = track ? track.animationEnd - track.animationStart : 0;
          const position = track ? completed && !loop ? duration : Math.min(duration, Math.max(0, track.getAnimationTime() - track.animationStart)) : 0;
          const status = !track ? 'ready' : completed && (!stopped || r?.status === 'completed') ? 'completed' : stopped ? 'paused' : 'playing';
          element.dataset.spineState = status; element.dataset.spineTime = position.toFixed(6); element.dataset.spineAnimation = animation; element.dataset.spineSkin = skin;
          report(status, position, duration, true, '', now);
          frame = requestAnimationFrame(draw);
        } catch (reason) { fail(reason); }
      };
      frame = requestAnimationFrame(draw);
    };
    void load().catch(fail);
    return () => { cancelled = true; cancelAnimationFrame(frame); textures.forEach(texture => texture.dispose()); renderer?.dispose(); };
  }, [asset?.id, asset?.path, asset?.spine?.atlasPath, restart, feedback?.request.pageInstance, feedback?.request.sourceSequence]);
  return <div className="spine-preview"><canvas ref={canvas} width={Math.max(1, width)} height={Math.max(1, height)} aria-label={asset ? asset.name + '实时预览' : '骨骼动画预览'} />{error && <span className="spine-preview-error" role="status">{error}</span>}{!asset?.spine && <span className="spine-preview-error">请选择骨骼动画素材</span>}</div>;
}

export function SpinePlaybackFields({ asset, value = {}, onChange, placement = true }: { asset?: Asset; value?: SpinePlayback; onChange: (settings: SpinePlayback) => void; placement?: boolean }) {
  const update = (patch: Partial<SpinePlayback>) => onChange({ ...value, ...patch });
  const speed = useSpineSpeedInput(value.speed ?? 1, next => update({ speed: next }));
  return <>
    <Field label="动画"><select aria-label="骨骼动画名称" value={value.animation ?? asset?.spine?.animations[0]?.name ?? ''} onChange={event => update({ animation: event.target.value })}>
      {!asset?.spine?.animations.length && <option value="">静态骨骼姿态</option>}
      {asset?.spine?.animations.map(animation => <option key={animation.name} value={animation.name}>{animation.name} · {animation.duration.toFixed(2)} 秒</option>)}
    </select></Field>
    <Field label="皮肤" uiProperty="spineSkin"><select aria-label="骨骼皮肤" value={value.skin ?? ''} onChange={event => update({ skin: event.target.value || undefined })}><option value="">默认皮肤</option>{asset?.spine?.skins.map(name => <option key={name} value={name}>{name === 'default' ? 'default（默认皮肤）' : name}</option>)}</select></Field>
    <Field label="自动播放"><input type="checkbox" checked={value.autoplay ?? true} onChange={event => update({ autoplay: event.target.checked })} /></Field>
    <Field label="动画循环" uiProperty="spineLoop"><input type="checkbox" checked={value.loop ?? true} onChange={event => update({ loop: event.target.checked })} /></Field>
    <Field label="动画速度" uiProperty="spineSpeed" hint={`支持 ${uiSpineSpeedRange} 倍；0 保留当前姿态，调速不重播。超出范围会拒绝，保留原值。`}><NumberInput {...speed.input} /></Field>
    {speed.error && <small id={speed.errorId} role="status">{speed.error}</small>}
    {placement && <>
      <Field label="骨骼布局" uiProperty="spineFit"><select value={value.fit ?? 'contain'} onChange={event => update({ fit: event.target.value as 'contain' | 'manual' })}><option value="contain">适应组件区域</option><option value="manual">自定义原点与缩放</option></select></Field>
      {value.fit === 'manual' && <>
        <Field label="骨骼缩放" uiProperty="spineScale"><NumberInput type="number"   step={0.01} value={value.scale ?? 1} onChange={event => update({ scale: Number(event.target.value) })} /></Field>
        {(['originX', 'originY'] as const).map(key => <Field key={key} label={`${key === 'originX' ? '横向' : '纵向'}原点 %`} uiProperty={key === 'originX' ? 'spineOriginX' : 'spineOriginY'}><NumberInput type="number"   step={0.1} value={Number(((value[key] ?? 0.5) * 100).toFixed(3))} onChange={event => update({ [key]: Number(event.target.value) / 100 })} /></Field>)}
      </>}
      <Field label="骨骼旋转" uiProperty="spineRotation"><NumberInput type="number"   value={value.rotation ?? 0} onChange={event => update({ rotation: Number(event.target.value) })} /></Field>
      {(['flipX', 'flipY'] as const).map(key => <Field key={key} label={key === 'flipX' ? '水平翻转' : '垂直翻转'} uiProperty={key === 'flipX' ? 'spineFlipX' : 'spineFlipY'}><input type="checkbox" checked={value[key] ?? false} onChange={event => update({ [key]: event.target.checked })} /></Field>)}
    </>}
  </>;
}

export function SpineAssetPreview({ asset }: { asset: Asset }) {
  const [settings, setSettings] = useState<SpinePlayback>({});
  const [restart, setRestart] = useState(0);
  return <><div className="asset-spine-preview"><SpinePreview asset={asset} settings={settings} restart={restart} /></div>
    <div className="spine-preview-controls"><button onClick={() => setSettings({ ...settings, autoplay: !(settings.autoplay ?? true) })}>{settings.autoplay === false ? '继续预览' : '暂停预览'}</button><button onClick={() => setRestart(value => value + 1)}>重新预览</button></div>
    <SpinePlaybackFields asset={asset} value={settings} onChange={setSettings} placement={false} />
  </>;
}
