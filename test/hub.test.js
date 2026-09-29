import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createHub } from '../server/hub.js';

const silent = { error() {}, warn() {}, log() {} };

function makeHub(opts = {}) {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-hub-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>tank</h1>');
  let mode = 'interactive';
  const routes = {
    'GET /api/status': { admin: true, handler: () => ({ mode }) },
    'POST /api/admin/mode': { admin: true, handler: ({ body }) => { mode = body.mode; return { ok: true, mode }; } },
  };
  const hub = createHub({ publicDir, threeDir: publicDir, routes, log: silent, ...opts });
  return { hub, publicDir, getMode: () => mode };
}

async function start(h) {
  await h.hub.listen(0, '127.0.0.1');
  return h.hub.server.address().port;
}

function raw(port, text) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(text));
    let out = '';
    s.on('data', (d) => { out += d.toString(); });
    s.on('error', () => resolve(out));
    s.on('close', () => resolve(out));
    setTimeout(() => { s.destroy(); resolve(out); }, 500);
  });
}

describe('hub: requests that used to crash or bypass the server', () => {
  const h = makeHub();
  let port;
  before(async () => { port = await start(h); });
  after(async () => { await h.hub.close(); fs.rmSync(h.publicDir, { recursive: true, force: true }); });

  const url = (p) => `http://127.0.0.1:${port}${p}`;

  test('a malformed request line gets 400 and the server keeps running', async () => {
    const answer = await raw(port, 'GET http://[::1 HTTP/1.1\r\nHost: a\r\n\r\n');
    assert.match(answer, /^HTTP\/1\.1 400/);
    assert.equal((await fetch(url('/'))).status, 200);
  });

  test('a cross-site text/plain POST is refused (415) and changes nothing', async () => {
    const res = await fetch(url('/api/admin/mode'), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"mode":"tv"}' });
    assert.equal(res.status, 415);
    assert.equal(h.getMode(), 'interactive');
  });

  test('a JSON POST from a foreign Origin is refused (401)', async () => {
    const res = await fetch(url('/api/admin/mode'), {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"mode":"tv"}',
    });
    assert.equal(res.status, 401);
    assert.equal(h.getMode(), 'interactive');
  });

  test('without a token, a non-local Host (DNS rebinding) cannot read the admin API', async () => {
    const answer = await raw(port, 'GET /api/status HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n');
    assert.match(answer, /^HTTP\/1\.1 401/);
  });

  test('a same-origin JSON POST from the panel works', async () => {
    const res = await fetch(url('/api/admin/mode'), {
      method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: '{"mode":"tv"}',
    });
    assert.equal(res.status, 200);
    assert.equal(h.getMode(), 'tv');
  });

  test('an oversized body gets a clean 413', async () => {
    const res = await fetch(url('/api/admin/mode'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'a'.repeat(40000) });
    assert.equal(res.status, 413);
  });

  test('static serving stays inside its folders', async () => {
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/vendor/three/build/..%2f..%2fpackage.json']) {
      assert.equal((await fetch(url(p))).status, 404, p);
    }
  });
});

describe('hub: with ADMIN_TOKEN', () => {
  const h = makeHub({ adminToken: 'secret' });
  let port;
  before(async () => { port = await start(h); });
  after(async () => { await h.hub.close(); fs.rmSync(h.publicDir, { recursive: true, force: true }); });

  test('the admin API needs the token', async () => {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/status`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/status`, { headers: { 'x-admin-token': 'nope' } })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/status`, { headers: { 'x-admin-token': 'secret' } })).status, 200);
  });

  test('an admin WebSocket without the token is refused before the upgrade; a bad frame cannot crash the server', async () => {
    const answer = await raw(port,
      'GET /ws?role=admin HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n\x81\x02hi');
    assert.match(answer, /^HTTP\/1\.1 401/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  });
});
