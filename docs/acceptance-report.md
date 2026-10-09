# 1.0 验收记录

本页保留 1.0 的历史验收。1.1 的连线操作、资源管理器、两章剧情模板与发行程序验收见 [1.1 工作台与剧情示例](workbench-1.1.md)。

验证日期：2026-09-08 至 2026-09-11（北京时间）。本记录区分编辑器自动化、真实 Ren'Py 游戏测试和发行测试；没有将自动化称为真人零基础试用。完整原始报告、失败尝试、截图及日志保留在原始开发工作区的 `artifacts` 中；源码 ZIP 和安装包随附本摘要及可重新执行的验证方法，不包含完整原始记录。

## 9 月 11 日玩家设置与确认框

- 13 类玩家设置、换肤滑条和下拉菜单、角色音量、初始值、透明度及可编辑确认页已接入普通工程。新增设置读写和确认分支节点后，当前共 36 种内置节点，哀鸿模板 181 个组件。语言切换仍未实现。
- `artifacts/settings-runtime-verification/2026-09-11T10-31-11.233Z/report.json`：原生和开发目录外独立 EXE 各 68 断言，新进程各 5 断言通过，覆盖实际声音通道、零音量默认值、确认、重置、窗口、读档和设置持久保存。
- `artifacts/settings-authoring-verification/2026-09-11T03-03-18.630Z/report.json`：通过真实中文控件从空白 UI 创建设置、确认和蓝图接线，保存重开后实际导出；独立 EXE 15 断言通过。随后重新打包的程序及 NSIS 1.0.0 覆盖升级、最终冒烟均通过，`upgrade-*`、`smoke-*` 和 0.1.0 基线报告均保留在 `E:/VNS-Release-Ship/reports/`。
- 最新模板运行截图位于 `artifacts/aihong-ui-verification/2026-09-11T10-34-46.690Z/`；蓝图运行回归 24 断言、两种分辨率通用界面各 23 断言通过。标准控件替换另有 `artifacts/standard-settings-verification/2026-09-11T10-38-39.217Z/report.json`。

## 9 月 10 日实时骨骼动画与界面增补

- 用户提供的 `1_0.png` 已匹配 `1.bytes` 和 `1.atlas.bytes`，标题改为 Spine 4.2 实时计算。界面组件和六个新增节点均为通用功能；设置功能接入后当前共 36 个内置节点，创作者无需修改生成脚本。
- 桌面验收通过真实控件完成原始资源导入、动画预览、组件配置、按钮创建、蓝图执行线/数据线连接、保存重开及导出；从“新建工程”创建哀鸿模板副本并启动真实试玩也通过。
- `artifacts/spine-packaged-verification/2026-09-10T15-31-30.574Z/report.json`：打包程序复制到开发目录外，使用独立配置及其自带的运行时；导出 EXE 使用仅系统 PATH，通过播放/暂停/调速、组件显示与重置、非零动画位置和界面属性存档恢复的 19 个断言。报告记录程序、app.asar、DLL 和导出 ZIP 哈希；设置打包创作补查见 `artifacts/settings-packaged-verification/2026-09-11T10-49-24.152Z/report.json`。
- `artifacts/aihong-ui-verification/2026-09-10T15-30-36.039Z/report.json`：标题、对话、按钮真实按住/移出取消、存读档、收藏及音乐返回共 45 断言通过。
- `artifacts/ui-runtime-verification/2026-09-10T15-06-50-335Z/report.json`：1280×720 和 640×360 通用界面各 23 断言通过。`artifacts/runtime-verification/verification/2026-09-10T15-23-07-296Z/report.json`：原示例及最新导出 EXE 各 43 断言通过。

本次安装器已重新生成，打包产物的独立运行、创作和导出已实测；NSIS 0.1.0 基线、1.0.0 覆盖升级和文档更新后的最终冒烟检查均通过，相关 `upgrade-*`、`smoke-*` 和基线报告保留在 `E:/VNS-Release-Ship/reports/`。Spine 当前限 4.2 JSON 与 Windows x64。完整原作逐页复刻、全部解锁规则和原作运行画面逐页对照仍未完成。

## 已通过

| 项目 | 实际范围与结果 |
| --- | --- |
| 核心自动化 | `pnpm test`，89 项通过，0 失败。涵盖项目保存/迁移/恢复、编译、蓝图执行/数据链与接口、引用、中文文本、DOCX 损坏检查、音频 Range、UI 图片状态、骨骼组合素材导入/迁移与玩家设置。 |
| 空白创作 | 原生 Electron 界面创建双角色、三场景、好感度、分支和三结局，导入图片音频、拖拽舞台、保存重开、缺失素材定位和导出。真实游戏 3 条路线、7 个断言通过。 |
| 恢复 | 正常关闭前保存最新快照；强杀整个 Electron 进程树后恢复自动保存；未选择正式保存位置的草稿恢复后可落盘。 |
| 玩家功能 | 示例实际运行及导出包内 EXE 各通过 5 个用例、43 个断言，包括三结局、好感度、存读档、回滚、历史、设置、CG 与音乐回放。 |
| 自动、跳过和跨周目状态 | 5 次独立 Ren'Py 进程、9 个用例、58 个断言通过。自动/跳过实际推进且停在选项；反复读档不重复累计、不覆盖后续持久值，手动回退后主动重选可再次执行状态修改。片段试玩的指定状态仅进入独立试玩；18 个正式存档相关文件和编译源码哈希保持不变。 |
| 动态演出和互动 | 角色动画、共享镜头效果、场景/角色热点、密码锁及限时点击。游戏及开发目录外解压的 EXE 各通过 14 个用例、40 个断言，覆盖成功/失败/取消、菜单暂停、存档进度和重新进入重置。 |
| 同一 UI 配置贯通 | 通过 Electron 可见控件配置并保存同一个 18 节点工程：双角色关键帧、镜头、共享效果两次调用、场景/角色热点、中文密码、限时点击、成功/失败/取消出口和中文标题页；同一快照原生导出及 ZIP 自身 EXE 各通过 8 个用例、33 个断言。两端均验证背景、角色位置/透明度、镜头参数及读档恢复。报告为 `artifacts/interaction-authoring-verification/2026-09-08T16-22-41.967Z/report.json`。 |
| 旧存档 | 两个不同版本的实际游戏通过 24 个断言；保持对象身份时改写和插入对白，恢复变量、调用栈并继续到结局。旧存档及编译基线哈希未改变。 |
| 界面编辑 | 1280×720、1920×1080 下编辑器页面可操作；自定义标题、对白、选项、存档和设置页面在真实游戏中以 1280×720、640×360 各通过 23 个断言。 |
| 《哀鸿》示例素材 | 示例工程已替换为用户提供的东关街、茶舍、郊外背景，角色演示图和《哀鸿》BGM；项目目录与 1.0.0 安装包均只使用相对路径副本，素材来源和授权提示见 `resources/example/CREDITS.md`。 |
| 自定义界面导出 | 上述两种分辨率的 Windows ZIP 均在开发目录外用自身 EXE 通过原 23 个断言。剧情、界面和设置脚本与已通过版哈希相同，测试脚本/存档未进入原 ZIP，ZIP 未被测试修改。 |
| 效果管理 | 中文新建/改名、动作编辑/排序、共享调用、引用删除保护、循环限制、撤销重做，以及两种编辑器分辨率的对话框检查。 |
| 实际 Word 文件 | 用户附件解析为 8297 个字符、13 个角色、6 个段落和 227 条对白/旁白；诊断为 0，重复导入身份稳定。 |
| 中文文本完整流程 | 原生 Electron 11 项检查通过：实际附件导入与保存重开、改稿、撤销/重做保稿、斜杠窗口、音频播放/进度定位、错误草稿定位与发布阻断、图文同步、4 次最新草稿真实编译及 Windows 导出。真实场景跳转通过 1 个用例、3 个断言。 |
| 长篇 | 100 个场景、1000 个段落加 1 个结局，91730 字符。浏览器文本打开 525 ms、局部编辑预览 552 ms、应用 399 ms。最新原生 Electron 整稿 Ctrl+V 并预览 438 ms，光标定位预览 114 ms，草稿保存 175 ms；只有 1 次粘贴与 1 次输入事件。 |
| 安装与升级 | 最终产品代码在 `E:\VNS-Release-Final` 完成 0.1.0 到 1.0.0 的真实安装升级；旧工程内容与身份保留。安装版使用私有随附运行时完成中文改稿、实际 Word 导入/保存重开、试玩与导出。两份导出游戏在开发目录外使用自身 EXE 和仅系统 PATH，各通过 1 个用例、5 个存读档等断言。关于页版本、中文文档、许可和样例均已检查。 |

长篇测试设备：Windows 10 19045，AMD Ryzen 7 5800H，16 GB 内存，16 个逻辑处理器，Node.js 24.19.0。数值是本机单次验收观测，不是其他设备的性能保证。

## 最终发行检查

- 最终代码已完成安装升级、Word 导入、中文改稿试玩与独立游戏导出；文档更新后的冒烟检查确认程序和 `app.asar` 哈希仍与完整升级验收一致。
- 源码 ZIP、官方示例 ZIP、安装器和 `SHA256SUMS.txt` 由 `scripts/prepare-release-artifacts.ts` 生成并逐项校验；交付时以 `release/SHA256SUMS.txt` 作为三个发行物的哈希来源，避免在会被打包的文档中重复维护自引用哈希。

## 原始证据位置

- `artifacts/authoring-verification/2026-09-08T13-01-11.156Z/report.json`
- `artifacts/runtime-verification/verification/2026-09-08T15-53-54-316Z/report.json`
- `artifacts/runtime-verification/verification/2026-09-09T17-11-54-602Z/report.json`：替换《哀鸿》素材后的示例、导出包和独立 EXE 复测。
- `artifacts/interaction-verification/2026-09-08T12-48-05.438Z/report.json`
- `artifacts/save-compatibility/2026-09-08T15-31-29-055Z/report.json`
- `artifacts/player-state-verification/2026-09-08T15-26-19.024Z/report.json`
- `artifacts/ui-runtime-verification/2026-09-08T13-13-27-642Z/report.json`
- `artifacts/ui-export-verification/2026-09-08T15-11-25.244Z/report.json`
- `artifacts/effect-management-verification/2026-09-08T13-26-46.062Z/report.json`
- `artifacts/text-import-verification/2026-09-08T12-39-00.469Z/report.json`
- `artifacts/text-desktop-verification/2026-09-08T15-15-58.411Z-ac0db814/report.json`
- `artifacts/editor-verification/2026-09-08T13-36-42.878Z/report.json`：主要编辑页面；该轮长篇是 999 段落，完整 1000 段落见下一项。
- `artifacts/editor-verification/2026-09-08T14-57-09.803Z/report.json`
- `artifacts/long-text-paste-verification/2026-09-08T15-01-33.817Z/report.json`
- `artifacts/installed-verification/baseline-report.json`：旧版安装升级基线。
- `artifacts/installed-verification/upgrade-report.json`：包含持久状态修复的最终代码安装升级与独立游戏测试。
- `artifacts/interaction-authoring-verification/2026-09-08T16-22-41.967Z/report.json`：同一 UI 配置快照的原生及 ZIP EXE 互动贯通测试。

## 限制与待验证

干净 Windows 虚拟机、其他实体设备、真实中文输入法候选窗操作、真人零基础创作者试用尚未执行。安装包未签名。Ren'Py 打包的 Windows 长路径限制仍存在；一次约 280 字符路径的失败已保留，常规发行验收使用短目录。文本画面预览不代替真实分支/小游戏运行，DOCX 不转换图片与 Word 排版。旧存档兼容只覆盖上面实际验证的范围。详细说明和真人验收流程见 `user-guide.md`。
