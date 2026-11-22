// ==========================================
// js/services/sync-state.js
// 作用：统一读写「云同步点」并生成本机同步状态摘要
//
// 同步点按云端路径分开存：换账号 / 换备份路径不会拿旧记录误判。
// 本机改动时间取 createdAt / updatedAt / lastReadAt 的最大值。
// ==========================================

import { dbService } from './db.js';

const SYNC_STATE_PREFIX = 'gs_cloud_sync:';

export function readSyncState(path) {
  try {
    const key = SYNC_STATE_PREFIX + String(path || '');
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch (err) {
    return {};
  }
}

export function writeSyncState(path, patch) {
  const prev = readSyncState(path);
  const key = SYNC_STATE_PREFIX + String(path || '');
  localStorage.setItem(key, JSON.stringify({ ...prev, ...patch }));
}

export function formatSyncTime(ms) {
  const value = Number(ms);
  if (!value) return '时间未知';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '时间未知';
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export async function getCloudSyncSummary(path) {
  const state = readSyncState(path);
  const at = Number(state.at) || 0;

  try {
    const local = await dbService.getLocalChangeStamp();
    const status = !at ? 'never' : (local.at > at ? 'pending' : 'clean');
    return { at, etag: state.etag || '', local, status };
  } catch (err) {
    console.warn('[云同步] 读取本机改动失败:', err.message);
    return {
      at,
      etag: state.etag || '',
      local: { at: 0, scoreCount: 0, logCount: 0 },
      status: 'unknown'
    };
  }
}

export function describeCloudSync(summary) {
  if (!summary) return '正在读取同步状态…';
  if (summary.status === 'unknown') return '同步状态读取失败 · 仍可手动上传 / 下载';

  const scores = Number(summary.local && summary.local.scoreCount) || 0;
  const logs = Number(summary.local && summary.local.logCount) || 0;

  if (summary.status === 'never') {
    return (scores || logs)
      ? `尚未同步 · 本机有 ${scores} 份乐谱 / ${logs} 条记录`
      : '尚未同步 · 本机暂无数据';
  }

  const time = formatSyncTime(summary.at);
  if (summary.status === 'pending') return `上次同步 ${time} · 本机有未同步改动`;
  return `上次同步 ${time} · 本机已是最新`;
}
