# 游戏导出

在「作品设置 → 游戏导出」选择 Windows 或 Android。顶部的「导出」也打开此页面。修改设置只保存配置；点击页面底部「导出」才会编译和生成游戏包。未设置目录时会先询问位置，成功后自动打开目标文件夹。

两种平台共用作品版本和游戏图标。图标从资源管理器选择 PNG，资源浏览器支持缩略图；程序自动生成 Windows 的 ICO、窗口图标以及 Android 的自适应图标前景和背景。

点击「一键配置」自动准备并复检环境。界面显示下载／安装进度、取消、重试及详细记录；关闭再打开设置页仍能查看正在进行的任务。已校验的下载会保留，重试时复用。工具使用编辑器私有目录，不修改系统 PATH 或 JAVA_HOME。配置期间不能同时导出。

## Windows

支持 64 位 Windows ZIP 或单 EXE，在「Windows 打包格式」选择。文件名可使用中文、英文、数字、下划线或短横线。ZIP 完整解压后运行游戏 EXE；单 EXE 直接双击运行。玩家不需要安装编辑器或 Ren’Py。

单 EXE 内含引擎和素材，每次启动自动校验并解包到独立临时目录，正常退出后清理；存档保存在用户目录。启动时需要额外磁盘空间，比解压好的 ZIP 稍慢。准备期间可以取消，文件损坏或空间不足会提示原因。游戏图标也会写入单 EXE。它使用 Windows 自带的 .NET Framework，不需要开发编译器。

Windows 运行时随安装版和便携版提供，一键配置可以离线完成，也能重新复制并修复私有运行时。打包临时路径过长时会自动使用系统临时目录下的短路径。文件本身仍需满足 Windows 文件名和路径限制。

内置“哀鸿界面示例”已包含标题、剧情、选项、存档、读档、玩家设置、三个分支结局和返回标题。新游戏从作品设置的故事入口开始；结局显示完后返回标题，重新开局重置本次剧情变量。没有结局指令的 AI 导入剧本自动以“未完待续”收尾。用户保存的游戏进度与玩家偏好使用独立的存档目录。

2026-09-20 已生成可独立运行的[Windows 示例游戏包](../artifacts/complete-game-export/2026-09-20T04-24-42.460Z/distribution/Aihong-Authoring-Demo-1.0.0-win.zip)。解压后运行 `Aihong-Authoring-Demo.exe`；包内程序的完整流程通过 16 个原生断言，并保留[核验报告与截图](../artifacts/complete-game-export/2026-09-20T04-24-42.460Z/report.json)。这是可编辑的两章分支示例，剧情含节选与改写。

## Android

- **APK**：用于直接安装到手机或分发到支持 APK 的商店。
- **AAB**：用于提交 Google Play，不能直接安装。
- **包名**：应用的唯一标识，例如 `com.example.mystory`。每段以小写字母开头，可以包含数字和下划线；发布后保持包名不变。
- **版本代码下限**：Ren’Py 8.5.3 取该数值和构建时的 Unix 时间戳的较大值。界面中的游戏版本仍为 `1.0.0` 等对玩家显示的版本。
- **屏幕方向**：横屏、竖屏或跟随设备旋转。
- **允许联网**：需要访问网络的自定义游戏脚本可启用此权限。
- **图标底色**：用于 Android 自适应图标的背景，前景由所选 PNG 生成。

环境检查为只读操作，不会下载依赖、创建签名或打包。首次导出前：

1. 阅读界面中的 [Android SDK 许可协议](https://developer.android.com/studio/terms)，同意后勾选确认。
2. 点击「一键配置」。程序从官方来源获取 JDK 21、匹配的 RAPT 与 Android SDK，验证 SHA-256 后安装所需平台和构建工具。
3. 等待检查列表显示「可以导出」，再点击「选择目录并导出」。首次实际构建还可能下载 Gradle 与 Maven 依赖。

下载失败可重试，已校验的压缩包不会重复下载。高级工具保留 Ren’Py 启动器入口；已有 SDK 可将绝对路径写入私有运行时的 `rapt/sdk.txt`。自带 Spine Android 库缺失时会单独报错，不会把环境误报为就绪。

「Android 安装说明」打开 [Ren’Py 官方 Android 文档](https://www.renpy.org/doc/html/android.html)。编辑器开发版优先使用 `VNS_RENPY_SDK` 指定的运行时；否则使用随编辑器提供的运行时或开发目录上级的 SDK。

签名保存在工程内的 `.studio/<工程编号>/android-signing/`，首次实际导出时创建，后续构建继续复用。可以通过「打开签名文件夹」备份 `android.keystore`、`bundle.keystore` 和签名记录；移动工程时一并保留 `.studio`。另存为会复制签名，且不会覆盖目标目录中的其他签名。已有 Ren’Py 工程可将原签名放在工程根目录，首次导出时会导入；目前使用 Ren’Py 的标准 `android` 别名和密码格式。密钥不会进入导出的游戏包。

## 含骨骼动画的作品

Android 使用原生 `libvns_spine.so`，Windows 使用 `vns_spine.dll`。Android 导出检查 ARM 32 位、ARM 64 位、x86_64 三种库，缺失时会在构建前显示原因。开发编辑器时可使用 Android NDK r28 或更新版本生成这些支持库：

```powershell
node scripts/build-spine-android.mjs "C:/Android/Sdk/ndk/28.2.13676358"
```

也可设置 `ANDROID_NDK_HOME` 后运行 `pnpm spine:build:android`。该命令只生成骨骼动画支持库，不生成 APK。输出位于 `resources/spine/android/<ABI>/libvns_spine.so`，使用 16 KB 段对齐；发布编辑器时随资源目录一起分发。实际 Android 导出会将这些库安装到 RAPT 的原生库目录，游戏按设备架构加载。

## 开发验证

`pnpm test` 覆盖平台路由、配置保存、签名复用、图标、依赖错误和失败报告。`node scripts/build-desktop.mjs` 后运行 `pnpm exec tsx scripts/verify-export-settings.ts`，检查真实桌面设置、资源缩略图、保存重开及导出参数；测试隔离真实打包入口，不生成安装包。

`node node_modules/tsx/dist/cli.mjs scripts/verify-complete-game-export.ts` 通过正式导出服务生成独立 Windows ZIP，随后解压并直接运行包内的 EXE，检查标题、流程图、设置、真实存读档与分页、三个分支结局、返回标题和重新开局。验证脚本仅加入解压后的测试副本，交付 ZIP 保持发行内容；使用独立玩家存档，不覆盖用户作品。最新游戏包、截图与结果见[当前验收记录](current-authoring-work.md)。此记录验证 Windows 导出，不代表 Android 已实际打包。
