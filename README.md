# 叙事工坊

Windows 中文视觉小说编辑器，使用同一份项目数据编辑剧本、蓝图、舞台和游戏界面，生成 Ren'Py 游戏。

编辑器源码独立于 Ren'Py SDK。小说作品、便携版用户数据和本机验收备份各自保存，不放进源码仓库。目录约定与开发准备见[工程组织](docs/repository-layout.md)。

当前发行版为 v0.8（0.8.0，2026-10-09 更新），发行文件位于 `release`。资源管理器现在使用单行工具栏，删除先确认，文件夹连同全部内部资源一起删除；时间轴独立为“时间轴预设”，并恢复当前作者工程的图片章节默认参数。详见[资源类型与删除更新](docs/resource-types-2026-10-09.md)。此前的统一资源目录、等大卡片、参数菜单与试玩交互见[统一资源与试玩更新](docs/unified-resources-and-preview-2026-10-09.md)，图片变换、数值拖动与暂停编辑见 [v0.8 发行说明](docs/release-0.8.md) 和 [验收记录](docs/acceptance-0.8.md)。安装版和便携版均随附离线运行时，创作者无需安装开发工具。此前内部 1.3.x 记录保留供追溯。

v0.8 同时提供图片／视频／文字指令与入离场过渡、Windows 单 EXE 游戏导出、关闭保存提示、导出后打开文件夹、章节四区文字、独立台词播放、自动换行与可拖动分栏。台词演出和独立演出可转为时间轴编辑，独立演出单独执行并隐藏对白框；章节音效与背景音乐分别控制。流程图、角色预设、按章长文本编辑、AI 创作辅助和实时试玩继续使用同一份项目数据。

安装包和便携包从 [GitHub Releases](https://github.com/2196328649/visual-novel-studio/releases) 下载。本机构建输出位于 `release/`：安装入口为 `Visual Novel Studio Setup 0.8.0.exe`；便携版为 `Visual-Novel-Studio-0.8.0-portable-win-x64.zip`，全部解压后运行 `Visual Novel Studio.exe`。用法见 [便携版](docs/portable.md) 和 [游戏导出](docs/game-export.md)。维护源码仍可双击 `启动开发版.cmd`。

剧本的模块模式与文本模式共用右侧预览，可播放当前台词的演出和配音。文本支持中文、拼音首字母补全和可点击的参数提示，也可开启「隐藏演出」，默认只在预览下方显示选中台词的演出。顶部「演出」工作区提供可拖动轨道、进度定位与暂停，公开标题、图片、声音等参数后可按名称调用复用。界面属性分为「游戏设置」与「组件设置」；「参数集」可创建与蓝图共享的玩家设置。详见 [轨道与参数使用说明](docs/authoring-tracks-and-parameters.md)、[中文文本编剧](docs/text-authoring.md) 和 [本轮验收](docs/current-authoring-work.md)。

角色统一位置和缩放见 [角色站位预设](docs/character-presets.md)，AI 框架、场景配置与配音匹配见 [AI 创作助手](docs/ai-assistant.md)。

启动时先显示项目窗口，支持空白项目、哀鸿模板和自制模板；“模板库”提供新建、复制和打开编辑。“分支入门”已从创建入口移除，已有工程仍可打开。

## 创作流程

1. 在项目窗口新建空白项目，或选择“哀鸿模板”与自制模板。进入“模板库”可以新建、复制和编辑模板，见[模板管理](docs/starter-template.md)。哀鸿示例的剧情依据用户提供的原文节选改编，背景和 BGM 使用原作素材副本。
2. 打开“资源”页或按 Ctrl+空格打开资源管理器，在同一目录中组织图片、音频、蓝图和时间轴预设。单行工具栏提供搜索、范围、类型多选、排序与视图切换；底部滑块统一调整方形缩略图大小。双击资源打开，或拖入节点画布。删除会先显示确认框；删除文件夹包含内部全部资源和子文件夹。详见[资源类型与删除更新](docs/resource-types-2026-10-09.md)。
3. 在“剧本”内切换“模块编辑”和“文本编辑”：按对白块编排，或用带行号、语法颜色和查找替换的文本模式导入 DOCX/TXT/MD，输入 `/` 选择中文指令。内部编号自动隐藏，两种模式同步剧情与当前对白。在“流程图”中连接段落、选项和条件，在“蓝图”中制作台词演出、独立演出和通用逻辑，用中文节点、参数选择器和自动接线制作演出与逻辑。
4. 选择对白，在右侧实时预览打开“编辑舞台”，直接拖动角色并调整画面、关键帧和镜头；两种剧本模式共用预览，支持撤销。用热点和小游戏节点添加互动，界面视图可调整游戏页面。
5. 保存作品并试玩。问题列表可定位到相关节点和对白。
6. 在「作品设置 → 游戏导出」选择平台和输出位置，就绪后点击「导出」；如环境缺失，使用「一键配置」。Windows 可离线配置；Android 首次配置需要联网并同意 SDK 许可。检查列表会明确提示缺少的依赖，见 [游戏导出](docs/game-export.md)。

项目文件、素材目录与恢复文件应一起保留。导入素材会复制到项目内，重命名显示名称不会改变素材身份。

中文文档：`docs/user-guide.md`（入门与发行）、`docs/text-authoring.md`（中文文本和指令）、`docs/blueprint-authoring.md`（中文节点编程与用户节点）、`docs/interaction-authoring.md`（效果与互动）。文本画面预览用于改稿，实际分支、小游戏和存档使用真正的 Ren'Py 试玩验收。

节点编程提供按中文搜索的内置节点与用户节点库、类型化参数与输出、错误定位和入门示例。右键或空格可在鼠标位置搜索并添加节点。连线在缩小画布后仍保持宽点击区域，选中后可断开、拖动端点改接，或从连线列表定位；Delete 删除与 Ctrl+Z 撤销均支持连线。常用角色、背景、音频、玩家设置和界面操作通过名称选择。具体用法和当前能力边界见蓝图文档。

设置页支持 13 类玩家选项、换肤滑条、下拉菜单、角色独立音量、作者初始值和可编辑确认框；还可以从参数集添加开关、数值和文字设置。玩家偏好独立于剧情存档保存。制作步骤见 [玩家设置与确认框](docs/player-settings.md)；哀鸿模板当前包含 183 个普通可编辑界面组件。两章内容、三条结局路线与改编范围见 [哀鸿剧情示例](docs/aihong-story-sample.md)。

## 开发与构建

以下命令供维护源码使用，创作者使用发行包时无需这些工具。

前提：Node.js 24、pnpm 11.25.0、64 位 Windows，以及已解压的 Ren'Py 8.5.3 SDK。源码目录可以放在任意位置；下面的 SDK 路径需替换为本机实际路径。源码包已包含示例工程和素材。

```powershell
pnpm install --frozen-lockfile
node scripts/prepare-runtime.mjs 'E:\Tools\renpy-8.5.3-sdk'
pnpm test
pnpm test:runtime
pnpm dev
pnpm package
```

进一步验收：`scripts/verify-text-desktop.ts`、`scripts/verify-authoring.ts`、`scripts/verify-editor.ts`、`scripts/verify-interactions.ts --export`、`scripts/verify-save-compatibility.ts` 和 `scripts/verify-ui-runtime.ts`。实际附件可通过 `scripts/verify-text-import.ts <文档路径>` 验证。

蓝图专项验收：`pnpm test:blueprint-editor` 验证界面、接口同步和保存重开；`pnpm test:blueprint-runtime` 验证实际演出、循环、菜单和存档；运行 `pnpm build` 后，`pnpm exec tsx scripts/verify-blueprint-desktop.ts` 验证真实桌面保存、试玩、导出和独立 EXE。

工作台专项：`pnpm test:workbench` 验证连线点击与改接、资源组织、真实拖放、保存重开与三种窗口尺寸；`pnpm test:aihong-story` 检查 14 条剧情路线及真实 Ren'Py 的章节、三个结局、新游戏重置与存读档。

打包后可运行 `pnpm exec tsx scripts/verify-blueprint-desktop.ts --packaged`，将安装产物复制到源码目录外，使用独立配置、自带运行时和真实导出游戏进行验收。默认输出到 `E:/VNS-Blueprint-Verification`，可通过 `VNS_BLUEPRINT_VERIFY_ROOT` 更换位置。

通过 `pnpm runtime:prepare <SDK目录>`，或设置 `VNS_RENPY_SDK` 后运行 `pnpm runtime:prepare`，准备本机离线运行时。无需把源码放进 SDK 目录。`pnpm sample` 使用 `VNS_AIHONG_ASSETS`（默认 `E:/Project/Model/SLY/T/Assets`）重新生成《哀鸿》素材示例；普通源码重建无需执行。

源码 ZIP 不重复包含 Ren'Py SDK 和依赖目录；维护者需按上述步骤准备运行时。Spine 4.2 的源码、Windows DLL 和可编辑界面模板随源码包提供；`pnpm spine:build` 可用 Visual Studio C++ 工具重建 DLL。`pnpm exec tsx scripts/prepare-release-artifacts.ts` 收集源码 ZIP、已验收的示例游戏和 SHA-256 校验清单。自动/跳过、跨周目记录与片段隔离可用 `scripts/verify-player-state.ts` 验证；安装与升级验证见 `scripts/verify-installed.ts`。

“哀鸿模板 · 两章与三个结局”的标题动画使用图片图集与 Spine 骨骼数据实时播放。普通工程也可从素材库导入骨骼动画，添加界面组件，再通过播放、暂停、速度及组件属性蓝图节点控制。操作步骤见 [骨骼动画与蓝图](docs/spine-authoring.md)。`pnpm test:spine-authoring` 验证桌面导入、可视化创作、保存重开和独立 EXE；加 `--packaged` 可对打包产物执行相同流程。

设置专项：`pnpm exec tsx scripts/verify-settings-runtime.ts --export` 检查实际控件、声音、确认分支、读档和重启；`pnpm exec tsx scripts/verify-settings-authoring.ts --packaged` 从空白界面通过安装产物的控件创作并导出；`pnpm exec tsx scripts/verify-standard-settings.ts` 检查标准控件逐项替换。

## 资源声明

示例画面与音乐来自用户提供的《哀鸿》素材，来源说明见 `resources/SAMPLE-CREDITS.md` 和 `resources/example/CREDITS.md`。编辑器依赖许可原文见 `resources/THIRD-PARTY-NOTICES.txt`，运行时完整许可声明随包提供；打包时自动重新收集依赖许可。源码尚未单独指定对外开源许可证。
