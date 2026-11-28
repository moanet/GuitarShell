#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_030.py
# 0.1.28 全局外壳回归：品牌行、版本胶囊、设置入口、Tab 与设置抽屉
#
# 用法（仓库根目录）：
#   python tests/browser/gs_030.py
#   GS_WIDTH=320 python tests/browser/gs_030.py
#   GS_THEME=light python tests/browser/gs_030.py
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
PORT = int(os.environ.get("GS_CDP_PORT", "9410"))
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
        path = Path(tempfile.gettempdir()) / f"gs_030_{WIDTH}_{THEME}_{name}.png"
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
  await sleep(600);
  const checks = [];
  const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail });
  try {
    const header = document.querySelector('.app-header');
    const brand = document.querySelector('.brand');
    const brandIcon = document.querySelector('.brand-icon');
    const version = document.getElementById('appVersion');
    const settingsBtn = document.getElementById('btnGlobalSettings');
    const tabs = Array.from(document.querySelectorAll('.tab-btn'));
    const cs = (el, pseudo = null) => getComputedStyle(el, pseudo);
    const rect = (el) => el.getBoundingClientRect();
    const hit = (el, dx = 0, dy = 0) => {
      const box = rect(el);
      const node = document.elementFromPoint(box.left + box.width / 2 + dx, box.top + box.height / 2 + dy);
      return node === el || el.contains(node);
    };

    check('品牌名 18 / 图标 26', cs(brand).fontSize === '18px' && Math.abs(rect(brandIcon).width - 26) <= 1, `${cs(brand).fontSize}/${rect(brandIcon).width.toFixed(1)}`);
    check('头部两行且总高保持 91', Math.abs(rect(header).height - 91.2) <= 1.2 && rect(tabs[0]).top > rect(brand).bottom, `${rect(header).height.toFixed(1)}/${rect(brand).height.toFixed(1)}`);
    check('版本胶囊视觉 23–25', rect(version).height >= 23 && rect(version).height <= 25 && cs(version).fontSize === '11px', `${rect(version).width.toFixed(1)}×${rect(version).height.toFixed(1)} / ${cs(version).fontSize}`);
    check('版本胶囊热区 44', cs(version, '::after').content !== 'none' && hit(version, 0, -8), `${cs(version, '::after').content}`);
    check('设置按钮视觉 27 / 热区 44', Math.abs(rect(settingsBtn).width - 27) <= 1 && Math.abs(rect(settingsBtn).height - 27) <= 1 && cs(settingsBtn, '::after').content !== 'none' && hit(settingsBtn, 0, -6), `${rect(settingsBtn).width.toFixed(1)}/${cs(settingsBtn, '::after').content}`);
    check('Tab 16 / 可见 37 / 热区 44', tabs.length === 4 && tabs.every((el) => cs(el).fontSize === '16px' && Math.abs(rect(el).height - 37) <= 2 && cs(el, '::after').content !== 'none' && hit(el, 0, rect(el).height / 2 + 2)), tabs.map((el) => `${cs(el).fontSize}/${rect(el).height.toFixed(1)}`).join(','));
    check('320 下 Tab 单行不溢出', tabs.every((el) => el.scrollWidth <= el.clientWidth + 1) && document.documentElement.scrollWidth <= innerWidth + 1, `${document.documentElement.scrollWidth}/${innerWidth}`);
    check('Tab 文案固定', tabs.map((el) => el.textContent.trim()).join('/') === '乐谱/节拍器/调音器/记录', tabs.map((el) => el.textContent.trim()).join('/'));
    const toastSvc = await import('/js/services/toast.js');
    toastSvc.showToast('外壳检查');
    await sleep(80);
    const appToast = document.querySelector('.app-toast');
    check('全局 Toast 14 / 14', appToast && cs(appToast).fontSize === '14px' && cs(appToast).borderRadius === '14px', appToast ? `${cs(appToast).fontSize}/${cs(appToast).borderRadius}` : 'none');
    appToast?.classList.remove('show');

    settingsBtn.click();
    await sleep(450);
    const settings = document.querySelector('guitar-settings');
    const sr = settings?.shadowRoot;
    if (!sr) throw new Error('全局设置未就绪');
    const drawer = sr.getElementById('drawer');
    const close = sr.querySelector('.close');
    const h2 = sr.querySelector('h2');
    const body = sr.querySelector('.body');
    check('设置抽屉宽度与无圆角', rect(drawer).width <= 360 && cs(drawer).borderTopLeftRadius === '0px', `${rect(drawer).width.toFixed(1)}/${cs(drawer).borderTopLeftRadius}`);
    check('抽屉标题 20', cs(h2).fontSize === '20px', cs(h2).fontSize);
    check('抽屉关闭视觉 32 / 热区 44', Math.abs(rect(close).width - 32) <= 1 && cs(close, '::after').content !== 'none' && cs(close, '::after').inset === '-6px', `${rect(close).width.toFixed(1)}/${cs(close, '::after').inset}`);
    const fold = sr.querySelector('.fold-head');
    const act = sr.querySelector('.act');
    const cloudInput = sr.querySelector('.cloud-field input');
    check('抽屉行 / 动作行热区 44 / 输入 44', cs(fold, '::after').inset === '-2px 0px' && cs(act, '::after').inset === '-2px 0px' && cs(cloudInput).height === '44px', `${cs(fold, '::after').inset}/${cs(act, '::after').inset}/${cs(cloudInput).height}`);
    check('抽屉内容边距 12', cs(body).paddingLeft === '12px' && cs(body).paddingRight === '12px', `${cs(body).paddingLeft}/${cs(body).paddingRight}`);
    check('运行期无异常', !window.__gsErrs030.length, JSON.stringify(window.__gsErrs030));
    return { checks, errors: window.__gsErrs030, meta: { width: innerWidth, theme: document.documentElement.dataset.theme } };
  } catch (err) {
    checks.push({ name: '测试脚本完成', pass: false, detail: String(err && err.stack || err) });
    return { checks, errors: [String(err && err.stack || err)], meta: { width: innerWidth } };
  }
})()
"""


def main():
    server = start_server()
    browser = pick_browser()
    profile = tempfile.mkdtemp(prefix="gs-browser-030-")
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
            if cdp.ev("!!document.querySelector('guitar-settings')?.shadowRoot"):
                break
            time.sleep(0.25)
        cdp.ev(f"document.documentElement.dataset.theme = '{THEME}'; true")
        time.sleep(0.3)

        cdp.ev("""
window.__gsErrs030 = [];
window.addEventListener('error', e => window.__gsErrs030.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', e => window.__gsErrs030.push(String(e.reason && e.reason.stack || e.reason)));
""")
        out = cdp.ev(TEST)

        failed = 0
        for c in out["checks"]:
            print(("[PASS] " if c["pass"] else "[FAIL] ") + c["name"] + (f" — {c['detail']}" if c.get("detail") != "" else ""))
            if not c["pass"]:
                failed += 1

        print("截图：")
        cdp.ev(f"document.documentElement.dataset.theme = '{THEME}'; true")
        time.sleep(0.25)
        print(" ", cdp.shot("drawer"))
        cdp.ev("document.querySelector('guitar-settings').shadowRoot.querySelector('.close').click(); true")
        time.sleep(0.35)
        print(" ", cdp.shot("header"))

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
