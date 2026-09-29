const MIN = 60000;

/**
 * Autonomous life: the tank keeps living when nobody writes anything.
 * A caretaker feeds the fish, bubbles burst now and then, the golden fish
 * visits on its own (rarely), jellyfish drift in at night, fish are born.
 */
export class Ambient {
  constructor({ director, world, config, clock = Date.now, rng = Math.random }) {
    this.director = director;
    this.world = world;
    this.cfg = config;
    this.clock = clock;
    this.rng = rng;
    const now = clock();
    this.last = now;
    this.nextBubbles = now + this.between(4, 10);
    this.nextEcosystem = now + MIN;
  }

  between(aMin, bMin) { return (aMin + this.rng() * (bMin - aMin)) * MIN; }

  tick(now = this.clock()) {
    const dt = Math.min(now - this.last, 10000);
    this.last = now;
    const d = this.director;
    const tv = d.mode === 'tv';

    const feedEvery = (tv ? this.cfg.tvFeedEveryMin : this.cfg.feedEveryMin) * MIN;
    if (now - this.world.state.lastFedAt > feedEvery) {
      d.systemFire('feed', now, { amount: 44, caretaker: true });
    }

    if (now >= this.nextBubbles) {
      if (d.systemFire('bubbles', now, { intensity: 1.2 })) this.nextBubbles = now + this.between(6, 14);
    }

    // Poisson arrivals: probability of at least one arrival during dt.
    const chance = (meanMin) => 1 - Math.exp(-dt / (meanMin * MIN));
    if (this.rng() < chance(this.cfg.goldenMeanMin)) d.systemFire('wish', now);
    if (this.world.isNight(now) && this.rng() < chance(this.cfg.nightJellyMeanMin)) {
      d.systemFire('jellyfish', now, { count: 3 + Math.floor(this.rng() * 3) });
    }

    if (now >= this.nextEcosystem) {
      this.nextEcosystem = now + MIN;
      const born = this.world.ecosystemTick(now, { birthsPerDayPerSpecies: this.cfg.birthsPerDayPerSpecies });
      for (const fish of born) d.announce('fish_add', { fish, born: true }, now);
    }
  }
}
