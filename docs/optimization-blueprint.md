# 叙事工坊 2.0 优化蓝图（面向零基础创作者的 UE 式架构）

编写时间：2026-09-12。本文基于对 `visual-novel-studio` 源码的实地审查（文件路径与行号可直接核对），给出问题清单、目标架构与分阶段路线图。**当前未修改任何源码**，只产出方案。

## 一、结论先行

这个项目不是"简单可视化壳"，它已经具备相当完整的引擎骨架：

| 维度 | 现状 |
| --- | --- |
| 技术栈 | Electron 40 + React 19 + Vite 7 + TypeScript strict（`package.json:27-51`） |
| 代码规模 | `src` 约 15,700 行；其中 `Inspector.tsx` 1935 行、`styles.css` 2702 行、`App.tsx` 1132 行 |
| 数据模型 | 单文件 `src/core/model.ts` 536 行，zod 全量校验，含剧情节点、蓝图、UI、实例继承 |
| 编译链路 | `model → compiler.ts(671行) → Ren'Py → distribute`（`src/runtime/service.ts:49-97`） |
| 测试 | 10 个测试文件、102 个用例，`blueprint`/`compiler` 覆盖较厚 |
| 文档 | 11 份中文文档，`acceptance-report.md` 记录了 89 项单测与多轮真实 EXE 验收 |

**核心判断：当前瓶颈不在功能数量，而在三件事**

1. **没有"权威数据层"**——所有编辑器都通过"整体克隆项目 → 改 → 回写"的方式编辑（`editor.ts:58-72`），这会随项目规模放大成性能与一致性双重问题。
2. **没有扩展点**——全仓库无插件机制（`grep plugin|registry|manifest` 在 `src` 中零命中），新增一种节点/控件必须同时改 model、compiler、Inspector、渲染器四处。
3. **对新手"概念过载"**——开局面对 5 个并列视图（剧本/文本/蓝图/舞台/界面）+ 36 种蓝图节点 + 181 个 UI 组件，没有引导式路径。

## 二、值得保留的资产（不要在重构中丢掉）

- `project-store.ts` 的**原子写 + 三级恢复**（主文件 / `.autosave` / `.previous`，`project-store.ts:57-105`）质量很高，是同类工具里少见的。
- `containedPath()` 的路径越界防护（`:10-18`）与 `studio-asset://` 自定义协议（`main.ts:298-308`）构成了合理的 Electron 安全边界。
- `effectiveScene` / `effectiveCharacter` / `effectiveUiComponents` 三套**非破坏性继承解析**（`model.ts:114-126, 336-347, 361-378`），这正是 UE 蓝图/预制体的思路，方向正确。
- `build-manifest.json` + `preserveCompiledGame()` 的编译基线保留（`service.ts:88, 99-113`），为存档兼容打好了基础。
- 诊断能反查到文本行号与节点（`App.tsx:576-608`），工程化程度超过一般独立项目。

## 三、问题清单（按优先级）

### P0 — 阻碍长期演进

| # | 问题 | 证据 | 后果 |
| --- | --- | --- | --- |
| 1 | 编辑基于全量深拷贝 + `JSON.stringify` 比对 | `editor.ts:59-61` 每次提交克隆整个 Project 并序列化两次 | 1000 段落规模下每次击键都可能触发全量克隆；撤销栈 100 步 = 100 份完整快照 |
| 2 | 无插件/注册表机制 | `src` 中无 register/manifest/plugin 相关代码 | 加一个节点类型要改 4 个以上文件，社区无法扩展 |
| 3 | 类型零散定义 | `nodeSchema`(11 种)、`blueprintNodeSchema.type`(43 种枚举，`model.ts:169`)、`actionSchema`(13 种)、`uiComponentSchema.kind`(23 种) 各写各的 | 新增类型时容易出现"模型加了、编译器忘了、界面没入口" |
| 4 | `schemaVersion` 只有 1，迁移是硬编码 `if version===0` | `project-store.ts:41-42` | 第二次结构变更就要写分支判断，随版本线性劣化 |

### P1 — 明显影响新手与可维护性

| # | 问题 | 证据 |
| --- | --- | --- |
| 5 | 巨型组件 | `Inspector.tsx` 1935 行、`App.tsx` 1132 行、`TextEditor.tsx` 21 个 `useState` |
| 6 | 单文件数据模型 | `model.ts` 536 行混合了 schema、ID 生成、继承解析、图操作 |
| 7 | 用系统 `confirm()` | `App.tsx:253,541,952`、`Inspector.tsx:885,938` 等 6 处 | 中文界面里弹出英文风格的浏览器对话框，与产品调性冲突 |
| 8 | 无快捷键体系/命令面板 | 只有 `Ctrl+S/Z/Y`（`App.tsx:386-407`）；UE 的核心体验之一是命令面板 |
| 9 | 无"新建引导" | 新建对话框只有名称 + 2 个模板（`App.tsx:943-1002`）|
| 10 | 编译错误靠日志解析 | `diagnosticsFromLog` 从 stdout 正则提取（`service.ts:9`）|

### P2 — 需要时再处理

- 预置 `artifacts/` 目录 2000+ PNG、1085 个 pyc 混在源码树中，`vite.config.ts:4` 只能靠 ignore 绕开。
- `pnpm test` 只跑 Node 端单测，编辑器 UI 无组件测试（Playwright 仅用于 `scripts/verify-*` 端到端）。
- 无 i18n 键值层，中文全硬编码，README 已承认"语言切换仍未实现"。

## 四、目标架构

### 4.1 引入"文档内核"（Document Kernel）

把一次性大对象改成**事务化文档**，这是所有后续优化的地基。

```
Editor UI ──dispatch(Command)──▶ CommandBus ──▶ DocumentStore(规范状态)
                                     │                    │
                                     │              ┌─────┴─────┐
                                     │              │ 选择集/历史 │
                                     ▼              └───────────┘
                              PluginRegistry（每个插件注册命令与校验器）
                                     │
                              Patch 增量 → 序列化 / 编译
```

要点：

1. **命令模式**：`{ type: 'node.add', payload, inverse }`，天然得到撤销/重做、录制、宏。
2. **补丁式历史**：只记录变更路径（可引入 Immer 或自研 patch），撤销栈从"100 份快照"变为"100 组差量"。
3. **选择集独立于数据**：`SelectionStore { view, sceneId, nodeId, lineId }`，让视图可以纯函数化。
4. **文档级 schema 校验只在提交边界执行**（用 zod 的 `safeParse` 只对受影响的子树），不必每次全量。

### 4.2 插件化节点系统

现状是 4 处硬编码，目标是一份声明驱动四处：

```ts
// 一个节点类型 = 一份清单
export const ShowCharacterNode: NodeDefinition = {
  type: 'showCharacter',
  category: '演出',
  label: '显示角色',
  icon: 'user',
  fields: [
    { key: 'characterId', kind: 'character', label: '角色', required: true },
    { key: 'x', kind: 'percent', label: '横向位置', default: 0.5 },
  ],
  inputs:  [{ id: 'exec', type: 'exec' }],
  outputs: [{ id: 'exec', type: 'exec' }],
  compile(ctx, node) { /* 生成 Ren'Py 片段 */ },
};
registry.register(ShowCharacterNode);
```

收益：**Inspector 表单、蓝图参数面板、编译器分支、诊断文案全部由清单生成**。第三方插件只需提供同样的对象。

### 4.3 新手分层（UE 的"Starter / Editor / Expert"）

不要在同一个界面上把全部能力铺开，按三个层级组织：

| 层级 | 面向 | 界面 | 数据落点 |
| --- | --- | --- | --- |
| L1 剧本模式 | 零基础 | 只有"上一句 / 下一句 / 选择 / 结局"的**对话流**，像聊天记录 | 生成 `passage` + `choice` |
| L2 场景模式 | 会用软件 | 左侧**大纲树**（章→节→段落）+ 中间舞台预览 + 右侧简化属性 | 同上 + 少量 `show`/`background` |
| L3 蓝图模式 | 想控流程 | 现有蓝图编辑器 | 全量能力 |

关键原则：**默认只进 L1，L2/L3 是显式升级而非并列标签页**。UE 的"关卡设计器→蓝图→C++"就是这个渐进曲线。

### 4.4 向导式工程创建

把 `newDialog` 扩展成 UE 式的"选择起始内容"：

1. **作品形态**：纯对话 / 带分支 / 带互动小游戏
2. **画面规格**：1280×720 / 1920×1080（含移动端竖屏预设）
3. **视觉风格**：仅选 1 个配色 + 字体，不暴露 181 个组件
4. **创作路径**：直接写对白 / 导入 Word / 从示例改写

创建后不应落在空画布，而应生成**可运行的最小作品 + 一条当前应该做的下一步提示**。

### 4.5 面向新手的护栏（Guardrails）

- **空状态即教程**：每个空白面板给出"点这里添加第一句对白"，而不是空列表。
- **术语表内置**：模型里已有中文 `nodeNames`/`actionNames`（`editor.ts:18-46`），把它做成悬停解释 + 首次出现时的气泡，而不是靠记。
- **错误可修复**：诊断项除"定位"外增加"一键修复"（如"素材缺失 → 重新选择文件"、"节点未接线 → 连接到结局"）。
- **保存心理负担**：已有 autosave，但界面没有明确表达。建议改为"每 2 秒自动保存 · 上次 14:23"，替代现在的状态栏文本（`App.tsx:203-210`）。
- **统一对话框**：替换 6 处 `confirm()` 为项目内中文 Modal。

### 4.6 分级编译错误

现有链路是"生成 → 跑 Ren'Py → 解析日志"。目标改为**三层防线**：

1. **提交时**：schema + 引用完整性（已有 `validate.ts` 308 行，可扩充）
2. **编译前**：静态检查器，给出"哪个节点、哪一行、为什么、怎么改"
3. **运行时**：`diagnosticsFromLog` 作为兜底（保留，但不再是主路径）

## 五、分阶段路线图

### 阶段 0：地基（不动界面，2 周量级）

- [ ] 抽出 `DocumentStore` + `CommandBus`，`useProjectHistory` 改为薄封装（保持现有 API 不变，先并行运行）
- [ ] 补 `tests/history.test.ts`：验证增量撤销/重做与现有行为等价
- [ ] 把 `model.ts` 拆为 `schema/`、`resolve.ts`（继承解析）、`graph.ts`（节点连接）
- [ ] 引入 `schemaVersion: 2` + 迁移函数注册表（`migrations: Record<number, fn>`）

**验收**：现有 102 个测试全绿；1000 段落工程下任意编辑操作 < 16 ms。

### 阶段 1：插件化（1 个月量级）

- [ ] 定义 `NodeDefinition` / `ComponentDefinition` 接口与 `PluginRegistry`
- [ ] 把 43 种蓝图节点逐类迁到清单（先迁 5 种验证抽象）
- [ ] Inspector 表单改为 schema 驱动渲染
- [ ] 提供插件加载点（本地目录 + 未来市场）

**验收**：新增一个自定义蓝图节点，**只写一个文件、不改现有代码**即可在界面出现、可编译、可被诊断。

### 阶段 2：新手体验（与阶段 1 并行）

- [ ] 向导式新建（4 步）
- [ ] L1 剧本模式（对话流界面）
- [ ] 空状态引导 + 术语气泡 + 一键修复
- [ ] 替换全部 `confirm()`；引入命令面板（`Ctrl+K`）
- [ ] 快捷键体系（UE 式可配置）

**验收**：找 3 位无编程经验的人，在无口头指导下完成"新建作品 → 写 5 句对白 → 加 1 个分支 → 试玩 → 导出"，记录卡点。

### 阶段 3：工程化收尾

- [ ] UI 组件测试（Playwright component / Testing Library）
- [ ] i18n 键值层
- [ ] `artifacts/` 移出源码树或加入 `.gitignore`
- [ ] 编译错误分级（静态检查器）

## 六、建议的验收指标

| 指标 | 现状 | 目标 |
| --- | --- | --- |
| 新增一种节点/控件需改动的文件数 | 4+ | 1 |
| 1000 段落单次编辑耗时 | 未单独测量 | < 16 ms（一帧） |
| 撤销一步的内存开销 | 完整快照 | 差量，< 1% 工程体积 |
| 零基础完成首个可试玩作品 | 需读文档 | 引导下 < 10 分钟 |
| 编译失败时的可定位率 | 依赖日志正则 | 检查器覆盖 ≥ 90% 的常见错误 |

## 七、风险与取舍

- **不要为了"像 UE"而牺牲易用**：UE 本身对新手并不友好。这里学的是它的**架构分层**（资产/蓝图/插件/命令），不是它的界面复杂度。
- **渐进重构，避免大爆炸**：`DocumentStore` 应与 `useProjectHistory` 并行运行一段时间，行为对齐后再切主路径。
- **Windows 路径长度限制**是 Ren'Py 侧的硬约束（`main.ts:284-289` 已有专门提示），短期建议在保存/导出时**主动校验总路径长度并提前告警**，而不是等打包失败。
- **测试是这套重构的安全绳**：现有 102 个用例覆盖面尚可，但缺少历史/存储的性能回归，阶段 0 必须补上。

## 八、立即可做的 5 件事（不依赖架构改造）

这五项改动局限在 2~3 个文件内，可以独立提交、独立回滚，适合作为验证手感的第一步。

1. 用项目内中文 Modal 替换 6 处 `confirm()`。
2. 新建对话框增加"我想做什么"的三选一并据此预置内容。
3. 空白面板补空状态引导文案。
4. 保存/导出前校验路径长度，超限提前提示（复用 `main.ts:285` 的检测逻辑）。
5. 状态栏把自动保存时间显式化。

### 8.1 第 1 项的完整改造配方

这一项收益最直接：`App.tsx:253/541/953` 与 `Inspector.tsx:887/940/1096/1224/1304` 共 8 处调用原生 `confirm()`，弹出的对话框由操作系统渲染，按钮文字跟随系统语言（中文 Windows 上是"确定/取消"，英文环境是"OK/Cancel"），且完全脱离产品视觉。对零基础用户来说，这是最突兀的一类打断。

**做法：一个 Context + 一个 Provider，不改动任何组件结构。**

新建 `src/renderer/ConfirmDialog.tsx`，导出 `ConfirmProvider` 与 `useConfirm`：

```tsx
export interface ConfirmRequest {
  title: string;
  message?: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 用红色确认按钮表达破坏性操作（删除、丢弃）。 */
  danger?: boolean;
}

export interface ConfirmHandle {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  prompt: (request: ConfirmRequest & { initialValue?: string }) => Promise<string | null>;
}
```

Provider 内部维护一个 `pending` 状态，渲染时复用现有的 `.modal-backdrop` / `.dialog` / `.dialog-actions` 样式（`styles.css:2250-2292`），因此**不需要新增任何 CSS**。要点：

- 用 `createContext` + `useMemo` 暴露一个稳定引用，避免调用方因引用变化重渲染。
- `onMouseDown` 判断 `event.target === event.currentTarget` 实现点遮罩关闭。
- 监听 `Escape` 关闭，`prompt` 模式下聚焦并全选输入框（`setTimeout(..., 30)` 等待挂载）。
- 删除类操作传 `danger: true`，在按钮上方渲染一行"此操作无法撤销"的警示。

**接入方式（两行改动）：**

```tsx
// main.tsx
<ConfirmProvider>
  <App />
</ConfirmProvider>

// App.tsx
const dialog = useConfirm();
```

**调用点改写示例：**

```tsx
// 改造前（App.tsx:541）
if (scene && confirm(`删除场景“${scene.name}”及其中所有剧情？`))

// 改造后：顺带把"会影响多少内容"量化出来，这才是新手真正需要的信息
const count = project.nodes.filter((n) => n.sceneId === id).length;
const approved = await dialog.confirm({
  title: `删除场景“${scene.name}”？`,
  message: count ? `该场景中的 ${count} 个剧情节点会一并删除。` : "该场景中没有剧情节点。",
  confirmLabel: "删除场景",
  danger: true,
});
```

**需要注意的三个坑：**

1. **异步化会改变调用点签名。** 原先 `confirm()` 是同步返回，改成 `await` 后，包含它的函数要么变成 `async`，要么把后续逻辑包进 `.then()`。`App.tsx:953` 处位于 `onSubmit` 回调内且被 `if (...) return;` 提前拦截，需整体改为 `void (async () => { ... })()` 包装，否则 `onSubmit` 的同步返回语义会被破坏。
2. **`Inspector.tsx` 的 `leave()` 是同步校验函数**（`:887`），被多个入口共用。这里建议保留同步外观，内部把待执行的 `next()` 挂起到 Promise 解决后再调用，即 `leave(next)` 改为「先问、问了之后再执行」。
3. **别一次性全改。** 建议先改 `App.tsx` 的 3 处（互不耦合、易验证），跑一次 `pnpm typecheck` 与 `pnpm test`，确认无回归后再处理 `Inspector.tsx` 的 5 处。

**验收方式：** 触发删除场景与未保存切换两个流程，确认弹窗为中文、样式与产品一致、`Esc` 可取消、焦点初始落在输入框（`prompt` 模式）；`pnpm typecheck` 与 `pnpm test` 全绿。

