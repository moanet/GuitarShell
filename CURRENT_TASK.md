# CURRENT TASK — 0.1.8 阅读工具栏、双指缩放与统一返回层级

> 状态：开发完成；浏览器 320 / 360 回归通过；release APK 已安装到测试设备，返回层级与弹窗行为已实机验证；双指缩放的真机手感待用户手动确认；已提交 `main`，按用户要求不发布 Release
> 更新时间：2026-11-23
> 版本基线：线上 Release 为 0.1.6；0.1.7 已提交 main，未发布
> 关联：[TASK.md](TASK.md)（项目总账） / [CHANGELOG.md](CHANGELOG.md)（发布历史）

本文件只记录当前版本的“做什么、怎么做、怎么验收”。发布后把结果压缩进 `CHANGELOG.md`，再重写本文件进入下一版。

0.1.7 的完整记录已归档到 [docs/archive/CURRENT_TASK-0.1.7.md](docs/archive/CURRENT_TASK-0.1.7.md)。

## 1. 目标

0.1.8 只做用户确认过的四项交互收口，不改其他功能：

1. **阅读页工具栏**：改成单行五段式操作条，`返回书架` 改名 `返回`，统一视觉，320/360 宽不换行、不溢出。
2. **双指缩放**：手机阅读页补上双指捏合缩放，保持缩放锚点，避免谱面跳回左上角。
3. **弹窗外点关闭**：补齐缺失的遮罩点击关闭；表单有改动时先确认“放弃本次编辑”。
4. **返回层级**：系统返回键/手势按层级关闭弹窗、抽屉、子页面，只有四个顶层 Tab 且无子层时才退出应用。

相册导入的原生 Photo Picker 方案单独放到 0.1.9，本版不实现。

## 2. 方案

### 2.1 阅读页工具栏：单行五段式

- 工具栏改 `display:flex; flex-wrap:nowrap`，5 个按钮等宽 `flex:1 1 0`，禁止换行。
- 每个按钮改为“图标在上、短标签在下”的竖向结构，高度约 46–48px，标签 11–12px。
- 文案固定为：`返回 / 打卡 / 存进度 / 书签 / 拆分`。
- `拆分` 只在 `.pdf` 时显示；图片谱 4 个按钮自动等宽，不保留空位。
- 统一视觉：同一套透明/细描边底、图标和标签同一颜色体系；按下态只做轻微背景变化，不再混用灰底、绿底、棕橙渐变、透明描边四种样式。
- 图标使用统一线性 SVG，不再使用 emoji。
- 320 宽按左右各 12px、按钮间距 6px 计算，单按钮约 54px，3 字标签可放下。

### 2.2 双指缩放

- `viewer` 增加 `touchmove` 监听，`passive:false`。
- 两指时 `preventDefault()`，按当前距离/初始距离计算缩放比例，`scale` 限制在 `1..6`，调用现有 `applyScale()`。
- 缩放锚点取双指中点对应的内容坐标，缩放后调整 `scrollLeft/scrollTop`，保持手指下的谱面位置。
- `touchend/touchcancel` 清空初始距离与初始缩放；单指不进入缩放分支。
- PDF 位图重渲继续依赖现有 `refreshPdfResolution()` 防抖，不在 `touchmove` 每帧强制同步重渲。
- 320 / 360 宽均需验证缩放值变化、滚动位置稳定、单指拖动不回归。

### 2.3 统一遮罩与层级栈

新增 `js/services/ui-layer.js`，作为所有浮层的唯一注册中心：

- `registerLayer({ id, close, isDirty? })`：打开时注册，返回取消注册函数。
- `closeTopLayer()`：关闭最上层；`close` 必须复用各弹窗已有的关闭函数。
- `getLayerDepth()`：当前层数。
- 每次层数变化调用原生 `BackGuard.setLayerDepth({ depth })`。
- `bindBackdrop(mask, close)`：统一外点关闭；`pointerdown` 记录起点是否在遮罩上，`pointerup` 仍在遮罩才关闭，避免从弹窗内部拖到遮罩误关。

层级顺序（从顶层到底层）：

1. 全局确认框
2. 拆分页码选择器
3. 拆分弹窗
4. 导入动作面板 / 记录练习 / 编辑信息 / 标签 / 云同步 / 节拍器设置
5. 设置抽屉
6. 阅读全屏
7. 阅读页
8. 书架管理模式
9. 四个顶层 Tab

规则：

- 外点关闭、取消按钮、系统返回、`Esc` 共用同一个 `close`。
- 嵌套弹窗只关最上层；拆分页码选择器打开时先关 picker。
- 表单脏状态：
  - 记录练习、编辑乐谱信息、拆分建卡：检测到输入改动时，外点/返回先弹一次“放弃本次编辑？”；未改动直接关闭。
  - 标签、云同步等短表单：直接关闭，不额外确认。
- 云同步弹窗外点关闭只隐藏弹窗，不取消后台任务；浮动状态胶囊继续保留。
- `splitBusy` 时关闭拆分弹窗被拒绝，返回键应被吞掉，不退出应用。

### 2.4 原生返回拦截

- `BackGuardPlugin` 增加 `setLayerDepth` / `getLayerDepth`，维护 `layerDepth`。
- `MainActivity.onBackPressed()` 逻辑：
  1. `layerDepth > 0`：向 WebView 派发 `gs-back-request`，不退出应用。
  2. `layerDepth == 0 && busy`：派发 `gs-cloud-exit-request`，保持 0.1.7 的云同步退出确认。
  3. 其他：`super.onBackPressed()`，退出应用。
- `main.js` 监听 `gs-back-request`，调用 `closeTopLayer()`；若层栈为空则把原生 depth 归零，避免状态卡死。
- 阅读页返回复用现有 `btnBack` 的保存进度逻辑；全屏先退出全屏；管理模式返回只退出多选。

### 2.5 0.1.9 预留

- 原生 `GalleryPickerPlugin`：Android 13+ `ACTION_PICK_IMAGES`，12 以下回退 `ACTION_OPEN_DOCUMENT`/`ACTION_GET_CONTENT`。
- 一次最多 20 张；选中 URI 复制到缓存，返回路径，JS 用 `Capacitor.convertFileSrc` 取 Blob 后复用 `handleFiles`。
- 0.1.8 不做，避免和返回层级、手势改动混在一起。

## 3. 改动范围

- `js/services/ui-layer.js`：新增层级注册、外点关闭、原生深度同步。
- `js/main.js`：监听 `gs-back-request`，初始化层级状态。
- `js/components/app-dialog.js`：注册全局确认框层级；busy 时禁止关闭。
- `js/components/settings.js`：设置抽屉注册层级，外点关闭复用 `close()`。
- `js/components/metronome.js`：节拍器设置面板注册层级，补外点关闭。
- `js/components/sheet-reader.js`：工具栏、双指缩放、全部弹窗层级、外点关闭、脏确认、阅读页/管理模式返回。
- `android/.../BackGuardPlugin.java`：`setLayerDepth` / `getLayerDepth`。
- `android/.../MainActivity.java`：按层级派发 `gs-back-request`。
- `tests/browser/gs_018.py`：0.1.8 交互回归。
- 版本号同步为 `0.1.8`，`versionCode 108`；不创建 tag、不发布 Release。

## 4. 验收标准

### 4.1 阅读页工具栏

- [x] 320 / 360 宽下 5 个按钮单行显示，不换行、不横向溢出。
- [x] 文案为 `返回 / 打卡 / 存进度 / 书签 / 拆分`。
- [x] 图片谱隐藏 `拆分`，其余 4 项等宽。
- [x] 5 个按钮视觉统一，无灰/绿/棕橙/透明四种底色混用。
- [x] 按钮可点，阅读页打开/返回不回归。

### 4.2 双指缩放

- [x] 两指捏合可放大/缩小，缩放值限制在 `1..6`。
- [x] 缩放时手指中点下的谱面位置保持稳定，不跳回左上角。
- [x] 单指拖动、翻页热区、滚轮缩放不回归。
- [x] `touchend/touchcancel` 后再次捏合可重新开始。

> 双指缩放已由 `gs_018.py` 合成双指事件验证；测试机未开放 `/dev/input` 写入，无法脚本模拟真实双指，手感需用户在设备上再捏合确认。

### 4.3 外点关闭与脏确认

- [x] 导入动作面板、记录练习、编辑信息、云同步、节拍器设置均支持点遮罩关闭。
- [x] 从弹窗内部拖到遮罩不会误关。
- [x] 记录练习、编辑信息、拆分建卡有改动时，外点先弹“放弃本次编辑？”；未改动直接关闭。
- [x] 取消确认后弹窗保持，输入内容不丢。
- [x] 云同步弹窗外点关闭不取消后台任务。
- [x] 拆分 `busy` 时外点/返回不会强行关闭。

### 4.4 返回层级

- [x] 阅读页按系统返回回书架，不退出应用；返回前保存进度。
- [x] 阅读全屏按返回先退出全屏，再回书架。
- [x] 管理模式按返回退出多选，不回书架。
- [x] 设置抽屉、节拍器设置、导入动作面板、各弹窗按返回关闭最上层。
- [x] 拆分页码选择器打开时，返回先关 picker，不关拆分弹窗。
- [x] 云同步弹窗打开时，返回先关弹窗；再按一次才按 0.1.7 逻辑处理同步中退出确认。
- [x] 四个顶层 Tab 且无任何子层时，返回才退出应用。
- [x] 连续快速返回不会误退出、不会卡死层级。

### 4.5 工程检查

- [x] `npm run check` 通过。
- [x] `python -m compileall -q tests/browser` 通过。
- [x] `python tests/browser/gs_018.py` 通过；`GS_WIDTH=360` 同样通过。
- [x] release APK 构建通过，包名、版本、签名、SHA-256 校验通过。
- [x] APK 覆盖安装到测试设备，版本显示 `0.1.8`。
- [x] 真机验收通过后提交 main；不创建 tag、不发布 GitHub Release。

### 4.6 验收记录（2026-11-23）

- `npm run check`：`检查通过：v0.1.8，28 个 JS 文件，SW 缓存与版本一致`。
- `python -m compileall -q tests/browser` 通过；`gs_015.py`、`gs_016.py` 复跑通过。
- `gs_018.py` 在 320 / 360 宽通过：工具栏 5 项同排、高 46、宽 54 / 62；双指合成事件缩放 `1.83`，滚动锚点生效；无改动外点关闭、脏确认与取消保留、详情空白框修复、书签/拆分 picker/阅读页/管理模式返回层级全部符合。
- release APK：`4,364,875` 字节，`versionCode 108` / `versionName 0.1.8`，包名 `com.guitarshell`，`minSdk 22` / `targetSdk 34`，v1 / v2 签名通过，证书 SHA-256 `CA6D27B23E55E5009B6E27C3918ED08C87CE4ED2AEC7FFF65E3C2F461715AC4E`。
- SHA-256 `5A1538181F9B90A7C2B0F2F66752C287958C5C40D4C27A8E5A6C9C924F0699A4`；本地路径 `dist/GuitarShell-0.1.8-release.apk`；APK 内 `assets/public/sw.js` 为 `APP_VERSION = '0.1.8'`。
- 设备 `ca14b16` 覆盖安装成功，系统显示 `versionCode=108` / `versionName=0.1.8`，书架徽标 `v0.1.8`。
- 实机返回：阅读页 → 书架、书架 → 桌面均正确；打卡弹窗无改动时返回只关弹窗，填写时长后返回弹「放弃本次记录？」，放弃后回阅读页。
- 实机截图复核：五段式工具栏单行等宽；修复后的放弃确认框不再出现空白详情横框。
- 双指缩放真机手势未脚本化（`sendevent` 被系统权限拒绝），以浏览器合成双指事件 + 代码审查作为本轮证据，保留用户手动捏合复核。

## 5. 风险与边界

- 原生层数只反映“JS 注册的浮层”，不直接检查 shadow DOM；JS 关闭失败时层数可能保持，返回键表现为“吞掉”，不会误退出。
- 表单脏确认会多一步，但只在检测到实际改动时出现；未改动仍是一点即关。
- 双指缩放依赖 JS 接管，`touch-action` 仍保留 `pan-x pan-y`，不能改成 `none`，否则单指拖动会失效。
- 相册导入仍保持 0.1.7 现状：Android WebView 可能把 `image/*` 落到文件选择器；0.1.9 才修。
- 不新增权限、不改云同步协议、不改 PDF 渲染虚拟化策略。
