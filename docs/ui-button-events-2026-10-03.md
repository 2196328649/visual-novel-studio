# 按钮交互事件 · 2026-10-03

继续以 UE5 Widget Blueprint 的控件事件工作方式推进。界面设计用于摆放控件，事件图用于连接行为。本轮为按钮补上悬停、移出、按下、松开事件，与已有 OnClicked、页面显示、快捷键、定时事件共用页面事件图、UI 草稿和保存入口。

## 操作方式

1. 打开“界面 → 事件图”，选择当前页面及左侧按钮。
2. 点击“悬停时 · OnHovered”“移出时 · OnUnhovered”“按下时 · OnPressed”或“松开时 · OnReleased”。重复添加会定位已有入口。
3. 选择要控制的控件，添加“设置属性”或动画节点，并连接白色执行线。例如悬停时改变提示文字，移出时清空提示，按下时播放动画。
4. 展开“交互预演”，实际移动鼠标、按住、松开，或使用 Enter / Space。确认效果后“保存界面”。离开时仍可保存、放弃或取消离开。

## 数据及输入行为

- 新 `eventButton` 节点包含 `componentId`、`trigger`（`hover/unhover/press/release`）、`uiInstanceId`，执行输出为 `exec`。控件及触发类型参与校验；节点按页面和当前界面方案过滤。原点击事件的数据格式保持兼容。
- 正常点击的顺序为 press → release → click。按住后移出仍触发 unhover，外部松开只触发 release；重新进入后在按钮内松开可以点击。
- 隐藏、禁用、关闭页面或被模态页面覆盖会取消按压。取消后不补发 release/click；同一事件中先禁用再启用也不会恢复原按压。
- Enter / Space 走同样的 press → release → click 顺序，中途取消后停止后续事件。悬停仅来自鼠标进入/移出，内部焦点重建不触发悬停。
- 原生释放鼠标抓取时同时取消发起回调的按钮和当前替换显示对象。预演在属性修改、页面变化及时间推进时清理失效按压。
- AI 上下文说明已同步真实节点字段和取消语义。未调用外部模型，本轮不据此宣称 AI 实际生成全覆盖。

## 原生验收发现的修复

最初将 hover/unhover 绑定到原生 focus/unfocus，会因事件回调的新上下文反复重建焦点，产生 H/U 循环。现使用真实鼠标移动和边界变化判断，不再把内部焦点变化解释成用户输入。

OnPressed 打开非等待页面时还发现两个现存页面问题：主菜单屏蔽普通 overlay，因此页面状态为 shown 但没有画面；自定义页面的预设“返回”仅执行 Return，不能关闭非等待页面。现在空的页面宿主通过 always_shown_screens 保持可用，未打开页面时没有交互内容；返回动作优先按页面 ID 关闭已打开页面，等待页通过既有结果计时器返回，小游戏的原 Return 路径仍保留。

失败证据：`artifacts/ui-button-events-runtime/2026-10-02T17-50-13.173Z/runtime.log` 记录 `{'button_overlay': 'shown'} None True`；同目录 `game/tests/screenshots/modal.png` 仍显示底层。`2026-10-02T17-52-57.244Z` 的测试进一步查出返回按钮未移除打开状态。最终报告同时断言页面可见、关闭后状态移除及普通按钮恢复可用。

## 验收

全量 575 项通过：`artifacts/ui-button-events-tests.log`。其中 `tests/ui-button-events.test.ts` 六项覆盖输入顺序、取消、模态页面、定时禁用后恢复、序列化与方案隔离。类型检查、前端及桌面构建通过，日志分别为 `ui-button-events-typecheck.log`、`ui-button-events-build.log`、`ui-button-events-desktop-build.log`。

| 范围 | 报告 |
|---|---|
| 原生真实鼠标 / Enter / Space、取消、非等待模态页面和返回，1 用例 / 30 断言 | `artifacts/ui-button-events-runtime/2026-10-02T17-54-36.286Z/report.json` |
| 原事件图创建、拖放控件、手动连线、保存、撤销重做、页面隔离回归 | `artifacts/ui-event-editor/2026-10-02T17-56-46.297Z/report.json` |
| 原生等待页及嵌套等待，1 用例 / 9 断言 | `artifacts/ui-page-wait-runtime/2026-10-02T17-55-46.948Z/report.json` |
| 原生确认框与普通 / 蓝图菜单，1 用例 / 25 断言 | `artifacts/ui-confirm-runtime/2026-10-02T17-55-55.432Z/report.json` |
| 原生命名关键帧动画及存读档，1 用例 / 21 断言 | `artifacts/ui-animation-clips-runtime/2026-10-02T17-56-03.345Z/report.json` |

最终编译版按钮事件桌面报告：`artifacts/ui-button-events/2026-10-02T17-58-59.438Z/report.json`。验证四种事件创建、重复定位、预演、保存重开、撤销重做及放弃草稿；同目录 `event-graph.png` 已复查，事件入口与原点击事件保持同色。交互预演截图 `pressed.png` 展示真实按压状态。原事件图回归使用 Vite；按钮事件专项使用 dist。验收工程和运行目录均位于 artifacts，未修改原作、用户素材库或已安装编辑器。

## 未完成范围

本轮仅补充按钮交互事件，尚不等同完整 UMG：滑块值改变、文本输入、焦点事件、拖放事件、动画循环与倒放等仍待处理。标准菜单内置控件的完整编辑、其他集合、原作还原、旧入口脚本迁移、剧情流程全选删除和 AI 全覆盖继续保留在主审计中。整体 goal 未完成。
