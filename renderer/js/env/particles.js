import * as THREE from 'three';
import { U, withCaustics } from '../shaders.js';
import { mulberry32 } from '../util.js';

const rnd = mulberry32(1234);

/** Air bubbles: a bubbler stone in the corner plus event bursts (an "air curtain"). */
export class Bubbles {
  constructor(scene, terrain, { quality, onPop } = {}) {
    this.terrain = terrain;
    this.max = quality === 'low' ? 500 : 1200;
    this.onPop = onPop;
    this.n = 0;
    this.pos = new Float32Array(this.max * 3);
    this.size = new Float32Array(this.max);
    this.seed = new Float32Array(this.max);
    this.vel = new Float32Array(this.max);
    this.emitters = [{ x: 10.4, z: -4.6, rate: 9, spread: 0.07, acc: 0 }];
    this.burst = null;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    this.uniforms = { uFocal: { value: 1000 }, uColor: { value: new THREE.Color(0.85, 0.97, 1.0) }, uBright: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aSize;
        uniform float uFocal;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = max(1.5, aSize * 2.0 * uFocal / d);
          vAlpha = exp(-d * 0.025);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uBright;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r = length(c);
          if (r > 1.0) discard;
          float rim = smoothstep(0.6, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
          float spec = smoothstep(0.38, 0.0, length(c - vec2(-0.35, -0.38)));
          float a = rim * 0.8 + 0.1 + spec * 0.9;
          gl_FragColor = vec4(uColor * (0.7 + spec * 0.8) * uBright, a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
  }

  spawn(x, y, z, size) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i] = size;
    this.seed[i] = rnd() * 100;
    this.vel[i] = 0.7 + size * 16 + rnd() * 0.3;
  }

  startBurst(intensity = 1, durationMs = 12000) {
    this.burst = { until: performance.now() + durationMs, rate: 70 * intensity, acc: 0 };
  }

  update(dt, t, palette) {
    for (const e of this.emitters) {
      e.acc += e.rate * dt;
      const y = this.terrain.heightAt(e.x, e.z) + 0.15;
      while (e.acc >= 1) {
        e.acc -= 1;
        this.spawn(e.x + (rnd() - 0.5) * e.spread, y, e.z + (rnd() - 0.5) * e.spread, 0.018 + rnd() * rnd() * 0.07);
      }
    }
    if (this.burst) {
      if (performance.now() > this.burst.until) this.burst = null;
      else {
        this.burst.acc += this.burst.rate * dt;
        while (this.burst.acc >= 1) {
          this.burst.acc -= 1;
          const x = -10 + rnd() * 20, z = -4.8 + rnd() * 2.0;
          this.spawn(x, this.terrain.heightAt(x, z) + 0.1, z, 0.03 + rnd() * rnd() * 0.12);
        }
      }
    }
    const top = U.uSurfaceY.value - 0.05;
    let popped = 0;
    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i];
      this.pos[i * 3 + 1] += this.vel[i] * dt;
      this.pos[i * 3] += Math.sin(t * 7 + s) * 0.35 * dt * (0.4 + this.size[i] * 12);
      this.pos[i * 3 + 2] += Math.cos(t * 6 + s * 1.3) * 0.25 * dt;
      if (this.pos[i * 3 + 1] > top) {
        const last = --this.n;
        this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
        this.size[i] = this.size[last];
        this.seed[i] = this.seed[last];
        this.vel[i] = this.vel[last];
        i--;
        popped++;
      }
    }
    if (popped && this.onPop) this.onPop(popped);
    this.points.geometry.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.uniforms.uBright.value = 0.45 + palette.hemi * 0.55;
  }

  setFocal(focal) { this.uniforms.uFocal.value = focal; }
}

/** Food flakes: float on the surface for a moment, then flutter down. */
export class Food {
  constructor(scene, terrain) {
    this.terrain = terrain;
    this.max = 320;
    this.flakes = [];
    this.pending = [];
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = 0.035 + (i % 2) * 0.012 + (i === 3 ? 0.01 : 0);
      shape[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    const geo = new THREE.ShapeGeometry(shape);
    const mat = withCaustics(new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), 0.6);
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.palette = ['#ff8a3a', '#d9442b', '#d4a55a', '#7fbf4a', '#e8c37a'].map((h) => new THREE.Color(h));
    for (let i = 0; i < this.max; i++) this.mesh.setColorAt(i, this.palette[i % this.palette.length]);
    scene.add(this.mesh);
    this.tmpM = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpE = new THREE.Euler();
    this.tmpS = new THREE.Vector3();
  }

  /** Sprinkle `amount` flakes around x over ~1.5 s. */
  drop(amount = 40, x = 0) {
    const now = performance.now();
    for (let i = 0; i < amount; i++) {
      this.pending.push({
        at: now + rnd() * 1500,
        x: x + (rnd() - 0.5) * 5,
        z: -2.5 + rnd() * 4.5,
      });
    }
  }

  get count() { return this.flakes.length; }

  consume(flake) { flake.eaten = true; }

  update(dt, t) {
    const now = performance.now();
    if (this.pending.length) {
      this.pending = this.pending.filter((p) => {
        if (now < p.at) return true;
        if (this.flakes.length >= this.max) return false;
        this.flakes.push({
          pos: new THREE.Vector3(p.x, U.uSurfaceY.value - 0.08, p.z),
          rot: new THREE.Vector3(rnd() * 6, rnd() * 6, rnd() * 6),
          spin: new THREE.Vector3((rnd() - 0.5) * 3, (rnd() - 0.5) * 3, (rnd() - 0.5) * 3),
          sink: 0.2 + rnd() * 0.14,
          floatUntil: t + 0.4 + rnd() * 2.2,
          seed: rnd() * 100,
          landedAt: 0,
          scale: 1.5 + rnd() * 0.9,
          color: Math.floor(rnd() * 5),
          eaten: false,
        });
        return false;
      });
    }
    const m = this.tmpM, q = this.tmpQ, e = this.tmpE, s = this.tmpS;
    let k = 0;
    for (let i = 0; i < this.flakes.length; i++) {
      const f = this.flakes[i];
      if (f.eaten || (f.landedAt && t - f.landedAt > 30)) continue;
      if (t > f.floatUntil && !f.landedAt) {
        f.pos.y -= f.sink * dt;
        f.pos.x += Math.sin(t * 1.3 + f.seed) * 0.1 * dt;
        f.pos.z += Math.cos(t * 1.1 + f.seed) * 0.07 * dt;
        f.rot.addScaledVector(f.spin, dt);
        const ground = this.terrain.heightAt(f.pos.x, f.pos.z) + 0.02;
        if (f.pos.y <= ground) {
          f.pos.y = ground;
          f.landedAt = t;
          f.rot.set(Math.PI / 2, f.rot.y, 0);
        }
      } else if (!f.landedAt) {
        f.pos.x += Math.sin(t * 0.8 + f.seed) * 0.05 * dt;
      }
      this.flakes[k++] = f;
      const fade = f.landedAt ? Math.max(0, 1 - (t - f.landedAt) / 30) : 1;
      e.set(f.rot.x, f.rot.y, f.rot.z);
      q.setFromEuler(e);
      s.setScalar(f.scale * (0.3 + 0.7 * fade));
      m.compose(f.pos, q, s);
      this.mesh.setMatrixAt(k - 1, m);
      this.mesh.setColorAt(k - 1, this.palette[f.color]);
    }
    this.flakes.length = k;
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Glittering trail (golden fish). */
export class Sparkles {
  constructor(scene) {
    this.max = 400;
    this.n = 0;
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.lifeAttr = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aLife', this.lifeAttr);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aLife;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (4.0 + 10.0 * aLife) * (22.0 / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying float vLife;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float star = max(0.0, 1.0 - length(c) * 2.0);
          star += max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.2) * 0.6;
          star += max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.2) * 0.6;
          gl_FragColor = vec4(vec3(1.0, 0.8, 0.35) * 2.2, star * vLife);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);
  }

  emit(p, count = 2) {
    for (let k = 0; k < count && this.n < this.max; k++) {
      const i = this.n++;
      this.pos.set([p.x + (rnd() - 0.5) * 0.3, p.y + (rnd() - 0.5) * 0.3, p.z + (rnd() - 0.5) * 0.3], i * 3);
      this.vel.set([(rnd() - 0.5) * 0.2, 0.1 + rnd() * 0.25, (rnd() - 0.5) * 0.2], i * 3);
      this.life[i] = 1;
    }
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt * 0.8;
      if (this.life[i] <= 0) {
        const last = --this.n;
        this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
        this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
        this.life[i] = this.life[last];
        i--;
        continue;
      }
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }
}

/**
 * Soft glowing motes: night plankton lighting up behind moving fish, the glitter of scales
 * where the shark bites. Each particle has its own colour and lifetime.
 */
export class Glow {
  constructor(scene, { max = 900 } = {}) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.span = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aLife', this.lifeAttr);
    this.uniforms = { uFocal: { value: 1000 } };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uFocal;
        attribute vec3 aColor;
        attribute float aLife;
        varying vec3 vColor;
        varying float vLife;
        void main() {
          vColor = aColor;
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Specks of a fixed size in the water (about 5-10 cm), whatever the resolution.
          gl_PointSize = max(1.5, (0.05 + 0.06 * aLife) * uFocal / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vLife;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r) * vLife * 0.85;
          gl_FragColor = vec4(vColor * 1.2, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);
  }

  setFocal(focal) { this.uniforms.uFocal.value = focal; }

  emit(p, count = 1, color = new THREE.Color(0.3, 0.95, 1), spread = 0.2, seconds = 1.2) {
    for (let k = 0; k < count && this.n < this.max; k++) {
      const i = this.n++;
      this.pos.set([p.x + (rnd() - 0.5) * spread, p.y + (rnd() - 0.5) * spread, p.z + (rnd() - 0.5) * spread], i * 3);
      const burst = spread * 0.9;
      this.vel.set([(rnd() - 0.5) * burst, (rnd() - 0.3) * burst, (rnd() - 0.5) * burst], i * 3);
      this.col.set([color.r, color.g, color.b], i * 3);
      this.life[i] = 1;
      this.span[i] = seconds * (0.7 + rnd() * 0.6);
    }
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt / this.span[i];
      if (this.life[i] <= 0) {
        const last = --this.n;
        this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
        this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
        this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
        this.life[i] = this.life[last];
        this.span[i] = this.span[last];
        i--;
        continue;
      }
      for (let a = 0; a < 3; a++) {
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
        this.vel[i * 3 + a] *= 1 - 1.5 * dt;
      }
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }
}
