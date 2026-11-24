#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_016.py
# 0.1.6 浏览器回归：PDF 页段拆分建卡
#
# 依赖：
#   pip install websocket-client
#
# 用法（仓库根目录）：
#   python tests/browser/gs_016.py
#   GS_BROWSER="C:\...\msedge.exe" python tests/browser/gs_016.py
#   GS_BASE_URL=http://127.0.0.1:8123/ python tests/browser/gs_016.py
#   GS_WIDTH=360 python tests/browser/gs_016.py
#
# 脚本会自动探测 Edge / Chrome；本地静态服务没起时会自动拉起并清理。
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
PORT = int(os.environ.get("GS_CDP_PORT", "9352"))
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
    profile = tempfile.mkdtemp(prefix="gs-browser-016-")
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

        out1 = cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  const b64 = __PDF_B64__;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pdfBlob = new Blob([bytes], { type: 'application/pdf' });

  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('GuitarShellDB');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('scores', 'readwrite');
    const s = tx.objectStore('scores');
    s.clear();
    s.add({ name: '三页测试.pdf', createdAt: Date.now(), updatedAt: Date.now(),
      tags: ['练习', '待练'], fileBlob: pdfBlob, fileHash: 'split-fixture' });
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

  const viewer = sr.querySelector('#viewer');
  const box2 = sr.querySelector('.page-box[data-page="2"]');
  const top = box2.getBoundingClientRect().top - viewer.getBoundingClientRect().top + viewer.scrollTop;
  viewer.scrollTop = top + box2.offsetHeight * 0.5 - viewer.clientHeight * 0.5;
  await sleep(160);

  const btnSplit = sr.querySelector('#btnSplit');
  const btnRect = btnSplit.getBoundingClientRect();
  const btnHit = sr.elementFromPoint(btnRect.left + btnRect.width / 2, btnRect.top + btnRect.height / 2);
  out.pdfReady = r.pdfDoc ? r.pdfDoc.numPages : 0;
  out.toolbar = {
    visible: getComputedStyle(btnSplit).display !== 'none',
    hit: btnHit?.id === 'btnSplit',
    inViewport: btnRect.left >= 0 && btnRect.right <= innerWidth
  };

  btnSplit.click(); await sleep(120);
  const box = sr.querySelector('.split-box');
  const boxRect = box.getBoundingClientRect();
  const confirmRect = sr.querySelector('#splitConfirm').getBoundingClientRect();
  const confirmHit = sr.elementFromPoint(confirmRect.left + confirmRect.width / 2, confirmRect.top + confirmRect.height / 2);
  out.open = {
    modal: sr.querySelector('#splitModalMask').classList.contains('show'),
    start: sr.querySelector('#splitStart').value,
    end: sr.querySelector('#splitEnd').value,
    max: sr.querySelector('#splitStart').getAttribute('max'),
    hint: sr.querySelector('#splitRangeHint').textContent,
    error: sr.querySelector('#splitRangeHint').classList.contains('error'),
    confirmDisabled: sr.querySelector('#splitConfirm').disabled,
    confirmHit: confirmHit?.id === 'splitConfirm',
    boxWidth: boxRect.width,
    boxRight: boxRect.right,
    boxOverflow: box.scrollWidth > box.clientWidth,
    inputFocused: sr.activeElement?.id === 'splitStart'
  };

  await sleep(650);
  const sc = sr.querySelector('#splitStartCanvas');
  const ec = sr.querySelector('#splitEndCanvas');
  const previewStart = sr.querySelector('#splitPreviewStart').getBoundingClientRect();
  const previewEnd = sr.querySelector('#splitPreviewEnd').getBoundingClientRect();
  out.preview = {
    startPage: sr.querySelector('#splitPreviewStartPage').textContent,
    endPage: sr.querySelector('#splitPreviewEndPage').textContent,
    startRendered: !sc.hidden && sc.width > 0 && sc.height > 0,
    endRendered: !ec.hidden && ec.width > 0 && ec.height > 0,
    startEmptyDisplay: getComputedStyle(sr.querySelector('#splitStartEmpty')).display,
    endEmptyDisplay: getComputedStyle(sr.querySelector('#splitEndEmpty')).display,
    startSize: { w: Math.round(previewStart.width), h: Math.round(previewStart.height) },
    endSize: { w: Math.round(previewEnd.width), h: Math.round(previewEnd.height) },
    inViewport: previewStart.left >= 0 && previewEnd.right <= innerWidth
  };

  sr.querySelector('#splitPreviewStart').click(); await sleep(90);
  out.picker = {
    open: sr.querySelector('#splitPickerMask').classList.contains('show'),
    title: sr.querySelector('#splitPickerTitle').textContent,
    current: sr.querySelector('#splitPickerCurrent').textContent,
    count: sr.querySelectorAll('#splitPickerGrid .split-page-btn').length,
    selected: sr.querySelector('#splitPickerGrid .split-page-btn.selected')?.textContent || '',
    gridOverflow: (() => {
      const g = sr.querySelector('#splitPickerGrid');
      return g.scrollWidth > g.clientWidth;
    })()
  };
  sr.querySelector('#splitPickerCancel').click(); await sleep(70);
  out.picker.closed = !sr.querySelector('#splitPickerMask').classList.contains('show');
  return out;
})()
""".replace("__PDF_B64__", pdf_b64))

        assert out1["pdfReady"] == 3, out1
        assert out1["toolbar"]["visible"] is True, out1
        assert out1["toolbar"]["hit"] is True, out1
        assert out1["toolbar"]["inViewport"] is True, out1
        assert out1["open"]["modal"] is True, out1
        assert out1["open"]["start"] == "2", out1
        assert out1["open"]["end"] == "2", out1
        assert out1["open"]["max"] == "3", out1
        assert "第 2–2 页" in out1["open"]["hint"], out1
        assert out1["open"]["error"] is False, out1
        assert out1["open"]["confirmDisabled"] is False, out1
        assert out1["open"]["confirmHit"] is True, out1
        assert out1["open"]["boxWidth"] <= WIDTH, out1
        assert out1["open"]["boxRight"] <= WIDTH, out1
        assert out1["open"]["boxOverflow"] is False, out1
        assert out1["open"]["inputFocused"] is False, out1
        assert out1["preview"]["startPage"] == "P2", out1
        assert out1["preview"]["endPage"] == "P2", out1
        assert out1["preview"]["startRendered"] is True, out1
        assert out1["preview"]["endRendered"] is True, out1
        assert out1["preview"]["startEmptyDisplay"] == "none", out1
        assert out1["preview"]["endEmptyDisplay"] == "none", out1
        assert out1["preview"]["inViewport"] is True, out1
        assert out1["picker"]["open"] is True, out1
        assert out1["picker"]["title"] == "选择起始页", out1
        assert "P2" in out1["picker"]["current"], out1
        assert out1["picker"]["count"] == 3, out1
        assert out1["picker"]["selected"] == "2", out1
        assert out1["picker"]["gridOverflow"] is False, out1
        assert out1["picker"]["closed"] is True, out1

        shot = cdp.cmd("Page.captureScreenshot", {"format": "png"})
        shot_path = Path(os.environ.get("TEMP", r"C:\Users\Mao\AppData\Local\Temp")) / f"gs_016_{WIDTH}_split.png"
        shot_path.write_bytes(base64.b64decode(shot["result"]["data"]))

        cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const sr = document.querySelector('guitar-sheet-reader').shadowRoot;
  sr.querySelector('#splitPreviewStart').click();
  await sleep(160);
})()
""")
        picker_shot = cdp.cmd("Page.captureScreenshot", {"format": "png"})
        picker_path = Path(os.environ.get("TEMP", r"C:\Users\Mao\AppData\Local\Temp")) / f"gs_016_{WIDTH}_picker.png"
        picker_path.write_bytes(base64.b64decode(picker_shot["result"]["data"]))
        cdp.ev("document.querySelector('guitar-sheet-reader').shadowRoot.querySelector('#splitPickerCancel').click()")

        out2 = cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  const r = document.querySelector('guitar-sheet-reader');
  const sr = r.shadowRoot;
  const setRange = async (start, end) => {
    const a = sr.querySelector('#splitStart');
    const b = sr.querySelector('#splitEnd');
    a.value = String(start); a.dispatchEvent(new Event('input', { bubbles: true }));
    b.value = String(end); b.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(60);
  };
  const rangeState = () => ({
    disabled: sr.querySelector('#splitConfirm').disabled,
    error: sr.querySelector('#splitRangeHint').classList.contains('error'),
    hint: sr.querySelector('#splitRangeHint').textContent,
    start: sr.querySelector('#splitStart').value,
    end: sr.querySelector('#splitEnd').value
  });

  await setRange(0, 2); out.zero = rangeState();
  await setRange(2, 4); out.over = rangeState();
  await setRange(3, 2); out.reverse = rangeState();
  sr.querySelector('#splitPreviewStart').click(); await sleep(80);
  sr.querySelector('#splitPickerGrid .split-page-btn[data-page="3"]').click(); await sleep(80);
  out.pickStart = rangeState();
  sr.querySelector('#splitPreviewEnd').click(); await sleep(80);
  sr.querySelector('#splitPickerGrid .split-page-btn[data-page="1"]').click(); await sleep(80);
  out.pickEnd = rangeState();
  await setRange(2, 3);
  out.valid = {
    ...rangeState(),
    name: sr.querySelector('#splitName').value,
    hint: sr.querySelector('#splitRangeHint').textContent
  };
  sr.querySelector('#splitConfirm').click();

  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('GuitarShellDB');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  const getAll = () => new Promise((res, rej) => {
    const tx = db.transaction('scores', 'readonly');
    const req = tx.objectStore('scores').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  for (let i = 0; i < 80; i++) {
    const rows = await getAll();
    if (rows.length === 2) break;
    await sleep(100);
  }
  const rows = await getAll();
  const original = rows.find((x) => x.name === '三页测试.pdf');
  const split = rows.find((x) => x.name === '三页测试 · P2-3.pdf');
  out.created = {
    count: rows.length,
    names: rows.map((x) => x.name),
    toast: sr.querySelector('#toast').textContent,
    modalClosed: !sr.querySelector('#splitModalMask').classList.contains('show'),
    confirmDisabled: sr.querySelector('#splitConfirm').disabled,
    loading: sr.querySelector('#loading')?.classList.contains('show'),
    hint: sr.querySelector('#splitRangeHint').textContent
  };
  const dlg = document.querySelector('guitar-dialog');
  if (dlg && dlg.shadowRoot) {
    const m = dlg.shadowRoot.querySelector('.mask');
    out.created.dialog = {
      open: m?.classList.contains('show'),
      title: dlg.shadowRoot.querySelector('#dlgTitle')?.textContent,
      message: dlg.shadowRoot.querySelector('#dlgMessage')?.textContent
    };
  }
  if (!original || !split) return out;
  const { PDFDocument } = await import('/js/lib/pdf-lib.esm.min.js');
  const originalDoc = await PDFDocument.load(await original.fileBlob.arrayBuffer());
  const splitDoc = await PDFDocument.load(await split.fileBlob.arrayBuffer());

  out.created.pages = { original: originalDoc.getPageCount(), split: splitDoc.getPageCount() };
  out.created.originalTags = original.tags;
  out.created.splitTags = split.tags;
  out.created.splitHashLength = (split.fileHash || '').length;

  sr.querySelector('#btnBack').click();
  for (let i = 0; i < 40; i++) {
    if (sr.querySelector('#shelfView').style.display !== 'none') break;
    await sleep(100);
  }
  const cards = Array.from(sr.querySelectorAll('.score-card'));
  const newCard = cards.find((c) => c.querySelector('.score-name').textContent === '三页测试 · P2-3.pdf');
  newCard.click();
  for (let i = 0; i < 60; i++) {
    if (r.pdfDoc && r.pdfDoc.numPages === 2) break;
    await sleep(100);
  }
  out.reopen = {
    opened: r.pdfDoc ? r.pdfDoc.numPages : 0,
    splitVisible: getComputedStyle(sr.querySelector('#btnSplit')).display !== 'none',
    currentName: r.currentFileName
  };

  sr.querySelector('#btnBookmarks').click(); await sleep(80);
  sr.querySelector('#bmAdd').click(); await sleep(150);
  sr.querySelector('#bmClose').click();
  out.bookmark = { count: r.bookmarks.length };

  const viewer = sr.querySelector('#viewer');
  const page2 = sr.querySelector('.page-box[data-page="2"]');
  const p2top = page2.getBoundingClientRect().top - viewer.getBoundingClientRect().top + viewer.scrollTop;
  viewer.scrollTop = p2top + page2.offsetHeight * 0.5 - viewer.clientHeight * 0.5;
  await sleep(150);
  sr.querySelector('#btnSavePos').click(); await sleep(250);
  const saved = (await getAll()).find((x) => x.name === '三页测试 · P2-3.pdf');
  out.progress = { page: saved.lastReadPage, toast: sr.querySelector('#toast').textContent };

  sr.querySelector('#btnSplit').click(); await sleep(120);
  const rsStart = sr.querySelector('#splitStart');
  const rsEnd = sr.querySelector('#splitEnd');
  out.resplit = { max: rsEnd.max, start: rsStart.value, end: rsEnd.value };
  rsStart.value = '1'; rsStart.dispatchEvent(new Event('input', { bubbles: true }));
  rsEnd.value = '1'; rsEnd.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(80);
  out.resplit.name = sr.querySelector('#splitName').value;
  sr.querySelector('#splitConfirm').click();
  for (let i = 0; i < 80; i++) {
    if ((await getAll()).length === 3) break;
    await sleep(100);
  }
  const rsRows = await getAll();
  const rsCard = rsRows.find((x) => x.name === '三页测试 · P2-3 · P1.pdf');
  out.resplit.count = rsRows.length;
  out.resplit.createdName = rsCard ? rsCard.name : '';
  if (rsCard) {
    const rsDoc = await PDFDocument.load(await rsCard.fileBlob.arrayBuffer());
    out.resplit.pageCount = rsDoc.getPageCount();
  }

  sr.querySelector('#btnBack').click();
  for (let i = 0; i < 40; i++) {
    if (sr.querySelector('#shelfView').style.display !== 'none') break;
    await sleep(100);
  }
  await new Promise((res, rej) => {
    const tx = db.transaction('scores', 'readwrite');
    tx.objectStore('scores').add({
      name: '图片测试.png', createdAt: Date.now(), updatedAt: Date.now(),
      tags: [], fileBlob: new Blob(['x'], { type: 'image/png' }), fileHash: 'image-fixture'
    });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  await r.loadShelf(); await sleep(100);
  const imgCard = Array.from(sr.querySelectorAll('.score-card'))
    .find((c) => c.querySelector('.score-name').textContent === '图片测试.png');
  imgCard.click(); await sleep(250);
  out.image = {
    splitDisplay: getComputedStyle(sr.querySelector('#btnSplit')).display,
    currentName: r.currentFileName
  };

  let badError = '';
  try {
    const mod = await import('/js/services/pdf-split.js');
    await mod.splitPdfPages(new Blob(['not a pdf'], { type: 'application/pdf' }), 1, 1);
  } catch (err) {
    badError = err.message || String(err);
  }
  out.badPdf = { error: badError };
  out.finalCount = (await getAll()).length;
  return out;
})()
""")

        if out2["created"]["count"] != 2:
            print(json.dumps(out2, ensure_ascii=False, indent=2))
            raise AssertionError("拆分建卡未写入，查看 created 调试信息")

        assert out2["zero"]["disabled"] is True, out2
        assert out2["zero"]["error"] is True, out2
        assert "起始页必须是" in out2["zero"]["hint"], out2
        assert out2["over"]["disabled"] is True, out2
        assert out2["over"]["error"] is True, out2
        assert "结束页必须是" in out2["over"]["hint"], out2
        assert out2["reverse"]["disabled"] is False, out2
        assert out2["reverse"]["error"] is False, out2
        assert out2["reverse"]["start"] == "2", out2
        assert out2["reverse"]["end"] == "2", out2
        assert "第 2–2 页" in out2["reverse"]["hint"], out2
        assert out2["pickStart"]["start"] == "3", out2
        assert out2["pickStart"]["end"] == "3", out2
        assert out2["pickEnd"]["start"] == "1", out2
        assert out2["pickEnd"]["end"] == "1", out2
        assert out2["valid"]["disabled"] is False, out2
        assert out2["valid"]["error"] is False, out2
        assert out2["valid"]["name"] == "三页测试 · P2-3", out2
        assert "共 2 页" in out2["valid"]["hint"], out2

        assert out2["created"]["pages"]["original"] == 3, out2
        assert out2["created"]["pages"]["split"] == 2, out2
        assert out2["created"]["originalTags"] == ["练习", "待练"], out2
        assert out2["created"]["splitTags"] == ["练习", "待练"], out2
        assert out2["created"]["splitHashLength"] == 71, out2
        assert "已建卡" in out2["created"]["toast"], out2
        assert "2 页" in out2["created"]["toast"], out2
        assert out2["created"]["modalClosed"] is True, out2

        assert out2["reopen"]["opened"] == 2, out2
        assert out2["reopen"]["splitVisible"] is True, out2
        assert out2["reopen"]["currentName"] == "三页测试 · P2-3", out2
        assert out2["bookmark"]["count"] == 1, out2
        assert out2["progress"]["page"] == 2, out2
        assert "已保存" in out2["progress"]["toast"], out2
        assert out2["resplit"]["max"] == "2", out2
        assert out2["resplit"]["start"] == "2", out2
        assert out2["resplit"]["name"] == "三页测试 · P2-3 · P1", out2
        assert out2["resplit"]["count"] == 3, out2
        assert out2["resplit"]["createdName"] == "三页测试 · P2-3 · P1.pdf", out2
        assert out2["resplit"]["pageCount"] == 1, out2
        assert out2["image"]["splitDisplay"] == "none", out2
        assert out2["image"]["currentName"] == "图片测试", out2
        assert out2["badPdf"]["error"] != "", out2
        assert out2["finalCount"] == 4, out2

        print(json.dumps({"open": out1, "flow": out2, "screenshot": str(shot_path), "pickerScreenshot": str(picker_path)}, ensure_ascii=False, indent=2))
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
