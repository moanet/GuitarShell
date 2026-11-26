#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_022.py
# 0.1.12 浏览器回归：文本谱、封面、禅定锁屏、桌面快捷键
#
# 依赖：
#   pip install websocket-client
#
# 用法（仓库根目录）：
#   python tests/browser/gs_022.py
# ==========================================
import base64
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
PORT = int(os.environ.get("GS_CDP_PORT", "9357"))
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
        self.ws = create_connection(url, timeout=180)
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


def main():
    server = start_server()
    browser = pick_browser()
    profile = tempfile.mkdtemp(prefix="gs-browser-022-")
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
        for _ in range(80):
            if cdp.ev("!!document.querySelector('guitar-sheet-reader')?.shadowRoot?.getElementById('shelfView')"):
                break
            time.sleep(0.25)

        out = cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, timeout = 8000, step = 120) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = await fn();
      if (value) return value;
      await sleep(step);
    }
    return null;
  };
  const reader = document.querySelector('guitar-sheet-reader');
  const $ = (id) => reader.shadowRoot.getElementById(id);
  const out = {};

  const db = await import('/js/services/db.js');
  await db.dbService.clearAllData();
  reader.loadShelf();
  await sleep(300);

  // 清库后冷启动默认可能落在节拍器；回归必须显式切到乐谱页
  document.querySelector('.tab-btn[data-target="view-reader"]').click();
  await sleep(400);

  const lines = Array.from({ length: 36 }, (_, i) => `第 ${i + 1} 行：这是一段用于滚动高亮的歌词，保留空格和换行。`).join('\n');
  const txt = new File([
    '{title: 小星星}\n{artist: 传统}\n{capo: 1}\n{key: C}\n[主歌]\n[C]一闪一闪亮晶晶 [Am]满天都是小星星\n[C]挂在天上放光明 [G]好像许多小眼睛\n\n[副歌]\nC  G  Am  F\n' + lines
  ], '小星星.txt', { type: 'text/plain' });
  const md = new File([
    '# 晨练短句\n\n## 开门\n- 先慢速空弦\n- 再跟节拍器\n\n## 收尾\n最后录一遍。\n'
  ], '晨练.md', { type: 'text/markdown' });
  const cho = new File([
    '{title: 弹唱练习}\n{artist: 自己}\n{capo: 3}\n{section: 主歌}\n[C]今天也要练琴 [G]慢慢来\n[Am]把每一拍 [F]弹清楚\n'
  ], '弹唱.cho', { type: 'text/plain' });

  $('inputSingleFile').onchange({ target: { id: 'inputSingleFile', files: [txt, md, cho], value: '' } });
  await waitFor(() => reader.shadowRoot.querySelectorAll('.score-card').length >= 3);
  await sleep(400);

  const cardInfo = () => Array.from(reader.shadowRoot.querySelectorAll('.score-card')).map((card) => ({
    name: card.querySelector('.score-name')?.textContent || '',
    meta: card.querySelector('.score-meta')?.textContent || '',
    hasCover: !!card.querySelector('.score-cover.has-cover img'),
  }));
  out.textImport = {
    cards: cardInfo(),
    shelfOverflow: $('shelfView').scrollWidth > $('shelfView').clientWidth + 1,
    octetAccept: ($('inputSingleFile').getAttribute('accept') || '').includes('application/octet-stream')
  };

  // 书架多条目：卡片不能被网格压扁，且内部必须能滚动
  const shelf = $('shelfView');
  const sampleCard = shelf.querySelector('.score-card');
  const cardHeight = Math.round(sampleCard.getBoundingClientRect().height);
  const coverWidth = Math.round(sampleCard.querySelector('.score-cover')?.getBoundingClientRect().width || 0);
  const titleSize = parseFloat(getComputedStyle(sampleCard.querySelector('.score-name')).fontSize) || 0;
  const hasCardDelete = !!sampleCard.querySelector('.card-actions, .btn-delete');
  const clones = Array.from({ length: 18 }, () => sampleCard.cloneNode(true));
  clones.forEach((node) => shelf.appendChild(node));
  await sleep(250);
  out.shelfDensity = {
    cardHeight,
    coverWidth,
    titleSize,
    hasCardDelete,
    clientH: shelf.clientHeight,
    scrollH: shelf.scrollHeight,
    canScroll: shelf.scrollHeight > shelf.clientHeight + 20
  };
  shelf.scrollTop = 160;
  await sleep(120);
  out.shelfDensity.scrollTopAfter = shelf.scrollTop;
  clones.forEach((node) => node.remove());
  shelf.scrollTop = 0;
  await sleep(150);

  const textCard = Array.from(reader.shadowRoot.querySelectorAll('.score-card'))
    .find((card) => card.querySelector('.score-name')?.textContent === '小星星.txt');
  textCard.click();
  await waitFor(() => $('contentContainer').querySelector('.text-sheet'));
  await sleep(300);

  const sheet = $('contentContainer').querySelector('.text-sheet');
  out.textRender = {
    title: sheet.querySelector('.text-title')?.textContent || '',
    sections: Array.from(sheet.querySelectorAll('.text-block.section')).map((el) => el.textContent),
    chordTokens: sheet.querySelectorAll('.chord-token').length,
    chordLines: sheet.querySelectorAll('.text-block.chord').length,
    current: sheet.querySelector('.text-block.current')?.textContent || '',
    textOverflow: sheet.scrollWidth > sheet.clientWidth + 1,
    readerFormat: reader.currentFormat,
    bookmarkVisible: getComputedStyle($('btnBookmarks')).display,
    splitVisible: getComputedStyle($('btnSplit')).display,
    viewerClient: $('viewer').clientHeight,
    sheetHeight: sheet.offsetHeight
  };

  $('viewer').scrollTop = Math.round(($('viewer').scrollHeight - $('viewer').clientHeight) * 0.58);
  $('viewer').dispatchEvent(new Event('scroll'));
  await sleep(350);
  const currentAfterScroll = sheet.querySelector('.text-block.current')?.textContent || '';
  out.textScroll = {
    top: $('viewer').scrollTop,
    current: currentAfterScroll,
    changed: currentAfterScroll !== out.textRender.current
  };

  $('btnSavePos').click();
  await sleep(350);
  $('btnBack').click();
  await waitFor(() => !reader.classList.contains('reading'));
  await sleep(250);

  textCard.click();
  await waitFor(() => $('contentContainer').querySelector('.text-sheet'));
  await sleep(250);
  const banner = $('progressBanner');
  out.textRestore = { bannerShown: banner.classList.contains('show') };
  if (banner.classList.contains('show')) {
    $('pbText').click();
    await sleep(600);
  }
  out.textRestore.ratio = Number(($('viewer').scrollTop / Math.max(1, $('viewer').scrollHeight - $('viewer').clientHeight)).toFixed(3));
  out.textRestore.savedRatio = 0.58;

  $('btnBack').click();
  await waitFor(() => !reader.classList.contains('reading'));
  await sleep(250);

  // PDF 首页封面
  const pdfResp = await fetch('/tests/browser/fixtures/split-source.pdf');
  const pdfBlob = await pdfResp.blob();
  const pdf = new File([pdfBlob], '封面测试.pdf', { type: 'application/pdf' });
  $('inputSingleFile').onchange({ target: { id: 'inputSingleFile', files: [pdf], value: '' } });
  await waitFor(() => Array.from(reader.shadowRoot.querySelectorAll('.score-name')).some((el) => el.textContent === '封面测试.pdf'));
  const pdfCard = Array.from(reader.shadowRoot.querySelectorAll('.score-card'))
    .find((card) => card.querySelector('.score-name')?.textContent === '封面测试.pdf');
  await waitFor(() => pdfCard.querySelector('.score-cover.has-cover img')?.naturalWidth > 0, 15000);
  const pdfScore = await db.dbService.getScore(Number(pdfCard.dataset.scoreId));
  const pdfAsset = pdfScore?.coverAssetId ? await db.dbService.getAsset(pdfScore.coverAssetId) : null;
  out.cover = {
    hasCover: !!pdfCard.querySelector('.score-cover.has-cover img'),
    width: pdfCard.querySelector('.score-cover img')?.naturalWidth || 0,
    complete: pdfCard.querySelector('.score-cover img')?.complete || false,
    asset: pdfAsset ? { type: pdfAsset.mime, bytes: pdfAsset.bytes, dims: [pdfAsset.width, pdfAsset.height], pageCount: pdfAsset.pageCount } : null,
    meta: pdfCard.querySelector('.score-meta')?.textContent || ''
  };

  // 禅定模式：透明阅读锁
  pdfCard.click();
  await waitFor(() => reader.classList.contains('reading'));
  await sleep(400);
  $('btnZenLock').click();
  await sleep(250);
  out.zen = {
    locked: reader.zenLocked,
    mask: $('zenLock').classList.contains('show'),
    zenActive: reader.classList.contains('zen-active'),
    background: getComputedStyle($('zenLock')).backgroundColor,
    pointerEvents: getComputedStyle($('zenLock')).pointerEvents,
    revealed: $('zenLock').classList.contains('revealed'),
    panelOpacity: Number(getComputedStyle($('zenPanel')).opacity),
    panelPointer: getComputedStyle($('zenPanel')).pointerEvents,
    toolbarDisplay: getComputedStyle($('readerToolbar')).display,
    viewerOverflow: getComputedStyle($('viewer')).overflow,
    viewerTouchAction: getComputedStyle($('viewer')).touchAction,
    zoomVisibility: getComputedStyle($('zoomControls')).visibility,
    miniOpacity: Number(getComputedStyle($('miniMetronome')).opacity),
    navDisplay: getComputedStyle($('navPrev')).display
  };
  $('viewer').scrollTop = 120;
  out.zen.scrollTopBefore = $('viewer').scrollTop;
  $('viewer').dispatchEvent(new WheelEvent('wheel', { deltaY: 160, bubbles: true, cancelable: true }));
  await sleep(80);
  out.zen.scrollTopAfterWheel = $('viewer').scrollTop;

  const tapViewer = async () => {
    const rect = $('viewer').getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, isPrimary: true, clientX: x, clientY: y };
    $('viewer').dispatchEvent(new PointerEvent('pointerdown', opts));
    $('viewer').dispatchEvent(new PointerEvent('pointerup', opts));
    await sleep(250);
  };
  await tapViewer();
  out.zen.revealedAfterTap = $('zenLock').classList.contains('revealed');
  out.zen.panelOpacityAfterTap = Number(getComputedStyle($('zenPanel')).opacity);
  out.zen.panelPointerAfterTap = getComputedStyle($('zenPanel')).pointerEvents;

  const down = () => $('zenUnlock').dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, isPrimary: true
  }));
  const up = () => $('zenUnlock').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, isPrimary: true
  }));
  down();
  await sleep(1000);
  up();
  await sleep(200);
  out.zen.shortHoldStillLocked = reader.zenLocked;

  window.dispatchEvent(new CustomEvent('gs-back-request'));
  await sleep(250);
  out.zen.backStillReading = reader.classList.contains('reading');
  out.zen.backStillLocked = reader.zenLocked;

  down();
  await sleep(1700);
  out.zen.longHoldUnlocked = !reader.zenLocked;
  up();
  await sleep(200);

  // 桌面键盘：翻页、缩放、全屏、节拍器、锁定
  $('viewer').scrollTop = 0;
  const keydown = (value, repeat = false) => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: value, bubbles: true, cancelable: true, repeat
  }));
  const keyup = (value) => window.dispatchEvent(new KeyboardEvent('keyup', {
    key: value, bubbles: true, cancelable: true
  }));
  keydown('PageDown');
  await sleep(500);
  out.keyboard = { pageDown: $('viewer').scrollTop > 0 };
  const beforeZoom = reader.scale;
  keydown('+');
  await sleep(200);
  out.keyboard.zoom = reader.scale > beforeZoom;
  keydown('f');
  await sleep(300);
  out.keyboard.fullscreen = reader.fullscreen;
  keydown('Escape');
  await sleep(300);
  out.keyboard.exitFullscreen = !reader.fullscreen;
  $('mmPlay').click();
  await sleep(300);
  out.keyboard.metronomePlaying = reader.mmPlaying;
  $('mmPlay').click();
  await sleep(200);

  // L 短按进入；锁定期间其他快捷键全部失效；长按 L 解锁
  keydown('l');
  await sleep(250);
  out.keyboard.lock = reader.zenLocked;
  keyup('l');
  await sleep(300);
  out.keyboard.quickLStillLocked = reader.zenLocked;
  const lockedScroll = $('viewer').scrollTop;
  keydown('PageDown');
  await sleep(350);
  out.keyboard.lockedPageDownBlocked = Math.abs($('viewer').scrollTop - lockedScroll) < 2;
  const lockedZoom = reader.scale;
  keydown('+');
  await sleep(200);
  out.keyboard.lockedZoomBlocked = reader.scale === lockedZoom;
  keydown(' ');
  await sleep(200);
  out.keyboard.lockedSpaceBlocked = reader.mmPlaying === false;
  keydown('Escape');
  await sleep(200);
  out.keyboard.lockedEscBlocked = reader.classList.contains('reading') && reader.zenLocked;
  keydown('l');
  await sleep(1200);
  out.keyboard.longLStillLocked = reader.zenLocked;
  await sleep(450);
  out.keyboard.unlocked = !reader.zenLocked;
  keyup('l');
  await sleep(200);

  out.registry = {
    dbVersion: await new Promise((resolve, reject) => {
      const req = indexedDB.open('GuitarShellDB');
      req.onsuccess = () => {
        const version = req.result.version;
        const stores = Array.from(req.result.objectStoreNames);
        req.result.close();
        resolve({ version, stores });
      };
      req.onerror = () => reject(req.error);
    })
  };

  $('btnBack').click();
  await sleep(400);
  out.shelfFinalOverflow = $('shelfView').scrollWidth > $('shelfView').clientWidth + 1;
  return out;
})()
""")

        print(json.dumps(out, ensure_ascii=False, indent=2))

        assert out["textImport"]["cards"], out
        names = {item["name"]: item["meta"] for item in out["textImport"]["cards"]}
        assert names.get("小星星.txt") == "TXT", out
        assert names.get("晨练.md") == "MD", out
        assert names.get("弹唱.cho") == "CHO", out
        assert out["textImport"]["shelfOverflow"] is False, out
        assert out["textImport"]["octetAccept"] is True, out
        assert out["shelfDensity"]["cardHeight"] >= 140, out
        assert out["shelfDensity"]["canScroll"] is True, out
        assert out["shelfDensity"]["scrollTopAfter"] >= 100, out
        assert out["shelfDensity"]["hasCardDelete"] is False, out
        if 341 <= WIDTH <= 380:
            assert out["shelfDensity"]["coverWidth"] == 72, out
            assert abs(out["shelfDensity"]["titleSize"] - 12.5) < 0.2, out
        assert out["textRender"]["title"] == "小星星", out
        assert "主歌" in out["textRender"]["sections"], out
        assert out["textRender"]["chordTokens"] >= 4, out
        assert out["textRender"]["chordLines"] >= 1, out
        assert out["textRender"]["current"], out
        assert out["textRender"]["textOverflow"] is False, out
        assert out["textRender"]["readerFormat"] == "text", out
        assert out["textRender"]["bookmarkVisible"] == "none", out
        assert out["textRender"]["splitVisible"] == "none", out
        assert out["textRender"]["viewerClient"] > 0, out
        assert out["textScroll"]["top"] > 0, out
        assert out["textScroll"]["changed"] is True, out
        assert out["textRestore"]["bannerShown"] is True, out
        assert abs(out["textRestore"]["ratio"] - out["textRestore"]["savedRatio"]) < 0.04, out
        assert out["cover"]["hasCover"] is True, out
        assert out["cover"]["complete"] is True, out
        assert out["cover"]["width"] >= 200, out
        assert out["cover"]["asset"]["dims"] == [320, 427], out
        assert "3 页" in out["cover"]["meta"], out
        assert out["zen"]["locked"] is True and out["zen"]["mask"] is True, out
        assert out["zen"]["zenActive"] is True, out
        assert out["zen"]["background"] in ("rgba(0, 0, 0, 0)", "transparent"), out
        assert out["zen"]["pointerEvents"] == "none", out
        assert out["zen"]["toolbarDisplay"] == "none", out
        assert out["zen"]["viewerOverflow"] == "hidden", out
        assert out["zen"]["viewerTouchAction"] == "none", out
        assert out["zen"]["scrollTopAfterWheel"] == out["zen"]["scrollTopBefore"], out
        assert out["zen"]["zoomVisibility"] == "hidden", out
        assert out["zen"]["miniOpacity"] <= 0.001, out
        assert out["zen"]["navDisplay"] == "none", out
        assert out["zen"]["revealed"] is False, out
        assert out["zen"]["panelOpacity"] <= 0.05, out
        assert out["zen"]["panelPointer"] == "none", out
        assert out["zen"]["revealedAfterTap"] is True, out
        assert out["zen"]["panelOpacityAfterTap"] >= 0.9, out
        assert out["zen"]["panelPointerAfterTap"] == "auto", out
        assert out["zen"]["shortHoldStillLocked"] is True, out
        assert out["zen"]["backStillReading"] is True and out["zen"]["backStillLocked"] is True, out
        assert out["zen"]["longHoldUnlocked"] is True, out
        assert out["keyboard"]["pageDown"] is True, out
        assert out["keyboard"]["zoom"] is True, out
        assert out["keyboard"]["fullscreen"] is True, out
        assert out["keyboard"]["exitFullscreen"] is True, out
        assert out["keyboard"]["lock"] is True, out
        assert out["keyboard"]["quickLStillLocked"] is True, out
        assert out["keyboard"]["lockedPageDownBlocked"] is True, out
        assert out["keyboard"]["lockedZoomBlocked"] is True, out
        assert out["keyboard"]["lockedSpaceBlocked"] is True, out
        assert out["keyboard"]["lockedEscBlocked"] is True, out
        assert out["keyboard"]["longLStillLocked"] is True, out
        assert out["keyboard"]["unlocked"] is True, out
        assert out["registry"]["dbVersion"]["version"] == 4, out
        assert "assets" in out["registry"]["dbVersion"]["stores"], out
        assert out["shelfFinalOverflow"] is False, out

        shot = tempfile.NamedTemporaryFile(prefix=f"gs_022_{WIDTH}_", suffix=".png", delete=False)
        shot.close()
        data = cdp.cmd("Page.captureScreenshot", {"format": "png"})["result"]["data"]
        Path(shot.name).write_bytes(base64.b64decode(data))
        out["screenshot"] = shot.name
        print(json.dumps(out, ensure_ascii=False, indent=2))
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        if server:
            server.terminate()


if __name__ == "__main__":
    main()
