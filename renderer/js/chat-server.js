import { Net } from './net.js';

/**
 * Chat panel backend for a page connected to the Director: messages go to /api/chat as a regular
 * viewer would send them, the feed is the server's chat log (YouTube, fake viewers and tests alike).
 */
export function serverChatBackend({ token = '', onLog, onMode, onLink }) {
  const headers = { 'content-type': 'application/json', 'x-admin-token': token };
  const post = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  let sim = { viewers: 0, raiders: 0, raidLeftMs: 0, sent: 0 };
  const link = new Net({
    role: 'admin',
    token,
    onMessage(msg) {
      if (msg.t !== 'status') return;
      sim = msg.sim ?? sim;
      onLog?.(msg.chatLog ?? []);
      onMode?.(msg.mode);
    },
    onStatus: (s) => onLink?.(s),
  });
  link.connect();

  return {
    say: (user, text) => post('/api/chat', { user, text }),
    crowd: (on, viewers = 40) => post('/api/admin/sim', on ? { action: 'start', scenario: 'normal', viewers } : { action: 'stop' }),
    raid: (intent = 'shark', viewers = 1000) => post('/api/admin/sim', { action: 'raid', intent, viewers, durationMs: 15000 }),
    trigger: (kind) => post('/api/admin/trigger', { kind }),
    setMode: (mode) => post('/api/admin/mode', { mode }),
    status: () => sim,
    get connected() { return link.connected; },
  };
}
