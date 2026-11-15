# 通用控件属性面板实施与验收记录

日期：2026-11-08（Asia/Shanghai）

状态：**约定范围已实现并验收完成。统一构建、最终类型检查、1871／1871 项单测、4 项桌面与 3 项游戏专项通过；游戏共 82 项运行时断言，外观与集合专项共 730 项绘制检查，另有剧情图黑底像素回归。11 次专项的 29 个隔离目录、本轮 unit-temp 的 14 个子项及一次测试专用存档目录已清理，任务进程 0，真实工程哈希未变。未提交、未打包。** 最终审计见 [final-audit.json](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/validation-main/final-audit.json>)。

本页记录实际实现和本轮证据。[通用化方案](<E:/Project/Visual Novel Studio/editor/docs/ui-inspector-generalization-2026-11-08.md>)与[23 类控件审查](<E:/Project/Visual Novel Studio/editor/docs/ui-control-inspector-review-2026-11-08.md>)保留为实施前的历史依据；其中“尚未实施”、旧字段数量、旧截图及旧源码行号均描述当时状态。

## 1. 已实现的编辑方式

### 共用结构、搜索与连续操作

普通控件使用“内容、位置与大小、外观、交互”四组。顶部显示实际控件类型、名称和所属界面方案；组件设置与页面设置保持独立。滑条、输入框、开关或选项组的类型根据绑定来源解析，避免由旧的控件种类名称决定错误入口。

同一工程、页面、方案和实际控件类型共享分组偏好及位置单位。给两个按钮连续调整外观时，切换按钮保留当前状态、展开的组和任务位置。普通浏览、搜索及页面设置分别记录滚动位置；输入草稿仍属于被选中的具体控件，不传给另一个对象。

“搜索控件属性”使用完整中文字段目录，并按当前能力过滤。命中时临时展开对应组及嵌套组，清除后恢复原折叠偏好；搜索、状态预览和单位切换不写入工程。分组首次打开才挂载内部字段，之后收起保留草稿；昂贵的联动诊断在组关闭时停止扫描。

玩家剧情图继续使用“内容、节点样式、布局与连线、玩家操作”专用四组，另以“整张图的位置”“整张图的交互”表达整个控件的设置范围。连线图片、显示区域、滚动条、当前位置标记、底图、分段文字和阴影的嵌套组已接入同一搜索与折叠机制。

220、280、360 CSS px 属性栏中的长标签、颜色字段和复杂输入可换行；明暗主题共用正文、说明及边框变量。新桌面专项已验证三个代表控件的 18 个宽度／主题组合，没有横向溢出，关键字段与来源文字对比度不低于 4.5。

### 外观值、来源与恢复

设计值读取与修改通过独立设计适配层处理，共用现有属性定义和真实默认值解析。显示值可以区分页面默认、其他状态回退及本地单独设置；恢复某项只移除该项的覆盖，保留其他状态、内容、绑定和布局。

按钮按普通、悬停、按住、选中、禁用状态集中编辑适用的背景、文字颜色、图片及亮度，状态同步到画布和适用的外观小样。图片状态回退使用真实解析链；普通图片也可调整普通亮度。复杂列表和系统输入控件直接以画布为准，避免用普通按钮小样冒充其完整状态效果。

颜色支持文本值、透明度及“无填充”。未设置与显式透明分开保存；透明文字背景、按钮悬停沿用普通背景、默认白色边框等均显示真实值。“恢复本组外观”只清理归属外观的设置，保留内容组的图片适配。恢复操作单独进入撤销历史，避免与刚输入的数值合并。

字段根据真实支持能力出现：面板、进度条不再出现无效皮肤入口，进度条不显示字体；文字、媒体和集合按各自能力提供字段。字体继续使用项目素材选择器，可搜索、浏览和导入项目字体。字号受既有高度规则限制时，面板说明设置值、有效值及原因；本轮没有增加固定字号／自动适配新规则。

圆角、媒体背景与前景边框、RGBA 表面及进度条合成已同时接入编辑器和游戏生成代码。圆角仅裁切控件自身表面，不借此裁切子对象或文字阴影；透明进度背景避免重复绘制叠加。外观游戏专项的 6 个场景、21 项运行时断言与 386 项绘制检查已通过，包含真实图片和视频、父子绘制顺序、状态切换及恢复。

### 父布局与界面方案继承

自由位置明确相对画面、父内容区或父外框。横／竖排列的子控件仍保留有效的 X/Y，标签改为“附加偏移”；容器间距、排列、内边距和滚动与子对象本身的几何分开。暂不适用但已保存的布局值保留说明和入口，不因面板隐藏而被清除。

界面方案继续采用原有的**整控件覆盖**模型。面板准确标出来源及覆盖范围；“恢复整个继承控件”移除当前方案对该控件的覆盖，子对象各自的覆盖保留。恢复前检查当前及下游受影响方案的父子关系，新产生的无效层级会阻止写入并说明原因；无关的既有无效草稿不会一概阻止恢复。

隐藏继承控件与删除本地控件分别表达；页面设置可恢复本方案隐藏的控件。保存期间禁用写入，字段回调核对工程、页面、方案和具体对象身份，避免切换目标后把旧输入写到新对象。

## 2. 参数、事件和联动

- 设置滑条、下拉／选项、文字输入、开关按实际输入模式显示绑定与内容入口。失效参数保留原 ID，并明确显示“参数已删除”，不会假选音乐音量。
- 切换绑定作为一次完整操作：清理不兼容的数值范围，保留仍适用或暂时休眠的选项、输入和外观设置；失败不留下部分改动，一次撤销恢复原来源及范围。
- 自定义范围先在本地编辑上下限和步长，再“应用整个控件范围”；搜索和折叠不丢失草稿。控件范围、选项索引、文字长度及引擎边界在真正修改前检查。
- 点击摘要来自实际处理器链。仅配置点击事件的按钮显示“点击 → 执行事件”；展开后可查看真实顺序并定位已有蓝图。快捷键使用统一键名目录。
- 显示、可操作、选中条件以本地草稿编辑，明确应用、清除与撤销；点击添加不会先把空条件写入工程。
- 属性联动显示当前参数及已有蓝图，支持定位、换源、解除。换源保留原图、节点和连线身份，不增加定时器；解除只删除确认由该入口管理且没有其他引用的自动图。
- 共享、继承、被外部调用或已自定义的蓝图受到保护，不能由快捷入口覆盖或误删。普通页面／控件事件创建也不会误复用自动联动图。

联动继续使用原有 **0.05 秒定时更新**机制。本轮解决重复创建和管理边界，没有改为事件驱动，也没有通过本次验收得出大工程性能结论。

## 3. 集合内部部件与内容管理

存档、历史、图鉴、音乐、语音、选项及章节列表的专用设置已按内容、布局、外观、交互分配。外观组使用“编辑列表部件”，明确标出设置影响此列表的所有条目；整个控件外观与条目内部部件分开。

存档可分别编辑缩略图、章节、对白摘要、槽位编号、读写按钮、自动档、缩略图相框及分页。历史可分别编辑姓名、正文、重播／收藏按钮和滚动条。画布中真实双击部件会选择该部件并展开对应面板；修饰键选择保留原有选层／多选行为，不由旧的双击回退路径抢走。

存档读写按钮的编辑模式跟随画布和实际格子：固定自动存档格使用读取模式，普通格按保存／读取模式选择对应底图。该入口的源代码已完成；新 19 组专项直接验证了摘要与历史正文的真实鼠标双击，未将所有读写格子的双击组合记作已穷举验收。

内部文字沿用共用字体、字号、颜色及对齐编辑。新覆盖保存在 `list.textStyles`；原 `summaryFontSize`、`historyNameFontSize`、编号／分页颜色等旧字段继续作为兼容来源。恢复某个部件的文字设置后重新沿用旧值或基础值，不改写其他部件。导出时字体素材转换为游戏字体路径，移除的可选字段不会被导出为阻断默认值的空覆盖。

自定义位置的初始矩形来自当前实际布局，不再给所有部件套同一矩形。存档缩略图首次开启自定义位置的前后几何误差已在桌面专项中限制为小于 1.5 CSS px。没有生效的可选部件仍说明开启后会增加该内容。

相关缺陷已修正：

- 关闭“显示条目文字”会同时隐藏自定义章节和摘要，预览与游戏一致。
- 历史列表不显示普通网格行列；姓名字号在上下和分列布局中采用统一解析。
- 历史滚动条始终有系统／自定义入口，取消自定义真正恢复系统滚动条，并可单次撤销／重做。
- 图鉴真实默认值显示为两行，移除“0 行就是滚动”的错误提示；本轮没有新增图鉴滚动模式。
- 图鉴、音乐、语音素材管理进入较宽的独立内容对话框。增删、排序、来源切换等离散操作分别记录撤销；连续名称输入仍可合并。关闭对话框不是取消已经写入的编辑。
- 章节列表页数使用实际剧情入口数；存档自定义摘要不再叠出重复底栏，已有存档不再显示为空槽，自动存档不显示不适用的删除操作。

## 4. 代码责任划分

| 职责 | 主要代码 |
| --- | --- |
| 面板壳、分组记忆、中文搜索及布局解释 | `src/renderer/UiInspector.tsx`、`UiInspectorContext.tsx`、`UiPropertyGroup.tsx`；`src/core/ui-inspector-session.ts`、`ui-inspector-search.ts`、`ui-inspector-layout.ts` |
| 设计值／来源／定向修改与恢复，外观适用能力 | `src/core/ui-design-properties.ts`、`ui-inspector-appearance.ts`；`src/renderer/UiCommonAppearance.tsx` |
| 实际输入模式、绑定切换、交互摘要及自动联动管理 | `src/core/ui-control-authoring.ts`、`ui-inspector-interaction.ts`、`ui-parameter-links.ts`；`src/renderer/PlayerPreferences.tsx`、`UiInspectorInteraction.tsx`、`UiParameterBindings.tsx` |
| 整控件继承恢复与父子关系保护 | `src/core/ui-hierarchy-edit.ts` |
| 集合布局、内部部件、文字兼容与内容管理 | `src/core/ui-collection-layout.ts`、`ui-collection-text.ts`、`ui-collection-edit.ts`；`src/renderer/UiCollectionInspector.tsx`、`UiCollectionEditing.tsx`、`UiCollectionContentDialog.tsx` 及各集合预览 |
| 编辑器与游戏表面绘制、内部文字及滚动条 | `src/renderer/UiComponentVisual.tsx` 等预览；`src/runtime/screens.ts`、`ui-runtime.ts`、`ui-widgets.ts` |

设计写入没有直接复用运行时私有快照函数 `applyUiPropertySnapshot`，避免把运行状态或绑定文字误写为设计值。新逻辑继续走现有草稿、保存及撤销机制；此次整理没有创建第二套完整工程或控件模型。

## 5. 已完成验证与证据

遵守“全部实现后统一编译、验证、验收”。以下为本页整理时已存在且读回为通过的报告；目录名使用 UTC，因此落在 `2026-11-07T19-…Z`，本地日期为 11 月 8 日。

| 项目 | 已确认结果 | 证据 |
| --- | --- | --- |
| 统一编辑器构建 | `tsc --noEmit`、Vite 与桌面构建完成；末尾空行整理后再次构建，产物哈希与已验收版本一致 | [build-final.log](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/validation-main/build-final.log>) |
| 最终类型检查 | `corepack pnpm typecheck` 通过；包含最终验收脚本修正 | [typecheck-final.log](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/validation-main/typecheck-final.log>) |
| 全量单元测试 | **1871／1871 通过**，0 失败、0 跳过 | [unit-tests-final.log](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/validation-main/unit-tests-final.log>) |
| 通用面板 Electron 专项 | **19 组通过**；23 类代表样例、有效默认值、搜索与草稿、换源／联动、恢复与撤销、内部部件、18 个窄栏／主题组合、保存重开 | [report.json](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/editor-2026-11-07T19-09-52.516Z-16ca7c50/report.json>) |
| 流程图布局 Electron 回归 | 通过；分段文字、连线、滚动条、方向及锁定显示等原断言保留 | [report.json](<E:/Project/Visual Novel Studio/editor/artifacts/flow-layout-editor/2026-11-07T19-11-05.164Z/report.json>) |
| 玩家剧情图 Electron 回归 | **10 组通过**；节点来源／分段、预设、保存保护、目录翻页、预览状态、窄栏与重开 | [report.json](<E:/Project/Visual Novel Studio/editor/artifacts/player-flowchart-editor/2026-11-07T19-12-32.694Z/report.json>) |
| 流程图文字黑底 Electron 回归 | **3 组通过**；实际黑底像素、基础／预设操作、撤销保存重开及恢复草稿兼容 | [report.json](<E:/Project/Visual Novel Studio/editor/artifacts/flow-text-backdrop-editor/2026-11-07T19-18-46.751Z/report.json>) |
| 集合与输入控件 Ren'Py 专项 | **4 场景、54 断言、344 像素样本通过**；真实存档、内部字体颜色对齐、旧值回退、历史两种排列与滚动条状态、极小下拉尺寸 | [report.json](<E:/Project/Visual Novel Studio/editor/artifacts/ui-collection-inspector-runtime/2026-11-07T19-20-26.609Z-52356/report.json>) |
| 外观 Ren'Py 专项 | **6 场景、21 断言、386 项绘制检查通过**；圆角与 RGBA 边框、真实图片／视频、透明进度合成、子对象顺序、状态图片及恢复 | [report.json](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-appearance-runtime/2026-11-07T19-28-06.741Z-48320/report.json>) |
| 流程图文字黑底 Ren'Py 回归 | **7 运行时断言及像素比较通过**；分支、目录、缩放与兼容旧阴影 | [report.json](<E:/Project/Visual Novel Studio/editor/artifacts/flow-text-backdrop-runtime/2026-11-07T19-22-00.069Z/report.json>) |

通用面板报告没有 renderer 异常；两次启动的自有 Electron PID 均已退出。代表截图：

- [220px 明亮主题属性栏](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/editor-2026-11-07T19-09-52.516Z-16ca7c50/08-light-220.png>)。
- [存档摘要部件](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/editor-2026-11-07T19-09-52.516Z-16ca7c50/05-save-caption-part.png>)。
- [图鉴内容管理](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/editor-2026-11-07T19-09-52.516Z-16ca7c50/07-gallery-content-manager.png>)。

上述桌面专项对应构建哈希：`dist/index.html` 为 `590acc916543f3b716e69c9f5825866f4dcc560056a8a06f4c04bfdc82d1802f`，`dist-desktop/main.cjs` 为 `72e7a47f4120f57b869eaa99f0fb0e1b1193c9174f1c1edee075ad16ac2dd5d7`。这些哈希用于定位已验收产物，不表示用户正在打开的旧进程或安装版已经刷新。

### 验收中发现并收口的问题

- 嵌入的参数联动表单仍继承旧工具栏 46px 固定高度，内容盖住下一组标题。已改为自适应高度并移除内部选择框的旧宽度上限；滚动定位为顶部固定标签保留空间，正常鼠标点击回归通过。
- 历史滚动条成功取消后会卸载自定义复选框。脚本原用 `uncheck()` 等待已卸载输入，改为真实点击后验证控件消失、系统滚动条恢复及撤销重做，产品取消逻辑保持正确。
- 集合游戏样例起初把只适用于存档／历史页的控件放入自定义页，被 schema 正确拒绝。现使用合法内置页面及编译器生成的 19 个独立控件 screen，没有放宽模型限制。
- 外观游戏初稿直接读取离屏透明 Surface 的 alpha；SDK 二次缩放令原生半透明 `Solid` 同样读出 64，不能据此认定产品透明度错误。现用黑白不透明底合成、RGB 参照及差值反推覆盖率，检查单层、双层、三层 128／192／224，并使用原生尺寸取像。没有为通过测试而改变产品透明度。
- 两项初稿单测分别沿用“媒体不支持背景”的旧预期、把根皮肤合法空值误匹配为列表参数问题。已改为检查媒体背景读写恢复和精确的历史滚动条 options；21 项定向用例及最终全量单测通过。

本轮新增单元用例覆盖设计属性、能力／搜索、任务状态、布局、交互、绑定切换、自动联动、集合文字／布局、继承恢复及圆角导出。首次失败日志和重跑报告保留，最终没有待修复的本轮验收失败。

## 6. 保护范围与后续边界

真实工程 `E:\Project\Visual Novel Studio\我的视觉小说1\project.vns.json` 只读核对。通用面板专项前后 SHA256 均为 `33aef64ba7ad196aa9f1b0e88a369996ea9efac1890a9cfc7c58c0c7f3853e0f`，没有写入作者工程。

整轮 11 次 GUI／游戏运行（含失败重跑）的 `cleanup.json` 共记录 **29 个**隔离目录已删除，逐一读回确认均不存在，报告、日志和截图保留。全量单测统一写入本轮 `validation-main/unit-temp`，14 个子项及该目录已清理；未处理历史被拒清理的其他目录。

首次外观游戏编译在加入隔离前生成了独立的 `AppData/Roaming/RenPy/vns_ui_inspector_appearance_runtime` 测试存档。后续脚本已在编译前隔离全部存档；收尾仅对该确认为本轮创建、只有两个文件且无链接的专用测试目录申请工作区外清理权限，批准后删除。用户游戏存档没有清理。记录见 [appearance-save-cleanup.json](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/validation-main/appearance-save-cleanup.json>)。

最终只读进程核对为 0 个本轮任务进程；全部产品源码不晚于已验收构建，真实工程 SHA256 与开始时一致。详见 [逐次专项清理记录](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/validation-main/verification-runs.json>)、[单测清理记录](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/validation-main/unit-temp-cleanup.json>)和 [最终审计](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/validation-main/final-audit.json>)。

本轮不提交、不打包、不发布，不调用付费 AI 接口。变更位于开发源码及验收资产；没有自动更新安装版。

仍需单独设计或讨论的能力：

- 可复用的独立控件模板、公开参数／事件、实例差量覆盖及更新传播。当前整控件方案继承与内部部件编辑不等于 Unity Prefab／UE UserWidget 的完整模板体系。
- 参数联动从轮询改为事件驱动，以及真实大工程的持续性能采样。
- 固定字号／自动适配新规则、图鉴滚动模式、跨对象批量写入与冲突处理。

真实 Spine 素材的完整播放未纳入新增外观游戏专项；能力接口及导出路径有单元用例，但不能代称真实素材渲染已经覆盖。重玩／解锁、文字计时、局部粗斜体三态和原生菜单语义不在本轮面板整理中扩展。
