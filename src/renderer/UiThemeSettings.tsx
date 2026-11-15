import { Image as ImageIcon, Layers, MessageSquare, Paintbrush, Settings2 } from 'lucide-react';
import type { Project } from '../core/model';
import { chapterEffectNames } from '../core/chapter';
import { uiActionAvailable, uiMenuShortcut } from '../core/ui-availability';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect } from './UiAppearance';
import { UiPropertyGroup } from './UiPropertyGroup';
import { PlayerDefaultsFields } from './PlayerPreferences';
import { ChapterCompositionFields } from './ChapterFields';
import './ui-page-settings.css';

export function UiThemeSettings({ project, commit, assetUrl }: { project: Project; commit: Commit; assetUrl: AssetUrl }) {
  return <div className="ui-global-theme-settings">
      <UiPropertyGroup title="玩家与菜单" icon={<Settings2 size={15} />} defaultOpen>
      <PlayerDefaultsFields project={project} commit={commit} />
      <Field label="菜单快捷键打开" hint="游戏中按 Esc 或鼠标右键时打开的页面，再按一次返回剧情。"><select aria-label="菜单快捷键打开" value={uiMenuShortcut(project.ui) ?? ''} onChange={event => commit('菜单快捷键页面', p => { p.ui.menuShortcutPage = event.target.value as NonNullable<Project['ui']['menuShortcutPage']>; })}>{!uiMenuShortcut(project.ui) && <option value="">没有可用菜单</option>}{([['preferences', '设置'], ['save', '存档'], ['load', '读档'], ['pause', '暂停菜单']] as const).filter(([action]) => uiActionAvailable(project.ui, action)).map(([action, name]) => <option key={action} value={action}>{name}</option>)}</select></Field>
      </UiPropertyGroup>
      <UiPropertyGroup title="主题颜色与文字" icon={<Paintbrush size={15} />}>
      <div className="color-fields">
        {(["accent", "background", "textColor"] as const).map((key) => (
          <Field
            key={key}
            label={
              { accent: "强调色", background: "背景色", textColor: "文字色" }[
                key
              ]
            }
          >
            <input
              type="color"
              value={project.ui[key]}
              onChange={(e) =>
                commit(`界面颜色 ${key}`, (p) => {
                  p.ui[key] = e.target.value;
                })
              }
            />
          </Field>
        ))}
      </div>
      <Field label="主题字体"><UiAssetSelect assetUrl={assetUrl} project={project} kind="font" value={project.ui.fontAssetId} onChange={value => commit('主题字体', p => { p.ui.fontAssetId = value; })} /></Field>
      <Field label="对白等待图标" hint="文字显示完毕后，在句末提示点击继续。"><UiAssetSelect assetUrl={assetUrl} project={project} kind="image" value={project.ui.continueIndicatorId} onChange={value => commit('对白等待图标', p => { p.ui.continueIndicatorId = value; })} /></Field>
      {project.ui.continueIndicatorId && <Field label="等待图标宽度"><NumberInput type="number"   value={project.ui.continueIndicatorWidth ?? project.assets.find(asset => asset.id === project.ui.continueIndicatorId)?.width ?? 32} onChange={event => commit('等待图标大小', p => { p.ui.continueIndicatorWidth = Number(event.target.value); })} /></Field>}
      <Field label={`字号 ${project.ui.fontSize}`}>
        <input
          type="range"
          min="16"
          max="64"
          value={project.ui.fontSize}
          onChange={(e) =>
            commit("界面字号", (p) => {
              p.ui.fontSize = Number(e.target.value);
            })
          }
        />
      </Field>
      </UiPropertyGroup>
      <UiPropertyGroup title="标题与声音" icon={<ImageIcon size={15} />}>
      <Field label="标题背景">
        <UiAssetSelect assetUrl={assetUrl} label="标题背景"
          project={project}
          kind="image"
          value={project.ui.menuBackgroundId}
          onChange={(value) =>
            commit("标题背景", (p) => {
              p.ui.menuBackgroundId = value;
            })
          }
        />
      </Field>
      <Field label="按钮悬停音效" hint="用于标题和各个菜单的按钮，跟随玩家音效音量。单个按钮可在属性中覆盖或关闭。"><UiAssetSelect project={project} kind="audio" assetUrl={assetUrl} label="默认按钮悬停音效" empty="不播放音效" value={project.ui.hoverSoundId} onChange={value => commit('按钮悬停音效', p => { p.ui.hoverSoundId = value; })} /></Field>
      <Field label="按钮点击音效" hint="用于标题和各个菜单的按钮、列表条目，玩家确实点击后播放一次。单个按钮可在属性中覆盖或关闭。"><UiAssetSelect project={project} kind="audio" assetUrl={assetUrl} label="默认按钮点击音效" empty="不播放音效" value={project.ui.clickSoundId} onChange={value => commit('按钮点击音效', p => { p.ui.clickSoundId = value; })} /></Field>
      <Field label="标题音乐" hint="进入标题页后循环播放，剧情配乐仍由演出动作或蓝图控制。"><UiAssetSelect project={project} kind="audio" assetUrl={assetUrl} label="标题音乐" empty="不播放音乐" value={project.ui.menuMusicId} onChange={value => commit('标题音乐', p => { p.ui.menuMusicId = value; })} /></Field>
      {project.ui.menuMusicId && <><audio aria-label="试听标题音乐" controls preload="metadata" src={assetUrl(project.ui.menuMusicId)} /><Field label="标题音乐淡入（秒）"><NumberInput type="number"   step={0.1} value={project.ui.menuMusicFade ?? 0.3} onChange={event => commit('标题音乐淡入', p => { p.ui.menuMusicFade = Number(event.target.value); })} /></Field></>}
      </UiPropertyGroup>
      <UiPropertyGroup title="旧版章节默认配置" icon={<Layers size={15} />}>
        <p className="ui-page-help">用于旧章节与生成默认章节演出。已生成的章节请在时间轴中编辑，这里的修改不会同步过去。</p>
        <Field label="默认章节效果"><select aria-label="主题章节效果" value={project.ui.chapterTransition?.effect ?? 'fade'} onChange={event => commit('章节效果', p => { p.ui.chapterTransition = { ...p.ui.chapterTransition, effect: event.target.value as 'none' | 'fade' | 'ink' }; })}>{Object.entries(chapterEffectNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
        <ChapterCompositionFields project={project} commit={commit} assetUrl={assetUrl} />
      </UiPropertyGroup>
      <UiPropertyGroup title="对白框" icon={<MessageSquare size={15} />}>
      <Field
        label={`对话框高度 ${Math.round(project.ui.dialogueHeight * 100)}%`}
      >
        <input
          type="range"
          min="15"
          max="60"
          value={project.ui.dialogueHeight * 100}
          onChange={(e) =>
            commit("对话框高度", (p) => {
              p.ui.dialogueHeight = Number(e.target.value) / 100;
            })
          }
        />
      </Field>
      <Field
        label={`对话框不透明度 ${Math.round(project.ui.dialogueOpacity * 100)}%`}
      >
        <input
          type="range"
          min="0"
          max="100"
          value={project.ui.dialogueOpacity * 100}
          onChange={(e) =>
            commit("对话框透明度", (p) => {
              p.ui.dialogueOpacity = Number(e.target.value) / 100;
            })
          }
        />
      </Field>

      </UiPropertyGroup>
  </div>;
}
