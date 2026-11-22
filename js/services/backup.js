// ==========================================
// js/services/backup.js
// 全局设置抽屉与读谱页共用的备份格式辅助
// 备份载荷保持与既有「备份 / 恢复」完全兼容：
//   scores[]（含 base64 文件、标签、阅读进度、书签）+ logs[]
// ==========================================

import { dbService } from './db.js';
import { APP_VERSION, BACKUP_SCHEMA } from './version.js';

const readAsDataURL = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const pad = (n) => String(n).padStart(2, '0');

export function backupFileName(now = new Date()) {
  return `GuitarShell-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
}

export async function getDataStats() {
  const [scores, logs] = await Promise.all([
    dbService.getAllScores(),
    dbService.getAllLogs()
  ]);
  let usage = 0;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage || 0;
    }
  } catch (err) {}
  return { scores: scores.length, logs: logs.length, usage };
}

export async function buildBackupPayload() {
  const scores = await dbService.getAllScores();
  const logs = await dbService.getAllLogs();
  if (!scores.length && !logs.length) return null;

  const exportScores = [];
  for (const item of scores) {
    exportScores.push({
      name: item.name,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt || 0,
      data: await readAsDataURL(item.fileBlob),
      tags: item.tags || [],
      lastReadPage: item.lastReadPage || 0,
      lastReadPageRatio: item.lastReadPageRatio || 0,
      lastReadScrollY: item.lastReadScrollY || 0,
      lastReadAt: item.lastReadAt || 0,
      bookmarks: Array.isArray(item.bookmarks) ? item.bookmarks : [],
      fileHash: item.fileHash || ''
    });
  }

  return {
    version: APP_VERSION,
    schema: BACKUP_SCHEMA,
    exportedAt: Date.now(),
    scores: exportScores,
    logs
  };
}

export function downloadBackup(payload) {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

// Android WebView 不认 <a download> + blob，备份会「提示成功但没有文件」。
// 壳内改走原生 SaveBackup：API 29+ 用 MediaStore 写系统下载目录，
// API 22–28 写公共 Download 目录；网页端仍走浏览器下载。
const getNativeSavePlugin = () => {
  try {
    const cap = window.Capacitor;
    if (!cap) return null;
    if (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform()) return null;
    if (cap.Plugins && cap.Plugins.SaveBackup) return cap.Plugins.SaveBackup;
    if (typeof cap.nativePromise === 'function') {
      return { save: (opts) => cap.nativePromise('SaveBackup', 'save', opts) };
    }
  } catch (err) {}
  return null;
};

export async function saveBackupFile(payload) {
  const fileName = backupFileName();
  const json = JSON.stringify(payload);
  const plugin = getNativeSavePlugin();

  if (plugin) {
    const result = await plugin.save({ fileName, data: json });
    const savedName = (result && result.fileName) || fileName;
    return {
      native: true,
      fileName: savedName,
      path: (result && result.path) || `Download/GuitarShell/${savedName}`,
      uri: (result && result.uri) || ''
    };
  }

  downloadBackup(payload);
  return {
    native: false,
    fileName,
    path: '浏览器下载目录',
    uri: ''
  };
}

export async function parseBackupFile(file) {
  if (!file) throw new Error('没有选择备份文件');
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (err) {
    throw new Error('备份文件不是有效 JSON');
  }
  if (!payload || !Array.isArray(payload.scores)) throw new Error('备份文件格式不正确');
  if (payload.logs && !Array.isArray(payload.logs)) throw new Error('备份文件的练习记录格式不正确');
  const badScore = payload.scores.find((item) => (
    !item || typeof item.name !== 'string' || typeof item.data !== 'string' || !item.data.startsWith('data:')
  ));
  if (badScore) throw new Error('备份中存在无效的乐谱数据');
  return payload;
}

export async function restoreBackup(payload) {
  const scoreRecords = [];
  for (const item of payload.scores) {
    const blob = await (await fetch(item.data)).blob();
    scoreRecords.push({
      name: item.name,
      fileBlob: blob,
      createdAt: item.createdAt || Date.now(),
      updatedAt: item.updatedAt || item.createdAt || Date.now(),
      tags: item.tags || [],
      fileHash: item.fileHash || '',
      lastReadPage: item.lastReadPage || 0,
      lastReadPageRatio: item.lastReadPageRatio || 0,
      lastReadScrollY: item.lastReadScrollY || 0,
      lastReadAt: item.lastReadAt || 0,
      bookmarks: Array.isArray(item.bookmarks) ? item.bookmarks : []
    });
  }
  await dbService.clearAllData();
  await dbService.bulkImport(scoreRecords, payload.logs || []);
  return { scores: scoreRecords.length, logs: (payload.logs || []).length };
}
