#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_018.py
# 0.1.8 浏览器回归：工具栏、双指缩放、外点关闭、返回层级
#
# 用法（仓库根目录）：
#   python tests/browser/gs_018.py
#   GS_WIDTH=360 python tests/browser/gs_018.py
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
FIXTURE = ROOT / "tests" / "browser" / "fixtures" / "split-source.pdf"
BASE = os.environ.get("GS_BASE_URL", "http://127.0.0.1:8123/").rstrip("/") + "/"
PORT = int(os.environ.get("GS_CDP_PORT", "9353"))
WIDTH = int(os.environ.get("GS_WIDTH", "320"))

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
        self.ws = create_connection(url, timeout=30)
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
    if not FIXTURE.exists():
        raise RuntimeError(f"缺少测试 PDF：{FIXTURE}")
    pdf_b64 = json.dumps(base64.b64encode(FIXTURE.read_bytes()).decode("ascii"))

    server = start_server()
    browser = pick_browser()
    profile = tempfile.mkdtemp(prefix="gs-browser-018-")
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
        cdp.cmd("Page.enable")
        cdp.cmd("Emulation.setDeviceMetricsOverride", {
            "width": WIDTH, "height": 800, "deviceScaleFactor": 1, "mobile": True,
        })
        for _ in range(80):
            if cdp.ev("!!document.querySelector('guitar-sheet-reader')?.shadowRoot"):
                break
            time.sleep(0.25)

        out = cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  const b64 = __PDF_B64__;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pdfBlob = new Blob([bytes], { type: 'application/pdf' });

  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('GuitarShellDB', 3);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('scores', 'readwrite');
    const s = tx.objectStore('scores');
    s.clear();
    s.add({ name: '交互测试.pdf', createdAt: Date.now(), updatedAt: Date.now(),
      tags: ['练习'], fileBlob: pdfBlob, fileHash: 'gs018-fixture' });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });

  document.querySelector('.tab-btn[data-target="view-reader"]').click();
  const r = document.querySelector('guitar-sheet-reader');
  await sleep(120); await r.loadShelf(); await sleep(160);
  const sr = r.shadowRoot;
  sr.querySelector('.score-card').click();
  for (let i = 0; i < 60; i++) {
    if (r.pdfDoc && r.pdfDoc.numPages === 3) break;
    await sleep(100);
  }

  // 记录原生层数同步
  window.__depths = [];
  window.Capacitor = window.Capacitor || {};
  window.Capacitor.Plugins = window.Capacitor.Plugins || {};
  window.Capacitor.Plugins.BackGuard = {
    setLayerDepth({ depth }) { window.__depths.push(depth); }
  };

  const viewer = sr.querySelector('#viewer');
  const ids = ['btnBack', 'btnLog', 'btnSavePos', 'btnBookmarks', 'btnSplit'];
  const buttons = ids.map(id => sr.querySelector('#' + id));
  const rects = buttons.map(btn => btn.getBoundingClientRect());
  out.toolbar = {
    labels: Array.from(sr.querySelectorAll('.tool-btn .tl')).map(el => el.textContent),
    visible: buttons.every(btn => getComputedStyle(btn).display !== 'none'),
    oneRow: Math.max(...rects.map(r => r.top)) - Math.min(...rects.map(r => r.top)) < 1,
    inViewport: rects.every(r => r.left >= 0 && r.right <= innerWidth),
    heights: rects.map(r => Math.round(r.height)),
    widths: rects.map(r => Math.round(r.width))
  };

  // 双指缩放：合成 TouchEvent，检查 scale 与滚动锚点
  out.pinch = { supported: false };
  try {
    const mk = (x, y, id) => new Touch({
      identifier: id, target: viewer, clientX: x, clientY: y,
      pageX: x, pageY: y, screenX: x, screenY: y
    });
    const fire = (type, pts) => viewer.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, touches: pts, targetTouches: pts, changedTouches: pts
    }));
    r.scale = 1; viewer.scrollLeft = 0; viewer.scrollTop = 0;
    fire('touchstart', [mk(100, 300, 1), mk(220, 300, 2)]);
    fire('touchmove', [mk(50, 300, 1), mk(270, 300, 2)]);
    await sleep(40);
    out.pinch = {
      supported: true,
      scale: Math.round(r.scale * 100) / 100,
      scrollLeft: Math.round(viewer.scrollLeft),
      scrollTop: Math.round(viewer.scrollTop)
    };
    fire('touchend', []);
    await sleep(30);
  } catch (err) {
    out.pinch = { supported: false, error: String(err) };
  }

  // 无改动时外点关闭记录练习弹窗
  const logMask = sr.querySelector('#logModalMask');
  sr.querySelector('#btnLog').click();
  await sleep(60);
  const tapMask = (mask) => {
    mask.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    mask.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  };
  tapMask(logMask);
  await sleep(80);
  out.backdrop = {
    logClosed: !logMask.classList.contains('show'),
    dialogOpen: !!document.querySelector('guitar-app-dialog')
  };

  // 有改动时外点关闭应先弹放弃确认
  sr.querySelector('#btnLog').click();
  await sleep(50);
  const timeInput = sr.querySelector('#logTime');
  timeInput.value = '15';
  timeInput.dispatchEvent(new Event('input', { bubbles: true }));
  tapMask(logMask);
  await sleep(120);
  const dlg = document.querySelector('guitar-app-dialog');
  out.dirty = {
    dialogOpen: !!dlg,
    title: dlg?.shadowRoot?.querySelector('#dlgTitle')?.textContent || '',
    logStillOpen: logMask.classList.contains('show'),
    detailsDisplay: getComputedStyle(dlg.shadowRoot.querySelector('#dlgDetails')).display
  };
  dlg?.shadowRoot?.querySelector('#dlgCancel')?.click();
  await sleep(220);
  out.dirty.cancelKeptLogOpen = logMask.classList.contains('show');
  timeInput.value = '';
  timeInput.dispatchEvent(new Event('input', { bubbles: true }));
  sr.querySelector('#logCancel').click();
  await sleep(80);
  out.dirty.closedAfterClean = !logMask.classList.contains('show');

  // 书签面板：打开后系统返回只关面板
  sr.querySelector('#btnBookmarks').click();
  await sleep(50);
  const depthBeforeBookmark = window.__depths.slice();
  window.dispatchEvent(new CustomEvent('gs-back-request'));
  await sleep(80);
  out.backLayer = {
    depthBeforeBookmark,
    bookmarkClosed: !sr.querySelector('#bookmarkMask').classList.contains('show'),
    depthAfter: window.__depths[window.__depths.length - 1]
  };

  // 拆分弹窗：返回关闭；先开 picker 时返回只关 picker
  sr.querySelector('#btnSplit').click();
  await sleep(80);
  sr.querySelector('#splitPreviewStart').click();
  await sleep(60);
  window.dispatchEvent(new CustomEvent('gs-back-request'));
  await sleep(70);
  out.splitBack = {
    pickerClosed: !sr.querySelector('#splitPickerMask').classList.contains('show'),
    splitStillOpen: sr.querySelector('#splitModalMask').classList.contains('show')
  };
  window.dispatchEvent(new CustomEvent('gs-back-request'));
  await sleep(90);
  out.splitBack.splitClosed = !sr.querySelector('#splitModalMask').classList.contains('show');

  // 阅读页返回书架
  window.dispatchEvent(new CustomEvent('gs-back-request'));
  await sleep(260);
  out.readerBack = {
    reading: r.classList.contains('reading'),
    shelfDisplay: getComputedStyle(sr.querySelector('#shelfView')).display,
    depthAfter: window.__depths[window.__depths.length - 1]
  };

  // 管理模式返回退出管理
  sr.querySelector('#btnManage').click();
  await sleep(60);
  window.dispatchEvent(new CustomEvent('gs-back-request'));
  await sleep(80);
  out.manageBack = {
    manageMode: !!r.manageMode,
    batchVisible: sr.querySelector('#batchBar').classList.contains('show'),
    depthAfter: window.__depths[window.__depths.length - 1]
  };

  out.depths = window.__depths.slice();
  return out;
})()
""".replace("__PDF_B64__", pdf_b64))

        assert out["toolbar"]["visible"] is True, out
        assert out["toolbar"]["oneRow"] is True, out
        assert out["toolbar"]["inViewport"] is True, out
        assert out["toolbar"]["labels"] == ["返回", "打卡", "存进度", "书签", "拆分"], out
        assert out["pinch"]["supported"] is True, out
        assert out["pinch"]["scale"] > 1.2, out
        assert out["pinch"]["scrollLeft"] > 0, out
        assert out["backdrop"]["logClosed"] is True, out
        assert out["backdrop"]["dialogOpen"] is False, out
        assert out["dirty"]["dialogOpen"] is True, out
        assert "放弃本次记录" in out["dirty"]["title"], out
        assert out["dirty"]["detailsDisplay"] == "none", out
        assert out["dirty"]["logStillOpen"] is True, out
        assert out["dirty"]["cancelKeptLogOpen"] is True, out
        assert out["dirty"]["closedAfterClean"] is True, out
        assert out["backLayer"]["bookmarkClosed"] is True, out
        assert out["backLayer"]["depthBeforeBookmark"][-1] == 2, out
        assert out["backLayer"]["depthAfter"] == 1, out
        assert out["splitBack"]["pickerClosed"] is True, out
        assert out["splitBack"]["splitStillOpen"] is True, out
        assert out["splitBack"]["splitClosed"] is True, out
        assert out["readerBack"]["reading"] is False, out
        assert out["readerBack"]["depthAfter"] == 0, out
        assert out["manageBack"]["manageMode"] is False, out
        assert out["manageBack"]["batchVisible"] is False, out
        assert out["manageBack"]["depthAfter"] == 0, out

        # 重新打开阅读页，截一张带工具栏的图给人工复核
        cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const r = document.querySelector('guitar-sheet-reader');
  const sr = r.shadowRoot;
  sr.querySelector('.score-card').click();
  for (let i = 0; i < 40; i++) {
    if (r.pdfDoc && r.pdfDoc.numPages === 3) break;
    await sleep(100);
  }
  await sleep(220);
})()
""")
        shot = tempfile.NamedTemporaryFile(prefix=f"gs_018_{WIDTH}_", suffix=".png", delete=False)
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
