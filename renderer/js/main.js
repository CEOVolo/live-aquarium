import { Aquarium } from './aquarium.js';
import { Overlay } from './overlay.js';
import { AudioEngine } from './audio.js';
import { Net } from './net.js';
import { LocalWorld } from './local.js';
import { SPECIES } from './fish/species.js';
import { loadFishModels } from './fish/models.js';

// URL parameters:
//   mode=tv|interactive   force a view (default: follow the Director's mode)
//   q=low|med|high        render quality          camera=static|drift|cinematic
//   music=1  vol=0..1  mute=1  debug=1  offline=1  overlay=0  pr=<max pixel ratio>
//   chat=0                hide the test chat panel (it is never shown inside OBS anyway)
//   models=0              procedural fish only (skip the 3D models)
const qs = new URLSearchParams(location.search);
const forcedMode = ['tv', 'interactive'].includes(qs.get('mode')) ? qs.get('mode') : null;
const embed = qs.get('embed') === '1';
const q = ['low', 'med', 'high', 'ultra'].includes(qs.get('q')) ? qs.get('q') : embed ? 'low' : 'high';
const opts = {
  // 'ultra' = 'high' + hardware MSAA (for strong GPUs, e.g. a cloud render node).
  quality: q === 'ultra' ? 'high' : q,
  msaa: q === 'ultra',
  maxPixelRatio: Number(qs.get('pr')) || (embed ? 1 : 2),
  cameraStyle: qs.get('camera') ?? (forcedMode === 'tv' ? 'cinematic' : 'drift'),
  adaptive: qs.get('adaptive') !== '0',
  capture: qs.get('capture') === '1',
  // 3D fish models load before the tank is built; a model that fails keeps its procedural fish.
  models: qs.get('models') === '0' ? {} : await loadFishModels(SPECIES),
};

const audio = new AudioEngine({
  volume: Math.min(1, Math.max(0, Number(qs.get('vol') ?? 0.8))),
  music: qs.get('music') === '1',
  muted: embed || qs.get('mute') === '1',
});
const aquarium = new Aquarium(document.getElementById('scene'), opts, audio);
const overlay = new Overlay(document.getElementById('overlay'), aquarium);
aquarium.onFrame(() => overlay.frame(aquarium.camera, aquarium.width, aquarium.height));
aquarium.onCatch = (info) => overlay.onCatch(info);
window.aquarium = aquarium;

let mode = forcedMode ?? 'interactive';
let chatPanel = null;
function applyMode(serverMode) {
  mode = forcedMode ?? serverMode ?? mode;
  document.body.dataset.mode = mode;
  chatPanel?.setView(serverMode ?? mode);
  overlay.setVisible(mode === 'interactive' && qs.get('overlay') !== '0' && !embed);
  if (!qs.get('camera')) aquarium.rig.setStyle(mode === 'tv' ? 'cinematic' : 'drift');
}
applyMode(mode);

const dispatch = (ev) => {
  aquarium.handleEvent(ev);
  overlay.onEvent(ev);
};

// ---- Director link, with an offline fallback --------------------------------------
let local = null;
let localTimer = null;
function goOffline() {
  if (local) return;
  local = new LocalWorld();
  const h = local.hello();
  aquarium.syncWorld(h.world);
  overlay.updateWorld({ population: h.world.fish.length, tod: h.world.tod });
  localTimer = setInterval(() => {
    const s = local.sync();
    aquarium.syncTime(s);
    overlay.updateWorld(s);
    for (const ev of local.tick()) dispatch(ev);
  }, 1000);
  hud.net = 'offline (local world)';
}
function leaveOffline() {
  clearInterval(localTimer);
  local = null;
}

const hud = { net: 'connecting…' };
// Once the Director has been reached, a restart or a network blip must not swap the tank for a
// local placeholder: the fish keep swimming and the clock keeps running until the link is back.
let everOnline = false;
const net = new Net({
  role: embed ? 'preview' : 'renderer',
  token: qs.get('token') ?? '',
  onMessage(msg) {
    switch (msg.t) {
      case 'hello':
        everOnline = true;
        leaveOffline();
        aquarium.syncWorld(msg.world);
        applyMode(msg.mode);
        overlay.updateWorld({ population: msg.world.fish.length, tod: msg.world.tod });
        break;
      case 'world':
        aquarium.syncTime(msg);
        overlay.updateWorld(msg);
        break;
      case 'event':
        dispatch(msg);
        break;
      case 'meters':
        overlay.updateMeters(msg);
        break;
      case 'mode':
        applyMode(msg.mode);
        break;
      default:
        break;
    }
  },
  onStatus(s) {
    hud.net = s;
    if (s !== 'online' && !net.connected && !everOnline) setTimeout(() => { if (!net.connected && !everOnline) goOffline(); }, 2500);
  },
});
// The test chat panel: never inside OBS (it injects window.obsstudio), never in the admin preview.
const showChat = !window.obsstudio && !embed && qs.get('chat') !== '0';
const chatRoot = document.getElementById('chat');

// Standalone demo (e.g. a shared link without a server): the real Director runs in the page.
const demoMode = qs.get('demo') === '1' || window.AQUARIUM_DEMO === true;
let demo = null;
if (demoMode) {
  const [{ startDemo }, { mountChatPanel }] = await Promise.all([import('./demo.js'), import('./chat-panel.js')]);
  demo = startDemo({
    onHello(h) {
      aquarium.syncWorld(h.world);
      applyMode(h.mode);
      overlay.updateWorld({ population: h.world.fish.length, tod: h.world.tod });
    },
    onEvent: dispatch,
    onWorld(w) {
      aquarium.syncTime(w);
      overlay.updateWorld(w);
    },
    onMeters: (m) => overlay.updateMeters(m),
    onChat: (c) => chatPanel?.push(c),
  });
  const backend = {
    ...demo,
    setMode(m) {
      demo.setMode(m);
      applyMode(m);
    },
  };
  chatPanel = mountChatPanel(chatRoot, backend, {
    subtitle: 'Пишут фейковые зрители и вы. У каждого сообщения видно, что понял парсер и что решил режиссёр.',
    audio,
  });
  chatPanel.setView(mode);
  hud.net = 'demo: director runs in the browser';
} else if (qs.get('offline') === '1') goOffline();
else {
  net.connect();
  if (showChat) {
    const [{ mountChatPanel }, { serverChatBackend }] = await Promise.all([import('./chat-panel.js'), import('./chat-server.js')]);
    const backend = serverChatBackend({
      token: qs.get('token') ?? '',
      onLog: (list) => chatPanel?.replace(list),
      onMode: (m) => chatPanel?.setView(m),
    });
    chatPanel = mountChatPanel(chatRoot, backend, {
      subtitle: 'Сообщения из YouTube, от фейковых зрителей и ваши. У каждого видно, что понял парсер и что решил режиссёр.',
      collapsed: mode === 'tv',
    });
    chatPanel.setView(mode);
    setTimeout(() => {
      if (!backend.connected) chatPanel.notice('Нет связи с чатом сервера. Если на сервере задан ADMIN_TOKEN, откройте страницу с ?token=…');
    }, 4000);
  }
}

// Heartbeat: frames actually drawn since the last one, so a frozen render loop shows up as 0 fps.
let hbFrames = aquarium.frames;
let hbAt = performance.now();
setInterval(() => {
  const now = performance.now();
  net.send({
    t: 'hb', frames: aquarium.frames - hbFrames, ms: Math.round(now - hbAt),
    fish: aquarium.fish.count, size: `${aquarium.width}x${aquarium.height}`, quality: opts.quality,
  });
  hbFrames = aquarium.frames;
  hbAt = now;
}, 2000);

// ---- keyboard: quick manual triggers for testing -------------------------------------
const KEYS = { f: 'feed', s: 'shark', j: 'jellyfish', n: 'night', d: 'day', b: 'bubbles', g: 'golden', a: 'spawn' };
async function trigger(kind) {
  if (demo) {
    demo.trigger(kind);
    return;
  }
  if (local) {
    const ev = local.trigger(kind);
    if (ev) dispatch(ev);
    return;
  }
  try {
    const res = await fetch('/api/admin/trigger', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': qs.get('token') ?? '' },
      body: JSON.stringify({ kind }),
    });
    if (res.ok) return;
  } catch { /* fall through */ }
  // No admin rights on the Director: play the visual locally only.
  const preview = new LocalWorld().trigger(kind);
  if (preview && !['night', 'day', 'spawn'].includes(kind)) dispatch(preview);
}

const hudEl = document.getElementById('hud');
let hudOn = qs.get('debug') === '1';
hudEl.classList.toggle('hidden', !hudOn);
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const k = e.key.toLowerCase();
  if (KEYS[k]) trigger(KEYS[k]);
  if (k === 'h') { hudOn = !hudOn; hudEl.classList.toggle('hidden', !hudOn); }
  if (k === 'o') overlay.setVisible(!overlay.visible);
  if (k === 'c') {
    const styles = ['static', 'drift', 'cinematic'];
    aquarium.rig.setStyle(styles[(styles.indexOf(aquarium.rig.style) + 1) % styles.length]);
  }
});
setInterval(() => {
  if (!hudOn) return;
  const tod = aquarium.tod;
  const hh = Math.floor(tod * 24), mm = Math.floor((tod * 24 * 60) % 60);
  hudEl.textContent = [
    `${aquarium.fps.toFixed(0)} fps · ${aquarium.width}×${aquarium.height} @${aquarium.pixelRatio.toFixed(2)}x · q=${opts.quality}`,
    `fish ${aquarium.fish.count} · jellies ${aquarium.jellies.count} · bubbles ${aquarium.bubbles.n} · food ${aquarium.food.count}`,
    `tank time ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · view ${mode} · camera ${aquarium.rig.style}`,
    `director: ${hud.net} · sound: ${audio.running ? 'on' : 'off'}`,
    'keys: F feed · S shark · J jelly · N night · D day · B bubbles · G golden · A fish · C camera · O overlay · H hud',
  ].join('\n');
}, 500);

// ---- sound: autoplay works in OBS / headless; browsers need one click -----------------
const hint = document.getElementById('sound-hint');
async function unlock() {
  const ok = await audio.start();
  hint.classList.toggle('hidden', ok || audio.muted);
  if (ok) {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  }
}
// In the demo the panel owns the sound button; elsewhere any click turns sound on.
if (!demoMode) {
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  unlock();
  setTimeout(() => hint.classList.add('faded'), 12000);
}

aquarium.start();
