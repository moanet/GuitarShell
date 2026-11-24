#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_023.py
# 0.1.13 浏览器回归：存储统计 / 两种缓存清理 / 练习卡片分享
#
# 依赖：
#   pip install websocket-client
#
# 用法（仓库根目录）：
#   python tests/browser/gs_023.py
#   环境变量：GS_WIDTH=360 / GS_CDP_PORT=9395
# ==========================================
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

try:
    from websocket import create_connection
except ImportError:
    print("缺少依赖：pip install websocket-client", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[2]
BASE = os.environ.get("GS_BASE_URL", "http://127.0.0.1:8123/").rstrip("/") + "/"
PORT = int(os.environ.get("GS_CDP_PORT", "9395"))
WIDTH = int(os.environ.get("GS_WIDTH", "360"))

BROWSERS = [
    os.environ.get("GS_BROWSER", ""),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def pick_browser():
    for path in BROWSERS:
        if path and Path(path).exists():
            return path
    raise RuntimeError("找不到 Edge / Chrome，请用 GS_BROWSER 指定浏览器路径")


def reachable(url, timeout=1):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status < 500
    except Exception:
        return False


def start_server():
    if reachable(BASE):
        return None
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8123", "--bind", "127.0.0.1"],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(40):
        if reachable(BASE):
            return proc
        time.sleep(0.25)
    proc.terminate()
    raise RuntimeError(f"本地静态服务启动失败：{BASE}")


class CDP:
    def __init__(self, url):
        self.ws = create_connection(url, timeout=240)
        self.n = 0

    def cmd(self, method, params=None):
        self.n += 1
        msg_id = self.n
        self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == msg_id:
                return msg

    def ev(self, expression):
        res = self.cmd("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
        })["result"]
        if res.get("exceptionDetails"):
            raise RuntimeError(json.dumps(res["exceptionDetails"], ensure_ascii=False))
        return res.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


TEST_JS = r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));  const waitFor = async (fn, timeout = 12000, step = 150) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = await fn();
      if (value) return value;
      await sleep(step);
    }
    return null;
  };
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  try {

  const reader = document.querySelector('guitar-sheet-reader');
  const settings = document.querySelector('guitar-settings');
  const db = await import('/js/services/db.js');
  const stats = await import('/js/services/storage-stats.js');
  const bgLib = await import('/js/services/share-card.js');

  const cardHash = (c) => {
    const data = c.getContext('2d').getImageData(0, 0, 1080, 1440).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 337) hash = (hash * 31 + data[i]) % 2147483647;
    return hash;
  };
  const hexLum = (hex) => {
    const raw = String(hex).replace('#', '');
    const rgb = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const contrast = (a, b) => {
    const x = hexLum(a), y = hexLum(b);
    const hi = Math.max(x, y), lo = Math.min(x, y);
    return (hi + 0.05) / (lo + 0.05);
  };

  // 记录清理 / 分享过程中的可疑外网请求
  let netCalls = 0;
  const origFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    const url = String(args[0] && args[0].url ? args[0].url : args[0]);
    if (/dav|webdav|nutstore|jianguoyun/i.test(url)) netCalls += 1;
    return origFetch(...args);
  };

  await db.dbService.clearAllData();

  // 1x1 PNG：真实可解码，封面重建能跑通
  const pngBlob = await (await origFetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).blob();

  const scoreA = await db.dbService.addScore('封面测试.png', pngBlob, { format: 'image' });
  const coverA = await db.dbService.addAsset({
    scoreId: scoreA, kind: 'cover', blob: pngBlob, mime: 'image/png',
    width: 1, height: 1, bytes: pngBlob.size
  });
  await db.dbService.updateScore(scoreA, { coverAssetId: coverA }, { touch: false });

  const scoreB = await db.dbService.addScore('孤儿测试.png', pngBlob, { format: 'image' });
  await db.dbService.addAsset({
    scoreId: scoreB, kind: 'cover', blob: pngBlob, mime: 'image/png',
    width: 1, height: 1, bytes: pngBlob.size
  });

  const before = await stats.collectStorageStats();
  const expectScoreText = stats.formatBytes(pngBlob.size * 2);
  const expectCoverText = stats.formatBytes(pngBlob.size * 2);
  check('scoreBytes 与乐谱文件大小一致', before.scoreBytes === pngBlob.size * 2, `${before.scoreBytes}`);
  check('coverBytes 与 assets 汇总一致', before.coverBytes === pngBlob.size * 2, `${before.coverBytes}`);

  // 设置页存储卡
  settings.open();
  await waitFor(() => settings.shadowRoot.getElementById('totalUsage').textContent !== '—');
  await sleep(320);
  const totalText = settings.shadowRoot.getElementById('totalUsage').textContent;
  const scoreText = settings.shadowRoot.getElementById('scoreUsage').textContent;
  const coverText = settings.shadowRoot.getElementById('coverUsage').textContent;
  const quotaHint = settings.shadowRoot.getElementById('quotaHint').textContent;
  check('存储卡总占用有值', /约|\d/.test(totalText) && totalText !== '—', totalText);
  check('曲谱文件文案正确', scoreText === expectScoreText, `${scoreText} vs ${expectScoreText}`);
  check('封面缓存文案正确', coverText === expectCoverText, `${coverText} vs ${expectCoverText}`);
  check('配额提示可见', quotaHint.length > 0 && !quotaHint.includes('正在统计'), quotaHint);

  // 清理封面缓存
  settings.shadowRoot.getElementById('btnCleanCover').click();
  const dlg1 = await waitFor(() => document.querySelector('guitar-app-dialog'));
  check('清理封面弹出确认', !!dlg1, '');
  dlg1?.shadowRoot?.getElementById('dlgConfirm')?.click();
  await waitFor(async () => {
    const assets = await db.dbService.getAllAssets();
    return assets.filter(a => a.kind === 'cover').length === 0;
  });
  await sleep(320);
  const afterCoverClean = await stats.collectStorageStats();
  const scoresAfter = await db.dbService.getAllScores();
  check('封面资产已清空', afterCoverClean.coverCount === 0, `coverCount=${afterCoverClean.coverCount}`);
  check('乐谱指针已置空', scoresAfter.every(s => s.coverAssetId === null || s.coverAssetId === undefined), scoresAfter.map(s => s.coverAssetId).join(','));
  check('乐谱未被删除', scoresAfter.length === 2, `scores=${scoresAfter.length}`);
  check('清理后数字刷新为 0 B', settings.shadowRoot.getElementById('coverUsage').textContent === '0 B', settings.shadowRoot.getElementById('coverUsage').textContent);
  settings.shadowRoot.getElementById('btnClose').click();
  await sleep(300);

  // 重新进书架，封面应按需重建
  reader.loadShelf();
  const rebuilt = await waitFor(async () => {
    const assets = await db.dbService.getAllAssets();
    return assets.filter(a => a.kind === 'cover').length >= 1;
  });
  check('清理后封面可重建', !!rebuilt, rebuilt ? 'cover 重建成功' : '未重建');

  // 再造一条孤儿：模拟已删乐谱留下的历史缓存
  await db.dbService.addAsset({
    scoreId: 999999, kind: 'cover', blob: pngBlob, mime: 'image/png',
    width: 1, height: 1, bytes: pngBlob.size
  });

  // 清理未引用缓存
  const orphans = await stats.findOrphanAssets();
  check('存在未引用缓存', orphans.length >= 1, `orphans=${orphans.length}`);
  settings.open();
  await waitFor(() => settings.shadowRoot.getElementById('totalUsage').textContent !== '—');
  settings.shadowRoot.getElementById('btnCleanOrphan').click();
  const dlg2 = await waitFor(() => document.querySelector('guitar-app-dialog'));
  check('清理未引用弹出确认', !!dlg2, '');
  dlg2?.shadowRoot?.getElementById('dlgConfirm')?.click();
  await waitFor(async () => (await stats.findOrphanAssets()).length === 0);
  await sleep(260);
  const assetsAfterOrphan = await db.dbService.getAllAssets();
  const scoresNow = await db.dbService.getAllScores();
  const referenced = assetsAfterOrphan.filter(a => scoresNow.some(s => s.id === a.scoreId && s.coverAssetId === a.id));
  check('孤儿缓存已清理', assetsAfterOrphan.length === 0 || (await stats.findOrphanAssets()).length === 0, `assets=${assetsAfterOrphan.length}`);
  check('被引用封面保留', referenced.length >= 1, `referenced=${referenced.length}`);
  settings.shadowRoot.getElementById('btnClose').click();
  await sleep(300);

  // 练习卡片
  await db.dbService.addLog({ name: '小星星练习', minutes: 25, bpm: 96 });
  await db.dbService.addLog({ name: '晨练和弦', minutes: 10, bpm: 120 });
  window.dispatchEvent(new CustomEvent('log-updated'));
  document.querySelector('.tab-btn[data-target="view-log"]').click();
  await sleep(500);

  const practice = document.querySelector('guitar-practice-log');
  const shareBtn = practice && practice.shadowRoot.getElementById('btnShare');
  check('记录页有分享入口', !!shareBtn, '');
  if (!shareBtn) throw new Error('记录页分享入口未渲染');
  shareBtn.click();

  const preview = await waitFor(() => {
    const el = document.querySelector('guitar-share-preview');
    return el && el.shadowRoot && el.shadowRoot.getElementById('cardCanvas').dataset.rendered === '1' ? el : null;
  });
  check('预览浮层打开', !!preview, '');
  if (!preview) throw new Error('练习卡片预览未打开');
  const canvas = preview.shadowRoot.getElementById('cardCanvas');
  check('卡片尺寸 1080×1440', canvas.width === 1080 && canvas.height === 1440, `${canvas.width}×${canvas.height}`);
  check('默认背景为深胡桃木', canvas.dataset.background === 'walnut', canvas.dataset.background);
  const swatches = preview.shadowRoot.getElementById('swatches');
  check('背景色板共 6 个', swatches && swatches.querySelectorAll('.swatch').length === 6, swatches ? `${swatches.querySelectorAll('.swatch').length}` : 'missing');
  check('背景预设共 6 套', bgLib.SHARE_BACKGROUNDS.length === 6, `${bgLib.SHARE_BACKGROUNDS.length}`);
  check('背景预设 id 无重复', new Set(bgLib.SHARE_BACKGROUNDS.map(b => b.id)).size === 6, '');
  check('浅色预设为 2 套', bgLib.SHARE_BACKGROUNDS.filter(b => b.light).length === 2, '');
  const walnutSwatch = swatches.querySelector('[data-bg="walnut"]');
  check('默认选中深胡桃木', walnutSwatch.classList.contains('selected'), '');
  const swatchRect = walnutSwatch.getBoundingClientRect();
  check('色板直径 28px', Math.round(swatchRect.width) === 28 && Math.round(swatchRect.height) === 28, `${swatchRect.width}×${swatchRect.height}`);

  const bgHashes = {};
  for (const bg of bgLib.SHARE_BACKGROUNDS) {
    swatches.querySelector(`[data-bg="${bg.id}"]`).click();
    await waitFor(() => canvas.dataset.background === bg.id, 8000);
    await sleep(120);
    bgHashes[bg.id] = cardHash(canvas);
  }
  check('6 套背景都能渲染', Object.keys(bgHashes).length === 6, Object.keys(bgHashes).join(','));
  check('6 套背景画面互不相同', new Set(Object.values(bgHashes)).size === 6, Object.values(bgHashes).join(','));

  swatches.querySelector('[data-bg="felt"]').click();
  await waitFor(() => canvas.dataset.background === 'felt', 8000);
  await sleep(120);
  check('切换背景写入 gs_share_bg', localStorage.getItem('gs_share_bg') === 'felt', localStorage.getItem('gs_share_bg'));
  check('6 套背景主文字对比度达标', bgLib.SHARE_BACKGROUNDS.every(b =>
    contrast(b.palette.strong, b.top) >= 7 && contrast(b.palette.strong, b.bottom) >= 7), '');
  check('6 套背景弱化文字对比度达标', bgLib.SHARE_BACKGROUNDS.every(b =>
    contrast(b.palette.muted, b.top) >= 4 && contrast(b.palette.muted, b.bottom) >= 4), '');
  check('6 套背景强调色对比度达标', bgLib.SHARE_BACKGROUNDS.every(b =>
    contrast(b.palette.accent, b.top) >= 3.5 && contrast(b.palette.accent, b.bottom) >= 3.5), '');

  check('卡片有格言', Boolean(canvas.dataset.quoteId), `${canvas.dataset.quoteId}/${canvas.dataset.quoteLang}`);
  check('默认不显示曲名', canvas.dataset.showName === '0' && !preview.shadowRoot.getElementById('chkName').checked, '');
  check('今日分钟正确', canvas.dataset.minutes === '35', canvas.dataset.minutes);
  check('网页端走下载通道', preview.dataset.shareChannel === 'web', preview.dataset.shareChannel);

  const quotes = await import('/js/services/quotes.js');
  const ids = new Set(quotes.QUOTES.map(q => q.id));
  check('格言库共 60 条', quotes.QUOTES.length === 60, `count=${quotes.QUOTES.length}`);
  check('60 条格言 id 无重复', ids.size === 60, `unique=${ids.size}`);
  check('60 条格言全部可抽取', quotes.QUOTES.every(q => q.text && q.lang), '');
  const dayA = quotes.pickQuote(new Date(2026, 10, 24, 9, 0, 0));
  const dayB = quotes.pickQuote(new Date(2026, 10, 24, 21, 0, 0));
  check('同日格言稳定', dayA && dayB && dayA.id === dayB.id, `${dayA && dayA.id} / ${dayB && dayB.id}`);

  const probe = document.createElement('canvas').getContext('2d');
  const quoteFont = '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif';
  const stripStop = (text) => String(text).replace(/[。.]+$/u, '').trimEnd();
  const quoteFits = quotes.QUOTES.every(q => {
    const text = stripStop(q.text);
    let size = 26;
    probe.font = `${q.lang === 'en' ? 'italic ' : ''}${size}px ${quoteFont}`;
    while (size > 22 && probe.measureText(text).width > 888) {
      size -= 1;
      probe.font = `${q.lang === 'en' ? 'italic ' : ''}${size}px ${quoteFont}`;
    }
    return probe.measureText(text).width <= 888;
  });
  check('60 条格言在 22px 下可单行放下', quoteFits, '');
  check('页脚格言不带句号', canvas.dataset.quoteText && !/[。.]$/.test(canvas.dataset.quoteText), canvas.dataset.quoteText);

  const regionHash = (c, y, h) => {
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(96, y, 888, h).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 61) hash = (hash * 31 + data[i]) % 2147483647;
    return hash;
  };
  const nameHashBefore = regionHash(canvas, 980, 200);
  const footerHashBefore = regionHash(canvas, 1240, 200);
  const quoteBefore = canvas.dataset.quoteId;

  const emptyCard = document.createElement('canvas');
  await bgLib.drawShareCard(emptyCard, preview.summary, { quote: null, background: 'felt' });
  check('页脚格言已绘制', regionHash(emptyCard, 1240, 200) !== footerHashBefore, '');

  const chk = preview.shadowRoot.getElementById('chkName');
  chk.checked = true;
  chk.onchange();
  await waitFor(() => canvas.dataset.showName === '1');
  await sleep(220);
  const nameHashAfter = regionHash(canvas, 980, 200);
  const footerHashAfter = regionHash(canvas, 1240, 200);
  check('打开开关后显示曲名', canvas.dataset.showName === '1' && nameHashBefore !== nameHashAfter, `${nameHashBefore} → ${nameHashAfter}`);
  check('格言 id 不随曲名开关变化', canvas.dataset.quoteId === quoteBefore, `${quoteBefore} → ${canvas.dataset.quoteId}`);
  check('页脚格言不随曲名开关变化', footerHashBefore === footerHashAfter, `${footerHashBefore} / ${footerHashAfter}`);

  const saveBtn = preview.shadowRoot.getElementById('btnSave');
  const shareBtn2 = preview.shadowRoot.getElementById('btnShare');
  check('底栏没有取消按钮', !preview.shadowRoot.getElementById('btnCancel'), '');
  check('网页保存按钮文案', saveBtn && saveBtn.textContent === '保存图片', saveBtn ? saveBtn.textContent : 'missing');
  check('网页分享按钮按能力显隐', shareBtn2.hidden === !preview.canWebShare, `hidden=${shareBtn2.hidden}/can=${preview.canWebShare}`);
  check('保存与分享按钮 2:1', getComputedStyle(saveBtn).flexGrow === '2' && getComputedStyle(shareBtn2).flexGrow === '1', `${getComputedStyle(saveBtn).flexGrow}:${getComputedStyle(shareBtn2).flexGrow}`);

  let downloads = 0;
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { downloads += 1; };
  saveBtn.click();
  await waitFor(() => downloads > 0);
  await sleep(260);
  HTMLAnchorElement.prototype.click = origClick;
  check('保存图片触发下载', downloads > 0, `downloads=${downloads}`);
  check('保存后预览不关闭', Boolean(document.querySelector('guitar-share-preview')), '');
  check('网页保存反馈正确', document.querySelector('.app-toast') && document.querySelector('.app-toast').textContent === '图片已下载', document.querySelector('.app-toast') ? document.querySelector('.app-toast').textContent : 'missing');
  check('网页保存按钮恢复可点', saveBtn.textContent === '保存图片' && !saveBtn.disabled, `${saveBtn.textContent}/${saveBtn.disabled}`);
  preview.shadowRoot.getElementById('btnClose').click();
  await sleep(220);
  check('关闭按钮可关闭', !document.querySelector('guitar-share-preview'), '');

  practice.shadowRoot.getElementById('btnShare').click();
  const reopened = await waitFor(() => {
    const el = document.querySelector('guitar-share-preview');
    const c = el && el.shadowRoot && el.shadowRoot.getElementById('cardCanvas');
    return c && c.dataset.rendered === '1' ? el : null;
  });
  check('重新打开沿用上次背景', Boolean(reopened) && reopened.shadowRoot.getElementById('cardCanvas').dataset.background === 'felt', reopened ? reopened.shadowRoot.getElementById('cardCanvas').dataset.background : 'missing');
  reopened?.shadowRoot.getElementById('btnClose').click();
  await sleep(220);

  const originalCapacitor = window.Capacitor;
  let savedGalleryOpts = null;
  let releaseGallery = null;
  let shareCalls = 0;
  let releaseShare = null;
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      ShareCard: {
        saveToGallery: (opts) => {
          savedGalleryOpts = opts;
          return new Promise((resolve) => {
            releaseGallery = () => resolve({ channel: 'gallery', path: 'Pictures/GuitarShell/test.png' });
          });
        },
        share: (opts) => {
          shareCalls += 1;
          return new Promise((resolve) => {
            releaseShare = () => resolve({ channel: 'native' });
          });
        }
      }
    }
  };
  practice.shadowRoot.getElementById('btnShare').click();
  const nativePreview = await waitFor(() => {
    const el = document.querySelector('guitar-share-preview');
    const c = el && el.shadowRoot && el.shadowRoot.getElementById('cardCanvas');
    return c && c.dataset.rendered === '1' ? el : null;
  });
  check('原生预览识别为原生', Boolean(nativePreview) && nativePreview.native === true && nativePreview.dataset.shareChannel === 'native', nativePreview ? nativePreview.dataset.shareChannel : 'missing');
  const nativeSaveBtn = nativePreview && nativePreview.shadowRoot.getElementById('btnSave');
  const nativeShareBtn = nativePreview && nativePreview.shadowRoot.getElementById('btnShare');
  check('原生主按钮文案', Boolean(nativeSaveBtn) && nativeSaveBtn.textContent === '保存到相册', nativeSaveBtn ? nativeSaveBtn.textContent : 'missing');
  check('原生分享按钮可见', Boolean(nativeShareBtn) && !nativeShareBtn.hidden && nativeShareBtn.textContent === '分享', nativeShareBtn ? `${nativeShareBtn.hidden}/${nativeShareBtn.textContent}` : 'missing');
  check('原生按钮仍为 2:1', Boolean(nativeSaveBtn) && getComputedStyle(nativeSaveBtn).flexGrow === '2' && getComputedStyle(nativeShareBtn).flexGrow === '1', '');

  nativeSaveBtn.click();
  await waitFor(() => typeof releaseGallery === 'function', 8000);
  check('保存中按钮文案与互斥', nativeSaveBtn.textContent === '正在保存…' && nativeSaveBtn.disabled && nativeShareBtn.disabled && nativePreview.shadowRoot.getElementById('chkName').disabled, `${nativeSaveBtn.textContent}/${nativeSaveBtn.disabled}/${nativeShareBtn.disabled}`);
  releaseGallery();
  await waitFor(() => !nativeSaveBtn.disabled, 8000);
  await sleep(120);
  check('原生保存写入相册分支', Boolean(savedGalleryOpts && savedGalleryOpts.dataUrl.startsWith('data:image/png;base64,') && savedGalleryOpts.fileName.endsWith('.png')), savedGalleryOpts ? savedGalleryOpts.fileName : 'missing');
  check('原生保存后预览不关闭', Boolean(document.querySelector('guitar-share-preview')), '');
  check('原生保存反馈正确', document.querySelector('.app-toast') && document.querySelector('.app-toast').textContent === '已保存到相册', document.querySelector('.app-toast') ? document.querySelector('.app-toast').textContent : 'missing');
  check('原生保存按钮复原', nativeSaveBtn.textContent === '保存到相册' && !nativeSaveBtn.disabled, `${nativeSaveBtn.textContent}/${nativeSaveBtn.disabled}`);

  window.Capacitor.Plugins.ShareCard.saveToGallery = async () => { throw new Error('没有写入权限'); };
  nativeSaveBtn.click();
  await waitFor(() => {
    const t = document.querySelector('.app-toast');
    return Boolean(t && t.textContent.includes('保存失败') && !nativeSaveBtn.disabled);
  }, 8000);
  check('保存失败有明确提示', document.querySelector('.app-toast').textContent.includes('保存失败：没有写入权限'), document.querySelector('.app-toast').textContent);
  check('保存失败后预览仍在且可重试', Boolean(document.querySelector('guitar-share-preview')) && nativeSaveBtn.textContent === '保存到相册' && !nativeSaveBtn.disabled, `${nativeSaveBtn.textContent}/${nativeSaveBtn.disabled}`);

  nativeShareBtn.click();
  await waitFor(() => typeof releaseShare === 'function', 8000);
  check('分享中按钮文案与互斥', nativeShareBtn.textContent === '正在打开…' && nativeShareBtn.disabled && nativeSaveBtn.disabled, `${nativeShareBtn.textContent}/${nativeShareBtn.disabled}`);
  releaseShare();
  await waitFor(() => !nativeShareBtn.disabled, 8000);
  await sleep(120);
  check('原生分享调用系统面板', shareCalls === 1, `shareCalls=${shareCalls}`);
  check('原生分享后预览不关闭', Boolean(document.querySelector('guitar-share-preview')), '');
  check('原生分享反馈正确', document.querySelector('.app-toast') && document.querySelector('.app-toast').textContent === '已打开系统分享', document.querySelector('.app-toast') ? document.querySelector('.app-toast').textContent : 'missing');
  nativePreview.shadowRoot.getElementById('btnClose').click();
  await sleep(220);

  savedGalleryOpts = null;
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      ShareCard: {
        saveToGallery: async (opts) => {
          savedGalleryOpts = opts;
          return { channel: 'gallery', path: 'Pictures/GuitarShell/test.png' };
        },
        share: async () => ({ channel: 'native' })
      }
    }
  };
  const galleryResult = await bgLib.saveShareCard(pngBlob, 'test.png');
  check('saveShareCard 走原生相册', galleryResult.channel === 'native-gallery', galleryResult.channel);
  check('saveToGallery 收到 PNG dataUrl', Boolean(savedGalleryOpts && savedGalleryOpts.dataUrl.startsWith('data:image/png;base64,')) && savedGalleryOpts.fileName === 'test.png', savedGalleryOpts ? savedGalleryOpts.fileName : 'missing');
  const nativeShareResult = await bgLib.shareShareCard(pngBlob, 'test.png');
  check('shareShareCard 走原生分享', nativeShareResult.channel === 'native', nativeShareResult.channel);
  window.Capacitor = originalCapacitor;

  check('全程无 WebDAV 请求', netCalls === 0, `netCalls=${netCalls}`);

  return {
    checks,
    failed: checks.filter(c => !c.pass).length,
    width: innerWidth
  };
  } catch (err) {
    checks.push({ name: '脚本异常', pass: false, detail: err.message });
    return {
      checks,
      failed: checks.filter(c => !c.pass).length,
      width: innerWidth,
      error: err.message
    };
  }
})()
"""


def main():
    server = start_server()
    browser = pick_browser()
    profile = tempfile.mkdtemp(prefix="gs-browser-023-")
    proc = subprocess.Popen(
        [browser, "--headless=new", "--disable-gpu", "--no-first-run",
         "--no-default-browser-check", f"--remote-debugging-port={PORT}",
         f"--user-data-dir={profile}", BASE],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    cdp = None
    try:
        target = None
        for _ in range(120):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=1) as r:
                    pages = json.loads(r.read().decode())
                target = next((p for p in pages if p.get("type") == "page" and p.get("url", "").startswith(BASE)), None)
                if target:
                    break
            except Exception:
                pass
            time.sleep(0.25)
        if not target:
            raise RuntimeError("浏览器 CDP 页面未就绪")

        cdp = CDP(target["webSocketDebuggerUrl"])
        cdp.cmd("Runtime.enable")
        cdp.cmd("Emulation.setDeviceMetricsOverride", {
            "width": WIDTH, "height": 800, "deviceScaleFactor": 1, "mobile": True,
        })
        for _ in range(100):
            if cdp.ev("!!document.querySelector('guitar-settings')?.shadowRoot?.getElementById('totalUsage')"):
                break
            time.sleep(0.25)

        result = cdp.ev(TEST_JS)
        if not isinstance(result, dict):
            raise RuntimeError(f"回归脚本返回异常：{result!r}")

        for item in result["checks"]:
            mark = "PASS" if item["pass"] else "FAIL"
            print(f"[{mark}] {item['name']}" + (f" — {item['detail']}" if item["detail"] else ""))
        if result.get("error"):
            print(f"脚本异常：{result['error']}")
        print(f"\n宽度 {result['width']}：通过 {len(result['checks']) - result['failed']}/{len(result['checks'])}")
        sys.exit(0 if result["failed"] == 0 else 1)
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            pass
        if server:
            server.terminate()


if __name__ == "__main__":
    main()
