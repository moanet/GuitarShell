#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_025.py
# 0.1.18 浏览器回归：节拍器 BPM 圆盘非线性映射、刻度与中心输入
#
# 用法（仓库根目录）：
#   python tests/browser/gs_025.py
#   GS_WIDTH=320 python tests/browser/gs_025.py
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
PORT = int(os.environ.get("GS_CDP_PORT", "9368"))
WIDTH = int(os.environ.get("GS_WIDTH", "360"))
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
    profile = tempfile.mkdtemp(prefix="gs-browser-025-")
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
        cdp.cmd("Page.reload")
        time.sleep(0.4)
        for _ in range(80):
            if cdp.ev("!!document.querySelector('guitar-metronome')?.shadowRoot"):
                break
            time.sleep(0.25)

        out = cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  document.querySelector('.tab-btn[data-target="view-metronome"]').click();
  await sleep(260);
  const m = document.querySelector('guitar-metronome');
  const mr = m.shadowRoot;
  const $ = (id) => mr.getElementById(id);
  const wrap = $('knobWrap');
  const canvas = $('knobCanvas');
  const input = $('bpmInput');
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const r = Math.min(rect.width, rect.height) / 2 - Math.min(rect.width, rect.height) * 0.12;

  const pressAt = (relDeg) => {
    const a = (135 + relDeg) * Math.PI / 180;
    const opts = {
      bubbles: true, cancelable: true, clientX: cx + Math.cos(a) * r,
      clientY: cy + Math.sin(a) * r, pointerId: 77, pointerType: 'touch',
      isPrimary: true, buttons: 1
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
    wrap.dispatchEvent(new PointerEvent('pointerup', opts));
    return Number(input.value);
  };

  const anchors = [
    [30, 0], [60, 34], [90, 78], [120, 135],
    [150, 192], [180, 236], [250, 270]
  ];
  const at = {};
  for (const [bpm, deg] of anchors) at[bpm] = pressAt(deg);

  const samples = [];
  for (let d = 0; d <= 270; d += 5) samples.push(pressAt(d));
  const monotonic = samples.every((v, i) => i === 0 || v >= samples[i - 1]);

  input.value = '120';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const plus = $('knobPlus');
  const minus = $('knobMinus');
  plus.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  const afterPlus = Number(input.value);
  minus.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  const afterMinus = Number(input.value);

  input.value = '250';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = '30';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const typedLow = Number(input.value);

  // 在 30 标签位置取一小块像素，确认环外刻度/文字确实画到了画布上。
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / rect.width;
  const lineW = Math.max(10, r * 0.13);
  const labelR = r + lineW * 1.45;
  const la = 135 * Math.PI / 180;
  const lx = (rect.width / 2 + Math.cos(la) * labelR) * dpr;
  const ly = (rect.height / 2 + Math.sin(la) * labelR) * dpr;
  const box = ctx.getImageData(Math.max(0, Math.floor(lx - 12 * dpr)), Math.max(0, Math.floor(ly - 8 * dpr)), Math.floor(24 * dpr), Math.floor(16 * dpr)).data;
  let labelPixels = 0;
  for (let i = 3; i < box.length; i += 4) if (box[i] > 0) labelPixels++;

  input.value = '120';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(30);
  const finalBpm = Number(input.value);

  const play = mr.querySelector('.play-in-knob').getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  return {
    version: document.querySelector('.version-chip')?.textContent.trim() || '',
    width: innerWidth,
    canvas: { w: Math.round(canvasRect.width), h: Math.round(canvasRect.height), dpr },
    at,
    anchors,
    samples: { first: samples[0], last: samples[samples.length - 1], count: samples.length, monotonic },
    center: { afterPlus, afterMinus, typedLow, finalBpm },
    labelPixels,
    play: { top: Math.round(play.top), left: Math.round(play.left), w: Math.round(play.width) },
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    canvasInsideWrap: canvasRect.top >= wrap.getBoundingClientRect().top - 1 &&
      canvasRect.bottom <= wrap.getBoundingClientRect().bottom + 1
  };
})()
""")

        assert out["version"] == "v0.1.21b", out
        assert out["canvas"]["w"] > 200, out
        for bpm, deg in out["anchors"]:
            assert abs(out["at"][str(bpm)] - bpm) <= 1, (bpm, out["at"], out)
        assert out["samples"]["first"] == 30, out
        assert out["samples"]["last"] == 250, out
        assert out["samples"]["monotonic"] is True, out
        assert out["at"]["120"] == 120, out
        assert out["center"]["afterPlus"] == 121, out
        assert out["center"]["afterMinus"] == 120, out
        assert out["center"]["typedLow"] == 30, out
        assert out["center"]["finalBpm"] == 120, out
        assert out["labelPixels"] > 3, out
        assert out["overflow"] is False, out
        assert out["canvasInsideWrap"] is True, out
        assert (192 - 78) / (34 - 0) >= 3, out
        assert (236 - 34) / 270 >= 0.70, out

        shot = tempfile.NamedTemporaryFile(prefix=f"gs_025_{WIDTH}_dial_", suffix=".png", delete=False)
        shot.close()
        data = cdp.cmd("Page.captureScreenshot", {"format": "png"})["result"]["data"]
        Path(shot.name).write_bytes(base64.b64decode(data))
        out["screenshot"] = shot.name

        print(json.dumps(out, ensure_ascii=False, indent=2))
        print(f"[PASS] BPM 圆盘非线性映射 — 120 在顶部，60–180 覆盖 {round((236-34)/270*100, 1)}%")
        print(f"[PASS] 锚点取整误差 ≤ 1 BPM — {out['at']}")
        print(f"[PASS] 全弧单调递增 — {out['samples']['first']} → {out['samples']['last']}")
        print(f"[PASS] 中心输入与 ± 步进 — {out['center']}")
        print(f"[PASS] 环外标签像素 — {out['labelPixels']}")
        print(f"[PASS] {WIDTH} 宽无横向溢出")
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
