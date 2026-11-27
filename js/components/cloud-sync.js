import { buildBackupPayload, restoreBackup, saveBackupFile } from '../services/backup.js';
import { dbService } from '../services/db.js';
import { showConfirm } from './app-dialog.js';
import { getCloudSyncSummary } from '../services/sync-state.js';
import { describeCloudSync, formatSyncTime, readSyncState, writeSyncState } from '../services/sync-state.js';
import { showToast } from '../services/toast.js';
import { vaultService } from '../services/vault.js';
import { webdavService } from '../services/webdav.js';

const REMEMBER_KEY = 'gs_cloud_remember';
const PASS_SECRET = 'webdav-pass';

function cloudDetailText(summary) {
  if (!summary) return '正在读取本机同步记录';
  if (summary.status === 'unknown') return '状态读取失败，仍可手动上传 / 下载';
  if (summary.status === 'never') return '还没建立第一次同步';
  const time = formatSyncTime(summary.at);
  if (summary.status === 'pending') return `上次同步 ${time} · 本机有未同步改动`;
  return `上次同步 ${time} · 本机已是最新`;
}

function validatePayload(payload) {
  if (!payload || !Array.isArray(payload.scores)) throw new Error('云端备份格式不正确');
  if (payload.logs && !Array.isArray(payload.logs)) throw new Error('云端备份的练习记录格式不正确');
  const badScore = payload.scores.find((item) => (
    !item || typeof item.name !== 'string' || typeof item.data !== 'string' || !item.data.startsWith('data:')
  ));
  if (badScore) throw new Error('云端备份中存在无效的乐谱数据');
  return {
    scores: payload.scores,
    logs: payload.logs || [],
    exportedAt: payload.exportedAt || null
  };
}

export class CloudSyncController {
  constructor(host) {
    this.host = host;
    this.root = host.shadowRoot;
    this.busy = false;
    this.taskText = '';
    this.taskKind = '';
    this.failure = null;
    this.retry = null;
    this.bind();
    this.loadForm();
    this.refreshStatus();
  }

  $(id) {
    return this.root.getElementById(id);
  }

  setText(id, value, visible = true) {
    const el = this.$(id);
    if (!el) return;
    el.textContent = value;
    if (el.hasAttribute('data-visibility')) el.hidden = !visible;
    else el.hidden = !visible;
  }

  setHint(id, text) {
    const el = this.$(id);
    if (el) el.textContent = text;
  }

  bind() {
    this.$('btnCloudTest')?.addEventListener('click', () => this.test());
    this.$('btnCloudUpload')?.addEventListener('click', () => this.upload());
    this.$('btnCloudDownload')?.addEventListener('click', () => this.download());
    this.$('cloudCancel')?.addEventListener('click', () => this.cancel());
    this.$('cloudRetry')?.addEventListener('click', () => this.runRetry());
    this.$('cloudDismiss')?.addEventListener('click', () => this.dismissFailure());
    this.$('cloudForget')?.addEventListener('click', () => this.forgetPassword());
    this.$('cloudRemember')?.addEventListener('change', () => this.syncRememberHint());
    this.$('cloudPath')?.addEventListener('change', () => this.refreshStatus());
    this.$('cloudPath')?.addEventListener('blur', () => this.refreshStatus());
    for (const id of ['cloudAccount', 'cloudSecret', 'cloudPath', 'cloudBase']) {
      this.$(id)?.addEventListener('focus', () => {
        setTimeout(() => {
          try { this.$(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) {}
        }, 180);
      });
    }
  }

  loadForm() {
    const supported = vaultService.isSupported();
    const remember = supported && localStorage.getItem(REMEMBER_KEY) === '1';
    const user = localStorage.getItem('gs_cloud_user') || '';
    const path = localStorage.getItem('gs_cloud_path') || 'GuitarShell/backup.json';
    const base = localStorage.getItem('gs_dav_base') || '';

    if (this.$('cloudAccount')) this.$('cloudAccount').value = user;
    if (this.$('cloudPath')) this.$('cloudPath').value = path;
    if (this.$('cloudBase')) this.$('cloudBase').value = base;
    if (this.$('cloudSecret')) this.$('cloudSecret').value = '';
    if (this.$('cloudRemember')) {
      this.$('cloudRemember').checked = remember;
      this.$('cloudRemember').disabled = !supported;
    }
    this.syncRememberHint();

    if (supported && remember) {
      vaultService.load(PASS_SECRET).then((value) => {
        if (value && this.$('cloudSecret') && !this.$('cloudSecret').value) {
          this.$('cloudSecret').value = value;
        }
      }).catch((err) => console.warn('[cloud] 读取密码失败', err));
    }
  }

  syncRememberHint() {
    const supported = vaultService.isSupported();
    const checked = supported && !!this.$('cloudRemember')?.checked;
    if (this.$('cloudRememberRow')) this.$('cloudRememberRow').hidden = !supported;
    this.$('cloudForget').hidden = !checked;
    this.setHint('cloudRememberHint', supported
      ? (checked
        ? '密码以 AES-GCM 加密存进本机 IndexedDB，密钥不可导出，也不会写进备份文件；换设备需重新填。'
        : '不勾选时密码只在本次填写中有效，不会写盘。')
      : '当前页面不是 HTTPS / localhost，浏览器不提供加密能力，只能每次手填。');
  }

  async readForm() {
    const user = (this.$('cloudAccount')?.value || '').trim();
    const pass = (this.$('cloudSecret')?.value || '');
    const path = (this.$('cloudPath')?.value || '').trim() || 'GuitarShell/backup.json';
    const base = (this.$('cloudBase')?.value || '').trim();
    if (!user) {
      showToast('请先填写账号');
      this.$('cloudAccount')?.focus();
      return null;
    }
    if (!pass) {
      showToast('请先填写应用密码');
      this.$('cloudSecret')?.focus();
      return null;
    }

    localStorage.setItem('gs_cloud_user', user);
    localStorage.setItem('gs_cloud_path', path);
    if (base) localStorage.setItem('gs_dav_base', base);
    else localStorage.removeItem('gs_dav_base');
    if (this.$('cloudPath')) this.$('cloudPath').value = path;

    const remember = vaultService.isSupported() && !!this.$('cloudRemember')?.checked;
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
    try {
      if (remember) await vaultService.save(PASS_SECRET, pass);
      else await vaultService.clear(PASS_SECRET);
    } catch (err) {
      console.warn('[cloud] 保存密码失败', err);
      if (remember) showToast('密码没能保存到本机');
    }
    return { user, pass, path, base };
  }

  async forgetPassword() {
    await vaultService.clear(PASS_SECRET);
    localStorage.setItem(REMEMBER_KEY, '0');
    if (this.$('cloudRemember')) this.$('cloudRemember').checked = false;
    if (this.$('cloudSecret')) this.$('cloudSecret').value = '';
    this.syncRememberHint();
    this.refreshStatus();
    showToast('已清除记住的密码');
  }

  setBusy(kind, text) {
    this.busy = true;
    this.taskKind = kind;
    this.taskText = text;
    this.failure = null;
    this.retry = null;
    this.publishTask();
    this.renderState();
  }

  finishBusy() {
    this.busy = false;
    this.taskKind = '';
    this.taskText = '';
    webdavService.endTask();
    this.publishTask();
    this.renderState();
    this.refreshStatus();
  }

  fail(kind, text, retry) {
    this.busy = false;
    this.taskKind = '';
    this.taskText = '';
    this.failure = { kind, text };
    this.retry = retry;
    webdavService.endTask();
    this.publishTask();
    this.renderState();
    this.refreshStatus();
    showToast(`${text}，可点重试`);
  }

  publishTask() {
    window.dispatchEvent(new CustomEvent('gs-cloud-task', {
      detail: { busy: this.busy, text: this.busy ? this.taskText : (this.failure?.text || '') }
    }));
  }

  cancel() {
    if (!this.busy) return;
    if (webdavService.cancelTask()) {
      this.setText('cloudSyncState', '正在取消当前任务…');
      const cancel = this.$('cloudCancel');
      if (cancel) cancel.disabled = true;
    }
  }

  async runRetry() {
    if (this.busy || !this.retry) return;
    const fn = this.retry;
    this.failure = null;
    this.retry = null;
    await fn();
  }

  dismissFailure() {
    this.failure = null;
    this.retry = null;
    this.publishTask();
    this.renderState();
    this.refreshStatus();
  }

  renderState() {
    const cancel = this.$('cloudCancel');
    const retry = this.$('cloudRetry');
    const dismiss = this.$('cloudDismiss');
    if (cancel) cancel.hidden = !this.busy;
    if (retry) retry.hidden = this.busy || !this.failure;
    if (dismiss) dismiss.hidden = this.busy || !this.failure;
    if (cancel) cancel.disabled = false;

    for (const id of ['btnCloudTest', 'btnCloudUpload', 'btnCloudDownload']) {
      const btn = this.$(id);
      if (btn) btn.disabled = this.busy;
    }

    if (this.busy) {
      this.paintStatus('pending', this.taskLabel(), this.taskText || '请稍候');
      this.setText('cloudSyncState', this.taskText || this.taskLabel());
    } else if (this.failure) {
      this.paintStatus('unknown', this.failure.text, '可以重试，或先导出本地备份');
      this.setText('cloudSyncState', this.failure.text);
    }
  }

  taskLabel() {
    if (this.taskKind === 'upload') return '正在上传';
    if (this.taskKind === 'download') return '正在下载';
    if (this.taskKind === 'test') return '正在测试连接';
    return '正在处理';
  }

  paintStatus(status, text, detail) {
    const dot = this.$('cloudDot');
    if (dot) {
      dot.classList.remove('success', 'pending', 'unknown', 'never');
      if (status === 'clean') dot.classList.add('success');
      else if (status === 'pending') dot.classList.add('pending');
      else if (status === 'unknown') dot.classList.add('unknown');
      else if (status === 'never') dot.classList.add('never');
    }
    this.setText('cloudStatusText', text);
    this.setText('cloudDetail', detail);
  }

  async refreshStatus() {
    if (this.busy) {
      this.paintStatus('pending', this.taskLabel(), this.taskText || '请稍候');
      return;
    }
    if (this.failure) {
      this.paintStatus('unknown', this.failure.text, '可以重试，或先导出本地备份');
      return;
    }
    const path = this.$('cloudPath')?.value.trim() || localStorage.getItem('gs_cloud_path') || 'GuitarShell/backup.json';
    try {
      const summary = await getCloudSyncSummary(path);
      const text = summary?.status === 'unknown'
        ? '状态读取失败'
        : describeCloudSync(summary, { compact: true });
      this.paintStatus(summary?.status || 'unknown', text, cloudDetailText(summary));
      this.setText('cloudSyncState', cloudDetailText(summary));
    } catch (err) {
      this.paintStatus('unknown', '状态读取失败', '仍可手动上传 / 下载');
      this.setText('cloudSyncState', '状态读取失败，仍可手动上传 / 下载');
    }
  }

  async test() {
    if (this.busy) return;
    const form = await this.readForm();
    if (!form) return;
    webdavService.beginTask();
    this.setBusy('test', '正在测试 WebDAV 连接…');
    try {
      const result = await webdavService.probe(form.user, form.pass, form.path);
      if (webdavService.isCancelled()) {
        showToast('已取消');
        return;
      }
      const endpoint = result?.endpoint || webdavService.getEndpointLabel();
      const note = result?.exists === null ? '端点可达' : (result?.exists ? '连接正常 · 云端已有备份' : '连接正常 · 云端暂无该文件');
      showToast(`${note} · ${endpoint}`);
      this.setText('cloudSyncState', `连接正常：${endpoint}`);
    } catch (err) {
      if (webdavService.isCancelled()) {
        showToast('已取消');
        return;
      }
      this.fail('test', '连接失败', () => this.test());
      return;
    } finally {
      this.finishBusy();
    }
  }

  async upload() {
    if (this.busy) return;
    const form = await this.readForm();
    if (!form) return;
    webdavService.beginTask();
    this.setBusy('upload', '正在检查云端状态…');
    try {
      const remote = await webdavService.stat(form.user, form.pass, form.path).catch(() => null);
      if (remote && remote.exists) {
        const state = await readSyncState(form.path);
        const change = this.cloudChangeState(state, remote);
        this.setBusy('upload', '等待确认覆盖云端…');
        let go = true;
        if (change === 'changed') {
          go = await showConfirm({
            title: '云端已有更新',
            message: '云端文件比上次同步的新，继续上传会覆盖它。确定覆盖吗？',
            confirmText: '覆盖云端',
            danger: true
          });
        } else if (change === 'first') {
          go = await showConfirm({
            title: '覆盖云端文件',
            message: '云端已经存在同名备份，但本机没有它的同步记录。继续上传会覆盖它。',
            confirmText: '覆盖云端',
            danger: true
          });
        }
        if (!go) {
          showToast('已取消上传');
          return;
        }
      }
      if (webdavService.isCancelled()) {
        showToast('已取消');
        return;
      }
      this.setBusy('upload', '正在打包备份…');
      const payload = await buildBackupPayload({ showLoading: false });
      if (!payload) throw new Error('本机没有可打包的数据');
      this.setBusy('upload', '正在上传备份…');
      await webdavService.upload(form.user, form.pass, form.path, JSON.stringify(payload));
      if (webdavService.isCancelled()) {
        showToast('已取消');
        return;
      }
      const now = Date.now();
      const next = await webdavService.stat(form.user, form.pass, form.path).catch(() => null);
      await writeSyncState(form.path, { at: now, etag: next?.etag || null });
      this.failure = null;
      this.setText('cloudSyncState', '上传完成，本机已同步');
      showToast('已上传到云端');
    } catch (err) {
      if (webdavService.isCancelled()) {
        showToast('已取消');
        return;
      }
      console.error('[cloud] 上传失败', err);
      this.fail('upload', '上传失败', () => this.upload());
      return;
    } finally {
      this.finishBusy();
    }
  }

  async download() {
    if (this.busy) return;
    const form = await this.readForm();
    if (!form) return;
    webdavService.beginTask();
    this.setBusy('download', '正在检查云端文件…');
    try {
      const remote = await webdavService.stat(form.user, form.pass, form.path).catch(() => null);
      const state = await readSyncState(form.path);
      const change = this.cloudChangeState(state, remote);
      this.setBusy('download', '正在下载备份…');
      const text = await webdavService.download(form.user, form.pass, form.path);
      if (webdavService.isCancelled()) {
        showToast('已取消');
        return;
      }
      const payload = validatePayload(JSON.parse(text));

      const local = await this.getLocalChangeStamp();
      const syncedAt = Number(state?.at) || 0;
      const cloudLogs = payload.logs || [];
      const backupTime = payload.exportedAt
        ? formatSyncTime(payload.exportedAt)
        : (remote?.lastModified ? formatSyncTime(remote.lastModified) : '时间未知');

      const localTouched = syncedAt && local.at > syncedAt;
      const neverSyncedWithData = !syncedAt && (local.scoreCount || local.logCount);
      const danger = payload.scores.length === 0 && cloudLogs.length === 0;
      let message = '用云端备份覆盖本机数据？';
      if (danger) {
        message = '云端备份是空的，继续会清空本机乐谱和练习记录，且无法撤销。';
      } else if (localTouched) {
        message = `本机自上次同步后又有改动（${formatSyncTime(local.at)}，含阅读进度），覆盖会丢失这些改动。`;
      } else if (neverSyncedWithData) {
        message = '本机已有数据但还没有同步记录，覆盖会清空本机现有内容。';
      } else if (change === 'changed') {
        message = '云端文件比上次同步的新；继续会用云端覆盖本机。';
      }

      this.setBusy('download', '等待确认覆盖本机…');
      const go = await showConfirm({
        title: danger ? '云端备份是空的' : '用云端备份覆盖本机',
        message,
        details: [
          { label: '本机', value: `${local.scoreCount || 0} 份乐谱 / ${local.logCount || 0} 条练习` },
          { label: '云端', value: `${payload.scores.length} 份乐谱 / ${cloudLogs.length} 条练习` },
          { label: '云端备份时间', value: backupTime }
        ],
        extra: {
          label: '先导出本地备份',
          onClick: async () => {
            try {
              const backup = await buildBackupPayload({ showLoading: false });
              if (!backup) return;
              const saved = await saveBackupFile(backup);
              showToast(saved.native ? `本地备份已保存到 ${saved.path}` : `本地备份已导出到 ${saved.path}`);
            } catch (err) {
              console.error('[cloud] 导出本地备份失败', err);
              showToast(`导出失败：${err.message}`);
            }
          }
        },
        confirmText: '覆盖本机',
        danger: true
      });
      if (!go) {
        showToast('已取消下载');
        return;
      }

      const result = await restoreBackup(payload);
      await writeSyncState(form.path, { at: Date.now(), etag: remote?.etag || null });

      window.dispatchEvent(new CustomEvent('gs-data-changed'));
      window.dispatchEvent(new CustomEvent('log-updated'));
      this.host.refreshStats?.();
      this.failure = null;
      showToast(`已从云端恢复 ${result.scores} 份乐谱、${result.logs} 条练习`);
    } catch (err) {
      if (webdavService.isCancelled()) {
        showToast('已取消');
        return;
      }
      console.error('[cloud] 下载失败', err);
      this.fail('download', '下载失败', () => this.download());
      return;
    } finally {
      this.finishBusy();
    }
  }

  cloudChangeState(state, remote) {
    if (!state?.at && !state?.etag) return 'first';
    if (!remote || remote.exists === null) return 'unknown';
    if (state.etag && remote.etag) return state.etag === remote.etag ? 'same' : 'changed';
    if (remote.lastModified && state.at) {
      return remote.lastModified > state.at ? 'changed' : 'same';
    }
    return 'unknown';
  }

  async getLocalChangeStamp() {
    try {
      return await dbService.getLocalChangeStamp();
    } catch (err) {
      console.warn('[cloud] 读取本机数据失败', err);
      return { at: 0, scoreCount: 0, logCount: 0 };
    }
  }
}
