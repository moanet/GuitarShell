# CURRENT TASK — 0.1.11b 双主题 UI 联动与顶部导航分割线

> 状态：已完成并发布 `v0.1.11b`
> 更新时间：2026-11-23
> 版本基线：线上 Release 为 `0.1.11b`；本次只做 UI 统一，不新增功能、不改存档与同步逻辑。
> 关联：[TASK.md](TASK.md)（项目总账） / [CHANGELOG.md](CHANGELOG.md)（发布历史）

0.1.11 的完整记录已归档到 [docs/archive/CURRENT_TASK-0.1.11.md](docs/archive/CURRENT_TASK-0.1.11.md)。

## 1. 目标

用户完成了一套日间模式启动动画，要求界面整体统一、品牌图标一起联动，并把顶部四大页面标签下的重阴影收成与全局设置标题栏一致的浅细分割线。

1. 启动动画支持 `deep` / `light` 两套主题，冷启动跟随当前主题；
2. 页头品牌图标、全局设置「关于」图标、浏览器 favicon 随主题切换；
3. 顶部导航去掉浮起的渐变与投影，只保留 `1px var(--line)` 分割线；
4. 选中标签去掉外投影，避免看起来悬在页面之上；
5. README「下载与安装」只保留最新 Release 的下载安装信息。

`0.1.11a` 仅作为本地真机试用标记，不单独发布；正式版本号为 `0.1.11b` / `versionCode 113`。

## 2. 改动

### 2.1 启动动画

- `android/app/src/main/assets/splash.html` 合并为单文件双主题版本，URL hash `#deep` / `#light` 选择主题。
- 页面在 head 最前面读取 hash 并落 `html[data-theme]`，避免先闪错色。
- 日间中心同心圆对齐 `icon-gShell-flat-light.svg`：外黑环 `r25.2 / stroke 9.6`、棕环 `r15.5 / 4.6`、黑实心核 `r13.2`。
- 深色保留原生产版中心结构；几何、随机起点、10 秒一圈、16 段拖尾、80° 实体段、0.45 不透明度与三点闪烁均未改。
- 保留 `prefers-reduced-motion` 对呼吸环和三点闪烁的降级。

### 2.2 原生冷启动主题

- `MainActivity` 新增 `PREFS_NAME = "gs_native"` / `KEY_THEME = "gs_theme"`。
- `onCreate` 先读原生主题，应用系统栏后再加载对应启动层；深色背景 `rgb(14,16,19)`，浅色 `rgb(243,237,227)`。
- `ThemeBarsPlugin.setTheme()` 在应用系统栏前先写入原生偏好，保证下次冷启动跟随。
- 既有用户升级后第一次冷启动可能回退深色一次，Web 层初始化后会写入当前主题，后续正常。

### 2.3 图标与 favicon 联动

- `js/services/theme.js` 新增 `FAVICON_PATHS` 与 `syncThemeImages(root = document)`。
- `paintBrowserChrome()` 同时更新 `meta[theme-color]` 与所有 `link[data-theme-favicon]`。
- `index.html` 页头品牌图标与两个 favicon 加主题属性；`js/components/settings.js` 的「关于」图标同步，Shadow DOM 内也调用 `syncThemeImages(this.shadowRoot)`。
- 新增浅色图标 `icon-gShell-light-32.png` / `-192.png` / `-512.png`，接入 `scripts/build-www.mjs` 与 `sw.js` 缓存清单。

### 2.4 顶部导航分割线

- `.app-header` 去掉 `linear-gradient` 背景、`box-shadow: 0 8px 28px ...` 与 `backdrop-filter`。
- 改为 `background: transparent` + `border-bottom: 1px solid var(--line)`，与全局设置 `.head` 的分割线一致。
- `.tab-btn.active` 去掉 `0 4px 14px` 外投影，只保留 `inset 0 1px 0` 内高光，四个标签与下方内容连成同一平面。

## 3. 验收

- `npm run check`：`检查通过：v0.1.11b，29 个 JS 文件，SW 缓存与版本一致`。
- Edge 360 宽双主题截图：日间与深色顶部均只保留 1px 分割线，选中标签无外投影；全局设置标题栏风格一致。
- release APK `4,417,334` 字节，SHA-256 `E858F6ED95CB8BBB6DCC3C1C4001B8FF4E8E06E21E3C8E33CC23B8B0E4DEDDA7`。
- 包名 `com.guitarshell`，`versionCode 113` / `versionName 0.1.11b`，`minSdk 22` / `targetSdk 34`，v1 / v2 签名通过，证书 SHA-256 `CA6D27B23E55E5009B6E27C3918ED08C87CE4ED2AEC7FFF65E3C2F461715AC4E`。
- 真机 `ca14b16` 覆盖安装成功；书架 6 张乐谱与练习数据保留，书架徽标 `0.1.11b`。
- 日间模式冷启动：浅色启动动画、浅色状态栏正常。

## 4. 发布

- 代码与文档提交并推送 `main`。
- GitHub Pages 随 `main` 部署网页版。
- 创建 tag `v0.1.11b` 并发布 GitHub Release，上传 `GuitarShell-0.1.11b-release.apk`。

## 5. 边界

- Android 桌面启动图标保持静态，不随 App 内手动主题动态切换；`activity-alias` 方案可能重置桌面快捷方式，本轮不做。
- Android 12+ 系统启动窗口背景仍是固定深色 `#0E1013`，日间模式冷启动可能先出现极短深色系统层，再进入浅色 WebView 启动动画。
- 本轮不改功能、存档、同步、权限与原生插件逻辑。
