import http from 'http';
import { fetch } from 'undici';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // MOVE 是 WebDAV 替换临时文件的必要方法；浏览器会先发 OPTIONS 预检
  "Access-Control-Allow-Methods": "GET,PUT,DELETE,PROPFIND,MOVE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, Destination, Overwrite, X-Requested-With",
  "Access-Control-Max-Age": "86400"
};

const UPSTREAM = new URL("https://dav.jianguoyun.com");
const METHODS_WITH_BODY = new Set(["PUT", "POST", "PATCH"]);

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const upstreamUrl = new URL(req.url ?? "/", UPSTREAM);
    const headers = { ...req.headers };

    // 浏览器把 Destination 写成代理域名；坚果云要求目标指回它自己的上游地址。
    // 只保留路径与查询串，统一换成 https://dav.jianguoyun.com/...。
    if (headers.destination) {
      try {
        const dest = new URL(headers.destination, upstreamUrl);
        headers.destination = new URL(dest.pathname + dest.search, UPSTREAM).toString();
      } catch (err) {
        console.warn("忽略无法解析的 Destination:", headers.destination);
        delete headers.destination;
      }
    }
    // 这些是浏览器 / 代理层的头，不应该带给上游
    delete headers.host;
    delete headers.origin;
    delete headers.referer;

    const fetchOpts = {
      method: req.method,
      headers,
      redirect: "follow"
    };

    if (METHODS_WITH_BODY.has(req.method)) {
      fetchOpts.body = req;
      fetchOpts.duplex = "half";
    }

    const upstreamRes = await fetch(upstreamUrl, fetchOpts);

    // 设置CORS头
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

    // 状态码
    res.writeHead(upstreamRes.status);

    // ✅Web ReadableStream 使用 pipeTo，不要使用 .pipe()
    if (upstreamRes.body) {
      // Node http.ServerResponse 可以作为 WritableStream
      await upstreamRes.body.pipeTo(new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
        },
        abort(err) {
          res.destroy(err);
        }
      }));
    } else {
      res.end();
    }

  } catch (err) {
    console.error("代理异常：", err);
    // 防止头已经发送再writeHead
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end("proxy error:" + err.message);
  }
});

// 原来：server.listen(8000, "0.0.0.0", () => {
server.listen(8081, "0.0.0.0", () => {
  console.log("✅本地WebDAV代理已启动");
  console.log("本机访问地址：http://127.0.0.1:8081");
  console.log("局域网其他设备：http://192.168.0.200:8081");
});
