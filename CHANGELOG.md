# Changelog

> Guitar Shell 的**完整迭代记录**：逐版本交付、测试结果、关键决策与风险。
> README 只保留精简时间线和当前进度；需要追溯细节时看这里。

## 0.1.3 — 数据可靠性：内容哈希去重与同步状态（已发布，2026-11-22）

> 版本已同步为 `0.1.3`；release APK 已构建、校验并上传 GitHub Release。

**内容哈希去重**

- 新增 `js/services/file-hash.js`：优先 SHA-256，浏览器不支持时回退 FNV-1a 64；结果带算法前缀 `sha256:` / `fnv1a64:`，避免跨算法误判。
- 新增 `js/services/score-dedup.js`：有哈希时只认哈希；旧记录没有哈希时保留“名称 + 大小”兼容回退。
- 导入时先显示“正在校验 文件名...”，哈希失败只警告、不阻断导入。
- 同一批导入的重复文件也会即时加入候选，改名后的同一份 PDF 只入库一次。
- 旧库同尺寸无哈希记录按需计算并写回 `fileHash`，回填使用 `{ touch: false }`，不会把维护动作算成用户改动。

**云同步状态**

- 新增 `js/services/sync-state.js`，统一读写 `gs_cloud_sync:<path>` 与状态文案。
- 读谱页云同步弹窗、全局设置云同步卡片共享同一状态摘要。
- 状态覆盖：未同步、上次同步后有本机改动、本机已是最新、状态读取失败。
- 打开弹窗、切换云路径、上传成功、下载成功后立即刷新。
- 同步状态只代表本机记录与云端同步点，不代表云端真实内容。

**数据字段**

- `dbService.addScore()` 写入 `updatedAt`；`updateScore()` 默认刷新 `updatedAt`，可通过 `{ touch: false }` 跳过。
- 本机改动时间取 `createdAt / updatedAt / lastReadAt` 的最大值。
- 本地备份、云备份、恢复流程均保留 `fileHash` 与 `updatedAt`。

**验收**

- 真实导入 UI：同一批导入 `练习曲A.pdf` 与改名副本，提示“成功 1 本 / 跳过重复 1 本”；再次导入改名副本仍跳过；导入不同内容正常新增。
- 单元测试：相同内容同哈希、不同内容不同哈希；哈希相同命中、同名同大小但哈希不同不命中、旧记录同尺寸惰性回填后命中。
- 浏览器：数据/同步/备份全量测试通过；360×800 与 320×800 下 reader / settings 无横向溢出，云同步状态可见。
- 真机：覆盖安装 0.1.2 后旧数据保留、版本显示 `0.1.3`；导入去重、云同步状态、备份恢复均通过。
- `node --check` 通过 `file-hash.js` / `score-dedup.js` / `sync-state.js` / `db.js` / `backup.js` / `sheet-reader.js` / `settings.js` / `sw.js`。

**构建与版本**

- `npm run apk:release` BUILD SUCCESSFUL（JDK 21，37s）。
- `aapt`：包名 `com.guitarshell`，`versionCode 103`，`versionName 0.1.3`。
- APK `4,136,009` 字节；SHA-256 `43A86823D6ED11B91A527493953FAB48D1D133C13FD9E264E905D910310A5DF1`。
- v1 / v2 签名校验通过；证书 SHA-256 `CA6D27B23E55E5009B6E27C3918ED08C87CE4ED2AEC7FFF65E3C2F461715AC4E`。
- 本地正式包：`dist/GuitarShell-0.1.3-release.apk`。

**发布**

- 代码提交 `77e6554` 已推送 `main`。
- annotated tag `v0.1.3` 指向 `77e6554`，tag 对象 `4a2f27c4a453f660d8e454637899db3d3bb4cc34`，已推送。
- GitHub Release `v0.1.3` 已正式发布（公开、非草稿、非预发布）：`https://github.com/moanet/GuitarShell/releases/tag/v0.1.3`。
- 资产 `GuitarShell-0.1.3-release.apk` 已上传，大小 `4,136,009` 字节；远端下载复核 SHA-256 与本地一致。
- `releases/latest` 已指向 `v0.1.3`。

## 0.1.2 — 节拍器界面收尾与设置按钮统一（已发布，2026-11-21）

> 版本已同步为 `0.1.2`；release APK 已构建、校验并上传 GitHub Release。

**节拍器界面**

- 主界面移除顶部设置栏，设置按钮移到左下、TAP 移到右下，两者同宽同高并左右镜像。
- 练习 HUD 移到圆盘下方；音频跟练双行 HUD 与练习信息共用同一位置。
- 设置面板改为固定头部：标题在左、“完成”在右；内容区独立滚动，删除底部“完成”按钮。
- 底部信息条与按钮整体上提：HUD 与按钮间距 10px；360×800 下 HUD 距圆盘约 35px，底部留白 64px。
- 设置按钮边框与字体样式统一到 TAP：`--line-warm` 边框、品牌强调色文字、`14px / 800 / 1.5px` 字距；背景保留中性表面色。
- 闪动条高度跟随拍点实际高度：4/4 为 24px，7/8 为 19px，32 拍为 11px；双轨总高与单轨一致，隐藏时保留同高占位，不推动圆盘或按钮。

**拍点色块**

- 色块位于拍点下方，宽度跟随拍点组实际宽度；4/4 与四个拍点对齐，32 拍跟随换行后的拍点组。
- 色块二合一：拍点同步闪动 + 计时 / 变速进度条。
- 八分音符每拍闪两次；三连、十六分及休止变体回退为每拍闪一次。
- 设置页新增“节拍闪光条（拍点同步）”开关；关闭后隐藏闪动，但计时 / 变速开启时仍显示进度。
- 计时进度按已用时间填充；变速进度按当前 BPM 在起始→目标区间中的比例填充；双轨时上计时、下变速。

**计时 / 变速自动记录**

- 计时到 0、变速到达目标并保持设定小节数后自动停止并写入记录。
- 两者同时开启时只记录先自然完成的一次；手动停止、切 Tab、迷你节拍器抢占、内部重启与应用退出均不记录。
- 新增记录字段：`source / mode / auto / minutes / durationSec / bpm / bpmStart / bpmEnd / plannedMinutes`。
- 记录页显示实际时长、BPM 区间与“自动”徽标；趋势累计优先使用 `durationSec`，旧记录继续兼容 `minutes`。

**音频拍号推测**

- 音频分析新增 2/4、3/4、4/4、6/8 候选推测，基于 RMS 包络、正向差分与 bar-lag 自相关。
- 设置页显示“拍号推测：3/4（置信度 100%）”或“不确定”；低置信度不填充。
- 推测结果只自动填入拍号输入框，不自动应用；必须手动点“应用”才改变实际拍号与重音。
- 用户手动改过拍号输入框后，后续分析不覆盖；换音频或清除音频时重置旧建议。

**验收**

- 真机：布局、色块闪动/计时变速进度、自动记录、拍号推测均通过；底部位置与间距确认合理。设置按钮边框/字体微调未再实机验证。
- 浏览器：360×800 / 320×800 无横向溢出；设置面板滚动时“完成”固定；4/4、7/8、32 拍色块与拍点同高；隐藏闪动条不造成位移。
- 自动记录：计时自然结束只写 1 条；手动停止不增加；计时+变速同时开启只新增先完成的一条。
- 拍号：3/4 样本显示建议并填入输入框，信息栏仍为旧拍号；点“应用”后才变为 3/4。
- `node --check` 通过 `metronome.js` / `audio.js` / `audio-analysis.js` / `practice-log.js` / `sw.js` / `version.js`。

**构建与版本**

- `npm run apk:release` BUILD SUCCESSFUL（JDK 21）；`cap sync` 已把 `www` 资源同步进 Android。
- `aapt`：包名 `com.guitarshell`，`versionCode 102`，`versionName 0.1.2`。
- APK `4,131,436` 字节；SHA-256 `B0AE1A31A719CFB378DA52EF7BEFEA92454F4358675B0181998A9D98E51B4F90`。
- v1 / v2 签名校验通过；证书 SHA-256 `CA6D27B23E55E5009B6E27C3918ED08C87CE4ED2AEC7FFF65E3C2F461715AC4E`。
- 版本已同步：`package.json` / `package-lock.json`、`js/services/version.js`、`sw.js`、Android `versionCode 102` / `versionName 0.1.2`。

**发布**

- 代码提交 `8b3887c` 已推送 `main`；发布记录另提交 `b4c8cf2`。
- annotated tag `v0.1.2` 指向 `8b3887c`，tag 对象 `ad489599e11edf63ffc06733f73b3f272d9bee27`，已推送。
- GitHub Release `v0.1.2` 已正式发布（公开、非草稿、非预发布）：`https://github.com/moanet/GuitarShell/releases/tag/v0.1.2`。
- 资产 `GuitarShell-0.1.2-release.apk` 已上传，大小 `4,131,436` 字节；远端下载复核 SHA-256 与本地一致。
- `releases/latest` 已指向 `v0.1.2`。

## 0.1.1 — 节拍器练习增强与启动动画提速（已发布，2026-11-21）

> 版本已同步为 `0.1.1`；release APK 已完成实机验证并正式发布（`com.guitarshell` / `versionCode 101` / `versionName 0.1.1`，GitHub Release `v0.1.1`）。

**节拍器 A 批：交互与基础能力**

- **BPM 长按步进**：`− / +` 支持长按连续加减，单击只加减 1；实测长按 520ms 从 120 到 123，真实单击 194 → 195。
- **拍号**：保留 9 个内置拍号（2/4、3/4、4/4、5/4、6/8、7/8、8/8、9/8、12/8）；新增自定义拍号，分子 1–32、分母 1–64。
- **细分**：扩到 11 种，包含四分、八分、三连、三连三种休止位、十六分、十六分四种休止位；休止位不发声但仍占拍。
- **Swing**：改为 0–100%、1% 步进，滑块与 HUD 同步。
- **音色**：6 种（正弦 / 方波 / 三角 / 木鱼 / 电子 / 短促）；木鱼与电子为独立合成。
- **TAP 与 32 拍**：TAP 补提示、8 次取样窗口与 2.5 秒自动重置；32 拍 / 64 分母下拍点自动缩小，避免挤出屏幕。
- **设置面板**：内容超高时内部滚动，360×800 下无横向溢出，主界面不被撑开；浏览器验收通过。

**节拍器 B 批：音频、节奏型与震动**

- **音频跟练**：选择本地音频后解码为 `AudioBuffer`，支持首拍偏移、预节拍（无 / 1 / 2 / 4 小节）、单曲循环与每次循环预节拍；音频与节拍器共用开始时刻，停止时淡出。
- **本地 BPM / 调性分析**：新增 `js/services/audio-analysis.js`，纯前端、不上传。BPM 搜索 50–200，调性分析 80–2000Hz / 8192 点 FFT；14 秒 120 BPM click track 实测 `120 BPM`、`A#m`（click track 的调性无实际音乐意义）。
- **节奏型**：6 个内置节奏型（4/4 流行、4/4 摇滚、3/4 圆舞曲、6/8 摇篮、7/8 复合、Swing 4/4）；支持保存、应用、删除；实测保存后 7 个，应用「4/4 摇滚」得到 `accent/sub/beat/sub`。
- **震动反馈**：重音 40ms / 次重音 30ms / 普通 18ms，静音拍不震动；刷新后保留。
- **音频播放能力**：`audio.js` 的 `startMetronome` 暴露 `startTime`，新增 `playBuffer()`，支持 `when / offset / loop / volume / onEnded`，停止时用 gain 淡出。

**音频跟练 / 音频测速（本轮）**

- 设置面板「音频」分组新增 `音频跟练` 与 `音频测速` 两个勾，同一行；只能二选一或全不选，勾选一个自动取消另一个。
- 内部状态为 `off / follow / tempo`，随 `guitar_metronome_settings` 持久化；刷新恢复，非法值回落 `off`。
- **跟练**：保留原逻辑，开始播放音频、分析后应用 BPM；进入跟练自动关闭「变速练习」和「Swing」，相关控件置灰；退出跟练立即停止音频，节拍器继续。运行中切跟练不半途插入音频，提示「重新开始后播放音频」。
- **测速**：分析后自动调整 BPM；点「开始」只跑节拍器，不播放音频；自动关闭变速，Swing 可保留。
- **全不选**：音频仍可载入和分析，但不自动改 BPM；开始只跑节拍器，已有音频也不播放。
- **跟练 HUD**：沿用原练习 HUD 位置改为两行：第一行文件名（过长单行省略），第二行 `音频跟练 · 120 BPM · 调性 A#m`，有倒计时继续追加；未选音频显示「音频跟练 · 未选择音频 / 开始不会播放」。
- **模式切换**：跟练运行中换音频，会停止、重新分析、更新 BPM、重新对齐并播放新音频；切测速 / 全不选立即停音频，节拍器保持运行。

**同期准备的其他更新**

- **信息架构调整**：Tab 统一为 `乐谱 / 节拍器 / 调音器 / 记录`；有乐谱默认进乐谱，无乐谱默认进节拍器，1.2 秒读库超时或异常回退节拍器；乐谱零数据空状态同时给「导入第一份乐谱」与「先用节拍器」，搜索无结果仍显示独立提示。`js/main.js` 新增统一 `setActiveTab()` 与 `app-request-tab`；`db.js` 新增只读条目数的 `getScoreCount()`；360px 以下 Tab 增加紧凑规则。
- **README 云同步文档**：新增「坚果云 WebDAV 同步」章节，写明应用密码申请、账号 / 应用密码 / 路径 / 同步通道填写、旧设备上传与新设备覆盖本地、冲突提示、密码本机加密、隐私边界与常见问题。同步仍为手动，不后台自动上传、不自动合并。
- **调音器切换爆音修复**：`audio.js` 的 `tone()` 在输出后串入独立淡出 GainNode，`stop()` 默认用 35ms 指数淡出后再停振荡器；`tuner.js` 切换弦 / 重播标准音时传入 35ms 淡出。浏览器采样验收中，快速 A2→B3→E4 切换的停止窗口最大采样跳变约 `0.0189`，同一采集链路的硬切对照组为 `0.1765`。
- **启动动画提速**：`MainActivity` 的原生启动层从「显示 1200ms + 淡出 260ms」压缩为「显示 800ms + 淡出 200ms」，总时长由约 `1.46s` 降至 `1.00s`；淡入仍为 `160ms`，`splash.html` 的蜗牛随机起点、拖尾、三点闪烁与系统栏配色均未改。

**验收与版本**

- 360×800 设置面板 `clientHeight 725 / scrollHeight 1470`，无横向溢出；音频模式行宽 318，两个勾顶部对齐；320 宽度下仍保持一行。
- 音频模式二选一 / 全不选、控件置灰、刷新恢复均通过；测速开始音频句柄为空；跟练开始音频句柄存在；跟练运行中换音频可重新分析并播放。
- 跟练 HUD 实测第一行文件名、第二行 `音频跟练 · 120 BPM · 调性 A#m`；文件名 `nowrap / ellipsis`。
- `node --check` 通过 `metronome.js` / `audio.js` / `audio-analysis.js`；浏览器 console 异常 0。
- 启动动画代码口径为 `800 + 200 = 1000ms`；`0.1.1` release APK 已随版本完成实机验证，未单独记录首帧 / 完全消失的秒表实测值。
- 版本已同步：`package.json` / `package-lock.json`、`js/services/version.js`、`sw.js` 与 Android `versionCode 101` / `versionName 0.1.1`。
- release APK `4,127,969` 字节；SHA-256 `C73E31F114F9F19FE6DF19DD70E1E9EA58AE1224AAEBF1304609FF85E2BE66BB`；包名 `com.guitarshell`；v1 / v2 签名校验通过。

**发布**

- `v0.1.1` annotated tag 指向代码提交 `066e8b4`，已推送 `origin`。
- GitHub Release `v0.1.1` 已正式发布：`https://github.com/moanet/GuitarShell/releases/tag/v0.1.1`。
- 资产 `GuitarShell-0.1.1-release.apk` 已上传（`4,127,969` 字节）；通过 GitHub API 重新下载后 SHA-256 与本地一致；用户确认实机验证通过。

## 0.0.8.10 — 暖纸日光 · 日间模式（已真机验收，UI 终版）

- **新增日间主题**：按用户提供的浅色九色色板新增「暖纸日光 · 日间模式」：背景 `#F3EDE3`、卡片 / 面板 `#FCF8F1`、主品牌 `#8F552C`、辅品牌 `#F3E8D6`、强调 `#C7863F`、常规文字 `#2A2520`、次要文字 `#7C7165`、成功 `#506E1B`、危险 `#A63E36`；边框 `#E5DAC8`。保留深色「复古木质 · 深夜琴房」原值不变。
- **双主题切换**：新增 `js/services/theme.js`，主题持久化在 `localStorage` 的 `gs_theme`，首次启动仍为深色；设置抽屉「外观」改为两张可点按主题卡，带 `aria-pressed` 与「使用中」标签，点按即切换，不再弹 Toast。
- **防启动闪色**：`index.html` 在样式表前内联读取 `gs_theme`，先落 `data-theme`、`color-scheme` 和 `meta[name=theme-color]`；浅色启动不会先闪深色。
- **全链路 token 化**：`css/layout.css` 重写为深 / 浅双主题 token，页面渐变、Header、Tabs、Toast、滚动条、焦点描边、遮罩、阴影、RGB 辅助色全部主题化；`sheet-reader.js`、`metronome.js`、`practice-log.js`、`tuner.js` 四个 Shadow DOM 组件完成换肤，硬编码色基本清零。
- **Canvas / SVG 跟随主题**：节拍器主 Canvas 与读谱迷你节拍器 Canvas 改为从 CSS 变量读取颜色，监听 `gs-theme-changed` 后重绘；练琴趋势 SVG 改为 `.bar` / `.bar.current` / `.axis-label` class，颜色走 `--chart-bar` / `--chart-current` / `--muted`，切主题无需重绘。
- **Android 系统栏**：新增 `ThemeBarsPlugin` 并在 `MainActivity` 注册，公开 `applyThemeSystemBars(String theme)`；深色状态栏 / 导航栏 `#0E1013` + 浅色图标，日间 `#F3EDE3` + 深色图标。`theme.js` 同时支持 `Plugins.ThemeBars` 与 `Capacitor.nativePromise('ThemeBars', 'setTheme')` 两条调用路径，兼容零构建 Capacitor 壳。
- **修复窄屏遮挡**：读谱「上次读到的位置」提示条改为按工具栏真实高度定位，390px 下工具栏换行时不再盖住「书签」按钮。
- **浏览器验收**：390×844 / 360×800 浅色均无横向溢出；`theme=light`、`meta=#F3EDE3`、`bg0=#F3EDE3`、`bg1=#FCF8F1`、`primary=#8F552C`、`heading=#2A2520`；设置抽屉 `active=light`、日间卡 `aria-pressed=true`；切回深色 `meta=#121110`、`primary=#B87B4C`、`heading=#F3E8D6`；书架卡片 `rgb(245,236,221)`、读谱工具栏 `rgb(252,248,241)`、记录当前柱 `rgb(143,85,44)`、调音器按钮渐变 `rgb(199,134,63)→rgb(143,85,44)`；`errors: []`。
- **Android 构建**：`npm run cap:sync` → `gradlew assembleDebug` BUILD SUCCESSFUL；`aapt` 确认 `versionCode 20` / `versionName 0.0.8.10`；`dexdump` 已含 `ThemeBarsPlugin`；APK 内含 `assets/public/js/services/theme.js`、`version.js`、`css/layout.css` 与 `assets/splash.html`。
- debug APK `5,133,204` 字节；SHA-256 `F1DA1EC0AF3A16C6DBF65251E02BFFD7F87AE422BCA8CD0BEF71071E33FFB29D`；debug 签名 v1 / v2 校验通过。
- 版本：网页 / SW `APP_VERSION = 0.0.8.10`；`package.json` / `package-lock.json` `0.0.8.10`；Android `versionCode 20` / `versionName 0.0.8.10`。
- **真机验收通过**：用户 2026-11-20 在手机上确认双主题与浅色系统栏效果良好，明确 `0.0.8.10` 作为 UI 终版冻结；Android 构建、APK 签名与浏览器回归一并通过。
- **发布**：代码与文档提交 `b9a0b17` 并推送 GitHub `main`，GitHub Pages 已上线 `APP_VERSION = 0.0.8.10`；GitHub Release `v0.0.8.10` 已上传 `GuitarShell-B1-spike-0.0.8.10-debug.apk`，重新下载 SHA-256 与本地一致，并已按真机确认转为正式 Release：`https://github.com/moanet/GuitarShell/releases/tag/v0.0.8.10`。

## 0.0.8.9 — 启动动画提速 + 蜗牛随机起点（已真机验收）

- **启动时长压缩**：真机反馈 `0.0.8.8` 的启动层 2.3 秒偏慢；`MainActivity` 显示时间改为 `1200ms`，淡出改为 `260ms`，总时长约 `1.46s`，落在 1–1.5 秒目标区间。
- **蜗牛随机起点**：`android/app/src/main/assets/splash.html` 的 `A_START` 由固定 `120°`（七点钟）改为 `Math.random() * 2π`，每次启动从轨道随机角度顺时针爬行；10 秒一圈、16 段渐隐拖尾、80° 实体段、0.45 不透明度、品牌文案与三点闪烁全部保持不变。首圈拖尾继续从随机起点裁剪，不会出现整圈亮起。
- **随机性验收**：浏览器连续重载 4 次，采样起点角度为 `-149.9°` / `91.4°` / `-52.1°` / `18.6°`，确认每次不同；启动页仍无滚动溢出，JS 错误列表为空。
- **Android 构建**：`npm run cap:sync` → `gradlew assembleDebug` BUILD SUCCESSFUL；`aapt` 确认 `versionCode 19` / `versionName 0.0.8.9`；APK 内含 `assets/splash.html` 与最新 `sheet-reader.js`；`classes4.dex` 已含 `MainActivity`。
- debug APK `5,102,363` 字节；SHA-256 `909EBA4D90F6A3E1993149B08F1DE3E5B46622322C316025E490206DA02E05CA`；debug 签名 v1 / v2 校验通过。
- 版本：网页 / SW `APP_VERSION = 0.0.8.9`；`package.json` / `package-lock.json` `0.0.8.9`；Android `versionCode 19` / `versionName 0.0.8.9`。
- **验收与发布**：按用户确认标记 `0.0.8.9` 实机验收通过；代码与文档提交推送 GitHub `main`。GitHub Release `v0.0.8.9`（Pre-release）已上传 `GuitarShell-B1-spike-0.0.8.9-debug.apk`，下载后 SHA-256 与构建产物一致：`https://github.com/moanet/GuitarShell/releases/tag/v0.0.8.9`。

## 0.0.8.8 — UI 终版：书架单行省略 + 附件终稿启动动画（已真机验收，启动时长由 0.0.8.9 修正）

- **书架标题单行省略**：`js/components/sheet-reader.js` 的 `.score-name` 从两行 clamp / `word-break: break-all` 改为 `display: block` + `width: 100%` + `white-space: nowrap` + `overflow: hidden` + `text-overflow: ellipsis`。超长文件名只占一行，尾部显示省略号；完整名称继续放在卡片 `title` 属性里，长按 / 悬浮可看全名。
- **书架验收**：390×844 下标题宽 `147px`、高 `17px`、`scrollWidth=504`、`clientWidth=147`，`whiteSpace=nowrap` / `textOverflow=ellipsis`；360×800 下宽 `132px`、高 `17px`，同为单行省略；卡片标签与书架布局不变。
- **启动动画终稿接入**：把 `splash-preview/splash-final.html` 复制为 `android/app/src/main/assets/splash.html`，保留轨道 G（`#A46B40`）、奶白蜗牛、16 段线性渐隐拖尾、10 秒一圈、从七点钟方向顺时针爬行、三点闪烁；布局改成全屏，适配安全区，不再显示 300×540 手机外框。
- **原生启动层**：`MainActivity` 在 Capacitor 加载应用的同时叠加全屏 WebView 动画层，显示 2.3 秒后以 380ms 淡出并销毁；动画层拦截触摸，加载期间不会误触底层页面；系统状态栏 / 导航栏同步 `#0E1013`，`AppTheme.NoActionBarLaunch` 背景改为深色，原 Capacitor 蓝色 X 启动图不再出现。
- **启动页验收**：390×844 下 `.phone` 为 390×844、SVG 226×226、`scrollWidth=390` / `scrollHeight=844`，无滚动溢出；蜗牛在 0.9 秒与 1.8 秒的 `transform` 不同，拖尾 16 条 path 正常；360×800 下 SVG 209×209、`scrollWidth=360`，无横向溢出；JS 错误列表为空。
- **Android 构建**：`npm run cap:sync` → `gradlew assembleDebug` BUILD SUCCESSFUL；`aapt` 确认 `versionCode 18` / `versionName 0.0.8.8`；APK 内含 `assets/splash.html`、`assets/public/js/components/sheet-reader.js` 与 `assets/public/sw.js`；`classes4.dex` 已含 `MainActivity` 与 `splash.html` 字符串。
- debug APK `5,102,350` 字节；SHA-256 `D1DEC29D8A54B7E3418F687358A7335FCD8041AED3E61E9ABDFDD4777DB99614`；debug 签名 v1 / v2 校验通过。
- 版本：网页 / SW `APP_VERSION = 0.0.8.8`；`package.json` / `package-lock.json` `0.0.8.8`；Android `versionCode 18` / `versionName 0.0.8.8`。
- **真机反馈**：书架长标题单行省略、启动动画视觉与系统栏衔接通过；唯一问题是启动层 2.3 秒偏慢，由 `0.0.8.9` 缩短到约 1.46 秒并改为随机起点。

## 0.0.8.7 — 数据管理归拢 + Android 原生备份（已真机验收）

- **数据管理全部收进设置抽屉**：本地备份、从文件恢复、清空乐谱与练习记录、云同步入口统一放在右侧全局设置里；读谱页顶部不再保留备份 / 恢复 / 云同步按钮。
- **云同步入口迁移**：设置抽屉「云同步」卡片点击后自动切到读谱页并打开原有坚果云 WebDAV 弹窗；账号、应用密码、路径、同步通道与冲突检测逻辑保持不变。
- **读谱书架精简**：书架态隐藏读谱工具栏，只保留「导入 + 搜索 + 排序 + 标签 + 书架」；导入按钮放在搜索行最左侧，移动端仍打开拍照 / 相册 / 文件选择，桌面端保留文件夹导入图标；打开谱面后工具栏只显示返回、打卡、存进度、书签。
- **顶部齿轮右对齐**：品牌行改为整行布局，齿轮固定在右上角，左右留白与 26px 品牌图标对称（390px 宽下均为 20px）；版本徽标留在标题旁。
- **Android 原生备份**：新增 `SaveBackupPlugin` 与 `MainActivity` 注册；API 29+ 用 MediaStore 写入 `Download/GuitarShell/`，API 22–28 申请 `WRITE_EXTERNAL_STORAGE` 后写入公共 Download；返回真实文件名、路径与 content URI。
- **修复「提示成功但没有文件」**：Android WebView 不处理 `<a download>` + blob，旧实现只有 toast。现在 `js/services/backup.js` 新增 `saveBackupFile()`，壳内走 `Capacitor.nativePromise('SaveBackup', 'save')`，网页端继续浏览器下载；设置抽屉成功后显示实际保存路径。
- **备份文件名**：增加秒级时间戳，改为 `GuitarShell-backup-YYYYMMDD-HHmmss.json`，避免连续备份同名覆盖；备份 schema 仍为 2，恢复格式不变。
- **Service Worker**：缓存清单补入 `settings.js` 与 `backup.js`，PWA 离线不会漏文件；`APP_VERSION` 与缓存名同步 `0.0.8.7`。
- **浏览器验收**：390×844 下版本徽标 `v0.0.8.7`；品牌图标左距 20px、齿轮右距 20px、齿轮 27px；书架工具栏 `display:none`，搜索行依次为导入 74px、搜索 164px、排序 104px，标签栏与书架正常；设置抽屉宽 344px，云同步卡片可见；点击云同步后自动切到读谱页且 `cloudModalMask` 为 `modal-mask show`；打开谱面后工具栏恢复，仅返回 / 打卡 / 存进度 / 书签；Android UA 下导入按钮打开 `action-sheet-mask show`，文件夹按钮隐藏；网页端 `saveBackupFile()` 正确回退为 `native:false` / 浏览器下载目录；JS 错误列表为空。
- **真机验收通过**：用户确认 `0.0.8.7` 实机验收通过，原生备份实际落盘、`Download/GuitarShell` 路径可见；设置抽屉数据管理 / 云同步入口、读谱书架精简、齿轮右对齐均通过。此前无连接设备时保留的 `SaveBackup` MediaStore 写盘风险已关闭。
- **Android 构建**：`npm run cap:sync` → `gradlew assembleDebug` BUILD SUCCESSFUL；`aapt` 确认 `versionCode 17` / `versionName 0.0.8.7`，`WRITE_EXTERNAL_STORAGE maxSdkVersion=28`，启动图标仍为 `res/mipmap-*/ic_launcher_gshell.png`；`classes4.dex` 已包含 `SaveBackupPlugin`。
- debug APK `5,125,523` 字节；SHA-256 `414A360C03210AB4C9345E88DD5D321FF52075A4E2AA8A5244205B3A35577F43`；debug 签名 v1 / v2 校验通过。
- 版本：网页 / SW `APP_VERSION = 0.0.8.7`；`package.json` / `package-lock.json` `0.0.8.7`；Android `versionCode 17` / `versionName 0.0.8.7`。
- **发布**：`0.0.8.7` 代码与文档已推送 GitHub `main`，GitHub Pages 已上线 `APP_VERSION = 0.0.8.7`；未创建 tag / Release。

## 0.0.8.6 — 全局设置抽屉 + 读谱热区缩小（已真机验收）

- **读谱翻页热区缩小**：`navPrev` / `navNext` 从原来的整屏高度（`top:56px; bottom:120px`）改为谱面中线附近 `170px` 高、`7%` 宽的短条，JS 按 viewer 高度居中定位；保留左右翻页点击，不再用大片灰色区域盖住谱面。左右热区继续 `outline:none` + 点按高亮透明。
- **全局设置抽屉**：顶部标题栏版本徽标右侧新增齿轮入口，打开右侧抽屉。抽屉含：
    - **数据管理**：本机乐谱 / 练习记录条数、当前存储占用；本地备份 JSON、从备份文件恢复、清空乐谱与练习记录（二次确认）。恢复 / 清空后广播 `gs-data-changed` 与 `log-updated`，读谱书架和练习记录页即时刷新。
    - **外观**：展示当前唯一的「复古木质 · 深夜琴房」主题与九色 token，为后续多主题切换预留位置。
    - **关于**：自有图标、产品定位、当前版本 `v0.0.8.6`，明确无账号、默认不上传云端。
- **备份服务抽离**：新增 `js/services/backup.js`，统一打包 / 下载 / 解析 / 恢复；保留既有备份格式（`APP_VERSION`、`BACKUP_SCHEMA=2`、scores base64 + logs），与读谱页旧备份完全兼容。
- **继承 0.0.8.5**：启动图标 G 已真机确认「非常完美」；木鱼音色、全局按钮 / 读谱箭头无蓝色选中框继续保留。
- **浏览器验收**：390×844 下版本徽标 `v0.0.8.6`；齿轮 27px、无 outline / 点按高亮；设置抽屉宽约 344px，读到 1 份乐谱 / 4 条练习，`v0.0.8.6`，页面无横向溢出；备份载荷 scores=1 / logs=4 且恢复往返成功，非法 JSON 正确报「备份文件不是有效 JSON」；读谱箭头热区实测 `170×27px`、垂直居中，`outline-style=none`、`-webkit-tap-highlight-color=rgba(0,0,0,0)`。
- **验收与发布**：用户已确认 0.0.8.6 实机验收通过；代码与文档随 `0.0.8.7` 一起提交推送 GitHub，未单独创建 tag / Release。
- 版本：网页 / SW `APP_VERSION = 0.0.8.6`；`package.json` / `package-lock.json` `0.0.8.6`；Android `versionCode 16` / `versionName 0.0.8.6`。
- **Android 构建**：`npm run cap:sync` → `gradlew assembleDebug` BUILD SUCCESSFUL；`aapt` 确认 `versionCode 16` / `versionName 0.0.8.6`，启动图标仍为 `res/mipmap-*/ic_launcher_gshell.png`。
- debug APK `5,091,753` 字节；SHA-256 `A5B276B56256B6BF264E9C1E1F5DF34E5C9F20596325F234559C11114F1A1BE9`；debug 签名 v1 / v2 校验通过；真机已验收。

## 0.0.8.5 — 启动图标 / 按钮选中框 / 木鱼音色修正（图标已真机验收）

- **修复 0.0.8.4 未通过项：Android 启动图标**：放弃自适应前景铺满方案（真机上 G 撑满、背景被 MIUI 染棕）；改为独立 legacy 资源 `@mipmap/ic_launcher_gshell` / `ic_launcher_gshell_round`，按截图右侧 `GShell` 比例把源图缩至约 95% 居中，G 约占图标 74%，四周保留近黑 `#0E1014` 留白，圆角半径约 22%；同时覆盖 mdpi / hdpi / xhdpi / xxhdpi / xxxhdpi，避开系统自适应背景着色。
- **清除按钮蓝色矩形选中框**：全局 `css/layout.css` 去掉按钮 focus-visible 琥珀 outline，改为 `button:focus, button:focus-visible { outline: none !important }` + `-webkit-tap-highlight-color: transparent`，并对 `html / body / *` 统一关闭点按高亮；`metronome.js` / `practice-log.js` / `tuner.js` / `sheet-reader.js` 四个 Shadow DOM 组件各自在样式顶部统一清除按钮、label、input、select 的 outline 与点按高亮。覆盖顶部四页切换、记录页“保存这次练习 / 练习趋势 / 近 7 天 / 近 12 月”、标题右侧版本徽标、读谱左右翻页热区 `div.nav-zone`（`navPrev` / `navNext`）及其他按钮。
- **节拍器音色**：`TIMBRES` 用“木鱼”替换“三角”；`audio.js` 新增 `woodblock` 独立合成（木腔双正弦共振 + 短带通噪声瞬态 + 75ms 指数衰减），不是仅改标签；`setTimbre` 接受 `woodblock`，旧存档 `triangle` 自动迁移；节拍器与读谱迷你节拍器共用，音色同步生效。
- **已在 0.0.8.4 真机验收通过并保留**：读谱单页提示“上次读到的位置”+ 2 秒停留；记录页默认“记录本次练习”+“练习记录列表”、“练习趋势”折叠、累计统计移入趋势底部；顶部标题栏 26px 自有品牌图标。
- **已推送**：`0.0.8.5` 代码、图标资源、README 与 CHANGELOG 已提交并推送 GitHub；测试 APK 继续本地交付，不创建 Release。
- 版本：网页 / SW `APP_VERSION = 0.0.8.5`；`package.json` / `package-lock.json` `0.0.8.5`；Android `versionCode 15` / `versionName 0.0.8.5`。
- **浏览器验收**：390×844 下版本徽标 `v0.0.8.5`；顶部四页切换、版本徽标、记录页保存 / 趋势 / 近 7 天 / 近 12 月、节拍器设置面板全部按钮、读谱书架 / 谱面工具栏按钮计算样式 `outline-style = none`、`-webkit-tap-highlight-color = rgba(0,0,0,0)`；读谱左右热区 `navPrev` / `navNext` 同时确认无 outline、点按高亮透明，全页蓝色高亮计数为 0；音色列表为“正弦 / 方波 / 木鱼”，`audioEngine.click({type:'woodblock'})` 无异常。
- **Android 构建**：`npm run cap:sync` → `gradlew assembleDebug` BUILD SUCCESSFUL；`aapt` 确认 `versionCode 15` / `versionName 0.0.8.5`，启动图标为 `res/mipmap-*/ic_launcher_gshell.png`（不再走 `mipmap-anydpi-v26` 自适应 XML）。
- debug APK `5,110,820` 字节；SHA-256 `4CE1F9B59ADC73C9049974A9E5E7C4994F40062E20B0D1A051FF53D7311BDAAE`；debug 签名 v1 / v2 校验通过；启动图标已真机确认通过。读谱左右箭头热区偏大，转 `0.0.8.6` 缩小。

## 0.0.8.4 — UI 细节修正第一版（图标未通过，已被 0.0.8.5 取代）

- **读谱恢复提示**：单页谱由“上次读到上次的位置”改为“上次读到的位置”；提示条显示后停留 2 秒自动收起，与底部“已恢复上次练习速度”提示一致；多页谱仍显示具体页码。
- **自有品牌图标**：顶部标题栏移除吉他 emoji，改用 `icon-gShell-192.png` 作为 26px 品牌图标；Android 使用 `icon-gShell-512.png` 重新生成 mdpi / hdpi / xhdpi / xxhdpi / xxxhdpi 的 `ic_launcher.png`、`ic_launcher_round.png` 与自适应前景 PNG；自适应背景色统一 `#0E1014`，移除默认白色 / 青色背景。
- **记录页排版**：默认只展示“记录本次练习”表单 + “练习记录列表”；原“累计打卡 / 累计分钟”大统计栏删除并收进趋势面板底部；“练习趋势”改为一行折叠栏，显示近 7 天 / 近 12 月摘要，点击展开图表、TOP 排行和累计统计；累计值字号 13px，与趋势标题一致。
- **浏览器验收**：390×844 下记录页默认 `trend-box collapsed`，统计元素高度 0；展开后图表 / TOP / 累计正常，`scrollWidth = 390`；读谱测试数据提示文案为“上次读到的位置 · 11月20日 13:40”，2 秒后 `display:none`；顶部图标 26×26，页面无 JS 异常。
- **未发布**：本轮只生成测试 APK，未提交、未推送 GitHub，等待真机确认。
- 版本：网页 / SW `APP_VERSION = 0.0.8.4`；`package.json` / `package-lock.json` `0.0.8.4`；Android `versionCode 14` / `versionName 0.0.8.4`。
- Android 构建：`npm run cap:sync` → `gradlew assembleDebug` BUILD SUCCESSFUL；`aapt` 确认 `versionCode 14` / `versionName 0.0.8.4`。
- debug APK `5,029,116` 字节；SHA-256 `C88C51EBC356CE3E242C094E443FB467A408D161C87A34AED020BDB927BCB274`；真机复测待确认。

## 0.0.8.3 — UI 复古木质重构（真机验收通过并推送）

- **视觉方向**：从赛博极客青绿风整体切到「复古木质 / 深夜琴房 / 咖啡馆」；取消青蓝、亮绿与霓虹发光，统一暖木、低饱和、大圆角。
- **9 色 token**：`--bg0 #121110`、`--bg1 #1E1B18`、`--line #2C2622`、`--primary #B87B4C`、`--secondary #F3E8D6`、`--accent #D99E6A`、`--txt #EAE3D9`、`--muted #8A8075`、`--success #6B8E23`、`--danger #B54A42`；`css/layout.css` 保留 `--cyan / --amber / --green / --red` 旧变量别名，避免组件样式断裂。
- **全局外壳**：深黑棕底 + 极淡木棕 / 橄榄径向光晕；header 深木棕渐变、暖色阴影；tabs 胶囊圆角、active 半透明木棕；toast、版本徽标、placeholder、滚动条、focus-visible 同步暖化；`theme-color` / manifest 背景改 `#121110`。
- **节拍器**：播放按钮木棕渐变、运行中铁锈红；拍点方块木棕 / 琥珀 / 奶白；旋钮轨道深木色，进度奶白 → 琥珀 → 木棕，手柄奶白光晕；设置面板、细分 / 拍号 / 音色、range、数字输入全部暖化。
- **调音器**：仪表深木面板；命中音名 / 指针 / 中心刻度橄榄绿；音分曲线琥珀；弦按钮、A4 校准、标准音、反馈按钮木棕 / 橄榄；开始按钮木棕渐变、停止铁锈红渐变。
- **读谱**：工具栏 / 筛选 / 卡片 / 弹窗全部木质化；主按钮与云同步木棕渐变；标签高亮半透明木棕 + 奶白文字；卡片 hover 木棕边框 + 暖阴影；迷你节拍器播放木棕渐变、圆环奶白 → 木棕、停止铁锈红。
- **练琴记录**：统计数字琥珀；打卡按钮木棕渐变；柱状图木棕、今日奶白；TOP 进度条深木 → 琥珀；输入框、分段切换、卡片、删除按钮统一木质调。
- **浏览器验收**：390×844 视口依次检查节拍器 / 读谱 / 记录 / 调音四页；版本徽标 `v0.0.8.3`，`body` 计算色 `rgb(18,17,16)`，四页 `scrollWidth = 390` 无横向溢出；打卡按钮、调音开始按钮均为木棕渐变。
- **真机验收**：用户确认 UI 复古木质重构通过；代码与 README 推送 GitHub。
- 版本：网页 / SW `APP_VERSION = 0.0.8.3`；`package.json` / `package-lock.json` `0.0.8.3`；Android `versionCode 13` / `versionName 0.0.8.3`。
- Android 构建：`npm run cap:sync` → `gradlew assembleDebug` BUILD SUCCESSFUL；`aapt` 确认 `versionCode 13` / `versionName 0.0.8.3`。
- debug APK `4,983,212` 字节；SHA-256 `0D8A8B8D0BC6A1C3307E5E90840351486750AA3AEFF590D29E6A73F5AE6175C1`；真机视觉效果待复测。

## 0.0.8.1 — C1b 原生插件通道修正（真机验收通过）

- **问题**：`0.0.8.0` 的 `wakelock.js` 只读取 `window.Capacitor.Plugins.KeepAwake`。零构建壳只注入 `native-bridge.js`，没有 `Plugins` 命名空间，原生路径会静默落空并回退 Web，原生 `FLAG_KEEP_SCREEN_ON` 实际不会生效。
- **修正**：`getNativePlugin()` 改为优先使用 `Capacitor.Plugins.KeepAwake`（若未来引入 `@capacitor/core`），否则使用 `Capacitor.nativePromise('KeepAwake', 'enable' / 'disable' / 'isEnabled', {})` 直连原生桥。
- **模拟壳验证**：临时把 `window.Capacitor` 设为 `isNativePlatform: () => true` 并提供 `nativePromise`，`acquire` 后 `mode=native / active=true`，调用记录为 `KeepAwake:enable`；`release` 后 `active=false`，调用记录追加 `KeepAwake:disable`。
- 版本：网页 / SW `APP_VERSION = 0.0.8.1`；`package.json` / `package-lock.json` `0.0.8.1`；Android `versionCode 12` / `versionName 0.0.8.1`。
- Android 构建：`cap:sync` → `gradlew assembleDebug` BUILD SUCCESSFUL；`aapt` 确认 `versionCode 12` / `versionName 0.0.8.1`。
- debug APK `4,982,163` 字节；SHA-256 `DD20784171785CEA6710FBA913CB70C92E90488D0A7053AEFDA7608E83A098A0`；真机常亮效果待复测。

## 0.0.8.0 — C1b 屏幕常亮首包（已被 0.0.8.1 取代）

- **新增常亮服务**：`js/services/wakelock.js` 统一管理屏幕常亮，按 reason 引用计数，允许节拍器 / 读谱 / 调音同时持有；`acquire` / `release` 幂等，`wakeLockState()` 供调试。
- **双路径**：壳内优先调用 Capacitor 原生插件 `KeepAwake`（Android `FLAG_KEEP_SCREEN_ON`）；原生不可用时回退 `navigator.wakeLock.request('screen')`。原生插件调用失败会标记并自动回退，不阻塞页面。
- **接入点**：节拍器 `start()` 申请 / `stop()` 与 `onStop` 释放；读谱 `openScore()` 申请 / `返回书架`、切走读谱页、组件卸载释放；调音 `isListening = true` 后申请 / `stopTuner()` 释放。
- **可见性恢复**：`visibilitychange` 时页不可见则释放，回到前台仍有 reason 则自动补申请；`pagehide` 清空 reason，避免冷启动残留。
- **原生层**：新增 `KeepAwakePlugin.java`（`enable` / `disable` / `isEnabled`），`MainActivity.onCreate()` 在 `super.onCreate()` 前注册；Manifest 补 `WAKE_LOCK`，用于 WebView 内 Web Wake Lock 回退路径。
- **未引入前台服务**：后台 / 锁屏节拍器已由 `0.0.7.2` 真机验证续响；本轮不再叠加 Android 14 前台服务类型 / 通知权限复杂度。`FLAG_KEEP_SCREEN_ON` 只作用于窗口，切后台不会继续耗电。
- 版本：网页 `APP_VERSION = 0.0.8.0`；`sw.js APP_VERSION = 0.0.8.0` 并补缓存 `js/services/wakelock.js`；`package.json` / `package-lock.json` `0.0.8.0`；Android `versionCode 11` / `versionName 0.0.8.0`。
- 浏览器验证：节拍器启动 `active=true / mode=web / reasons=['metronome']`，停止后 `active=false`；打开谱面 `reasons=['reader']`，返回书架清空；用合成音频流启动调音 `reasons=['tuner']`，停止 / 切页后清空；同时申请两个 reason 后只释放一个，常亮仍保持。
- Android 构建：`npm run cap:sync` → `gradlew assembleDebug` BUILD SUCCESSFUL；`aapt` 确认 `versionCode 11` / `versionName 0.0.8.0` 与 `WAKE_LOCK`；`dexdump` 在 `classes4.dex` 找到 `KeepAwakePlugin`。
- debug APK `4,981,896` 字节；SHA-256 `DAB9E4467D72F222B18FD71A01D241BED75C30F28DD14380CE5AB64A6167CD14`；真机常亮效果待复测。
- 已知问题：零构建壳没有 `Capacitor.Plugins` 命名空间，原生路径未真正生效；由 `0.0.8.1` 修正。

## 0.0.7.3 — B1-spike 体验修复（真机验收通过）

- **mini 节拍器步进**：`mmMinus` / `mmPlus` 此前只有按钮、没有事件绑定；现按 `±1 BPM` 步进，调用 `updateMmBpm()`，播放中同步 `mmHandle.setBpm()`，并广播 `bpm-changed` 给主节拍器。
- **提示音干扰**：调准“叮”触发后设 420ms 检测保护窗（覆盖 0.32s 音效尾音 + 扬声器/采集延迟）；窗口内 `updatePitch()` 直接跳帧，不采样、不清历史，指针和音分读数保持上一帧。
- **读谱全屏**：缩放列新增 `⤢ / ⤡` 全屏按钮，顺序为 `＋ / − / 全屏`；全屏用 `:host(.reader-fullscreen)` 固定层覆盖整个视口并隐藏工具栏，壳内跳过原生 Fullscreen API，避免 WebView reject / 闪退。
- **控件渐隐**：`＋ / − / 全屏` 与 mini 节拍器共用“谱面交互即 0.15 透明度、指针进入控件即实体化”的状态机；刚打开谱面保持实体化。
- 版本：网页 `APP_VERSION = 0.0.7.3`；Android `versionCode 10` / `versionName 0.0.7.3`；debug APK 5,009,621 字节，SHA-256 `1D863853C4FE5E7C712C1D1C5B3FDDD1AB9F64BADC00B049D5BCBC8B536A55F9`。
- 本地验证：mini 步进 `120 → 121 → 119`，播放中 handle 同步 `119 → 120 → 119`；合成麦克风采样确认提示音窗口内 `lastAnalysisAt` 冻结约 420ms 后恢复；594×891 全屏下工具栏 `display:none`、host 覆盖 `594×891`。
- B1-spike `0.0.7.2` 已在真机验收，后台 / 锁屏节拍器可持续发声；C1b 继续补常亮、长时 Doze 与音频焦点兜底。
- `0.0.7.3` 三项修复已真机复测通过。

## 0.0.7.2 — 标准音低音弦响度补偿（真机验收通过）

- 调音器标准音试听按弦号设置电平：E2 `0.36` / A2 `0.34` / D3 `0.30` / G3 `0.28` / B3 `0.25` / E4 `0.22`，低音 E/A 明显加强，高音 e 保持原响度。
- 低频弦（<140Hz）补入 2/3/4 次谐波；中频弦（140–220Hz）补入 2/3 次谐波，让手机小喇叭更容易推出可听的中频泛音。
- 网页端音频图实测 RMS：E2 `0.290`、A2 `0.275`、D3 `0.219`、G3 `0.206`、B3 `0.168`、E4 `0.148`，低音相对高音 e 提升约 5–6dB。
- Android `versionCode 9` / `versionName 0.0.7.2`；debug APK `4,976,609` 字节；SHA-256 `E38AC5D2D26E11A4D7CB8626D7E35153D5F6F4BDCA491CBF78AA5640E22ABCCC`。
- 提交 `81ceb95`，tag `v0.0.7.2`；GitHub Release 以 **Pre-release / 测试性质** 发布，资产 `GuitarShell-B1-spike-0.0.7.2-debug.apk`。

## 0.0.7.1 — B1-spike 真机反馈修复（已并入 0.0.7.2 推送）

真机测试集中反馈 5 个问题，均先改网页端再回灌 APK：

- **调音器标准音不响**：参考音改为基音 + 2/3 次谐音；试听前 `await audioEngine.resume()`，并用 `refEpoch` 防止连续点击 / 切页时旧异步恢复偷偷发声。网页端确认 `AudioContext` 为 `running`、Analyser 有信号；实际扬声器可听性留真机复测。
- **导入文件面板挤压**：`sheet-reader.js` 中卡片 22px 圆形按钮与底部操作面板的 `.action-btn` 样式冲突；拆为 `.card-actions .action-btn` / `.action-sheet .action-btn`。面板改为整行横排、`max-height:80vh` 可滚动、底部安全区。360px 下按钮 `320×55`。
- **节拍器圆形主体缩放**：`.practice-hud` 改为固定 `42px` 常驻占位，`.show` 只控制 `opacity/visibility`；HUD 文案压缩为 `Swing 50% · 变速 120→160 · 每2小节 · ⏳15分`。360px 下开关 HUD 前后 `knobCanvas` 均为 `656×656`（CSS 328px），`knobWrap` 高度不变。
- **云同步键盘遮挡**：弹窗顶部对齐 + 内部滚动、`max-height:100%`；`cloudUser/cloudPass/cloudPath/cloudBase` focus 后 `scrollIntoView`；viewport 补 `interactive-widget=resizes-content`，Android `MainActivity` 补 `adjustResize`。360×420 短视口下账号/密码仍在可视区。
- **读谱排序栏文字显示不全**：`.search-inp` 补 `min-width:0`；`.sort-sel` 补 `flex:0 0 auto; min-width:104px; max-width:42vw`。360px 下排序框右边界 `344px`，`最新添加` 完整显示。

## 0.0.7.0 — B0 打壳前体检 + B1-spike 预演包

### B0 打壳前体检（已验收，提交 `0800edc`，tag `v0.0.7.0`）

- **manifest 去写死**：`start_url` / `scope` 由 `/GuitarShell/` 改为 `./`；本地根目录、Pages 子目录与未来 APK 本地资源共用一份 manifest。模拟解析：Pages → `/GuitarShell/`，本地 → `/`。
- **SW 清单对齐**：删除未使用的 `base` 死代码；`ASSETS_TO_CACHE` 补入 `js/services/toast.js`。22 个有效缓存项全部存在；离线断网重载后四大模块仍可打开。
- **壳内 SW 策略**：检测到 `window.Capacitor.isNativePlatform()` 为真时跳过 Service Worker 注册，网页端继续注册，避免 APK 内“资源已本地打包又叠一层 SW 缓存”的双缓存风险。模拟壳测试注册调用 0 次、无 registration、应用正常加载。
- **统一轻提示**：新增 `js/services/toast.js`；调音器麦克风失败不再弹 `alert()`，改为停止已建立音轨、复位按钮为「🎤 开启麦克风」、状态文字转红并提示原因。7 条浏览器用例 PASS。
- **安全区**：header 增加 `env(safe-area-inset-top/right/left)`，`.view-section` 预留 `safe-area-inset-bottom`；360px 无横向溢出。
- **360px 结构审计**：四个 Tab 切换均无横向溢出；360×800 下 header 自动换行成 92px 两行；四个页面内容均可完整进入滚动区。窄屏视觉压缩留给 UI 终版，不在 B0 冻像素。
- **壳层风险决策**：manifest 相对路径 / SW 漏缓存 / 壳内双缓存 / WebView alert 割裂 / 安全区 / 键盘顶起 / IndexedDB 配额 / 锁屏音频；B0 只做网页端能验证的部分，真机项交给 B1-spike。

**壳层风险与决策清单**

| 风险 | B0 决策 | 验证状态 |
| --- | --- | --- |
| Pages 子目录 / 本地根目录 / APK 三套路径 | manifest 用相对 `./`，SW 缓存全部相对 SW 根 | ✅ 路径解析 + 本地离线重载通过 |
| SW 漏缓存导致离线白屏 | 缓存清单与实际 import 对齐，补 `toast.js` | ✅ 22 项缓存全部存在；断网重载四大模块可开 |
| APK 内资源已本地打包，再叠 SW 会双缓存 | 壳内跳过 SW 注册，网页端保留 | ✅ 模拟壳测试通过；真机 B1-spike 复核 |
| WebView 原生 `alert()` 割裂 | 麦克风失败改应用内 toast + 状态文字 | ✅ 7 条浏览器用例 PASS |
| 刘海 / 状态栏 / Home Indicator 遮挡 | header 与 view-section 预留 `env(safe-area-inset-*)` | ⏳ 360px 结构通过；真机 B1-spike |
| Android 返回键 / 键盘顶起 / 横竖屏 | 不在网页端假装通过，交给 B1-spike | ⏳ B1-spike |
| IndexedDB 配额 / 文件选择器 / 震动权限 | 记录为宿主风险，B1-spike 逐项实测 | ⏳ B1-spike |
| 锁屏 / 切后台音频焦点 | Web 端先保留现状，C1b 再做前台服务 | ⏳ C1b |

### B1-spike Capacitor 预演包（不发布）

- Capacitor 6.2.3 + Android API 34 + build-tools 34.0.0，包名 `cc.ccwu.guitarshell.spike`，应用名 `Guitar Shell`；权限 `INTERNET` / `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` / `VIBRATE`。
- Web 资源、`toast.js`、`sw.js` 打进 `assets/public`，壳内跳过 SW；debug APK 由 Gradle 8.7 构建。
- 本机 SDK `I:\Tools\android-sdk`；换机需改 `android/local.properties` 或设置 `ANDROID_HOME`。
- 真机待验收：麦克风权限与采样、PDF/图片导入、IndexedDB 配额、锁屏/切后台音频、震动、返回键、状态栏/安全区、键盘顶起。

## 0.0.6.5 — C5 UI 收尾（已验收推送，提交 `492f9c2`）

- 调音器「开启麦克风 / 停止调音」去掉点击高亮与焦点矩形，保留原蓝 / 红胶囊与光晕。

## 0.0.6.4 — C5b 调音器界面（已验收）

- A4 以 `− / 440 Hz / +` 步进 1Hz，430 / 450 边界自动禁用；改动即写入 `guitar_tuner_a4` 并重算六弦目标。
- 标准音按钮在选弦后可用，点击播 1.2 秒参考音；播放期间暂停检测，避免麦克风把扬声器参考音当成琴声。
- 音分曲线记录最近 10 秒偏差（±50¢），100ms 刷新，进入 ±5¢ 转绿。
- 自定义调准音效占位：`audio.js` 的 `CUSTOM_CHIME_URL` 留空，做好音效后放 `assets/` 并同步 `sw.js` 缓存。
- 17 条 C5b 用例 + 9 条六弦精度 / 节拍器共存用例 PASS；六弦逐弦偏差 ≤ 0.02 音分。

## 0.0.6.1～0.0.6.3 — C5a 调音器底层（并入 0.0.6.4）

- **0.0.6.1 YIN**：新建 `pitch.js`，自相关整体换 YIN（差分 → CMNDF → 首个谷 + 抛物线插值）；A4 支持 430–450 校准并写本机 `guitar_tuner_a4`，六弦目标频率由 MIDI 推算、不再写死；`nearestNote` 输出音名 / 八度 / 音分；RMS 门限、置信度 ≥ 0.6、5 帧中值滤波、30fps 节流。
- **0.0.6.1 低音 E2 尾音修复**：基频衰减、二次谐音占主导时，164.8Hz 会被 `foldToGuitarFundamental()` 折回 82.4Hz，自动模式不再跳成 D3、手动 E2 不再误报偏高；停声 500ms 后清空旧读数。31 条 Node 用例 + 20 条浏览器全链路 / 低音衰减复现 PASS。
- **0.0.6.2 离页关麦**：监听 `app-tab-changed`，切离调音页立即关麦、断开分析器、复位按钮与读数；`stopEpoch` 防止「刚点开启就切页」时异步权限回来又偷偷启动。
- **0.0.6.2 / 0.0.6.3 调准反馈**：进入 ±5 音分时播 2093Hz + 4186Hz、0.32 秒衰减的“叮”（与节拍器 60ms 的“哒”区分），并 `navigator.vibrate(50)`；只在刚进入音准区触发，1.2 秒内不重复。提示音 / 震动各有开关，存 `guitar_tuner_feedback_sound` / `guitar_tuner_feedback_vibrate`；不支持震动时按钮置灰。15 条浏览器用例 + 4 条音色用例 PASS。

## 0.0.6.0 — C1a 页级书签 + C4 节拍器满血（已验收推送）

- 页级书签：阅读态「🔖 书签 N」；按页升序显示页码 + 时间，点行跳页并关面板，可单删；同页刷新时间，上限 30 条；存 `bookmarks: [{page, at}]`，随备份 / 云同步。
- 节拍器设置四组：逐拍重音（四态循环 + 圆点着色，静音占拍位）、Swing（0.5 → 0.75）、变速练习（起始 → 目标，每 N 小节递增，**到目标后保持 N 小节再停**）、倒计时（1～180 分钟）。
- HUD 一行摘要（含目标保持进度）；迷你节拍器同步重音 / Swing。
- 33 条 UI + 14 条引擎 + 6 条迷你同步用例 PASS；0.0.6.0 追加 11 条「保持 N 小节」用例 PASS。
- README 全面重构：架构 / 盘点 / 迭代 / 看板归档。

## 0.0.5.15 — C1a + C4（并入 0.0.6.0）

- 页级书签；节拍器逐拍重音 / Swing / 变速 / 倒计时 / 迷你同步。

## 0.0.5.14 — C3 练习趋势（已推送，提交 `4dccd2e`）

- 近 7 天 / 近 12 月手写 SVG 柱状图、今天 / 本月高亮、汇总、TOP5；窄屏可收起，状态存 localStorage。17 条用例 PASS。

## 0.0.5.13 — C2 找谱（已推送，提交 `bcdf253`）

- `pinyin.js` 覆盖 U+3400～U+9FFF 共 27648 字，纯本地；搜索支持中文 / 英文 / 拼音首字母子序列；标签改多选 AND。13 条用例 PASS。

## 0.0.5.12 — B4 PDF 内存（已推送，提交 `acc2e89`）

- 所有页先建 `aspect-ratio` 占位；只保留可见页 ±3 的位图，滚出即 `canvas.width=0` + `page.cleanup()`；位图密度按实际宽度 × min(DPR,2)；渲染串行可取消，关谱 `pdf.destroy()`。
- 实测 40 页首页只活 4 页 11.8MB，滚到第 30 页只保 7 页。

## 0.0.5.11 — B2 音频引擎（已推送）

- 抽出 `audio.js` 单例：共享 `AudioContext` + `masterGain`；节拍只保留一份 lookahead；每路独立总线，停止即静音，掐掉已排队的 100ms 尾音；`setBpm` 把下一拍往回收；调音器改用 `openAnalyser()`，不再 `close()`。

## 0.0.5.10 — B3 入口清理（已推送，提交 `8adc92f`）

- 去掉重复的 `loadComponents()`、`<meta>` 全部回 `<head>`、静态资源只留一份；图标 / manifest / 样式去重。

## 0.0.5.7～0.0.5.9 — A 数据闭环（已推送）

- **云同步多通道**：本地代理（仅 http 调试页）→ 自建域名 `dav.noamet.ccwu.cc` → workers.dev；用户手填通道最高优先，超时 / 5xx 自动换线，全失败才报错。
- **冲突检测**：同步成功后按备份路径存「时点 + etag」；上传前 `stat()` 比对，云端变过就提示；下载前用 `getLocalChangeStamp()` 判断本地是否动过。
- **空备份保护**：0 谱 0 记录时强提示将被清空的数量，取消即不写库。
- **载荷规范化**：`version` 取 `APP_VERSION`、新增 `schema`、恢复前校验结构；补「备份版本 + 文件名转义」。
- **应用密码**：`vault.js` AES-GCM 加密，密钥不可导出、独立库存储；明文不进 localStorage / 备份 / 日志。
- 验收：手机 4G + 电脑「覆盖本地」全链路通过；A 机上传 → B 机再上传弹出「云端被改过」。

## 0.0.5.6 — 基线

- 四大模块可用：节拍器 / 读谱 / 记录 / 调音；阅读进度双轨制成形。

## 历史专题：阅读进度双轨制

- 旧版「返回书架存 scrollTop」有三重问题：iframe 内滚动父级读不到、药丸读书架旧快照、像素值换缩放 / 设备即失效。
- 现方案：统一 Canvas 渲染；存「页码 + 页内比例 + scrollY + 时间戳」；手动档（📍 / 打卡勾选）+ 弱自动档（返回书架必存、每 5 分钟静默存，切走 tab 不写）；打开谱现取最新记录；药丸按页码 + 比例精确跳转；打卡日志带页码；备份 / 恢复 / 云同步共用同一份载荷。
