# CG 图鉴分组与原作核对（2026-10-02）

> 2026-10-03 更新：以下保留历史验收。两份正式模板现已接入94组381张完整内容；8处候选有明确的模板默认选择且其他版本保留，未宣称原作加载版本已确认。按用户最新标准不以逐像素差异阻塞整体功能接入。当前证据与剩余解锁路线范围见[完整图鉴接入](aihong-gallery-complete-2026-10-03.md)。

整体目标未完成。本轮完成通用分组编辑、运行时分镜、分页与源素材提取，未把未确认的同名图像写入正式模板。原作窗口操作在用户按 Escape 后停止；本轮后续对照使用已经保存的截图，原作目录和原素材目录只读。

## 原始清单和提取证据

- `artifacts/aihong-gallery-source/texture-grid.json` 来自 sharedassets0.assets 的 Boot.chapter / pathId 1621。动态定位并严格解析 Texture 表，1018 行中381个 Event 条目有 Thumbnail，按原始顺序归为94组，共12页，每页8组。
- `scripts/extract-aihong-gallery.py` 从 globalgamemanagers 的 ResourceManager 按完整资源路径解析。475个路径中8个路径有两个像素不同的候选，不能将同名条目直接转为字典取其中一个。
- `artifacts/aihong-gallery-source/manifest.json`、`assets/`：483项无损WebP，合计704156252字节。导出后重新解码并与 Unity 原始 RGBA 的 SHA256 比较，全部通过。日志 `artifacts/aihong-gallery-extraction.log`。
- `scripts/lib/aihong-gallery.ts` 只接受精确候选；有歧义且无明确选择时抛错。源资源路径和 pathId 保存在导入素材的 sourcePath 中。当前没有八处路径的最终选择。

## 通用编辑和运行时

`list.galleryGroups` 的每组有 `id`、`name`、`thumbnailAssetId`、有序 `assetIds`。存在分组数组时覆盖旧平面列表；显式空数组保持为空，未配置分组时兼容旧图鉴并尊重 assetIds 顺序。组内重复分镜、重复组ID、错误类型/缺失资源会诊断，空分组提示警告。

普通属性支持搜索、增删/重命名/排序分组，独立缩略图，以及分镜增删和排序。详情支持完整显示/居中裁切/拉伸、末张返回/循环、可选翻页和关闭按钮。每组任一分镜解锁后可打开，详情只按作者顺序显示已解锁分镜。返回保留原页，重开从第一张开始；兼容旧单张详情调用。

分页新增同时显示页码数量、按钮宽高/间隔、字号/字体/粗体/颜色。缩略图状态亮度可独立编辑。AI 可通过真实 UI schema 读取这些字段并按分组ID编辑；本轮验证的是核心读取/写入/校验，未新增真实模型服务验收，不据此宣称 AI 全功能覆盖。

实际编辑器发现并修复 `ui-draft.ts` 按 ID 合并数组时丢失排序的问题：显式排序和插入保留作者顺序；仅修改属性保留外部排序；外部新增保留，外部已删除项不会被重建。新增回归验证此合并规则。

## 原作样式修正

原作 UguiLayeredGridPage 实际引用 sharedassets0.assets:1365 的 CarouselButton，尺寸84×67。场景中的64×57节点只是样板。12个按钮零间距，位置由 Carousel 锚点与226左内边距计算；字体使用原字体引用、BestFit最大40和粗体，文字白色。生成器与两个模板的分页字段已同步。

实际卡片 Button 的目标是 RawImage，普通色0.5019608乘1.5约为0.7529412；悬停色乘系数后截为1。生成器及两个模板的缩略图状态亮度已同步。原生通过独立缩略图显示对象响应按钮状态；底框不随缩略图一同压暗。

源图与保存的原作首张详情比较，居中裁切的RGB平均误差约1.21，完整显示11.98，拉伸10.13（384×216比较，含光标/窗口边缘差异）。证据 `artifacts/aihong-gallery-source/fit-comparison.json`。这证明该画面更符合居中裁切，不代表全部详情交互已核对。

## 验收报告

- 原生合成数据：`artifacts/gallery-pages/2026-10-02T13-00-37.871Z/report.json`。94组/12页、首末页和选中态、部分解锁/新增解锁、分镜顺序、末张返回、Esc返回保持页、重入、循环、方向键/上一张/关闭、旧单图调用。
- 编译版编辑器：`artifacts/gallery-editor/2026-10-02T13-00-38.931Z/report.json`。94组搜索、独立缩略图选择、增删/改名/排序、分镜增删排序、亮度预览、分页尺寸/字号/粗体、撤销重做、保存前磁盘不变、保存重载。脚本 `scripts/verify-gallery-editor.ts`。
- 原素材第一页：`artifacts/aihong-gallery-page/2026-10-02T12-56-33.597Z/report.json`。第一页8组、独立缩略图、首组5分镜以及前3张截图、84×67页码、缩略图普通/悬停状态。**第9组以后是保持12页的空测试组，不是完整导入或完整图鉴验收。**
- 上述目录 `comparison.png`、`comparison-metrics.json`：原作客户区裁为(1,30,1537,894)，两侧均缩到960×540。第一页误差5.11；前三张详情约2.25/2.25/2.28；悬停缩略图比普通状态亮约1.319倍。已查看对照。脚本 `scripts/compare-aihong-gallery.py` 仅读取保存的截图。
- 最终全量515项通过：`artifacts/gallery-full-tests.log`。最终类型检查：`artifacts/gallery-final-typecheck.log`。前端/桌面构建：`artifacts/gallery-final-build.log`。更新开发构建，没有替换安装版。

## 下一步与限制

1. 八处歧义路径：斩首p3/p4/p5/p7、event/yi/cg4、thumbnail/cg4/cg5/cg34。保留所有候选，需确证实际使用版本。
2. 原作首组末张再点击、右键/Esc返回、缩放/拖动和解锁规则仍需实际确认。目前返回/循环是通用编辑器能力，不是原作行为已等价的结论。
3. 完整94组/381分镜尚未写入 `resources/templates/aihong/project.vns.json` 和 `artifacts/aihong-template/project.vns.json`；这两个模板当前仍为旧示例背景清单，只有已证实的分页与缩略图状态样式被同步。后续完整导入必须在 populateAihongStory 后执行，避免它重置平面assetIds。
4. 第一页背景/文字渲染和菜单状态仍有差异，页码字形比原作更粗；不能凭上述像素分数宣称完全相同。
5. 本轮新 CG 缓存约704 MB。验收中的素材链接只用于只读输入；不修改或清理用户已有数据。后续大量夹具避免反复整包复制。

更大范围的 AI 操作覆盖、高级UI其他集合/等待式页面、嵌套时间轴限制和其余原作页面继续参见完整审计表。

## 高级 UI 图鉴交互预演补充

`gallery-preview.ts` 管理独立的分页和详情状态，`ui-logic-preview.ts` 接入图鉴事件。`GalleryPreview` 同时服务静态设计画布与交互预演，复用几何、缩略图和皮肤。详情支持三种fit、上一张/下一张、末项关闭/循环、可选控制按钮；关闭保留页码和焦点，离页重入复位。`UiGalleryPreviewData` 允许全部或部分测试解锁，旧平面图鉴也可预演。详情期间页面计时器继续，底层按钮、偏好控件和快捷键被拦截。

- 最终编译版：`artifacts/ui-gallery-preview/2026-10-02T13-27-26.326Z/report.json`，94组/12页、独立缩略图、部分解锁、分镜顺序、键盘/右键/按钮、焦点恢复、测试重置、UI草稿及磁盘不变。
- 最初交互报告 `2026-10-02T13-21-14.213Z` 未检测到视觉层级错误。复查截图发现 `.ui-component` 的z-index高于详情，虽inert仍会绘制。修复为隔离预演画面、将页面组件放入独立堆叠上下文；新增“隐藏底层前后详情画面逐像素相同”断言，修复前62446像素不同，修复后0。证据 `artifacts/gallery-interaction-layer-regression-before.log`，最终截图 `partial-unlock-frame.png`、`partial-unlock-detail.png` 和 `last-page-frame.png` 已查看。
- 原菜单回归：`artifacts/ui-preview-navigation/2026-10-02T13-27-26.381Z/report.json`。静态图鉴编辑回归：`artifacts/gallery-editor/2026-10-02T13-24-35.680Z/report.json`，涵盖草稿、排序、撤销重做和保存重载。
- 新增6项图鉴预演核心测试，全量521项通过：`artifacts/gallery-interaction-full-tests.log`。最终类型检查：`artifacts/gallery-interaction-final-typecheck.log`；前端/桌面构建：`artifacts/gallery-interaction-build.log`，视觉修复后的前端构建：`artifacts/gallery-interaction-layer-build.log`。

这些使用小型合成素材，不新增原作交互或真实模型验收。完整原作导入仍受八处资源歧义限制；其他集合、等待式页面、演出协同继续待办。
