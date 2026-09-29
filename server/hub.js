import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

const hostnameOf = (host = '') => host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();

/**
 * HTTP (static files + JSON API) and WebSocket fan-out.
 * Roles: renderer (the aquarium page), preview (the panel's small preview), admin (control panel).
 *
 * Admin access: with ADMIN_TOKEN set, the token is required. Without it, admin calls are
 * accepted only for a loopback Host (or one listed in allowedHosts) from a same-origin page,
 * which blocks cross-site requests and DNS rebinding against a local dev server.
 */
export function createHub({ publicDir, threeDir, adminToken, allowedHosts = [], routes, onSocketMessage, onSocketOpen, log = console }) {
  const clients = new Set();
  const extraHosts = new Set(allowedHosts.map((h) => hostnameOf(h)));

  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true; // curl, OBS, server-to-server
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  };

  const tokenOk = (req, url) => {
    const given = req.headers['x-admin-token'] ?? url.searchParams.get('token') ?? '';
    return safeEqual(given, adminToken);
  };

  const isAdmin = (req, url) => {
    if (!sameOrigin(req)) return false;
    if (adminToken) return tokenOk(req, url);
    const host = hostnameOf(req.headers.host);
    return LOOPBACK.has(host) || host.endsWith('.localhost') || extraHosts.has(host);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) return json(res, 404, { error: 'not found' });
        if (route.admin && !isAdmin(req, url)) return json(res, 401, { error: 'admin token required' });
        let body = {};
        if (req.method === 'POST') {
          // A JSON content type forces a CORS preflight, so other sites cannot post here.
          if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return json(res, 415, { error: 'use Content-Type: application/json' });
          body = await readJson(req);
        }
        const out = await route.handler({ req, url, body });
        return json(res, out?.status ?? 200, out?.body ?? out ?? {});
      }
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      const status = err.status ?? (err instanceof TypeError && err.code === 'ERR_INVALID_URL' ? 400 : 500);
      if (status >= 500) log.error('[http]', err);
      if (!res.headersSent) json(res, status, { error: err.expose || status < 500 ? err.message : 'internal error' });
      else res.destroy();
    }
  });

  function serveStatic(req, res, pathname) {
    let rel;
    try { rel = path.posix.normalize(decodeURIComponent(pathname)); } catch { return notFound(res); }
    let base = publicDir;
    if (rel === '/') rel = '/index.html';
    else if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
    else if (rel.startsWith('/vendor/three/')) {
      rel = rel.slice('/vendor/three'.length);
      if (!/^\/(build|examples\/jsm)\//.test(rel)) return notFound(res);
      base = threeDir;
    }
    const file = path.resolve(base, `.${rel}`);
    if (!file.startsWith(base + path.sep)) return notFound(res);
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return notFound(res);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'content-length': st.size,
        'cache-control': base === threeDir ? 'public, max-age=3600' : 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      // A file that fails to open (permissions, fd exhaustion, deleted mid-deploy) must not crash the server.
      pipeline(fs.createReadStream(file), res, (e) => { if (e) res.destroy(); });
    });
  }

  // Sockets are upgraded by hand so an unauthorised admin connection is refused before it exists.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return refuse(socket, 400, 'Bad Request'); }
    if (url.pathname !== '/ws') return refuse(socket, 404, 'Not Found');
    const asked = url.searchParams.get('role');
    const role = ['renderer', 'admin', 'preview'].includes(asked) ? asked : 'renderer';
    if (role === 'admin' && !isAdmin(req, url)) return refuse(socket, 401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.role = role;
      // Only trusted renderers count for /healthz: any token-less page may watch, but not vouch for the stream.
      ws.trusted = !adminToken || tokenOk(req, url);
      ws.meta = { connectedAt: Date.now(), ip: req.socket.remoteAddress };
      ws.isAlive = true;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('error', () => { clients.delete(ws); ws.terminate(); });
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      onSocketMessage?.(ws, msg);
    });
    ws.on('close', () => clients.delete(ws));
    onSocketOpen?.(ws);
  });

  // Drop dead connections so a crashed browser does not count as a live renderer.
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) { ws.terminate(); clients.delete(ws); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);
  heartbeat.unref();

  function send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function broadcast(roles, msg) {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      // A slow client must not make the server buffer without limit.
      if (roles.includes(ws.role) && ws.readyState === 1 && ws.bufferedAmount < 2e6) ws.send(data);
    }
  }

  function listen(port, host) {
    return new Promise((resolve) => server.listen(port, host, resolve));
  }

  function close() {
    clearInterval(heartbeat);
    for (const ws of clients) ws.terminate();
    wss.close();
    server.closeAllConnections?.();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, clients, send, broadcast, listen, close };
}

function refuse(socket, code, text) {
  socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      if (tooLarge) return; // keep draining so the 413 can still be delivered
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('body too large'), { status: 413, expose: true }));
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400, expose: true }));
      }
    });
    req.on('error', reject);
  });
}
