# v0.8（0.8.0）验收记录

发行批次：2026-10-08。平台：Windows 10 x64、Ren’Py 8.5.3、Electron 40。

本批次包含全部已完成的 v0.8 开发修改：背景音乐命令、图片仅本句、独立 X/Y 缩放、数值拖动、舞台变换、角色默认渐变离场、流程图属性精简、完成状态预览、暂停后编辑保留时间，以及章节与媒体、关闭保存和 Windows 单 EXE 导出。

## 本次开发验证

| 范围 | 结果与证据 |
|---|---|
| 全量单元测试 | 953 / 953 通过，0 失败、0 跳过；`work/v08-release-tests.log` |
| 类型检查、前端及桌面构建 | 通过；`work/live-parameters-typecheck.log`、`work/live-parameters-vite.log`、`work/live-parameters-desktop.log` |
| 两轴变换与编辑界面 | 8 项检查通过；包含两轴各自控制画面、数值拖动与修饰键、舞台移动／缩放／旋转、暂停编辑、角色页签、仅本句和保存重开；`artifacts/media-authoring-ux/2026-10-08T03-32-54.211Z/report.json` |
| 原生图片范围与变换 | 15 条断言及像素检查通过；不同 X/Y 缩放、旋转、跨句、存读档、定时和独立演出清理；`artifacts/media-lifetime/2026-10-08T03-38-51.028Z/report.json` |
| 作者工程实时编辑 | 模块和文本各连续拖动 24 次，最终数值、一次撤销／重做、保存重开通过；`artifacts/live-parameters/2026-10-08T03-40-27.874Z/report.json` |
| 旧变换替换 | 1 条已使用的图片变换替换为两轴，保留实际画面大小和位置；118 条角色指令及场景入口不变，写入前核对哈希并备份；`work/image-axis-replacement/2026-10-08T03-29-47.630Z/applied.json` |
| 开头背景音乐 | 章节音乐通道为空，首句播放显式指定的「花街柳巷」，未调用「青梅竹马」；`artifacts/author-opening-music/2026-10-08T02-41-50.271Z/report.json` |

旧 `@bgm`、旧显示角色「转场／时长」参数、旧图片「尺寸＋整体缩放」文本结构不作为兼容语法保留。测试与模板使用新命令和结构。

## 实时编辑测量

采用作者工程副本与真实素材，使用生产前端构建。数值拖动期间只更新预览，结束时统一同步剧本；每种模式记录 24 次输入到下一帧的时间。

| 情形 | 中位数 | P95 |
|---|---:|---:|
| 修改前，模块模式 | 512.6ms | 577.3ms |
| 修改后，模块模式 | 24.4ms | 29.2ms |
| 修改后，文本模式 | 21.7ms | 24.8ms |

前测文本模式在实时提交后因选择丢失而中断，只使用模块模式完成的 24 个样本作前后比较。失败记录保留在 `artifacts/live-parameters/2026-10-08T03-29-02.896Z-baseline/report.json`；最新运行两种模式均通过。松开时仍有一次完整提交，本机两种模式分别观测到 279ms 和 228ms 的长任务。这些是单机结果，不是所有工程的性能承诺；此前章节首次播放仍可能短暂停顿。

## 发行包复验

安装版和便携版生成后，使用当前文件的 SHA-256 与实际解包程序进行复验；最终结果另存为随发行文件提供的 `release/verification-0.8.0.json`、`release/acceptance-0.8.md`、`release/SHA256SUMS-0.8.0.txt`，不使用历史包报告替代本批次证据。

复验范围包括：安装器主档和单独存放的 Android Spine 库、便携 ZIP 与发行目录的逐文件核对；从本次安装器解出的编辑器验证图片与演出交互、作者工程副本及流程图；在源码目录外、仅系统 PATH 的环境启动便携编辑器，创建中文工程、移动便携目录、重开工程并从界面导出单 EXE。

```powershell
node scripts/package.mjs
node scripts/verify-v08-release.mjs
# 将 VNS_INSTALLED_EXE 指向本次校验报告中的 installer.executable 后：
node --import tsx scripts/verify-media-authoring-ux.ts
node --import tsx scripts/verify-media-commands-editor.ts
node --import tsx work/verify-compact-show-ui.ts '<作者工程路径>'
node --import tsx scripts/profile-live-parameters.ts '<作者工程路径>'
# 便携版直接验证本次 ZIP：
node --import tsx scripts/verify-v08-portable.ts
```

发行内容验证使用支持 NSIS 的完整 7-Zip，可通过 `VNS_FULL_7ZIP` 指定。安装器只进行解包与程序运行验证，未执行系统安装／卸载。Windows 已实测；本轮没有重新执行 Android SDK 下载、签名和真机安装，Android 库仅检查内容与哈希完整性。已导出的游戏需要重新导出才能包含运行时修改。

2026-10-07 的 926／936 项测试、旧包验收与当时「未重新打包」的状态保留在 [历史记录](acceptance-0.8-2026-10-07.md)，不代表本批次。
