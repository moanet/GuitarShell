// ==========================================
// js/components/app-dialog.js
// 全局应用内确认弹窗：替换原生 confirm / alert
// 挂载到 document.body，跨组件 Shadow DOM 共用
// ==========================================

const dialogCSS = `
  :host {
    position: fixed; inset: 0; z-index: 1400; display: block;
    font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", -apple-system, sans-serif;
    color: var(--txt);
  }
  .mask {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: max(20px, env(safe-area-inset-top, 0px)) 16px calc(20px + env(safe-area-inset-bottom, 0px));
    background: rgba(var(--shadow-rgb), .68); backdrop-filter: blur(2px);
    opacity: 0; transition: opacity .18s ease;
  }
  .mask.show { opacity: 1; }
  .box {
    width: min(92vw, 380px); max-height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch;
    background: var(--surface-raised); border: 1px solid var(--line-warm); border-radius: 18px;
    box-shadow: 0 24px 64px var(--shadow-color); padding: 20px;
    display: flex; flex-direction: column; gap: 14px;
  }
  h3 { margin: 0; text-align: center; color: var(--accent-text); font-size: 18px; line-height: 1.4; }
  .message { margin: 0; font-size: 13px; line-height: 1.7; color: var(--txt-soft); white-space: pre-line; text-align: center; }
  .details { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 10px; background: var(--surface-deep); border: 1px solid var(--line); }
  .detail-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; font-size: 12px; line-height: 1.5; }
  .detail-row .k { color: var(--muted); flex: none; }
  .detail-row .v { color: var(--txt); text-align: right; min-width: 0; overflow-wrap: anywhere; }
  .extra {
    width: 100%; padding: 10px 12px; border-radius: 9px; border: 1px solid var(--line-warm);
    background: transparent; color: var(--accent-text); font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .extra:hover { background: rgba(var(--primary-rgb), .12); }
  .extra:disabled { opacity: .55; cursor: wait; }
  .footer { display: flex; gap: 10px; margin-top: 2px; }
  .btn { flex: 1; padding: 12px; border-radius: 9px; border: none; font-size: 14px; font-weight: 700; cursor: pointer; }
  .btn.cancel { background: var(--line-strong); color: var(--txt); }
  .btn.confirm { background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary); }
  .btn.danger { background: var(--danger); color: var(--on-danger); }
  .btn:disabled { opacity: .55; cursor: not-allowed; }
  .btn:focus-visible, .extra:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  @media (max-width: 360px) {
    .box { padding: 16px; gap: 12px; }
    .footer { flex-direction: column-reverse; }
  }
`;

const dialogHTML = `
  <div class="mask" part="mask">
    <div class="box" role="dialog" aria-modal="true" aria-labelledby="dlgTitle" aria-describedby="dlgMessage">
      <h3 id="dlgTitle"></h3>
      <p class="message" id="dlgMessage"></p>
      <div class="details" id="dlgDetails"></div>
      <button class="extra" id="dlgExtra" type="button"></button>
      <div class="footer">
        <button class="btn cancel" id="dlgCancel" type="button">取消</button>
        <button class="btn confirm" id="dlgConfirm" type="button">确定</button>
      </div>
    </div>
  </div>
`;

class GuitarDialog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._opened = false;
    this._resolve = null;
    this._opts = {};
    this._busy = false;
    this._prevFocus = null;
    this._keyHandler = (e) => {
      if (!this._opened) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close(false);
      }
    };
  }

  connectedCallback() {
    if (this._rootBuilt) return;
    this._rootBuilt = true;
    this.shadowRoot.innerHTML = `<style>${dialogCSS}</style>${dialogHTML}`;
    this._mask = this.shadowRoot.querySelector('.mask');
    this._title = this.shadowRoot.querySelector('#dlgTitle');
    this._message = this.shadowRoot.querySelector('#dlgMessage');
    this._details = this.shadowRoot.querySelector('#dlgDetails');
    this._extra = this.shadowRoot.querySelector('#dlgExtra');
    this._cancel = this.shadowRoot.querySelector('#dlgCancel');
    this._confirm = this.shadowRoot.querySelector('#dlgConfirm');

    this._mask.addEventListener('click', (e) => {
      if (e.target === this._mask && !this._busy) this.close(false);
    });
    this._cancel.addEventListener('click', () => this.close(false));
    this._confirm.addEventListener('click', () => this.close(true));
    this._extra.addEventListener('click', () => this._runExtra());
  }

  open(options = {}) {
    this._opts = options;
    this._prevFocus = document.activeElement;
    this._title.textContent = options.title || '请确认';
    this._message.textContent = options.message || '';
    this._message.hidden = !options.message;

    this._details.innerHTML = '';
    const details = Array.isArray(options.details) ? options.details.filter(Boolean) : [];
    details.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'detail-row';
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = item.label ?? '';
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = item.value ?? '';
      row.append(k, v);
      this._details.appendChild(row);
    });
    this._details.hidden = details.length === 0;

    this._extra.hidden = !options.extra;
    if (options.extra) {
      this._extra.textContent = options.extra.label || '更多操作';
      this._extra.disabled = false;
    }

    const cancelText = options.cancelText === null ? '' : (options.cancelText || '取消');
    this._cancel.textContent = cancelText;
    this._cancel.hidden = !cancelText;
    this._confirm.textContent = options.confirmText || '确定';
    this._confirm.classList.toggle('danger', !!options.danger);

    this._opened = true;
    document.addEventListener('keydown', this._keyHandler);
    this.dispatchEvent(new CustomEvent('dialog-open', { bubbles: true }));
    requestAnimationFrame(() => this._mask.classList.add('show'));

    const focusTarget = options.danger && cancelText ? this._cancel : this._confirm;
    setTimeout(() => focusTarget.focus({ preventScroll: true }), 0);

    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  async _runExtra() {
    const extra = this._opts.extra;
    if (!extra || this._busy) return;
    this._busy = true;
    this._extra.disabled = true;
    this._cancel.disabled = true;
    this._confirm.disabled = true;
    try {
      await extra.onClick?.();
    } catch (err) {
      console.error('[对话框] 附加操作失败:', err);
    } finally {
      this._busy = false;
      this._extra.disabled = false;
      this._cancel.disabled = false;
      this._confirm.disabled = false;
      this._extra.focus({ preventScroll: true });
    }
  }

  close(result = false) {
    if (!this._opened) return;
    this._opened = false;
    document.removeEventListener('keydown', this._keyHandler);
    this._mask.classList.remove('show');
    this._cancel.disabled = true;
    this._confirm.disabled = true;
    this._extra.disabled = true;
    const resolve = this._resolve;
    this._resolve = null;
    setTimeout(() => {
      this.remove();
      resolve?.(!!result);
      try { this._prevFocus?.focus?.({ preventScroll: true }); } catch (err) {}
    }, 180);
  }
}

if (!customElements.get('guitar-app-dialog')) {
  customElements.define('guitar-app-dialog', GuitarDialog);
}

let activeDialog = null;

function openDialog(options) {
  activeDialog?.close(false);

  const el = document.createElement('guitar-app-dialog');
  document.body.appendChild(el);
  activeDialog = el;

  const promise = el.open(options);
  return promise.finally(() => {
    if (activeDialog === el) activeDialog = null;
  });
}

export function showConfirm(options = {}) {
  return openDialog({
    title: '请确认',
    cancelText: '取消',
    confirmText: '确定',
    ...options
  });
}

export function showAlert(message, options = {}) {
  return openDialog({
    title: '提示',
    cancelText: null,
    confirmText: '知道了',
    ...options,
    message
  });
}
