#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_015.py
# 0.1.5 浏览器回归：批量标签焦点 + 云同步取消/失败重试
#
# 依赖：
#   pip install websocket-client
#
# 用法（仓库根目录）：
#   python tests/browser/gs_015.py
#   GS_BROWSER="C:\...\msedge.exe" python tests/browser/gs_015.py
#   GS_BASE_URL=http://127.0.0.1:8123/ python tests/browser/gs_015.py
#
# 脚本会自动探测 Edge / Chrome；本地静态服务没起时会自动拉起并清理。
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
PORT = int(os.environ.get("GS_CDP_PORT", "9351"))

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
        self.ws = create_connection(url, timeout=20)
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
    profile = tempfile.mkdtemp(prefix="gs-browser-015-")
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
            "width": 360, "height": 800, "deviceScaleFactor": 1, "mobile": True,
        })
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
    const tx = db.transaction('scores', 'readwrite');
    const s = tx.objectStore('scores');
    s.clear();
    s.add({ name: '批量焦点.png', createdAt: Date.now(), updatedAt: Date.now(),
      tags: ['流行', '练习'], fileBlob: new Blob(['x'], { type: 'image/png' }), fileHash: 'batch-focus' });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });

  document.querySelector('.tab-btn[data-target="view-reader"]').click();
  const r = document.querySelector('guitar-sheet-reader');
  await sleep(150); await r.loadShelf(); await sleep(180);
  const sr = r.shadowRoot;
  const activeInfo = () => {
    const a = sr.activeElement;
    return a ? { id: a.id || '', tag: a.tagName, cls: a.className || '' } : null;
  };

  sr.querySelector('#btnManage').click(); await sleep(80);
  sr.querySelector('.score-card').click(); await sleep(80);
  sr.querySelector('#batchTag').click(); await sleep(140);
  out.batchOpen = {
    modal: sr.querySelector('#tagModalMask').classList.contains('show'),
    active: activeInfo(),
    inputFocused: sr.activeElement?.id === 'tagModalInput'
  };
  sr.querySelector('#tagQuickList .quick-tag[data-tag="练习"]').click(); await sleep(100);
  out.batchChip = {
    value: sr.querySelector('#tagModalInput').value,
    active: activeInfo(),
    inputFocused: sr.activeElement?.id === 'tagModalInput'
  };
  sr.querySelector('#tagModalCancel').click(); await sleep(80);
  sr.querySelector('#batchExit').click(); await sleep(80);

  const wd = await import('/js/services/webdav.js');
  out.timeouts = wd.webdavService.getTimeouts();

  window.dispatchEvent(new CustomEvent('open-cloud-sync')); await sleep(200);
  sr.querySelector('#cloudUser').value = 'test@example.com';
  sr.querySelector('#cloudPass').value = 'pass';
  sr.querySelector('#cloudPath').value = 'GuitarShell/test.json';
  sr.querySelector('#cloudBase').value = 'http://127.0.0.1:8123/';

  const realFetch = window.fetch;
  const slowFetch = (url, opt = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(new Response('', { status: (opt.method || 'GET').toUpperCase() === 'PUT' ? 201 : 404 }));
    }, 900);
    if (opt.signal) {
      opt.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });

  // 取消：请求挂起时点浮动胶囊的“取消”
  window.fetch = slowFetch;
  sr.querySelector('#cloudUpload').click(); await sleep(120);
  const cancelRect = sr.querySelector('#cloudTaskCancel').getBoundingClientRect();
  const cancelHit = sr.elementFromPoint(cancelRect.left + cancelRect.width / 2, cancelRect.top + cancelRect.height / 2);
  out.cancelStart = {
    busy: r.cloudBusy,
    task: sr.querySelector('#cloudTask').classList.contains('show'),
    cancelVisible: getComputedStyle(sr.querySelector('#cloudTaskCancel')).display !== 'none',
    cancelHit: cancelHit?.id === 'cloudTaskCancel',
    inViewport: cancelRect.left >= 0 && cancelRect.right <= innerWidth
  };
  sr.querySelector('#cloudTaskCancel').click(); await sleep(400);
  out.cancelEnd = {
    busy: r.cloudBusy,
    task: sr.querySelector('#cloudTask').classList.contains('show'),
    toast: sr.querySelector('#toast').textContent,
    uploadDisabled: sr.querySelector('#cloudUpload').disabled
  };

  // 失败：全部端点拒绝，出现失败胶囊与“重试”
  window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  sr.querySelector('#cloudUpload').click(); await sleep(350);
  const retryRect = sr.querySelector('#cloudTaskRetry').getBoundingClientRect();
  const retryHit = sr.elementFromPoint(retryRect.left + retryRect.width / 2, retryRect.top + retryRect.height / 2);
  out.fail = {
    busy: r.cloudBusy,
    failed: sr.querySelector('#cloudTask').classList.contains('failed'),
    text: sr.querySelector('#cloudTaskText').textContent,
    toast: sr.querySelector('#toast').textContent,
    retryVisible: getComputedStyle(sr.querySelector('#cloudTaskRetry')).display !== 'none',
    retryHit: retryHit?.id === 'cloudTaskRetry',
    inViewport: retryRect.left >= 0 && retryRect.right <= innerWidth
  };

  // 错误应保留在云同步弹窗状态行
  window.dispatchEvent(new CustomEvent('open-cloud-sync')); await sleep(180);
  out.fail.modalState = sr.querySelector('#cloudSyncState').textContent;
  sr.querySelector('#cloudCancel').click(); await sleep(80);
  sr.querySelector('#cloudPass').value = 'pass';

  // 重试：恢复成功响应后点“重试”
  window.fetch = (url, opt = {}) => Promise.resolve(
    new Response('', { status: (opt.method || 'GET').toUpperCase() === 'PUT' ? 201 : 404 })
  );
  sr.querySelector('#cloudTaskRetry').click(); await sleep(500);
  out.retry = {
    busy: r.cloudBusy,
    task: sr.querySelector('#cloudTask').classList.contains('show'),
    failed: sr.querySelector('#cloudTask').classList.contains('failed'),
    toast: sr.querySelector('#toast').textContent,
    uploadDisabled: sr.querySelector('#cloudUpload').disabled
  };

  window.fetch = realFetch;
  out.returnLabel = sr.querySelector('#cloudCancel').textContent.trim();
  return out;
})()
""")

        assert out["batchOpen"]["modal"] is True, out
        assert out["batchOpen"]["active"] is None, out
        assert out["batchOpen"]["inputFocused"] is False, out
        assert out["batchChip"]["value"] == "练习", out
        assert out["batchChip"]["active"] is None, out
        assert out["batchChip"]["inputFocused"] is False, out
        assert out["timeouts"] == {"upload": 60000, "download": 30000, "meta": 12000}, out
        assert out["cancelStart"]["busy"] is True, out
        assert out["cancelStart"]["cancelVisible"] is True, out
        assert out["cancelStart"]["cancelHit"] is True, out
        assert out["cancelStart"]["inViewport"] is True, out
        assert out["cancelEnd"]["busy"] is False, out
        assert out["cancelEnd"]["task"] is False, out
        assert out["cancelEnd"]["toast"] == "已取消云同步任务", out
        assert out["cancelEnd"]["uploadDisabled"] is False, out
        assert out["fail"]["failed"] is True, out
        assert out["fail"]["toast"] == "上传失败，可点状态条重试", out
        assert out["fail"]["retryVisible"] is True, out
        assert out["fail"]["retryHit"] is True, out
        assert out["fail"]["inViewport"] is True, out
        assert out["fail"]["modalState"] == out["fail"]["text"], out
        assert out["retry"]["task"] is False, out
        assert out["retry"]["failed"] is False, out
        assert out["retry"]["uploadDisabled"] is False, out
        assert out["returnLabel"] == "返回", out
        print(json.dumps(out, ensure_ascii=False, indent=2))
    finally:
        if cdp:
            cdp.close()
        try:
            proc.terminate()
        except Exception:
            pass
        if server:
            try:
                server.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    main()
