# 编辑器易用性优化（2026-10-28）

面向零代码作者：简洁、通用、直观、易懂。演出编辑参考剪映，界面与蓝图参考 UE5。

## 已完成

### 数值输入只拦截会出错的值
- `NumberInput` 统一处理 `min`/`max`：键入过程中不打断，越界的中间值暂不提交，离开输入框或按回车时钳制到边界。以前直接键入的负数等非法值会原样写入工程，保存时才报错。
- 去掉主观上下限（如字号 16–64、时长 60/3600 秒、列数 12、页码 99、像素上限、镜头缩放 25%–400%、骨骼速度 8 倍、动画循环/速度上限、分辨率 640–3840）。
- 保留防错限制：0–1 比例（透明度、音量、裁切、锚点）、整数要求、尺寸与时长非负、数量至少 1、字号和分辨率必须为正、Ren'Py 偏好滑条的固有范围、随机种子上限、散布角 360°。
- schema、蓝图校验、编辑器预览、Ren'Py 运行时（`ui-animation-runtime.ts`）与说明文案同步；`tests/numeric-ranges.test.ts` 守住规则。

### 蓝图节点易读
- 取值节点（读取输入、读取状态、读取玩家选项、旧小游戏取值）改为 UE 式单行：“前缀 + 名称 + 输出点”，读取对象在右侧属性中选择（`blueprintGetterNode`）。
- 打开蓝图时适合窗口的最低缩放为 60%，保证文字可读；“显示全部节点”按钮仍完整缩放。
- 自动排列、暴露参数时的避让和章节/封装生成器按 40 高度排布读取节点（间距 56）。已有工程不移动节点，可用“自动排列”整理。
- 详细信息面板去掉“连线”页签和工具菜单中的“连线列表”：点击连线即在画布上显示连线说明和断开按钮，Delete 断开所选（可多条），拖动端点改接。AI 助手的 `showBlueprintConnections` 改为在画布上选中全部连线（命令名不变，旧对话记录仍然有效）；旧导航记录中的“连线”页签按“节点参数”打开。
- 框选与 UE5 一致：拖动时只显示淡的中性框线，松开后只高亮选中的节点和连线，不再留下蓝色选区框。React Flow 的选区框改为透明且不拦截点击，选区内的空白处点击即取消选择；拖动任一选中节点仍整体移动。
- “添加节点”窗口的滚轮像右侧滚动条一样滚动列表，不再逐项移动高亮；内嵌的中文指令面板本来就是这样（`useMenuWheel`）。
- 事件图左侧“我的界面”参考 UE5“我的蓝图”：控件、事件、动画、页面输入与结果、状态、页面设置各有一条通栏类别栏（折叠箭头、图标、数量、右侧新增按钮），点击类别栏即折叠，折叠状态会记住（`UiLibraryHeading`）；在折叠的类别上点“新增”会先展开。事件行带红色事件菱形，状态行按类型显示与引脚相同的颜色，行高收紧，说明文字统一为次要色，所选控件的操作放在一张卡片里。

### 演出直达时间轴
- “编辑演出”遇到只包装一个时间轴的蓝图（事件开始、读取输入、输出结果、唯一时间轴调用）时直接打开时间轴，顶部“返回蓝图”回到逻辑层（`timelineWrapperCall`）。

### 演出预览与时间轴
- 从台词打开演出时，预览使用这句台词的播放设置（淡出、停留、淡入），与游戏运行一致；直接调用时间轴或经包装蓝图直达时都生效。
- 时间标尺、播放头和拖放素材的时间对齐到标尺显示的 0.01 秒，关键帧不再记录为 `3.000000305` 这类带误差的值。
- UI 预览“按时间预演”不再因任何工程变化停止计时。预演是对当前工程重放操作记录，现在只在改动让此刻的重放结果不同时才停止：用旧工程按同样的操作再算一次并比较（`sameUiPreviewResult`）。目录中新文件被自动导入、整理文件夹、保存时移动素材都不再打断；改动画面中的组件或此刻已生效的蓝图逻辑仍会停止，可再点“播放计时”继续。只影响之后的改动（如尚未触发的定时器间隔）继续播放，到时按新逻辑生效（`tests/ui-logic-preview.test.ts`）。

### 修复的数据丢失与崩溃
- 文本剧本中带【id】引用的调用行不再按空格拆成“指令 + 参数”。此前新建的“独立演出 1”这类蓝图写成 `@独立演出 1【id】` 后，会被误认为 `@独立演出` 指令：首次编辑背景等动作时，模块被拆成两个节点，刚编辑的动作丢失（`tests/text-script-command-names.test.ts`）。
- 演出目标失效时给出提示并回到安全状态，不再让整个编辑器白屏。
- 关闭编辑器后进程残留在后台：`will-quit` 等待图片工作线程清理完后再次调用 `app.quit()`，没有进行中的图片任务时这一调用发生在同一轮微任务里，被 Electron 忽略，窗口关闭但进程一直运行。现改为下一轮事件循环再退出（`main.ts`），并新增 `scripts/verify-editor-quit.ts`：有、无未保存修改时关闭，进程都须在 10 秒内以 0 退出。
- 停用“键盘”页的作品无法启动（Ren'Py 报 `ScreenNotFound: vn_components_keyboard`）：导出时停用页面的 screen 被删除，但保留的引擎页面 `input` 仍 `use` 键盘页组件。aihong 模板默认停用键盘页，从模板新建的作品都会受影响。现在指向已删除 screen 的 `use` 改为空语句（`omitDisabledUiScreens`，`tests/sample-cleanup.test.ts`）。
- 保存后素材重复、刚保存又显示未保存：保存会把素材文件整理进分类文件夹，而后台每 5 秒的目录扫描若在保存期间或用保存前的工程比对，就把移动后的文件当作新素材再导入一份。现在扫描排在保存之后，并按最近一次保存的路径识别已有文件（`asset-discovery.ts`、`main.ts`，`tests/asset-discovery.test.ts`）。
- 没有页面外观设置的作品打开设置、存档、读档页时崩溃：原生样式前缀查不到页面时得到空字符串，拼出无效样式名；现在回退为不加前缀（`ui-page-styles.ts`）。
- 滑条吸附步长后出现 `0.35000000000000003` 这类浮点尾数，蓝图中“等于 0.35”的判断会失败。编辑器预览与 Ren'Py 运行时都按步长的小数位取整（`uiControlUserValue`、`vn_ui_range_user_value`，`tests/ui-control-interaction.test.ts`）。
- 子页面中按 Esc 或右键返回上一步：从设置页进入的子页面（如角色音量）回到设置页，由蓝图直接打开时回到打开它的页面；预览与运行时一致（`ui-logic-preview.ts`、`ui-native-page-runtime.ts`、`screens.ts`，`tests/ui-confirm-preview.test.ts`）。
- 预览中滚动后的原生设置页点击位置偏移：竖向滚动条让内层画面变窄，换算比例时误用了内层宽度；现在按最外层画面换算（`uiPointerInPlane`）。

### 参数面板
- 内置游戏设置：没有自定义参数时内容居中、占满宽度，不再留半屏空白；音量和不透明度直接以百分比输入（仍存为 0–1）；滑条、数值、单位三列对齐；文字速度标“字/秒”，自动播放间隔标“越大越慢”并附说明；顶部说明精简为一句。
- 参数列表与详情统一使用“随存档保存 / 本地持久化”；去掉重复的存储标签、与生命周期表重复的说明和开发者备注。

### 参数集支持图片、音频、视频
- 参数类型新增“图片 / 音频 / 视频”（`type: 'asset'` + `assetKind`，值为素材 id，`''` 表示无）。参数集工具栏和右键菜单的“素材”添加；初始值用带缩略图的素材选择器；列表、资源管理器、文本补全显示素材名而不是 id。
- 剧情文本：`@设置：头像 = 素材名`、`@条件：头像 == 素材名` 按同类素材的名称解析，`无` 清空，同名素材写 `名称【id】`；找不到素材或用 `+=` 时报出具体问题。插入指令面板对素材参数提供素材下拉。
- 界面：图片、视频组件的“图片来源 / 视频来源”可选同类参数（`assetParameterId`），参数改变时运行时、UI 预览和设计画布都跟随，参数为空或素材无效时显示组件自己的素材。
- 蓝图：读取状态的输出、设置状态的输入为素材类型，内联选择器只列同类素材；图片参数连到音乐输入等类型不符的连线在检查中报错。“播放音乐”的素材为空时不播放（与“播放音效”一致），不再弹出 Ren'Py 错误。
- 运行时：`vn_parameter_set` 接受素材参数（此前“恢复默认”会因类型检查失败）；游戏启动和读档时，存档或本机记录中指向已删除素材的值恢复为初始值。素材参数没有玩家控件：默认设置菜单不显示，设置控件不能绑定（有诊断）。
- 跨工程粘贴素材参数时，目标工程没有对应素材则初始值清空。
- 验收：`tests/asset-parameters.test.ts`、`scripts/verify-asset-parameters-runtime.ts`（真实 Ren'Py：剧情切换、组件回退、音乐播放与空值跳过、失效素材修复、恢复默认）、`scripts/verify-asset-parameters-editor.ts`（参数集添加、选择初始图片、绑定图片来源、画布随参数切换）。
- 暂未做：剧情文本中 `@背景音乐` 等指令直接引用参数（目前经蓝图实现）。

### 时间轴属性编辑
- 没有关键帧的属性（位置、缩放、不透明度等）在播放头位于片段外时也能直接修改，整段统一生效；带关键帧的属性仍需把播放头放进片段（`setCompositionPose`）。

### 文本模式光标
- 文本框失焦时记录作者的实际光标；舞台编辑写回文本后，在下一帧为未聚焦的文本框恢复光标，不再跳回开头。

### 其他
- 角色页默认显示全部角色；共享内容文件夹中含蓝图、状态、剧情等其他内容的文件夹不再出现在角色目录。
- 演出预览不再显示写死的示例台词，改用实际调用这段演出的台词与说话人；独立演出不显示台词。
- 页面设置字号可正常逐键输入两位数。
- 剧本模块模式去掉重复的“对白与演出”标题、无效的“彩色标注”和配色设置、长期占位的提示，只保留“故事入口”；文本模式不变。
- 模块模式下选中独立演出时，右侧不再重复显示左侧卡片里的同一份演出表单。
- 作品设置中的分组标题去掉重复的展开箭头；导出页图标数值最多显示两位小数。
- 资源搜索在“在文件夹内”范围时，若子文件夹中还有匹配项，状态栏提供“显示全部 N 个匹配”。原有“不平铺嵌套结果”的行为保留。
- 界面编辑器选中列表类组件（音乐列表、存档栏、画廊、章节列表等）时，“列表与内容”默认展开。这类组件没有“内容与素材”分组，以前选中后只看得到位置与大小。
- 参数的滑条范围输入框以可见的“最小值 / 最大值 / 步长”作为无障碍名称（原为“设置滑条min”这类内部名）。

## 暂未改动（候选）
- 流程图的“连线列表”下拉占用整行。
- 模块模式下普通台词的演出表单仍同时出现在左侧卡片与右侧面板；右侧是多项验收覆盖的主编辑位置。
- 角色音量页作者放置的“返回设置”按钮在预览中总是回到设置页；由蓝图直接打开该页时，与 Esc/右键的“返回上一步”不同。尚未与运行时逐项对照。
## 验收脚本维护
本轮修复了 5 个落后于界面的验收脚本：`verify-blueprint-input-layout`、`verify-module-editing`、`verify-performance-layout`、`verify-timeline-layer-keyframes`、`verify-ui-simplicity`。`scripts/lib/ui-disclosures.ts` 的 `openDisclosure` 现在会先展开外层分组。

`verify-performance-layout.ts` 的前半段与新增的收尾检查覆盖当前流程；后半段针对已退役的“显示角色实例关键帧”和旧对象属性面板，需设置 `VNS_VERIFY_LEGACY_TIMELINE=1` 才运行。对应新功能由 `verify-character-visual-timeline`、`verify-timeline-layer-keyframes`、`verify-composition-*` 等覆盖。

测试结束或失败时，有未保存修改的编辑器会弹出“是否保存”确认框，之前导致验收卡住并在桌面上留下确认窗口。现在开发版在 `VNS_TEST_DISCARD_ON_CLOSE=1` 时关闭窗口直接丢弃测试修改（打包版忽略该变量）：`launchDesktopFixture` 默认开启，需要测试保存确认的脚本传 `confirmClose: true`（`verify-close-save-export`、`verify-preview-close-dialog`、`verify-ui-save-and-text`）；直接启动编辑器的脚本也已加上该变量（测试关闭保存的 `verify-authoring` 除外）。

统一验收中另外 5 个脚本落后于界面，已更新：`verify-authoring-opt`（资源范围改为“资源显示范围”下拉框，类型筛选弹层在双击文件夹后关闭需重新打开，卡片尺寸按 0.01px 比较以忽略亚像素误差）、`verify-ui-save-and-text`（通过“添加组件”菜单添加；各页面共用一份界面草稿，切换页面不再询问；关闭窗口改为一次原生“保存工程”询问，脚本替换该对话框，不在桌面上弹出真实窗口）、`verify-close-save-export` 与 `verify-preview-close-dialog`（随“列表与内容”默认展开恢复）、`verify-editor-project-colors-parameters`（随滑条范围标签恢复）。

UI 预览窗口关闭后再调用 `app.exit()`，Electron 会在约 5 秒后以 0xC000041D 崩溃退出，并锁住测试配置目录；单独的普通窗口没有这个问题，撤销本轮 `main.ts` 改动的对照实验结果相同。作者正常退出（关闭窗口或 `app.quit()`）约 0.2 秒干净退出；产品中 `app.exit()` 只在创建窗口前的便携版目录错误路径使用。8 个打开过 UI 预览的界面编辑器验收脚本（`verify-ui-layout-editor`、`verify-ui-image-editor`、`verify-ui-control-*-editor`、`verify-ui-property-surfaces-editor`、`verify-ui-spine-editor`、`verify-ui-video-editor`）收尾改用 `app.quit()`。

本轮还更新了 `verify-story-workspace`、`verify-performance-workspace`、`verify-character-visual-timeline` 中落后于界面的步骤（带参数名的指令文本、指令面板改为输入“/”打开、视觉片段属性页签、旧 `@章节…` 指令走加载迁移、旧 `chapterTitle` 阶段放到 `VNS_VERIFY_LEGACY_CHAPTER` 开关后）。以下仍待单独分析（第一项已用恢复原 `NumberInput` 的对照实验确认不是本轮引入；第四、五项涉及的预览过渡与音频代码本轮未改动；第二、三项未做对照）：
- `verify-story-workspace`：文本模式下用舞台数值框修改角色纵向位置后，“显示角色”一行没有更新。
- `verify-performance-workspace`：问题定位到主题默认按钮后，期望焦点落在“点击行为”字段。
- `verify-character-visual-timeline`：播放头越过时间轴结尾后，预览仍保留角色画面（期望消失）。
- `verify-v08-editor`：预览中同一时刻出现两个图片过渡元素（期望一个）。
- `verify-text-preview-pause`：长文本末尾播放预览时，检测不到正在播放的预览音频。

后续统一验收中更新的脚本：`verify-ui-more-settings`（选项控件的值改为序号，按选中项的文字核对）、`verify-voice-collection-pages`（模板删除收藏语音要先确认，脚本断言出现确认框后再确认）、`verify-ui-property-surfaces-editor`（不设上限的范围显示“0～不限”）。`verify-ui-runtime` 在用例开头关闭过渡：跨台词的舞台溶解在交互结束前一直算作“进行中”，Ren'Py 测试的 `click` 会一直等它，嵌套到 RecursionError。玩家不受影响（选项按钮不在 master 层），过渡另有专门脚本验证。

截图不要写进工程文件夹：编辑器会自动导入工程根目录、`game` 和素材目录中新出现的媒体文件，测试中途会因此停止预览播放、让工程变为未保存。`verify-ui-native-preferences`、`verify-ui-more-settings` 已改存到 `shots/` 子文件夹。

当前状态：单元测试 1638 项全部通过，类型检查与构建通过。统一验收中仍失败的脚本：
- 落后于模板或界面：`verify-aihong-ui`（需要模板中已没有的章节标题节点，并测试已停用的章节选择页）；`verify-ui-parameter-controls`、`verify-ui-parameter-create`、`verify-ui-player-preferences`（依赖的“高级 UI 蓝图”按钮在已提交版本中也不存在）。
- 缺少运行前提：`verify-settings-runtime`（需要 `artifacts/aihong-template/project.vns.json`）、`verify-ui-event-variable-runtime`（需要 `VNS_UI_EVENT_PROJECT`）、`verify-aihong-choices` 与 `verify-aihong-dialogue-menu`（需要 2026-09-10 的界面检查数据）。
- 已有失败：`verify-ui-control-interaction-editor`、`verify-ui-control-properties-editor`、`verify-ui-video-editor`、`verify-ui-spine-editor` 在 10-17 与 10-26 的记录中就停在同一步。
- 受桌面环境影响：`verify-authoring-opt` 用真实鼠标点击游戏窗口，其他窗口遮挡或抢走前台时会失败，重跑通过（此前停在保存后的未保存标记，即上面的保存与素材扫描冲突，已修复）；`verify-ui-layout-toolbar-editor` 偶发失败，重跑通过。

### 计时预演与事件图（2026-10-30）
新增验收：`verify-ui-timed-preview-edits`（计时播放中往工程文件夹放入截图，导入后工程变为未保存但计时和演出声音继续；切换到设计模式不打断；改动当前预演页面中组件的宽度后停止并停在原时间，可再继续）、`verify-ui-event-graph-panels`（详细信息没有连线页签；框选后选区框透明且不拦截点击、选区内空白处点击取消选择；添加节点窗口滚轮滚动列表、画布不缩放；我的界面按类别折叠、记住状态，类别上的新增按钮先展开）。

随去掉连线页签更新：`verify-ai-blueprint-editor`（“选中蓝图全部连线”后断言两条连线被选中，再重新定位节点查看属性）、`verify-timeline-node-edits` 与 `verify-workbench`（在画布上点击连线，用连线说明上的“断开选中连线”按钮）、`verify-blueprint-interactions-editor`（中文指令面板的滚轮改为断言列表滚动、高亮不变）。同时修正与本轮无关的界面改名：连线说明中的“变量”现为“作品状态”；“资源分组”输入框的名称是“蓝图资源分组”；`verify-blueprint-selection-editor` 原先点击的工具栏位置现在是“添加节点”按钮，改为先移开焦点再按 Esc；`verify-ui-animation-playback` 先把状态列表切到“作品状态”再拖入作品参数。

本轮统一验收通过：`verify-ui-timed-preview-edits`、`verify-ui-event-graph-panels`、`verify-ui-native-preferences`、`verify-ui-stage-preview`、`verify-ui-music-preview`、`verify-blueprint-state-editor`、`verify-blueprint-capabilities-editor`、`verify-blueprint-editor`、`verify-ui-event-editor`、`verify-ui-page-interface-editor`、`verify-ui-button-events`、`verify-ui-event-scheme-ownership`、`verify-ai-blueprint-selection`、`verify-ui-header-editor`。以下失败点与本轮改动无关：
- 脚本已越过本轮相关步骤：`verify-ai-blueprint-editor` 之后找不到“高级界面蓝图”选择框；`verify-workbench` 点选并断开连线后，资源管理器中找不到 `ai_story_home`；`verify-blueprint-selection-editor` 的部分框选、只框节点删除和单条连线框选都已通过，之后框住两条连线时选中 0 条，去掉本轮的选区样式重跑结果相同。
- 停在本轮改动之前：`verify-timeline-node-edits` 修改间隔节点后重新读取时间轴蓝图时找不到该蓝图；`verify-blueprint-interactions-editor` 的节点上已没有“显示角色 · 过渡”字段。
- 依赖已不存在的按钮或名称：“交互预演”（`verify-ui-animation-playback`、`verify-ui-control-events`、`verify-ui-text-commit`）、“高级 UI 蓝图”（`verify-ui-timer-preview`、`verify-blueprint-panel-swap`、`verify-ai-ui-blueprint-selection`）、表单“创建界面图变量”（现为“创建状态变量”，`verify-ui-event-variables`）、节点说明中的“变量”（`verify-ui-graph-readability`）；`verify-ui-event-timeline` 点“添加时间轴”后工程中没有出现时间轴组件。
- 窗口尺寸差 1 像素（显示缩放取整）：`verify-ui-preview-window`、`verify-blueprint-toolbar-editor`。

### 过时脚本更新（2026-11-01）
新增 `scripts/lib/renpy-saves.ts` 的 `isolateRenpySaves(runDir)`。不带 `--savedir` 的 Ren'Py 命令（编译、检查）会读取 `%APPDATA%\RenPy\<存档目录>`，并合并进 `game/saves`、退出时写回。作者以前的游玩进度因此混进测试，测试也会覆盖作者的进度。运行 Ren'Py 的验收脚本先调用它，把本次所有 Ren'Py 进程的 `RENPY_PATH_TO_SAVES` 指向运行目录下的私有文件夹。导出不包含 `game/saves`，玩家不受影响。

保存等待：保存按钮在“保存中…”时也是禁用的，所以按钮变灰不代表已经写完。要等 `.ui-save-status` 显示“已保存”再读文件或切页。只等按钮禁用的 22 处（`verify-ai-animation-targets`、11 个 `verify-blueprint-*-editor`、10 个 `verify-ui-*`），以及点保存后立即读文件的 `verify-ui-design-return`，都已加上这一步等待。等 `.dirty-dot` 消失的脚本不用改：该标记在文件写完后才消失。

改后重跑，23 个脚本中 20 个通过，包括此前失败的 `verify-blueprint-toolbar-editor`、`verify-ui-control-events`、`verify-ui-event-variables`。其余 3 个的失败点与保存等待无关，是脚本落后于当前行为：
- `verify-ui-design-return`、`verify-ui-resource-migration-editor`：保存时会同步资源目录（`syncFolders` 默认开启），文件移入分类文件夹并按资源名重命名，例如 `assets/UI素材/实际画布图片.png`。脚本仍断言原路径。前者以前在保存完成前就读文件，现在读到的是真实保存结果。
- `verify-ai-animation-targets`：新等待通过后，脚本仍在等切换目标时的“保存界面修改”对话框；现在各页面共用一份界面草稿，切换时不再询问。

落后于当前行为、已更新的脚本：
- `verify-game-flow`：流程图默认只列章节。脚本把对白段落与选项设为可见，以覆盖滚动与标题。标题按控件 id（`…_label`）读取：只有一层清晰描边，柔和阴影是单独模糊的 `…_shadow` 副本。剧情入口总是解锁，后续章节到达后才解锁。用例开头关闭过渡。
- `verify-aihong-ui`：存档摘要保留最近多段对白，以空行连接。历史收藏按对白行记录（`voiceVisitKey`），共用同一录音的台词互不影响。模板删除收藏前先确认。
- `verify-blueprint-interactions-editor`：主题名直接取自 `editorThemes`，不再写死旧名称。
- `verify-presentation-fidelity`：章节页在实际游玩中淡入到已清空的黑色舞台上，而不是明亮的标题菜单上。测试在章节页下加一层黑底，淡入比例才是均匀的。
- `verify-ui-preview-navigation`：标题宿主没有游戏进度，不能打开存档页，读档仍可用。切到游戏内宿主后才能存档。

顺带修复的产品问题：
- UI 预演：菜单自身导航替换页面后，关闭时焦点回到最初的打开者（`UiLogicPreviewFrame`）。StrictMode 的重复挂载不再覆盖原焦点来源。
- 流程图当前位置标记：当前位置在未列出的节点中时，标记映射到它所属的已列出条目（见[流程图当前位置标记](flow-current-marker.md)）。
- 页面显示回调按页面实例执行：两个页面共用同一个显示蓝图时各自执行一次，预演与导出游戏一致（`vn_run_blueprint(..., show=True)`）。按钮回调和按钮主操作仍沿用原规则：同一蓝图在执行中（例如等待它打开的页面）时，重复触发会被忽略。单元测试已覆盖这两种情况。

当前状态：单元测试 1639 项全部通过，类型检查与构建通过。统一重建后，以下脚本全部通过：`verify-ai-animation-selection`、`verify-game-flow`、`verify-ui-confirm-preview`、`verify-ui-standard-confirm-preview`、`verify-ui-page-preview`、`verify-ui-click-preview`、`verify-ui-gallery-preview`、`verify-ui-key-preview`、`verify-ui-preview-navigation`、`verify-blueprint-interactions-editor`、`verify-blueprint-interactions-runtime`、`verify-aihong-ui`（4/4 用例，92/92 断言）、`verify-presentation-fidelity`。

待跟进（未改动）：
- 第一章的流程图入口用普通节点外框，第二章的独立标题用章节外框，两者可能不一致。
- 章节标题首帧约晚 0.35 秒出现。
- 自动保存不包含 UI 草稿。
- `verify-game-flow-path-runtime` 的测试工程编译失败。
- `verify-blueprint-tasks-runtime` 的 `task_call_save_remaining_time` 超时（其余 15 个用例通过）。页面显示规则修改前就已失败，存档隔离后重跑结果相同。
