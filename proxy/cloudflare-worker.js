/**
 * GuitarShell WebDAV 反向代理（Cloudflare Worker）
 *
 * 作用：
 *   1. 把自定义域名下的 `/dav/...` 请求转发到坚果云 `https://dav.jianguoyun.com`；
 *   2. 在 CORS 中放开 WebDAV 的 MOVE，让浏览器可以完成“临时文件 → 正式文件”替换；
 *   3. 把浏览器传来的 Destination（代理域名）重写为坚果云上游地址。
 *
 * 部署：
 *   - Cloudflare Dashboard → Workers & Pages → 选择现有 Worker → Edit code；
 *   - 用本文件完整替换 `src/index.js` / 编辑器内容 → Deploy；
 *   - 确认 `dav.noamet.ccwu.cc` 与 `guitar-webdav-proxy.cuimao513.workers.dev`
 *     两个入口都指向这个 Worker（或分别部署同一份代码）。
 *
 * 说明：
 *   - 不在这里保存账号密码；Authorization 头由 App 每次请求携带并原样转发。
 *   - 只代理到固定的坚果云上游，不接受任意目标地址，避免 SSRF。
 */

const UPSTREAM = 'https://dav.jianguoyun.com';

const CORS_METHODS = 'GET,HEAD,PUT,DELETE,PROPFIND,MKCOL,MOVE,COPY,OPTIONS';
const CORS_HEADERS = [
  'Authorization',
  'Content-Type',
  'Depth',
  'Destination',
  'Overwrite',
  'If',
  'Lock-Token',
  'Timeout',
  'X-Requested-With'
].join(', ');
const CORS_MAX_AGE = '86400';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    'Access-Control-Max-Age': CORS_MAX_AGE
  };
}

function errorResponse(message, status = 502) {
  return new Response(`proxy error: ${message}`, {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 浏览器预检：直接本地返回，不再打到坚果云。
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // 保留原始 path / query；自定义域名根路径必须与坚果云 `/dav/` 对齐。
    const target = new URL(url.pathname + url.search, UPSTREAM);

    const headers = new Headers(request.headers);
    // Host / Origin / Referer 属于浏览器和代理层，不应该转发给上游。
    headers.delete('host');
    headers.delete('origin');
    headers.delete('referer');
    // 让 Cloudflare 与上游协商压缩会干扰二进制响应长度，统一关闭。
    headers.delete('accept-encoding');

    // 浏览器把 Destination 写成代理域名；坚果云要求目标指回它自己的上游地址。
    const destination = headers.get('destination');
    if (destination) {
      try {
        const dest = new URL(destination, url);
        headers.set('destination', new URL(dest.pathname + dest.search, UPSTREAM).toString());
      } catch (err) {
        // 解析不了就丢掉，避免把非法头原样带给上游。
        headers.delete('destination');
      }
    }

    const init = {
      method: request.method,
      headers,
      redirect: 'manual'
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    let upstream;
    try {
      upstream = await fetch(target, init);
    } catch (err) {
      return errorResponse(err && err.message ? err.message : String(err));
    }

    const responseHeaders = new Headers(upstream.headers);
    // body 由 Worker 重新流式输出，长度与压缩标记不再可靠。
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    for (const [key, value] of Object.entries(corsHeaders())) {
      responseHeaders.set(key, value);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};
