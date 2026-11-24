// ==========================================
// js/components/share-preview.js
// 0.1.14a 练习卡片预览浮层：预览 / 曲名开关 / 六套背景 / 分享或保存
// 浮层挂在 document.body，注册 ui-layer，返回键与遮罩可关闭
// ==========================================

import {
  drawShareCard, canvasToPngBlob, saveShareCard, shareShareCard, cardFileName,
  canWebShareCard, SHARE_BACKGROUNDS, DEFAULT_SHARE_BG, getShareBackground
} from '../services/share-card.js';
import { showToast } from '../services/toast.js';
import { registerLayer, bindBackdrop } from '../services/ui-layer.js';

const BG_STORAGE_KEY = 'gs_share_bg';

function readShareBg() {
  try {
    return getShareBackground(localStorage.getItem(BG_STORAGE_KEY)).id;
  } catch (err) {
    return DEFAULT_SHARE_BG;
  }
}

function writeShareBg(id) {
  try {
    localStorage.setItem(BG_STORAGE_KEY, id);
  } catch (err) {}
}

const previewCSS = `
  :host {
    position: fixed; inset: 0; z-index: 1450; display: block;
    font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", -apple-system, sans-serif;
    color: var(--txt);
  }
  .mask {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: max(16px, env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px));
    background: rgba(var(--shadow-rgb), .72); backdrop-filter: blur(3px);
    opacity: 0; transition: opacity .18s ease;
  }
  .mask.show { opacity: 1; }
  .sheet {
    width: min(92vw, 400px); max-height: 100%; overflow-y: auto;
    background: var(--surface-raised); border: 1px solid var(--line-warm); border-radius: 20px;
    box-shadow: 0 24px 64px var(--shadow-color); padding: 16px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .title { font-size: 15px; font-weight: 700; color: var(--heading); letter-spacing: .5px; }
  .close {
    width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--txt); font-size: 18px; cursor: pointer;
    display: grid; place-items: center; font-family: inherit;
  }
  .preview { border-radius: 14px; overflow: hidden; border: 1px solid rgba(var(--primary-rgb), .22); background: #241B15; }
  .preview canvas { display: block; width: 100%; height: auto; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .switch { display: inline-flex; align-items: center; gap: 9px; font-size: 12px; color: var(--txt-soft); cursor: pointer; }
  .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .slider {
    width: 38px; height: 22px; border-radius: 999px; background: var(--line-strong);
    position: relative; transition: background .18s; flex: 0 0 auto;
  }
  .slider::after {
    content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
    border-radius: 50%; background: var(--surface-raised); transition: transform .18s;
  }
  .switch input:checked + .slider { background: var(--primary); }
  .switch input:checked + .slider::after { transform: translateX(16px); }
  .switch input:disabled + .slider { opacity: .45; }
  .bg-row { display: flex; align-items: center; gap: 10px; padding-top: 2px; }
  .bg-label { flex: 0 0 auto; font-size: 12px; color: var(--txt-soft); }
  .swatches {
    display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 2px;
    overflow-x: auto; scrollbar-width: none;
  }
  .swatches::-webkit-scrollbar { display: none; }
  .swatch {
    width: 28px; height: 28px; padding: 0; border-radius: 50%; cursor: pointer;
    border: 1px solid rgba(255,255,255,.16); box-sizing: border-box; flex: 0 0 auto;
  }
  .swatch[data-light="1"] { border-color: rgba(30,24,18,.28); }
  .swatch.selected {
    box-shadow: 0 0 0 2px var(--surface-raised), 0 0 0 3px var(--primary);
  }
  .swatch:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .swatch:disabled { opacity: .55; cursor: wait; }
  .hint { margin: 0; font-size: 11px; color: var(--muted); line-height: 1.5; }
  .footer { display: flex; gap: 10px; }
  .btn {
    padding: 12px; border-radius: 11px; font-size: 14px; font-weight: 700;
    font-family: inherit; cursor: pointer; box-sizing: border-box;
  }
  .btn.primary {
    flex: 2; border: none;
    background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary);
  }
  .btn.secondary {
    flex: 1; border: 1px solid var(--line-strong); background: transparent; color: var(--txt);
  }
  .btn:disabled { opacity: .55; cursor: wait; }
  .btn[hidden] { display: none; }
  @media (max-width: 360px) {
    .sheet { padding: 13px; gap: 10px; }
  }
`;

const previewHTML = `
  <div class="mask" id="mask">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="练习卡片">
      <div class="head">
        <span class="title">练习卡片</span>
        <button class="close" id="btnClose" type="button" aria-label="关闭">×</button>
      </div>
      <div class="preview"><canvas id="cardCanvas" width="1080" height="1440"></canvas></div>
      <div class="row">
        <label class="switch">
          <input type="checkbox" id="chkName">
          <span class="slider" aria-hidden="true"></span>
          <span>显示曲名</span>
        </label>
        <span class="hint" id="nameHint">默认不显示曲名</span>
      </div>
      <div class="bg-row">
        <span class="bg-label">背景</span>
        <div class="swatches" id="swatches" role="group" aria-label="卡片背景"></div>
      </div>
      <p class="hint">卡片只在本机生成，不会上传任何练习数据。</p>
      <div class="footer">
        <button class="btn primary" id="btnSave" type="button">保存到相册</button>
        <button class="btn secondary" id="btnShare" type="button">分享</button>
      </div>
    </div>
  </div>
`;

function isNativeShell() {
  return Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
}

class GuitarSharePreview extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.busy = false;
    this._layerOff = null;
    this._keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    };
  }

  connectedCallback() {
    if (this._built) return;
    this._built = true;
    this.shadowRoot.innerHTML = `<style>${previewCSS}</style>${previewHTML}`;
    this.$ = (id) => this.shadowRoot.getElementById(id);
    this.canvas = this.$('cardCanvas');
    this.native = isNativeShell();
    this.canWebShare = this.native || canWebShareCard();
    this.dataset.shareChannel = this.native ? 'native' : 'web';
    this.$('btnSave').textContent = this.native ? '保存到相册' : '保存图片';
    this.$('btnShare').hidden = !this.native && !this.canWebShare;

    this.$('btnClose').onclick = () => this.close();
    bindBackdrop(this.$('mask'), () => this.close());
    this.$('chkName').onchange = () => {
      if (!this.busy) this.render();
    };
    this.$('btnSave').onclick = () => this.save();
    this.$('btnShare').onclick = () => this.share();
    this.bgId = readShareBg();
    this.buildSwatches();
  }

  buildSwatches() {
    const box = this.$('swatches');
    box.innerHTML = '';
    SHARE_BACKGROUNDS.forEach((bg) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.dataset.bg = bg.id;
      btn.dataset.light = bg.light ? '1' : '0';
      btn.title = bg.name;
      btn.setAttribute('aria-label', bg.name);
      btn.style.background = `linear-gradient(135deg, ${bg.top}, ${bg.bottom})`;
      btn.onclick = () => this.selectBackground(bg.id);
      box.appendChild(btn);
    });
    this.syncSwatches();
  }

  syncSwatches() {
    const box = this.$('swatches');
    if (!box) return;
    box.querySelectorAll('.swatch').forEach((btn) => {
      const selected = btn.dataset.bg === this.bgId;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  selectBackground(id) {
    if (this.busy) return;
    this.bgId = getShareBackground(id).id;
    writeShareBg(this.bgId);
    this.syncSwatches();
    this.render();
  }

  async open(summary) {
    this.summary = summary;
    const hasName = Boolean(summary && summary.topName);
    this._hasName = hasName;
    const chk = this.$('chkName');
    chk.checked = false;
    chk.disabled = !hasName;
    this.$('nameHint').textContent = hasName ? '默认不显示曲名' : '今日没有可显示的曲名';
    this.bgId = readShareBg();
    this.syncSwatches();
    this._setBusy(false);
    this.$('mask').classList.add('show');
    if (!this._layerOff) {
      this._layerOff = registerLayer({
        id: 'share-preview',
        close: () => this.close()
      });
    }
    document.addEventListener('keydown', this._keyHandler);
    await this.render();
    requestAnimationFrame(() => {
      try { this.$('btnSave').focus({ preventScroll: true }); } catch (err) {}
    });
    return this;
  }

  _setBusy(on, action) {
    this.busy = on;
    const save = this.$('btnSave');
    const share = this.$('btnShare');
    const chk = this.$('chkName');
    if (!save || !share || !chk) return;
    save.disabled = on;
    share.disabled = on;
    chk.disabled = on || !this._hasName;
    this.$('swatches').querySelectorAll('.swatch').forEach((btn) => {
      btn.disabled = on;
    });
    save.textContent = on && action === 'save'
      ? '正在保存…'
      : (this.native ? '保存到相册' : '保存图片');
    share.textContent = on && action === 'share' ? '正在打开…' : '分享';
  }

  async render() {
    if (!this.summary || this.busy) return;
    const showName = this.$('chkName').checked;
    await drawShareCard(this.canvas, this.summary, { showName, background: this.bgId });
  }

  async save() {
    if (this.busy) return;
    this._setBusy(true, 'save');
    try {
      const blob = await canvasToPngBlob(this.canvas);
      const result = await saveShareCard(blob, cardFileName());
      showToast(result.channel === 'native-gallery' ? '已保存到相册' : '图片已下载');
    } catch (err) {
      console.warn('[分享卡] 保存失败:', err.message);
      showToast(`保存失败：${err.message}`);
    } finally {
      this._setBusy(false);
    }
  }

  async share() {
    if (this.busy) return;
    this._setBusy(true, 'share');
    try {
      const blob = await canvasToPngBlob(this.canvas);
      const result = await shareShareCard(blob, cardFileName());
      if (result.cancelled) showToast('已取消分享');
      else if (result.channel === 'native') showToast('已打开系统分享');
      else if (result.channel === 'web-share') showToast('已打开分享');
      else showToast('图片已下载');
    } catch (err) {
      console.warn('[分享卡] 分享失败:', err.message);
      showToast(`分享失败：${err.message}`);
    } finally {
      this._setBusy(false);
    }
  }

  close() {
    document.removeEventListener('keydown', this._keyHandler);
    if (this._layerOff) { this._layerOff(); this._layerOff = null; }
    const mask = this.$('mask');
    if (mask) mask.classList.remove('show');
    setTimeout(() => this.remove(), 180);
  }
}

if (!customElements.get('guitar-share-preview')) {
  customElements.define('guitar-share-preview', GuitarSharePreview);
}
