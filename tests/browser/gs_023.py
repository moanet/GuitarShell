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
  check('默认不显示曲名', canvas.dataset.showName === '0' && !preview.shadowRoot.getElementById('chkName').checked, '');
  check('今日分钟正确', canvas.dataset.minutes === '35', canvas.dataset.minutes);
  check('网页端走下载通道', preview.dataset.shareChannel === 'web', preview.dataset.shareChannel);

  const pixelHash = (c) => {
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(96, 930, 888, 130).data;
    let h = 0;
    for (let i = 0; i < data.length; i += 61) h = (h * 31 + data[i]) % 2147483647;
    return h;
  };
  const hashBefore = pixelHash(canvas);
  const chk = preview.shadowRoot.getElementById('chkName');
  chk.checked = true;
  chk.onchange();
  await waitFor(() => canvas.dataset.showName === '1');
  await sleep(220);
  const hashAfter = pixelHash(canvas);
  check('打开开关后显示曲名', canvas.dataset.showName === '1' && hashBefore !== hashAfter, `${hashBefore} → ${hashAfter}`);

  let downloads = 0;
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { downloads += 1; };
  preview.shadowRoot.getElementById('btnShare').click();
  await waitFor(() => downloads > 0);
  await sleep(260);
  HTMLAnchorElement.prototype.click = origClick;
  check('保存图片触发下载', downloads > 0, `downloads=${downloads}`);
  check('分享卡已关闭', !document.querySelector('guitar-share-preview'), '');

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
