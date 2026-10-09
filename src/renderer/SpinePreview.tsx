import { NumberInput } from './NumberInput';
import { useEffect, useRef, useState } from 'react';
import { AnimationState, AnimationStateData, AtlasAttachmentLoader, GLTexture, Physics, SceneRenderer, Skeleton, SkeletonJson, TextureAtlas } from '@esotericsoftware/spine-webgl';
import type { Asset, SpinePlayback } from '../core/model';
import { spinePlacement } from '../core/spine';
import { browserBridge } from './browserBridge';
import { Field } from './components';

/** The editor uses the same atlas dimensions, pose and settings as the player. */
export function SpinePreview({ asset, settings = {}, width = 640, height = 360, paused, restart = 0 }: {
  asset?: Asset; settings?: SpinePlayback; width?: number; height?: number; paused?: boolean; restart?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ settings, paused }); current.current = { settings, paused };
  const [error, setError] = useState('');
  useEffect(() => {
    const element = canvas.current;
    if (!element || !asset?.spine) return;
    let cancelled = false, frame = 0;
    let renderer: SceneRenderer | undefined;
    const textures: GLTexture[] = [];
    element.dataset.spineState = 'loading'; setError('');
    const url = (relative: string) => (window.studio ?? browserBridge).assetUrl(relative);
    const load = async () => {
      const gl = element.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: true });
      if (!gl) throw new Error('此设备未能创建动画预览，请检查显卡加速设置。');
      renderer = new SceneRenderer(element, gl, true);
      renderer.camera.position.set(width / 2, height / 2, 0);
      renderer.camera.setViewport(width, height); renderer.camera.update();
      const loadText = async (path: string) => {
        const response = await fetch(url(path));
        if (!response.ok) throw new Error('骨骼素材配套文件读取失败。');
        return response.text();
      };
      const [atlasText, json] = await Promise.all([loadText(asset.spine!.atlasPath), loadText(asset.path)]);
      if (cancelled) return;
      const atlas = new TextureAtlas(atlasText);
      for (const page of atlas.pages) {
        const metadata = asset.spine!.pages.find(item => item.name === page.name);
        if (!metadata) throw new Error(`缺少图集图片：${page.name}`);
        const image = new window.Image(); image.crossOrigin = 'anonymous'; image.src = url(metadata.path); await image.decode();
        if (cancelled) return;
        const texture = new GLTexture(gl, image); textures.push(texture); page.setTexture(texture);
      }
      const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(json));
      const skeleton = new Skeleton(data), state = new AnimationState(new AnimationStateData(data));
      let signature = '', elapsed = 0, last: number | undefined;
      const draw = (now: number) => {
        if (cancelled || !renderer) return;
        try {
          const s = current.current.settings;
          const animation = s.animation ?? data.animations[0]?.name ?? '';
          const nextSignature = JSON.stringify([animation, s.skin, s.loop]);
          if (signature !== nextSignature) {
            signature = nextSignature; elapsed = 0; state.clearTracks(); skeleton.setToSetupPose();
            skeleton.setSkin(s.skin ? data.findSkin(s.skin) : data.defaultSkin);
            skeleton.setSlotsToSetupPose();
            if (animation) state.setAnimation(0, animation, s.loop ?? true);
          }
          const stopped = current.current.paused ?? !(s.autoplay ?? true);
          const delta = stopped || last === undefined ? 0 : Math.min(0.1, Math.max(0, (now - last) / 1000)) * (s.speed ?? 1);
          last = now; elapsed += delta;
          state.update(delta); state.apply(skeleton); skeleton.update(delta); skeleton.updateWorldTransform(Physics.update);
          const p = spinePlacement(asset, s, width, height), angle = p.rotation * Math.PI / 180;
          const cosine = Math.cos(angle), sine = Math.sin(angle);
          gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          renderer.begin();
          renderer.drawSkeleton(skeleton, false, -1, -1, (vertices, length, stride) => {
            for (let i = 0; i < length; i += stride) {
              const x = vertices[i] * p.scaleX, y = -vertices[i + 1] * p.scaleY;
              vertices[i] = p.x + x * cosine - y * sine;
              vertices[i + 1] = height - (p.y + x * sine + y * cosine);
            }
          });
          renderer.end();
          element.dataset.spineState = stopped ? 'paused' : 'playing';
          element.dataset.spineTime = elapsed.toFixed(6); element.dataset.spineAnimation = animation;
          frame = requestAnimationFrame(draw);
        } catch (error) { element.dataset.spineState = 'error'; setError(error instanceof Error ? error.message : String(error)); }
      };
      frame = requestAnimationFrame(draw);
    };
    void load().catch(error => { if (!cancelled) { element.dataset.spineState = 'error'; setError(error instanceof Error ? error.message : String(error)); } });
    return () => { cancelled = true; cancelAnimationFrame(frame); textures.forEach(texture => texture.dispose()); renderer?.dispose(); };
  }, [asset?.id, asset?.path, width, height, restart]);
  return <div className="spine-preview"><canvas ref={canvas} width={width} height={height} aria-label={asset ? `${asset.name}实时预览` : '骨骼动画预览'} />{error && <span className="spine-preview-error" role="status">{error}</span>}{!asset?.spine && <span className="spine-preview-error">请选择骨骼动画素材</span>}</div>;
}

export function SpinePlaybackFields({ asset, value = {}, onChange, placement = true }: { asset?: Asset; value?: SpinePlayback; onChange: (settings: SpinePlayback) => void; placement?: boolean }) {
  const update = (patch: Partial<SpinePlayback>) => onChange({ ...value, ...patch });
  return <>
    <Field label="动画"><select aria-label="骨骼动画名称" value={value.animation ?? asset?.spine?.animations[0]?.name ?? ''} onChange={event => update({ animation: event.target.value })}>
      {!asset?.spine?.animations.length && <option value="">静态骨骼姿态</option>}
      {asset?.spine?.animations.map(animation => <option key={animation.name} value={animation.name}>{animation.name} · {animation.duration.toFixed(2)} 秒</option>)}
    </select></Field>
    <Field label="皮肤"><select aria-label="骨骼皮肤" value={value.skin ?? ''} onChange={event => update({ skin: event.target.value || undefined })}><option value="">默认皮肤</option>{asset?.spine?.skins.filter(name => name !== 'default').map(name => <option key={name} value={name}>{name}</option>)}</select></Field>
    <Field label="自动播放"><input type="checkbox" checked={value.autoplay ?? true} onChange={event => update({ autoplay: event.target.checked })} /></Field>
    <Field label="动画循环"><input type="checkbox" checked={value.loop ?? true} onChange={event => update({ loop: event.target.checked })} /></Field>
    <Field label="动画速度"><NumberInput type="number"   step={0.1} value={value.speed ?? 1} onChange={event => update({ speed: Number(event.target.value) })} /></Field>
    {placement && <>
      <Field label="骨骼布局"><select value={value.fit ?? 'contain'} onChange={event => update({ fit: event.target.value as 'contain' | 'manual' })}><option value="contain">适应组件区域</option><option value="manual">自定义原点与缩放</option></select></Field>
      {value.fit === 'manual' && <>
        <Field label="骨骼缩放"><NumberInput type="number"   step={0.01} value={value.scale ?? 1} onChange={event => update({ scale: Number(event.target.value) })} /></Field>
        {(['originX', 'originY'] as const).map(key => <Field key={key} label={`${key === 'originX' ? '横向' : '纵向'}原点 %`}><NumberInput type="number"   step={0.1} value={Number(((value[key] ?? 0.5) * 100).toFixed(3))} onChange={event => update({ [key]: Number(event.target.value) / 100 })} /></Field>)}
      </>}
      <Field label="骨骼旋转"><NumberInput type="number"   value={value.rotation ?? 0} onChange={event => update({ rotation: Number(event.target.value) })} /></Field>
      {(['flipX', 'flipY'] as const).map(key => <Field key={key} label={key === 'flipX' ? '水平翻转' : '垂直翻转'}><input type="checkbox" checked={value[key] ?? false} onChange={event => update({ [key]: event.target.checked })} /></Field>)}
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
