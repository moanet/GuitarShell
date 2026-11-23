# CURRENT TASK — 0.1.11 WebDAV 可恢复写入

> 状态：已完成并发布 `v0.1.11`
> 更新时间：2026-11-23
> 版本基线：线上 Release 为 `0.1.11`；本次只收口 WebDAV 写入技术债，不新增用户功能。
> 关联：[TASK.md](TASK.md)（项目总账） / [CHANGELOG.md](CHANGELOG.md)（发布历史）

0.1.10 的完整记录已归档到 [docs/archive/CURRENT_TASK-0.1.10.md](docs/archive/CURRENT_TASK-0.1.10.md)。

## 1. 目标

坚果云 WebDAV 实测结论：

- `OPTIONS` 返回 `Allow` 含 `MOVE`；
- 普通 `MOVE` 返回 `201`；
- 目标已存在时 `MOVE` 返回 `409`，即使带 `Overwrite: T` 也不覆盖。

因此不能做“单次 `MOVE` 严格原子替换”。0.1.11 把上传改成**可恢复写入**：

1. 先把备份写到同目录的 `<正式文件>.uploading`；
2. 用 `PROPFIND` 校验临时文件存在且大小与 PUT 字节数一致；
3. 删除正式文件（404 视为本来就不存在）；
4. `MOVE` 临时文件到正式文件；
5. `MOVE` 被浏览器 CORS 预检拦截、代理不转发 MOVE、返回 409 / 非 2xx 时，自动回退为“正式文件 PUT + PROPFIND 校验”，临时文件保留；
6. 任何一步失败都保留 `.uploading`，下次上传继续处理；
7. 正式文件缺失、或正式文件不是完整 JSON 时，下载回退读取 `.uploading`，避免另一台设备取到半截备份。

补充实测：自定义域名 `dav.noamet.ccwu.cc` 与 `workers.dev` 的 `OPTIONS` 只返回 `Access-Control-Allow-Methods: GET,PUT,DELETE,PROPFIND,OPTIONS`，MOVE 会在浏览器预检阶段被拦。仓库内本地 Node 代理已同步放开 MOVE 并重写 `Destination`；自定义域名 Worker 的重新部署不在本版本内，因此生产路径必须有 PUT 回退。

不包含：

- 云同步自动 / 定时触发、退出前自动上传；
- 自定义域名 Worker 的重新部署（需要完全原子 MOVE 时再单独处理）；
- `.bak` 旧版本副本方案（保留复杂度，暂不做）；
- 备份格式、备份内容、云同步 UI 布局改动。

## 2. 方案

### 2.1 临时文件与端点锁定

- 临时路径固定为 `normalizePath(remotePath) + '.uploading'`，不新增随机文件名，失败后下次直接覆盖同一临时文件。
- 首次 `PUT` 仍走现有端点候选（自定义端点 → 本地代理 → 自建域名 → Worker）。
- 临时文件一旦 `PUT` 成功，后续 `PROPFIND` / `DELETE` / `MOVE` 全部锁定同一个端点，避免“临时文件写在 A、替换请求跑到 B”。
- 首次 `PUT` 返回 5xx 时仍允许换端点；换成功后锁在新端点。

### 2.2 写入序列

`js/services/webdav.js` 的 `upload()`：

1. `PUT <path>.uploading`，`Content-Type: application/json;charset=utf-8`；
2. 401 → “账号或应用密码错误”；
3. 404 / 409 → `ensureFolder()` 补建父目录后，在同一端点重试一次；
4. `PROPFIND Depth: 0` 读临时文件：
   - 405 / 501：端点不放开 PROPFIND，跳过大小校验；
   - 404：临时文件不可见，终止，不碰正式文件；
   - `getcontentlength` 与 PUT 的 UTF-8 字节数不一致：删除临时文件并终止；
5. `DELETE` 正式文件：
   - 204 / 200 / 202 成功；
   - 404 视为首次上传；
   - 401 报密码错误；其他状态终止并保留临时文件；
6. `MOVE <path>.uploading` → `<path>`：
   - `Destination` 用当前端点拼绝对 URL；
   - `Overwrite: F`，避免替换过程中另一台设备刚写入的正式文件；
   - 401 报密码错误；2xx 视为成功。

### 2.2.1 MOVE 不可用时的回退

`MOVE` 在浏览器里是“非简单方法”，必须先通过 CORS 预检。实测自定义域名 / Worker 的
`Access-Control-Allow-Methods` 不含 `MOVE`，预检会直接失败；本地 Node 代理原先也不含 `MOVE`。
因此 `upload()` 不能把 MOVE 当成唯一路径：

- MOVE 抛网络错误（含 CORS 拦截）、返回 409 / 405 / 5xx 等非 2xx 时，记录警告并回退；
- 回退序列：`PUT <path>`（正式文件）→ `PROPFIND Depth: 0` 校验大小 → `DELETE <path>.uploading`；
- 回退 PUT 失败：错误“替换失败：正式文件写入失败（HTTP xxx），临时文件已保留”；
- 回退 PUT 成功但大小不一致：删除正式文件，错误“上传校验失败：正式文件大小 N，应为 M，临时文件已保留”；
- MOVE 返回 401、任务被取消时不回退，直接抛出。

### 2.2.2 本地代理

`proxy/proxy.js`：

- `Access-Control-Allow-Methods` 增加 `MOVE`；
- 转发前把浏览器的 `Destination`（代理域名）重写为 `https://dav.jianguoyun.com/...`，否则上游会把目标当成外部主机；
- 删除转发给上游的 `Host` / `Origin` / `Referer`。

### 2.3 下载回退

`download()` 先 `GET` 正式文件；404 时再 `GET <path>.uploading`。正式文件返回 200
但不是完整 JSON（例如回退 PUT 被中断留下半截内容）时，也尝试 `GET .uploading`：

- 临时文件 200 → 直接返回其内容，由上层 `JSON.parse` 与格式校验兜底；
- 正式文件是半截 JSON、临时文件是完整 JSON → 返回临时文件；
- 临时文件 404 → “云端没有找到备份文件”；
- 临时文件 401 → 密码错误。

`sheet-reader.js` 下载流程不再在 `stat` 返回 `exists:false` 时提前抛出，交给 `download()` 决定是否回退。

### 2.4 错误文案

- 目录不可写：`上传失败：云端目录不可写（HTTP xxx），请先在坚果云里建好文件夹`
- 大小不一致：`上传校验失败：临时文件大小 N，应为 M`
- 删旧失败：`替换失败：无法删除旧备份（HTTP xxx），临时文件已保留`
- MOVE 失败且回退 PUT 失败：`替换失败：正式文件写入失败（HTTP xxx），临时文件已保留`
- 回退 PUT 成功但大小不一致：`上传校验失败：正式文件大小 N，应为 M，临时文件已保留`

## 3. 验收标准

### 3.1 浏览器

新增 `tests/browser/gs_021.py`（端口 `9356`），直接调用 `js/services/webdav.js` 并 mock `fetch`：

- 正常上传请求序列必须是 `PUT → PROPFIND → DELETE → MOVE`；
- 临时路径以 `.uploading` 结尾，正式路径不带后缀；
- `MOVE` 的 `Destination` 指向正式文件，`Overwrite: F`；
- PROPFIND 大小与 PUT 字节数不一致时，只 `DELETE .uploading`，不删除正式文件；
- `MOVE` 返回 409 时，回退 `PUT 正式文件 → PROPFIND → DELETE .uploading`，上传成功；
- `MOVE` 抛 CORS TypeError 时，同样回退 PUT 并成功；
- `MOVE` 失败且回退 PUT 失败时，错误含“临时文件已保留”；
- 正式文件 404、`.uploading` 200 时，下载返回临时文件内容；
- 正式文件 200 但是半截 JSON、`.uploading` 200 时，下载返回临时文件内容；
- 正式文件与临时文件都 404 时，报“云端没有找到备份文件”；
- 自定义端点 503 时自动换到本地端点，后续请求全部锁在本地端点。

### 3.2 回归

- `npm run check` 通过 `v0.1.11 / 29 个 JS`。
- `python -m compileall -q tests/browser` 通过。
- `gs_015.py` 云同步取消 / 失败 / 重试 / 退出确认无回归；mock 已适配 `PUT / PROPFIND / DELETE / MOVE`。
- `gs_016.py`、`gs_018.py`、`gs_019.py`、`gs_020.py` 全部通过。

### 3.3 APK / 真机

- `versionCode 111` / `versionName 0.1.11`，包名 `com.guitarshell` 与签名不变。
- Android 13 设备 `ca14b16` 覆盖安装成功，书架徽标 `0.1.11`，原有 6 张乐谱与 10 条练习记录保留。
- 打开全局设置 → 云同步，账号 / 应用密码 / 路径 / 自定义通道 / 返回 / 覆盖本地 / 上传备份布局正常。
- 点“测试连接”（只读 PROPFIND）返回“连接正常 · 自定义端点 · 云端已有备份”。
- 用测试路径 `GuitarShell/backup-cors-test.json` 实际上传一次，上传完成、状态“本机已是最新”，测试连接显示“云端已有备份”；未触碰正式 `GuitarShell/backup.json`。该链路因自定义域名 CORS 不含 MOVE，实际走 PUT 回退，证明回退路径可用。测试文件与遗留测试目录已由用户删除。
- 自定义域名 Worker 参考源码已补在 `proxy/cloudflare-worker.js`：CORS 放开 `MOVE`，并把 `Destination` 重写为坚果云上游地址；用户可手动替换 Cloudflare Worker 代码。

## 4. 实施记录

### 4.1 `js/services/webdav.js`

- 新增 `TEMP_SUFFIX = '.uploading'`、`tempPathFor()`、`utf8ByteLength()`。
- 抽出 `requestAt(endpoint, remotePath, init, timeoutMs)`：固定端点请求，设置 `lastEndpoint`。
- 新增 `requestWithEndpoint()`：保留原有候选端点 / 5xx 回退，同时返回实际端点；`request()` 改为薄包装。
- `ensureFolder()` 增加可选 `endpoint` 参数，补建目录时也锁定同一端点；401 / 403 直接抛出。
- 抽出 `parseStatResponse()`，`statAt()` 用固定端点读临时文件；公开 `stat()` 行为不变。
- `upload()` 改为临时文件 + 校验 + 删除 + `MOVE` 的可恢复流程。
- `MOVE` 抛网络错误 / 非 2xx 时自动回退为正式文件 `PUT`，再做一次 `PROPFIND` 校验；失败保留 `.uploading`。
- `download()` 增加 `.uploading` 回退，并在正式文件不是完整 JSON 时改用临时文件。
- `fetchWithTimeout()` 的网络失败错误补 `code = 'NETWORK'`，供上传流程识别 CORS / 断网。
- `probe()` / `getTimeouts()` / `getEndpointLabel()` / 任务取消接口保持不变。

### 4.2 `js/components/sheet-reader.js` 与 `proxy/`

- 下载流程移除 `remote.exists === false` 的提前抛出，避免正式文件缺失时无法读取可恢复的临时文件。
- `proxy/proxy.js` 的 CORS 方法增加 `MOVE`；转发前把 `Destination` 重写为坚果云上游地址，并去掉 `Host` / `Origin` / `Referer`。
- 新增 `proxy/cloudflare-worker.js` 作为自定义域名 Worker 的参考源码：预检直接返回 `204`，CORS 放开 `MOVE`，转发前重写 `Destination`，并去掉 `Host` / `Origin` / `Referer` / `Accept-Encoding`。
- 上传 / 下载按钮、状态胶囊、取消 / 重试与退出确认均未改动。

### 4.3 测试

- `tests/browser/gs_015.py`：mock 从“PUT 201 / 其他 404”改为按方法返回：
  - `PUT` / `MOVE` → 201；
  - `PROPFIND` → 405（跳过大小校验）；
  - `DELETE` → 404（首次上传）。
- 新增 `tests/browser/gs_021.py`，覆盖正常序列、大小失败、MOVE 409 回退、CORS TypeError 回退、回退 PUT 失败、下载回退、半截 JSON 回退、无备份、端点回退锁定九组用例。
- `tests/browser/README.md` 补 `gs_021.py`、端口 `9356` 与覆盖说明。

### 4.4 验证结果

- `npm run check`：`v0.1.11，29 个 JS 文件，SW 缓存与版本一致`。
- `python -m compileall -q tests/browser`：通过。
- `gs_021.py`：九组用例全部通过；正常序列 `PUT → PROPFIND → DELETE → MOVE`，`Destination` 与 `Overwrite: F` 正确；MOVE 409 / CORS TypeError 时回退 `PUT → PROPFIND → DELETE .uploading`。
- `gs_015.py`：云同步取消、失败胶囊、重试成功、退出确认均通过；重试 toast `已上传到云端 · 自定义端点`。
- `gs_016.py` / `gs_018.py` / `gs_019.py` / `gs_020.py`：全部通过。
- release APK 构建通过：`dist/GuitarShell-0.1.11-release.apk`，4,373,460 字节，SHA-256 `C6BAA0E6F4B3B437F399EB232DDB24643566B26179B42B9163CA87F82795CAAE`。
- `aapt dump badging`：`com.guitarshell`，`versionCode 111` / `versionName 0.1.11`，`minSdk 22` / `targetSdk 34`。
- `apksigner verify --print-certs`：v1 / v2 通过，证书 SHA-256 仍为 `CA6D27B23E55E5009B6E27C3918ED08C87CE4ED2AEC7FFF65E3C2F461715AC4E`。
- 真机 `ca14b16` 覆盖安装成功；书架徽标 `v0.1.11`，原有 6 张乐谱与 10 条练习记录保留。
- 真机用测试路径 `GuitarShell/backup-cors-test.json` 实际上传一次：上传完成、状态变为“本机已是最新”，测试连接返回“连接正常 · 自定义端点 · 云端已有备份”。未触碰正式 `GuitarShell/backup.json`；测试文件与遗留测试目录已由用户删除。
- 该测试路径的实际链路走的是 MOVE 失败后的 `PUT` 回退（自定义域名 CORS 仍不含 MOVE），证明回退路径在真机可用。

### 4.5 版本与状态

- 版本已同步：`package.json` / `package-lock.json`、`sw.js`、`js/services/version.js`、`android/app/build.gradle` 均为 `0.1.11` / `versionCode 111`。
- `README.md` 版本徽标改为 `0.1.11`；GitHub Release 已更新为 `v0.1.11`。
- APK：`dist/GuitarShell-0.1.11-release.apk`，4,373,460 字节，SHA-256 `C6BAA0E6F4B3B437F399EB232DDB24643566B26179B42B9163CA87F82795CAAE`。
- 已推送 `main`；CI 与 Pages 工作流成功，网页版已部署 `0.1.11`。
- 已发布 GitHub Release `v0.1.11`（Release ID `455427768`，tag 指向 `4aa7358`）；APK asset ID `782951194`，远端下载大小与 SHA-256 复核一致。
