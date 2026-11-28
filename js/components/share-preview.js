// ==========================================
// js/components/share-preview.js
// 0.1.14b 练习卡片预览浮层：预览 / 曲名开关 / 六套预设 + 自定义背景 / 分享或保存
// 浮层挂在 document.body，注册 ui-layer，返回键与遮罩可关闭
// ==========================================

import {
  drawShareCard, canvasToPngBlob, saveShareCard, shareShareCard, cardFileName,
  canWebShareCard, SHARE_BACKGROUNDS, DEFAULT_SHARE_BG, getShareBackground
} from '../services/share-card.js';
import {
  CUSTOM_BG_ID, CUSTOM_BG_2_ID, CUSTOM_BG_IDS, isCustomBgId,
  getSelectedBackground, setSelectedBackground, getBackgroundDim,
  setBackgroundDim, loadCustomBackground, removeCustomBackground, pickCustomBackgroundFile
} from '../services/share-bg.js';
import { showToast } from '../services/toast.js';
import { registerLayer, bindBackdrop } from '../services/ui-layer.js';
import './share-bg-crop.js';

function readShareBg() {
  try {
    const stored = localStorage.getItem('gs_share_bg');
    if (isCustomBgId(stored)) return stored;
    return getShareBackground(getSelectedBackground()).id;
  } catch (err) {
    return DEFAULT_SHARE_BG;
  }
}

function writeShareBg(id) {
  setSelectedBackground(id);
}

const previewCSS = `
  :host { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  input, textarea, select, [contenteditable="true"] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
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
  .swatch.custom {
    border-radius: 9px; border: 1px dashed rgba(var(--primary-rgb), .55);
    background: rgba(var(--primary-rgb), .08) center / cover no-repeat;
    display: grid; place-items: center; color: var(--primary); font-size: 16px; font-weight: 600;
  }
  .swatch.custom.has-image { border-style: solid; color: transparent; }
  .custom-tools {
    display: flex; flex-direction: column; gap: 7px;
    padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: 10px;
    background: rgba(var(--primary-rgb), .04);
  }
  .custom-tools[hidden] { display: none; }
  .dim-row { display: flex; align-items: center; gap: 8px; }
  .dim-row span { flex: 0 0 auto; font-size: 11px; color: var(--txt-soft); }
  .dim-row .dim-value { min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
  .dim-range { flex: 1; min-width: 80px; accent-color: var(--primary); }
  .custom-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .custom-action {
    border: none; background: transparent; color: var(--primary); font-family: inherit;
    font-size: 12px; padding: 1px 0; cursor: pointer;
  }
  .custom-action.danger { color: var(--danger, #B94A3A); }
  .custom-action:disabled { opacity: .5; cursor: wait; }
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
      <div class="custom-tools" id="customTools" hidden>
        <div class="dim-row">
          <span>压暗</span>
          <input class="dim-range" id="dimRange" type="range" min="0" max="90" step="2" value="30" aria-label="自定义背景压暗程度">
          <span class="dim-value" id="dimValue">30%</span>
        </div>
        <div class="custom-actions">
          <button class="custom-action" id="btnReplaceBg" type="button">更换图片</button>
          <button class="custom-action danger" id="btnRemoveBg" type="button">移除</button>
        </div>
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
    this.cropOpen = false;
    this.customs = {};
    CUSTOM_BG_IDS.forEach((slotId) => {
      this.customs[slotId] = {
        image: null,
        asset: null,
        dim: getBackgroundDim(slotId)
      };
    });
    this._layerOff = null;
    this._thumbUrls = {};
    this._renderRaf = 0;
    this._removeTimer = 0;
    this._keyHandler = (e) => {
      if (this.cropOpen) return;
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
    this.$('dimRange').oninput = (e) => this.onDimInput(e);
    this.$('btnReplaceBg').onclick = () => this.chooseCustomBackground({ replace: true });
    this.$('btnRemoveBg').onclick = () => this.armRemoveCustom();
    this.bgId = readShareBg();
    this.buildSwatches();
  }

  _customLabel(slotId) {
    return slotId === CUSTOM_BG_2_ID ? '自定义背景 2' : '自定义背景 1';
  }

  _activeCustom() {
    return isCustomBgId(this.bgId) ? this.customs[this.bgId] : null;
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

    CUSTOM_BG_IDS.forEach((slotId) => {
      const custom = document.createElement('button');
      custom.type = 'button';
      custom.className = 'swatch custom';
      custom.dataset.bg = slotId;
      custom.dataset.slot = slotId;
      custom.title = this._customLabel(slotId);
      custom.setAttribute('aria-label', this._customLabel(slotId));
      custom.onclick = () => this.selectBackground(slotId);
      box.appendChild(custom);
    });

    this._updateCustomThumbs();
    this.syncSwatches();
  }

  _setCustomThumb(slotId) {
    const btn = this.$('swatches')?.querySelector(`.swatch.custom[data-bg="${slotId}"]`);
    if (!btn) return;
    if (this._thumbUrls[slotId]) {
      URL.revokeObjectURL(this._thumbUrls[slotId]);
      this._thumbUrls[slotId] = null;
    }
    const slot = this.customs[slotId];
    if (slot && slot.asset && slot.asset.blob instanceof Blob) {
      this._thumbUrls[slotId] = URL.createObjectURL(slot.asset.blob);
      btn.style.backgroundImage = `url("${this._thumbUrls[slotId]}")`;
      btn.textContent = '';
      btn.classList.add('has-image');
      btn.setAttribute('aria-label', `${this._customLabel(slotId)}（已设置）`);
    } else {
      btn.style.backgroundImage = '';
      btn.textContent = '＋';
      btn.classList.remove('has-image');
      btn.setAttribute('aria-label', `添加${this._customLabel(slotId)}`);
    }
  }

  _updateCustomThumbs() {
    CUSTOM_BG_IDS.forEach((slotId) => this._setCustomThumb(slotId));
  }

  syncCustomTools() {
    const tools = this.$('customTools');
    if (!tools) return;
    const active = this._activeCustom();
    const visible = Boolean(active && active.image);
    tools.hidden = !visible;
    const range = this.$('dimRange');
    if (range) range.value = String(active ? active.dim : 30);
    const label = this.$('dimValue');
    if (label) label.textContent = `${active ? active.dim : 30}%`;
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

  async selectBackground(id) {
    if (this.busy) return;
    if (isCustomBgId(id) && !this.customs[id].image) {
      await this.chooseCustomBackground({ replace: false, slotId: id });
      return;
    }
    this.bgId = isCustomBgId(id) ? id : getShareBackground(id).id;
    writeShareBg(this.bgId);
    this.syncSwatches();
    this.syncCustomTools();
    await this.render();
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
    const customLoads = CUSTOM_BG_IDS.map(async (slotId) => {
      const loaded = await loadCustomBackground(slotId);
      this.customs[slotId] = loaded
        ? { image: loaded.image, asset: loaded.asset, dim: getBackgroundDim(slotId) }
        : { image: null, asset: null, dim: getBackgroundDim(slotId) };
    });
    await Promise.all(customLoads);
    if (isCustomBgId(this.bgId) && !this.customs[this.bgId].image) {
      this.bgId = DEFAULT_SHARE_BG;
    }
    this._updateCustomThumbs();
    this.syncSwatches();
    this.syncCustomTools();
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
    ['dimRange', 'btnReplaceBg', 'btnRemoveBg'].forEach((id) => {
      const el = this.$(id);
      if (el) el.disabled = on;
    });
    save.textContent = on && action === 'save'
      ? '正在保存…'
      : (this.native ? '保存到相册' : '保存图片');
    share.textContent = on && action === 'share' ? '正在打开…' : '分享';
  }

  async render() {
    if (!this.summary || this.busy) return;
    const showName = this.$('chkName').checked;
    const active = this._activeCustom();
    const useCustom = Boolean(active && active.image);
    await drawShareCard(this.canvas, this.summary, {
      showName,
      background: this.bgId,
      customImage: useCustom ? active.image : null,
      customDim: active ? active.dim : 30
    });
  }

  _scheduleRender() {
    if (this.busy) return;
    if (this._renderRaf) return;
    this._renderRaf = requestAnimationFrame(() => {
      this._renderRaf = 0;
      this.render();
    });
  }

  onDimInput(e) {
    if (this.busy) return;
    const active = this._activeCustom();
    if (!active) return;
    const slotId = this.bgId;
    const dim = setBackgroundDim(e.target.value, slotId);
    active.dim = dim;
    this.$('dimValue').textContent = `${dim}%`;
    this._scheduleRender();
  }

  async chooseCustomBackground({ replace = false, slotId = this.bgId } = {}) {
    if (this.busy || this.cropOpen) return;
    const targetSlot = isCustomBgId(slotId) ? slotId : CUSTOM_BG_ID;
    let file = null;
    try {
      if (this.native) file = await pickCustomBackgroundFile();
      else file = await this._pickWebFile();
    } catch (err) {
      if (err && err.code === 'PICK_CANCELLED') return;
      console.warn('[背景] 选图失败:', err.message);
      showToast(`选图失败：${err.message}`);
      return;
    }
    if (!file) return;
    await this.openCrop(file, { replace, slotId: targetSlot });
  }

  _pickWebFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      let done = false;
      let focusTimer = 0;
      let guardTimer = 0;
      const finish = (file) => {
        if (done) return;
        done = true;
        clearTimeout(focusTimer);
        clearTimeout(guardTimer);
        window.removeEventListener('focus', onFocus);
        input.remove();
        resolve(file || null);
      };
      const onFocus = () => {
        focusTimer = setTimeout(() => finish(null), 320);
      };
      input.onchange = () => finish(input.files && input.files[0]);
      if ('oncancel' in input) input.oncancel = () => finish(null);
      window.addEventListener('focus', onFocus, { once: true });
      document.body.appendChild(input);
      input.click();
      guardTimer = setTimeout(() => finish(null), 60000);
    });
  }

  async openCrop(file, { replace = false, slotId = this.bgId } = {}) {
    if (this.busy || this.cropOpen) return;
    const targetSlot = isCustomBgId(slotId) ? slotId : CUSTOM_BG_ID;
    this.cropOpen = true;
    this._setBusy(true, 'crop');
    const crop = document.createElement('guitar-share-bg-crop');
    document.body.appendChild(crop);
    let result = null;
    try {
      result = await crop.open(file, { slotId: targetSlot });
    } catch (err) {
      console.warn('[背景] 裁切失败:', err.message);
      showToast(`背景处理失败：${err.message}`);
    } finally {
      this._setBusy(false);
      this.cropOpen = false;
      setTimeout(() => crop.remove(), 220);
    }
    if (!result) return;

    this.customs[targetSlot] = {
      image: result.image,
      asset: result.asset,
      dim: getBackgroundDim(targetSlot)
    };
    this.bgId = targetSlot;
    writeShareBg(targetSlot);
    this._updateCustomThumbs();
    this.syncSwatches();
    this.syncCustomTools();
    await this.render();
    showToast(replace
      ? `已更换${this._customLabel(targetSlot)}`
      : `已设置${this._customLabel(targetSlot)}`);
  }

  armRemoveCustom() {
    if (this.busy) return;
    const btn = this.$('btnRemoveBg');
    if (!btn) return;
    if (!this._removeArmed) {
      this._removeArmed = true;
      btn.textContent = '再点一次移除';
      clearTimeout(this._removeTimer);
      this._removeTimer = setTimeout(() => {
        this._removeArmed = false;
        if (btn.isConnected) btn.textContent = '移除';
      }, 3000);
      return;
    }
    clearTimeout(this._removeTimer);
    this._removeArmed = false;
    btn.textContent = '移除';
    this.removeCustom();
  }

  async removeCustom() {
    if (this.busy) return;
    const slotId = isCustomBgId(this.bgId) ? this.bgId : CUSTOM_BG_ID;
    this._setBusy(true, 'remove');
    try {
      await removeCustomBackground(slotId);
      this.customs[slotId] = {
        image: null,
        asset: null,
        dim: getBackgroundDim(slotId)
      };
      this.bgId = DEFAULT_SHARE_BG;
      this._updateCustomThumbs();
      this.syncSwatches();
      this.syncCustomTools();
      this._setBusy(false);
      await this.render();
      showToast(`已移除${this._customLabel(slotId)}`);
    } catch (err) {
      console.warn('[背景] 移除失败:', err.message);
      showToast(`移除失败：${err.message}`);
    } finally {
      this._setBusy(false);
    }
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
    if (this.cropOpen) return;
    document.removeEventListener('keydown', this._keyHandler);
    if (this._layerOff) { this._layerOff(); this._layerOff = null; }
    if (this._thumbUrls) {
      Object.values(this._thumbUrls).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      this._thumbUrls = {};
    }
    if (this._renderRaf) { cancelAnimationFrame(this._renderRaf); this._renderRaf = 0; }
    const mask = this.$('mask');
    if (mask) mask.classList.remove('show');
    setTimeout(() => this.remove(), 180);
  }
}

if (!customElements.get('guitar-share-preview')) {
  customElements.define('guitar-share-preview', GuitarSharePreview);
}
