# CURRENT TASK — 0.1.9 原生相册导入

> 状态：开发完成，真机验收通过，已推送 `main`；按用户要求未创建 tag / GitHub Release
> 更新时间：2026-11-23
> 版本基线：线上 Release 为 `0.1.6`；`0.1.7` / `0.1.8` 已提交 `main`，未发布 Release
> 关联：[TASK.md](TASK.md)（项目总账） / [CHANGELOG.md](CHANGELOG.md)（发布历史）

本文件只记录当前版本的“做什么、怎么做、怎么验收”。发布后把结果压缩进 `CHANGELOG.md`，再重写本文件进入下一版。

0.1.8 的完整记录已归档到 [docs/archive/CURRENT_TASK-0.1.8.md](docs/archive/CURRENT_TASK-0.1.8.md)。

## 1. 目标

0.1.9 只做一件事：**把 Android 手机“从相册选择”从 WebView 文件选择器改为系统照片选择器**，一次最多 20 张，选中的图片复制到应用缓存，再由 JS 用 `Capacitor.convertFileSrc` 取回 Blob 复用现有导入链路。

必须解决：

1. 点“从相册选择”不再落到文件管理 / 文档选择器。
2. Android 13+ 使用系统 Photo Picker；Android 12 及以下回退到 `ACTION_OPEN_DOCUMENT` / `ACTION_GET_CONTENT`。
3. 一次最多 20 张；不请求存储权限。
4. 原生只返回缓存文件路径与元信息，不返回 base64。
5. 导入仍复用 `handleFiles`，内容哈希、重复检测、标签、书架刷新行为不变。
6. 网页 / PWA 无原生插件时回退现有 `<input type=file>`，并同样限制相册一次最多 20 张。

不包含：

- 相机拍照改造。
- PDF 文件选择改造。
- 图片裁剪、压缩、旋转、批量编辑。
- 相册权限长期持有或后台访问。
- 0.1.8 已完成的阅读工具栏、双指缩放、返回层级改动。

## 2. 方案

### 2.1 原生 `GalleryPickerPlugin`

新增 `android/app/src/main/java/com/guitarshell/GalleryPickerPlugin.java`，`@CapacitorPlugin(name = "GalleryPicker")`，在 `MainActivity.onCreate()` 注册。

对外方法：

```ts
GalleryPicker.pickImages({ limit?: number })
→ { files: Array<{ path: string, name: string, mimeType: string, size: number }>, failed: number }
```

规则：

- `limit` 夹在 `1..20`，默认 20。
- Android 13+（API 33）：
  - `Intent(MediaStore.ACTION_PICK_IMAGES)`，`type = "image/*"`。
  - `putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, limit)`。
  - 若系统没有可处理 Activity，回退 `ACTION_OPEN_DOCUMENT`。
- Android 12 及以下：
  - `ACTION_OPEN_DOCUMENT`，`type = "image/*"`，`EXTRA_ALLOW_MULTIPLE = true`，`CATEGORY_OPENABLE`。
  - 若不可用，回退 `ACTION_GET_CONTENT`。
- 不新增运行时权限；Photo Picker / SAF 自带读取授权。
- 结果支持 `ClipData` 多选与单 URI；最多处理 `limit` 个。
- 取消选择：`call.reject('已取消选择', 'PICK_CANCELLED')`；JS 不弹错误提示。
- 没有可处理 Activity：`call.reject('系统相册不可用', 'PICK_UNAVAILABLE')`。

### 2.2 缓存文件

- 复制到 `context.getCacheDir()/gallery-picker/`。
- 每个文件用 `ContentResolver.openInputStream(uri)` 流式复制，不整文件读进内存。
- 文件名：
  - 优先 `OpenableColumns.DISPLAY_NAME`，去掉路径分隔符与控制字符，限制长度。
  - 扩展名优先原文件名；缺失时按 MIME 用 `MimeTypeMap` 补 `jpg/png/webp/...`。
  - 加短 UUID 前缀/后缀避免重名。
- 返回 `path` 为缓存文件绝对路径，`name` 为可读文件名，`mimeType` 为 `ContentResolver.getType(uri)`，`size` 为复制后字节数。
- 单个文件复制失败：删除半成品，继续处理其余；全部失败则 reject `PICK_COPY_FAILED`。
- 每次开始选择前清理该目录下超过 24 小时的文件，避免缓存无限增长。

### 2.3 JS 服务 `js/services/gallery-picker.js`

- `isNativeGalleryAvailable()`：检查 `window.Capacitor.isNativePlatform()` 与 `window.Capacitor.Plugins.GalleryPicker`。
- `pickGalleryImages({ limit = 20 } = {})`：
  1. 调 `GalleryPicker.pickImages({ limit })`。
  2. 对每个 `path` 执行 `Capacitor.convertFileSrc(path)`。
  3. `fetch(url)` → `blob()`。
  4. 组装 `File([blob], info.name, { type: info.mimeType || blob.type })`。
  5. 最多返回 20 个；单个 fetch 失败跳过并计入失败数；全部失败抛 `GALLERY_FETCH_FAILED`。
- 不把 base64 写进插件返回值，也不在 JS 里做 base64 转换。
- 如果 `convertFileSrc` 或 `fetch` 不可用，抛出 `GALLERY_UNAVAILABLE`，由调用方回退 input。

### 2.4 阅读页动作面板接入

- `sheet-reader.js` 的“从相册选择”从 `<label for="inputGallery">` 改为真实按钮 `#btnGallery`。
- 点击：
  - 原生可用：先 `closeActionSheet()`，再 `pickGalleryImages({ limit: 20 })`，得到 File 后直接 `handleFiles(files)`。
  - 原生不可用：先 `closeActionSheet()`，再触发隐藏的 `inputGallery.click()`，沿用 Web 文件选择。
- 取消：
  - 原生 `PICK_CANCELLED` 静默返回，不显示 toast。
  - Web input 取消不产生文件，不导入。
- 导入中仍显示现有 `loading` 遮罩与“正在导入 N 个文件...”。
- `handleFiles` 的内容哈希、重复检测、失败计数、书架刷新不改。
- 相册一次超过 20 张：
  - 原生选择器本身限制 20。
  - Web input 若仍返回超过 20，截取前 20 并提示“一次最多选择 20 张，已取前 20 张”。

### 2.5 版本与测试

- `package.json`、`package-lock.json`、`sw.js`、`js/services/version.js`、`android/app/build.gradle` 同步为 `0.1.9` / `versionCode 109`。
- `sw.js` 缓存清单加入 `./js/services/gallery-picker.js`。
- 新增 `tests/browser/gs_019.py`：
  - 在 Web 模式下打开移动端导入面板，点“从相册选择”走 input 回退。
  - 伪造 21 个图片 File，验证只导入前 20 个。
  - 验证取消不导入、动作面板关闭、书架数量不变。
  - 用 mock `GalleryPicker` + mock `convertFileSrc` 验证 JS 服务把路径转成 File、不产生 base64。
- 真机验收以 Android 13 设备 `ca14b16` 为准。

## 3. 改动范围

- 新增 `android/app/src/main/java/com/guitarshell/GalleryPickerPlugin.java`。
- `android/app/src/main/java/com/guitarshell/MainActivity.java`：注册 `GalleryPickerPlugin`。
- 新增 `js/services/gallery-picker.js`。
- `js/components/sheet-reader.js`：动作面板按钮、原生 / Web 分支、20 张限制。
- `sw.js`：缓存清单与版本。
- 版本文件 5 处：`package.json`、`package-lock.json`、`sw.js`、`js/services/version.js`、`android/app/build.gradle`。
- 新增 `tests/browser/gs_019.py`；更新 `tests/browser/README.md`。
- 更新 `CHANGELOG.md`、`TASK.md`、`README.md`、`CURRENT_TASK.md`。

## 4. 验收标准

### 4.1 原生选择器

- [ ] Android 13 真机点“从相册选择”，打开系统照片选择器，不再进入文件管理。
- [ ] 可选 1 张、5 张、20 张，返回后书架出现对应数量卡片。
- [ ] 选满 20 张时无法再选第 21 张。
- [ ] 取消选择不新增卡片、不弹错误 toast。
- [ ] 不弹存储权限申请。

### 4.2 文件与导入

- [ ] 返回的是缓存文件路径，不是 base64；JS 用 `convertFileSrc` 成功取到 Blob。
- [ ] 文件名、扩展名、MIME 正确；图片可在阅读页打开。
- [ ] 内容相同的图片仍被识别为重复并跳过。
- [ ] 部分文件复制 / fetch 失败时，其余图片仍能导入，并提示失败数量。
- [ ] 导入完成后书架数量、标签、排序与既有逻辑一致。

### 4.3 Web 回退与边界

- [ ] 浏览器 / PWA 无插件时，“从相册选择”仍打开文件选择器。
- [ ] Web 一次选超过 20 张时只导入前 20 张，并提示。
- [ ] 动作面板外点 / 返回键行为不回归 0.1.8。
- [ ] 20 张大图导入时 loading 不消失、无白屏、无内存崩溃。

### 4.4 工程检查

- [ ] `npm run check` 通过。
- [ ] `python -m compileall -q tests/browser` 通过。
- [ ] `gs_019.py` 通过。
- [ ] `gs_015.py` / `gs_016.py` / `gs_018.py` 无回归。
- [ ] release APK 构建通过，`versionCode 109` / `versionName 0.1.9`，签名与 SHA-256 核对。
- [ ] APK 覆盖安装到 `ca14b16`，书架徽标显示 `v0.1.9`。
- [ ] 真机验收通过后提交 `main`；tag / Release 等用户确认。

## 5. 风险与边界

- 部分 OEM 的 `ACTION_PICK_IMAGES` 可能不可用，必须有 `ACTION_OPEN_DOCUMENT` 回退。
- 20 张大图同时 fetch 可能占用较多内存；JS 串行读取、逐个交给 `handleFiles`，避免一次性并发 20 个 Blob。
- 缓存目录由系统可能随时清理；导入必须在选择返回后立即读取。
- `convertFileSrc` 依赖 Capacitor 本地文件服务；网页端没有该通道，只能走 input 回退。
- 不改变现有图片格式支持范围；HEIC 等格式仍取决于 WebView 能否解码。
- Android 12 以下的 SAF 选择器 UI 与 Photo Picker 不同，但返回结果与导入链路一致。

## 6. 实施结果（2026-11-23）

### 6.1 代码

- 新增 `GalleryPickerPlugin.java`，已注册到 `MainActivity`；支持 Android 13+ Photo Picker、`ACTION_OPEN_DOCUMENT` / `ACTION_GET_CONTENT` 回退、`ClipData` 多选、后台流式复制、24 小时缓存清理、纯数字显示名替换为 `照片-yyyyMMdd-HHmmss-*`。
- 新增 `js/services/gallery-picker.js`；动作面板改为按钮，原生路径 `convertFileSrc` + `fetch` → `File`，Web 回退 input；20 张截断与取消静默处理已接入。
- 版本同步为 `0.1.9` / `versionCode 109`，`sw.js` 缓存加入 `gallery-picker.js`。

### 6.2 浏览器验收

- `npm run check`：通过，`v0.1.9 / 29 个 JS`。
- `python -m compileall -q tests/browser`：通过。
- `gs_019.py` 320 / 360：通过。Web 回退 input 1 次；21 张截断到 20 且 toast 提示；原生取消不增卡；mock 原生两路径导入 2 张；服务层返回 `File`、MIME / size 正确、无 base64、失败计数 2。
- `gs_015.py` / `gs_016.py` / `gs_018.py` 320 / 360：全部通过，无回归。

### 6.3 真机验收（`ca14b16`，Android 13）

- 点“从相册选择”打开 `PhotoPickerActivity`，不再进入文件管理。
- 单张导入成功，书架出现图片卡；5 张多选显示 `Add (5)`。
- 选满 20 张后点第 21 张提示 `Select up to 20 items`，Add 保持 20。
- 取消选择不新增卡片、不弹错误 toast。
- 全程无存储权限弹窗。
- 测试卡、临时测试图与截图均已从设备清理，原有 6 张乐谱保留。

### 6.4 APK

- `dist/GuitarShell-0.1.9-release.apk`，`4,370,166` 字节。
- SHA-256 `BE9692312CBC5E0811DD14D73C04A2F2857659F966A088633BCD4E22818588C9`。
- `versionCode 109` / `versionName 0.1.9`，包名 `com.guitarshell`，`minSdk 22` / `targetSdk 34`。
- v1 / v2 签名通过，证书 SHA-256 `CA6D27B23E55E5009B6E27C3918ED08C87CE4ED2AEC7FFF65E3C2F461715AC4E`。
- 覆盖安装到 `ca14b16`，书架徽标与系统版本均为 `0.1.9`。
