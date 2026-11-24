import { dbService } from '../services/db.js';
import { webdavService } from '../services/webdav.js';
import { vaultService } from '../services/vault.js';
import { APP_VERSION, BACKUP_SCHEMA } from '../services/version.js';
import { audioEngine } from '../services/audio.js';
import { wakeLock } from '../services/wakelock.js';
import { matchPinyin } from '../lib/pinyin.js';
import { hashBlob } from '../services/file-hash.js';
import { findDuplicateScore } from '../services/score-dedup.js';
import { readSyncState, writeSyncState, formatSyncTime as fmtTime, getCloudSyncSummary, describeCloudSync } from '../services/sync-state.js';
import { themeColor, onThemeChange } from '../services/theme.js';
import { showConfirm, showAlert } from './app-dialog.js';
import { registerLayer, bindBackdrop } from '../services/ui-layer.js';
import { parseTagInput, uniqueTags, toggleTag, hasTag, applyTagChanges, collectTagStats } from '../services/tag-utils.js';
import { saveBackupFile } from '../services/backup.js';
import { splitPdfPages } from '../services/pdf-split.js';
import { isNativeGalleryAvailable, pickGalleryImages, takeGalleryFiles } from '../services/gallery-picker.js';
import { ensureCoverForScore } from '../services/cover-cache.js';
import { detectScoreFormat, formatDisplay, formatIcon, SCORE_FORMAT } from '../services/score-format.js';
import { parseTextScore, readTextBlob } from '../services/text-score.js';

let pdfjsLib = null;

// 名称 / 标签直接进了 innerHTML，恢复或云下载的备份可能来自他人，必须转义
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

const readerCSS = `
  :host { display: flex; flex-direction: column; height: 100%; width: 100%; background: var(--bg0); color: var(--txt); overflow: hidden; position: relative; }
  :host(.reader-fullscreen) {
    position: fixed; inset: 0; z-index: 1000;
    width: 100vw; height: 100vh; height: 100dvh;
    background: var(--viewer);
  }
  :host(.reader-fullscreen) .toolbar { display: none !important; }
  :host(.reader-fullscreen) .content-container {
    padding-top: calc(20px + env(safe-area-inset-top, 0px));
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  }
  button, label, input, select { outline: none !important; -webkit-tap-highlight-color: transparent !important; }
  :host, * { -webkit-tap-highlight-color: transparent !important; }
  
  .toolbar { display: none; gap: 6px; padding: 8px 12px; background: var(--bg1); border-bottom: 1px solid var(--line); align-items: center; z-index: 10; flex-wrap: nowrap; min-height: 54px; box-sizing: border-box; }
  :host(.reading) .toolbar { display: flex; }
  .tool-btn {
    flex: 1 1 0; min-width: 0; height: 46px; padding: 0 2px; box-sizing: border-box;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    border: 1px solid var(--line-strong); border-radius: 12px;
    background: var(--surface-raised); color: var(--txt-soft); box-shadow: none;
    font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent;
  }
  .tool-btn:active { background: var(--surface-hover); border-color: var(--line-warm); }
  .tool-btn:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 1px; }
  .tool-btn .ti { width: 18px; height: 18px; display: grid; place-items: center; flex: none; position: relative; pointer-events: none; }
  .tool-btn .ti svg { display: block; width: 18px; height: 18px; }
  .tool-btn .tl { pointer-events: none; }
  .tool-badge {
    position: absolute; top: -6px; right: -8px; min-width: 13px; height: 13px; padding: 0 3px;
    box-sizing: border-box; border-radius: 7px; background: var(--primary); color: var(--on-primary);
    font-size: 9px; font-weight: 800; line-height: 13px; text-align: center;
  }
  .tool-btn .tl { font-size: 11px; font-weight: 700; line-height: 1.1; white-space: nowrap; letter-spacing: .2px; }
  .tool-btn.accent { color: var(--accent-text); border-color: var(--line-warm); }

  .filter-bar { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; background: var(--surface-deep); border-bottom: 1px solid var(--line); }
  .search-row { display: flex; gap: 8px; align-items: center; }
  .import-btn {
    flex: 0 0 auto; height: 36px; padding: 0 12px; border-radius: 8px;
    border: 1px solid rgba(var(--secondary-rgb),.10);
    background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary);
    font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
    white-space: nowrap; box-shadow: 0 3px 10px rgba(var(--primary-rgb),.16);
  }
  .import-folder {
    flex: 0 0 36px; width: 36px; height: 36px; padding: 0; border-radius: 8px;
    border: 1px solid var(--line-warm); background: var(--surface-raised); color: var(--accent-text);
    font-family: inherit; font-size: 15px; cursor: pointer;
  }
  @media (max-width: 640px) { .import-folder { display: none; } }
  .search-inp { flex: 1; min-width: 0; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--txt); font-size: 14px; }
  .search-inp:focus { border-color: var(--primary); }
  .sort-sel { flex: 0 0 auto; min-width: 104px; max-width: 42vw; box-sizing: border-box; padding: 8px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface-raised); color: var(--txt); font-size: 13px; }
  .tag-row { display: flex; gap: 8px; align-items: center; }
  .tag-bar { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; flex: 1; min-width: 0; }
  .tag-bar::-webkit-scrollbar { display: none; }
  .tag-chip { padding: 4px 10px; border-radius: 12px; border: 1px solid var(--line-strong); background: var(--surface-raised); font-size: 12px; cursor: pointer; white-space: nowrap; color: var(--muted); }
  .tag-chip.active { background: rgba(var(--primary-rgb), 0.20); border-color: var(--primary); color: var(--heading); }
  .tag-bar.disabled { opacity: .4; pointer-events: none; }
  .manage-btn {
    flex: none; padding: 5px 11px; border-radius: 10px; border: 1px solid var(--line-strong);
    background: var(--surface-raised); color: var(--muted); font-family: inherit; font-size: 12px;
    font-weight: 700; cursor: pointer; white-space: nowrap;
  }
  .manage-btn.active { background: rgba(var(--primary-rgb), .18); border-color: var(--primary); color: var(--accent-text); }
  .search-inp:disabled, .sort-sel:disabled { opacity: .45; cursor: not-allowed; }

  .shelf-view { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; align-content: start; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
  @media (max-width: 640px) {
    .shelf-view { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 12px; }
  }
  @media (max-width: 340px) {
    .shelf-view { grid-template-columns: minmax(0, 1fr); }
  }
  .shelf-view.managing { padding-bottom: 118px; }
  .score-card { box-sizing: border-box; min-height: 148px; background: var(--surface-raised); border: 1px solid var(--line); border-radius: 14px; padding: 8px; cursor: pointer; display: flex; flex-direction: row; align-items: flex-start; gap: 8px; position: relative; transition: 0.2s; overflow: hidden; }
  .score-card:hover { background: var(--surface-hover); border-color: var(--primary); transform: translateY(-2px); box-shadow: 0 10px 24px rgba(var(--shadow-rgb),.24); }
  .score-card.selected { border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary), 0 0 0 3px rgba(var(--primary-rgb), .12); }
  .score-cover {
    width: 84px; flex: 0 0 84px; aspect-ratio: 3 / 4; border-radius: 9px; overflow: hidden; position: relative;
    display: grid; place-items: center; background: var(--surface-deep); border: 1px solid var(--line);
  }
  .score-cover img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; }
  .score-cover.has-cover .score-cover-fallback { display: none; }
  .score-cover-fallback { font-size: 26px; line-height: 1; color: var(--muted); }
  .score-icon { font-size: 36px; margin-bottom: 8px; }
  .score-info { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; padding-top: 1px; }
  .score-name { font-size: 13px; text-align: left; display: -webkit-box; width: 100%; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.35; margin-top: 0; word-break: break-word; }
  .score-meta { font-size: 10px; color: var(--muted); text-align: left; margin-top: 4px; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .tag-badge {
    display: block; margin-top: 7px; z-index: 2; max-width: 100%; box-sizing: border-box;
    padding: 3px 7px; border-radius: 8px; border: 1px solid rgba(var(--primary-rgb), .32);
    background: rgba(var(--primary-rgb), .13); color: var(--accent-text);
    font-size: 9px; line-height: 1.4; font-weight: 700; pointer-events: none;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;
  }

  .select-mark {
    position: absolute; top: 7px; left: 7px; z-index: 4; width: 20px; height: 20px;
    border-radius: 50%; border: 1px solid var(--line-strong); background: var(--surface-raised);
    color: var(--on-primary); font-size: 12px; font-weight: 800; display: none;
    align-items: center; justify-content: center;
  }
  .shelf-view.managing .tag-badge, .shelf-view.managing .card-edit-btn, .shelf-view.managing .card-actions { display: none; }
  .shelf-view.managing .select-mark { display: flex; }
  .score-card.selected .select-mark { background: var(--primary); border-color: var(--primary); }

  .card-tags { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; margin-top: 8px; }
  .card-tag { font-size: 9px; padding: 2px 6px; border-radius: 6px; background: rgba(var(--primary-rgb), 0.14); color: var(--accent-text); border: 1px solid rgba(var(--primary-rgb), 0.3); }

  .card-edit-btn {
    position: absolute; top: 6px; left: 6px; z-index: 3; width: 22px; height: 22px;
    border-radius: 50%; border: 1px solid rgba(var(--primary-rgb), .32);
    background: rgba(var(--primary-rgb), .16); color: var(--primary);
    font-family: inherit; font-size: 12px; cursor: pointer; display: flex;
    align-items: center; justify-content: center;
  }
  .card-edit-btn:hover { background: rgba(var(--primary-rgb), .26); }

  .card-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; opacity: 0; transition: 0.2s; z-index: 3; }
  .score-card:hover .card-actions { opacity: 1; }
  .card-actions .action-btn { width: 22px; height: 22px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 12px; }
  .btn-delete { background: rgba(var(--danger-rgb), 0.2); color: var(--danger); }

  .batch-bar {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 160; display: none;
    flex-direction: column; gap: 8px; padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
    background: var(--surface-raised); border-top: 1px solid var(--line-warm);
    box-shadow: 0 -8px 24px rgba(var(--shadow-rgb), .28);
  }
  .batch-bar.show { display: flex; }
  .batch-line { display: flex; align-items: center; gap: 8px; }
  .batch-count { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: var(--accent-text); }
  .batch-btn {
    padding: 9px 12px; border-radius: 9px; border: 1px solid var(--line-strong);
    background: var(--surface-deep); color: var(--txt); font-family: inherit; font-size: 13px;
    font-weight: 700; cursor: pointer;
  }
  .batch-btn.ghost { border-color: transparent; background: transparent; color: var(--muted); padding: 9px 6px; }
  .batch-btn.tag { border-color: var(--primary); color: var(--accent-text); background: rgba(var(--primary-rgb), .12); }
  .batch-btn.delete { border-color: rgba(var(--danger-rgb), .5); color: var(--danger); background: rgba(var(--danger-rgb), .10); }
  .batch-btn:disabled { opacity: .4; cursor: not-allowed; }

  .viewer { flex: 1; overflow: auto; position: relative; background: var(--viewer); cursor: grab; -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y; display: none; }
  .viewer:active { cursor: grabbing; }
  .content-container { display: flex; flex-direction: column; align-items: center; min-width: 100%; width: 100%; padding: 20px 0; box-sizing: border-box; }
  .page-box { width: 100%; margin-bottom: 15px; background: var(--surface-deep); box-shadow: 0 4px 12px rgba(var(--shadow-rgb),0.5); display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative; }
  .page-box::after { content: '加载中...'; color: var(--muted); font-size: 12px; position: absolute; }
  .page-box.loaded::after { display: none; }
  .content-container img, .content-container canvas { display: block; width: 100%; height: auto; max-width: none; user-select: none; -webkit-user-drag: none; }

  .empty-tip { text-align: center; color: var(--muted); margin-top: 50px; grid-column: 1 / -1; }
  .empty-state {
    grid-column: 1 / -1; min-height: 380px; box-sizing: border-box;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; padding: 48px 20px 36px; gap: 12px;
  }
  .empty-mark {
    width: 64px; height: 64px; border-radius: 18px;
    display: grid; place-items: center; font-size: 30px;
    color: var(--accent-text); background: rgba(var(--primary-rgb), 0.12);
    border: 1px solid var(--line-warm);
  }
  .empty-title { margin: 0; color: var(--heading); font-size: 18px; font-weight: 700; letter-spacing: .3px; }
  .empty-desc { margin: 0; max-width: 300px; color: var(--muted); font-size: 13px; line-height: 1.7; }
  .empty-actions { width: min(260px, 100%); margin-top: 6px; display: flex; flex-direction: column; gap: 8px; }
  .empty-action {
    width: 100%; box-sizing: border-box; padding: 11px 16px; border-radius: 10px;
    font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
  }
  .empty-action.primary {
    color: var(--on-primary); border: 1px solid rgba(var(--secondary-rgb),.10);
    background: linear-gradient(180deg, var(--accent), var(--primary));
    box-shadow: 0 4px 12px rgba(var(--primary-rgb),.18);
  }
  .empty-action.secondary {
    color: var(--accent-text); border: 1px solid var(--line-warm); background: transparent;
  }
  .empty-action.secondary:hover { background: rgba(var(--primary-rgb), 0.10); }
  .zoom-controls { position: absolute; bottom: calc(30px + env(safe-area-inset-bottom, 0px)); right: calc(20px + env(safe-area-inset-right, 0px)); display: none; flex-direction: column; gap: 8px; z-index: 20; transition: opacity 0.25s ease; }
  .zoom-controls.faded { opacity: 0.15; }
  .zoom-btn { width: 44px; height: 44px; border-radius: 50%; background: rgba(var(--bg1-rgb), 0.92); border: 1px solid var(--line-warm); color: var(--accent-text); font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .zoom-btn.lock-btn { font-size: 18px; }

  /* 📝 文本谱：等宽、保留空格，当前行轻高亮 */
  .text-sheet {
    width: min(900px, 100%); margin: 0 auto; box-sizing: border-box;
    padding: 18px clamp(14px, 4vw, 34px) 46vh;
    font-family: "SFMono-Regular", "Cascadia Mono", "Noto Sans Mono CJK SC", "Sarasa Mono SC", ui-monospace, monospace;
    font-size: calc(var(--text-scale, 1) * 15px); line-height: 1.85; color: var(--txt);
    tab-size: 4; word-break: break-word;
  }
  .text-head { margin: 0 0 18px; padding: 0 0 14px; border-bottom: 1px solid var(--line-warm); }
  .text-title { margin: 0; font-size: calc(var(--text-scale, 1) * 22px); line-height: 1.35; color: var(--txt); letter-spacing: .2px; }
  .text-sub { margin: 5px 0 0; font-size: calc(var(--text-scale, 1) * 12px); color: var(--muted); line-height: 1.5; }
  .text-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .text-tag { padding: 2px 8px; border-radius: 8px; border: 1px solid rgba(var(--primary-rgb), .3); background: rgba(var(--primary-rgb), .1); color: var(--accent-text); font-size: calc(var(--text-scale, 1) * 11px); line-height: 1.5; }
  .text-block { white-space: pre-wrap; overflow-wrap: anywhere; padding: 1px 8px; margin: 0 -8px; border-left: 2px solid transparent; border-radius: 4px; }
  .text-block.empty { min-height: 1em; }
  .text-block.section { margin-top: 18px; margin-bottom: 7px; padding: 3px 10px; border-left: 3px solid var(--primary); background: rgba(var(--primary-rgb), .08); color: var(--accent-text); font-weight: 800; letter-spacing: .3px; }
  .text-block.chord { color: var(--accent-text); font-weight: 700; letter-spacing: .3px; }
  .text-block.note { color: var(--muted); font-style: italic; }
  .text-block.divider { height: 1px; min-height: 1px; margin: 16px 0; padding: 0; background: var(--line-warm); }
  .text-block.current { background: rgba(var(--primary-rgb), .13); border-left-color: var(--primary); color: var(--txt); }
  .text-block.section.current { background: rgba(var(--primary-rgb), .17); }
  .chord-token { color: var(--accent-text); font-weight: 700; }

  /* 🧘 禅定模式：透明阅读锁，不压暗谱面，只收起阅读控件 */
  .zen-lock {
    position: absolute; inset: 0; z-index: 340; display: none;
    background: transparent; pointer-events: none;
    -webkit-user-select: none; user-select: none;
  }
  .zen-lock.show { display: block; }
  :host(.reader-fullscreen) .zen-lock { position: fixed; }
  :host(.zen-active) .toolbar { display: none !important; }
  :host(.zen-active) .viewer { overflow: hidden; touch-action: none; }
  :host(.zen-active) .content-container { padding-top: 8px; padding-bottom: 8px; }
  :host(.zen-active) .zoom-controls,
  :host(.zen-active) .mini-metronome {
    opacity: 0 !important; visibility: hidden; pointer-events: none;
  }
  :host(.zen-active) .nav-zone,
  :host(.zen-active) #progressBanner { display: none !important; }
  .zen-panel {
    position: absolute; left: 50%; bottom: calc(28px + env(safe-area-inset-bottom, 0px));
    transform: translate(-50%, 8px); z-index: 1;
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    max-width: calc(100% - 32px); box-sizing: border-box;
    padding: 8px 12px 10px; border-radius: 16px;
    background: rgba(var(--bg1-rgb), .78); border: 1px solid var(--line-warm);
    box-shadow: 0 8px 24px rgba(var(--shadow-rgb), .22);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    opacity: 0; pointer-events: none; transition: opacity .18s ease, transform .18s ease;
  }
  .zen-lock.revealed .zen-panel { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
  .zen-title { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: var(--muted); }
  .zen-unlock {
    min-width: 142px; height: 42px; padding: 0 18px; border-radius: 999px;
    border: 1px solid var(--line-warm); background: rgba(var(--bg1-rgb), .9);
    color: var(--accent-text); font-family: inherit; font-size: 13px; font-weight: 700;
    line-height: 1.2; white-space: nowrap; cursor: pointer; position: relative;
    overflow: hidden; touch-action: none; -webkit-tap-highlight-color: transparent;
  }
  .zen-unlock:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 3px; }
  .zen-unlock .zen-progress {
    position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--primary);
    transform: scaleX(0); transform-origin: left center; opacity: .9;
  }
  .zen-unlock.holding .zen-progress { transform: scaleX(1); transition: transform 1.5s linear; }

  .mini-metronome { position: absolute; bottom: 30px; left: 20px; display: none; flex-direction: column; align-items: center; z-index: 20; }
  .mm-panel { background: rgba(var(--bg1-rgb), 0.95); backdrop-filter: blur(8px); border: 1px solid var(--line-warm); border-radius: 16px; padding: 10px; display: flex; flex-direction: column; align-items: center; gap: 8px; transition: all 0.3s ease; }
  .mm-main-row { display: flex; align-items: center; gap: 12px; }
  .mm-btn { background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary); border: 1px solid rgba(var(--secondary-rgb),.12); width: 36px; height: 36px; border-radius: 50%; font-size: 16px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(var(--primary-rgb),.22); }
  .mm-btn.playing { background: var(--danger); color: var(--on-danger); box-shadow: 0 4px 12px rgba(var(--danger-rgb),.2); }
  .mm-bpm-display { font-size: 20px; font-weight: bold; color: var(--txt); cursor: pointer; min-width: 50px; text-align: center; }
  .mm-bpm-display::after { content: ' BPM'; font-size: 10px; color: var(--muted); font-weight: normal; }
  .mm-advanced-area { display: none; flex-direction: column; align-items: center; gap: 8px; width: 100%; border-top: 1px solid var(--line-strong); padding-top: 10px; }
  .mini-metronome.advanced .mm-advanced-area { display: flex; }
  .mm-knob-wrap { width: 120px; height: 120px; position: relative; display: flex; align-items: center; justify-content: center; }
  .mm-knob-wrap canvas { position: absolute; top: 0; left: 0; touch-action: none; cursor: grab; }
  .mm-adv-controls { display: flex; align-items: center; gap: 16px; }
  .mm-step { background: var(--surface-raised); color: var(--txt); border: 1px solid var(--line-strong); width: 32px; height: 32px; border-radius: 10px; font-size: 20px; cursor: pointer; }

  .loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(var(--shadow-rgb),0.7); color: var(--primary); font-size: 16px; z-index: 300; display: none; }
  .loading.show { display: flex; }
  .toast { position: absolute; left: 50%; bottom: 100px; transform: translate(-50%, 10px); background: rgba(var(--accent-rgb), 0.92); color: var(--on-accent); padding: 10px 20px; border-radius: 20px; font-size: 14px; font-weight: bold; z-index: 400; opacity: 0; pointer-events: none; transition: 0.3s; }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }

  .cloud-task {
    position: absolute; bottom: 150px; left: 50%; transform: translateX(-50%); z-index: 190;
    display: none; align-items: center; gap: 8px; max-width: calc(100% - 32px); box-sizing: border-box;
    padding: 8px 10px 8px 14px; border-radius: 999px; border: 1px solid var(--line-warm);
    background: var(--surface-raised); color: var(--accent-text);
    font-size: 12px; font-weight: 600; box-shadow: 0 8px 22px rgba(var(--shadow-rgb), .35);
    white-space: nowrap; pointer-events: none; backdrop-filter: blur(4px);
  }
  .cloud-task.show { display: flex; }
  .cloud-task-text { flex: 0 1 auto; min-width: 0; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cloud-task-btn {
    pointer-events: auto; display: none; align-items: center; justify-content: center; flex: none;
    border: 1px solid var(--line-strong); background: var(--surface-hover); color: var(--accent-text);
    border-radius: 999px; padding: 3px 8px; font: inherit; font-size: 11px; line-height: 1.4; cursor: pointer;
  }
  .cloud-task-btn:disabled { opacity: .55; cursor: default; }
  .cloud-task.busy .cloud-task-cancel { display: inline-flex; }
  .cloud-task.failed { color: var(--danger-text); border-color: rgba(var(--danger-rgb), .45); }
  .cloud-task.failed::before {
    content: '!'; width: 12px; height: 12px; flex: none; border-radius: 50%;
    border: 0; background: var(--danger); color: #fff; animation: none;
    display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700;
  }
  .cloud-task.failed .cloud-task-retry, .cloud-task.failed .cloud-task-dismiss { display: inline-flex; }
  .cloud-task::before {
    content: ''; width: 12px; height: 12px; flex: none; border-radius: 50%;
    border: 2px solid var(--line-strong); border-top-color: var(--primary);
    animation: cloudSpin .8s linear infinite;
  }
  @keyframes cloudSpin { to { transform: rotate(360deg); } }

  .action-sheet-mask, .modal-mask { position: absolute; inset: 0; background: rgba(var(--shadow-rgb),0.6); display: none; align-items: flex-end; z-index: 200; }
  .action-sheet-mask.show, .modal-mask.show { display: flex; }
  .action-sheet { width: 100%; max-height: 80vh; box-sizing: border-box; overflow-y: auto; -webkit-overflow-scrolling: touch; background: var(--surface-raised); border-radius: 16px 16px 0 0; padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 12px; transform: translateY(100%); transition: transform 0.2s; }
  .action-sheet-mask.show .action-sheet { transform: translateY(0); }
  .action-sheet .action-btn { display: flex; align-items: center; gap: 12px; justify-content: center; width: 100%; box-sizing: border-box; background: var(--surface-hover); color: var(--txt); border: none; padding: 16px; border-radius: 10px; font-size: 16px; cursor: pointer; }
  .action-sheet .action-btn.cancel { background: transparent; color: var(--muted); }

  .modal-mask { align-items: flex-start; justify-content: center; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: max(20px, env(safe-area-inset-top, 0px)) 20px calc(20px + env(safe-area-inset-bottom, 0px)); }
  .modal-box { box-sizing: border-box; max-height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; margin: auto 0; background: var(--surface-raised); border: 1px solid var(--line); border-radius: 16px; padding: 20px; width: 100%; max-width: 360px; display: flex; flex-direction: column; gap: 16px; }
  .modal-box h3 { margin: 0; text-align: center; color: var(--accent-text); font-size: 18px; }
  .modal-field { display: flex; flex-direction: column; gap: 6px; }
  .modal-field label { font-size: 12px; color: var(--muted); }
  .modal-inp { padding: 12px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface-deep); color: var(--txt); font-size: 14px; outline: none; }
  .modal-footer { display: flex; gap: 10px; margin-top: 8px; }
  .modal-btn { flex: 1; padding: 12px; border-radius: 8px; border: none; font-size: 14px; font-weight: bold; cursor: pointer; }
  .modal-btn.cancel { background: var(--line-strong); color: var(--txt); }
  .modal-btn.confirm { background: linear-gradient(180deg, var(--accent), var(--primary)); color: var(--on-primary); }
  .modal-btn.danger { background: var(--danger); color: var(--on-danger); }

  .tag-box { max-width: 380px; gap: 12px; }
  .tag-hint { font-size: 12px; color: var(--muted); line-height: 1.5; }
  .quick-tags-label { font-size: 11px; color: var(--muted); margin-bottom: -4px; }
  .quick-tags { display: flex; flex-wrap: wrap; gap: 6px; max-height: 116px; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 2px; }
  .quick-tag {
    padding: 4px 8px; border-radius: 8px; border: 1px solid var(--line-strong);
    background: var(--surface-deep); color: var(--txt-soft); font-family: inherit; font-size: 11px;
    cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .quick-tag small { color: var(--muted); font-size: 9px; margin-left: 3px; }
  .quick-tag.active { border-color: var(--primary); background: rgba(var(--primary-rgb), .18); color: var(--accent-text); }
  .quick-tag.empty-hint { border-style: dashed; color: var(--muted); cursor: default; }
  .tag-mode-row { display: flex; gap: 8px; }
  .tag-mode-btn {
    flex: 1; padding: 9px; border-radius: 9px; border: 1px solid var(--line-strong);
    background: var(--surface-deep); color: var(--muted); font-family: inherit; font-size: 13px;
    font-weight: 700; cursor: pointer;
  }
  .tag-mode-btn.active { border-color: var(--primary); color: var(--accent-text); background: rgba(var(--primary-rgb), .16); }
  @media (max-width: 360px) {
    .tag-box { padding: 16px; gap: 10px; }
    .quick-tags { max-height: 88px; }
  }
  
  /* 🌟 沉浸式虚化：只降透明度，不禁用指针事件，否则鼠标永远移不上去、无法实体化 */
  .mini-metronome { transition: opacity 0.25s ease; }
  .mini-metronome.faded { opacity: 0.15; cursor: pointer; }

  /* 🌟 左右点击翻页热区：内缩安全距离，避免压住滚动条 / 手机边缘返回手势 */
  .nav-zone {
    position: absolute; top: 56px; height: 170px; width: 7%; z-index: 15;
    cursor: pointer; opacity: 0; transition: opacity 0.2s; display: none;
    align-items: center; justify-content: center;
    font-size: 30px; color: rgba(var(--tint-rgb),0.35); font-weight: bold;
    user-select: none; -webkit-user-select: none;
    outline: none !important; -webkit-tap-highlight-color: transparent !important;
  }
  .nav-zone:focus, .nav-zone:focus-visible, .nav-zone:active { outline: none !important; }
  .nav-zone.show { display: flex; }
  .nav-zone:hover, .nav-zone:active { opacity: 1; background: rgba(var(--shadow-rgb),0.18); }
  .nav-zone.left { left: 20px; }
  .nav-zone.right { right: 26px; }

  /* 🌟 阅读进度提示条：独立于滚动容器，避免显示/隐藏时把谱面顶偏 */
  #progressBanner {
    position: absolute; top: 70px; left: 50%; transform: translate(-50%, -6px);
    display: none; align-items: center; gap: 10px;
    z-index: 60; background: rgba(var(--accent-rgb), 0.95); color: var(--on-accent);
    padding: 8px 10px 8px 16px; border-radius: 22px; font-size: 13px; font-weight: bold;
    box-shadow: 0 6px 18px rgba(var(--shadow-rgb),0.45); white-space: nowrap;
    opacity: 0; transition: opacity 0.25s ease, transform 0.25s ease;
  }
  #progressBanner.show { display: flex; opacity: 1; transform: translate(-50%, 0); }
  #progressBanner .pb-text { cursor: pointer; }
  #progressBanner .pb-close {
    background: rgba(var(--shadow-rgb),0.18); border: none; color: var(--on-accent); width: 22px; height: 22px;
    border-radius: 50%; font-size: 13px; font-weight: bold; cursor: pointer; line-height: 1;
  }

  /* 🌟 打卡弹窗内的「阅读进度」区 */
  .progress-readout { font-size: 13px; color: var(--accent-text); font-weight: bold; }
  .modal-check-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); cursor: pointer; }
  .modal-check-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
  .modal-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .split-note { font-size: 12px; color: var(--muted); line-height: 1.6; margin: -4px 0 0; }
  .split-page-row { display: flex; gap: 10px; }
  .split-page-row .modal-field { flex: 1; min-width: 0; }
  .split-page-row .modal-inp { width: 100%; box-sizing: border-box; }
  .split-range-hint { font-size: 12px; color: var(--muted); line-height: 1.5; min-height: 1.5em; }
  .split-range-hint.error { color: var(--danger-text); }
  .split-inherit { font-size: 11px; color: var(--muted); line-height: 1.5; word-break: break-word; }
  .split-preview { display: flex; gap: 10px; }
  .split-thumb {
    flex: 1; min-width: 0; padding: 0; border: 1px solid var(--line-warm); border-radius: 12px;
    background: var(--surface-deep); color: var(--txt); cursor: pointer; overflow: hidden;
    display: flex; flex-direction: column; font-family: inherit; text-align: left;
  }
  .split-thumb:active { border-color: var(--primary); transform: translateY(1px); }
  .split-thumb-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 7px 9px 5px; font-size: 11px; color: var(--muted); }
  .split-thumb-page { flex: none; font-size: 11px; font-weight: 700; color: var(--accent-text); }
  .split-thumb-canvas { position: relative; display: flex; align-items: center; justify-content: center; aspect-ratio: 3 / 4; overflow: hidden; background: var(--surface-active); }
  .split-thumb-canvas canvas { display: block; width: 100%; height: 100%; object-fit: contain; }
  .split-thumb-canvas canvas[hidden], .split-thumb-empty[hidden] { display: none; }
  .split-thumb-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 8px; font-size: 11px; color: var(--muted); text-align: center; }
  .split-preview-tip { margin-top: -10px; font-size: 11px; color: var(--muted); line-height: 1.5; }
  .split-picker-mask { z-index: 220; }
  .split-picker-box { gap: 12px; }
  .split-picker-current {
    padding: 9px 12px; border-radius: 9px; border: 1px solid var(--line-warm);
    background: rgba(var(--primary-rgb), .10); color: var(--accent-text);
    font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  }
  .split-picker-grid {
    display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px;
    max-height: min(48vh, 360px); overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding: 2px; overscroll-behavior: contain;
  }
  .split-page-btn {
    padding: 10px 0; border-radius: 8px; border: 1px solid var(--line);
    background: var(--surface-deep); color: var(--txt); font-family: inherit;
    font-size: 12px; font-weight: 700; cursor: pointer;
  }
  .split-page-btn.current { border-color: var(--line-strong); color: var(--muted); }
  .split-page-btn.selected { border-color: var(--primary); background: rgba(var(--primary-rgb), .16); color: var(--accent-text); }
  @media (max-width: 360px) {
    .split-page-row, .split-preview { gap: 8px; }
  }

  /* 🔖 页级书签面板 */
  #bookmarkMask {
    position: absolute; inset: 0; background: rgba(var(--shadow-rgb),.55);
    display: none; z-index: 80;
  }
  #bookmarkMask.show { display: block; }
  .bm-panel {
    position: absolute; left: 0; right: 0; bottom: 0; max-height: 72%;
    background: var(--surface-deep); border-top: 1px solid var(--line-strong); border-radius: 16px 16px 0 0;
    display: flex; flex-direction: column; padding: 14px 16px calc(18px + env(safe-area-inset-bottom, 0px));
    box-shadow: 0 -10px 30px rgba(var(--shadow-rgb),.5);
  }
  .bm-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .bm-title { font-size: 14px; font-weight: bold; color: var(--txt); }
  .bm-close { background: transparent; border: none; color: var(--muted); font-size: 20px; cursor: pointer; line-height: 1; padding: 0 4px; }
  .bm-add {
    width: 100%; padding: 10px; margin-bottom: 10px; border-radius: 10px; cursor: pointer;
    border: 1px solid var(--line-warm); background: rgba(var(--primary-rgb),.12); color: var(--accent-text); font-size: 13px; font-weight: bold;
  }
  .bm-list { overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-height: 40px; }
  .bm-empty { color: var(--muted); font-size: 13px; text-align: center; padding: 18px 0; }
  .bm-row {
    display: flex; align-items: center; gap: 10px; padding: 10px 12px;
    background: var(--surface-raised); border: 1px solid var(--line); border-radius: 10px; cursor: pointer;
  }
  .bm-row:active { background: var(--surface-active); }
  .bm-page { font-size: 14px; font-weight: bold; color: var(--accent-text); flex-shrink: 0; min-width: 58px; }
  .bm-time { flex: 1; min-width: 0; font-size: 11px; color: var(--muted); }
  .bm-del {
    background: rgba(var(--danger-rgb), 0.12); color: var(--danger); border: none; border-radius: 6px;
    padding: 5px 9px; font-size: 12px; cursor: pointer; flex-shrink: 0;
  }
`;

  


const readerHTML = `
  <div class="toolbar" id="readerToolbar">
    <button class="tool-btn" id="btnBack" type="button" aria-label="返回书架">
      <span class="ti" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg></span>
      <span class="tl">返回</span>
    </button>
    <button class="tool-btn accent" id="btnLog" type="button" aria-label="记录本次练习">
      <span class="ti" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>
      <span class="tl">打卡</span>
    </button>
    <button class="tool-btn" id="btnSavePos" type="button" style="display:none;" aria-label="保存阅读进度">
      <span class="ti" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></span>
      <span class="tl">存进度</span>
    </button>
    <button class="tool-btn" id="btnBookmarks" type="button" style="display:none;" aria-label="本书书签">
      <span class="ti" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4Z"/></svg><span class="tool-badge" id="bookmarkBadge" hidden></span></span>
      <span class="tl">书签</span>
    </button>
    <button class="tool-btn accent" id="btnSplit" type="button" style="display:none;" aria-label="拆分 PDF 页段">
      <span class="ti" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20"/><path d="M8.1 15.9 20 4"/></svg></span>
      <span class="tl">拆分</span>
    </button>
  </div>
  
  <input type="file" id="inputSingleFile" accept="image/*,application/pdf,.txt,.md,.markdown,.cho,.chordpro,text/plain,text/markdown,application/octet-stream" multiple style="display:none">
  <input type="file" id="inputFolder" webkitdirectory multiple style="display:none">
  <input type="file" id="inputCamera" accept="image/*" capture="environment" style="display:none">
  <input type="file" id="inputGallery" accept="image/*" multiple style="display:none">
  <input type="file" id="inputMobileFile" accept=".pdf,application/pdf,image/*,.txt,.md,.markdown,.cho,.chordpro,text/plain,text/markdown,application/octet-stream" multiple style="display:none">

  <div class="filter-bar" id="filterBar">
    <div class="search-row">
      <button class="import-btn" id="btnImportMain" type="button">📂 导入</button>
      <button class="import-folder" id="btnFolderMain" type="button" title="导入整个文件夹" aria-label="导入整个文件夹">📁</button>
      <input type="text" id="searchInp" class="search-inp" placeholder="搜索谱名、标签或拼音首字母（如 gbq）">
      <select id="sortSel" class="sort-sel">
        <option value="newest">最新添加</option>
        <option value="oldest">最旧添加</option>
        <option value="name">按名称 A-Z</option>
      </select>
    </div>
    <div class="tag-row">
      <div class="tag-bar" id="tagBar"></div>
      <button class="manage-btn" id="btnManage" type="button">管理</button>
    </div>
  </div>

  <div class="shelf-view" id="shelfView"></div>

  <div class="batch-bar" id="batchBar">
    <div class="batch-line">
      <span class="batch-count" id="batchCount">已选 0 份</span>
      <button class="batch-btn ghost" id="batchSelectAll" type="button">全选</button>
      <button class="batch-btn ghost" id="batchExit" type="button">退出管理</button>
    </div>
    <div class="batch-line">
      <button class="batch-btn tag" id="batchTag" type="button" disabled>打标签</button>
      <button class="batch-btn delete" id="batchDelete" type="button" disabled>删除</button>
    </div>
  </div>

  <div class="viewer" id="viewer">
    <div class="content-container" id="contentContainer"></div>
  </div>

  <!-- 🌟 翻页热区：放在滚动容器外，滚动谱面时固定在可视区左右两侧 -->
  <div class="nav-zone left" id="navPrev">❮</div>
  <div class="nav-zone right" id="navNext">❯</div>

  <!-- 🌟 阅读进度提示：放在滚动容器外面，跳转后隐藏也不会导致谱面抖动 -->
  <div id="progressBanner">
    <span class="pb-text" id="pbText"></span>
    <button class="pb-close" id="pbClose" title="从第一页开始">✕</button>
  </div>

  <div class="zoom-controls" id="zoomControls">
    <button class="zoom-btn" id="zoomIn" aria-label="放大">＋</button>
    <button class="zoom-btn" id="zoomOut" aria-label="缩小">−</button>
    <button class="zoom-btn" id="btnFullscreen" aria-label="进入全屏" title="全屏">⤢</button>
    <button class="zoom-btn lock-btn" id="btnZenLock" aria-label="锁定阅读页" title="禅定锁定">🔒</button>
  </div>

  <div class="mini-metronome" id="miniMetronome">
    <div class="mm-panel">
      <div class="mm-main-row">
        <button class="mm-btn" id="mmPlay">▶</button>
        <div class="mm-bpm-display" id="mmBpmDisplay">120</div>
      </div>
      <div class="mm-advanced-area" id="mmAdvancedArea">
        <div class="mm-knob-wrap" id="mmKnobWrap"><canvas id="mmKnobCanvas"></canvas></div>
        <div class="mm-adv-controls">
          <button class="mm-step" id="mmMinus">−</button>
          <button class="mm-step" id="mmPlus">+</button>
        </div>
      </div>
    </div>
  </div>

  <div class="loading" id="loading">处理中...</div>
  <div class="cloud-task" id="cloudTask">
    <span class="cloud-task-text" id="cloudTaskText"></span>
    <button class="cloud-task-btn cloud-task-cancel" id="cloudTaskCancel" type="button">取消</button>
    <button class="cloud-task-btn cloud-task-retry" id="cloudTaskRetry" type="button">重试</button>
    <button class="cloud-task-btn cloud-task-dismiss" id="cloudTaskDismiss" type="button" aria-label="关闭任务提示">×</button>
  </div>
  <div class="toast" id="toast"></div>

  <div class="zen-lock" id="zenLock" role="dialog" aria-modal="true" aria-label="禅定模式已锁定">
    <div class="zen-panel" id="zenPanel" aria-hidden="true">
      <span class="zen-title">禅定模式</span>
      <button class="zen-unlock" id="zenUnlock" type="button" aria-label="长按 1.5 秒解锁">长按 1.5 秒解锁<span class="zen-progress"></span></button>
    </div>
  </div>

  <div id="bookmarkMask">
    <div class="bm-panel">
      <div class="bm-head">
        <span class="bm-title">🔖 本书书签</span>
        <button class="bm-close" id="bmClose">×</button>
      </div>
      <button class="bm-add" id="bmAdd">＋ 收藏当前页</button>
      <div class="bm-list" id="bmList"></div>
    </div>
  </div>

  <div class="action-sheet-mask" id="actionSheetMask">
    <div class="action-sheet">
      <button class="action-btn" id="btnCamera" type="button">📷 拍照</button>
      <button class="action-btn" id="btnGallery" type="button">🖼️ 从相册选择</button>
      <button class="action-btn" id="btnMobileFile" type="button">📁 选择文件</button>
      <button class="action-btn cancel" id="btnCancel">取消</button>
    </div>
  </div>

  <div class="modal-mask" id="logModalMask">
    <div class="modal-box">
      <h3>记录本次练习</h3>
      <div class="modal-field"><label>练习内容</label><input type="text" class="modal-inp" id="logName"></div>
      <div class="modal-field"><label>练习时长 (分钟)</label><input type="number" class="modal-inp" id="logTime" min="1"></div>
      <div class="modal-field"><label>练习 BPM</label><input type="number" class="modal-inp" id="logBpm" min="30" max="250"></div>
      <div class="modal-field">
        <label>📍 阅读位置</label>
        <div class="progress-readout" id="logProgressText">第 1 页</div>
        <label class="modal-check-row"><input type="checkbox" id="logSaveProgress" checked> 把这次的位置存到本曲</label>
      </div>
      <div class="modal-footer">
        <button class="modal-btn cancel" id="logCancel">取消</button>
        <button class="modal-btn confirm" id="logConfirm">保存记录</button>
      </div>
    </div>
  </div>

  <div class="modal-mask" id="editModalMask">
    <div class="modal-box">
      <h3>编辑乐谱信息</h3>
      <div class="modal-field"><label>名称</label><input type="text" class="modal-inp" id="editName"></div>
      <div class="modal-field"><label>标签（逗号分隔，点已有标签快捷填入）</label><input type="text" class="modal-inp" id="editTags" placeholder="如: 流行, 练习曲, 待练"></div>
      <div class="quick-tags-label">已有标签（点击即填入 / 再点取消）</div>
      <div class="quick-tags" id="editQuickList"></div>
      <div class="modal-footer">
        <button class="modal-btn danger" id="editDeleteBtn" style="flex:0 0 60px;">删除</button>
        <button class="modal-btn cancel" id="editCancel">取消</button>
        <button class="modal-btn confirm" id="editConfirm">保存</button>
      </div>
    </div>
  </div>

  <div class="modal-mask" id="tagModalMask">
    <div class="modal-box tag-box">
      <h3 id="tagModalTitle">设置标签</h3>
      <div class="modal-field">
        <label id="tagModalHint">输入标签，用逗号分隔</label>
        <input type="text" class="modal-inp" id="tagModalInput" placeholder="如: 流行, 练习曲, 待练">
      </div>
      <div class="tag-mode-row" id="tagModeRow" style="display:none;">
        <button class="tag-mode-btn active" id="tagModeAdd" type="button">追加标签</button>
        <button class="tag-mode-btn" id="tagModeRemove" type="button">移除标签</button>
      </div>
      <div class="quick-tags-label">已有标签（点击即填入 / 再点取消）</div>
      <div class="quick-tags" id="tagQuickList"></div>
      <div class="modal-footer">
        <button class="modal-btn cancel" id="tagModalCancel">取消</button>
        <button class="modal-btn confirm" id="tagModalSave">保存</button>
      </div>
    </div>
  </div>

  <div class="modal-mask" id="splitModalMask">
    <div class="modal-box split-box">
      <h3>拆分建卡</h3>
      <div class="split-note">从当前 PDF 抽取页段，生成一份独立乐谱卡；原谱保持不变。</div>
      <div class="split-page-row">
        <div class="modal-field">
          <label>起始页</label>
          <input type="number" class="modal-inp" id="splitStart" min="1" step="1">
        </div>
        <div class="modal-field">
          <label>结束页</label>
          <input type="number" class="modal-inp" id="splitEnd" min="1" step="1">
        </div>
      </div>
      <div class="split-preview" id="splitPreview">
        <button class="split-thumb" id="splitPreviewStart" type="button" aria-label="选择起始页">
          <span class="split-thumb-head"><span>起始页</span><span class="split-thumb-page" id="splitPreviewStartPage">P1</span></span>
          <span class="split-thumb-canvas"><canvas id="splitStartCanvas"></canvas><span class="split-thumb-empty" id="splitStartEmpty">加载中…</span></span>
        </button>
        <button class="split-thumb" id="splitPreviewEnd" type="button" aria-label="选择结束页">
          <span class="split-thumb-head"><span>结束页</span><span class="split-thumb-page" id="splitPreviewEndPage">P1</span></span>
          <span class="split-thumb-canvas"><canvas id="splitEndCanvas"></canvas><span class="split-thumb-empty" id="splitEndEmpty">加载中…</span></span>
        </button>
      </div>
      <div class="split-preview-tip">点缩略图快速选页；起止页顺序会自动纠正。</div>
      <div class="split-range-hint" id="splitRangeHint"></div>
      <div class="modal-field">
        <label>新卡名称</label>
        <input type="text" class="modal-inp" id="splitName" placeholder="如: 某首曲子">
      </div>
      <div class="split-inherit" id="splitInherit"></div>
      <div class="modal-footer">
        <button class="modal-btn cancel" id="splitCancel">取消</button>
        <button class="modal-btn confirm" id="splitConfirm">建卡</button>
      </div>
    </div>
  </div>

  <div class="modal-mask split-picker-mask" id="splitPickerMask">
    <div class="modal-box split-picker-box">
      <h3 id="splitPickerTitle">选择页码</h3>
      <button class="split-picker-current" id="splitPickerCurrent" type="button">使用当前页</button>
      <div class="split-picker-grid" id="splitPickerGrid"></div>
      <div class="modal-footer">
        <button class="modal-btn cancel" id="splitPickerCancel">返回</button>
      </div>
    </div>
  </div>

  <div class="modal-mask" id="cloudModalMask">
    <div class="modal-box">
      <h3>☁️ 云同步</h3>
      <div class="modal-field"><label>账号</label><input type="text" class="modal-inp" id="cloudUser" placeholder="坚果云邮箱"></div>
      <div class="modal-field"><label>应用密码</label><input type="password" class="modal-inp" id="cloudPass" placeholder="在坚果云安全选项申请"></div>
      <div class="modal-field" id="cloudRememberRow" style="flex-direction:row;align-items:center;gap:8px;">
        <input type="checkbox" id="cloudRemember" style="width:16px;height:16px;flex:none;margin:0;">
        <label for="cloudRemember" style="flex:none;margin:0;font-size:13px;color: var(--accent-text);cursor:pointer;">记住应用密码（仅本机）</label>
        <button type="button" id="cloudForget" style="margin-left:auto;background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;padding:0;">清除已保存</button>
      </div>
      <div class="modal-field" id="cloudRememberHint" style="font-size:12px;color:var(--muted);line-height:1.6;margin-top:-4px;">
        密码以 AES-GCM 加密存进本机 IndexedDB，密钥不可导出，也不会写进备份文件；换设备需重新填。
      </div>
      <div class="modal-field"><label>路径</label><input type="text" class="modal-inp" id="cloudPath" value="GuitarShell/backup.json"></div>
      <div class="modal-field"><label>同步通道（留空自动选）</label><input type="text" class="modal-inp" id="cloudBase" placeholder="https://你的域名/dav/"></div>
      <button class="modal-btn cancel" id="cloudTest" style="background:var(--line);color: var(--accent-text);font-size:13px;font-weight:normal;">测试连接</button>
      <div id="cloudSyncState" style="font-size:12px;color:var(--muted);line-height:1.6;margin:-2px 2px 10px;">正在读取同步状态…</div>
      <div class="modal-footer">
        <button class="modal-btn cancel" id="cloudCancel">返回</button>
        <button class="modal-btn confirm" id="cloudDownload">📥 覆盖本地</button>
        <button class="modal-btn confirm" id="cloudUpload" style="background:var(--primary);">📤 上传备份</button>
      </div>
    </div>
  </div>
`;

class SheetReader extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.currentObjectUrl = null;
    this.scale = 1; 
    this.isDragging = false;
    this.startX = 0; this.startY = 0;
    this.scrollLeftStart = 0; this.scrollTopStart = 0;
    this.observer = null;
    // PDF 虚拟化渲染状态：只保当前页附近的位图，滚走就释放
    this.pdfDoc = null;
    this.pdfPages = null;        // Map<页码, {status, canvas, page, task, box}>
    this.pdfWindowRange = null;  // 当前保留窗口 {from, to}
    this.pdfJobChain = Promise.resolve();
    this.pdfRaf = null;
    this.pdfRefreshTimer = null;
    this.isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    
    this.allScores = [];
    this.filteredScores = [];
    this.searchKeyword = '';
    this.activeTags = [];
    this.sortMode = 'newest';
    this.manageMode = false;
    this.selectedIds = new Set();
    this.tagModalState = null;
    
    this.mmBpm = 120;
    this.mmPlaying = false;
    this.mmHandle = null;
    this.toastTimer = null;
    this.mmAutoCollapseTimer = null;
    this.currentFileName = "";
    this.currentScoreId = null;
    this.currentFileBlob = null;
    this.currentTags = [];
    this.closingReader = false;
    this.mmKnob = { ctx: null, size: 0, cx: 0, cy: 0, r: 0, dragging: false };

    // 🌟 阅读进度状态
    this.totalPages = 0;
    this.lastKnownPosition = null;   // 缓存的 { page, ratio, scrollY, total }
    this.bannerTimer = null;
    this.bookmarks = [];             // 🔖 当前谱的页级书签 [{ page, at }]
    this.fullscreen = false;
    this.nativeFullscreenActive = false;
    this.currentFormat = '';
    this.coverUrls = new Map();
    this.coverSeq = 0;
    this.zenLocked = false;
    this.zenHoldTimer = null;
    this.zenHoldSource = '';
    this.zenTapStart = null;
    this.zenKeyHeld = false;
    this.zenLayerOff = null;
    this.textHighlightRaf = null;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `<style>${readerCSS}</style>${readerHTML}`;
    this.initLogic();
    this.loadShelf();

    // 🌟 切换到其他标签页（节拍器/记录/调音）时，立刻停掉 mini 节拍器，避免双声道串音
    this.handleTabChange = (e) => {
      if (!e.detail || e.detail.target !== 'view-reader') {
        if (this.stopMiniMetronome) this.stopMiniMetronome();
        if (this.fullscreen && this.setReaderFullscreen) this.setReaderFullscreen(false);
        wakeLock.release('reader');
      } else {
        // 回到读谱页且仍有打开的谱面时，重新申请常亮
        const viewer = this.shadowRoot.getElementById('viewer');
        if (this.currentScoreId && viewer && viewer.style.display !== 'none') wakeLock.acquire('reader');
        if (this.updatePdfWindow) {
          // 回到读谱页：隐藏期间容器尺寸为 0，窗口可能被算歪，按当前尺寸重建一次
          requestAnimationFrame(() => this.updatePdfWindow());
        }
      }
    };
    window.addEventListener('app-tab-changed', this.handleTabChange);

    // 🌟 跟主节拍器保持一致：音色、重音（含首拍）实时同步
    this.handleMetronomeSettings = (e) => {
      if (!e.detail || !this.mmHandle) return;
      if (e.detail.timbre) this.mmHandle.setTimbre(e.detail.timbre);
      if (e.detail.accents) this.mmHandle.setAccents(e.detail.accents);
      if (e.detail.swing != null) this.mmHandle.setSwing(e.detail.swing);
    };
    window.addEventListener('metronome-settings', this.handleMetronomeSettings);

    // 🌟 全局设置里恢复 / 清空数据后，书架立即重读 IndexedDB
    this.handleDataChanged = () => this.loadShelf();
    window.addEventListener('gs-data-changed', this.handleDataChanged);
    this.offTheme = onThemeChange(() => { if (this.drawMmKnob) this.drawMmKnob(); });

    // 浏览器原生全屏被 Esc / 系统手势退出时，同步收回 CSS 全屏状态
    // 只有「确实进过原生全屏」才响应退出，避免 requestFullscreen 失败时误判
    this.handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        if (document.fullscreenElement === this) this.nativeFullscreenActive = true;
        return;
      }
      if (!this.nativeFullscreenActive) return;
      this.nativeFullscreenActive = false;
      if (this.fullscreen) this.setReaderFullscreen(false);
    };
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.handleFullscreenChange);
  }

  disconnectedCallback() {
    wakeLock.release('reader');
    if (this.currentObjectUrl) URL.revokeObjectURL(this.currentObjectUrl);
    if (this.observer) this.observer.disconnect();
    if (this.destroyPdf) this.destroyPdf();
    if (this.stopMiniMetronome) this.stopMiniMetronome();
    if (this.setZenLock) this.setZenLock(false);
    if (this.revokeCoverUrls) this.revokeCoverUrls();
    if (this.handleReaderKeydown) window.removeEventListener('keydown', this.handleReaderKeydown);
    if (this.handleReaderKeyup) window.removeEventListener('keyup', this.handleReaderKeyup);
    if (this.cancelZenKeyHold) window.removeEventListener('blur', this.cancelZenKeyHold);
    if (this.textHighlightRaf) { cancelAnimationFrame(this.textHighlightRaf); this.textHighlightRaf = null; }
    clearTimeout(this.zenHoldTimer);
    if (this.autoSaveTimer) { clearInterval(this.autoSaveTimer); this.autoSaveTimer = null; }
    if (this.handleTabChange) window.removeEventListener('app-tab-changed', this.handleTabChange);
    if (this.handleMetronomeSettings) window.removeEventListener('metronome-settings', this.handleMetronomeSettings);
    if (this.handleDataChanged) window.removeEventListener('gs-data-changed', this.handleDataChanged);
    if (this.handleCloudCancelRequest) window.removeEventListener('gs-cloud-cancel-request', this.handleCloudCancelRequest);
    if (this.offTheme) { this.offTheme(); this.offTheme = null; }
    if (this.handleOpenCloudSync) window.removeEventListener('open-cloud-sync', this.handleOpenCloudSync);
    if (this.handleFullscreenChange) document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    if (this.handleFullscreenChange) document.removeEventListener('webkitfullscreenchange', this.handleFullscreenChange);
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        const p = document.exitFullscreen();
        if (p && p.catch) p.catch(() => {});
      } catch (err) {}
    }
    if (this.handlePdfResize) window.removeEventListener('resize', this.handlePdfResize);
    if (this.positionNavZones) window.removeEventListener('resize', this.positionNavZones);
    clearTimeout(this.mmAutoCollapseTimer);
  }

  initLogic() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    
    const btnBack = $('btnBack');
    const btnLog = $('btnLog');
    const btnSplit = $('btnSplit');
    const btnImportMain = $('btnImportMain');
    const shelfView = $('shelfView');
    const filterBar = $('filterBar');
    const viewer = $('viewer');
    const container = $('contentContainer');
    const zoomControls = $('zoomControls');
    const miniMetronome = $('miniMetronome');
    const zenLock = $('zenLock');
    const zenPanel = $('zenPanel');
    const zenUnlock = $('zenUnlock');
    const btnZenLock = $('btnZenLock');
    const loading = $('loading');
    const toastEl = $('toast');
    const cloudTask = $('cloudTask');
    const cloudTaskText = $('cloudTaskText');
    const cloudTaskCancel = $('cloudTaskCancel');
    const cloudTaskRetry = $('cloudTaskRetry');
    const cloudTaskDismiss = $('cloudTaskDismiss');
    this.cloudFailure = null;
    this.cloudRetry = null;
    
    const searchInp = $('searchInp');
    const sortSel = $('sortSel');
    const tagBar = $('tagBar');
    const btnManage = $('btnManage');
    const batchBar = $('batchBar');
    const batchCount = $('batchCount');
    const batchTag = $('batchTag');
    const batchDelete = $('batchDelete');
    const batchSelectAll = $('batchSelectAll');
    const batchExit = $('batchExit');

    const logModalMask = $('logModalMask');
    const editModalMask = $('editModalMask');
    const editTags = $('editTags');
    const editQuickList = $('editQuickList');
    const tagModalMask = $('tagModalMask');
    const tagModalInput = $('tagModalInput');
    const tagQuickList = $('tagQuickList');
    const tagModalTitle = $('tagModalTitle');
    const tagModalHint = $('tagModalHint');
    const tagModeRow = $('tagModeRow');
    const tagModeAdd = $('tagModeAdd');
    const tagModeRemove = $('tagModeRemove');
    const cloudModalMask = $('cloudModalMask');
    const actionSheetMask = $('actionSheetMask');
    
    const showToast = (msg) => {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
    };

    // 浮层层级：同一 id 只保留一个注册；关闭时必须调用对应 untrack
    const layerOffs = new Map();
    const trackLayer = (id, close, options = {}) => {
      const old = layerOffs.get(id);
      if (old) old();
      const off = registerLayer({ id, close, ...options });
      layerOffs.set(id, off);
    };
    const untrackLayer = (id) => {
      const off = layerOffs.get(id);
      if (off) { off(); layerOffs.delete(id); }
    };
    const formChanged = (before, now) => {
      if (!before) return false;
      return Object.keys(before).some((key) => String(before[key] ?? '') !== String(now[key] ?? ''));
    };

    const confirmDiscard = async (title, message) => showConfirm({
      title,
      message,
      cancelText: '继续编辑',
      confirmText: '放弃',
      danger: true
    });

    const closeCloudModal = () => {
      untrackLayer('cloud-modal');
      cloudModalMask.classList.remove('show');
    };

    const closeActionSheet = () => {
      untrackLayer('import-sheet');
      actionSheetMask.classList.remove('show');
    };

    const isCloudCancel = (err) => !!(err && err.code === 'CLOUD_CANCELLED');

    const setCloudButtonsDisabled = (disabled) => {
      ['cloudUpload', 'cloudDownload', 'cloudTest'].forEach((id) => {
        const btn = $(id);
        if (btn) btn.disabled = !!disabled;
      });
    };

    const publishCloudTaskState = (busy, text = '') => {
      window.dispatchEvent(new CustomEvent('gs-cloud-task', {
        detail: { busy: !!busy, text: text || '' }
      }));
    };

    const setCloudBusy = (text) => {
      this.cloudBusy = !!text;
      publishCloudTaskState(this.cloudBusy, this.cloudBusy ? text : (this.cloudFailure || ''));
      if (text) {
        // 新任务开始：清掉上一次的失败 / 重试状态
        this.cloudFailure = null;
        this.cloudRetry = null;
        cloudTask.classList.remove('failed');
        cloudTask.classList.add('busy', 'show');
        cloudTaskText.textContent = text;
        cloudTask.title = '';
        cloudTaskCancel.disabled = false;
        const syncStateEl = $('cloudSyncState');
        syncStateEl.textContent = text;
        syncStateEl.style.color = 'var(--accent-text)';
      } else if (!this.cloudFailure) {
        cloudTask.classList.remove('busy', 'failed', 'show');
        cloudTaskText.textContent = '';
        cloudTask.title = '';
        if (cloudModalMask.classList.contains('show')) refreshCloudStatus();
      }
      setCloudButtonsDisabled(!!text);
    };

    const setCloudFailure = (text, retry) => {
      this.cloudBusy = false;
      this.cloudFailure = text;
      this.cloudRetry = retry || null;
      publishCloudTaskState(false, text);
      cloudTask.classList.remove('busy');
      cloudTask.classList.add('failed', 'show');
      cloudTaskText.textContent = text;
      cloudTask.title = text;
      cloudTaskCancel.disabled = false;
      setCloudButtonsDisabled(false);
      const syncStateEl = $('cloudSyncState');
      if (cloudModalMask.classList.contains('show')) {
        syncStateEl.textContent = text;
        syncStateEl.style.color = 'var(--danger-text)';
      }
    };

    const dismissCloudFailure = () => {
      this.cloudFailure = null;
      this.cloudRetry = null;
      publishCloudTaskState(false, '');
      cloudTask.classList.remove('busy', 'failed', 'show');
      cloudTaskText.textContent = '';
      cloudTask.title = '';
      if (cloudModalMask.classList.contains('show')) refreshCloudStatus();
    };

    const requestCloudCancel = () => {
      if (!this.cloudBusy) return;
      if (webdavService.cancelTask()) {
        cloudTaskText.textContent = '正在取消...';
        cloudTaskCancel.disabled = true;
      }
    };

    cloudTaskCancel.onclick = requestCloudCancel;
    cloudTaskRetry.onclick = () => {
      const retry = this.cloudRetry;
      if (!retry || this.cloudBusy) return;
      // 不在点击时清失败态：任务真正启动后由 setCloudBusy 清；
      // 若表单校验没过，失败胶囊和错误仍在，避免提示凭空消失。
      retry();
    };
    cloudTaskDismiss.onclick = () => dismissCloudFailure();
    this.handleCloudCancelRequest = requestCloudCancel;
    window.addEventListener('gs-cloud-cancel-request', this.handleCloudCancelRequest);

    if (this.isMobile) {
      $('btnFolderMain').style.display = 'none';
    }

    // ==================== 搜索：曲名 / 标签 / 拼音首字母 ====================
    const matchScoreByKeyword = (score, keyword) => {
      if (!keyword) return true;
      const q = keyword.toLowerCase();
      const name = String(score.name || '').toLowerCase();
      const tags = (score.tags || []).map(t => String(t).toLowerCase());

      // 1) 原文包含（中文、英文、数字都能直接搜）
      if (name.includes(q) || tags.some(t => t.includes(q))) return true;

      // 2) 纯字母 / 数字的查询才走拼音首字母（"gb" → 告白气球）
      if (!/^[a-z0-9]+$/.test(q)) return false;
      if (matchPinyin(score.name, q)) return true;
      return tags.some(t => matchPinyin(t, q));
    };

    const sameTags = (a, b) => {
      const left = uniqueTags(a).map(t => t.toLowerCase()).sort();
      const right = uniqueTags(b).map(t => t.toLowerCase()).sort();
      return left.length === right.length && left.every((t, i) => t === right[i]);
    };

    const updateBatchBar = () => {
      const count = this.selectedIds.size;
      batchBar.classList.toggle('show', this.manageMode);
      btnManage.classList.toggle('active', this.manageMode);
      btnManage.textContent = this.manageMode ? '完成' : '管理';
      batchCount.textContent = `已选 ${count} 份`;
      batchTag.disabled = count === 0;
      batchDelete.disabled = count === 0;

      const visible = this.filteredScores || [];
      const allSelected = visible.length > 0 && visible.every(score => this.selectedIds.has(score.id));
      batchSelectAll.textContent = allSelected ? '取消全选' : '全选';
      batchSelectAll.disabled = visible.length === 0;
    };
    this.updateBatchBar = updateBatchBar;

    const setManageMode = (enabled) => {
      this.manageMode = !!enabled;
      if (!this.manageMode) this.selectedIds.clear();
      searchInp.disabled = this.manageMode;
      sortSel.disabled = this.manageMode;
      tagBar.classList.toggle('disabled', this.manageMode);
      this.renderList();
      if (this.manageMode) {
        trackLayer('reader-manage', () => setManageMode(false), { blocksNavigation: false });
      } else {
        untrackLayer('reader-manage');
      }
    };
    this.setManageMode = setManageMode;

    const toggleSelected = (id) => {
      if (this.selectedIds.has(id)) this.selectedIds.delete(id);
      else this.selectedIds.add(id);
      const card = Array.from(shelfView.querySelectorAll('.score-card'))
        .find(el => el.dataset.scoreId === String(id));
      if (card) card.classList.toggle('selected', this.selectedIds.has(id));
      updateBatchBar();
    };
    this.toggleSelected = toggleSelected;

    const closeTagModal = () => {
      untrackLayer('tag-modal');
      tagModalMask.classList.remove('show');
      this.tagModalState = null;
    };

    const renderTagQuick = () => {
      const state = this.tagModalState;
      if (!state) return;
      const stats = state.mode === 'batch' && state.tagMode === 'remove'
        ? collectTagStats(state.scores)
        : collectTagStats(this.allScores);

      if (stats.length === 0) {
        tagQuickList.innerHTML = '<span class="quick-tag empty-hint">还没有已有标签</span>';
        return;
      }

      tagQuickList.innerHTML = stats.map(({ tag, count }) => {
        const active = hasTag(state.draft || [], tag);
        return `<button class="quick-tag ${active ? 'active' : ''}" type="button" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}<small>${count}</small></button>`;
      }).join('');

      tagQuickList.querySelectorAll('.quick-tag[data-tag]').forEach(btn => {
        btn.onclick = () => {
          // 与编辑乐谱弹窗一致：快捷标签只做选择，不把焦点塞回输入框
          tagModalInput.blur();
          const tag = btn.dataset.tag || '';
          state.draft = toggleTag(state.draft || [], tag);
          tagModalInput.value = state.draft.join(', ');
          renderTagQuick();
        };
      });
    };

    const renderEditQuick = () => {
      const state = this.editModalState;
      if (!state) return;
      const stats = collectTagStats(this.allScores);
      if (stats.length === 0) {
        editQuickList.innerHTML = '<span class="quick-tag empty-hint">还没有已有标签</span>';
        return;
      }
      editQuickList.innerHTML = stats.map(({ tag, count }) => {
        const active = hasTag(state.draft || [], tag);
        return `<button class="quick-tag ${active ? 'active' : ''}" type="button" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}<small>${count}</small></button>`;
      }).join('');
      editQuickList.querySelectorAll('.quick-tag[data-tag]').forEach(btn => {
        btn.onclick = () => {
          // 点快捷标签只做选择，不把焦点塞回输入框；否则移动端键盘会重新弹出并挡住标签区
          $('editName').blur();
          editTags.blur();
          const tag = btn.dataset.tag || '';
          state.draft = toggleTag(state.draft || [], tag);
          editTags.value = state.draft.join(', ');
          renderEditQuick();
        };
      });
    };

    let editInitial = null;
    const readEditForm = () => ({
      name: $('editName').value,
      tags: editTags.value
    });
    const closeEditModal = async (opts = {}) => {
      if (!editModalMask.classList.contains('show')) return;
      if (!opts.force && editInitial && formChanged(editInitial, readEditForm())) {
        const ok = await confirmDiscard('放弃本次编辑？', '修改后的名称或标签不会保存。');
        if (!ok) return;
      }
      untrackLayer('edit-modal');
      this.editModalState = null;
      editInitial = null;
      editModalMask.classList.remove('show');
    };

    const openEditModal = (score) => {
      // 打开时只回填内容，不自动聚焦；键盘等用户真正点输入框时再出
      $('editName').blur();
      editTags.blur();
      const tags = uniqueTags(score.tags || []);
      this.editModalState = { scoreId: score.id, draft: tags };
      $('editName').value = score.name;
      editTags.value = tags.join(', ');
      editInitial = readEditForm();
      renderEditQuick();
      editModalMask.classList.add('show');
      trackLayer('edit-modal', closeEditModal);
    };

    const openBatchTagModal = () => {
      tagModalInput.blur();
      const scores = this.allScores.filter(score => this.selectedIds.has(score.id));
      if (scores.length === 0) return;
      this.tagModalState = {
        mode: 'batch',
        tagMode: 'add',
        draft: [],
        scores
      };
      tagModalTitle.textContent = `给 ${scores.length} 份乐谱打标签`;
      tagModalHint.textContent = '选择追加或移除，可一次填多个标签';
      tagModeRow.style.display = 'flex';
      tagModeAdd.classList.add('active');
      tagModeRemove.classList.remove('active');
      tagModalInput.value = '';
      renderTagQuick();
      tagModalMask.classList.add('show');
      trackLayer('tag-modal', closeTagModal);
    };

    const confirmDeleteScore = async (score) => {
      const ok = await showConfirm({
        title: '从书架删除',
        message: '删除后乐谱文件将从本机移除，练习记录会保留。',
        details: [{ label: '乐谱', value: score.name }],
        confirmText: '删除',
        danger: true
      });
      if (!ok) return false;
      await dbService.deleteScore(score.id);
      return true;
    };

    const revokeCoverUrls = () => {
      this.coverUrls.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch (err) {}
      });
      this.coverUrls.clear();
      this.coverSeq += 1;
    };
    this.revokeCoverUrls = revokeCoverUrls;

    const updateCardMeta = (card, score) => {
      const meta = card.querySelector('.score-meta');
      if (!meta) return;
      const format = detectScoreFormat(score.name, score.fileBlob && score.fileBlob.type, score.format);
      meta.textContent = formatDisplay(format, score.name, score.pageCount);
    };

    const hydrateOneCover = async (score, seq) => {
      if (seq !== this.coverSeq) return;
      const card = shelfView.querySelector(`.score-card[data-score-id="${score.id}"]`);
      if (!card) return;
      const cover = card.querySelector('.score-cover');
      if (!cover) return;

      const blob = await ensureCoverForScore(score);
      if (seq !== this.coverSeq) return;
      if (blob) {
        const url = URL.createObjectURL(blob);
        this.coverUrls.set(score.id, url);
        let img = cover.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.alt = '';
          img.decoding = 'async';
          cover.appendChild(img);
        }
        img.src = url;
        cover.classList.add('has-cover');
      }
      updateCardMeta(card, score);
    };

    const hydrateCovers = async (scores) => {
      const seq = this.coverSeq;
      // 小批并发：PDF 首页解析不要太挤，也不能让 30 张卡排成一条长队
      const batchSize = 3;
      for (let i = 0; i < scores.length; i += batchSize) {
        if (seq !== this.coverSeq) return;
        await Promise.all(scores.slice(i, i + batchSize).map((score) => hydrateOneCover(score, seq)));
      }
    };

    this.renderList = () => {
      const keyword = (this.searchKeyword || '').trim();
      this.filteredScores = this.allScores.filter(score => {
        // 多标签是「同时满足」（AND）：选了「流行 + 待练」只留下两个标签都有的
        const tags = score.tags || [];
        const tagMatch = this.activeTags.length === 0 || this.activeTags.every(t => tags.includes(t));
        return tagMatch && matchScoreByKeyword(score, keyword);
      });

      this.filteredScores.sort((a, b) => {
        if (this.sortMode === 'newest') return b.createdAt - a.createdAt;
        if (this.sortMode === 'oldest') return a.createdAt - b.createdAt;
        if (this.sortMode === 'name') return a.name.localeCompare(b.name);
        return 0;
      });

      shelfView.classList.toggle('managing', this.manageMode);
      updateBatchBar();

      revokeCoverUrls();
      shelfView.innerHTML = '';
      if (this.allScores.length === 0) {
        shelfView.innerHTML = `
          <div class="empty-state">
            <div class="empty-mark" aria-hidden="true">♪</div>
            <h3 class="empty-title">还没有乐谱</h3>
            <p class="empty-desc">导入 PDF、图片、TXT / Markdown / ChordPro，或拍照，建立你的练琴书架。也可以先用节拍器热身。</p>
            <div class="empty-actions">
              <button class="empty-action primary" id="emptyImport" type="button">导入第一份乐谱</button>
              <button class="empty-action secondary" id="emptyMetronome" type="button">先用节拍器</button>
            </div>
          </div>`;
        const emptyImport = shelfView.querySelector('#emptyImport');
        const emptyMetronome = shelfView.querySelector('#emptyMetronome');
        if (emptyImport) emptyImport.onclick = () => btnImportMain.click();
        if (emptyMetronome) emptyMetronome.onclick = () => {
          window.dispatchEvent(new CustomEvent('app-request-tab', { detail: { target: 'view-metronome' } }));
        };
        return;
      }

      if (this.filteredScores.length === 0) {
        shelfView.innerHTML = `<div class="empty-tip">没有找到符合条件的乐谱</div>`;
        return;
      }

      this.filteredScores.forEach(score => {
        const card = document.createElement('div');
        const selected = this.selectedIds.has(score.id);
        card.className = 'score-card' + (selected ? ' selected' : '');
        card.dataset.scoreId = String(score.id);
        const format = detectScoreFormat(score.name, score.fileBlob && score.fileBlob.type, score.format);
        const icon = formatIcon(format, score.name);
        const metaText = formatDisplay(format, score.name, score.pageCount);
        const tags = uniqueTags(score.tags || []);
        const badgeText = tags.length === 0
          ? ''
          : (tags.length === 1 ? `#${tags[0]}` : `#${tags[0]} +${tags.length - 1}`);

        card.innerHTML = `
          <button class="card-edit-btn" type="button" title="编辑乐谱信息">✎</button>
          <span class="select-mark" aria-hidden="true">✓</span>
          <div class="score-cover"><span class="score-cover-fallback" aria-hidden="true">${icon}</span></div>
          <div class="score-info">
            <div class="score-name" title="${escapeHtml(score.name)}">${escapeHtml(score.name)}</div>
            <div class="score-meta">${escapeHtml(metaText)}</div>
            ${tags.length ? `<span class="tag-badge" title="${escapeHtml(tags.join('，'))}">${escapeHtml(badgeText)}</span>` : ''}
          </div>
          <div class="card-actions">
            <button class="action-btn btn-delete" title="删除">×</button>
          </div>
        `;

        card.onclick = () => {
          if (this.manageMode) {
            toggleSelected(score.id);
            return;
          }
          this.openScore(score.fileBlob, score.name, score.id, score.tags, score);
        };

        card.querySelector('.card-edit-btn').onclick = (e) => {
          e.stopPropagation();
          if (this.manageMode) return;
          openEditModal(score);
        };

        card.querySelector('.btn-delete').onclick = async (e) => {
          e.stopPropagation();
          const deleted = await confirmDeleteScore(score);
          if (deleted) {
            showToast('已删除');
            this.loadShelf();
          }
        };

        shelfView.appendChild(card);
      });

      hydrateCovers(this.filteredScores);
    };

    this.loadShelf = async () => {
      this.allScores = await dbService.getAllScores();
      const existingIds = new Set(this.allScores.map(s => s.id));
      Array.from(this.selectedIds).forEach(id => {
        if (!existingIds.has(id)) this.selectedIds.delete(id);
      });

      const tagStats = collectTagStats(this.allScores);
      tagBar.innerHTML = `<div class="tag-chip ${this.activeTags.length === 0 ? 'active' : ''}" data-tag="全部">全部</div>`;
      tagStats.forEach(({ tag }) => {
        tagBar.innerHTML += `<div class="tag-chip ${this.activeTags.includes(tag) ? 'active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</div>`;
      });

      tagBar.querySelectorAll('.tag-chip').forEach(chip => {
        chip.onclick = () => {
          if (this.manageMode) return;
          const tag = chip.dataset.tag;
          if (tag === '全部') this.activeTags = [];
          else if (this.activeTags.includes(tag)) this.activeTags = this.activeTags.filter(t => t !== tag);
          else this.activeTags = this.activeTags.concat(tag); // 多选，按顺序叠加

          tagBar.querySelectorAll('.tag-chip').forEach(c => {
            const name = c.dataset.tag;
            c.classList.toggle('active', name === '全部' ? this.activeTags.length === 0 : this.activeTags.includes(name));
          });
          this.renderList();
        };
      });

      this.renderList();
    };

    btnManage.onclick = () => setManageMode(!this.manageMode);
    batchExit.onclick = () => setManageMode(false);
    batchSelectAll.onclick = () => {
      const visible = this.filteredScores || [];
      const allSelected = visible.length > 0 && visible.every(score => this.selectedIds.has(score.id));
      if (allSelected) visible.forEach(score => this.selectedIds.delete(score.id));
      else visible.forEach(score => this.selectedIds.add(score.id));
      this.renderList();
    };
    batchTag.onclick = () => openBatchTagModal();
    batchDelete.onclick = async () => {
      const scores = this.allScores.filter(score => this.selectedIds.has(score.id));
      if (scores.length === 0) return;
      const preview = scores.slice(0, 3).map(score => `《${score.name}》`).join('、');
      const more = scores.length > 3 ? ` 等 ${scores.length} 份` : '';
      const ok = await showConfirm({
        title: '批量删除乐谱',
        message: '删除后这些乐谱文件将从本机移除，练习记录会保留。',
        details: [
          { label: '乐谱', value: `${scores.length} 份` },
          { label: '包含', value: preview + more },
          { label: '练习记录', value: '保留' }
        ],
        confirmText: '删除',
        danger: true
      });
      if (!ok) return;
      for (const score of scores) await dbService.deleteScore(score.id);
      this.selectedIds.clear();
      setManageMode(false);
      await this.loadShelf();
      showToast(`已删除 ${scores.length} 份乐谱`);
    };

    tagModalInput.addEventListener('input', () => {
      if (!this.tagModalState) return;
      this.tagModalState.draft = parseTagInput(tagModalInput.value);
      renderTagQuick();
    });
    tagModeAdd.onclick = () => {
      if (!this.tagModalState) return;
      this.tagModalState.tagMode = 'add';
      this.tagModalState.draft = [];
      tagModalInput.value = '';
      tagModeAdd.classList.add('active');
      tagModeRemove.classList.remove('active');
      renderTagQuick();
    };
    tagModeRemove.onclick = () => {
      if (!this.tagModalState) return;
      this.tagModalState.tagMode = 'remove';
      this.tagModalState.draft = [];
      tagModalInput.value = '';
      tagModeRemove.classList.add('active');
      tagModeAdd.classList.remove('active');
      renderTagQuick();
    };
    $('tagModalCancel').onclick = closeTagModal;
    bindBackdrop(tagModalMask, closeTagModal);
    $('tagModalSave').onclick = async () => {
      const state = this.tagModalState;
      if (!state) return;
      const tags = parseTagInput(tagModalInput.value);

      if (state.mode === 'single') {
        await dbService.updateScore(state.scoreId, { tags });
        closeTagModal();
        await this.loadShelf();
        showToast('标签已更新');
        return;
      }

      if (tags.length === 0) {
        showToast(state.tagMode === 'remove' ? '请先选择要移除的标签' : '请先填写要追加的标签');
        return;
      }

      let changed = 0;
      for (const score of state.scores) {
        const before = uniqueTags(score.tags || []);
        const after = applyTagChanges(before, tags, state.tagMode);
        if (sameTags(before, after)) continue;
        await dbService.updateScore(score.id, { tags: after });
        changed += 1;
      }

      closeTagModal();
      await this.loadShelf();
      showToast(changed > 0 ? `已更新 ${changed} 份乐谱的标签` : '没有需要变更的标签');
    };

    searchInp.oninput = (e) => {
      if (this.manageMode) return;
      this.searchKeyword = e.target.value;
      this.renderList();
    };
    sortSel.onchange = (e) => {
      if (this.manageMode) return;
      this.sortMode = e.target.value;
      this.renderList();
    };

    const applyScale = () => {
      this.scale = Math.max(1, Math.min(6, Number(this.scale) || 1));
      if (this.currentFormat === SCORE_FORMAT.TEXT) {
        container.style.width = '100%';
        container.style.setProperty('--text-scale', String(this.scale));
      } else {
        container.style.removeProperty('--text-scale');
        container.style.width = `${this.scale * 100}%`;
      }
      // 缩放改变的是 CSS 宽度，位图要按新宽度重渲才不糊（防抖，滚轮连续缩放不卡）
      if (this.refreshPdfResolution) this.refreshPdfResolution();
    };
    const loadPdfLib = async () => {
      if (window.pdfjsLib) { pdfjsLib = window.pdfjsLib; return pdfjsLib; }
      loading.textContent = '正在加载解析引擎...'; loading.classList.add('show');
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = './js/lib/pdf.js'; 
        script.onload = () => {
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = './js/lib/pdf.worker.js';
            pdfjsLib = window.pdfjsLib; loading.classList.remove('show'); resolve(pdfjsLib);
          } else { loading.classList.remove('show'); reject(new Error('pdf.js 加载未挂载')); }
        };
        script.onerror = () => { loading.classList.remove('show'); reject(new Error('找不到本地文件')); };
        document.head.appendChild(script);
      });
    };

    // ==================== PDF 渲染：虚拟化 + 分辨率自适应 ====================
    // 口径：同时只保留「当前可见页 ±3 页」的位图，滚走即释放；
    //      位图密度 = 实际显示宽度 × min(DPR, 2)，缩放后按新宽度重渲。
    const PDF_MAX_DPR = 2;
    const PDF_KEEP_RADIUS = 3;
    const PDF_PRELOAD_RADIUS = 1;

    const currentDensity = () => Math.min(window.devicePixelRatio || 1, PDF_MAX_DPR);

    const pageBoxOf = (n) => container.querySelector(`.page-box[data-page="${n}"]`);

    const pdfRecord = (n) => {
      if (!this.pdfPages) this.pdfPages = new Map();
      let rec = this.pdfPages.get(n);
      if (!rec) {
        rec = { status: 'empty', canvas: null, page: null, task: null, box: null };
        this.pdfPages.set(n, rec);
      }
      if (!rec.box) rec.box = pageBoxOf(n);
      return rec;
    };

    // 当前可视页范围（跨页时两页都算可见）
    const visiblePageRange = () => {
      const boxes = container.querySelectorAll('.page-box');
      if (!boxes.length) return null;
      const viewTop = viewer.getBoundingClientRect().top;
      const scrollTop = viewer.scrollTop;
      const viewBottom = scrollTop + (viewer.clientHeight || 1);
      let first = 0, last = 0;
      for (const box of boxes) {
        const top = box.getBoundingClientRect().top - viewTop + scrollTop;
        const bottom = top + box.offsetHeight;
        if (bottom < scrollTop || top > viewBottom) continue;
        const n = parseInt(box.dataset.page, 10);
        if (!first) first = n;
        last = Math.max(last, n);
      }
      if (!first) {
        // 完全落在页间留白：取离视口最近的一页，避免不渲染
        let nearest = 1, min = Infinity;
        for (const box of boxes) {
          const top = box.getBoundingClientRect().top - viewTop + scrollTop;
          const d = Math.abs(top - scrollTop);
          if (d < min) { min = d; nearest = parseInt(box.dataset.page, 10); }
        }
        first = last = nearest;
      }
      return { first, last };
    };

    const isRetained = (n) => {
      const range = this.pdfWindowRange;
      if (!range) return true;
      return n >= range.from && n <= range.to;
    };

    const evictPage = (n) => {
      const rec = this.pdfPages && this.pdfPages.get(n);
      if (!rec) return;
      if (rec.task) { try { rec.task.cancel(); } catch (err) {} rec.task = null; }
      if (rec.canvas) { rec.canvas.width = 0; rec.canvas.height = 0; rec.canvas = null; }
      if (rec.page && rec.page.cleanup) { try { rec.page.cleanup(); } catch (err) {} }
      rec.page = null;
      if (rec.box) { rec.box.innerHTML = ''; rec.box.classList.remove('loaded'); }
      rec.status = 'empty';
    };

    const renderPdfPage = async (n) => {
      const rec = pdfRecord(n);
      if (!rec.box || !this.pdfDoc) return;
      const page = rec.page || (rec.page = await this.pdfDoc.getPage(n));
      const baseViewport = page.getViewport({ scale: 1.0 });
      const cssWidth = container.clientWidth || viewer.clientWidth || baseViewport.width;
      const scale = Math.max(0.6, Math.min(3.2, (cssWidth / baseViewport.width) * currentDensity()));
      const vp = page.getViewport({ scale });

      if (!rec.canvas) rec.canvas = document.createElement('canvas');
      rec.canvas.width = Math.floor(vp.width);
      rec.canvas.height = Math.floor(vp.height);
      rec.status = 'rendering';
      rec.task = page.render({ canvasContext: rec.canvas.getContext('2d'), viewport: vp });
      try {
        await rec.task.promise;
      } catch (err) {
        rec.status = 'empty';
        throw err;
      }
      rec.task = null;

      // 渲染期间可能已经滚出保留窗口：别把图塞回去，直接释放
      if (!isRetained(n) || !rec.box) { evictPage(n); return; }
      rec.box.innerHTML = '';
      rec.box.appendChild(rec.canvas);
      rec.box.classList.add('loaded');
      rec.status = 'ready';
    };

    // 串行排队：一次只渲染一页，滚动时先渲染可见页，再补窗口内其余页
    const ensurePageRendered = (n) => {
      const rec = pdfRecord(n);
      if (rec.status === 'rendering' || rec.status === 'queued' || rec.status === 'ready') return;
      rec.status = 'queued';
      this.pdfJobChain = (this.pdfJobChain || Promise.resolve()).then(async () => {
        const cur = pdfRecord(n);
        if (cur.status !== 'queued') return; // 排队期间被释放
        try { await renderPdfPage(n); }
        catch (err) { console.warn('PDF 页渲染失败', n, err); cur.status = 'empty'; }
      });
    };

    const updatePdfWindow = () => {
      if (!this.pdfDoc || !this.pdfPages) return;
      const range = visiblePageRange();
      if (!range) return;

      const keepFrom = Math.max(1, range.first - PDF_KEEP_RADIUS);
      const keepTo = Math.min(this.totalPages, range.last + PDF_KEEP_RADIUS);
      this.pdfWindowRange = { from: keepFrom, to: keepTo };

      // 1) 释放窗口外的位图
      for (const n of Array.from(this.pdfPages.keys())) {
        if (n < keepFrom || n > keepTo) evictPage(n);
      }

      // 2) 可见页 ±1 先渲染，其余窗口内页排队补齐
      const visFrom = Math.max(1, range.first - PDF_PRELOAD_RADIUS);
      const visTo = Math.min(this.totalPages, range.last + PDF_PRELOAD_RADIUS);
      const queue = [];
      for (let n = visFrom; n <= visTo; n++) queue.push(n);
      for (let n = keepFrom; n <= keepTo; n++) if (n < visFrom || n > visTo) queue.push(n);
      queue.forEach(ensurePageRendered);
    };
    this.updatePdfWindow = updatePdfWindow;

    const requestPdfWindowUpdate = () => {
      if (this.pdfRaf) return;
      this.pdfRaf = requestAnimationFrame(() => { this.pdfRaf = null; updatePdfWindow(); });
    };
    viewer.addEventListener('scroll', requestPdfWindowUpdate, { passive: true });

    // 窗口尺寸 / 横竖屏变化：容器宽度变了，位图按新宽度重渲
    this.handlePdfResize = () => { if (this.refreshPdfResolution) this.refreshPdfResolution(); };
    window.addEventListener('resize', this.handlePdfResize);

    // 缩放后重渲：先把已就绪的页标 stale，再让窗口逻辑补渲
    this.refreshPdfResolution = () => {
      if (!this.pdfDoc) return;
      clearTimeout(this.pdfRefreshTimer);
      this.pdfRefreshTimer = setTimeout(() => {
        if (!this.pdfDoc || !this.pdfPages) return;
        for (const rec of this.pdfPages.values()) {
          if (rec.status === 'ready') rec.status = 'stale';
        }
        updatePdfWindow();
      }, 250);
    };

    // 关谱 / 换谱时彻底释放：取消渲染、清位图、销毁 pdf 文档
    const destroyPdf = () => {
      clearTimeout(this.pdfRefreshTimer);
      if (this.pdfRaf) { cancelAnimationFrame(this.pdfRaf); this.pdfRaf = null; }
      if (this.pdfPages) {
        for (const n of Array.from(this.pdfPages.keys())) evictPage(n);
        this.pdfPages.clear();
      }
      this.pdfWindowRange = null;
      this.pdfJobChain = Promise.resolve();
      if (this.pdfDoc) {
        try { this.pdfDoc.destroy(); } catch (err) {}
        this.pdfDoc = null;
      }
    };
    this.destroyPdf = destroyPdf;

    const renderPDFLazy = async (fileBlob) => {
      const lib = await loadPdfLib();
      const arrayBuffer = await fileBlob.arrayBuffer();
      const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
      this.pdfDoc = pdf;
      this.pdfPages = new Map();
      this.totalPages = pdf.numPages;

      // 只取首页量一下宽高比，量完立刻释放，别占着页对象
      const firstPage = await pdf.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1.0 });
      const ratio = viewport.height / viewport.width;
      if (firstPage.cleanup) { try { firstPage.cleanup(); } catch (err) {} }

      container.innerHTML = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const pageBox = document.createElement('div');
        pageBox.className = 'page-box';
        pageBox.dataset.page = i;
        pageBox.style.aspectRatio = `1 / ${ratio}`; // 先占位，滚到才渲染，滚动条长度稳定
        container.appendChild(pageBox);
      }

      updatePdfWindow();
      requestAnimationFrame(() => updatePdfWindow());
    };

    // ==================== 🌟 阅读进度：计算 / 恢复 / 提示 ====================
    const pageBoxes = () => Array.from(container.querySelectorAll('.page-box'));

    // 当前阅读位置：页码 + 页内比例（不依赖像素，缩放后也不会偏）
    const getReadingPosition = () => {
      const cached = this.lastKnownPosition;
      if ((!viewer.offsetParent || viewer.clientHeight === 0) && cached) return cached;

      const scrollTop = viewer.scrollTop;
      const viewH = viewer.clientHeight || 1;
      const viewTop = viewer.getBoundingClientRect().top;
      const boxes = pageBoxes();
      let page = 1, ratio = 0;
      const total = boxes.length || this.totalPages || 1;

      if (boxes.length) {
        // 用「视口中心」判定当前页，落在两页之间的留白时也不会误判
        const probe = scrollTop + viewH * 0.5;
        let current = boxes[0];
        for (const box of boxes) {
          const top = box.getBoundingClientRect().top - viewTop + scrollTop;
          if (top <= probe) current = box; else break;
        }
        page = parseInt(current.dataset.page, 10) || 1;
        const top = current.getBoundingClientRect().top - viewTop + scrollTop;
        const h = current.offsetHeight || 1;
        ratio = Math.min(1, Math.max(0, (scrollTop - top) / Math.max(1, h - viewH)));
      } else {
        const img = container.querySelector('img');
        const textSheet = container.querySelector('.text-sheet');
        if (textSheet) {
          page = 1;
          ratio = Math.min(1, Math.max(0, scrollTop / Math.max(1, viewer.scrollHeight - viewH)));
        } else if (img) {
          const top = img.getBoundingClientRect().top - viewTop + scrollTop;
          const h = img.offsetHeight || 1;
          page = 1;
          ratio = Math.min(1, Math.max(0, (scrollTop - top) / Math.max(1, h - viewH)));
        }
      }

      const pos = { page, ratio, scrollY: Math.round(scrollTop), total };
      this.lastKnownPosition = pos;
      return pos;
    };

    // 跳到「第 page 页 + 页内比例」
    const scrollToPage = (page, ratio) => {
      const boxes = pageBoxes();
      const targetEl = boxes.length
        ? (boxes.find(b => parseInt(b.dataset.page, 10) === page) || boxes[boxes.length - 1])
        : (container.querySelector('img') || container.querySelector('.text-sheet'));
      if (!targetEl) return;

      const viewTop = viewer.getBoundingClientRect().top;
      const top = targetEl.getBoundingClientRect().top - viewTop + viewer.scrollTop;
      const h = targetEl.offsetHeight || 1;
      const maxStop = Math.max(0, viewer.scrollHeight - viewer.clientHeight);
      const wanted = top + Math.min(1, Math.max(0, ratio)) * Math.max(0, h - viewer.clientHeight);
      const target = Math.round(Math.min(Math.max(0, wanted), maxStop));

      viewer.scrollTo({ top: target, behavior: 'smooth' });
      this.lastKnownPosition = { page, ratio, scrollY: target, total: boxes.length || this.totalPages || 1 };
    };

    // ==================== 🔖 页级书签（存进乐谱记录的 bookmarks 字段，随备份 / 云同步一起走） ====================
    const btnBookmarks = $('btnBookmarks');
    const bookmarkMask = $('bookmarkMask');
    const bmList = $('bmList');

    const updateBookmarkBadge = () => {
      const badge = $('bookmarkBadge');
      if (!badge) return;
      const count = this.bookmarks.length;
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.hidden = count === 0;
      btnBookmarks.setAttribute('aria-label', count ? `本书书签，共 ${count} 个` : '本书书签');
    };

    const persistBookmarks = async () => {
      if (!this.currentScoreId) return;
      await dbService.updateScore(this.currentScoreId, { bookmarks: this.bookmarks.slice() });
      const cached = this.allScores.find(s => s.id === this.currentScoreId);
      if (cached) cached.bookmarks = this.bookmarks.slice();
    };

    const renderBookmarkList = () => {
      if (!this.bookmarks.length) {
        bmList.innerHTML = `<div class="bm-empty">还没有书签：翻到想记住的一页，点上面的「收藏当前页」</div>`;
        return;
      }
      bmList.innerHTML = '';
      this.bookmarks.slice().sort((a, b) => a.page - b.page).forEach(bm => {
        const d = new Date(bm.at || Date.now());
        const timeStr = `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const row = document.createElement('div');
        row.className = 'bm-row';
        row.innerHTML = `
          <div class="bm-page">第 ${bm.page} 页</div>
          <div class="bm-time">${timeStr}</div>
          <button class="bm-del">删除</button>
        `;
        row.onclick = (e) => {
          if (e.target.closest('.bm-del')) return;
          closeBookmarks();
          scrollToPage(bm.page, 0);
        };
        row.querySelector('.bm-del').onclick = async (e) => {
          e.stopPropagation();
          this.bookmarks = this.bookmarks.filter(b => b.page !== bm.page);
          await persistBookmarks();
          updateBookmarkBadge();
          renderBookmarkList();
        };
        bmList.appendChild(row);
      });
    };

    const addBookmark = async () => {
      if (!this.currentScoreId) return showToast('还没有打开的谱子');
      const page = Math.max(1, getReadingPosition().page || 1);
      const now = Date.now();
      const existing = this.bookmarks.find(b => b.page === page);
      if (existing) existing.at = now;
      else this.bookmarks.push({ page, at: now });

      // 最多留 30 个，超出按收藏时间丢最旧的
      if (this.bookmarks.length > 30) {
        this.bookmarks.sort((a, b) => a.at - b.at).splice(0, this.bookmarks.length - 30);
      }
      this.bookmarks.sort((a, b) => a.page - b.page);

      await persistBookmarks();
      updateBookmarkBadge();
      renderBookmarkList();
      showToast(`已收藏第 ${page} 页`);
    };

    const closeBookmarks = () => {
      untrackLayer('bookmarks');
      bookmarkMask.classList.remove('show');
    };
    btnBookmarks.onclick = () => {
      renderBookmarkList();
      bookmarkMask.classList.add('show');
      trackLayer('bookmarks', closeBookmarks);
    };
    $('bmClose').onclick = closeBookmarks;
    $('bmAdd').onclick = addBookmark;
    bindBackdrop(bookmarkMask, closeBookmarks);

    // ==================== ✂ 拆分建卡（独立 PDF） ====================
    const splitModalMask = $('splitModalMask');
    const splitStart = $('splitStart');
    const splitEnd = $('splitEnd');
    const splitName = $('splitName');
    const splitRangeHint = $('splitRangeHint');
    const splitInherit = $('splitInherit');
    const splitCancel = $('splitCancel');
    const splitConfirm = $('splitConfirm');
    const splitPreviewStart = $('splitPreviewStart');
    const splitPreviewEnd = $('splitPreviewEnd');
    const splitPreviewStartPage = $('splitPreviewStartPage');
    const splitPreviewEndPage = $('splitPreviewEndPage');
    const splitStartCanvas = $('splitStartCanvas');
    const splitEndCanvas = $('splitEndCanvas');
    const splitStartEmpty = $('splitStartEmpty');
    const splitEndEmpty = $('splitEndEmpty');
    const splitPickerMask = $('splitPickerMask');
    const splitPickerTitle = $('splitPickerTitle');
    const splitPickerCurrent = $('splitPickerCurrent');
    const splitPickerGrid = $('splitPickerGrid');
    const splitPickerCancel = $('splitPickerCancel');
    let splitBusy = false;
    let splitNameTouched = false;
    let splitPreviewTimer = null;
    let splitPreviewToken = 0;
    let splitPickerTarget = 'start';
    let splitInitial = null;

    const splitTotalPages = () => (this.pdfDoc && this.pdfDoc.numPages) || 0;
    const splitDefaultName = (start, end) => {
      const base = (this.currentFileName || '乐谱').trim() || '乐谱';
      return `${base} · ${start === end ? `P${start}` : `P${start}-${end}`}`;
    };

    const splitCurrentPage = () => {
      const total = splitTotalPages();
      const pos = getReadingPosition();
      return Math.min(Math.max(1, pos.page || 1), total || 1);
    };

    const splitPageValid = (n, total = splitTotalPages()) => (
      Number.isInteger(n) && n >= 1 && n <= total
    );

    // 输入一侧页码时自动纠正顺序：起始页变大就抬高结束页，结束页变小就压低起始页。
    const normalizeSplitRange = (source) => {
      const total = splitTotalPages();
      if (!total) return;
      const start = Number(splitStart.value);
      const end = Number(splitEnd.value);
      if (!splitPageValid(start, total) || !splitPageValid(end, total)) return;
      if (source === 'start' && start > end) splitEnd.value = String(start);
      if (source === 'end' && end < start) splitStart.value = String(end);
    };

    const clearSplitPreview = () => {
      splitPreviewToken++;
      clearTimeout(splitPreviewTimer);
      splitPreviewTimer = null;
      [splitStartCanvas, splitEndCanvas].forEach((canvas) => {
        canvas.width = 0;
        canvas.height = 0;
        canvas.hidden = true;
      });
      splitStartEmpty.textContent = '加载中…';
      splitEndEmpty.textContent = '加载中…';
      splitStartEmpty.hidden = false;
      splitEndEmpty.hidden = false;
    };

    const renderSplitThumb = async (pageNumber, canvas) => {
      const page = await this.pdfDoc.getPage(pageNumber);
      try {
        const base = page.getViewport({ scale: 1.0 });
        const scale = Math.min(0.8, 160 / Math.max(1, base.width));
        const vp = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      } finally {
        if (page.cleanup) { try { page.cleanup(); } catch (err) {} }
      }
    };

    const renderSplitPreview = async () => {
      const token = ++splitPreviewToken;
      const total = splitTotalPages();
      const start = Number(splitStart.value);
      const end = Number(splitEnd.value);
      splitPreviewStartPage.textContent = total && start ? `P${start}` : 'P?';
      splitPreviewEndPage.textContent = total && end ? `P${end}` : 'P?';

      const valid = splitPageValid(start, total) && splitPageValid(end, total);
      if (!valid) {
        splitStartCanvas.hidden = true;
        splitEndCanvas.hidden = true;
        splitStartEmpty.textContent = '页码无效';
        splitEndEmpty.textContent = '页码无效';
        splitStartEmpty.hidden = false;
        splitEndEmpty.hidden = false;
        return;
      }

      splitStartCanvas.hidden = true;
      splitEndCanvas.hidden = true;
      splitStartEmpty.textContent = '加载中…';
      splitEndEmpty.textContent = '加载中…';
      splitStartEmpty.hidden = false;
      splitEndEmpty.hidden = false;
      try {
        await renderSplitThumb(start, splitStartCanvas);
        if (token !== splitPreviewToken) return;
        await renderSplitThumb(end, splitEndCanvas);
      } catch (err) {
        if (token !== splitPreviewToken) return;
        console.warn('拆分缩略图渲染失败:', err);
        splitStartEmpty.textContent = '预览失败';
        splitEndEmpty.textContent = '预览失败';
        return;
      }
      if (token !== splitPreviewToken) return;
      splitStartCanvas.hidden = false;
      splitEndCanvas.hidden = false;
      splitStartEmpty.hidden = true;
      splitEndEmpty.hidden = true;
    };

    const scheduleSplitPreview = (delay = 140) => {
      clearTimeout(splitPreviewTimer);
      splitPreviewTimer = setTimeout(renderSplitPreview, delay);
    };

    const updateSplitRange = ({ refreshName = true, refreshPreview = true } = {}) => {
      const total = splitTotalPages();
      const start = Number(splitStart.value);
      const end = Number(splitEnd.value);
      let error = '';

      if (!total) error = '原 PDF 页数不可用，请重新打开乐谱';
      else if (!Number.isInteger(start) || start < 1 || start > total) error = `起始页必须是 1–${total} 之间的整数`;
      else if (!Number.isInteger(end) || end < 1 || end > total) error = `结束页必须是 1–${total} 之间的整数`;
      else if (start > end) error = '起始页不能大于结束页';

      splitRangeHint.textContent = error
        ? error
        : `原谱共 ${total} 页 · 将抽取第 ${start}–${end} 页，共 ${end - start + 1} 页`;
      splitRangeHint.classList.toggle('error', !!error);
      splitConfirm.disabled = !!error || splitBusy;

      if (!error && refreshName && !splitNameTouched) {
        splitName.value = splitDefaultName(start, end);
      }
      if (refreshPreview && splitModalMask.classList.contains('show')) scheduleSplitPreview();
    };

    const closeSplitPicker = () => {
      untrackLayer('split-picker');
      splitPickerMask.classList.remove('show');
    };

    const openSplitPicker = (target) => {
      const total = splitTotalPages();
      if (!total) return showToast('PDF 尚未准备好，请稍后再试');
      splitPickerTarget = target === 'end' ? 'end' : 'start';
      const input = splitPickerTarget === 'start' ? splitStart : splitEnd;
      const selected = Number(input.value);
      const current = splitCurrentPage();
      splitPickerTitle.textContent = splitPickerTarget === 'start' ? '选择起始页' : '选择结束页';
      splitPickerCurrent.textContent = `使用当前阅读页 P${current}`;
      splitPickerCurrent.dataset.page = String(current);

      splitPickerGrid.innerHTML = '';
      for (let i = 1; i <= total; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'split-page-btn';
        if (i === selected) btn.classList.add('selected');
        if (i === current) btn.classList.add('current');
        btn.dataset.page = String(i);
        btn.textContent = String(i);
        btn.setAttribute('aria-label', `第 ${i} 页`);
        splitPickerGrid.appendChild(btn);
      }
      splitPickerMask.classList.add('show');
      trackLayer('split-picker', closeSplitPicker);
      requestAnimationFrame(() => {
        const selectedBtn = splitPickerGrid.querySelector('.split-page-btn.selected');
        if (selectedBtn) selectedBtn.scrollIntoView({ block: 'center' });
      });
    };

    const applySplitPage = (page) => {
      const total = splitTotalPages();
      if (!splitPageValid(page, total)) return;
      if (splitPickerTarget === 'start') {
        splitStart.value = String(page);
        const end = Number(splitEnd.value);
        if (splitPageValid(end, total) && end < page) splitEnd.value = String(page);
      } else {
        splitEnd.value = String(page);
        const start = Number(splitStart.value);
        if (splitPageValid(start, total) && start > page) splitStart.value = String(page);
      }
      closeSplitPicker();
      updateSplitRange();
    };

    const readSplitForm = () => ({
      start: splitStart.value,
      end: splitEnd.value,
      name: splitName.value
    });

    const closeSplitModal = async (opts = {}) => {
      if (splitBusy) return;
      if (!opts.force && splitInitial && formChanged(splitInitial, readSplitForm())) {
        const ok = await confirmDiscard('放弃本次拆分？', '已修改的页码或名称不会保存。');
        if (!ok) return;
      }
      closeSplitPicker();
      clearSplitPreview();
      untrackLayer('split-modal');
      splitInitial = null;
      splitModalMask.classList.remove('show');
    };

    const openSplitModal = () => {
      if (!this.currentScoreId || !this.currentFileBlob) return showToast('还没有打开的 PDF');
      const total = splitTotalPages();
      if (!total) return showToast('PDF 尚未准备好，请稍后再试');

      const current = splitCurrentPage();
      splitBusy = false;
      splitNameTouched = false;
      splitStart.disabled = false;
      splitEnd.disabled = false;
      splitName.disabled = false;
      splitCancel.disabled = false;
      splitConfirm.disabled = false;
      splitConfirm.textContent = '建卡';
      splitStart.max = String(total);
      splitEnd.max = String(total);
      splitStart.value = String(current);
      splitEnd.value = String(current);
      splitInherit.textContent = this.currentTags.length
        ? `将沿用标签：${this.currentTags.join('，')}`
        : '新卡暂无标签，可建卡后在书架编辑';
      closeSplitPicker();
      clearSplitPreview();
      splitInitial = null;
      splitModalMask.classList.add('show');
      updateSplitRange();
      splitInitial = readSplitForm();
      trackLayer('split-modal', closeSplitModal);
      scheduleSplitPreview(0);
    };

    splitStart.oninput = () => { normalizeSplitRange('start'); updateSplitRange(); };
    splitEnd.oninput = () => { normalizeSplitRange('end'); updateSplitRange(); };
    splitName.oninput = () => { splitNameTouched = true; };
    splitPreviewStart.onclick = () => openSplitPicker('start');
    splitPreviewEnd.onclick = () => openSplitPicker('end');
    splitPickerGrid.onclick = (e) => {
      const btn = e.target.closest('.split-page-btn');
      if (!btn) return;
      applySplitPage(Number(btn.dataset.page));
    };
    splitPickerCurrent.onclick = () => applySplitPage(Number(splitPickerCurrent.dataset.page));
    splitPickerCancel.onclick = closeSplitPicker;
    bindBackdrop(splitPickerMask, closeSplitPicker);
    splitCancel.onclick = closeSplitModal;
    bindBackdrop(splitModalMask, closeSplitModal);

    splitConfirm.onclick = async () => {
      if (splitBusy) return;
      updateSplitRange({ refreshName: false });
      if (splitConfirm.disabled) return;

      const start = Number(splitStart.value);
      const end = Number(splitEnd.value);
      const name = splitName.value.trim();
      if (!name) { splitName.focus({ preventScroll: true }); return showToast('请输入新卡名称'); }

      splitBusy = true;
      splitStart.disabled = true;
      splitEnd.disabled = true;
      splitName.disabled = true;
      splitCancel.disabled = true;
      splitConfirm.disabled = true;
      splitPreviewStart.disabled = true;
      splitPreviewEnd.disabled = true;
      closeSplitPicker();
      splitConfirm.textContent = '正在建卡...';
      loading.textContent = '正在拆分 PDF...';
      loading.classList.add('show');

      let created = false;
      try {
        const result = await splitPdfPages(this.currentFileBlob, start, end, name);
        const fileName = /\.pdf$/i.test(name) ? name : `${name}.pdf`;
        const fileHash = await hashBlob(result.blob);
        await dbService.addScore(fileName, result.blob, { tags: this.currentTags.slice(), fileHash });
        created = true;
        try { await this.loadShelf(); } catch (err) { console.warn('建卡后刷新书架失败', err); }
        untrackLayer('split-modal');
        splitInitial = null;
        splitModalMask.classList.remove('show');
        clearSplitPreview();
        showToast(`已建卡：${name} · ${result.pageCount} 页（原谱保留）`);
      } catch (err) {
        console.error(err);
        if (created) {
          untrackLayer('split-modal');
          splitInitial = null;
          splitModalMask.classList.remove('show');
          clearSplitPreview();
          showToast('已建卡，但书架刷新失败');
        } else {
          const msg = /encrypt/i.test(err && err.message ? err.message : '')
            ? '该 PDF 已加密，暂不支持拆分'
            : (err && err.message ? err.message : 'PDF 拆分失败');
          await showAlert(msg, { title: '无法拆分' });
        }
      } finally {
        splitBusy = false;
        loading.classList.remove('show');
        splitStart.disabled = false;
        splitEnd.disabled = false;
        splitName.disabled = false;
        splitCancel.disabled = false;
        splitPreviewStart.disabled = false;
        splitPreviewEnd.disabled = false;
        splitConfirm.textContent = '建卡';
        updateSplitRange({ refreshName: false });
      }
    };

    btnSplit.onclick = openSplitModal;

    // 🌟 统一的进度写库入口（手动按钮 / 打卡 / 定时兜底 / 返回书架 共用）
    const saveReadingProgress = async (withToast) => {
      if (!this.currentScoreId) return false;
      const pos = getReadingPosition();
      await dbService.updateScore(this.currentScoreId, {
        lastReadPage: pos.page,
        lastReadPageRatio: pos.ratio,
        lastReadScrollY: pos.scrollY,
        lastReadAt: Date.now()
      });
      this.lastKnownPosition = pos;
      if (withToast) {
        if (this.currentFormat === SCORE_FORMAT.TEXT) showToast('已保存文本谱阅读位置');
        else showToast(pos.total > 1 ? `已保存：第 ${pos.page} 页 / 共 ${pos.total} 页` : `已保存当前阅读位置`);
      }
      return true;
    };

    // 🌟 弱自动兜底：每 5 分钟存一次（仅在阅读页可见时才写，避免隐藏时写 0）
    const stopAutoSave = () => {
      if (this.autoSaveTimer) { clearInterval(this.autoSaveTimer); this.autoSaveTimer = null; }
    };
    const startAutoSave = () => {
      stopAutoSave();
      this.autoSaveTimer = setInterval(() => {
        if (!this.currentScoreId || !viewer.offsetParent) return;
        saveReadingProgress(false).catch(err => console.warn('自动保存进度失败', err));
      }, 5 * 60 * 1000);
    };

    // 🌟 翻页热区定位：随 viewer 顶部对齐，只在谱面中线附近保留一小段可点区域
    const positionNavZones = () => {
      const hostTop = this.getBoundingClientRect().top;
      const viewerRect = viewer.getBoundingClientRect();
      const top = Math.max(0, Math.round(viewerRect.top - hostTop));
      const zoneH = 170;
      const centered = top + Math.max(0, Math.round((viewerRect.height - zoneH) / 2));
      $('navPrev').style.top = centered + 'px';
      $('navNext').style.top = centered + 'px';
    };
    window.addEventListener('resize', positionNavZones);
    this.positionNavZones = positionNavZones;

    const hideProgressBanner = () => {
      const banner = $('progressBanner');
      if (!banner) return;
      clearTimeout(this.bannerTimer);
      banner.classList.remove('show');
      this.bannerTimer = setTimeout(() => { banner.style.display = 'none'; }, 260);
    };

    const showProgressBanner = (page, savedAt, total, onJump) => {
      const banner = $('progressBanner');
      const text = $('pbText');
      if (!banner || !text) return;

      // 提示条始终落在工具栏真实高度之下，窄屏工具栏换行时也不会盖住「书签」
      const toolbar = $('readerToolbar');
      const toolbarH = toolbar ? toolbar.offsetHeight : 0;
      banner.style.top = `${toolbarH + 10}px`;

      let when = '';
      if (savedAt) {
        const d = new Date(savedAt);
        when = `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
      const pageText = (total > 1) ? `第 ${page} 页` : '的位置';
      text.textContent = when ? `上次读到${pageText} · ${when}` : `上次读到${pageText}`;
      text.onclick = () => { onJump(); hideProgressBanner(); };

      // 清掉上一次隐藏留下的定时器，避免刚显示就被关掉
      clearTimeout(this.bannerTimer);
      banner.classList.remove('show');
      banner.style.display = 'flex';
      requestAnimationFrame(() => banner.classList.add('show'));
      // 与底部“已恢复上次练习速度”提示保持一致：停留 2 秒
      this.bannerTimer = setTimeout(() => hideProgressBanner(), 2000);
    };

    $('pbClose').onclick = () => hideProgressBanner();

    // 用户自己一开始滚动就收起提示条，别挡视线
    viewer.addEventListener('scroll', () => {
      const banner = $('progressBanner');
      if (banner && banner.classList.contains('show') && viewer.scrollTop > 40) hideProgressBanner();
      scheduleTextHighlight();
    }, { passive: true });

    // ==================== 📝 文本谱渲染 ====================
    const appendInlineChords = (el, text) => {
      // [C] 和弦原样保留括号，只上色，不重排歌词，保证空格与和弦位置不变
      const parts = String(text).split(/(\[[^\]\n]{1,24}\])/g);
      parts.forEach((part) => {
        if (!part) return;
        if (/^\[[^\]\n]{1,24}\]$/.test(part)) {
          const span = document.createElement('span');
          span.className = 'chord-token';
          span.textContent = part;
          el.appendChild(span);
        } else {
          el.appendChild(document.createTextNode(part));
        }
      });
    };

    const buildTextSheet = (parsed) => {
      const sheet = document.createElement('div');
      sheet.className = 'text-sheet';

      const head = document.createElement('div');
      head.className = 'text-head';
      const title = document.createElement('h2');
      title.className = 'text-title';
      title.textContent = parsed.meta.title || '未命名文本谱';
      head.appendChild(title);

      const subBits = [];
      if (parsed.meta.artist) subBits.push(parsed.meta.artist);
      if (parsed.meta.capo) subBits.push(`Capo ${parsed.meta.capo}`);
      if (parsed.meta.key) subBits.push(`Key ${parsed.meta.key}`);
      if (subBits.length) {
        const sub = document.createElement('p');
        sub.className = 'text-sub';
        sub.textContent = subBits.join(' · ');
        head.appendChild(sub);
      }
      sheet.appendChild(head);

      const blocks = parsed.blocks.slice();
      if (blocks[0] && blocks[0].type === 'section' && blocks[0].text === parsed.meta.title) blocks.shift();

      if (!blocks.length) {
        const empty = document.createElement('div');
        empty.className = 'text-block note';
        empty.textContent = '这份文本谱没有可显示的正文。';
        sheet.appendChild(empty);
        return sheet;
      }

      blocks.forEach((block) => {
        const el = document.createElement('div');
        el.className = `text-block ${block.type}`;
        if (block.type === 'empty') {
          el.textContent = '';
          el.setAttribute('aria-hidden', 'true');
        } else if (block.type === 'divider') {
          el.textContent = '';
          el.setAttribute('aria-hidden', 'true');
        } else if (block.type === 'line') {
          appendInlineChords(el, block.text);
        } else {
          el.textContent = block.text;
        }
        sheet.appendChild(el);
      });
      return sheet;
    };

    const renderTextScore = async (fileBlob, fileName) => {
      this.currentFormat = SCORE_FORMAT.TEXT;
      this.totalPages = 1;
      container.style.padding = '0';
      container.style.width = '100%';
      const parsed = parseTextScore(await readTextBlob(fileBlob), fileName);
      const sheet = buildTextSheet(parsed);
      container.appendChild(sheet);
      container.style.setProperty('--text-scale', String(this.scale));
      requestAnimationFrame(() => {
        updateTextHighlight();
        applyScale();
      });
      return parsed;
    };

    const updateTextHighlight = () => {
      if (this.currentFormat !== SCORE_FORMAT.TEXT) return;
      const blocks = Array.from(container.querySelectorAll('.text-sheet .text-block'));
      if (!blocks.length) return;
      const viewRect = viewer.getBoundingClientRect();
      const probe = viewer.scrollTop + viewer.clientHeight * 0.46;
      let target = blocks[0];
      for (const block of blocks) {
        if (!block.offsetHeight && block.classList.contains('empty')) continue;
        const top = block.getBoundingClientRect().top - viewRect.top + viewer.scrollTop;
        if (top <= probe) target = block;
        else break;
      }
      if (!target) return;
      const current = container.querySelector('.text-sheet .text-block.current');
      if (current === target) return;
      if (current) current.classList.remove('current');
      target.classList.add('current');
    };

    const scheduleTextHighlight = () => {
      if (this.currentFormat !== SCORE_FORMAT.TEXT || this.textHighlightRaf) return;
      this.textHighlightRaf = requestAnimationFrame(() => {
        this.textHighlightRaf = null;
        updateTextHighlight();
      });
    };

    this.openScore = async (fileBlob, fileName, fileId, tags, scoreData, opts = {}) => {
      this.currentFileName = fileName.replace(/\.[^/.]+$/, ""); 
      this.currentScoreId = fileId;
      this.currentFileBlob = fileBlob;
      this.currentTags = Array.isArray(tags) ? tags.slice() : [];
      this.closingReader = false;
      const format = detectScoreFormat(fileName, fileBlob && fileBlob.type, scoreData && scoreData.format);
      const isPdf = format === SCORE_FORMAT.PDF;
      const isText = format === SCORE_FORMAT.TEXT;
      this.currentFormat = format;
      if (!format) { showToast('不支持的文件格式'); return; }
      btnSplit.style.display = isPdf ? 'flex' : 'none';
      untrackLayer('split-modal');
      untrackLayer('split-picker');
      untrackLayer('bookmarks');
      $('splitModalMask').classList.remove('show');

      // 🔖 载入这份谱已有的书签（存于乐谱记录里，随备份 / 云同步一起走）
      this.bookmarks = (!isText && scoreData && Array.isArray(scoreData.bookmarks))
        ? scoreData.bookmarks
            .filter(b => b && Number(b.page) > 0)
            .map(b => ({ page: Number(b.page), at: Number(b.at) || 0 }))
        : [];
      if (typeof updateBookmarkBadge === 'function') updateBookmarkBadge();
      $('bookmarkMask').classList.remove('show');
      
      shelfView.style.display = 'none';
      filterBar.style.display = 'none';
      this.classList.add('reading');
      trackLayer('reader', () => this.closeReader(), { blocksNavigation: false });
      
      btnBack.style.display = 'flex'; btnLog.style.display = 'flex'; viewer.style.display = 'block'; miniMetronome.style.display = 'flex'; 
      $('btnSavePos').style.display = 'flex';
      $('btnBookmarks').style.display = isText ? 'none' : 'flex';
      $('navPrev').classList.add('show'); $('navNext').classList.add('show');
      
      if (miniMetronome.classList.contains('advanced')) miniMetronome.classList.remove('advanced');
      miniMetronome.classList.remove('faded'); // 刚打开文件时保持实体化
      zoomControls.classList.remove('faded');
      clearTimeout(this.mmAutoCollapseTimer);

      if (this.currentObjectUrl) URL.revokeObjectURL(this.currentObjectUrl);
      if (this.destroyPdf) this.destroyPdf();
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      container.innerHTML = ''; this.scale = 1; applyScale();
      viewer.scrollTop = 0; viewer.scrollLeft = 0;
      
      this.totalPages = 0;
      this.lastKnownPosition = null;
      hideProgressBanner();

      // 🌟 关键修复：向数据库要「最新」记录，不要用书架里的旧快照
      let fresh = null;
      try { fresh = await dbService.getScore(fileId); } catch (e) { console.warn('读取乐谱记录失败', e); }
      if (!fresh && scoreData) fresh = scoreData;

      try {
        const lastLog = await dbService.getLatestLogByName(this.currentFileName);
        if (lastLog && lastLog.bpm) { updateMmBpm(lastLog.bpm, true); showToast(`已恢复上次练习速度：${this.mmBpm} BPM`); }
      } catch(e) { console.error(e); }

      // 🌟 统一渲染：PDF 与图片共用同一个滚动容器，父级才能拿到真实 scrollTop
      zoomControls.style.display = 'flex';
      container.style.padding = '20px 0'; container.style.height = ''; container.style.position = 'static';

      if (isPdf) {
        try { await renderPDFLazy(fileBlob); } catch (err) { await showAlert(err.message, { title: '无法打开乐谱' }); }
      } else if (isText) {
        try { await renderTextScore(fileBlob, fileName); } catch (err) { await showAlert(err.message, { title: '无法打开文本谱' }); }
      } else {
        this.currentObjectUrl = URL.createObjectURL(fileBlob);
        const img = document.createElement('img'); img.src = this.currentObjectUrl; img.draggable = false;
        container.appendChild(img);
        this.totalPages = 1;
        // 图片必须解码完才有真实高度，否则算出来的恢复位置恒为 0
        await new Promise((resolve) => {
          if (img.complete && img.naturalHeight) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      }

      // 🌟 恢复阅读进度：按「页码 + 页内比例」，换缩放/换屏宽都不会偏
      const savedPage = fresh ? (fresh.lastReadPage || 0) : 0;
      const savedRatio = fresh ? (fresh.lastReadPageRatio || 0) : 0;
      const savedScrollY = fresh ? (fresh.lastReadScrollY || 0) : 0;
      const savedAt = fresh ? (fresh.lastReadAt || 0) : 0;

      if (savedPage > 0) {
        if (opts.autoRestore) {
          // 翻页切换（上一本/下一本）：直接回到上次位置，不再弹提示条
          scrollToPage(savedPage, savedRatio);
        } else {
          showProgressBanner(savedPage, savedAt, this.totalPages, () => scrollToPage(savedPage, savedRatio));
        }
      } else if (savedScrollY > 0) {
        // 兼容旧数据：只有像素值，没有页码
        if (opts.autoRestore) {
          viewer.scrollTo({ top: savedScrollY, behavior: 'smooth' });
        } else {
          showProgressBanner(1, savedAt, this.totalPages, () => {
            viewer.scrollTo({ top: savedScrollY, behavior: 'smooth' });
          });
        }
      }

      // 🌟 阅读模式收尾：热区对齐 + 启动 5 分钟兜底自动保存
      if (isText) requestAnimationFrame(scheduleTextHighlight);
      positionNavZones();
      startAutoSave();
      // 读谱期间保持屏幕常亮，直到返回书架 / 切走读谱页
      wakeLock.acquire('reader');
    };

    const closeReader = async () => {
      if (!this.classList.contains('reading') || this.closingReader) return;
      this.closingReader = true;
      // 🌟 弱自动兜底之一：返回书架时强制保存一次，防止意外退出丢位置
      if (this.currentScoreId) {
        try { await saveReadingProgress(false); } catch (e) { console.warn('返回时保存进度失败', e); }
      }
      stopAutoSave();
      wakeLock.release('reader');
      hideProgressBanner();
      this.lastKnownPosition = null;

      if (this.setZenLock) this.setZenLock(false);
      if (this.textHighlightRaf) { cancelAnimationFrame(this.textHighlightRaf); this.textHighlightRaf = null; }
      this.currentFormat = '';
      container.style.removeProperty('--text-scale');

      $('btnSavePos').style.display = 'none';
      $('btnBookmarks').style.display = 'none';
      $('btnSplit').style.display = 'none';
      $('splitModalMask').classList.remove('show');
      $('bookmarkMask').classList.remove('show');
      $('navPrev').classList.remove('show'); $('navNext').classList.remove('show');

      viewer.style.display = 'none'; zoomControls.style.display = 'none'; btnLog.style.display = 'none'; miniMetronome.style.display = 'none';
      if (this.setReaderFullscreen) this.setReaderFullscreen(false);
      if (this.stopMiniMetronome) this.stopMiniMetronome();
      if (miniMetronome.classList.contains('advanced')) miniMetronome.classList.remove('advanced');
      miniMetronome.classList.remove('faded');
      zoomControls.classList.remove('faded');
      clearTimeout(this.mmAutoCollapseTimer);

      btnBack.style.display = 'none'; shelfView.style.display = 'grid'; filterBar.style.display = 'flex';
      this.classList.remove('reading');
      if (this.observer) this.observer.disconnect();
      if (this.destroyPdf) this.destroyPdf();
      this.currentFileBlob = null;
      this.currentTags = [];
      untrackLayer('split-modal');
      untrackLayer('split-picker');
      untrackLayer('bookmarks');
      untrackLayer('reader');
      this.closingReader = false;
    };
    this.closeReader = closeReader;
    btnBack.onclick = () => closeReader();

    let logInitial = null;
    const readLogForm = () => ({
      name: $('logName').value,
      time: $('logTime').value,
      bpm: $('logBpm').value,
      saveProgress: $('logSaveProgress').checked ? '1' : '0'
    });
    const closeLogModal = async (opts = {}) => {
      if (!logModalMask.classList.contains('show')) return;
      if (!opts.force && logInitial && formChanged(logInitial, readLogForm())) {
        const ok = await confirmDiscard('放弃本次记录？', '已填写的练习内容不会保存。');
        if (!ok) return;
      }
      untrackLayer('log-modal');
      logInitial = null;
      logModalMask.classList.remove('show');
    };
    $('logCancel').onclick = closeLogModal;
    bindBackdrop(logModalMask, closeLogModal);

    // 🌟 手动档：一键存进度（与「打卡」互补——只想存位置时不用编练习时长）
    $('btnSavePos').onclick = async () => {
      if (!this.currentScoreId) return showToast('还没有打开的谱子');
      const btn = $('btnSavePos');
      btn.disabled = true;
      try { await saveReadingProgress(true); }
      catch (err) { console.error(err); showToast('保存进度失败，请重试'); }
      finally { btn.disabled = false; }
    };

    btnLog.onclick = () => {
      $('logName').value = this.currentFileName; $('logBpm').value = this.mmBpm; $('logTime').value = '';
      // 🌟 打开弹窗时快照当前阅读位置并展示出来
      const pos = getReadingPosition();
      $('logProgressText').textContent = this.currentFormat === SCORE_FORMAT.TEXT
        ? (pos.ratio > 0 ? `文本谱 · 约 ${Math.round(pos.ratio * 100)}%` : '文本谱 · 开头')
        : ((pos.total > 1) ? `第 ${pos.page} 页 / 共 ${pos.total} 页` : '第 1 页');
      logInitial = readLogForm();
      logModalMask.classList.add('show');
      trackLayer('log-modal', closeLogModal);
    };
    $('logConfirm').onclick = async () => {
      const name = $('logName').value.trim(), time = $('logTime').value.trim(), bpm = $('logBpm').value.trim();
      const saveProgress = $('logSaveProgress').checked;
      const hasTime = !!time && !isNaN(time) && Number(time) > 0;

      if (!name) return showToast('请输入练习内容');
      if (!hasTime && !saveProgress) return showToast('请输入练习时长，或勾选保存阅读进度');

      const pos = getReadingPosition();
      const confirmBtn = $('logConfirm');
      confirmBtn.disabled = true;

      try {
        // 1) 先写进度（用户勾选时才写）—— 与手动按钮共用同一入口
        if (saveProgress) {
          if (!this.currentScoreId) return showToast('还没有打开的谱子，无法保存进度');
          await saveReadingProgress(false);
        }

        // 2) 再写练习日志（填了合法时长才写），带上阅读位置，便于回溯
        if (hasTime) {
          await dbService.addLog({
            name: name,
            minutes: parseInt(time, 10),
            bpm: bpm ? parseInt(bpm, 10) : null,
            scoreId: this.currentScoreId,
            page: pos.page,
            pageRatio: pos.ratio,
            totalPages: pos.total
          });
          window.dispatchEvent(new CustomEvent('log-updated'));
        }

        untrackLayer('log-modal');
        logInitial = null;
        logModalMask.classList.remove('show');
        if (hasTime && saveProgress) showToast(`打卡完成，已记到第 ${pos.page} 页`);
        else if (hasTime) showToast('打卡成功！');
        else showToast(`已记录阅读进度：第 ${pos.page} 页`);
      } catch (err) {
        console.error('保存失败', err);
        showToast('保存失败，请重试');
      } finally {
        confirmBtn.disabled = false;
      }
    };

    $('editConfirm').onclick = async () => {
      const state = this.editModalState;
      if (!state) return;
      const newName = $('editName').value.trim();
      if (!newName) return showToast('名称不能为空');
      const newTags = uniqueTags(state.draft || []);
      await dbService.updateScore(state.scoreId, { name: newName, tags: newTags });
      untrackLayer('edit-modal');
      this.editModalState = null;
      editInitial = null;
      showToast('修改成功');
      editModalMask.classList.remove('show');
      this.loadShelf();
    };

    $('editDeleteBtn').onclick = async () => {
      const state = this.editModalState;
      if (!state) return;
      const score = this.allScores.find(s => s.id === state.scoreId);
      if (!score) return;
      const deleted = await confirmDeleteScore(score);
      if (deleted) {
        untrackLayer('edit-modal');
        this.editModalState = null;
        editInitial = null;
        editModalMask.classList.remove('show');
        showToast('已删除');
        this.loadShelf();
      }
    };

    editTags.oninput = () => {
      const state = this.editModalState;
      if (!state) return;
      state.draft = uniqueTags(parseTagInput(editTags.value));
      renderEditQuick();
    };

    $('editCancel').onclick = closeEditModal;
    bindBackdrop(editModalMask, closeEditModal);
    $('cloudCancel').onclick = closeCloudModal;
    bindBackdrop(cloudModalMask, closeCloudModal);

    // 🌟 核心修复：极其宽容的文件过滤逻辑
    const handleFiles = async (filesArray, { extraNotice = '' } = {}) => {
      if (!filesArray || filesArray.length === 0) return;
      loading.textContent = `正在导入 ${filesArray.length} 个文件...`; loading.classList.add('show');
      
      let addedCount = 0;
      let dupCount = 0;
      let failCount = 0;
      
      try {
        const existingScores = await dbService.getAllScores();
        for (const file of filesArray) {
          const format = detectScoreFormat(file.name, file.type);
          if (format) {
            let fileHash = '';
            try {
              loading.textContent = `正在校验 ${file.name}...`;
              fileHash = await hashBlob(file);
            } catch (hashErr) {
              // 哈希失败不阻断导入，退回名称 + 大小判重
              console.warn('[导入] 计算文件哈希失败:', file.name, hashErr.message);
            }

            const duplicate = await findDuplicateScore(existingScores, file, fileHash);
            if (duplicate) {
              dupCount++;
              continue;
            }
            
            try {
              const id = await dbService.addScore(file.name, file, { fileHash, format });
              existingScores.push({ id, name: file.name, fileBlob: file, fileHash, format });
              addedCount++;
            } catch (err) {
              console.error('保存文件失败:', file.name, err);
              failCount++;
            }
          } else {
            failCount++;
          }
        }
        
        let msg = `导入完成: 成功 ${addedCount} 本`;
        if (dupCount > 0) msg += `, 跳过重复 ${dupCount} 本`;
        if (failCount > 0) msg += `, 失败/不支持 ${failCount} 本`;
        
        if (addedCount > 0 || dupCount > 0) {
          showToast(msg + extraNotice);
        } else {
          showToast('没有找到支持的格式或全部导入失败' + extraNotice);
        }
        
        this.loadShelf();
      } catch (err) {
        console.error(err);
        showToast(`导入出错：${err.message}`);
      } finally {
        loading.classList.remove('show'); 
      }
    };

    // 🌟 核心修复：先将 FileList 转为真正的 Array 拷贝，然后再清空 input 的值，防止异步操作中文件被浏览器销毁！
    const handleInputChange = (e) => {
      const input = e.target;
      const files = Array.from(input.files);
      input.value = ''; 
      closeActionSheet();
      if (input.id === 'inputGallery') {
        const { files: limited, truncated } = takeGalleryFiles(files);
        handleFiles(limited, {
          extraNotice: truncated ? '，一次最多 20 张，已取前 20 张' : ''
        });
        return;
      }
      handleFiles(files); 
    };

    $('inputSingleFile').onchange = handleInputChange;
    $('inputFolder').onchange = handleInputChange;
    $('inputCamera').onchange = handleInputChange;
    $('inputGallery').onchange = handleInputChange;
    $('inputMobileFile').onchange = handleInputChange;
    
    btnImportMain.onclick = () => {
      if (this.isMobile) {
        actionSheetMask.classList.add('show');
        trackLayer('import-sheet', closeActionSheet);
      } else {
        $('inputSingleFile').click();
      }
    };
    $('btnFolderMain').onclick = () => $('inputFolder').click();
    $('btnCancel').onclick = closeActionSheet;
    $('btnCamera').onclick = () => {
      closeActionSheet();
      $('inputCamera').click();
    };
    $('btnMobileFile').onclick = () => {
      closeActionSheet();
      $('inputMobileFile').click();
    };
    $('btnGallery').onclick = async () => {
      closeActionSheet();

      if (!isNativeGalleryAvailable()) {
        $('inputGallery').click();
        return;
      }

      try {
        const result = await pickGalleryImages({
          limit: 20,
          onPicked: () => {
            loading.textContent = '正在读取照片...';
            loading.classList.add('show');
          }
        });

        const notices = [];
        if (result.failed > 0) notices.push(`${result.failed} 张读取失败`);
        if (result.truncated > 0) notices.push(`已取前 20 张`);
        await handleFiles(result.files, {
          extraNotice: notices.length ? `，${notices.join('，')}` : ''
        });
      } catch (err) {
        if (err && err.code === 'PICK_CANCELLED') return;
        if (err && err.code === 'PICK_UNAVAILABLE') {
          loading.classList.remove('show');
          $('inputGallery').click();
          return;
        }
        console.error('[相册导入]', err);
        showToast(`相册导入失败：${err && err.message ? err.message : '请重试'}`);
      } finally {
        loading.classList.remove('show');
      }
    };
    bindBackdrop(actionSheetMask, closeActionSheet);

    // 🌟 打包：本地导出与云端上传共用同一份数据（含阅读进度与打卡记录）
    const buildBackupPayload = async ({ showLoading = true } = {}) => {
      const scores = await dbService.getAllScores();
      const logs = await dbService.getAllLogs();
      if (scores.length === 0 && logs.length === 0) { showToast('没有可备份的数据'); return null; }
      if (showLoading) { loading.textContent = '正在打包...'; loading.classList.add('show'); }
      try {
        const exportScores = [];
        for (const item of scores) {
          const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(item.fileBlob);
          });
          exportScores.push({
            name: item.name, createdAt: item.createdAt, data: base64Data, tags: item.tags || [],
            updatedAt: item.updatedAt || 0,
            lastReadPage: item.lastReadPage || 0,
            lastReadPageRatio: item.lastReadPageRatio || 0,
            lastReadScrollY: item.lastReadScrollY || 0,
            lastReadAt: item.lastReadAt || 0,
            bookmarks: Array.isArray(item.bookmarks) ? item.bookmarks : [],
            fileHash: item.fileHash || ''
          });
        }
        return { version: APP_VERSION, schema: BACKUP_SCHEMA, exportedAt: Date.now(), scores: exportScores, logs: logs };
      } finally { if (showLoading) loading.classList.remove('show'); }
    };

    // 🌟 恢复：先完整校验并转好 Blob，再清空写入，保证「要么全成功，要么不动本地」
    const restoreFromPayload = async (payload, confirmOverwrite = true, confirmEmpty = true) => {
      if (!payload || !Array.isArray(payload.scores)) throw new Error('备份文件格式不正确');
      if (payload.logs && !Array.isArray(payload.logs)) throw new Error('备份文件的打卡记录格式不正确');
      const badScore = payload.scores.find((item) => !item || typeof item.name !== 'string' || typeof item.data !== 'string' || !item.data.startsWith('data:'));
      if (badScore) throw new Error('备份中存在无效的乐谱数据');

      // 🌟 空备份保护：云端失联时可能拿到空载荷，绝不能用一句普通 confirm 就把本地清空
      const scoreCount = payload.scores.length;
      const logCount = (payload.logs || []).length;
      if (scoreCount === 0 && logCount === 0 && confirmEmpty) {
        const localScores = await dbService.getAllScores();
        const localLogs = await dbService.getAllLogs();
        const ok = await showConfirm({
          title: '备份是空的',
          message: '继续会把本地乐谱和练习记录清空，且无法撤销。',
          details: [
            { label: '备份', value: '0 份乐谱 / 0 条记录' },
            { label: '本地', value: `${localScores.length} 份乐谱 / ${localLogs.length} 条记录` }
          ],
          confirmText: '仍然恢复',
          danger: true
        });
        if (!ok) { showToast('已取消：空备份未写入'); return false; }
      } else if (confirmOverwrite) {
        const ok = await showConfirm({
          title: '覆盖本地数据',
          message: '备份会替换本机现有的乐谱与练习记录。',
          details: [
            { label: '备份', value: `${scoreCount} 份乐谱 / ${logCount} 条记录` },
            {
              label: '备份时间',
              value: payload.exportedAt ? new Date(payload.exportedAt).toLocaleString('zh-CN', { hour12: false }) : '未知'
            }
          ],
          confirmText: '覆盖',
          danger: true
        });
        if (!ok) return false;
      }

      loading.textContent = '正在恢复...'; loading.classList.add('show');
      try {
        const scoreRecords = [];
        for (const item of payload.scores) {
          if (!item || !item.data) throw new Error('备份中存在无效的乐谱数据');
          const blob = await (await fetch(item.data)).blob();
          scoreRecords.push({
            name: item.name, fileBlob: blob, createdAt: item.createdAt || Date.now(),
            updatedAt: item.updatedAt || item.createdAt || Date.now(),
            tags: item.tags || [], fileHash: item.fileHash || '',
            lastReadPage: item.lastReadPage || 0,
            lastReadPageRatio: item.lastReadPageRatio || 0,
            lastReadScrollY: item.lastReadScrollY || 0,
            lastReadAt: item.lastReadAt || 0,
            bookmarks: Array.isArray(item.bookmarks) ? item.bookmarks : []
          });
        }
        await dbService.clearAllData();
        await dbService.bulkImport(scoreRecords, payload.logs || []);
        this.loadShelf();
        window.dispatchEvent(new CustomEvent('log-updated'));
        showToast('恢复完成');
        return true;
      } finally { loading.classList.remove('show'); }
    };

    // 本地备份 / 恢复 / 清空已统一收进全局设置抽屉；这里只保留云同步所需的数据打包与恢复。
    // ==================== ☁️ 云同步（坚果云 WebDAV） ====================
    const REMEMBER_KEY = 'gs_cloud_remember';
    const PASS_SECRET = 'webdav-pass';

    const readCloudForm = () => {
      const user = $('cloudUser').value.trim();
      const pass = $('cloudPass').value;
      const path = $('cloudPath').value.trim() || 'GuitarShell/backup.json';
      const base = $('cloudBase').value.trim();
      if (!user || !pass) { showToast('请填写账号与应用密码'); return null; }
      localStorage.setItem('gs_cloud_user', user);
      localStorage.setItem('gs_cloud_path', path);
      // 自定义通道：留空即清掉，回到自动选择
      if (base) localStorage.setItem('gs_dav_base', base);
      else localStorage.removeItem('gs_dav_base');

      // 记住密码：只存密文，明文不进 localStorage；取消勾选即删除
      const remember = !!$('cloudRemember').checked;
      localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
      if (remember) vaultService.save(PASS_SECRET, pass).catch(err => console.warn('[云同步] 保存密码失败:', err.message));
      else vaultService.clear(PASS_SECRET).catch(() => {});

      return { user, pass, path };
    };

    const openCloudModal = () => {
      $('cloudUser').value = localStorage.getItem('gs_cloud_user') || '';
      $('cloudPath').value = localStorage.getItem('gs_cloud_path') || 'GuitarShell/backup.json';
      $('cloudBase').value = localStorage.getItem('gs_dav_base') || '';
      $('cloudPass').value = '';

      const supported = vaultService.isSupported();
      $('cloudRemember').checked = supported && localStorage.getItem(REMEMBER_KEY) === '1';
      $('cloudRememberRow').style.display = supported ? '' : 'none';
      $('cloudRememberHint').textContent = supported
        ? '密码以 AES-GCM 加密存进本机 IndexedDB，密钥不可导出，也不会写进备份文件；换设备需重新填。'
        : '当前页面不是 HTTPS / localhost，浏览器不提供加密能力，只能每次手填。';

      if (supported && $('cloudRemember').checked) {
        // 异步回填：用户已经动手打字就别覆盖他输的内容
        vaultService.load(PASS_SECRET).then((saved) => {
          if (saved && !$('cloudPass').value) $('cloudPass').value = saved;
        }).catch(() => {});
      }
      cloudModalMask.classList.add('show');
      trackLayer('cloud-modal', closeCloudModal);
      cloudModalMask.scrollTop = 0;
      refreshCloudStatus();
    };
    this.handleOpenCloudSync = () => openCloudModal();
    window.addEventListener('open-cloud-sync', this.handleOpenCloudSync);

    // Android WebView 键盘弹出后会把视口压短：输入框获得焦点时把它滚进可视区，
    // 避免云同步账号 / 密码栏被键盘顶出弹窗。
    ['cloudUser', 'cloudPass', 'cloudPath', 'cloudBase'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('focus', () => {
        setTimeout(() => {
          try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) {}
        }, 120);
      });
    });

    $('cloudForget').onclick = async () => {
      await vaultService.clear(PASS_SECRET);
      localStorage.setItem(REMEMBER_KEY, '0');
      $('cloudRemember').checked = false;
      $('cloudPass').value = '';
      showToast('已清除本机保存的应用密码');
    };

    // ==================== 🌟 A2 冲突检测 ====================
    // 同步点读写统一走 sync-state.js，读谱页弹窗与全局设置共用同一份状态

    // 打开弹窗 / 切换路径 / 同步成功后刷新本机状态摘要
    const refreshCloudStatus = async () => {
      const el = $('cloudSyncState');
      if (!el) return;
      el.style.color = 'var(--muted)';
      if (this.cloudFailure) {
        el.textContent = this.cloudFailure;
        el.style.color = 'var(--danger-text)';
        return;
      }
      if (cloudTask.classList.contains('show')) {
        el.textContent = cloudTaskText.textContent;
        el.style.color = 'var(--accent-text)';
        return;
      }
      el.textContent = '正在读取同步状态…';
      const path = $('cloudPath').value.trim() || 'GuitarShell/backup.json';
      try {
        const summary = await getCloudSyncSummary(path);
        el.textContent = describeCloudSync(summary);
      } catch (err) {
        console.warn('[云同步] 刷新状态失败:', err.message);
        el.textContent = '同步状态读取失败 · 仍可手动上传 / 下载';
      }
    };
    const cloudPathInput = $('cloudPath');
    if (cloudPathInput) cloudPathInput.addEventListener('change', refreshCloudStatus);

    // 云端在本机上次同步后是否被改过：优先比 etag（不受两机时钟差影响），缺失再退化到时间戳
    const cloudChangeState = (remote, path) => {
      const state = readSyncState(path);
      if (!state.at && !state.etag) return 'first';
      if (state.etag && remote.etag) return remote.etag !== state.etag ? 'changed' : 'same';
      if (state.at && remote.lastModified) return remote.lastModified > state.at ? 'changed' : 'same';
      return 'unknown';
    };

    // 同步成功后更新同步点；etag 必须重新读一次（PUT 之后云端 etag 已变）
    const markSynced = async (form) => {
      writeSyncState(form.path, { at: Date.now() });
      try {
        const remote = await webdavService.stat(form.user, form.pass, form.path);
        if (remote && remote.etag) writeSyncState(form.path, { etag: remote.etag });
      } catch (err) {
        console.warn('[云同步] 同步后读取云端状态失败:', err.message);
      }
    };

    $('cloudUpload').onclick = async () => {
      if (this.cloudBusy) return;
      const form = readCloudForm(); if (!form) return;
      closeCloudModal();
      webdavService.beginTask();
      try {
        setCloudBusy('正在检查云端状态...');
        // 老代理可能不放开 PROPFIND，读不到就当「未知」继续，不因检查失败挡住同步
        const remote = await webdavService.stat(form.user, form.pass, form.path).catch((err) => {
          if (isCloudCancel(err)) throw err;
          console.warn('[云同步] 读取云端状态失败:', err.message);
          return null;
        });

        if (remote && remote.exists === true) {
          const state = cloudChangeState(remote, form.path);
          const when = remote.lastModified ? fmtTime(remote.lastModified) : '时间未知';
          if (state === 'changed') {
            setCloudBusy(null);
            const ok = await showConfirm({
              title: '云端备份已被改动',
              message: '云端自本机上次同步后又被改过，可能来自另一台设备。继续上传会用本机数据覆盖它。',
              details: [
                { label: '云端备份时间', value: when },
                { label: '本次操作', value: '用本机数据覆盖云端' }
              ],
              confirmText: '继续上传',
              danger: true
            });
            if (!ok) { showToast('已取消上传'); return; }
          } else if (state === 'first') {
            setCloudBusy(null);
            const ok = await showConfirm({
              title: '覆盖云端备份',
              message: '云端已有一份备份，而本机从未同步过。继续上传会覆盖云端数据。',
              details: [
                { label: '云端备份时间', value: when },
                { label: '本次操作', value: '用本机数据覆盖云端' }
              ],
              confirmText: '继续上传',
              danger: true
            });
            if (!ok) { showToast('已取消上传'); return; }
          }
        }

        setCloudBusy('正在打包备份...');
        const payload = await buildBackupPayload({ showLoading: false });
        if (!payload) return;
        if (webdavService.isCancelled()) throw Object.assign(new Error('已取消云同步任务'), { code: 'CLOUD_CANCELLED' });
        setCloudBusy('正在上传到云端...');
        await webdavService.upload(form.user, form.pass, form.path, JSON.stringify(payload));
        await markSynced(form);
        await refreshCloudStatus();
        showToast(`已上传到云端 · ${webdavService.getEndpointLabel()}`);
      } catch (err) {
        if (isCloudCancel(err)) {
          showToast('已取消云同步任务');
          return;
        }
        console.error(err);
        showToast('上传失败，可点状态条重试');
        setCloudFailure(`上传失败：${err.message}`, () => $('cloudUpload').onclick());
      } finally {
        webdavService.endTask();
        if (!this.cloudFailure) setCloudBusy(null);
      }
    };

    $('cloudDownload').onclick = async () => {
      if (this.cloudBusy) return;
      const form = readCloudForm(); if (!form) return;
      closeCloudModal();
      webdavService.beginTask();
      try {
        setCloudBusy('正在检查云端状态...');
        const remote = await webdavService.stat(form.user, form.pass, form.path).catch((err) => {
          if (isCloudCancel(err)) throw err;
          console.warn('[云同步] 读取云端状态失败:', err.message);
          return null;
        });
        // 正式文件可能在上次上传中断后缺失，但 .uploading 临时文件是完整的；
        // 不在 stat 阶段拦截，交给 download 回退读取临时文件。
        setCloudBusy('正在下载云端备份...');
        const text = await webdavService.download(form.user, form.pass, form.path);
        const payload = JSON.parse(text);
        if (!payload || !Array.isArray(payload.scores)) throw new Error('云端备份格式不正确');
        if (payload.logs && !Array.isArray(payload.logs)) throw new Error('云端备份的练习记录格式不正确');

        const local = await dbService.getLocalChangeStamp();
        const syncedAt = Number(readSyncState(form.path).at) || 0;
        const cloudLogs = payload.logs || [];
        const backupTime = payload.exportedAt
          ? fmtTime(payload.exportedAt)
          : (remote && remote.lastModified ? fmtTime(remote.lastModified) : '时间未知');

        // 下载已完成，先把「本地 vs 云端」摆给用户看，再决定是否覆盖
        const localTouched = syncedAt && local.at > syncedAt;
        const neverSyncedWithData = !syncedAt && (local.scoreCount || local.logCount);
        const emptyBackup = payload.scores.length === 0 && cloudLogs.length === 0;
        let message = '用云端备份覆盖本机数据？';
        if (emptyBackup) {
          message = '云端备份是空的，继续会清空本机乐谱和练习记录，且无法撤销。';
        } else if (localTouched) {
          message = `本机自上次同步后又有改动（${fmtTime(local.at)}，含阅读进度），覆盖会丢失这些改动。`;
        } else if (neverSyncedWithData) {
          message = '本机已有数据但还没有同步记录，覆盖会清空本机现有内容。';
        }

        setCloudBusy(null);
        const ok = await showConfirm({
          title: emptyBackup ? '云端备份是空的' : '用云端备份覆盖本地',
          message,
          details: [
            { label: '本地', value: `${local.scoreCount || 0} 份乐谱 / ${local.logCount || 0} 条记录` },
            { label: '云端', value: `${payload.scores.length} 份乐谱 / ${cloudLogs.length} 条记录` },
            { label: '云端备份时间', value: backupTime }
          ],
          extra: {
            label: '先导出本地备份',
            onClick: async () => {
              try {
                const backup = await buildBackupPayload({ showLoading: false });
                if (!backup) return;
                const saved = await saveBackupFile(backup);
                showToast(saved.native ? `本地备份已保存到 ${saved.path}` : `本地备份已导出到${saved.path}`);
              } catch (err) {
                console.error('[云同步] 导出本地备份失败:', err);
                showToast(`导出失败：${err.message}`);
              }
            }
          },
          confirmText: '覆盖本地',
          danger: true
        });
        if (!ok) { showToast('已取消覆盖本地'); return; }

        // 覆盖确认已在上面完成，空备份也在同一弹窗提示过；这里只做写入
        const restored = await restoreFromPayload(payload, false, false);
        if (restored === false) return;
        await markSynced(form);
        await refreshCloudStatus();
        showToast(`已用云端备份覆盖本地 · ${webdavService.getEndpointLabel()}`);
      } catch (err) {
        if (isCloudCancel(err)) {
          showToast('已取消云同步任务');
          return;
        }
        console.error(err);
        showToast('下载失败，可点状态条重试');
        setCloudFailure(`下载失败：${err.message}`, () => $('cloudDownload').onclick());
      } finally {
        webdavService.endTask();
        if (!this.cloudFailure) setCloudBusy(null);
      }
    };

    // 🌟 连通性探测：国内访问 Worker 偶发失联，上传前先试一手，别把备份扔进断网
    $('cloudTest').onclick = async () => {
      if (this.cloudBusy) return;
      const form = readCloudForm(); if (!form) return;
      const btn = $('cloudTest');
      webdavService.beginTask();
      setCloudBusy('正在测试连接...');
      btn.textContent = '测试中...';
      try {
        const r = await webdavService.probe(form.user, form.pass, form.path);
        if (r.exists === null) showToast(`端点可达 · ${r.endpoint}`);
        else if (r.exists) showToast(`连接正常 · ${r.endpoint} · 云端已有备份`);
        else showToast(`连接正常 · ${r.endpoint} · 云端暂无该文件`);
      } catch (err) {
        if (isCloudCancel(err)) {
          showToast('已取消云同步任务');
          return;
        }
        console.error(err);
        showToast('连接失败，可点状态条重试');
        setCloudFailure(`连接失败：${err.message}`, () => $('cloudTest').onclick());
      } finally {
        webdavService.endTask();
        if (!this.cloudFailure) setCloudBusy(null);
        btn.textContent = '测试连接';
      }
    };

    // 🌟 沉浸式虚化状态机：谱面交互 → 虚化；鼠标移入控件 → 实体化（无自动恢复定时器）
    const setMmFaded = (faded) => {
      if (faded) miniMetronome.classList.add('faded');
      else miniMetronome.classList.remove('faded');
    };
    const setZoomFaded = (faded) => {
      if (faded) zoomControls.classList.add('faded');
      else zoomControls.classList.remove('faded');
    };
    const fadeReaderChrome = () => {
      if (!miniMetronome.classList.contains('faded')) setMmFaded(true);
      if (!zoomControls.classList.contains('faded')) setZoomFaded(true);
    };

    // 🧘 禅定模式：透明阅读锁；轻点浮出解锁条，连续长按 1.5 秒解锁
    const ZEN_HOLD_MS = 1500;
    const revealZenControls = () => {
      if (!this.zenLocked) return;
      zenLock.classList.add('revealed');
      zenPanel.setAttribute('aria-hidden', 'false');
    };
    const hideZenControls = () => {
      zenLock.classList.remove('revealed');
      zenPanel.setAttribute('aria-hidden', 'true');
    };
    const cancelZenHold = () => {
      clearTimeout(this.zenHoldTimer);
      this.zenHoldTimer = null;
      this.zenHoldSource = '';
      zenUnlock.classList.remove('holding');
    };
    const startZenHold = (source, showProgress) => {
      if (!this.zenLocked) return;
      clearTimeout(this.zenHoldTimer);
      this.zenHoldSource = source;
      if (showProgress) {
        zenUnlock.classList.remove('holding');
        // 强制重排，保证每次按下进度条都从 0 开始
        void zenUnlock.offsetWidth;
        zenUnlock.classList.add('holding');
      }
      this.zenHoldTimer = setTimeout(() => {
        if (!this.zenLocked) return;
        this.setZenLock(false);
        showToast('已解锁');
      }, ZEN_HOLD_MS);
    };

    this.setZenLock = (on) => {
      const next = !!on;
      if (this.zenLocked === next) return;
      this.zenLocked = next;
      cancelZenHold();
      hideZenControls();
      this.classList.toggle('zen-active', next);
      zenLock.classList.toggle('show', next);
      if (next) {
        trackLayer('zen-lock', () => {}, { blocksNavigation: true });
        wakeLock.acquire('reader');
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      } else {
        untrackLayer('zen-lock');
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      }
    };

    btnZenLock.onclick = (e) => {
      e.stopPropagation();
      this.setZenLock(true);
    };

    // 轻点谱面才浮出解锁条；拖动 / 双指缩放不触发
    viewer.addEventListener('pointerdown', (e) => {
      if (!this.zenLocked) { this.zenTapStart = null; return; }
      if (!e.isPrimary || zenPanel.contains(e.target)) { this.zenTapStart = null; return; }
      this.zenTapStart = { x: e.clientX, y: e.clientY, at: Date.now() };
    }, { passive: true });
    viewer.addEventListener('pointerup', (e) => {
      if (!this.zenLocked) return;
      const tap = this.zenTapStart;
      this.zenTapStart = null;
      if (!tap || !e.isPrimary || zenPanel.contains(e.target)) return;
      if (Date.now() - tap.at > 650) return;
      if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) return;
      revealZenControls();
    }, { passive: true });
    viewer.addEventListener('pointercancel', () => { this.zenTapStart = null; }, { passive: true });

    zenUnlock.addEventListener('pointerdown', (e) => {
      if (!this.zenLocked) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!e.isPrimary) return;
      e.preventDefault();
      e.stopPropagation();
      revealZenControls();
      startZenHold('pointer', true);
    });
    zenUnlock.addEventListener('pointerup', cancelZenHold);
    zenUnlock.addEventListener('pointercancel', cancelZenHold);
    zenUnlock.addEventListener('pointerleave', cancelZenHold);
    zenUnlock.addEventListener('contextmenu', (e) => e.preventDefault());

    this.cancelZenKeyHold = () => {
      if (this.zenHoldSource === 'key') cancelZenHold();
    };
    window.addEventListener('blur', this.cancelZenKeyHold);

    // 🌟 全屏：CSS 先覆盖整个视口（兼容 WebView），再尽量申请浏览器原生全屏隐藏地址栏 / 状态栏
    this.setReaderFullscreen = (on) => {
      const next = !!on;
      if (this.fullscreen === next) return;
      this.fullscreen = next;
      this.classList.toggle('reader-fullscreen', next);

      const btn = $('btnFullscreen');
      if (btn) {
        btn.textContent = next ? '⤡' : '⤢';
        btn.title = next ? '退出全屏' : '全屏';
        btn.setAttribute('aria-label', next ? '退出全屏' : '进入全屏');
      }
      setMmFaded(false);
      setZoomFaded(false);

      if (next) {
        // 壳内 WebView 不折腾原生 fullscreen：CSS 固定层已覆盖整个应用视口，
        // 原生 API 在部分 WebView 会直接 reject / 闪退，反而打断阅读。
        const isNativeShell = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        const request = isNativeShell ? null : (this.requestFullscreen || this.webkitRequestFullscreen);
        if (request) {
          try {
            const p = request.call(this);
            if (p && p.catch) p.catch(() => {}); // 不支持就留在 CSS 全屏，不影响阅读
          } catch (err) {}
        }
      } else if (document.fullscreenElement && document.exitFullscreen) {
        this.nativeFullscreenActive = false;
        try {
          const p = document.exitFullscreen();
          if (p && p.catch) p.catch(() => {});
        } catch (err) {}
      }
    };

    $('btnFullscreen').onclick = (e) => {
      e.stopPropagation();
      setZoomFaded(false);
      this.setReaderFullscreen(!this.fullscreen);
    };

    // ⌨️ 桌面键盘：只在阅读页、无弹窗、未聚焦输入框时接管
    const isReaderModalOpen = () => !!this.shadowRoot.querySelector(
      '.modal-mask.show, #bookmarkMask.show, #actionSheetMask.show'
    );

    this.handleReaderKeydown = (e) => {
      if (!this.classList.contains('reading')) return;

      const target = e.composedPath ? e.composedPath()[0] : e.target;
      const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable)) return;

      const key = e.key;
      const lower = key.length === 1 ? key.toLowerCase() : key;

      if (this.zenLocked) {
        // 锁定期间只允许长按 L 解锁，翻页 / 缩放 / Esc 等一律不执行
        if (lower === 'l' && !e.repeat) {
          revealZenControls();
          startZenHold('key', true);
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (isReaderModalOpen()) return;

      const pageStep = Math.max(120, Math.round(viewer.clientHeight * 0.86));
      let handled = true;

      if (key === 'PageDown') viewer.scrollBy({ top: pageStep, behavior: 'smooth' });
      else if (key === 'PageUp') viewer.scrollBy({ top: -pageStep, behavior: 'smooth' });
      else if (key === 'ArrowDown') viewer.scrollBy({ top: 80, behavior: 'smooth' });
      else if (key === 'ArrowUp') viewer.scrollBy({ top: -80, behavior: 'smooth' });
      else if (key === 'Home') viewer.scrollTo({ top: 0, behavior: 'smooth' });
      else if (key === 'End') viewer.scrollTo({ top: viewer.scrollHeight, behavior: 'smooth' });
      else if (key === '+' || key === '=') {
        this.scale = Math.min(6, this.scale + 0.25);
        applyScale();
        setZoomFaded(false);
      } else if (key === '-') {
        this.scale = Math.max(1, this.scale - 0.25);
        applyScale();
        setZoomFaded(false);
      } else if (lower === 'f' && !e.repeat) {
        this.setReaderFullscreen(!this.fullscreen);
      } else if (lower === 'l' && !e.repeat) {
        this.setZenLock(true);
        startZenHold('key', false);
      } else if (key === ' ' && !e.repeat) {
        if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'button') return;
        const mmPlay = $('mmPlay');
        if (mmPlay) mmPlay.click();
      } else if (key === 'Escape' && !e.repeat) {
        if (this.fullscreen) this.setReaderFullscreen(false);
        else closeReader();
      } else {
        handled = false;
      }

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    this.handleReaderKeyup = (e) => {
      if (!this.classList.contains('reading')) return;
      if (!e.key || e.key.toLowerCase() !== 'l') return;
      if (this.zenHoldSource === 'key') cancelZenHold();
      if (this.zenLocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', this.handleReaderKeydown);
    window.addEventListener('keyup', this.handleReaderKeyup);

    // 鼠标在谱面上移动即虚化（只在状态不同时写 DOM，避免每帧重排）
    viewer.addEventListener('pointermove', () => {
      fadeReaderChrome();
    }, { passive: true });

    // 鼠标移到控件上 / 手指按在控件上 → 立刻实体化
    miniMetronome.addEventListener('pointerenter', () => setMmFaded(false));
    miniMetronome.addEventListener('pointerdown', () => setMmFaded(false));
    miniMetronome.addEventListener('touchstart', () => setMmFaded(false), { passive: true });
    zoomControls.addEventListener('pointerenter', () => setZoomFaded(false));
    zoomControls.addEventListener('pointerdown', () => setZoomFaded(false));
    zoomControls.addEventListener('touchstart', () => setZoomFaded(false), { passive: true });

    viewer.addEventListener('wheel', (e) => {
      if (this.zenLocked) { e.preventDefault(); return; }
      fadeReaderChrome(); // 滚动谱面时虚化
      if (miniMetronome.classList.contains('advanced')) miniMetronome.classList.remove('advanced');
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); const delta = e.deltaY > 0 ? -0.15 : 0.15; this.scale = Math.max(1, Math.min(6, this.scale + delta)); applyScale(); }
    }, { passive: false });
    
    viewer.addEventListener('pointerdown', (e) => {
      if (this.zenLocked) { this.isDragging = false; return; }
      fadeReaderChrome(); // 触摸/拖拽谱面时虚化
      if (miniMetronome.classList.contains('advanced')) miniMetronome.classList.remove('advanced');
      if (e.target.closest('.zoom-controls') || e.target.closest('.toolbar') || e.target.closest('.mini-metronome') || e.target.closest('.nav-zone')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.isDragging = true; this.startX = e.clientX; this.startY = e.clientY; this.scrollLeftStart = viewer.scrollLeft; this.scrollTopStart = viewer.scrollTop; viewer.style.cursor = 'grabbing';
    });

    // 触屏按下谱面同样虚化；两指捏合缩放由 touchmove 接管
    let pinchState = null;
    const pinchDistance = (touches) => {
      const a = touches[0], b = touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    viewer.addEventListener('touchstart', (e) => {
      if (this.zenLocked) return;
      fadeReaderChrome();
      if (e.touches.length === 2) {
        this.isDragging = false;
        const t1 = e.touches[0], t2 = e.touches[1];
        const rect = viewer.getBoundingClientRect();
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        pinchState = {
          startDistance: Math.max(1, pinchDistance(e.touches)),
          startScale: this.scale,
          anchorX: (midX - rect.left) + viewer.scrollLeft,
          anchorY: (midY - rect.top) + viewer.scrollTop
        };
      }
    }, { passive: false });

    viewer.addEventListener('touchmove', (e) => {
      if (this.zenLocked) { e.preventDefault(); return; }
      if (!pinchState || e.touches.length !== 2) return;
      e.preventDefault();
      const t1 = e.touches[0], t2 = e.touches[1];
      const nextScale = Math.max(1, Math.min(6,
        pinchState.startScale * (pinchDistance(e.touches) / pinchState.startDistance)));
      if (Math.abs(nextScale - this.scale) < 0.001) return;

      this.scale = nextScale;
      applyScale();

      // 保持双指中点下的谱面内容不跳动
      const rect = viewer.getBoundingClientRect();
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      const ratio = nextScale / pinchState.startScale;
      viewer.scrollLeft = pinchState.anchorX * ratio - (midX - rect.left);
      viewer.scrollTop = pinchState.anchorY * ratio - (midY - rect.top);
    }, { passive: false });

    const endPinch = (e) => {
      if (!e.touches || e.touches.length < 2) pinchState = null;
    };
    viewer.addEventListener('touchend', endPinch, { passive: true });
    viewer.addEventListener('touchcancel', () => { pinchState = null; }, { passive: true });

    viewer.addEventListener('pointermove', (e) => { if (this.zenLocked || !this.isDragging) return; e.preventDefault(); viewer.scrollLeft = this.scrollLeftStart - (e.clientX - this.startX); viewer.scrollTop = this.scrollTopStart - (e.clientY - this.startY); });
    const onPointerUp = () => { this.isDragging = false; viewer.style.cursor = 'grab'; };
    viewer.addEventListener('pointerup', onPointerUp); viewer.addEventListener('pointercancel', onPointerUp);
    $('zoomIn').onclick = () => { this.scale = Math.min(6, this.scale * 1.25); applyScale(); };
    $('zoomOut').onclick = () => { this.scale = Math.max(1, this.scale / 1.25); applyScale(); };

    const mmPlay = $('mmPlay'), mmBpmDisplay = $('mmBpmDisplay'), mmKnobCanvas = $('mmKnobCanvas'), mmKnobWrap = $('mmKnobWrap');
    const mmMinus = $('mmMinus'), mmPlus = $('mmPlus');
    this.mmKnob.ctx = mmKnobCanvas.getContext('2d');
    const initMmKnob = () => {
      const size = 120, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      mmKnobCanvas.width = size * dpr; mmKnobCanvas.height = size * dpr;
      mmKnobCanvas.style.width = size + 'px'; mmKnobCanvas.style.height = size + 'px';
      this.mmKnob.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.mmKnob.size = size; this.mmKnob.cx = size / 2; this.mmKnob.cy = size / 2; this.mmKnob.r = size / 2 - 16;
      drawMmKnob();
    };
    this.drawMmKnob = () => {
      const ctx = this.mmKnob.ctx; if (!ctx || this.mmKnob.size < 10) return;
      const { cx, cy, r } = this.mmKnob; ctx.clearRect(0, 0, this.mmKnob.size, this.mmKnob.size);
      const MIN_BPM = 30, MAX_BPM = 250, START_ANG = 0.75 * Math.PI, SWEEP_ANG = 1.5 * Math.PI;
      const lineW = Math.max(8, r * 0.15), t = (this.mmBpm - MIN_BPM) / (MAX_BPM - MIN_BPM), curA = START_ANG + t * SWEEP_ANG;
      const handleColor = themeColor('--heading', '#f3e8d6');
      ctx.beginPath(); ctx.arc(cx, cy, r, START_ANG, START_ANG + SWEEP_ANG); ctx.strokeStyle = themeColor('--line', '#2c2622'); ctx.lineWidth = lineW; ctx.lineCap = 'round'; ctx.stroke();
      if (t > 0.002) {
        const grad = ctx.createLinearGradient(0, 0, this.mmKnob.size, this.mmKnob.size);
        grad.addColorStop(0, handleColor);
        grad.addColorStop(0.55, themeColor('--accent', '#d99e6a'));
        grad.addColorStop(1, themeColor('--primary', '#b87b4c'));
        ctx.beginPath(); ctx.arc(cx, cy, r, START_ANG, curA); ctx.strokeStyle = grad; ctx.lineWidth = lineW; ctx.lineCap = 'round'; ctx.stroke();
      }
      const hx = cx + Math.cos(curA) * r, hy = cy + Math.sin(curA) * r;
      ctx.beginPath(); ctx.arc(hx, hy, Math.max(5, lineW * 0.8), 0, Math.PI * 2); ctx.fillStyle = handleColor; ctx.fill(); ctx.strokeStyle = themeColor('--muted-soft', '#6a5b4d'); ctx.lineWidth = 2; ctx.stroke();
    };
    const drawMmKnob = this.drawMmKnob; 
    const updateMmBpm = (v, isSync) => {
      this.mmBpm = Math.round(v); if (this.mmBpm < 30) this.mmBpm = 30; if (this.mmBpm > 250) this.mmBpm = 250;
      mmBpmDisplay.textContent = this.mmBpm; drawMmKnob();
      // 正在响就同步变速（引擎会把下一个拍点提前）
      if (this.mmHandle) this.mmHandle.setBpm(this.mmBpm);
      if (!isSync) window.dispatchEvent(new CustomEvent('bpm-changed', { detail: { bpm: this.mmBpm } }));
    };
    const pointerToMmBpm = (e) => {
      const rect = mmKnobCanvas.getBoundingClientRect(), x = e.clientX - rect.left - this.mmKnob.cx, y = e.clientY - rect.top - this.mmKnob.cy;
      let deg = Math.atan2(y, x) * 180 / Math.PI; if (deg < 0) deg += 360; if (deg < 45) deg += 360; if (deg < 135) deg = (deg < 90) ? 405 : 135;
      const t = (deg - 135) / 270; return 30 + t * (250 - 30);
    };
    mmKnobWrap.addEventListener('pointerdown', (e) => { e.preventDefault(); this.mmKnob.dragging = true; mmKnobWrap.setPointerCapture(e.pointerId); updateMmBpm(pointerToMmBpm(e), false); });
    mmKnobWrap.addEventListener('pointermove', (e) => { if (!this.mmKnob.dragging) return; e.preventDefault(); updateMmBpm(pointerToMmBpm(e), false); });
    const onMmKnobUp = (e) => { if (!this.mmKnob.dragging) return; this.mmKnob.dragging = false; try { mmKnobWrap.releasePointerCapture(e.pointerId); } catch(err){} };
    mmKnobWrap.addEventListener('pointerup', onMmKnobUp); mmKnobWrap.addEventListener('pointercancel', onMmKnobUp);
    mmBpmDisplay.onclick = () => { miniMetronome.classList.toggle('advanced'); if (miniMetronome.classList.contains('advanced')) { initMmKnob(); } };
    this.setMiniPlayUI = (playing) => {
      const btn = this.shadowRoot.getElementById('mmPlay');
      if (btn) { btn.textContent = playing ? '■' : '▶'; btn.classList.toggle('playing', playing); }
    };

    this.stopMiniMetronome = () => {
      this.mmPlaying = false;
      if (this.mmHandle) { const h = this.mmHandle; this.mmHandle = null; h.stop('user'); }
      this.setMiniPlayUI(false);
    };
    // 主节拍器的音色 / 拍号重音存在 localStorage；mini 启动时对齐，避免「两套风格」
    const readMetronomeSettings = () => {
      try {
        const s = JSON.parse(localStorage.getItem('guitar_metronome_settings') || '{}');
        const tsNum = Math.max(1, Math.min(12, parseInt(s.tsNum, 10) || 4));
        const accents = new Array(tsNum).fill('beat');
        if (Array.isArray(s.accents) && s.accents.length === tsNum) {
          s.accents.forEach((a, i) => { if (['accent', 'sub', 'beat', 'mute'].includes(a)) accents[i] = a; });
        } else {
          accents[0] = 'accent';
        }
        return { timbre: s.timbre || 'sine', accents, swing: Number(s.swing) || 0 };
      } catch (err) {
        return { timbre: 'sine', accents: ['accent', 'beat', 'beat', 'beat'] };
      }
    };

    const startMiniMetronome = () => {
      const { timbre, accents, swing } = readMetronomeSettings();
      // 引擎内互斥会让主节拍器自动停下（无需再广播事件）
      this.mmHandle = audioEngine.startMetronome({
        bpm: this.mmBpm,
        slots: [1],
        // 与主节拍器同一套重音：逐拍与主节拍器设置一致（含次重音 / 静音 / Swing）
        accents,
        timbre,
        swing,
        // 被主节拍器抢占时把按钮复位，避免显示「■」但其实已经停了
        onStop: () => {
          if (!this.mmPlaying) return;
          this.mmPlaying = false;
          this.mmHandle = null;
          this.setMiniPlayUI(false);
        }
      });
      this.mmPlaying = true;
      this.setMiniPlayUI(true);
    };

    // 🌟 修复：mini 节拍器开始/停止按钮（此前完全没有绑定事件，点「▶」无任何反应）
    mmPlay.onclick = (e) => {
      e.stopPropagation();
      if (this.mmPlaying) this.stopMiniMetronome();
      else startMiniMetronome();
    };

    // mini 节拍器的步进按钮：与主节拍器一致，每次 ±1 BPM；播放中实时变速
    const nudgeMmBpm = (delta) => (e) => {
      e.stopPropagation();
      updateMmBpm(this.mmBpm + delta, false);
    };
    mmMinus.onclick = nudgeMmBpm(-1);
    mmPlus.onclick = nudgeMmBpm(1);

    // 🌟 左右翻页逻辑：切换前先保存当前进度，切换后直接回到目标谱的上次位置
    const openAdjacentScore = async (direction) => {
      if (this.navSwitching) return; // 防连点重入
      if (!this.currentScoreId || !this.filteredScores.length) return;
      const currentIndex = this.filteredScores.findIndex(s => s.id === this.currentScoreId);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex + direction;
      if (nextIndex < 0) nextIndex = this.filteredScores.length - 1; // 循环到最后一个
      if (nextIndex >= this.filteredScores.length) nextIndex = 0; // 循环到第一个

      const nextScore = this.filteredScores[nextIndex];
      if (!nextScore || nextScore.id === this.currentScoreId) return; // 书架只有一本时不重载

      this.navSwitching = true;
      try {
        // 关键修复：离开当前谱之前先存位，否则回到它时会退回第一页
        try { await saveReadingProgress(false); } catch (e) { console.warn('切歌前保存进度失败', e); }
        await this.openScore(nextScore.fileBlob, nextScore.name, nextScore.id, nextScore.tags, nextScore, { autoRestore: true });
      } finally {
        this.navSwitching = false;
      }
    };

    $('navPrev').onclick = () => openAdjacentScore(-1);
    $('navNext').onclick = () => openAdjacentScore(1);

  }
}

customElements.define('guitar-sheet-reader', SheetReader);
