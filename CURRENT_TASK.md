# CURRENT_TASK — 0.1.12b 书架滚动、禅定锁滚与工具栏让位

> 状态：已构建并真机验收，待用户试用确认
> 更新时间：2026-11-24
> 版本基线：`0.1.12a` / `versionCode 115`
> 目标版本：`0.1.12b` / `versionCode 116`

## 1. 背景

`0.1.12a` 已在本机完成透明禅定与长按解锁。真机试用后仍有三处不符合实际使用：

1. 乐谱书架把所有谱都挤进一屏。文件多时卡片被压缩，封面被挤扁，书名与“图片 / PDF · 1 页”类型提示被裁掉；书架不能独立上下滑动。
2. 进入禅定后，手指仍能滑动谱面，电脑鼠标滚轮也能滚动，锁定不彻底。
3. 禅定时阅读页上方“返回 / 打卡 / 存进度 / 书签 / 拆分”工具栏只是隐藏，留下整条空白；长谱、多页谱没有把这块纵向空间用起来。

## 2. 本版范围

### 2.1 书架可滚动与卡片尺寸

- 书架 `.shelf-view` 成为独立纵向滚动容器：`flex:1`、`min-height:0`、`overflow-y:auto`，滚动不带动外层页面。
- 手机宽度 ≤640px 固定 2 列；≤340px 单列；桌面保持自适应多列。
- 卡片改为横向信息卡：左封面、右书名 / 类型 / 标签。
- 封面固定 `84px` 宽、3:4 比例，不再被网格压缩。
- 卡片 `box-sizing:border-box` 且 `min-height:148px`，禁止 CSS Grid 在条目多时把卡片压成只剩内边距的细条；这是书架能真正撑出滚动高度的关键。
- 书名 13px、最多两行、左对齐；类型 10px 紧随其下；标签完整显示。点击、编辑、删除、管理模式逻辑不变。

### 2.2 禅定完全锁定滚动

- `zenLocked` 时拦截 `wheel`、`touchstart`、`touchmove`、`pointerdown`、`pointermove`，不再手动改 `scrollTop / scrollLeft`。
- `:host(.zen-active) .viewer` 使用 `overflow:hidden` 与 `touch-action:none`，从 CSS 层阻断触屏与鼠标滚动。
- 键盘翻页、缩放、全屏、Esc、空格节拍器在锁定期继续被拦截。
- 轻点浮出解锁条、长按 1.5 秒解锁、`L` 短按进入 / 长按解锁的行为保持不变；解锁后滚动与工具栏恢复。

### 2.3 禅定时折叠阅读工具栏

- `:host(.zen-active) .toolbar { display:none !important; }`，工具栏不再占位，阅读区整体上移。
- `content-container` 上下内边距收紧到 8px，长谱 / 多页谱获得更多纵向可视面积。
- 缩放控件、迷你节拍器、相邻谱切换热区、进度横幅继续隐藏。

## 3. 验收标准

- 书架 2 列；每张卡片的书名、类型与标签完整可见，封面保持 3:4，不出现压迫或裁切。
- 卡片高度不低于 140px；条目超过一屏时 `.shelf-view` 的 `scrollHeight > clientHeight`，手指上滑 / 下滑可到列表顶部与底部，外层栏目不跟着动。
- 禅定下工具栏 `display:none`，谱面顶部上移到 App 头部下方。
- 禅定下 `viewer` 为 `overflow:hidden` / `touch-action:none`；手指上滑、鼠标滚轮均不改变 `scrollTop`。
- 禅定轻点浮出解锁条，长按 1.7 秒解锁；解锁后工具栏和正常滚动恢复。
- `npm run check` 通过；`gs_022.py` 在 360 / 320 通过，新增卡片高度与书架可滚动断言。
- 真机 `ca14b16` 覆盖安装 `0.1.12b / 116`，原书架与练习数据保留。

## 4. 不做

- 不改 PDF / 图片 / TXT / Markdown / ChordPro 解析与渲染。
- 不改 DB、备份、云同步 schema。
- 不做禅定下的自动滚屏、翻页手势或滚动解锁；本版按确认结果完全锁滚。
- 不重做书架筛选、排序、标签、批量管理逻辑，只改布局与滚动。

## 5. 发布

- 版本同步：`package.json`、`package-lock.json`、`js/services/version.js`、`sw.js`、`android/app/build.gradle`、README 徽标。
- 构建 release APK，校验 `versionCode 116` / `versionName 0.1.12b`、v1 / v2 签名、SHA-256。
- 更新 `CHANGELOG.md` / `TASK.md`，提交并推送 `main`；GitHub Release 是否创建按用户当次要求执行。

## 6. 验收结果

- `npm run check` 通过：`v0.1.12b，32 个 JS 文件，SW 缓存与版本一致`。
- `gs_022.py` 在 360 / 320 通过；新增断言 `cardHeight = 148`、书架 `canScroll = true`、`scrollTop = 160`、禅定 `toolbarDisplay = none`、`viewerOverflow = hidden`、`viewerTouchAction = none`、滚轮前后 `scrollTop` 不变。
- release APK `4,429,070` 字节 / SHA-256 `8DC2893860C5DA518C5018C4D3B97FA84491AD298D8C3D0E58884F12871322BF`；`versionCode 116` / `versionName 0.1.12b`，证书 SHA-256 保持 `CA6D27B23E55E5009B6E27C3918ED08C87CE4ED2AEC7FFF65E3C2F461715AC4E`。
- 真机 `ca14b16` 覆盖安装成功，原谱与练习记录保留；书架徽标 `0.1.12b`。
- 真机书架：2 列、4 行，首屏约 8 张；书名两行、类型和标签完整显示，封面 84×112。导入 14 张谱后书架可在列表顶部与底部之间自由上下滑，卡片不再被压扁。
- 真机禅定：工具栏整条消失，谱面上移；执行上滑手势前后画面一致，点击浮出“长按 1.5 秒解锁”，长按解锁后工具栏恢复。
- 浏览器桌面验证：60 张谱时卡片仍为 148px，书架 `scrollHeight 4814 > clientHeight 610`，设置 `scrollTop` 可滚动。
- 临时 4 张“溢出测试”谱已从书架批量删除，真机 Download 目录中的临时测试文件已清理。
