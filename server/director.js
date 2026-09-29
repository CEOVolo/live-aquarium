import { RULES, INTENTS, SPAWNABLE, ENGINE_EVENTS } from './catalog.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * The Director turns a noisy stream of chat votes into a calm, rate-limited
 * stream of whitelisted engine events.
 *
 *  - 1000 people typing SHARK = ONE shark ("summoned by 1000 viewers").
 *  - Each viewer counts once per vote window and has a personal rate limit.
 *  - Thresholds grow with the number of active chatters.
 *  - Per-event cooldowns, a global events-per-minute budget and a minimum gap
 *    between events; when several events are ready, the higher priority wins.
 *  - Mode gating: TV mode only allows calm events.
 *  - Admin can do everything: an admin vote skips every gate above.
 */
export class Director {
  constructor({ world, clock = Date.now, rng = Math.random, mode = 'interactive', rules = RULES, limits = {} } = {}) {
    this.world = world;
    this.clock = clock;
    this.rng = rng;
    this.rules = rules;
    this.mode = mode;
    this.limits = {
      userPerMin: 8,
      userBurst: 4,
      activeWindowMs: 120000,
      minGapMs: 3500,
      ...limits,
      perMin: { interactive: 10, tv: 3, ...(limits.perMin ?? {}) },
    };
    this.listeners = new Set();
    this.votes = {};
    this.lastByUser = {};
    for (const k of Object.keys(rules)) {
      this.votes[k] = new Map();
      this.lastByUser[k] = new Map();
    }
    this.readyAt = {};
    this.cooldownUntil = {};
    this.queues = { spawn: [], myfish: [] };
    this.lastServed = { spawn: -Infinity, myfish: -Infinity };
    this.active = new Map();
    this.buckets = new Map();
    this.fireTimes = [];
    this.lastFireAt = -Infinity;
    this.lastPrune = clock();
    this.seq = 0;
    this.scheduled = [];
    this.stats = { received: 0, accepted: 0, rejected: {}, events: {} };
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(ev) { for (const fn of this.listeners) fn(ev); }

  setMode(mode) {
    if (mode !== 'interactive' && mode !== 'tv') return false;
    this.mode = mode;
    for (const m of Object.values(this.votes)) m.clear();
    this.readyAt = {};
    this.queues.spawn.length = 0;
    this.queues.myfish.length = 0;
    return true;
  }

  // ---- inputs ---------------------------------------------------------------
  noteActivity(userId, now = this.clock()) { if (userId) this.active.set(userId, now); }

  /**
   * @param {{userId:string, userName?:string, intent:string, species?:string,
   *          weight?:number, admin?:boolean, source?:string}} v
   * @returns {{accepted:boolean, reason:string, event?:object}}
   */
  vote(v, now = this.clock()) {
    const { intent } = v;
    this.stats.received++;
    if (!Object.hasOwn(this.rules, intent)) return this.reject('unknown');
    const rule = this.rules[intent];

    // Admin can do everything. This check comes before any gate on purpose.
    if (v.admin) {
      const ev = this.fire(intent, now, {
        admin: true, voters: [{ id: v.userId, name: v.userName, w: 1 }],
        userId: v.userId, userName: v.userName, species: v.species, source: v.source,
      });
      return ev ? this.accept('admin', ev) : this.reject('failed');
    }

    if (!this.modeAllows(intent)) return this.reject('mode');
    if (!this.takeToken(v.userId, now)) return this.reject('user_rate');
    const w = Number.isFinite(v.weight) ? Math.max(1, Math.min(20, v.weight)) : 1;

    if (rule.kind === 'vote') {
      const blocked = this.stateBlock(intent, now);
      if (blocked) return this.reject(blocked);
      const m = this.votes[intent];
      if (m.has(v.userId)) return this.reject('dup');
      m.set(v.userId, { ts: now, w, name: v.userName });
      return this.accept('vote');
    }

    if (rule.kind === 'meter') {
      const last = this.lastByUser[intent].get(v.userId);
      if (last !== undefined && now - last < rule.perUserMs) return this.reject('user_cooldown');
      this.lastByUser[intent].set(v.userId, now);
      this.world.state.luck = Math.min(this.luckTarget(), this.world.state.luck + w);
      // Who wished is persisted with the luck, so the credit survives a restart.
      const wish = (this.world.state.wish ??= { names: [], count: 0 });
      wish.count++;
      if (v.userName) wish.names = [v.userName, ...wish.names.filter((n) => n !== v.userName)].slice(0, 3);
      this.world.dirty = true;
      return this.accept('luck');
    }

    // request
    const last = this.lastByUser[intent].get(v.userId);
    if (last !== undefined && now - last < rule.perUserMs) return this.reject('user_cooldown');
    const q = this.queues[intent];
    if (q.some((r) => r.userId === v.userId)) return this.reject('dup');
    if (intent === 'spawn') {
      if (this.world.fishOf(v.userId)) return this.reject('has_fish');
      if (this.world.population >= this.world.populationCap && !this.world.rehomeCandidate()) return this.reject('full');
    }
    if (intent === 'myfish' && !this.world.fishOf(v.userId)) return this.reject('no_fish');
    if (q.length >= rule.queueMax) return this.reject('queue_full');
    // The personal cooldown starts when the request is served, so a lost request never locks a viewer out.
    q.push({ userId: v.userId, userName: v.userName, species: v.species, ts: now });
    return this.accept('queued');
  }

  // ---- the clock ----------------------------------------------------------
  tick(now = this.clock()) {
    this.pruneActive(now);
    this.runScheduled(now);
    const ready = [];
    for (const [intent, r] of Object.entries(this.rules)) {
      if (r.kind === 'vote') {
        const m = this.votes[intent];
        for (const [uid, x] of m) if (now - x.ts > r.windowMs) m.delete(uid);
        const voice = this.voiceOf(intent);
        if (!m.size || voice < this.need(intent)) { delete this.readyAt[intent]; continue; }
        this.readyAt[intent] ??= now;
        if (now - this.readyAt[intent] < r.gatherMs || !this.canFire(intent, now)) continue;
        ready.push({ intent, voice, priority: r.priority });
      } else if (r.kind === 'meter') {
        const luck = this.world.state.luck;
        if (luck >= this.luckTarget() && this.canFire(intent, now)) ready.push({ intent, voice: luck, priority: r.priority });
      }
    }
    ready.sort((a, b) => b.priority - a.priority || b.voice - a.voice);

    const fired = [];
    for (const c of ready) {
      if (!this.globalOk(now)) break;
      if (!this.canFire(c.intent, now)) continue; // e.g. DAY lost to NIGHT in this very tick
      const ev = c.intent === 'wish' ? this.fireWish(now) : this.fireVotes(c.intent, now);
      if (ev) fired.push(ev);
    }
    this.serveRequests(now, fired);
    if (now - this.lastPrune > 60000) this.prune(now);
    return fired;
  }

  /** Ambient life (caretaker feeding, rare visitors). Respects cooldowns and spacing, not modes. */
  systemFire(intent, now = this.clock(), params = {}) {
    if (!this.rules[intent]) return null;
    if (this.cooldownLeft(intent, now) > 0 || now - this.lastFireAt < this.limits.minGapMs) return null;
    if (this.stateBlock(intent, now)) return null;
    return intent === 'wish'
      ? this.fire('wish', now, { system: true, params })
      : this.fire(intent, now, { system: true, params });
  }

  /** Announce something that happened in the world (e.g. a fish was born). */
  announce(kind, params, now = this.clock()) {
    if (!ENGINE_EVENTS.includes(kind)) return null;
    const ev = this.makeEvent(kind, params, now, { count: 0, names: [], system: true });
    this.publish(ev);
    return ev;
  }

  // ---- gates ----------------------------------------------------------------
  modeAllows(intent) { return this.rules[intent].modes.includes(this.mode); }

  need(intent) {
    const [base, frac, max] = this.rules[intent].need;
    const need = clamp(base + Math.floor(frac * this.active.size), 1, max);
    return Math.min(need, Math.max(1, this.active.size));
  }

  luckTarget() {
    const [base, frac, max] = this.rules.wish.target;
    return clamp(base + Math.floor(frac * this.active.size), 1, max);
  }

  voiceOf(intent) {
    let voice = 0;
    for (const x of this.votes[intent].values()) voice += x.w;
    return voice;
  }

  cooldownLeft(intent, now = this.clock()) {
    const r = this.rules[intent];
    let until = this.cooldownUntil[intent] ?? 0;
    if (r.group) until = Math.max(until, this.cooldownUntil[r.group] ?? 0);
    return Math.max(0, until - now);
  }

  stateBlock(intent, now) {
    if (intent === 'night' && this.world.isNight(now)) return 'already';
    if (intent === 'day' && !this.world.isNight(now)) return 'already';
    return null;
  }

  canFire(intent, now) {
    return this.modeAllows(intent) && this.cooldownLeft(intent, now) === 0 && !this.stateBlock(intent, now);
  }

  globalOk(now) {
    while (this.fireTimes.length && now - this.fireTimes[0] > 60000) this.fireTimes.shift();
    return now - this.lastFireAt >= this.limits.minGapMs && this.fireTimes.length < this.limits.perMin[this.mode];
  }

  takeToken(userId, now) {
    const { userPerMin, userBurst } = this.limits;
    let b = this.buckets.get(userId);
    if (!b) {
      b = { tokens: userBurst, at: now };
      this.buckets.set(userId, b);
    }
    b.tokens = Math.min(userBurst, b.tokens + ((now - b.at) * userPerMin) / 60000);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  // ---- firing -----------------------------------------------------------------
  fireVotes(intent, now) {
    const m = this.votes[intent];
    const voters = [...m.entries()]
      .map(([id, x]) => ({ id, name: x.name, w: x.w, ts: x.ts }))
      .sort((a, b) => a.ts - b.ts);
    m.clear();
    delete this.readyAt[intent];
    return this.fire(intent, now, { voters });
  }

  fireWish(now) {
    const { names = [], count = 0 } = this.world.state.wish ?? {};
    return this.fire('wish', now, { voters: names.map((name) => ({ name, w: 1 })), count });
  }

  serveRequests(now, fired) {
    for (const intent of ['spawn', 'myfish']) {
      const r = this.rules[intent];
      const q = this.queues[intent];
      while (q.length && now - q[0].ts > r.queueTtlMs) {
        q.shift();
        this.bump('expired');
      }
      if (!q.length || now - this.lastServed[intent] < r.gapMs) continue;
      const req = q.shift();
      if (intent === 'spawn' && this.world.fishOf(req.userId)) continue;
      this.lastServed[intent] = now;
      const ev = this.fire(intent, now, {
        voters: [{ id: req.userId, name: req.userName, w: 1 }],
        userId: req.userId, userName: req.userName, species: req.species,
      });
      if (ev) {
        this.lastByUser[intent].set(req.userId, now);
        fired.push(ev);
      }
    }
  }

  fire(intent, now, ctx = {}) {
    const r = this.rules[intent];
    const voters = ctx.voters ?? [];
    const count = ctx.count ?? voters.length;
    const names = voters.map((v) => v.name).filter(Boolean).slice(0, 3);
    const voice = voters.reduce((s, v) => s + (v.w ?? 1), 0);
    const pre = [];
    let kind = intent;
    let params = {};

    switch (intent) {
      case 'feed':
        params = { amount: clamp(36 + 4 * count, 36, 140), x: round((this.rng() * 2 - 1) * 6, 1), durationMs: r.durationMs };
        break;
      case 'bubbles':
        params = { intensity: round(clamp(1 + Math.log2(1 + count) * 0.6, 1, 4)), durationMs: r.durationMs };
        break;
      case 'shark': {
        const victim = this.pickVictim(r.eat, now);
        const [h0, h1] = r.eat?.huntAfterMs ?? [12000, 12000];
        params = {
          durationMs: r.durationMs,
          side: this.rng() < 0.5 ? 'left' : 'right',
          victim: victim ? { id: victim.id, species: victim.species, name: victim.name } : null,
          huntAtMs: Math.round(h0 + this.rng() * (h1 - h0)),
        };
        if (victim) this.eatFish(victim);
        break;
      }
      case 'jellyfish':
        params = { count: clamp(3 + Math.floor(Math.log2(1 + count)), 3, 8), durationMs: r.durationMs };
        break;
      case 'night':
      case 'day':
        params = this.world.skipTo(intent, now);
        break;
      case 'wish':
        kind = 'golden';
        params = { durationMs: r.durationMs };
        // Only chat's own wish spends the luck meter; a natural or admin visit leaves it alone.
        if (!ctx.system && !ctx.admin) {
          this.world.state.luck = 0;
          this.world.state.wish = { names: [], count: 0 };
        }
        this.later(now + r.durationMs - (r.giftBeforeEndMs ?? 5000), (at) => this.giveGift(at));
        break;
      case 'spawn': {
        const species = SPAWNABLE.includes(ctx.species) ? ctx.species : SPAWNABLE[Math.floor(this.rng() * SPAWNABLE.length)];
        if (this.world.population >= this.world.populationCap) {
          const old = this.world.rehomeCandidate();
          if (!old && !ctx.admin) return null;
          if (old) {
            this.world.removeFish(old.id);
            pre.push(this.makeEvent('fish_remove', { fishId: old.id, reason: 'rehomed' }, now, { count: 0, names: [], system: true }));
          }
        }
        // Fish spawned from the admin panel belong to nobody; chat fish belong to the viewer.
        const ownerId = ctx.source === 'panel' ? null : ctx.userId ?? null;
        const fish = this.world.addFish({ species, ownerId, ownerName: ownerId ? ctx.userName ?? null : null });
        kind = 'fish_add';
        params = { fish, born: false };
        break;
      }
      case 'myfish': {
        const fish = this.world.fishOf(ctx.userId);
        if (!fish) return null;
        kind = 'spotlight';
        params = { fishId: fish.id, name: fish.name, species: fish.species, survived: fish.survived ?? 0, durationMs: r.durationMs };
        break;
      }
      default:
        return null;
    }
    params = { ...params, ...(ctx.params ?? {}) };

    const cd = this.mode === 'tv' && r.tvCooldownMs ? r.tvCooldownMs : r.cooldownMs ?? 0;
    this.cooldownUntil[intent] = now + cd;
    if (r.group) {
      this.cooldownUntil[r.group] = now + cd;
      for (const [k, other] of Object.entries(this.rules)) {
        if (other.group === r.group && k !== intent) {
          this.votes[k].clear();
          delete this.readyAt[k];
        }
      }
    }
    if (r.kind !== 'request') {
      this.lastFireAt = now;
      this.fireTimes.push(now);
    }

    const ev = this.makeEvent(kind, params, now, {
      count, names, voice, admin: !!ctx.admin, system: !!ctx.system,
    });
    for (const e of pre) this.publish(e);
    this.publish(ev);
    return ev;
  }

  // ---- consequences --------------------------------------------------------
  /** The shark's victim: a weighted pick among fish that are old enough and not hiding. */
  pickVictim(eat, now) {
    if (!eat || this.world.population < eat.minPopulation) return null;
    const pool = this.world.state.fish.filter((f) => !eat.safe.includes(f.species) && now - f.bornAt >= eat.minAgeMs);
    const weight = (f) => (f.ownerId ? eat.ownedWeight : eat.ownerlessWeight);
    let total = 0;
    for (const f of pool) total += weight(f);
    if (!total) return null;
    let x = this.rng() * total;
    for (const f of pool) {
      x -= weight(f);
      if (x <= 0) return f;
    }
    return pool[pool.length - 1];
  }

  eatFish(victim) {
    this.world.removeFish(victim.id);
    const stats = this.world.state.stats;
    stats.eaten = (stats.eaten ?? 0) + 1;
    for (const f of this.world.state.fish) f.survived = (f.survived ?? 0) + 1;
    // A viewer who lost a fish may ask for a new one straight away.
    if (victim.ownerId) this.lastByUser.spawn?.delete(victim.ownerId);
  }

  giveGift(at) {
    if (this.world.population >= this.world.populationCap) return;
    const species = SPAWNABLE[Math.floor(this.rng() * SPAWNABLE.length)];
    const fish = this.world.addFish({ species, bornAt: at });
    this.announce('fish_add', { fish, born: true, gift: true }, at);
  }

  later(at, fn) { this.scheduled.push({ at, fn }); }

  runScheduled(now) {
    if (!this.scheduled.length) return;
    const due = this.scheduled.filter((s) => s.at <= now);
    if (!due.length) return;
    this.scheduled = this.scheduled.filter((s) => s.at > now);
    for (const s of due) s.fn(now);
  }

  makeEvent(kind, params, now, by) {
    return { id: ++this.seq, kind, params, by, at: now };
  }

  publish(ev) {
    this.world.recordEvent(ev);
    this.stats.events[ev.kind] = (this.stats.events[ev.kind] ?? 0) + 1;
    this.emit(ev);
  }

  // ---- housekeeping -------------------------------------------------------
  accept(reason, event) {
    this.stats.accepted++;
    return { accepted: true, reason, event };
  }

  reject(reason) {
    this.bump(reason);
    return { accepted: false, reason };
  }

  bump(reason) { this.stats.rejected[reason] = (this.stats.rejected[reason] ?? 0) + 1; }

  pruneActive(now) {
    const cutoff = now - this.limits.activeWindowMs;
    for (const [id, ts] of this.active) if (ts < cutoff) this.active.delete(id);
  }

  prune(now) {
    this.lastPrune = now;
    for (const [id, b] of this.buckets) if (now - b.at > 600000) this.buckets.delete(id);
    for (const [intent, m] of Object.entries(this.lastByUser)) {
      const keep = this.rules[intent].perUserMs ?? 0;
      for (const [id, ts] of m) if (now - ts > keep) m.delete(id);
    }
  }

  snapshot(now = this.clock()) {
    const meters = INTENTS.map((intent) => {
      const r = this.rules[intent];
      const base = { intent, kind: r.kind, enabled: this.modeAllows(intent), cooldownMs: this.cooldownLeft(intent, now) };
      if (r.kind === 'vote') {
        return { ...base, count: this.votes[intent].size, voice: this.voiceOf(intent), need: this.need(intent), blocked: this.stateBlock(intent, now) };
      }
      if (r.kind === 'meter') return { ...base, voice: this.world.state.luck, need: this.luckTarget() };
      return { ...base, queued: this.queues[intent].length };
    });
    return { mode: this.mode, active: this.active.size, meters, stats: this.stats };
  }
}
