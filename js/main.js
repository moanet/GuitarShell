import { APP_VERSION } from './services/version.js';
import { showToast } from './services/toast.js';
import { initTheme } from './services/theme.js';
import { dbService } from './services/db.js';
import { showConfirm } from './components/app-dialog.js';
import { closeTopLayer, syncNativeLayerDepth, setLayerScope, isNavigationBlocked } from './services/ui-layer.js';

// 主题只认 html[data-theme]；冷启动时再同步一次浏览器与原生系统栏
initTheme();

const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
const sections = Array.from(document.querySelectorAll('.view-section'));

let currentTab = document.querySelector('.tab-btn.active')?.getAttribute('data-target') || 'view-reader';
let tabSelectedByUser = false;

function setActiveTab(targetId, { announce = true, userInitiated = false } = {}) {
  const btn = tabBtns.find(item => item.getAttribute('data-target') === targetId);
  const section = document.getElementById(targetId);
  if (!btn || !section) return false;
  if (userInitiated && isNavigationBlocked()) {
    showToast('先关闭当前窗口');
    return false;
  }

  if (userInitiated) tabSelectedByUser = true;

  tabBtns.forEach(item => item.classList.remove('active'));
  sections.forEach(item => item.classList.remove('active'));
  btn.classList.add('active');
  section.classList.add('active');
  currentTab = targetId;
  setLayerScope(targetId);

  if (announce) {
    window.dispatchEvent(new CustomEvent('app-tab-changed', { detail: { target: targetId } }));
  }
  return true;
}

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    setActiveTab(btn.getAttribute('data-target'), { userInitiated: true });
  });
});

// 组件里不直接操作 Tab DOM，统一通过事件请求切换
window.addEventListener('app-request-tab', (event) => {
  const target = event.detail?.target;
  if (target) setActiveTab(target, { userInitiated: true });
});

// 自动获取基础路径：本地 / ，GitHub Pages /GuitarShell/
function getBasePath() {
  const path = location.pathname;
  // GitHub Pages 仓库子目录模式
  if (path.startsWith('/GuitarShell/')) {
    return '/GuitarShell/';
  }
  return '/';
}
const base = getBasePath();

async function loadComponents() {
  try { await import(`${base}js/components/metronome.js`); } catch (e) { console.error('节拍器加载失败', e); }
  try { await import(`${base}js/components/sheet-reader.js`); } catch (e) { console.error('读谱器加载失败', e); }
  try { await import(`${base}js/components/practice-log.js`); } catch (e) { console.error('记录组件加载失败', e); }
  // 🌟 新增调音器
  try { await import(`${base}js/components/tuner.js`); } catch (e) { console.error('调音器加载失败', e); }
  // 🌟 全局设置抽屉
  try { await import(`${base}js/components/settings.js`); } catch (e) { console.error('全局设置加载失败', e); }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

async function resolveInitialTab() {
  try {
    const count = await withTimeout(dbService.getScoreCount(), 1200);
    return count > 0 ? 'view-reader' : 'view-metronome';
  } catch (err) {
    console.warn('读取乐谱数量失败，默认进入节拍器', err);
    return 'view-metronome';
  }
}

async function boot() {
  const initialTarget = await resolveInitialTab();
  if (!tabSelectedByUser) setActiveTab(initialTarget, { announce: false });

  // 等组件挂载后再广播首个激活页，避免监听器还没注册
  await loadComponents();
  window.dispatchEvent(new CustomEvent('app-tab-changed', { detail: { target: currentTab } }));
}

boot();


// ==================== ⚙ 全局设置入口 ====================
const settingsBtn = document.getElementById('btnGlobalSettings');
if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    if (isNavigationBlocked()) {
      showToast('先关闭当前窗口');
      return;
    }
    const panel = document.querySelector('guitar-settings');
    if (panel) panel.open();
    else showToast('全局设置正在加载…');
  });
}

// ==================== ☁️ 云同步中退出保护 ====================
// 不提醒“离开前记得同步”；只保护已经在进行的上传，避免用户误关应用把备份写坏。
let cloudTask = { busy: false, text: '' };
let cloudExitPromptOpen = false;
let pendingCloudExit = false;

const syncNativeBackGuard = () => {
  try {
    const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackGuard;
    if (plugin && plugin.setBusy) plugin.setBusy({ busy: cloudTask.busy });
  } catch (err) {
    console.warn('同步返回键保护状态失败:', err);
  }
};

const exitApplication = () => {
  try {
    const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackGuard;
    if (plugin && plugin.exitApp) {
      plugin.exitApp();
      return;
    }
  } catch (err) {
    console.warn('退出应用失败:', err);
  }
  window.close();
};

window.addEventListener('gs-cloud-task', (event) => {
  const detail = event.detail || {};
  cloudTask = { busy: !!detail.busy, text: detail.text || '' };
  syncNativeBackGuard();
  if (pendingCloudExit && !cloudTask.busy) {
    pendingCloudExit = false;
    setTimeout(exitApplication, 0);
  }
});
syncNativeBackGuard();
syncNativeLayerDepth(true);

// Android 返回键/手势：有浮层时由前端关闭最上层，不退出应用
window.addEventListener('gs-back-request', () => {
  const handled = closeTopLayer();
  if (!handled) syncNativeLayerDepth(true);
});

// 网页关闭 / 刷新：交给浏览器原生离开确认，文案由浏览器决定
window.addEventListener('beforeunload', (event) => {
  if (!cloudTask.busy) return;
  event.preventDefault();
  event.returnValue = '云同步仍在进行，退出可能中断上传。';
  return event.returnValue;
});

const promptCloudExit = async () => {
  if (!cloudTask.busy || cloudExitPromptOpen) return;
  cloudExitPromptOpen = true;
  const ok = await showConfirm({
    title: '云同步仍在进行',
    message: '现在退出可能中断上传，云端备份可能不完整。建议等同步完成，或先取消同步。',
    details: [
      { label: '当前任务', value: cloudTask.text || '云同步进行中' }
    ],
    cancelText: '继续同步',
    confirmText: '取消同步并退出',
    danger: true
  });
  cloudExitPromptOpen = false;
  if (!ok) return;
  if (!cloudTask.busy) {
    exitApplication();
    return;
  }

  pendingCloudExit = true;
  window.dispatchEvent(new CustomEvent('gs-cloud-cancel-request'));
  // 通常取消后很快会收到 busy=false；给网络层一点收尾时间，超时也按用户意愿退出
  setTimeout(() => {
    if (!pendingCloudExit) return;
    pendingCloudExit = false;
    exitApplication();
  }, 1200);
};

window.addEventListener('gs-cloud-exit-request', promptCloudExit);

// ==================== 🏷️ 版本徽标 ====================
// 目的：一眼看出「现在跑的是哪版」，并区分「线上已有新版」与「本机缓存没换」
const CACHE_PREFIX = 'guitar-shell-v';
const badge = document.getElementById('appVersion');

// 线上 sw.js 里写的版本号（带时间戳绕开 CDN 缓存，只看内容不看响应头）
const readLiveVersion = async () => {
  const res = await fetch(`${base}sw.js?ts=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const hit = text.match(/APP_VERSION\s*=\s*'([^']+)'/);
  return hit ? hit[1] : '';
};

// 当前浏览器里实际存着的离线缓存版本（可能落后于运行版本）
const readCacheVersion = async () => {
  if (!('caches' in window)) return '';
  const names = await caches.keys();
  const versions = names.filter(n => n.startsWith(CACHE_PREFIX)).map(n => n.slice(CACHE_PREFIX.length));
  return versions.sort().pop() || '';
};

const paintBadge = (liveVersion) => {
  if (liveVersion && liveVersion !== APP_VERSION) {
    badge.textContent = `v${APP_VERSION} → v${liveVersion}`;
    badge.classList.add('has-update');
    badge.title = `线上已是 v${liveVersion}，点我重新加载`;
  } else {
    badge.textContent = `v${APP_VERSION}`;
    badge.classList.remove('has-update');
    badge.title = '点按检查线上版本';
  }
};

if (badge) {
  paintBadge();
  badge.addEventListener('click', async () => {
    if (badge.disabled) return;
    badge.disabled = true;
    const restore = badge.textContent;
    badge.textContent = '检查中…';
    try {
      const live = await readLiveVersion();
      const cached = await readCacheVersion();
      paintBadge(live);

      if (live && live !== APP_VERSION) {
        const go = await showConfirm({
          title: '发现新版本',
          message: `本机运行 v${APP_VERSION}，线上已是 v${live}。重新加载会一起更新离线缓存。`,
          details: [
            { label: '本机', value: `v${APP_VERSION}` },
            { label: '线上', value: `v${live}` }
          ],
          confirmText: '重新加载'
        });
        if (go) {
          const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
          if (reg) await reg.update().catch(() => {});
          location.reload();
          return;
        }
        showToast(`发现新版 v${live}，需重载后生效`);
      } else {
        showToast(cached && cached !== APP_VERSION
          ? `运行 v${APP_VERSION}，离线缓存是 v${cached}，重载一次即可对齐`
          : `v${APP_VERSION} 已是最新`);
      }
    } catch (err) {
      badge.textContent = restore;
      showToast('读不到线上版本（离线或网络不通），先按当前版本用');
    } finally {
      badge.disabled = false;
    }
  });

  // 进页面后静默查一次：线上有新版就把徽标染色，但不打断操作
  window.addEventListener('load', () => {
    setTimeout(() => { readLiveVersion().then(paintBadge).catch(() => {}); }, 1500);
  });
}

// 🌟 注册 PWA 离线缓存 (Service Worker)
// APK / Capacitor 内资源已本地打包，SW 只会多一层缓存风险；壳内跳过，网页端保留
const isNativeShell = () => Boolean(
  window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()
);
if ('serviceWorker' in navigator && !isNativeShell()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`)
      .then(reg => {
        console.log('Guitar Shell 离线引擎已就绪！', reg.scope);
      })
      .catch(err => {
        console.warn('离线引擎注册失败:', err);
      });
  });
}
