# 时间轴媒体编辑验收 · 2026-10-06

时间轴现在直接使用片段和组件属性编辑、按默认参数试播。音频显示真实波形，音视频支持拖动移动、左右裁剪和淡入淡出；组件等当前片段中最晚的结束时点完成。

## 需求与实现

| 需求 | 当前行为与代码 | 验收证据 |
| --- | --- | --- |
| 去掉重复的时间轴属性、播放设置和试播设置 | 工具栏保留添加片段、轨道、吸附、显示区间和缩放；试播使用组件参数默认值。[PerformanceTimeline.tsx](../src/renderer/PerformanceTimeline.tsx) | [图片剪辑桌面验收](../artifacts/timeline-clip-editing/2026-10-05T17-12-30.527Z/report.json)、[界面事件桌面验收](../artifacts/ui-event-timeline/2026-10-05T17-14-48.974Z/report.json) |
| 属性面板明显二选一 | “时间轴组件 / 片段”使用互斥页签和清楚的选中状态。[performance-workspace.css](../src/renderer/performance-workspace.css) | 图片剪辑桌面验收，包含 1024 像素窗口检查 |
| 音乐图案可用于编辑 | 从源音频提取各声道峰值，保留安静段和强弱变化；裁剪只改变源区间，不放大安静段；更换素材同步刷新。[AudioWaveform.tsx](../src/renderer/AudioWaveform.tsx)、[audio-waveform.ts](../src/renderer/audio-waveform.ts) | [媒体剪辑桌面验收](../artifacts/timeline-media-editing/2026-10-05T17-08-35.251Z/report.json)、下方波形截图 |
| 音视频像片段一样拖动和裁剪 | 左右边缘调整入点、出点；拖动片段调整时间或轨道；黄色把手调整淡入淡出。数值裁剪同样限制已读取的源长度，直接换视频重新读取新素材长度。[TimelineAudioClipEditor.tsx](../src/renderer/TimelineAudioClipEditor.tsx)、[TimelineVisualClipEditor.tsx](../src/renderer/TimelineVisualClipEditor.tsx)、[visual-object.ts](../src/core/visual-object.ts) | 媒体剪辑桌面验收，包括 6 秒视频替换为 2 秒视频、源末尾限制、跨轨移动、保存重开和窄窗口 |
| 明确组件何时完成 | 工具栏显示完成时间；导出播放和完成期限共用解析后的视觉数据，时长参数被源末尾限制后同步调整期限。[compiler.ts](../src/runtime/compiler.ts)、[visual-objects.ts](../src/runtime/visual-objects.ts) | [媒体原生运行验收](../artifacts/timeline-media-runtime/2026-10-05T17-10-03.888Z/report.json)：默认 6 秒完成，缩短参数后 4 秒完成；视频传入 99 秒时长和 4 秒入点后实际使用 2 秒，该组合 3 秒完成 |
| 图片、音乐、音效、视频可由调用端替换 | “设为素材参数”公开素材输入；调用节点直接选择本次素材或接入素材线；未传入和空值回退默认，恢复默认不修改组件默认值。[BlueprintCallFields.tsx](../src/renderer/BlueprintCallFields.tsx)、[blueprint-authoring.ts](../src/core/blueprint-authoring.ts) | [组件调用桌面验收](../artifacts/timeline-component/2026-10-05T17-17-38.767Z/report.json)、媒体原生运行验收 |
| 进入组合调整内部内容 | 双击进入组合工作区，按片段调整子对象，面包屑逐层返回。[CompositionWorkspace.tsx](../src/renderer/CompositionWorkspace.tsx) | 界面事件桌面验收中的标题内部时间轴和逐层返回检查 |

视频定位与暂停会保留当前帧，播放时解码器持续推进。淡入淡出影响画面与真实音量，属性面板中的作者不透明度保持原值；静音真实生效，先结束的视频会消失，其余片段继续播放。

## 当前构建的检查

- `pnpm test`：808 项通过，0 失败。[完整日志](../artifacts/timeline-media-final-tests.log)
- `pnpm build`：TypeScript、前端生产构建与桌面主进程编译成功。[构建日志](../artifacts/timeline-media-final-build.log)
- 媒体原生运行：1 个测试用例、17 个外层断言及同步媒体状态检查通过。[运行日志](../artifacts/timeline-media-runtime/2026-10-05T17-10-03.888Z/runtime.log)
- 界面事件原生运行：1 个测试用例、5 个断言通过，按钮实际调用组件及其内部时间轴。[报告](../artifacts/ui-event-timeline-runtime/2026-10-05T17-15-59.076Z/report.json)

## 实际桌面截图

以下波形来自验收音频，包含安静段和不同强度的声音。横向对应时间，波形高度对应源音频强弱。

![真实波形示例](../artifacts/timeline-media-editing/2026-10-05T17-08-35.251Z/waveform-detail.png)

[音视频剪辑与实际视频画面](../artifacts/timeline-media-editing/2026-10-05T17-08-35.251Z/01-media-timeline.png) · [窄窗口](../artifacts/timeline-media-editing/2026-10-05T17-08-35.251Z/02-media-narrow.png)
