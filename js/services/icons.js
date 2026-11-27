// 统一线性图标：24×24，stroke 1.8，颜色继承 currentColor。
// 只负责生成 SVG 片段，不处理布局；按钮尺寸由各组件 CSS 决定。

const ICON_PATHS = {
  settings: `
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
  `,
  metronome: `
    <path d="M9 3h6l2 18H7L9 3Z"/>
    <path d="M12 17 16.5 6"/>
    <circle cx="16.5" cy="6" r="1.2"/>
    <path d="M8 21h8"/>
  `,
  music: `
    <path d="M9 18V5l10-2v13"/>
    <circle cx="6.5" cy="18" r="2.5"/>
    <circle cx="16.5" cy="16" r="2.5"/>
  `,
  target: `
    <circle cx="12" cy="12" r="8.5"/>
    <circle cx="12" cy="12" r="4.5"/>
    <path d="M12 12h.01"/>
  `,
  trending: `
    <path d="M3 17l6-6 4 4 8-9"/>
    <path d="M15 6h6v6"/>
  `,
  list: `
    <path d="M8 6h13M8 12h13M8 18h13"/>
    <path d="M4 6h.01M4 12h.01M4 18h.01"/>
  `,
  waveform: `
    <path d="M3 12h2l2-7 3 14 3-10 3 6 2-3h6"/>
  `,
  chart: `
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>
  `,
  share: `
    <path d="M12 16V4"/>
    <path d="m8 8 4-4 4 4"/>
    <path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>
  `,
  clock: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v5l3 2"/>
  `,
  gauge: `
    <path d="M4 17a8 8 0 1 1 16 0"/>
    <path d="M12 17l4-5"/>
    <path d="M4 17h16"/>
  `,
  book: `
    <path d="M3 5a2 2 0 0 1 2-2h5a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H3Z"/>
    <path d="M21 5a2 2 0 0 0-2-2h-5a3 3 0 0 0-3 3v14a3 3 0 0 1 3-3h7Z"/>
  `,
  cloud: `
    <path d="M17.5 19H7a5 5 0 0 1-.8-9.9A6 6 0 0 1 18 9a5 5 0 0 1-.5 10Z"/>
  `,
  folder: `
    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>
  `,
  import: `
    <path d="M12 3v12"/>
    <path d="m8 11 4 4 4-4"/>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
  `,
  download: `
    <path d="M12 3v12"/>
    <path d="m8 11 4 4 4-4"/>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
  `,
  upload: `
    <path d="M12 15V3"/>
    <path d="m8 7 4-4 4 4"/>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
  `,
  lock: `
    <rect x="4" y="10" width="16" height="11" rx="2"/>
    <path d="M8 10V7a4 4 0 0 1 8 0v3"/>
  `,
  play: `
    <path d="M8 5 19 12 8 19Z"/>
  `,
  pause: `
    <rect x="6" y="5" width="4" height="14" rx="1"/>
    <rect x="14" y="5" width="4" height="14" rx="1"/>
  `,
  stop: `
    <rect x="6" y="6" width="12" height="12" rx="1"/>
  `,
  bookmark: `
    <path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4Z"/>
  `,
  camera: `
    <path d="M5 7h3l2-2h4l2 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/>
    <circle cx="12" cy="13" r="3.5"/>
  `,
  image: `
    <rect x="3" y="4" width="18" height="16" rx="2"/>
    <circle cx="8.5" cy="9" r="1.5"/>
    <path d="m21 15-4.5-4.5L9 18"/>
  `,
  file: `
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/>
    <path d="M14 3v6h6"/>
  `,
  text: `
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/>
    <path d="M14 3v6h6"/>
    <path d="M9 13h7M9 17h5"/>
  `,
  pin: `
    <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/>
    <circle cx="12" cy="10" r="2.5"/>
  `,
  volume: `
    <path d="M11 5 6 9H3v6h3l5 4Z"/>
    <path d="M15 9a4 4 0 0 1 0 6"/>
    <path d="M18 6a7 7 0 0 1 0 12"/>
  `,
  bell: `
    <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/>
    <path d="M10 21h4"/>
  `,
  vibrate: `
    <rect x="8" y="4" width="8" height="16" rx="2"/>
    <path d="M4 8v8M2 10v4M20 8v8M22 10v4"/>
  `,
  mic: `
    <rect x="9" y="3" width="6" height="11" rx="3"/>
    <path d="M5 11a7 7 0 0 0 14 0"/>
    <path d="M12 18v3M8 21h8"/>
  `,
  check: `
    <path d="m5 12 4.5 4.5L19 7"/>
  `,
  palette: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 3a9 9 0 0 1 0 18Z"/>
  `,
  sun: `
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
  `,
  database: `
    <ellipse cx="12" cy="5" rx="8" ry="3"/>
    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/>
    <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>
  `,
  archive: `
    <rect x="3" y="4" width="18" height="5" rx="1"/>
    <path d="M5 9v10h14V9"/>
    <path d="M10 13h4"/>
  `,
  info: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 11v5M12 8h.01"/>
  `,
  dot: `
    <circle cx="12" cy="12" r="7"/>
  `,
  close: `
    <path d="M18 6 6 18M6 6l12 12"/>
  `,
  pencil: `
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
  `,
  plus: `
    <path d="M12 5v14M5 12h14"/>
  `,
  minus: `
    <path d="M5 12h14"/>
  `,
  maximize: `
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>
  `,
  chevronLeft: `
    <path d="m15 18-6-6 6-6"/>
  `,
  chevronRight: `
    <path d="m9 18 6-6-6-6"/>
  `,
};

export function icon(name, size = 18) {
  const body = ICON_PATHS[name] || ICON_PATHS.dot;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle" aria-hidden="true" focusable="false">${body}</svg>`;
}
