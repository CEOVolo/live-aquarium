// Shared helpers for the test suite: fake clock, deterministic RNG, a ready-made
// "tank" (World + Director) and temp directories. Nothing here touches the network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../server/world.js';
import { Director } from '../server/director.js';

// 2026-09-29 12:00 PDT: far away from both UTC and Pacific midnight, so day
// rollovers (AI budget, YouTube quota) never happen by accident.
export const T0 = Date.UTC(2026, 8, 29, 19, 0, 0);

/** A mutable fake clock: `c.now` is the time, `c.clock` is what components get. */
export function makeClock(start = T0) {
  const c = {
    now: start,
    clock: () => c.now,
    advance(ms) {
      c.now += ms;
      return c.now;
    },
  };
  return c;
}

/** Deterministic PRNG (mulberry32) in [0, 1). */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const silentLog = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

/**
 * An in-memory tank: a seeded World (42 fish, mid-morning) and a Director on a
 * fake clock. `tickFor(ms)` advances time in 100 ms steps like the server loop.
 */
export function makeTank({ mode = 'interactive', limits, populationCap, rules, seed = 7 } = {}) {
  const c = makeClock();
  const world = new World({ dataDir: null, clock: c.clock, rng: seededRng(seed), populationCap }).load();
  const director = new Director({ world, clock: c.clock, rng: seededRng(seed + 1), mode, limits, rules });
  const events = [];
  director.on((ev) => events.push(ev));

  /** Advance fake time by `ms` in `step` increments, ticking the director; returns what fired. */
  const tickFor = (ms, step = 100, beforeTick) => {
    const fired = [];
    const end = c.now + ms;
    while (c.now < end) {
      c.now = Math.min(end, c.now + step);
      beforeTick?.(c.now);
      fired.push(...director.tick(c.now));
    }
    return fired;
  };
  const kinds = (kind) => events.filter((e) => e.kind === kind);
  /** Public view of one intent's meter (count, need, cooldown, ...). */
  const meter = (intent, now = c.now) => director.snapshot(now).meters.find((m) => m.intent === intent);

  return { c, world, director, events, tickFor, kinds, meter };
}

export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aq-'));
}

export function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
