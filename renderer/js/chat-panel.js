// Test chat next to the aquarium: a live-chat style feed (every message and what
// the parser made of it), a box to write as a viewer, fake viewers, a raid and
// host buttons. Operator tool - it is never part of the stream picture.
// Works with any backend that has: say, crowd, raid, trigger, status, setMode.
// Viewer-provided text is always inserted with textContent.

const TRIGGERS = [
  ['feed', '🍤', 'Покормить'], ['shark', '🦈', 'Акула'], ['jellyfish', '🪼', 'Медузы'], ['bubbles', '🫧', 'Пузыри'],
  ['night', '🌙', 'Ночь'], ['day', '☀️', 'День'], ['golden', '✨', 'Золотая рыбка'], ['spawn', '🐠', 'Новая рыба'],
];
const SAMPLES = ['SHARK', 'shrak', '🦈🦈', 'покормите рыбок', 'ночь', '!fish clownfish', 'good night everyone', 'no more sharks'];
const ICON = { feed: '🍤', shark: '🦈', night: '🌙', day: '☀️', bubbles: '🫧', wish: '✨', jellyfish: '🪼', spawn: '🐠', myfish: '🔎' };
const VERDICT = {
  vote: 'голос', queued: 'рыба в очереди', luck: '+1 к удаче', admin: 'ведущий',
  '✗ dup': 'уже голосовал', '✗ user_rate': 'слишком часто', '✗ mode': 'не в ТВ-режиме', '✗ already': 'уже так',
  '✗ user_cooldown': 'личный кулдаун', '✗ has_fish': 'уже есть рыба', '✗ no_fish': 'нет своей рыбы',
  '✗ queue_full': 'очередь полна', '✗ full': 'аквариум полон', 'low confidence': 'AI не уверен',
};
const NAME_COLORS = ['#9fdcff', '#ffc38a', '#b9f5a4', '#f5a8d4', '#d7c2ff', '#ffe28a', '#8ff0e0', '#ffb3a8'];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, cls = '') {
  const b = el('button', `chat-btn ${cls}`.trim(), label);
  b.type = 'button';
  return b;
}

function nameColor(name = '') {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

function tagFor({ intent, result, via }) {
  if (via === 'ai…') return { text: 'AI думает…', cls: 'wait' };
  if (!intent) return via === 'ai' ? { text: 'AI: не команда', cls: 'dim' } : null;
  const r = String(result ?? '');
  return { text: `${ICON[intent] ?? ''} ${VERDICT[r] ?? r}`.trim(), cls: r.startsWith('✗') || r === 'low confidence' ? 'rej' : 'ok' };
}

let savedCollapsed = null;
try { savedCollapsed = localStorage.getItem('aq.chat.collapsed'); } catch { /* storage may be blocked */ }

/**
 * @param {HTMLElement} root   container (.chat-dock)
 * @param {object} backend     { say(user, text), crowd(on, n), raid(intent, n), trigger(kind), status(), setMode(mode) }
 * @param {object} opts        { subtitle, audio?, collapsed? }
 */
export function mountChatPanel(root, backend, { subtitle = '', audio = null, collapsed = false } = {}) {
  const panel = el('section', 'chat');
  panel.setAttribute('aria-label', 'Чат');

  const head = el('header', 'chat-h');
  const headText = el('div');
  headText.append(el('div', 'chat-title', '💬 Чат'), el('div', 'chat-sub', subtitle));
  const hide = button('Скрыть', 'ghost');
  head.append(headText, hide);

  const feed = el('ol', 'chat-feed');
  feed.setAttribute('aria-live', 'polite');
  const empty = el('div', 'chat-empty', 'Здесь появятся сообщения. Напишите что-нибудь или запустите фейковых зрителей.');

  const form = el('form', 'chat-say');
  const name = el('input', 'chat-name');
  name.id = 'chat-name';
  name.value = 'Вы';
  name.maxLength = 24;
  name.setAttribute('aria-label', 'Имя зрителя');
  const input = el('input', 'chat-text');
  input.id = 'chat-text';
  input.placeholder = 'Напишите как зритель: покормите рыбок';
  input.autocomplete = 'off';
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Сообщение в чат');
  const send = el('button', 'chat-btn primary', 'Отправить');
  send.type = 'submit';
  form.append(name, input, send);

  const samples = el('div', 'chat-samples');
  for (const s of SAMPLES) {
    const b = button(s, 'chip');
    b.addEventListener('click', () => say(s));
    samples.append(b);
  }

  const crowdRow = el('div', 'chat-row');
  const crowd = button('▶ Фейковые зрители · 40');
  const raid = button('Рейд: 1000 × SHARK', 'danger');
  crowdRow.append(crowd, raid);
  const simStatus = el('div', 'chat-status');

  const host = el('details', 'chat-host');
  const summary = el('summary');
  summary.append(el('span', null, 'Кнопки ведущего'), el('span', 'chat-hint', 'без ограничений'));
  const grid = el('div', 'chat-grid');
  for (const [kind, icon, label] of TRIGGERS) {
    const b = button(`${icon} ${label}`);
    b.addEventListener('click', () => backend.trigger(kind));
    grid.append(b);
  }
  host.append(summary, grid);

  const viewRow = el('div', 'chat-row');
  const seg = el('div', 'chat-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Режим');
  const views = ['interactive', 'tv'].map((v) => {
    const b = button(v === 'tv' ? 'ТВ-режим' : 'Интерактив');
    b.dataset.view = v;
    b.addEventListener('click', () => backend.setMode(v));
    seg.append(b);
    return b;
  });
  viewRow.append(seg);
  let sound = null;
  if (audio) {
    sound = button('🔈 Звук выкл');
    viewRow.append(sound);
  }

  panel.append(head, feed, empty, form, samples, crowdRow, simStatus, host, viewRow);
  const open = button('💬 Чат', 'chat-open');
  root.replaceChildren(panel, open);

  const setCollapsed = (c, remember = false) => {
    panel.hidden = c;
    open.hidden = !c;
    document.body.classList.toggle('chat-open', !c);
    if (remember) {
      try { localStorage.setItem('aq.chat.collapsed', c ? '1' : '0'); } catch { /* ignore */ }
    }
  };
  hide.addEventListener('click', () => setCollapsed(true, true));
  open.addEventListener('click', () => {
    setCollapsed(false, true);
    input.focus();
  });
  const narrow = window.matchMedia('(max-width: 700px)').matches;
  setCollapsed(collapsed || narrow || savedCollapsed === '1');

  function say(text) {
    const user = name.value.trim() || 'Вы';
    Promise.resolve(backend.say(user, text)).catch(() => {
      entries.push({ user: 'система', text: 'Сообщение не отправлено: нет связи с сервером.', intent: null, system: true });
      dirty = true;
    });
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    say(text);
    input.value = '';
  });

  // The button follows the real simulator state; right after a click the server's status still
  // lags a second behind, so the intended state is shown until it catches up.
  let pending = null;
  const crowdOn = () => (pending && performance.now() < pending.until ? pending.on : Boolean(backend.status()?.viewers));
  const showCrowd = () => { crowd.textContent = crowdOn() ? '■ Остановить зрителей' : '▶ Фейковые зрители · 40'; };
  crowd.addEventListener('click', () => {
    const on = !crowdOn();
    pending = { on, until: performance.now() + 2500 };
    backend.crowd(on, 40);
    showCrowd();
  });
  raid.addEventListener('click', () => backend.raid('shark', 1000));

  if (sound) {
    let soundOn = false;
    sound.addEventListener('click', async () => {
      soundOn = !soundOn;
      if (soundOn) {
        await audio.start();
        audio.setVolume(0.8);
      } else audio.setVolume(0);
      sound.textContent = soundOn && audio.running ? '🔊 Звук вкл' : '🔈 Звук выкл';
    });
  }

  setInterval(() => {
    const s = backend.status() ?? {};
    showCrowd();
    const parts = [];
    if (s.viewers) parts.push(`${s.viewers} зрителей пишут`);
    if (s.raiders) parts.push(`рейд: ${s.raiders.toLocaleString('ru-RU')} пишут SHARK, ещё ${Math.ceil(s.raidLeftMs / 1000)} с`);
    simStatus.textContent = parts.length
      ? `${parts.join(' · ')} · сообщений: ${(s.sent ?? 0).toLocaleString('ru-RU')}`
      : 'Фейковых зрителей нет. Аквариум живёт сам.';
  }, 500);

  // Hundreds of messages per second during a raid: keep the newest and redraw 4 times a second.
  let entries = [];
  let dirty = false;
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    feed.replaceChildren(...entries.map((m) => {
      const li = el('li', m.system ? 'sys' : '');
      const who = el('span', `who${m.source === 'youtube' ? ' yt' : ''}`, m.user);
      if (!m.system) who.style.color = nameColor(m.user);
      li.append(who, el('span', 'txt', m.text));
      const tag = tagFor(m);
      if (tag) li.append(el('span', `tag ${tag.cls}`, tag.text));
      return li;
    }));
    empty.hidden = entries.length > 0;
    if (atBottom) feed.scrollTop = feed.scrollHeight;
  }, 250);

  return {
    /** One new message (demo backend). */
    push(entry) {
      entries.push(entry);
      if (entries.length > 60) entries = entries.slice(-60);
      dirty = true;
    },
    /** The latest messages as the server sees them (server backend). */
    replace(list) {
      entries = list.slice(-60);
      dirty = true;
    },
    setView(mode) {
      for (const b of views) b.setAttribute('aria-pressed', String(b.dataset.view === mode));
    },
    notice(text) {
      entries.push({ user: 'система', text, system: true });
      dirty = true;
    },
  };
}
