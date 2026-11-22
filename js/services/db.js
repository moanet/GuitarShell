const DB_NAME = 'GuitarShellDB';
const STORE_NAME = 'scores';
const LOG_STORE_NAME = 'logs';
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(LOG_STORE_NAME)) {
        db.createObjectStore(LOG_STORE_NAME, { keyPath: 'id', autoIncrement: true });
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
        fileHash: extraData.fileHash || ''
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

  // 🌟 只取条目数，不把乐谱 Blob 读进内存；用于冷启动默认页判定
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

  // 🌟 新增：按 id 读取单条乐谱（避免 getAllScores 把所有 Blob 都读进内存）
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

  // 🌟 新增：更新单个乐谱的信息（重命名、改标签等）
  // options.touch=false 用于内部回填（如 fileHash），不把维护动作算成用户改动
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
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
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

  // 🌟 A2 冲突检测用：只算「最后一次改动时间」与条数，用游标逐条读，不把整库 Blob 攒进内存
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
      const tx = db.transaction([STORE_NAME, LOG_STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(LOG_STORE_NAME).clear();
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