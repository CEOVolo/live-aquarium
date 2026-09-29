import fs from 'node:fs';
import path from 'node:path';
import { SPAWNABLE } from './catalog.js';

const DAY_MS = 86400000;
const INACTIVE_OWNER_MS = 7 * DAY_MS;
const frac = (x) => x - Math.floor(x);

// Time of day: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
export const NIGHT_TARGET = 0.9;
export const DAY_TARGET = 0.34;
export const isNightTod = (tod) => tod < 0.23 || tod > 0.77;

const SEED_POPULATION = { chromis: 22, clownfish: 4, tang: 3, yellowtang: 3, gramma: 4, cardinal: 6 };

/**
 * Persistent aquarium state: who lives in the tank, what time it is there, how
 * much luck chat has gathered, statistics. Survives restarts (data/world.json).
 * Positions of fish are NOT persisted - they are the renderer's business.
 */
export class World {
  constructor({ dataDir, dayLengthMin = 30, populationCap = 140, clock = Date.now, rng = Math.random } = {}) {
    this.file = dataDir ? path.join(dataDir, 'world.json') : null;
    this.dayLengthMs = dayLengthMin * 60000;
    this.populationCap = populationCap;
    this.clock = clock;
    this.rng = rng;
    this.dirty = false;
    this.transition = null;
    this.todBase = 0.36;
    this.todAt = clock();
    this.state = this.freshState();
    this.viewers = new Set();
  }

  freshState() {
    return {
      version: 1,
      createdAt: this.clock(),
      tod: 0.36,
      fish: [],
      nextFishId: 1,
      luck: 0,
      growth: 0.55,
      lastFedAt: this.clock(),
      stats: { messages: 0, votes: 0, events: {}, viewers: 0 },
      viewersSeen: [],
      top: {},
      history: [],
    };
  }

  load() {
    if (this.file && fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (saved?.version !== 1 || !Array.isArray(saved.fish)) throw new Error(`unsupported world file (version ${saved?.version})`);
        const fresh = this.freshState();
        this.state = {
          ...fresh,
          ...saved,
          stats: { ...fresh.stats, ...(saved.stats ?? {}), events: { ...(saved.stats?.events ?? {}) } },
          fish: saved.fish.filter((f) => SPAWNABLE.includes(f.species)),
        };
      } catch (err) {
        // A corrupt or unknown file must not kill the stream: keep it for inspection and start fresh.
        const bad = `${this.file}.corrupt-${this.clock()}`;
        fs.renameSync(this.file, bad);
        console.warn(`[world] could not read ${this.file} (${err.message}); moved to ${bad}`);
      }
    }
    this.viewers = new Set(this.state.viewersSeen);
    // Owners from older save files get a fresh grace period.
    for (const f of this.state.fish) if (f.ownerId && !f.seenAt) f.seenAt = this.clock();
    this.todBase = this.state.tod;
    this.todAt = this.clock();
    if (this.state.fish.length === 0) this.seed();
    return this;
  }

  save() {
    if (!this.file) return;
    // Mid fast-forward, save where the skip ends so a restart does not undo a chat NIGHT/DAY.
    const tr = this.transition;
    this.state.tod = tr ? frac(tr.from + tr.delta) : this.tod();
    this.state.viewersSeen = [...this.viewers].slice(-20000);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }

  seed() {
    const now = this.clock();
    for (const [species, n] of Object.entries(SEED_POPULATION)) {
      for (let i = 0; i < n; i++) this.addFish({ species, bornAt: now - (3 + this.rng() * 20) * DAY_MS });
    }
  }

  // ---- time of day -------------------------------------------------------
  get rate() { return 1 / this.dayLengthMs; }

  tod(now = this.clock()) {
    const tr = this.transition;
    if (tr) {
      const k = (now - tr.start) / tr.duration;
      if (k < 1) return frac(tr.from + tr.delta * Math.max(0, k));
      this.todBase = frac(tr.from + tr.delta);
      this.todAt = tr.start + tr.duration;
      this.transition = null;
      this.dirty = true;
    }
    return frac(this.todBase + (now - this.todAt) * this.rate);
  }

  // Current speed of the clock (fraction of a day per ms) - lets the renderer extrapolate.
  todRate(now = this.clock()) {
    const tr = this.transition;
    if (tr && now < tr.start + tr.duration) return tr.delta / tr.duration;
    return this.rate;
  }

  isNight(now = this.clock()) { return isNightTod(this.tod(now)); }

  /** Fast-forward the clock (always forward, like a real day) to night or day. */
  skipTo(phase, now = this.clock(), duration = 20000) {
    const from = this.tod(now);
    const target = phase === 'night' ? NIGHT_TARGET : DAY_TARGET;
    const delta = frac(target - from);
    this.transition = { start: now, duration, from, delta };
    this.dirty = true;
    return { target, transitionMs: duration };
  }

  // ---- population ---------------------------------------------------------
  addFish({ species, ownerId = null, ownerName = null, bornAt = this.clock() }) {
    const fish = {
      id: `f${this.state.nextFishId++}`,
      species,
      name: ownerName,
      ownerId,
      bornAt,
      seed: Math.floor(this.rng() * 1e9),
    };
    if (ownerId) fish.seenAt = this.clock();
    this.state.fish.push(fish);
    this.dirty = true;
    return fish;
  }

  removeFish(id) {
    const i = this.state.fish.findIndex((f) => f.id === id);
    if (i < 0) return null;
    this.dirty = true;
    return this.state.fish.splice(i, 1)[0];
  }

  fishOf(ownerId) { return ownerId ? this.state.fish.find((f) => f.ownerId === ownerId) ?? null : null; }

  get population() { return this.state.fish.length; }

  /**
   * A fish that can move to "another tank" to make room: the oldest ownerless
   * one, otherwise the fish of the viewer who has been away the longest (a week+).
   */
  rehomeCandidate(now = this.clock()) {
    const counts = {};
    for (const f of this.state.fish) counts[f.species] = (counts[f.species] ?? 0) + 1;
    const ownerless = this.state.fish
      .filter((f) => !f.ownerId && counts[f.species] > 2)
      .sort((a, b) => a.bornAt - b.bornAt)[0];
    if (ownerless) return ownerless;
    return this.state.fish
      .filter((f) => f.ownerId && now - (f.seenAt ?? now) > INACTIVE_OWNER_MS)
      .sort((a, b) => a.seenAt - b.seenAt)[0] ?? null;
  }

  // ---- slow evolution -------------------------------------------------------
  /** Called once a minute. Returns newborn fish (to be announced). */
  ecosystemTick(now = this.clock(), { birthsPerDayPerSpecies = 2 } = {}) {
    const s = this.state;
    s.growth = Math.min(1, s.growth + 0.45 / (7 * 24 * 60)); // plants reach full size in about a week
    this.dirty = true;
    const born = [];
    const wellFed = now - s.lastFedAt < 3 * 3600000;
    if (!wellFed || this.population >= this.populationCap - 10) return born;
    const p = birthsPerDayPerSpecies / (24 * 60);
    for (const species of SPAWNABLE) {
      const adults = s.fish.filter((f) => f.species === species && now - f.bornAt > DAY_MS).length;
      if (adults >= 2 && this.rng() < p) born.push(this.addFish({ species, bornAt: now }));
    }
    return born;
  }

  // ---- bookkeeping ---------------------------------------------------------
  noteMessage(userId, userName) {
    this.state.stats.messages++;
    if (userId && !this.viewers.has(userId)) {
      this.viewers.add(userId);
      this.state.stats.viewers++;
      // Remember recent viewers only; the total above stays an approximate running count.
      if (this.viewers.size > 50000) {
        const oldest = this.viewers.values();
        for (let i = 0; i < 5000; i++) this.viewers.delete(oldest.next().value);
      }
    }
    const own = this.fishOf(userId);
    if (own) own.seenAt = this.clock(); // owners who keep coming back keep their fish
    this.dirty = true;
  }

  noteVote(userId, userName) {
    this.state.stats.votes++;
    if (!userId) return;
    const top = this.state.top;
    const t = (top[userId] ??= { name: userName, n: 0 });
    t.n++;
    t.name = userName || t.name;
    const ids = Object.keys(top);
    if (ids.length > 600) {
      ids.sort((a, b) => top[a].n - top[b].n).slice(0, ids.length - 500).forEach((id) => delete top[id]);
    }
  }

  recordEvent(ev) {
    const s = this.state;
    s.stats.events[ev.kind] = (s.stats.events[ev.kind] ?? 0) + 1;
    if (ev.kind === 'feed') s.lastFedAt = ev.at;
    s.history.push({ kind: ev.kind, at: ev.at, count: ev.by?.count ?? 0, names: ev.by?.names ?? [] });
    if (s.history.length > 100) s.history.splice(0, s.history.length - 100);
    this.dirty = true;
  }

  topContributors(n = 10) {
    return Object.values(this.state.top).sort((a, b) => b.n - a.n).slice(0, n);
  }

  /** What a renderer needs to rebuild the tank from scratch. */
  snapshot(now = this.clock()) {
    return {
      now,
      tod: this.tod(now),
      todRate: this.todRate(now),
      growth: this.state.growth,
      luck: this.state.luck,
      fish: this.state.fish,
      lastFedAt: this.state.lastFedAt,
    };
  }
}
