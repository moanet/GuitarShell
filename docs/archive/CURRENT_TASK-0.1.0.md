# CURRENT_TASK — 0.1.0 正式包与迁移（归档）

> 版本：`0.1.0` / `versionCode 100`
> 发布日期：2026-11-21
> 来源：2026-11-25 从旧 `TASK.md` 第 1.1 / 1.2 节迁出。`CHANGELOG.md` 从 `0.1.1` 起逐版本记录，本文件保留 `0.1.0` 的发布、签名与迁移事实。

## 1. 正式包

已完成：

- `namespace` / `applicationId` 切到 `com.guitarshell`；Java 源码从 `cc/ccwu/guitarshell/spike/` 迁到 `com/guitarshell/`。
- `capacitor.config.json` 的 `appId`、`strings.xml` 的 `package_name` / `custom_url_scheme` 同步更换。
- Gradle 版本改为 `versionCode 100` / `versionName "0.1.0"`。
- npm 包名改为 `guitarshell`，版本 `0.1.0`，新增 `apk:release`。
- 网页与 Service Worker 版本同步为 `0.1.0`。
- 新建 release keystore，接入条件式 release signing；签名文件与密码配置均不进入 Git。
- 正式签名 APK 构建通过，包名、版本、v1 / v2 签名与证书指纹均已校验。
- 源码与文档已提交并推送 `main`（`ade4430`）；`v0.1.0` tag 已推送。
- GitHub Release `v0.1.0` 已正式发布，资产 `GuitarShell-0.1.0-release.apk` 已上传；远端下载文件 SHA-256 与本地一致。
- GitHub Pages 已随 `main` 更新到 `0.1.0`。

发布地址：`https://github.com/moanet/GuitarShell/releases/tag/v0.1.0`

本地 APK SHA-256：`6FD48F67DEEDE073C12A5BDBB1F04C22D7F603301E797273BC865381C817A1A9`

## 2. 发布后补验（2026-11-21）

- [x] 真机安装 `0.1.0`，确认与 `0.0.8.10` 并存安装、启动、权限与备份恢复。
- [x] 旧版设置抽屉导出备份 JSON，新版「从文件恢复」导入，核对乐谱、阅读进度、页级书签与练习记录。
- 验收结论：用户确认无问题；测试机型与系统版本未在本轮记录。

## 3. 包名与迁移说明

- `0.1.0` 与 `0.0.8.10` 是独立应用，不能覆盖升级。
- 备份包含：乐谱、阅读进度、页级书签、练习记录。
- 备份不包含：WebDAV 密码保险库、主题选择。换机或重装后需要重新设置。
- 备份恢复顺序：先完整校验 dataURL，再清库写入；不要中途清空旧数据。
