// ==========================================
// js/services/ui-layer.js
// 统一浮层层级：弹窗 / 抽屉 / 子页面注册 close，返回键只关最上层
// ==========================================

const layers = [];
let lastSyncedDepth = -1;
let activeScope = '';

function getBackGuard() {
  try {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackGuard;
  } catch (err) {
    return null;
  }
}

const inScope = (layer, scope) => !layer.scope || layer.scope === scope;

function depthForScope(scope = activeScope) {
  return layers.reduce((count, layer) => count + (inScope(layer, scope) ? 1 : 0), 0);
}

function syncNativeDepth(force = false) {
  const depth = depthForScope();
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
 * 切换当前页面作用域。返回键与原生层数只统计当前 tab 的浮层，
 * 避免在节拍器页按返回时误关后台的阅读页。
 */
export function setLayerScope(scope) {
  activeScope = scope || '';
  syncNativeDepth(true);
}

/**
 * 注册一个浮层。返回取消注册函数。
 * close 必须是该浮层已有的关闭函数；关闭成功后由 close 自己调用取消注册。
 * blocksNavigation=false 用于阅读页这类“页面状态”，它不应锁住四页导航。
 */
export function registerLayer({ id, close, scope = null, blocksNavigation = true } = {}) {
  if (!id || typeof close !== 'function') return () => {};

  const existingIndex = layers.findIndex((item) => item.id === id);
  if (existingIndex >= 0) layers.splice(existingIndex, 1);

  const layer = { id, close, scope: scope || activeScope, blocksNavigation: blocksNavigation !== false };
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

export function getLayerDepth(scope = activeScope) {
  return depthForScope(scope);
}

/**
 * 当前 tab 是否有模态浮层。四页导航和右上角设置入口应被它锁住。
 */
export function isNavigationBlocked(scope = activeScope) {
  return layers.some((layer) => inScope(layer, scope) && layer.blocksNavigation !== false);
}

/**
 * 关闭最上层。返回 true 表示这次返回已被浮层消费，不应退出应用。
 * 如果 close 因为 busy / 脏确认而拒绝关闭，层会保留，返回键被吞掉。
 */
export function closeTopLayer(scope = activeScope) {
  const top = layers.slice().reverse().find((layer) => inScope(layer, scope));
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
 * 统一外点关闭：pointerdown 和 pointerup 都必须在遮罩上，最后在 click 阶段关闭。
 * 不能直接在 pointerup 里移除遮罩：浏览器随后补发的 click 会落到下层按钮，
 * 造成“点遮罩却进入搜索 / 管理 / 切页”的点击穿透。
 */
export function bindBackdrop(mask, close) {
  if (!mask || typeof close !== 'function') return () => {};
  let downOnMask = false;
  let upOnMask = false;

  const onPointerDown = (event) => {
    downOnMask = event.target === mask;
    upOnMask = false;
  };
  const onPointerUp = (event) => {
    upOnMask = downOnMask && event.target === mask;
  };
  const onClick = (event) => {
    const shouldClose = downOnMask && upOnMask && event.target === mask;
    downOnMask = false;
    upOnMask = false;
    if (shouldClose) close();
  };
  const onPointerCancel = () => {
    downOnMask = false;
    upOnMask = false;
  };

  mask.addEventListener('pointerdown', onPointerDown, { passive: true });
  mask.addEventListener('pointerup', onPointerUp, { passive: true });
  mask.addEventListener('click', onClick, { passive: true });
  mask.addEventListener('pointercancel', onPointerCancel, { passive: true });

  return () => {
    mask.removeEventListener('pointerdown', onPointerDown);
    mask.removeEventListener('pointerup', onPointerUp);
    mask.removeEventListener('click', onClick);
    mask.removeEventListener('pointercancel', onPointerCancel);
  };
}
