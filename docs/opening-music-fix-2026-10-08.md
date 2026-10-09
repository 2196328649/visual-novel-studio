# 开头配乐残留修复

作者工程中的开场入场动作曾自动循环播放“青梅竹马”。第一次清理后，旧窗口在 00:51:42 再次保存，将内存中的入场动作写回工程。第二次在编辑器关闭时清理并备份，之后使用真实用户配置打开作者工程，保存、关闭、重新启动，确认入场动作始终为空且最新剧本内容保留。

原生回放还发现标题界面音乐会延续到章节动画。编译器现于 `label start` 首先停止 music 通道，再进入选定剧情入口。普通开始和从选定位置试玩均适用，正文自己的 BGM 指令正常播放。

最终验证：

- 30 项编译器及玩家界面相关测试通过：`work/story-start-music-tests.log`。
- TypeScript 与桌面构建通过：`work/story-start-music-types.log`、`work/story-start-music-desktop.log`。
- 真实作者工程经保存、关闭、重新启动后仍无隐藏入场 BGM：`artifacts/author-bgm-session/2026-10-07T17-10-21.831Z/report.json`。使用用户原配置目录，已留下更新后的编辑器窗口供继续使用。
- 原生 Ren’Py 记录实际播放调用及通道状态：`artifacts/author-opening-music/2026-10-07T17-07-59.395Z/report.json`。章节动画时 `playing=null`，第一句正文时为 `assets/BGM/花街柳巷.ogg`，未调用 `assets/BGM/青梅竹马.ogg`。

最新清理前备份：`E:/Project/Visual Novel Studio/我的视觉小说1/.studio/backups/remove-opening-memory-bgm-2026-10-07T16-56-00.029Z/project.vns.json`。保留音乐素材及其他未调用的蓝图定义，未打包安装程序。
