#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_027.py
# 0.1.23 全局设置折叠布局回归：摘要行、单开互斥、主题网格、关于细线承诺
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


TEST = r"""
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
    await sleep(700);
    const sRoot = settings.shadowRoot;
    await waitFor(() => sRoot.querySelector('.mask.show'), 8000);
    await waitFor(() => {
      const text = sRoot.getElementById('cloudStatusText')?.textContent.trim() || '';
      return text && !text.includes('正在读取');
    }, 8000);
    await sleep(200);

    const body = sRoot.querySelector('.body');
    const cards = Array.from(body.querySelectorAll('.card'));
    const names = Array.from(body.querySelectorAll('.card h3')).map((el) => el.textContent.trim());
    check('设置五张卡顺序不变', names.join(' / ') === '外观 / 数据与备份 / 云同步 / 存储与缓存 / 关于', names.join(' / '));

    const headers = [
      sRoot.getElementById('btnToggleAppearance'),
      sRoot.getElementById('btnToggleData'),
      sRoot.getElementById('btnToggleCloud'),
      sRoot.getElementById('btnToggleStorage'),
      sRoot.querySelector('.about .card-head')
    ];
    const icons = headers.map((head) => head.querySelector('.ico'));
    const titles = headers.map((head) => head.querySelector('h3'));
    const iconRects = icons.map((el) => el.getBoundingClientRect());
    const titleRects = titles.map((el) => el.getBoundingClientRect());
    const headerRects = headers.map((el) => el.getBoundingClientRect());
    check('五个标题图标盒均为 24×24', iconRects.every((r) => Math.abs(r.width - 24) < 1 && Math.abs(r.height - 24) < 1), iconRects.map((r) => `${Math.round(r.width)}×${Math.round(r.height)}`).join(' / '));
    check('五个标题字号均为 13px', titles.every((el) => getComputedStyle(el).fontSize === '13px'), titles.map((el) => getComputedStyle(el).fontSize).join(' / '));
    check('标题图标左边缘对齐', iconRects.every((r) => Math.abs(r.left - iconRects[0].left) < 1), iconRects.map((r) => Math.round(r.left)).join(' / '));
    check('图标与标题间距均为 8', titleRects.every((r, i) => Math.abs((r.left - iconRects[i].right) - 8) < 1), titleRects.map((r, i) => Math.round(r.left - iconRects[i].right)).join(' / '));
    check('五张标题单行不换行', titleRects.every((r) => r.height <= 20), titleRects.map((r) => Math.round(r.height)).join(' / '));
    check('外观与数据标题行高 40', [0, 1].every((i) => Math.abs(headerRects[i].height - 40) < 1), [0, 1].map((i) => Math.round(headerRects[i].height)).join(' / '));
    check('存储标题行高 40', Math.abs(headerRects[3].height - 40) < 1, `${Math.round(headerRects[3].height)}`);
    check('云同步折叠行 40、关于 36', Math.abs(headerRects[2].height - 40) < 1 && Math.abs(headerRects[4].height - 36) < 1, [2, 4].map((i) => Math.round(headerRects[i].height)).join(' / '));
    check('折叠行均为整行按钮', [0, 1, 3].every((i) => headers[i].tagName === 'BUTTON' && headers[i].getAttribute('aria-controls')), '');

    check('抽屉标题副标题已删除', !sRoot.querySelector('.head p'), '');
    check('外观与数据默认收起', sRoot.getElementById('appearanceBody').hidden && sRoot.getElementById('dataBody').hidden, '');
    check('存储默认收起', sRoot.getElementById('storageBody').hidden && sRoot.getElementById('btnToggleStorage').getAttribute('aria-expanded') === 'false', '');

    const storageChev = sRoot.getElementById('btnToggleStorage').querySelector('.chev').getBoundingClientRect();
    const github = sRoot.querySelector('.about .dev-link').getBoundingClientRect();
    check('存储箭头与关于 GitHub 右边缘对齐', Math.abs(storageChev.right - github.right) < 1, `${Math.round(storageChev.right)} / ${Math.round(github.right)}`);

    const appearanceSummary = sRoot.getElementById('themeSummary');
    const appearanceNote = sRoot.getElementById('themeNote');
    check('外观摘要显示当前主题', appearanceSummary.textContent.trim() === '深夜琴房', appearanceSummary.textContent.trim());
    check('外观说明提示另一套主题', appearanceNote.textContent.includes('暖纸日光') && appearanceNote.textContent.includes('点按即切换'), appearanceNote.textContent.trim());

    sRoot.getElementById('btnToggleAppearance').click();
    await sleep(120);
    check('外观展开', sRoot.getElementById('appearanceBody').hidden === false && sRoot.getElementById('btnToggleAppearance').getAttribute('aria-expanded') === 'true', '');
    const themeGrid = sRoot.querySelector('.theme-grid');
    const themeChoices = Array.from(sRoot.querySelectorAll('[data-theme-choice]'));
    const themeRects = themeChoices.map((el) => el.getBoundingClientRect());
    const gridCols = getComputedStyle(themeGrid).gridTemplateColumns.split(' ').filter(Boolean);
    check('主题网格固定两列', gridCols.length === 2, gridCols.join(' / '));
    check('主题网格两项等宽', themeRects.length === 2 && Math.abs(themeRects[0].width - themeRects[1].width) < 1, themeRects.map((r) => Math.round(r.width)).join(' / '));
    check('主题色板高 42', themeChoices.every((el) => Math.abs(el.querySelector('.swatch').getBoundingClientRect().height - 42) < 1), themeChoices.map((el) => Math.round(el.querySelector('.swatch').getBoundingClientRect().height)).join(' / '));
    check('主题网格默认选中当前主题', themeChoices.filter((el) => el.classList.contains('active')).length === 1 && sRoot.querySelector('[data-theme-choice="deep"]').classList.contains('active'), '');
    check('主题命名保持原样', themeChoices.map((el) => el.textContent.trim()).join(' / ') === '深夜琴房 / 暖纸日光', themeChoices.map((el) => el.textContent.trim()).join(' / '));

    sRoot.querySelector('[data-theme-choice="light"]').click();
    await sleep(120);
    check('切到浅色后摘要同步', appearanceSummary.textContent.trim() === '暖纸日光' && sRoot.querySelector('[data-theme-choice="light"]').classList.contains('active') && !sRoot.querySelector('[data-theme-choice="deep"]').classList.contains('active'), appearanceSummary.textContent.trim());
    check('切到浅色后说明同步', appearanceNote.textContent.includes('深夜琴房'), appearanceNote.textContent.trim());
    check('浅色动作按钮边框可见', getComputedStyle(sRoot.getElementById('btnBackup')).borderTopColor !== 'rgba(0, 0, 0, 0)', getComputedStyle(sRoot.getElementById('btnBackup')).borderTopColor);
    sRoot.querySelector('[data-theme-choice="deep"]').click();
    await sleep(120);
    check('切回深色后摘要同步', appearanceSummary.textContent.trim() === '深夜琴房', appearanceSummary.textContent.trim());

    sRoot.getElementById('btnToggleData').click();
    await sleep(120);
    check('数据展开时外观自动收起', sRoot.getElementById('dataBody').hidden === false && sRoot.getElementById('appearanceBody').hidden === true, '');
    const dataSummary = sRoot.querySelector('#dataCard .fold-value').textContent.replace(/\s+/g, ' ').trim();
    const dataValue = sRoot.querySelector('#dataCard .fold-value');
    check('数据摘要为乐谱与练习统计', /^\d+ 份乐谱\s*·\s*\d+ 条练习$/.test(dataSummary), dataSummary);
    check('数据摘要不省略', dataValue.scrollWidth <= dataValue.clientWidth + 1, `${dataValue.scrollWidth}/${dataValue.clientWidth}`);
    check('数据说明单行', sRoot.querySelector('#dataCard .fold-note').getBoundingClientRect().height <= 17, `${Math.round(sRoot.querySelector('#dataCard .fold-note').getBoundingClientRect().height)}`);
    const dataActs = [sRoot.getElementById('btnBackup'), sRoot.getElementById('btnRestore')];
    check('数据动作高 40 且等分', dataActs.every((el) => Math.abs(el.getBoundingClientRect().height - 40) < 1)
      && Math.abs(dataActs[0].getBoundingClientRect().width - dataActs[1].getBoundingClientRect().width) < 1,
      dataActs.map((el) => `${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`).join(' / '));
    const clearStyle = getComputedStyle(sRoot.getElementById('btnClear'));
    check('清空仍为 30 文本按钮', parseFloat(clearStyle.minHeight) === 30 && clearStyle.backgroundColor === 'rgba(0, 0, 0, 0)', `${clearStyle.minHeight} / ${clearStyle.backgroundColor}`);
    check('Android 备份路径移入展开体', sRoot.querySelector('#dataBody .hint').textContent.includes('Download/GuitarShell'), sRoot.querySelector('#dataBody .hint').textContent.trim());

    sRoot.getElementById('btnToggleStorage').click();
    await sleep(120);
    check('存储展开时数据自动收起', sRoot.getElementById('storageBody').hidden === false && sRoot.getElementById('dataBody').hidden === true, '');
    const storageActs = [sRoot.getElementById('btnCleanCover'), sRoot.getElementById('btnCleanOrphan')];
    check('存储动作高 40 且等分', storageActs.every((el) => Math.abs(el.getBoundingClientRect().height - 40) < 1)
      && Math.abs(storageActs[0].getBoundingClientRect().width - storageActs[1].getBoundingClientRect().width) < 1,
      storageActs.map((el) => `${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`).join(' / '));
    check('存储总占用保留', sRoot.getElementById('totalUsage').textContent.trim() !== '—', sRoot.getElementById('totalUsage').textContent.trim());
    sRoot.getElementById('btnToggleStorage').click();
    await sleep(80);

    const about = sRoot.querySelector('.about');
    const aboutText = about.textContent.replace(/\s+/g, ' ').trim();
    const privacy = sRoot.querySelector('.about-privacy');
    const privacyText = Array.from(privacy.querySelectorAll('span')).map((el) => el.textContent.trim()).join(' ');
    const privacyRects = Array.from(privacy.querySelectorAll('span')).map((el) => el.getBoundingClientRect());
    const privacyLines = privacy.querySelectorAll('i');
    check('关于不折叠', !about.querySelector('.chev') && privacy.offsetParent !== null, '');
    check('品牌副标题已移除', !sRoot.querySelector('.about-copy small'), '');
    check('关于承诺为三项', privacyText === '无账号 本地优先 默认不上传', privacyText);
    check('关于承诺三项单行', privacyRects.every((r) => r.height <= 17) && Math.abs(privacyRects[0].top - privacyRects[1].top) < 1, privacyRects.map((r) => Math.round(r.top)).join(' / '));
    check('关于承诺细线分隔', privacyLines.length === 2 && Array.from(privacyLines).every((el) => el.getBoundingClientRect().width === 1), `${privacyLines.length}`);
    check('盾牌与旧承诺块已删除', sRoot.querySelectorAll('.about svg').length === 2 && !aboutText.includes('你的谱子') && !aboutText.includes('备份由你手动保存'), aboutText);
    check('GitHub 入口保留', sRoot.getElementById('btnGithub').getAttribute('href') === 'https://github.com/moanet/GuitarShell', '');
    check('关于不再展示开发者构建信息', !aboutText.includes('零构建') && !aboutText.includes('Web Components'), aboutText);

    check('设置页无横向溢出', body.scrollWidth <= body.clientWidth + 1, `${body.scrollWidth}/${body.clientWidth}`);
    const bodyRect = body.getBoundingClientRect();
    const aboutRect = about.getBoundingClientRect();
    check('折叠后内容不超过一屏', body.scrollHeight <= body.clientHeight + 1, `${body.scrollHeight}/${body.clientHeight}`);
    check('关于卡完整可见', aboutRect.bottom <= bodyRect.bottom + 1, `${Math.round(aboutRect.bottom)} / ${Math.round(bodyRect.bottom)}`);
    check('运行期无异常', !window.__gsErrs027.length, JSON.stringify(window.__gsErrs027));
    return { checks, errors: window.__gsErrs027, meta: { width: innerWidth } };
  } catch (err) {
    return { checks, errors: [String(err && err.stack || err)], meta: { width: innerWidth } };
  }
})()
"""


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

        out = cdp.ev(TEST)

        failed = 0
        for c in out["checks"]:
            print(("[PASS] " if c["pass"] else "[FAIL] ") + c["name"] + (f" — {c['detail']}" if c.get("detail") != "" else ""))
            if not c["pass"]:
                failed += 1

        print("截图：")
        print(" ", cdp.shot("settings_top"))
        cdp.ev("document.querySelector('guitar-settings').shadowRoot.getElementById('btnToggleAppearance').click(); true")
        time.sleep(0.25)
        print(" ", cdp.shot("settings_appearance"))
        cdp.ev("document.querySelector('guitar-settings').shadowRoot.querySelector('.body').scrollTop = document.querySelector('guitar-settings').shadowRoot.querySelector('.body').scrollHeight; true")
        time.sleep(0.2)
        print(" ", cdp.shot("settings_about"))
        cdp.ev("""
const s = document.querySelector('guitar-settings');
s.shadowRoot.querySelector('[data-theme-choice="light"]').click();
s.closeAllFolds();
s.shadowRoot.querySelector('.body').scrollTop = 0;
true
""")
        time.sleep(0.3)
        print(" ", cdp.shot("settings_light"))
        cdp.ev('document.querySelector(\'guitar-settings\').shadowRoot.querySelector(\'[data-theme-choice="deep"]\').click(); true')
        time.sleep(0.2)

        cloud_open = cdp.ev("""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const s = document.querySelector('guitar-settings');
  const r = s.shadowRoot;
  r.getElementById('btnToggleCloud').click();
  await sleep(300);
  return {
    open: !r.getElementById('cloudBody').hidden,
    expanded: r.getElementById('btnToggleCloud').getAttribute('aria-expanded') === 'true',
    fields: ['cloudAccount', 'cloudSecret', 'cloudPath', 'cloudBase', 'btnCloudTest', 'btnCloudUpload', 'btnCloudDownload']
      .every(id => !!r.getElementById(id)),
    othersClosed: r.getElementById('appearanceBody').hidden && r.getElementById('dataBody').hidden && r.getElementById('storageBody').hidden,
    noOldModal: !r.getElementById('cloudModalMask') && !r.getElementById('btnCloudEntry')
  };
})()
""")
        check_cloud = all(cloud_open.values())
        print(("[PASS] " if check_cloud else "[FAIL] ") + f"云同步折叠行展开表单且旧入口消失 — {json.dumps(cloud_open, ensure_ascii=False)}")
        if not check_cloud:
            failed += 1

        print(" ", cdp.shot("settings_cloud_top"))
        cdp.ev("""
const r = document.querySelector('guitar-settings').shadowRoot;
r.querySelector('.body').scrollTop = r.querySelector('.body').scrollHeight;
true
""")
        time.sleep(0.25)
        print(" ", cdp.shot("settings_cloud_bottom"))
        cdp.ev("""
{
  const s = document.querySelector('guitar-settings').shadowRoot;
  s.querySelector('[data-theme-choice="light"]').click();
  s.querySelector('.body').scrollTop = 0;
}
true
""")
        time.sleep(0.25)
        print(" ", cdp.shot("settings_cloud_light_top"))
        cdp.ev("""
{
  const s = document.querySelector('guitar-settings').shadowRoot;
  s.querySelector('[data-theme-choice="deep"]').click();
}
true
""")
        time.sleep(0.15)

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
