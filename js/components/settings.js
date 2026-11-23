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

const settingsCSS = `
  button, label, input, select { outline: none !important; -webkit-tap-highlight-color: transparent !important; }
  :host, * { -webkit-tap-highlight-color: transparent !important; }
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
    width: min(88vw, 380px); height: 100%; display: flex; flex-direction: column;
    background:
      radial-gradient(560px 260px at 100% -8%, rgba(var(--primary-rgb), .13), transparent 66%),
      linear-gradient(180deg, var(--drawer-a), var(--drawer-b));
    border-left: 1px solid var(--drawer-border);
    box-shadow: -24px 0 60px var(--shadow-color);
    transform: translateX(100%); transition: transform .28s cubic-bezier(.2,.8,.2,1);
  }
  .mask.show .drawer { transform: translateX(0); }
  .head {
    padding: calc(20px + env(safe-area-inset-top)) 18px 16px;
    border-bottom: 1px solid var(--line); display: flex; align-items: flex-start; gap: 12px;
  }
  .head-copy { flex: 1; min-width: 0; }
  .eyebrow { font-size: 10px; letter-spacing: 2px; color: var(--muted); text-transform: uppercase; margin-bottom: 5px; }
  h2 { margin: 0; font-size: 22px; line-height: 1.2; color: var(--heading); letter-spacing: .5px; }
  .head p { margin: 7px 0 0; font-size: 11px; color: var(--muted); }
  .close {
    flex: 0 0 auto; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--txt); font-size: 20px; line-height: 1; cursor: pointer;
    display: grid; place-items: center;
  }
  .close:active { background: var(--surface-hover); }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px calc(24px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 12px; }
  .card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 18px; padding: 14px; }
  .card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 11px; }
  .card-head .ico { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 8px; background: rgba(var(--primary-rgb), .14); color: var(--accent-text); font-size: 13px; }
  h3 { margin: 0; font-size: 13px; font-weight: 700; color: var(--heading); letter-spacing: .4px; }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 11px; }
  .stat { background: var(--surface-deep); border: 1px solid var(--line); border-radius: 12px; padding: 10px 11px; display: flex; align-items: baseline; gap: 5px; }
  .stat b { font-size: 20px; color: var(--accent-text); font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11px; color: var(--muted); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .act {
    width: 100%; min-height: 42px; border-radius: 12px; border: 1px solid var(--line-strong); background: var(--surface-raised);
    color: var(--txt); font-size: 13px; font-weight: 700; font-family: inherit; cursor: pointer;
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
  .hint { margin: 9px 2px 0; font-size: 11px; line-height: 1.6; color: var(--muted); }
  .hint b { color: var(--txt-soft); font-weight: 600; }
  .status { min-height: 16px; margin-top: 8px; font-size: 11px; color: var(--accent-text); line-height: 1.5; word-break: break-all; }
  .cloud-note { margin: 0 2px 10px; font-size: 11px; line-height: 1.65; color: var(--muted); }
  .cloud-note b { color: var(--txt-soft); font-weight: 600; }
  .cloud-status { margin: 0 2px 10px; font-size: 11px; line-height: 1.6; color: var(--accent-text); }

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
  .about-brand { display: flex; align-items: center; gap: 11px; }
  .about-brand img { width: 42px; height: 42px; border-radius: 11px; object-fit: contain; box-shadow: 0 4px 14px rgba(var(--shadow-rgb), .28); }
  .about-copy { flex: 1; min-width: 0; }
  .about-copy b { display: block; font-size: 15px; color: var(--heading); }
  .about-copy small { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; }
  .ver { padding: 3px 8px; border: 1px solid var(--line-strong); border-radius: 999px; color: var(--accent-text); font-size: 10px; font-variant-numeric: tabular-nums; }
  .about p { margin: 11px 2px 0; font-size: 11px; line-height: 1.7; color: var(--muted); }
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
    color: var(--accent-text); text-decoration: none;
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
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="全局设置">
      <div class="head">
        <div class="head-copy">
          <div class="eyebrow">Global Settings</div>
          <h2>全局设置</h2>
          <p>本地优先 · 数据只留在这台设备</p>
        </div>
        <button class="close" id="btnClose" type="button" aria-label="关闭设置">×</button>
      </div>
      <div class="body">
        <section class="card">
          <div class="card-head"><span class="ico">▦</span><h3>数据管理</h3></div>
          <div class="stats">
            <div class="stat"><b id="scoreCount">—</b><span>份乐谱</span></div>
            <div class="stat"><b id="logCount">—</b><span>条练习</span></div>
          </div>
          <div class="grid2">
            <button class="act primary" id="btnBackup" type="button">📤 本地备份</button>
            <button class="act" id="btnRestore" type="button">📥 从文件恢复</button>
          </div>
          <button class="danger" id="btnClear" type="button">清空乐谱与练习记录</button>
          <div class="status" id="statusLine"></div>
          <p class="hint">备份包含乐谱、阅读进度、页级书签和练习记录。Android 版会保存到 <b>Download/GuitarShell</b>，网页版进入浏览器下载目录。</p>
        </section>

        <section class="card">
          <div class="card-head"><span class="ico">☁</span><h3>云同步</h3></div>
          <p class="cloud-note">坚果云 WebDAV · 手动上传 / 下载。账号与应用密码由读谱页的云同步弹窗管理，密码只在本机加密保存。</p>
          <p class="cloud-status" id="cloudStatus">正在读取同步状态…</p>
          <button class="act" id="btnCloudEntry" type="button">☁ 打开云同步</button>
        </section>

        <section class="card">
          <div class="card-head"><span class="ico">◐</span><h3>外观</h3></div>
          <button class="theme-choice" id="themeDeep" data-theme-choice="deep" type="button" aria-pressed="true">
            <span class="swatch swatch-dark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            <span class="theme-copy"><b>复古木质 · 深夜琴房</b><small>深色 · 低光练琴，保留原有木质暖调</small></span>
            <span class="tag">使用中</span>
          </button>
          <button class="theme-choice" id="themeLight" data-theme-choice="light" type="button" aria-pressed="false">
            <span class="swatch swatch-light" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            <span class="theme-copy"><b>暖纸日光 · 日间模式</b><small>浅色 · 暖纸底 / 深暖棕文字</small></span>
            <span class="tag">使用中</span>
          </button>
          <p class="hint">两套主题都使用九色 token，点按即切换并保存在本机；读谱、节拍器、调音与记录会同步换色。</p>
        </section>

        <section class="card about">
          <div class="card-head"><span class="ico">◎</span><h3>关于</h3></div>
          <div class="about-brand">
            <img src="./icon-gShell-192.png" data-theme-icon data-dark-src="./icon-gShell-192.png" data-light-src="./icon-gShell-light-192.png" alt="">
            <div class="about-copy"><b>Guitar Shell</b><small>吉他手的一站式练琴工作站</small></div>
            <span class="ver" id="appVer">v…</span>
          </div>
          <p>零构建原生 Web Components · PWA / Android 壳。<br><b>无账号、无云端默认上传</b>，乐谱与练习记录默认只存在本机。</p>
          <div class="dev-row">
            <span>找到开发者：</span>
            <a class="dev-link" id="btnGithub" href="https://github.com/moanet/GuitarShell" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 打开 Guitar Shell 项目" title="GitHub">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0c6.63 0 12 5.276 12 11.79-.001 5.067-3.29 9.567-8.175 11.187-.6.118-.825-.25-.825-.56 0-.398.015-1.665.015-3.242 0-1.105-.375-1.813-.81-2.181 2.67-.295 5.475-1.297 5.475-5.822 0-1.297-.465-2.344-1.23-3.169.12-.295.54-1.503-.12-3.125 0 0-1.005-.324-3.3 1.209a11.32 11.32 0 00-3-.398c-1.02 0-2.04.133-3 .398-2.295-1.518-3.3-1.209-3.3-1.209-.66 1.622-.24 2.83-.12 3.125-.765.825-1.23 1.887-1.23 3.169 0 4.51 2.79 5.527 5.46 5.822-.345.294-.66.81-.765 1.577-.69.31-2.415.81-3.495-.973-.225-.354-.9-1.223-1.845-1.209-1.005.015-.405.56.015.781.51.28 1.095 1.327 1.23 1.666.24.663 1.02 1.93 4.035 1.385 0 .988.015 1.916.015 2.196 0 .31-.225.664-.825.56C3.303 21.374-.003 16.867 0 11.791 0 5.276 5.37 0 12 0z"/></svg>
            </a>
          </div>
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
  }

  open() {
    this.$('mask').classList.add('show');
    if (!this._layerOff) {
      this._layerOff = registerLayer({
        id: 'settings-drawer',
        close: () => this.close()
      });
    }
    this.refreshStats();
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

  async refreshCloudStatus() {
    const el = this.$('cloudStatus');
    if (!el) return;
    el.textContent = '正在读取同步状态…';
    const path = localStorage.getItem('gs_cloud_path') || 'GuitarShell/backup.json';
    try {
      const summary = await getCloudSyncSummary(path);
      el.textContent = describeCloudSync(summary);
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
