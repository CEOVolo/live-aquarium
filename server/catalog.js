// The whitelist. Everything chat (rules or AI) can ask for is an INTENT from this
// file, and everything the render engine can be told to do is an ENGINE_EVENT.
// Nothing outside these lists ever reaches the engine.

export const SPECIES = {
  chromis: 'Chromis',
  clownfish: 'Clownfish',
  tang: 'Blue Tang',
  yellowtang: 'Yellow Tang',
  gramma: 'Royal Gramma',
  cardinal: 'Cardinalfish',
};

export const SPAWNABLE = Object.keys(SPECIES);

export const INTENTS = ['feed', 'shark', 'night', 'day', 'bubbles', 'wish', 'jellyfish', 'spawn', 'myfish'];

export const ENGINE_EVENTS = [
  'feed', 'shark', 'night', 'day', 'bubbles', 'golden', 'jellyfish',
  'fish_add', 'fish_remove', 'spotlight',
];

// How chat votes turn into events.
//  kind 'vote'    - many viewers vote; fires once `need` unique voters agree inside `windowMs`.
//                   need = min(base + floor(frac * activeChatters), max), and never more than
//                   the number of active chatters, so a tiny audience can still trigger everything.
//  kind 'meter'   - every unique viewer adds to a persistent meter; fires when it is full.
//  kind 'request' - personal request of one viewer, queued and served one by one.
// `gatherMs` keeps the vote open a little after the threshold so simultaneous
// voters are merged into the same event instead of producing a second one.
export const RULES = {
  feed: {
    kind: 'vote', need: [1, 0, 1], windowMs: 15000, gatherMs: 3000,
    cooldownMs: 25000, tvCooldownMs: 10 * 60000, priority: 3,
    modes: ['interactive', 'tv'], durationMs: 22000,
  },
  bubbles: {
    kind: 'vote', need: [1, 0, 1], windowMs: 10000, gatherMs: 2000,
    cooldownMs: 30000, tvCooldownMs: 5 * 60000, priority: 1,
    modes: ['interactive', 'tv'], durationMs: 12000,
  },
  shark: {
    kind: 'vote', need: [3, 0.04, 60], windowMs: 30000, gatherMs: 1500,
    cooldownMs: 3 * 60000, priority: 5, modes: ['interactive'], durationMs: 55000,
    // One fish per visit. Babies and clownfish (they hide in their anemone) are safe; a fish
    // without an owner is three times likelier to be caught than a viewer's fish. The shark
    // circles for huntAfterMs before it picks the victim out, so everyone sees it coming.
    eat: { ownerlessWeight: 3, ownedWeight: 1, safe: ['clownfish'], minAgeMs: 86400000, minPopulation: 12, huntAfterMs: [10000, 18000] },
  },
  jellyfish: {
    kind: 'vote', need: [3, 0.03, 40], windowMs: 30000, gatherMs: 1500,
    cooldownMs: 4 * 60000, priority: 4, modes: ['interactive'], durationMs: 120000,
  },
  night: {
    kind: 'vote', need: [3, 0.03, 40], windowMs: 30000, gatherMs: 1500,
    cooldownMs: 4 * 60000, priority: 4, group: 'light', modes: ['interactive'],
  },
  day: {
    kind: 'vote', need: [3, 0.03, 40], windowMs: 30000, gatherMs: 1500,
    cooldownMs: 4 * 60000, priority: 4, group: 'light', modes: ['interactive'],
  },
  wish: {
    kind: 'meter', perUserMs: 10 * 60000, target: [20, 0.3, 300],
    cooldownMs: 10 * 60000, priority: 6, modes: ['interactive', 'tv'], durationMs: 100000,
    // Before leaving, the golden fish grants the wish: a baby fish appears.
    giftBeforeEndMs: 5000,
  },
  spawn: {
    kind: 'request', perUserMs: 20 * 60000, gapMs: 2500, queueMax: 40, queueTtlMs: 120000,
    priority: 2, modes: ['interactive'],
  },
  myfish: {
    kind: 'request', perUserMs: 3 * 60000, gapMs: 6000, queueMax: 6, queueTtlMs: 45000,
    priority: 2, modes: ['interactive'], durationMs: 10000,
  },
};

// Viewer-facing labels (the overlay is in English: the channel is international).
export const INTENT_LABEL = {
  feed: 'FEED', shark: 'SHARK', night: 'NIGHT', day: 'DAY', bubbles: 'BUBBLES',
  wish: 'WISH', jellyfish: 'JELLY', spawn: '!fish', myfish: '!myfish',
};
