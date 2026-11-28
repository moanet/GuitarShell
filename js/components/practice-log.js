import { dbService } from '../services/db.js';
import { showConfirm } from './app-dialog.js';
import { getTodayPracticeSummary } from '../services/share-card.js';
import { icon } from '../services/icons.js';

// 练习内容名称可能来自备份恢复（他人数据），进 innerHTML 前必须转义
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

const logCSS = `
  :host { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  input, textarea, select, [contenteditable="true"] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
  button, label, input, select { outline: none !important; -webkit-tap-highlight-color: transparent !important; }
  :host { display: flex; flex-direction: column; height: 100%; width: 100%; background: var(--bg0); color: var(--txt); overflow: hidden; font-family: -apple-system, sans-serif; }
  .stats-line { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; margin: 10px 4px 0; padding: 10px 4px 2px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
  .stats-line .stat-val { font-size: 14px; font-weight: 700; color: var(--accent-text); }
  .stats-line .stats-sep { color: var(--muted-soft); margin: 0 3px; }
  .form-box { padding: 0 16px; background: var(--surface-deep); border-bottom: 1px solid var(--line); flex-shrink: 0; }
  .form-head { width: 100%; min-height: 48px; padding: 0; border: 0; background: transparent; color: inherit; font-family: inherit; display: flex; align-items: center; gap: 8px; text-align: left; cursor: pointer; }
  .form-title { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: var(--heading); letter-spacing: .3px; flex-shrink: 0; }
  .form-title svg { display: block; color: var(--accent-text); }
  .form-peek { margin-left: auto; min-width: 0; max-width: 58%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 600; color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
  .form-peek b { color: var(--accent-text); font-weight: 700; }
  .form-chevron { flex: 0 0 auto; width: 16px; display: grid; place-items: center; color: var(--muted); transition: transform .2s; }
  .form-chevron svg { display: block; }
  .form-box:not(.collapsed) .form-chevron { transform: rotate(90deg); }
  .form-body { display: flex; flex-direction: column; gap: 8px; padding: 0 0 10px; }
  .form-box.collapsed .form-body { display: none; }
  .form-hint { margin: -2px 2px 0; font-size: 11px; color: var(--muted); }
  .input-row { display: flex; gap: 8px; }
  .inp { flex: 1; min-width: 0; box-sizing: border-box; height: 44px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--txt); font-size: 14px; outline: none; transition: 0.2s; }
  .inp:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(var(--primary-rgb),.12); }
  .btn-submit { width: 100%; height: 46px; padding: 0 18px; background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary); border: 1px solid rgba(var(--secondary-rgb),.10); border-radius: 16px; font-size: 16px; font-weight: 700; cursor: pointer; transition: 0.2s; box-shadow: 0 6px 16px rgba(var(--primary-rgb),.18); display: flex; align-items: center; justify-content: center; gap: 6px; }
  .list-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 0; font-size: 14px; font-weight: 700; color: var(--txt); flex-shrink: 0; }
  .list-count { font-size: 11px; font-weight: 400; color: var(--muted); }
  .log-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
  .log-card { background: var(--surface-raised); border: 1px solid var(--line); border-radius: 14px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; }
  .log-info { flex: 1; min-width: 0; }
  .log-title { font-size: 14px; font-weight: 700; color: var(--heading); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .auto-badge { display:inline-block; margin-left:6px; padding:1px 5px; border-radius:8px; background:rgba(var(--accent-rgb),.16); color:var(--accent-text); font-size:10px; font-weight:700; vertical-align:2px; }
  .log-detail { font-size: 11px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 10px; line-height: 1.45; }
  .log-detail span { color: var(--accent-text); font-weight: 700; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; flex: 0 0 auto; }
  @media (max-width: 360px) {
    .log-detail { font-size: 11px; gap: 3px 8px; }
    .log-detail span { gap: 3px; }
  }
  .btn-del { min-height: 44px; background: rgba(var(--danger-rgb), 0.12); color: var(--danger); border: none; border-radius: 14px; padding: 0 12px; font-size: 14px; cursor: pointer; margin-left: 12px; display: inline-flex; align-items: center; }
  .empty-tip { text-align: center; color: var(--muted); font-size: 14px; margin-top: 28px; }
  .toast { position: absolute; left: 50%; bottom: 30px; transform: translate(-50%, 10px); background: rgba(var(--accent-rgb), 0.92); color: var(--on-accent); padding: 10px 20px; border-radius: 999px; font-size: 14px; font-weight: 700; opacity: 0; pointer-events: none; transition: 0.3s; z-index: 100; }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  .trend-box { background: var(--bg2); border-bottom: 1px solid var(--line); flex-shrink: 0; }
  .trend-head { display: flex; align-items: center; gap: 4px; }
  .trend-toggle-row { flex: 1; min-width: 0; min-height: 44px; border: none; background: transparent; display: flex; align-items: center; gap: 9px; padding: 0 0 0 16px; cursor: pointer; color: var(--txt); font-family: inherit; text-align: left; }
  .share-btn {
    flex: 0 0 auto; margin-right: 12px; min-height: 44px; padding: 0 12px; border-radius: 14px;
    border: 1px solid rgba(var(--primary-rgb), .5); background: rgba(var(--primary-rgb), .12);
    color: var(--accent-text); font-size: 14px; font-weight: 700; font-family: inherit;
    white-space: nowrap; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
  }
  .share-btn:active { filter: brightness(.95); }
  .trend-toggle-row:hover { background: rgba(var(--primary-rgb),.06); }
  .trend-title { font-size: 14px; font-weight: 700; flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; }
  .trend-peek { flex: 1; min-width: 0; font-size: 11px; font-weight: 400; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .trend-chevron { font-size: 14px; color: var(--muted); flex-shrink: 0; }
  .trend-box:not(.collapsed) .trend-peek { display: none; }
  .seg { display: flex; background: var(--surface-raised); border: 1px solid var(--line); border-radius: 10px; padding: 2px; }
  .seg-btn { min-height: 44px; border: none; background: transparent; color: var(--muted); font-size: 14px; padding: 0 12px; border-radius: 8px; cursor: pointer; }
  .seg-btn.active { background: var(--primary); color: var(--on-primary); font-weight: 700; }
  .trend-body { max-height: 56vh; overflow-y: auto; padding: 0 12px 12px; }
  .trend-box.collapsed .trend-body { display: none; }
  .trend-controls { display: flex; justify-content: flex-end; padding: 0 4px 8px; }
  .trend-sub { font-size: 11px; color: var(--muted); padding: 0 4px 6px; }
  .chart-wrap svg { display: block; width: 100%; height: auto; }
  .chart-wrap .bar { fill: var(--chart-bar); }
  .chart-wrap .bar.current { fill: var(--chart-current); }
  .chart-wrap .axis-label { fill: var(--muted); }
  .top-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .top-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
  .top-name { width: 96px; color: var(--txt); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; }
  .top-track { flex: 1; height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
  .top-fill { height: 100%; background: linear-gradient(90deg, var(--line-warm), var(--accent)); border-radius: 3px; }
  .top-min { width: 52px; text-align: right; color: var(--accent-text); font-weight: 700; flex-shrink: 0; }
`;

const logHTML = `
  <div class="form-box collapsed" id="formBox">
    <button class="form-head" id="formToggle" type="button" aria-expanded="false" aria-controls="formBody">
      <span class="form-title">${icon('pencil', 14)}记录本次练习</span>
      <span class="form-peek" id="formPeek">今天还未打卡</span>
      <span class="form-chevron" aria-hidden="true">${icon('chevronRight', 14)}</span>
    </button>
    <div class="form-body" id="formBody">
      <div class="form-hint">填写后点保存</div>
      <div class="input-row"><input type="text" id="inpName" class="inp" placeholder="练习曲目 / 内容" maxlength="30"></div>
      <div class="input-row">
        <input type="number" id="inpTime" class="inp" placeholder="练习时长 (分钟)" min="1">
        <input type="number" id="inpBpm" class="inp" placeholder="最高 BPM (选填)" min="30" max="250">
      </div>
      <button class="btn-submit" id="btnSubmit">${icon('check', 15)} 保存本次练习</button>
    </div>
  </div>
  <div class="trend-box collapsed" id="trendBox">
    <div class="trend-head">
      <button class="trend-toggle-row" id="trendToggle" type="button" aria-expanded="false">
        <span class="trend-title">${icon('chart', 15)} 练习趋势</span>
        <span class="trend-peek" id="trendPeek">近 7 天 · 0 分钟</span>
        <span class="trend-chevron" id="trendChevron">▸</span>
      </button>
      <button class="share-btn" id="btnShare" type="button">${icon('share', 14)} 分享卡片</button>
    </div>
    <div class="trend-body">
      <div class="trend-controls">
        <div class="seg" id="segBtns">
          <button class="seg-btn active" data-range="week">近 7 天</button>
          <button class="seg-btn" data-range="month">近 12 月</button>
        </div>
      </div>
      <div class="trend-sub" id="trendSummary"></div>
      <div class="chart-wrap" id="chartWrap"></div>
      <div class="top-list" id="topList"></div>
      <div class="stats-line">
        <span>累计打卡</span><span class="stat-val" id="statCount">0</span><span>次</span>
        <span class="stats-sep">·</span>
        <span>累计</span><span class="stat-val" id="statTime">0</span><span>分钟</span>
      </div>
    </div>
  </div>
  <div class="list-head"><span>练习记录列表</span><span class="list-count" id="listCount">0 条</span></div>
  <div class="log-list" id="logList"><div class="empty-tip">还没有打卡记录，开始你的第一次练习吧！</div></div>
  <div class="toast" id="toast"></div>
`;

class GuitarPracticeLog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.toastTimer = null;
    // 定义好刷新函数，方便后面监听
    this.handleLogUpdate = () => {
      if (this.loadLogs) this.loadLogs();
    };
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `<style>${logCSS}</style>${logHTML}`;
    this.initLogic();
    
    // 核心：监听来自其他组件（如看谱器）的更新广播
    window.addEventListener('log-updated', this.handleLogUpdate);
  }

  disconnectedCallback() {
    // 组件卸载时，移除监听，防止内存泄漏
    window.removeEventListener('log-updated', this.handleLogUpdate);
  }

  initLogic() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    const inpName = $('inpName'), inpTime = $('inpTime'), inpBpm = $('inpBpm');
    const btnSubmit = $('btnSubmit'), logList = $('logList');
    const statCount = $('statCount'), statTime = $('statTime'), toastEl = $('toast');
    const listCount = $('listCount'), trendPeek = $('trendPeek');
    const formBox = $('formBox'), formToggle = $('formToggle'), formPeek = $('formPeek');
    const chartWrap = $('chartWrap'), topList = $('topList'), trendSummary = $('trendSummary');
    const segBtns = $('segBtns'), trendBox = $('trendBox'), trendToggle = $('trendToggle'), trendChevron = $('trendChevron');
    const btnShare = $('btnShare');

    // ==================== 练习趋势（手写 SVG，不引库） ====================
    const DAY = 86400000;
    const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const logMinutes = (log) => {
      const sec = Number(log && log.durationSec);
      if (Number.isFinite(sec) && sec > 0) return sec / 60;
      return parseInt(log && log.minutes, 10) || 0;
    };
    const formatMinutes = (value) => {
      const n = Number(value) || 0;
      const rounded = Math.round(n * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    };
    const fmtDuration = (log) => {
      const sec = Number(log && log.durationSec);
      if (Number.isFinite(sec) && sec > 0) {
        const total = Math.max(1, Math.round(sec));
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      }
      return `${parseInt(log && log.minutes, 10) || 0} 分钟`;
    };
    const bpmRange = (log) => {
      const start = Number(log && log.bpmStart);
      const end = Number(log && log.bpmEnd);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        return start === end ? `${end} BPM` : `${start}→${end} BPM`;
      }
      return log && log.bpm ? `${log.bpm} BPM` : '';
    };
    const sumMinutes = (logs) => logs.reduce((acc, l) => acc + logMinutes(l), 0);

    const svgBars = (items) => {
      const W = 300, TOP = 16, BASE = 104, H = 128;
      const slot = W / items.length;
      const maxVal = Math.max(1, ...items.map(i => i.value));
      const showValue = items.length <= 7;
      let body = '';
      items.forEach((it, i) => {
        const bw = Math.max(6, Math.min(slot * 0.62, 24));
        const x = i * slot + (slot - bw) / 2;
        const h = (it.value / maxVal) * (BASE - TOP);
        const barClass = it.current ? 'bar current' : 'bar';
        body += `<g><title>${it.full}：${formatMinutes(it.value)} 分钟</title>`
             + `<rect class="${barClass}" x="${x.toFixed(1)}" y="${(BASE - Math.max(h, 2)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 2).toFixed(1)}" rx="3"/></g>`;
        if (showValue && it.value > 0) {
          body += `<text class="axis-label" x="${(x + bw / 2).toFixed(1)}" y="${(BASE - h - 3).toFixed(1)}" text-anchor="middle" font-size="10">${formatMinutes(it.value)}</text>`;
        }
        body += `<text class="axis-label" x="${(i * slot + slot / 2).toFixed(1)}" y="120" text-anchor="middle" font-size="10">${it.label}</text>`;
      });
      return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="练习时长柱状图">${body}</svg>`;
    };

    this.rangeMode = localStorage.getItem('gs_trend_range') === 'month' ? 'month' : 'week';
    const setTrendOpen = (open) => {
      trendBox.classList.toggle('collapsed', !open);
      trendToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      trendChevron.textContent = open ? '▾' : '▸';
    };
    // 默认收起：先看记录，需要看曲线时再展开
    setTrendOpen(false);

    const setFormOpen = (open) => {
      formBox.classList.toggle('collapsed', !open);
      formToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) {
        const focused = this.shadowRoot.activeElement;
        if (focused && focused.tagName === 'INPUT') focused.blur();
      }
    };
    formToggle.onclick = () => setFormOpen(formBox.classList.contains('collapsed'));

    segBtns.querySelectorAll('.seg-btn').forEach(btn => {
      btn.onclick = () => {
        this.rangeMode = btn.dataset.range;
        localStorage.setItem('gs_trend_range', this.rangeMode);
        if (this.currentLogs) this.renderTrend(this.currentLogs);
      };
    });
    trendToggle.onclick = () => setTrendOpen(trendBox.classList.contains('collapsed'));

    this.renderTrend = (logs) => {
      segBtns.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.range === this.rangeMode));
      const items = [];

      if (this.rangeMode === 'week') {
        const today0 = startOfDay(Date.now());
        for (let i = 6; i >= 0; i--) {
          const s = today0 - i * DAY;
          const d = new Date(s);
          const value = sumMinutes(logs.filter(l => l.createdAt >= s && l.createdAt < s + DAY));
          items.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, full: `${d.getMonth() + 1}月${d.getDate()}日`, value, current: i === 0 });
        }
        const total = sumMinutes(logs.filter(l => l.createdAt >= today0 - 6 * DAY));
        const count = logs.filter(l => l.createdAt >= today0 - 6 * DAY).length;
        trendSummary.textContent = `近 7 天共 ${formatMinutes(total)} 分钟 · ${count} 次练习`;
        trendPeek.textContent = `近 7 天 · ${formatMinutes(total)} 分钟`;
      } else {
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const s = d.getTime();
          const e = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
          const value = sumMinutes(logs.filter(l => l.createdAt >= s && l.createdAt < e));
          items.push({ label: `${d.getMonth() + 1}月`, full: `${d.getFullYear()}年${d.getMonth() + 1}月`, value, current: i === 0 });
        }
        const total = sumMinutes(logs.filter(l => l.createdAt >= new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime()));
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const monthMin = sumMinutes(logs.filter(l => l.createdAt >= monthStart));
        trendSummary.textContent = `近 12 个月共 ${formatMinutes(total)} 分钟 · 本月 ${formatMinutes(monthMin)} 分钟`;
        trendPeek.textContent = `近 12 月 · ${formatMinutes(total)} 分钟`;
      }

      chartWrap.innerHTML = logs.length
        ? svgBars(items)
        : `<div class="empty-tip" style="margin:14px 0 4px">还没有练习记录，打一次卡就有曲线了</div>`;

      // 按曲目聚合（全部记录，取累计时长前 5）
      const agg = new Map();
      logs.forEach(l => {
        const key = String(l.name || '未命名');
        agg.set(key, (agg.get(key) || 0) + logMinutes(l));
      });
      const top = Array.from(agg.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const maxMin = top.length ? top[0][1] : 0;
      topList.innerHTML = top.length
        ? `<div class="trend-sub" style="padding-left:0">累计 TOP${top.length}（全部记录）</div>`
          + top.map(([name, min]) => `
            <div class="top-row">
              <div class="top-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
              <div class="top-track"><div class="top-fill" style="width:${maxMin ? Math.round(min / maxMin * 100) : 0}%"></div></div>
              <div class="top-min">${formatMinutes(min)} 分</div>
            </div>`).join('')
        : '';
    };

    const showToast = (msg) => {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
    };

    // 将 loadLogs 挂载到 this 上，方便外部广播触发
    this.loadLogs = async () => {
      const logs = await dbService.getAllLogs();
      this.currentLogs = logs;
      const today = getTodayPracticeSummary(logs);
      formPeek.innerHTML = today.count
        ? `今天 <b>${today.count}</b> 次 · <b>${formatMinutes(today.minutes)}</b> 分钟`
        : '今天还未打卡';
      logList.innerHTML = '';
      let totalTime = 0;
      statCount.textContent = logs.length;
      listCount.textContent = `${logs.length} 条`;
      if (logs.length === 0) {
        logList.innerHTML = `<div class="empty-tip">还没有打卡记录，开始你的第一次练习吧！</div>`;
        statTime.textContent = '0';
        this.renderTrend(logs);
        return;
      }
      logs.forEach(log => {
        totalTime += logMinutes(log);
        const card = document.createElement('div');
        card.className = 'log-card';
        const d = new Date(log.createdAt);
        const timeStr = `${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const bpmText = bpmRange(log);
        card.innerHTML = `
          <div class="log-info">
            <div class="log-title">${escapeHtml(log.name)}${log.auto ? '<span class="auto-badge">自动</span>' : ''}</div>
            <div class="log-detail"><span>${icon('clock', 13)} ${fmtDuration(log)}</span>${bpmText ? `<span>${icon('gauge', 13)} ${bpmText}</span>` : ''}${log.page ? `<span>${icon('book', 13)} 第 ${log.page} 页</span>` : ''}<span style="color:var(--muted)">${timeStr}</span></div>
          </div>
          <button class="btn-del" data-id="${log.id}">删除</button>
        `;
        card.querySelector('.btn-del').onclick = async (e) => {
          e.stopPropagation();
          const ok = await showConfirm({
            title: '删除练习记录',
            message: '这条记录会从本机删除，且无法撤销。',
            details: [{ label: '记录', value: log.name || '未命名练习' }],
            confirmText: '删除',
            danger: true
          });
          if (ok) { await dbService.deleteLog(log.id); this.loadLogs(); }
        };
        logList.appendChild(card);
      });
      statTime.textContent = formatMinutes(totalTime);
      this.renderTrend(logs);
    };

    btnSubmit.onclick = async () => {
      const name = inpName.value.trim(), minutes = inpTime.value.trim(), bpm = inpBpm.value.trim();
      if (!name) return showToast('请输入练习内容');
      if (!minutes || isNaN(minutes) || minutes <= 0) return showToast('请输入正确的练习时长');
      
      await dbService.addLog({ name, minutes: parseInt(minutes, 10), bpm: bpm ? parseInt(bpm, 10) : null });
      
      showToast('打卡成功！');
      inpName.value = ''; inpTime.value = ''; inpBpm.value = '';
      setFormOpen(false);
      
      this.loadLogs();
      // 这里也广播一下，万一未来其他页面需要知道数据变了呢
      window.dispatchEvent(new CustomEvent('log-updated'));
    };

    btnShare.onclick = async () => {
      const summary = getTodayPracticeSummary(this.currentLogs || []);
      if (!summary.count) {
        showToast('今天还没有打卡，先记录一次练习');
        return;
      }
      try {
        await import('../components/share-preview.js');
        const sheet = document.createElement('guitar-share-preview');
        document.body.appendChild(sheet);
        await sheet.open(summary);
      } catch (err) {
        console.error('[分享卡] 打开失败:', err);
        showToast('练习卡片加载失败');
      }
    };
    
    this.loadLogs();
  }
}
customElements.define('guitar-practice-log', GuitarPracticeLog);
