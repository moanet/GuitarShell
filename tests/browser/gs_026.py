#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_026.py
# 0.1.21 浏览器回归：调音器顶部状态、底部动作行、调音设置两行调弦与 A4 单行
#
# 用法（仓库根目录）：
#   python tests/browser/gs_026.py
#   GS_WIDTH=320 python tests/browser/gs_026.py
#   GS_THEME=light python tests/browser/gs_026.py
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
PORT = int(os.environ.get("GS_CDP_PORT", "9369"))
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

FAILS = []


def check(name, ok, detail=""):
    if ok:
        print(f"[PASS] {name}" + (f" — {detail}" if detail else ""))
    else:
        print(f"[FAIL] {name}" + (f" — {detail}" if detail else ""))
        FAILS.append(name)


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
            "expression": expression, "returnByValue": True, "awaitPromise": True,
        })["result"]
        if res.get("exceptionDetails"):
            raise RuntimeError(json.dumps(res["exceptionDetails"], ensure_ascii=False))
        return res.get("result", {}).get("value")

    def shot(self, name):
        path = Path(tempfile.gettempdir()) / f"gs_026_{WIDTH}_{THEME}_{name}.png"
        data = self.cmd("Page.captureScreenshot", {"format": "png"})["result"]["data"]
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
    profile = tempfile.mkdtemp(prefix="gs-browser-026-")
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
            if cdp.ev("!!document.querySelector('guitar-tuner')?.shadowRoot"):
                break
            time.sleep(0.25)

        cdp.ev(f"""
(() => {{
  localStorage.clear();
  localStorage.setItem('gs_theme', '{THEME}');
  document.documentElement.dataset.theme = '{THEME}';
  document.documentElement.style.colorScheme = '{COLOR_SCHEME}';
  return document.documentElement.dataset.theme;
}})()
""")
        cdp.cmd("Page.reload")
        time.sleep(0.4)
        for _ in range(80):
            if cdp.ev("!!document.querySelector('guitar-tuner')?.shadowRoot"):
                break
            time.sleep(0.25)

        out = cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const errors = [];
  window.__gsErrs = errors;
  window.addEventListener('error', e => errors.push(String(e.message || e.error)));
  document.querySelector('.tab-btn[data-target="view-tuner"]').click();
  await sleep(280);
  const tuner = document.querySelector('guitar-tuner');
  const sr = tuner.shadowRoot;
  const $ = (id) => sr.getElementById(id);
  const container = sr.querySelector('.container');

  const state = {
    version: document.querySelector('#appVersion')?.textContent.trim() || '',
    default: {
      name: $('tuningName')?.textContent.trim(),
      a4Hidden: !!$('a4Status')?.hidden,
      a4Text: $('a4Status')?.textContent.trim(),
      notes: [...sr.querySelectorAll('.string-btn:not(.auto) .string-note')].map(n => n.textContent.trim()),
      nums: [...sr.querySelectorAll('.string-num')].map(n => n.textContent.trim()),
      buttonText: $('btnToggle')?.textContent.trim(),
      hasRefButton: !!$('refTone'),
      slots: [...sr.querySelectorAll('.string-btn')].length,
    },
    layout: {
      containerOverflow: container.scrollWidth > container.clientWidth + 1,
      width: container.clientWidth,
      scrollWidth: container.scrollWidth,
      stringWidths: [...sr.querySelectorAll('.string-btn')].map(b => Math.round(b.getBoundingClientRect().width)),
      containerTop: Math.round(container.getBoundingClientRect().top),
      headTop: Math.round($('tuningName').getBoundingClientRect().top),
      headFont: getComputedStyle($('tuningName')).fontSize,
      settingsRect: (() => { const r = $('openSettings').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })(),
      startRect: (() => { const r = $('btnToggle').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })(),
    },
  };

  // 设置入口已移到底部动作行，主界面从顶部起排
  const topPadding = parseFloat(getComputedStyle(container).paddingTop);
  state.layout.headOffset = state.layout.headTop - state.layout.containerTop;
  state.layout.topPadding = topPadding;
  state.layout.settingsLeftOfStart = state.layout.settingsRect.left < state.layout.startRect.left;
  state.layout.actionsSameRow = Math.abs(state.layout.settingsRect.top - state.layout.startRect.top) <= 2;
  state.layout.startFlexible = state.layout.startRect.width > state.layout.settingsRect.width * 1.5;
  state.layout.displayFlex = getComputedStyle(sr.querySelector('.display-area')).flexGrow;

  // 打开调音设置：三项分区、自绘预设下拉、两行调弦、A4 单行
  $('openSettings').click();
  await sleep(260);
  state.settingsOpen = !!sr.querySelector('.settings-mask.show');
  state.settingsSections = sr.querySelectorAll('.sheet-section').length;
  state.sheet = {
    width: Math.round($('settingsSheet').getBoundingClientRect().width),
    eyebrow: !!sr.querySelector('.sheet-eyebrow'),
    overflow: $('settingsSheet').scrollWidth > $('settingsSheet').clientWidth + 1,
  };
  state.presetMenuHidden = $('presetMenu')?.hidden;
  $('presetField').click();
  await sleep(160);
  state.presetMenu = {
    open: !$('presetMenu')?.hidden,
    expanded: $('presetField')?.getAttribute('aria-expanded'),
    fieldName: $('presetFieldName')?.textContent.trim(),
    options: [...sr.querySelectorAll('.preset-option .preset-name')].map(n => n.textContent.trim()),
  };
  window.dispatchEvent(new Event('gs-back-request'));
  await sleep(160);
  state.backFromMenu = {
    menuHidden: !!$('presetMenu')?.hidden,
    settingsOpen: !!sr.querySelector('.settings-mask.show'),
  };
  $('presetField').click();
  await sleep(140);
  state.customEntry = !!$('customEntry');
  state.a4Steps = ['a4SheetMinus', 'a4SheetPlus'].filter(id => $(id) ? true : false).length;
  state.feedbackRows = sr.querySelectorAll('.switch-row').length;
  state.a4Row = {
    resetTop: Math.round($('a4Reset').getBoundingClientRect().top),
    minusTop: Math.round($('a4SheetMinus').getBoundingClientRect().top),
    sameRow: Math.abs(
      ($('a4Reset').getBoundingClientRect().top + $('a4Reset').getBoundingClientRect().bottom) / 2
      - ($('a4SheetMinus').getBoundingClientRect().top + $('a4SheetMinus').getBoundingClientRect().bottom) / 2
    ) <= 3,
  };

  // 预设切换：标准 -> Drop D
  sr.querySelector('.preset-option[data-preset="drop-d"]').click();
  await sleep(220);
  state.dropD = {
    name: $('tuningName')?.textContent.trim(),
    notes: [...sr.querySelectorAll('.string-btn:not(.auto) .string-note')].map(n => n.textContent.trim()),
    saved: localStorage.getItem('guitar_tuner_preset'),
  };

  // A4 442：偏离 440 时状态条显示，设置里可恢复
  sr.querySelector('.mini-chip[data-a4="442"]').click();
  await sleep(180);
  state.a4Off = {
    hidden: !!$('a4Status')?.hidden,
    text: $('a4Status')?.textContent.trim(),
    sheet: $('a4SheetVal')?.textContent.trim(),
  };
  $('a4Reset').click();
  await sleep(160);
  state.a4Reset = { hidden: !!$('a4Status')?.hidden, sheet: $('a4SheetVal')?.textContent.trim() };
  $('closeSettings').click();
  await sleep(260);

  // 点弦：选中 slot 5 并进入试听；不再有单独标准音按钮
  const highE = sr.querySelector('.string-btn[data-slot="5"]');
  highE.click();
  await sleep(120);
  state.stringClick = {
    active: highE.classList.contains('active'),
    slot: tuner.targetSlot,
    playing: highE.classList.contains('playing'),
    status: $('statusText')?.textContent.trim(),
    hasRefButton: !!$('refTone'),
  };
  await sleep(1400);
  state.stringClick.after = {
    playing: highE.classList.contains('playing'),
    isPlayingRef: tuner.isPlayingRef,
    status: $('statusText')?.textContent.trim(),
  };
  sr.querySelector('.string-btn[data-slot="auto"]').click();
  await sleep(120);

  // 自定义调弦：保存六根重复 E2，验证按弦位而不是音名建目标
  $('openSettings').click();
  await sleep(220);
  $('customEntry').click();
  await sleep(160);
  state.customEditor = {
    open: !$('customEditor')?.hidden,
    selects: sr.querySelectorAll('#customNotes select').length,
  };

  // 原生返回：编辑器先退回设置主页，再关闭整个调音设置
  window.dispatchEvent(new Event('gs-back-request'));
  await sleep(160);
  state.backFromEditor = {
    editorHidden: !!$('customEditor')?.hidden,
    settingsOpen: !!sr.querySelector('.settings-mask.show'),
  };
  window.dispatchEvent(new Event('gs-back-request'));
  await sleep(240);
  state.backFromSettings = {
    settingsOpen: !!sr.querySelector('.settings-mask.show'),
    hidden: !!$('settingsMask')?.hidden,
  };
  $('openSettings').click();
  await sleep(220);
  $('customEntry').click();
  await sleep(160);

  const nameInput = $('customName');
  nameInput.value = '重复 E';
  sr.querySelectorAll('#customNotes select').forEach(sel => { sel.value = 'E2'; });
  $('customSave').click();
  await sleep(320);
  state.custom = {
    name: $('tuningName')?.textContent.trim(),
    notes: [...sr.querySelectorAll('.string-btn:not(.auto) .string-note')].map(n => n.textContent.trim()),
    targets: tuner.targets.map(t => t.name),
    saved: localStorage.getItem('guitar_tuner_preset'),
    customSaved: !!localStorage.getItem('guitar_tuner_custom'),
  };

  // 回到标准调弦，便于截图
  $('openSettings').click();
  await sleep(220);
  sr.querySelector('.preset-option[data-preset="standard"]').click();
  await sleep(180);
  $('closeSettings').click();
  await sleep(260);
  state.backToStandard = {
    name: $('tuningName')?.textContent.trim(),
    notes: [...sr.querySelectorAll('.string-btn:not(.auto) .string-note')].map(n => n.textContent.trim()),
  };
  state.errors = errors;
  return state;
})()
""")

        print(json.dumps(out, ensure_ascii=False, indent=2))

        check("版本为 v0.1.21", out["version"] == "v0.1.21", out["version"])
        check("默认调弦名常驻", out["default"]["name"] == "标准调弦", out["default"]["name"])
        check("A4 440 默认不显示", out["default"]["a4Hidden"] and out["default"]["a4Text"] == "", out["default"])
        check("默认六弦音名", out["default"]["notes"] == ["E", "A", "D", "G", "B", "e"], str(out["default"]["notes"]))
        check("弦位序号 6–1", out["default"]["nums"] == ["6", "5", "4", "3", "2", "1"], str(out["default"]["nums"]))
        check("主按钮文案为开始调音", out["default"]["buttonText"] == "开始调音", out["default"]["buttonText"])
        check("移除单独标准音按钮", not out["default"]["hasRefButton"])
        check("主界面无横向溢出", not out["layout"]["containerOverflow"], f"{out['layout']['width']}/{out['layout']['scrollWidth']}")
        check("主界面从顶部起排", out["layout"]["headOffset"] <= out["layout"]["topPadding"] + 8, f"offset={out['layout']['headOffset']} pad={out['layout']['topPadding']}")
        check("调弦名放大到 19px", out["layout"]["headFont"] == "19px", out["layout"]["headFont"])
        check("设置入口在底部且位于开始调音左侧", out["layout"]["settingsLeftOfStart"] and out["layout"]["actionsSameRow"], f"{out['layout']['settingsRect']} / {out['layout']['startRect']}")
        check("开始调音吸收剩余宽度", out["layout"]["startFlexible"], f"{out['layout']['settingsRect']['width']} / {out['layout']['startRect']['width']}")
        check("读数区弹性吸收高度", out["layout"]["displayFlex"] == "1", out["layout"]["displayFlex"])
        check("设置面板打开", out["settingsOpen"])
        check("调音设置三分区", out["settingsSections"] == 3, str(out["settingsSections"]))
        check("设置面板 90% / 最大 400", abs(out["sheet"]["width"] - min(400, out["layout"]["width"] * 0.9)) <= 2, f"{out['sheet']['width']} / 源宽 {out['layout']['width']}")
        check("去掉 TUNER SETTINGS 眉标", not out["sheet"]["eyebrow"])
        check("设置面板无横向溢出", not out["sheet"]["overflow"])
        check("预设下拉默认收起", out["presetMenuHidden"])
        check("点击字段展开自绘下拉", out["presetMenu"]["open"] and out["presetMenu"]["expanded"] == "true", str(out["presetMenu"]))
        check("五个预设选项", len(out["presetMenu"]["options"]) == 5 and out["customEntry"], str(out["presetMenu"]["options"]))
        check("返回键先收起预设下拉", out["backFromMenu"]["menuHidden"] and out["backFromMenu"]["settingsOpen"], str(out["backFromMenu"]))
        check("A4 按钮与恢复同处一行", out["a4Steps"] == 2 and out["a4Row"]["sameRow"] and out["feedbackRows"] == 2, f"a4={out['a4Steps']} fb={out['feedbackRows']} {out['a4Row']}")
        check("Drop D 切换生效", out["dropD"]["name"] == "Drop D" and out["dropD"]["notes"] == ["D", "A", "D", "G", "B", "e"] and out["dropD"]["saved"] == "drop-d", str(out["dropD"]))
        check("A4 442 偏离时无圆点文案", not out["a4Off"]["hidden"] and out["a4Off"]["text"] == "A4 442" and out["a4Off"]["sheet"] == "442", str(out["a4Off"]))
        check("A4 恢复 440 后隐藏", out["a4Reset"]["hidden"] and out["a4Reset"]["sheet"] == "440", str(out["a4Reset"]))
        check("点弦选中 slot 5", out["stringClick"]["active"] and out["stringClick"]["slot"] == 5, str(out["stringClick"]))
        check("点弦进入标准音试听", "第1弦" in out["stringClick"]["status"], out["stringClick"]["status"])
        check("试听约 1 秒后自动收束", not out["stringClick"]["after"]["playing"] and not out["stringClick"]["after"]["isPlayingRef"], str(out["stringClick"]["after"]))
        check("点弦后仍无单独标准音按钮", not out["stringClick"]["hasRefButton"])
        check("自定义编辑器六弦选择器", out["customEditor"]["open"] and out["customEditor"]["selects"] == 6, str(out["customEditor"]))
        check("返回键先退出自定义编辑器", out["backFromEditor"]["editorHidden"] and out["backFromEditor"]["settingsOpen"], str(out["backFromEditor"]))
        check("再按返回键关闭调音设置", not out["backFromSettings"]["settingsOpen"] and out["backFromSettings"]["hidden"], str(out["backFromSettings"]))
        check("自定义重复音高按 slot 建目标", out["custom"]["name"] == "重复 E" and out["custom"]["targets"] == ["E2"] * 6 and out["custom"]["notes"] == ["E"] * 6, str(out["custom"]))
        check("自定义调弦持久化", out["custom"]["saved"] == "custom" and out["custom"]["customSaved"], str(out["custom"]))
        check("回到标准调弦", out["backToStandard"]["name"] == "标准调弦" and out["backToStandard"]["notes"] == ["E", "A", "D", "G", "B", "e"], str(out["backToStandard"]))
        check("运行期无异常", not out["errors"], json.dumps(out["errors"], ensure_ascii=False))

        print("截图：")
        print(" ", cdp.shot("tuner_main"))
        cdp.ev("document.querySelector('guitar-tuner')?.shadowRoot?.getElementById('openSettings')?.click(); true")
        time.sleep(0.3)
        print(" ", cdp.shot("tuner_settings"))
        cdp.ev("document.querySelector('guitar-tuner')?.shadowRoot?.getElementById('customEntry')?.click(); true")
        time.sleep(0.25)
        print(" ", cdp.shot("tuner_custom"))

        print(f"\n宽度 {WIDTH} / {THEME}：{'通过' if not FAILS else '失败 ' + str(len(FAILS))}")
        if FAILS:
            sys.exit(1)
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        if server:
            server.terminate()


if __name__ == "__main__":
    main()
