// ==========================================
// 1. 样式区域
// ==========================================
import { audioEngine } from '../services/audio.js';
import { analyzeAudioBuffer, decodeAudioBuffer } from '../services/audio-analysis.js';
import { wakeLock } from '../services/wakelock.js';
import { showConfirm } from './app-dialog.js';
import { registerLayer, bindBackdrop } from '../services/ui-layer.js';
import { bindSheetSwipe } from '../services/sheet-swipe.js';
import { themeColor, onThemeChange } from '../services/theme.js';
import { dbService } from '../services/db.js';
import { icon } from '../services/icons.js';

const metronomeCSS = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: linear-gradient(180deg, var(--bg1), var(--grad-end));
    position: relative;
  }

  button {
    outline: none !important;
    -webkit-tap-highlight-color: transparent !important;
  }
  button:focus, button:focus-visible { outline: none !important; }
  
  .main-inner {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 12px 16px calc(14px + env(safe-area-inset-bottom, 0px));
    overflow: hidden;
  }

  .info-bar { flex:0 0 auto;margin-top:0; display:flex;gap:1px; background:var(--line);border:1px solid var(--line);border-radius:16px; overflow:hidden; }
  .info-cell { flex:1 1 0;min-width:0;padding:9px 6px; background:var(--surface-deep);text-align:center; }
  .info-k { font-size:10px;color:var(--muted);letter-spacing:1px; margin-bottom:3px; }
  .info-v { font-size:18px;font-weight:700;color: var(--heading); font-variant-numeric:tabular-nums; white-space:nowrap;overflow:hidden;text-overflow:ellipsis; line-height:1.1; }
  .info-v small{font-size:10px;font-weight:500;opacity:.55;margin-left:2px}
  .info-v.v-sm{font-size:13.5px;padding-top:2px}

  .beat-block { flex:0 0 auto; width:fit-content; max-width:100%; margin:14px auto 6px; display:flex; flex-direction:column; align-items:center; gap:4px; }
  .dots { flex:0 0 auto;display:flex;flex-wrap:wrap;gap:var(--dot-gap,7px); justify-content:center;align-items:center; min-height:26px;margin:0; }
  .beat-strip {
    position:relative; width:100%; height:var(--strip-height,24px); border-radius:999px; overflow:hidden;
    background:rgba(var(--primary-rgb),.10); visibility:hidden;
  }
  .beat-strip.show { visibility:visible; }
  .strip-track { position:absolute; left:0; right:0; height:100%; display:none; }
  .strip-track.show { display:block; }
  .beat-strip.dual .strip-track { height:calc(50% - 1px); }
  .strip-track.timer { top:0; }
  .strip-track.ramp { bottom:0; }
  .strip-track.timer .strip-fill { background:linear-gradient(90deg,rgba(var(--primary-rgb),.35),var(--primary)); }
  .strip-track.ramp .strip-fill { background:linear-gradient(90deg,rgba(var(--accent-rgb),.35),var(--accent)); }
  .strip-fill { position:absolute; left:0; top:0; bottom:0; width:0%; border-radius:999px; transition:width .12s linear; }
  .strip-flash { position:absolute; inset:0; border-radius:999px; background:var(--accent); opacity:0; pointer-events:none; }
  .strip-flash.accent { background:var(--heading); }
  .strip-flash.flash { animation:beatStripFlash .16s ease-out; }
  @keyframes beatStripFlash { 0% { opacity:.82; } 100% { opacity:0; } }
  .dot { width:var(--dot-size,22px);height:var(--dot-size,22px); border-radius:8px;background:var(--surface-sunken);border:1px solid var(--line); transition:background .06s, box-shadow .06s, border-color .06s, transform .1s; }
  .dot.m-accent{background:var(--dot-accent);border-color:var(--line-warm)}
  .dot.m-beat{background:var(--dot-beat);border-color:var(--scroll)}
  .dot.m-sub{background:var(--dot-sub);border-color:var(--dot-sub-line)}
  .dot.m-mute{background:var(--surface-deep);border-color:var(--surface-raised);opacity:.55}
  .dot.on.m-accent{background:var(--accent);border-color:var(--accent);box-shadow:0 0 20px rgba(var(--accent-rgb),.55)}
  .dot.on.m-beat{background:var(--primary);border-color:var(--primary);box-shadow:0 0 20px rgba(var(--primary-rgb),.5)}
  .dot.on.m-sub{background:var(--heading);border-color:var(--heading);box-shadow:0 0 20px rgba(var(--heading-rgb),.30)}

  .knob-wrap { flex:1 1 auto;min-height:200px;margin:4px 0 2px; display:flex;align-items:center;justify-content:center; position:relative; touch-action: none; }
  .knob-wrap canvas { display:block;touch-action:none;cursor:grab; }
  .knob-center { position:absolute;inset:0; display:flex;flex-direction:column; align-items:center;justify-content:center; pointer-events:none; gap:2px; }
  .knob-row { display:flex;align-items:center;gap:4px; pointer-events:auto; }
  
  .knob-step { width:28px;height:28px;border-radius:50%; border:1px solid var(--line-strong);background:var(--surface-raised);color:var(--muted); font-size:16px;cursor:pointer; display:flex;align-items:center;justify-content:center; padding:0; touch-action:none; user-select:none; -webkit-touch-callout:none; }
  .knob-step:active{transform:scale(.9);background:rgba(var(--primary-rgb),.18)}
  
  .knob-num { width:64px;border:none;outline:none;background:transparent; text-align:center; font-size:34px;font-weight:700;color: var(--heading); font-variant-numeric:tabular-nums;padding:0; caret-color:var(--primary); pointer-events:auto; touch-action: manipulation; }
  .knob-unit { font-size:9px;letter-spacing:4px;color:var(--muted); margin-top:2px; }
  
  .play-in-knob { margin-top:10px; padding:0 28px; min-width:140px; height:46px; border-radius:16px; border:1px solid rgba(var(--secondary-rgb),.10); cursor:pointer; font-size:14px; font-weight:800; letter-spacing:5px; color:var(--on-primary); background:linear-gradient(180deg,var(--accent),var(--primary)); box-shadow:0 6px 18px rgba(var(--primary-rgb),.26); pointer-events:auto; }
  .play-in-knob.running { color:var(--on-danger); background:var(--danger); box-shadow:0 6px 18px rgba(var(--danger-rgb),.26); }

  .bottom-area { flex:0 0 auto; display:flex; flex-direction:column; gap:0; padding-top:0; margin-top:10px; margin-bottom:64px; }
  .bottom-row { display:flex; align-items:center; justify-content:space-between; gap:8px; height:44px; padding:0 8px; flex:0 0 auto; }
  .tap-btn, .bottom-settings { width:72px; height:44px; border-radius:14px; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; flex:0 0 auto; }
  .tap-btn { border:1px solid var(--line-warm); background:linear-gradient(180deg,var(--tap-a),var(--tap-b)); color: var(--accent-text); }
  .tap-btn:active, .tap-btn.pulse { transform:scale(.95); background:rgba(var(--primary-rgb),.28); }
  .bottom-settings { border:1px solid var(--line-warm); background:var(--surface-raised); color:var(--accent-text); font-size:13px; font-weight:800; letter-spacing:.6px; gap:4px; flex-direction:row; }
  .bottom-settings:active { transform:scale(.95); background:rgba(var(--primary-rgb),.10); }

  .settings-mask {
    position: absolute; inset: 0; background: rgba(var(--shadow-rgb),.6); backdrop-filter: blur(4px);
    display: flex; align-items: flex-end; justify-content: center; z-index: 100;
    opacity: 0; pointer-events: none; transition: opacity .2s;
  }
  .settings-mask.show { opacity: 1; pointer-events: auto; }
  .settings-panel {
    background: var(--bg1); border: 1px solid var(--line); border-bottom: none;
    border-radius: 18px 18px 0 0;
    width: 100%; max-width: 520px; max-height: 90vh; max-height: 90dvh;
    padding: 0 0 env(safe-area-inset-bottom, 0px);
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 -10px 30px rgba(var(--shadow-rgb),.5);
    transform: translateY(100%); transition: transform .22s ease; will-change: transform;
  }
  .settings-mask.show .settings-panel { transform: translateY(0); }
  .settings-panel.sheet-dragging { transition: none; user-select: none; -webkit-user-select: none; }
  .settings-grabber { flex: 0 0 auto; width: 44px; height: 4px; margin: 8px auto 0; border-radius: 999px; background: var(--line-strong); opacity: .75; touch-action: none; }
  .settings-head { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 16px 12px; border-bottom:1px solid var(--line); background:var(--bg1); touch-action: none; }
  .settings-title-wrap { min-width:0; }
  .settings-panel h3 { margin: 0; font-size: 16px; color: var(--heading); text-align: left; letter-spacing: .5px; }
  .settings-sub { margin-top:3px; font-size:10px; color:var(--muted); }
  .settings-close { flex:0 0 auto; padding:8px 16px; border-radius:10px; border:1px solid var(--primary); background:rgba(var(--primary-rgb),.18); color:var(--heading); font-size:13px; font-weight:700; cursor:pointer; }
  .settings-close:active { transform:scale(.96); }
  .settings-content { flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
  .settings-card {
    display: flex; flex-direction: column; gap: 12px;
    background: var(--card-bg); border: 1px solid var(--line); border-radius: 16px;
    padding: 12px;
  }
  .card-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .card-ico {
    flex: 0 0 auto; width: 24px; height: 24px; border-radius: 8px;
    display: grid; place-items: center;
    background: rgba(var(--primary-rgb), .14); color: var(--accent-text); font-size: 13px;
  }
  .settings-card h4 { margin: 0; font-size: 13px; font-weight: 700; color: var(--heading); letter-spacing: .4px; }
  .settings-group { display: flex; flex-direction: column; gap: 8px; }
  .settings-label { font-size: 12px; color: var(--muted); }
  .label-hint { display: block; margin-top: 3px; font-size: 10px; line-height: 1.4; color: var(--muted); opacity: .82; }
  
  .ts-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .ts-btn { padding: 8px 0; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--muted); cursor: pointer; font-size: 13px; }
  .ts-btn.on { border-color: var(--primary); color: var(--heading); background: rgba(var(--primary-rgb),.18); }

  .ts-custom { display: flex; align-items: center; gap: 6px; }
  .ts-custom input {
    width: 0; flex: 1 1 0; min-width: 0; padding: 7px 6px; border-radius: 8px;
    border: 1px solid var(--line-strong); background: var(--surface-raised);
    color: var(--heading); font-size: 13px; text-align: center; outline: none;
  }
  .ts-custom input:focus { border-color: var(--primary); }
  .ts-custom .ts-sep { flex: 0 0 auto; color: var(--muted); font-size: 13px; }
  .ts-custom .ts-apply {
    flex: 0 0 auto; padding: 8px 12px; border-radius: 9px; border: 1px solid var(--primary);
    background: rgba(var(--primary-rgb),.18); color: var(--heading); font-size: 12px; cursor: pointer;
  }

  .sub-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .sub-btn {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
    padding: 6px 2px 7px; border-radius: 10px; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--muted); cursor: pointer; font-size: 11.5px;
  }
  .sub-btn .sub-name { line-height: 1.25; }
  .sub-btn .sub-desc { font-size: 8.5px; line-height: 1.25; opacity: .68; white-space: nowrap; }
  .sub-btn.on { border-color: var(--primary); color: var(--heading); background: rgba(var(--primary-rgb),.18); }
  .sub-btn.on .sub-desc { color: var(--accent-text); opacity: .9; }

  .timbre-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .timbre-btn { padding: 8px 0; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--muted); cursor: pointer; font-size: 12px; }
  .timbre-btn.on { border-color: var(--primary); color: var(--heading); background: rgba(var(--primary-rgb),.18); }

  /* B 批：节奏型 / 音频跟练 / 震动 */
  .pattern-list { display: flex; flex-wrap: wrap; gap: 6px; max-height: 142px; overflow-y: auto; overscroll-behavior: contain; }
  .pattern-chip {
    display: flex; align-items: center; gap: 6px; max-width: 100%;
    padding: 7px 8px; border-radius: 9px; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--heading); font-size: 12px;
  }
  .pattern-chip .p-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; cursor: pointer; }
  .pattern-chip .p-name { max-width: 128px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pattern-chip .p-meta { font-size: 9px; color: var(--muted); }
  .pattern-chip .p-del {
    flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; border: none;
    background: transparent; color: var(--muted); font-size: 14px; line-height: 1; cursor: pointer;
  }
  .pattern-chip .p-del:hover { color: var(--danger, #e5484d); background: rgba(var(--shadow-rgb),.12); }
  .pattern-save-row { display: flex; gap: 6px; }
  .pattern-name {
    flex: 1 1 0; min-width: 0; padding: 7px 8px; border-radius: 8px; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--heading); font-size: 12px; outline: none;
  }
  .pattern-name:focus { border-color: var(--primary); }
  .pattern-save {
    flex: 0 0 auto; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--primary);
    background: rgba(var(--primary-rgb),.18); color: var(--heading); font-size: 11px; cursor: pointer;
  }
  .follow-row { display: flex; gap: 6px; }
  .follow-btn {
    flex: 1 1 0; padding: 7px 8px; border-radius: 8px; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--heading); font-size: 12px; cursor: pointer;
  }
  .follow-btn.ghost { border-color: var(--line-strong); color: var(--muted); }
  .follow-info {
    min-height: 30px; padding: 6px 8px; border-radius: 8px; background: var(--surface-deep);
    border: 1px solid var(--line); color: var(--muted); font-size: 11px; line-height: 1.4;
    overflow: hidden; text-overflow: ellipsis;
  }
  .follow-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .follow-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 10px; color: var(--muted); }
  .follow-grid input, .follow-grid select {
    width: 100%; padding: 6px; border-radius: 8px; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--heading); font-size: 12px; outline: none;
  }
  .follow-grid input:focus, .follow-grid select:focus { border-color: var(--primary); }
  .follow-hint { font-size: 10px; color: var(--muted); line-height: 1.4; }
  .meter-guess { color: var(--heading); }
  .switch-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--muted); padding: 2px 0; }
  .switch-row + .switch-row { border-top: 1px solid var(--line); padding-top: 10px; margin-top: 2px; }
  .switch-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .switch-name { font-size: 13px; color: var(--txt-soft); }
  .switch-desc { font-size: 9.5px; line-height: 1.35; color: var(--muted); }
  .switch {
    position: relative; flex: 0 0 auto; width: 42px; height: 24px; border-radius: 999px;
    border: 1px solid var(--line-strong); background: var(--surface-raised); cursor: pointer;
    transition: background .15s, border-color .15s;
  }
  .switch::after {
    content: ''; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%;
    background: var(--muted); transition: left .15s, background .15s;
  }
  .switch.on { border-color: var(--primary); background: rgba(var(--primary-rgb),.24); }
  .switch.on::after { left: 21px; background: var(--primary); }

  /* 定时快捷档：一行 6 个，下面保留自定义输入 */
  .timer-presets { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; }
  .timer-chip {
    min-width: 0; padding: 7px 0; border-radius: 9px; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--muted); cursor: pointer;
    font-size: 12px; line-height: 1.2; font-variant-numeric: tabular-nums;
  }
  .timer-chip.on { border-color: var(--primary); color: var(--heading); background: rgba(var(--primary-rgb),.18); }
  .timer-chip.on:not(.armed) { opacity: .55; }
  .timer-custom { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--muted); }
  .timer-custom input {
    width: 64px; padding: 6px; border-radius: 8px; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--heading); font-size: 12px;
    text-align: center; outline: none;
  }
  .timer-custom input:focus { border-color: var(--primary); }

  /* C4 练习工具 */
  .practice-hud {
    /* 永远占住同一块高度：开关 Swing / 变速 / 倒计时时，圆形旋钮不缩放、不位移 */
    display: flex; align-items: center; justify-content: center;
    height: 42px; box-sizing: border-box;
    margin-top: 8px; padding: 4px 8px; border-radius: 9px;
    background: rgba(var(--primary-rgb),.10); border: 1px solid rgba(var(--accent-rgb),.35);
    color: var(--accent-text); font-size: 10px; line-height: 1.35; text-align: center;
    overflow: hidden; opacity: 0; visibility: hidden; pointer-events: none;
    transition: opacity .15s;
  }
  .practice-hud.show { opacity: 1; visibility: visible; }
  .practice-hud.two-line {
    flex-direction: column; align-items: stretch; justify-content: center;
    gap: 1px; text-align: left; padding: 3px 8px;
  }
  .hud-line { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hud-line.file { font-size: 10px; }
  .hud-line.meta { font-size: 9px; opacity: .9; }
  .audio-mode-row { display: flex; align-items: center; gap: 16px; flex-wrap: nowrap; }
  .audio-mode-row .check-row { font-size: 12px; }
  .audio-mode-hint { font-size: 10px; line-height: 1.4; color: var(--muted); }
  .settings-panel input:disabled, .settings-panel select:disabled {
    opacity: .45; cursor: not-allowed;
  }
  .accent-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
  .accent-btn {
    padding: 7px 2px; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--surface-raised);
    color: var(--muted); font-size: 11px; cursor: pointer; white-space: nowrap;
  }
  .accent-btn.t-accent { border-color: var(--primary); color: var(--heading); background: rgba(var(--primary-rgb),.20); }
  .accent-btn.t-sub { border-color: var(--accent); color: var(--accent-text); background: rgba(var(--accent-rgb),.14); }
  .accent-btn.t-mute { border-color: var(--line-strong); color: var(--muted); background: var(--surface-deep); }
  .check-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); cursor: pointer; }
  .check-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
  .num-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .num-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 10px; color: var(--muted); }
  .num-grid input {
    width: 100%; padding: 6px; border-radius: 8px; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--heading); font-size: 12px; outline: none;
  }
  .num-grid input:focus { border-color: var(--primary); }
  .range { width: 100%; accent-color: var(--primary); }
  .m-toast {
    position: fixed; left: 50%; bottom: 86px; transform: translateX(-50%);
    background: var(--surface-raised); border: 1px solid var(--line-strong); border-radius: 22px;
    color: var(--heading); font-size: 12px; padding: 8px 14px; z-index: 30;
    opacity: 0; transition: opacity .2s; pointer-events: none; white-space: nowrap;
  }
  .m-toast.show { opacity: 1; }
  
  .close-btn { padding: 10px; border-radius: 10px; border: none; background: var(--line-strong); color: var(--heading); cursor: pointer; margin-top: 8px; font-weight: bold; }
`;

// ==========================================
// 2. HTML 结构区域
// ==========================================
const metronomeHTML = `
<div class="main-inner">
  <div class="info-bar">
    <div class="info-cell">
      <div class="info-k">拍速</div>
      <div class="info-v"><span id="infoBpm">120</span><small>BPM</small></div>
    </div>
    <div class="info-cell">
      <div class="info-k">拍号</div>
      <div class="info-v"><span id="infoTs">4/4</span></div>
    </div>
    <div class="info-cell">
      <div class="info-k">细分</div>
      <div class="info-v v-sm"><span id="infoSub">四分</span></div>
    </div>
  </div>

  <div class="beat-block">
    <div class="dots" id="dots"></div>
    <div class="beat-strip" id="beatStrip">
      <div class="strip-track timer" id="stripTimerTrack"><div class="strip-fill" id="stripTimerFill"></div></div>
      <div class="strip-track ramp" id="stripRampTrack"><div class="strip-fill" id="stripRampFill"></div></div>
      <div class="strip-flash" id="stripFlash"></div>
    </div>
  </div>

  <div class="knob-wrap" id="knobWrap">
    <canvas id="knobCanvas"></canvas>
    <div class="knob-center">
      <div class="knob-row">
        <button class="knob-step" id="knobMinus" type="button" aria-label="降低 1 BPM">${icon('minus', 16)}</button>
        <input id="bpmInput" class="knob-num" type="text" inputmode="numeric" maxlength="3" value="120">
        <button class="knob-step" id="knobPlus" type="button" aria-label="升高 1 BPM">${icon('plus', 16)}</button>
      </div>
      <div class="knob-unit">BPM</div>
      <button class="play-in-knob" id="playBtn">开 始</button>
    </div>
  </div>

  <div class="practice-hud" id="practiceHud"></div>

  <div class="bottom-area">
    <div class="bottom-row">
      <button class="bottom-settings" id="btnSettings">${icon('settings', 14)} 设置</button>
      <button class="tap-btn" id="tapBtn">
        <span style="font-size:14px;font-weight:800;letter-spacing:1.5px;">TAP</span>
        <span id="tapHint" style="font-size:8.5px;opacity:.65;">测速</span>
      </button>
    </div>
  </div>
</div>

<div class="settings-mask" id="settingsMask">
  <div class="settings-panel" id="settingsPanel">
    <div class="settings-grabber" id="settingsGrabber" aria-hidden="true"></div>
    <div class="settings-head" id="settingsHead">
      <div class="settings-title-wrap">
        <h3>节拍器设置</h3>
        <div class="settings-sub">修改即时生效</div>
      </div>
      <button class="settings-close" id="btnCloseSettings">完成</button>
    </div>
    <div class="settings-content" id="settingsContent">
    <section class="settings-card">
      <div class="card-head"><span class="card-ico">${icon('metronome', 16)}</span><h4>基础节奏</h4></div>
      <div class="settings-group">
        <div class="settings-label">拍号</div>
        <div class="ts-grid" id="tsGrid"></div>
        <div class="ts-custom">
          <input id="tsNumInput" type="number" inputmode="numeric" min="1" max="32" step="1" value="4" aria-label="拍号分子">
          <span class="ts-sep">/</span>
          <input id="tsDenInput" type="number" inputmode="numeric" min="1" max="64" step="1" value="4" aria-label="拍号分母">
          <button class="ts-apply" id="tsApply">应用</button>
        </div>
      </div>
      <div class="settings-group">
        <div class="settings-label">拍内细分</div>
        <div class="sub-grid" id="subGrid"></div>
      </div>
      <div class="settings-group">
        <div class="settings-label">音色</div>
        <div class="timbre-grid" id="timbreGrid"></div>
      </div>
    </section>

    <section class="settings-card">
      <div class="card-head"><span class="card-ico">${icon('target', 16)}</span><h4>重音与反馈</h4></div>
      <div class="settings-group">
        <div class="settings-label">重音模式<span class="label-hint">点按拍位循环：重 → 次 → 常 → 静</span></div>
        <div class="accent-grid" id="accentGrid"></div>
      </div>
      <div class="settings-group">
        <div class="switch-row">
          <span class="switch-copy"><span class="switch-name">节拍闪光条</span><span class="switch-desc">随拍点同步闪烁</span></span>
          <div class="switch on" id="flashSwitch" role="switch" aria-checked="true" tabindex="0"></div>
        </div>
        <div class="switch-row">
          <span class="switch-copy"><span class="switch-name">震动反馈</span><span class="switch-desc">重音 40ms · 次重音 30ms · 普通 18ms</span></span>
          <div class="switch" id="vibrationSwitch" role="switch" aria-checked="false" tabindex="0"></div>
        </div>
      </div>
    </section>

    <section class="settings-card">
      <div class="card-head"><span class="card-ico">${icon('trending', 16)}</span><h4>高级练习</h4></div>
      <div class="settings-group">
        <div class="settings-label">Swing 摇摆 <span id="swingVal">0%</span></div>
        <label class="check-row"><input type="checkbox" id="swingOn"> 启用 Swing</label>
        <input type="range" id="swingRange" class="range" min="0" max="100" step="1" value="0" disabled aria-label="Swing 摇摆比例">
        <span class="label-hint" id="swingHint">勾选后生效，数值会保留</span>
      </div>
      <div class="settings-group">
        <label class="check-row"><input type="checkbox" id="rampOn"> 变速练习（到目标后保持 N 小节再停）</label>
        <div class="num-grid">
          <label>起始 BPM<input type="number" id="rampStart" min="30" max="250" step="1"></label>
          <label>目标 BPM<input type="number" id="rampTarget" min="30" max="250" step="1"></label>
          <label>每次±<input type="number" id="rampStep" min="1" max="20" step="1"></label>
          <label>每几小节<input type="number" id="rampEvery" min="1" max="16" step="1"></label>
        </div>
      </div>
      <div class="settings-group">
        <label class="check-row"><input type="checkbox" id="timerOn"> 倒计时自动停</label>
        <div class="timer-presets" id="timerPresets"></div>
        <div class="timer-custom">
          <span>自定义</span>
          <input type="number" id="timerMin" min="1" max="180" step="1">
          <span>分钟</span>
        </div>
      </div>
    </section>

    <section class="settings-card">
      <div class="card-head"><span class="card-ico">${icon('list', 16)}</span><h4>节奏型</h4></div>
      <div class="settings-group">
        <div class="pattern-list" id="patternList"></div>
        <div class="pattern-save-row">
          <input class="pattern-name" id="patternName" type="text" maxlength="16" placeholder="节奏型名称">
          <button class="pattern-save" id="patternSave">保存当前</button>
        </div>
      </div>
    </section>

    <section class="settings-card">
      <div class="card-head"><span class="card-ico">${icon('music', 16)}</span><h4>音频跟练与测速</h4></div>
      <div class="settings-group">
        <input id="followAudioFile" type="file" accept="audio/*" hidden>
        <div class="audio-mode-row">
          <label class="check-row"><input type="checkbox" id="audioFollowMode"> 音频跟练</label>
          <label class="check-row"><input type="checkbox" id="audioTempoMode"> 音频测速</label>
        </div>
        <div class="audio-mode-hint" id="audioModeHint">未启用音频 · 开始仅播放节拍器</div>
        <div class="settings-label">拍号推测</div>
        <div class="follow-info meter-guess" id="meterGuess">拍号推测：未分析</div>
        <div class="follow-row">
          <button class="follow-btn" id="followAudioPick">选择音频</button>
          <button class="follow-btn ghost" id="followAudioClear">清除</button>
        </div>
        <div class="follow-info" id="followAudioInfo">未选择音频</div>
        <div class="follow-grid">
          <label>首拍偏移（ms）<input id="followAudioOffset" type="number" inputmode="numeric" min="-3000" max="3000" step="10" value="0"></label>
          <label>预节拍（小节）<select id="followAudioPrebeat">
            <option value="0">无</option>
            <option value="1">1 小节</option>
            <option value="2">2 小节</option>
            <option value="4">4 小节</option>
          </select></label>
        </div>
        <label class="check-row"><input type="checkbox" id="followAudioLoop"> 单曲循环</label>
        <div class="follow-grid" id="followAudioPrebeatModeRow" style="grid-template-columns:1fr">
          <label>预节拍模式<select id="followAudioPrebeatMode">
            <option value="first">仅第一遍</option>
            <option value="every">每次循环</option>
          </select></label>
        </div>
        <div class="follow-hint">跟练：开始播放音频；测速：只分析并调整 BPM，开始不播放音频。分析结果仅供参考，可用 TAP 或手动修正。</div>
      </div>
    </section>
    </div>
  </div>
</div>
`;

// ==========================================
// 3. 逻辑区域
// ==========================================
class GuitarMetronome extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    
    this.bpm = 120;
    this.timeSigNum = 4;
    this.timeSigDen = 4;
    this.currentSubId = 'q';
    this.currentSlots = [1];
    this.accents = ['accent', 'beat', 'beat', 'beat'];
    this.currentTimbre = 'sine';
    
    this.isRunning = false;
    this.metronomeHandle = null;
    this._settingsLayerOff = null;
    this.queue = [];
    this.slotQueue = [];
    this.dotEls = [];

    // C4 练习工具状态
    this.swing = 0;
    this.swingEnabled = false;
    this.flashEnabled = true;
    this.ramp = { enabled: false, start: 120, target: 160, step: 5, every: 2 };
    this.timer = { enabled: false, minutes: 15 };
    this.rampBars = 0;
    this.rampHolding = false;
    this.rampHoldBars = 0;
    this.countdownEndAt = 0;
    this.countdownTimer = null;
    this.stripFlashTimer = null;
    this.session = null;

    // B 批：节奏型 / 音频跟练 / 震动
    this.patterns = [];
    this.vibrationEnabled = false;
    this.audioMode = 'off';
    this.followAudio = {
      buffer: null,
      name: '',
      duration: 0,
      offsetMs: 0,
      loop: false,
      prebeatBars: 0,
      prebeatEveryLoop: false,
      analysis: null,
      handle: null,
      generation: 0,
      analysisToken: 0,
      loading: false,
      meterGuess: null
    };
    this.meterSuggestion = null;
    this.tsInputDirty = false;

    this.currentBeatDur = 60 / this.bpm;
    this.currentSlotDurs = [this.currentBeatDur];

    // 定义全局 BPM 监听的函数
    this.handleGlobalBpmChange = (e) => {
      if (e.detail.bpm !== this.bpm) {
        this.setBpm(e.detail.bpm, true); // 传入 true 表示来自外部同步
      }
    };

    // 切走「节拍器」页就立刻停，不留背景噪音（以前只有开 mini 才会停）
    this.handleTabChange = (e) => {
      if (!e.detail || e.detail.target !== 'view-metronome') this.stop();
    };
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `<style>${metronomeCSS}</style>${metronomeHTML}`;
    this.initLogic();
    
    // 监听来自其他组件的 BPM 广播
    window.addEventListener('bpm-changed', this.handleGlobalBpmChange);
    window.addEventListener('app-tab-changed', this.handleTabChange);
    this.offTheme = onThemeChange(() => { if (this.drawKnob) this.drawKnob(); });
  }

  disconnectedCallback() {
    this.stop();
    if (this._settingsLayerOff) { this._settingsLayerOff(); this._settingsLayerOff = null; }
    if (this._settingsSwipeOff) { this._settingsSwipeOff(); this._settingsSwipeOff = null; }
    // 移除监听
    window.removeEventListener('bpm-changed', this.handleGlobalBpmChange);
    window.removeEventListener('app-tab-changed', this.handleTabChange);
    if (this.offTheme) { this.offTheme(); this.offTheme = null; }
  }

  initLogic() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    
    const bpmInput   = $('bpmInput');
    const knobMinus  = $('knobMinus');
    const knobPlus   = $('knobPlus');
    const knobWrap   = $('knobWrap');
    const knobCanvas = $('knobCanvas');
    const infoBpm    = $('infoBpm');
    const infoTs     = $('infoTs');
    const infoSub    = $('infoSub');
    const dotsWrap   = $('dots');
    const beatStrip  = $('beatStrip');
    const stripTimerTrack = $('stripTimerTrack'), stripRampTrack = $('stripRampTrack');
    const stripTimerFill = $('stripTimerFill'), stripRampFill = $('stripRampFill');
    const stripFlash = $('stripFlash');
    const playBtn    = $('playBtn');
    const tapBtn     = $('tapBtn');
    const tapHint    = $('tapHint');
    
    const settingsMask = $('settingsMask');
    const settingsPanel = $('settingsPanel');
    const settingsHead = $('settingsHead');
    const settingsGrabber = $('settingsGrabber');
    const btnSettings = $('btnSettings');
    const btnCloseSettings = $('btnCloseSettings');
    const settingsContent = $('settingsContent');
    const tsGrid = $('tsGrid');
    const tsNumInput = $('tsNumInput'), tsDenInput = $('tsDenInput'), tsApply = $('tsApply');
    const subGrid = $('subGrid');
    const timbreGrid = $('timbreGrid');
    const accentGrid = $('accentGrid');
    const swingRange = $('swingRange');
    const swingVal = $('swingVal');
    const swingOn = $('swingOn');
    const swingHint = $('swingHint');
    const practiceHud = $('practiceHud');
    const rampOn = $('rampOn'), rampStart = $('rampStart'), rampTarget = $('rampTarget');
    const rampStep = $('rampStep'), rampEvery = $('rampEvery');
    const timerOn = $('timerOn'), timerMin = $('timerMin'), timerPresets = $('timerPresets');
    const patternList = $('patternList'), patternName = $('patternName'), patternSave = $('patternSave');
    const followAudioFile = $('followAudioFile');
    const followAudioPick = $('followAudioPick'), followAudioClear = $('followAudioClear');
    const followAudioInfo = $('followAudioInfo');
    const followAudioOffset = $('followAudioOffset');
    const followAudioPrebeat = $('followAudioPrebeat');
    const followAudioPrebeatMode = $('followAudioPrebeatMode');
    const followAudioPrebeatModeRow = $('followAudioPrebeatModeRow');
    const followAudioLoop = $('followAudioLoop');
    const audioFollowMode = $('audioFollowMode'), audioTempoMode = $('audioTempoMode');
    const audioModeHint = $('audioModeHint');
    const meterGuess = $('meterGuess');
    const flashSwitch = $('flashSwitch');
    const vibrationSwitch = $('vibrationSwitch');

    // Swing 启用与数值分开：关闭时保留滑杆值，但引擎实际收到 0
    const swingAmount = () => (this.swingEnabled ? this.swing : 0);
    const paintSwingUI = () => {
      const audioFollow = this.audioMode === 'follow';
      swingRange.value = this.swing;
      swingVal.textContent = this.swing + '%';
      swingOn.checked = this.swingEnabled;
      swingOn.disabled = audioFollow;
      swingRange.disabled = audioFollow || !this.swingEnabled;
      swingHint.textContent = audioFollow
        ? '音频跟练期间关闭'
        : (this.swingEnabled ? '拖动即生效' : '勾选后生效，数值会保留');
    };

    const showToast = (msg) => {
      const el = document.createElement('div');
      el.className = 'm-toast';
      el.textContent = msg;
      this.shadowRoot.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 250);
      }, 1600);
    };

    const MIN_BPM = 30, MAX_BPM = 250;
    const START_ANG = 0.75 * Math.PI, SWEEP_ANG = 1.5 * Math.PI;
    // 非线性锚点：120 在顶部中心，60–180 占约 75% 弧长，两端压缩。
    const BPM_ANCHORS = [
      [30, 0], [60, 34], [90, 78], [120, 135],
      [150, 192], [180, 236], [250, 270]
    ];
    const BPM_LABELS = [30, 60, 90, 120, 150, 180, 250];
    const bpmAngle = (bpm) => {
      const v = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
      for (let i = 1; i < BPM_ANCHORS.length; i++) {
        const [b0, a0] = BPM_ANCHORS[i - 1];
        const [b1, a1] = BPM_ANCHORS[i];
        if (v <= b1) return a0 + (v - b0) / (b1 - b0) * (a1 - a0);
      }
      return 270;
    };
    const angleBpm = (deg) => {
      const d = Math.min(270, Math.max(0, deg));
      for (let i = 1; i < BPM_ANCHORS.length; i++) {
        const [b0, a0] = BPM_ANCHORS[i - 1];
        const [b1, a1] = BPM_ANCHORS[i];
        if (d <= a1) return Math.round(b0 + (d - a0) / (a1 - a0) * (b1 - b0));
      }
      return MAX_BPM;
    };
    const knob = { ctx: knobCanvas.getContext('2d'), size: 0, cx: 0, cy: 0, r: 0 };

    const TIME_SIGS = [
      { num:2, den:4 }, { num:3, den:4 }, { num:4, den:4 }, { num:5, den:4 },
      { num:6, den:8 }, { num:7, den:8 }, { num:9, den:8 }, { num:12, den:8 }
    ];
    const SUBDIVISIONS = [
      { id:'q', short:'四分', desc:'每拍 1 个', full:'四分音符，每拍 1 个', slots:[1] },
      { id:'e', short:'八分', desc:'每拍 2 个', full:'八分音符，每拍 2 个', slots:[1,1] },
      { id:'t', short:'三连', desc:'每拍 3 个', full:'三连音，每拍 3 个', slots:[1,1,1] },
      { id:'t1', short:'三·休1', desc:'第 1 位休止', full:'三连音，第 1 位休止', slots:[0,1,1] },
      { id:'t2', short:'三·休2', desc:'第 2 位休止', full:'三连音，第 2 位休止', slots:[1,0,1] },
      { id:'t3', short:'三·休3', desc:'第 3 位休止', full:'三连音，第 3 位休止', slots:[1,1,0] },
      { id:'s', short:'十六', desc:'每拍 4 个', full:'十六分音符，每拍 4 个', slots:[1,1,1,1] },
      { id:'s1', short:'十·休1', desc:'第 1 位休止', full:'十六分音符，第 1 位休止', slots:[0,1,1,1] },
      { id:'s2', short:'十·休2', desc:'第 2 位休止', full:'十六分音符，第 2 位休止', slots:[1,0,1,1] },
      { id:'s3', short:'十·休3', desc:'第 3 位休止', full:'十六分音符，第 3 位休止', slots:[1,1,0,1] },
      { id:'s4', short:'十·休4', desc:'第 4 位休止', full:'十六分音符，第 4 位休止', slots:[1,1,1,0] }
    ];
    const TIMER_PRESETS = [3, 5, 10, 15, 20, 30];
    const TIMBRES = [
      { id:'sine', label:'正弦' }, { id:'square', label:'方波' }, { id:'triangle', label:'三角' },
      { id:'woodblock', label:'木鱼' }, { id:'electronic', label:'电子' }, { id:'beep', label:'短促' }
    ];
    const DEFAULT_PATTERNS = [
      { name:'4/4 流行', tsNum:4, tsDen:4, accents:['accent','beat','beat','beat'], subId:'e' },
      { name:'4/4 摇滚', tsNum:4, tsDen:4, accents:['accent','sub','beat','sub'], subId:'e' },
      { name:'3/4 圆舞曲', tsNum:3, tsDen:4, accents:['accent','beat','beat'], subId:'q' },
      { name:'6/8 摇篮', tsNum:6, tsDen:8, accents:['accent','beat','beat','sub','beat','beat'], subId:'q' },
      { name:'7/8 复合', tsNum:7, tsDen:8, accents:['accent','beat','sub','beat','sub','beat','beat'], subId:'q' },
      { name:'Swing 4/4', tsNum:4, tsDen:4, accents:['accent','beat','beat','beat'], subId:'t' }
    ];

    const normalizeAccents = (list, len) => {
      const valid = ['accent', 'sub', 'beat', 'mute'];
      const out = Array.from({ length: len }, (_, i) => (
        Array.isArray(list) && valid.includes(list[i]) ? list[i] : 'beat'
      ));
      if (!out.includes('accent')) out[0] = 'accent';
      return out;
    };

    const makeDefaultPatterns = () => DEFAULT_PATTERNS.map((p, i) => ({
      id: 'pat_' + i,
      name: p.name,
      tsNum: p.tsNum,
      tsDen: p.tsDen,
      accents: p.accents.slice(),
      subId: p.subId
    }));

    const saveSettings = () => {
      const data = {
        bpm: this.bpm, tsNum: this.timeSigNum, tsDen: this.timeSigDen,
        subId: this.currentSubId, timbre: this.currentTimbre,
        accents: this.accents.slice(), swing: this.swing, swingEnabled: this.swingEnabled,
        ramp: { ...this.ramp }, timer: { ...this.timer },
        flash: this.flashEnabled,
        patterns: this.patterns.map(p => ({
          ...p,
          accents: Array.isArray(p.accents) ? p.accents.slice() : null
        })),
        vibration: this.vibrationEnabled,
        audioMode: this.audioMode,
        followAudio: {
          loop: this.followAudio.loop,
          prebeatBars: this.followAudio.prebeatBars,
          prebeatEveryLoop: this.followAudio.prebeatEveryLoop,
          offsetMs: this.followAudio.offsetMs
        }
      };
      localStorage.setItem('guitar_metronome_settings', JSON.stringify(data));
    };

    // 把音色 / 重音 / Swing 广播出去：读谱页的 mini 节拍器据此保持同一套风格
    const broadcastSettings = () => {
      window.dispatchEvent(new CustomEvent('metronome-settings', {
        detail: {
          timbre: this.currentTimbre,
          accents: this.accents.slice(),
          swing: swingAmount()
        }
      }));
    };
    
    const loadSettings = () => {
      try {
        const raw = localStorage.getItem('guitar_metronome_settings');
        if (raw) {
          const d = JSON.parse(raw);
          if (Number.isFinite(d.bpm)) this.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(d.bpm)));
          if (Number.isFinite(d.tsNum)) this.timeSigNum = Math.min(32, Math.max(1, Math.round(d.tsNum)));
          if (Number.isFinite(d.tsDen)) this.timeSigDen = Math.min(64, Math.max(1, Math.round(d.tsDen)));
          if (d.subId && SUBDIVISIONS.some(s => s.id === d.subId)) this.currentSubId = d.subId;
          if (d.timbre && TIMBRES.some(t => t.id === d.timbre)) this.currentTimbre = d.timbre;
          if (Number.isFinite(d.swing)) this.swing = Math.min(100, Math.max(0, Math.round(d.swing)));
          // 旧存档没有 swingEnabled：数值保留，启用状态默认关闭
          if (typeof d.swingEnabled === 'boolean') this.swingEnabled = d.swingEnabled;
          if (Array.isArray(d.accents)) {
            const valid = ['accent', 'sub', 'beat', 'mute'];
            this.accents = Array.from({ length: this.timeSigNum }, (_, i) => {
              return valid.includes(d.accents[i]) ? d.accents[i] : 'beat';
            });
            if (!this.accents.includes('accent')) this.accents[0] = 'accent';
          }
          if (d.ramp && typeof d.ramp === 'object') this.ramp = { ...this.ramp, ...d.ramp };
          if (d.timer && typeof d.timer === 'object') this.timer = { ...this.timer, ...d.timer };
          if (typeof d.flash === 'boolean') this.flashEnabled = d.flash;

          if (Array.isArray(d.patterns) && d.patterns.length) {
            this.patterns = d.patterns
              .filter(p => p && typeof p.name === 'string' && p.name.trim())
              .map((p, i) => {
                const num = Math.min(32, Math.max(1, Math.round(Number(p.tsNum) || 4)));
                const den = Math.min(64, Math.max(1, Math.round(Number(p.tsDen) || 4)));
                return {
                  id: typeof p.id === 'string' && p.id ? p.id : 'pat_' + i,
                  name: p.name.trim().slice(0, 16),
                  tsNum: num,
                  tsDen: den,
                  accents: normalizeAccents(p.accents, num),
                  subId: SUBDIVISIONS.some(s => s.id === p.subId) ? p.subId : 'q'
                };
              });
          }
          if (!this.patterns.length) this.patterns = makeDefaultPatterns();

          if (typeof d.vibration === 'boolean') this.vibrationEnabled = d.vibration;
          if (d.audioMode === 'follow' || d.audioMode === 'tempo') this.audioMode = d.audioMode;

          if (d.followAudio && typeof d.followAudio === 'object') {
            const fa = d.followAudio;
            if (typeof fa.loop === 'boolean') this.followAudio.loop = fa.loop;
            if (Number.isFinite(fa.prebeatBars)) {
              const bars = Math.min(4, Math.max(0, Math.round(fa.prebeatBars)));
              this.followAudio.prebeatBars = [0, 1, 2, 4].includes(bars) ? bars : 0;
            }
            if (typeof fa.prebeatEveryLoop === 'boolean') {
              this.followAudio.prebeatEveryLoop = fa.prebeatEveryLoop;
            }
            if (Number.isFinite(fa.offsetMs)) {
              this.followAudio.offsetMs = Math.min(3000, Math.max(-3000, Math.round(fa.offsetMs / 10) * 10));
            }
          }
        }
      } catch (e) {}
      if (!this.patterns.length) this.patterns = makeDefaultPatterns();
      // 无论有没有旧存档，都保证重音数组长度和拍号一致
      this.accents = this.accents.slice(0, this.timeSigNum);
      while (this.accents.length < this.timeSigNum) this.accents.push('beat');
      if (!this.accents.includes('accent')) this.accents[0] = 'accent';
    };
    loadSettings();

    const updateDurations = () => {
      this.currentBeatDur = 60 / this.bpm;
      const slotCount = this.currentSlots.length;
      this.currentSlotDurs = new Array(slotCount).fill(this.currentBeatDur / slotCount);
    };
    updateDurations();

    // 音频与调度都交给全局引擎：组件只负责“给参数 + 收节拍回调”
    const resetPlayUI = () => {
      playBtn.textContent = '开 始';
      playBtn.classList.remove('running');
      this.dotEls.forEach(d => d.classList.remove('on'));
      stripFlash.classList.remove('flash');
    };

    const updateStripVisibility = () => {
      const show = this.flashEnabled || this.timer.enabled || this.ramp.enabled;
      const dual = this.timer.enabled && this.ramp.enabled;
      beatStrip.classList.toggle('show', show);
      beatStrip.classList.toggle('dual', dual);
      stripTimerTrack.classList.toggle('show', this.timer.enabled);
      stripRampTrack.classList.toggle('show', this.ramp.enabled);
    };

    const updateStripProgress = () => {
      if (!beatStrip.classList.contains('show')) return;
      let timerPct = 0;
      if (this.timer.enabled && this.countdownEndAt) {
        const total = Math.max(60000, this.timer.minutes * 60000);
        const elapsed = total - Math.max(0, this.countdownEndAt - Date.now());
        timerPct = Math.max(0, Math.min(1, elapsed / total));
      }
      let rampPct = 0;
      if (this.ramp.enabled) {
        const from = Number(this.ramp.start) || this.bpm;
        const to = Number(this.ramp.target) || this.bpm;
        const span = to - from;
        rampPct = span ? (this.bpm - from) / span : (this.bpm >= to ? 1 : 0);
        rampPct = Math.max(0, Math.min(1, rampPct));
      }
      stripTimerFill.style.width = `${(timerPct * 100).toFixed(1)}%`;
      stripRampFill.style.width = `${(rampPct * 100).toFixed(1)}%`;
    };

    const flashStrip = (ev) => {
      if (!this.flashEnabled || !beatStrip.classList.contains('show')) return;
      stripFlash.className = 'strip-flash' + (ev && ev.style === 'accent' ? ' accent' : '');
      void stripFlash.offsetWidth;
      stripFlash.classList.add('flash');
      if (this.stripFlashTimer) clearTimeout(this.stripFlashTimer);
      this.stripFlashTimer = setTimeout(() => {
        stripFlash.classList.remove('flash');
        this.stripFlashTimer = null;
      }, 170);
    };

    this.drawLoop = () => {
      const now = audioEngine.currentTime;
      while (this.queue.length && this.queue[0].time <= now + 0.005) {
        const ev = this.queue.shift();
        for (let i = 0; i < this.dotEls.length; i++) {
          this.dotEls[i].classList.toggle('on', i === ev.beat);
        }
      }
      while (this.slotQueue.length && this.slotQueue[0].time <= now + 0.005) {
        const ev = this.slotQueue.shift();
        flashStrip(ev);
      }
      updateStripProgress();
      this.rafId = requestAnimationFrame(this.drawLoop);
    };

    const resizeKnob = () => {
      const rect = knobWrap.getBoundingClientRect();
      if (rect.width < 10) return;
      const size = Math.floor(Math.min(rect.width, rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      knobCanvas.width = size * dpr;
      knobCanvas.height = size * dpr;
      knobCanvas.style.width = size + 'px';
      knobCanvas.style.height = size + 'px';
      knob.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      knob.size = size; knob.cx = size / 2; knob.cy = size / 2; knob.r = size / 2 - size * 0.12; 
      drawKnob();
    };

    const drawKnob = () => {
      const ctx = knob.ctx;
      if (!ctx || knob.size < 10) return;
      const { cx, cy, r } = knob;
      ctx.clearRect(0, 0, knob.size, knob.size);

      const lineW = Math.max(10, r * 0.13);
      const curA = START_ANG + bpmAngle(this.bpm) * Math.PI / 180;
      const trackColor = themeColor('--line', '#2c2622');
      const handleColor = themeColor('--heading', '#f3e8d6');
      const handleEdge = themeColor('--edge-handle', '#8a6a4a');
      const accentRgb = themeColor('--accent-rgb', '217, 158, 106');
      const tickColor = themeColor('--muted', '#8b7d70');
      const labelSize = Math.max(8, Math.min(10, r * 0.072));

      ctx.beginPath(); ctx.arc(cx, cy, r, START_ANG, START_ANG + SWEEP_ANG);
      ctx.strokeStyle = trackColor; ctx.lineWidth = lineW; ctx.lineCap = 'round'; ctx.stroke();

      if (curA > START_ANG + 0.002) {
        const grad = ctx.createLinearGradient(0, 0, knob.size, knob.size);
        grad.addColorStop(0, handleColor);
        grad.addColorStop(0.55, themeColor('--accent', '#d99e6a'));
        grad.addColorStop(1, themeColor('--primary', '#b87b4c'));
        ctx.beginPath(); ctx.arc(cx, cy, r, START_ANG, curA);
        ctx.strokeStyle = grad; ctx.lineWidth = lineW; ctx.lineCap = 'round'; ctx.stroke();
      }

      // 非线性刻度：每 10 BPM 一格，30 的整数倍加长；关键数值标在环外。
      ctx.save();
      ctx.strokeStyle = tickColor;
      ctx.lineWidth = 1;
      ctx.lineCap = 'butt';
      for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 10) {
        const a = START_ANG + bpmAngle(bpm) * Math.PI / 180;
        const major = bpm % 30 === 0;
        const inner = r + lineW * 0.58;
        const outer = r + lineW * (major ? 0.92 : 0.78);
        ctx.globalAlpha = major ? 0.72 : 0.38;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
        ctx.stroke();
      }
      ctx.fillStyle = tickColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${labelSize}px "Segoe UI", system-ui, sans-serif`;
      const labelR = r + lineW * 1.45;
      for (const bpm of BPM_LABELS) {
        const a = START_ANG + bpmAngle(bpm) * Math.PI / 180;
        ctx.globalAlpha = 0.92;
        ctx.fillText(String(bpm), cx + Math.cos(a) * labelR, cy + Math.sin(a) * labelR);
      }
      ctx.restore();

      const hx = cx + Math.cos(curA) * r, hy = cy + Math.sin(curA) * r;
      const hr = Math.max(6, lineW * 0.85);

      ctx.save();
      ctx.shadowColor = `rgba(${accentRgb}, 0.4)`;
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fillStyle = handleColor; ctx.fill();
      ctx.restore();

      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.strokeStyle = handleEdge; ctx.lineWidth = Math.max(2, hr * 0.35); ctx.stroke();
    };
    this.drawKnob = drawKnob;

    const buildDots = () => {
      dotsWrap.innerHTML = '';
      this.dotEls = [];
      const classOf = { accent: 'm-accent', sub: 'm-sub', beat: 'm-beat', mute: 'm-mute' };

      let size = 22;
      if (this.timeSigNum > 4) size = 20;
      if (this.timeSigNum > 6) size = 17;
      if (this.timeSigNum > 9) size = 14;
      if (this.timeSigNum > 12) size = 11;
      if (this.timeSigNum > 16) size = 9;
      dotsWrap.style.setProperty('--dot-size', size + 'px');
      beatStrip.style.setProperty('--strip-height', (size + 2) + 'px');
      dotsWrap.style.setProperty('--dot-gap', this.timeSigNum > 12 ? '4px' : (this.timeSigNum > 8 ? '5px' : '7px'));

      for (let i = 0; i < this.timeSigNum; i++) {
        const d = document.createElement('div');
        const type = this.accents[i] || (i === 0 ? 'accent' : 'beat');
        d.className = 'dot ' + (classOf[type] || 'm-beat');
        dotsWrap.appendChild(d);
        this.dotEls.push(d);
      }
    };

    // ==================== C4 练习工具：HUD / Swing / 变速 / 倒计时 ====================
    const fmtClock = (ms) => {
      const total = Math.max(0, Math.ceil(ms / 1000));
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    };

    const updateHud = () => {
      updateStripVisibility();
      updateStripProgress();
      // 音频跟练：第一行文件名，第二行速度 / 调性 + 其他练习信息
      if (this.audioMode === 'follow') {
        const fa = this.followAudio;
        practiceHud.innerHTML = '';
        practiceHud.classList.add('two-line');

        const fileLine = document.createElement('span');
        fileLine.className = 'hud-line file';
        fileLine.textContent = fa.buffer ? (fa.name || '本地音频') : '音频跟练 · 未选择音频';

        const metaLine = document.createElement('span');
        metaLine.className = 'hud-line meta';
        let meta = '';
        if (!fa.buffer) {
          meta = '开始不会播放';
        } else {
          meta = '音频跟练';
          if (!fa.analysis) {
            meta += ' · 分析中…';
          } else {
            meta += fa.analysis.bpm ? ` · ${fa.analysis.bpm} BPM` : ' · 速度未识别';
            meta += fa.analysis.key ? ` · 调性 ${fa.analysis.key}` : ' · 调性未识别';
          }
        }
        if (this.timer.enabled) {
          meta += this.countdownEndAt ? ` · 倒计时 ${fmtClock(this.countdownEndAt - Date.now())}` : ` · 倒计时 ${this.timer.minutes}分`;
        }
        metaLine.textContent = meta;

        practiceHud.appendChild(fileLine);
        practiceHud.appendChild(metaLine);
        practiceHud.classList.add('show');
        return;
      }

      practiceHud.classList.remove('two-line');
      const parts = [];
      if (this.swingEnabled && this.swing > 0) parts.push(`Swing ${this.swing}%`);
      if (this.ramp.enabled) {
        let txt = `变速 ${this.ramp.start}→${this.ramp.target} · 每${this.ramp.every}小节`;
        if (this.rampHolding && this.bpm === this.ramp.target) {
          txt += ` · 保持 ${this.rampHoldBars}/${Math.max(1, this.ramp.every)}`;
        }
        parts.push(txt);
      }
      if (this.timer.enabled) {
        parts.push(this.countdownEndAt ? `倒计时 ${fmtClock(this.countdownEndAt - Date.now())}` : `倒计时 ${this.timer.minutes}分`);
      }
      if (parts.length) {
        practiceHud.textContent = parts.join('  ·  ');
        practiceHud.classList.add('show');
      } else {
        practiceHud.textContent = '';
        practiceHud.classList.remove('show');
      }
    };

    const stopCountdown = () => {
      if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
      this.countdownEndAt = 0;
    };

    const finishSession = async (reason) => {
      const session = this.session;
      if (!session || session.recorded || !this.isRunning) return;
      session.recorded = true;

      const durationSec = Math.max(1, Math.round((Date.now() - session.startedAt) / 1000));
      const mode = reason === 'ramp' ? 'ramp' : 'timer';
      const name = mode === 'ramp' ? '节拍器 · 变速练习' : '节拍器 · 计时练习';
      const bpmStart = Math.round(session.startBpm);
      const bpmEnd = Math.round(this.bpm);
      const minutes = Math.max(1, Math.round(durationSec / 60));
      const plannedMinutes = mode === 'timer' ? Math.max(1, Math.round(this.timer.minutes)) : null;

      this.stop();

      try {
        await dbService.addLog({
          name,
          source: 'metronome',
          mode,
          auto: true,
          minutes,
          durationSec,
          bpm: Math.max(bpmStart, bpmEnd),
          bpmStart,
          bpmEnd,
          plannedMinutes
        });
        window.dispatchEvent(new CustomEvent('log-updated'));
        showToast(`${mode === 'ramp' ? '变速完成' : '计时完成'}，已记录 ${fmtClock(durationSec * 1000)}`);
      } catch (err) {
        showToast('练习结束，记录保存失败');
      }
    };

    const startCountdown = () => {
      stopCountdown();
      if (!this.timer.enabled) { updateHud(); return; }
      this.countdownEndAt = Date.now() + Math.max(1, this.timer.minutes) * 60000;
      this.countdownTimer = setInterval(() => {
        if (!this.isRunning) { stopCountdown(); updateHud(); return; }
        if (Date.now() >= this.countdownEndAt) {
          stopCountdown();
          updateHud();
          finishSession('timer');
          return;
        }
        updateHud();
      }, 500);
      updateHud();
    };

    // 变速练习：每 N 个小节向目标 BPM 靠近一次；抵达目标后再保持 N 小节才停
    // （N 就是用户填的「每几小节」，让目标速度听满一段再收工）
    const rampAdvance = () => {
      if (!this.ramp.enabled || !this.isRunning) return;
      this.rampBars += 1;
      // 第一拍只是「开跑」，要等一整小节走完才第一次加档
      if (this.rampBars <= 0) return;
      const target = this.ramp.target;
      const every = Math.max(1, this.ramp.every);

      // 已在目标：累计保持的小节，满 N 小节才停
      if (this.bpm === target) {
        this.rampHolding = true;
        this.rampHoldBars += 1;
        updateHud();
        if (this.rampHoldBars >= every) {
          setTimeout(() => {
            if (!this.isRunning) return;
            finishSession('ramp');
          }, 0);
        }
        return;
      }

      this.rampHolding = false;
      this.rampHoldBars = 0;
      if (this.rampBars % every !== 0) return;
      const step = Math.max(1, this.ramp.step);
      const dir = Math.sign(target - this.bpm);
      if (!dir) return;
      let next = this.bpm + dir * step;
      if (dir > 0 ? next >= target : next <= target) next = target;
      this.setBpm(next, true);
      this.rampHolding = next === target;
      this.rampHoldBars = 0;
      updateHud();
    };

    const updateUI = () => {
      bpmInput.value = this.bpm;
      infoBpm.textContent = this.bpm;
      infoTs.textContent = this.timeSigNum + '/' + this.timeSigDen;
      const sub = SUBDIVISIONS.find(s => s.id === this.currentSubId) || SUBDIVISIONS[0];
      this.currentSubId = sub.id;
      infoSub.textContent = sub.short;
      this.currentSlots = sub.slots.slice();
      
      updateDurations();
      drawKnob();
      buildDots();
      updateHud();
      paintSwingUI();
      saveSettings();
    };

    // ==================== B 批：音频跟练 ====================
    const fmtAudioDuration = (sec) => {
      const total = Math.max(0, Math.round(sec));
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    };

    const disableRampForAudio = () => {
      this.ramp.enabled = false;
      this.rampBars = 0;
      this.rampHolding = false;
      this.rampHoldBars = 0;
      rampOn.checked = false;
    };

    const disableSwingForAudio = () => {
      // 跟练期间强制关闭，但保留滑杆数值，退出跟练后可再勾选恢复
      this.swingEnabled = false;
      paintSwingUI();
      if (this.metronomeHandle) this.metronomeHandle.setSwing(0);
      broadcastSettings();
    };

    const applyAudioAnalysisBpm = () => {
      if (this.audioMode !== 'follow' && this.audioMode !== 'tempo') return;
      const bpm = this.followAudio.analysis && this.followAudio.analysis.bpm;
      if (bpm) this.setBpm(bpm, true);
    };

    const updateMeterUI = () => {
      const analysis = this.followAudio.analysis;
      const m = this.meterSuggestion || (analysis && analysis.meter);
      if (!analysis && !m) {
        meterGuess.textContent = '拍号推测：未分析';
        return;
      }
      if (!m || !m.num || !m.den || (m.confidence || 0) < 0.55) {
        meterGuess.textContent = '拍号推测：不确定';
        return;
      }
      meterGuess.textContent = `拍号推测：${m.num}/${m.den}（置信度 ${Math.round(m.confidence * 100)}%）`;
    };

    const applyMeterSuggestion = (result) => {
      const m = result && result.meter;
      if (!m || !m.num || !m.den || (m.confidence || 0) < 0.55) {
        this.meterSuggestion = null;
        updateMeterUI();
        return;
      }
      this.meterSuggestion = { num: m.num, den: m.den, confidence: m.confidence };
      if (!this.tsInputDirty) {
        tsNumInput.value = m.num;
        tsDenInput.value = m.den;
      }
      updateMeterUI();
    };

    const updateAudioModeUI = () => {
      const isFollow = this.audioMode === 'follow';
      const isTempo = this.audioMode === 'tempo';
      const hasBuffer = !!this.followAudio.buffer;

      audioFollowMode.checked = isFollow;
      audioTempoMode.checked = isTempo;

      // 跟练专属控件：只有跟练模式可用
      [followAudioOffset, followAudioPrebeat, followAudioLoop, followAudioPrebeatMode]
        .forEach(el => { el.disabled = !isFollow; });

      // 跟练关闭变速 + Swing；测速关闭变速（否则开始会从起始 BPM 重爬）
      [rampOn, rampStart, rampTarget, rampStep, rampEvery]
        .forEach(el => { el.disabled = isFollow || isTempo; });
      paintSwingUI();

      if (isFollow) {
        audioModeHint.textContent = hasBuffer
          ? '音频跟练已开启 · 开始播放音频 · 变速/Swing 已关闭'
          : '音频跟练已开启 · 请选择音频 · 开始不会播放';
      } else if (isTempo) {
        audioModeHint.textContent = hasBuffer
          ? '音频测速已开启 · 只调整 BPM · 开始不播放音频'
          : '音频测速已开启 · 请选择音频 · 开始不播放音频';
      } else {
        audioModeHint.textContent = '未启用音频 · 开始仅播放节拍器';
      }
    };

    const setAudioMode = (mode) => {
      if (mode !== 'follow' && mode !== 'tempo') mode = 'off';
      if (mode === this.audioMode) {
        updateFollowAudioUI();
        return;
      }

      const previous = this.audioMode;
      if (mode === 'follow') {
        disableRampForAudio();
        disableSwingForAudio();
      } else if (mode === 'tempo') {
        disableRampForAudio();
      }

      this.audioMode = mode;

      // 退出跟练时立即停音频；进入跟练不半途插入，等下一次“开始”再对齐
      if (previous === 'follow' && mode !== 'follow') this.stopFollowAudio();

      updateFollowAudioUI();
      updateHud();
      saveSettings();
      applyAudioAnalysisBpm();

      if (mode === 'follow') {
        if (!this.followAudio.buffer) {
          showToast('音频跟练已开启；请选择音频，开始不会播放');
        } else if (this.isRunning) {
          showToast('音频跟练已开启；重新开始后播放音频');
        } else {
          showToast('音频跟练已开启；变速练习和 Swing 已关闭');
        }
      } else if (mode === 'tempo') {
        showToast('音频测速已开启；开始不播放音频');
      } else {
        showToast('音频已关闭；开始仅播放节拍器');
      }
    };

    const updateFollowAudioUI = () => {
      const fa = this.followAudio;
      if (fa.loading) {
        followAudioInfo.textContent = '正在读取并解码音频…';
      } else if (!fa.buffer) {
        followAudioInfo.textContent = '未选择音频';
      } else {
        const bits = [fa.name || '本地音频', fmtAudioDuration(fa.duration)];
        if (fa.analysis) {
          bits.push(fa.analysis.bpm ? `${fa.analysis.bpm} BPM` : 'BPM 未识别');
          if (fa.analysis.key) bits.push(`调性 ${fa.analysis.key}`);
        } else {
          bits.push('分析中…');
        }
        followAudioInfo.textContent = bits.join(' · ');
      }
      followAudioLoop.checked = fa.loop;
      followAudioOffset.value = fa.offsetMs;
      followAudioPrebeat.value = String(fa.prebeatBars);
      followAudioPrebeatMode.value = fa.prebeatEveryLoop ? 'every' : 'first';
      followAudioPrebeatModeRow.style.display = (this.audioMode === 'follow' && fa.loop && fa.prebeatBars > 0) ? '' : 'none';
      updateAudioModeUI();
      updateMeterUI();
      updateHud();
    };

    this.stopFollowAudio = () => {
      const fa = this.followAudio;
      fa.generation += 1;
      if (fa.handle) {
        const handle = fa.handle;
        fa.handle = null;
        try { handle.stop(); } catch (err) {}
      }
    };

    this.startFollowAudio = (when) => {
      const fa = this.followAudio;
      if (this.audioMode !== 'follow' || !fa.buffer || !this.isRunning) return;

      this.stopFollowAudio();
      const generation = fa.generation;
      const manualLoop = fa.loop && fa.prebeatEveryLoop && fa.prebeatBars > 0;
      const playOnce = (at, first) => {
        if (!this.isRunning || fa.generation !== generation) return;

        const prebeatSec = (first || fa.prebeatEveryLoop)
          ? fa.prebeatBars * this.timeSigNum * (60 / this.bpm)
          : 0;
        const audioAt = Math.max(audioEngine.currentTime + 0.02, at + prebeatSec);
        const offsetSec = fa.offsetMs / 1000;
        if (offsetSec >= fa.buffer.duration) return;

        // 正偏移：延后开始，留出静音；负偏移：跳过音频开头
        const startAt = offsetSec > 0 ? audioAt + offsetSec : audioAt;
        const startOffset = offsetSec < 0 ? -offsetSec : 0;

        fa.handle = audioEngine.playBuffer(fa.buffer, {
          when: startAt,
          offset: startOffset,
          loop: fa.loop && !manualLoop,
          volume: 0.7,
          onEnded: () => {
            if (!manualLoop || !this.isRunning || fa.generation !== generation) return;
            fa.handle = null;
            playOnce(audioEngine.currentTime + 0.08, false);
          }
        });
      };

      playOnce(when || (audioEngine.currentTime + 0.08), true);
    };

    this.runFollowAudioAnalysis = (buffer) => {
      const token = ++this.followAudio.analysisToken;
      // 先让 UI 显示「分析中」，避免解码后卡一帧
      updateFollowAudioUI();

      setTimeout(() => {
        const fa = this.followAudio;
        if (fa.buffer !== buffer || fa.analysisToken !== token) return;

        let result = { bpm: null, key: null };
        try { result = analyzeAudioBuffer(buffer); } catch (err) {}
        if (fa.buffer !== buffer || fa.analysisToken !== token) return;

        fa.analysis = result;
        applyMeterSuggestion(result);
        updateFollowAudioUI();
        saveSettings();

        const wasRunning = this.isRunning;
        if (this.audioMode === 'follow' && wasRunning) {
          // 保持跟练原来的行为：运行中载入新音频后，重新对齐并开始播放
          this.stop();
          applyAudioAnalysisBpm();
          this.start();
        } else if (this.audioMode === 'follow' || this.audioMode === 'tempo') {
          applyAudioAnalysisBpm();
        }
        updateHud();

        if (result.bpm) {
          if (this.audioMode === 'off') {
            showToast(`分析：${result.bpm} BPM${result.key ? ' · ' + result.key : ''}（未启用，未改 BPM）`);
          } else {
            let msg = `分析：${result.bpm} BPM${result.key ? ' · ' + result.key : ''}`;
            if (this.audioMode === 'follow' && !wasRunning) msg += '；开始后播放音频';
            showToast(msg);
          }
        } else {
          showToast('未能识别 BPM，可用 TAP 或手动设置');
        }
      }, 80);
    };

    this.loadFollowAudioFile = async (file) => {
      if (!file) return;
      const fa = this.followAudio;
      fa.loading = true;
      updateFollowAudioUI();

      try {
        const ctx = await audioEngine.resume();
        const arrayBuffer = await file.arrayBuffer();
        const buffer = await decodeAudioBuffer(ctx, arrayBuffer);
        if (!buffer || !buffer.duration) throw new Error('音频为空');

        this.stopFollowAudio();
        fa.buffer = buffer;
        fa.name = file.name || '本地音频';
        fa.duration = buffer.duration;
        fa.analysis = null;
        fa.loading = false;
        this.meterSuggestion = null;
        this.tsInputDirty = false;
        tsNumInput.value = this.timeSigNum;
        tsDenInput.value = this.timeSigDen;
        updateFollowAudioUI();
        saveSettings();
        showToast('音频已载入，正在分析 BPM / 调性…');
        this.runFollowAudioAnalysis(buffer);
      } catch (err) {
        fa.loading = false;
        updateFollowAudioUI();
        showToast('音频载入失败：' + (err && err.message ? err.message : '格式不支持'));
      }
    };

    const clearFollowAudio = () => {
      this.stopFollowAudio();
      this.followAudio.analysisToken += 1;
      this.followAudio.buffer = null;
      this.followAudio.name = '';
      this.followAudio.duration = 0;
      this.followAudio.analysis = null;
      this.followAudio.loading = false;
      this.meterSuggestion = null;
      this.tsInputDirty = false;
      tsNumInput.value = this.timeSigNum;
      tsDenInput.value = this.timeSigDen;
      updateFollowAudioUI();
      saveSettings();
      showToast('已清除跟练音频');
    };

    followAudioPick.onclick = () => followAudioFile.click();
    audioFollowMode.onchange = () => setAudioMode(audioFollowMode.checked ? 'follow' : 'off');
    audioTempoMode.onchange = () => setAudioMode(audioTempoMode.checked ? 'tempo' : 'off');
    followAudioFile.onchange = () => {
      const file = followAudioFile.files && followAudioFile.files[0];
      followAudioFile.value = '';
      if (file) this.loadFollowAudioFile(file);
    };
    followAudioClear.onclick = clearFollowAudio;

    followAudioOffset.oninput = () => {
      const v = Math.min(3000, Math.max(-3000, Math.round((parseInt(followAudioOffset.value, 10) || 0) / 10) * 10));
      this.followAudio.offsetMs = v;
      saveSettings();
    };
    followAudioOffset.onchange = () => { followAudioOffset.value = this.followAudio.offsetMs; };

    followAudioLoop.onchange = () => {
      this.followAudio.loop = !!followAudioLoop.checked;
      updateFollowAudioUI();
      saveSettings();
      if (this.isRunning && this.followAudio.buffer) showToast('循环设置将在下次开始生效');
    };
    followAudioPrebeat.onchange = () => {
      this.followAudio.prebeatBars = Math.min(4, Math.max(0, parseInt(followAudioPrebeat.value, 10) || 0));
      updateFollowAudioUI();
      saveSettings();
      if (this.isRunning && this.followAudio.buffer) showToast('预节拍将在下次开始生效');
    };
    followAudioPrebeatMode.onchange = () => {
      this.followAudio.prebeatEveryLoop = followAudioPrebeatMode.value === 'every';
      saveSettings();
      if (this.isRunning && this.followAudio.buffer) showToast('预节拍模式将在下次开始生效');
    };

    // ==================== B 批：震动 ====================
    const updateFlashUI = () => {
      flashSwitch.classList.toggle('on', this.flashEnabled);
      flashSwitch.setAttribute('aria-checked', this.flashEnabled ? 'true' : 'false');
    };

    const toggleFlash = () => {
      this.flashEnabled = !this.flashEnabled;
      updateFlashUI();
      saveSettings();
      updateHud();
      if (this.flashEnabled) {
        flashStrip({ style: 'accent' });
        showToast('节拍闪光条已开启');
      } else {
        showToast('节拍闪光条已关闭');
      }
    };
    flashSwitch.onclick = toggleFlash;
    flashSwitch.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFlash(); }
    };

    const updateVibrationUI = () => {
      vibrationSwitch.classList.toggle('on', this.vibrationEnabled);
      vibrationSwitch.setAttribute('aria-checked', this.vibrationEnabled ? 'true' : 'false');
    };

    this.vibrateFor = (beatIdx) => {
      if (!this.vibrationEnabled || typeof navigator.vibrate !== 'function') return;
      const mode = this.accents[beatIdx] || 'beat';
      if (mode === 'mute') return;
      const ms = mode === 'accent' ? 40 : (mode === 'sub' ? 30 : 18);
      try { navigator.vibrate(ms); } catch (err) {}
    };

    const toggleVibration = () => {
      this.vibrationEnabled = !this.vibrationEnabled;
      updateVibrationUI();
      saveSettings();
      if (!this.vibrationEnabled) {
        showToast('震动已关闭');
        return;
      }
      if (typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(30); } catch (err) {}
        showToast('震动已开启');
      } else {
        showToast('当前设备不支持震动');
      }
    };
    vibrationSwitch.onclick = toggleVibration;
    vibrationSwitch.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleVibration(); }
    };

    updateFollowAudioUI();
    updateVibrationUI();
    updateFlashUI();


    this.setBpm = (v, isSync) => {
      v = Math.round(v);
      if (!isFinite(v)) return;
      v = Math.min(MAX_BPM, Math.max(MIN_BPM, v));
      if (v === this.bpm) return;
      
      this.bpm = v;
      bpmInput.value = this.bpm;
      infoBpm.textContent = this.bpm;
      updateDurations();
      drawKnob();
      saveSettings();

      // 正在响就同步变速（引擎会把还没排进 Web Audio 的下一个拍点提前）
      if (this.metronomeHandle) this.metronomeHandle.setBpm(this.bpm);

      // 如果不是同步过来的（是用户手动改的），就向全局发广播
      if (!isSync) {
        window.dispatchEvent(new CustomEvent('bpm-changed', { detail: { bpm: this.bpm } }));
      }
    };

    this.start = () => {
      this.isRunning = true;
      this.queue = [];
      this.slotQueue = [];
      // 变速练习从设定的起始 BPM 开跑（不要把上一轮爬到的 BPM 当成起点）
      if (this.ramp.enabled) {
        this.setBpm(this.ramp.start, true);
        this.rampBars = -1;
        this.rampHolding = false;
        this.rampHoldBars = 0;
      }
      this.session = { startedAt: Date.now(), startBpm: this.bpm, recorded: false };
      this.metronomeHandle = audioEngine.startMetronome({
        bpm: this.bpm,
        // 细分是「每拍切成几个 slot」，拍号是「每小节几拍」，二者在引擎里按 slot 推进
        slots: this.currentSlots,
        accents: this.accents,
        timbre: this.currentTimbre,
        swing: swingAmount(),
        onBeat: (ev) => {
          this.queue.push(ev);
          this.vibrateFor(ev.beat);
          if (ev.beat === 0) rampAdvance();
        },
        onSlot: (ev) => {
          // 色块最多做到八分音符：四分/八分逐 slot 闪，其他细分回退为每拍一次
          const flashSlots = this.currentSubId === 'e' ? 2 : 1;
          if (ev.slot < flashSlots) this.slotQueue.push(ev);
        },
        // 只有被迷你节拍器抢占时才会走到这里；用户自己点停会先把 isRunning 置 false
        onStop: () => {
          this.stopFollowAudio();
          if (!this.isRunning) return;
          this.isRunning = false;
          this.session = null;
          wakeLock.release('metronome');
          stopCountdown();
          cancelAnimationFrame(this.rafId);
          this.queue = [];
          this.slotQueue = [];
          resetPlayUI();
          updateHud();
        }
      });
      this.rafId = requestAnimationFrame(this.drawLoop);
      startCountdown();
      wakeLock.acquire('metronome');
      playBtn.textContent = '停 止';
      playBtn.classList.add('running');

      // 音频跟练：仅 follow 模式与节拍器首拍同一个 startTime 起跑；测速/未启用不播
      if (this.audioMode === 'follow' && this.metronomeHandle) {
        this.startFollowAudio(this.metronomeHandle.startTime);
      }
    };

    this.stop = () => {
      this.isRunning = false;
      this.session = null;
      this.stopFollowAudio();
      wakeLock.release('metronome');
      if (this.metronomeHandle) {
        const handle = this.metronomeHandle;
        this.metronomeHandle = null;
        handle.stop('user');
      }
      stopCountdown();
      cancelAnimationFrame(this.rafId);
      this.queue = [];
      this.slotQueue = [];
      resetPlayUI();
      updateHud();
    };

    const applyTimeSignature = (num, den) => {
      this.meterSuggestion = null;
      this.tsInputDirty = false;
      const nextNum = Math.min(32, Math.max(1, Math.round(Number(num) || this.timeSigNum)));
      const nextDen = Math.min(64, Math.max(1, Math.round(Number(den) || this.timeSigDen)));
      if (nextNum === this.timeSigNum && nextDen === this.timeSigDen) {
        renderSettings();
        return;
      }

      const numChanged = nextNum !== this.timeSigNum;
      this.timeSigNum = nextNum;
      this.timeSigDen = nextDen;
      if (numChanged) {
        this.accents = new Array(nextNum).fill('beat');
        this.accents[0] = 'accent';
      } else {
        this.accents = this.accents.slice(0, nextNum);
        while (this.accents.length < nextNum) this.accents.push('beat');
        if (!this.accents.includes('accent')) this.accents[0] = 'accent';
      }

      updateUI();
      renderSettings();
      broadcastSettings();
      if (this.isRunning) { this.stop(); this.start(); }
    };

    const applyPattern = (pat) => {
      if (!pat) return;
      this.meterSuggestion = null;
      this.tsInputDirty = false;
      const nextNum = Math.min(32, Math.max(1, Math.round(Number(pat.tsNum) || 4)));
      const nextDen = Math.min(64, Math.max(1, Math.round(Number(pat.tsDen) || 4)));
      const sub = SUBDIVISIONS.find(s => s.id === pat.subId) || SUBDIVISIONS[0];

      this.timeSigNum = nextNum;
      this.timeSigDen = nextDen;
      this.accents = normalizeAccents(pat.accents, nextNum);
      this.currentSubId = sub.id;

      updateUI();
      renderSettings();
      broadcastSettings();
      if (this.isRunning) { this.stop(); this.start(); }
      showToast(`已应用「${pat.name}」`);
    };

    const renderPatterns = () => {
      patternList.innerHTML = '';
      this.patterns.forEach((pat) => {
        const chip = document.createElement('div');
        chip.className = 'pattern-chip';

        const main = document.createElement('div');
        main.className = 'p-main';
        const name = document.createElement('span');
        name.className = 'p-name';
        name.textContent = pat.name;
        const sub = SUBDIVISIONS.find(s => s.id === pat.subId) || SUBDIVISIONS[0];
        const meta = document.createElement('span');
        meta.className = 'p-meta';
        meta.textContent = `${pat.tsNum}/${pat.tsDen} · ${sub.short}`;
        main.appendChild(name);
        main.appendChild(meta);
        main.onclick = () => applyPattern(pat);

        const del = document.createElement('button');
        del.className = 'p-del';
        del.type = 'button';
        del.title = '删除节奏型';
        del.textContent = '×';
        del.onclick = async (e) => {
          e.stopPropagation();
          const ok = await showConfirm({
            title: '删除节奏型',
            message: '这个自定义节奏型会从本机删除。',
            details: [{ label: '节奏型', value: pat.name }],
            confirmText: '删除',
            danger: true
          });
          if (!ok) return;
          this.patterns = this.patterns.filter(p => p.id !== pat.id);
          saveSettings();
          renderPatterns();
          showToast('已删除节奏型');
        };

        chip.appendChild(main);
        chip.appendChild(del);
        patternList.appendChild(chip);
      });
    };

    const saveCurrentPattern = () => {
      const name = patternName.value.trim().slice(0, 16);
      if (!name) {
        patternName.focus();
        showToast('先填写节奏型名称');
        return;
      }
      const data = {
        tsNum: this.timeSigNum,
        tsDen: this.timeSigDen,
        accents: this.accents.slice(),
        subId: this.currentSubId
      };
      const existing = this.patterns.find(p => p.name === name);
      if (existing) {
        Object.assign(existing, data);
      } else {
        this.patterns.push({
          id: 'pat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name,
          ...data
        });
      }
      patternName.value = '';
      saveSettings();
      renderPatterns();
      showToast(existing ? '已更新节奏型' : '已保存节奏型');
    };
    patternSave.onclick = saveCurrentPattern;
    patternName.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveCurrentPattern(); }
    };

    const updateTimerPresetUI = () => {
      timerPresets.querySelectorAll('.timer-chip').forEach(b => {
        const selected = Number(b.dataset.min) === this.timer.minutes;
        b.classList.toggle('on', selected);
        b.classList.toggle('armed', selected && this.timer.enabled);
      });
    };

    const setTimerMinutes = (minutes, { syncInput = true, restart = false } = {}) => {
      const next = Math.min(180, Math.max(1, parseInt(minutes, 10) || 15));
      const changed = next !== this.timer.minutes;
      const wasEnabled = this.timer.enabled;
      this.timer.minutes = next;
      // 只改分钟，不碰 timerOn：是否启用只由复选框决定，避免点预设就误开倒计时
      if (syncInput) timerMin.value = this.timer.minutes;
      updateTimerPresetUI();
      saveSettings();
      if (this.isRunning && this.timer.enabled && (restart || changed || !wasEnabled)) startCountdown();
      else updateHud();
    };

    const commitTimerMinutes = () => {
      const value = parseInt(timerMin.value, 10);
      if (!Number.isFinite(value)) {
        timerMin.value = this.timer.minutes;
        updateTimerPresetUI();
        return;
      }
      setTimerMinutes(value, { restart: false });
    };

    const renderTimerPresets = () => {
      timerPresets.innerHTML = '';
      TIMER_PRESETS.forEach(min => {
        const b = document.createElement('button');
        b.className = 'timer-chip';
        b.dataset.min = String(min);
        b.textContent = String(min);
        b.title = `${min} 分钟`;
        b.setAttribute('aria-label', `倒计时 ${min} 分钟`);
        b.onclick = () => setTimerMinutes(min, { restart: true });
        timerPresets.appendChild(b);
      });
      updateTimerPresetUI();
    };

    const renderSettings = () => {
      tsGrid.innerHTML = '';
      TIME_SIGS.forEach(ts => {
        const b = document.createElement('button');
        b.className = 'ts-btn' + (ts.num === this.timeSigNum && ts.den === this.timeSigDen ? ' on' : '');
        b.textContent = `${ts.num}/${ts.den}`;
        b.onclick = () => applyTimeSignature(ts.num, ts.den);
        tsGrid.appendChild(b);
      });

      subGrid.innerHTML = '';
      SUBDIVISIONS.forEach(s => {
        const b = document.createElement('button');
        b.className = 'sub-btn' + (s.id === this.currentSubId ? ' on' : '');
        b.title = s.full;
        b.setAttribute('aria-label', `${s.short}（${s.full}）`);
        const name = document.createElement('span');
        name.className = 'sub-name';
        name.textContent = s.short;
        const desc = document.createElement('span');
        desc.className = 'sub-desc';
        desc.textContent = s.desc;
        b.appendChild(name);
        b.appendChild(desc);
        b.onclick = () => {
          this.currentSubId = s.id;
          updateUI(); renderSettings();
          if (this.isRunning) { this.stop(); this.start(); }
        };
        subGrid.appendChild(b);
      });

      timbreGrid.innerHTML = '';
      TIMBRES.forEach(t => {
        const b = document.createElement('button');
        b.className = 'timbre-btn' + (t.id === this.currentTimbre ? ' on' : '');
        b.textContent = t.label;
        b.onclick = () => {
          this.currentTimbre = t.id;
          updateUI(); renderSettings();
          broadcastSettings();
          // 音色在启动时快照给引擎，响着换音色要重启一次调度（不会重复发声，引擎内是同一路）
          if (this.isRunning) { this.stop(); this.start(); }
        };
        timbreGrid.appendChild(b);
      });

      // 逐拍重音：点一下在 重音→次重音→普通→静音 之间循环
      const ACCENT_ORDER = ['accent', 'sub', 'beat', 'mute'];
      const ACCENT_LABEL = { accent: '重', sub: '次', beat: '常', mute: '静' };
      accentGrid.innerHTML = '';
      for (let i = 0; i < this.timeSigNum; i++) {
        const type = this.accents[i] || 'beat';
        const b = document.createElement('button');
        b.className = 'accent-btn t-' + type;
        b.textContent = `${i + 1}·${ACCENT_LABEL[type]}`;
        b.onclick = () => {
          const idx = ACCENT_ORDER.indexOf(this.accents[i] || 'beat');
          this.accents[i] = ACCENT_ORDER[(idx + 1) % ACCENT_ORDER.length];
          buildDots();
          if (this.metronomeHandle) this.metronomeHandle.setAccents(this.accents);
          broadcastSettings();
          saveSettings();
          renderSettings();
        };
        accentGrid.appendChild(b);
      }

      // 把 C4 控件回填成当前状态（打开设置面板时总是显示真实值）
      if (this.meterSuggestion && !this.tsInputDirty) {
        tsNumInput.value = this.meterSuggestion.num;
        tsDenInput.value = this.meterSuggestion.den;
      } else {
        tsNumInput.value = this.timeSigNum;
        tsDenInput.value = this.timeSigDen;
      }
      paintSwingUI();
      rampOn.checked = this.ramp.enabled;
      rampStart.value = this.ramp.start;
      rampTarget.value = this.ramp.target;
      rampStep.value = this.ramp.step;
      rampEvery.value = this.ramp.every;
      timerOn.checked = this.timer.enabled;
      timerMin.value = this.timer.minutes;
      renderTimerPresets();

      renderPatterns();
      updateFollowAudioUI();
      updateVibrationUI();
      updateFlashUI();
    };

    const applyCustomTimeSignature = () => {
      applyTimeSignature(tsNumInput.value, tsDenInput.value);
      // 回填被 clamp 后的真实值
      tsNumInput.value = this.timeSigNum;
      tsDenInput.value = this.timeSigDen;
      updateMeterUI();
    };
    tsApply.onclick = applyCustomTimeSignature;
    [tsNumInput, tsDenInput].forEach(el => {
      el.addEventListener('input', () => { this.tsInputDirty = true; });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyCustomTimeSignature(); }
      });
    });

    // Swing：勾选后才生效；拖动滑杆即时改变（二连音后半拍位置 0.5 → 0.75）
    swingRange.oninput = () => {
      this.swing = Math.min(100, Math.max(0, parseInt(swingRange.value, 10) || 0));
      swingVal.textContent = this.swing + '%';
      if (this.swingEnabled) {
        if (this.metronomeHandle) this.metronomeHandle.setSwing(this.swing);
        broadcastSettings();
      }
      updateHud();
      saveSettings();
    };

    swingOn.onchange = () => {
      this.swingEnabled = swingOn.checked;
      // 首次勾选且数值还是 0 时给一个可感知的起点
      if (this.swingEnabled && this.swing === 0) this.swing = 25;
      paintSwingUI();
      if (this.metronomeHandle) this.metronomeHandle.setSwing(swingAmount());
      updateHud();
      saveSettings();
      broadcastSettings();
    };

    // 变速练习参数
    const readRampFields = () => {
      const clamp = (v, min, max, dflt) => Math.min(max, Math.max(min, parseInt(v, 10) || dflt));
      this.ramp.start = clamp(rampStart.value, MIN_BPM, MAX_BPM, this.ramp.start);
      this.ramp.target = clamp(rampTarget.value, MIN_BPM, MAX_BPM, this.ramp.target);
      this.ramp.step = clamp(rampStep.value, 1, 30, this.ramp.step);
      this.ramp.every = clamp(rampEvery.value, 1, 32, this.ramp.every);
      saveSettings();
      updateHud();
    };
    [rampStart, rampTarget, rampStep, rampEvery].forEach(el => { el.oninput = readRampFields; });
    rampOn.onchange = () => {
      this.ramp.enabled = rampOn.checked;
      saveSettings();
      if (this.isRunning && this.ramp.enabled) {
        this.rampBars = -1;
        this.rampHolding = false;
        this.rampHoldBars = 0;
        this.setBpm(this.ramp.start, true);
        if (this.session) this.session.startBpm = this.bpm;
      }
      updateHud();
    };

    // 倒计时
    timerMin.onchange = commitTimerMinutes;
    timerMin.onblur = commitTimerMinutes;
    timerMin.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      commitTimerMinutes();
      timerMin.blur();
    };
    timerOn.onchange = () => {
      this.timer.enabled = timerOn.checked;
      saveSettings();
      updateTimerPresetUI();
      if (this.isRunning) {
        if (this.timer.enabled) startCountdown();
        else { stopCountdown(); updateHud(); }
      } else {
        updateHud();
      }
    };

    const closeSettings = () => {
      if (this._settingsLayerOff) { this._settingsLayerOff(); this._settingsLayerOff = null; }
      settingsMask.classList.remove('show');
    };
    btnSettings.onclick = () => {
      renderSettings();
      settingsMask.classList.add('show');
      if (settingsContent) settingsContent.scrollTop = 0;
      if (!this._settingsLayerOff) {
        this._settingsLayerOff = registerLayer({
          id: 'metronome-settings',
          close: closeSettings
        });
      }
    };
    btnCloseSettings.onclick = closeSettings;
    bindBackdrop(settingsMask, closeSettings);
    this._settingsSwipeOff = bindSheetSwipe({
      sheet: settingsPanel,
      scrollEl: settingsContent,
      grabEls: [settingsGrabber, settingsHead],
      onClose: closeSettings
    });

    playBtn.onclick = () => this.isRunning ? this.stop() : this.start();
    
    bpmInput.addEventListener('input', () => {
      const v = parseInt(bpmInput.value.replace(/[^\d]/g, ''), 10);
      if (isFinite(v)) this.setBpm(v, false); // 来自用户输入
    });
    bpmInput.addEventListener('blur', () => bpmInput.value = this.bpm);

    // BPM +/−：点一下走 1 格；按住 350ms 后连续步进，松手立即停
    const bindHoldStep = (btn, delta) => {
      let holdTimer = null, repeatTimer = null;
      let didRepeat = false, active = false, pointerId = null;

      const clearTimers = () => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
      };
      const step = () => this.setBpm(this.bpm + delta, false);
      const finish = (applyStep) => {
        if (!active) return;
        active = false;
        clearTimers();
        if (applyStep && !didRepeat) step();
        if (pointerId != null) {
          try { btn.releasePointerCapture(pointerId); } catch (err) {}
          pointerId = null;
        }
      };

      btn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (active) return;
        e.preventDefault();
        active = true;
        didRepeat = false;
        pointerId = e.pointerId;
        try { btn.setPointerCapture(e.pointerId); } catch (err) {}
        holdTimer = setTimeout(() => {
          if (!active) return;
          didRepeat = true;
          step();
          repeatTimer = setInterval(step, 70);
        }, 350);
      });

      btn.addEventListener('pointerup', () => finish(true));
      btn.addEventListener('pointercancel', () => finish(false));
      btn.addEventListener('lostpointercapture', () => finish(false));

      // 键盘 Enter / Space 触发 click(detail=0) 时保留单击能力；
      // 指针点击已经由 pointerup 处理，避免一次点击加两格
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (e.detail === 0) step();
      });
    };

    bindHoldStep(knobMinus, -1);
    bindHoldStep(knobPlus, 1);

    let isDragging = false;
    const pointerToBpm = (e) => {
      const rect = knobCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left - knob.cx;
      const y = e.clientY - rect.top - knob.cy;
      let deg = Math.atan2(y, x) * 180 / Math.PI;
      if (deg < 0) deg += 360;
      if (deg < 45) deg += 360;
      if (deg < 135) deg = (deg < 90) ? 405 : 135;
      return angleBpm(deg - 135);
    };

    knobWrap.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.knob-center')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      
      const rect = knobCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left - knob.cx;
      const y = e.clientY - rect.top - knob.cy;
      const dist = Math.sqrt(x * x + y * y);
      const lineW = Math.max(10, knob.r * 0.13);
      
      if (dist < knob.r - lineW * 2.2 || dist > knob.r + lineW * 1.6) return;

      e.preventDefault();
      isDragging = true;
      try { knobWrap.setPointerCapture(e.pointerId); } catch (err) {}
      knobCanvas.style.cursor = 'grabbing';
      
      this.setBpm(pointerToBpm(e), false); // 来自拖拽
    });

    knobWrap.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      this.setBpm(pointerToBpm(e), false);
    });

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      knobCanvas.style.cursor = '';
      try { knobWrap.releasePointerCapture(e.pointerId); } catch (err) {}
    };

    knobWrap.addEventListener('pointerup', onPointerUp);
    knobWrap.addEventListener('pointercancel', onPointerUp);

    let tapTimes = [];
    let tapResetTimer = null;
    tapBtn.onclick = () => {
      const now = performance.now();
      if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes = [];
      tapTimes.push(now);
      if (tapTimes.length > 8) tapTimes.shift();

      tapBtn.classList.add('pulse');
      setTimeout(() => tapBtn.classList.remove('pulse'), 100);

      if (tapTimes.length >= 2) {
        let sum = 0;
        for (let i = 1; i < tapTimes.length; i++) sum += (tapTimes[i] - tapTimes[i-1]);
        this.setBpm(Math.round(60000 / (sum / (tapTimes.length - 1))), false);
        tapHint.textContent = `${tapTimes.length} 次`;
      } else {
        tapHint.textContent = '继续…';
      }

      clearTimeout(tapResetTimer);
      tapResetTimer = setTimeout(() => {
        tapTimes = [];
        tapHint.textContent = '测速';
      }, 2500);
    };

    setTimeout(() => { resizeKnob(); updateUI(); }, 50);
    new ResizeObserver(resizeKnob).observe(knobWrap);
  }
}

customElements.define('guitar-metronome', GuitarMetronome);