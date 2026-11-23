// ==========================================
// js/services/ui-layer.js
// 统一浮层层级：弹窗 / 抽屉 / 子页面注册 close，返回键只关最上层
// ==========================================

const layers = [];
let lastSyncedDepth = -1;

function getBackGuard() {
  try {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackGuard;
  } catch (err) {
    return null;
  }
}

function syncNativeDepth(force = false) {
  const depth = layers.length;
  if (!force && depth === lastSyncedDepth) return;
  lastSyncedDepth = depth;
  const plugin = getBackGuard();
  if (!plugin || typeof plugin.setLayerDepth !== 'function') return;
  try {
    plugin.setLayerDepth({ depth });
  } catch (err) {
    console.warn('[层级] 同步原生返回层数失败:', err);
  }
}

export function syncNativeLayerDepth(force = false) {
  syncNativeDepth(force);
}

/**
 * 注册一个浮层。返回取消注册函数。
 * close 必须是该浮层已有的关闭函数；关闭成功后由 close 自己调用取消注册。
 */
export function registerLayer({ id, close } = {}) {
  if (!id || typeof close !== 'function') return () => {};

  const existingIndex = layers.findIndex((item) => item.id === id);
  if (existingIndex >= 0) layers.splice(existingIndex, 1);

  const layer = { id, close };
  layers.push(layer);
  syncNativeDepth();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
    syncNativeDepth();
  };
}

export function getLayerDepth() {
  return layers.length;
}

/**
 * 关闭最上层。返回 true 表示这次返回已被浮层消费，不应退出应用。
 * 如果 close 因为 busy / 脏确认而拒绝关闭，层会保留，返回键被吞掉。
 */
export function closeTopLayer() {
  const top = layers[layers.length - 1];
  if (!top) {
    syncNativeDepth(true);
    return false;
  }
  try {
    top.close();
  } catch (err) {
    console.error('[层级] 关闭最上层失败:', err);
  }
  return true;
}

/**
 * 统一外点关闭：pointerdown 必须在遮罩上，pointerup 仍在遮罩上才关闭。
 * 避免从弹窗内部拖到遮罩再抬手时被误判为外点。
 */
export function bindBackdrop(mask, close) {
  if (!mask || typeof close !== 'function') return () => {};
  let downOnMask = false;

  const onPointerDown = (event) => {
    downOnMask = event.target === mask;
  };
  const onPointerUp = (event) => {
    if (!downOnMask) return;
    downOnMask = false;
    if (event.target === mask) close();
  };
  const onPointerCancel = () => { downOnMask = false; };

  mask.addEventListener('pointerdown', onPointerDown, { passive: true });
  mask.addEventListener('pointerup', onPointerUp, { passive: true });
  mask.addEventListener('pointercancel', onPointerCancel, { passive: true });

  return () => {
    mask.removeEventListener('pointerdown', onPointerDown);
    mask.removeEventListener('pointerup', onPointerUp);
    mask.removeEventListener('pointercancel', onPointerCancel);
  };
}
