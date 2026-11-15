# 时间轴属性与关键帧同行

用户要求时间轴属性像剪映一样节省空间，将属性数值和关键帧排在同一行。

## 改动

- 「基础 → 画面与变换」中的位置、缩放、旋转、不透明度，统一为「属性名｜数值｜上一帧・菱形・下一帧」。普通画面片段、外层组合和组合内部子片段共用现有组件。
- 清除通用表单给每行叠加的上下空白，数值框保持 30px 高，每行连同间隔为 36px。按钮显式使用 24px 宽，避免通用按钮的 30px 最小宽度挤压输入框。
- 可用属性区域不足 200px 时，只有标签移到上一行；数值与三个关键帧按钮仍保持同行。使用面板自身宽度适配，拖动面板分隔线也会生效。
- 保留属性名拖动调值、直接数字输入、关键帧激活/禁用、前后定位、撤销重做和保存重开。
- 桌面验收发现 `updateVisualNodeObject` 在第一次改位置时无条件把节点名同步为对象名，导致首个拖动更新修改两个字段、后续只修改一个字段，历史合并将其分开。现在只在外层对象确实改名时同步节点名称；修改变换或子对象名称不会覆盖外层节点名。新增回归覆盖字段稳定性、明确改名和子对象改名。

没有改变关键帧时序、插值算法、工程格式和游戏绘制。文字计时规则、局部粗斜体三态以及大型组件拆分不在本次范围内。

## 验证

全部实现后统一构建、验证；第一轮桌面验收暴露上述撤销问题，修复后重建。最终 `corepack pnpm build`（含类型检查）和 1702/1702 单元测试通过。

`scripts/verify-timeline-layer-keyframes.ts --compiled --properties-only` 使用最终编译产物、隔离工程与 profile。属性专项保留轨道/片段拖动和画面像素检查，加入同行几何、标签拖动、一次撤销/重做、插值、关键帧增删/定位、保存重开、窄窗口、组合及区间外禁用检查。`--properties-only` 跳过原脚本中与本次无关的资源管理、角色目录及剧情转场步骤，未据此声称那些步骤重新通过。

| 场景 | 属性可用宽度 | 每行高度 | 数值框宽度 | 横向溢出 |
| --- | ---: | ---: | ---: | ---: |
| 1440px 窗口 | 304.14px | 36px | 160.14px | 0 |
| 1100px 窗口 | 222.54px | 36px | 78.54px | 0 |
| 1024px 窗口 | 204.29px | 36px | 60.29px | 0 |
| 1024px 手动缩窄面板 | 184.03px | 54.39px | 108.03px | 0 |
| 组合外层 | 319px | 36px | 175px | 0 |
| 组合内部文字片段 | 304.14px | 36px | 160.14px | 0 |

- 第一轮失败与诊断：`artifacts/timeline-layer-keyframes/2026-11-05T11-38-45.488Z/report.json`、`artifacts/timeline-property-layout-2026-11-05/undo-diagnostic.log`。
- 修复后通过：`artifacts/timeline-layer-keyframes/2026-11-05T11-45-31.363Z/report.json`。
- 最终截图补全后再次通过：`artifacts/timeline-layer-keyframes/2026-11-05T11-49-34.543Z/report.json`；该次只调整脚本拍摄前的滚动位置，产品代码与最终构建一致。
- [常规窗口截图](../artifacts/timeline-layer-keyframes/2026-11-05T11-49-34.543Z/keyframes-desktop.png)、[1024px 窗口截图](../artifacts/timeline-layer-keyframes/2026-11-05T11-49-34.543Z/timeline-1024.png)、[组合内部截图](../artifacts/timeline-layer-keyframes/2026-11-05T11-49-34.543Z/composition-properties.png)。截图已人工核对。
- 构建、单测、桌面日志和总报告保留在 `artifacts/timeline-property-layout-2026-11-05/`。

本轮没有游戏运行时改动，不重复整套游戏验收。3 次桌面运行的 9 个临时工程、profile 和输入素材目录均已清理，错误为 0；保留报告、截图、日志和保存数据证据。临时诊断脚本已删除。真实工程未写入，未提交 Git、未打包或发布。最终构建入口为 `dist/assets/index-CmPUVoL0.js` 和 `dist/assets/index-C9_vTmCR.css`。
