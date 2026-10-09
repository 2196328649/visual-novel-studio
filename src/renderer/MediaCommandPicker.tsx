import { useState } from 'react';
import { X } from 'lucide-react';
import { VisualTransitionField, VisualTransitionsEditor } from './VisualTransitionsEditor';
import type { VisualTransitions, ActorTransitionRule, Project } from '../core/model';
import { createMediaVisual, mediaLifetimeNames, type MediaContent, type MediaLifetime } from '../core/media-command';
import { defaultImageTransform } from '../core/image-transform';
import { ImageTransformFields } from './ImageTransformFields';
import { actionText } from '../core/text-script';
import { UiAssetSelect } from './AssetPicker';
import { NumberInput } from './NumberInput';

export function MediaCommandPicker({ project, content, assetUrl, onInsert, onCancel }: { project: Project; content: MediaContent | 'hide'; assetUrl: (id?: string) => string | undefined; onInsert: (text: string) => void; onCancel: () => void }) {
  const [assetId, setAssetId] = useState(project.assets.find(asset => asset.kind === content)?.id);
  const [id, setId] = useState<string>(content === 'hide' ? 'image' : content);
  const [visualTransitions, setVisualTransitions] = useState<VisualTransitions>();
  const [transitionWait, setTransitionWait] = useState(false);
  const [exitTransition, setExitTransition] = useState<ActorTransitionRule>();
  const [hideWait, setHideWait] = useState(true);
  const [text, setText] = useState('');
  const [transform, setTransform] = useState({ ...defaultImageTransform });
  const [lifetime, setLifetime] = useState<MediaLifetime>(content === 'image' ? 'line' : 'persistent');
  const [x, setX] = useState(50), [y, setY] = useState(50), [width, setWidth] = useState(content === 'text' ? 80 : 100), [height, setHeight] = useState(content === 'text' ? 20 : 100);
  const [duration, setDuration] = useState(0), [layer, setLayer] = useState(20), [wait, setWait] = useState(false);
  const [fit, setFit] = useState<'contain' | 'cover' | 'stretch'>('contain'), [loop, setLoop] = useState(false), [volume, setVolume] = useState(100), [fontSize, setFontSize] = useState(60), [color, setColor] = useState('#ffffff'), [error, setError] = useState('');
  const name = content === 'hide' ? '隐藏对象' : '显示' + { image: '图片', video: '视频', text: '文字' }[content];
  const numeric = (label: string, value: number, change: (value: number) => void, min?: number, max?: number) => <label className="text-command-field">{label}<NumberInput aria-label={label} type="number" min={min} max={max} value={value} onChange={event => change(Number(event.target.value))} /></label>;
  return <div className="text-command-picker" role="dialog" aria-label="命令参数"><div className="text-command-picker-header"><strong>设置“{name}”</strong><button type="button" className="icon-button" aria-label="关闭参数面板" onClick={onCancel}><X size={15} /></button></div>
    <div className="text-command-fields">
      {(content === 'image' || content === 'video') && <UiAssetSelect project={project} assetUrl={assetUrl} kind={content} category="all" label={content === 'image' ? '显示图片素材' : '显示视频素材'} value={assetId} empty="选择素材" onChange={setAssetId} />}
      {content === 'text' && <label className="text-command-field">文字<textarea aria-label="显示文字内容" value={text} onChange={event => setText(event.target.value)} /></label>}
      <label className="text-command-field">对象 ID<input aria-label="对象ID" value={id} onChange={event => setId(event.target.value)} /></label>
      <p className="text-command-hint">相同 ID 替换同一对象；不同 ID 可同时显示。默认图片 image、视频 video、文字 text。</p>
      {content === 'hide' && <><VisualTransitionField label="离场过渡" value={exitTransition} inherit onChange={setExitTransition} /><label className="check-field"><input type="checkbox" aria-label="等待离场过渡" checked={hideWait} onChange={event => setHideWait(event.target.checked)} />等待离场结束</label></>}
      {content !== 'hide' && <>
        {content === 'image' ? <><ImageTransformFields value={transform} onChange={setTransform} /><label className="text-command-field">显示范围<select aria-label="图片显示范围" value={lifetime} onChange={event => { const value = event.target.value as MediaLifetime; setLifetime(value); setDuration(value === 'duration' ? duration || 3 : 0); }}>{Object.entries(mediaLifetimeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label></> : <><div className="text-command-inline">{numeric('横向位置 %', x, setX)}{numeric('纵向位置 %', y, setY)}</div><div className="text-command-inline">{numeric('宽度 %', width, setWidth, 1, 400)}{numeric('高度 %', height, setHeight, 1, 400)}</div></>}
        <div className="text-command-inline">{(content !== 'image' || lifetime === 'duration') && numeric('显示时长（秒）', duration, setDuration, 0)}{numeric('图层', layer, setLayer)}</div>
        <p className="text-command-hint">{content === 'image' ? '默认仅本句：推进台词后隐藏。持续显示保留到隐藏对象或切换背景。' : '位置按对象中心计算；时长 0 持续显示，直到隐藏对象或切换背景。视频默认完整播放一次。'}</p>
        <label className="check-field"><input type="checkbox" aria-label="等待显示结束" checked={wait && duration > 0} disabled={duration === 0} onChange={event => setWait(event.target.checked)} />等待显示结束后继续台词</label>
        {content !== 'text' && <label className="text-command-field">适应方式<select aria-label="适应方式" value={fit} onChange={event => setFit(event.target.value as typeof fit)}><option value="contain">完整容纳</option><option value="cover">填满并裁切</option><option value="stretch">拉伸</option></select></label>}
        {content === 'video' && <><label className="check-field"><input type="checkbox" aria-label="循环视频" checked={loop} onChange={event => setLoop(event.target.checked)} />循环播放</label>{numeric('视频音量 %', volume, setVolume, 0, 100)}</>}
        {content === 'text' && <>{numeric('文字字号', fontSize, setFontSize, 12, 300)}<label className="text-command-field">文字颜色<input aria-label="文字颜色" type="color" value={color} onChange={event => setColor(event.target.value)} /></label></>}
      </>}
      {content !== 'hide' && <VisualTransitionsEditor value={visualTransitions} wait={transitionWait} onChange={setVisualTransitions} onWaitChange={setTransitionWait} />}
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="text-command-picker-actions"><button type="button" onClick={onCancel}>取消</button><button type="button" className="primary" disabled={(content === 'image' || content === 'video') && !assetId} onClick={() => {
      try {
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(id)) throw new Error('对象 ID 请使用小写英文字母开头的字母、数字或下划线。');
        const action = content === 'hide' ? { kind: 'hideVisual' as const, instanceId: id, exitTransition, wait: hideWait } : createMediaVisual(content, content === 'text' ? text : assetId!, { visualTransitions, transitionWait, instanceId: id, ...(content === 'image' ? { ...transform, lifetime } : { x: x / 100, y: y / 100, width: width / 100, height: height / 100 }), duration, layer, wait: duration > 0 && wait, fit, loop, volume: volume / 100, fontSize, color });
        onInsert(actionText(project, action) + '\n');
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    }}>插入指令</button></div>
  </div>;
}
