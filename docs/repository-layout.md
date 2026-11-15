# 工程组织

编辑器源码和 Ren'Py SDK 是两个独立目录。开发时使用已准备到 `resources/runtime/` 的运行时，也可通过 `VNS_RENPY_SDK` 指定本机 SDK。安装版和便携版自带离线运行时。

## 源码目录

| 目录 | 内容 |
| --- | --- |
| `src/core/` | 工程数据、文本指令、蓝图与时间轴等核心逻辑 |
| `src/renderer/` | 编辑器界面、画布、属性面板与交互 |
| `src/desktop/` | Electron 桌面窗口、文件操作、AI 与试玩管理 |
| `src/runtime/` | Ren'Py 编译、游戏运行及导出 |
| `native/`、`vendor/` | 原生桥接、单 EXE 启动器和第三方源码 |
| `resources/` | 示例工程、模板、依赖许可及打包资源 |
| `scripts/` | 开发、打包和桌面验收脚本 |
| `tests/` | 自动化测试 |
| `docs/` | 使用说明、设计资料与历史验收记录 |
| `docs/design/` | 产品规划和界面设计提案 |

`node_modules/`、`dist/`、`dist-desktop/`、`release/`、`artifacts/`、`work/` 和 `resources/runtime/` 都是本机目录，已由 Git 忽略。它们分别保存依赖、编译结果、发行包、验收输出、工作备份和运行时。历史记录中的验收文件路径属于执行当时的本机环境。

小说作品的 `project.vns.json` 和素材目录保存在单独的作品文件夹。便携版的 `data/` 与程序一起保存，包含编辑器偏好、AI 配置、模板及试玩存档；不要将它加入源码仓库。

## 从源码开始

使用 Windows x64、Node.js 24 和 pnpm 11.25.0，并另外解压 Ren'Py 8.5.3 SDK。仓库的 `packageManager` 字段固定了 pnpm 版本。

```powershell
pnpm install --frozen-lockfile
pnpm runtime:prepare '<本机 RenPy SDK 目录>'
pnpm typecheck
pnpm test
pnpm dev
```

SDK 路径需替换为本机实际位置。已有 `resources/runtime/` 时不必重复准备。维护源码使用 `pnpm dev`；正式版直接运行 `Visual Novel Studio.exe`。

打包使用 `pnpm package`，产物写入 `release/`。发行包通过 GitHub Releases 分发；Git 仓库保存可维护的源码、模板和必要资源，不保存便携版的用户数据。

## 程序、作品与备份

源码、正式程序、小说作品和 SDK 可分别放在自己选择的目录。作品不要放进源码仓库或程序更新目录；移动作品时保留工程、素材与 `.studio`。便携版更新时先关闭程序，将旧版 `data` 复制到完整解压的新版目录。安装版通过正常安装更新，保留原有用户数据。

GitHub Release 提供安装版、便携版和版本校验清单，源码由版本标签自动生成。验收输出与本机备份保存在源码之外的独立位置，或已忽略的本机目录，不作为发行附件。
