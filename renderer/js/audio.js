// Procedural ASMR soundscape: everything is synthesised with Web Audio, no
// sample files. Underwater rumble, flowing water, a bubbler, soft event cues
// and an optional generative ambient pad.

const PENTA = [0, 2, 4, 7, 9];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor({ volume = 0.8, music = false, muted = false } = {}) {
    this.volume = volume;
    this.musicOn = music;
    this.muted = muted;
    this.ctx = null;
    this.bubbleAcc = 0;
    this.burstUntil = 0;
    this.lastNibble = 0;
  }

  get running() { return this.ctx?.state === 'running' && Boolean(this.master); }

  /** Must be called from a user gesture in normal browsers (OBS/headless allow autoplay). */
  async start() {
    if (this.muted) return false;
    this.ctx ??= new AudioContext({ latencyHint: 'playback' });
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* needs a user gesture */ }
    }
    // Build the graph only once audio can actually play (avoids autoplay warnings).
    if (this.ctx.state === 'running' && !this.master) this.build();
    return this.running;
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.4;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.5, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    this.reverb.connect(wet).connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverb);
    this.buildAmbience();
    if (this.musicOn) this.startMusic();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  noise(kind, seconds = 8) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else if (kind === 'pink') {
          b0 = 0.99765 * b0 + w * 0.099;
          b1 = 0.963 * b1 + w * 0.2965;
          b2 = 0.57 * b2 + w * 1.0527;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
        } else d[i] = w * 0.5;
      }
    }
    return buf;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  loop(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }

  lfo(freq, depth, target, offset = 0) {
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start(this.ctx.currentTime + offset);
    return o;
  }

  buildAmbience() {
    const ctx = this.ctx;
    // Deep underwater rumble.
    const rumble = this.loop(this.noise('brown', 10));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.6;
    const rg = ctx.createGain();
    rg.gain.value = 0.55;
    rumble.connect(lp).connect(rg).connect(this.master);
    this.lfo(0.05, 140, lp.frequency);
    this.lfo(0.07, 0.12, rg.gain, 1.3);
    this.rumbleFilter = lp;

    // Flowing water / gentle current.
    const flow = this.loop(this.noise('pink', 9));
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 850;
    bp.Q.value = 0.7;
    const fg = ctx.createGain();
    fg.gain.value = 0.05;
    flow.connect(bp).connect(fg).connect(this.master);
    this.lfo(0.11, 0.025, fg.gain);
    this.lfo(0.04, 300, bp.frequency, 2);

    // Filter return trickling at the surface.
    const trickle = this.loop(this.noise('white', 6));
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 4200;
    hp.Q.value = 1.4;
    const tg = ctx.createGain();
    tg.gain.value = 0.012;
    const pan = ctx.createStereoPanner();
    pan.pan.value = 0.55;
    trickle.connect(hp).connect(tg).connect(pan).connect(this.master);
    this.lfo(0.21, 0.008, tg.gain);
  }

  env(gainNode, t, attack, peak, release) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  /** One bubble: a sine with a quick upward pitch glide - the classic bubble sound. */
  bubble(pan = 0.6, vol = 0.025) {
    const ctx = this.ctx, t = ctx.currentTime + Math.random() * 0.02;
    const f0 = 380 + Math.random() ** 2 * 1500;
    const dur = 0.04 + Math.random() * 0.07;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.6 + Math.random()), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol * (0.4 + Math.random() * 0.6), dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan + (Math.random() - 0.5) * 0.3));
    o.connect(g).connect(p).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  update(dt) {
    if (!this.running) return;
    const bursting = performance.now() < this.burstUntil;
    const rate = bursting ? 22 : 4.5;
    this.bubbleAcc += dt * rate;
    while (this.bubbleAcc >= 1) {
      this.bubbleAcc -= 1;
      if (Math.random() < 0.85) this.bubble(bursting ? (Math.random() - 0.5) * 1.6 : 0.62, bursting ? 0.03 : 0.018);
    }
  }

  burst(ms = 12000) {
    this.burstUntil = performance.now() + ms;
  }

  nibble() {
    if (!this.running) return;
    const now = performance.now();
    if (now - this.lastNibble < 120) return;
    this.lastNibble = now;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(900 + Math.random() * 500, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.05);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.008, 0.06);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.1);
  }

  feed() {
    if (!this.running) return;
    const ctx = this.ctx;
    const noise = this.noise('white', 0.2);
    for (let i = 0; i < 18; i++) {
      const t = ctx.currentTime + Math.random() * 1.4;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3500 + Math.random() * 3000;
      bp.Q.value = 2;
      const g = ctx.createGain();
      this.env(g, t, 0.002, 0.05, 0.03);
      const p = ctx.createStereoPanner();
      p.pan.value = (Math.random() - 0.5) * 0.8;
      src.connect(bp).connect(g).connect(p).connect(this.sfx);
      src.start(t);
      src.stop(t + 0.06);
    }
    for (let i = 0; i < 5; i++) {
      const t = ctx.currentTime + 0.2 + Math.random() * 1.3;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(1100, t);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.07);
      const g = ctx.createGain();
      this.env(g, t, 0.003, 0.03, 0.09);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  shark() {
    if (!this.running) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 3);
    g.gain.setValueAtTime(0.2, t + 9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    g.connect(lp).connect(this.master);
    for (const f of [49, 73.5, 98]) {
      const o = ctx.createOscillator();
      o.type = f === 98 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(g);
      o.start(t);
      o.stop(t + 15.5);
    }
    const whoosh = ctx.createBufferSource();
    whoosh.buffer = this.noise('brown', 6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.exponentialRampToValueAtTime(600, t + 3);
    bp.frequency.exponentialRampToValueAtTime(200, t + 6);
    const wg = ctx.createGain();
    this.env(wg, t, 2.5, 0.25, 3.5);
    whoosh.connect(bp).connect(wg).connect(this.sfx);
    whoosh.start(t);
    whoosh.stop(t + 6.2);
  }

  /** The bite: a deep thump and a short muffled crunch. */
  chomp() {
    if (!this.running) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    const g = ctx.createGain();
    this.env(g, t, 0.005, 0.35, 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.45);
    const crunch = ctx.createBufferSource();
    crunch.buffer = this.noise('brown', 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const cg = ctx.createGain();
    this.env(cg, t + 0.02, 0.004, 0.25, 0.16);
    crunch.connect(lp).connect(cg).connect(this.sfx);
    crunch.start(t + 0.02);
    crunch.stop(t + 0.3);
  }

  chime(notes, gap = 0.2, vol = 0.05) {
    const ctx = this.ctx;
    notes.forEach((n, i) => {
      const t = ctx.currentTime + i * gap;
      for (const [mult, v] of [[1, 1], [2, 0.3], [3.01, 0.12]]) {
        const o = ctx.createOscillator();
        o.frequency.value = midi(n) * mult;
        const g = ctx.createGain();
        this.env(g, t, 0.01, vol * v, 2.8);
        o.connect(g).connect(this.sfx);
        o.start(t);
        o.stop(t + 3);
      }
    });
  }

  golden() {
    if (!this.running) return;
    this.chime([84, 88, 91, 93, 96, 100], 0.16, 0.045);
  }

  jelly() {
    if (!this.running) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const f of [1318.5, 1760, 2217.5, 2637]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.012, t + 2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 7);
      const trem = ctx.createGain();
      const wobble = this.lfo(3 + Math.random() * 3, 0.5, trem.gain);
      wobble.stop(t + 7.2); // an LFO left running would pile up with every jellyfish bloom
      o.connect(g).connect(trem).connect(this.sfx);
      o.start(t);
      o.stop(t + 7.2);
    }
  }

  night() { if (this.running) this.pad([57, 60, 64, 67], 0.03, 8); }

  day() { if (this.running) this.pad([60, 64, 67, 71], 0.03, 7); }

  pad(notes, vol = 0.03, len = 10) {
    const ctx = this.ctx, t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(this.sfx);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = midi(n);
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol / notes.length, t + len * 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(t + len + 0.1);
      }
    }
  }

  /** Optional generative ambient pad (?music=1): slow chords every ~14 s. */
  startMusic() {
    const chords = [[48, 55, 60, 64, 71], [45, 52, 60, 64, 67], [41, 48, 57, 60, 64], [43, 50, 59, 62, 67]];
    let i = 0;
    const play = () => {
      if (!this.running) return;
      this.pad(chords[i % chords.length], 0.05, 18);
      if (Math.random() < 0.5) {
        const root = chords[i % chords.length][0] + 24;
        this.chime([root + PENTA[Math.floor(Math.random() * 5)], root + 12 + PENTA[Math.floor(Math.random() * 5)]], 0.9, 0.012);
      }
      i++;
    };
    play();
    this.musicTimer = setInterval(play, 14000);
  }
}
