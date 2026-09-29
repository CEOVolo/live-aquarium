import * as THREE from 'three';
import { U } from './shaders.js';
import { Environment } from './env/environment.js';
import { Terrain } from './env/terrain.js';
import { Reef } from './env/reef.js';
import { GodRays, Surface, MarineSnow } from './env/effects.js';
import { Bubbles, Food, Sparkles, Glow } from './env/particles.js';
import { FishSystem } from './fish/school.js';
import { Jellies } from './fish/jellyfish.js';
import { CameraRig } from './camera.js';
import { Post } from './post.js';

const frac = (x) => x - Math.floor(x);
const wrapHalf = (x) => x - Math.round(x);

/**
 * The render engine. It never decides anything by itself about chat: it only
 * plays whitelisted events it receives (handleEvent) and keeps the tank alive.
 */
export class Aquarium {
  constructor(canvas, opts, audio) {
    this.opts = opts;
    this.audio = audio;
    const quality = opts.quality;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: opts.capture });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio);
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 500);

    this.env = new Environment(scene, opts);
    this.terrain = new Terrain(scene, opts);
    this.reef = new Reef(scene, this.terrain, opts);
    this.rays = new GodRays(scene, opts);
    this.surface = new Surface(scene);
    this.snow = new MarineSnow(scene, opts);
    this.bubbles = new Bubbles(scene, this.terrain, opts);
    this.food = new Food(scene, this.terrain);
    this.sparkles = new Sparkles(scene);
    this.glow = new Glow(scene, { max: quality === 'low' ? 400 : 900 });
    this.fish = new FishSystem(scene, {
      terrain: this.terrain, reef: this.reef, food: this.food, sparkles: this.sparkles, glow: this.glow, quality, models: opts.models,
      onEat: () => audio?.nibble(),
      onCatch: (info) => this.handleCatch(info),
    });
    this.onCatch = null; // set by the page to announce a catch
    this.jellies = new Jellies(scene);
    this.rig = new CameraRig(this.camera, { style: opts.cameraStyle });
    this.post = new Post(renderer, scene, this.camera, opts);

    this.tod = 0.42;
    this.serverTod = 0.42;
    this.todRate = 1 / (30 * 60000);
    this.todSyncedAt = performance.now();
    this.clockOffset = 0;
    this.t = 0;
    this.frames = 0;
    this.lastError = 0;
    this.last = performance.now();
    this.fps = 60;
    this.fpsFrames = 0;
    this.fpsSince = performance.now();
    this.lowFor = 0;
    this.highFor = 0;
    this.listeners = [];

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.pixelRatio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const focal = (h * this.pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.bubbles.setFocal(focal);
    this.glow.setFocal(focal);
  }

  // ---- inputs from the Director --------------------------------------------------
  syncWorld(world) {
    if (world.now) this.clockOffset = world.now - Date.now();
    this.fish.sync(world.fish ?? [], Date.now() + this.clockOffset);
    this.syncTime(world, true);
    if (world.growth !== undefined) U.uGrowth.value = world.growth;
  }

  syncTime({ tod, todRate, growth }, snap = false) {
    if (growth !== undefined) U.uGrowth.value = growth;
    if (tod === undefined) return;
    this.serverTod = tod;
    this.todRate = todRate ?? this.todRate;
    this.todSyncedAt = performance.now();
    if (snap) this.tod = tod;
  }

  handleEvent(ev) {
    const p = ev.params ?? {};
    const a = this.audio;
    switch (ev.kind) {
      case 'feed':
        this.food.drop(p.amount ?? 40, p.x ?? 0);
        this.fish.feed(p.x ?? 0);
        a?.feed();
        break;
      case 'bubbles':
        this.bubbles.startBurst(p.intensity ?? 1, p.durationMs ?? 12000);
        this.fish.bubbles(p.durationMs ?? 12000);
        a?.burst(p.durationMs ?? 12000);
        break;
      case 'shark':
        this.fish.spawnVisitor('shark', { durationMs: p.durationMs ?? 50000, side: p.side, victimId: p.victim?.id ?? null, huntAtMs: p.huntAtMs ?? 12000 });
        a?.shark();
        break;
      case 'golden':
        this.fish.spawnVisitor('golden', { durationMs: p.durationMs ?? 90000 });
        a?.golden();
        break;
      case 'jellyfish':
        this.jellies.spawn(p.count ?? 4, p.durationMs ?? 90000);
        a?.jelly();
        break;
      case 'night':
        a?.night();
        break;
      case 'day':
        this.fish.wake();
        a?.day();
        break;
      case 'fish_add': {
        if (!p.fish) break;
        const f = this.fish.add(p.fish, { enter: !p.born, born: !!p.born, nowMs: Date.now() + this.clockOffset });
        if (f && !p.born) this.fish.greet(f);
        if (p.gift) this.sparkles.emit(f?.pos ?? new THREE.Vector3(0, 4, 0), 30);
        break;
      }
      case 'spotlight':
        this.fish.spotlight(p.fishId, p.durationMs ?? 10000);
        break;
      case 'fish_remove':
        this.fish.remove(p.fishId, { exit: true });
        break;
      default:
        break;
    }
  }

  /** The shark got its fish: glitter, a burst of bubbles, the bite sound, then the overlay. */
  handleCatch(info) {
    for (let i = 0; i < 12; i++) {
      this.bubbles.spawn(info.pos.x + (Math.random() - 0.5) * 0.6, info.pos.y, info.pos.z + (Math.random() - 0.5) * 0.6, 0.02 + Math.random() * 0.05);
    }
    this.audio?.chomp();
    this.onCatch?.(info);
  }

  // ---- loop ------------------------------------------------------------------------
  start() {
    const loop = () => {
      // Schedule first: one bad frame must not stop the stream for good.
      requestAnimationFrame(loop);
      try {
        this.frame();
      } catch (err) {
        if (performance.now() - this.lastError > 60000) console.error('[aquarium] frame failed', err);
        this.lastError = performance.now();
      }
    };
    requestAnimationFrame(loop);
  }

  onFrame(fn) { this.listeners.push(fn); }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    if (!(dt > 0)) return; // coarse timers can repeat a timestamp
    this.last = now;
    this.t += dt;
    this.frames++;

    // Time of day: extrapolate the Director's clock and ease towards it.
    const expected = frac(this.serverTod + (now - this.todSyncedAt) * this.todRate);
    const diff = wrapHalf(expected - this.tod);
    this.tod = Math.abs(diff) > 0.2 ? expected : frac(this.tod + diff * Math.min(1, dt * 2.5));

    const palette = this.env.update(this.tod);
    // Shaders get a wrapped clock: a 32-bit float counting seconds for days would make every
    // animation step visibly. The wrap (every 6 h) is a one-frame hiccup in the water motion.
    const shaderTime = this.t % 21600;
    U.uTime.value = shaderTime;
    const night = this.env.night;
    this.rays.update(this.t, palette);
    this.surface.update(palette);
    this.snow.update(palette, night, this.pixelRatio);
    this.bubbles.update(dt, this.t, palette);
    this.food.update(dt, this.t);
    this.sparkles.update(dt);
    this.glow.update(dt);
    // By day the sea grass gives off tiny oxygen bubbles.
    const spots = this.reef.grassSpots;
    if (spots?.length && Math.random() < dt * 6 * (1 - night)) {
      const s = spots[Math.floor(Math.random() * spots.length)];
      const a = Math.random() * Math.PI * 2, d = Math.random() * s.r;
      const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d * 0.7;
      this.bubbles.spawn(x, this.terrain.heightAt(x, z) + 0.6 + Math.random() * 1.6, z, 0.01 + Math.random() * 0.015);
    }
    const jellies = this.jellies.list.map((j) => ({ pos: j.pos, r: 0.5 * j.scale }));
    this.fish.update(dt, this.t, { night, nowMs: Date.now() + this.clockOffset, jellies });
    this.jellies.update(dt, this.t, { night, day: U.uDay.value });
    this.rig.update(dt, this.t);
    this.post.render(shaderTime, night);
    this.audio?.update(dt);
    for (const fn of this.listeners) fn(dt);
    this.measure(now, dt);
  }

  measure(now, dt) {
    this.fpsFrames++;
    if (now - this.fpsSince >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsSince);
      this.fpsFrames = 0;
      this.fpsSince = now;
      if (!this.opts.adaptive) return;
      // Adaptive resolution: keep the stream smooth on weaker GPUs.
      if (this.fps < 45) { this.lowFor++; this.highFor = 0; } else if (this.fps > 58) { this.highFor++; this.lowFor = 0; } else { this.lowFor = 0; this.highFor = 0; }
      if (this.lowFor >= 3 && this.pixelRatio > 0.6) {
        this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.15);
        this.lowFor = 0;
        this.resize();
      } else if (this.highFor >= 15 && this.pixelRatio < this.maxPixelRatio) {
        this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
        this.highFor = 0;
        this.resize();
      }
    }
  }
}
