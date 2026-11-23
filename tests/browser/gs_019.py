#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_019.py
# 0.1.9 浏览器回归：相册入口回退、20 张限制、原生路径转 File
#
# 用法（仓库根目录）：
#   python tests/browser/gs_019.py
#   GS_WIDTH=360 python tests/browser/gs_019.py
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
PORT = int(os.environ.get("GS_CDP_PORT", "9354"))
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
    server = start_server()
    browser = pick_browser()
    profile = tempfile.mkdtemp(prefix="gs-browser-019-")
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
        cdp.cmd("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        for _ in range(80):
            if cdp.ev("!!document.querySelector('guitar-sheet-reader')?.shadowRoot"):
                break
            time.sleep(0.25)

        out = cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};

  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('GuitarShellDB', 3);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction(['scores', 'logs'], 'readwrite');
    tx.objectStore('scores').clear();
    tx.objectStore('logs').clear();
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });

  document.querySelector('.tab-btn[data-target="view-reader"]').click();
  const r = document.querySelector('guitar-sheet-reader');
  await sleep(120);
  await r.loadShelf();
  await sleep(120);
  const sr = r.shadowRoot;
  const $ = (id) => sr.getElementById(id);
  const cardCount = () => sr.querySelectorAll('.score-card').length;

  // 1. Web 回退：没有原生插件时，相册按钮要触发隐藏 input，而不是报错
  $('btnImportMain').click();
  await sleep(80);
  let inputClicks = 0;
  const inputGallery = $('inputGallery');
  const realClick = inputGallery.click.bind(inputGallery);
  inputGallery.click = () => { inputClicks++; };
  $('btnGallery').click();
  await sleep(120);
  out.webFallback = {
    inputClicks,
    sheetClosed: !$('actionSheetMask').classList.contains('show'),
    cards: cardCount()
  };
  inputGallery.click = realClick;

  // 2. Web 一次 21 张：只导入前 20 张，并提示截断
  const mkImage = (i) => new File(
    [new Blob([`gs019-image-${i}`], { type: 'image/png' })],
    `gallery-${String(i).padStart(2, '0')}.png`,
    { type: 'image/png', lastModified: Date.now() }
  );
  const files21 = Array.from({ length: 21 }, (_, i) => mkImage(i + 1));
  const fakeTarget = { id: 'inputGallery', files: files21, value: 'fake' };
  $('inputGallery').onchange({ target: fakeTarget });

  for (let i = 0; i < 240; i++) {
    if (!$('loading').classList.contains('show') && cardCount() === 20) break;
    await sleep(50);
  }
  out.webLimit = {
    cards: cardCount(),
    truncatedToast: $('toast').textContent,
    sheetClosed: !$('actionSheetMask').classList.contains('show')
  };

  // 3. 原生取消：静默返回，不新增卡片、不显示失败
  let cancelCalls = 0;
  window.Capacitor = {
    isNativePlatform: () => true,
    convertFileSrc: (path) => `mock://${path}`,
    Plugins: {
      GalleryPicker: {
        pickImages: async ({ limit }) => {
          cancelCalls++;
          out.cancelLimit = limit;
          const err = new Error('已取消选择');
          err.code = 'PICK_CANCELLED';
          throw err;
        }
      }
    }
  };
  const beforeCancel = cardCount();
  $('btnImportMain').click();
  await sleep(60);
  $('btnGallery').click();
  await sleep(200);
  out.nativeCancel = {
    calls: cancelCalls,
    cardsBefore: beforeCancel,
    cardsAfter: cardCount(),
    sheetClosed: !$('actionSheetMask').classList.contains('show'),
    toast: $('toast').textContent
  };

  // 4. 原生成功：缓存路径 -> convertFileSrc -> fetch -> File，复用 handleFiles
  let successCalls = 0;
  let successLimit = 0;
  const realFetch = window.fetch.bind(window);
  window.Capacitor.Plugins.GalleryPicker.pickImages = async ({ limit }) => {
    successCalls++;
    successLimit = limit;
    return {
      failed: 0,
      files: [
        { path: '/data/user/0/com.guitarshell/cache/gallery-picker/native-1.jpg', name: 'native-1.jpg', mimeType: 'image/jpeg', size: 12 },
        { path: '/data/user/0/com.guitarshell/cache/gallery-picker/native-2.jpg', name: 'native-2.jpg', mimeType: 'image/jpeg', size: 12 }
      ]
    };
  };
  window.fetch = async (url, opts) => {
    const text = String(url);
    if (text.startsWith('mock://')) {
      return new Response(new Blob([`native-bytes-${text}`], { type: 'image/jpeg' }), { status: 200 });
    }
    return realFetch(url, opts);
  };

  $('btnImportMain').click();
  await sleep(60);
  $('btnGallery').click();
  for (let i = 0; i < 160; i++) {
    if (!$('loading').classList.contains('show') && cardCount() === beforeCancel + 2) break;
    await sleep(50);
  }
  const nativeNames = Array.from(sr.querySelectorAll('.score-name')).map(el => el.textContent);
  out.nativeSuccess = {
    calls: successCalls,
    limit: successLimit,
    cardsBefore: beforeCancel,
    cardsAfter: cardCount(),
    hasNative1: nativeNames.includes('native-1.jpg'),
    hasNative2: nativeNames.includes('native-2.jpg'),
    sheetClosed: !$('actionSheetMask').classList.contains('show')
  };
  window.fetch = realFetch;

  // 5. 服务层直接验证：返回 File、无 base64 字段、失败计数
  const gp = await import('/js/services/gallery-picker.js');
  window.Capacitor.Plugins.GalleryPicker.pickImages = async () => ({
    failed: 1,
    files: [
      { path: '/data/cache/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 6 },
      { path: '', name: 'broken.jpg', mimeType: 'image/jpeg', size: 6 }
    ]
  });
  window.fetch = async (url, opts) => {
    if (String(url).startsWith('mock://')) {
      return new Response(new Blob(['abcdef'], { type: 'image/jpeg' }), { status: 200 });
    }
    return realFetch(url, opts);
  };
  const picked = await gp.pickGalleryImages({ limit: 999 });
  out.service = {
    isFile: picked.files[0] instanceof File,
    name: picked.files[0].name,
    type: picked.files[0].type,
    size: picked.files[0].size,
    failed: picked.failed,
    truncated: picked.truncated,
    noBase64Key: !('data' in picked.files[0]) && !JSON.stringify({ name: picked.files[0].name, size: picked.files[0].size }).includes('base64'),
    webTake21: gp.takeGalleryFiles(files21).files.length,
    webTruncated: gp.takeGalleryFiles(files21).truncated
  };
  window.fetch = realFetch;

  return out;
})()
""")

        assert out["webFallback"]["inputClicks"] == 1, out
        assert out["webFallback"]["sheetClosed"] is True, out
        assert out["webFallback"]["cards"] == 0, out
        assert out["webLimit"]["cards"] == 20, out
        assert "一次最多 20 张" in out["webLimit"]["truncatedToast"], out
        assert out["nativeCancel"]["calls"] == 1, out
        assert out["nativeCancel"]["cardsBefore"] == 20, out
        assert out["nativeCancel"]["cardsAfter"] == 20, out
        assert out["nativeCancel"]["sheetClosed"] is True, out
        assert "相册导入失败" not in out["nativeCancel"]["toast"], out
        assert out["nativeSuccess"]["calls"] == 1, out
        assert out["nativeSuccess"]["limit"] == 20, out
        assert out["nativeSuccess"]["cardsAfter"] == 22, out
        assert out["nativeSuccess"]["hasNative1"] is True, out
        assert out["nativeSuccess"]["hasNative2"] is True, out
        assert out["nativeSuccess"]["sheetClosed"] is True, out
        assert out["service"]["isFile"] is True, out
        assert out["service"]["name"] == "a.jpg", out
        assert out["service"]["type"] == "image/jpeg", out
        assert out["service"]["size"] == 6, out
        assert out["service"]["failed"] == 2, out
        assert out["service"]["truncated"] == 0, out
        assert out["service"]["noBase64Key"] is True, out
        assert out["service"]["webTake21"] == 20, out
        assert out["service"]["webTruncated"] is True, out

        shot = tempfile.NamedTemporaryFile(prefix=f"gs_019_{WIDTH}_", suffix=".png", delete=False)
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
