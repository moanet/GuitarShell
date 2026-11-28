#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_029.py
# 0.1.28 阅读器外壳回归：五段工具栏、浮动工具组、进度条与触控热区
#
# 用法（仓库根目录）：
#   python tests/browser/gs_029.py
#   GS_WIDTH=320 python tests/browser/gs_029.py
#   GS_THEME=light python tests/browser/gs_029.py
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
PORT = int(os.environ.get("GS_CDP_PORT", "9398"))
WIDTH = int(os.environ.get("GS_WIDTH", "360"))
HEIGHT = int(os.environ.get("GS_HEIGHT", "800"))
THEME = os.environ.get("GS_THEME", "deep").lower()
if THEME not in ("deep", "light"):
    THEME = "deep"

BROWSERS = [
    os.environ.get("GS_BROWSER", ""),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
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
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
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
            "expression": expression, "returnByValue": True, "awaitPromise": True,
        })["result"]
        if res.get("exceptionDetails"):
            raise RuntimeError(json.dumps(res["exceptionDetails"], ensure_ascii=False))
        return res.get("result", {}).get("value")

    def shot(self, name):
        data = self.cmd("Page.captureScreenshot", {"format": "png"}).get("result", {}).get("data")
        if not data:
            return None
        path = Path(tempfile.gettempdir()) / f"gs_029_{WIDTH}_{THEME}_{name}.png"
        path.write_bytes(base64.b64decode(data))
        return str(path)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


TEST = r"""
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const checks = [];
  const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail });
  try {
    const db = await import('/js/services/db.js');
    await db.dbService.clearAllData();
    const reader = document.querySelector('guitar-sheet-reader');
    if (!reader?.shadowRoot) throw new Error('乐谱组件未就绪');
    document.querySelector('.tab-btn[data-target="view-reader"]').click();
    await sleep(250);
    const r = reader.shadowRoot;
    const $ = (id) => r.getElementById(id);
    const lines = Array.from({ length: 36 }, (_, i) => `第 ${i + 1} 行：这是一段用于阅读页外壳检查的歌词。`).join('\n');
    const txt = new File([
      '{title: 外壳检查}\n{artist: 本地}\n[主歌]\n[C]一闪一闪亮晶晶 [Am]满天都是小星星\n' + lines
    ], '外壳检查.txt', { type: 'text/plain' });
    $('inputSingleFile').onchange({ target: { id: 'inputSingleFile', files: [txt], value: '' } });
    for (let i = 0; i < 80; i++) {
      if (Array.from(r.querySelectorAll('.score-name')).some((el) => el.textContent === '外壳检查.txt')) break;
      await sleep(100);
    }
    const card = Array.from(r.querySelectorAll('.score-card')).find((el) => el.querySelector('.score-name')?.textContent === '外壳检查.txt');
    card.click();
    for (let i = 0; i < 80; i++) {
      if ($('contentContainer').querySelector('.text-sheet')) break;
      await sleep(100);
    }
    await sleep(400);

    const cs = (el, pseudo = null) => getComputedStyle(el, pseudo);
    const rect = (el) => el.getBoundingClientRect();
    const toolbar = $('readerToolbar');
    const toolButtons = Array.from(toolbar.querySelectorAll('.tool-btn')).filter((el) => cs(el).display !== 'none');
    const toolRects = toolButtons.map(rect);
    const toolbarRect = rect(toolbar);
    const viewerTop = rect($('viewer')).top;
    const zoomButtons = Array.from(r.querySelectorAll('.zoom-btn')).map(rect);
    const miniBtn = $('mmPlay');
    const mmStep = $('mmPlus');
    const pbClose = $('pbClose');

    check('进入阅读态', reader.classList.contains('reading') && cs(toolbar).display === 'flex', reader.className);
    check('工具栏总高 46–48', toolbarRect.height >= 46 && toolbarRect.height <= 48, toolbarRect.height.toFixed(1));
    check('工具栏内边距 12', cs(toolbar).paddingLeft === '12px' && cs(toolbar).paddingRight === '12px', `${cs(toolbar).paddingLeft}/${cs(toolbar).paddingRight}`);
    check('工具栏与内容无缝衔接', Math.abs(viewerTop - toolbarRect.bottom) <= 1, `${viewerTop.toFixed(1)}/${toolbarRect.bottom.toFixed(1)}`);
    check('工具栏按钮 46/12', toolRects.length >= 3 && toolRects.every((box) => Math.abs(box.height - 46) <= 1) && toolButtons.every((el) => cs(el).borderRadius === '12px'), toolRects.map((box) => box.height.toFixed(1)).join(','));
    check('工具栏按钮等分且不溢出', toolButtons.every((el, i) => Math.abs(toolRects[i].width - toolRects[0].width) <= 1) && toolbar.scrollWidth <= toolbar.clientWidth + 1, `${toolRects.map((box) => box.width.toFixed(1)).join(',')} / ${toolbar.scrollWidth}/${toolbar.clientWidth}`);
    check('工具栏图标 18 / 标签 11', toolButtons.every((el) => {
      const svg = el.querySelector('.ti svg');
      return svg && Math.abs(rect(svg).width - 18) <= 1 && cs(el.querySelector('.tl')).fontSize === '11px';
    }), toolButtons.map((el) => `${rect(el.querySelector('.ti svg')).width}/${cs(el.querySelector('.tl')).fontSize}`).join(','));
    check('工具栏无字距', toolButtons.every((el) => cs(el.querySelector('.tl')).letterSpacing === 'normal' || cs(el.querySelector('.tl')).letterSpacing === '0px'), toolButtons.map((el) => cs(el.querySelector('.tl')).letterSpacing).join(','));
    check('翻页热区在工具栏下方', rect($('navPrev')).top >= toolbarRect.bottom - 1, `${rect($('navPrev')).top.toFixed(1)}/${toolbarRect.bottom.toFixed(1)}`);
    check('缩放 / 全屏 / 禅定均 44', zoomButtons.length === 4 && zoomButtons.every((box) => Math.abs(box.width - 44) <= 1 && Math.abs(box.height - 44) <= 1), zoomButtons.map((box) => `${box.width.toFixed(0)}×${box.height.toFixed(0)}`).join(','));
    check('迷你节拍器播放按钮 36 视觉 / 44 热区', parseFloat(cs(miniBtn).width) === 36 && cs(miniBtn, '::after').content !== 'none', `${cs(miniBtn).width}/${cs(miniBtn, '::after').content}`);
    check('迷你节拍器步进 32 视觉 / 44 热区', parseFloat(cs(mmStep).width) === 32 && cs(mmStep, '::after').content !== 'none', `${cs(mmStep).width}/${cs(mmStep, '::after').content}`);
    check('进度条关闭 22 视觉 / 44 热区', parseFloat(cs(pbClose).width) === 22 && cs(pbClose, '::after').content !== 'none', `${cs(pbClose).width}/${cs(pbClose, '::after').content}`);
    check('阅读器 Toast 14 圆角', cs($('toast')).borderRadius === '14px', cs($('toast')).borderRadius);
    check('阅读页无横向溢出', document.documentElement.scrollWidth <= innerWidth + 1, `${document.documentElement.scrollWidth}/${innerWidth}`);
    check('运行期无异常', !window.__gsErrs029.length, JSON.stringify(window.__gsErrs029));
    return { checks, errors: window.__gsErrs029, meta: { width: innerWidth, theme: document.documentElement.dataset.theme } };
  } catch (err) {
    checks.push({ name: '测试脚本完成', pass: false, detail: String(err && err.stack || err) });
    return { checks, errors: [String(err && err.stack || err)], meta: { width: innerWidth } };
  }
})()
"""


def main():
    server = start_server()
    browser = pick_browser()
    profile = tempfile.mkdtemp(prefix="gs-browser-029-")
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
            "width": WIDTH, "height": HEIGHT, "deviceScaleFactor": 1, "mobile": True,
        })
        for _ in range(80):
            if cdp.ev("!!document.querySelector('guitar-sheet-reader')?.shadowRoot"):
                break
            time.sleep(0.25)
        cdp.ev(f"document.documentElement.dataset.theme = '{THEME}'; true")
        time.sleep(0.3)

        cdp.ev("""
window.__gsErrs029 = [];
window.addEventListener('error', e => window.__gsErrs029.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', e => window.__gsErrs029.push(String(e.reason && e.reason.stack || e.reason)));
""")
        out = cdp.ev(TEST)

        failed = 0
        for c in out["checks"]:
            print(("[PASS] " if c["pass"] else "[FAIL] ") + c["name"] + (f" — {c['detail']}" if c.get("detail") != "" else ""))
            if not c["pass"]:
                failed += 1

        print("截图：")
        cdp.ev(f"document.documentElement.dataset.theme = '{THEME}'; document.querySelector('guitar-sheet-reader').shadowRoot.getElementById('toast').classList.remove('show'); true")
        time.sleep(0.25)
        print(" ", cdp.shot("reader"))

        print("")
        print(f"宽度 {WIDTH} / {THEME}：{'通过' if not failed else '失败 ' + str(failed)}")
        if out["errors"]:
            print("运行期异常：", json.dumps(out["errors"], ensure_ascii=False))
        if failed or out["errors"]:
            sys.exit(1)
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        if server:
            server.terminate()


if __name__ == "__main__":
    main()
