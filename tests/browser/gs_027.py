#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_027.py
# 0.1.22 全局设置布局回归：标题行、动作行、云同步层级、关于页本地优先
#
# 依赖：
#   pip install websocket-client
#
# 用法（仓库根目录）：
#   python tests/browser/gs_027.py
#   GS_WIDTH=320 python tests/browser/gs_027.py
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
PORT = int(os.environ.get("GS_CDP_PORT", "9371"))
WIDTH = int(os.environ.get("GS_WIDTH", "360"))
TMP = Path(os.environ.get("TEMP", tempfile.gettempdir()))

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
            "expression": expression, "returnByValue": True, "awaitPromise": True
        })["result"]
        if res.get("exceptionDetails"):
            raise RuntimeError(json.dumps(res["exceptionDetails"], ensure_ascii=False))
        return res.get("result", {}).get("value")

    def shot(self, name):
        data = self.cmd("Page.captureScreenshot", {"format": "png"}).get("result", {}).get("data")
        if not data:
            return None
        path = TMP / f"gs_027_{WIDTH}_{name}.png"
        path.write_bytes(base64.b64decode(data))
        return str(path)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def main():
    server = start_server()
    browser = pick_browser()
    profile = tempfile.mkdtemp(prefix="gs-browser-027-")
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
            if cdp.ev("!!document.querySelector('#btnGlobalSettings') && !!document.querySelector('guitar-settings')?.shadowRoot"):
                break
            time.sleep(0.25)
        time.sleep(1.2)

        cdp.ev("""
window.__gsErrs027 = [];
window.addEventListener('error', e => window.__gsErrs027.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', e => window.__gsErrs027.push(String(e.reason && e.reason.stack || e.reason)));
document.querySelector('#btnGlobalSettings').click();
""")


        out = cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, timeout = 12000, step = 150) => {
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
    const settings = document.querySelector('guitar-settings');
    await sleep(800);
    const sRoot = settings.shadowRoot;
    await waitFor(() => sRoot.querySelector('.mask.show'), 8000);
    await waitFor(() => {
      const t = sRoot.getElementById('cloudStatus')?.textContent.trim() || '';
      return t && !t.includes('正在读取');
    }, 8000);
    await sleep(200);

    const body = sRoot.querySelector('.body');
    const cards = Array.from(body.querySelectorAll('.card'));
    const headerNames = Array.from(body.querySelectorAll('.card h3')).map((el) => el.textContent.trim());
    check('设置五张卡顺序不变', headerNames.join(' / ') === '外观 / 数据与备份 / 云同步 / 存储与缓存 / 关于', headerNames.join(' / '));

    const headers = cards.map((card) => card.querySelector('.card-head') || card.querySelector('.storage-head'));
    const icons = headers.map((head) => head.querySelector('.ico'));
    const titles = headers.map((head) => head.querySelector('h3'));
    const iconRects = icons.map((el) => el.getBoundingClientRect());
    const titleRects = titles.map((el) => el.getBoundingClientRect());
    const headerRects = headers.map((el) => el.getBoundingClientRect());
    const iconSizes = icons.map((el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width)}×${Math.round(r.height)}`;
    });
    const iconFont = icons.map((el) => getComputedStyle(el).fontSize);
    const titleFont = titles.map((el) => getComputedStyle(el).fontSize);
    check('五个标题图标盒均为 24×24', iconSizes.every((s) => s === '24×24'), iconSizes.join(' / '));
    check('五个标题字号均为 13px', titleFont.every((s) => s === '13px'), titleFont.join(' / '));
    check('标题图标左边缘对齐', iconRects.every((r) => Math.abs(r.left - iconRects[0].left) < 1), iconRects.map((r) => Math.round(r.left)).join(' / '));
    check('图标与标题间距均为 8', titleRects.every((r, i) => Math.abs((r.left - iconRects[i].right) - 8) < 1), titleRects.map((r, i) => Math.round(r.left - iconRects[i].right)).join(' / '));
    check('五张卡标题单行不换行', titleRects.every((r) => r.height <= 20), titleRects.map((r) => Math.round(r.height)).join(' / '));
    check('普通标题行高 36', [0, 1, 2, 4].every((i) => Math.abs(headerRects[i].height - 36) < 1), [0, 1, 2, 4].map((i) => Math.round(headerRects[i].height)).join(' / '));
    check('存储标题行高 40 且整行可点', Math.abs(headerRects[3].height - 40) < 1 && sRoot.getElementById('btnToggleStorage').tagName === 'BUTTON', `${Math.round(headerRects[3].height)}`);
    check('标题行底距 10', Array.from(sRoot.querySelectorAll('.card-head')).every((el) => parseFloat(getComputedStyle(el).marginBottom) === 10), getComputedStyle(sRoot.querySelector('.card-head')).marginBottom);

    const storageChev = sRoot.querySelector('.storage-head .chev').getBoundingClientRect();
    const github = sRoot.querySelector('.about .dev-link').getBoundingClientRect();
    check('存储箭头与关于 GitHub 右边缘对齐', Math.abs(storageChev.right - github.right) < 1, `${Math.round(storageChev.right)} / ${Math.round(github.right)}`);

    const storageBody = sRoot.getElementById('storageBody');
    check('存储卡默认折叠', storageBody.hidden === true && sRoot.getElementById('btnToggleStorage').getAttribute('aria-expanded') === 'false', '');
    sRoot.getElementById('btnToggleStorage').click();
    await sleep(80);
    check('存储卡可展开且箭头状态同步', storageBody.hidden === false && sRoot.getElementById('btnToggleStorage').getAttribute('aria-expanded') === 'true' && sRoot.getElementById('storageCard').classList.contains('open'), '');

    const acts = Array.from(body.querySelectorAll('.act'));
    const actRects = acts.map((el) => el.getBoundingClientRect());
    const actRadius = acts.map((el) => getComputedStyle(el).borderRadius);
    check('所有动作按钮高 40', actRects.every((r) => Math.abs(r.height - 40) < 1), actRects.map((r) => Math.round(r.height)).join(' / '));
    check('所有动作按钮圆角 12', actRadius.every((v) => v === '12px'), actRadius.join(' / '));
    const dataActs = [sRoot.getElementById('btnBackup').getBoundingClientRect(), sRoot.getElementById('btnRestore').getBoundingClientRect()];
    const storageActs = [sRoot.getElementById('btnCleanCover').getBoundingClientRect(), sRoot.getElementById('btnCleanOrphan').getBoundingClientRect()];
    check('数据备份两按钮等分', Math.abs(dataActs[0].width - dataActs[1].width) < 1, dataActs.map((r) => Math.round(r.width)).join(' / '));
    check('存储清理两按钮等分', Math.abs(storageActs[0].width - storageActs[1].width) < 1, storageActs.map((r) => Math.round(r.width)).join(' / '));
    check('管理按钮最小宽 64', parseFloat(getComputedStyle(sRoot.getElementById('btnCloudEntry')).minWidth) === 64, getComputedStyle(sRoot.getElementById('btnCloudEntry')).minWidth);
    const clearRect = sRoot.getElementById('btnClear').getBoundingClientRect();
    check('清空本机数据仍为 30 文本按钮', Math.abs(clearRect.height - 30) < 1 && getComputedStyle(sRoot.getElementById('btnClear')).backgroundColor === 'rgba(0, 0, 0, 0)', `${Math.round(clearRect.height)} / ${getComputedStyle(sRoot.getElementById('btnClear')).borderTopWidth}`);

    const cloudNote = sRoot.querySelector('.cloud-note').getBoundingClientRect();
    const cloudStatus = sRoot.querySelector('.cloud-status').getBoundingClientRect();
    const cloudDetail = sRoot.getElementById('cloudDetail').getBoundingClientRect();
    check('云同步三层信息上下排列', cloudNote.top < cloudStatus.top && cloudStatus.top < cloudDetail.top,
      `${Math.round(cloudNote.top)} / ${Math.round(cloudStatus.top)} / ${Math.round(cloudDetail.top)}`);
    check('云同步状态点 6px 且可见', sRoot.getElementById('cloudDot').getBoundingClientRect().width === 6
      && getComputedStyle(sRoot.getElementById('cloudDot')).backgroundColor !== 'rgba(0, 0, 0, 0)', `${sRoot.getElementById('cloudDot').getBoundingClientRect().width}px`);

    const about = sRoot.querySelector('.about');
    const aboutText = about.textContent.replace(/\s+/g, ' ').trim();
    const local = sRoot.querySelector('.local-first');
    const shield = local.querySelector('svg');
    check('关于品牌副标题为本地优先', sRoot.querySelector('.about-copy small').textContent.trim() === '本地优先的练琴工作站', sRoot.querySelector('.about-copy small').textContent.trim());
    check('关于品牌副标题单行', sRoot.querySelector('.about-copy small').getBoundingClientRect().height <= 16, `${Math.round(sRoot.querySelector('.about-copy small').getBoundingClientRect().height)}`);
    check('关于承诺标题 13px/700', getComputedStyle(local.querySelector('b')).fontSize === '13px' && getComputedStyle(local.querySelector('b')).fontWeight === '700', `${getComputedStyle(local.querySelector('b')).fontSize}/${getComputedStyle(local.querySelector('b')).fontWeight}`);
    check('关于本地承诺文字完整', aboutText.includes('你的谱子，只待在你的机器里') && aboutText.includes('无账号 · 默认不上传 · 备份由你手动保存'), aboutText);
    check('关于盾牌图标 18px', shield && Math.abs(shield.getBoundingClientRect().width - 18) < 1 && Math.abs(shield.getBoundingClientRect().height - 18) < 1, shield ? `${shield.getBoundingClientRect().width}×${shield.getBoundingClientRect().height}` : 'missing');
    check('关于不再出现开发者构建信息', !aboutText.includes('零构建') && !aboutText.includes('Web Components'), aboutText);

    const bodyWidths = `${body.scrollWidth}/${body.clientWidth}`;
    check('设置页无横向溢出', body.scrollWidth <= body.clientWidth + 1, bodyWidths);
    check('320/360 标题不因长度换行', titleRects.every((r) => r.height <= 20), titleRects.map((r) => Math.round(r.height)).join(' / '));
    check('内容过高时抽屉可纵向滚动', body.scrollHeight > body.clientHeight, `${body.scrollHeight}/${body.clientHeight}`);
    body.scrollTop = body.scrollHeight;
    await sleep(100);
    const bodyRect = body.getBoundingClientRect();
    const aboutRect = about.getBoundingClientRect();
    check('滚到底后关于卡完整可见', aboutRect.bottom <= bodyRect.bottom + 1, `${Math.round(aboutRect.bottom)} / ${Math.round(bodyRect.bottom)}`);
    body.scrollTop = 0;
    if (!storageBody.hidden) {
      sRoot.getElementById('btnToggleStorage').click();
      await sleep(80);
    }

    sRoot.getElementById('themeLight').click();
    await sleep(120);
    const lightBorder = getComputedStyle(sRoot.querySelector('.act')).borderTopColor;
    check('浅色动作按钮边框可见', lightBorder !== 'rgba(0, 0, 0, 0)' && lightBorder !== 'transparent', lightBorder);
    sRoot.getElementById('themeDeep').click();
    await sleep(120);

    check('运行期无异常', !window.__gsErrs027.length, JSON.stringify(window.__gsErrs027));
    return { checks, errors: window.__gsErrs027, meta: { width: innerWidth } };
  } catch (err) {
    return { checks, errors: [String(err && err.stack || err)], meta: { width: innerWidth } };
  }
})()
""")

        failed = 0
        for c in out["checks"]:
            print(("[PASS] " if c["pass"] else "[FAIL] ") + c["name"] + (f" — {c['detail']}" if c.get("detail") != "" else ""))
            if not c["pass"]:
                failed += 1

        print("截图：")
        print(" ", cdp.shot("settings_top"))
        cdp.ev("document.querySelector('guitar-settings').shadowRoot.querySelector('.body').scrollTop = document.querySelector('guitar-settings').shadowRoot.querySelector('.body').scrollHeight; true")
        time.sleep(0.2)
        print(" ", cdp.shot("settings_about"))
        cdp.ev("document.querySelector('guitar-settings').shadowRoot.getElementById('themeLight').click(); document.querySelector('guitar-settings').shadowRoot.querySelector('.body').scrollTop = 0; true")
        time.sleep(0.2)
        print(" ", cdp.shot("settings_light"))
        cdp.ev("document.querySelector('guitar-settings').shadowRoot.getElementById('themeDeep').click(); true")
        time.sleep(0.2)

        cloud_open = cdp.ev("""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let opened = 0;
  const onCloud = () => { opened += 1; };
  window.addEventListener('open-cloud-sync', onCloud, { once: true });
  document.querySelector('guitar-settings').shadowRoot.getElementById('btnCloudEntry').click();
  await sleep(600);
  window.removeEventListener('open-cloud-sync', onCloud);
  return opened;
})()
""")
        check_cloud = cloud_open == 1
        print(("[PASS] " if check_cloud else "[FAIL] ") + f"管理按钮仍打开云同步面板事件 — {cloud_open}")
        if not check_cloud:
            failed += 1

        total = len(out["checks"]) + 1
        print("")
        print(f"宽度 {WIDTH}：通过 {total - failed}/{total}")
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
