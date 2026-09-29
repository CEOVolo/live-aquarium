import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, isAiCandidate, normalize, tokenize } from '../server/parser.js';
import { INTENTS, SPAWNABLE } from '../server/catalog.js';

// [chat message, expected intent, expected species (spawn only)]
const COMMANDS = [
  // English: case, typos, phrases
  ['SHARK', 'shark'],
  ['shrak', 'shark'], // two adjacent letters swapped
  ['sharkkkk', 'shark'], // stretched word
  ['SHARK 🦈', 'shark'],
  ['!shark', 'shark'],
  ['feed my fish', 'feed'], // the verb comes first: "my fish" does not make it !myfish
  ['FEED', 'feed'],
  ['feeed', 'feed'], // doubled letter
  ['they look hungry', 'feed'],
  ['more bubbles', 'bubbles'],
  ['jellyfsh', 'jellyfish'], // one letter missing from a long word
  ['nigth', 'night'],
  ['lights off', 'night'],
  ['night mode pls', 'night'],
  ['its too bright, can you turn it down?', 'night'], // the phrase beats the single word "bright"
  ['too dark', 'day'], // ...and "too dark" asks for DAY, not for "dark"
  ['lights on', 'day'],
  ['i wish for the golden fish', 'wish'],
  ['where is my fish', 'myfish'],
  ['!myfish', 'myfish'],
  // Russian / Ukrainian
  ['акула', 'shark'],
  ['АКУЛУ!', 'shark'],
  ['рыбки голодные', 'feed'],
  ['покормите рыбок', 'feed'],
  ['нагодуйте рибок', 'feed'],
  ['пусть будет темно', 'night'],
  ['выключи свет', 'night'],
  ['слишком темно', 'day'],
  ['увімкни світло', 'day'],
  ['бульбашки', 'bubbles'],
  ['золотая рыбка', 'wish'],
  ['медуза', 'jellyfish'],
  ['моя рыбка', 'myfish'],
  // other languages
  ['tubarão', 'shark'],
  ['comida', 'feed'],
  // emoji
  ['🦈🦈', 'shark'],
  ['🍤', 'feed'],
  ['🌙', 'night'],
  ['☀️', 'day'],
  ['🫧', 'bubbles'],
  ['✨', 'wish'],
  ['🪼', 'jellyfish'],
  // spawn requests
  ['!fish yellow tang', 'spawn', 'yellowtang'],
  ['хочу рыбку-клоуна', 'spawn', 'clownfish'],
  ['добавь рыбку', 'spawn', 'any'],
  ['🐠', 'spawn', 'any'],
  ['!fish', 'spawn', 'any'],
  ['!fish clownfish', 'spawn', 'clownfish'],
  ['/fish clownfish', 'spawn', 'clownfish'],
  ['give me a nemo', 'spawn', 'clownfish'],
  ['add dory', 'spawn', 'tang'],
  ['spawn chromis', 'spawn', 'chromis'],
  ['add a gramma', 'spawn', 'gramma'],
  ['!fish banggai', 'spawn', 'cardinal'],
  ['give me yellow fish', 'spawn', 'yellowtang'], // a colour names a species next to a fish word
  ['хочу желтого хирурга', 'spawn', 'yellowtang'],
  ['!fish shark', 'spawn', 'any'], // unknown species -> any fish, and no shark vote
];

// Everyday chat that must never cast a vote.
const CHATTER = [
  'share this stream', // one substituted letter is not a typo of "shark"
  'feel good',
  'dare you',
  'good night everyone', // greetings are not requests
  'goodnight',
  'buenas noches',
  'Bom dia!',
  'доброй ночи всем',
  'спокойной ночи',
  'добраніч',
  'have a nice day',
  'good morning from Brazil',
  'make it yellow', // a bare colour is not a species
  'yellow',
  'hello from Brazil',
  'so relaxing 😍',
  '🐠🐠 cute', // fish emoji are reactions unless they are the whole message
  'fish',
  'feedback',
  'no shark please', // negation
  'не акула',
  "don't feed them",
  'нет ночи',
  'lol',
];

describe('parseMessage: commands', () => {
  for (const [text, intent, species] of COMMANDS) {
    test(`${JSON.stringify(text)} -> ${intent}${species ? `/${species}` : ''}`, () => {
      const r = parseMessage(text);
      assert.equal(r.intent, intent);
      if (species) assert.equal(r.species, species);
      else assert.equal(r.species, undefined);
    });
  }
});

describe('parseMessage: everyday chat does not vote', () => {
  for (const text of CHATTER) {
    test(`${JSON.stringify(text)} -> no intent`, () => {
      const r = parseMessage(text);
      assert.equal(r.intent, null);
      assert.equal(typeof r.aiCandidate, 'boolean');
    });
  }

  test('a negated request is not a vote but is worth asking the AI about', () => {
    assert.deepEqual(parseMessage('no shark please'), { intent: null, aiCandidate: true });
  });

  test('greetings are plain chatter, not even AI candidates', () => {
    for (const text of ['good night everyone', 'доброй ночи всем', 'Bom dia!']) {
      assert.deepEqual(parseMessage(text), { intent: null, aiCandidate: false }, text);
    }
  });
});

describe('parseMessage: details', () => {
  test('short messages are high confidence, longer sentences medium', () => {
    assert.equal(parseMessage('SHARK').confidence, 'high');
    assert.equal(parseMessage('we need a shark').confidence, 'medium');
    assert.equal(parseMessage('!fish clownfish').confidence, 'high');
  });

  test('empty and non-string input never throws', () => {
    for (const input of [null, undefined, '', '   ', '\n', 42, {}, []]) {
      assert.deepEqual(parseMessage(input), { intent: null, aiCandidate: false }, String(input));
    }
    assert.equal(parseMessage('🦈'.repeat(500)).intent, 'shark');
    assert.equal(parseMessage('a'.repeat(10_000)).intent, null);
  });

  test('output always stays inside the whitelist', () => {
    const words = ['shark', 'SHRAK', 'feed', 'no', 'not', 'the', 'my', 'fish', '!fish', 'add', 'хочу', 'рыбку', 'клоун',
      'nemo', 'yellow', 'tang', 'good', 'night', 'too', 'dark', 'bright', 'lights', 'off', 'on', '🦈', '🐠', '🌙', '?',
      'please', 'medusa', 'golden', 'bubbles', 'акулу', 'темно', 'світло', 'myfish', '/', 'kraken', 'megalodon'];
    let seed = 42;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 3000; n++) {
      const text = Array.from({ length: 1 + Math.floor(next() * 5) }, () => words[Math.floor(next() * words.length)]).join(' ');
      const r = parseMessage(text);
      if (r.intent === null) {
        assert.equal(typeof r.aiCandidate, 'boolean', text);
        continue;
      }
      assert.ok(INTENTS.includes(r.intent), `${text} -> ${r.intent}`);
      if (r.intent === 'spawn') assert.ok([...SPAWNABLE, 'any'].includes(r.species), `${text} -> ${r.species}`);
      assert.ok(['high', 'medium'].includes(r.confidence), text);
    }
  });
});

describe('isAiCandidate', () => {
  test('free-form requests and questions go to the AI', () => {
    assert.equal(isAiCandidate('can we get something scary in there?'), true);
    assert.equal(isAiCandidate('it would be cool to see something glowing'), true);
    assert.equal(isAiCandidate('могли бы вы добавить что-то светящееся?'), true);
    assert.equal(parseMessage('могли бы вы добавить что-то светящееся?').aiCandidate, true);
  });

  test('plain chatter, very short or very long messages and links do not', () => {
    assert.equal(isAiCandidate('hello from Brazil'), false);
    assert.equal(isAiCandidate('lol'), false);
    assert.equal(isAiCandidate('ok?'), false);
    assert.equal(isAiCandidate(`please ${'x'.repeat(230)}`), false);
    assert.equal(isAiCandidate('please add a fish like https://example.com/fish.png'), false);
    assert.equal(isAiCandidate('please www.example.com'), false);
  });
});

describe('normalize / tokenize', () => {
  test('normalize lower-cases, folds ё, drops apostrophes and squeezes stretched letters', () => {
    assert.equal(normalize('ЁЖИК'), 'ежик');
    assert.equal(normalize("Don't"), 'dont');
    assert.equal(normalize('SHAAAAARK'), 'shaark');
    assert.equal(normalize(null), '');
  });

  test('tokenize keeps letters and digits of any script', () => {
    assert.deepEqual(tokenize('feed!!! the-fish, 2x 🦈 рыбку'), ['feed', 'the', 'fish', '2x', 'рыбку']);
  });
});

// ---------------------------------------------------------------------------
// Known problems (see the report). They are executable specs: each one lists
// the messages that are parsed wrongly today and will pass once fixed.
// ---------------------------------------------------------------------------
const mismatches = (cases, pick = (r) => r.intent) =>
  cases
    .map(([text, want]) => ({ text, want, got: pick(parseMessage(text)) ?? null }))
    .filter(({ want, got }) => want !== got);

describe('parseMessage: known problems', () => {
  test('fixed: everyday chat casts votes (prefix stems, false friends, greetings)', () => {
    const cases = [
      'нічого собі', // Ukrainian "wow": stem 'ніч' (night) matches "нічого" (nothing)
      'нічого не видно',
      'привіт Світлано', // the name Svitlana/Svetlana matches the stems 'світл'/'светл' (light)
      'Светлана привет',
      'еду домой', // "I'm going home": 'еду' is in the feed word list
      'this fish is a unit', // "unit" is an adjacent swap of French "nuit"
      'night all', // greetings, like "good night everyone"
      'night everyone',
      'night night',
      'morning everyone',
      'с добрым утром',
      'доброго утра',
      'day 3 of watching',
      'i like the light blue fish',
      'my new fish is cute', // "new" + "fish" = a spawn request
    ].map((t) => [t, null]);
    assert.deepEqual(mismatches(cases), []);
  });

  test('fixed: negation only looks one word back', () => {
    const cases = ['no more sharks', 'stop the shark', "I don't want a shark", 'i dont want night', 'dont make it dark',
      'не надо акулу', 'не хочу акулу', 'no more feeding', 'no 🦈'].map((t) => [t, null]);
    assert.deepEqual(mismatches(cases), []);
  });

  test('fixed: requests to turn the light down vote for DAY', () => {
    const cases = [['switch off the lights', 'night'], ['kill the lights', 'night'], ['dim the lights', 'night'],
      ['очень светло', 'night']];
    assert.deepEqual(mismatches(cases), []);
  });

  test('fixed: "!fish yellow" loses the species (the colour needs a fish word, but "fish" is the command)', () => {
    const cases = [['!fish yellow', 'yellowtang'], ['!fish желтый', 'yellowtang'], ['!рыбка желтую', 'yellowtang']];
    assert.deepEqual(mismatches(cases, (r) => r.species), []);
  });
});
