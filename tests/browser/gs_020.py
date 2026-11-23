#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_020.py
# 0.1.10 浏览器回归：节拍器设置卡片、拍号快捷格、细分说明、定时档
#
# 用法（仓库根目录）：
#   python tests/browser/gs_020.py
#   GS_WIDTH=360 python tests/browser/gs_020.py
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
PORT = int(os.environ.get("GS_CDP_PORT", "9355"))
WIDTH = int(os.environ.get("GS_WIDTH", "320"))
THEME = os.environ.get("GS_THEME", "deep").lower()
if THEME not in ("deep", "light"):
    THEME = "deep"
COLOR_SCHEME = "light" if THEME == "light" else "dark"

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
    profile = tempfile.mkdtemp(prefix="gs-browser-020-")
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
            "width": WIDTH, "height": 900, "deviceScaleFactor": 1, "mobile": True,
        })
        cdp.cmd("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        for _ in range(80):
            if cdp.ev("!!document.querySelector('guitar-metronome')?.shadowRoot"):
                break
            time.sleep(0.25)
        cdp.ev(f"""
(() => {{
  localStorage.setItem('gs_theme', '{THEME}');
  document.documentElement.dataset.theme = '{THEME}';
  document.documentElement.style.colorScheme = '{COLOR_SCHEME}';
  return document.documentElement.dataset.theme;
}})()
""")

        out = cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};

  document.querySelector('.tab-btn[data-target="view-metronome"]').click();
  await sleep(220);
  const m = document.querySelector('guitar-metronome');
  const mr = m.shadowRoot;
  const $ = (id) => mr.getElementById(id);
  $('btnSettings').click();
  await sleep(260);

  const cardOf = (el) => {
    const card = el.closest('.settings-card');
    return card ? card.querySelector('h4')?.textContent.trim() : '';
  };
  const cards = [...mr.querySelectorAll('.settings-card')].map(c => ({
    title: c.querySelector('h4')?.textContent.trim() || '',
    top: Math.round(c.getBoundingClientRect().top),
  }));

  const tsButtons = [...$('tsGrid').querySelectorAll('.ts-btn')];
  out.cards = cards.map(c => c.title);
  out.timeSig = {
    count: tsButtons.length,
    labels: tsButtons.map(b => b.textContent.trim()),
    selected: tsButtons.filter(b => b.classList.contains('on')).map(b => b.textContent.trim()),
    has88: tsButtons.some(b => b.textContent.trim() === '8/8')
  };

  const subButtons = [...$('subGrid').querySelectorAll('.sub-btn')];
  const subMap = {};
  subButtons.forEach(b => {
    subMap[b.querySelector('.sub-name')?.textContent.trim()] = {
      desc: b.querySelector('.sub-desc')?.textContent.trim() || '',
      title: b.title || '',
      aria: b.getAttribute('aria-label') || ''
    };
  });
  out.subdiv = {
    count: subButtons.length,
    quarter: subMap['四分'],
    sixteenthRest3: subMap['十·休3']
  };

  const timerChips = [...$('timerPresets').querySelectorAll('.timer-chip')];
  out.timer = {
    count: timerChips.length,
    labels: timerChips.map(b => b.textContent.trim()),
    rows: new Set(timerChips.map(b => Math.round(b.getBoundingClientRect().top))).size,
    selected: timerChips.filter(b => b.classList.contains('on')).map(b => b.textContent.trim())
  };

  timerChips.find(b => b.textContent.trim() === '10').click();
  await sleep(80);
  out.timer.afterClick10 = {
    input: $('timerMin').value,
    selected: timerChips.filter(b => b.classList.contains('on')).map(b => b.textContent.trim())
  };

  $('timerMin').value = '7';
  $('timerMin').dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(80);
  out.timer.afterCustom7 = {
    input: $('timerMin').value,
    selected: timerChips.filter(b => b.classList.contains('on')).map(b => b.textContent.trim())
  };

  // 自定义 8/8：快捷格没有它，但输入仍能应用
  $('tsNumInput').value = '8';
  $('tsDenInput').value = '8';
  $('tsApply').click();
  await sleep(120);
  out.custom88 = {
    info: $('infoTs').textContent.trim(),
    selectedQuick: [...$('tsGrid').querySelectorAll('.ts-btn.on')].map(b => b.textContent.trim())
  };
  // 回到 4/4，保持截图状态常见
  [...$('tsGrid').querySelectorAll('.ts-btn')].find(b => b.textContent.trim() === '4/4').click();
  await sleep(120);

  out.cardAnchors = {
    flash: cardOf($('flashSwitch')),
    vibration: cardOf($('vibrationSwitch')),
    timer: cardOf($('timerPresets')),
    pattern: cardOf($('patternList')),
    audio: cardOf($('meterGuess'))
  };
  out.audioTitle = [...mr.querySelectorAll('.settings-card h4')].map(h => h.textContent.trim()).find(t => t.includes('音频'));

  const panel = mr.querySelector('.settings-panel');
  const content = mr.querySelector('.settings-content');
  const cardRects = [...mr.querySelectorAll('.settings-card')].map(c => c.getBoundingClientRect());
  out.layout = {
    viewport: innerWidth,
    panelWidth: Math.round(panel.getBoundingClientRect().width),
    panelOverflow: panel.scrollWidth > panel.clientWidth + 1,
    contentOverflow: content.scrollWidth > content.clientWidth + 1,
    maxCardRight: Math.round(Math.max(...cardRects.map(r => r.right))),
    contentRight: Math.round(content.getBoundingClientRect().right),
    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    scrollHeight: content.scrollHeight,
    clientHeight: content.clientHeight
  };
  out.settingsOpen = $('settingsMask').classList.contains('show');
  out.theme = document.documentElement.dataset.theme || '';
  out.layout.viewport = innerWidth;
  content.scrollTop = 0;
  return out;
})()
""")

        assert out["cards"] == ["基础节奏", "重音与反馈", "高级练习", "节奏型", "音频跟练与测速"], out
        assert out["timeSig"]["count"] == 8, out
        assert out["timeSig"]["labels"] == ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8"], out
        assert out["timeSig"]["selected"] == ["4/4"], out
        assert out["timeSig"]["has88"] is False, out
        assert out["subdiv"]["count"] == 11, out
        assert out["subdiv"]["quarter"]["desc"] == "每拍 1 个", out
        assert out["subdiv"]["quarter"]["title"] == "四分音符，每拍 1 个", out
        assert "四分音符" in out["subdiv"]["quarter"]["aria"], out
        assert out["subdiv"]["sixteenthRest3"]["desc"] == "第 3 位休止", out
        assert out["subdiv"]["sixteenthRest3"]["title"] == "十六分音符，第 3 位休止", out
        assert out["timer"]["count"] == 6, out
        assert out["timer"]["labels"] == ["3", "5", "10", "15", "20", "30"], out
        assert out["timer"]["rows"] == 1, out
        assert out["timer"]["selected"] == ["15"], out
        assert out["timer"]["afterClick10"]["input"] == "10", out
        assert out["timer"]["afterClick10"]["selected"] == ["10"], out
        assert out["timer"]["afterCustom7"]["input"] == "7", out
        assert out["timer"]["afterCustom7"]["selected"] == [], out
        assert out["custom88"]["info"] == "8/8", out
        assert out["custom88"]["selectedQuick"] == [], out
        assert out["cardAnchors"]["flash"] == "重音与反馈", out
        assert out["cardAnchors"]["vibration"] == "重音与反馈", out
        assert out["cardAnchors"]["timer"] == "高级练习", out
        assert out["cardAnchors"]["pattern"] == "节奏型", out
        assert out["cardAnchors"]["audio"] == "音频跟练与测速", out
        assert out["audioTitle"] == "音频跟练与测速", out
        assert out["layout"]["panelOverflow"] is False, out
        assert out["layout"]["contentOverflow"] is False, out
        assert out["layout"]["pageOverflow"] is False, out
        assert out["layout"]["maxCardRight"] <= out["layout"]["contentRight"] + 1, out
        assert out["settingsOpen"] is True, out

        shot_top = tempfile.NamedTemporaryFile(prefix=f"gs_020_{WIDTH}_top_", suffix=".png", delete=False)
        shot_top.close()
        data = cdp.cmd("Page.captureScreenshot", {"format": "png"})["result"]["data"]
        Path(shot_top.name).write_bytes(base64.b64decode(data))
        out["screenshot_top"] = shot_top.name

        # 滚到定时卡，检查“高级练习”卡片与 6 个快捷档的一行布局
        cdp.ev("""
(() => {
  const m = document.querySelector('guitar-metronome');
  const c = m.shadowRoot.querySelector('.settings-content');
  const t = m.shadowRoot.getElementById('timerPresets');
  c.scrollTop = t.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 90;
  return c.scrollTop;
})()
""")
        time.sleep(0.2)
        shot_mid = tempfile.NamedTemporaryFile(prefix=f"gs_020_{WIDTH}_timer_", suffix=".png", delete=False)
        shot_mid.close()
        data = cdp.cmd("Page.captureScreenshot", {"format": "png"})["result"]["data"]
        Path(shot_mid.name).write_bytes(base64.b64decode(data))
        out["screenshot_timer"] = shot_mid.name

        # 滚到底部再截一张，检查节奏型 / 音频卡片
        cdp.ev("""
(() => {
  const m = document.querySelector('guitar-metronome');
  const c = m.shadowRoot.querySelector('.settings-content');
  c.scrollTop = c.scrollHeight;
  return c.scrollTop;
})()
""")
        time.sleep(0.2)
        shot_bottom = tempfile.NamedTemporaryFile(prefix=f"gs_020_{WIDTH}_bottom_", suffix=".png", delete=False)
        shot_bottom.close()
        data = cdp.cmd("Page.captureScreenshot", {"format": "png"})["result"]["data"]
        Path(shot_bottom.name).write_bytes(base64.b64decode(data))
        out["screenshot_bottom"] = shot_bottom.name

        # 滚到底部后关闭再打开，设置内容应回到顶部
        out["reopenScroll"] = cdp.ev("""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const mr = document.querySelector('guitar-metronome').shadowRoot;
  const content = mr.getElementById('settingsContent');
  const before = content.scrollTop;
  mr.getElementById('btnCloseSettings').click();
  await sleep(180);
  mr.getElementById('btnSettings').click();
  await sleep(220);
  return { before, after: content.scrollTop };
})()
""")
        assert out["reopenScroll"]["before"] > 0, out
        assert out["reopenScroll"]["after"] == 0, out

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
