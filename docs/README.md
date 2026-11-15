# 叙事工坊 v0.8.1

Windows 中文视觉小说编辑器，可编辑剧本、流程图、蓝图、舞台与游戏界面，生成独立运行的 Ren'Py 游戏。程序随附离线运行时，日常创作无需安装 Node.js、Python 或 Ren'Py SDK。

安装版从开始菜单启动，便携版全部解压后双击 **Visual Novel Studio.exe**。请保留程序目录中的 `resources`、`locales`、DLL 等文件。便携版的设置、模板、AI 配置和缓存保存在程序旁的 **data** 文件夹；移动或更新时一并保留。小说作品保存在创建时自己选择的目录，备份时保留工程、素材和 `.studio`。

## 开始使用

1. 新建空白作品或哀鸿模板，保存到自己的作品目录。
2. 导入资源、建立角色和参数，在剧本中输入台词，在流程图中连接分支。
3. 使用蓝图或时间轴制作演出，编辑界面后保存，点击“试玩”检查。
4. 打开“作品设置 → 游戏导出”，确认环境就绪后导出 Windows ZIP 或单 EXE。Android 首次配置需要联网并同意 SDK 许可。

## 使用文档

- [使用说明](docs/user-guide.md)：创建、保存、试玩、界面和玩家剧情图。
- [v0.8.1 更新说明](docs/release-0.8.1.md)：本版功能、更新方法和下载校验。
- [便携版](docs/portable.md)：解压、data 保留和换机。
- [游戏导出](docs/game-export.md)：Windows 和 Android 的环境及格式。
- [中文文本编剧](docs/text-authoring.md)与[文字演出](docs/text-presentation.md)。
- [蓝图](docs/blueprint-authoring.md)、[时间轴与参数](docs/authoring-tracks-and-parameters.md)、[模板管理](docs/starter-template.md)。
- [AI 创作助手](docs/ai-assistant.md)：连接设置、参考资料和方案审阅。

安装程序、便携 ZIP 和校验清单见 [v0.8.1 下载页](https://github.com/2196328649/visual-novel-studio/releases/tag/v0.8.1)。更新前关闭旧程序并备份作品；便携版解压到新目录后复制旧版 `data`。素材与依赖许可见 `resources/SAMPLE-CREDITS.md` 和 `resources/THIRD-PARTY-NOTICES.txt`。

本文件在发行包中放在程序根目录；源码维护说明见仓库根 README。
