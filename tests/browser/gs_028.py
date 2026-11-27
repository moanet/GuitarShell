#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_028.py
# 0.1.26 练习记录页折叠回归：表单摘要行、展开/收起、保存自动折叠、列表首屏
#
# 依赖：
#   pip install websocket-client
#
# 用法（仓库根目录）：
#   python tests/browser/gs_028.py
#   GS_WIDTH=320 python tests/browser/gs_028.py
#   GS_THEME=light python tests/browser/gs_028.py
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
PORT = int(os.environ.get("GS_CDP_PORT", "9372"))
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
        path = Path(tempfile.gettempdir()) / f"gs_028_{WIDTH}_{THEME}_{name}.png"
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
    for (let i = 1; i <= 6; i++) {
      await db.dbService.addLog({ name: `练习 ${i}`, minutes: 10, bpm: 90 + i });
    }
    window.dispatchEvent(new Event('log-updated'));
    document.querySelector('.tab-btn[data-target="view-log"]').click();
    await sleep(600);

    const log = document.querySelector('guitar-practice-log');
    if (!log?.shadowRoot) throw new Error('练习记录组件未就绪');
    const r = log.shadowRoot;
    const $ = (id) => r.getElementById(id);
    const formBox = $('formBox');
    const formToggle = $('formToggle');
    const formPeek = $('formPeek');
    const formBody = $('formBody');
    const inpName = $('inpName');
    const inpTime = $('inpTime');
    const inpBpm = $('inpBpm');
    const btnSubmit = $('btnSubmit');
    const trendBox = $('trendBox');
    const trendToggle = $('trendToggle');
    const logList = $('logList');
    const listHead = r.querySelector('.list-head');
    const cards = Array.from(r.querySelectorAll('.log-card'));
    const visibleText = (root) => {
      const parts = [];
      const walk = (node) => {
        if (!node) return;
        if (node.nodeType === 3) { parts.push(node.nodeValue); return; }
        if (node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') return;
        if (node.shadowRoot) walk(node.shadowRoot);
        for (const child of node.childNodes || []) walk(child);
      };
      walk(root);
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    };

    const formRect = formBox.getBoundingClientRect();
    const headRect = formToggle.getBoundingClientRect();
    const listRect = logList.getBoundingClientRect();
    const cardRects = cards.map((el) => el.getBoundingClientRect());
    const fullyVisible = cardRects.filter((rect) => rect.top >= listRect.top - 1 && rect.bottom <= listRect.bottom + 1).length;
    const firstCard = cardRects[0] || null;
    const summaryText = formPeek.textContent.replace(/\s+/g, ' ').trim();

    check('默认折叠', formBox.classList.contains('collapsed') && getComputedStyle(formBody).display === 'none', getComputedStyle(formBody).display);
    check('摘要行 48–50px', headRect.height >= 48 && headRect.height <= 50, `${headRect.width.toFixed(1)}×${headRect.height.toFixed(1)}`);
    check('折叠表单总高不超过 52', formRect.height <= 52, formRect.height.toFixed(1));
    check('摘要行为整行按钮并带 aria', formToggle.tagName === 'BUTTON' && formToggle.getAttribute('aria-controls') === 'formBody' && formToggle.getAttribute('aria-expanded') === 'false', `${formToggle.tagName}/${formToggle.getAttribute('aria-expanded')}`);
    check('摘要显示今日次数与分钟', /^今天 6 次 · 60 分钟$/.test(summaryText), summaryText);
    check('摘要两项数字有强调', formPeek.querySelectorAll('b').length === 2, `${formPeek.querySelectorAll('b').length}`);
    check('摘要行箭头为 SVG', !!formToggle.querySelector('.form-chevron svg'), '');
    check('摘要行无横向溢出', formToggle.scrollWidth <= formToggle.clientWidth + 1, `${formToggle.scrollWidth}/${formToggle.clientWidth}`);
    check('标题单行', r.querySelector('.form-title').getBoundingClientRect().height <= 20, `${r.querySelector('.form-title').getBoundingClientRect().height.toFixed(1)}`);
    check('摘要单行', formPeek.getBoundingClientRect().height <= 18, `${formPeek.getBoundingClientRect().height.toFixed(1)}`);
    check('趋势默认仍收起', trendBox.classList.contains('collapsed') && trendToggle.getAttribute('aria-expanded') === 'false', '');
    check('列表标题在趋势之后', Math.abs(listHead.getBoundingClientRect().top - trendBox.getBoundingClientRect().bottom) < 2, `${listHead.getBoundingClientRect().top.toFixed(0)}/${trendBox.getBoundingClientRect().bottom.toFixed(0)}`);
    check('首条记录明显上移', firstCard && firstCard.top <= 245, firstCard ? firstCard.top.toFixed(1) : 'none');
    check('首屏至少 4 条完整记录', fullyVisible >= 4, `${fullyVisible}/${cards.length}, list=${listRect.top.toFixed(0)}–${listRect.bottom.toFixed(0)}`);
    check('记录数量 6', $('listCount').textContent.trim() === '6 条', $('listCount').textContent.trim());
    check('页面无横向溢出', document.documentElement.scrollWidth <= innerWidth + 1, `${document.documentElement.scrollWidth}/${innerWidth}`);

    formToggle.click();
    await sleep(120);
    check('点击摘要行展开', !formBox.classList.contains('collapsed') && getComputedStyle(formBody).display === 'flex' && formToggle.getAttribute('aria-expanded') === 'true', `${getComputedStyle(formBody).display}/${formToggle.getAttribute('aria-expanded')}`);
    check('展开后输入框与按钮可见', [inpName, inpTime, inpBpm, btnSubmit].every((el) => el.getBoundingClientRect().height > 0), '');
    check('展开不自动聚焦输入框', r.activeElement?.tagName !== 'INPUT', r.activeElement?.tagName || 'none');
    const expandedHeight = formBox.getBoundingClientRect().height;
    check('展开高度与旧版接近', expandedHeight < 222 && expandedHeight > 150, expandedHeight.toFixed(1));

    inpName.value = '草稿曲目';
    inpTime.value = '12';
    inpBpm.value = '88';
    inpName.focus();
    await sleep(60);
    formToggle.click();
    await sleep(120);
    check('收起后输入框失焦', r.activeElement?.tagName !== 'INPUT', r.activeElement?.tagName || 'none');
    check('收起后字段隐藏', getComputedStyle(formBody).display === 'none', getComputedStyle(formBody).display);
    check('收起不清空草稿', inpName.value === '草稿曲目' && inpTime.value === '12' && inpBpm.value === '88', `${inpName.value}/${inpTime.value}/${inpBpm.value}`);

    formToggle.click();
    await sleep(120);
    check('再次展开草稿仍在', inpName.value === '草稿曲目' && inpTime.value === '12' && inpBpm.value === '88', `${inpName.value}/${inpTime.value}/${inpBpm.value}`);

    inpName.value = '';
    btnSubmit.click();
    await sleep(120);
    check('空内容保存不收起', !formBox.classList.contains('collapsed'), formBox.className);
    check('空内容保存提示正确', $('toast').textContent.trim() === '请输入练习内容', $('toast').textContent.trim());

    inpName.value = '新记录';
    inpTime.value = '15';
    inpBpm.value = '120';
    btnSubmit.click();
    await sleep(600);
    const cardsAfterSave = r.querySelectorAll('.log-card').length;
    check('保存成功自动折叠', formBox.classList.contains('collapsed') && formToggle.getAttribute('aria-expanded') === 'false', formBox.className);
    check('保存成功后清空字段', inpName.value === '' && inpTime.value === '' && inpBpm.value === '', `${inpName.value}/${inpTime.value}/${inpBpm.value}`);
    check('保存后记录新增', cardsAfterSave === 7 && $('listCount').textContent.trim() === '7 条', `${cardsAfterSave}/${$('listCount').textContent.trim()}`);
    check('保存后摘要更新', /^今天 7 次 · 75 分钟$/.test(formPeek.textContent.replace(/\s+/g, ' ').trim()), formPeek.textContent.replace(/\s+/g, ' ').trim());
    check('保存成功提示正确', $('toast').textContent.trim() === '打卡成功！', $('toast').textContent.trim());

    const allLogs = await db.dbService.getAllLogs();
    await db.dbService.deleteLog(allLogs[0].id);
    window.dispatchEvent(new Event('log-updated'));
    await sleep(450);
    const cardsAfterDelete = r.querySelectorAll('.log-card').length;
    check('删除后列表与摘要同步', cardsAfterDelete === 6 && /^今天 6 次 · \d+ 分钟$/.test(formPeek.textContent.replace(/\s+/g, ' ').trim()), `${cardsAfterDelete}/${formPeek.textContent.replace(/\s+/g, ' ').trim()}`);

    trendToggle.click();
    await sleep(120);
    check('趋势独立展开', !trendBox.classList.contains('collapsed') && formBox.classList.contains('collapsed'), `${trendBox.className}/${formBox.className}`);
    check('趋势图表仍渲染', !!r.querySelector('#chartWrap svg'), `${r.querySelectorAll('#chartWrap svg').length}`);
    r.querySelector('.seg-btn[data-range="month"]').click();
    await sleep(150);
    check('近 12 月切换仍生效', r.querySelector('.seg-btn[data-range="month"]').classList.contains('active') && localStorage.getItem('gs_trend_range') === 'month', `${localStorage.getItem('gs_trend_range')}`);
    check('趋势摘要仍更新', $('trendSummary').textContent.includes('近 12 个月共'), $('trendSummary').textContent.trim());
    trendToggle.click();
    await sleep(100);
    check('趋势可再收起', trendBox.classList.contains('collapsed'), '');

    const beforeTheme = document.documentElement.dataset.theme;
    const deepColor = getComputedStyle(formPeek).color;
    const nextTheme = beforeTheme === 'light' ? 'deep' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    await sleep(120);
    const lightColor = getComputedStyle(formPeek).color;
    const lightBg = getComputedStyle(formBox).backgroundColor;
    document.documentElement.dataset.theme = beforeTheme;
    await sleep(100);
    check('主题切换摘要颜色跟随', deepColor !== lightColor, `${beforeTheme}:${deepColor} → ${nextTheme}:${lightColor}`);
    check('对比主题表单背景跟随变量', lightBg !== 'rgba(0, 0, 0, 0)', lightBg);

    check('运行期无异常', !window.__gsErrs028.length, JSON.stringify(window.__gsErrs028));
    return { checks, errors: window.__gsErrs028, meta: { width: innerWidth, theme: document.documentElement.dataset.theme } };
  } catch (err) {
    checks.push({ name: '测试脚本完成', pass: false, detail: String(err && err.stack || err) });
    return { checks, errors: [String(err && err.stack || err)], meta: { width: innerWidth } };
  }
})()
"""


def main():
    server = start_server()
    browser = pick_browser()
    profile = tempfile.mkdtemp(prefix="gs-browser-028-")
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
            if cdp.ev("!!document.querySelector('guitar-practice-log')?.shadowRoot"):
                break
            time.sleep(0.25)
        cdp.ev(f"document.documentElement.dataset.theme = '{THEME}'; true")
        time.sleep(0.3)

        cdp.ev("""
window.__gsErrs028 = [];
window.addEventListener('error', e => window.__gsErrs028.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', e => window.__gsErrs028.push(String(e.reason && e.reason.stack || e.reason)));
""")
        out = cdp.ev(TEST)

        failed = 0
        for c in out["checks"]:
            print(("[PASS] " if c["pass"] else "[FAIL] ") + c["name"] + (f" — {c['detail']}" if c.get("detail") != "" else ""))
            if not c["pass"]:
                failed += 1

        print("截图：")
        cdp.ev("""
const log = document.querySelector('guitar-practice-log');
const r = log.shadowRoot;
if (!r.getElementById('formBox').classList.contains('collapsed')) r.getElementById('formToggle').click();
if (!r.getElementById('trendBox').classList.contains('collapsed')) r.getElementById('trendToggle').click();
r.getElementById('toast').classList.remove('show');
r.getElementById('logList').scrollTop = 0;
true
""")
        cdp.ev(f"document.documentElement.dataset.theme = '{THEME}'; true")
        time.sleep(0.25)
        print(" ", cdp.shot("collapsed"))
        cdp.ev("document.querySelector('guitar-practice-log').shadowRoot.getElementById('formToggle').click(); true")
        time.sleep(0.3)
        print(" ", cdp.shot("expanded"))
        cdp.ev("document.querySelector('guitar-practice-log').shadowRoot.getElementById('formToggle').click(); true")
        time.sleep(0.2)

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
