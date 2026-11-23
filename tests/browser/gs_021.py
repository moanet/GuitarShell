#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_021.py
# 0.1.11 浏览器回归：WebDAV 可恢复写入
#
# 依赖：
#   pip install websocket-client
#
# 用法（仓库根目录）：
#   python tests/browser/gs_021.py
#   GS_BASE_URL=http://127.0.0.1:8123/ python tests/browser/gs_021.py
#
# 直接调用 js/services/webdav.js，用 mock fetch 记录请求序列：
#   PUT 临时文件 → PROPFIND 校验 → DELETE 正式文件 → MOVE 临时文件
# 并覆盖大小校验失败、MOVE 被 CORS 拦截后的 PUT 回退、MOVE 409 回退、
# 回退 PUT 失败、下载回退临时文件、下载正式文件半截 JSON、首个端点 5xx 后锁端点。
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
PORT = int(os.environ.get("GS_CDP_PORT", "9356"))

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
    profile = tempfile.mkdtemp(prefix="gs-browser-021-")
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
  const wd = await import('/js/services/webdav.js');
  const svc = wd.webdavService;
  localStorage.setItem('gs_dav_base', 'http://mock.local/dav/');

  const pathInfo = (url) => {
    const u = new URL(url);
    return { path: u.pathname, origin: u.origin };
  };
  const xml = (size) => '<?xml version="1.0" encoding="UTF-8"?>' +
    '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/x</d:href>' +
    '<d:propstat><d:prop>' +
    `<d:getcontentlength>${size}</d:getcontentlength>` +
    '<d:getlastmodified>Mon, 23 Nov 2026 11:44:24 GMT</d:getlastmodified>' +
    '<d:getetag>"mock-etag"</d:getetag>' +
    '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';

  let mode = 'ok';
  let lastPutBody = '';
  let calls = [];
  const putBodies = new Map();
  window.fetch = async (url, opt = {}) => {
    const method = (opt.method || 'GET').toUpperCase();
    const info = pathInfo(url);
    calls.push({
      method,
      path: info.path,
      url,
      body: opt.body || '',
      destination: opt.headers?.Destination || '',
      overwrite: opt.headers?.Overwrite || ''
    });

    if (mode === 'endpoint-fallback' && info.origin === 'http://mock.local') {
      return new Response(null, { status: 503 });
    }
    if (mode === 'size-mismatch' && method === 'PROPFIND') {
      return new Response(xml(new Blob([lastPutBody]).size + 7), { status: 207 });
    }
    if ((mode === 'move-fallback' || mode === 'move-put-fail') && method === 'MOVE') {
      return new Response(null, { status: 409 });
    }
    if (mode === 'cors-move-fail' && method === 'MOVE') {
      throw new TypeError('Failed to fetch');
    }
    if (mode === 'move-put-fail' && method === 'PUT' && !info.path.endsWith('.uploading')) {
      return new Response(null, { status: 500 });
    }
    if (mode === 'download-temp' && method === 'GET' && info.path.endsWith('.uploading')) {
      return new Response('{"scores":[],"logs":[],"exportedAt":1}', { status: 200 });
    }
    if (mode === 'download-corrupt' && method === 'GET' && info.path.endsWith('.uploading')) {
      return new Response('{"scores":[],"logs":[],"exportedAt":2}', { status: 200 });
    }
    if (mode === 'download-corrupt' && method === 'GET' && !info.path.endsWith('.uploading')) {
      return new Response('{"scores":[', { status: 200 });
    }

    if (method === 'PUT') {
      lastPutBody = opt.body || '';
      putBodies.set(info.path, lastPutBody);
      return new Response('', { status: 201 });
    }
    if (method === 'PROPFIND') {
      const body = putBodies.get(info.path);
      const size = body !== undefined ? new Blob([body]).size : 123;
      return new Response(xml(size), { status: 207 });
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (method === 'MOVE') return new Response(null, { status: 201 });
    if (method === 'GET') return new Response(null, { status: 404 });
    return new Response(null, { status: 404 });
  };

  const payload = '{"scores":[],"logs":[],"exportedAt":1,"note":"中文"}';
  const expectedSize = new Blob([payload]).size;

  // 1. 正常上传：临时文件 → 校验 → 删正式文件 → MOVE
  mode = 'ok'; calls = [];
  out.normal = { label: await svc.upload('u', 'p', 'GuitarShell/test.json', payload) };
  out.normal.calls = calls.slice();
  out.normal.expectedSize = expectedSize;
  out.normal.tempPath = calls[0]?.path || '';
  out.normal.destination = calls[calls.length - 1]?.destination || '';
  out.normal.overwrite = calls[calls.length - 1]?.overwrite || '';

  // 2. 大小不一致：只删临时文件，不碰正式文件
  mode = 'size-mismatch'; calls = [];
  out.sizeMismatch = {};
  try {
    await svc.upload('u', 'p', 'GuitarShell/test.json', payload);
    out.sizeMismatch.error = '';
  } catch (err) {
    out.sizeMismatch.error = err.message;
  }
  out.sizeMismatch.calls = calls.map(c => ({ method: c.method, path: c.path }));

  // 3. MOVE 409：回退正式文件 PUT，校验后删除临时文件，上传成功
  mode = 'move-fallback'; calls = [];
  out.moveFallback = {};
  try {
    out.moveFallback.label = await svc.upload('u', 'p', 'GuitarShell/test.json', payload);
  } catch (err) {
    out.moveFallback.error = err.message;
  }
  out.moveFallback.calls = calls.map(c => ({ method: c.method, path: c.path }));

  // 4. MOVE 被 CORS 拦截（fetch TypeError）：同样回退正式文件 PUT
  mode = 'cors-move-fail'; calls = [];
  out.corsMoveFallback = {};
  try {
    out.corsMoveFallback.label = await svc.upload('u', 'p', 'GuitarShell/test.json', payload);
  } catch (err) {
    out.corsMoveFallback.error = err.message;
  }
  out.corsMoveFallback.calls = calls.map(c => ({ method: c.method, path: c.path }));

  // 5. MOVE 失败且回退 PUT 失败：保留临时文件并报错
  mode = 'move-put-fail'; calls = [];
  out.movePutFail = {};
  try {
    await svc.upload('u', 'p', 'GuitarShell/test.json', payload);
    out.movePutFail.error = '';
  } catch (err) {
    out.movePutFail.error = err.message;
  }
  out.movePutFail.calls = calls.map(c => ({ method: c.method, path: c.path }));

  // 6. 正式文件缺失时，下载回退读取临时文件
  mode = 'download-temp'; calls = [];
  out.downloadFallback = { text: await svc.download('u', 'p', 'GuitarShell/test.json') };
  out.downloadFallback.calls = calls.map(c => ({ method: c.method, path: c.path }));

  // 7. 正式文件存在但是半截 JSON：下载改用完整的临时文件
  mode = 'download-corrupt'; calls = [];
  out.downloadCorrupt = { text: await svc.download('u', 'p', 'GuitarShell/test.json') };
  out.downloadCorrupt.calls = calls.map(c => ({ method: c.method, path: c.path }));

  // 8. 正式文件和临时文件都没有：报“云端没有找到备份文件”
  mode = 'ok'; calls = [];
  out.downloadNone = {};
  try {
    await svc.download('u', 'p', 'GuitarShell/test.json');
    out.downloadNone.error = '';
  } catch (err) {
    out.downloadNone.error = err.message;
  }
  out.downloadNone.calls = calls.map(c => ({ method: c.method, path: c.path }));

  // 9. 首个自定义端点 5xx：自动换到本地端点，后续请求全部锁在本地端点
  mode = 'endpoint-fallback'; calls = [];
  out.fallback = { label: await svc.upload('u', 'p', 'GuitarShell/test.json', payload) };
  out.fallback.calls = calls.map(c => ({ method: c.method, origin: pathInfo(c.url).origin }));

  return out;
})()
""")

        normal_calls = out["normal"]["calls"]
        assert out["normal"]["label"] == "自定义端点", out
        assert [c["method"] for c in normal_calls] == ["PUT", "PROPFIND", "DELETE", "MOVE"], out
        assert out["normal"]["tempPath"].endswith("/GuitarShell/test.json.uploading"), out
        assert normal_calls[0]["path"].endswith("/GuitarShell/test.json.uploading"), out
        assert normal_calls[2]["path"].endswith("/GuitarShell/test.json"), out
        assert normal_calls[3]["path"].endswith("/GuitarShell/test.json.uploading"), out
        assert out["normal"]["destination"].endswith("/GuitarShell/test.json"), out
        assert out["normal"]["overwrite"] == "F", out

        assert "上传校验失败" in out["sizeMismatch"]["error"], out
        assert [c["method"] for c in out["sizeMismatch"]["calls"]] == ["PUT", "PROPFIND", "DELETE"], out
        assert out["sizeMismatch"]["calls"][-1]["path"].endswith(".uploading"), out

        assert out["moveFallback"].get("error") is None, out
        assert out["moveFallback"]["label"] == "自定义端点", out
        assert [c["method"] for c in out["moveFallback"]["calls"]] == [
            "PUT", "PROPFIND", "DELETE", "MOVE", "PUT", "PROPFIND", "DELETE"
        ], out
        assert out["moveFallback"]["calls"][4]["path"].endswith("/GuitarShell/test.json"), out
        assert out["moveFallback"]["calls"][6]["path"].endswith(".uploading"), out

        assert out["corsMoveFallback"].get("error") is None, out
        assert out["corsMoveFallback"]["label"] == "自定义端点", out
        assert [c["method"] for c in out["corsMoveFallback"]["calls"]] == [
            "PUT", "PROPFIND", "DELETE", "MOVE", "PUT", "PROPFIND", "DELETE"
        ], out

        assert "临时文件已保留" in out["movePutFail"]["error"], out
        assert [c["method"] for c in out["movePutFail"]["calls"]] == [
            "PUT", "PROPFIND", "DELETE", "MOVE", "PUT"
        ], out
        assert out["movePutFail"]["calls"][-1]["path"].endswith("/GuitarShell/test.json"), out

        assert out["downloadFallback"]["text"].startswith('{"scores"'), out
        assert [c["method"] for c in out["downloadFallback"]["calls"]] == ["GET", "GET"], out
        assert out["downloadFallback"]["calls"][1]["path"].endswith(".uploading"), out

        assert out["downloadCorrupt"]["text"].startswith('{"scores"'), out
        assert '"exportedAt":2' in out["downloadCorrupt"]["text"], out
        assert [c["method"] for c in out["downloadCorrupt"]["calls"]] == ["GET", "GET"], out
        assert out["downloadCorrupt"]["calls"][1]["path"].endswith(".uploading"), out

        assert out["downloadNone"]["error"] == "云端没有找到备份文件", out
        assert [c["method"] for c in out["downloadNone"]["calls"]] == ["GET", "GET"], out

        assert out["fallback"]["label"] == "本地代理", out
        assert out["fallback"]["calls"][0]["origin"] == "http://mock.local", out
        for c in out["fallback"]["calls"][1:]:
            assert c["origin"] == "http://192.168.0.200:8081", out

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
