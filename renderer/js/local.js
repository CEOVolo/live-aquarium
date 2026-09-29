// Offline mode: when no Director is reachable (or ?offline=1), the page runs a
// tiny local world so the aquarium still lives - useful for demos and for
// designing the scene without the server.

const SEED = { chromis: 22, clownfish: 4, tang: 3, yellowtang: 3, gramma: 4, cardinal: 6 };
const DAY = 86400000;

export class LocalWorld {
  constructor({ dayLengthMin = 30 } = {}) {
    this.rate = 1 / (dayLengthMin * 60000);
    this.base = 0.42;
    this.at = Date.now();
    this.seq = 0;
    this.fish = [];
    let n = 1;
    for (const [species, count] of Object.entries(SEED)) {
      for (let i = 0; i < count; i++) {
        this.fish.push({ id: `local${n++}`, species, name: null, bornAt: Date.now() - (3 + Math.random() * 10) * DAY, seed: Math.floor(Math.random() * 1e9) });
      }
    }
    this.nextFeed = Date.now() + 60000;
    this.nextBubbles = Date.now() + 25000;
    this.nextGolden = Date.now() + 5 * 60000;
    this.transition = null;
  }

  tod(now = Date.now()) {
    const tr = this.transition;
    if (tr) {
      const k = (now - tr.start) / tr.duration;
      if (k < 1) return (tr.from + tr.delta * k) % 1;
      this.base = (tr.from + tr.delta) % 1;
      this.at = tr.start + tr.duration;
      this.transition = null;
    }
    return (this.base + (now - this.at) * this.rate) % 1;
  }

  todRate(now = Date.now()) {
    const tr = this.transition;
    return tr && now < tr.start + tr.duration ? tr.delta / tr.duration : this.rate;
  }

  hello() {
    const now = Date.now();
    return { mode: null, world: { now, tod: this.tod(now), todRate: this.todRate(now), growth: 0.8, fish: this.fish } };
  }

  sync() {
    const now = Date.now();
    return { now, tod: this.tod(now), todRate: this.todRate(now), population: this.fish.length };
  }

  event(kind, params = {}, by = { count: 0, names: [], system: true }) {
    return { id: ++this.seq, kind, params, by, at: Date.now() };
  }

  /** Keyboard / demo triggers. */
  trigger(kind) {
    const now = Date.now();
    switch (kind) {
      case 'feed': return this.event('feed', { amount: 50, x: (Math.random() - 0.5) * 10 }, { count: 1, names: ['You'] });
      case 'bubbles': return this.event('bubbles', { intensity: 2, durationMs: 12000 }, { count: 1, names: ['You'] });
      case 'shark': {
        const pool = this.fish.filter((f) => f.species !== 'clownfish');
        const victim = pool.length > 12 ? pool[Math.floor(Math.random() * pool.length)] : null;
        if (victim) this.fish = this.fish.filter((f) => f !== victim);
        const v = victim ? { id: victim.id, species: victim.species, name: victim.name } : null;
        return this.event('shark', { durationMs: 45000, victim: v, huntAtMs: 9000 }, { count: 327, names: ['You'] });
      }
      case 'jellyfish': return this.event('jellyfish', { count: 5, durationMs: 90000 }, { count: 1, names: ['You'] });
      case 'golden': return this.event('golden', { durationMs: 90000 }, { count: 52, names: ['You'] });
      case 'night':
      case 'day': {
        const from = this.tod(now);
        const target = kind === 'night' ? 0.9 : 0.34;
        this.transition = { start: now, duration: 20000, from, delta: (target - from + 1) % 1 };
        return this.event(kind, { transitionMs: 20000 }, { count: 1, names: ['You'] });
      }
      case 'spawn': {
        const species = Object.keys(SEED)[Math.floor(Math.random() * 6)];
        const fish = { id: `local${Date.now()}`, species, name: 'You', bornAt: now, seed: Math.floor(Math.random() * 1e9) };
        this.fish.push(fish);
        return this.event('fish_add', { fish, born: false }, { count: 1, names: ['You'] });
      }
      default: return null;
    }
  }

  tick(now = Date.now()) {
    const out = [];
    if (now > this.nextFeed) {
      this.nextFeed = now + 4 * 60000;
      out.push(this.event('feed', { amount: 44, x: (Math.random() - 0.5) * 8 }));
    }
    if (now > this.nextBubbles) {
      this.nextBubbles = now + (3 + Math.random() * 4) * 60000;
      out.push(this.event('bubbles', { intensity: 1.2, durationMs: 10000 }));
    }
    if (now > this.nextGolden) {
      this.nextGolden = now + (20 + Math.random() * 30) * 60000;
      out.push(this.event('golden', { durationMs: 90000 }));
    }
    return out;
  }
}
