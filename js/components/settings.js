// ==========================================
// js/components/settings.js
// 全局设置抽屉：数据备份 / 恢复 / 清空 + 当前主题 + 关于
// Shadow DOM 隔离，抽屉固定在视口右侧，不参与页面布局
// ==========================================

import { APP_VERSION, BUILD_STAMP } from '../services/version.js';
import { showToast } from '../services/toast.js';
import { dbService } from '../services/db.js';
import { getTheme, setTheme, onThemeChange, syncThemeImages } from '../services/theme.js';
import { showConfirm } from './app-dialog.js';
import { registerLayer, bindBackdrop } from '../services/ui-layer.js';
import {
  buildBackupPayload, getDataStats, parseBackupFile, restoreBackup, saveBackupFile
} from '../services/backup.js';
import {
  clearCoverCache, clearOrphanAssets, collectStorageStats, ensurePersistentStorage,
  findOrphanAssets, formatBytes
} from '../services/storage-stats.js';
import { icon } from '../services/icons.js';
import { CloudSyncController } from './cloud-sync.js';

// 当前两套主题；未来新增主题只在数组末尾追加一项，设置页网格自动排下一行。
// 真正启用新主题仍需同步扩展 theme.js 的白名单、系统栏颜色与图标资源。
const THEME_OPTIONS = [
  { id: 'deep', name: '深夜琴房', swatch: 'swatch-dark' },
  { id: 'light', name: '暖纸日光', swatch: 'swatch-light' }
];

const themeChoicesHTML = THEME_OPTIONS.map((option) => `
  <button class="theme-choice" data-theme-choice="${option.id}" type="button" aria-pressed="false">
    <span class="swatch ${option.swatch}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <span class="theme-copy"><b>${option.name}</b></span>
  </button>
`).join('');

const settingsCSS = `
  :host { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  input, textarea, select, [contenteditable="true"] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
  button, label, input, select { outline: none !important; -webkit-tap-highlight-color: transparent !important; }
  :host, * { box-sizing: border-box; -webkit-tap-highlight-color: transparent !important; }
  :host {
    position: fixed; inset: 0; z-index: 1000; pointer-events: none;
    font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", -apple-system, sans-serif;
    color: var(--txt);
  }
  .mask {
    position: absolute; inset: 0; display: flex; justify-content: flex-end;
    background: var(--mask); backdrop-filter: blur(3px);
    opacity: 0; pointer-events: none; transition: opacity .24s ease;
  }
  .mask.show { opacity: 1; pointer-events: auto; }
  .drawer {
    width: 80vw; max-width: 360px; height: 100%; display: flex; flex-direction: column;
    touch-action: pan-y;
    background:
      radial-gradient(560px 260px at 100% -8%, rgba(var(--primary-rgb), .13), transparent 66%),
      linear-gradient(180deg, var(--drawer-a), var(--drawer-b));
    border-left: 1px solid var(--drawer-border);
    box-shadow: -24px 0 60px var(--shadow-color);
    transform: translateX(100%); transition: transform .28s cubic-bezier(.2,.8,.2,1);
  }
  .mask.show .drawer { transform: translateX(0); }
  .head {
    padding: calc(14px + env(safe-area-inset-top)) 14px 14px;
    border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 10px;
  }
  .head-copy { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 20px; line-height: 1.2; color: var(--heading); letter-spacing: .4px; }
  .close {
    position: relative;
    flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--txt); font-size: 19px; line-height: 1; cursor: pointer;
    display: grid; place-items: center;
  }
  .close::after { content: ''; position: absolute; inset: -6px; border-radius: 50%; }
  .close:active { background: var(--surface-hover); }
  .close:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 12px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; }
  .card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 16px; padding: 12px; }
  .card-head { display: flex; align-items: center; gap: 8px; min-height: 36px; margin-bottom: 10px; }
  .fold-head {
    position: relative;
    width: 100%; min-height: 40px; display: flex; align-items: center; gap: 8px; margin: 0; padding: 0;
    border: 0; background: transparent; color: inherit; font-family: inherit; text-align: left; cursor: pointer;
  }
  .fold-head::after { content: ''; position: absolute; inset: -2px 0; border-radius: 8px; }
  .card-head .ico, .fold-head .ico { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 8px; background: rgba(var(--primary-rgb), .14); color: var(--accent-text); font-size: 13px; flex-shrink: 0; }
  h3 { margin: 0; font-size: 13px; font-weight: 700; color: var(--heading); letter-spacing: .4px; white-space: nowrap; flex-shrink: 0; }
  .fold-value {
    margin-left: auto; min-width: 0; max-width: 58%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 11.5px; font-weight: 600; line-height: 1.4; color: var(--txt-soft); font-variant-numeric: tabular-nums;
  }
  .fold-value b { color: var(--accent-text); font-weight: 700; }
  .fold-value .sep { margin: 0 5px; color: var(--muted-soft); font-weight: 400; }
  .fold-value.metrics { white-space: normal; line-height: 1.25; display: flex; flex-wrap: wrap; justify-content: flex-end; }
  .fold-value.metrics .metric { white-space: nowrap; }
  /* 320 宽：数据标题与统计上下排，保持 40px 行高、完整计数与单行说明 */
  @media (max-width: 340px) {
    #btnToggleData {
      display: grid; grid-template-columns: 24px 1fr 16px; grid-template-rows: 17px 16px;
      column-gap: 8px; align-content: center; height: 40px;
    }
    #btnToggleData .ico { grid-row: 1 / 3; }
    #btnToggleData h3 { grid-column: 2; grid-row: 1; align-self: end; }
    #btnToggleData .fold-value.metrics {
      grid-column: 2; grid-row: 2; display: block; width: auto; max-width: none;
      justify-self: end; white-space: nowrap; overflow: visible; text-overflow: clip; line-height: 1.4;
    }
    #btnToggleData .chev { grid-column: 3; grid-row: 1 / 3; }
  }
  .fold-note { margin: 4px 2px 0; font-size: 10.5px; line-height: 1.5; color: var(--muted); }
  .fold-body { margin-top: 10px; }
  .chev { width: 16px; text-align: center; color: var(--muted); font-size: 10px; flex: 0 0 auto; transition: transform .2s; }
  .fold-card.open .chev { transform: rotate(180deg); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .act {
    position: relative;
    width: 100%; min-height: 40px; border-radius: 12px; border: 1px solid var(--line-strong); background: var(--surface-raised);
    color: var(--txt); font-size: 12px; font-weight: 700; font-family: inherit; cursor: pointer;
  }
  .act::after { content: ''; position: absolute; inset: -2px 0; border-radius: inherit; }
  .act.primary { background: linear-gradient(180deg, var(--accent), var(--primary)); border-color: rgba(var(--secondary-rgb), .1); color: var(--on-primary); box-shadow: 0 6px 16px rgba(var(--primary-rgb), .18); }
  .act:active { filter: brightness(.96); }
  .act:disabled { opacity: .5; cursor: default; }
  .danger {
    position: relative;
    width: 100%; min-height: 40px; margin-top: 9px; border-radius: 12px;
    border: 1px solid rgba(var(--danger-rgb), .45); background: rgba(var(--danger-rgb), .12);
    color: var(--danger-text); font-size: 12px; font-weight: 700; font-family: inherit; cursor: pointer;
  }
  .danger::after { content: ''; position: absolute; inset: -2px 0; border-radius: inherit; }
  .danger:active { background: rgba(var(--danger-rgb), .2); }
  .hint { margin: 8px 2px 0; font-size: 10.5px; line-height: 1.55; color: var(--muted); }
  .hint b { color: var(--txt-soft); font-weight: 600; }
  .status { min-height: 15px; margin-top: 6px; font-size: 10.5px; color: var(--accent-text); line-height: 1.5; word-break: break-all; }
  .status:empty { display: none; }
  /* 云同步：摘要行 + 展开表单 */
  .cloud-summary { display: flex; align-items: center; gap: 6px; margin-left: auto; min-width: 0; }
  .cloud-summary span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; font-weight: 600; color: var(--txt-soft); }
  .cloud-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--muted); }
  .cloud-dot.pending { background: var(--accent); }
  .cloud-dot.success { background: var(--success-text); }
  .cloud-dot.unknown { background: var(--danger-text); }
  .cloud-field { margin-top: 9px; }
  .cloud-field label { display: block; margin: 0 2px 4px; font-size: 10.5px; font-weight: 600; color: var(--muted); }
  .cloud-field input {
    width: 100%; height: 44px; padding: 0 10px; border-radius: 10px;
    border: 1px solid var(--line-strong); background: var(--surface-raised);
    color: var(--txt); font: inherit; font-size: 12px;
  }
  .cloud-field input:focus { border-color: var(--primary); }
  .cloud-field input::placeholder { color: var(--muted-soft); }
  .cloud-field-hint { margin: 4px 2px 0; font-size: 10px; line-height: 1.5; color: var(--muted); }
  .cloud-remember { display: flex; align-items: center; gap: 7px; margin-top: 9px; min-height: 24px; font-size: 11px; color: var(--txt-soft); }
  .cloud-remember input { width: 15px; height: 15px; margin: 0; accent-color: var(--primary); }
  .cloud-remember button {
    margin-left: auto; padding: 2px 0; border: 0; background: transparent;
    color: var(--accent-text); font: inherit; font-size: 10.5px; font-weight: 600; cursor: pointer;
  }
  .cloud-state {
    min-height: 32px; margin-top: 8px; padding: 7px 9px; border-radius: 9px;
    background: rgba(var(--bg1-rgb), .4); border: 1px solid var(--line);
    font-size: 10.5px; line-height: 1.5; color: var(--muted);
  }
  .cloud-links { display: flex; justify-content: flex-end; gap: 14px; margin-top: 6px; }
  .cloud-links button {
    padding: 2px 0; border: 0; background: transparent; font: inherit;
    font-size: 10.5px; font-weight: 600; color: var(--accent-text); cursor: pointer;
  }
  .cloud-links button[hidden] { display: none; }
  .cloud-links button:disabled { opacity: .5; cursor: default; }
  .cloud-actions { margin-top: 8px; }

  /* 数据与备份：摘要行 + 展开动作 */
  .danger-link {
    width: 100%; min-height: 30px; margin-top: 8px; padding: 6px 2px 0;
    border: 0; border-top: 1px solid var(--line); background: transparent;
    color: var(--danger-text); font-size: 10.5px; font-weight: 600; font-family: inherit;
    text-align: right; cursor: pointer;
  }
  .danger-link:active { color: var(--danger); }

  /* 外观：两列主题网格，后续主题直接追加一行 */
  .theme-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .theme-choice {
    width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 7px;
    padding: 9px; border-radius: 12px; border: 1px solid var(--line);
    background: rgba(var(--bg1-rgb), .46); color: var(--txt); font-family: inherit; cursor: pointer;
    transition: border-color .2s, background .2s, transform .2s;
  }
  .theme-choice:hover { border-color: rgba(var(--primary-rgb), .55); background: rgba(var(--primary-rgb), .07); }
  .theme-choice:active { transform: scale(.985); }
  .theme-choice.active { border-color: var(--primary); background: rgba(var(--primary-rgb), .11); box-shadow: inset 0 0 0 1px rgba(var(--primary-rgb), .18); }
  .swatch {
    width: 100%; height: 42px; border-radius: 9px; flex-shrink: 0;
    display: grid; grid-template-columns: 1fr 1fr; overflow: hidden;
    border: 1px solid var(--line-strong);
  }
  .swatch i { display: block; }
  .swatch-dark i:nth-child(1) { background: #121110; }
  .swatch-dark i:nth-child(2) { background: #B87B4C; }
  .swatch-dark i:nth-child(3) { background: #F3E8D6; }
  .swatch-dark i:nth-child(4) { background: #6B8E23; }
  .swatch-light i:nth-child(1) { background: #F3EDE3; }
  .swatch-light i:nth-child(2) { background: #8F552C; }
  .swatch-light i:nth-child(3) { background: #FCF8F1; }
  .swatch-light i:nth-child(4) { background: #C7863F; }
  .theme-copy { min-width: 0; }
  .theme-copy b { display: block; font-size: 12px; line-height: 1.4; color: var(--heading); text-align: center; }

  /* 存储：展开体 */
  .storage-line { display: flex; flex-wrap: wrap; gap: 3px 9px; margin: 0 2px 8px; font-size: 10.5px; color: var(--muted); }
  .storage-line b { color: var(--txt-soft); font-weight: 600; font-variant-numeric: tabular-nums; }
  .cap-hint { margin: 0 2px 9px; font-size: 10px; line-height: 1.5; color: var(--muted); }

  /* 云同步：状态与操作 */

  .about-brand { display: flex; align-items: center; gap: 8px; }
  .about-brand img { width: 36px; height: 36px; border-radius: 10px; object-fit: contain; }
  .about-copy { flex: 1; min-width: 0; }
  .about-copy b { display: block; font-size: 14px; color: var(--heading); }
  .ver { padding: 3px 6px; border: 1px solid var(--line-strong); border-radius: 999px; color: var(--accent-text); font-size: 10px; font-variant-numeric: tabular-nums; }
  .about-dev { margin: 6px 2px 0 44px; font-size: 10px; line-height: 1.35; color: var(--accent-text); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .about-privacy { display: flex; align-items: center; gap: 8px; margin: 8px 2px 0; font-size: 11px; line-height: 1.4; color: var(--muted); white-space: nowrap; }
  .about-privacy i { width: 1px; height: 10px; flex: 0 0 auto; background: var(--line-strong); }
  .dev-link {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; box-sizing: border-box; border-radius: 9px;
    border: 1px solid var(--line); background: var(--surface-raised);
    color: var(--accent-text); text-decoration: none; margin-left: auto; flex: 0 0 auto;
    -webkit-tap-highlight-color: transparent;
    transition: background .18s, border-color .18s, transform .12s;
  }
  .dev-link:hover { background: var(--surface-hover); border-color: var(--line-warm); }
  .dev-link:active { transform: scale(.96); }
  .dev-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .dev-link svg { width: 17px; height: 17px; display: block; fill: currentColor; }
`;

const settingsHTML = `
  <div class="mask" id="mask">
    <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="全局设置">
      <div class="head">
        <div class="head-copy">
          <h2>全局设置</h2>
        </div>
        <button class="close" id="btnClose" type="button" aria-label="关闭设置">×</button>
      </div>
      <div class="body">
        <section class="card fold-card" id="appearanceCard">
          <button class="fold-head" id="btnToggleAppearance" type="button" aria-expanded="false" aria-controls="appearanceBody">
            <span class="ico">${icon('sun', 16)}</span><h3>外观</h3>
            <span class="fold-value" id="themeSummary">深夜琴房</span>
            <span class="chev" aria-hidden="true">▾</span>
          </button>
          <p class="fold-note" id="themeNote">暖纸日光可选，点按即切换</p>
          <div class="fold-body" id="appearanceBody" hidden>
            <div class="theme-grid" role="group" aria-label="外观主题">${themeChoicesHTML}</div>
          </div>
        </section>

        <section class="card fold-card" id="dataCard">
          <button class="fold-head" id="btnToggleData" type="button" aria-expanded="false" aria-controls="dataBody">
            <span class="ico">${icon('database', 16)}</span><h3>数据与备份</h3>
            <span class="fold-value metrics"><span class="metric"><b id="scoreCount">—</b> 份乐谱<span class="sep">·</span></span><span class="metric"><b id="logCount">—</b> 条练习</span></span>
            <span class="chev" aria-hidden="true">▾</span>
          </button>
          <p class="fold-note">备份含进度、书签与练习记录</p>
          <div class="fold-body" id="dataBody" hidden>
            <div class="grid2">
              <button class="act primary" id="btnBackup" type="button">备份到文件</button>
              <button class="act" id="btnRestore" type="button">从文件恢复</button>
            </div>
            <button class="danger-link" id="btnClear" type="button">清空本机数据</button>
            <div class="status" id="statusLine"></div>
            <p class="hint">Android 存到 <b>Download/GuitarShell</b>。</p>
          </div>
        </section>

        <section class="card fold-card" id="cloudCard">
          <button class="fold-head" id="btnToggleCloud" type="button" aria-expanded="false" aria-controls="cloudBody">
            <span class="ico">${icon('cloud', 16)}</span><h3>云同步</h3>
            <span class="cloud-summary"><i class="cloud-dot" id="cloudDot" aria-hidden="true"></i><span id="cloudStatusText">正在读取…</span></span>
            <span class="chev" aria-hidden="true">▾</span>
          </button>
          <p class="fold-note" id="cloudDetail">正在读取本机同步记录</p>
          <div class="fold-body" id="cloudBody" hidden>
            <p class="hint">坚果云 WebDAV · 手动上传 / 下载。使用应用密码，不填登录密码。</p>
            <div class="cloud-field">
              <label for="cloudAccount">账号</label>
              <input id="cloudAccount" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="坚果云账号（邮箱）">
            </div>
            <div class="cloud-field">
              <label for="cloudSecret">应用密码</label>
              <input id="cloudSecret" type="password" autocomplete="current-password" placeholder="坚果云第三方应用密码">
            </div>
            <div class="cloud-remember" id="cloudRememberRow">
              <input type="checkbox" id="cloudRemember">
              <label for="cloudRemember">记住密码</label>
              <button id="cloudForget" type="button" hidden>清除</button>
            </div>
            <p class="cloud-field-hint" id="cloudRememberHint">不勾选时密码只在本次填写中有效，不会写盘。</p>
            <div class="cloud-field">
              <label for="cloudPath">备份路径</label>
              <input id="cloudPath" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="GuitarShell/backup.json">
            </div>
            <div class="cloud-field">
              <label for="cloudBase">同步通道</label>
              <input id="cloudBase" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="留空自动选通道">
            </div>
            <button class="act cloud-actions" id="btnCloudTest" type="button">测试连接</button>
            <div class="cloud-state" id="cloudSyncState">正在读取同步状态…</div>
            <div class="cloud-links">
              <button id="cloudCancel" type="button" hidden>取消</button>
              <button id="cloudRetry" type="button" hidden>重试</button>
              <button id="cloudDismiss" type="button" hidden>关闭</button>
            </div>
            <div class="grid2 cloud-actions">
              <button class="act" id="btnCloudDownload" type="button">覆盖本地</button>
              <button class="act primary" id="btnCloudUpload" type="button">上传备份</button>
            </div>
          </div>
        </section>

        <section class="card fold-card storage-card" id="storageCard">
          <button class="fold-head" id="btnToggleStorage" type="button" aria-expanded="false" aria-controls="storageBody">
            <span class="ico">${icon('archive', 16)}</span><h3>存储与缓存</h3>
            <span class="fold-value"><b id="totalUsage">—</b></span>
            <span class="chev" aria-hidden="true">▾</span>
          </button>
          <div class="fold-body" id="storageBody" hidden>
            <div class="storage-line"><span>曲谱 <b id="scoreUsage">—</b></span><span>图片缓存 <b id="coverUsage">—</b></span></div>
            <p class="cap-hint" id="quotaHint">正在统计本机占用…</p>
            <div class="grid2">
              <button class="act" id="btnCleanCover" type="button">清理封面缓存</button>
              <button class="act" id="btnCleanOrphan" type="button">清理未引用缓存</button>
            </div>
            <p class="hint">只删可重建的封面缓存和失去引用的自定义背景副本；当前使用中的背景不会被清理。</p>
            <div class="status" id="storageStatus"></div>
          </div>
        </section>

        <section class="card about">
          <div class="card-head">
            <span class="ico">${icon('info', 16)}</span><h3>关于</h3>
            <a class="dev-link" id="btnGithub" href="https://github.com/moanet/GuitarShell" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 打开 Guitar Shell 项目" title="GitHub">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0c6.63 0 12 5.276 12 11.79-.001 5.067-3.29 9.567-8.175 11.187-.6.118-.825-.25-.825-.56 0-.398.015-1.665.015-3.242 0-1.105-.375-1.813-.81-2.181 2.67-.295 5.475-1.297 5.475-5.822 0-1.297-.465-2.344-1.23-3.169.12-.295.54-1.503-.12-3.125 0 0-1.005-.324-3.3 1.209a11.32 11.32 0 00-3-.398c-1.02 0-2.04.133-3 .398-2.295-1.518-3.3-1.209-3.3-1.209-.66 1.622-.24 2.83-.12 3.125-.765.825-1.23 1.887-1.23 3.169 0 4.51 2.79 5.527 5.46 5.822-.345.294-.66.81-.765 1.577-.69.31-2.415.81-3.495-.973-.225-.354-.9-1.223-1.845-1.209-1.005.015-.405.56.015.781.51.28 1.095 1.327 1.23 1.666.24.663 1.02 1.93 4.035 1.385 0 .988.015 1.916.015 2.196 0 .31-.225.664-.825.56C3.303 21.374-.003 16.867 0 11.791 0 5.276 5.37 0 12 0z"/></svg>
            </a>
          </div>
          <div class="about-brand">
            <img src="./icon-gShell-192.png" data-theme-icon data-dark-src="./icon-gShell-192.png" data-light-src="./icon-gShell-light-192.png" alt="">
            <div class="about-copy"><b>Guitar Shell</b></div>
            <span class="ver" id="appVer">v…</span>
          </div>
          <div class="about-dev" id="appDev" hidden></div>
          <p class="about-privacy" aria-label="无账号，本地优先，默认不上传">
            <span>无账号</span><i aria-hidden="true"></i><span>本地优先</span><i aria-hidden="true"></i><span>默认不上传</span>
          </p>
        </section>
      </div>
    </aside>
  </div>
  <input type="file" id="backupFile" accept=".json,application/json" hidden>
`;

class GuitarSettings extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.busy = false;
    this._layerOff = null;
    this._swipeOff = null;
    this._suppressClickUntil = 0;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `<style>${settingsCSS}</style>${settingsHTML}`;
    this.$ = (id) => this.shadowRoot.getElementById(id);
    this.$('appVer').textContent = `v${APP_VERSION}`;
    const appDev = this.$('appDev');
    appDev.hidden = !BUILD_STAMP;
    appDev.textContent = BUILD_STAMP ? `v${BUILD_STAMP}` : '';
    this.bind();
    this.syncThemeUI();
    this.offTheme = onThemeChange(() => this.syncThemeUI());
    this.handleOpen = () => this.open();
    window.addEventListener('open-global-settings', this.handleOpen);
  }

  disconnectedCallback() {
    window.removeEventListener('open-global-settings', this.handleOpen);
    document.removeEventListener('keydown', this.handleKey);
    if (this._layerOff) { this._layerOff(); this._layerOff = null; }
    if (this._swipeOff) { this._swipeOff(); this._swipeOff = null; }
    if (this.offTheme) { this.offTheme(); this.offTheme = null; }
  }

  syncThemeUI() {
    const current = getTheme();
    const active = THEME_OPTIONS.find((option) => option.id === current) || THEME_OPTIONS[0];
    this.shadowRoot.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      const isActive = btn.dataset.themeChoice === current;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    const summary = this.$('themeSummary');
    if (summary) summary.textContent = active.name;
    const note = this.$('themeNote');
    const alternative = THEME_OPTIONS.find((option) => option.id !== current);
    if (note) note.textContent = alternative ? `${alternative.name}可选，点按即切换` : '点按即切换';
    syncThemeImages(this.shadowRoot);
  }

  bind() {
    this.$('btnClose').onclick = () => this.close();
    bindBackdrop(this.$('mask'), () => this.close());
    this.handleKey = (e) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this.handleKey);

    this.shadowRoot.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      btn.onclick = () => {
        setTheme(btn.dataset.themeChoice);
        this.syncThemeUI();
      };
    });

    this.$('btnBackup').onclick = () => this.backup();
    this.$('btnRestore').onclick = () => this.$('backupFile').click();
    this.$('btnGithub').onclick = (e) => {
      e.preventDefault();
      const url = this.$('btnGithub').href;
      if (window.Capacitor) {
        // Capacitor 壳会拦截站外导航，交给系统浏览器打开
        window.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener');
      }
    };
    this.$('backupFile').onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) this.restore(file);
    };
    this.$('btnClear').onclick = () => this.clear();
    this.$('btnCleanCover').onclick = () => this.cleanCoverCache();
    this.$('btnCleanOrphan').onclick = () => this.cleanOrphanCache();

    this.folds = {
      appearance: { card: 'appearanceCard', btn: 'btnToggleAppearance', body: 'appearanceBody' },
      data: { card: 'dataCard', btn: 'btnToggleData', body: 'dataBody' },
      cloud: { card: 'cloudCard', btn: 'btnToggleCloud', body: 'cloudBody' },
      storage: { card: 'storageCard', btn: 'btnToggleStorage', body: 'storageBody' }
    };
    Object.keys(this.folds).forEach((name) => {
      const fold = this.folds[name];
      this.$(fold.btn).onclick = () => this.setFoldOpen(name, this.$(fold.body).hidden);
    });
    this.cloud = new CloudSyncController(this);
    this._swipeOff = this.bindSwipe();
  }

  setFoldOpen(name, open) {
    const fold = this.folds && this.folds[name];
    if (!fold) return;
    const body = this.$(fold.body);
    if (!body) return;
    if (open) {
      Object.keys(this.folds).forEach((key) => {
        if (key !== name) this.setFoldOpen(key, false);
      });
    }
    body.hidden = !open;
    this.$(fold.card).classList.toggle('open', open);
    this.$(fold.btn).setAttribute('aria-expanded', open ? 'true' : 'false');
    if (name === 'cloud' && open && this.cloud) {
      this.cloud.loadForm();
      this.cloud.refreshStatus();
    }
  }

  closeAllFolds() {
    if (!this.folds) return;
    Object.keys(this.folds).forEach((name) => this.setFoldOpen(name, false));
  }

  /**
   * 抽屉右滑关闭：触屏与鼠标统一走 pointer 事件。
   * 只有横向位移明确压过纵向才判定，避免和存储区纵向滚动抢手势。
   */
  bindSwipe() {
    const drawer = this.$('drawer');
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let horizontal = false;
    let vertical = false;

    const reset = () => {
      pointerId = null;
      horizontal = false;
      vertical = false;
    };

    const onDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (pointerId !== null) {
        vertical = true; // 第二根手指落下即取消主指针关闭判定
        return;
      }
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      horizontal = false;
      vertical = false;
    };

    // Android WebView 的横向滑动在部分机型不派发 pointermove；
    // 触摸事件是兜底通道，判定阈值与 pointer 路径一致。
    let touchId = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchHorizontal = false;
    let touchVertical = false;
    let touchMulti = false;

    const resetTouch = () => {
      touchId = null;
      touchHorizontal = false;
      touchVertical = false;
    };

    const onTouchStart = (e) => {
      if (e.touches.length > 1) {
        touchMulti = true;
        resetTouch();
        return;
      }
      if (touchMulti || touchId !== null) return;
      touchId = e.touches[0].identifier;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchHorizontal = false;
      touchVertical = false;
    };

    const onTouchMove = (e) => {
      const t = Array.from(e.touches).find((item) => item.identifier === touchId);
      if (!t || touchVertical) return;
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      if (!touchHorizontal) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) + 8) {
          touchVertical = true;
          return;
        }
        if (dx > 10 && dx > Math.abs(dy) + 8) touchHorizontal = true;
      }
      if (touchHorizontal) e.preventDefault();
    };

    const onTouchEnd = (e) => {
      if (touchMulti) {
        if (e.touches.length === 0) touchMulti = false;
        resetTouch();
        return;
      }
      if (touchId === null) return;
      const t = Array.from(e.changedTouches).find((item) => item.identifier === touchId);
      if (!t) return;
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      const shouldClose = !touchVertical && touchHorizontal && dx >= 64 && dx > Math.abs(dy) * 1.5;
      resetTouch();
      if (shouldClose) {
        this._suppressClickUntil = performance.now() + 450;
        this.close();
      }
    };

    const onTouchCancel = () => {
      touchMulti = false;
      resetTouch();
    };


    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      if (vertical) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!horizontal) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) + 8) {
          vertical = true;
          return;
        }
        if (dx > 10 && dx > Math.abs(dy) + 8) horizontal = true;
      }
    };

    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const shouldClose = !vertical && horizontal && dx >= 64 && dx > Math.abs(dy) * 1.5;
      reset();
      if (shouldClose) {
        this._suppressClickUntil = performance.now() + 450;
        this.close();
      }
    };

    const onClick = (e) => {
      if (performance.now() < this._suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    drawer.addEventListener('pointerdown', onDown, { passive: true });
    drawer.addEventListener('pointermove', onMove, { passive: true });
    drawer.addEventListener('pointerup', onUp, { passive: true });
    drawer.addEventListener('pointercancel', reset, { passive: true });
    drawer.addEventListener('touchstart', onTouchStart, { passive: true });
    drawer.addEventListener('touchmove', onTouchMove, { passive: false });
    drawer.addEventListener('touchend', onTouchEnd, { passive: true });
    drawer.addEventListener('touchcancel', onTouchCancel, { passive: true });
    drawer.addEventListener('click', onClick, true);

    return () => {
      drawer.removeEventListener('pointerdown', onDown);
      drawer.removeEventListener('pointermove', onMove);
      drawer.removeEventListener('pointerup', onUp);
      drawer.removeEventListener('pointercancel', reset);
      drawer.removeEventListener('touchstart', onTouchStart);
      drawer.removeEventListener('touchmove', onTouchMove);
      drawer.removeEventListener('touchend', onTouchEnd);
      drawer.removeEventListener('touchcancel', onTouchCancel);
      drawer.removeEventListener('click', onClick, true);
    };
  }

  open() {
    this.$('mask').classList.add('show');
    this._suppressClickUntil = 0;
    this.closeAllFolds();
    const body = this.shadowRoot.querySelector('.body');
    if (body) body.scrollTop = 0;
    if (!this._layerOff) {
      this._layerOff = registerLayer({
        id: 'settings-drawer',
        close: () => this.close()
      });
    }
    this.refreshStats();
    this.refreshStorage();
    this.cloud?.refreshStatus();
  }

  close() {
    if (this._layerOff) { this._layerOff(); this._layerOff = null; }
    this.$('mask').classList.remove('show');
  }

  setBusy(on, text = '') {
    this.busy = on;
    ['btnBackup', 'btnRestore', 'btnClear'].forEach((id) => { this.$(id).disabled = on; });
    this.$('statusLine').textContent = text;
  }

  async refreshStats() {
    try {
      const s = await getDataStats();
      this.$('scoreCount').textContent = s.scores;
      this.$('logCount').textContent = s.logs;
    } catch (err) {
      this.$('scoreCount').textContent = '—';
      this.$('logCount').textContent = '—';
    }
  }

  setStorageBusy(on, text = '') {
    ['btnCleanCover', 'btnCleanOrphan'].forEach((id) => {
      const btn = this.$(id);
      if (btn) btn.disabled = on;
    });
    this.$('storageStatus').textContent = text;
  }

  async refreshStorage() {
    try {
      const stats = await collectStorageStats();
      this.storageStats = stats;
      this.$('totalUsage').textContent = formatBytes(stats.usage);
      this.$('scoreUsage').textContent = formatBytes(stats.scoreBytes);
      this.$('coverUsage').textContent = formatBytes(stats.imageBytes);

      const quotaText = stats.exact && stats.quota
        ? `系统统计（含网页缓存）· 配额约 ${formatBytes(stats.quota)}`
        : '系统未提供精确占用，这里显示曲谱 + 图片缓存合计';
      const persist = await ensurePersistentStorage();
      const persistText = persist === 'granted'
        ? '已申请持久存储'
        : persist === 'denied'
          ? '未授予持久存储，空间紧张时可能被回收'
          : '当前环境不支持持久存储申请';
      this.$('quotaHint').textContent = `${quotaText} · ${persistText} · 封面 ${stats.coverCount} 张 · 背景 ${stats.backgroundCount} 张`;
    } catch (err) {
      console.warn('[存储] 统计失败:', err.message);
      ['totalUsage', 'scoreUsage', 'coverUsage'].forEach((id) => { this.$(id).textContent = '—'; });
      this.$('quotaHint').textContent = '占用统计失败，两个清理按钮仍可使用';
    }
  }

  async cleanCoverCache() {
    if (this.busy) return;
    const stats = this.storageStats || await collectStorageStats().catch(() => null);
    if (!stats || !stats.coverCount) {
      this.$('storageStatus').textContent = '没有需要清理的封面缓存';
      showToast('没有可清理的封面缓存');
      return;
    }
    const ok = await showConfirm({
      title: '清理封面缓存',
      message: '会删除全部乐谱封面并清空缓存指针，乐谱文件、阅读进度、书签与练习记录都不受影响；下次进入书架时按需重建。',
      details: [
        { label: '封面', value: `${stats.coverCount} 张` },
        { label: '预计释放', value: `约 ${formatBytes(stats.coverBytes)}` }
      ],
      confirmText: '清理',
      danger: true
    });
    if (!ok) return;
    this.setStorageBusy(true, '正在清理封面缓存…');
    try {
      const result = await clearCoverCache();
      window.dispatchEvent(new CustomEvent('gs-cover-cache-cleared', { detail: result }));
      await this.refreshStorage();
      this.setStorageBusy(false, `已清理 ${result.count} 张封面`);
      showToast(`已清理 ${result.count} 张封面，释放约 ${formatBytes(result.bytes)}`);
    } catch (err) {
      this.setStorageBusy(false, '清理封面缓存失败');
      showToast(`清理失败：${err.message}`);
    }
  }

  async cleanOrphanCache() {
    if (this.busy) return;
    let orphans = [];
    try {
      orphans = await findOrphanAssets();
    } catch (err) {
      this.setStorageBusy(false, '读取缓存失败');
      showToast(`读取缓存失败：${err.message}`);
      return;
    }
    if (!orphans.length) {
      this.$('storageStatus').textContent = '没有未引用的缓存';
      showToast('没有未引用的缓存');
      return;
    }
    const bytes = orphans.reduce((sum, asset) => sum + (Number(asset.bytes) || 0), 0);
    const ok = await showConfirm({
      title: '清理未引用缓存',
      message: '只删除已失去引用关系的封面缓存和自定义背景副本，正在使用的封面/背景与全部乐谱都不受影响。',
      details: [
        { label: '缓存', value: `${orphans.length} 条` },
        { label: '预计释放', value: `约 ${formatBytes(bytes)}` }
      ],
      confirmText: '清理',
      danger: true
    });
    if (!ok) return;
    this.setStorageBusy(true, '正在清理未引用缓存…');
    try {
      const result = await clearOrphanAssets();
      await this.refreshStorage();
      this.setStorageBusy(false, `已清理 ${result.count} 条缓存`);
      showToast(`已清理 ${result.count} 条缓存，释放约 ${formatBytes(result.bytes)}`);
    } catch (err) {
      this.setStorageBusy(false, '清理未引用缓存失败');
      showToast(`清理失败：${err.message}`);
    }
  }

  async backup() {
    if (this.busy) return;
    this.setBusy(true, '正在打包备份…');
    try {
      const payload = await buildBackupPayload();
      if (!payload) {
        this.setBusy(false, '');
        showToast('没有可备份的数据');
        return;
      }
      const saved = await saveBackupFile(payload);
      this.setBusy(false, saved.native ? `已保存到 ${saved.path}` : '备份文件已下载到浏览器下载目录');
      showToast(saved.native
        ? `已保存到 ${saved.path}`
        : `已下载 ${payload.scores.length} 份乐谱 / ${payload.logs.length} 条练习记录`);
    } catch (err) {
      this.setBusy(false, '备份失败');
      showToast(`备份失败：${err.message}`);
    }
  }

  async restore(file) {
    if (this.busy) return;
    this.setBusy(true, '正在读取备份…');
    try {
      const payload = await parseBackupFile(file);
      const scoreCount = payload.scores.length;
      const logCount = (payload.logs || []).length;
      const local = await getDataStats();
      if (!scoreCount && !logCount) {
        const ok = await showConfirm({
          title: '备份是空的',
          message: '继续会把本地乐谱和练习记录清空，且无法撤销。',
          details: [
            { label: '备份', value: '0 份乐谱 / 0 条记录' },
            { label: '本地', value: `${local.scores} 份乐谱 / ${local.logs} 条记录` }
          ],
          confirmText: '仍然恢复',
          danger: true
        });
        if (!ok) {
          this.setBusy(false, '已取消');
          return;
        }
      } else {
        const ok = await showConfirm({
          title: '覆盖本地数据',
          message: '备份会替换本机现有的乐谱与练习记录。',
          details: [
            { label: '备份', value: `${scoreCount} 份乐谱 / ${logCount} 条记录` },
            { label: '本地', value: `${local.scores} 份乐谱 / ${local.logs} 条记录` },
            {
              label: '备份时间',
              value: payload.exportedAt ? new Date(payload.exportedAt).toLocaleString('zh-CN', { hour12: false }) : '未知'
            }
          ],
          confirmText: '覆盖',
          danger: true
        });
        if (!ok) {
          this.setBusy(false, '已取消');
          return;
        }
      }

      this.$('statusLine').textContent = '正在恢复…';
      const result = await restoreBackup(payload);
      this.refreshStats();
      window.dispatchEvent(new CustomEvent('gs-data-changed', { detail: { source: 'settings', action: 'restore' } }));
      window.dispatchEvent(new CustomEvent('log-updated'));
      this.setBusy(false, '恢复完成');
      showToast(`恢复完成：${result.scores} 份乐谱 / ${result.logs} 条练习记录`);
    } catch (err) {
      this.setBusy(false, '恢复失败');
      showToast(`恢复失败：${err.message}`);
    }
  }

  async clear() {
    if (this.busy) return;
    const s = await getDataStats().catch(() => ({ scores: 0, logs: 0 }));
    const ok = await showConfirm({
      title: '清空本机数据',
      message: '乐谱、练习记录、阅读进度和书签都会删除，且无法撤销。',
      details: [
        { label: '乐谱', value: `${s.scores} 份` },
        { label: '练习记录', value: `${s.logs} 条` }
      ],
      confirmText: '清空',
      danger: true
    });
    if (!ok) return;
    this.setBusy(true, '正在清空…');
    try {
      await dbService.clearAllData();
      this.refreshStats();
      window.dispatchEvent(new CustomEvent('gs-data-changed', { detail: { source: 'settings', action: 'clear' } }));
      window.dispatchEvent(new CustomEvent('log-updated'));
      this.setBusy(false, '已清空');
      showToast('已清空乐谱与练习记录');
    } catch (err) {
      this.setBusy(false, '清空失败');
      showToast(`清空失败：${err.message}`);
    }
  }
}

customElements.define('guitar-settings', GuitarSettings);
