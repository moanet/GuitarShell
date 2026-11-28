// 底部弹层下滑关闭：把手 / 标题栏始终可拖，内容区只在滚动到顶部时接管。
// pointer 与 touch 双通道：Android WebView 个别机型不派发 pointermove，touch 兜底；
// 鼠标 / 触控笔走 pointer，触摸走 touch，避免同一手势执行两次。

const MIN_DISTANCE = 6;
const MIN_THRESHOLD = 48;
const MAX_THRESHOLD = 96;
const VELOCITY = 0.6;
const VELOCITY_DISTANCE = 24;
const CLICK_GUARD_MS = 350;

export function bindSheetSwipe({ sheet, scrollEl = null, grabEls = [], isBlocked = null, onClose }) {
  if (!sheet || typeof onClose !== 'function') return () => {};
  const scrollTarget = scrollEl || sheet;
  const grabList = (Array.isArray(grabEls) ? grabEls : [grabEls]).filter(Boolean);

  let drag = null;
  let pointerId = null;
  let touchId = null;
  let touchMulti = false;
  let suppressClickUntil = 0;

  const isGrab = (target) => grabList.some((el) => el === target || el.contains(target));
  const blocked = () => (typeof isBlocked === 'function' ? isBlocked() : false);
  const getScrollTop = () => (scrollTarget ? scrollTarget.scrollTop : 0);

  const begin = (y, target) => {
    if (blocked()) return null;
    const grab = isGrab(target);
    // 内容区没在顶部时让原生滚动先走；把手 / 标题栏不受此限制
    if (!grab && getScrollTop() > 0) return null;
    return {
      startY: y,
      lastY: y,
      lastT: performance.now(),
      lastDelta: 0,
      dy: 0,
      grab,
      mode: grab ? 'drag' : 'pending'
    };
  };

  const activate = (state) => {
    state.mode = 'drag';
    sheet.classList.add('sheet-dragging');
    sheet.style.transition = 'none';
  };

  const move = (state, y) => {
    if (!state) return false;
    const now = performance.now();
    state.dy = y - state.startY;

    if (state.mode === 'pending') {
      if (Math.abs(state.dy) < MIN_DISTANCE) return false;
      // 向上拖或内容不在顶部：交还给原生滚动
      if (state.dy <= 0 || getScrollTop() > 0) {
        state.mode = 'cancel';
        return false;
      }
      activate(state);
    }
    if (state.mode !== 'drag') return false;
    if (getScrollTop() > 0) {
      state.mode = 'cancel';
      return false;
    }

    state.lastDelta = y - state.lastY;
    state.lastT = now;
    state.lastY = y;
    sheet.style.transform = `translateY(${Math.max(0, state.dy)}px)`;
    return true;
  };

  const velocity = (state) => {
    const dt = Math.max(1, performance.now() - state.lastT);
    return state.lastDelta / dt;
  };

  const reset = () => {
    sheet.classList.remove('sheet-dragging');
    sheet.style.transition = '';
    sheet.style.transform = '';
  };

  const finish = (state) => {
    if (!state) return false;
    const active = state.mode === 'drag';
    const dy = Math.max(0, state.dy);
    const v = velocity(state);
    const height = sheet.getBoundingClientRect().height || 0;
    const threshold = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, height * 0.25));
    const shouldClose = active && !blocked()
      && (dy >= threshold || (v > VELOCITY && dy > VELOCITY_DISTANCE));

    if (shouldClose) {
      // 保持当前位移，先撤掉 .show，再把内联位移交还给基础态（100%），
      // 这样是从松手位置继续滑出，而不是先弹回顶部再关闭
      sheet.classList.remove('sheet-dragging');
      sheet.style.transition = '';
      onClose();
      sheet.style.transform = '';
    } else {
      reset();
    }
    if (active) suppressClickUntil = performance.now() + CLICK_GUARD_MS;
    return shouldClose;
  };

  // 鼠标 / 触控笔：pointer 通道
  const onPointerDown = (e) => {
    if (e.pointerType === 'touch') return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    // 上一次 pointerup 丢失时不要卡死后续手势
    if (drag) {
      reset();
      drag = null;
      pointerId = null;
    }
    drag = begin(e.clientY, e.target);
    pointerId = drag ? e.pointerId : null;
  };

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== pointerId) return;
    if (move(drag, e.clientY) && e.cancelable) e.preventDefault();
  };

  const onPointerEnd = (e) => {
    if (!drag || (pointerId !== null && e.pointerId !== pointerId)) return;
    finish(drag);
    drag = null;
    pointerId = null;
  };

  const onPointerCancel = () => {
    if (!drag) return;
    reset();
    drag = null;
    pointerId = null;
  };

  // 触摸：touch 通道（WebView 兜底）
  const onTouchStart = (e) => {
    if (e.touches.length > 1) {
      touchMulti = true;
      touchId = null;
      drag = null;
      reset();
      return;
    }
    if (touchMulti) return;
    // 上一次手势没收到 touchend / touchcancel 时，不要卡死后续手势
    if (touchId !== null) {
      touchId = null;
      drag = null;
    }
    const touch = e.touches[0];
    const state = begin(touch.clientY, e.target);
    if (!state) return;
    touchId = touch.identifier;
    drag = state;
  };

  const onTouchMove = (e) => {
    if (!drag || touchId === null) return;
    const touch = Array.from(e.touches).find((item) => item.identifier === touchId);
    if (!touch) return;
    if (move(drag, touch.clientY) && e.cancelable) e.preventDefault();
  };

  const onTouchEnd = (e) => {
    if (e.touches.length === 0) touchMulti = false;
    if (touchId === null) return;
    const touch = Array.from(e.changedTouches).find((item) => item.identifier === touchId);
    touchId = null;
    const state = drag;
    drag = null;
    if (!state || !touch) return;
    finish(state);
  };

  const onTouchCancel = () => {
    touchId = null;
    touchMulti = false;
    drag = null;
    reset();
  };

  // 拖完松手会补一个 click，别让它误触到「完成」等按钮
  const onClickCapture = (e) => {
    if (performance.now() >= suppressClickUntil) return;
    e.stopPropagation();
    e.preventDefault();
  };

  sheet.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerEnd, { passive: true });
  window.addEventListener('pointercancel', onPointerCancel, { passive: true });
  sheet.addEventListener('touchstart', onTouchStart, { passive: true });
  sheet.addEventListener('touchmove', onTouchMove, { passive: false });
  sheet.addEventListener('touchend', onTouchEnd, { passive: true });
  sheet.addEventListener('touchcancel', onTouchCancel, { passive: true });
  sheet.addEventListener('click', onClickCapture, true);

  return () => {
    reset();
    sheet.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerEnd);
    window.removeEventListener('pointercancel', onPointerCancel);
    sheet.removeEventListener('touchstart', onTouchStart);
    sheet.removeEventListener('touchmove', onTouchMove);
    sheet.removeEventListener('touchend', onTouchEnd);
    sheet.removeEventListener('touchcancel', onTouchCancel);
    sheet.removeEventListener('click', onClickCapture, true);
  };
}
