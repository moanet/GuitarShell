// ==========================================
// js/components/share-preview.js
// 0.1.13 练习卡片预览浮层：预览 / 曲名开关 / 分享或保存
// 浮层挂在 document.body，注册 ui-layer，返回键与遮罩可关闭
// ==========================================

import {
  drawShareCard, canvasToPngBlob, exportShareCard, cardFileName
} from '../services/share-card.js';
import { showToast } from '../services/toast.js';
import { registerLayer, bindBackdrop } from '../services/ui-layer.js';

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
  .hint { margin: 0; font-size: 11px; color: var(--muted); line-height: 1.5; }
  .footer { display: flex; gap: 10px; }
  .btn {
    flex: 1; padding: 12px; border-radius: 11px; border: none; font-size: 14px; font-weight: 700;
    font-family: inherit; cursor: pointer;
  }
  .btn.cancel { background: var(--line-strong); color: var(--txt); }
  .btn.primary { background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary); }
  .btn:disabled { opacity: .55; cursor: wait; }
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
      <p class="hint">卡片只在本机生成，不会上传任何练习数据。</p>
      <div class="footer">
        <button class="btn cancel" id="btnCancel" type="button">取消</button>
        <button class="btn primary" id="btnShare" type="button">分享</button>
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
    this.dataset.shareChannel = this.native ? 'native' : 'web';
    this.$('btnShare').textContent = this.native ? '分享到…' : '保存图片';

    this.$('btnClose').onclick = () => this.close();
    this.$('btnCancel').onclick = () => this.close();
    bindBackdrop(this.$('mask'), () => this.close());
    this.$('chkName').onchange = () => this.render();
    this.$('btnShare').onclick = () => this.share();
  }

  async open(summary) {
    this.summary = summary;
    const hasName = Boolean(summary && summary.topName);
    const chk = this.$('chkName');
    chk.checked = false;
    chk.disabled = !hasName;
    this.$('nameHint').textContent = hasName ? '默认不显示曲名' : '今日没有可显示的曲名';
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
      try { this.$('btnShare').focus({ preventScroll: true }); } catch (err) {}
    });
    return this;
  }

  async render() {
    if (!this.summary) return;
    const showName = this.$('chkName').checked;
    await drawShareCard(this.canvas, this.summary, { showName });
  }

  async share() {
    if (this.busy) return;
    this.busy = true;
    const btn = this.$('btnShare');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '正在生成…';
    try {
      const blob = await canvasToPngBlob(this.canvas);
      const result = await exportShareCard(blob, cardFileName());
      showToast(result.channel === 'native' ? '已打开系统分享' : '图片已保存到下载目录');
      this.close();
    } catch (err) {
      console.warn('[分享卡] 导出失败:', err.message);
      showToast(`导出失败：${err.message}`);
      btn.disabled = false;
      btn.textContent = label;
    } finally {
      this.busy = false;
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
