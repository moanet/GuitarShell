const DB_NAME = 'GuitarShellDB';
const STORE_NAME = 'scores';
const LOG_STORE_NAME = 'logs';
const ASSET_STORE_NAME = 'assets';
const DB_VERSION = 4;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(LOG_STORE_NAME)) {
        db.createObjectStore(LOG_STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        const assetStore = db.createObjectStore(ASSET_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        assetStore.createIndex('scoreId', 'scoreId', { unique: false });
      } else {
        const tx = request.transaction;
        const assetStore = tx.objectStore(ASSET_STORE_NAME);
        if (!assetStore.indexNames.contains('scoreId')) {
          assetStore.createIndex('scoreId', 'scoreId', { unique: false });
        }
      }
    };
  });
}

export const dbService = {
  async addScore(name, fileBlob, extraData = {}) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = {
        name, fileBlob, createdAt: Date.now(),
        updatedAt: extraData.updatedAt || Date.now(),
        tags: extraData.tags || [],
        lastReadPage: extraData.lastReadPage || 0,
        lastReadPageRatio: extraData.lastReadPageRatio || 0,
        lastReadScrollY: extraData.lastReadScrollY || 0,
        lastReadAt: extraData.lastReadAt || 0,
        fileHash: extraData.fileHash || '',
        format: extraData.format || '',
        pageCount: extraData.pageCount || 0,
        coverAssetId: extraData.coverAssetId || null
      };
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getAllScores() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(request.error);
    });
  },

  // 只取条目数，不把乐谱 Blob 读进内存；用于冷启动默认页判定
  async getScoreCount() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.count();
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  },

  // 按 id 读取单条乐谱（避免 getAllScores 把所有 Blob 都读进内存）
  async getScore(id) {
    if (id === null || id === undefined) return null;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },

  // 更新单个乐谱的信息（重命名、改标签等）
  // options.touch=false 用于内部回填（如 fileHash / coverAssetId），不把维护动作算成用户改动
  async updateScore(id, updateData, options = {}) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const data = getReq.result;
        if (!data) return reject(new Error('找不到该乐谱'));
        Object.assign(data, updateData);
        if (options.touch !== false) data.updatedAt = Date.now();
        const putReq = store.put(data);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  async deleteScore(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, ASSET_STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      const assetStore = tx.objectStore(ASSET_STORE_NAME);
      const cursorReq = assetStore.index('scoreId').openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('删除乐谱失败'));
    });
  },

  // ==================== 封面 / 缩略图等派生资产 ====================
  async addAsset(assetData) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
      const store = tx.objectStore(ASSET_STORE_NAME);
      const record = { ...assetData, createdAt: assetData.createdAt || Date.now() };
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getAsset(id) {
    if (id === null || id === undefined) return null;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE_NAME, 'readonly');
      const store = tx.objectStore(ASSET_STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },

  async deleteAsset(id) {
    if (id === null || id === undefined) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
      tx.objectStore(ASSET_STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteAssetsForScore(scoreId) {
    if (scoreId === null || scoreId === undefined) return 0;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      let count = 0;
      const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
      const cursorReq = tx.objectStore(ASSET_STORE_NAME).index('scoreId').openCursor(IDBKeyRange.only(scoreId));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        count += 1;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
    });
  },

  // ==================== 0.1.13 存储统计与缓存清理 ====================
  // 只读元数据汇总用；记录里带 Blob 引用，但这里不读内容，不会把图片解码进内存
  async getAllAssets() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE_NAME, 'readonly');
      const request = tx.objectStore(ASSET_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  // 清空全部封面缓存，并把乐谱上的 coverAssetId 指针置空；不碰进度 / 书签 / 标签
  async clearCoverAssets() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      let count = 0;
      let bytes = 0;
      const tx = db.transaction([STORE_NAME, ASSET_STORE_NAME], 'readwrite');
      const assetStore = tx.objectStore(ASSET_STORE_NAME);
      const scoreStore = tx.objectStore(STORE_NAME);

      const assetReq = assetStore.openCursor();
      assetReq.onsuccess = () => {
        const cursor = assetReq.result;
        if (!cursor) return;
        const value = cursor.value || {};
        if (value.kind === 'cover') {
          count += 1;
          bytes += Number(value.bytes) || 0;
          cursor.delete();
        }
        cursor.continue();
      };

      const scoreReq = scoreStore.openCursor();
      scoreReq.onsuccess = () => {
        const cursor = scoreReq.result;
        if (!cursor) return;
        const value = cursor.value || {};
        if (value.coverAssetId !== null && value.coverAssetId !== undefined) {
          value.coverAssetId = null;
          cursor.update(value);
        }
        cursor.continue();
      };

      tx.oncomplete = () => resolve({ count, bytes });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('清理封面缓存失败'));
    });
  },

  async deleteAssetsByIds(ids) {
    const list = Array.isArray(ids) ? ids.filter((id) => id !== null && id !== undefined) : [];
    if (!list.length) return 0;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
      const store = tx.objectStore(ASSET_STORE_NAME);
      list.forEach((id) => store.delete(id));
      tx.oncomplete = () => resolve(list.length);
      tx.onerror = () => reject(tx.error);
    });
  },

  async addLog(logData) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LOG_STORE_NAME);
      const record = { ...logData, createdAt: Date.now(), scoreId: logData.scoreId || '' };
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getAllLogs() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE_NAME, 'readonly');
      const store = tx.objectStore(LOG_STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(request.error);
    });
  },

  async deleteLog(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LOG_STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async getLatestLogByName(name) {
    const logs = await this.getAllLogs();
    return logs.find(log => log.name === name) || null;
  },

  // A2 冲突检测用：只算「最后一次改动时间」与条数，用游标逐条读，不把整库 Blob 攒进内存
  async getLocalChangeStamp() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, LOG_STORE_NAME], 'readonly');
      let at = 0, scoreCount = 0, logCount = 0, pending = 2;
      const finish = () => { if (--pending === 0) resolve({ at, scoreCount, logCount }); };

      const scoreReq = tx.objectStore(STORE_NAME).openCursor();
      scoreReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return finish();
        const v = cursor.value || {};
        scoreCount += 1;
        at = Math.max(at, v.createdAt || 0, v.updatedAt || 0, v.lastReadAt || 0);
        cursor.continue();
      };
      scoreReq.onerror = () => reject(scoreReq.error);

      const logReq = tx.objectStore(LOG_STORE_NAME).openCursor();
      logReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return finish();
        const v = cursor.value || {};
        logCount += 1;
        at = Math.max(at, v.createdAt || 0);
        cursor.continue();
      };
      logReq.onerror = () => reject(logReq.error);
    });
  },

  async clearAllData() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, LOG_STORE_NAME, ASSET_STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(LOG_STORE_NAME).clear();
      tx.objectStore(ASSET_STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async bulkImport(scores, logs) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, LOG_STORE_NAME], 'readwrite');
      const scoreStore = tx.objectStore(STORE_NAME);
      const logStore = tx.objectStore(LOG_STORE_NAME);
      scores.forEach(item => { delete item.id; scoreStore.add(item); });
      logs.forEach(item => { delete item.id; logStore.add(item); });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};
