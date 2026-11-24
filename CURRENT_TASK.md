# CURRENT TASK — 0.1.12 读谱底座

> 状态：已完成浏览器 + 真机验收，已发布 GitHub Release `v0.1.12`
> 更新时间：2026-11-24
> 版本基线：`0.1.11b` / `versionCode 113`，HEAD `aceaee2`
> 目标版本：`0.1.12` / `versionCode 114`（已完成并发布）
> 关联：[TASK.md](TASK.md)（项目总账） / [CHANGELOG.md](CHANGELOG.md)（发布历史） / [docs/功能完善指南.md](docs/功能完善指南.md)（范围口径）

## 1. 目标

把读谱页从“文件查看器”补成更顺手的阅读底座。只做四件事，不碰谱面结构化、不做 A-B 页段/行段循环、不做自动滚屏：

1. **PDF / 图片首页缩略图**：书架卡片显示封面，PDF 只渲染第 1 页；缩略图落 `assets` store，可重复使用，不把整本 PDF 转图。
2. **文本谱导入**：支持 `.txt`、`.md` / `.markdown`、轻量 `.cho` / `.chordpro`；等宽渲染、保留空格与换行、当前阅读行高亮。
3. **禅定锁屏**：阅读页可一键锁定，遮住全部操作区；必须长按 3 秒才会解锁，返回键不直接退出。
4. **桌面键盘快捷键**：桌面浏览器 / 带实体键盘的设备可翻页、缩放、全屏、锁定、播放节拍器；不做蓝牙踏板映射。

`0.2.X` 的页段循环、行段循环、自动滚屏仍保留为想法，等混合结构化与锚点模型定稿后再写规格。

## 2. 数据与格式

### 2.1 IndexedDB

- `DB_VERSION` 从 `3` 升到 `4`。
- 新增 `assets` store：`keyPath: 'id'`、`autoIncrement: true`，索引 `scoreId`。
- 封面资产记录：`{ id, scoreId, kind: 'cover', blob, mime, width, height, bytes, createdAt }`。
- `scores` 记录新增：
  - `format`: `pdf` / `image` / `text`
  - `pageCount`: PDF 页数；图片 / 文本为 `1`
  - `coverAssetId`: 封面资产 id；文本谱为空
- `deleteScore` 同步删除该谱的 `assets`；`clearAllData` 清空 `assets`。
- 升级只建 store / 索引，不迁移、不重写旧记录；旧记录按文件扩展名惰性推断格式。

### 2.2 备份

- 备份 schema 从 `2` 升到 `3`。
- 导出 / 恢复保留 `format`、`pageCount`；不导出封面资产，恢复后按需重新生成。
- 旧备份没有 `format` 时，按文件名推断，保证兼容。

### 2.3 文本谱判定

- 扩展名：`.txt` / `.md` / `.markdown` / `.cho` / `.chordpro`。
- MIME：`text/plain` / `text/markdown`。
- 其他文件仍按 PDF / 图片处理；不认识的格式计入失败，不再静默当图片。

## 3. 实现

### 3.1 封面缩略图

- 新增 `js/services/cover-cache.js`：
  - PDF：用现有本地 `pdf.js` 只渲染第 1 页，缩略图宽 320px，JPEG 质量约 0.78。
  - 图片：用 `Image` + canvas 缩到 320px，JPEG 质量约 0.78。
  - 生成后写入 `assets`，回填 `coverAssetId` / `pageCount`。
  - 同一份谱只生成一次；并发请求复用同一个 Promise。
  - 文本谱不生成封面。
- 书架卡片：
  - 有封面时显示 3:4 封面图，`object-fit: cover`、顶部对齐。
  - 无封面时保留 `📄` / `🖼️` / `📝` 图标占位。
  - 首次渲染先出占位，再异步补封面；不阻塞书架出现。
  - 卡片底部显示格式 / 页数小字，例如 `PDF · 3 页`、`TXT`。
- 打开 PDF 时仍用现有 `renderPDFLazy`；封面缓存不得改变阅读页虚拟化参数。

### 3.2 文本谱

- 新增 `js/services/score-format.js`：统一格式判定与显示名。
- 新增 `js/services/text-score.js`：解析轻量文本谱。
  - 去 BOM、统一换行。
  - ChordPro 指令：`{title:}` / `{artist:}` / `{capo:}` / `{key:}` / `{section:}` / `{comment:}` / `{start_of_*}` / `{end_of_*}`。
  - Markdown 标题 `#` / `##` 作为段落标题。
  - `【段落】` 作为段落标题。
  - 行内和弦 `[C]` / `[G]` 保留括号原位，只做颜色区分，不重排歌词。
  - 纯和弦行、空行、正文行分别渲染。
- 阅读页：
  - `container` 内渲染 `.text-sheet`，最大宽度约 900px，等宽字体，`white-space: pre-wrap`。
  - 当前阅读行按视口中心高亮；滚动时节流更新，不逐帧重排。
  - 缩放改为字号缩放，不做横向放大。
  - 阅读进度按“第 1 页 + 滚动比例”保存；恢复时回到相同比例。
  - 文本谱隐藏“拆分”和“书签”；保留返回、打卡、存进度、迷你节拍器、缩放 / 全屏。
- 导入入口：
  - `inputSingleFile` / `inputMobileFile` / 文件夹导入接受文本扩展名。
  - 文本 Blob 原样入库，不做转码；UTF-8 读取，异常编码按原字节显示替换字符。

### 3.3 禅定锁屏

- 缩放控件新增锁按钮 `🔒`；阅读页可用。
- 锁定后：
  - 全屏遮罩覆盖谱面、工具栏、翻页热区、迷你节拍器与缩放控件。
  - 遮罩显示“禅定模式”和“长按 3 秒解锁”，带 3 秒进度条。
  - 长按必须连续 3 秒；松手 / 移出 / 取消即重置。
  - 锁定期间返回键被层级栈吞掉，不关闭阅读页、不退出应用。
- 关闭阅读页、切换 Tab、退出全屏不自动解锁，但关闭阅读页必须强制解锁并注销层级。
- 锁定不停止已播放的迷你节拍器，不释放屏幕常亮。

### 3.4 桌面键盘

仅在阅读页且没有弹窗 / 输入框聚焦时生效：

| 按键 | 行为 |
| --- | --- |
| `PageUp` / `PageDown` | 上 / 下一屏 |
| `↑` / `↓` | 上 / 下滚 80px |
| `Home` / `End` | 到顶 / 到底 |
| `+` / `=` / `-` | 缩放 |
| `F` | 全屏切换 |
| `L` | 禅定锁定切换 |
| `Space` | 播放 / 暂停迷你节拍器 |
| `Esc` | 先退出全屏；已非全屏时关闭阅读页 |

- 输入框、文本域、`contenteditable` 聚焦时不拦截。
- 弹窗、拆分选择器、书签面板、记录弹窗打开时不拦截。
- 锁定状态下键盘不提供解锁绕过；必须完成长按手势。

## 4. 验收

### 4.1 静态检查

- `npm run check` 通过，版本为 `0.1.12`，JS 文件数与 SW 缓存清单一致。

### 4.2 浏览器回归

新增 `tests/browser/gs_022.py`，至少覆盖：

- 导入 `.txt` / `.md` / `.chordpro`：书架出现 3 张卡，格式分别为 `TXT` / `MD` / `CHO`。
- 打开文本谱：标题、段落、行内和弦可见；滚动后当前行高亮切换；关闭再打开恢复到相同滚动比例。
- 导入 PDF：书架卡出现封面 `<img>`，封面不是空白；`pageCount` 正确。
- 点击锁按钮：遮罩出现；短按 1 秒不解锁；长按 3 秒解锁；返回键在锁定时不关闭阅读页。
- 键盘：`PageDown` 滚动、`+` 放大、`F` 全屏、`L` 锁定、`Space` 播放/暂停、`Esc` 退出全屏。
- 320 / 360 宽无横向溢出；深浅主题下文本谱与锁屏可读。

### 4.3 真机

- release APK 覆盖安装，书架 6 张谱 / 10 条练习保留。
- 真机导入 1 个 TXT、1 个 Markdown、1 个 ChordPro，打开、滚动、缩放、保存进度、重开恢复。
- 真机 PDF 卡显示首页封面；老 PDF 首次进入书架自动补封面。
- 真机锁屏：短按无效、长按 3 秒解锁、锁定期间返回键不退出。
- 有实体键盘时抽查 `PageDown` / `Space` / `F`；无键盘则记录为未覆盖，不阻塞发布。
- 阅读页与书架在 320 / 360 宽、深色 / 浅色下无溢出。

### 4.4 验收结果（2026-11-24）

- `npm run check`：`v0.1.12，32 个 JS 文件，SW 缓存与版本一致`。
- `gs_022.py`：320 / 360 均通过；文本三格式、滚动 58% 恢复、PDF 封面 320×427、锁屏、键盘、DB v4 全部命中。
- `gs_015` / `gs_016` / `gs_018` / `gs_019` / `gs_020` / `gs_021` 全量复跑通过；旧脚本固定 IndexedDB 版本 3 已改为按当前版本打开，兼容 DB v4。
- release APK：`4,428,186` 字节，SHA-256 `9339ED821C605020E36A968CFE8EA8C8E0E68DBC91D70B97989D29F74E33CBEB`；`versionCode 114` / `versionName 0.1.12`，v1 / v2 签名与证书指纹不变。
- 真机 `ca14b16`：覆盖安装后 6 张谱 / 10 条练习保留，老 PDF 卡自动补封面；真机导入 TXT / MD / CHO 成功，TXT 与 CHO 打开后标题、段落、行内和弦渲染正确；锁屏短按 1 秒无效、长按 3.4 秒解锁、遮罩与返回键拦截正常。
- Android 文件选择器把 `.cho` 识别为 BIN，已给 `inputSingleFile` / `inputMobileFile` 增加 `application/octet-stream`；真机复查 `.cho` 从灰显变为可选，导入后格式为 `CHO`。
- 测试谱与临时文件已从真机删除，最终书架恢复 6 张。
- GitHub Release：`https://github.com/moanet/GuitarShell/releases/tag/v0.1.12`，标题 `v0.1.12`，公开、非草稿、非预发布；Release ID `456339351`，APK asset ID `785820396`，远端下载 SHA-256 复核一致。

## 5. 发布

- 版本同步：`package.json`、`package-lock.json`、`js/services/version.js`、`sw.js`、`android/app/build.gradle`、README 徽标。
- 构建 release APK 并校验包名、`versionCode 114`、`versionName 0.1.12`、v1/v2 签名、SHA-256。
- 更新 `CHANGELOG.md` 与 `TASK.md`；提交并推送 `main`；已创建 `v0.1.12` Release 并上传 APK。

## 6. 边界

- 不做 PDF / 图片 OMR，不做自动识谱。
- 不做页段 / 行段循环，不做自动滚屏，不做节拍器联动滚动。
- 不做文本谱的手动行锚点、书签、目录、搜索。
- 不做蓝牙键盘 / 踏板映射，不做长按快进。
- 不改云同步协议；封面资产不进云备份。
- 不引入 `@capacitor/share`，分享卡片留给 `0.1.13`。
