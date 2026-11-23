# CURRENT TASK — 0.1.7 同步退出保护与拆分页预览

> 状态：真机验收通过，已提交 main；按用户要求不发布 Release
> 更新时间：2026-11-23
> 版本基线：线上 Release 为 0.1.6；0.1.7 尚未发布
> 关联：[TASK.md](TASK.md)（项目总账） / [CHANGELOG.md](CHANGELOG.md)（发布历史）

本文件只记录当前版本的“做什么、怎么做、怎么验收”。发布后把结果压缩进 `CHANGELOG.md`，再重写本文件进入下一版。

0.1.6 的完整记录已归档到 [docs/archive/CURRENT_TASK-0.1.6.md](docs/archive/CURRENT_TASK-0.1.6.md)。

## 1. 目标

0.1.7 只做两件收口事项，不铺新模块：

1. **云同步进行中退出保护**：上传或下载仍在进行时，按 Android 返回键或关闭网页先确认，避免误关应用中断上传、留下不完整云端备份。
2. **拆分页预览**：拆分建卡弹窗增加起止页缩略图、轻量页码选择器，并在起止页顺序错误时自动纠正，降低“盲输页码”的出错率。

## 2. 方案

### 2.1 云同步退出保护

云同步任务状态从读谱组件上提到应用外壳：

- `sheet-reader.js` 在开始、失败、取消、完成、关闭失败提示时发布 `gs-cloud-task`，detail 为 `{ busy, text }`。
- `js/main.js` 维护应用级 `cloudTask` 状态；状态变化时同步给原生 `BackGuard.setBusy({ busy })`。
- 网页端监听 `beforeunload`：同步忙碌时 `preventDefault()` 并设置 `returnValue`，由浏览器弹出离开确认。
- Android 返回键由 `BackGuardPlugin` 拦截：busy 时向 WebView 派发 `gs-cloud-exit-request`，不直接退出；空闲时走原有返回逻辑。
- 应用内确认弹窗：
  - 标题「云同步仍在进行」
  - 正文说明“现在退出可能中断上传，云端备份可能不完整”
  - 当前任务作为详情展示
  - 取消「继续同步」，确认「取消同步并退出」，危险样式
- 确认退出后先派发 `gs-cloud-cancel-request`，等同步进入空闲再 `exitApplication()`；1200ms 内未完成也兜底退出。
- `exitApplication()` 优先调用 `BackGuard.exitApp()`，网页环境回退 `window.close()`。
- 组件卸载时移除 `gs-cloud-cancel-request` 监听，避免重复绑定。

### 2.2 拆分页预览与自动纠正

复用拆分弹窗已加载的 `this.pdfDoc` 与 pdf.js，不新增依赖：

- 起止页输入行下方新增两张缩略图卡片，分别显示起始页、结束页与 `Pn` 标签。
- 缩略图按卡片宽度约 160px 的低分辨率渲染；渲染完成调用 `page.cleanup()`，释放页面资源。
- 缩略图渲染防抖 140ms；串行渲染起始页、结束页，使用 token 防止旧任务覆盖新结果。
- 点任一缩略图打开轻量页码选择器：
  - 标题「选择起始页 / 选择结束页」
  - 顶部按钮「使用当前阅读页 Pn」
  - 5 列数字网格，标出当前值，滚动到选中项
  - 点页码后写回输入框，并按规则自动纠正另一端
- 起止页顺序自动纠正：
  - 改起始页后若 `start > end`，把结束页抬到 `start`
  - 改结束页后若 `end < start`，把起始页压到 `end`
- 非法页码（非整数、越界）仍保留原校验：禁用“建卡”并显示具体错误。
- 保留原名称规则、标签继承、成功后刷新书架与提示。

## 3. 改动范围

- `js/components/sheet-reader.js`：
  - 拆分预览样式、缩略图卡片、页码选择器
  - `splitCurrentPage` / `splitPageValid` / `normalizeSplitRange`
  - `renderSplitThumb` / `renderSplitPreview` / `scheduleSplitPreview` / `clearSplitPreview`
  - `openSplitPicker` / `applySplitPage` / `closeSplitPicker`
  - `publishCloudTaskState` / `requestCloudCancel` / 卸载清理
- `js/main.js`：
  - 应用级 `cloudTask` 状态、`beforeunload`
  - `gs-cloud-exit-request` 确认弹窗、取消后等待、兜底退出
  - 原生 `BackGuard` 状态同步与 `exitApplication`
- `android/app/src/main/java/com/guitarshell/BackGuardPlugin.java`：新增 Capacitor 插件。
- `android/app/src/main/java/com/guitarshell/MainActivity.java`：注册插件、重写 `onBackPressed()`。
- `tests/browser/gs_015.py`：新增同步中退出确认用例。
- `tests/browser/gs_016.py`：新增缩略图、页码选择、自动纠正断言；原 0.1.6 流程保留。
- 版本号同步为 `0.1.7`，`versionCode 107`。

## 4. 验收标准

### 4.1 云同步退出保护

- [x] 同步进行中派发 `gs-cloud-exit-request`，弹出「云同步仍在进行」。
- [x] 正文包含“可能中断上传”，详情显示当前任务，按钮为「继续同步」/「取消同步并退出」。
- [x] 点「继续同步」后弹窗关闭，同步任务仍在运行。
- [x] Android 返回键在同步中先弹确认，不直接退出。
- [x] 确认「取消同步并退出」后取消任务并退出应用。
- [x] 同步空闲时返回键行为与 0.1.6 一致。
- [ ] 网页关闭 / 刷新在同步中触发浏览器离开确认（未单独实测）。

### 4.2 拆分页预览

- [x] 打开拆分弹窗显示起止页两张缩略图，页码标签正确。
- [x] 缩略图渲染成功，加载态隐藏，卡片在视口内。
- [x] 点缩略图打开页码选择器，标题、当前阅读页按钮、页码数量与选中值正确。
- [x] 页码网格无横向溢出，点取消可关闭。
- [x] 选起始页 3 自动得到 `3–3`；选结束页 1 自动得到 `1–1`。
- [x] 反向输入 `3 → 2` 自动纠正为 `2–2`，不再报错禁用。
- [x] 非法页码 0、超出总页数仍禁用建卡并显示错误。
- [x] 原拆分建卡、标签继承、重开、书签、进度、再次拆分、图片卡、损坏 PDF 流程不回归。
- [x] 320 / 360 宽弹窗无横向溢出，按钮可见可点。

### 4.3 工程检查

- [x] `npm run check` 通过。
- [x] `python -m compileall -q tests/browser` 通过。
- [x] `python tests/browser/gs_015.py` 通过。
- [x] `python tests/browser/gs_016.py` 通过；`GS_WIDTH=360` 同样通过。
- [x] release APK 构建通过，包名、版本、签名、SHA-256 校验通过。
- [x] APK 已覆盖安装到测试设备，版本显示 `0.1.7`。
- [x] 真机验收通过。
- [ ] 提交、推送、tag 与 GitHub Release 完成。

## 5. 风险与边界

- Android Home / 上滑杀进程无法被应用可靠阻止；退出确认只覆盖返回键与网页关闭路径。
- 当前上传是 WebDAV `PUT` 覆盖云端备份；进程被强杀仍可能留下不完整远端文件。退出确认只能降低概率，不能完全保证。
- 更稳的“临时文件 + MOVE”上传方案不在本版范围。
- 确认退出后若取消请求超过 1200ms，会兜底退出；极端情况下仍可能中断远端写入。
- `beforeunload` 在移动 WebView 的实际表现需真机确认；壳内主要依赖返回键拦截。
- 页码选择器是数字网格，不是全页面缩略图网格；全页面预览与按目录自动识别曲目不在本版范围。
- 缩略图只渲染起止两页，超大页数 PDF 的首次渲染耗时与内存需在真机观察。
- 拆分只复制页面内容，不保留原 PDF 的书签、表单、附件等文档级结构。

## 6. 发布前检查

- [x] 两项功能代码完成。
- [x] 浏览器 320 / 360 验收通过。
- [x] `npm run check` 与测试脚本编译通过。
- [x] 版本号同步为 `0.1.7`。
- [x] CHANGELOG / TASK / README 已更新。
- [x] 构建 release APK，复核包名、版本、签名与 SHA-256。
- [x] APK 已安装到测试设备，待真机操作验收。
- [x] 真机验收通过。
- [x] 已提交 `main`；按用户要求不创建 tag、不发布 GitHub Release。
