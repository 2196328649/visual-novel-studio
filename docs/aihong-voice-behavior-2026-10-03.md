# 语音收藏删除确认与排列（2026-10-03）

开发版的哀鸿模板现在按收藏先后显示语音，删除前弹出确认框。原作核对仅使用已有源数据，未恢复用户停止的原作窗口操作。

## 原作证据与实现

只读记录位于 `artifacts/aihong-voice-source/2026-10-03/voice-disassembly.txt` 与 `native-source.json`。`OnClickRemoveCollection`（RVA `0x438fa0`）读取 `ui_voice_collection_remove` 并以类型 2 调用 `MessageBox.Show`；类型 2 为 Confirm。接受回调（`0x439170`）执行 `RemoveCollectionLogs` 后刷新。注册收藏追加到 collectionLogs，打开列表按索引生成条目，因此收藏先后决定显示顺序。

列表新增可编辑字段 `voiceOrder`（source/favorites）、`voiceRemoveConfirm` 和 `voiceRemoveMessage`。普通列表沿用资源顺序与直接移除；`resources/templates/aihong/project.vns.json` 和 `artifacts/aihong-template/project.vns.json` 启用收藏先后与确认。设计属性可修改这些选项，支持撤销、重做、显式保存与重开。

打开确认框时保留收藏、页码和试听；取消或 Escape 不修改数据。接受后仅删除目标，删除正在试听的条目停止声音，删除其他条目继续播放；末页删空回退，未解锁的收藏仍可删除，重新加入的收藏排在末尾。自定义与标准确认框均使用字面提示，`[name]` 和 `{b}` 不执行插值或样式。

## 验收

最初批次全量 679 项、17 项相关测试、类型检查与前端/桌面构建通过，日志为 `artifacts/voice-behavior-{all-tests,unit,types,build}.log`。

预览移到独立窗口后，重新运行 `scripts/verify-aihong-voice-behavior.ts`：

- 桌面真实原图控件、收藏顺序、确认提示、撤销重做、保存重开、窄窗口、WAV 试听与七类收藏交互：`artifacts/aihong-voice-behavior/2026-10-03T07-04-54.100Z/editor-report.json`。
- 自定义确认框：同目录 `custom-runtime/report.json`，23 条原生断言通过。
- 标准确认框：同目录 `standard-runtime/report.json`，23 条原生断言通过。
- 原生确认和收藏截图位于各自 `game/tests/screenshots/`，已查看；自定义原图、标准确认框均显示字面提示。
- 原有收藏预演回归：`artifacts/ui-voice-preview/2026-10-03T07-00-07.388Z/report.json`。

最新 679 项全量测试仍通过，见 `artifacts/ui-preview-window-tests.log`。早期失败报告保留；已修正验收脚本在模态框返回后重新展开语音测试数据，以及 Ren’Py 字面提示转义的断言方式。

## 范围

本记录的早期批次按语音资源 ID 收藏，尚未区分共用音频的不同对白。该身份缺口已在后续[按对白记录收藏](voice-dialogue-collection-2026-10-03.md)中修复，旧资源收藏保持兼容；最终原模板回归为 `artifacts/aihong-voice-behavior/2026-10-03T09-30-28.280Z/`，桌面和两套各 23 条原生断言通过，最新全量为 681 项。默认中文提示仍为“确定删除这条语音收藏吗？”，未提取原作本地化提示的准确文本。验收使用隔离工程和玩家资料，没有改写原游戏、替换安装版或新增真实模型验收。
