// Fake audience for testing without a live stream: tens to thousands of
// viewers chatting in several languages, typing commands, typos, emoji,
// free-form requests (for the AI parser) and plain chatter.

const NAMES = ['Anna', 'Max', 'Leo', 'Mia', 'Oliver', 'Sofia', 'Ivan', 'Olena', 'Kenji', 'Ana', 'Lucas', 'Emma',
  'Noah', 'Chloe', 'Mateo', 'Yuki', 'Dmytro', 'Maria', 'Sam', 'Ella', 'Omar', 'Zoe', 'Artem', 'Nina', 'Pedro',
  'Liam', 'Eva', 'Tom', 'Iris', 'Hana', 'Diego', 'Lena', 'Marco', 'Aisha', 'Felix', 'Julia', 'Oskar', 'Mila'];
const SUFFIX = ['', '_92', 'Fish', 'TV', '07', 'K', 'Live', '2k', '_ua', 'Reef', 'Blue', 'X', '_br', '88'];

const T = {
  feed: ['FEED', '!feed', 'feed', 'feed them', 'food!', '🍤', 'покорми', 'покормите рыбок', 'корм', 'нагодуйте',
    'feed pls 🍤', 'comida', 'feeeed', 'they look hungry'],
  shark: ['SHARK', 'shark!!!', '🦈', '🦈🦈🦈', 'SHARK SHARK', 'акула', 'АКУЛУ!', 'акулу давай', 'tiburon', 'tubarão',
    'shrak', 'we need a shark', 'SHARK 🦈'],
  night: ['night', 'NIGHT', '🌙', 'ночь', 'lights off', 'make it dark', 'ніч', 'night mode pls'],
  day: ['day', 'DAY', '☀️', 'день', 'lights on', 'bright pls', 'сонце'],
  bubbles: ['bubbles', '🫧', 'пузыри', 'бульбашки', 'BUBBLES', 'more bubbles'],
  wish: ['wish', '✨', 'golden', 'gold', 'желание', 'золотая рыбка', '🍀', 'luck', 'i wish for the golden fish'],
  jellyfish: ['jellyfish', 'jelly', '🪼', 'медуза', 'медузы', 'JELLY'],
  spawn: ['!fish clownfish', 'add clownfish', 'spawn tang', '!fish', 'добавь рыбку', 'хочу рыбку-клоуна', 'give me a nemo',
    'spawn chromis', '!fish yellow tang', 'add a gramma', '!fish cardinal', 'add dory'],
  myfish: ['!myfish', 'where is my fish', 'моя рыбка', 'my fish?'],
  freeform: ['can we get something scary in there?', 'it would be cool to see something glowing', 'can you make it darker please',
    'I wish for something magical to happen', 'могли бы вы добавить что-то светящееся?', 'пусть станет темно',
    'is it possible to add one more fish for me?', 'the little ones need something to eat', 'make it brighter pls i cant see'],
  chatter: ['so relaxing 😍', 'hello from Brazil', 'love this stream', 'first time here', 'lol', 'wow', 'that fish is cute',
    'привет всем', 'красиво', 'gg', 'what software is this?', '❤️', 'beautiful', 'watching from Poland 🇵🇱',
    'i fell asleep to this yesterday', 'is this real?', 'good night everyone', 'Bom dia!', 'so calm', 'nice 👍',
    'the blue one is my favorite', 'чудово', 'this is my screensaver now', '🐠🐠 cute', 'hi chat'],
};

const MIX = {
  calm: { chatter: 0.62, feed: 0.1, bubbles: 0.06, wish: 0.08, spawn: 0.06, myfish: 0.03, freeform: 0.05 },
  normal: { chatter: 0.42, feed: 0.1, shark: 0.08, night: 0.04, day: 0.04, bubbles: 0.06, wish: 0.07, jellyfish: 0.05,
    spawn: 0.07, myfish: 0.03, freeform: 0.04 },
};

export const SCENARIOS = {
  calm: { viewers: 12, everyS: [25, 90], mix: MIX.calm },
  normal: { viewers: 80, everyS: [15, 70], mix: MIX.normal },
  busy: { viewers: 400, everyS: [10, 50], mix: MIX.normal },
};

export class CrowdSimulator {
  constructor({ onMessage, clock = Date.now, rng = Math.random }) {
    this.onMessage = onMessage;
    this.clock = clock;
    this.rng = rng;
    this.viewers = [];
    this.raiders = [];
    this.raidUntil = 0;
    this.scenario = null;
    this.sent = 0;
    this.seq = 0;
  }

  pick(list) { return list[Math.floor(this.rng() * list.length)]; }

  name(i) { return `${NAMES[i % NAMES.length]}${SUFFIX[Math.floor(i / NAMES.length) % SUFFIX.length]}${i >= NAMES.length * SUFFIX.length ? i : ''}`; }

  start({ scenario = 'normal', viewers } = {}) {
    const sc = SCENARIOS[scenario] ?? SCENARIOS.normal;
    const n = Math.max(1, Math.min(5000, Number(viewers) || sc.viewers));
    const now = this.clock();
    this.scenario = { name: scenario in SCENARIOS ? scenario : 'normal', ...sc };
    this.viewers = Array.from({ length: n }, (_, i) => ({ id: `sim:${i}`, name: this.name(i), nextAt: now + this.rng() * sc.everyS[1] * 1000 }));
    return this.status();
  }

  stop() {
    this.viewers = [];
    this.raiders = [];
    this.scenario = null;
    return this.status();
  }

  /** A raid: `viewers` people spam the same command for `durationMs`. */
  raid({ intent = 'shark', viewers = 1000, durationMs = 20000 } = {}) {
    const now = this.clock();
    const n = Math.max(1, Math.min(5000, Number(viewers) || 1000));
    const templates = T[intent] ?? T.shark;
    this.raidUntil = now + durationMs;
    this.raiders = Array.from({ length: n }, (_, i) => ({
      id: `raid:${i}`, name: this.name(i + 500), templates, nextAt: now + this.rng() * 3000,
    }));
    return this.status();
  }

  tick(now = this.clock()) {
    const mix = this.scenario?.mix;
    for (const v of this.viewers) {
      if (now < v.nextAt) continue;
      const [a, b] = this.scenario.everyS;
      v.nextAt = now + (a + this.rng() * (b - a)) * 1000;
      this.send(v, this.pick(T[this.roll(mix)]), now);
    }
    if (this.raiders.length) {
      if (now > this.raidUntil) this.raiders = [];
      for (const r of this.raiders) {
        if (now < r.nextAt) continue;
        r.nextAt = now + 800 + this.rng() * 2500;
        this.send(r, this.rng() < 0.85 ? this.pick(r.templates) : this.pick(T.chatter), now);
      }
    }
  }

  roll(mix) {
    let x = this.rng();
    for (const [k, p] of Object.entries(mix)) {
      x -= p;
      if (x <= 0) return k;
    }
    return 'chatter';
  }

  send(viewer, text, now) {
    this.sent++;
    this.onMessage({ id: `sim-${++this.seq}`, source: 'sim', userId: viewer.id, userName: viewer.name, text, ts: now, roles: {} });
  }

  status() {
    return {
      running: Boolean(this.scenario) || this.raiders.length > 0,
      scenario: this.scenario?.name ?? null,
      viewers: this.viewers.length,
      raiders: this.raiders.length,
      raidLeftMs: this.raiders.length ? Math.max(0, this.raidUntil - this.clock()) : 0,
      sent: this.sent,
    };
  }
}
