# CURRENT_TASK — 0.1.28 全站回归与测试包

> 状态：U1–U5 已完成；全站浏览器回归通过；待同步版本号、构建 `0.1.28` 测试包并交用户真机测试。
> 开发分支：`dev`；稳定分支：`main`；基线：`0.1.27` / `versionCode 137`。
> 前序：U5 全局外壳已完成，任务书归档到 [docs/archive/CURRENT_TASK-0.1.28-ui-u5-shell.md](docs/archive/CURRENT_TASK-0.1.28-ui-u5-shell.md)。
> 规范契约：[docs/UI_DESIGN_SPEC.md](docs/UI_DESIGN_SPEC.md) `v1.1`；版本规则：[docs/VERSIONING.md](docs/VERSIONING.md)。

## 1. 目标

把 U1–U5 的 UI 统一结果收成一个可安装、可回滚的 `0.1.28` 测试包：同步版本号与 CHANGELOG，构建 APK，装入真机并明确交还用户测试。**发布 Release 必须等用户测试通过。**

## 2. 非目标

- 不创建 tag、不创建 GitHub Release、不推 `main`。
- 不在用户测试通过前把 `0.1.28` 当作稳定快照。
- 不新增 UI 改动；只处理回归中发现并确认的缺陷。
- 不改 U1–U5 已锁定的交互与验收口径。

## 3. 范围与涉及文件

| 文件 | 用途 |
|---|---|
| `package.json` / `package-lock.json` | 版本号 `0.1.28` |
| `js/services/version.js` | `APP_VERSION = '0.1.28'` |
| `sw.js` | `APP_VERSION = '0.1.28'`，缓存名派生同步 |
| `android/app/build.gradle` | `versionName 0.1.28` / `versionCode 138` |
| `README.md` | 版本徽标同步 |
| `CHANGELOG.md` | `[Unreleased]` 切到 `## [0.1.28] — 2026-11-28`，顶部新开空段 |
| `dist/GuitarShell-0.1.28.apk` | 测试包；不入库 |

## 4. 验收标准

- 全站静态检查 `npm run check` 通过；`python -m compileall -q tests/browser` 通过。
- `gs_015`–`gs_030` 全部通过；U1–U5 的 360/320、深/浅组合通过。
- 版本四处核心字段 + `package-lock.json` + README 徽标一致：`0.1.28` / `138`。
- `npm run apk:release` 从干净提交构建成功，APK 存在且可安装。
- 真机 `ca14b16` 安装后启动正常，停在书架页；测试前明确告知开始，测试后明确交还设备。
- 用户测试通过后，才允许创建 `v0.1.28` tag 与 GitHub Release。

## 5. 测试包检查清单

- 全局：头部两行总高约 91，Tab 16 / 可见 37、四个 Tab 可点且 44 热区；版本胶囊显示 `v0.1.28`；设置按钮可打开右侧抽屉。
- 设置抽屉：外观、数据与备份、云同步、存储与缓存、关于五张卡顺序正常；关闭 44 热区；深/浅主题切换正常。
- U1 调音器：弦位 44、主按钮 140×46、设置面板可开合、A4 状态正常。
- U2 书架：搜索 / 排序 / 标签 chip / 管理 44，卡片 14 圆角、标题 14、辅助 11；导入与长按批量不回归。
- U3 练习记录：表单输入 44、主按钮 46、折叠 49、展开 231、首屏 6 条；保存与趋势不回归。
- U4 阅读器：五段工具栏总高 47，按钮 46，缩放 / 全屏 / 禅定 44；迷你节拍器与进度条关闭热区正常。

## 6. 发布闸门

- 用户真机测试通过前：不 tag、不 Release、不合并 `main`。
- 测试通过后：按 [docs/VERSIONING.md](docs/VERSIONING.md) 从干净提交构建、创建 draft Release、上传 APK、核对后再 publish。
- Release 标题只用 `v0.1.28`；GitHub Release 使用 API，不占用鼠标键盘。
- APK 上传或下载超时：立即告知用户，可跳过该步，不重试、不做下载校验。

## 7. 当前状态

- 2026-11-28：U1–U5 全部完成；`gs_030.py` 四组通过；`gs_023.py` 已同步到 9:16 并通过 156/156。
- 全站回归已跑：`gs_015` / `016` / `018` / `019` / `020` / `021` / `022` / `023` / `024` / `025` / `026` / `028` / `029` / `030`；`npm run check` 通过。
- 下一步：版本号同步、CHANGELOG 切段、构建并安装测试包，交用户测试。
- **当前没有 0.1.28 tag 或 Release。**

## 8. 后续任务

用户测试通过后，按版本规则发布 `v0.1.28`；发布完成后把 `main` 合回 `dev`，新改动继续在 `dev` 累积。
