// ==========================================
// js/components/settings.js
// 全局设置抽屉：数据备份 / 恢复 / 清空 + 当前主题 + 关于
// Shadow DOM 隔离，抽屉固定在视口右侧，不参与页面布局
// ==========================================

import { APP_VERSION } from '../services/version.js';
import { showToast } from '../services/toast.js';
import { dbService } from '../services/db.js';
import { getTheme, setTheme, onThemeChange, syncThemeImages } from '../services/theme.js';
import { getCloudSyncSummary, describeCloudSync } from '../services/sync-state.js';
import { showConfirm } from './app-dialog.js';
import { registerLayer, bindBackdrop } from '../services/ui-layer.js';
import {
  buildBackupPayload, getDataStats, parseBackupFile, restoreBackup, saveBackupFile
} from '../services/backup.js';
import {
  clearCoverCache, clearOrphanAssets, collectStorageStats, ensurePersistentStorage,
  findOrphanAssets, formatBytes
} from '../services/storage-stats.js';

const settingsCSS = `
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
    padding: calc(16px + env(safe-area-inset-top)) 14px 12px;
    border-bottom: 1px solid var(--line); display: flex; align-items: flex-start; gap: 10px;
  }
  .head-copy { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 20px; line-height: 1.2; color: var(--heading); letter-spacing: .4px; }
  .head p { margin: 5px 0 0; font-size: 10.5px; color: var(--muted); }
  .close {
    flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--txt); font-size: 19px; line-height: 1; cursor: pointer;
    display: grid; place-items: center;
  }
  .close:active { background: var(--surface-hover); }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 12px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; }
  .card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 16px; padding: 12px; }
  .card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
  .card-head .ico, .storage-head .ico { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 7px; background: rgba(var(--primary-rgb), .14); color: var(--accent-text); font-size: 12px; flex-shrink: 0; }
  h3 { margin: 0; font-size: 12.5px; font-weight: 700; color: var(--heading); letter-spacing: .4px; }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 11px; }
  .stats.triple { grid-template-columns: repeat(3, 1fr); }
  .stat { background: var(--surface-deep); border: 1px solid var(--line); border-radius: 12px; padding: 10px 11px; display: flex; align-items: baseline; gap: 5px; }
  .stat b { font-size: 20px; color: var(--accent-text); font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11px; color: var(--muted); }
  .stats.triple .stat { flex-direction: column; align-items: flex-start; gap: 3px; padding: 9px 10px; }
  .stats.triple .stat b { font-size: 14px; line-height: 1.2; }
  .stats.triple .stat span { font-size: 10px; }
  .cap-hint { margin: 0 2px 10px; font-size: 10px; line-height: 1.55; color: var(--muted); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .act {
    width: 100%; min-height: 38px; border-radius: 11px; border: 1px solid var(--line-strong); background: var(--surface-raised);
    color: var(--txt); font-size: 12px; font-weight: 700; font-family: inherit; cursor: pointer;
  }
  .act.primary { background: linear-gradient(180deg, var(--accent), var(--primary)); border-color: rgba(var(--secondary-rgb), .1); color: var(--on-primary); box-shadow: 0 6px 16px rgba(var(--primary-rgb), .18); }
  .act:active { filter: brightness(.96); }
  .act:disabled { opacity: .5; cursor: default; }
  .danger {
    width: 100%; min-height: 40px; margin-top: 9px; border-radius: 12px;
    border: 1px solid rgba(var(--danger-rgb), .45); background: rgba(var(--danger-rgb), .12);
    color: var(--danger-text); font-size: 12px; font-weight: 700; font-family: inherit; cursor: pointer;
  }
  .danger:active { background: rgba(var(--danger-rgb), .2); }
  .hint { margin: 8px 2px 0; font-size: 10.5px; line-height: 1.55; color: var(--muted); }
  .hint b { color: var(--txt-soft); font-weight: 600; }
  .status { min-height: 15px; margin-top: 6px; font-size: 10.5px; color: var(--accent-text); line-height: 1.5; word-break: break-all; }
  .status:empty { display: none; }
  .cloud-note { margin: 0 2px 8px; font-size: 10.5px; line-height: 1.55; color: var(--muted); }
  .cloud-note b { color: var(--txt-soft); font-weight: 600; }
  .cloud-status { margin: 0; font-size: 10.5px; line-height: 1.5; color: var(--accent-text); }

  /* 数据与备份：一行裸统计 + 紧凑动作 */
  .data-line { display: flex; align-items: baseline; gap: 5px; margin: 0 2px 10px; font-size: 11px; color: var(--muted); flex-wrap: wrap; }
  .data-line b { font-size: 16px; line-height: 1.1; color: var(--accent-text); font-variant-numeric: tabular-nums; }
  .data-line .dot { color: var(--muted-soft); margin: 0 2px; }
  .danger-link {
    width: 100%; min-height: 30px; margin-top: 8px; padding: 6px 2px 0;
    border: 0; border-top: 1px solid var(--line); background: transparent;
    color: var(--danger-text); font-size: 10.5px; font-weight: 600; font-family: inherit;
    text-align: right; cursor: pointer;
  }
  .danger-link:active { color: var(--danger); }

  /* 外观：一行分段控件 */
  .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 3px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-deep); }
  .seg-btn {
    min-width: 0; min-height: 36px; display: flex; align-items: center; justify-content: center; gap: 6px;
    border: 1px solid transparent; border-radius: 9px; background: transparent;
    color: var(--muted); font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
    transition: background .18s, border-color .18s, color .18s;
  }
  .seg-btn.active { background: rgba(var(--primary-rgb), .14); border-color: rgba(var(--primary-rgb), .6); color: var(--heading); box-shadow: inset 0 0 0 1px rgba(var(--primary-rgb), .12); }
  .seg-btn:active { transform: scale(.985); }
  .dots { display: inline-flex; gap: 2px; flex-shrink: 0; }
  .dots i { width: 6px; height: 6px; border-radius: 50%; border: 1px solid rgba(var(--secondary-rgb), .18); }
  .dots.deep i:nth-child(1) { background: #121110; }
  .dots.deep i:nth-child(2) { background: #B87B4C; }
  .dots.deep i:nth-child(3) { background: #F3E8D6; }
  .dots.light i:nth-child(1) { background: #F3EDE3; }
  .dots.light i:nth-child(2) { background: #8F552C; }
  .dots.light i:nth-child(3) { background: #C7863F; }

  /* 存储：默认折叠，头常驻 */
  .storage-head {
    width: 100%; display: flex; align-items: center; gap: 8px; margin: 0; padding: 0;
    border: 0; background: transparent; color: inherit; font-family: inherit; text-align: left; cursor: pointer;
  }
  .storage-total { margin-left: auto; font-size: 11.5px; color: var(--accent-text); font-variant-numeric: tabular-nums; }
  .chev { width: 16px; text-align: center; color: var(--muted); font-size: 10px; transition: transform .2s; }
  .storage-card.open .chev { transform: rotate(180deg); }
  .storage-body { margin-top: 10px; }
  .storage-line { display: flex; flex-wrap: wrap; gap: 3px 9px; margin: 0 2px 8px; font-size: 10.5px; color: var(--muted); }
  .storage-line b { color: var(--txt-soft); font-weight: 600; font-variant-numeric: tabular-nums; }
  .cap-hint { margin: 0 2px 9px; font-size: 10px; line-height: 1.5; color: var(--muted); }

  /* 云同步：状态与入口同一行 */
  .cloud-row { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
  .cloud-row .cloud-status { flex: 1; min-width: 0; }
  .act.small { width: auto; flex: 0 0 auto; min-height: 32px; padding: 0 11px; font-size: 11px; }

  /* 主题选择：两张可点按的色板卡，不依赖弹窗 */
  .theme-choice {
    width: 100%; display: flex; align-items: center; gap: 11px;
    margin-top: 8px; padding: 9px 10px; border-radius: 14px;
    border: 1px solid var(--line); background: rgba(var(--bg1-rgb), .46);
    color: var(--txt); font-family: inherit; text-align: left; cursor: pointer;
    transition: border-color .2s, background .2s, transform .2s;
  }
  .theme-choice:first-of-type { margin-top: 0; }
  .theme-choice:hover { border-color: rgba(var(--primary-rgb), .55); background: rgba(var(--primary-rgb), .07); }
  .theme-choice:active { transform: scale(.985); }
  .theme-choice.active { border-color: var(--primary); background: rgba(var(--primary-rgb), .11); box-shadow: inset 0 0 0 1px rgba(var(--primary-rgb), .18); }
  .swatch {
    width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
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
  .theme-copy { flex: 1; min-width: 0; }
  .theme-copy b { display: block; font-size: 13px; color: var(--heading); }
  .theme-copy small { display: block; margin-top: 3px; font-size: 11px; color: var(--muted); }
  .tag {
    flex-shrink: 0; padding: 3px 8px; border-radius: 999px;
    border: 1px solid rgba(var(--success-rgb), .4); background: rgba(var(--success-rgb), .1);
    color: var(--success-text); font-size: 10px;
    opacity: 0; transform: translateX(3px); transition: opacity .18s, transform .18s;
  }
  .theme-choice.active .tag { opacity: 1; transform: translateX(0); }
  .about-brand { display: flex; align-items: center; gap: 9px; }
  .about-brand img { width: 36px; height: 36px; border-radius: 10px; object-fit: contain; box-shadow: 0 4px 14px rgba(var(--shadow-rgb), .28); }
  .about-copy { flex: 1; min-width: 0; }
  .about-copy b { display: block; font-size: 14px; color: var(--heading); }
  .about-copy small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
  .ver { padding: 3px 7px; border: 1px solid var(--line-strong); border-radius: 999px; color: var(--accent-text); font-size: 10px; font-variant-numeric: tabular-nums; }
  .about p { margin: 8px 2px 0; font-size: 10.5px; line-height: 1.55; color: var(--muted); }
  .about p b { color: var(--txt-soft); font-weight: 600; }
  .dev-row {
    display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px;
    border-top: 1px solid var(--line); font-size: 11px; color: var(--muted);
  }
  .dev-row > span { color: var(--txt-soft); font-weight: 600; }
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
          <p>本地优先 · 数据只留在这台设备</p>
        </div>
        <button class="close" id="btnClose" type="button" aria-label="关闭设置">×</button>
      </div>
      <div class="body">
        <section class="card">
          <div class="card-head"><span class="ico">◐</span><h3>外观</h3></div>
          <div class="seg" role="group" aria-label="外观主题">
            <button class="seg-btn active" id="themeDeep" data-theme-choice="deep" type="button" aria-pressed="true">
              <span class="dots deep" aria-hidden="true"><i></i><i></i><i></i></span>深夜琴房
            </button>
            <button class="seg-btn" id="themeLight" data-theme-choice="light" type="button" aria-pressed="false">
              <span class="dots light" aria-hidden="true"><i></i><i></i><i></i></span>暖纸日光
            </button>
          </div>
          <p class="hint">点按即切换，全站同步换色。</p>
        </section>

        <section class="card">
          <div class="card-head"><span class="ico">▦</span><h3>数据与备份</h3></div>
          <div class="data-line">
            <b id="scoreCount">—</b><span>份乐谱</span><span class="dot">·</span><b id="logCount">—</b><span>条练习</span>
          </div>
          <div class="grid2">
            <button class="act primary" id="btnBackup" type="button">备份到文件</button>
            <button class="act" id="btnRestore" type="button">从文件恢复</button>
          </div>
          <button class="danger-link" id="btnClear" type="button">清空本机数据</button>
          <div class="status" id="statusLine"></div>
          <p class="hint">备份含乐谱、进度、书签与练习记录；Android 存到 <b>Download/GuitarShell</b>。</p>
        </section>

        <section class="card">
          <div class="card-head"><span class="ico">☁</span><h3>云同步</h3></div>
          <p class="cloud-note">坚果云 WebDAV · 手动上传 / 下载，密码本机加密。</p>
          <div class="cloud-row">
            <p class="cloud-status" id="cloudStatus">正在读取同步状态…</p>
            <button class="act small" id="btnCloudEntry" type="button">打开</button>
          </div>
        </section>

        <section class="card storage-card" id="storageCard">
          <button class="storage-head" id="btnToggleStorage" type="button" aria-expanded="false" aria-controls="storageBody">
            <span class="ico">▤</span><h3>存储与缓存</h3>
            <span class="storage-total" id="totalUsage">—</span>
            <span class="chev" aria-hidden="true">▾</span>
          </button>
          <div class="storage-body" id="storageBody" hidden>
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
            <span class="ico">◎</span><h3>关于</h3>
            <a class="dev-link" id="btnGithub" href="https://github.com/moanet/GuitarShell" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 打开 Guitar Shell 项目" title="GitHub">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0c6.63 0 12 5.276 12 11.79-.001 5.067-3.29 9.567-8.175 11.187-.6.118-.825-.25-.825-.56 0-.398.015-1.665.015-3.242 0-1.105-.375-1.813-.81-2.181 2.67-.295 5.475-1.297 5.475-5.822 0-1.297-.465-2.344-1.23-3.169.12-.295.54-1.503-.12-3.125 0 0-1.005-.324-3.3 1.209a11.32 11.32 0 00-3-.398c-1.02 0-2.04.133-3 .398-2.295-1.518-3.3-1.209-3.3-1.209-.66 1.622-.24 2.83-.12 3.125-.765.825-1.23 1.887-1.23 3.169 0 4.51 2.79 5.527 5.46 5.822-.345.294-.66.81-.765 1.577-.69.31-2.415.81-3.495-.973-.225-.354-.9-1.223-1.845-1.209-1.005.015-.405.56.015.781.51.28 1.095 1.327 1.23 1.666.24.663 1.02 1.93 4.035 1.385 0 .988.015 1.916.015 2.196 0 .31-.225.664-.825.56C3.303 21.374-.003 16.867 0 11.791 0 5.276 5.37 0 12 0z"/></svg>
            </a>
          </div>
          <div class="about-brand">
            <img src="./icon-gShell-192.png" data-theme-icon data-dark-src="./icon-gShell-192.png" data-light-src="./icon-gShell-light-192.png" alt="">
            <div class="about-copy"><b>Guitar Shell</b><small>吉他手的练琴工作站</small></div>
            <span class="ver" id="appVer">v…</span>
          </div>
          <p>零构建 Web Components<br>无账号 · 默认不上传</p>
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
    this.shadowRoot.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      const active = btn.dataset.themeChoice === current;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
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
    this.$('btnCloudEntry').onclick = () => this.openCloud();
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
    this.$('btnToggleStorage').onclick = () => this.setStorageOpen(this.$('storageBody').hidden);
    this._swipeOff = this.bindSwipe();
  }

  setStorageOpen(open) {
    const body = this.$('storageBody');
    if (!body) return;
    body.hidden = !open;
    this.$('storageCard').classList.toggle('open', open);
    this.$('btnToggleStorage').setAttribute('aria-expanded', open ? 'true' : 'false');
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
    this.setStorageOpen(false);
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
    this.refreshCloudStatus();
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

  async refreshCloudStatus() {
    const el = this.$('cloudStatus');
    if (!el) return;
    el.textContent = '正在读取同步状态…';
    const path = localStorage.getItem('gs_cloud_path') || 'GuitarShell/backup.json';
    try {
      const summary = await getCloudSyncSummary(path);
      el.textContent = describeCloudSync(summary, { compact: true });
    } catch (err) {
      console.warn('[云同步] 读取设置页状态失败:', err.message);
      el.textContent = '同步状态读取失败 · 仍可手动上传 / 下载';
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

  openCloud() {
    this.close();
    const readerTab = document.querySelector('.tab-btn[data-target="view-reader"]');
    if (readerTab) readerTab.click();
    // 等读谱视图和抽屉退场动画完成后再打开云同步弹窗，避免弹窗落在隐藏视图里
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-cloud-sync'));
    }, 300);
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
