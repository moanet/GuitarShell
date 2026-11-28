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
  const bgStore = await import('/js/services/share-bg.js');
  const bgLib = await import('/js/services/share-card.js');

  const cardHash = (c) => {
    const data = c.getContext('2d').getImageData(0, 0, 1080, 1920).data;
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

  // 设置页：0.1.14c 瘦身布局
  settings.open();
  await waitFor(() => settings.shadowRoot.getElementById('totalUsage').textContent !== '—');
  await sleep(320);
  const sRoot = settings.shadowRoot;
  await waitFor(() => {
    const t = sRoot.getElementById('cloudStatusText')?.textContent.trim() || '';
    return t && !t.includes('正在读取');
  }, 8000);
  const cloudText = sRoot.getElementById('cloudStatusText').textContent.trim();
  check('云同步状态文案保持单行短句', ['尚未同步', '待同步', '已同步', '状态读取失败'].includes(cloudText), cloudText);
  check('未同步细节说明首次同步', sRoot.getElementById('cloudDetail').textContent.trim() === '还没建立第一次同步', sRoot.getElementById('cloudDetail').textContent.trim());
  check('未同步状态点为灰点', sRoot.getElementById('cloudDot').className === 'cloud-dot never', sRoot.getElementById('cloudDot').className);
  const cloudHead = sRoot.getElementById('btnToggleCloud');
  const cloudHeadRect = cloudHead.getBoundingClientRect();
  check('云同步变为 40 高整行折叠按钮', Math.abs(cloudHeadRect.height - 40) < 1 && cloudHead.getAttribute('aria-expanded') === 'false', `${cloudHeadRect.height}/${cloudHead.getAttribute('aria-expanded')}`);
  check('云同步展开体默认收起且无旧管理入口', sRoot.getElementById('cloudBody').hidden && !sRoot.getElementById('btnCloudEntry'), `${sRoot.getElementById('cloudBody').hidden}`);
  cloudHead.click();
  await sleep(260);
  check('云同步折叠行可展开表单', !sRoot.getElementById('cloudBody').hidden
    && ['cloudAccount', 'cloudSecret', 'cloudPath', 'cloudBase'].every((id) => !!sRoot.getElementById(id)),
    `${sRoot.getElementById('cloudBody').hidden}/fields`);
  localStorage.setItem('gs_cloud_sync:GuitarShell/backup.json', JSON.stringify({ at: 1 }));
  await settings.cloud.refreshStatus();
  const pendingText = sRoot.getElementById('cloudStatusText').textContent.trim();
  check('本机有改动时显示待同步', pendingText === '待同步', pendingText);
  check('待同步细节与状态一致', sRoot.getElementById('cloudDetail').textContent.includes('本机有未同步改动') && sRoot.getElementById('cloudDetail').textContent.startsWith('上次同步'), sRoot.getElementById('cloudDetail').textContent.trim());
  check('待同步状态点为强调色', sRoot.getElementById('cloudDot').className === 'cloud-dot pending', sRoot.getElementById('cloudDot').className);
  localStorage.setItem('gs_cloud_sync:GuitarShell/backup.json', JSON.stringify({ at: Date.now() + 3600000 }));
  await settings.cloud.refreshStatus();
  check('云端较新时显示已同步', sRoot.getElementById('cloudStatusText').textContent.trim() === '已同步', sRoot.getElementById('cloudStatusText').textContent.trim());
  check('已同步细节说明本机最新', sRoot.getElementById('cloudDetail').textContent.includes('本机已是最新'), sRoot.getElementById('cloudDetail').textContent.trim());
  check('已同步状态点为成功色', sRoot.getElementById('cloudDot').className === 'cloud-dot success', sRoot.getElementById('cloudDot').className);
  const dbmod = await import('/js/services/db.js');
  const originalStamp = dbmod.dbService.getLocalChangeStamp;
  dbmod.dbService.getLocalChangeStamp = async () => { throw new Error('test'); };
  localStorage.setItem('gs_cloud_sync:GuitarShell/backup.json', JSON.stringify({ at: 1 }));
  await settings.cloud.refreshStatus();
  check('读取失败时保留手动同步入口', sRoot.getElementById('cloudStatusText').textContent.trim() === '状态读取失败'
    && sRoot.getElementById('cloudDetail').textContent.trim() === '状态读取失败，仍可手动上传 / 下载'
    && sRoot.getElementById('cloudDot').className === 'cloud-dot unknown', `${sRoot.getElementById('cloudStatusText').textContent.trim()} / ${sRoot.getElementById('cloudDot').className}`);
  dbmod.dbService.getLocalChangeStamp = originalStamp;
  localStorage.removeItem('gs_cloud_sync:GuitarShell/backup.json');
  await settings.cloud.refreshStatus();
  check('清除同步点后回到未同步', sRoot.getElementById('cloudStatusText').textContent.trim() === '尚未同步' && sRoot.getElementById('cloudDetail').textContent.trim() === '还没建立第一次同步', `${sRoot.getElementById('cloudStatusText').textContent.trim()} / ${sRoot.getElementById('cloudDetail').textContent.trim()}`);
  settings.closeAllFolds();
  await sleep(220);
  const drawer = sRoot.getElementById('drawer');
  const drawerWidth = drawer.getBoundingClientRect().width;
  const expectDrawerWidth = Math.min(innerWidth * 0.8, 360);
  check('设置抽屉宽度为 80vw 且不超过 360', Math.abs(drawerWidth - expectDrawerWidth) < 2.5, `${drawerWidth} vs ${expectDrawerWidth}`);
  const sectionTitles = Array.from(sRoot.querySelectorAll('.body .card h3')).map((el) => el.textContent.trim());
  check('设置分区顺序正确', sectionTitles.join(' / ') === '外观 / 数据与备份 / 云同步 / 存储与缓存 / 关于', sectionTitles.join(' / '));
  const aboutText = sRoot.querySelector('.about').textContent.replace(/\s+/g, ' ').trim();
  const privacy = sRoot.querySelector('.about-privacy');
  check('关于品牌副标题已移除', !sRoot.querySelector('.about-copy small'), '');
  const privacyText = privacy ? Array.from(privacy.querySelectorAll('span')).map((el) => el.textContent.trim()).join(' ') : '';
  check('关于改为三项本地属性', privacy && privacyText === '无账号 本地优先 默认不上传', privacyText);
  check('关于不再出现旧承诺与盾牌', !aboutText.includes('你的谱子') && !aboutText.includes('备份由你手动保存')
    && !sRoot.querySelector('.about .local-first') && sRoot.querySelectorAll('.about svg').length === 2, aboutText);
  check('关于卡不再展示开发者构建信息', !aboutText.includes('零构建') && !aboutText.includes('Web Components'), aboutText);
  check('版本徽标与 GitHub 入口保留', /^v\d+\.\d+\.\d+/.test(sRoot.getElementById('appVer').textContent.trim())
    && sRoot.getElementById('btnGithub').getAttribute('href') === 'https://github.com/moanet/GuitarShell', `${sRoot.getElementById('appVer').textContent.trim()} / ${sRoot.getElementById('btnGithub').getAttribute('href')}`);
  const themeChoices = Array.from(sRoot.querySelectorAll('[data-theme-choice]'));
  check('外观为主题网格两项', themeChoices.length === 2 && themeChoices.every((b) => b.classList.contains('theme-choice')), `${themeChoices.length}`);
  check('外观默认只有一项选中', themeChoices.filter((b) => b.classList.contains('active')).length === 1, '');
  check('外观摘要显示当前主题', sRoot.getElementById('themeSummary').textContent.trim() === '深夜琴房', sRoot.getElementById('themeSummary').textContent.trim());
  sRoot.querySelector('[data-theme-choice="light"]').click();
  await sleep(80);
  check('主题网格可切到浅色', sRoot.querySelector('[data-theme-choice="light"]').classList.contains('active')
    && !sRoot.querySelector('[data-theme-choice="deep"]').classList.contains('active')
    && sRoot.getElementById('themeSummary').textContent.trim() === '暖纸日光', sRoot.getElementById('themeSummary').textContent.trim());
  sRoot.querySelector('[data-theme-choice="deep"]').click();
  await sleep(80);
  check('主题网格可切回深色', sRoot.querySelector('[data-theme-choice="deep"]').classList.contains('active')
    && !sRoot.querySelector('[data-theme-choice="light"]').classList.contains('active')
    && sRoot.getElementById('themeSummary').textContent.trim() === '深夜琴房', sRoot.getElementById('themeSummary').textContent.trim());
  const dataSummary = sRoot.querySelector('#dataCard .fold-value').textContent.replace(/\s+/g, ' ').trim();
  check('数据统计与备份入口合并', sRoot.getElementById('scoreCount').textContent !== '—'
    && dataSummary.includes('份乐谱') && dataSummary.includes('条练习')
    && !!sRoot.getElementById('btnBackup') && !!sRoot.getElementById('btnRestore'), dataSummary);
  check('清空为文本按钮', sRoot.getElementById('btnClear').classList.contains('danger-link'), '');
  const storageBody = sRoot.getElementById('storageBody');
  check('存储卡默认折叠', storageBody.hidden === true && sRoot.getElementById('btnToggleStorage').getAttribute('aria-expanded') === 'false', '');
  sRoot.getElementById('btnToggleStorage').click();
  await sleep(60);
  check('存储卡可展开', storageBody.hidden === false && sRoot.getElementById('btnToggleStorage').getAttribute('aria-expanded') === 'true', '');
  check('展开箭头随状态旋转', sRoot.getElementById('storageCard').classList.contains('open'), '');
  const totalText = sRoot.getElementById('totalUsage').textContent;
  const scoreText = sRoot.getElementById('scoreUsage').textContent;
  const coverText = sRoot.getElementById('coverUsage').textContent;
  const quotaHint = sRoot.getElementById('quotaHint').textContent;
  check('存储卡总占用有值', /约|\d/.test(totalText) && totalText !== '—', totalText);
  check('曲谱文件文案正确', scoreText === expectScoreText, `${scoreText} vs ${expectScoreText}`);
  check('图片缓存文案正确', coverText === expectCoverText, `${coverText} vs ${expectCoverText}`);
  check('图片缓存标题正确', sRoot.querySelector('.storage-line').textContent.includes('图片缓存'), sRoot.querySelector('.storage-line').textContent.trim());
  check('配额提示含图片张数', quotaHint.includes('封面 2 张') && quotaHint.includes('背景 0 张'), quotaHint);
  check('设置页无横向溢出', sRoot.querySelector('.body').scrollWidth <= sRoot.querySelector('.body').clientWidth + 1, `${sRoot.querySelector('.body').scrollWidth}/${sRoot.querySelector('.body').clientWidth}`);

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
  // 点遮罩关闭（0.1.14c）
  const maskEl = sRoot.getElementById('mask');
  const pointer = (type) => maskEl.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1, isPrimary: true
  }));
  pointer('pointerdown');
  pointer('pointerup');
  maskEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(320);
  check('点击遮罩关闭设置', !maskEl.classList.contains('show'), '');

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
  check('重新打开设置后存储卡默认折叠', sRoot.getElementById('storageBody').hidden === true, '');
  const swipe = (type, x, y) => drawer.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: x, clientY: y
  }));
  swipe('pointerdown', 40, 300);
  swipe('pointermove', 90, 302);
  swipe('pointerup', 90, 302);
  await sleep(80);
  check('短横滑不关闭设置', sRoot.getElementById('mask').classList.contains('show'), '');
  swipe('pointerdown', 100, 250);
  swipe('pointermove', 100, 340);
  swipe('pointerup', 100, 340);
  await sleep(80);
  check('纵向滚动不误触关闭', sRoot.getElementById('mask').classList.contains('show'), '');
  const swipeBy = (type, id, x, y) => drawer.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id, isPrimary: id === 7, clientX: x, clientY: y
  }));
  swipeBy('pointerdown', 7, 40, 300);
  swipeBy('pointerdown', 8, 70, 320);
  swipeBy('pointermove', 7, 160, 306);
  await sleep(40);
  swipeBy('pointerup', 7, 160, 306);
  swipeBy('pointerup', 8, 160, 306);
  await sleep(80);
  check('双指横滑不关闭设置', sRoot.getElementById('mask').classList.contains('show'), '');
  swipe('pointerdown', 40, 300);
  swipe('pointermove', 160, 306);
  swipe('pointerup', 160, 306);
  await sleep(340);
  check('右滑关闭设置', !sRoot.getElementById('mask').classList.contains('show'), '');
  settings.open();
  await waitFor(() => settings.shadowRoot.getElementById('totalUsage').textContent !== '—');
  sRoot.getElementById('btnToggleStorage').click();
  await sleep(60);
  sRoot.getElementById('btnCleanOrphan').click();
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
  sRoot.getElementById('btnClose').click();
  await sleep(300);

  // 0.1.14b b1：自定义背景处理与资产指针
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = 1600;
  sourceCanvas.height = 900;
  const sourceCtx = sourceCanvas.getContext('2d');
  sourceCtx.fillStyle = '#1040d0';
  sourceCtx.fillRect(0, 0, 1600, 900);
  sourceCtx.fillStyle = '#d02020';
  sourceCtx.fillRect(400, 0, 800, 900);
  const sourceBlob = await new Promise((resolve) => sourceCanvas.toBlob(resolve, 'image/jpeg', 0.9));
  const sourceFile = new File([sourceBlob], 'wide-test.jpg', { type: 'image/jpeg' });
  const processed = await bgStore.processCustomBackground(sourceFile);
  check('自定义背景输出 1080×1920', processed.width === 1080 && processed.height === 1920, `${processed.width}×${processed.height}`);
  check('自定义背景输出 JPEG 且 ≤900 KB', processed.mime === 'image/jpeg' && processed.bytes <= 900 * 1024, `${processed.mime}/${processed.bytes}`);
  const pixelCanvas = document.createElement('canvas');
  pixelCanvas.width = 1;
  pixelCanvas.height = 1;
  const pixelCtx = pixelCanvas.getContext('2d');
  const pixelImg = new Image();
  const pixelUrl = URL.createObjectURL(processed.blob);
  await new Promise((resolve, reject) => {
    pixelImg.onload = resolve;
    pixelImg.onerror = reject;
    pixelImg.src = pixelUrl;
  });
  pixelCtx.drawImage(pixelImg, 540, 720, 1, 1, 0, 0, 1, 1);
  URL.revokeObjectURL(pixelUrl);
  const px = pixelCtx.getImageData(0, 0, 1, 1).data;
  check('自定义背景中心裁切保留中部', px[0] > 140 && px[2] < 100, `rgb=${px[0]},${px[1]},${px[2]}`);

  const savedBg = await bgStore.saveCustomBackground(sourceFile);
  const statsWithBg = await stats.collectStorageStats();
  check('自定义背景资产 kind 正确', savedBg.asset.kind === 'share-bg' && !savedBg.asset.scoreId, savedBg.asset.kind);
  check('自定义背景写入指针', bgStore.getActiveBackgroundAssetId() === savedBg.id && bgStore.getSelectedBackground() === 'custom', `${bgStore.getActiveBackgroundAssetId()}/${bgStore.getSelectedBackground()}`);
  check('统计包含自定义背景', statsWithBg.backgroundCount === 1 && statsWithBg.backgroundBytes === savedBg.asset.bytes && statsWithBg.imageBytes === statsWithBg.coverBytes + savedBg.asset.bytes, `${statsWithBg.backgroundCount}/${statsWithBg.backgroundBytes}/${statsWithBg.imageBytes}`);
  check('当前自定义背景不算孤儿', (await stats.findOrphanAssets()).every(a => a.id !== savedBg.id), `active=${savedBg.id}`);

  await stats.clearCoverCache();
  check('清封面缓存不删自定义背景', !!(await db.dbService.getAsset(savedBg.id)), `active=${savedBg.id}`);

  const orphanBg = await db.dbService.addAsset({
    kind: 'share-bg', blob: processed.blob, mime: 'image/jpeg',
    width: 1080, height: 1920, bytes: processed.bytes
  });
  const bgOrphans = await stats.findOrphanAssets();
  check('无指针自定义背景被判孤儿', bgOrphans.some(a => a.id === orphanBg), `orphans=${bgOrphans.length}`);
  await stats.clearOrphanAssets();
  check('孤儿清理保留当前自定义', !!(await db.dbService.getAsset(savedBg.id)), `active=${savedBg.id}`);
  check('孤儿清理删除无指针自定义', !(await db.dbService.getAsset(orphanBg)), `orphan=${orphanBg}`);

  const removedBg = await bgStore.removeCustomBackground();
  check('移除自定义背景回退默认', removedBg.deleted && bgStore.getActiveBackgroundAssetId() === null && bgStore.getSelectedBackground() === 'walnut', `${removedBg.deleted}/${bgStore.getSelectedBackground()}`);
  check('移除后资产已删除', !(await db.dbService.getAsset(savedBg.id)), `id=${savedBg.id}`);

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
  const previewBox = preview.shadowRoot.querySelector('.preview');
  const sheetBox = preview.shadowRoot.querySelector('.sheet');
  const previewRect = previewBox.getBoundingClientRect();
  const sheetRect = sheetBox.getBoundingClientRect();
  check('卡片尺寸 1080×1920', canvas.width === 1080 && canvas.height === 1920, `${canvas.width}×${canvas.height}`);
  check('预览高度 420–430', previewRect.height >= 420 && previewRect.height <= 431, previewRect.height.toFixed(1));
  check('分享弹窗一屏显示', sheetRect.top >= 0 && sheetRect.bottom <= innerHeight + 1 && previewRect.height < innerHeight - 200, `${sheetRect.top.toFixed(1)}–${sheetRect.bottom.toFixed(1)}/${innerHeight}`);
  check('默认背景为深胡桃木', canvas.dataset.background === 'walnut', canvas.dataset.background);
  const swatches = preview.shadowRoot.getElementById('swatches');
  check('背景色板共 8 个', swatches && swatches.querySelectorAll('.swatch').length === 8, swatches ? `${swatches.querySelectorAll('.swatch').length}` : 'missing');
  check('背景预设共 6 套', bgLib.SHARE_BACKGROUNDS.length === 6, `${bgLib.SHARE_BACKGROUNDS.length}`);
  check('第 7、8 个为自定义入口', swatches.querySelectorAll('.swatch.custom').length === 2 && swatches.querySelector('[data-bg="custom"]') && swatches.querySelector('[data-bg="custom2"]'), '');
  check('自定义入口占 28px', Math.round(swatches.querySelector('[data-bg="custom"]').getBoundingClientRect().width) === 28 && Math.round(swatches.querySelector('[data-bg="custom2"]').getBoundingClientRect().width) === 28, '');
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

  // 0.1.14b b2：裁切页、自定义背景、压暗滑块、替换与移除
  const cropPromise = preview.openCrop(sourceFile, { replace: false });
  const crop = await waitFor(() => {
    const el = document.querySelector('guitar-share-bg-crop');
    return el && el.dataset.zoom === '1.00' ? el : null;
  }, 8000);
  check('自定义背景裁切页打开', !!crop, '');
  const cropFrame = crop && crop.shadowRoot.getElementById('cropFrame');
  const cropRect = cropFrame.getBoundingClientRect();
  check('裁切取景框为 9:16', Math.abs(cropRect.width / cropRect.height - 9 / 16) < 0.02, `${cropRect.width}×${cropRect.height}`);
  const cropCanvas = crop.shadowRoot.getElementById('cropCanvas');
  check('裁切页初始 1.0×', crop.dataset.zoom === '1.00', crop.dataset.zoom);
  const firePointer = (type, id, x, y) => {
    cropCanvas.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 1, buttons: type === 'pointerup' ? 0 : 1,
      clientX: cropRect.left + x, clientY: cropRect.top + y, bubbles: true, cancelable: true
    }));
  };
  firePointer('pointerdown', 1, 40, cropRect.height / 2);
  firePointer('pointerdown', 2, 180, cropRect.height / 2);
  firePointer('pointermove', 2, 320, cropRect.height / 2);
  check('双指放大改变缩放', Number(crop.dataset.zoom) >= 1.7, crop.dataset.zoom);
  firePointer('pointerup', 1, 40, cropRect.height / 2);
  firePointer('pointerup', 2, 320, cropRect.height / 2);
  crop.shadowRoot.getElementById('btnReset').click();
  check('恢复居中回到 1.0×', crop.dataset.zoom === '1.00', crop.dataset.zoom);

  crop.shadowRoot.getElementById('btnCropConfirm').click();
  await cropPromise;
  await sleep(280);
  await waitFor(() => canvas.dataset.background === 'custom', 8000);
  await sleep(160);
  const customTools = preview.shadowRoot.getElementById('customTools');
  const customSwatch = swatches.querySelector('.swatch.custom');
  const dimRange = preview.shadowRoot.getElementById('dimRange');
  check('确认后卡片使用自定义背景', canvas.dataset.background === 'custom', canvas.dataset.background);
  check('自定义工具行出现', customTools.hidden === false, `${customTools.hidden}`);
  check('自定义色板显示缩略图', customSwatch.classList.contains('has-image') && customSwatch.classList.contains('selected'), customSwatch.className);
  check('默认压暗 30%', canvas.dataset.customDim === '30' && dimRange.value === '30', `${canvas.dataset.customDim}/${dimRange.value}`);
  const customHash30 = cardHash(canvas);
  dimRange.value = '70';
  dimRange.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(260);
  check('压暗滑块实时重绘', canvas.dataset.customDim === '70' && cardHash(canvas) !== customHash30, `${canvas.dataset.customDim}/${cardHash(canvas)}`);
  check('压暗值持久化', localStorage.getItem('gs_share_bg_dim') === '70', localStorage.getItem('gs_share_bg_dim'));
  check('自定义背景主文字对比度达标', contrast(bgLib.CUSTOM_SHARE_BG.palette.strong, '#666666') >= 5, '');
  check('自定义背景弱化文字对比度达标', contrast(bgLib.CUSTOM_SHARE_BG.palette.muted, '#666666') >= 4.5, '');
  check('自定义背景强调色对比度达标', contrast(bgLib.CUSTOM_SHARE_BG.palette.accent, '#666666') >= 3, '');
  dimRange.value = '60';
  dimRange.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(180);

  const firstCustomId = bgStore.getActiveBackgroundAssetId();
  const replacePromise = preview.openCrop(sourceFile, { replace: true });
  await sleep(300);
  const crop2 = await waitFor(() => {
    const el = document.querySelector('guitar-share-bg-crop');
    return el && el !== crop ? el : null;
  }, 8000);
  check('更换时再次进入裁切页', !!crop2, '');
  crop2.shadowRoot.getElementById('btnCropConfirm').click();
  await replacePromise;
  await sleep(280);
  const secondCustomId = bgStore.getActiveBackgroundAssetId();
  check('更换后资产 id 更新', secondCustomId && secondCustomId !== firstCustomId, `${firstCustomId}→${secondCustomId}`);
  check('更换后旧资产已删除', !(await db.dbService.getAsset(firstCustomId)), `old=${firstCustomId}`);

  const removeBtn = preview.shadowRoot.getElementById('btnRemoveBg');
  removeBtn.click();
  check('移除需要二次确认', removeBtn.textContent.includes('再点一次'), removeBtn.textContent);
  removeBtn.click();
  await waitFor(() => canvas.dataset.background === 'walnut' && bgStore.getActiveBackgroundAssetId() === null, 8000);
  await sleep(180);
  check('移除后回退深胡桃木', canvas.dataset.background === 'walnut' && customTools.hidden === true, `${canvas.dataset.background}/${customTools.hidden}`);
  check('移除后自定义色板恢复加号', !customSwatch.classList.contains('has-image'), customSwatch.className);

  // 0.1.15：第二套自定义背景，独立图片与独立压暗
  const custom2Swatch = swatches.querySelector('[data-bg="custom2"]');
  const custom2Promise = preview.openCrop(sourceFile, { replace: false, slotId: 'custom2' });
  await sleep(300);
  const crop3 = await waitFor(() => {
    const el = document.querySelector('guitar-share-bg-crop');
    return el && el !== crop2 ? el : null;
  }, 8000);
  check('第二套自定义进入裁切页', !!crop3, '');
  crop3.shadowRoot.getElementById('btnCropConfirm').click();
  await custom2Promise;
  await sleep(280);
  await waitFor(() => canvas.dataset.background === 'custom2', 8000);
  check('第二套自定义卡片生效', canvas.dataset.background === 'custom2' && localStorage.getItem('gs_share_bg') === 'custom2', `${canvas.dataset.background}/${localStorage.getItem('gs_share_bg')}`);
  check('第二套自定义色板有缩略图并选中', custom2Swatch.classList.contains('has-image') && custom2Swatch.classList.contains('selected'), custom2Swatch.className);
  check('第二套自定义压暗默认 30%', canvas.dataset.customDim === '30' && dimRange.value === '30', `${canvas.dataset.customDim}/${dimRange.value}`);
  dimRange.value = '0';
  dimRange.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(220);
  check('压暗可降到 0%', canvas.dataset.customDim === '0' && dimRange.value === '0', `${canvas.dataset.customDim}/${dimRange.value}`);
  check('第二套压暗值独立持久化', localStorage.getItem('gs_share_bg_dim_2') === '0' && localStorage.getItem('gs_share_bg_dim') === '60', `${localStorage.getItem('gs_share_bg_dim_2')}/${localStorage.getItem('gs_share_bg_dim')}`);
  removeBtn.click();
  removeBtn.click();
  await waitFor(() => canvas.dataset.background === 'walnut' && bgStore.getActiveBackgroundAssetId('custom2') === null, 8000);
  await sleep(180);
  check('移除第二套后色板恢复加号', !custom2Swatch.classList.contains('has-image'), custom2Swatch.className);

  swatches.querySelector('[data-bg="felt"]').click();
  await waitFor(() => canvas.dataset.background === 'felt', 8000);
  await sleep(120);

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
  const nameHashBefore = regionHash(canvas, 1230, 140);
  const footerHashBefore = regionHash(canvas, 1680, 160);
  const quoteBefore = canvas.dataset.quoteId;

  const emptyCard = document.createElement('canvas');
  await bgLib.drawShareCard(emptyCard, preview.summary, { quote: null, background: 'felt' });
  check('页脚格言已绘制', regionHash(emptyCard, 1680, 160) !== footerHashBefore, '');

  const chk = preview.shadowRoot.getElementById('chkName');
  chk.checked = true;
  chk.onchange();
  await waitFor(() => canvas.dataset.showName === '1');
  await sleep(220);
  const nameHashAfter = regionHash(canvas, 1230, 140);
  const footerHashAfter = regionHash(canvas, 1680, 160);
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
