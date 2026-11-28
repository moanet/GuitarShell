#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_026.py
# 0.1.21d 浏览器回归：调音器底部安全区、A4 快捷档、统一开关与自绘音高选择器
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
HEIGHT = int(os.environ.get("GS_HEIGHT", "900"))
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
        path = Path(tempfile.gettempdir()) / f"gs_026_{WIDTH}x{HEIGHT}_{THEME}_{name}.png"
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
            "width": WIDTH, "height": HEIGHT, "deviceScaleFactor": 1, "mobile": True,
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
      stringHeight: Math.round(sr.querySelector('.string-btn:not(.auto)').getBoundingClientRect().height),
      stringRadius: getComputedStyle(sr.querySelector('.string-btn:not(.auto)')).borderRadius,
      stringNumFont: getComputedStyle(sr.querySelector('.string-num')).fontSize,
      centsLabelFont: getComputedStyle(sr.querySelector('.cents-label')).fontSize,
      settingsFont: getComputedStyle($('openSettings')).fontSize,
      settingsWeight: getComputedStyle($('openSettings')).fontWeight,
      a4Font: getComputedStyle($('a4Status')).fontSize,
      settingsRect: (() => { const r = $('openSettings').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })(),
      startRect: (() => { const r = $('btnToggle').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })(),
      displayHeight: Math.round(sr.querySelector('.display-area').getBoundingClientRect().height),
      bottomGap: Math.round(window.innerHeight - $('btnToggle').getBoundingClientRect().bottom),
      titleToNote: Math.round($('noteName').getBoundingClientRect().top - $('tuningName').getBoundingClientRect().bottom),
      live: (() => {
        const status = $('statusText').getBoundingClientRect();
        const freq = $('freqVal').getBoundingClientRect();
        const meter = sr.querySelector('.meter-wrap').getBoundingClientRect();
        return {
          text: $('statusText').textContent.trim(),
          gapAfterFreq: Math.round(status.top - freq.bottom),
          aboveMeter: status.bottom <= meter.top,
          align: getComputedStyle($('statusText')).textAlign,
          centerOffset: Math.round(Math.abs((status.left + status.width / 2) - (container.getBoundingClientRect().left + container.clientWidth / 2))),
          height: Math.round(status.height),
        };
      })(),
      spacing: (() => {
        const cents = sr.querySelector('.cents-wrap').getBoundingClientRect();
        const strings = sr.querySelector('.strings-row').getBoundingClientRect();
        const start = $('btnToggle').getBoundingClientRect();
        return {
          centsToStrings: Math.round(strings.top - cents.bottom),
          stringsToActions: Math.round(start.top - strings.bottom),
        };
      })(),
      meter: (() => {
        const r = sr.querySelector('.meter-wrap').getBoundingClientRect();
        return { top: Math.round(r.top), center: Math.round(r.top + r.height / 2), height: Math.round(r.height) };
      })(),
      actions: (() => {
        const srRect = $('openSettings').getBoundingClientRect();
        const stRect = $('btnToggle').getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        return {
          settingsText: $('openSettings').textContent.trim(),
          settingsCenterY: Math.round(srRect.top + srRect.height / 2),
          startCenterY: Math.round(stRect.top + stRect.height / 2),
          startCenterOffset: Math.round(Math.abs((stRect.left + stRect.width / 2) - (cRect.left + cRect.width / 2))),
        };
      })(),
      autoLines: (() => {
        const auto = sr.querySelector('.string-btn.auto');
        const range = document.createRange();
        range.selectNodeContents(auto);
        return range.getClientRects().length;
      })(),
    },
  };

  state.layout.screenCenter = Math.round(window.innerHeight / 2);
  state.layout.meterCenterOffset = Math.round(Math.abs(state.layout.meter['center'] - state.layout.screenCenter));
  state.layout.settingsLeftOfStart = state.layout.settingsRect.left < state.layout.startRect.left;
  state.layout.actionsSameRow = Math.abs(state.layout.actions.settingsCenterY - state.layout.actions.startCenterY) <= 2;
  const topPadding = parseFloat(getComputedStyle(container).paddingTop);
  state.layout.topPadding = topPadding;
  state.layout.headOffset = state.layout.headTop - state.layout.containerTop;

  // 打开调音设置：三项分区、自绘预设下拉、两行调弦、A4 单行
  $('openSettings').click();
  await sleep(260);
  state.settingsOpen = !!sr.querySelector('.settings-mask.show');
  state.settingsSections = sr.querySelectorAll('.sheet-section').length;
  state.sheet = {
    width: Math.round($('settingsSheet').getBoundingClientRect().width),
    eyebrow: !!sr.querySelector('.sheet-eyebrow'),
    overflow: $('settingsSheet').scrollWidth > $('settingsSheet').clientWidth + 1,
    doneHeight: Math.round($('settingsDone').getBoundingClientRect().height),
    doneText: $('settingsDone')?.textContent.trim(),
    hasClose: !!$('closeSettings'),
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
  state.switchSize = (() => {
    const track = sr.querySelector('.switch-row[aria-pressed="true"] .switch-track');
    const r = track.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  })();
  state.a4Row = {
    hasReset: !!$('a4Reset'),
    hasQuick: !!sr.querySelector('.a4-quick'),
    sameRow: Math.abs(
      (sr.querySelector('.a4-quick').getBoundingClientRect().top + sr.querySelector('.a4-quick').getBoundingClientRect().bottom) / 2
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
  sr.querySelector('.mini-chip[data-a4="440"]').click();
  await sleep(160);
  state.a4Back = { hidden: !!$('a4Status')?.hidden, sheet: $('a4SheetVal')?.textContent.trim() };
  $('settingsDone').click();
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
    noteButtons: sr.querySelectorAll('#customNotes .note-field-btn').length,
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

  // 音高选择器：应用内底部弹层，先验证返回层级，再逐弦选 E2
  $('customNote0').click();
  await sleep(180);
  state.notePicker = {
    open: $('notePickerMask')?.classList.contains('show'),
    title: $('notePickerTitle')?.textContent.trim(),
    options: $('notePickerList')?.querySelectorAll('.note-option').length,
    active: $('notePickerList')?.querySelectorAll('.note-option.active').length,
    selected: $('notePickerList')?.querySelector('.note-option.active')?.textContent.trim(),
    nativeSelects: sr.querySelectorAll('select').length,
  };
  window.dispatchEvent(new Event('gs-back-request'));
  await sleep(180);
  state.backFromPicker = {
    pickerOpen: $('notePickerMask')?.classList.contains('show'),
    editorOpen: !$('customEditor')?.hidden,
    settingsOpen: !!sr.querySelector('.settings-mask.show'),
  };

  $('customName').value = '重复 E';
  for (let slot = 0; slot < 6; slot++) {
    $(`customNote${slot}`).click();
    await sleep(120);
    $('notePickerList').querySelector('.note-option[data-note="E2"]').click();
    await sleep(160);
  }
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
  $('settingsDone').click();
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

        check("版本为 v0.1.27", out["version"] == "v0.1.27", out["version"])
        check("默认调弦名常驻", out["default"]["name"] == "标准调弦", out["default"]["name"])
        check("A4 440 默认不显示", out["default"]["a4Hidden"] and out["default"]["a4Text"] == "", out["default"])
        check("默认六弦音名", out["default"]["notes"] == ["E", "A", "D", "G", "B", "e"], str(out["default"]["notes"]))
        check("弦位序号 6–1", out["default"]["nums"] == ["6", "5", "4", "3", "2", "1"], str(out["default"]["nums"]))
        check("主按钮文案为开始调音", out["default"]["buttonText"] == "开始调音", out["default"]["buttonText"])
        check("移除单独标准音按钮", not out["default"]["hasRefButton"])
        check("主界面无横向溢出", not out["layout"]["containerOverflow"], f"{out['layout']['width']}/{out['layout']['scrollWidth']}")
        check("顶部标题下压贴近大读数", 44 <= out["layout"]["headOffset"] <= 54 and -12 <= out["layout"]["titleToNote"] <= -4, f"offset={out['layout']['headOffset']} titleToNote={out['layout']['titleToNote']}")
        check("调弦名放大到 19px", out["layout"]["headFont"] == "19px", out["layout"]["headFont"])
        check("调音器主界面字号收口", out["layout"]["settingsFont"] == "14px" and out["layout"]["settingsWeight"] == "700" and out["layout"]["stringNumFont"] == "10px" and out["layout"]["centsLabelFont"] == "10px" and out["layout"]["a4Font"] == "14px", str({k: out["layout"][k] for k in ("settingsFont", "settingsWeight", "stringNumFont", "centsLabelFont", "a4Font")}))
        check("弦位按钮 44 高 / 14 圆角", out["layout"]["stringHeight"] == 44 and out["layout"]["stringRadius"] == "14px", f"{out['layout']['stringHeight']} / {out['layout']['stringRadius']}")
        check("设置按钮与节拍器同尺寸", out["layout"]["settingsRect"]["width"] == 72 and out["layout"]["settingsRect"]["height"] == 44 and out["layout"]["actions"]["settingsText"] == "设置", f"{out['layout']['settingsRect']} / {out['layout']['actions']['settingsText']}")
        check("设置按钮位于开始调音左侧", out["layout"]["settingsLeftOfStart"] and out["layout"]["actionsSameRow"], f"{out['layout']['settingsRect']} / {out['layout']['startRect']}")
        check("开始调音缩窄并水平居中", 140 <= out["layout"]["startRect"]["width"] <= 150 and out["layout"]["actions"]["startCenterOffset"] <= 2, f"{out['layout']['startRect']} / 偏移 {out['layout']['actions']['startCenterOffset']}")
        check("读数区固定高度", 150 <= out["layout"]["displayHeight"] <= 222, out["layout"]["displayHeight"])
        check("仪表盘回到视觉中心", out["layout"]["meterCenterOffset"] <= 12, f"仪表中心 {out['layout']['meter']['center']} / 屏幕中心 {out['layout']['screenCenter']}")
        check("按钮组紧跟弦位行", 11 <= out["layout"]["spacing"]["stringsToActions"] <= 13 and out["layout"]["bottomGap"] >= 150, f"间距={out['layout']['spacing']['stringsToActions']} 底距={out['layout']['bottomGap']}")
        check("按钮组与音分到弦位间距一致", abs(out["layout"]["spacing"]["stringsToActions"] - out["layout"]["spacing"]["centsToStrings"]) <= 1, str(out["layout"]["spacing"]))
        check("删除静态提示文案", out["layout"]["live"]["text"] == "", str(out["layout"]["live"]))
        check("实时反馈位于频率与仪表之间", 6 <= out["layout"]["live"]["gapAfterFreq"] <= 10 and out["layout"]["live"]["aboveMeter"] and out["layout"]["live"]["align"] == "center" and out["layout"]["live"]["centerOffset"] <= 2, str(out["layout"]["live"]))
        check("自动按钮不折行", out["layout"]["autoLines"] == 1, out["layout"]["autoLines"])
        check("设置面板打开", out["settingsOpen"])
        check("调音设置三分区", out["settingsSections"] == 3, str(out["settingsSections"]))
        check("设置面板 90% / 最大 400", abs(out["sheet"]["width"] - min(400, out["layout"]["width"] * 0.9)) <= 2, f"{out['sheet']['width']} / 源宽 {out['layout']['width']}")
        check("去掉 TUNER SETTINGS 眉标", not out["sheet"]["eyebrow"])
        check("设置面板无横向溢出", not out["sheet"]["overflow"])
        check("调音设置去掉右上角 X", not out["sheet"]["hasClose"])
        check("设置弹层底部完成为 46", out["sheet"]["doneHeight"] == 46 and out["sheet"]["doneText"] == "完成", str(out["sheet"]))
        check("预设下拉默认收起", out["presetMenuHidden"])
        check("点击字段展开自绘下拉", out["presetMenu"]["open"] and out["presetMenu"]["expanded"] == "true", str(out["presetMenu"]))
        check("五个预设选项", len(out["presetMenu"]["options"]) == 5 and out["customEntry"], str(out["presetMenu"]["options"]))
        check("返回键先收起预设下拉", out["backFromMenu"]["menuHidden"] and out["backFromMenu"]["settingsOpen"], str(out["backFromMenu"]))
        check("A4 去掉恢复 440", out["a4Steps"] == 2 and not out["a4Row"]["hasReset"] and out["a4Row"]["hasQuick"], f"a4={out['a4Steps']} {out['a4Row']}")
        check("A4 快捷档与步进同处一行", out["a4Row"]["sameRow"], str(out["a4Row"]))
        check("调音设置仍为两个反馈开关", out["feedbackRows"] == 2, str(out["feedbackRows"]))
        check("开关尺寸与节拍器统一", out["switchSize"]["w"] == 44 and out["switchSize"]["h"] == 26, str(out["switchSize"]))
        check("Drop D 切换生效", out["dropD"]["name"] == "Drop D" and out["dropD"]["notes"] == ["D", "A", "D", "G", "B", "e"] and out["dropD"]["saved"] == "drop-d", str(out["dropD"]))
        check("A4 442 偏离时无圆点文案", not out["a4Off"]["hidden"] and out["a4Off"]["text"] == "A4 442" and out["a4Off"]["sheet"] == "442", str(out["a4Off"]))
        check("A4 440 快捷档可恢复", out["a4Back"]["hidden"] and out["a4Back"]["sheet"] == "440", str(out["a4Back"]))
        check("点弦选中 slot 5", out["stringClick"]["active"] and out["stringClick"]["slot"] == 5, str(out["stringClick"]))
        check("点弦进入标准音试听", "第1弦" in out["stringClick"]["status"], out["stringClick"]["status"])
        check("试听约 1 秒后自动收束", not out["stringClick"]["after"]["playing"] and not out["stringClick"]["after"]["isPlayingRef"], str(out["stringClick"]["after"]))
        check("点弦后仍无单独标准音按钮", not out["stringClick"]["hasRefButton"])
        check("自定义编辑器为六个自绘音高按钮", out["customEditor"]["open"] and out["customEditor"]["noteButtons"] == 6 and out["customEditor"]["selects"] == 0, str(out["customEditor"]))
        check("音高选择器为应用内弹层", out["notePicker"]["open"] and out["notePicker"]["title"] == "第6弦音高" and out["notePicker"]["options"] == 39 and out["notePicker"]["active"] == 1, str(out["notePicker"]))
        check("返回键先关音高选择器", not out["backFromPicker"]["pickerOpen"] and out["backFromPicker"]["editorOpen"] and out["backFromPicker"]["settingsOpen"], str(out["backFromPicker"]))
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
        cdp.ev("document.querySelector('guitar-tuner')?.shadowRoot?.getElementById('customNote0')?.click(); true")
        time.sleep(0.25)
        print(" ", cdp.shot("tuner_note_picker"))

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
