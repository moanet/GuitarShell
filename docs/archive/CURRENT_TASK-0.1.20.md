# CURRENT_TASK — 0.1.20 调音设置打开闪现修复

> 状态：已发布（GitHub Release `v0.1.20`）。
> 版本：`0.1.20` / `versionCode 126`；构建日期 2026-11-27。
> 范围：只修复调音设置打开时主界面“开始调音”按钮上移闪动；不改调音算法、调弦数据、设置内容与面板视觉。

## 1. 问题

- 真机点“调音设置”后，约半秒内主界面“开始调音”按钮从原位向上顶、随后被弹层盖住，闪动非常明显。
- 根因：`openSettings()` 在 `requestAnimationFrame` 里给弹层加 `show` 后立即 `closeSettings` 聚焦。此时弹层仍在 `translateY(100%)` 入场早期，聚焦离屏按钮触发 WebView 视口滚动补偿，把主界面一起上推；动画结束后视口复位，形成闪现。

## 2. 修复

- 关闭按钮聚焦改为 `focus({ preventScroll: true })`，旧环境回退普通 `focus()`，保留键盘可访问性。
- 不改弹层布局、动画时长、遮罩外点与返回键层级；不调整调音器 UI。
- 调音器与“调音设置”的整体视觉打磨另记 backlog，本版不处理。

## 3. 验收

- 逐帧对比：修复前打开瞬间主界面整体上移约 750px，“开始调音”按钮出现后消失；修复后按钮保持原位，只有弹层按原动画向上滑入并覆盖。
- 浏览器 `gs_026.py`：360 深色、320 深色、360 浅色均通过；版本断言 `v0.1.20`，运行期无异常。
- 静态检查：`npm run check` 通过，`v0.1.20，40 个 JS 文件`；`tuner.js` ES module 语法复核通过。
- 真机 Android 13 `ca14b16`：覆盖安装后显示 `v0.1.20`；反复开关“调音设置”无上移闪动；返回键只关面板、停留调音器；A4 440、标准调弦、自动选弦保持。
- logcat 未出现 `FATAL EXCEPTION` / `beginning of crash` / `Uncaught TypeError`。

## 4. 构建

- APK：`dist/GuitarShell-0.1.20-release.apk`，`4,510,404` 字节，SHA-256 `74BC76BE1E1394195A5D8D15645E041646CC382D62F9FF674F6991B1DCC70E56`。
- `aapt` 版本 `versionCode 126` / `versionName 0.1.20`；签名证书 SHA-256 与 0.1.19 一致。

## 5. 范围外

- 调音器主界面与“调音设置”弹层的视觉打磨：五段比例、状态条 / 弦位行密度、分组节奏与底部安全区，已记入 `TASK.md` backlog，待专项版本处理。
- 本版不触碰调音检测、预设 / 自定义调弦、A4、试听与反馈逻辑。

## 6. 风险

- 个别旧 WebView 若不支持 `preventScroll`，会走普通 `focus()` 回退；当前验证基线 Android 13 正常。
- 本次只按真机逐帧 + 浏览器回归验证闪现，不额外扩大 UI 改动面。

## 7. 发布

- 代码提交：`7459b62`（`fix(tuner): 修复调音设置打开时主界面上移闪现`）。
- tag：`v0.1.20`。
- GitHub Release：ID `459714769`，<https://github.com/moanet/GuitarShell/releases/tag/v0.1.20>。
- APK asset：ID `796953683`，`GuitarShell-0.1.20-release.apk`，`4,510,404` 字节，digest `sha256:74bc76be1e1394195a5d8d15645e041646cc382d62f9ff674f6991b1dcc70e56`，与本地产物一致。
- 发布后官方最新版为 `v0.1.20`；调音器与调音设置视觉打磨转入 backlog / 下一版专项讨论。
