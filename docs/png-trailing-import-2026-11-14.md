# PNG 尾部数据导致素材不显示的修复

日期：2026-11-14（Asia/Shanghai）。接续 [游戏流程禁止跳过修复](game-flow-skip-2026-11-14.md)。用户询问 `我的视觉小说1/assets/未分类` 中一张图片为什么没有显示在编辑器资源管理器。

状态：原因确认、最小产品修复、全量测试、统一构建及真实图片隔离桌面验收完成。真实作品和图片均只读，最终哈希不变。临时工程与 profile 已清理；两轮 unit-temp 精确删除被 `blocked by policy` 拒绝，详见末尾。

## 实际原因

目录有两张 PNG。`Image_1791558602272_523.png` 已在工程素材清单登记；`asset_530d4de6eb4fef751fb98dc8.png` 未登记，工程清单共 469 项，无该 ID 或路径引用。

未登记图片为 1672 × 2508，2,212,136 字节。完整 PNG 的 IEND 结束在 2,210,874 字节处，后有 1,262 字节附加数据。图像内容可正常解码，原 `pngjs` 元数据读取却因结束后的数据报 `unrecognised content at end of stream`。

编辑器已有打开、窗口聚焦和每 5 秒自动发现素材的扫描。扫描与手动导入共用该解析器，所以扫描一直无法登记该图片。此前手动导入又先复制、后分析元数据，解析失败可能留下“文件存在、没有素材记录”的状态。无法仅凭现存文件断言它具体来自哪一次历史导入。

## 修复

`src/desktop/png-metadata.ts` 从签名后的块边界逐个读取长度，只把完整、长度为 0 的 IEND（含其 CRC）作为图像流结束。元数据解码时忽略结束后的附加数据，源文件、内容 ID、复制和引用字节保持原样。

不会搜索并误切割块内容里的 `IEND` 字样。没有完整 IEND、内部截断和越界时继续交给原解码器拒绝，保留现有签名和 CRC 校验；不称 pngjs 对所有 ancillary 块都校验 CRC。

`src/desktop/project-store.ts` 在创建目录、复制文件前完成 PNG 元数据读取。元数据失败不再留下新目标文件；没有扩大为所有取消或磁盘写入失败的完整事务。

重新打开包含修复的源码编辑器后，现有扫描即可发现目录内这张图片，再保存工程保留登记。不需要编辑真实工程 JSON 或重新编码原图。

## 统一验证

全部实现、用例和静态交叉审查完成后统一运行：

- `corepack pnpm exec tsx --test --test-concurrency=4 tests/*.test.ts`：2492／2492，通过。
- `corepack pnpm build`：含 TypeScript 检查，通过。renderer JS `index-Cs2LH9aM.js`／CSS `index-uhZFVY1z.css` 与前一游戏流程专项相同，桌面 main／图片 worker 更新。
- 新增单测 5 组：同步与 worker、透明边界、块内 IEND、不合法 CRC／截断、复制／引用／去重、保存重开、失败无目标残留、已有未登记同路径文件及自动发现。
- 桌面 4 组：使用该真实图片原始字节的本轮证据副本，建立全新工程，真实自动发现、缩略图、双击详情预览、实际保存和关闭重开，全部通过。

桌面验收没有直接向工程注入素材记录或用 IPC 模拟发现。产品扫描自行登记，Chromium 的实际图片 `complete`、`naturalWidth=1672`、`naturalHeight=2508` 均通过；文件字节和修改时间不变。重开后经聚焦与 5.2 秒定时扫描，仍一条登记、无未保存标记、保存文件文本不变。两次自有 Electron 正常退出，无未捕获页面异常，4 张最长边 1280 的截图和两份 trace 保留。

前一游戏流程修复的 6 组桌面、10 原生／57 断言仍对应相同 renderer 和游戏运行时源码，详见上述文档。本轮没有再次生成原生游戏验收结果。

## 证据和边界

证据根：`artifacts/png-trailing-import-2026-11-14/`。

- 原因与只读文件哈希：`diagnosis.json`、`validation-main/author-read-only-audit.json`。
- 原图片证据副本：`original-image.png`；最长边 900 的预览：`missing-image-preview.png`。
- 最终桌面：`editor/2026-11-13T18-11-45.352Z-c22941bd/report.json`；`evidence/` 保留发现前、保存后和重开后的工程与原始图片。
- 冻结 1704 份源／测试／脚本／配置，验证后无改动；10 件构建指纹及与前轮比较保留在 `validation-main/`。

真实工程 JSON SHA256 始终 `189c37e45d490e1f4db34e2aa07aaef3815655e75c0600a704bd85d0cb4c4511`，原图 SHA256 始终 `530d4de6eb4fef751fb98dc8285b9188e8458887700cd03a5b75a56ef0cfa6af`。

桌面临时 `project`、`profile` 已自清理。**本轮 `unit-temp` 和前一游戏流程轮 `unit-temp` 的精确 PowerShell 删除被自动审批以 `blocked by policy` 拒绝，命令未执行；拒绝后不得进入、枚举、检查存在性或重试，也不得换工具／代理绕过。** 清单在两轮 `validation-main/cleanup-exceptions.json`，报告、截图、trace 和工程证据保留，不称全部临时清理完成。其它历史拒绝路径没有访问。

未提交、打包、发布或调用付费 AI。安装版未更新；本轮没有直接启动真实作品，需重开新版源码编辑器查看自动发现结果。
