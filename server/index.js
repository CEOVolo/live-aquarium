import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config, ROOT } from './config.js';
import { World } from './world.js';
import { Director } from './director.js';
import { Ambient } from './ambient.js';
import { AiParser } from './ai-parser.js';
import { YouTubeChat } from './youtube.js';
import { CrowdSimulator } from './simulator.js';
import { createHub } from './hub.js';
import { parseMessage } from './parser.js';
import { INTENTS, SPAWNABLE, SPECIES } from './catalog.js';

// Open to the network without a token? Make one up rather than leave the panel open to everyone.
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
if (!config.adminToken && !loopback) config.adminToken = randomBytes(12).toString('hex');

process.on('unhandledRejection', (err) => console.error('[aquarium] unhandled rejection', err));

const world = new World({ dataDir: config.dataDir, ...config.world }).load();
const director = new Director({ world, mode: config.mode });
const ambient = new Ambient({ director, world, config: config.ambient });

const started = Date.now();
const chatLog = [];
const eventLog = [];
const msgTimes = [];
const bySource = {};

// ---- chat pipeline: any source -> rules parser -> (AI parser) -> director ----

function weightOf(msg) {
  if (msg.superchat) return 10;
  if (msg.roles?.mod) return 3;
  if (msg.roles?.member) return 2;
  return 1;
}

function castVote(msg, parsed, via) {
  // The channel owner is an admin: their chat commands bypass every gate.
  const admin = Boolean(msg.roles?.owner);
  const r = director.vote({
    userId: msg.userId, userName: msg.userName, intent: parsed.intent, species: parsed.species,
    weight: weightOf(msg), admin, source: via,
  });
  if (r.accepted) world.noteVote(msg.userId, msg.userName);
  return r.accepted ? r.reason : `✗ ${r.reason}`;
}

function handleChat(msg) {
  const now = Date.now();
  msgTimes.push(now);
  bySource[msg.source] = (bySource[msg.source] ?? 0) + 1;
  world.noteMessage(msg.userId, msg.userName);
  director.noteActivity(msg.userId, now);
  const entry = { at: now, source: msg.source, user: msg.userName, text: String(msg.text ?? '').slice(0, 200), intent: null, via: null, result: null };
  chatLog.push(entry);
  if (chatLog.length > 300) chatLog.shift();

  const parsed = parseMessage(msg.text);
  // Clear commands go straight to the Director. A keyword inside a longer sentence
  // ("that shark was cool") is double-checked by the AI when it is available.
  const askAi = ai.enabled && (parsed.aiCandidate || (parsed.intent && parsed.confidence !== 'high'));
  if (askAi) {
    msg.entry = entry;
    entry.via = 'ai…'; // set first: a cache hit answers synchronously inside enqueue()
    if (ai.enqueue(msg)) return;
    entry.via = null;
  }
  if (parsed.intent) {
    Object.assign(entry, { intent: parsed.intent, species: parsed.species, via: 'rules' });
    entry.result = castVote(msg, parsed, 'rules');
  }
}

const ai = new AiParser({
  config: config.ai,
  onResult(msg, res) {
    const entry = msg.entry ?? {};
    entry.via = 'ai';
    if (res.intent === 'none' || res.confidence === 'low') {
      entry.result = res.intent === 'none' ? '—' : 'low confidence';
      return;
    }
    Object.assign(entry, { intent: res.intent, species: res.species });
    entry.result = castVote(msg, res, 'ai');
  },
});

const youtube = new YouTubeChat({ config: config.youtube, onMessage: handleChat });
const sim = new CrowdSimulator({ onMessage: handleChat });

// ---- hub -----------------------------------------------------------------------

const worldSync = (now = Date.now()) => ({
  now,
  tod: world.tod(now),
  todRate: world.todRate(now),
  growth: world.state.growth,
  luck: world.state.luck,
  luckTarget: director.luckTarget(),
  population: world.population,
  mode: director.mode,
});

function renderers(now = Date.now()) {
  return [...hub.clients].filter((c) => c.role === 'renderer').map((c) => ({
    fps: c.meta.fps ?? null,
    lastHbAgoMs: c.meta.lastHb ? now - c.meta.lastHb : null,
    size: c.meta.size ?? null,
    fish: c.meta.fish ?? null,
    quality: c.meta.quality ?? null,
    trusted: c.trusted,
  }));
}

// Renderers do not need to know who owns a fish (a YouTube channel id), only the name to show.
const publicFish = ({ ownerId, ...fish }) => fish;
const publicEvent = (ev) => (ev.kind === 'fish_add' ? { ...ev, params: { ...ev.params, fish: publicFish(ev.params.fish) } } : ev);

function status() {
  const now = Date.now();
  while (msgTimes.length && now - msgTimes[0] > 10000) msgTimes.shift();
  return {
    now,
    uptimeMs: now - started,
    mode: director.mode,
    world: {
      ...worldSync(now),
      isNight: world.isNight(now),
      createdAt: world.state.createdAt,
      stats: world.state.stats,
      top: world.topContributors(8),
      species: SPAWNABLE.map((sp) => [sp, world.state.fish.filter((f) => f.species === sp).length]),
      owned: world.state.fish.filter((f) => f.ownerId).slice(-12).map(({ id, species, name }) => ({ id, species, name })),
    },
    director: director.snapshot(now),
    renderers: renderers(now),
    chat: { perSec: Math.round((msgTimes.length / 10) * 10) / 10, bySource },
    ai: ai.status(),
    youtube: youtube.status(),
    sim: sim.status(),
    chatLog: chatLog.slice(-60),
    events: eventLog.slice(-30),
  };
}

const adminTrigger = ({ body }) => {
  const intent = body.kind === 'golden' ? 'wish' : body.kind;
  if (!INTENTS.includes(intent)) return { status: 400, body: { error: `unknown event ${body.kind}` } };
  const r = director.vote({
    userId: 'admin', userName: body.name || 'Admin', intent, species: body.species, admin: true, source: 'panel',
  });
  return { ok: r.accepted, reason: r.reason, event: r.event ?? null };
};

const routes = {
  'GET /healthz': {
    handler: () => {
      const r = renderers();
      const ok = r.some((x) => x.trusted && x.lastHbAgoMs !== null && x.lastHbAgoMs < 15000 && (x.fps ?? 0) >= 15);
      return { status: ok ? 200 : 503, body: { ok, renderers: r, youtube: youtube.state, uptimeMs: Date.now() - started } };
    },
  },
  'GET /api/status': { admin: true, handler: () => status() },
  'POST /api/chat': {
    admin: true,
    handler: ({ body }) => {
      const user = String(body.user || 'Tester').slice(0, 40);
      const text = String(body.text ?? '').slice(0, 300);
      if (!text.trim()) return { status: 400, body: { error: 'empty message' } };
      handleChat({ id: `local-${Date.now()}`, source: 'local', userId: `local:${user}`, userName: user, text, ts: Date.now(), roles: {} });
      return { ok: true, entry: chatLog[chatLog.length - 1] };
    },
  },
  'POST /api/admin/trigger': { admin: true, handler: adminTrigger },
  'POST /api/admin/mode': {
    admin: true,
    handler: ({ body }) => {
      if (!director.setMode(body.mode)) return { status: 400, body: { error: 'mode must be interactive or tv' } };
      hub.broadcast(['renderer', 'preview'], { t: 'mode', mode: director.mode });
      return { ok: true, mode: director.mode };
    },
  },
  'POST /api/admin/sim': {
    admin: true,
    handler: ({ body }) => {
      if (body.action === 'stop') return sim.stop();
      if (body.action === 'raid') return sim.raid({ intent: body.intent, viewers: body.viewers, durationMs: body.durationMs });
      return sim.start({ scenario: body.scenario, viewers: body.viewers });
    },
  },
  'POST /api/admin/youtube': {
    admin: true,
    handler: ({ body }) => {
      if (body.action === 'stop') { youtube.stop(); return youtube.status(); }
      const videoId = body.videoId ? String(body.videoId).trim().replace(/^.*(?:v=|youtu\.be\/|live\/)([\w-]{11}).*$/, '$1') : undefined;
      youtube.start(videoId ? { videoId } : {});
      return youtube.status();
    },
  },
  'POST /api/admin/fish/remove': {
    admin: true,
    handler: ({ body }) => {
      const fish = world.removeFish(String(body.fishId));
      if (!fish) return { status: 404, body: { error: 'no such fish' } };
      director.announce('fish_remove', { fishId: fish.id, reason: 'admin' });
      return { ok: true };
    },
  },
};

const hub = createHub({
  publicDir: path.join(ROOT, 'renderer'),
  threeDir: path.join(ROOT, 'node_modules', 'three'),
  adminToken: config.adminToken,
  allowedHosts: config.allowedHosts,
  routes,
  onSocketOpen(ws) {
    if (ws.role === 'admin') hub.send(ws, { t: 'status', ...status() });
    else {
      const snap = world.snapshot();
      hub.send(ws, { t: 'hello', mode: director.mode, world: { ...snap, fish: snap.fish.map(publicFish), luckTarget: director.luckTarget() } });
    }
  },
  onSocketMessage(ws, msg) {
    if (msg?.t === 'hb' && ws.role !== 'admin') {
      // Frames actually drawn since the last heartbeat: a frozen render loop reports 0.
      const frames = Number(msg.frames), ms = Number(msg.ms);
      const fps = Number.isFinite(frames) && ms > 0 ? (frames * 1000) / ms : Number(msg.fps);
      ws.meta.fps = Number.isFinite(fps) ? Math.max(0, Math.min(1000, Math.round(fps))) : 0;
      ws.meta.fish = Number(msg.fish) || 0;
      ws.meta.size = typeof msg.size === 'string' ? msg.size.slice(0, 20) : null;
      ws.meta.quality = typeof msg.quality === 'string' ? msg.quality.slice(0, 10) : null;
      ws.meta.lastHb = Date.now();
    }
  },
});

// Highlight markers for cutting Shorts out of the stream recording later.
const HIGHLIGHT_TITLES = {
  shark: (n, p) => {
    const v = p?.victim;
    if (v?.name) return `The Shark Ate ${v.name}'s ${SPECIES[v.species] ?? 'Fish'}`;
    if (v) return n > 1 ? `${n} Viewers Summoned a Shark and It Caught a ${SPECIES[v.species] ?? 'Fish'}` : `A Shark Caught a ${SPECIES[v.species] ?? 'Fish'} Live`;
    return n > 1 ? `${n} Viewers Summoned a Shark Into the Aquarium` : 'Someone Spawned a Shark in the Aquarium';
  },
  golden: (n) => (n > 1 ? `Chat Created a Rare Golden Fish (${n} wishes)` : 'A Rare Golden Fish Appeared'),
  jellyfish: () => 'Glowing Jellyfish Took Over the Aquarium',
  night: () => 'The Aquarium Changed Into Night Mode',
  day: () => 'Morning Comes to the Reef',
};
const highlightsFile = path.join(config.dataDir, 'highlights.jsonl');
function logHighlight(ev) {
  const title = HIGHLIGHT_TITLES[ev.kind];
  if (!title) return;
  // For a catch, the moment worth cutting is the bite, a few seconds after the hunt starts.
  const moment = ev.kind === 'shark' && ev.params?.victim ? ev.at + ev.params.huntAtMs + 4000 : ev.at;
  const line = JSON.stringify({ at: new Date(moment).toISOString(), kind: ev.kind, viewers: ev.by?.count ?? 0, title: title(ev.by?.count ?? 0, ev.params) });
  fs.appendFile(highlightsFile, `${line}\n`, () => {});
}

director.on((ev) => {
  hub.broadcast(['renderer', 'preview'], { t: 'event', ...publicEvent(ev) });
  eventLog.push(ev);
  if (eventLog.length > 100) eventLog.shift();
  if (ev.kind === 'night' || ev.kind === 'day') hub.broadcast(['renderer', 'preview'], { t: 'world', ...worldSync() });
  logHighlight(ev);
});

// ---- loops ---------------------------------------------------------------------

setInterval(() => {
  const now = Date.now();
  sim.tick(now);
  director.tick(now);
  ambient.tick(now);
  ai.tick(now);
}, 100);
setInterval(() => hub.broadcast(['renderer', 'preview'], { t: 'world', ...worldSync() }), 1000);
setInterval(() => {
  const snap = director.snapshot();
  hub.broadcast(['renderer', 'preview'], { t: 'meters', mode: snap.mode, active: snap.active, meters: snap.meters, population: world.population });
}, 500);
setInterval(() => hub.broadcast(['admin'], { t: 'status', ...status() }), 1000);
// A full or read-only disk must not take the stream down: log and retry later.
let saveBlockedUntil = 0;
setInterval(() => {
  if (!world.dirty || Date.now() < saveBlockedUntil) return;
  try {
    world.save();
  } catch (err) {
    saveBlockedUntil = Date.now() + 5 * 60000;
    console.error(`[aquarium] could not save the world (${err.code ?? err.message}); retrying in 5 min`);
  }
}, 15000);

let stopping = false;
async function shutdown(signal) {
  if (stopping) process.exit(1); // second Ctrl+C: stop right now
  stopping = true;
  console.log(`\n[aquarium] ${signal}: saving world…`);
  setTimeout(() => process.exit(0), 3000).unref(); // never hang on a slow client
  try { world.save(); } catch (err) { console.error('[aquarium] save failed', err); }
  youtube.stop();
  await hub.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await hub.listen(config.port, config.host);
youtube.start();
if (config.sim.autostart) sim.start({ scenario: config.sim.autostart });

const base = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
console.log(`[aquarium] ${world.population} fish, mode=${director.mode}, day length ${config.world.dayLengthMin} min`);
console.log(`[aquarium] aquarium (interactive): ${base}/`);
console.log(`[aquarium] aquarium (TV mode):     ${base}/?mode=tv`);
console.log(`[aquarium] control panel:          ${base}/admin${config.adminToken ? `?token=${config.adminToken}` : ''}`);
console.log(`[aquarium] youtube: ${youtube.state}${youtube.configured ? '' : ' (set YOUTUBE_API_KEY + YOUTUBE_VIDEO_ID)'} · ai parser: ${ai.enabled ? config.ai.model : 'off'}`);
