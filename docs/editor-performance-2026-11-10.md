# 2026-11-10 模块编辑与资源保存性能

## 当前状态

本文件记录本轮性能实现与已经执行的取证。主代理已完成整批构建和第二轮全量单测（2061 项通过），随后开放独占窗口。四项冻结性能脚本、同首行无详细 trace 的补充基线，以及 build05 字体修复后的两项复测已执行，脚本原有断言均通过。对白预览重复字体声明引发的全局失效已消除；无详细 trace 的首次选行仍记录到 75ms 长任务，不能把脚本通过写成所有卡顿均已解决。

真实工程只读：`E:\Project\Visual Novel Studio\我的视觉小说1\project.vns.json`。本轮主代理记录的 SHA256 为 `774ad334a2e598375768bc647da77baf4b09e73137740f163578041817f913aa`。任何采样都在 `artifacts` 的新隔离副本中操作，不能覆盖真实工程或恢复历史哈希。

## 首轮实际结果与未完成项

首轮桌面性能使用 build04 的 `index-BDiq4zRr.js`；移除对白预览重复字体声明后的复测使用主代理已构建的 build05 `index-CELAXLxZ.js`。采样直接运行本地 Node v24.22.1 和 `node_modules/tsx/dist/cli.mjs`，没有在采样过程中启用开发服务器或重建。工程含 341 项素材、340 个独立内部文件，共 356,961,937 字节；目标段落 227 句，所在场景共 229 行。输出时间戳使用 UTC，因此目录日期为 11 月 9 日，北京时间为 11 月 10 日。

| 记录 | 本轮输出目录（相对 `artifacts/editor-refinements-2026-11-10`） | 结果 |
| --- | --- | --- |
| 滚动与首次操作，详细 trace | `module-scroll/2026-11-09T19-20-58.409Z` | exit 0，5 组功能检查通过 |
| 模块输入、数值、撤销和重开 | `module-editor/2026-11-09T19-22-08.024Z` | exit 0，4 组功能检查通过 |
| 模拟首次整理 ABBA | `resource-save-imported/2026-11-09T19-22-51.003Z-6fca0a7b` | exit 0，项目与素材字节一致 |
| 作者现有布局 ABBA | `resource-save-authored/2026-11-09T19-23-59.778Z-eed17672` | exit 0，无额外素材复制 |
| 同首行、无详细 trace，修复前 | `module-scroll-untraced-before/2026-11-09T19-29-33.317Z` | exit 0，5 组原功能检查通过 |
| 同首行、无详细 trace，修复后 | `module-scroll-untraced-after/2026-11-09T19-35-47.434Z` | exit 0，5 组原功能检查通过 |
| 同首行、详细 trace，修复后诊断 | `module-scroll-traced-after/2026-11-09T19-36-46.455Z` | exit 0，5 组原功能检查通过 |

无详细 trace 的同首行结果：焦点事件到下一帧 **79.2ms**，长任务 **84ms**，原生 `scrollIntoView` **24.2ms**；首次展开为 **38.3ms**，没有长任务。连续滚动、展开六行和文字动画滚动阶段均未记录超过 50ms 的长任务。模块编辑脚本以末行为首次目标，首次焦点到下一帧 92.2ms；连续输入 P95 34.7ms、调数值 P95 58.6ms，但数值阶段仍有四个 52～57ms 长任务。这些是独立样本，不能把首行和末行直接当成前后对照。

详细 trace 中首次选行显示 469ms 长任务、402.4ms 强制样式／布局，其中字体更新失效 360.1ms。该 trace 同时为 **4520 个“Fonts changed”节点记录深层堆栈，事件 JSON 共约 33.37MB**，诊断采集会放大工作量；469ms 不是本轮普通运行延迟。归因证据仍有效：从仅演出的 silent 行选中第一句时，文字面板保持收起，右侧 `DialoguePreview` 首次挂载；其局部 `UiFontFaces` 与 App 常驻字体声明重复，随后原生自动定位消费挂起的字体样式失效。未发生字体解码。紧凑调用链与边界见详细 trace 目录下的 `first-selection-analysis.json`。

主代理的最小修复仅移除 `DialoguePreview` 两个位置分支内的重复 `UiFontFaces`；App 常驻声明、台词字体预热和自动定位保持原行为。两次无详细 trace 采样的前后目标完全一致：从仅演出的 `txt_node_199q16x` 切到 `txt_node_1g9ees` 的首句 `txt_line_ixhau5`，文字面板保持收起，滚动位置从 0 到约 801.714。结果如下：

| 无详细 trace，同首行同协议 | build04 修复前 | build05 修复后 |
| --- | --- | --- |
| 焦点事件到下一帧 | 79.2ms | 71.5ms |
| 首次选行长任务 | 84ms | 75ms |
| 原生自动定位 | 24.2ms | 18.6ms |
| 随后首次展开到下一帧 | 38.3ms | 35.4ms |

每个条件只有一次观测，CPU profiler 和输入观察器仍然开启；这些数字描述本次样本，不构成稳定的总体提速比例。两次所有滚轮阶段均无超过 50ms 的长任务，首次展开也均无长任务。

修复后详细 trace 仍记录一次对白预览插入，但 `StyleEngine::InvalidateStyleAndLayoutForFontUpdates` 从 1 次降到 0 次，`LayoutInvalidationTracking` 的 `Fonts changed` 从 4520 条降到 0 条，新增 ruleSets 失效也从 1 次降到 0 次；前后均没有字体解码。证据见修复后 trace 目录中的 `first-selection-analysis.json`。这确认已消除重复声明造成的失效链；剩余 React 更新、预览首次挂载与布局仍有成本，因此不声称首次选行已经没有卡顿。

保存 ABBA 的每个版本各两个独立副本，结果如下（按版本内实际执行顺序，单位秒）：

| 场景／阶段 | 旧实现 | 新实现 |
| --- | --- | --- |
| 模拟首次整理，总保存 | 6.913 / 7.291 | 5.593 / 7.309 |
| 其中复制与目标哈希 | 2.432 / 2.254 | 1.553 / 1.969 |
| 已整理布局，首次保存 | 0.688 / 0.814 | 0.792 / 0.678 |

模拟整理的复制与目标哈希均值减少约 24.9%，总保存均值减少约 9.2%；总耗时样本区间重叠，源校验及清理耗时波动明显，不能据两次观测承诺稳定整体提速。现有布局已整理，八次保存均未复制素材，不能据其小幅均值变化宣称并行复制带来收益。所有后续保存均零素材复制；新旧最终工程 hash 及每个资产的当前、历史引用字节一致。

两种保存采样均已审计源工程、ledger 和 340 个内部素材，全部未变；五次桌面运行结束时均检查源工程 hash 保持一致。七个运行的 `cleanup.json` 均无错误，随后逐个核对已删除的 20 个运行／配置／bundle 目录均无残留。原始日志、报告、截图和 CPU profile 保留。首轮资源单测曾因测试 ID 使用连字符而在 gate 中等待超时，已改合法 ID 并让检查点报告保存提前失败；定向 14 项及随后主代理全量单测通过，未放宽 10 秒门槛。

## 资源整理

`src/desktop/resource-layout.ts` 的预检仍按原顺序进行，完整检查后才写素材，因而冲突文件名和重定位顺序保持确定。复制与复制后的目标 SHA256 校验改为最多四项并行；不同资产使用相同规范化目标时，只执行一次物理复制，仍保留每个资产的路径及历史别名。

内部 junction／符号链接可能让两个不同目标名落在同一物理文件。现有真实路径检查发现项目根以下存在别名时，该次整理保守退回串行，避免第二项遇到 `EEXIST` 后读取首项仍未写完的文件。项目根本身经别名访问不必退回串行。

任一复制或校验失败后停止分配新任务，等待已启动任务全部结束再返回错误；失败时不进入 ledger 写入和项目保存。全部复制成功后依次写路径记录、耐久写入工程、执行 `finish()`。保留复制后的目标新哈希，以及保存结束时源文件的新哈希，外部修改过的源素材不能被删除。`finish()` 的源哈希索引改为 Map，移除逐源扫描计划列表的二次复杂度。

没有改另存为的两阶段复制、主进程写入队列、原子文件写入、自动保存或源文件清理规则。先前记录的约 29.8 秒是历史隔离样本，不能作为本轮基线或收益数字。

`tests/resource-layout.test.ts` 增加四类回归：

- 规范化目标相同只复制一次，保留两个资产各自的历史别名；Windows 同时覆盖扩展名大小写。
- 一项失败、三项在途时保存保持未完成，第五、第六项不启动；原项目、备份、ledger、迁移记录与源文件均保留。
- 强制目标逆序完成仍采用相同冲突文件名，已有目标不覆盖。
- 内部目录别名下显式模拟半写入文件，后续别名目标等待首项完成。

故障模拟使用可控 gate；正常结束、断言失败和测试超时的清理都先放行并等待该测试的 IO，不使用睡眠碰运气。无法创建目录链接的环境会明确跳过链接专项。

## 模块编辑

`src/renderer/LineEffects.tsx` 在所有 hooks 之后提前返回独立文字面板，避免先构造最终丢弃的舞台动作、配音和对话框节点。每个舞台动作的名称与细节只解析一次，供文字和无障碍标签共用。文字控件、DOM 结构、自动定位、收起／展开行为及播放计时不在此补丁内改变。

没有取消 `ScriptEditor` 的自动定位。旧记录中的首次点击约 124.6ms、强制布局约 62.2ms 只保留 React 总调用；同一提交还创建文字预览、观察器并使样式失效，缺少足够证据归因于 `scrollIntoView`。原首行可能已经选中，此时滚动 effect 甚至不会重新执行。普通点击与复制共用选择函数，鼠标与键盘共用焦点回调，直接跳过会损坏新增行或外部导航的定位。

两个既有脚本已补上遗漏的阶段：

- `profile-module-editor.ts` 在第一次点击前启用采样，分别记录真正切换选中行和随后展开同一行。
- `profile-module-scroll.ts` 将首次选行与首次展开纳入各自的 `measure()` 和 CPU profile，不再只有滚轮阶段。
- 报告记录前后选中节点／台词、目标是否已选中、展开状态、`scrollTop`、输入到下一帧，以及原生 `scrollIntoView` 的调用次数、单次目标和耗时。包装器原样执行原生方法，结束、异常或重载前恢复。
- 原输入、滚轮、离屏预览、舞台菜单、选字、撤销、保存及文本往返检查保留；新增 `--artifact-root`，输出仍使用唯一时间戳子目录。

如果最终采样仍出现卡顿，应先区分选行、展开与连续滚动，并结合调用记录及 trace 的 layout／style invalidation 定位。仅凭连续滚动没有长任务，不能宣称所有操作都流畅。

## 复现命令与采样范围

应由主代理协调构建和测试后再运行，避免与性能窗口并发。保存相关回归至少包括：

```powershell
corepack pnpm exec tsx --test tests/resource-layout.test.ts tests/store.test.ts tests/project-recovery.test.ts tests/resource-import.test.ts
```

桌面采样应串行运行，避免与游戏性能样本相互污染：

```powershell
corepack pnpm exec tsx scripts/profile-module-scroll.ts --source 'E:\Project\Visual Novel Studio\我的视觉小说1\project.vns.json' --artifact-root artifacts/editor-refinements-2026-11-10/module-scroll --trace-first
corepack pnpm exec tsx scripts/profile-module-editor.ts --source 'E:\Project\Visual Novel Studio\我的视觉小说1\project.vns.json' --artifact-root artifacts/editor-refinements-2026-11-10/module-editor
```

`scripts/profile-resource-save.ts` 在隔离 bundle 中替换保存的旧 `resource-layout.ts`，其余源码、工程数据与素材相同，不回滚工作树。默认按旧／新／新／旧顺序，逐次创建新副本，分别记录首次与后续保存：总耗时、预检、复制加目标哈希、ledger、耐久写工程及源验证／清理。保留每次物理复制耗时、字节数、峰值并发、素材清单与 SHA256，并检查新旧结果相同、后续保存不再复制素材。峰值并发只统计重叠的 `fs.copyFile` 调用，不是包含目标哈希的完整 worker 数；每个版本两次观测也不构成延迟分位数。

```powershell
corepack pnpm exec tsx scripts/profile-resource-save.ts --source 'E:\Project\Visual Novel Studio\我的视觉小说1\project.vns.json' --layout imported
corepack pnpm exec tsx scripts/profile-resource-save.ts --source 'E:\Project\Visual Novel Studio\我的视觉小说1\project.vns.json' --layout authored
```

`imported` 只在副本中把完全内部素材放到待整理路径，并打开目录同步，适合取证首次整理。普通素材保留共享源，Spine 每组使用独立前缀并保留组内原相对结构。产品会跳过混有外置成员的资产组，因此这些组的内部成员仍按原路径与 ledger 复制。内部文件系统别名会展开为普通文件，并在报告中列出。此模式不能称为作者当前磁盘状态。

`authored` 保留工程已引用文件的当前路径、目录同步设置及历史别名；遇到内部文件系统别名会明确拒绝，避免展开后改变整理语义。两种模式都只测同目录保存，不测另存为，也不复制未引用的占位或冲突文件，因此都不是完整磁盘镜像。外置成员逐项列出，不复制、不参与字节审计；已缺失的内部引用单独记录，资产完整性检查只覆盖实际存在的内部文件。阅读结果时须一并查看这些范围。

副本准备、独立 SHA256 验证和 bundle 编译不计入保存耗时；准备会暖机操作系统缓存，因此“首次保存”不等于“磁盘冷启动”。无论采样成功或失败，结束时都会审计已捕获的源工程、ledger 和内部素材；源完整性或清理失败会使最终状态失败，保留原始异常。采样脚本不是最终提速结论，必须阅读阶段数据与完整报告，不能只比较一个总数。

修改前源码保存在 `artifacts/editor-refinements-2026-11-10/baseline-source/`；本子任务的独立清单为 `performance-paths-baseline.json`、`line-effects-baseline.json`、`module-profiling-baseline.json` 及 `baseline-source/save-pipeline-review-tests.sha256.json`。统一采样产生的临时副本及 bundle 按脚本清理，报告、截图、trace 和 CPU profile 保留；最终来源与检查状态汇总在本轮根目录的 `editor-performance-validation.json`。
