// Control panel. All server-provided text goes through textContent.

const qs = new URLSearchParams(location.search);
const token = qs.get('token') ?? '';
const $ = (id) => document.getElementById(id);

const LABEL = {
  feed: '🍤 Кормление', shark: '🦈 Акула', night: '🌙 Ночь', day: '☀️ День', bubbles: '🫧 Пузыри',
  wish: '✨ Желание (золотая рыбка)', jellyfish: '🪼 Медузы', spawn: '🐠 !fish', myfish: '🔎 !myfish',
};
const EVENT_LABEL = {
  feed: '🍤 кормление', shark: '🦈 акула', night: '🌙 ночь', day: '☀️ день', bubbles: '🫧 пузыри',
  golden: '✨ золотая рыбка', jellyfish: '🪼 медузы', fish_add: '🐠 новая рыба', fish_remove: '👋 рыба ушла', spotlight: '🔎 показ рыбы',
};
const REASON = {
  dup: 'повтор голоса', user_rate: 'лимит зрителя', mode: 'не в этом режиме', already: 'уже так',
  user_cooldown: 'личный кулдаун', has_fish: 'уже есть рыба', no_fish: 'нет своей рыбы', queue_full: 'очередь полна',
  full: 'аквариум полон', unknown: 'неизвестно', expired: 'просрочено', failed: 'ошибка',
};
const QUICK = ['SHARK', '🦈', 'покормите рыбок', 'ночь', 'day', 'bubbles', 'wish', 'медуза', '!fish clownfish', '!myfish',
  'good night everyone', 'can we get something scary?', 'shrak'];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

const time = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour12: false });
const dur = (ms) => {
  if (!ms) return '';
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} с`;
};

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-admin-token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function flash(btn) {
  btn.classList.add('ok');
  setTimeout(() => btn.classList.remove('ok'), 600);
}

// ---- controls -----------------------------------------------------------------------
const tokenQ = token ? `&token=${encodeURIComponent(token)}` : '';
$('preview').src = `/?embed=1&q=low&overlay=0${tokenQ}`;
$('link-interactive').href = '/?mode=interactive';
$('link-tv').href = '/?mode=tv';

$('triggers').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  try {
    await api('/api/admin/trigger', { kind: btn.dataset.kind });
    flash(btn);
  } catch (err) { alert(err.message); }
});
$('spawn').addEventListener('click', async (e) => {
  try {
    await api('/api/admin/trigger', { kind: 'spawn', species: $('spawn-species').value });
    flash(e.target);
  } catch (err) { alert(err.message); }
});

for (const mode of ['interactive', 'tv']) {
  $(`mode-${mode}`).addEventListener('click', () => api('/api/admin/mode', { mode }).catch((err) => alert(err.message)));
}

async function sendChat(text) {
  const user = $('chat-user').value.trim() || 'Tester';
  try {
    const r = await api('/api/chat', { user, text });
    const e = r.entry ?? {};
    $('chat-result').textContent = e.intent
      ? `Понял как «${LABEL[e.intent] ?? e.intent}»${e.species && e.species !== 'any' ? ` (${e.species})` : ''} через ${e.via}: ${e.result}`
      : e.via === 'ai…' ? 'Правила не поняли — отправлено AI-парсеру…' : 'Не команда (обычный чат)';
  } catch (err) { $('chat-result').textContent = err.message; }
}
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chat-text').value.trim();
  if (!text) return;
  sendChat(text);
  $('chat-text').value = '';
});
for (const q of QUICK) {
  const b = el('button', 'chip', q);
  b.type = 'button';
  b.addEventListener('click', () => sendChat(q));
  $('quick').append(b);
}

$('sim-start').addEventListener('click', () => api('/api/admin/sim', { action: 'start', scenario: $('sim-scenario').value, viewers: Number($('sim-viewers').value) || undefined }));
$('sim-stop').addEventListener('click', () => api('/api/admin/sim', { action: 'stop' }));
$('raid').addEventListener('click', () => api('/api/admin/sim', { action: 'raid', intent: $('raid-intent').value, viewers: Number($('raid-viewers').value) || 1000, durationMs: 20000 }));

$('yt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  api('/api/admin/youtube', { action: 'start', videoId: $('yt-video').value.trim() || undefined }).catch((err) => alert(err.message));
});
$('yt-stop').addEventListener('click', () => api('/api/admin/youtube', { action: 'stop' }));

// ---- live status ------------------------------------------------------------------------
function pill(text, state) {
  const p = el('span', `pill ${state}`, text);
  return p;
}

function kv(root, rows) {
  root.replaceChildren(...rows.map(([k, v]) => {
    const r = el('div', 'kv-row');
    r.append(el('span', 'k', k), el('span', 'v', v === undefined || v === null || v === '' ? '—' : String(v)));
    return r;
  }));
}

function render(s) {
  const r0 = s.renderers[0];
  const ytState = { live: 'ok', waiting: 'warn', resolving: 'warn', disabled: 'off', stopped: 'off', idle: 'off' }[s.youtube.state] ?? 'bad';
  $('pills').replaceChildren(
    pill('● сервер', 'ok'),
    pill(s.renderers.length ? `рендер ×${s.renderers.length}${r0?.fps ? ` · ${r0.fps} fps` : ''}` : 'рендер не подключён', s.renderers.length ? 'ok' : 'bad'),
    pill(`YouTube: ${s.youtube.state}`, ytState),
    pill(s.ai.enabled ? `AI: ${s.ai.model}` : 'AI: выключен', s.ai.enabled ? 'ok' : 'off'),
    pill(`${s.world.isNight ? '🌙' : '☀️'} ${String(Math.floor(s.world.tod * 24)).padStart(2, '0')}:${String(Math.floor((s.world.tod * 1440) % 60)).padStart(2, '0')}`, 'off'),
  );
  $('mode-interactive').classList.toggle('active', s.mode === 'interactive');
  $('mode-tv').classList.toggle('active', s.mode === 'tv');
  $('preview-note').textContent = `· ${s.world.population} рыб`;

  // meters
  $('active').textContent = `· активных в чате: ${s.director.active}`;
  $('meters').replaceChildren(...s.director.meters.map((m) => {
    const tr = el('tr', m.enabled ? '' : 'off');
    const bar = el('div', 'bar');
    const fill = el('div', 'fill');
    let text = '';
    if (m.kind === 'vote' || m.kind === 'meter') {
      fill.style.width = `${Math.min(100, (m.voice / (m.need || 1)) * 100)}%`;
      text = `${m.voice}/${m.need}`;
    } else {
      fill.style.width = '0%';
      text = m.queued ? `в очереди ${m.queued}` : '';
    }
    bar.append(fill);
    const state = !m.enabled ? 'выкл. в этом режиме' : m.blocked === 'already' ? 'уже так' : m.cooldownMs ? `кулдаун ${dur(m.cooldownMs)}` : 'готово';
    const td = (x, cls) => { const c = el('td', cls); if (x instanceof Node) c.append(x); else c.textContent = x; return c; };
    tr.append(td(LABEL[m.intent] ?? m.intent), td(bar, 'w'), td(text, 'num'), td(state, 'dim'));
    return tr;
  }));

  // stats
  const st = s.director.stats;
  const cards = [
    ['сообщений/с', s.chat.perSec],
    ['всего сообщений', s.world.stats.messages],
    ['зрителей всего', s.world.stats.viewers],
    ['голосов принято', st.accepted],
    ['событий', Object.values(s.world.stats.events).reduce((a, b) => a + b, 0)],
    ['рыб', s.world.population],
  ];
  $('stats').replaceChildren(...cards.map(([k, v]) => {
    const c = el('div', 'stat');
    c.append(el('div', 'stat-v', String(v)), el('div', 'stat-k', k));
    return c;
  }));
  const rej = Object.entries(st.rejected).sort((a, b) => b[1] - a[1]).map(([k, v]) => [`отклонено: ${REASON[k] ?? k}`, v]);
  const ev = Object.entries(s.world.stats.events).map(([k, v]) => [EVENT_LABEL[k] ?? k, v]);
  kv($('rejects'), [...rej, ...ev]);

  // events
  $('events').replaceChildren(...[...s.events].reverse().map((e) => {
    const li = el('li');
    const by = e.by ?? {};
    const who = by.admin ? 'админ' : by.system ? 'авто' : by.count > 1 ? `${by.count} зрителей (${(by.names ?? []).join(', ')}…)` : (by.names ?? [])[0] ?? '';
    li.append(el('span', 'dim', time(e.at)), el('span', null, ` ${EVENT_LABEL[e.kind] ?? e.kind} `), el('span', 'dim', who));
    return li;
  }));

  // chat
  $('chat').replaceChildren(...[...s.chatLog].reverse().slice(0, 40).map((m) => {
    const tr = el('tr');
    const res = m.result ?? '';
    tr.append(
      el('td', 'dim', time(m.at)),
      el('td', `src ${m.source}`, m.source),
      el('td', 'user', m.user),
      el('td', 'text', m.text),
      el('td', m.intent ? 'intent' : 'dim', m.intent ? `${m.intent}${m.species && m.species !== 'any' ? `:${m.species}` : ''} · ${m.via}` : m.via ?? ''),
      el('td', res.startsWith('✗') ? 'bad' : 'good', res.startsWith('✗') ? `✗ ${REASON[res.slice(2)] ?? res.slice(2)}` : res),
    );
    return tr;
  }));

  // youtube / ai / sim
  const y = s.youtube;
  kv($('yt'), [
    ['состояние', y.state], ['авторизация', y.auth], ['видео', y.videoId], ['чат', y.liveChatId],
    ['квота сегодня', `${y.quotaUsed} / ${y.quotaLimit}`], ['опросов', y.polls], ['сообщений', y.messages],
    ['следующий опрос', y.nextPollInMs !== null ? dur(y.nextPollInMs) : ''],
    ['задержка чата', y.lastDelayMs !== null ? `${(y.lastDelayMs / 1000).toFixed(1)} с` : ''], ['ошибка', y.lastError],
  ]);
  const a = s.ai;
  kv($('ai'), [
    ['состояние', a.enabled ? (a.pausedMs ? `пауза ${dur(a.pausedMs)}` : a.busy ? 'работает' : 'готов') : 'выключен (нет ANTHROPIC_API_KEY)'],
    ['модель', a.model], ['потрачено сегодня', `$${a.spentTodayUsd} / $${a.budgetUsd}`], ['вызовов', a.calls],
    ['распознано сообщений', a.classified], ['из кэша', a.cacheHits], ['из них команд', a.requests], ['задержка', a.lastLatencyMs ? `${a.lastLatencyMs} мс` : ''],
    ['отброшено', Object.entries(a.dropped).map(([k, v]) => `${k}: ${v}`).join(', ')], ['ошибка', a.lastError],
  ]);
  const sm = s.sim;
  $('sim-status').textContent = sm.running
    ? `идёт: ${sm.scenario ?? '—'} · зрителей ${sm.viewers}${sm.raiders ? ` · рейд ${sm.raiders} (${dur(sm.raidLeftMs)})` : ''} · отправлено ${sm.sent}`
    : `остановлен · отправлено ${sm.sent}`;

  // owned fish
  $('owned').replaceChildren(...(s.world.owned.length ? s.world.owned : []).slice().reverse().map((f) => {
    const li = el('li');
    const btn = el('button', 'ghost small', 'убрать');
    btn.addEventListener('click', () => {
      if (confirm(`Убрать рыбу «${f.name}»?`)) api('/api/admin/fish/remove', { fishId: f.id }).catch((err) => alert(err.message));
    });
    li.append(el('span', null, `${f.name ?? 'без имени'} · ${f.species}`), btn);
    return li;
  }));
  if (!s.world.owned.length) $('owned').append(el('li', 'dim', 'Пока никто не завёл свою рыбу (команда !fish)'));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?role=admin${tokenQ}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.t === 'status') render(msg);
  };
  ws.onclose = (e) => {
    $('pills').replaceChildren(pill(e.code === 4401 ? 'нужен токен: /admin?token=…' : 'нет связи с сервером…', 'bad'));
    setTimeout(connect, 2000);
  };
}
connect();
