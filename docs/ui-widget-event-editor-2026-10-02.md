# UI 控件事件图重构 · 2026-10-02

用户纠正：高级 UI 应采用类似 UE5 Widget Blueprint 的控件事件编程方式。原来的参数联动表单与预演主导工作区不满足这一要求；历史列表预演的未完成改动已移到 artifacts/ui-event-editor-checkpoint，未继续接入。

本轮开发版将 UI 编辑分为同一页面的“设计 / 事件图”。事件图使用单套停靠面板：左侧“我的界面”列出当前页面控件、事件和变量，中间是可拖动连线的图，右侧是节点详细信息。选择按钮可添加或定位 OnClicked；控件拖入图中可选读取/设置属性。上下文节点搜索默认筛选界面、流程和计算节点，可关闭筛选。测试与参数绑定降为底部辅助入口，默认收起。原有参数绑定、媒体预演及通用蓝图编辑器保留。

新增 BlueprintGraph.uiPageId / uiInstanceId 元数据。页面显示入口自动挂接原生与预演，删除入口后不会误执行点击节点；按键、定时和点击事件均检查页面/方案归属。无元数据的旧图按已有按钮事件、显示事件、定时或按键绑定归类，不再把全部 kind=ui 图混入当前页。页面、方案继承、同 ID 控件和空自定义页面有核心覆盖。

操作验收：选按钮 → 添加 OnClicked → 拖入目标文字 → 设置“显示=否” → 手动拖动执行引脚连线 → 预演点击生效 → 撤销重做 → 显式保存 → 重开保留图。再次添加同一按钮事件会定位已有节点。切换页面不混图；退出放弃能撤回新图。证据：

- scripts/verify-ui-event-editor.ts；artifacts/ui-event-editor/2026-10-02T15-48-29.110Z/report.json、event-graph.png、project.vns.json。
- scripts/verify-ui-event-runtime.ts 使用桌面实际保存图，并添加页面显示文字初始化。原生 Ren’Py 1 用例通过：artifacts/ui-event-runtime/2026-10-02T15-44-52.028Z/report.json。
- AI 同名控件选择、未保存草稿、应用建议、撤销重做及放弃：artifacts/ai-advanced-ui-selection/2026-10-02T15-46-32.829Z/report.json；模拟提供方，无外部模型请求。
- 548 项全量测试通过：artifacts/ui-event-full-tests-final.log。类型检查及前端/桌面构建通过：ui-event-typecheck.log、ui-event-build.log。

验收记录：首次桌面夹具使用不允许冒号的 id schema 暴露新标准页元数据校验错误，已改为标准页标识联合并补语义校验；两次后续脚本错误是控件输入匹配未指定 exact 和预演按钮名称拼接错误，修正断言后重跑通过。旧 verify-blueprint-editor.ts 仍依赖此前已移除的“新建逻辑蓝图”入口，本次没有将该失败算作通过；共用编辑器改用 verify-blueprint-selection-editor.ts 验证。

本轮是控件事件工作流落地，不代表已完整实现 UE5 的所有 Widget Blueprint 功能。当前直接事件入口包括页面显示、按钮点击、按键和定时；拖入控件创建带目标引用的读取/设置节点。原生动画与更多控件事件仍按现有能力与后续目标推进。未替换已安装版，未修改原作素材目录。整体持续目标仍未全部完成。

共用图编辑器补充：verify-blueprint-selection-editor 本轮 7 项节点/连线交互检查已通过（部分相交框选、节点/连线混选删除与撤销重做、整组拖动、参数折叠、缩放后的连线命中）。整套旧脚本未通过：更新“返回剧情蓝图”为当前“流程图”入口后，在无关剧情流程的全选删除阶段暴露“预期保留开始节点 1 个，实际 0 个”，停止于该断言，重启偏好段未执行；见 artifacts/ui-event-selection-regression.log。此项保留为后续审计，不能把整套脚本计为通过。本轮没有修改剧情流程的删除实现。UI 事件图自身完整脚本与 548 项全量单元测试均通过。

后续关闭记录（2026-10-03）：上述旧蓝图脚本入口和剧情全选删除问题已解决，两套完整脚本分别通过六项及九项验收，见[流程删除与验收迁移](story-delete-and-blueprint-verification-2026-10-03.md)。
