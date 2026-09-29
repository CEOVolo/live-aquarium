import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { World, NIGHT_TARGET, DAY_TARGET, isNightTod } from '../server/world.js';
import { SPAWNABLE } from '../server/catalog.js';
import { makeClock, seededRng, tmpDir, rmDir } from './helpers.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('time of day', () => {
  test('starts mid-morning and runs one full cycle per dayLengthMin', () => {
    const c = makeClock();
    const w = new World({ dataDir: null, dayLengthMin: 30, clock: c.clock }).load();
    const day = 30 * 60_000;
    assert.ok(close(w.tod(c.now), 0.36));
    assert.equal(w.isNight(c.now), false);
    assert.ok(close(w.tod(c.now + day / 2), 0.86));
    assert.equal(w.isNight(c.now + day / 2), true);
    assert.ok(close(w.tod(c.now + day), 0.36), 'wraps around after a full day');
    assert.equal(w.todRate(c.now), 1 / day);
  });

  test('night is before 0.23 and after 0.77', () => {
    assert.equal(isNightTod(0), true);
    assert.equal(isNightTod(0.22), true);
    assert.equal(isNightTod(0.23), false);
    assert.equal(isNightTod(0.5), false);
    assert.equal(isNightTod(0.77), false);
    assert.equal(isNightTod(0.78), true);
    assert.equal(isNightTod(NIGHT_TARGET), true);
    assert.equal(isNightTod(DAY_TARGET), false);
  });

  test('skipTo("night") fast-forwards smoothly and lands on the night target', () => {
    const c = makeClock();
    const w = new World({ dataDir: null, clock: c.clock }).load();
    const from = w.tod(c.now);
    w.dirty = false;
    assert.deepEqual(w.skipTo('night', c.now, 20_000), { target: NIGHT_TARGET, transitionMs: 20_000 });
    assert.equal(w.dirty, true);
    const delta = NIGHT_TARGET - from;
    assert.ok(close(w.todRate(c.now), delta / 20_000, 1e-15), 'the renderer can extrapolate the fast clock');
    assert.ok(close(w.tod(c.now + 10_000), from + delta / 2));
    assert.equal(w.isNight(c.now + 20_000), true);
    assert.ok(close(w.tod(c.now + 20_000), NIGHT_TARGET));
    assert.equal(w.todRate(c.now + 20_000), w.rate, 'back to normal speed');
    assert.ok(close(w.tod(c.now + 20_000 + w.dayLengthMs / 20), NIGHT_TARGET + 0.05), 'and the clock keeps running');
  });

  test('skipTo("day") at night goes forward through midnight, never back through the evening', () => {
    const c = makeClock();
    const w = new World({ dataDir: null, clock: c.clock }).load();
    w.skipTo('night', c.now, 1000);
    c.advance(1000);
    const from = w.tod(c.now);
    assert.ok(close(from, NIGHT_TARGET));
    w.skipTo('day', c.now, 10_000);
    const delta = 1 + DAY_TARGET - from;
    const mid = w.tod(c.now + 5000);
    assert.ok(close(mid, (from + delta / 2) % 1), `mid ${mid}`);
    assert.ok(mid < 0.23, 'past midnight at half-way');
    assert.ok(close(w.tod(c.now + 10_000), DAY_TARGET));
    assert.equal(w.isNight(c.now + 10_000), false);
  });
});

describe('fish roster', () => {
  test('add, find by owner, remove; rehome picks the oldest ownerless fish of a common species', () => {
    const w = new World({ dataDir: null, clock: makeClock().clock, rng: seededRng(1) });
    assert.equal(w.population, 0);
    const mine = w.addFish({ species: 'clownfish', ownerId: 'yt:ann', ownerName: 'Ann', bornAt: 5 });
    const old = w.addFish({ species: 'clownfish', bornAt: 1 });
    const young = w.addFish({ species: 'clownfish', bornAt: 3 });
    const lonely = w.addFish({ species: 'tang', bornAt: 0 }); // the oldest fish, but a rare species
    assert.deepEqual([mine.id, old.id, young.id, lonely.id], ['f1', 'f2', 'f3', 'f4']);
    assert.equal(mine.name, 'Ann');
    assert.equal(w.population, 4);

    assert.equal(w.fishOf('yt:ann'), mine);
    assert.equal(w.fishOf('yt:bob'), null);
    assert.equal(w.fishOf(null), null, 'ownerless fish are nobody\'s fish');
    assert.equal(w.fishOf(undefined), null);

    assert.equal(w.rehomeCandidate(), old);
    assert.equal(w.removeFish(old.id), old);
    assert.equal(w.removeFish(old.id), null);
    assert.equal(w.rehomeCandidate(), null, 'two clownfish and one tang are too few to move out');
    assert.equal(w.population, 3);
  });

  test('load() seeds an empty tank with 42 fish of every species', () => {
    const w = new World({ dataDir: null, clock: makeClock().clock, rng: seededRng(2) }).load();
    assert.equal(w.population, 42);
    const counts = Object.fromEntries(SPAWNABLE.map((sp) => [sp, w.state.fish.filter((f) => f.species === sp).length]));
    assert.deepEqual(counts, { chromis: 22, clownfish: 4, tang: 3, yellowtang: 3, gramma: 4, cardinal: 6 });
    assert.ok(w.state.fish.every((f) => f.ownerId === null));
  });
});

describe('ecosystem and bookkeeping', () => {
  test('ecosystemTick: plants grow; well-fed adults breed; hungry or crowded tanks do not', () => {
    const c = makeClock();
    let dice = 0.99;
    const w = new World({ dataDir: null, clock: c.clock, rng: () => dice }).load();
    const g0 = w.state.growth;
    assert.deepEqual(w.ecosystemTick(c.now), []);
    assert.ok(w.state.growth > g0);

    dice = 0; // every species wins the dice
    const born = w.ecosystemTick(c.now);
    assert.deepEqual(born.map((f) => f.species).sort(), [...SPAWNABLE].sort());
    assert.ok(born.every((f) => f.bornAt === c.now && f.ownerId === null));

    w.state.lastFedAt = c.now - 3 * 3_600_000 - 1; // hungry
    assert.deepEqual(w.ecosystemTick(c.now), []);
    w.state.lastFedAt = c.now;
    w.populationCap = w.population + 10; // crowded
    assert.deepEqual(w.ecosystemTick(c.now), []);

    w.state.growth = 0.99999;
    w.ecosystemTick(c.now);
    assert.equal(w.state.growth, 1, 'growth is capped');
  });

  test('recordEvent counts events, remembers the last feeding and keeps 100 history entries', () => {
    const w = new World({ dataDir: null, clock: makeClock().clock });
    for (let i = 0; i < 120; i++) w.recordEvent({ kind: i % 2 ? 'feed' : 'bubbles', at: 1000 + i, by: { count: i, names: [] } });
    assert.equal(w.state.history.length, 100);
    assert.equal(w.state.history[0].at, 1020);
    assert.equal(w.state.stats.events.feed, 60);
    assert.equal(w.state.lastFedAt, 1119);
  });

  test('noteMessage counts unique viewers; noteVote keeps a leaderboard', () => {
    const w = new World({ dataDir: null, clock: makeClock().clock }).load();
    w.noteMessage('a', 'A');
    w.noteMessage('a', 'A');
    w.noteMessage('b', 'B');
    assert.equal(w.state.stats.messages, 3);
    assert.equal(w.state.stats.viewers, 2);
    w.noteVote('a', 'A');
    w.noteVote('a', 'Ann');
    w.noteVote('b', 'B');
    assert.equal(w.state.stats.votes, 3);
    assert.deepEqual(w.topContributors(2), [{ name: 'Ann', n: 2 }, { name: 'B', n: 1 }]);
  });
});

describe('persistence', () => {
  test('save() + load() into a new World restores fish, luck, stats and fish ids', (t) => {
    const dir = tmpDir();
    t.after(() => rmDir(dir));
    const c = makeClock();
    const w1 = new World({ dataDir: dir, clock: c.clock, rng: seededRng(1) }).load();
    const mine = w1.addFish({ species: 'clownfish', ownerId: 'yt:ann', ownerName: 'Ann' });
    w1.removeFish('f1');
    w1.state.luck = 17;
    w1.state.growth = 0.7;
    w1.noteMessage('yt:ann', 'Ann');
    w1.noteMessage('yt:bob', 'Bob');
    w1.noteVote('yt:ann', 'Ann');
    w1.recordEvent({ kind: 'feed', at: c.now, by: { count: 3, names: ['Ann'] } });
    c.advance(60_000);
    w1.save();
    assert.equal(w1.dirty, false);
    assert.deepEqual(fs.readdirSync(dir), ['world.json'], 'written atomically: no temp file left behind');

    const w2 = new World({ dataDir: dir, clock: c.clock, rng: seededRng(2) }).load();
    assert.equal(w2.population, 42);
    assert.deepEqual(w2.state.fish, w1.state.fish);
    assert.deepEqual(w2.fishOf('yt:ann'), mine);
    assert.equal(w2.state.luck, 17);
    assert.equal(w2.state.growth, 0.7);
    assert.deepEqual(w2.state.stats, w1.state.stats);
    assert.deepEqual(w2.state.top, w1.state.top);
    assert.deepEqual(w2.state.history, w1.state.history);
    assert.equal(w2.state.lastFedAt, w1.state.lastFedAt);
    assert.ok(close(w2.tod(c.now), w1.tod(c.now)), 'time of day continues where it was');

    const next = w2.addFish({ species: 'tang' });
    assert.equal(next.id, `f${w1.state.nextFishId}`);
    assert.ok(!w1.state.fish.some((f) => f.id === next.id), 'no id collision after a restart');
    w2.noteMessage('yt:ann', 'Ann');
    assert.equal(w2.state.stats.viewers, 2, 'a returning viewer is not counted twice');
  });

  test('a corrupt world.json is moved aside and the tank starts fresh', (t) => {
    const dir = tmpDir();
    t.after(() => rmDir(dir));
    const warn = t.mock.method(console, 'warn', () => {});
    const file = path.join(dir, 'world.json');
    const broken = '{"version":1,"fish":[{"id":"f1","species":"clo'; // a torn write
    fs.writeFileSync(file, broken);

    const w = new World({ dataDir: dir, clock: makeClock().clock, rng: seededRng(1) }).load();
    assert.equal(w.population, 42, 'fresh, seeded tank');
    assert.equal(fs.existsSync(file), false);
    const aside = fs.readdirSync(dir).filter((f) => f.startsWith('world.json.corrupt-'));
    assert.equal(aside.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), broken, 'kept for inspection');
    assert.equal(warn.mock.callCount(), 1);

    w.save();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).fish.length, 42);
  });

  test('fish of species that are no longer in the catalog are dropped on load', (t) => {
    const dir = tmpDir();
    t.after(() => rmDir(dir));
    const fish = [
      { id: 'f1', species: 'clownfish', name: 'Ann', ownerId: 'yt:ann', bornAt: 0, seed: 1 },
      { id: 'f2', species: 'megalodon', name: null, ownerId: null, bornAt: 0, seed: 2 },
    ];
    fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({ version: 1, fish, nextFishId: 3, luck: 4 }));
    const w = new World({ dataDir: dir, clock: makeClock().clock }).load();
    assert.deepEqual(w.state.fish.map((f) => f.id), ['f1']);
    assert.equal(w.state.luck, 4);
    assert.equal(w.state.nextFishId, 3);
  });

  test('without a dataDir the world lives in memory only', () => {
    const w = new World({ dataDir: null, clock: makeClock().clock }).load();
    w.state.luck = 3;
    w.dirty = true;
    w.save();
    assert.equal(w.file, null);
    assert.equal(w.dirty, true, 'nothing was written');
  });

  test('fixed: a world.json with an unknown version survives load() + save() instead of being overwritten', (t) => {
    const dir = tmpDir();
    t.after(() => rmDir(dir));
    const original = JSON.stringify({ version: 2, fish: [{ id: 'f1', species: 'clownfish' }], luck: 99 });
    fs.writeFileSync(path.join(dir, 'world.json'), original);
    const w = new World({ dataDir: dir, clock: makeClock().clock, rng: seededRng(1) }).load();
    w.save();
    const contents = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(contents.includes(original), 'the original data still exists somewhere in dataDir');
  });
});

describe('making room in a full tank', () => {
  test('an ownerless fish goes first; then the fish of the viewer who has been away the longest (7+ days)', () => {
    let now = Date.UTC(2026, 0, 1);
    const world = new World({ dataDir: null, populationCap: 3, clock: () => now });
    const a = world.addFish({ species: 'tang', ownerId: 'yt:a', ownerName: 'A' });
    const b = world.addFish({ species: 'tang', ownerId: 'yt:b', ownerName: 'B' });
    assert.equal(world.rehomeCandidate(), null, 'nobody has been away long enough');
    now += 8 * 86400000;
    world.noteMessage('yt:b', 'B'); // B came back, A did not
    assert.equal(world.rehomeCandidate(), a);
    const stray = world.addFish({ species: 'tang' });
    world.addFish({ species: 'tang' });
    world.addFish({ species: 'tang' });
    assert.equal(world.rehomeCandidate(), stray, 'ownerless fish are rehomed before any viewer fish');
    assert.ok(b);
  });
});

