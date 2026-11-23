# CURRENT TASK — 0.1.5 交互一致性与云同步韧性

> 状态：真机验收通过，未发布，继续迭代
> 更新时间：2026-11-23
> 版本基线：线上 Release 为 0.1.4；内部版本 0.1.5 已真机验收，未单独发布
> 发布策略：0.1.5 不打 tag、不发布 GitHub Release，与后续功能一起跨版本发布
> 关联：[TASK.md](TASK.md)（项目总账） / [CHANGELOG.md](CHANGELOG.md)（发布历史）

本文件只记录当前版本的“做什么、怎么做、怎么验收”。发布后把结果压缩进 `CHANGELOG.md`，再重写本文件进入下一版。

0.1.4 的完整批次与验收清单已归档到 [docs/archive/CURRENT_TASK-0.1.4.md](docs/archive/CURRENT_TASK-0.1.4.md)。

## 1. 目标

0.1.5 不铺新功能，只补 0.1.4 暴露出的体验与工程缺口：

1. **批量标签弹窗焦点一致**：打开不自动聚焦、点快捷标签不回焦输入框，与编辑乐谱信息弹窗保持一致。
2. **云同步韧性**：下调超时，增加任务取消与失败重试，避免长任务只能干等。
3. **回归可重复**：关键浏览器回归脚本入库，新增静态检查与 CI。

## 2. 改动范围

### 2.1 批量标签焦点

- `openBatchTagModal()` 打开前 `blur()` 标签输入框，移除 `setTimeout(... focus)`。
- `renderTagQuick()` 点击快捷标签只切换 draft 并回填，不再 `focus()` 输入框。
- 键盘只在用户手动点击标签输入框时出现。

### 2.2 云同步超时

- 上传 `60s`、下载 `30s`、元信息 / 探测 `12s`。
- 本地代理 `cap 10s` 保持不变。
- 端点回退逻辑不变；单端点超时仍会换下一个。

### 2.3 云同步取消

- `webdav.js` 增加任务级 `AbortController`：`beginTask()` / `cancelTask()` / `isCancelled()` / `endTask()`。
- 浮动状态胶囊改为可交互：忙碌时显示“取消”，点击后当前请求立即中止。
- 取消后胶囊消失、上传 / 下载 / 测试按钮恢复；提示“已取消云同步任务”。
- 打包备份阶段不可中断，但打包完成后会检查取消标记，不再继续上传。
- 已完成的 PUT 不可撤销；取消只在请求进行中有效。

### 2.4 云同步失败重试

- 失败时浮动胶囊切换为失败态，显示简短错误、`重试` 与关闭按钮。
- 重试复用当前表单与字段值，重新走完整的上传 / 下载 / 测试流程。
- 错误同时保留在云同步弹窗状态行，关闭胶囊后再次打开弹窗仍能看到上次错误。
- 重试成功后清除失败态，恢复普通状态摘要。

### 2.5 回归与 CI

- 新增 `scripts/check.mjs` 与 `npm run check`：
  - `package.json` / `version.js` / `sw.js` / `build.gradle` 版本一致。
  - 全部 `js/**/*.js` 通过 `node --check`。
  - 静态 `import` 的相对路径存在。
  - `sw.js` 缓存清单覆盖全部 JS。
  - `js/` 内无原生 `confirm(` / `alert(`。
  - README 版本徽标与 `package.json` 一致。
- 新增 `tests/browser/gs_015.py`：批量标签焦点、云同步取消 / 失败重试 / 超时配置。
- 新增 `.github/workflows/ci.yml`：push / PR 执行 `npm run check`，并编译 Python 回归脚本。

## 3. 验收标准

- [x] 批量标签弹窗打开后 `shadowRoot.activeElement` 为 `null`。
- [x] 点批量标签快捷标签后输入框回填、焦点仍为 `null`。
- [x] `webdavService.getTimeouts()` 返回 `{ upload: 60000, download: 30000, meta: 12000 }`。
- [x] 云上传挂起时点“取消”，请求中止、胶囊消失、按钮恢复、提示“已取消云同步任务”。
- [x] 云请求全部失败时出现失败胶囊与“重试”；点“重试”能重新发起并成功。
- [x] 失败错误保留在云同步弹窗状态行。
- [x] 上传 / 下载成功后仍自动收起弹窗，底部按钮仍为“返回”。
- [x] 320 / 360 宽下浮动胶囊不横向溢出，文字截断，取消 / 重试按钮可点。
- [x] `npm run check` 通过。
- [x] 浏览器回归脚本 `tests/browser/gs_015.py` 通过。

## 4. 风险与边界

- 取消只中止进行中的网络请求，不能回滚已完成的云端写入或本地覆盖。
- `buildBackupPayload()` 读 IndexedDB 无法中断，取消会在打包结束后生效。
- 失败重试使用当前表单值；用户改过路径或密码后，重试按新值执行。
- 失败胶囊文字会截断，完整错误保留在弹窗状态行。
- CI 只做静态检查与 Python 编译；真实浏览器回归仍需本机 Edge / Chrome。
- 超时下调后，极慢网络上的大备份可能更早失败；失败可直接重试，不再无限等待。

## 5. 发布前检查

- [x] 批次 1–3 完成。
- [x] 320 / 360 宽书架、云同步胶囊、失败态截图。
- [x] `npm run check` 通过。
- [x] 版本号同步为 `0.1.5`：`package.json`、`version.js`、`sw.js`、`build.gradle`。
- [x] `CHANGELOG.md` / `TASK.md` / README 已更新。
- [x] 重新构建 release APK，复核包名、版本、v1 / v2 签名与 SHA-256。
- [x] 真机回归通过（2026-11-23）。
- [x] 提交并推送 `main`。
- [x] 本次不单独打 tag / 发布 GitHub Release，留待后续跨版本发布。

## 6. 浏览器验收记录

2026-11-23，Edge headless + CDP，临时 IndexedDB 隔离环境，360×800 与 320×800：

- 批量标签弹窗打开：`active:null`，`inputFocused:false`。
- 点批量标签快捷标签“练习”：输入框变为 `练习`，`active:null`，未聚焦标签输入框。
- 云同步超时：`{ upload: 60000, download: 30000, meta: 12000 }`。
- 云上传挂起时：胶囊 `busy`、取消按钮可见、命中测试落在取消按钮、未超出视口。
- 点取消：`busy:false`、胶囊隐藏、上传按钮恢复、toast 为“已取消云同步任务”。
- 全部端点失败：失败胶囊出现，`retryVisible:true`，重试按钮命中测试通过，未超出视口；toast 为“上传失败，可点状态条重试”。
- 失败后打开云同步弹窗，状态行保留同一条完整错误。
- 点重试并恢复成功响应：失败态清除、胶囊隐藏、上传按钮恢复，toast 为“已上传到云端 · 自定义端点”。
- 320 宽失败胶囊：宽 `288px`，左右 `16 / 304`，无横向溢出；文字截断，重试 / 关闭按钮可见。
- 360 宽失败胶囊：宽 `308.375px`，左右 `25.8 / 334.2`，无横向溢出。
- 云同步底部按钮文案仍为“返回”。
- `npm run check` 通过：`v0.1.5`，25 个 JS 文件，SW 缓存与版本一致。
- 截图：`%TEMP%\gs_015_320_fail.png`、`%TEMP%\gs_015_360_fail.png`。

## 7. APK 构建记录

2026-11-23 `npm run apk:release` 成功，产物 `I:\My Projects\GuitarShell\dist\GuitarShell-0.1.5-release.apk`：

- 包名 `com.guitarshell`，`versionCode 105`，`versionName 0.1.5`。
- 大小 `4,147,309` 字节。
- SHA-256 `5D9B313A25933B642995AA6918E00116427192D0E3E15D7FE8CEF52DA01534D9`。
- v1 / v2 签名通过，证书 SHA-256 `CA6D27B23E55E5009B6E27C3918ED08C87CE4ED2AEC7FFF65E3C2F461715AC4E`。
- APK 内 `assets/public` 已复核：`version.js` / `sw.js` 为 `0.1.5`，`sheet-reader.js` 含取消按钮，`webdav.js` 上传超时 `60s`。
- 2026-11-23 真机验收通过；按发布策略未单独发布。
- GitHub Actions CI 首次运行通过：`static-checks` 成功。

## 8. 发布策略

0.1.5 作为内部迭代版本随 `main` 推送，不打 `v0.1.5` tag，不创建 GitHub Release，也不更新 README 的正式下载入口。

后续继续累积功能，到下一个跨版本节点再统一构建、验收、打 tag 并发布 Release；届时 README 下载入口与版本说明一并切换。

GitHub Pages 会随 `main` 自动部署，因此线上网页当前显示 0.1.5 源码。它只作为开发预览，不替代 GitHub Release；正式 APK 下载入口仍指向 0.1.4。
