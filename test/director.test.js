import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { Director } from '../server/director.js';
import { World, NIGHT_TARGET, DAY_TARGET } from '../server/world.js';
import { Ambient } from '../server/ambient.js';
import { RULES, INTENTS, ENGINE_EVENTS, SPAWNABLE } from '../server/catalog.js';
import { makeTank, makeClock, seededRng } from './helpers.js';

const vote = (director, now, userId, intent, extra = {}) => director.vote({ userId, userName: userId, intent, ...extra }, now);

// ---------------------------------------------------------------------------
// 1-3. Crowds, spam and thresholds
// ---------------------------------------------------------------------------
describe('crowd votes', () => {
  test('1000 viewers typing SHARK within 10 s summon exactly one shark; the cooldown holds; later a new one', () => {
    const { c, director, tickFor, kinds, meter } = makeTank();
    const t0 = c.now;
    let first = null;
    let collected = null;

    // 100 new viewers per second for 10 s; the server loop ticks every 100 ms.
    for (let step = 0; step < 100; step++) {
      for (let k = 0; k < 10; k++) {
        const n = step * 10 + k;
        const userId = `yt:viewer${n}`;
        director.noteActivity(userId, c.now);
        const r = director.vote({ userId, userName: `Viewer ${n}`, intent: 'shark' }, c.now);
        assert.equal(r.accepted, true, `vote of ${userId}`);
      }
      const before = meter('shark');
      const fired = director.tick(c.now);
      if (fired.length) {
        assert.equal(first, null, 'a second shark fired during the raid');
        assert.deepEqual(fired.map((e) => e.kind), ['shark']);
        first = fired[0];
        collected = before;
      }
      c.advance(100);
    }

    assert.ok(first, 'the crowd summoned a shark');
    assert.equal(kinds('shark').length, 1);
    // "Summoned by N viewers": N is exactly what had been collected when it fired...
    assert.equal(first.by.count, collected.count);
    assert.equal(first.by.voice, collected.count);
    assert.ok(first.by.count >= collected.need);
    // ...which is everybody who voted during gatherMs after the threshold was reached.
    assert.equal(first.at - t0, RULES.shark.gatherMs);
    assert.equal(first.by.count, 10 * (RULES.shark.gatherMs / 100 + 1));
    assert.deepEqual(first.by.names, ['Viewer 0', 'Viewer 1', 'Viewer 2']);
    assert.equal(first.by.admin, false);
    assert.equal(first.params.durationMs, RULES.shark.durationMs);
    assert.ok(['left', 'right'].includes(first.params.side));

    // The rest of the raid, and a fresh wave of 200 viewers a minute later, change nothing.
    const cooldownEnd = first.at + RULES.shark.cooldownMs;
    tickFor(first.at + 60_000 - c.now);
    for (let n = 0; n < 200; n++) {
      director.noteActivity(`yt:late${n}`, c.now);
      assert.equal(vote(director, c.now, `yt:late${n}`, 'shark').accepted, true);
    }
    assert.ok(meter('shark').cooldownMs > 0);
    tickFor(cooldownEnd - 100 - c.now);
    assert.equal(kinds('shark').length, 1, 'no second shark during the 3-minute cooldown');

    // Once the cooldown is over, enough fresh votes summon the next shark.
    tickFor(100);
    assert.equal(meter('shark').cooldownMs, 0);
    for (let n = 0; n < 20; n++) {
      director.noteActivity(`yt:fresh${n}`, c.now);
      vote(director, c.now, `yt:fresh${n}`, 'shark');
    }
    tickFor(RULES.shark.gatherMs + 500);
    assert.equal(kinds('shark').length, 2);
    assert.equal(kinds('shark')[1].by.count, 20);
  });

  test('one viewer spamming SHARK 100 times counts once and cannot reach the threshold alone', () => {
    const { c, director, tickFor, kinds, meter } = makeTank();
    // Ten other people are chatting, so the threshold is the normal 3 voices.
    for (let i = 0; i < 10; i++) director.noteActivity(`yt:chatter${i}`, c.now);
    const reasons = {};
    let accepted = 0;
    for (let i = 0; i < 100; i++) {
      const r = vote(director, c.now, 'yt:spammer', 'shark');
      if (r.accepted) accepted++;
      else reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      c.advance(50);
      director.tick(c.now);
    }
    assert.equal(accepted, 1);
    assert.deepEqual(Object.keys(reasons).sort(), ['dup', 'user_rate']);
    assert.equal(meter('shark').count, 1);
    assert.equal(meter('shark').need, 3);

    for (let i = 0; i < 10; i++) director.noteActivity(`yt:chatter${i}`, c.now);
    tickFor(RULES.shark.windowMs + 1000);
    assert.equal(kinds('shark').length, 0);
    // after the window the old vote is gone; a new one is still just one voice
    for (let i = 0; i < 10; i++) director.noteActivity(`yt:chatter${i}`, c.now);
    assert.equal(vote(director, c.now, 'yt:spammer', 'shark').accepted, true);
    tickFor(1000);
    assert.equal(meter('shark').count, 1);
    assert.equal(kinds('shark').length, 0);
  });

  test('the SHARK threshold grows with active chatters: 3 + 4 % of them, at most 60, never above the audience', () => {
    const { c, director, meter } = makeTank();
    let active = 0;
    const activate = (n) => {
      for (; active < n; active++) director.noteActivity(`yt:chatter${active}`, c.now);
    };
    assert.equal(director.need('shark'), 1, 'nobody chatting: a single voice is enough');
    for (const [n, need] of [[1, 1], [2, 2], [3, 3], [24, 3], [25, 4], [100, 7], [250, 13], [500, 23], [1000, 43], [1425, 60], [5000, 60]]) {
      activate(n);
      assert.equal(director.need('shark'), need, `${n} active chatters`);
      assert.equal(meter('shark').need, need);
    }
    assert.equal(director.snapshot(c.now).active, 5000);
    assert.equal(director.need('feed'), 1, 'FEED always needs one voice');
    assert.equal(director.need('jellyfish'), RULES.jellyfish.need[2]);

    // Chatters who went quiet stop counting after activeWindowMs.
    c.advance(director.limits.activeWindowMs + 1);
    director.tick(c.now);
    assert.equal(director.need('shark'), 1);
  });

  test('a tiny audience can still trigger events: two chatters, two SHARK votes -> a shark', () => {
    const { c, director, tickFor, kinds } = makeTank();
    for (const id of ['yt:ann', 'yt:bob']) {
      director.noteActivity(id, c.now);
      vote(director, c.now, id, 'shark');
    }
    tickFor(RULES.shark.gatherMs + 200);
    assert.equal(kinds('shark').length, 1);
    assert.equal(kinds('shark')[0].by.count, 2);
  });

  test('vote weight: voice is the sum of weights, clamped to 1..20 per viewer', () => {
    const { c, director, meter } = makeTank();
    vote(director, c.now, 'a', 'jellyfish', { weight: 10 }); // e.g. a Super Chat
    vote(director, c.now, 'b', 'jellyfish', { weight: 100 });
    vote(director, c.now, 'c', 'jellyfish', { weight: 0 });
    vote(director, c.now, 'd', 'jellyfish', { weight: -5 });
    assert.equal(meter('jellyfish').count, 4);
    assert.equal(meter('jellyfish').voice, 10 + 20 + 1 + 1);
  });

  test('unknown intents are rejected', () => {
    const { c, director } = makeTank();
    for (const intent of ['kraken', 'golden', 'fish_add', '', undefined]) {
      assert.deepEqual(vote(director, c.now, 'a', intent), { accepted: false, reason: 'unknown' });
    }
  });
});

// ---------------------------------------------------------------------------
// Event parameters: shapes and trends, not exact tuning numbers
// ---------------------------------------------------------------------------
describe('event parameters scale with the crowd', () => {
  const crowd = [1, 2, 3, 5, 10, 20, 50, 100, 300, 1000];
  const fireWith = (intent, voters, seed = 7) => {
    const { c, director, tickFor, kinds } = makeTank({ seed });
    for (let i = 0; i < voters; i++) vote(director, c.now, `u${i}`, intent);
    tickFor(RULES[intent].gatherMs + 100);
    const [ev] = kinds(intent);
    assert.ok(ev, `${intent} with ${voters} voters fired`);
    assert.equal(ev.by.count, voters);
    return ev;
  };
  const assertGrowsThenCaps = (label, values) => {
    assert.ok(values.every((v) => Number.isFinite(v) && v > 0), `${label}: ${values.join()}`);
    for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1], `${label} never shrinks: ${values.join()}`);
    assert.ok(values.at(-1) > values[0], `${label} grows with the crowd: ${values.join()}`);
    assert.equal(values.at(-1), values.at(-2), `${label} is capped: ${values.join()}`);
  };

  test('FEED: more voters bring more food, up to a cap; the food lands inside the tank', () => {
    const feeds = crowd.map((n) => fireWith('feed', n));
    const amounts = feeds.map((e) => e.params.amount);
    assertGrowsThenCaps('food amount', amounts);
    assert.ok(amounts[1] > amounts[0], 'a second voter already adds food');
    assert.ok(feeds.every((e) => e.params.durationMs === RULES.feed.durationMs));
    for (let seed = 1; seed <= 20; seed++) {
      const { x } = fireWith('feed', 1, seed).params;
      assert.ok(Number.isFinite(x) && Math.abs(x) <= 6, `drop position x = ${x}`);
    }
  });

  test('BUBBLES intensity and the JELLYFISH swarm also grow with the crowd, up to a cap', () => {
    assertGrowsThenCaps('bubble intensity', crowd.map((n) => fireWith('bubbles', n).params.intensity));
    const jellyCrowd = crowd.filter((n) => n >= RULES.jellyfish.need[0]);
    assertGrowsThenCaps('jellyfish count', jellyCrowd.map((n) => fireWith('jellyfish', n).params.count));
  });
});

// ---------------------------------------------------------------------------
// 4. Priority and global spacing
// ---------------------------------------------------------------------------
describe('priority and pacing', () => {
  test('SHARK (priority 5) and FEED (priority 3) ready in the same tick: SHARK first, FEED minGapMs later', () => {
    const run = (withShark) => {
      const { c, director } = makeTank();
      const t0 = c.now;
      const fired = [];
      for (let t = t0; t <= t0 + 10_000; t += 100) {
        c.now = t;
        if (t === t0) vote(director, t, 'feeder', 'feed');
        // SHARK gathers for 1.5 s, FEED for 3 s: both become ready at t0 + 3000.
        if (withShark && t === t0 + RULES.feed.gatherMs - RULES.shark.gatherMs) {
          for (const u of ['a', 'b', 'c']) vote(director, t, u, 'shark');
        }
        const out = director.tick(t);
        if (out.length) fired.push({ dt: t - t0, kinds: out.map((e) => e.kind) });
      }
      return { fired, director };
    };

    // Control: FEED alone fires as soon as it has gathered.
    assert.deepEqual(run(false).fired, [{ dt: RULES.feed.gatherMs, kinds: ['feed'] }]);

    const { fired, director } = run(true);
    assert.deepEqual(fired, [
      { dt: RULES.feed.gatherMs, kinds: ['shark'] },
      { dt: RULES.feed.gatherMs + director.limits.minGapMs, kinds: ['feed'] },
    ]);
    assert.equal(director.limits.minGapMs, 3500);
  });

  test('the events-per-minute budget holds further events back until the window frees up', () => {
    const { c, director } = makeTank({ limits: { minGapMs: 0, perMin: { interactive: 2, tv: 1 } } });
    const t0 = c.now;
    const fired = [];
    let n = 0;
    for (let t = t0; t <= t0 + 70_000; t += 100) {
      c.now = t;
      if (t === t0) {
        for (const u of ['a', 'b', 'c']) vote(director, t, u, 'shark');
        vote(director, t, 'd', 'bubbles');
      }
      if ((t - t0) % 5000 === 0) vote(director, t, `hungry${n++}`, 'feed'); // the crowd keeps asking for food
      for (const e of director.tick(t)) fired.push({ kind: e.kind, dt: t - t0 });
    }
    assert.deepEqual(fired, [
      { kind: 'shark', dt: RULES.shark.gatherMs },
      { kind: 'bubbles', dt: RULES.bubbles.gatherMs },
      // FEED was ready at 3 s, but 2 events/min were spent: it waits for the shark to leave the window
      { kind: 'feed', dt: RULES.shark.gatherMs + 60_100 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5. TV mode
// ---------------------------------------------------------------------------
describe('TV mode', () => {
  test('SHARK is rejected with "mode"; FEED is allowed with the long tvCooldownMs', () => {
    const { c, director, tickFor, kinds, meter } = makeTank({ mode: 'tv' });
    assert.deepEqual(vote(director, c.now, 'a', 'shark'), { accepted: false, reason: 'mode' });
    for (const intent of ['jellyfish', 'night', 'day', 'spawn', 'myfish']) {
      assert.equal(vote(director, c.now, 'b', intent).reason, 'mode', intent);
    }
    assert.equal(meter('shark').enabled, false);
    assert.equal(meter('feed').enabled, true);

    assert.equal(vote(director, c.now, 'c', 'feed').accepted, true);
    tickFor(RULES.feed.gatherMs + 100);
    assert.equal(kinds('feed').length, 1);
    const [first] = kinds('feed');
    assert.equal(director.cooldownLeft('feed', first.at), RULES.feed.tvCooldownMs);

    // A hungry crowd keeps asking every 10 s: the interactive 25 s cooldown does not apply in TV mode...
    let n = 0;
    const ask = (t) => {
      if ((t - first.at) % 10_000 === 0) vote(director, t, `viewer${n++}`, 'feed');
    };
    tickFor(first.at + RULES.feed.tvCooldownMs - 100 - c.now, 100, ask);
    assert.equal(kinds('feed').length, 1);
    // ...the next feeding comes exactly when the TV cooldown ends.
    tickFor(200, 100, ask);
    assert.equal(kinds('feed').length, 2);
    assert.equal(kinds('feed')[1].at - first.at, RULES.feed.tvCooldownMs);
  });

  test('switching modes clears pending votes and queued requests', () => {
    const { c, director, tickFor, kinds, meter } = makeTank();
    vote(director, c.now, 'a', 'shark');
    vote(director, c.now, 'b', 'shark');
    vote(director, c.now, 'c', 'spawn');
    assert.equal(director.setMode('tv'), true);
    assert.equal(director.mode, 'tv');
    assert.equal(meter('shark').count, 0);
    assert.equal(meter('spawn').queued, 0);
    assert.equal(director.setMode('party'), false);
    assert.equal(director.mode, 'tv');
    tickFor(5000);
    assert.equal(kinds('fish_add').length, 0);
  });
});

// ---------------------------------------------------------------------------
// 6. Admin can do everything
// ---------------------------------------------------------------------------
describe('admin override: an admin vote passes every gate', () => {
  const admin = (intent, extra = {}) => ({ userId: 'yt:owner', userName: 'Owner', intent, admin: true, ...extra });

  test('mode + threshold: one admin SHARK fires at once in TV mode, without waiting for a tick', () => {
    const { c, director, events } = makeTank({ mode: 'tv' });
    const r = director.vote(admin('shark'), c.now);
    assert.equal(r.accepted, true);
    assert.equal(r.reason, 'admin');
    assert.equal(r.event.kind, 'shark');
    assert.equal(r.event.by.admin, true);
    assert.equal(r.event.by.count, 1);
    assert.deepEqual(r.event.by.names, ['Owner']);
    assert.deepEqual(events, [r.event], 'published synchronously');
  });

  test('cooldown: admin SHARK fires while the shark is on cooldown', () => {
    const { c, director, tickFor, kinds } = makeTank();
    for (const u of ['a', 'b', 'c']) vote(director, c.now, u, 'shark');
    tickFor(2000);
    assert.equal(kinds('shark').length, 1);
    assert.ok(director.cooldownLeft('shark', c.now) > 0);
    assert.equal(director.vote(admin('shark'), c.now).event.kind, 'shark');
    assert.equal(kinds('shark').length, 2);
  });

  test('rate limits: per-user tokens, duplicates, minGapMs and the per-minute budget do not apply', () => {
    const { c, director, events } = makeTank();
    const intents = ['shark', 'feed', 'bubbles', 'jellyfish'];
    for (let i = 0; i < 20; i++) {
      const r = director.vote(admin(intents[i % intents.length]), c.now); // 20 events in the same millisecond
      assert.equal(r.reason, 'admin', `admin vote #${i}`);
    }
    assert.equal(events.length, 20);
    assert.ok(20 > director.limits.perMin.interactive && 20 > director.limits.userBurst);
  });

  test('state: admin NIGHT fires even when it is already night', () => {
    const { c, world, director } = makeTank();
    world.skipTo('night', c.now, 1000);
    c.advance(1000);
    assert.equal(world.isNight(c.now), true);
    assert.equal(vote(director, c.now, 'viewer', 'night').reason, 'already');
    const r = director.vote(admin('night'), c.now);
    assert.equal(r.reason, 'admin');
    assert.equal(r.event.kind, 'night');
  });

  test('population cap: admin spawn works in a full tank where nobody can be rehomed', () => {
    const { c, world, director } = makeTank({ populationCap: 42 });
    world.state.fish.forEach((f, i) => {
      f.ownerId = `yt:pet${i}`; // everybody's pet: no rehome candidate
    });
    assert.equal(world.population, 42);
    assert.equal(world.rehomeCandidate(), null);
    assert.equal(vote(director, c.now, 'viewer', 'spawn').reason, 'full');

    const r = director.vote(admin('spawn', { species: 'clownfish' }), c.now);
    assert.equal(r.reason, 'admin');
    assert.equal(r.event.kind, 'fish_add');
    assert.equal(r.event.params.fish.species, 'clownfish');
    assert.equal(world.population, 43);
  });

  test('population cap: admin spawn rehomes the oldest ownerless fish when it can; panel fish belong to nobody', () => {
    const { c, world, director, events } = makeTank({ populationCap: 42 });
    const oldest = world.rehomeCandidate();
    const r = director.vote(admin('spawn', { species: 'gramma', source: 'panel' }), c.now);
    assert.deepEqual(events.map((e) => e.kind), ['fish_remove', 'fish_add']);
    assert.deepEqual(events[0].params, { fishId: oldest.id, reason: 'rehomed' });
    assert.equal(r.event.params.fish.ownerId, null);
    assert.equal(r.event.params.fish.name, null);
    assert.equal(world.population, 42);
  });

  test('requests: the channel owner gets fish at once, twice in a row, and a spotlight on them', () => {
    const { c, world, director } = makeTank();
    const a = director.vote(admin('spawn', { species: 'tang', source: 'rules' }), c.now);
    const b = director.vote(admin('spawn', { species: 'chromis', source: 'rules' }), c.now); // no has_fish/user_cooldown
    assert.equal(a.event.kind, 'fish_add');
    assert.equal(b.event.kind, 'fish_add');
    assert.equal(a.event.params.fish.ownerId, 'yt:owner');
    assert.equal(world.state.fish.filter((f) => f.ownerId === 'yt:owner').length, 2);
    const s = director.vote(admin('myfish'), c.now);
    assert.equal(s.event.kind, 'spotlight');
    assert.equal(s.event.params.fishId, a.event.params.fish.id);
  });

  test('wish: an admin golden fish comes even in TV mode and leaves the luck meter alone', () => {
    const { c, world, director } = makeTank({ mode: 'tv' });
    for (let i = 0; i < 5; i++) vote(director, c.now, `w${i}`, 'wish');
    const r = director.vote(admin('wish'), c.now);
    assert.equal(r.event.kind, 'golden');
    assert.equal(world.state.luck, 5);
  });
});

// ---------------------------------------------------------------------------
// 7. Personal requests
// ---------------------------------------------------------------------------
describe('personal requests: !fish and !myfish', () => {
  test('spawn requests are queued and served one per gapMs; each fish belongs to its viewer', () => {
    const { c, world, director, tickFor, kinds, meter } = makeTank();
    const t0 = c.now;
    const viewers = [['yt:ann', 'Ann', 'clownfish'], ['yt:bob', 'Bob', 'tang'], ['yt:cid', 'Cid', undefined]];
    for (const [userId, userName, species] of viewers) {
      const r = director.vote({ userId, userName, intent: 'spawn', species }, c.now);
      assert.equal(r.accepted, true);
      assert.equal(r.reason, 'queued');
    }
    assert.equal(meter('spawn').queued, 3);
    director.tick(c.now);
    tickFor(3 * RULES.spawn.gapMs);

    const adds = kinds('fish_add');
    assert.deepEqual(adds.map((e) => e.at - t0), [0, RULES.spawn.gapMs, 2 * RULES.spawn.gapMs]);
    adds.forEach((ev, i) => {
      const [userId, userName, species] = viewers[i];
      assert.equal(ev.params.fish.ownerId, userId);
      assert.equal(ev.params.fish.name, userName);
      assert.equal(ev.params.born, false);
      assert.deepEqual(ev.by.names, [userName]);
      assert.equal(world.fishOf(userId), ev.params.fish);
      if (species) assert.equal(ev.params.fish.species, species);
      else assert.ok(SPAWNABLE.includes(ev.params.fish.species));
    });
    assert.equal(meter('spawn').queued, 0);
  });

  test('one fish per viewer: a second request is rejected (dup while queued, user_cooldown, later has_fish)', () => {
    const { c, director, tickFor } = makeTank();
    assert.equal(vote(director, c.now, 'yt:ann', 'spawn').reason, 'queued');
    assert.equal(vote(director, c.now, 'yt:ann', 'spawn').reason, 'dup');
    tickFor(1000);
    // The personal cooldown starts when the fish is actually delivered.
    assert.equal(vote(director, c.now, 'yt:ann', 'spawn').reason, 'user_cooldown');
    c.advance(RULES.spawn.perUserMs);
    assert.equal(vote(director, c.now, 'yt:ann', 'spawn').reason, 'has_fish');
  });

  test('!myfish without a fish is "no_fish"; with a fish it puts a spotlight on it', () => {
    const { c, world, director, tickFor, kinds } = makeTank();
    assert.equal(vote(director, c.now, 'yt:ann', 'myfish').reason, 'no_fish');
    director.vote({ userId: 'yt:ann', userName: 'Ann', intent: 'spawn', species: 'gramma' }, c.now);
    tickFor(100);
    const fish = world.fishOf('yt:ann');
    assert.ok(fish);

    assert.equal(director.vote({ userId: 'yt:ann', userName: 'Ann', intent: 'myfish' }, c.now).reason, 'queued');
    tickFor(100);
    const [spot] = kinds('spotlight');
    assert.deepEqual(spot.params, { fishId: fish.id, name: 'Ann', species: 'gramma', survived: 0, durationMs: RULES.myfish.durationMs });
    assert.equal(vote(director, c.now, 'yt:ann', 'myfish').reason, 'user_cooldown');
  });

  test('an unknown species becomes a random spawnable one', () => {
    const { c, director, tickFor, kinds } = makeTank();
    director.vote({ userId: 'a', intent: 'spawn', species: 'megalodon' }, c.now);
    tickFor(100);
    assert.ok(SPAWNABLE.includes(kinds('fish_add')[0].params.fish.species));
  });

  test('in a full tank an old ownerless fish moves out to make room for a viewer fish', () => {
    const { c, world, director, events, tickFor } = makeTank({ populationCap: 42 });
    const oldest = world.rehomeCandidate();
    director.vote({ userId: 'yt:ann', intent: 'spawn', species: 'clownfish' }, c.now);
    tickFor(100);
    assert.deepEqual(events.map((e) => e.kind), ['fish_remove', 'fish_add']);
    assert.deepEqual(events[0].params, { fishId: oldest.id, reason: 'rehomed' });
    assert.equal(world.population, 42);
    assert.equal(world.fishOf('yt:ann').species, 'clownfish');
  });

  test('the spawn queue is bounded and stale requests expire', () => {
    const { c, director, kinds } = makeTank();
    for (let i = 0; i < RULES.spawn.queueMax; i++) assert.equal(vote(director, c.now, `u${i}`, 'spawn').reason, 'queued');
    assert.equal(vote(director, c.now, 'late', 'spawn').reason, 'queue_full');

    // The loop stalls for longer than queueTtlMs: nothing is served, everything expires.
    c.advance(RULES.spawn.queueTtlMs + 1);
    director.tick(c.now);
    assert.equal(kinds('fish_add').length, 0);
    assert.equal(director.snapshot(c.now).stats.rejected.expired, RULES.spawn.queueMax);
  });
});

// ---------------------------------------------------------------------------
// 8. Night and day
// ---------------------------------------------------------------------------
describe('night and day', () => {
  test('NIGHT while it is already night (and DAY by day) is rejected with "already"', () => {
    const { c, world, director, meter } = makeTank();
    assert.equal(world.isNight(c.now), false);
    assert.equal(vote(director, c.now, 'a', 'day').reason, 'already');
    world.skipTo('night', c.now, 1000);
    c.advance(1000);
    assert.equal(world.isNight(c.now), true);
    assert.equal(vote(director, c.now, 'b', 'night').reason, 'already');
    assert.equal(meter('night').blocked, 'already');
    assert.equal(meter('day').blocked, null);
  });

  test('a NIGHT event fast-forwards the world: it is night once transitionMs has passed', () => {
    const { c, world, director, tickFor, kinds } = makeTank();
    for (const u of ['a', 'b', 'c']) vote(director, c.now, u, 'night');
    tickFor(RULES.night.gatherMs + 100);
    const [night] = kinds('night');
    assert.ok(night, 'NIGHT fired');
    assert.equal(night.params.target, NIGHT_TARGET);
    const { transitionMs } = night.params;
    assert.ok(transitionMs > 0);

    const from = world.tod(night.at);
    assert.equal(world.isNight(night.at), false, 'still day when the transition starts');
    const mid = world.tod(night.at + transitionMs / 2);
    assert.ok(mid > from && mid < NIGHT_TARGET, `mid-transition tod ${mid}`);
    assert.equal(world.isNight(night.at + transitionMs), true);
    assert.ok(Math.abs(world.tod(night.at + transitionMs) - NIGHT_TARGET) < 1e-9);
  });

  test('DAY and NIGHT share the "light" cooldown group', () => {
    const { c, world, director, tickFor, kinds } = makeTank();
    for (const u of ['a', 'b', 'c']) vote(director, c.now, u, 'night');
    tickFor(RULES.night.gatherMs + 100);
    const [night] = kinds('night');
    assert.equal(night.at, c.now);
    assert.equal(director.cooldownLeft('night', c.now), RULES.night.cooldownMs);
    assert.equal(director.cooldownLeft('day', c.now), RULES.night.cooldownMs, 'DAY is on the same cooldown');

    tickFor(night.params.transitionMs);
    assert.equal(world.isNight(c.now), true);
    for (const u of ['d', 'e', 'f']) assert.equal(vote(director, c.now, u, 'day').reason, 'vote');
    tickFor(night.at + RULES.day.cooldownMs - 100 - c.now);
    assert.equal(kinds('day').length, 0, 'no DAY while the light group cools down');

    tickFor(100);
    for (const u of ['g', 'h', 'i']) vote(director, c.now, u, 'day');
    tickFor(RULES.day.gatherMs + 100);
    const [day] = kinds('day');
    assert.ok(day, 'DAY fired after the shared cooldown');
    assert.equal(day.params.target, DAY_TARGET);
    assert.equal(director.cooldownLeft('night', c.now), RULES.day.cooldownMs - (c.now - day.at));
  });
});

// ---------------------------------------------------------------------------
// 9. Wish meter
// ---------------------------------------------------------------------------
describe('wish meter and the golden fish', () => {
  test('unique wishers fill world.state.luck; a golden fish comes when it is full and the meter resets', () => {
    const { c, world, director, tickFor, meter } = makeTank();
    assert.equal(director.luckTarget(), RULES.wish.target[0]);
    for (let i = 0; i < 19; i++) {
      assert.equal(director.vote({ userId: `w${i}`, userName: `W${i}`, intent: 'wish' }, c.now).reason, 'luck');
    }
    assert.equal(world.state.luck, 19);
    assert.equal(vote(director, c.now, 'w0', 'wish').reason, 'user_cooldown', 'one wish per viewer per perUserMs');
    assert.equal(world.state.luck, 19);
    assert.equal(tickFor(1000).length, 0);
    assert.equal(meter('wish').voice, 19);
    assert.equal(meter('wish').need, 20);

    director.vote({ userId: 'w19', userName: 'W19', intent: 'wish' }, c.now);
    assert.equal(world.state.luck, 20);
    const fired = director.tick(c.now);
    assert.equal(fired.length, 1);
    const [golden] = fired;
    assert.equal(golden.kind, 'golden');
    assert.equal(golden.by.count, 20);
    assert.deepEqual(golden.by.names, ['W19', 'W18', 'W17']);
    assert.equal(golden.params.durationMs, RULES.wish.durationMs);
    assert.equal(world.state.luck, 0);
  });

  test('luck never overflows the target', () => {
    const { c, world, director } = makeTank();
    for (let i = 0; i < 30; i++) vote(director, c.now, `w${i}`, 'wish');
    assert.equal(world.state.luck, director.luckTarget());
  });

  test('an ambient golden visit (systemFire) does not spend the chat luck meter', () => {
    const { c, world, director } = makeTank();
    for (let i = 0; i < 5; i++) vote(director, c.now, `w${i}`, 'wish');
    assert.equal(world.state.luck, 5);
    const visit = director.systemFire('wish', c.now);
    assert.equal(visit.kind, 'golden');
    assert.equal(visit.by.system, true);
    assert.equal(world.state.luck, 5);
  });

  test('a full meter waits for the golden fish cooldown (e.g. after a natural visit)', () => {
    const { c, world, director, tickFor, kinds } = makeTank();
    const visit = director.systemFire('wish', c.now);
    for (let i = 0; i < 20; i++) vote(director, c.now, `w${i}`, 'wish');
    assert.equal(world.state.luck, 20);
    tickFor(visit.at + RULES.wish.cooldownMs - 100 - c.now);
    assert.equal(kinds('golden').length, 1);
    tickFor(100);
    assert.equal(kinds('golden').length, 2);
    assert.equal(world.state.luck, 0);
  });
});

// ---------------------------------------------------------------------------
// 10. Whitelist of engine events
// ---------------------------------------------------------------------------
describe('engine event whitelist', () => {
  test('a 30-minute randomized soak (chat, admins, mode switches, ambient life) only emits ENGINE_EVENTS', () => {
    const rng = seededRng(2026);
    const c = makeClock();
    const world = new World({ dataDir: null, clock: c.clock, rng: seededRng(11), populationCap: 60, dayLengthMin: 4 }).load();
    const director = new Director({ world, clock: c.clock, rng: seededRng(12) });
    const ambient = new Ambient({
      director, world, clock: c.clock, rng: seededRng(13),
      config: { feedEveryMin: 3, tvFeedEveryMin: 2, goldenMeanMin: 4, nightJellyMeanMin: 2, birthsPerDayPerSpecies: 400 },
    });
    const seen = [];
    director.on((ev) => seen.push(ev));
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const intents = [...INTENTS, 'kraken', 'golden', 'fish_add', ''];
    const reasons = new Set();

    for (const end = c.now + 30 * 60_000; c.now < end; c.advance(100)) {
      const n = Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const userId = `u${Math.floor(rng() * 400)}`;
        director.noteActivity(userId, c.now);
        const r = director.vote({
          userId, userName: userId, intent: pick(intents), species: pick([...SPAWNABLE, 'any', 'shark', undefined]),
          weight: pick([1, 1, 1, 2, 3, 10]), admin: rng() < 0.01, source: pick(['rules', 'ai', 'panel']),
        }, c.now);
        reasons.add(r.reason);
      }
      if (rng() < 0.0005) director.setMode(director.mode === 'tv' ? 'interactive' : 'tv');
      if (rng() < 0.001) director.systemFire(pick(INTENTS), c.now, {});
      director.tick(c.now);
      ambient.tick(c.now);
    }

    const allowed = new Set(ENGINE_EVENTS);
    assert.deepEqual(seen.filter((e) => !allowed.has(e.kind)).map((e) => e.kind), []);
    const kindsSeen = new Set(seen.map((e) => e.kind));
    assert.ok(kindsSeen.size >= 8, `only saw ${[...kindsSeen].join(', ')}`);
    assert.ok(reasons.has('admin') && reasons.has('unknown') && reasons.has('vote'), [...reasons].join(', '));
    for (let i = 1; i < seen.length; i++) {
      assert.ok(seen[i].id > seen[i - 1].id, 'event ids increase');
      assert.ok(seen[i].at >= seen[i - 1].at, 'events are in time order');
    }
  });

  test('snapshot() describes every intent', () => {
    const { c, director } = makeTank();
    const snap = director.snapshot(c.now);
    assert.equal(snap.mode, 'interactive');
    assert.deepEqual(snap.meters.map((m) => m.intent), INTENTS);
    for (const m of snap.meters) assert.equal(m.kind, RULES[m.intent].kind);
  });
});

// ---------------------------------------------------------------------------
// Known problems (see the report)
// ---------------------------------------------------------------------------
describe('director: known problems', () => {
  test('fixed: three active viewers who all vote SHARK can summon it (need is ceil(3.12) = 4 today)', () => {
    const { c, director, tickFor, kinds } = makeTank();
    for (const u of ['a', 'b', 'c']) {
      director.noteActivity(u, c.now);
      vote(director, c.now, u, 'shark');
    }
    tickFor(5000);
    assert.equal(kinds('shark').length, 1);
  });

  test('fixed: an accepted spawn request that expires unserved does not lock the viewer out for 20 min', () => {
    const { c, world, director, tickFor } = makeTank();
    const ids = Array.from({ length: RULES.spawn.queueMax }, (_, i) => `u${i}`);
    for (const id of ids) vote(director, c.now, id, 'spawn');
    tickFor(RULES.spawn.queueTtlMs + 10_000);
    const lockedOut = ids.filter((id) => !world.fishOf(id) && vote(director, c.now, id, 'spawn').reason !== 'queued');
    assert.deepEqual(lockedOut, []);
  });

  test('fixed: a non-numeric weight cannot push a single vote over the threshold (voice becomes NaN)', () => {
    const { c, director, tickFor, kinds } = makeTank();
    for (let i = 0; i < 10; i++) director.noteActivity(`chatter${i}`, c.now);
    vote(director, c.now, 'a', 'shark', { weight: 'lots' });
    tickFor(5000);
    assert.equal(kinds('shark').length, 0);
  });

  test('fixed: an intent named like an Object.prototype key is "unknown" instead of a TypeError', () => {
    const { c, director } = makeTank();
    for (const intent of ['constructor', 'toString', '__proto__']) {
      assert.equal(vote(director, c.now, 'a', intent).reason, 'unknown', intent);
    }
  });
});

// ---------------------------------------------------------------------------
// Consequences: the shark eats, the golden fish leaves a gift
// ---------------------------------------------------------------------------
describe('the shark takes one fish per visit', () => {
  const shark = (director, c) => director.vote({ userId: 'host', userName: 'Host', intent: 'shark', admin: true, source: 'panel' }, c.now).event;

  test('the victim leaves the world at once and is named in the event; everyone else survived one more shark', () => {
    const { c, world, director } = makeTank();
    const before = world.population;
    const ev = shark(director, c);
    const { victim, huntAtMs } = ev.params;
    assert.ok(victim, 'a 42-fish tank always has someone to catch');
    assert.equal(world.population, before - 1);
    assert.equal(world.state.fish.find((f) => f.id === victim.id), undefined);
    assert.ok(huntAtMs >= RULES.shark.eat.huntAfterMs[0] && huntAtMs <= RULES.shark.eat.huntAfterMs[1]);
    assert.ok(world.state.fish.every((f) => f.survived === 1));
    assert.equal(world.state.stats.eaten, 1);
    assert.equal('ownerId' in victim, false, 'the event carries no channel id');
  });

  test('clownfish (safe in their anemone) and babies are never eaten', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { c, world, director } = makeTank({ seed });
      world.addFish({ species: 'chromis', bornAt: c.now }); // a newborn
      const ev = shark(director, c);
      const v = ev.params.victim;
      assert.notEqual(v.species, 'clownfish');
      assert.ok(world.state.fish.some((f) => f.bornAt === c.now), 'the baby is still there');
    }
  });

  test('ownerless fish are the likelier victims; a viewer who loses a fish may !fish again at once', () => {
    let ownedLost = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { c, world, director, tickFor } = makeTank({ seed });
      // A viewer adopts a fish, then the shark comes.
      director.vote({ userId: 'yt:ann', userName: 'Ann', intent: 'spawn', species: 'tang' }, c.now);
      tickFor(100);
      const own = world.fishOf('yt:ann');
      own.bornAt -= 2 * 86400000; // old enough to be caught
      const ev = shark(director, c);
      if (ev.params.victim.id === own.id) {
        ownedLost++;
        assert.equal(ev.params.victim.name, 'Ann');
        assert.equal(director.vote({ userId: 'yt:ann', userName: 'Ann', intent: 'spawn' }, c.now).reason, 'queued');
      }
    }
    assert.ok(ownedLost < 10, `one owned fish among ~39 catchable ones should rarely be picked (was ${ownedLost}/60)`);
  });

  test('a nearly empty tank is left alone', () => {
    const { c, world, director } = makeTank();
    for (const f of [...world.state.fish].slice(0, world.population - 11)) world.removeFish(f.id);
    assert.equal(shark(director, c).params.victim, null);
    assert.equal(world.population, 11);
  });
});

describe('the golden fish leaves a gift', () => {
  test('shortly before the visit ends, a baby fish is announced as a gift', () => {
    const { c, world, director, tickFor, kinds } = makeTank();
    const before = world.population;
    director.vote({ userId: 'host', userName: 'Host', intent: 'wish', admin: true, source: 'panel' }, c.now);
    tickFor(RULES.wish.durationMs - RULES.wish.giftBeforeEndMs - 200);
    assert.equal(kinds('fish_add').length, 0);
    tickFor(400);
    const [gift] = kinds('fish_add');
    assert.ok(gift, 'the gift arrived');
    assert.equal(gift.params.born, true);
    assert.equal(gift.params.gift, true);
    assert.equal(world.population, before + 1);
  });
});

