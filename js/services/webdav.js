// ==========================================
// js/services/webdav.js
// 作用：封装 WebDAV 协议，实现与坚果云的数据收发
//
// 端点策略（A1）：
//   1. 用户手填的「同步通道」永远第一优先（换域名 / 换反代不必改代码）；
//   2. 本地 http 调试（:8000）优先直连局域网代理（同网段最快）；
//   3. 其次自建域名（Worker 绑定的自定义域名），再其次 workers.dev；
//   4. HTTPS 页面不能调 http 端点（混合内容会被拦），本地代理自动跳过；
//   5. 单端点超时 / 网络不可达 / 5xx 时自动换下一个，全部失败才报错并列出尝试过的通道。
//
// 上传策略：
//   坚果云支持 MOVE，但对已存在的目标 MOVE 会返回 409，不能直接原子覆盖。
//   因此写入改成可恢复流程：PUT 到 `<正式文件>.uploading` → 校验大小 →
//   删除正式文件 → MOVE 临时文件到正式文件。任何一步失败都保留临时文件，
//   下载时若正式文件不存在，会回退读取 `.uploading`。
//
//   注意：自定义域名 / Worker 的 CORS 只放开了 GET、PUT、DELETE、PROPFIND，
//   MOVE 会被浏览器预检拦截；本地 Node 代理同样需要显式放开 MOVE，并把
//   Destination 重写回坚果云上游。因此 MOVE 失败（网络 / CORS / 409 / 5xx）
//   时自动回退为“正式文件 PUT + 校验”，临时文件始终保留，下载会校验 JSON
//   并在正式文件损坏时改用临时文件。
// ==========================================

const ENDPOINTS = {
  // 自建域名（Worker 绑定的自定义域名），排在 workers.dev 之前
  domain: { label: '自建域名', base: 'https://dav.noamet.ccwu.cc/dav/' },
  worker: { label: 'Cloudflare Worker', base: 'https://guitar-webdav-proxy.cuimao513.workers.dev/dav/' },
  // 局域网代理同网段应秒回，压到 10s，别让一次失联卡住 90s
  local: { label: '本地代理', base: 'http://192.168.0.200:8081/dav/', cap: 10000 }
};

// 备份文件可能几十 MB（乐谱转 Base64），上传给足时间；下载与探测可以短一些。
// 0.1.5 起整体下调，并允许用户从浮动状态胶囊取消长任务。
const TIMEOUT = { upload: 60000, download: 30000, meta: 12000 };
const TEMP_SUFFIX = '.uploading';

let lastEndpoint = null;
// 一次云同步任务共享一个 AbortController，取消时连同端点回退一起中止
let activeTask = null;

function cancelledError() {
  const err = new Error('已取消云同步任务');
  err.code = 'CLOUD_CANCELLED';
  return err;
}

// 当前页面能安全使用的端点顺序：本地代理（仅 http 调试页）→ 自建域名 → Worker
function customEndpoint() {
  try {
    const base = (localStorage.getItem('gs_dav_base') || '').trim();
    if (!base) return null;
    return { label: '自定义端点', base: base.endsWith('/') ? base : base + '/' };
  } catch (err) {
    return null;
  }
}

function candidates() {
  const list = [];
  // 用户手填的通道最高优先（换域名或换反代时不必改代码）
  const custom = customEndpoint();
  if (custom) list.push(custom);
  // 本地代理只能用于 http 调试页 —— HTTPS 页面调用 http 会被混合内容直接拦掉
  if (location.protocol !== 'https:') list.push(ENDPOINTS.local);
  list.push(ENDPOINTS.domain);
  list.push(ENDPOINTS.worker);
  return list;
}

function normalizePath(remotePath) {
  return String(remotePath || '').replace(/^\/+/, '').trim();
}

function buildUrl(endpoint, remotePath) {
  return endpoint.base + encodeURI(normalizePath(remotePath));
}

function tempPathFor(remotePath) {
  return normalizePath(remotePath) + TEMP_SUFFIX;
}

function utf8ByteLength(text) {
  try {
    return new Blob([text]).size;
  } catch (err) {
    return String(text).length;
  }
}

// 备份文件必须是完整 JSON。若正式文件在 PUT 中断后留下半截内容，
// 下载时用这个廉价校验判断是否需要回退到 `.uploading`。
function isCompleteJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch (err) {
    return false;
  }
}

function basicAuth(username, password) {
  // 坚果云用「邮箱 + 应用密码」的 Basic Auth；应用密码全是 ASCII，btoa 安全
  return { 'Authorization': `Basic ${btoa(`${username}:${password}`)}` };
}

async function fetchWithTimeout(url, init, timeoutMs, label, taskSignal) {
  if (taskSignal && taskSignal.aborted) throw cancelledError();
  const controller = new AbortController();
  let timedOut = false;
  let onTaskAbort = null;
  if (taskSignal) {
    onTaskAbort = () => controller.abort();
    taskSignal.addEventListener('abort', onTaskAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (taskSignal && taskSignal.aborted) throw cancelledError();
    if (timedOut) throw new Error(`${label} 响应超时（${Math.round(timeoutMs / 1000)} 秒）`);
    // TypeError: Failed to fetch —— 断网 / DNS / CORS / 混合内容都会落到这里
    const netErr = new Error(`${label} 网络不可达`);
    netErr.code = 'NETWORK';
    throw netErr;
  } finally {
    clearTimeout(timer);
    if (taskSignal && onTaskAbort) taskSignal.removeEventListener('abort', onTaskAbort);
  }
}

// 固定端点请求：上传进入“临时文件”阶段后，后续 DELETE / MOVE 必须走同一个端点，
// 避免临时文件写在 A 通道、替换请求跑到 B 通道。
async function requestAt(endpoint, remotePath, init, timeoutMs = TIMEOUT.meta) {
  const taskSignal = activeTask ? activeTask.controller.signal : null;
  const effectiveTimeout = Math.min(timeoutMs, endpoint.cap || timeoutMs);
  const res = await fetchWithTimeout(
    buildUrl(endpoint, remotePath), init, effectiveTimeout, endpoint.label, taskSignal
  );
  lastEndpoint = endpoint;
  return res;
}

// 统一请求入口：失败自动换端点；5xx 视为端点异常，同样换。
// 返回实际成功的 endpoint，供上传流程锁定后续请求。
async function requestWithEndpoint(remotePath, init, { timeoutMs = TIMEOUT.meta } = {}) {
  const list = candidates();
  let lastErr = null;

  for (let i = 0; i < list.length; i++) {
    if (activeTask && activeTask.controller.signal.aborted) throw cancelledError();
    const ep = list[i];
    try {
      const res = await requestAt(ep, remotePath, init, timeoutMs);
      if (res.status >= 500 && i < list.length - 1) {
        lastErr = new Error(`${ep.label} 服务异常（HTTP ${res.status}）`);
        console.warn('[WebDAV]', lastErr.message, '→ 换下一个端点');
        continue;
      }
      return { res, endpoint: ep };
    } catch (err) {
      if (err.code === 'CLOUD_CANCELLED') throw err;
      lastErr = err;
      console.warn('[WebDAV]', `${ep.label} 不可用：${err.message}`, i < list.length - 1 ? '→ 换下一个端点' : '');
    }
  }

  const tried = list.map(ep => ep.label).join(' / ');
  throw new Error(`${lastErr ? lastErr.message : '网络不可达'}（已尝试：${tried}）`);
}

async function request(remotePath, init, opts) {
  const { res } = await requestWithEndpoint(remotePath, init, opts);
  return res;
}

// 备份路径的父目录不存在时，尝试逐级建目录（坚果云首次同步常见 409）
async function ensureFolder(username, password, remotePath, endpoint = null) {
  const segments = normalizePath(remotePath).split('/').slice(0, -1).filter(Boolean);
  if (!segments.length) return false;

  let created = false;
  for (let i = 1; i <= segments.length; i++) {
    const path = segments.slice(0, i).join('/') + '/';
    const init = { method: 'MKCOL', headers: basicAuth(username, password) };
    const res = endpoint
      ? await requestAt(endpoint, path, init, TIMEOUT.meta)
      : await request(path, init, { timeoutMs: TIMEOUT.meta });
    if (res.status === 401) throw new Error('账号或应用密码错误');
    if (res.status === 403) throw new Error('云端目录不可写');
    // 201 新建成功；405 已存在；其余留给随后的上传报错
    if (res.ok || res.status === 405) created = true;
  }
  return created;
}

async function parseStatResponse(res) {
  if (res.status === 401) throw new Error('账号或应用密码错误');
  if (res.status === 404) return { exists: false, lastModified: 0, etag: '', size: 0 };
  // 端点不放开 PROPFIND 时无法判断新旧，交给上层按「未知」处理
  if (res.status === 405 || res.status === 501) {
    return { exists: null, lastModified: 0, etag: '', size: 0 };
  }
  if (!res.ok && res.status !== 207) throw new Error(`读取云端状态失败: HTTP ${res.status}`);

  const text = await res.text();
  // 坚果云返回的 XML 前缀大小写不定（D: / d: / 无前缀），用标签名抓取最稳
  const grab = (tag) => {
    const m = text.match(new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`, 'i'));
    return m ? m[1].trim() : '';
  };

  const lastModifiedStr = grab('getlastmodified');
  const parsedDate = lastModifiedStr ? Date.parse(lastModifiedStr) : 0;

  return {
    exists: true,
    lastModified: Number.isFinite(parsedDate) ? parsedDate : 0,
    etag: grab('getetag').replace(/^W\//, '').replace(/"/g, ''),
    size: parseInt(grab('getcontentlength'), 10) || 0
  };
}

async function statAt(endpoint, username, password, remotePath) {
  const res = await requestAt(endpoint, remotePath, {
    method: 'PROPFIND',
    headers: { ...basicAuth(username, password), 'Depth': '0' }
  }, TIMEOUT.meta);
  return await parseStatResponse(res);
}

async function deleteAt(endpoint, remotePath, auth, timeoutMs = TIMEOUT.meta) {
  return await requestAt(endpoint, remotePath, { method: 'DELETE', headers: auth }, timeoutMs);
}

export const webdavService = {
  // 一次云同步任务的生命周期：开始 / 取消 / 结束。UI 层保证同一时间只有一个任务。
  beginTask() {
    if (activeTask) throw new Error('已有云同步任务进行中');
    activeTask = { controller: new AbortController(), cancelled: false };
    return activeTask.controller.signal;
  },

  cancelTask() {
    if (!activeTask) return false;
    activeTask.cancelled = true;
    activeTask.controller.abort();
    return true;
  },

  isCancelled() {
    return !!(activeTask && activeTask.cancelled);
  },

  endTask() {
    activeTask = null;
  },

  getTimeouts() {
    return { ...TIMEOUT };
  },

  getHeaders(username, password) {
    return basicAuth(username, password);
  },

  // 最近一次成功请求走的通道，用于 UI 提示「走的是哪条路」
  getEndpointLabel() {
    return lastEndpoint ? lastEndpoint.label : '';
  },

  // 上传文件（备份数据）：先写临时文件，校验后再替换正式文件。
  async upload(username, password, remotePath, dataStr) {
    const auth = basicAuth(username, password);
    const headers = {
      ...auth,
      'Content-Type': 'application/json;charset=utf-8'
    };
    const tempPath = tempPathFor(remotePath);
    const expectedSize = utf8ByteLength(dataStr);

    // 第一段允许换端点；临时文件一旦写成功，就锁死这个端点。
    const first = await requestWithEndpoint(
      tempPath,
      { method: 'PUT', headers, body: dataStr },
      { timeoutMs: TIMEOUT.upload }
    );
    let endpoint = first.endpoint;
    let res = first.res;

    if (res.status === 401) throw new Error('账号或应用密码错误');

    if (res.status === 409 || res.status === 404) {
      // 云端目录不存在 → 补建后在同一端点重试
      try {
        await ensureFolder(username, password, remotePath, endpoint);
      } catch (err) {
        console.warn('[WebDAV] 自动建目录失败:', err.message);
      }
      res = await requestAt(endpoint, tempPath, { method: 'PUT', headers, body: dataStr }, TIMEOUT.upload);
      if (res.status === 401) throw new Error('账号或应用密码错误');
    }

    if (!res.ok) {
      throw new Error(`上传失败：云端目录不可写（HTTP ${res.status}），请先在坚果云里建好文件夹`);
    }

    // 校验临时文件大小；PROPFIND 被代理禁用时返回 exists:null，跳过校验。
    let tempStat = null;
    try {
      tempStat = await statAt(endpoint, username, password, tempPath);
    } catch (err) {
      throw new Error(`上传校验失败：${err.message}`);
    }
    if (tempStat && tempStat.exists === false) {
      throw new Error('上传校验失败：临时文件未出现在云端');
    }
    if (tempStat && tempStat.size > 0 && tempStat.size !== expectedSize) {
      await deleteAt(endpoint, tempPath, auth).catch(() => {});
      throw new Error(`上传校验失败：临时文件大小 ${tempStat.size}，应为 ${expectedSize}`);
    }

    // 正式文件此时可能不存在（首次上传），DELETE 404 视为正常。
    const del = await deleteAt(endpoint, remotePath, auth);
    if (del.status === 401) throw new Error('账号或应用密码错误');
    if (!del.ok && del.status !== 404) {
      throw new Error(`替换失败：无法删除旧备份（HTTP ${del.status}），临时文件已保留`);
    }

    // 正式文件已删除，普通 MOVE 不会触发坚果云的覆盖 409。
    // 但浏览器端 MOVE 需要代理显式放开 CORS 预检；不放开时 fetch 会直接抛
    // TypeError。这里不把 MOVE 当成唯一路径：失败就回退为正式文件 PUT。
    let move = null;
    let moveErr = null;
    try {
      move = await requestAt(endpoint, tempPath, {
        method: 'MOVE',
        headers: {
          ...auth,
          'Destination': buildUrl(endpoint, remotePath),
          'Overwrite': 'F'
        }
      }, TIMEOUT.meta);
    } catch (err) {
      if (err.code === 'CLOUD_CANCELLED') throw err;
      moveErr = err;
    }

    if (move && move.status === 401) throw new Error('账号或应用密码错误');
    if (move && move.ok) return endpoint.label;

    console.warn(
      '[WebDAV] MOVE 不可用，回退正式文件 PUT:',
      moveErr ? moveErr.message : `HTTP ${move.status}`
    );

    // 回退路径：临时文件已经完整并通过校验，正式文件刚刚被删除（或本来不存在）。
    // 直接 PUT 正式文件并再次校验；失败时保留 `.uploading`，下载可回退。
    const putFinal = await requestAt(endpoint, remotePath, {
      method: 'PUT',
      headers,
      body: dataStr
    }, TIMEOUT.upload);
    if (putFinal.status === 401) throw new Error('账号或应用密码错误');
    if (!putFinal.ok) {
      throw new Error(`替换失败：正式文件写入失败（HTTP ${putFinal.status}），临时文件已保留`);
    }

    let finalStat = null;
    try {
      finalStat = await statAt(endpoint, username, password, remotePath);
    } catch (err) {
      throw new Error(`上传校验失败：无法读取正式文件状态（${err.message}），临时文件已保留`);
    }
    if (finalStat && finalStat.exists === false) {
      throw new Error('上传校验失败：正式文件未出现在云端，临时文件已保留');
    }
    if (finalStat && finalStat.size > 0 && finalStat.size !== expectedSize) {
      await deleteAt(endpoint, remotePath, auth).catch(() => {});
      throw new Error(`上传校验失败：正式文件大小 ${finalStat.size}，应为 ${expectedSize}，临时文件已保留`);
    }

    await deleteAt(endpoint, tempPath, auth).catch(() => {});
    return endpoint.label;
  },

  // 下载文件（获取备份数据）。正式文件不存在时，尝试读取上次失败留下的临时文件。
  // 正式文件存在但不是完整 JSON（例如 PUT 被中断）时，也优先改用临时文件。
  async download(username, password, remotePath) {
    const auth = basicAuth(username, password);
    let res = await request(remotePath, { method: 'GET', headers: auth }, { timeoutMs: TIMEOUT.download });

    if (res.status === 404) {
      const tempRes = await request(tempPathFor(remotePath), { method: 'GET', headers: auth }, { timeoutMs: TIMEOUT.download });
      if (tempRes.ok) return await tempRes.text();
      if (tempRes.status === 401) throw new Error('账号或应用密码错误');
      throw new Error('云端没有找到备份文件');
    }

    if (!res.ok) {
      if (res.status === 401) throw new Error('账号或应用密码错误');
      throw new Error(`下载失败: HTTP ${res.status}`);
    }

    const text = await res.text();
    if (isCompleteJson(text)) return text;

    // 正式文件是半截 JSON：临时文件通常才是完整的新备份。
    const tempRes = await request(tempPathFor(remotePath), { method: 'GET', headers: auth }, { timeoutMs: TIMEOUT.download });
    if (tempRes.ok) {
      const tempText = await tempRes.text();
      if (isCompleteJson(tempText)) {
        console.warn('[WebDAV] 正式文件不是完整 JSON，已改用临时文件');
        return tempText;
      }
    }
    if (tempRes.status === 401) throw new Error('账号或应用密码错误');

    // 临时文件也不可用时返回正式文件原文，由上层给出格式错误。
    return text;
  },

  // 连通性探测：上传前先确认哪条通道能用，避免把几十 MB 数据扔进失联的网络
  async probe(username, password, remotePath) {
    if (!username || !password) throw new Error('请先填写账号与应用密码');
    const res = await request(remotePath, {
      method: 'PROPFIND',
      headers: { ...basicAuth(username, password), 'Depth': '0' }
    }, { timeoutMs: TIMEOUT.meta });

    if (res.status === 401) throw new Error('账号或应用密码错误');
    // 405 / 501：端点通了，只是代理没放开 PROPFIND —— 也算连通
    if (res.status === 405 || res.status === 501) return { endpoint: lastEndpoint.label, exists: null };

    return { endpoint: lastEndpoint.label, exists: res.ok || res.status === 207 };
  },

  // 读云端元信息（A2 冲突检测用）：存在与否、最后修改时间、etag、大小
  async stat(username, password, remotePath) {
    const res = await request(remotePath, {
      method: 'PROPFIND',
      headers: { ...basicAuth(username, password), 'Depth': '0' }
    }, { timeoutMs: TIMEOUT.meta });
    return await parseStatResponse(res);
  }
};
