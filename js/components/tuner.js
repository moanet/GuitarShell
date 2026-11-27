import { audioEngine } from '../services/audio.js';
import { wakeLock } from '../services/wakelock.js';
import { showToast } from '../services/toast.js';
import {
  detectYin,
  clampA4,
  A4_DEFAULT,
  A4_MIN,
  A4_MAX,
  medianFrequency,
  foldToGuitarFundamental
} from '../services/pitch.js';
import {
  TUNING_PRESETS,
  CUSTOM_TUNING_ID,
  getPresetById,
  readTuningState,
  writeTuningState,
  createTuningTargets,
  normalizeCustomTuning,
  guitarNoteOptions,
  formatTuningNotes
} from '../services/tunings.js';
import { icon } from '../services/icons.js';
import { registerLayer, bindBackdrop } from '../services/ui-layer.js';

// 提示音本身会被麦克风收进去：叮响的 0.32s 加上扬声器/采集尾音，
// 这期间暂停 YIN，避免把提示音的低阶谐波当成琴声，把指针拽向右侧。
const CHIME_DETECT_GUARD_MS = 420;

const readBoolSetting = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch (err) { return fallback; }
};

const writeBoolSetting = (key, value) => {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch (err) {}
};

// 标准音试听响度补偿：手机小喇叭对 82/110Hz 的低音衰减很厉害，
// 低音 E/A 给更高电平，高音 e 保持原电平，避免六根弦试听响度差太多。
const REFERENCE_LEVELS = {
  D2: 0.36,
  E2: 0.36,
  G2: 0.35,
  A2: 0.34,
  D3: 0.3,
  'F#3': 0.29,
  G3: 0.28,
  A3: 0.27,
  B3: 0.25,
  D4: 0.23,
  E4: 0.22
};

const tunerCSS = `
  button, label, input, select { outline: none !important; -webkit-tap-highlight-color: transparent !important; }
  :host { display: flex; flex-direction: column; height: 100%; width: 100%; background: linear-gradient(180deg, var(--bg2), var(--bg0)); color: var(--txt); overflow: hidden; font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", -apple-system, sans-serif; align-items: center; justify-content: flex-start; }
  
  .container { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 500px; padding: 16px 20px; gap: 20px; box-sizing: border-box; }
  
  /* 提示与音符显示 */
  .display-area { flex: 1 1 auto; min-height: 180px; max-height: clamp(200px, 40vh, 360px); text-align: center; height: auto; display: flex; flex-direction: column; justify-content: center; }
  .note-name { font-size: 72px; font-weight: bold; color: var(--heading); line-height: 1; transition: color 0.2s; text-shadow: 0 8px 28px rgba(var(--shadow-rgb),.35); }
  .note-name.in-tune { color: var(--success); text-shadow: 0 0 24px rgba(var(--success-rgb), 0.48); }
  .freq-val { font-size: 14px; color: var(--muted); margin-top: 8px; letter-spacing: 2px; }
  .status-text { font-size: 16px; color: var(--accent-text); margin-top: 10px; height: 20px; font-weight: bold; }

  /* 仪表盘 */
  .meter-wrap { position: relative; width: 100%; height: 80px; background: linear-gradient(180deg, var(--bg1), var(--surface-deep)); border-radius: 18px; border: 1px solid var(--line); overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 1px 0 rgba(var(--secondary-rgb),.04); }
  
  /* 刻度线 */
  .ticks { position: absolute; inset: 0; display: flex; justify-content: space-between; padding: 0 20px; align-items: center; pointer-events: none; }
  .tick { width: 2px; height: 20px; background: var(--line-strong); border-radius: 2px; }
  .tick.center { height: 40px; background: var(--success); box-shadow: 0 0 12px rgba(var(--success-rgb),.55); width: 3px; }
  .tick.half { height: 30px; background: var(--muted); }

  /* 指针 */
  .needle { position: absolute; width: 4px; height: 60px; background: var(--danger); border-radius: 4px; transition: transform 0.1s cubic-bezier(0.1, 0.7, 1, 0.1), background 0.2s; box-shadow: 0 0 10px rgba(var(--danger-rgb), 0.5); transform-origin: bottom center; left: calc(50% - 2px); bottom: 10px; z-index: 10; }
  .needle.in-tune { background: var(--success); box-shadow: 0 0 16px rgba(var(--success-rgb), 0.7); }

  /* 目标弦选择 */
  .strings-row { display: flex; gap: 10px; width: 100%; justify-content: center; }
  .string-btn { flex: 1; max-width: 60px; padding: 12px 0; border-radius: 12px; background: var(--surface-raised); border: 1px solid var(--line-strong); color: var(--muted); font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s; outline: none; -webkit-tap-highlight-color: transparent; }
  .string-btn:hover { background: var(--surface-hover); color: var(--heading); }
  .string-btn.active { background: rgba(var(--primary-rgb), 0.18); border-color: var(--accent); color: var(--heading); box-shadow: 0 0 12px rgba(var(--accent-rgb),0.18); }
  
  .string-btn.auto { max-width: 80px; font-size: 14px; }

  /* 音分曲线 */
  .cents-wrap { position: relative; width: 100%; height: 52px; background: var(--surface-deep); border-radius: 12px; border: 1px solid var(--line); overflow: hidden; }
  .cents-wrap svg { width: 100%; height: 100%; display: block; }
  .cents-zero { stroke: var(--scroll); stroke-width: 1; }
  .cents-guide { stroke: var(--line); stroke-width: 1; stroke-dasharray: 3 4; }
  .cents-line { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .cents-dot { fill: var(--accent); }
  .cents-wrap.in-tune .cents-line, .cents-wrap.in-tune .cents-dot { stroke: var(--success); fill: var(--success); }
  .cents-label { position: absolute; left: 6px; font-size: 9px; color: var(--muted-soft); pointer-events: none; }
  .cents-label.top { top: 2px; }
  .cents-label.mid { top: 50%; transform: translateY(-50%); color: var(--muted); }
  .cents-label.bot { bottom: 2px; }
  .cents-title { position: absolute; right: 6px; top: 2px; font-size: 9px; color: var(--muted-soft); pointer-events: none; }

  /* A4 校准 + 标准音 */
  .tools-row { display: flex; gap: 8px; width: 100%; justify-content: center; flex-wrap: wrap; }
  .a4-box { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 18px; background: var(--surface-raised); border: 1px solid var(--line-strong); }
  .a4-label { font-size: 12px; color: var(--muted); }
  .step-btn { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--scroll); background: var(--surface-hover); color: var(--heading); font-size: 15px; line-height: 1; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; display: grid; place-items: center; }
  .step-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .a4-val { min-width: 58px; text-align: center; font-size: 13px; color: var(--heading); font-variant-numeric: tabular-nums; }
  .ref-btn { padding: 7px 14px; border-radius: 18px; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--muted); font-size: 13px; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; display: inline-flex; align-items: center; gap: 6px; }
  .ref-btn:not(:disabled) { color: var(--accent-text); border-color: var(--line-warm); background: rgba(var(--primary-rgb), 0.12); }
  .ref-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  /* 反馈开关 */
  .feedback-row { display: flex; gap: 10px; justify-content: center; width: 100%; }
  .feedback-btn { padding: 8px 14px; border-radius: 18px; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--muted); font-size: 13px; cursor: pointer; transition: 0.2s; outline: none; -webkit-tap-highlight-color: transparent; display: inline-flex; align-items: center; gap: 6px; }
  .feedback-btn.active { background: rgba(var(--success-rgb), 0.16); border-color: var(--success); color: var(--success); }
  .feedback-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  /* 控制按钮 */
  .btn-toggle { flex: 1 1 auto; height: 56px; padding: 0 22px; border-radius: 28px; border: none; font-size: 18px; font-weight: bold; cursor: pointer; transition: 0.3s; display: flex; align-items: center; justify-content: center; gap: 10px; outline: none; -webkit-appearance: none; appearance: none; -webkit-tap-highlight-color: transparent; }
  .btn-toggle:focus { outline: none !important; }
  .btn-toggle:focus-visible { outline: none !important; }
  .btn-toggle:active { outline: none !important; }
  .btn-toggle.start { background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary); box-shadow: 0 6px 20px rgba(var(--primary-rgb), 0.3); }
  .btn-toggle.stop { background: var(--danger); color: var(--on-danger); box-shadow: 0 6px 20px rgba(var(--danger-rgb), 0.28); }
  .btn-toggle:active { transform: scale(0.95); }

  /* 0.1.21：顶部状态、底部动作行与调音设置 */
  :host { position: relative; }
  .container { flex: 1 1 auto; padding: 10px 20px max(28px, env(safe-area-inset-bottom, 0px)); gap: 12px; }
  .tuning-head { width: 100%; max-width: 460px; display: flex; align-items: baseline; gap: 10px; min-width: 0; padding: 0 2px; flex: none; }
  .tuning-head .tuning-name { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 19px; font-weight: 700; color: var(--heading); line-height: 1.25; }
  .tuning-a4 { flex: none; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.25; }
  .action-row { width: 100%; max-width: 460px; display: flex; align-items: center; gap: 10px; flex: none; }
  .settings-btn { flex: 0 0 92px; height: 56px; border-radius: 20px; border: 1px solid var(--line-warm); background: var(--surface-raised); color: var(--accent-text); display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 8px; font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: 0.2s; -webkit-tap-highlight-color: transparent; }
  .settings-btn span { white-space: nowrap; }
  .settings-btn:active { transform: scale(0.95); background: rgba(var(--primary-rgb), 0.10); }
  .string-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 7px 0 6px; line-height: 1.1; min-width: 0; white-space: nowrap; }
  .string-note { font-size: 16px; font-weight: 700; line-height: 1.05; }
  .string-num { font-size: 9px; font-weight: 600; color: var(--muted-soft); line-height: 1.05; }
  .strings-row { gap: 6px; }
  .string-btn.auto { max-width: 72px; font-size: 13px; }
  .string-btn.playing { animation: tuner-pulse 0.95s ease-in-out infinite; }
  @keyframes tuner-pulse { 0%, 100% { box-shadow: 0 0 0 rgba(var(--accent-rgb), 0); } 50% { box-shadow: 0 0 18px rgba(var(--accent-rgb), 0.4); } }
  @media (max-width: 340px) {
    .container { padding-left: 16px; padding-right: 16px; }
    .settings-btn { flex-basis: 84px; font-size: 12px; gap: 4px; padding: 0 6px; }
    .btn-toggle { padding: 0 16px; font-size: 17px; gap: 8px; }
  }

  .settings-mask { position: absolute; inset: 0; z-index: 500; display: flex; align-items: flex-end; justify-content: center; background: rgba(var(--shadow-rgb), 0.66); opacity: 0; pointer-events: none; transition: opacity 0.18s; }
  .settings-mask.show { opacity: 1; pointer-events: auto; }
  .settings-sheet { width: 90%; max-width: 400px; max-height: 90%; overflow-y: auto; -webkit-overflow-scrolling: touch; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; padding: 12px 14px max(24px, calc(14px + env(safe-area-inset-bottom, 0px))); border-radius: 18px 18px 0 0; border: 1px solid var(--line); border-bottom: none; background: linear-gradient(180deg, var(--surface-raised), var(--surface-deep)); box-shadow: 0 -12px 40px rgba(var(--shadow-rgb), 0.32); transform: translateY(100%); transition: transform 0.2s; }
  .settings-mask.show .settings-sheet { transform: translateY(0); }
  .sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .sheet-title { margin: 0; font-size: 18px; color: var(--heading); }
  .icon-btn { width: 32px; height: 32px; flex: none; border-radius: 50%; border: 1px solid var(--line); background: var(--surface-hover); color: var(--muted); display: grid; place-items: center; cursor: pointer; }
  .settings-page { display: flex; flex-direction: column; gap: 12px; }
  .settings-page[hidden], .settings-mask[hidden], [hidden] { display: none !important; }
  .sheet-section { display: flex; flex-direction: column; gap: 6px; padding: 9px; border-radius: 12px; background: var(--surface-deep); border: 1px solid var(--line); }
  .section-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--heading); }
  .preset-select { position: relative; }
  .preset-field { width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 9px; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--txt); cursor: pointer; text-align: left; font-family: inherit; transition: 0.18s; }
  .preset-field:hover { background: var(--surface-hover); }
  .preset-field[aria-expanded="true"] { border-color: var(--accent); background: rgba(var(--primary-rgb), 0.10); }
  .preset-field-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .preset-field-name { font-size: 13px; font-weight: 600; color: var(--heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preset-field-notes { font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preset-field-chevron { flex: none; color: var(--muted); display: inline-flex; transition: transform 0.18s; }
  .preset-field[aria-expanded="true"] .preset-field-chevron { transform: rotate(90deg); color: var(--accent-text); }
  .preset-menu { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 20; display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: 12px; border: 1px solid var(--line-strong); background: var(--surface-raised); box-shadow: 0 12px 30px rgba(var(--shadow-rgb), 0.42); }
  .preset-option { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 8px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--txt); cursor: pointer; text-align: left; font-family: inherit; }
  .preset-option:hover, .preset-option:active { background: var(--surface-hover); }
  .preset-option.active { border-color: var(--accent); background: rgba(var(--primary-rgb), 0.12); }
  .preset-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .preset-name { font-size: 13px; font-weight: 600; color: var(--heading); }
  .preset-notes { font-size: 10px; color: var(--muted); }
  .preset-option .preset-check { flex: none; color: var(--accent-text); display: inline-flex; }
  .custom-entry { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 9px; border-radius: 10px; border: 1px dashed var(--line-strong); background: transparent; color: var(--txt); cursor: pointer; text-align: left; font-family: inherit; }
  .custom-entry.active { border-style: solid; border-color: var(--accent); background: rgba(var(--primary-rgb), 0.13); }
  .custom-entry-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .custom-entry-name { font-size: 13px; font-weight: 600; color: var(--heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .custom-entry-hint { font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .custom-entry-icon { flex: none; color: var(--muted); }
  .a4-section { padding: 0; border: none; background: transparent; }
  .a4-line { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; width: 100%; }
  .a4-stepper { display: flex; align-items: center; gap: 4px; flex: none; }
  .a4-value { min-width: 52px; text-align: center; font-size: 17px; font-weight: 700; color: var(--heading); font-variant-numeric: tabular-nums; line-height: 1; }
  .a4-value small { font-size: 10px; color: var(--muted); font-weight: 500; margin-left: 2px; }
  .a4-line .step-btn { width: 26px; height: 26px; }
  .a4-quick { display: flex; gap: 4px; flex: none; margin-left: auto; }
  .a4-line .mini-chip { padding: 4px 8px; font-size: 11px; }
  .mini-chip { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--muted); font-size: 11px; cursor: pointer; }
  .mini-chip.active { border-color: var(--accent); color: var(--accent-text); background: rgba(var(--primary-rgb), 0.12); }
  @media (max-width: 340px) {
    .a4-line { gap: 6px; }
    .a4-value { min-width: 46px; font-size: 16px; }
    .a4-line .step-btn { width: 24px; height: 24px; }
    .a4-line .mini-chip { padding: 4px 7px; font-size: 10.5px; }
  }
  .switch-row { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 8px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--txt); text-align: left; cursor: pointer; font-family: inherit; }
  .switch-row:disabled { opacity: 0.55; cursor: not-allowed; }
  .switch-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .switch-title { font-size: 13px; font-weight: 600; color: var(--heading); }
  .switch-help { font-size: 10px; color: var(--muted); }
  .switch-track { flex: none; width: 42px; height: 24px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--surface-raised); position: relative; transition: background 0.15s, border-color 0.15s; }
  .switch-thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted); transition: left 0.15s, background 0.15s; }
  .switch-row[aria-pressed="true"] .switch-track { border-color: var(--primary); background: rgba(var(--primary-rgb), 0.24); }
  .switch-row[aria-pressed="true"] .switch-thumb { left: 21px; background: var(--primary); }
  .sheet-subhead { display: flex; align-items: center; gap: 8px; }
  .sheet-subhead h3 { margin: 0; font-size: 16px; color: var(--heading); }
  .custom-field { display: flex; flex-direction: column; gap: 5px; }
  .custom-field label, .note-field-label { font-size: 11px; color: var(--muted); }
  .custom-name { width: 100%; box-sizing: border-box; padding: 9px 10px; border-radius: 9px; border: 1px solid var(--line-strong); background: var(--surface-deep); color: var(--txt); font-size: 14px; font-family: inherit; }
  .notes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .note-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .note-field-btn { width: 100%; min-height: 40px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; border-radius: 9px; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--heading); font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; text-align: left; }
  .note-field-btn:active { background: var(--surface-hover); }
  .note-field-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .note-field-chevron { flex: none; color: var(--muted); display: inline-flex; transform: rotate(90deg); }
  .editor-actions { display: flex; gap: 8px; margin-top: 2px; }
  .editor-actions button { flex: 1; padding: 11px 10px; border-radius: 9px; border: 1px solid var(--line-strong); font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
  .btn-reset { background: var(--surface-hover); color: var(--txt); }
  .btn-save { background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary); border-color: transparent; }

  /* 自定义调弦音高选择：应用内底部弹层，替代原生 select */
  .note-picker-mask { position: absolute; inset: 0; z-index: 600; display: flex; align-items: flex-end; justify-content: center; background: rgba(var(--shadow-rgb), 0.56); opacity: 0; pointer-events: none; transition: opacity 0.18s; }
  .note-picker-mask.show { opacity: 1; pointer-events: auto; }
  .note-picker-sheet { width: 90%; max-width: 400px; max-height: 72%; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px max(24px, calc(14px + env(safe-area-inset-bottom, 0px))); border-radius: 18px 18px 0 0; border: 1px solid var(--line); border-bottom: none; background: linear-gradient(180deg, var(--surface-raised), var(--surface-deep)); box-shadow: 0 -12px 40px rgba(var(--shadow-rgb), 0.32); transform: translateY(100%); transition: transform 0.2s; }
  .note-picker-mask.show .note-picker-sheet { transform: translateY(0); }
  .note-picker-sub { margin-top: 2px; font-size: 10px; color: var(--muted); }
  .note-picker-list { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 2px; }
  .note-option { min-height: 40px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--txt); font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
  .note-option.active { border-color: var(--accent); background: rgba(var(--primary-rgb), 0.14); color: var(--accent-text); }
`;

const tunerHTML = `
  <div class="container">
    <div class="tuning-head">
      <span class="tuning-name" id="tuningName">标准调弦</span>
      <span class="tuning-a4" id="a4Status" hidden></span>
    </div>

    <div class="display-area">
      <div class="note-name" id="noteName">--</div>
      <div class="freq-val" id="freqVal">0.0 Hz</div>
      <div class="status-text" id="statusText">点击下方按钮开始调音</div>
    </div>

    <div class="meter-wrap">
      <div class="ticks">
        <div class="tick"></div><div class="tick half"></div><div class="tick"></div>
        <div class="tick half"></div><div class="tick center"></div>
        <div class="tick half"></div><div class="tick"></div><div class="tick half"></div><div class="tick"></div>
      </div>
      <div class="needle" id="needle"></div>
    </div>

    <div class="cents-wrap" id="centsWrap">
      <svg viewBox="0 0 300 50" preserveAspectRatio="none" aria-hidden="true">
        <line class="cents-guide" x1="0" y1="12.5" x2="300" y2="12.5"></line>
        <line class="cents-zero" x1="0" y1="25" x2="300" y2="25"></line>
        <line class="cents-guide" x1="0" y1="37.5" x2="300" y2="37.5"></line>
        <path class="cents-line" id="centsPath" d=""></path>
        <circle class="cents-dot" id="centsDot" cx="-10" cy="25" r="3"></circle>
      </svg>
      <span class="cents-label top">+50¢</span>
      <span class="cents-label mid">0</span>
      <span class="cents-label bot">−50¢</span>
      <span class="cents-title">10s 音分</span>
    </div>

    <div class="strings-row" id="stringsRow">
      <button class="string-btn auto active" data-slot="auto" type="button">自动</button>
      <button class="string-btn" data-slot="0" type="button"><span class="string-note">E</span><span class="string-num">6</span></button>
      <button class="string-btn" data-slot="1" type="button"><span class="string-note">A</span><span class="string-num">5</span></button>
      <button class="string-btn" data-slot="2" type="button"><span class="string-note">D</span><span class="string-num">4</span></button>
      <button class="string-btn" data-slot="3" type="button"><span class="string-note">G</span><span class="string-num">3</span></button>
      <button class="string-btn" data-slot="4" type="button"><span class="string-note">B</span><span class="string-num">2</span></button>
      <button class="string-btn" data-slot="5" type="button"><span class="string-note">e</span><span class="string-num">1</span></button>
    </div>

    <div class="action-row">
      <button class="settings-btn" id="openSettings" type="button" aria-haspopup="dialog" aria-controls="settingsMask">
        ${icon('settings', 15)}<span>调音设置</span>
      </button>
      <button class="btn-toggle start" id="btnToggle">${icon('mic', 18)} 开始调音</button>
    </div>
  </div>

  <div class="settings-mask" id="settingsMask" hidden aria-hidden="true">
    <div class="settings-sheet" id="settingsSheet" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <div class="sheet-head">
        <div>
          <h2 class="sheet-title" id="settingsTitle">调音设置</h2>
        </div>
        <button class="icon-btn" id="closeSettings" type="button" aria-label="关闭调音设置">${icon('close', 18)}</button>
      </div>

      <div class="settings-page" id="settingsMain">
        <section class="sheet-section">
          <div class="section-title">${icon('music', 14)} 调弦</div>
          <div class="preset-select">
            <button class="preset-field" id="presetField" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="presetMenu">
              <span class="preset-field-copy">
                <span class="preset-field-name" id="presetFieldName">选择预设</span>
                <span class="preset-field-notes" id="presetFieldNotes">点开切换预设调弦</span>
              </span>
              <span class="preset-field-chevron">${icon('chevronRight', 14)}</span>
            </button>
            <div class="preset-menu" id="presetMenu" role="listbox" aria-label="预设调弦" hidden></div>
          </div>
          <button class="custom-entry" id="customEntry" type="button">
            <span class="custom-entry-copy">
              <span class="custom-entry-name" id="customEntryName">自定义调弦</span>
              <span class="custom-entry-hint" id="customEntryHint">自己设置六弦音高</span>
            </span>
            <span class="custom-entry-icon">${icon('chevronRight', 14)}</span>
          </button>
        </section>

        <section class="sheet-section a4-section">
          <div class="section-title">${icon('gauge', 14)} A4 校准</div>
          <div class="a4-line">
            <div class="a4-stepper">
              <button class="step-btn" id="a4SheetMinus" type="button" aria-label="A4 降低 1Hz">${icon('minus', 14)}</button>
              <div class="a4-value"><span id="a4SheetVal">440</span><small>Hz</small></div>
              <button class="step-btn" id="a4SheetPlus" type="button" aria-label="A4 升高 1Hz">${icon('plus', 14)}</button>
            </div>
            <div class="a4-quick">
              <button class="mini-chip" type="button" data-a4="440">440</button>
              <button class="mini-chip" type="button" data-a4="442">442</button>
            </div>
          </div>
        </section>

        <section class="sheet-section">
          <div class="section-title">${icon('bell', 14)} 调准反馈</div>
          <button class="switch-row" id="fbSound" type="button" aria-pressed="true">
            <span class="switch-copy">
              <span class="switch-title">调准提示音</span>
              <span class="switch-help">进入 ±5 音分时响一声</span>
            </span>
            <span class="switch-track"><span class="switch-thumb"></span></span>
          </button>
          <button class="switch-row" id="fbVibrate" type="button" aria-pressed="true">
            <span class="switch-copy">
              <span class="switch-title">调准震动</span>
              <span class="switch-help">进入 ±5 音分时震一下</span>
            </span>
            <span class="switch-track"><span class="switch-thumb"></span></span>
          </button>
        </section>
      </div>

      <div class="settings-page" id="customEditor" hidden>
        <div class="sheet-subhead">
          <button class="icon-btn" id="customBack" type="button" aria-label="返回调音设置">${icon('chevronLeft', 16)}</button>
          <h3>自定义调弦</h3>
        </div>
        <div class="custom-field">
          <label for="customName">名称</label>
          <input class="custom-name" id="customName" maxlength="16" placeholder="例如：我的开放 G" autocomplete="off">
        </div>
        <div class="notes-grid" id="customNotes"></div>
        <div class="editor-actions">
          <button class="btn-reset" id="customReset" type="button">填入标准调弦</button>
          <button class="btn-save" id="customSave" type="button">保存并使用</button>
        </div>
      </div>
    </div>
  </div>

  <div class="note-picker-mask" id="notePickerMask" hidden aria-hidden="true">
    <div class="note-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="notePickerTitle">
      <div class="sheet-head">
        <div>
          <h2 class="sheet-title" id="notePickerTitle">第6弦音高</h2>
          <div class="note-picker-sub">D2 – E5</div>
        </div>
        <button class="icon-btn" id="closeNotePicker" type="button" aria-label="关闭音高选择">${icon('close', 18)}</button>
      </div>
      <div class="note-picker-list" id="notePickerList" role="listbox" aria-label="音高选择"></div>
    </div>
  </div>
`;

class GuitarTuner extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isListening = false;
    this.stopEpoch = 0;
    this.analyser = null;
    this.analyserHandle = null;
    this.stream = null;
    this.rafId = null;
    
    // 数据平滑
    this.frequencyHistory = [];
    this.targetSlot = 'auto'; // 'auto' 或弦位 slot 0–5
    this.lastAnalysisAt = 0;
    this.lastValidAt = 0;

    // 调准反馈：进入 ±5 音分时响一次 / 震一次
    this.feedbackSound = readBoolSetting('guitar_tuner_feedback_sound', true);
    this.feedbackVibrate = readBoolSetting('guitar_tuner_feedback_vibrate', true);
    this.wasInTune = false;
    this.lastFeedbackAt = -1e9;
    this.chimeGuardUntil = 0;

    // 标准音试听 / 音分曲线
    this.lastSlot = null;
    this.centsHistory = [];
    this.lastChartAt = 0;
    this.isPlayingRef = false;
    this.refToneHandle = null;
    this.refTimer = null;
    this.refEpoch = 0;

    // A4 校准
    let savedA4 = A4_DEFAULT;
    try {
      const raw = localStorage.getItem('guitar_tuner_a4');
      if (raw) savedA4 = Number(raw);
    } catch (err) {}
    this.a4 = clampA4(savedA4);

    // 调弦预设 / 自定义调弦：目标频率按弦位维护，允许重复音高
    this.tuning = readTuningState();
    this.customTuning = this.tuning.custom || null;
    this._presetMenuOpen = false;
    this._presetMenuLayerOff = null;
    this._customNotesDraft = null;
    this._notePickerSlot = null;
    this._notePickerOpen = false;
    this._notePickerLayerOff = null;
    this.refreshTargets();
  }

  refreshTargets() {
    this.targets = createTuningTargets(this.tuning, this.a4);
  }

  getTarget(slot = this.targetSlot) {
    if (slot === 'auto' || slot === null || slot === undefined) return null;
    return this.targets[Number(slot)] || null;
  }

  // A4 校准入口：设置面板统一走这里
  setA4(value) {
    this.a4 = clampA4(value);
    try { localStorage.setItem('guitar_tuner_a4', String(this.a4)); } catch (err) {}
    this.refreshTargets();
    this.resetDetectionState();
    if (this.isPlayingRef) {
      this.stopReferenceTone();
      this.restoreAfterRef();
    }
    this.updateA4UI();
    this.updateTuningUI();
    this.resetCentsChart();
    return this.a4;
  }

  setTuning(tuning, custom = this.customTuning, persist = true) {
    this.tuning = tuning;
    this.customTuning = tuning.custom || custom || null;
    if (persist) writeTuningState(tuning, this.customTuning);
    this.refreshTargets();
    this.resetDetectionState();
    if (this.isPlayingRef) {
      this.stopReferenceTone();
      this.restoreAfterRef();
    }
    this.updateTuningUI();
    this.updateA4UI();
    this.renderPresetList();
    this.resetCentsChart();
  }

  resetDetectionState() {
    this.frequencyHistory = [];
    this.lastValidAt = 0;
    this.lastSlot = null;
    this.wasInTune = false;
    this.centsHistory = [];
    this.lastChartAt = 0;
  }

  updateTuningUI() {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;
    const name = root.getElementById('tuningName');
    const a4Status = root.getElementById('a4Status');
    if (name) name.textContent = this.tuning.name || '自定义调弦';
    if (a4Status) {
      const off = this.a4 !== A4_DEFAULT;
      a4Status.hidden = !off;
      a4Status.textContent = off ? `A4 ${this.a4}` : '';
    }

    root.querySelectorAll('.string-btn').forEach(btn => {
      const raw = btn.dataset.slot;
      if (raw === 'auto') return;
      const target = this.targets[Number(raw)];
      if (!target) return;
      const note = btn.querySelector('.string-note');
      const num = btn.querySelector('.string-num');
      if (note) note.textContent = target.label;
      if (num) num.textContent = String(target.stringNumber);
      btn.setAttribute('aria-label', `第${target.stringNumber}弦 ${target.name}，点击选中并试听`);
      btn.classList.toggle('active', this.targetSlot !== 'auto' && Number(raw) === Number(this.targetSlot));
    });
    const autoBtn = root.querySelector('.string-btn.auto');
    if (autoBtn) autoBtn.classList.toggle('active', this.targetSlot === 'auto');

    const customEntry = root.getElementById('customEntry');
    const customName = root.getElementById('customEntryName');
    const customHint = root.getElementById('customEntryHint');
    if (customEntry) customEntry.classList.toggle('active', this.tuning.id === CUSTOM_TUNING_ID);
    if (customName) customName.textContent = this.customTuning ? this.customTuning.name : '自定义调弦';
    if (customHint) customHint.textContent = this.customTuning
      ? formatTuningNotes(this.customTuning.notes)
      : '自己设置六弦音高';
  }

  updateA4UI() {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;
    const val = root.getElementById('a4SheetVal');
    const minus = root.getElementById('a4SheetMinus');
    const plus = root.getElementById('a4SheetPlus');
    if (val) val.textContent = String(this.a4);
    if (minus) minus.disabled = this.a4 <= A4_MIN;
    if (plus) plus.disabled = this.a4 >= A4_MAX;
    root.querySelectorAll('.mini-chip[data-a4]').forEach(chip => {
      chip.classList.toggle('active', Number(chip.dataset.a4) === this.a4);
    });
  }

  renderPresetList() {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;
    const fieldName = root.getElementById('presetFieldName');
    const fieldNotes = root.getElementById('presetFieldNotes');
    const menu = root.getElementById('presetMenu');
    const preset = this.tuning.id === CUSTOM_TUNING_ID ? null : getPresetById(this.tuning.id);

    if (fieldName) fieldName.textContent = preset ? preset.name : '选择预设';
    if (fieldNotes) fieldNotes.textContent = preset ? formatTuningNotes(preset.notes) : '点开切换预设调弦';

    if (menu) {
      menu.innerHTML = '';
      for (const option of TUNING_PRESETS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'preset-option';
        btn.dataset.preset = option.id;
        btn.setAttribute('role', 'option');
        const active = this.tuning.id === option.id;
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
        btn.classList.toggle('active', active);

        const copy = document.createElement('span');
        copy.className = 'preset-copy';
        const name = document.createElement('span');
        name.className = 'preset-name';
        name.textContent = option.name;
        const notes = document.createElement('span');
        notes.className = 'preset-notes';
        notes.textContent = formatTuningNotes(option.notes);
        copy.append(name, notes);
        btn.append(copy);

        if (active) {
          const check = document.createElement('span');
          check.className = 'preset-check';
          check.innerHTML = icon('check', 14);
          btn.append(check);
        }

        btn.onclick = (event) => {
          event.stopPropagation();
          this.applyPreset(option.id);
        };
        menu.append(btn);
      }
    }

    const customEntry = root.getElementById('customEntry');
    if (customEntry) customEntry.classList.toggle('active', this.tuning.id === CUSTOM_TUNING_ID);
  }

  togglePresetMenu() {
    if (this._presetMenuOpen) this.closePresetMenu();
    else this.openPresetMenu();
  }

  openPresetMenu() {
    if (!this.shadowRoot) return;
    const menu = this.shadowRoot.getElementById('presetMenu');
    const field = this.shadowRoot.getElementById('presetField');
    if (!menu || !field) return;
    this.renderPresetList();
    menu.hidden = false;
    field.setAttribute('aria-expanded', 'true');
    this._presetMenuOpen = true;
    if (!this._presetMenuLayerOff) {
      this._presetMenuLayerOff = registerLayer({
        id: 'tuner-preset-menu',
        close: () => this.closePresetMenu()
      });
    }
  }

  closePresetMenu() {
    if (!this.shadowRoot) return;
    const menu = this.shadowRoot.getElementById('presetMenu');
    const field = this.shadowRoot.getElementById('presetField');
    if (menu) menu.hidden = true;
    if (field) field.setAttribute('aria-expanded', 'false');
    this._presetMenuOpen = false;
    if (this._presetMenuLayerOff) {
      const off = this._presetMenuLayerOff;
      this._presetMenuLayerOff = null;
      off();
    }
  }

  applyPreset(presetId) {
    const preset = getPresetById(presetId);
    if (!preset) return;
    this.closePresetMenu();
    const tuning = { ...preset, custom: this.customTuning };
    this.setTuning(tuning, this.customTuning, true);
    this.showSettingsMain();
  }

  openSettings() {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;
    const mask = root.getElementById('settingsMask');
    if (!mask) return;
    this.closePresetMenu();
    this.renderPresetList();
    this.updateA4UI();
    this.updateTuningUI();
    this.paintFeedback();
    this.showSettingsMain();
    if (this._settingsLayerOff) this._settingsLayerOff();
    this._settingsLayerOff = registerLayer({
      id: 'tuner-settings',
      close: () => this.handleSettingsBack()
    });
    mask.hidden = false;
    mask.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      mask.classList.add('show');
      const close = root.getElementById('closeSettings');
      if (close) {
        // 弹层还在入场动画中，聚焦若触发滚动会把 WebView 视口上推，主界面会闪动
        try { close.focus({ preventScroll: true }); } catch (err) { close.focus(); }
      }
    });
  }

  // 返回键：自定义调弦编辑先退回设置主页，再关整个调音设置
  handleSettingsBack() {
    if (!this.shadowRoot) return;
    if (this._presetMenuOpen) {
      this.closePresetMenu();
      return;
    }
    const editor = this.shadowRoot.getElementById('customEditor');
    if (editor && !editor.hidden) {
      this.showSettingsMain();
      return;
    }
    this.closeSettings();
  }

  closeSettings() {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;
    const mask = root.getElementById('settingsMask');
    if (!mask) return;
    this.closePresetMenu();
    this.closeNotePicker();
    if (this._settingsLayerOff) {
      this._settingsLayerOff();
      this._settingsLayerOff = null;
    }
    mask.classList.remove('show');
    mask.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!mask.classList.contains('show')) mask.hidden = true;
    }, 220);
  }

  showSettingsMain() {
    if (!this.shadowRoot) return;
    this.closePresetMenu();
    this.closeNotePicker();
    const main = this.shadowRoot.getElementById('settingsMain');
    const editor = this.shadowRoot.getElementById('customEditor');
    if (main) main.hidden = false;
    if (editor) editor.hidden = true;
  }

  showCustomEditor() {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;
    this.closePresetMenu();
    this.closeNotePicker();
    const main = root.getElementById('settingsMain');
    const editor = root.getElementById('customEditor');
    const nameInput = root.getElementById('customName');
    if (main) main.hidden = true;
    if (editor) editor.hidden = false;
    const notes = this.customTuning ? this.customTuning.notes : TUNING_PRESETS[0].notes;
    if (nameInput) nameInput.value = this.customTuning ? this.customTuning.name : '';
    this.buildCustomNoteFields(notes);
  }

  buildCustomNoteFields(notes) {
    if (!this.shadowRoot) return;
    const wrap = this.shadowRoot.getElementById('customNotes');
    if (!wrap) return;
    wrap.innerHTML = '';
    const fallback = TUNING_PRESETS[0].notes;
    this._customNotesDraft = [];
    for (let slot = 0; slot < 6; slot++) {
      this._customNotesDraft.push(notes[slot] || fallback[slot]);
    }
    for (let slot = 0; slot < 6; slot++) {
      const field = document.createElement('div');
      field.className = 'note-field';
      const label = document.createElement('span');
      label.className = 'note-field-label';
      label.textContent = `第${6 - slot}弦`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'note-field-btn';
      btn.id = `customNote${slot}`;
      btn.dataset.slot = String(slot);
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-label', `第${6 - slot}弦音高，当前 ${this._customNotesDraft[slot]}`);
      const value = document.createElement('span');
      value.className = 'note-field-value';
      value.textContent = this._customNotesDraft[slot];
      const chevron = document.createElement('span');
      chevron.className = 'note-field-chevron';
      chevron.innerHTML = icon('chevronRight', 12);
      btn.append(value, chevron);
      btn.addEventListener('click', () => this.openNotePicker(slot));
      field.append(label, btn);
      wrap.append(field);
    }
  }

  updateCustomNoteButton(slot) {
    if (!this.shadowRoot || !this._customNotesDraft) return;
    const btn = this.shadowRoot.getElementById(`customNote${slot}`);
    if (!btn) return;
    const value = btn.querySelector('.note-field-value');
    if (value) value.textContent = this._customNotesDraft[slot];
    btn.setAttribute('aria-label', `第${6 - slot}弦音高，当前 ${this._customNotesDraft[slot]}`);
  }

  openNotePicker(slot) {
    if (!this.shadowRoot || slot < 0 || slot > 5) return;
    if (!Array.isArray(this._customNotesDraft) || this._customNotesDraft.length !== 6) return;
    const root = this.shadowRoot;
    this.closePresetMenu();
    this.closeNotePicker();
    this._notePickerSlot = slot;

    const mask = root.getElementById('notePickerMask');
    const list = root.getElementById('notePickerList');
    const title = root.getElementById('notePickerTitle');
    if (!mask || !list) return;
    if (title) title.textContent = `第${6 - slot}弦音高`;
    list.innerHTML = '';
    for (const opt of guitarNoteOptions()) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'note-option';
      option.dataset.note = opt.note;
      option.textContent = opt.note;
      option.setAttribute('role', 'option');
      const active = opt.note === this._customNotesDraft[slot];
      option.setAttribute('aria-selected', String(active));
      if (active) option.classList.add('active');
      option.addEventListener('click', () => {
        this._customNotesDraft[slot] = opt.note;
        this.updateCustomNoteButton(slot);
        this.closeNotePicker();
      });
      list.append(option);
    }

    mask.hidden = false;
    mask.setAttribute('aria-hidden', 'false');
    this._notePickerOpen = true;
    this._notePickerLayerOff = registerLayer({ id: 'tuner-note-picker', close: () => this.closeNotePicker() });
    requestAnimationFrame(() => {
      if (!this._notePickerOpen) return;
      mask.classList.add('show');
      const selected = list.querySelector('.note-option.active');
      if (selected) {
        try {
          selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch (err) {}
      }
    });
  }

  closeNotePicker() {
    if (this._notePickerLayerOff) {
      this._notePickerLayerOff();
      this._notePickerLayerOff = null;
    }
    this._notePickerOpen = false;
    this._notePickerSlot = null;
    if (!this.shadowRoot) return;
    const mask = this.shadowRoot.getElementById('notePickerMask');
    if (!mask) return;
    mask.classList.remove('show');
    mask.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!mask.classList.contains('show')) mask.hidden = true;
    }, 220);
  }

  readCustomNotes() {
    if (!Array.isArray(this._customNotesDraft) || this._customNotesDraft.length !== 6) return null;
    return this._customNotesDraft.slice();
  }

  saveCustomTuning() {
    if (!this.shadowRoot) return;
    const nameInput = this.shadowRoot.getElementById('customName');
    const notes = this.readCustomNotes();
    const plan = normalizeCustomTuning({ name: nameInput ? nameInput.value : '', notes });
    if (!plan) {
      showToast('自定义调弦无效：六根弦都必须在 D2–E5 之间');
      return;
    }
    const tuning = { id: CUSTOM_TUNING_ID, name: plan.name, notes: plan.notes, custom: plan };
    this.setTuning(tuning, plan, true);
    this.closeSettings();
  }

  fillCustomStandard() {
    const notes = TUNING_PRESETS[0].notes;
    this.buildCustomNoteFields(notes);
  }

  paintFeedback() {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;
    const soundBtn = root.getElementById('fbSound');
    const vibrateBtn = root.getElementById('fbVibrate');
    if (soundBtn) {
      soundBtn.setAttribute('aria-pressed', String(this.feedbackSound));
    }
    const vibrateSupported = typeof navigator.vibrate === 'function';
    if (vibrateBtn) {
      vibrateBtn.setAttribute('aria-pressed', String(this.feedbackVibrate && vibrateSupported));
      vibrateBtn.disabled = !vibrateSupported;
      vibrateBtn.title = vibrateSupported ? '调准时震动一下' : '当前设备 / 浏览器不支持震动';
    }
  }

  stopReferenceTone() {
    this.refEpoch = (this.refEpoch || 0) + 1;
    if (this.refTimer) { clearTimeout(this.refTimer); this.refTimer = null; }
    if (this.refToneHandle) {
      // 不硬切：交给音频引擎做 35ms 淡出，避免 A 未放完切 B 时出现截断爆音
      this.refToneHandle.stop(0.035);
      this.refToneHandle = null;
    }
    this.isPlayingRef = false;
    this.setStringPlaying(null, false);
  }

  setStringPlaying(slot, on) {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll('.string-btn').forEach(btn => {
      const raw = btn.dataset.slot;
      const active = on && raw !== 'auto' && Number(raw) === Number(slot);
      btn.classList.toggle('playing', active);
    });
  }

  restoreAfterRef() {
    const statusText = this.shadowRoot && this.shadowRoot.getElementById('statusText');
    if (statusText) {
      statusText.textContent = this.isListening ? '拨动琴弦...' : '点击“开始调音”并允许麦克风';
      statusText.style.color = this.isListening ? 'var(--accent)' : 'var(--muted)';
    }
    this.lastAnalysisAt = 0;
    this.lastValidAt = 0;
    this.frequencyHistory = [];
    this.centsHistory = [];
    this.resetCentsChart();
  }

  // 试听标准音：播放期间暂停检测，避免麦克风把扬声器里的参考音当成琴声
  async playReferenceTone(slot = this.targetSlot) {
    const target = this.getTarget(slot);
    if (!target) return;

    this.stopReferenceTone();
    const epoch = this.refEpoch;
    this.isPlayingRef = true;
    this.frequencyHistory = [];
    this.lastValidAt = 0;
    this.wasInTune = false;
    this.setStringPlaying(target.slot, true);

    const statusText = this.shadowRoot.getElementById('statusText');
    if (statusText) {
      statusText.textContent = `第${target.stringNumber}弦 ${target.name} 准备中...`;
      statusText.style.color = 'var(--accent)';
    }

    // 切后台后 AudioContext 可能已 suspended：等 resume 完成再排音，避免“看起来在播、实际没声”。
    // 加 250ms 上限：个别 WebView / 无声卡环境 resume 可能一直不 resolve，不能让试听锁死检测。
    let resumeTimer = null;
    const resumed = await Promise.race([
      audioEngine.resume().then(() => true).catch(() => false),
      new Promise(resolve => { resumeTimer = setTimeout(() => resolve('timeout'), 250); })
    ]);
    if (resumeTimer) clearTimeout(resumeTimer);
    if (epoch !== this.refEpoch) return;
    if (resumed === false) {
      this.isPlayingRef = false;
      this.setStringPlaying(null, false);
      this.restoreAfterRef();
      return;
    }

    if (statusText) statusText.textContent = `第${target.stringNumber}弦 ${target.name} 试听中...`;
    this.refToneHandle = audioEngine.tone(target.frequency, {
      dur: 1.0,
      level: REFERENCE_LEVELS[target.note] || 0.22
    });
    this.refTimer = setTimeout(() => {
      this.refToneHandle = null;
      this.isPlayingRef = false;
      this.refTimer = null;
      this.setStringPlaying(null, false);
      this.restoreAfterRef();
    }, 1080);
  }

  resetCentsChart() {
    if (!this.shadowRoot) return;
    const path = this.shadowRoot.getElementById('centsPath');
    const dot = this.shadowRoot.getElementById('centsDot');
    const wrap = this.shadowRoot.getElementById('centsWrap');
    if (path) path.setAttribute('d', '');
    if (dot) { dot.setAttribute('cx', '-10'); dot.setAttribute('cy', '25'); }
    if (wrap) wrap.classList.remove('in-tune');
  }

  pushCents(cents, inTune) {
    const now = performance.now();
    this.centsHistory.push({ t: now, cents: Math.max(-50, Math.min(50, cents)) });
    const cutoff = now - 10000;
    while (this.centsHistory.length && this.centsHistory[0].t < cutoff) this.centsHistory.shift();

    if (now - this.lastChartAt >= 100) {
      this.lastChartAt = now;
      this.renderCentsChart(now, inTune);
    }
  }

  renderCentsChart(now, inTune) {
    if (!this.shadowRoot) return;
    const path = this.shadowRoot.getElementById('centsPath');
    const dot = this.shadowRoot.getElementById('centsDot');
    const wrap = this.shadowRoot.getElementById('centsWrap');
    if (!path || !dot || !wrap) return;

    const points = this.centsHistory.filter(p => now - p.t <= 10000);
    if (!points.length) {
      path.setAttribute('d', '');
      dot.setAttribute('cx', '-10');
      return;
    }

    let d = '';
    let lastX = 300;
    let lastY = 25;
    for (const p of points) {
      const x = 300 - ((now - p.t) / 10000) * 300;
      const y = 25 - (p.cents / 50) * 22;
      d += (d ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      lastX = x;
      lastY = y;
    }
    path.setAttribute('d', d);
    dot.setAttribute('cx', lastX.toFixed(1));
    dot.setAttribute('cy', lastY.toFixed(1));
    wrap.classList.toggle('in-tune', !!inTune);
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `<style>${tunerCSS}</style>${tunerHTML}`;
    this.initLogic();
    // 切到别的页面就立刻关麦，回来时按钮已是「开启麦克风」
    this.handleTabChange = (e) => {
      if (!e.detail || e.detail.target !== 'view-tuner') this.stopTuner();
    };
    window.addEventListener('app-tab-changed', this.handleTabChange);
  }

  disconnectedCallback() {
    window.removeEventListener('app-tab-changed', this.handleTabChange);
    if (this._settingsBackdropOff) {
      this._settingsBackdropOff();
      this._settingsBackdropOff = null;
    }
    if (this._settingsLayerOff) {
      this._settingsLayerOff();
      this._settingsLayerOff = null;
    }
    if (this._presetMenuLayerOff) {
      this._presetMenuLayerOff();
      this._presetMenuLayerOff = null;
    }
    this.closeNotePicker();
    if (this._notePickerBackdropOff) {
      this._notePickerBackdropOff();
      this._notePickerBackdropOff = null;
    }
    this.stopTuner();
  }

  // 调准反馈：只在「刚进入音准区」时触发，且 1.2 秒内不重复
  triggerInTuneFeedback() {
    const now = performance.now();
    if (now - this.lastFeedbackAt < 1200) return;
    this.lastFeedbackAt = now;

    if (this.feedbackSound) {
      try {
        audioEngine.ensure();
        audioEngine.chime(audioEngine.currentTime + 0.01, {
          freq: 2093, level: 0.26, dur: 0.32
        });
        // 叮的尾音还在空气里 / 麦克风里时不要继续测音，否则会被自己的提示音带偏
        this.chimeGuardUntil = now + CHIME_DETECT_GUARD_MS;
      } catch (err) {}
    }

    if (this.feedbackVibrate && typeof navigator.vibrate === 'function') {
      navigator.vibrate(50);
    }
  }

  resetTunerUI() {
    const root = this.shadowRoot;
    if (!root) return;
    const btnToggle = root.getElementById('btnToggle');
    const statusText = root.getElementById('statusText');
    const noteName = root.getElementById('noteName');
    const freqVal = root.getElementById('freqVal');
    const needle = root.getElementById('needle');

    if (btnToggle) {
      btnToggle.innerHTML = `${icon('mic', 18)} 开始调音`;
      btnToggle.className = 'btn-toggle start';
    }
    if (statusText) {
      statusText.textContent = '点击“开始调音”并允许麦克风';
      statusText.style.color = 'var(--muted)';
    }
    if (noteName) {
      noteName.textContent = '--';
      noteName.classList.remove('in-tune');
    }
    if (freqVal) freqVal.textContent = '0.0 Hz';
    if (needle) {
      needle.style.transform = 'rotate(0deg)';
      needle.classList.remove('in-tune');
    }
  }

  initLogic() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    const btnToggle = $('btnToggle');
    const noteName = $('noteName');
    const freqVal = $('freqVal');
    const statusText = $('statusText');
    const needle = $('needle');
    const stringsRow = $('stringsRow');

    // 弦位选择：点一根弦 = 选中该弦 + 播放该弦标准音；再点同一根弦可停止试听
    stringsRow.querySelectorAll('.string-btn').forEach(btn => {
      btn.onclick = () => {
        const raw = btn.dataset.slot;
        const slot = raw === 'auto' ? 'auto' : Number(raw);
        if (slot !== 'auto' && this.targetSlot === slot && this.isPlayingRef) {
          this.stopReferenceTone();
          this.restoreAfterRef();
          return;
        }
        this.targetSlot = slot;
        this.resetDetectionState();
        this.updateTuningUI();
        this.resetCentsChart();
        if (this.isPlayingRef) {
          this.stopReferenceTone();
          this.restoreAfterRef();
        }
        if (slot !== 'auto') this.playReferenceTone(slot);
      };
    });

    // 状态条 / 调音设置面板
    const openSettings = $('openSettings');
    const settingsMask = $('settingsMask');
    const settingsSheet = $('settingsSheet');
    const closeSettings = $('closeSettings');
    const presetField = $('presetField');
    const a4SheetMinus = $('a4SheetMinus');
    const a4SheetPlus = $('a4SheetPlus');
    const customEntry = $('customEntry');
    const customBack = $('customBack');
    const customReset = $('customReset');
    const customSave = $('customSave');

    if (openSettings) openSettings.onclick = () => this.openSettings();
    if (closeSettings) closeSettings.onclick = () => this.closeSettings();
    if (settingsMask) {
      this._settingsBackdropOff = bindBackdrop(settingsMask, () => this.closeSettings());
    }
    const notePickerMask = $('notePickerMask');
    const closeNotePickerBtn = $('closeNotePicker');
    if (notePickerMask) {
      this._notePickerBackdropOff = bindBackdrop(notePickerMask, () => this.closeNotePicker());
    }
    if (closeNotePickerBtn) closeNotePickerBtn.onclick = () => this.closeNotePicker();
    if (presetField) {
      presetField.onclick = (event) => {
        event.stopPropagation();
        this.togglePresetMenu();
      };
    }
    if (settingsSheet) {
      settingsSheet.addEventListener('scroll', () => {
        if (this._presetMenuOpen) this.closePresetMenu();
      }, { passive: true });
    }
    this.shadowRoot.addEventListener('pointerdown', (event) => {
      if (!this._presetMenuOpen) return;
      const path = event.composedPath();
      if (path.some(node => node && node.classList && node.classList.contains('preset-select'))) return;
      this.closePresetMenu();
    });
    if (a4SheetMinus) a4SheetMinus.onclick = () => this.setA4(this.a4 - 1);
    if (a4SheetPlus) a4SheetPlus.onclick = () => this.setA4(this.a4 + 1);
    if (customEntry) customEntry.onclick = () => this.showCustomEditor();
    if (customBack) customBack.onclick = () => this.showSettingsMain();
    if (customReset) customReset.onclick = () => this.fillCustomStandard();
    if (customSave) customSave.onclick = () => this.saveCustomTuning();
    this.shadowRoot.querySelectorAll('.mini-chip[data-a4]').forEach(chip => {
      chip.onclick = () => this.setA4(Number(chip.dataset.a4));
    });

    // 反馈开关：只控制“调准提示音 / 震动”，不控制点弦试听的标准音
    const fbSound = $('fbSound');
    const fbVibrate = $('fbVibrate');
    if (fbSound) {
      fbSound.onclick = () => {
        this.feedbackSound = !this.feedbackSound;
        writeBoolSetting('guitar_tuner_feedback_sound', this.feedbackSound);
        this.paintFeedback();
      };
    }
    if (fbVibrate) {
      fbVibrate.onclick = () => {
        if (fbVibrate.disabled) return;
        this.feedbackVibrate = !this.feedbackVibrate;
        writeBoolSetting('guitar_tuner_feedback_vibrate', this.feedbackVibrate);
        this.paintFeedback();
      };
    }
    this.updateA4UI();
    this.updateTuningUI();
    this.renderPresetList();
    this.paintFeedback();

    // YIN 基频检测已抽到 services/pitch.js：纯前端 DSP，浏览器与 WebView 共用
    const updatePitch = () => {
      if (!this.isListening || !this.analyser) return;

      const now = performance.now();

      // 标准音播放期间暂停检测，避免把扬声器里的参考音当成琴声
      if (this.isPlayingRef) {
        this.rafId = requestAnimationFrame(updatePitch);
        return;
      }
      // 调准提示音的保护窗口：保持上一帧读数，不采提示音，也不清空历史
      if (now < this.chimeGuardUntil) {
        this.rafId = requestAnimationFrame(updatePitch);
        return;
      }
      // 30fps 足够跟手，也把低端机的 CPU 留出来
      if (now - this.lastAnalysisAt < 30) {
        this.rafId = requestAnimationFrame(updatePitch);
        return;
      }
      this.lastAnalysisAt = now;

      const bufferLength = this.analyser.fftSize;
      const buffer = new Float32Array(bufferLength);
      this.analyser.getFloatTimeDomainData(buffer);

      const result = detectYin(buffer, audioEngine.sampleRate, { minFreq: 70, maxFreq: 400 });

      if (result && result.frequency >= 70 && result.frequency <= 400 && result.confidence >= 0.6) {
        // 谐波折叠：低音弦尾音基频变弱时，164.8Hz 之类会折回 82.4Hz，避免误判成 D3
        const folded = foldToGuitarFundamental(result.frequency, this.a4, this.targetSlot, this.targets);

        // 超过 250ms 没有有效信号，视为新一次拨弦，允许重新选弦
        if (now - this.lastValidAt > 250) this.frequencyHistory = [];
        this.lastValidAt = now;

        // 中值滤波：比滑动平均更能压住拨弦瞬间的毛刺和八度跳变
        this.frequencyHistory.push(folded);
        if (this.frequencyHistory.length > 5) this.frequencyHistory.shift();

        let stablePitch = medianFrequency(this.frequencyHistory);

        processPitch(stablePitch);
      } else {
        // 声音已停：清掉尾音，避免指针停在旧读数上
        if (this.frequencyHistory.length > 0 && now - this.lastValidAt > 500) {
          this.frequencyHistory = [];
          this.lastValidAt = 0;
        }

        if (this.frequencyHistory.length === 0) {
          noteName.textContent = '--';
          freqVal.textContent = '0.0 Hz';
          statusText.textContent = '拨动琴弦...';
          needle.style.transform = `rotate(0deg)`;
          needle.classList.remove('in-tune');
          noteName.classList.remove('in-tune');
        }
      }
      
      this.rafId = requestAnimationFrame(updatePitch);
    };

    const processPitch = (freq) => {
      let target = null;

      // 自动识别最近的一根弦；手动模式固定到当前弦位
      if (this.targetSlot === 'auto') {
        let minDiff = Infinity;
        for (const candidate of this.targets) {
          // 利用对数距离，因为音乐是呈指数分布的
          const diff = Math.abs(Math.log2(freq / candidate.frequency));
          if (diff < minDiff) {
            minDiff = diff;
            target = candidate;
          }
        }
      } else {
        target = this.getTarget(this.targetSlot);
      }
      if (!target) return;

      // 换弦（自动模式）或手动选弦：音分曲线重新起一段
      if (this.lastSlot !== target.slot) {
        this.lastSlot = target.slot;
        this.centsHistory = [];
        this.lastChartAt = 0;
        this.resetCentsChart();
      }

      noteName.textContent = target.label;
      freqVal.textContent = freq.toFixed(1) + ' Hz';

      // 计算音分差异 (100 cents = 半音)
      const cents = 1200 * Math.log2(freq / target.frequency);
      
      // 限制指针范围 (-50 到 +50 音分)
      let clampedCents = Math.max(-50, Math.min(50, cents));
      
      // 映射到角度 (-45度 到 45度)
      let angle = (clampedCents / 50) * 45;
      
      // 指针过渡逻辑：低音准往左，高音准往右
      needle.style.transform = `rotate(${angle}deg)`;

      const inTune = Math.abs(cents) <= 5;
      if (inTune) {
        if (!this.wasInTune) this.triggerInTuneFeedback();
        this.wasInTune = true;
      } else {
        this.wasInTune = false;
      }

      this.pushCents(cents, inTune);

      if (inTune) {
        // 绿色，音准了
        needle.classList.add('in-tune');
        noteName.classList.add('in-tune');
        statusText.innerHTML = `${icon('target', 15)} 音准完美！`;
        statusText.style.color = 'var(--success)';
      } else {
        needle.classList.remove('in-tune');
        noteName.classList.remove('in-tune');
        if (cents < 0) {
          statusText.textContent = '偏低 ↓ 请稍微拧紧';
          statusText.style.color = 'var(--accent)';
        } else {
          statusText.textContent = '偏高 ↑ 请稍微拧松';
          statusText.style.color = 'var(--danger)';
        }
      }
    };

    btnToggle.onclick = async () => {
      if (this.isListening) {
        this.stopTuner();
      } else {
        try {
          btnToggle.textContent = '正在启动...';
          const epoch = ++this.stopEpoch;
          this.stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } 
          });

          if (epoch !== this.stopEpoch) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
            return;
          }
          
          // 复用全局上下文，不再为调音器新开一个（也不再 close）
          this.analyserHandle = audioEngine.openAnalyser(this.stream);
          this.analyser = this.analyserHandle.analyser;
          audioEngine.preloadChime();
          
          this.isListening = true;
          wakeLock.acquire('tuner');
          btnToggle.innerHTML = `${icon('stop', 18)} 停止调音`;
          btnToggle.className = 'btn-toggle stop';
          statusText.textContent = '拨动琴弦...';
          statusText.style.color = 'var(--accent)';
          this.frequencyHistory = [];
          this.lastAnalysisAt = 0;
          this.lastValidAt = 0;
          this.lastSlot = null;
          this.wasInTune = false;
          this.centsHistory = [];
          this.resetCentsChart();
          
          updatePitch();
        } catch (err) {
          console.error(err);
          if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
          }
          this.isListening = false;
          btnToggle.innerHTML = `${icon('mic', 18)} 开始调音`;
          btnToggle.className = 'btn-toggle start';
          statusText.textContent = '麦克风未开启';
          statusText.style.color = 'var(--danger)';
          showToast(err && err.name === 'NotAllowedError'
            ? '麦克风权限被拒绝：请在系统设置中允许 Guitar Shell 使用麦克风'
            : '无法获取麦克风，请确认在 HTTPS / localhost 下运行并允许麦克风访问');
        }
      }
    };
  }

  stopTuner() {
    this.stopEpoch = (this.stopEpoch || 0) + 1;
    this.isListening = false;
    wakeLock.release('tuner');
    this.stopReferenceTone();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    // 只断开节点，不关上下文：上下文是全局共享的，关掉会影响节拍器
    if (this.analyserHandle) {
      this.analyserHandle.dispose();
      this.analyserHandle = null;
    }
    this.analyser = null;
    this.frequencyHistory = [];
    this.lastValidAt = 0;
    this.wasInTune = false;
    this.lastFeedbackAt = -1e9;
    this.chimeGuardUntil = 0;
    this.lastSlot = null;
    this.centsHistory = [];
    this.lastChartAt = 0;
    this.resetCentsChart();
    this.resetTunerUI();
  }
}

customElements.define('guitar-tuner', GuitarTuner);