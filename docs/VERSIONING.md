# Guitar Shell 版本号与发布规则

> 适用范围：Guitar Shell 的所有开发、构建、归档与发布任务。
> 核心原则：**只有稳定快照才占用版本号；开发中间态用日期、时间和 commit 标识。**
> 本文件是版本号与发布流程的唯一规则来源。与其他文档冲突时，以本文件为准；历史版本号与已发布资产不回改。

## 1. 术语

- **开发中间态**：开发中的构建，用于本机试装、调试和验收，不要求功能完整。
- **稳定快照**：已经验证、能安装、出问题能回滚的构建点，不要求功能完整。
  - 稳定快照必须同时具备：版本号、对应 APK、Git tag、GitHub Release。
  - 只完成其中一部分，不构成稳定快照。
- **版本号**：稳定快照的公开标识，形如 `0.1.27`，不含字母后缀。
- **versionCode**：Android 安装标识，只要求单调递增，与版本号解耦，不要求数字对应。

## 2. 三条核心规则

### 2.1 草稿不编号，定稿才编号

**开发中间态**

- APK 命名为：

  ```text
  GuitarShell-dev-YYYYMMDD-HHmm-<commit前7位>[-dirty].apk
  ```

- 放在 `dist/dev/`。
- 使用 `npm run apk:dev` 构建；脚本自动计算时间、commit、dirty 状态，写入上述文件名，并把 Android `versionName` 设为 `<上一稳定版本号>-dev.<YYYYMMDD-HHmm>`，`versionCode` 沿用上一稳定快照。
- 不占用稳定版本号，不修改 `package.json` / `version.js` / `sw.js` 的稳定版本字段，不打 tag，不发 Release。
- 工作区有未提交改动时，文件名必须带 `-dirty`。
- `-dirty` 构建只能作为开发包，不能成为稳定快照。

**稳定快照**

- 版本号默认在末位 `+1`，例如 `0.1.26` → `0.1.27`；进入新的 `0.2.x` 阶段需单独决定，不自动跳。
- APK 命名为：

  ```text
  GuitarShell-<版本号>.apk
  ```

- 打 tag `v<版本号>`，创建 GitHub Release。
- Release 标题只用 `v<版本号>`，不加副标题。
- 使用 `npm run apk:release` 构建时，脚本输出 `dist/GuitarShell-<版本号>.apk`。

### 2.2 一个版本号只对应一个 APK

- 禁止 `0.1.27a` / `0.1.27b` 这种字母后缀。
- 草稿只用日期、时间和 commit 区分，不用版本号后缀。
- 一个稳定版本号只对应一个最终 APK。
- Release 发布后，asset 不可替换、删除或重传；发现 APK 有问题，只能发新版本。
- 回滚点绑定当时发布的那个 asset，保证可追溯。

### 2.3 CHANGELOG 先记 `[Unreleased]`，发版时切段

从 `0.1.27` 开始：

- 在 `CHANGELOG.md` 顶部维护空的 `## [Unreleased]` 段。
- 日常改动按 `新增` / `修复` / `变更` 分类写入；同类合并成一条，不逐 commit 罗列。
- 发版时：

  ```text
  [Unreleased] → ## [<新版本号>] — YYYY-MM-DD
  ```

  然后在顶部新开一个空的 `## [Unreleased]`。

- 历史标题保留原格式，例如 `## 0.1.26 — 日期`，不做全量迁移。
- `0.1.27` 开发任务启动前，不要向 `0.1.26` 段追加功能改动；启动时先建空 `[Unreleased]`。

## 3. Android 构建标识

| 构建类型 | versionName | versionCode |
| --- | --- | --- |
| 开发中间态 | `<上一稳定版本号>-dev.<YYYYMMDD-HHmm>` | 沿用上一稳定快照的 versionCode |
| 稳定快照 | `<新版本号>` | 上一稳定快照的 versionCode `+1` |

说明：

- 开发包的 `versionName` 只是 Android 系统标识，不是新版本号；不得写成 `0.1.27a`。
- 开发包不递增 `versionCode`，多个开发包共用上一稳定快照的 `versionCode`，靠 `versionName` 时间戳区分。
- 开发包内部通过构建时注入的 `BUILD_STAMP` 显示 dev 标识：顶部徽标只显示 `dev HHmm`，关于页显示完整 `v<上一稳定版本号>-dev.<YYYYMMDD-HHmm>`；稳定构建的 `BUILD_STAMP` 必须为空。
- 稳定快照的 `versionCode` 必须大于上一稳定快照；发版时写入并提交，构建阶段不再自动递增。
- 不额外维护构建计数器。

## 4. 版本字段与一致性检查

发版时必须同步以下**四处核心字段**：

1. `package.json` 的 `version`
2. `js/services/version.js` 的 `APP_VERSION`
3. `sw.js` 的 `APP_VERSION`（`CACHE_NAME` 由它派生，自动同步）
4. `android/app/build.gradle` 的 `versionName` 和 `versionCode`

以下属于**一致性检查**，不计入“四处 bump”：

5. `package-lock.json` 根 `version` 与 `packages[""].version`
6. `README.md` 版本徽标

发版前运行项目现有检查（如 `npm run check`），确认 JS 文件、Service Worker 缓存与版本号一致。

## 5. 稳定快照发版顺序

每次发稳定快照，按以下顺序执行，不能跳步：

1. **切 CHANGELOG**：把 `[Unreleased]` 改为 `## [<新版本号>] — YYYY-MM-DD`，顶部新开空 `[Unreleased]`。
2. **bump 四处并核对**：`versionCode = 上一稳定快照 +1`；同步 `package-lock.json` 与 README 徽标；运行一致性检查。
3. **先提交以上改动**：得到提交 hash，确认 `git status --short` 为空。
4. **从该提交构建** release APK：`dist/GuitarShell-<新版本号>.apk`。稳定快照只能从干净提交构建。
5. **先建 draft Release**：`tag_name = v<新版本号>`，`target_commitish = 该提交 hash`；上传 APK，核对 asset 名称、大小、digest。
6. **asset 成功后再发布**：创建/推送 tag，publish draft。发布后 asset 不可替换。
7. **输出核对清单**：新版本号、四处文件实际值、`package-lock.json` / README 徽标一致性、提交 hash、APK 路径、tag 名、CHANGELOG 切段位置、Release / asset 结果。

上传或下载 APK 超时时：

- 立即告知用户当前状态：Release 是否已创建、asset 是否缺失。
- 按用户偏好可跳过该步骤，不重试、不做下载校验。
- 上传超时时停在 draft，不 publish、不打 tag；该版本不算稳定快照，不进入 latest。
- 后续经用户确认后再补传，或删除 draft 后重新安排；不产生“已发布但没有 asset”的版本。

## 6. 草稿目录与 Git

- `dist/dev/` 必须在 `.gitignore` 覆盖范围内。
- 当前 `.gitignore` 的 `dist/` 已覆盖 `dist/dev/`。
- 首次 dev 构建前检查：

  ```text
  git check-ignore -v dist/dev/
  ```

- 如果未被忽略，先把 `dist/dev/` 加入 `.gitignore`，再构建。
- 草稿 APK 不进入 Git；稳定 APK 也不作为源码提交，按现有发布流程交付。

## 7. 0.1.26 归档结论

### 7.1 状态

`0.1.26` 是**稳定快照**，不是中间记录。

- tag：`v0.1.26`
- GitHub Release：`460687203`
- asset：`GuitarShell-0.1.26-release.apk`
- 当前四处核心值与一致性字段：

| 字段 | 实际值 |
| --- | --- |
| `package.json` `version` | `0.1.26` |
| `js/services/version.js` `APP_VERSION` | `0.1.26` |
| `sw.js` `APP_VERSION` | `0.1.26` |
| `build.gradle` `versionName` | `0.1.26` |
| `build.gradle` `versionCode` | `136` |
| `package-lock.json` 根 / `packages[""]` | `0.1.26` |
| README 版本徽标 | `0.1.26` |

结论：**0.1.26 状态一致，无需改动；不 bump、不打新 tag、不建新 Release。**

### 7.2 历史命名例外

`GuitarShell-0.1.26-release.apk` 是已发布的历史命名例外，不重命名、不替换。

从下一个稳定快照起，统一使用 `GuitarShell-<版本号>.apk`。

### 7.3 未发布的中间记录

- `0.1.21a–c`、`0.1.22`、`0.1.23`：未发布，无 tag / Release；作为历史中间记录保留，不改历史版本号。
- `0.1.25`：未发布，无 tag / Release；本地保留验收包 `GuitarShell-0.1.25-release.apk`。
- `0.1.26`：稳定快照，已发布；`0.1.25` 的改动随 `0.1.26` 发布。

### 7.4 CHANGELOG 格式

- `0.1.26` 及更早的历史标题保留 `## <版本号> — 日期` 原格式。
- 从 `0.1.27` 起使用 `## [Unreleased]` 与 `## [<版本号>] — 日期`。

## 8. 分支与发布线

- `main`：稳定发布线。只接收准备成为稳定快照的提交；文档修正可以单独提交，但不能把未定稿的应用代码推上去。
- `dev`：长期开发线。多轮改动、dev APK、网页本地测试都在这里；不预占稳定版本号、不打 tag、不发 Release。
- 日常多轮：在 `dev` 提交并推送 `origin dev` 作为备份；不推 `main`。
- 准备稳定快照：
  1. 本地切到 `main`，合并 `dev`。
  2. 在 `main` 上切 `[Unreleased]`、bump 四处、提交版本提交。
  3. 只推送最终版本提交到 `main`；不要先把未 bump 的 merge 推上去。
  4. 从该提交构建、建 draft Release、上传、打 tag、publish。
  5. 发布后把 `main` 合回 `dev`，作为下一轮基线。
- tag 只指向 `main` 上的版本提交，不指向 `dev` 的普通提交。
- 如果 GitHub Pages 绑定 `main`，推 `main` 就等于更新线上网页；开发轮次不要推 `main`。
- 现有 CI 在 `push main`、`push dev` 和 PR 时运行；推 `dev` 也会跑静态检查。

## 9. 下一版本

- 下一稳定快照默认目标：`0.1.27` / `versionCode 137`。
- `0.1.27` 开发任务启动时，先在 CHANGELOG 顶部建立空的 `## [Unreleased]`。
- 在 `0.1.27` 正式切段前，不向 `0.1.26` 段追加功能改动。

## 10. 禁止事项

- 禁止给开发包编稳定版本号。
- 禁止使用 `0.1.27a` / `0.1.27b` 等字母后缀。
- 禁止修改历史版本号、历史 tag 或已发布 asset 名。
- 禁止从脏工作区构建稳定快照。
- 禁止发布后替换同一版本的 asset。
- 禁止在没有 APK asset 的情况下把 Release 当作稳定快照。
