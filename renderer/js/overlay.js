// Viewer-facing overlay for the interactive stream (hidden in TV mode).
// All viewer-provided text (names) is inserted with textContent, never as HTML.

const SPECIES_LABEL = {
  chromis: 'Chromis', clownfish: 'Clownfish', tang: 'Blue Tang', yellowtang: 'Yellow Tang',
  gramma: 'Royal Gramma', cardinal: 'Cardinalfish', golden: 'Golden Fish', shark: 'Reef Shark',
};

const CHIPS = [
  { intent: 'feed', label: 'FEED', icon: '🍤' },
  { intent: 'shark', label: 'SHARK', icon: '🦈' },
  { intent: 'jellyfish', label: 'JELLY', icon: '🪼' },
  { intent: 'night', label: 'NIGHT', icon: '🌙' },
  { intent: 'day', label: 'DAY', icon: '☀️' },
  { intent: 'bubbles', label: 'BUBBLES', icon: '🫧' },
  { intent: 'wish', label: 'WISH', icon: '✨' },
  { intent: 'spawn', label: '!fish', icon: '🐠', hint: 'get your own fish' },
];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function byline(by = {}) {
  if (by.admin) return 'The host';
  if (by.system) return 'The caretaker';
  const names = by.names ?? [];
  const count = by.count ?? names.length;
  if (count <= 0) return 'Chat';
  if (count === 1) return names[0] ?? 'Someone';
  if (count === 2 && names.length >= 2) return `${names[0]} & ${names[1]}`;
  return `${names[0] ?? 'Chat'} + ${count - 1} others`;
}

const ageText = (ms) => {
  const h = ms / 3600000;
  if (h < 1) return 'just hatched';
  if (h < 24) return `${Math.floor(h)} h old`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} old`;
};

export class Overlay {
  constructor(root, aquarium) {
    this.root = root;
    this.aq = aquarium;
    this.visible = true;
    this.labels = new Map();
    this.meters = new Map();
    this.build();
  }

  build() {
    const r = this.root;
    r.replaceChildren();
    const tl = el('div', 'ov-top-left');
    const brand = el('div', 'ov-brand');
    brand.append(el('span', 'ov-live-dot'), el('span', null, 'LIVE AQUARIUM'));
    this.stats = el('div', 'ov-stats');
    this.stFish = el('span', null, '🐟 —');
    this.stTime = el('span', null, '☀️ Day');
    this.stChat = el('span', null, '💬 0');
    this.stats.append(this.stFish, this.stTime, this.stChat);
    tl.append(brand, this.stats);

    this.feed = el('div', 'ov-feed');
    this.announce = el('div', 'ov-announce');
    this.labelLayer = el('div', 'ov-labels');

    const bottom = el('div', 'ov-bottom');
    bottom.append(el('div', 'ov-howto', 'Type in chat to control the aquarium'));
    const chips = el('div', 'ov-chips');
    for (const c of CHIPS) {
      const chip = el('div', 'ov-chip');
      chip.dataset.intent = c.intent;
      const fill = el('div', 'ov-chip-fill');
      const icon = el('span', 'ov-chip-icon', c.icon);
      const label = el('span', 'ov-chip-label', c.label);
      const count = el('span', 'ov-chip-count', '');
      chip.append(fill, icon, label, count);
      chips.append(chip);
      this.meters.set(c.intent, { chip, fill, count });
    }
    bottom.append(chips);
    r.append(tl, this.feed, this.announce, this.labelLayer, bottom);
  }

  setVisible(v) {
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
  }

  updateWorld({ population, tod }) {
    if (population !== undefined) this.stFish.textContent = `🐟 ${population}`;
    if (tod !== undefined) {
      const night = tod < 0.23 || tod > 0.77;
      const dusk = !night && (tod < 0.3 || tod > 0.7);
      this.stTime.textContent = night ? '🌙 Night' : dusk ? '🌅 Twilight' : '☀️ Day';
    }
  }

  updateMeters(msg) {
    if (msg.active !== undefined) this.stChat.textContent = `💬 ${msg.active}`;
    if (msg.population !== undefined) this.stFish.textContent = `🐟 ${msg.population}`;
    for (const m of msg.meters ?? []) {
      const ui = this.meters.get(m.intent);
      if (!ui) continue;
      const disabled = !m.enabled || m.blocked === 'already';
      ui.chip.classList.toggle('disabled', disabled);
      const cooling = m.cooldownMs > 0;
      ui.chip.classList.toggle('cooling', cooling);
      let frac = 0;
      let text = '';
      if (m.kind === 'vote') {
        frac = m.need ? Math.min(1, m.voice / m.need) : 0;
        text = cooling ? `${Math.ceil(m.cooldownMs / 1000)}s` : m.need > 1 ? `${m.count}/${m.need}` : '';
      } else if (m.kind === 'meter') {
        frac = m.need ? Math.min(1, m.voice / m.need) : 0;
        text = cooling ? `${Math.ceil(m.cooldownMs / 1000)}s` : `${m.voice}/${m.need}`;
      } else {
        text = m.queued ? `+${m.queued}` : '';
      }
      if (m.blocked === 'already') text = 'now';
      ui.fill.style.transform = `scaleX(${cooling ? 0 : frac})`;
      ui.count.textContent = text;
    }
  }

  toast(icon, text, accent = '') {
    const t = el('div', `ov-toast ${accent}`);
    t.append(el('span', 'ov-toast-icon', icon), el('span', 'ov-toast-text', text));
    this.feed.prepend(t);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => t.classList.add('out'), 9000);
    setTimeout(() => t.remove(), 10000);
  }

  big(text, sub = '', accent = '') {
    const a = el('div', `ov-big ${accent}`);
    a.append(el('div', 'ov-big-title', text));
    if (sub) a.append(el('div', 'ov-big-sub', sub));
    this.announce.replaceChildren(a);
    setTimeout(() => a.classList.add('out'), 3800);
    setTimeout(() => a.remove(), 4800);
  }

  label(fishId, text, ms = 8000, accent = '') {
    const old = this.labels.get(fishId);
    if (old) old.node.remove();
    const node = el('div', `ov-label ${accent}`, text);
    this.labelLayer.append(node);
    this.labels.set(fishId, { node, until: performance.now() + ms });
  }

  onEvent(ev) {
    const by = ev.by ?? {};
    const p = ev.params ?? {};
    const who = byline(by);
    switch (ev.kind) {
      case 'feed':
        this.toast('🍤', `${who} fed the fish`);
        break;
      case 'bubbles':
        this.toast('🫧', `${who} turned on the bubbles`);
        break;
      case 'shark':
        this.big('🦈 SHARK!', by.count > 1 ? `summoned by ${by.count} viewers` : by.system ? '' : `summoned by ${who}`, 'danger');
        this.toast('🦈', by.count > 1 ? `${by.count} viewers summoned a shark` : `${who} summoned a shark`, 'danger');
        break;
      case 'jellyfish':
        this.big('🪼 JELLYFISH BLOOM', by.count > 1 ? `called by ${by.count} viewers` : '', 'glow');
        this.toast('🪼', by.system ? 'Jellyfish drifted in' : `${who} called the jellyfish`);
        break;
      case 'night':
        this.toast('🌙', `${who} turned the lights down`);
        break;
      case 'day':
        this.toast('☀️', `${who} brought the morning`);
        break;
      case 'golden':
        this.big('✨ THE GOLDEN FISH ✨', by.system ? 'a rare visitor' : by.count > 1 ? `wished for by ${by.count} viewers` : 'chat made a wish', 'gold');
        this.toast('✨', by.system ? 'A golden fish appeared!' : `${who} wished the golden fish`, 'gold');
        break;
      case 'fish_add': {
        const f = p.fish ?? {};
        const sp = SPECIES_LABEL[f.species] ?? 'fish';
        if (p.gift) {
          this.toast('✨', `The golden fish left a gift: a baby ${sp}!`, 'gold');
          setTimeout(() => this.label(f.id, `gift from the golden fish`, 8000, 'spot'), 300);
        } else if (p.born) {
          this.toast('🥚', `A baby ${sp} was born!`);
          setTimeout(() => this.label(f.id, `new baby ${sp}`, 7000), 300);
        } else if (f.name) {
          this.toast('🐠', `${f.name} added a ${sp}`);
          setTimeout(() => this.label(f.id, `${f.name}'s ${sp}`, 9000), 600);
        } else {
          this.toast('🐠', `A new ${sp} joined the reef`);
        }
        break;
      }
      case 'spotlight': {
        const fish = this.aq.fish.byId.get(p.fishId);
        const age = fish ? ageText(Date.now() - fish.bornAt) : '';
        const survived = p.survived > 0 ? ` · survived ${p.survived} shark${p.survived === 1 ? '' : 's'}` : '';
        this.label(p.fishId, `${p.name}'s ${SPECIES_LABEL[p.species] ?? 'fish'}${age ? ' · ' + age : ''}${survived}`, p.durationMs ?? 10000, 'spot');
        break;
      }
      default:
        break;
    }
  }

  /** The shark caught its fish (the renderer calls this at the moment of the bite). */
  onCatch({ name, species }) {
    const sp = SPECIES_LABEL[species] ?? 'fish';
    this.big('🦈 CHOMP!', name ? `${name}'s ${sp} was eaten` : `the shark caught a ${sp}`, 'danger');
    this.toast('🦈', name ? `The shark ate ${name}'s ${sp}. ${name}, type !fish for a new one` : `The shark caught a ${sp}`, 'danger');
  }

  /** Called every frame: keep name labels glued to their fish. */
  frame(camera, width, height) {
    if (!this.labels.size) return;
    const now = performance.now();
    for (const [id, l] of this.labels) {
      const s = this.aq.fish.screenPos(id, camera, width, height);
      if (!s || now > l.until) {
        l.node.classList.add('out');
        if (!s || now > l.until + 800) {
          l.node.remove();
          this.labels.delete(id);
        }
        continue;
      }
      l.node.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -140%)`;
      l.node.style.opacity = s.visible ? '' : '0';
    }
  }
}
