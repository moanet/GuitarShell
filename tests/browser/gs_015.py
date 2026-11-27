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
    const q = indexedDB.open('GuitarShellDB');
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

  const settings = document.querySelector('guitar-settings');
  const st = settings.shadowRoot;
  settings.open(); await sleep(280);
  st.getElementById('btnToggleCloud').click(); await sleep(220);

  const fill = () => {
    st.getElementById('cloudAccount').value = 'test@example.com';
    st.getElementById('cloudSecret').value = 'pass';
    st.getElementById('cloudPath').value = 'GuitarShell/test.json';
    st.getElementById('cloudBase').value = 'http://127.0.0.1:8123/';
  };
  fill();
  out.form = {
    bodyOpen: !st.getElementById('cloudBody').hidden,
    fields: ['cloudAccount', 'cloudSecret', 'cloudPath', 'cloudBase'].every((id) => !!st.getElementById(id)),
    actions: ['btnCloudTest', 'btnCloudUpload', 'btnCloudDownload'].every((id) => !!st.getElementById(id)),
    actionLabels: [st.getElementById('btnCloudUpload').textContent.trim(), st.getElementById('btnCloudDownload').textContent.trim()],
    oldSettingsEntry: !st.getElementById('btnCloudEntry'),
    oldSheetModal: !sr.querySelector('#cloudModalMask'),
    oldSheetTask: !sr.querySelector('#cloudTask'),
    oldSheetFields: !sr.querySelector('#cloudUser')
  };

  const realFetch = window.fetch;
  const okStatus = (opt = {}) => {
    const method = (opt.method || 'GET').toUpperCase();
    if (method === 'PUT' || method === 'MOVE') return 201;
    if (method === 'PROPFIND') return 405;
    if (method === 'DELETE') return 404;
    return 404;
  };
  const slowFetch = (url, opt = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(new Response('', { status: okStatus(opt) }));
    }, 1500);
    if (opt.signal) {
      opt.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });
  const toastText = () => document.querySelector('.app-toast')?.textContent.trim() || '';
  const clearToast = () => document.querySelector('.app-toast')?.classList.remove('show');

  // 关闭抽屉不取消任务：挂起请求中关掉再打开，仍能看到进度和取消按钮
  window.fetch = slowFetch;
  clearToast();
  st.getElementById('btnCloudUpload').click(); await sleep(180);
  st.getElementById('cloudCancel').scrollIntoView({ block: 'center' }); await sleep(160);
  const cancelRect = st.getElementById('cloudCancel').getBoundingClientRect();
  const cancelHit = st.elementFromPoint(cancelRect.left + cancelRect.width / 2, cancelRect.top + cancelRect.height / 2);
  out.taskStart = {
    busy: settings.cloud.busy,
    cancelVisible: !st.getElementById('cloudCancel').hidden,
    cancelHit: cancelHit?.id === 'cloudCancel',
    inViewport: cancelRect.left >= 0 && cancelRect.right <= innerWidth && cancelRect.top >= 0 && cancelRect.bottom <= innerHeight,
    uploadDisabled: st.getElementById('btnCloudUpload').disabled,
    summary: st.getElementById('cloudStatusText').textContent.trim()
  };

  settings.close(); await sleep(180);
  out.closedTask = {
    drawerOpen: st.getElementById('mask').classList.contains('show'),
    busy: settings.cloud.busy,
    toast: toastText()
  };
  settings.open(); await sleep(280);
  st.getElementById('btnToggleCloud').click(); await sleep(180);
  fill();
  out.reopenTask = {
    busy: settings.cloud.busy,
    bodyOpen: !st.getElementById('cloudBody').hidden,
    cancelVisible: !st.getElementById('cloudCancel').hidden,
    summary: st.getElementById('cloudStatusText').textContent.trim(),
    state: st.getElementById('cloudSyncState').textContent.trim()
  };

  clearToast();
  st.getElementById('cloudCancel').click(); await sleep(700);
  out.cancelEnd = {
    busy: settings.cloud.busy,
    cancelHidden: st.getElementById('cloudCancel').hidden,
    uploadDisabled: st.getElementById('btnCloudUpload').disabled,
    toast: toastText()
  };

  // 失败：全部端点拒绝，摘要行、状态行与重试按钮同时保留错误
  fill();
  clearToast();
  window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  st.getElementById('btnCloudUpload').click(); await sleep(650);
  st.getElementById('cloudRetry').scrollIntoView({ block: 'center' }); await sleep(220);
  const retryRect = st.getElementById('cloudRetry').getBoundingClientRect();
  const retryHit = st.elementFromPoint(retryRect.left + retryRect.width / 2, retryRect.top + retryRect.height / 2);
  out.fail = {
    busy: settings.cloud.busy,
    failure: settings.cloud.failure?.text || '',
    summary: st.getElementById('cloudStatusText').textContent.trim(),
    detail: st.getElementById('cloudDetail').textContent.trim(),
    state: st.getElementById('cloudSyncState').textContent.trim(),
    toast: toastText(),
    retryVisible: !st.getElementById('cloudRetry').hidden,
    dismissVisible: !st.getElementById('cloudDismiss').hidden,
    cancelHidden: st.getElementById('cloudCancel').hidden,
    retryHit: retryHit?.id === 'cloudRetry',
    inViewport: retryRect.left >= 0 && retryRect.right <= innerWidth && retryRect.top >= 0 && retryRect.bottom <= innerHeight
  };

  // 重试：恢复成功响应后点“重试”，任务重新跑完并回到已同步
  window.fetch = (url, opt = {}) => Promise.resolve(
    new Response('', { status: okStatus(opt) })
  );
  clearToast();
  st.getElementById('cloudRetry').click();
  for (let i = 0; i < 30; i += 1) {
    if (!settings.cloud.busy) break;
    await sleep(200);
  }
  await sleep(350);
  out.retry = {
    busy: settings.cloud.busy,
    failure: settings.cloud.failure,
    summary: st.getElementById('cloudStatusText').textContent.trim(),
    retryHidden: st.getElementById('cloudRetry').hidden,
    dismissHidden: st.getElementById('cloudDismiss').hidden,
    uploadDisabled: st.getElementById('btnCloudUpload').disabled,
    toast: toastText()
  };

  // 下载空备份：必须走危险确认，确认后清空本机并回到已同步
  window.fetch = (url, opt = {}) => {
    const method = (opt.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return Promise.resolve(new Response(
        JSON.stringify({ scores: [], logs: [], exportedAt: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ));
    }
    return Promise.resolve(new Response('', { status: okStatus(opt) }));
  };
  fill();
  clearToast();
  st.getElementById('btnCloudDownload').click();
  let dlg = null;
  for (let i = 0; i < 25; i += 1) {
    dlg = document.querySelector('guitar-app-dialog');
    if (dlg) break;
    await sleep(120);
  }
  const dsr = dlg?.shadowRoot;
  out.emptyDialog = {
    open: !!dlg,
    title: dsr?.querySelector('#dlgTitle')?.textContent.trim() || '',
    message: dsr?.querySelector('#dlgMessage')?.textContent.trim() || '',
    confirmText: dsr?.querySelector('#dlgConfirm')?.textContent.trim() || '',
    danger: dsr?.querySelector('#dlgConfirm')?.className.includes('danger') || false,
    extraText: dsr?.querySelector('#dlgExtra')?.textContent.trim() || '',
    details: dsr ? Array.from(dsr.querySelectorAll('.detail-row')).map((row) => row.textContent.trim()) : []
  };
  dsr?.querySelector('#dlgConfirm')?.click();
  for (let i = 0; i < 30; i += 1) {
    if (!settings.cloud.busy) break;
    await sleep(200);
  }
  await sleep(300);
  for (let i = 0; i < 10; i += 1) {
    if (sr.querySelectorAll('.score-card').length === 0) break;
    await sleep(200);
  }
  const dbm = await import('/js/services/db.js');
  out.downloadEmpty = {
    busy: settings.cloud.busy,
    summary: st.getElementById('cloudStatusText').textContent.trim(),
    toast: toastText(),
    readerCards: sr.querySelectorAll('.score-card').length,
    scoreCount: (await dbm.dbService.getAllScores()).length
  };

  window.fetch = realFetch;
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
        assert out["form"]["bodyOpen"] is True, out
        assert out["form"]["fields"] is True, out
        assert out["form"]["actions"] is True, out
        assert out["form"]["actionLabels"] == ["上传备份", "覆盖本地"], out
        assert out["form"]["oldSettingsEntry"] is True, out
        assert out["form"]["oldSheetModal"] is True, out
        assert out["form"]["oldSheetTask"] is True, out
        assert out["form"]["oldSheetFields"] is True, out
        assert out["taskStart"]["busy"] is True, out
        assert out["taskStart"]["cancelVisible"] is True, out
        assert out["taskStart"]["cancelHit"] is True, out
        assert out["taskStart"]["inViewport"] is True, out
        assert out["taskStart"]["uploadDisabled"] is True, out
        assert "上传" in out["taskStart"]["summary"], out
        assert out["closedTask"]["drawerOpen"] is False, out
        assert out["closedTask"]["busy"] is True, out
        assert out["reopenTask"]["busy"] is True, out
        assert out["reopenTask"]["bodyOpen"] is True, out
        assert out["reopenTask"]["cancelVisible"] is True, out
        assert out["cancelEnd"]["busy"] is False, out
        assert out["cancelEnd"]["cancelHidden"] is True, out
        assert out["cancelEnd"]["uploadDisabled"] is False, out
        assert out["cancelEnd"]["toast"] == "已取消", out
        assert out["fail"]["busy"] is False, out
        assert out["fail"]["failure"] == "上传失败", out
        assert out["fail"]["summary"] == "上传失败", out
        assert out["fail"]["state"] == "上传失败", out
        assert out["fail"]["toast"] == "上传失败，可点重试", out
        assert out["fail"]["retryVisible"] is True, out
        assert out["fail"]["dismissVisible"] is True, out
        assert out["fail"]["cancelHidden"] is True, out
        assert out["fail"]["retryHit"] is True, out
        assert out["fail"]["inViewport"] is True, out
        assert out["retry"]["busy"] is False, out
        assert out["retry"]["failure"] is None, out
        assert out["retry"]["summary"] == "已同步", out
        assert out["retry"]["retryHidden"] is True, out
        assert out["retry"]["dismissHidden"] is True, out
        assert out["retry"]["uploadDisabled"] is False, out
        assert out["retry"]["toast"] == "已上传到云端", out
        assert out["emptyDialog"]["open"] is True, out
        assert out["emptyDialog"]["title"] == "云端备份是空的", out
        assert "无法撤销" in out["emptyDialog"]["message"], out
        assert out["emptyDialog"]["confirmText"] == "覆盖本机", out
        assert out["emptyDialog"]["danger"] is True, out
        assert out["emptyDialog"]["extraText"] == "先导出本地备份", out
        assert len(out["emptyDialog"]["details"]) == 3, out
        assert out["downloadEmpty"]["busy"] is False, out
        assert out["downloadEmpty"]["toast"] == "已从云端恢复 0 份乐谱、0 条练习", out
        assert out["downloadEmpty"]["scoreCount"] == 0, out
        assert out["downloadEmpty"]["readerCards"] == 0, out
        assert out["downloadEmpty"]["summary"] == "已同步", out
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
