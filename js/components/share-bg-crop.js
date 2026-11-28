// ==========================================
// js/components/share-bg-crop.js
// 0.1.27 自定义背景轻量裁切页：9:16 取景、拖动定位、双指缩放、双击居中
// 只做平移和缩放，确认后导出 1080×1920 JPEG
// ==========================================

import {
  decodeBackgroundSource, encodeBackgroundCanvas, saveCustomBackgroundAsset,
  BG_SOURCE_MAX_BYTES, BG_WIDTH, BG_HEIGHT, CUSTOM_BG_ID
} from '../services/share-bg.js';
import { showToast } from '../services/toast.js';
import { registerLayer, bindBackdrop } from '../services/ui-layer.js';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

const cropCSS = `
  :host { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  input, textarea, select, [contenteditable="true"] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
  :host {
    position: fixed; inset: 0; z-index: 1470; display: block;
    font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", -apple-system, sans-serif;
    color: var(--txt);
  }
  .mask {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: max(14px, env(safe-area-inset-top, 0px)) 14px calc(14px + env(safe-area-inset-bottom, 0px));
    background: rgba(var(--shadow-rgb), .82); backdrop-filter: blur(4px);
    opacity: 0; transition: opacity .16s ease; box-sizing: border-box;
  }
  .mask.show { opacity: 1; }
  .panel {
    width: min(100%, 420px); max-height: 100%; overflow-y: auto; box-sizing: border-box;
    background: var(--surface-raised); border: 1px solid var(--line-warm); border-radius: 18px;
    box-shadow: 0 24px 64px var(--shadow-color); padding: 14px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .panel > * { flex: 0 0 auto; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .title { font-size: 15px; font-weight: 700; color: var(--heading); letter-spacing: .5px; }
  .close {
    width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--line-strong);
    background: transparent; color: var(--txt); font-size: 18px; cursor: pointer;
    display: grid; place-items: center; font-family: inherit;
  }
  .frame {
    width: min(100%, 300px); aspect-ratio: 9 / 16; margin: 0 auto; position: relative;
    background: #000; border-radius: 12px; overflow: hidden; touch-action: none;
    border: 1px solid rgba(var(--primary-rgb), .28); box-sizing: border-box;
  }
  .frame canvas {
    display: block; width: 100%; height: 100%; touch-action: none; cursor: grab;
  }
  .frame canvas:active { cursor: grabbing; }
  .frame::after {
    content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: 12px;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
    background:
      linear-gradient(to right, transparent 33.2%, rgba(255,255,255,.16) 33.3%, transparent 33.4%, transparent 66.2%, rgba(255,255,255,.16) 66.3%, transparent 66.4%),
      linear-gradient(to bottom, transparent 33.2%, rgba(255,255,255,.16) 33.3%, transparent 33.4%, transparent 66.2%, rgba(255,255,255,.16) 66.3%, transparent 66.4%);
  }
  .meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 2px; }
  .zoom { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .reset {
    border: none; background: transparent; color: var(--primary); font-family: inherit;
    font-size: 12px; cursor: pointer; padding: 2px 0;
  }
  .hint { margin: 0; text-align: center; font-size: 11px; color: var(--muted); line-height: 1.5; }
  .actions { display: flex; gap: 10px; }
  .btn {
    padding: 12px; border-radius: 11px; font-size: 14px; font-weight: 700;
    font-family: inherit; cursor: pointer; box-sizing: border-box;
  }
  .btn.secondary { flex: 1; border: 1px solid var(--line-strong); background: transparent; color: var(--txt); }
  .btn.primary {
    flex: 2; border: none;
    background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary);
  }
  .btn:disabled, .reset:disabled { opacity: .55; cursor: wait; }
  @media (max-width: 360px) {
    .panel { padding: 12px; gap: 9px; }
  }
  @media (max-height: 640px) {
    .frame { width: min(100%, 230px); }
    .panel { gap: 8px; }
  }
`;

const cropHTML = `
  <div class="mask" id="cropMask">
    <div class="panel" role="dialog" aria-modal="true" aria-label="裁切自定义背景">
      <div class="head">
        <span class="title">裁切背景</span>
        <button class="close" id="btnCropClose" type="button" aria-label="关闭">×</button>
      </div>
      <div class="frame" id="cropFrame"><canvas id="cropCanvas"></canvas></div>
      <div class="meta">
        <span class="zoom" id="zoomText">1.0×</span>
        <button class="reset" id="btnReset" type="button">恢复居中</button>
      </div>
      <p class="hint">拖动调整位置 · 双指缩放 · 双击恢复居中</p>
      <div class="actions">
        <button class="btn secondary" id="btnCropCancel" type="button">取消</button>
        <button class="btn primary" id="btnCropConfirm" type="button">使用这张</button>
      </div>
    </div>
  </div>
`;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

class GuitarShareBgCrop extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.busy = false;
    this._resolve = null;
    this._layerOff = null;
    this._keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
    };
  }

  connectedCallback() {
    if (this._built) return;
    this._built = true;
    this.shadowRoot.innerHTML = `<style>${cropCSS}</style>${cropHTML}`;
    this.$ = (id) => this.shadowRoot.getElementById(id);
    this.canvas = this.$('cropCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.frame = this.$('cropFrame');
    this.$('btnCropClose').onclick = () => this.cancel();
    this.$('btnCropCancel').onclick = () => this.cancel();
    this.$('btnCropConfirm').onclick = () => this.confirm();
    this.$('btnReset').onclick = () => this.reset();
    bindBackdrop(this.$('cropMask'), () => this.cancel());
    this.canvas.addEventListener('dblclick', () => this.reset());
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
  }

  async open(file, { slotId = CUSTOM_BG_ID } = {}) {
    this.slotId = slotId;
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this._layerOff = registerLayer({
        id: 'share-bg-crop',
        close: () => this.cancel()
      });
      this.lastTap = null;
      this.tapStart = null;
      this.pointers = new Map();
      document.addEventListener('keydown', this._keyHandler);
      this.$('cropMask').classList.add('show');
      this._setBusy(true);
      this._load(file).catch((err) => {
        console.warn('[背景裁切] 打开失败:', err.message);
        this._rejectOnce(err);
        this._dispose();
      });
    });
  }

  async _load(file) {
    if (!file) throw new Error('没有拿到图片');
    if (file.size > BG_SOURCE_MAX_BYTES) throw new Error('图片超过 20 MB，请换一张');
    if (file.type && !String(file.type).startsWith('image/')) throw new Error('请选择图片文件');
    const source = await decodeBackgroundSource(file);
    this.source = source;
    this.iw = Number(source.width) || 0;
    this.ih = Number(source.height) || 0;
    if (!this.iw || !this.ih) throw new Error('图片尺寸无效，请换一张');

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const cw = Math.max(1, Math.round(this.frame.clientWidth));
    const ch = Math.max(1, Math.round(this.frame.clientHeight));
    this.cw = cw;
    this.ch = ch;
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.base = Math.max(cw / this.iw, ch / this.ih);
    this.zoom = 1;
    this.cx = this.iw / 2;
    this.cy = this.ih / 2;
    this._clamp();
    this.draw();
    this._setBusy(false);
    requestAnimationFrame(() => {
      try { this.$('btnCropConfirm').focus({ preventScroll: true }); } catch (err) {}
    });
  }

  _scale() {
    return this.base * this.zoom;
  }

  _clamp() {
    const scale = this._scale();
    const halfW = this.cw / (2 * scale);
    const halfH = this.ch / (2 * scale);
    this.cx = halfW >= this.iw / 2 ? this.iw / 2 : clamp(this.cx, halfW, this.iw - halfW);
    this.cy = halfH >= this.ih / 2 ? this.ih / 2 : clamp(this.cy, halfH, this.ih - halfH);
  }

  draw() {
    if (!this.source || !this.ctx) return;
    const scale = this._scale();
    const sw = this.cw / scale;
    const sh = this.ch / scale;
    const sx = this.cx - sw / 2;
    const sy = this.cy - sh / 2;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.cw, this.ch);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(this.source.image, sx, sy, sw, sh, 0, 0, this.cw, this.ch);
    const zoomText = this.$('zoomText');
    if (zoomText) zoomText.textContent = `${this.zoom.toFixed(1)}×`;
    this.dataset.zoom = String(this.zoom.toFixed(2));
  }

  reset() {
    if (!this.source || this.busy) return;
    this.zoom = 1;
    this.cx = this.iw / 2;
    this.cy = this.ih / 2;
    this._clamp();
    this.draw();
  }

  _point(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _onPointerDown(e) {
    if (!this.source || this.busy) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    const p = this._point(e);
    this.pointers = this.pointers || new Map();
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.panLast = p;
      this.pinch = null;
      this.tapStart = { x: p.x, y: p.y, time: Date.now(), moved: false };
    } else if (this.pointers.size === 2) {
      this.tapStart = null;
      const pts = [...this.pointers.values()];
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      this.pinch = {
        startZoom: this.zoom,
        startDist: Math.max(1, distance(pts[0], pts[1])),
        mid,
        focalX: this.cx + (mid.x - this.cw / 2) / this._scale(),
        focalY: this.cy + (mid.y - this.ch / 2) / this._scale()
      };
      this.panLast = null;
    }
  }

  _onPointerMove(e) {
    if (!this.pointers || !this.pointers.has(e.pointerId) || !this.source || this.busy) return;
    e.preventDefault();
    const p = this._point(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size >= 2 && this.pinch) {
      const pts = [...this.pointers.values()].slice(0, 2);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dist = Math.max(1, distance(pts[0], pts[1]));
      this.zoom = clamp(this.pinch.startZoom * dist / this.pinch.startDist, MIN_ZOOM, MAX_ZOOM);
      const scale = this._scale();
      this.cx = this.pinch.focalX - (mid.x - this.cw / 2) / scale;
      this.cy = this.pinch.focalY - (mid.y - this.ch / 2) / scale;
      this._clamp();
      this.draw();
      return;
    }

    if (this.pointers.size === 1 && this.panLast) {
      const dx = p.x - this.panLast.x;
      const dy = p.y - this.panLast.y;
      if (this.tapStart && Math.hypot(p.x - this.tapStart.x, p.y - this.tapStart.y) > 8) {
        this.tapStart.moved = true;
      }
      const scale = this._scale();
      this.cx -= dx / scale;
      this.cy -= dy / scale;
      this.panLast = p;
      this._clamp();
      this.draw();
    }
  }

  _onPointerUp(e) {
    if (!this.pointers) return;
    const p = this._point(e);
    const wasLast = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    if (this.pointers.size === 1) {
      this.panLast = [...this.pointers.values()][0];
    } else {
      this.panLast = null;
    }

    if (
      wasLast &&
      e.type === 'pointerup' &&
      e.pointerType !== 'mouse' &&
      this.tapStart &&
      !this.tapStart.moved &&
      Date.now() - this.tapStart.time < 320
    ) {
      const last = this.lastTap;
      const now = Date.now();
      if (last && now - last.time < 340 && Math.hypot(p.x - last.x, p.y - last.y) < 36) {
        this.lastTap = null;
        this.reset();
      } else {
        this.lastTap = { x: p.x, y: p.y, time: now };
      }
    }
    this.tapStart = null;
  }

  _setBusy(on) {
    this.busy = on;
    ['btnCropClose', 'btnCropCancel', 'btnCropConfirm', 'btnReset'].forEach((id) => {
      const el = this.$(id);
      if (el) el.disabled = on;
    });
    const confirm = this.$('btnCropConfirm');
    if (confirm) confirm.textContent = on ? '正在处理…' : '使用这张';
  }

  async confirm() {
    if (this.busy || !this.source) return;
    this._setBusy(true);
    try {
      const out = document.createElement('canvas');
      out.width = BG_WIDTH;
      out.height = BG_HEIGHT;
      const ctx = out.getContext('2d');
      const scale = Math.max(BG_WIDTH / this.iw, BG_HEIGHT / this.ih) * this.zoom;
      const sw = BG_WIDTH / scale;
      const sh = BG_HEIGHT / scale;
      const sx = this.cx - sw / 2;
      const sy = this.cy - sh / 2;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, BG_WIDTH, BG_HEIGHT);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.source.image, sx, sy, sw, sh, 0, 0, BG_WIDTH, BG_HEIGHT);
      const processed = await encodeBackgroundCanvas(out, '');
      const saved = await saveCustomBackgroundAsset(processed, this.slotId || CUSTOM_BG_ID);
      this._finish(saved);
    } catch (err) {
      console.warn('[背景裁切] 处理失败:', err.message);
      showToast(`图片处理失败：${err.message}`);
      this._setBusy(false);
    }
  }

  cancel() {
    if (this.busy) return;
    this._finish(null);
  }

  _finish(result) {
    if (!this._resolve) return;
    const resolve = this._resolve;
    this._resolve = null;
    this._reject = null;
    resolve(result);
    this._dispose();
    setTimeout(() => this.remove(), 160);
  }

  _rejectOnce(err) {
    const reject = this._reject;
    this._resolve = null;
    this._reject = null;
    if (reject) reject(err);
  }

  _dispose() {
    document.removeEventListener('keydown', this._keyHandler);
    if (this._layerOff) { this._layerOff(); this._layerOff = null; }
    const mask = this.$('cropMask');
    if (mask) mask.classList.remove('show');
    if (this.source && this.source.image && typeof this.source.image.close === 'function') {
      this.source.image.close();
    }
    this.source = null;
  }
}

if (!customElements.get('guitar-share-bg-crop')) {
  customElements.define('guitar-share-bg-crop', GuitarShareBgCrop);
}
