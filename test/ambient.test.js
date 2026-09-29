import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { Director } from '../server/director.js';
import { Ambient } from '../server/ambient.js';
import { SPAWNABLE } from '../server/catalog.js';
import { makeClock, seededRng } from './helpers.js';

const MIN = 60_000;
const CONFIG = { feedEveryMin: 25, tvFeedEveryMin: 20, goldenMeanMin: 150, nightJellyMeanMin: 45, birthsPerDayPerSpecies: 2 };

/**
 * A living tank. The ambient and world dice are controllable: at 0.5 nothing
 * random happens (Poisson chances per 100 ms tick are tiny); at 0 everything does.
 */
function makeLife({ mode = 'interactive', cfg = {} } = {}) {
  const c = makeClock();
  const dice = { world: 0.5, ambient: 0.5 };
  const world = new World({ dataDir: null, clock: c.clock, rng: () => dice.world }).load();
  const director = new Director({ world, clock: c.clock, rng: seededRng(5), mode });
  const ambient = new Ambient({ director, world, clock: c.clock, rng: () => dice.ambient, config: { ...CONFIG, ...cfg } });
  const events = [];
  director.on((e) => events.push(e));
  const run = (ms, step = 100) => {
    const end = c.now + ms;
    while (c.now < end) {
      c.now = Math.min(end, c.now + step);
      director.tick(c.now);
      ambient.tick(c.now);
    }
  };
  return { c, t0: c.now, dice, world, director, ambient, events, run, kinds: (k) => events.filter((e) => e.kind === k) };
}

describe('ambient life', () => {
  test('the caretaker feeds the fish when nobody has for feedEveryMin', () => {
    const { t0, world, run, kinds } = makeLife();
    run(25 * MIN);
    assert.equal(kinds('feed').length, 0);
    run(100);
    const [feed] = kinds('feed');
    assert.ok(feed, 'caretaker fed the fish');
    assert.equal(feed.at - t0, 25 * MIN + 100, 'first tick after the deadline');
    assert.equal(feed.by.system, true);
    assert.equal(feed.params.caretaker, true, "the caretaker's own params are passed through");
    assert.ok(Number.isFinite(feed.params.amount) && feed.params.amount > 0);
    assert.equal(world.state.lastFedAt, feed.at);
    run(5 * MIN);
    assert.equal(kinds('feed').length, 1, 'fed fish are left alone');
  });

  test('food from chat resets the caretaker timer', () => {
    const { c, t0, director, run, kinds } = makeLife();
    run(20 * MIN);
    director.vote({ userId: 'viewer', intent: 'feed' }, c.now);
    run(10 * MIN);
    assert.equal(kinds('feed').length, 1, 'only the chat feeding');
    const chatFeed = kinds('feed')[0].at;
    run(chatFeed + 25 * MIN + 100 - c.now);
    assert.equal(kinds('feed').length, 2);
    assert.equal(kinds('feed')[1].at - chatFeed, 25 * MIN + 100);
    assert.ok(kinds('feed')[1].at - t0 > 45 * MIN);
  });

  test('in TV mode the caretaker uses tvFeedEveryMin', () => {
    const { t0, run, kinds } = makeLife({ mode: 'tv' });
    run(20 * MIN + 100);
    assert.equal(kinds('feed').length, 1);
    assert.equal(kinds('feed')[0].at - t0, 20 * MIN + 100);
  });

  test('bubbles burst on their own every few minutes', () => {
    const { t0, run, kinds } = makeLife();
    run(30 * MIN);
    // dice 0.5: first after between(4, 10) = 7 min, then every between(6, 14) = 10 min
    assert.deepEqual(kinds('bubbles').map((e) => (e.at - t0) / MIN), [7, 17, 27]);
    assert.ok(kinds('bubbles').every((e) => e.by.system && e.params.intensity === 1.2));
  });

  test('ambient events respect the global spacing: a due feeding waits minGapMs after bubbles', () => {
    const { t0, director, run, kinds } = makeLife({ cfg: { feedEveryMin: 7 } });
    run(8 * MIN);
    const [bubbles] = kinds('bubbles');
    const [feed] = kinds('feed');
    assert.equal(bubbles.at - t0, 7 * MIN);
    assert.equal(feed.at - bubbles.at, director.limits.minGapMs);
  });

  test('the golden fish visits on its own without spending chat luck', () => {
    const { c, dice, world, director, run, kinds } = makeLife();
    director.vote({ userId: 'wisher', intent: 'wish' }, c.now);
    assert.equal(world.state.luck, 1);
    run(1000);
    assert.equal(kinds('golden').length, 0);
    dice.ambient = 0; // the rare arrival happens now
    run(100);
    dice.ambient = 0.5;
    const [golden] = kinds('golden');
    assert.ok(golden, 'golden fish visited');
    assert.equal(golden.by.system, true);
    assert.equal(world.state.luck, 1);
  });

  test('jellyfish drift in at night only', () => {
    const { c, dice, world, run, kinds } = makeLife();
    dice.ambient = 0; // every random arrival would happen...
    run(5000); // ...but it is day
    assert.equal(kinds('jellyfish').length, 0);
    world.skipTo('night', c.now, 1000);
    run(6000);
    const [jelly] = kinds('jellyfish');
    assert.ok(jelly, 'jellyfish arrived at night');
    assert.equal(world.isNight(jelly.at), true);
    assert.equal(jelly.by.system, true);
    assert.equal(jelly.params.count, 3);
  });

  test('newborn fish are announced once a minute as fish_add (born: true)', () => {
    const { dice, world, run, kinds } = makeLife();
    const before = world.population;
    run(MIN - 100);
    assert.equal(kinds('fish_add').length, 0);
    dice.world = 0; // every species breeds at this ecosystem tick
    run(100);
    dice.world = 0.5;
    const born = kinds('fish_add');
    assert.equal(born.length, SPAWNABLE.length);
    assert.ok(born.every((e) => e.params.born === true && e.by.system === true && e.params.fish.ownerId === null));
    assert.equal(world.population, before + SPAWNABLE.length);
    run(MIN);
    assert.equal(kinds('fish_add').length, SPAWNABLE.length, 'no births when the dice say no');
  });
});
