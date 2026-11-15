# 控件属性的参数控制与双向同步

本轮将控件属性的控制来源统一到一份显式配置：默认使用原设计值或系统来源；需要关联参数时，从属性名称或值输入框的右键菜单设置单向跟随或双向同步。参数关联按属性生效，控件其他属性及事件保留自己的行为。新关联无需生成定时蓝图。

2026-11-10 续接：属性右键入口已扩展到文字、数字、下拉框、颜色和素材输入；菜单键及 `Shift+F10` 同样支持输入区。关闭菜单或取消设置会恢复原输入焦点；解除关联导致来源按钮消失时，焦点回到同项名称。帮助、恢复按钮及独立素材浏览器保留自己的操作，嵌套字段和资源弹层不会误开外层菜单。本次统一验收中的属性桌面专项13／13组通过，renderer错误为0，9张截图保留；见[桌面汇总](<E:/Project/Visual Novel Studio/editor/artifacts/editor-refinements-2026-11-10/validation-main/property-validation.json>)。下列11月9日记录是历史结果，本次结果以这里的续接和本轮汇总为准。

本次冻结的三项原生回归在GUI独占窗口内串行执行，均首次通过，合计27用例／239断言。控件交互14／76、基础属性4／51、属性来源与同步9／112；每套隔离工程编译、lint和实际游戏运行均成功，覆盖滑条范围、焦点、蓝图与玩家输入、单向限制、双向传播、动画驱动替换、持久参数及存读档恢复。三项没有现场修改产品或验收脚本，也没有重试；20张截图及全部报告、日志保留，见[原生汇总](<E:/Project/Visual Novel Studio/editor/artifacts/editor-refinements-2026-11-10/validation-main/control-runtime-validation.json>)。

三项原生回归的12个临时工程／游戏／存档目录已清理并逐项实查不存在，所属进程为0，GUI已交回主代理。真实工程前后SHA256均为 `774ad334a2e598375768bc647da77baf4b09e73137740f163578041817f913aa`。`TEMP`／`TMP`／`TMPDIR` 统一指向本轮 `unit-temp`，共用目录由主代理在全轮结束后清理；此处不代表整轮验收及清理已经完成。历史三处拒绝清理未检查、未重试。

2026-11-09 03:32：本轮实现、构建及功能验收已完成。5 项桌面专项共 56 组、7 项原生游戏专项共 54 用例／450 断言通过。全量单测 1929 项通过后，最后的 Spine 边界修复又通过 82 项相关补验；没有把补验称为重新执行全量单测。真实工程只读哈希未变，未提交、打包或更新安装版。

临时清理仍有三处被自动审批拒绝，已保留且未重试；其余 27 次专项／诊断的 71 个隔离目录已确认不存在。总结果见 [本轮报告](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/report.json>)，清理与构建核对见 [最终审计](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/final-audit.json>)。下文记录实际行为、维护约束和验证边界。

## 作者操作与三种方式

右键支持的属性名称或输入框，选择“关联参数…”打开“属性控制设置”；键盘可在属性名称或输入框上按 `Shift+F10` 或菜单键。菜单也提供“默认设置”和已有蓝图的定位入口。关联后，原输入框显示“跟随：参数名”或“同步：参数名”，点击可重新设置，悬停可查看预览值和保留的来源。普通打字、全选及复制粘贴快捷键保持原行为；素材搜索框恢复焦点时仍沿用既有搜索逻辑，不保留未选定的搜索词。

“已关联属性”集中显示当前关联、失效记录及其他属性入口。界面蓝图中的原“属性联动”入口使用相同数据和作者操作函数。新建参数与应用关联属于同一次草稿操作，可以一起撤销；仍需保存界面草稿后生效。

| 控制方式 | 属性读取 | 蓝图直接改写此属性 | 玩家主动改值 |
| --- | --- | --- | --- |
| 默认设置 | 原设计值、系统文字／条件／控件值等既有来源；临时覆盖按原规则生效 | 保留既有临时覆盖、动画及控件源写入语义 | 保留该控件原行为 |
| 单向跟随参数 `follow` | 指定参数的当前值 | 拒绝直接赋值及该属性动画；蓝图仍可修改来源参数 | 当前值关联时禁止玩家修改该值；滚动位置按关联轴限制 |
| 与参数双向同步 `sync` | 指定参数的当前值 | 有效改值写入参数，所有关联读取者随之更新 | 有效输入写入参数，再按原用户事件规则发事件 |

例如仅将“文字”设为单向跟随，字号、颜色、位置及点击事件仍各自工作。只有“当前数值／当前文字值／当前开关值”被设为单向跟随时，滑条、输入框或开关的主动改值受限；没有给整个控件增加一个统一的“禁止蓝图”开关。

布局、父级、按钮功能和集合部件等设置仍使用各自的编辑契约。可见字段不等于可在运行时关联的属性：入口以能力注册表为准，集合内部部件不会借用根控件的来源上下文。

相关实现：[UiPropertyControl.tsx](<E:/Project/Visual Novel Studio/editor/src/renderer/UiPropertyControl.tsx>)、[components.tsx](<E:/Project/Visual Novel Studio/editor/src/renderer/components.tsx>)、[UiInspector.tsx](<E:/Project/Visual Novel Studio/editor/src/renderer/UiInspector.tsx>)、[UiParameterBindings.tsx](<E:/Project/Visual Novel Studio/editor/src/renderer/UiParameterBindings.tsx>)。

## 数据契约与原值保留

`UiComponent.propertyControls` 为可选映射。未保存某项即使用默认方式，不另存 `mode: "default"`：

```json
{
  "text": "解除关联后保留的设计文字",
  "style": { "opacity": 0.8 },
  "propertyControls": {
    "text": { "mode": "follow", "parameterId": "caption" },
    "opacity": { "mode": "sync", "parameterId": "alpha" }
  }
}
```

关联不覆盖 `text`、`style`、`layout`、`controlRange` 等设计字段，也不删除 `binding`、`parameterId`、`assetParameterId`、显示／启用／选中条件。恢复默认方式只解除指定属性的关联；原来源重新起作用。读设计预览、切换选中对象、打开工程及编译都不应迁移这些数据。

显式属性来源优先于同项旧来源。例如输入框可以保留旧 `parameterId`，同时让 `stringValue` 同步另一个文字参数。旧 `parameterId` 仍定义这个控件的数值／文字／开关种类、选项及既有范围契约；显式关联改变当前值来源，不隐式替换整个控件定义。

`numberValue`、`stringValue`、`booleanValue`、`normalizedValue`、`optionIndex` 由 `uiPropertyControlKey` 归一到控件的实际当前值键。比例和索引是同一个值的不同读写视图，不能借别名绕过单向限制，也不能分别关联几个来源。新作者操作保存规范键；读取旧键不改数据。重复别名、错误类型的旧键及不再支持的属性保留诊断，修复操作显式清除同一属性族的旧记录。

核心实现：[model.ts](<E:/Project/Visual Novel Studio/editor/src/core/model.ts>) 的 `uiPropertyControlSchema`；[ui-property-control.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-property-control.ts>)。

| 核心入口 | 职责 |
| --- | --- |
| `uiPropertyControlKey`／`uiPropertyControlFor` | 解析规范键和已有记录；读取不迁移、不写参数 |
| `uiPropertyControlSourceProblem` | 检查属性能力、记录、来源类型与别名冲突；不依赖参数初值 |
| `uiPropertyControlProblem` | 在来源检查之上验证作者提供的初值及控件契约 |
| `uiPropertyControlCandidates` | 按属性和素材类型列出候选；初值有问题的候选保留说明机会 |
| `uiPropertyControlProblems` | 包含未知／损坏记录的诊断汇总 |
| `setUiPropertyControl` | 校验完整拟变更后写当前草稿，处理继承覆盖与旧托管图 |

来源菜单评估候选时，仅投影清除待修复属性族的旧关联，保留其他关联；否则重复别名会使所有候选不可用，或者丢失已关联范围／输入长度对新值的约束。`setUiPropertyControl` 是最终写入入口，UI 预检不能替代它。

## 参数真值、范围与素材

参数保存实际值，控件负责显示和输入约束。参数值为 `90`、控件范围为 `20～40` 时，可以显示 `40`，参数仍为 `90`。缩放控件、布局计算、刷新页面和读取归一化值都不会将显示值回写参数。滚动位置同样保留请求值，实际滚动边界只决定显示位置；主动滚动才走写入路径。

程序通过控件写入当前值时仍验证该控件的有效范围、选项和输入长度；直接修改参数保留参数赋值语义，并验证当前打开页面中受影响的显式关联。未打开页面及非活动方案不会无故否决该次参数修改，在实际使用其来源时检查有效性。来源已损坏或当前值不适用时，报告具体属性问题，不自动改回初值或悄悄改换来源。

数值范围关联按全部有效关联初值组成完整范围后检查。可先把上限关联为 `100`，再把下限关联为 `50`，无需误用原来的 `40` 作为上限。运行时“设置控件范围”先验证下限、上限、步长及涉及的全部参数，再一次写入；任一项单向受限、类型错误、范围无效或同一参数收到不同值时，整次拒绝。文字来源按有效 `maxLength` 和 Unicode 字符数检查；选项控件仍要求当前值属于其选项。

素材参数目前仅支持图片、音频、视频，并要求属性对应的素材种类一致。显式图片／视频来源的空字符串表示清空，不启用旧素材参数的备用素材行为。默认方式下的旧素材来源规则保留。

**参数集尚不提供字体和 Spine 素材类型。** 因此 `font`、`spineAsset` 不提供新素材参数关联；现有默认素材选择和蓝图能力保留。这不限制 Spine 的数值、开关或文字属性按各自能力关联，例如速度、循环和皮肤名称；皮肤仍须属于当前骨骼素材。颜色、对齐等文字参数也必须满足对应属性的格式或枚举要求。

契约依据：[ui-properties.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-properties.ts>)、[ui-control-properties.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-control-properties.ts>)、[ui-asset-binding.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-asset-binding.ts>)。

## 预览与游戏的读写路径

编辑器预演使用 [ui-logic-preview.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-logic-preview.ts>)，游戏使用 [ui-property-control-runtime.ts](<E:/Project/Visual Novel Studio/editor/src/runtime/ui-property-control-runtime.ts>)、[ui-control-runtime.ts](<E:/Project/Visual Novel Studio/editor/src/runtime/ui-control-runtime.ts>) 和 [parameter-runtime.ts](<E:/Project/Visual Novel Studio/editor/src/runtime/parameter-runtime.ts>)。

两端的实现遵循以下顺序：

1. 读属性时解析显式来源，读取参数当前值并验证；没有显式关联才进入原系统来源、临时覆盖或默认值路径。
2. 写属性时先检查能力与单向限制，完成比例／索引到实际值的换算，准备参数写入和未关联属性的局部写入。
3. 对整个拟变更验证后再提交。双向属性不同时保存一个相互竞争的局部覆盖值。
4. 根据受影响属性更新布局、媒体请求、指针／焦点等既有状态。程序写入不伪造用户操作事件。

新三模式使用属性读取及事件／动画写入边界处理关联：读取时取参数当前值，用户操作、蓝图赋值及动画采样产生改值时再提交。新关联不为每项属性生成托管定时蓝图，也不使用“读到显示值后再写回参数”的反馈循环。这一变化仅覆盖新配置及作者显式转换的旧托管联动；未转换的旧图、自定义图、共享图和继承图仍按原规则执行，不做全局自动迁移。

这里取消的是新属性关联对定时蓝图轮询的依赖；既有动画、任务和媒体所需的时钟与更新机制保留，不能据此假定整个运行时已经没有定时更新。

新增或修改运行时功能时，项目／玩家参数赋值须经过 `context.setParameter`／预览写入入口及游戏 `vn_parameter_set` 等集中路径。绕过这些路径直接改变量，会漏掉关联检查、动画归属及媒体更新。只读渲染函数不得调用提交函数。

## 动画、用户事件和重置

单向属性不能作为直接属性动画目标。蓝图静态检查产生可定位的警告，保留旧图；运行时仍检查真实目标，拒绝发生冲突的操作。整段界面动画含受限轨道时，在启动任何轨道前拒绝整段；同段多个轨道同步同一个参数时也拒绝，以避免同帧存在多个写入者。

双向属性动画在既有动画时钟采样阶段写参数，读取该参数的其他控件同步显示。一个参数同时只有一个有效动画驱动者；后启动的驱动替换旧驱动。显式参数／属性赋值，包括写入相同数值，会接管这个参数并停止旧动画。停止时保留实际停止值；选择完成时写入目标值。帧内相关修改先整体检查，再一起提交。

持久参数在动画中更新内存值，完成／停止后集中保存，避免每个动画采样都写持久存储。页面关闭、任务释放、读档和重开页面使用现有生命周期；关联配置及参数存储归属没有改成页面局部变量。

原生 `say`／`choice` 页面读档时，Ren’Py 会先恢复较早的场景列表，再重建当前原生页面。`after_rollback` 的这段重建间隔中，已显示过、拥有者仍存活且没有关闭／导航请求、父任务也仍存活的页面保留原会话 token，避免清理任务时误删其动画。页面重建后按页面、屏幕、图层及实际拥有者重新接回保存的会话，不创建第二个页面实例，也不再次触发 `OnShow`。实际关闭、拥有者消失或父任务结束仍按正常路径释放。

动画继续使用保存的 `elapsed`。读档或回滚恢复出不同记录时，首次采样的时间增量为零，再从保存进度继续；读取存档前后的现实等待时间不会被计入动画。页面恢复与任务释放由 [ui-native-page-runtime.ts](<E:/Project/Visual Novel Studio/editor/src/runtime/ui-native-page-runtime.ts>) 的 `vn_ui_native_page_alive`／`vn_ui_native_page_scope`／`vn_ui_native_page_shown` 和 [blueprint-task-runtime.ts](<E:/Project/Visual Novel Studio/editor/src/runtime/blueprint-task-runtime.ts>) 衔接；时间采样由 [ui-animation-runtime.ts](<E:/Project/Visual Novel Studio/editor/src/runtime/ui-animation-runtime.ts>) 的 `vn_ui_animation_tick` 负责。

玩家在滑条、选项或输入框主动改值时，只有操作来源控件触发既有改值／提交事件。蓝图赋值、参数传播、其他关联控件刷新及动画采样均不补发用户事件，避免传播形成事件回路。

重置操作需要区分：

| 操作 | 当前行为 |
| --- | --- |
| 作者选择“默认设置” | 解除这项作者关联，恢复保留的原设计／系统来源；属于可撤销草稿操作 |
| 蓝图重置单项属性 | 移除本项临时覆盖和本控件对应动画；显式参数关联保留，参数不恢复初值 |
| 蓝图重置控件 | 清本控件临时状态和自身动画；不改共享参数，不停止其他控件驱动该参数的动画 |
| 重置控件范围 | 清局部范围覆盖；仍关联的范围项继续读参数，不更改参数本身 |

Spine 播放有明确的局部例外：循环属性单向跟随时，“播放 Spine”仍播放选定动画，其循环输入不覆盖来源参数；设置播放速度等独立写入仍遵守速度属性的控制方式。

相关实现：[ui-animation-runtime.ts](<E:/Project/Visual Novel Studio/editor/src/runtime/ui-animation-runtime.ts>)、[ui-runtime.ts](<E:/Project/Visual Novel Studio/editor/src/runtime/ui-runtime.ts>)、[blueprint-ui-property-control.ts](<E:/Project/Visual Novel Studio/editor/src/core/blueprint-ui-property-control.ts>)、[blueprint-validation.ts](<E:/Project/Visual Novel Studio/editor/src/core/blueprint-validation.ts>)。

### Spine 速度的支持范围

骨骼播放速度统一支持 **0～32 倍，包含两端及 9 倍**，可直接填写范围内的数值。0 保留当前姿态，改速度不重播动画。超出 32、负数、`NaN`、无穷值及布尔值都作为无效速度拒绝，保留原值；不会把无效输入静默截成边界值。

范围和说明由 [ui-spine.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-spine.ts>) 的 `uiSpineMaximumSpeed`／`uiSpineSpeedProblem` 定义，写入 [ui-properties.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-properties.ts>) 的共用属性能力表。参数关联、属性赋值、蓝图节点及运行请求使用同一约束；导出的 `vn_ui_property_info` 将其传给 Python。原生适配器 [vns_spine.py](<E:/Project/Visual Novel Studio/editor/resources/spine/vns_spine.py>) 的 `_speed_problem` 在独立速度入口、保存记录检查，以及 `_Native.configure`／`_Native.advance` 调用原生库前再次检查。

编辑器的骨骼属性及蓝图速度输入共用 [SpineSpeedInput.tsx](<E:/Project/Visual Novel Studio/editor/src/renderer/SpineSpeedInput.tsx>)。它在提交前检查领域范围，不使用通用数字输入的 `min`／`max` 截值来伪装成功；被拒绝的修改显示说明，工程保留上次接受的值。

32 是当前明确的计算预算：适配器把每帧推进时间限制为最多 0.1 秒，再乘播放速度；原生 [vns_spine.c](<E:/Project/Visual Novel Studio/editor/native/spine/vns_spine.c>) 的 `vns_spine_update` 按最多 `1/30` 秒的子步推进。因此上限对应 3.2 秒模拟时间、约 96 次子步，计入浮点尾差按最多 97 次子步预算。速度很高会导致大量循环；达到极端值时，float32 的减步运算甚至可能不再使剩余时间变小，造成循环无法收敛。这解释了为何需要限制，但不意味着 33 倍必然卡死，也不保证所有素材在 32 倍下都能达到固定帧率。

旧工程中已保存的较大有限正值仍可读取，数据不会因新增上限而被自动修改。[validate.ts](<E:/Project/Visual Novel Studio/editor/src/core/validate.ts>) 会报告对应控件的速度问题；运行时的异常保存记录同样保留供明确修复，不把读档视为隐式修正速度的操作。

## 旧来源、蓝图与继承

旧 `parameterId`、`assetParameterId` 及自动联动图不会在加载、预览、编译或打开面板时被自动迁移。只有明确应用新控制方式或解除旧联动时，才调用现有联动管理接口。

`setUiPropertyControl` 仅移除当前页面／方案拥有、形状与签名符合自动生成规则、无外部引用的独立旧图。自定义、修改过、共享、继承或被其他内容调用的图原样保留，并提供打开原图的入口。默认方式仍可伴随旧逻辑；明确点击恢复默认也可以移除本项可独立管理的旧自动图。

旧图若写的是 `normalizedValue`／`optionIndex`，其参数单位可能是比例或索引。集中入口将其归到当前值属性展示，但不会自动把该旧参数当成实际当前值来源；作者需选择匹配实际值类型和单位的参数后应用。

基础方案、当前方案和自定义页面使用各自的精确归属。继承控件实际发生变更时才建立本地整控件覆盖，数量不足或来源无效时不创建覆盖。当前继承机制仍是整控件覆盖，没有新增逐字段继承规则。

参数引用扫描包含每项属性关联，并定位到实际拥有记录的方案／页面；同类型替换参数时更新关联ID，删除或改类型后保留可修复记录。项目诊断使用 `ui.property-control.source`；蓝图已知单向冲突使用 `ui-property-follow-write` 警告。动态控件目标由运行时判断；共享图在多方案控制方式不一致时不把当前编辑方案当成唯一结论。

维护入口：[ui-parameter-links.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-parameter-links.ts>)、[parameter-usages.ts](<E:/Project/Visual Novel Studio/editor/src/core/parameter-usages.ts>)、[validate.ts](<E:/Project/Visual Novel Studio/editor/src/core/validate.ts>)。

## 设计画布与几何保护

[ui-property-control-snapshot.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-property-control-snapshot.ts>) 的 `uiPropertyControlDesignSnapshot` 用参数初值生成私有绘制快照。它不运行页面蓝图，不写回默认值和参数；无须改值的控件允许直接返回原引用，调用者必须按只读数据使用。实际写样式、布局、素材之前使用 `cloneData`。`applyUiPropertySnapshot` 只用于这类私有快照，不能替代作者设计写入接口。

画布、命中、吸附、父子坐标换算使用显示快照；保存编辑仍定位到原控件。矩形操作先检查整组，再写未关联的字段：X和宽度关联时，合法的Y移动不会将显示X／宽度覆盖进原设计值。父宽度或其他布局参数参与子坐标换算；父参数本身保留。吸附若额外修改受控轴使操作无效，会尝试未吸附的原始合法位移并清除吸附线。

多选中任一改动违规，或本地覆盖容量不足时整组拒绝。置顶／置底依据显示中的同级层级计算；对象自身层级已关联时要求到来源处调整。

换父级会改变局部坐标的含义，当前采用保守保护：移动涉及的新旧根树中，只要位置、尺寸、显隐或布局属性有关联，就拒绝改父级并给出说明。保护覆盖兄弟尺寸、流式排列和滚动边界的间接影响；同父级的编辑器列表顺序仍可调整。当前没有实现保留动态来源表达式的自动坐标重写。

相关代码：[ui-arrange.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-arrange.ts>)、[ui-hierarchy.ts](<E:/Project/Visual Novel Studio/editor/src/core/ui-hierarchy.ts>)、[useUiComponentTransform.ts](<E:/Project/Visual Novel Studio/editor/src/renderer/useUiComponentTransform.ts>)、[useUiEditorCommands.tsx](<E:/Project/Visual Novel Studio/editor/src/renderer/useUiEditorCommands.tsx>)、[UiEditor.tsx](<E:/Project/Visual Novel Studio/editor/src/renderer/UiEditor.tsx>)。

## 后续维护与验证入口

增加可关联属性时应依次确认：能力注册表的实际读／写／预览支持，参数类型与值约束，TS预演和Python运行时的一致读写路径，是否影响布局／媒体／焦点，以及对应作者字段的 `uiProperty` 标识。仅给字段添加右键标记不能让一个尚无运行时实现的属性获得同步能力。

修改当前值别名、参数替换、动画驱动或原子操作时，应同时检查以下用例；不要用逐条写入替代完整操作的预检，也不要把来源元数据检查换成每帧初值检查。

| 用例文件 | 维护重点 |
| --- | --- |
| [ui-property-control.test.ts](<E:/Project/Visual Novel Studio/editor/tests/ui-property-control.test.ts>) | schema、三态原值保留、别名、素材／范围／长度、归属及原子性、旧图转换、删除诊断 |
| [ui-property-control-preview.test.ts](<E:/Project/Visual Novel Studio/editor/tests/ui-property-control-preview.test.ts>) | 双向传播、玩家事件、动画驱动、reset、滚动、当前值错误和未打开页面 |
| [ui-property-control-design.test.ts](<E:/Project/Visual Novel Studio/editor/tests/ui-property-control-design.test.ts>) | 私有快照、参数真值、单轴移动、多选保护、父几何、换父级边界 |
| [blueprint-ui-property-control.test.ts](<E:/Project/Visual Novel Studio/editor/tests/blueprint-ui-property-control.test.ts>) | 蓝图来源权限、动态目标、方案归属、保留图警告 |
| [verify-ui-property-control-editor.ts](<E:/Project/Visual Novel Studio/editor/scripts/verify-ui-property-control-editor.ts>) | 桌面右键入口、原子应用、撤销与持久保存等真实操作 |
| [verify-ui-property-control-runtime.ts](<E:/Project/Visual Novel Studio/editor/scripts/verify-ui-property-control-runtime.ts>) | Ren’Py实际运行中的传播、输入、动画、重置、保存／读取与页面生命周期 |

验收脚本共用 [ui-property-control-fixture.ts](<E:/Project/Visual Novel Studio/editor/scripts/lib/ui-property-control-fixture.ts>)，隔离工程、profile及存档，不使用真实作品作为写入目标。

## 统一验证记录

| 项目 | 实际结果／证据 |
| --- | --- |
| 类型检查与构建 | 最终 `build-04.log` 通过，含类型检查；JS `index-DisoKhsx.js`、CSS `index-CBcUYBse.css`。后续只修改验收脚本和文档，脚本最终类型检查见 `typecheck-final-02.log`；没有产品源码晚于构建。 |
| 全量单元测试 | `unit-03.log`：1929／1929 通过，0 失败；执行在最后 Spine 速度边界修复之前。 |
| 最终相关补验 | `unit-related-04.log`：82／82 通过，含最后新增的 4 条 Spine 边界用例，覆盖属性契约、预览、设计快照、蓝图及诊断。没有再跑全量。 |
| Electron桌面专项 | 5 项共 56 组通过，见下表。最终界面专项均使用源码编译产物。 |
| Ren’Py游戏专项 | 7 项共 54 用例／450 断言通过，56 张截图保留；每项编译、lint、实际游戏运行成功。汇总见 [原生验收](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/regression-final-report.json>)。 |
| 真实工程只读核对 | `我的视觉小说1/project.vns.json` 前后 SHA256 均为 `33aef64ba7ad196aa9f1b0e88a369996ea9efac1890a9cfc7c58c0c7f3853e0f`。 |
| 临时产物清理 | 27 次专项／诊断的 71 个隔离目录已清理并逐路径核对，测试所属进程 0；报告、截图和日志保留。下列三处自动审批拒绝项仍存在，清理整体尚未完成。 |

以上日志位于 `artifacts/ui-property-control-2026-11-09/`。桌面明细：

| 专项 | 结果 | 报告 |
| --- | --- | --- |
| 属性右键控制 | 11 组；三方式、创建关联、原值保留、参数快照、来源修复、旧图保护、独立预览与保存重开 | [属性控制](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/editor-2026-11-08T19-19-04.708Z-39d677ce/report.json>) |
| 通用属性面板 | 19 组，23 类控件，18 种布局 | [通用面板](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-generalization-2026-11-08/editor-2026-11-08T19-07-37.718Z-4ddceaaf/report.json>) |
| 通用／功能分层 | 19 组，48 种布局，含六种配色的开关像素、子对象保持父选择、内部部件保护 | [属性分层](<E:/Project/Visual Novel Studio/editor/artifacts/ui-inspector-hierarchy-2026-11-08/editor-2026-11-08T19-10-56.960Z-250a157c/report.json>) |
| 新建参数与关联 | 3 组；取消、撤销、重做、放弃草稿及保存重开 | [创建关联](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/parameter-create-2026-11-08T18-23-06.940Z/report.json>) |
| Spine速度与恢复 | 4 组；9／32、33／极端值拒绝、非法 Enter、蓝图两个入口、旧值修正后的同一 WebGL 画布恢复 | [速度专项](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/spine-speed-editor-2026-11-08T19-12-23.201Z-c987449d/report.json>) |

原生游戏明细：

| 专项 | 用例／断言 | 报告 |
| --- | --- | --- |
| 属性基础 | 4／51 | [基础属性](<E:/Project/Visual Novel Studio/editor/artifacts/ui-control-properties-runtime/2026-11-08T18-22-42.115Z/report.json>) |
| 控件交互 | 14／76 | [控件交互](<E:/Project/Visual Novel Studio/editor/artifacts/ui-control-interaction-runtime/2026-11-08T18-23-18.581Z/report.json>) |
| 布局 | 11／73 | [布局](<E:/Project/Visual Novel Studio/editor/artifacts/ui-layout-runtime/2026-11-08T18-25-05.591Z/report.json>) |
| 动画片段及读档 | 1／23 | [动画读档](<E:/Project/Visual Novel Studio/editor/artifacts/ui-animation-clips-runtime/2026-11-08T18-41-47.715Z/report.json>) |
| Spine | 14／66 | [Spine](<E:/Project/Visual Novel Studio/editor/artifacts/ui-spine-runtime/2026-11-08T19-20-00.772Z/report.json>) |
| 原生页面生命周期 | 1／49 | [页面生命周期](<E:/Project/Visual Novel Studio/editor/artifacts/native-page-lifecycle-runtime/2026-11-08T19-21-18.975Z/report.json>) |
| 属性控制、同步与持久存储 | 9／112 | [属性控制运行](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/runtime-2026-11-08T19-26-01.034Z-10297ceb/report.json>) |

### 验收发现与保留的边界

已修复右键菜单被延迟派发的旧滚动事件立即关闭、原生 `say` 页读档重建误删动画会话，以及极端 Spine 速度导致原生循环不收敛的问题。菜单按真实滚动位置变化关闭，没有增加等待或重试；Spine 输入与运行边界详见前文。

游戏持久参数专项使用实际磁盘读回并计数 `renpy.save_persistent`，确认动画采样不逐帧保存；完整结束、主动停止、重置自身动画、直接赋值分别触发预期保存。该专项曾把重置操作写进 `assert eval`，而 Ren’Py 的 `Assert.execute` 会求值两次，导致测试自己改变保存计数。现将所有相关操作移到独立语句，保留 112 条断言和原保存次数要求，产品代码未因此修改。

编辑器自动化曾有一次 `fill` 把旧文本前缀保留。一次有界事件诊断中，原 `fill` 和真实“点击→全选→输入”均首次成功，没有观察到值写回、失焦、DOM 替换或重新聚焦；原因仍未确定，不能列为已修产品缺陷。最终正式验收采用真实全选替换操作，额外检查焦点和完整选区，保留准确文本、改值次数与提交次数要求。原失败及 [输入事件诊断](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/input-diagnostic-2026-11-09-0319/report.json>) 均保留。另一次自动拖动属性栏没有达到目标宽度，后续串行验收保持同一宽度断言并通过；窗口焦点干扰仅为推测。桌面与原生验收随后串行运行，不能据此声称已经证明这两次偶发现象的原因。

没有新增字体／Spine 素材参数类型、逐字段继承或动态几何换父级转换，也没有测量整个大工程的性能；不要把本轮结果解释为所有历史问题都已消除。

### 清理例外

下列三个删除请求分别被自动审批以 `blocked by policy` 拒绝，未执行、未换工具、未重试：

| 本轮临时目录 | 记录 |
| --- | --- |
| `C:\Users\LiuXiangdong\AppData\Roaming\RenPy\vns_ui_property_control` | [首轮测试存档](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/fixture-save-cleanup-blocked.json>)；首次 compile 未隔离全局存档，后续 compile 已修正隔离。 |
| `E:\Project\Visual Novel Studio\editor\artifacts\ui-property-control-2026-11-09\unit-temp` | [单测缓存](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/unit-temp-cleanup-blocked.json>)；20 个顶层子项。 |
| `E:\Project\Visual Novel Studio\editor\artifacts\ui-property-control-2026-11-09\runtime-regression-saves` | [回归测试存档](<E:/Project/Visual Novel Studio/editor/artifacts/ui-property-control-2026-11-09/runtime-regression-saves-cleanup-blocked.json>)。 |

总体状态为“功能验收通过，三处清理被拒绝”。未提交、未打包、未发布，安装版未更新；需打开本轮源码构建查看新功能。
