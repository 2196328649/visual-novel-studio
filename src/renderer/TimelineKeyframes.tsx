import type { StageAction } from '../core/model';
import { KeyframeEditor } from './Inspector';
import { VisualCurvesEditor } from './VisualCurvesEditor';
import { createVisualObject } from '../core/visual-object';
import { actorAnimationDuration, actorCurveProperties } from '../core/actor-animation';

export function TimelineKeyframes({ action, start, onChange, onSeek }: {
  action: Extract<StageAction, { kind: 'animate' }>; start: number;
  onChange: (action: Extract<StageAction, { kind: 'animate' }>) => void; onSeek: (time: number) => void;
}) {
  let at = start;
  return <section aria-label="角色关键帧" className="timeline-keyframes">
    <p>目标：{action.instanceId ?? action.characterId}。时长表示从上一帧到达这一帧所需的秒数。</p>
    <VisualCurvesEditor object={{ ...createVisualObject('solid'), keyframes: action.keyframes, duration: actorAnimationDuration(action), curves: action.curves }} properties={actorCurveProperties} start={start} onSeek={onSeek} onChange={object => onChange({ ...action, curves: object.curves })} />
    {action.keyframes.map((frame, index) => {
      at += frame.duration; const position = at;
      return <details key={index} open className="timeline-keyframe">
        <summary>关键帧 {index + 1} · {position.toFixed(2)} 秒</summary>
        <div className="field-row"><button onClick={() => onSeek(position)}>定位此帧</button><button disabled={action.keyframes.length <= 1} onClick={() => {
          const keyframes = action.keyframes.map(frame => ({ ...frame }));
          const [removed] = keyframes.splice(index, 1);
          if (keyframes[index]) keyframes[index].duration += removed.duration;
          onChange({ ...action, keyframes });
        }}>删除此帧</button></div>
        <KeyframeEditor frame={frame} onChange={next => onChange({ ...action, keyframes: action.keyframes.map((value, i) => i === index ? next : value) })} />
      </details>;
    })}
    <button disabled={action.keyframes.length >= 32} onClick={() => onChange({ ...action, keyframes: [...action.keyframes, { ...action.keyframes.at(-1)!, duration: 1 }] })}>添加关键帧</button>
  </section>;
}
