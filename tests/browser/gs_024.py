#!/usr/bin/env python3
# ==========================================
# tests/browser/gs_024.py
# 0.1.17 浏览器回归：Emoji 清理、线性图标、书架搜索行收口
#
# 依赖：
#   pip install websocket-client
#
# 用法（仓库根目录）：
#   python tests/browser/gs_024.py
#   GS_WIDTH=320 python tests/browser/gs_024.py
#   GS_THEME=light python tests/browser/gs_024.py
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
PORT = int(os.environ.get("GS_CDP_PORT", "9367"))
WIDTH = int(os.environ.get("GS_WIDTH", "360"))
THEME = os.environ.get("GS_THEME", "deep").lower()
if THEME not in ("deep", "light"):
    THEME = "deep"
COLOR_SCHEME = "light" if THEME == "light" else "dark"
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
        path = TMP / f"gs_024_{WIDTH}_{THEME}_{name}.png"
        path.write_bytes(base64.b64decode(data))
        return str(path)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


FAILS = []


def check(name, cond, detail=""):
    print(("[PASS] " if cond else "[FAIL] ") + name + (f" — {detail}" if detail != "" else ""))
    if not cond:
        FAILS.append(name)


def main():
    server = start_server()
    browser = pick_browser()
    profile = tempfile.mkdtemp(prefix="gs-browser-024-")
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
            if cdp.ev("!!document.querySelector('guitar-sheet-reader')?.shadowRoot?.getElementById('shelfView')"):
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
            if cdp.ev("!!document.querySelector('guitar-sheet-reader')?.shadowRoot?.getElementById('shelfView')"):
                break
            time.sleep(0.25)

        cdp.ev(r"""
window.__gsErrs = [];
window.addEventListener('error', e => window.__gsErrs.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', e => window.__gsErrs.push(String(e.reason && e.reason.stack || e.reason)));
""")

        out = cdp.ev(r"""
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const reader = document.querySelector('guitar-sheet-reader');
  const $ = (id) => reader.shadowRoot.getElementById(id);
  const out = {};

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
    return parts.join(' ');
  };
  const emojiHits = (root) => {
    const text = visibleText(root);
    const m = text.match(/\p{Extended_Pictographic}/gu);
    return { count: m ? m.length : 0, chars: m ? [...new Set(m)] : [] };
  };

  const db = await import('/js/services/db.js');
  await db.dbService.clearAllData();
  reader.loadShelf();
  await sleep(250);
  document.querySelector('.tab-btn[data-target="view-reader"]').click();
  await sleep(350);

  const txt = new File(['{title: 小星星}\n{artist: 传统}\n[C]一闪一闪亮晶晶 [Am]满天都是小星星\n'], '小星星.txt', { type: 'text/plain' });
  $('inputSingleFile').onchange({ target: { id: 'inputSingleFile', files: [txt], value: '' } });
  for (let i = 0; i < 40; i++) {
    if (reader.shadowRoot.querySelectorAll('.score-card').length) break;
    await sleep(120);
  }
  await sleep(300);

  const row = reader.shadowRoot.querySelector('.search-row');
  const importBtn = $('btnImportMain');
  const folderBtn = $('btnFolderMain');
  const search = $('searchInp');
  const sort = $('sortBtn');
  const cardsBefore = reader.shadowRoot.querySelectorAll('.score-card').length;

  search.value = 'gbq';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(220);
  const cardsFiltered = reader.shadowRoot.querySelectorAll('.score-card').length;
  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(220);
  const cardsRestored = reader.shadowRoot.querySelectorAll('.score-card').length;

  const sortMenu = $('sortMenu');
  sort.click();
  await sleep(120);
  const sortOpts = Array.from(sortMenu.querySelectorAll('.sort-opt'));
  const sortMenuOpen = !sortMenu.hidden && sortOpts.length === 3;
  const nativeSelect = !!reader.shadowRoot.querySelector('select');
  sortOpts.find((opt) => opt.dataset.sort === 'name').click();
  await sleep(260);
  const sortLabelName = $('sortLabel').textContent.trim();
  const sortMenuClosed = sortMenu.hidden;
  sort.click();
  await sleep(100);
  sortOpts.find((opt) => opt.dataset.sort === 'newest').click();
  await sleep(220);

  const tagRect = reader.shadowRoot.querySelector('.tag-chip').getBoundingClientRect();
  const manageRect = reader.shadowRoot.querySelector('.manage-btn').getBoundingClientRect();

  out.reader = {
    cardsBefore, cardsFiltered, cardsRestored,
    rowWidth: Math.round(row.getBoundingClientRect().width),
    rowScroll: row.scrollWidth,
    rowOverflow: row.scrollWidth > row.clientWidth + 1,
    importWidth: Math.round(importBtn.getBoundingClientRect().width),
    importHeight: Math.round(importBtn.getBoundingClientRect().height),
    importText: importBtn.textContent.trim(),
    importAria: importBtn.getAttribute('aria-label'),
    importSvg: !!importBtn.querySelector('svg'),
    folderDisplay: getComputedStyle(folderBtn).display,
    folderSvg: !!folderBtn.querySelector('svg'),
    placeholder: search.placeholder,
    searchWidth: Math.round(search.getBoundingClientRect().width),
    searchHeight: Math.round(search.getBoundingClientRect().height),
    sortWidth: Math.round(sort.getBoundingClientRect().width),
    sortHeight: Math.round(sort.getBoundingClientRect().height),
    sortMenuOpen, nativeSelect, sortLabelName, sortMenuClosed,
    tagTop: tagRect.top,
    manageTop: manageRect.top,
    filterPadding: getComputedStyle(reader.shadowRoot.querySelector('.filter-bar')).padding,
    shelfPadding: getComputedStyle(reader.shadowRoot.querySelector('.shelf-view')).padding,
    shelfGap: getComputedStyle(reader.shadowRoot.querySelector('.shelf-view')).gap,
    cardRadius: getComputedStyle(reader.shadowRoot.querySelector('.score-card')).borderRadius,
    cardPadding: getComputedStyle(reader.shadowRoot.querySelector('.score-card')).padding,
    coverRadius: getComputedStyle(reader.shadowRoot.querySelector('.score-cover')).borderRadius,
    nameFont: getComputedStyle(reader.shadowRoot.querySelector('.score-name')).fontSize,
    metaFont: getComputedStyle(reader.shadowRoot.querySelector('.score-meta')).fontSize,
    tagHeight: Math.round(reader.shadowRoot.querySelector('.tag-chip').getBoundingClientRect().height),
    manageHeight: Math.round(reader.shadowRoot.querySelector('.manage-btn').getBoundingClientRect().height),
    cardEditSvg: reader.shadowRoot.querySelectorAll('.card-edit-btn svg').length,
    coverSvg: reader.shadowRoot.querySelectorAll('.score-cover-fallback svg').length,
    mmStepSvg: ['mmMinus', 'mmPlus'].filter((id) => reader.shadowRoot.getElementById(id)?.querySelector('svg')).length,
    emoji: emojiHits(reader),
  };

  out.global = {
    settingsChipSvg: !!document.querySelector('#btnGlobalSettings svg'),
    versionChip: document.querySelector('#appVersion')?.textContent.trim(),
  };

  document.querySelector('.tab-btn[data-target="view-metronome"]').click();
  await sleep(300);
  const metro = document.querySelector('guitar-metronome');
  out.metronome = {
    settingsBtnSvg: !!metro?.shadowRoot?.getElementById('btnSettings')?.querySelector('svg'),
    settingsClose: !!metro?.shadowRoot?.getElementById('btnCloseSettings'),
    settingsDone: metro?.shadowRoot?.getElementById('btnDoneSettings')?.textContent.trim(),
    cardIcoSvg: metro?.shadowRoot?.querySelectorAll('.card-ico svg').length || 0,
    stepSvg: ['knobMinus', 'knobPlus'].filter((id) => metro?.shadowRoot?.getElementById(id)?.querySelector('svg')).length,
    emoji: emojiHits(metro),
  };
  metro?.shadowRoot?.getElementById('btnSettings')?.click();
  await sleep(200);
  metro?.shadowRoot?.getElementById('btnDoneSettings')?.click();
  await sleep(200);

  document.querySelector('.tab-btn[data-target="view-tuner"]').click();
  for (let i = 0; i < 40 && !document.querySelector('guitar-tuner')?.shadowRoot; i++) await sleep(50);
  await sleep(300);
  const tuner = document.querySelector('guitar-tuner');
  out.tuner = {
    settingsSvg: !!tuner?.shadowRoot?.getElementById('openSettings')?.querySelector('svg'),
    settingsClose: !!tuner?.shadowRoot?.getElementById('closeSettings'),
    settingsDone: tuner?.shadowRoot?.getElementById('settingsDone')?.textContent.trim(),
    toggleSvg: !!tuner?.shadowRoot?.getElementById('btnToggle')?.querySelector('svg'),
    stepSvg: ['a4SheetMinus', 'a4SheetPlus'].filter((id) => tuner?.shadowRoot?.getElementById(id)?.querySelector('svg')).length,
    stringNums: tuner?.shadowRoot?.querySelectorAll('.string-num').length || 0,
    emoji: emojiHits(tuner),
  };

  document.querySelector('.tab-btn[data-target="view-log"]').click();
  await sleep(300);
  await db.dbService.addLog({ name: '音阶练习', minutes: 25, bpm: 120, page: 3 });
  window.dispatchEvent(new Event('log-updated'));
  await sleep(350);
  const log = document.querySelector('guitar-practice-log');
  const detail = log?.shadowRoot?.querySelector('.log-detail');
  out.log = {
    submitSvg: !!log?.shadowRoot?.getElementById('btnSubmit')?.querySelector('svg'),
    trendSvg: !!log?.shadowRoot?.querySelector('.trend-title svg'),
    shareSvg: !!log?.shadowRoot?.getElementById('btnShare')?.querySelector('svg'),
    logCards: log?.shadowRoot?.querySelectorAll('.log-card').length || 0,
    detailSvg: detail?.querySelectorAll('svg').length || 0,
    detailOverflow: detail ? detail.scrollWidth > detail.clientWidth + 1 : true,
    emoji: emojiHits(log),
  };

  document.querySelector('#btnGlobalSettings').click();
  await sleep(300);
  const settings = document.querySelector('guitar-settings');
  out.settings = {
    open: !!settings?.shadowRoot?.querySelector('.mask.show'),
    sectionSvg: settings?.shadowRoot?.querySelectorAll('.ico svg').length || 0,
    emoji: emojiHits(settings),
  };
  out.errors = window.__gsErrs;
  return out;
})()
""")
        print(json.dumps({k: v for k, v in out.items() if k not in ('reader',)}, ensure_ascii=False, indent=2))
        r = out['reader']
        print(json.dumps({"reader": r}, ensure_ascii=False, indent=2))

        check("书架导入成功", r["cardsBefore"] >= 1, str(r["cardsBefore"]))
        check("搜索行无横向溢出", not r["rowOverflow"], f"{r['rowWidth']}/{r['rowScroll']}")
        check("导入按钮 36×36 图标化", r["importWidth"] == 36 and r["importHeight"] == 36 and r["importText"] == "" and r["importSvg"], f"{r['importWidth']}×{r['importHeight']} text={r['importText']!r}")
        check("书架搜索/筛选高 44", r["searchHeight"] == 44 and r["sortHeight"] == 44 and r["tagHeight"] == 44 and r["manageHeight"] == 44, f"search={r['searchHeight']} sort={r['sortHeight']} tag={r['tagHeight']} manage={r['manageHeight']}")
        check("书架边距与卡片规格", r["filterPadding"] == "12px" and r["shelfPadding"] == "12px" and r["shelfGap"] == "12px" and r["cardRadius"] == "14px" and r["cardPadding"] == "12px" and r["coverRadius"] == "8px", str({k: r[k] for k in ("filterPadding", "shelfPadding", "shelfGap", "cardRadius", "cardPadding", "coverRadius")}))
        check("书架标题/辅助字号", r["nameFont"] == "14px" and r["metaFont"] == "11px", f"{r['nameFont']} / {r['metaFont']}")
        check("导入按钮有无障碍名称", r["importAria"] == "导入乐谱", r["importAria"])
        check("文件夹按钮为图标并在 640 下隐藏", r["folderSvg"] and r["folderDisplay"] == "none", f"{r['folderDisplay']}")
        check("搜索占位收口", r["placeholder"] == "搜谱名 / 标签 / 拼音", r["placeholder"])
        check("搜索框与排序不压盖", r["searchWidth"] >= 120 and r["sortWidth"] <= 96, f"search={r['searchWidth']} sort={r['sortWidth']}")
        check("排序为应用内下拉", not r["nativeSelect"] and r["sortMenuOpen"] and r["sortLabelName"] == "按名称 A-Z" and r["sortMenuClosed"], f"native={r['nativeSelect']} open={r['sortMenuOpen']} label={r['sortLabelName']!r} closed={r['sortMenuClosed']}")
        check("标签与管理垂直对齐", abs(r["tagTop"] - r["manageTop"]) <= 1, f"tag={r['tagTop']:.1f} manage={r['manageTop']:.1f}")
        check("搜索过滤仍生效并可清空", r["cardsFiltered"] == 0 and r["cardsRestored"] >= 1, f"{r['cardsFiltered']}→{r['cardsRestored']}")
        check("书架卡片编辑与选中为 SVG", r["cardEditSvg"] >= 1, str(r["cardEditSvg"]))
        check("封面格式占位为 SVG", r["coverSvg"] >= 1, str(r["coverSvg"]))
        check("迷你播放步进按钮为 SVG", r["mmStepSvg"] == 2, f"step={r['mmStepSvg']}")
        check("顶部设置为 SVG", out["global"]["settingsChipSvg"])
        check("书架无 Emoji", r["emoji"]["count"] == 0, str(r["emoji"]["chars"]))
        check("节拍器图标齐全", out["metronome"]["settingsBtnSvg"] and out["metronome"]["cardIcoSvg"] == 5 and out["metronome"]["stepSvg"] == 2, f"card={out['metronome']['cardIcoSvg']} step={out['metronome']['stepSvg']}")
        check("节拍器设置去掉右上角 X", not out["metronome"]["settingsClose"] and out["metronome"]["settingsDone"] == "完成", str(out["metronome"]))
        check("节拍器无 Emoji", out["metronome"]["emoji"]["count"] == 0, str(out["metronome"]["emoji"]["chars"]))
        check("调音器图标齐全", out["tuner"]["settingsSvg"] and out["tuner"]["toggleSvg"] and out["tuner"]["stepSvg"] == 2 and out["tuner"]["stringNums"] == 6, f"step={out['tuner']['stepSvg']} nums={out['tuner']['stringNums']}")
        check("调音设置去掉右上角 X 并保留底部完成", not out["tuner"]["settingsClose"] and out["tuner"]["settingsDone"] == "完成", str(out["tuner"]))
        check("调音器无 Emoji", out["tuner"]["emoji"]["count"] == 0, str(out["tuner"]["emoji"]["chars"]))
        check("练习记录图标齐全", out["log"]["submitSvg"] and out["log"]["trendSvg"] and out["log"]["shareSvg"])
        check("练习记录条目图标渲染", out["log"]["logCards"] >= 1 and out["log"]["detailSvg"] == 3, f"cards={out['log']['logCards']} icons={out['log']['detailSvg']}")
        check("练习记录详情不溢出", not out["log"]["detailOverflow"])
        check("练习记录无 Emoji", out["log"]["emoji"]["count"] == 0, str(out["log"]["emoji"]["chars"]))
        check("设置抽屉打开", out["settings"]["open"])
        check("设置五个分区图标为 SVG", out["settings"]["sectionSvg"] == 5, str(out["settings"]["sectionSvg"]))
        check("设置无 Emoji", out["settings"]["emoji"]["count"] == 0, str(out["settings"]["emoji"]["chars"]))
        check("运行期无异常", not out["errors"], json.dumps(out["errors"], ensure_ascii=False))

        print("截图：")
        print(" ", cdp.shot("settings_open"))
        cdp.ev("document.querySelector('guitar-settings')?.shadowRoot?.getElementById('btnClose')?.click(); true")
        time.sleep(0.2)
        cdp.ev("document.querySelector('.tab-btn[data-target=\"view-reader\"]').click(); true")
        time.sleep(0.3)
        print(" ", cdp.shot("reader"))
        cdp.ev("document.querySelector('.tab-btn[data-target=\"view-metronome\"]').click(); true")
        time.sleep(0.3)
        print(" ", cdp.shot("metronome"))
        cdp.ev("document.querySelector('guitar-metronome')?.shadowRoot?.getElementById('btnSettings')?.click(); true")
        time.sleep(0.25)
        print(" ", cdp.shot("metronome_settings"))
        cdp.ev("document.querySelector('guitar-metronome')?.shadowRoot?.getElementById('btnDoneSettings')?.click(); true")
        cdp.ev("document.querySelector('.tab-btn[data-target=\"view-tuner\"]').click(); true")
        time.sleep(0.3)
        print(" ", cdp.shot("tuner"))
        cdp.ev("document.querySelector('.tab-btn[data-target=\"view-log\"]').click(); true")
        time.sleep(0.3)
        print(" ", cdp.shot("log"))

        print(f"\n宽度 {WIDTH}：{'通过' if not FAILS else '失败 ' + str(len(FAILS))}")
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
