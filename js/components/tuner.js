import { audioEngine } from '../services/audio.js';
import { wakeLock } from '../services/wakelock.js';
import { showToast } from '../services/toast.js';
import {
  detectYin,
  guitarStringTargets,
  clampA4,
  A4_DEFAULT,
  A4_MIN,
  A4_MAX,
  medianFrequency,
  foldToGuitarFundamental
} from '../services/pitch.js';
import { icon } from '../services/icons.js';

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
  E2: 0.36,
  A2: 0.34,
  D3: 0.3,
  G3: 0.28,
  B3: 0.25,
  E4: 0.22
};

const tunerCSS = `
  button, label, input, select { outline: none !important; -webkit-tap-highlight-color: transparent !important; }
  :host { display: flex; flex-direction: column; height: 100%; width: 100%; background: linear-gradient(180deg, var(--bg2), var(--bg0)); color: var(--txt); overflow: hidden; font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", -apple-system, sans-serif; align-items: center; justify-content: center; }
  
  .container { display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 500px; padding: 16px 20px; gap: 20px; box-sizing: border-box; }
  
  /* 提示与音符显示 */
  .display-area { text-align: center; height: 120px; display: flex; flex-direction: column; justify-content: flex-end; }
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
  .btn-toggle { padding: 16px 40px; border-radius: 30px; border: none; font-size: 18px; font-weight: bold; cursor: pointer; transition: 0.3s; display: flex; align-items: center; gap: 10px; margin-top: 20px; outline: none; -webkit-appearance: none; appearance: none; -webkit-tap-highlight-color: transparent; }
  .btn-toggle:focus { outline: none !important; }
  .btn-toggle:focus-visible { outline: none !important; }
  .btn-toggle:active { outline: none !important; }
  .btn-toggle.start { background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary); box-shadow: 0 6px 20px rgba(var(--primary-rgb), 0.3); }
  .btn-toggle.stop { background: var(--danger); color: var(--on-danger); box-shadow: 0 6px 20px rgba(var(--danger-rgb), 0.28); }
  .btn-toggle:active { transform: scale(0.95); }
`;

const tunerHTML = `
  <div class="container">
    <div class="display-area">
      <div class="note-name" id="noteName">--</div>
      <div class="freq-val" id="freqVal">0.0 Hz</div>
      <div class="status-text" id="statusText">点击下方按钮开启麦克风</div>
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
      <button class="string-btn auto active" data-note="auto">自动</button>
      <button class="string-btn" data-note="E2">E</button>
      <button class="string-btn" data-note="A2">A</button>
      <button class="string-btn" data-note="D3">D</button>
      <button class="string-btn" data-note="G3">G</button>
      <button class="string-btn" data-note="B3">B</button>
      <button class="string-btn" data-note="E4">e</button>
    </div>

    <div class="tools-row">
      <div class="a4-box">
        <span class="a4-label">A4</span>
        <button class="step-btn" id="a4Minus" type="button" aria-label="A4 降低 1Hz">${icon('minus', 15)}</button>
        <span class="a4-val" id="a4Val">440 Hz</span>
        <button class="step-btn" id="a4Plus" type="button" aria-label="A4 升高 1Hz">${icon('plus', 15)}</button>
      </div>
      <button class="ref-btn" id="refTone" type="button" disabled>${icon('volume', 15)} 标准音</button>
    </div>

    <div class="feedback-row">
      <button class="feedback-btn active" id="fbSound" type="button" aria-pressed="true">${icon('bell', 15)} 提示音</button>
      <button class="feedback-btn active" id="fbVibrate" type="button" aria-pressed="true">${icon('vibrate', 15)} 震动</button>
    </div>

    <button class="btn-toggle start" id="btnToggle">${icon('mic', 18)} 开启麦克风</button>
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
    this.targetNote = 'auto'; // 默认自动识别
    this.lastAnalysisAt = 0;
    this.lastValidAt = 0;

    // 调准反馈：进入 ±5 音分时响一次 / 震一次
    this.feedbackSound = readBoolSetting('guitar_tuner_feedback_sound', true);
    this.feedbackVibrate = readBoolSetting('guitar_tuner_feedback_vibrate', true);
    this.wasInTune = false;
    this.lastFeedbackAt = -1e9;
    this.chimeGuardUntil = 0;

    // C5b：A4 校准 / 标准音试听 / 音分曲线
    this.lastString = null;
    this.centsHistory = [];
    this.lastChartAt = 0;
    this.isPlayingRef = false;
    this.refToneHandle = null;
    this.refTimer = null;
    this.refEpoch = 0;

    // A4 校准：C5a 先把能力放进检测层，界面留给 C5b
    let savedA4 = A4_DEFAULT;
    try {
      const raw = localStorage.getItem('guitar_tuner_a4');
      if (raw) savedA4 = Number(raw);
    } catch (err) {}
    this.a4 = clampA4(savedA4);

    // 吉他标准调弦频率（随 A4 校准联动，不再写死 440 的数值）
    this.stringFreqs = {};
    guitarStringTargets(this.a4).forEach(s => { this.stringFreqs[s.name] = s.frequency; });
  }

  // A4 校准入口：设置面板 / 未来自定义音效都走这里
  setA4(value) {
    this.a4 = clampA4(value);
    try { localStorage.setItem('guitar_tuner_a4', String(this.a4)); } catch (err) {}
    this.stringFreqs = {};
    guitarStringTargets(this.a4).forEach(s => { this.stringFreqs[s.name] = s.frequency; });
    this.frequencyHistory = [];
    this.lastValidAt = 0;
    this.centsHistory = [];
    this.lastChartAt = 0;
    if (this.isPlayingRef) {
      this.stopReferenceTone();
      this.restoreAfterRef();
    }
    this.updateA4UI();
    this.resetCentsChart();
    return this.a4;
  }

  updateA4UI() {
    if (!this.shadowRoot) return;
    const val = this.shadowRoot.getElementById('a4Val');
    const minus = this.shadowRoot.getElementById('a4Minus');
    const plus = this.shadowRoot.getElementById('a4Plus');
    if (val) val.textContent = `${this.a4} Hz`;
    if (minus) minus.disabled = this.a4 <= A4_MIN;
    if (plus) plus.disabled = this.a4 >= A4_MAX;
  }

  updateRefButton() {
    if (!this.shadowRoot) return;
    const btn = this.shadowRoot.getElementById('refTone');
    if (!btn) return;
    const target = this.targetNote === 'auto' ? this.lastString : this.targetNote;
    btn.disabled = !target;
    btn.innerHTML = target
      ? `${icon('volume', 15)} 标准音 ${target.replace(/\d/g, '')}`
      : `${icon('volume', 15)} 标准音（先选弦）`;
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
  }

  restoreAfterRef() {
    const statusText = this.shadowRoot && this.shadowRoot.getElementById('statusText');
    if (statusText) {
      statusText.textContent = this.isListening ? '拨动琴弦...' : '点击下方按钮开启麦克风';
      statusText.style.color = this.isListening ? 'var(--accent)' : 'var(--muted)';
    }
    this.lastAnalysisAt = 0;
    this.lastValidAt = 0;
    this.frequencyHistory = [];
    this.centsHistory = [];
    this.resetCentsChart();
  }

  // 试听标准音：播放期间暂停检测，避免麦克风把扬声器里的参考音当成琴声
  async playReferenceTone() {
    const target = this.targetNote === 'auto' ? this.lastString : this.targetNote;
    if (!target || !this.stringFreqs[target]) return;

    this.stopReferenceTone();
    const epoch = this.refEpoch;
    this.isPlayingRef = true;
    this.frequencyHistory = [];
    this.lastValidAt = 0;
    this.wasInTune = false;

    const statusText = this.shadowRoot.getElementById('statusText');
    if (statusText) {
      statusText.textContent = `标准音 ${target} 准备中...`;
      statusText.style.color = 'var(--accent)';
    }

    // 切后台后 AudioContext 可能已 suspended：等 resume 完成再排音，避免“看起来在播、实际没声”
    try {
      await audioEngine.resume();
    } catch (err) {
      if (epoch === this.refEpoch) {
        this.isPlayingRef = false;
        this.restoreAfterRef();
      }
      return;
    }
    if (epoch !== this.refEpoch) return;

    if (statusText) statusText.textContent = `标准音 ${target} 播放中...`;
    this.refToneHandle = audioEngine.tone(this.stringFreqs[target], {
      dur: 1.2,
      level: REFERENCE_LEVELS[target] || 0.22
    });
    this.refTimer = setTimeout(() => {
      this.refToneHandle = null;
      this.isPlayingRef = false;
      this.refTimer = null;
      this.restoreAfterRef();
    }, 1300);
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
      btnToggle.innerHTML = `${icon('mic', 18)} 开启麦克风`;
      btnToggle.className = 'btn-toggle start';
    }
    if (statusText) {
      statusText.textContent = '点击下方按钮开启麦克风';
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

    // 目标弦选择逻辑
    stringsRow.querySelectorAll('.string-btn').forEach(btn => {
      btn.onclick = () => {
        stringsRow.querySelectorAll('.string-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.targetNote = btn.dataset.note;
        this.frequencyHistory = [];
        this.lastValidAt = 0;
        this.lastString = null;
        this.wasInTune = false;
        this.centsHistory = [];
        this.lastChartAt = 0;
        this.resetCentsChart();
        if (this.isPlayingRef) {
          this.stopReferenceTone();
          this.restoreAfterRef();
        }
        this.updateRefButton();
      };
    });

    // A4 校准 + 标准音
    const a4Minus = $('a4Minus');
    const a4Plus = $('a4Plus');
    const refTone = $('refTone');
    a4Minus.onclick = () => this.setA4(this.a4 - 1);
    a4Plus.onclick = () => this.setA4(this.a4 + 1);
    refTone.onclick = () => this.playReferenceTone();
    this.updateA4UI();
    this.updateRefButton();

    // 反馈开关
    const fbSound = $('fbSound');
    const fbVibrate = $('fbVibrate');
    const paintFeedback = () => {
      fbSound.classList.toggle('active', this.feedbackSound);
      fbSound.setAttribute('aria-pressed', String(this.feedbackSound));
      const vibrateSupported = typeof navigator.vibrate === 'function';
      fbVibrate.classList.toggle('active', this.feedbackVibrate && vibrateSupported);
      fbVibrate.setAttribute('aria-pressed', String(this.feedbackVibrate && vibrateSupported));
      fbVibrate.disabled = !vibrateSupported;
      fbVibrate.title = vibrateSupported ? '调准时震动一下' : '当前设备 / 浏览器不支持震动';
      if (!vibrateSupported) fbVibrate.innerHTML = `${icon('vibrate', 15)} 震动（不支持）`;
    };
    fbSound.onclick = () => {
      this.feedbackSound = !this.feedbackSound;
      writeBoolSetting('guitar_tuner_feedback_sound', this.feedbackSound);
      paintFeedback();
    };
    fbVibrate.onclick = () => {
      if (fbVibrate.disabled) return;
      this.feedbackVibrate = !this.feedbackVibrate;
      writeBoolSetting('guitar_tuner_feedback_vibrate', this.feedbackVibrate);
      paintFeedback();
    };
    paintFeedback();

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
        const folded = foldToGuitarFundamental(result.frequency, this.a4, this.targetNote);

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
      let targetFreq = 0;
      let displayNote = '';
      let targetName = '';

      // 自动识别最近的一根弦
      if (this.targetNote === 'auto') {
        let minDiff = Infinity;
        for (const [note, f] of Object.entries(this.stringFreqs)) {
          // 利用对数距离，因为音乐是呈指数分布的
          const diff = Math.abs(Math.log2(freq / f));
          if (diff < minDiff) {
            minDiff = diff;
            targetFreq = f;
            displayNote = note.replace(/\d/, ''); // 去掉数字只留字母
            targetName = note;
          }
        }
      } else {
        targetFreq = this.stringFreqs[this.targetNote];
        displayNote = this.targetNote.replace(/\d/, '');
        targetName = this.targetNote;
      }

      // 换弦（自动模式）或手动选弦：音分曲线重新起一段
      if (this.lastString !== targetName) {
        this.lastString = targetName;
        this.centsHistory = [];
        this.lastChartAt = 0;
        this.resetCentsChart();
        this.updateRefButton();
      }

      noteName.textContent = displayNote;
      freqVal.textContent = freq.toFixed(1) + ' Hz';

      // 计算音分差异 (100 cents = 半音)
      const cents = 1200 * Math.log2(freq / targetFreq);
      
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
          this.wasInTune = false;
          
          updatePitch();
        } catch (err) {
          console.error(err);
          if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
          }
          this.isListening = false;
          btnToggle.innerHTML = `${icon('mic', 18)} 开启麦克风`;
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
    this.lastString = null;
    this.centsHistory = [];
    this.lastChartAt = 0;
    this.resetCentsChart();
    this.updateRefButton();
    this.resetTunerUI();
  }
}

customElements.define('guitar-tuner', GuitarTuner);