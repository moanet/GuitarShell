// ==========================================
// js/services/theme.js
// 双主题：deep（复古木质 · 深夜琴房）/ light（暖纸日光 · 日间模式）
// 只持久化主题名，颜色全部由 css/layout.css 的 token 决定
// ==========================================

export const THEME_KEY = 'gs_theme';
export const THEME_DEEP = 'deep';
export const THEME_LIGHT = 'light';
export const DEFAULT_THEME = THEME_DEEP;

const META_COLORS = {
  [THEME_DEEP]: '#121110',
  [THEME_LIGHT]: '#F3EDE3'
};

const FAVICON_PATHS = {
  [THEME_DEEP]: {
    32: './icon-gShell-32.png',
    192: './icon-gShell-192.png'
  },
  [THEME_LIGHT]: {
    32: './icon-gShell-light-32.png',
    192: './icon-gShell-light-192.png'
  }
};

const isTheme = (value) => value === THEME_DEEP || value === THEME_LIGHT;

export function readStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch (err) {
    return DEFAULT_THEME;
  }
}

export function getTheme() {
  const value = document.documentElement.dataset.theme;
  return isTheme(value) ? value : readStoredTheme();
}

function syncNativeSystemBars(theme) {
  const cap = window.Capacitor;
  if (!cap) return;
  try {
    if (cap.Plugins && cap.Plugins.ThemeBars && typeof cap.Plugins.ThemeBars.setTheme === 'function') {
      Promise.resolve(cap.Plugins.ThemeBars.setTheme({ theme })).catch(() => {});
      return;
    }
    // 当前零构建壳只注入 native-bridge.js：Plugins 命名空间不存在
    if (typeof cap.nativePromise === 'function') {
      Promise.resolve(cap.nativePromise('ThemeBars', 'setTheme', { theme })).catch(() => {});
    }
  } catch (err) {}
}

function paintBrowserChrome(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLORS[theme]);

  document.querySelectorAll('link[data-theme-favicon]').forEach((link) => {
    const href = FAVICON_PATHS[theme] && FAVICON_PATHS[theme][link.dataset.size];
    if (href && link.getAttribute('href') !== href) link.setAttribute('href', href);
  });
}

// 品牌图标：同一张图准备深/浅两份，切主题时只换 src
export function syncThemeImages(root = document) {
  const theme = getTheme();
  root.querySelectorAll('[data-theme-icon]').forEach((img) => {
    const next = theme === THEME_LIGHT ? img.getAttribute('data-light-src') : img.getAttribute('data-dark-src');
    if (next && img.getAttribute('src') !== next) img.setAttribute('src', next);
  });
}

export function applyTheme(theme, options = {}) {
  const next = isTheme(theme) ? theme : DEFAULT_THEME;
  const root = document.documentElement;
  root.dataset.theme = next;
  root.style.colorScheme = next === THEME_LIGHT ? 'light' : 'dark';
  paintBrowserChrome(next);
  syncThemeImages();

  try { localStorage.setItem(THEME_KEY, next); } catch (err) {}

  if (!options.silent) {
    syncNativeSystemBars(next);
    window.dispatchEvent(new CustomEvent('gs-theme-changed', { detail: { theme: next } }));
  }
  return next;
}

export function setTheme(theme) {
  const next = isTheme(theme) ? theme : DEFAULT_THEME;
  if (next === getTheme()) {
    // 主题未变时也同步一次原生系统栏与图标，覆盖冷启动后插件就绪较晚的情况
    syncNativeSystemBars(next);
    paintBrowserChrome(next);
    syncThemeImages();
    return next;
  }
  applyTheme(next);
  return next;
}

export function initTheme() {
  const theme = applyTheme(readStoredTheme(), { silent: true });
  syncNativeSystemBars(theme);
  if (document.readyState !== 'complete') {
    window.addEventListener('load', () => syncNativeSystemBars(getTheme()), { once: true });
  }
  return theme;
}

export function onThemeChange(handler) {
  const listener = (event) => handler(event.detail && event.detail.theme ? event.detail.theme : getTheme());
  window.addEventListener('gs-theme-changed', listener);
  return () => window.removeEventListener('gs-theme-changed', listener);
}

// Canvas / SVG 内联生成时用：从 :root 取当前主题色，取不到就用 fallback
export function themeColor(name, fallback = '') {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
