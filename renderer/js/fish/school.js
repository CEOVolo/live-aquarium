import * as THREE from 'three';
import { SPECIES, paintSpecies } from './species.js';
import { buildFishGeometry } from './geometry.js';
import { addPatch, withCaustics, normalMapFromHeight } from '../shaders.js';
import { mulberry32, clamp, wrapAngle, damp, lerp } from '../util.js';

const TANK = { xMin: -11.8, xMax: 11.8, zMin: -5.6, zMax: 4.0, yMax: 10.4 };
const CURTAIN_Z = -3.8; // where the bubble curtain rises (see Bubbles.startBurst)
const PREY_BOX = { x: 8.0, zMin: -3.6, zMax: 2.4, above: 1.7, yMax: 8.2 }; // where a hunted fish can run (in view)
const GLOW = new THREE.Color(0.3, 0.95, 1.0); // night plankton lit up by moving fish
const SCALES = new THREE.Color(0.95, 0.97, 1.0); // the glitter left where the shark bites
const DAY_MS = 86400000;
const growth = (ageMs) => 0.38 + 0.62 * (1 - Math.exp(-Math.max(0, ageMs) / DAY_MS / 1.2));

/**
 * Swimming: a travelling body wave, turn bending, fluttering fins, flapping pectorals.
 * Species with a jaw (the shark) also open their mouth: lower-jaw vertices swing down around the hinge
 * by their weight (a negative weight lifts the upper lip). A 3D model brings its own mouth and teeth;
 * on the procedural shark the skin stretched between the lips is painted as the inside of the mouth.
 */
function withSwim(material, uniforms) {
  return addPatch(material, 'swim', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 iSwim;   // x tail phase, y amplitude, z turn bend, w pectoral phase
        attribute float iJaw;   // how far the mouth is open, 0..1
        attribute vec2 aFin;    // x: 0 body, 1 median fin, 2/3 pectoral R/L; y: 0 base .. 1 edge (body: 1 = lower jaw)
        uniform float uWaveK, uAmp, uAmpHead, uFinFlutter, uPecWing, uJawAngle, uMouthPaint;
        uniform vec2 uJawHinge;
        varying float vFishJaw;
        varying vec2 vFishMouth;
        float fishS(vec3 p) { return clamp(0.5 - p.x, 0.0, 1.1); }
        float fishAmp(float s) { return mix(uAmpHead, uAmp, s * s) * iSwim.y; }
        float fishOffset(vec3 p) {
          float s = fishS(p);
          return fishAmp(s) * sin(iSwim.x - s * uWaveK) + iSwim.z * s * s;
        }
        float fishSlope(vec3 p) {
          float s = fishS(p);
          return fishAmp(s) * cos(iSwim.x - s * uWaveK) * uWaveK - 2.0 * iSwim.z * s;
        }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vFishJaw = aFin.x < 0.5 ? aFin.y : 0.0;
        float jawA = vFishJaw * iJaw * uJawAngle;
        float jawC = cos(jawA), jawS = sin(jawA);
        objectNormal.xy = vec2(jawC * objectNormal.x + jawS * objectNormal.y, -jawS * objectNormal.x + jawC * objectNormal.y);
        objectNormal.x -= fishSlope(position) * objectNormal.z;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFishMouth = vec2(position.x + abs(position.z), iJaw * uMouthPaint);
        vec2 jd = transformed.xy - uJawHinge;
        transformed.xy = uJawHinge + vec2(jawC * jd.x + jawS * jd.y, -jawS * jd.x + jawC * jd.y);
        transformed.z += fishOffset(position);
        if (aFin.x > 0.5 && aFin.x < 1.5) {
          transformed.z += sin(iSwim.x * 1.3 - fishS(position) * 7.0 + aFin.y * 2.2) * aFin.y * uFinFlutter * (0.6 + 0.6 * iSwim.y);
        } else if (aFin.x > 1.5 && uPecWing > 0.5) {
          // Wings (sharks) do not paddle: they only trim up and down a little, like a glider.
          transformed.y += sin(iSwim.w) * aFin.y * aFin.y * 0.03;
        } else if (aFin.x > 1.5) {
          float side = aFin.x > 2.5 ? -1.0 : 1.0;
          transformed.x += sin(iSwim.w) * aFin.y * 0.05;
          transformed.z += side * (0.5 + 0.5 * cos(iSwim.w)) * aFin.y * 0.04;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vFishJaw;
        varying vec2 vFishMouth;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // Only the triangles between the lips have a jaw weight strictly between 0 and 1.
        if (vFishMouth.y > 0.01 && vFishJaw > 0.001 && vFishJaw < 0.999) {
          float tooth = 1.0 - abs(fract(vFishMouth.x * 60.0) * 2.0 - 1.0);
          float teeth = max(step(vFishJaw, 0.32 * tooth), step(1.0 - 0.26 * tooth, vFishJaw));
          vec3 mouth = mix(vec3(0.2, 0.035, 0.045), vec3(0.94, 0.92, 0.86), teeth);
          diffuseColor.rgb = mix(diffuseColor.rgb, mouth, smoothstep(0.01, 0.18, vFishMouth.y));
        }`);
  });
}

function scalesNormalMap() {
  const tex = normalMapFromHeight(128, (ctx, s) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s, s);
    const n = 8, d = s / n;
    for (let row = -1; row <= n + 1; row++) {
      for (let col = -1; col <= n + 1; col++) {
        const x = col * d + (row % 2 ? d / 2 : 0), y = row * d * 0.8;
        const g = ctx.createRadialGradient(x, y, 0, x, y, d * 0.72);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.8, '#808080');
        g.addColorStop(1, '#000000');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, d * 0.72, 0, Math.PI);
        ctx.fill();
      }
    }
  }, 2.5);
  tex.repeat.set(22, 22);
  return tex;
}

const T = {
  goal: new THREE.Vector3(),
  desired: new THREE.Vector3(),
  v: new THREE.Vector3(),
  n: new THREE.Vector3(),
  ali: new THREE.Vector3(),
  coh: new THREE.Vector3(),
  sep: new THREE.Vector3(),
  e: new THREE.Euler(),
  q: new THREE.Quaternion(),
  s: new THREE.Vector3(),
  m: new THREE.Matrix4(),
  c: new THREE.Color(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
};

export class FishSystem {
  constructor(scene, { terrain, reef, food, sparkles, glow, quality, models = {}, onEat, onCatch }) {
    this.scene = scene;
    this.terrain = terrain;
    this.reef = reef;
    this.food = food;
    this.sparkles = sparkles;
    this.glow = glow;
    this.onEat = onEat;
    this.onCatch = onCatch;
    this.t = 0;
    // What the whole tank feels right now. Events set it; every fish reads it.
    this.mood = {
      alarm: 0, threat: null, hide: new THREE.Vector3(-7.8, 2.6, -2.6),
      frenzy: null, bubblesUntil: 0, wakeUntil: 0, golden: null, jellies: [],
    };
    this.rnd = mulberry32(42);
    this.kinds = {};
    this.all = [];
    this.byId = new Map();
    this.predators = [];
    this.toDestroy = [];
    this.grid = new Map();
    this.rocks = terrain.obstacles.filter((o) => o.rock && o.size[0] > 1.2);
    this.scalesNormal = scalesNormalMap();
    for (const [key, spec] of Object.entries(SPECIES)) this.kinds[key] = this.createKind(key, spec, quality, models[key]);
  }

  /** One kind of fish: instanced meshes (one per material) sharing transforms, swim state and colours. */
  createKind(key, spec, quality, model = null) {
    const cap = spec.capacity ?? (quality === 'low' ? 120 : 220);
    const uniforms = {
      uWaveK: { value: spec.swim.waveK },
      uAmp: { value: spec.swim.amp },
      uAmpHead: { value: spec.swim.ampHead },
      uFinFlutter: { value: spec.swim.finFlutter },
      uPecWing: { value: !model && spec.pec?.wing ? 1 : 0 },
      uJawAngle: { value: (model ? spec.model.jawAngle : spec.jaw?.angle) ?? 0 },
      uJawHinge: { value: new THREE.Vector2() },
      uMouthPaint: { value: model ? 0 : 1 },
    };
    const parts = model ? this.modelParts(spec, model, uniforms) : this.proceduralParts(spec, uniforms);
    const swim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const jaw = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    const colors = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    const meshes = [];
    for (const { geometry, material, shadow, renderOrder } of parts) {
      geometry.setAttribute('iSwim', swim);
      geometry.setAttribute('iJaw', jaw);
      const mesh = new THREE.InstancedMesh(geometry, material, cap);
      if (meshes.length) mesh.instanceMatrix = meshes[0].instanceMatrix;
      else mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = colors;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = Boolean(shadow) && quality !== 'low';
      mesh.renderOrder = renderOrder ?? 0;
      meshes.push(mesh);
      this.scene.add(mesh);
    }
    return { key, spec, meshes, body: meshes[0], swim, jaw, colors, list: [], cap, model: Boolean(model), schoolTarget: new THREE.Vector3(0, 6, -1), schoolUntil: 0, uniforms };
  }

  /** The code-built fish: a body and a fin mesh painted with one side-projected texture. */
  proceduralParts(spec, uniforms) {
    const { body, fins, jawHinge } = buildFishGeometry(spec);
    uniforms.uJawHinge.value.fromArray(jawHinge);
    const tex = paintSpecies(spec);
    const m = spec.material;
    const emissive = m.emissive ? new THREE.Color(m.emissive) : new THREE.Color(0);
    const bodyMat = new THREE.MeshPhysicalMaterial({
      map: tex,
      roughness: m.roughness,
      metalness: m.metalness,
      clearcoat: m.clearcoat ?? 0.5,
      clearcoatRoughness: 0.3,
      iridescence: m.iridescence ?? 0,
      iridescenceIOR: 1.4,
      iridescenceThicknessRange: [120, 420],
      // Scale bumps; skin without scales (the shark) gets none: a side-projected normal map striped it.
      normalMap: (m.scales ?? 0.22) > 0 ? this.scalesNormal : null,
      normalScale: new THREE.Vector2(m.scales ?? 0.22, m.scales ?? 0.22),
      emissive,
      emissiveMap: m.emissive ? tex : null,
      emissiveIntensity: m.emissiveIntensity ?? 0,
    });
    withSwim(bodyMat, uniforms);
    withCaustics(bodyMat, 0.55);
    const finMat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      roughness: 0.5,
      metalness: 0.05,
      alphaTest: 0.03,
      emissive,
      emissiveMap: m.emissive ? tex : null,
      emissiveIntensity: (m.emissiveIntensity ?? 0) * 0.8,
    });
    withSwim(finMat, uniforms);
    withCaustics(finMat, 0.4);
    return [{ geometry: body, material: bodyMat, shadow: true }, { geometry: fins, material: finMat, renderOrder: 3 }];
  }

  /** A prepared 3D model: its own textures and materials, driven by the same swim shader. */
  modelParts(spec, model, uniforms) {
    const cfg = spec.model;
    uniforms.uJawHinge.value.fromArray(cfg.jawHinge ?? [0, 0]);
    return model.map(({ geometry, material }) => {
      const role = cfg.roles?.[material.name] ?? 'body';
      const mat = material.clone();
      mat.vertexColors = false;
      if (role === 'fin') {
        Object.assign(mat, { transparent: true, side: THREE.DoubleSide, alphaTest: 0.03, depthWrite: true });
      } else {
        Object.assign(mat, { transparent: false, alphaTest: role === 'masked' ? 0.5 : 0, side: THREE.FrontSide });
      }
      if (cfg.roughness !== undefined && role !== 'masked') {
        // A constant roughness: glossy spots in the maps turn the sun into blinding highlights under bloom.
        mat.roughness = cfg.roughness;
        mat.roughnessMap = null;
        mat.metalnessMap = null;
      }
      mat.metalness = Math.min(mat.metalness, 0.1);
      // Baked occlusion darkens the ambient light the whole tank relies on, and a tinted specular map
      // sparkles orange under water: both are dropped.
      mat.aoMap = null;
      if ('specularColorMap' in mat) {
        mat.specularColorMap = null;
        mat.specularIntensity = 0.35;
      }
      withSwim(mat, uniforms);
      withCaustics(mat, role === 'fin' ? 0.4 : 0.55);
      return { geometry, material: mat, shadow: role === 'body', renderOrder: role === 'fin' ? 3 : 0 };
    });
  }

  get count() { return this.all.reduce((n, f) => n + (f.visitor ? 0 : 1), 0); }

  // ---- roster --------------------------------------------------------------------
  add(record, { enter = false, born = false, side = null, nowMs = Date.now() } = {}) {
    const kind = this.kinds[record.species];
    if (!kind || kind.list.length >= kind.cap || this.byId.has(record.id)) return null;
    const { spec } = kind;
    const r = mulberry32(record.seed ?? Math.floor(this.rnd() * 1e9));
    const f = {
      id: record.id, name: record.name ?? null, species: record.species, kind, spec, B: spec.behavior, sw: spec.swim,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3(), acc: new THREE.Vector3(),
      targetUntil: 0, yaw: 0, pitch: 0, roll: 0, yawRate: 0, bend: 0, amp: 1,
      phase: r() * Math.PI * 2, flap: r() * Math.PI * 2,
      sizeK: 0.9 + r() * 0.2, bornAt: record.bornAt ?? nowMs, size: spec.swim.size,
      hunger: 0.3 + r() * 0.4, eatCd: 0, panic: 0, gulp: 0, feeding: false,
      state: 'live', leaveAt: Infinity, visitor: false, charge: 0, phase0: r() * 10,
      spotUntil: 0, greet: null, hunted: false, huntedBy: null, huntedAt: 0, caught: false,
      mode: 'patrol', shake: 0, maxOverride: undefined, burst: false, jaw: 0, jawTarget: 0,
      idx: kind.list.length, r,
      offset: new THREE.Vector3((r() - 0.5) * 2.2, (r() - 0.5) * 1.1, (r() - 0.5) * 1.8),
    };
    const zone = f.B.zone ?? [2.5, 7.5];
    if (born) {
      const parent = kind.list[Math.floor(r() * kind.list.length)];
      f.pos.copy(parent ? parent.pos : new THREE.Vector3(0, 3, 0)).add(new THREE.Vector3((r() - 0.5) * 0.6, 0.2, (r() - 0.5) * 0.6));
      f.vel.set((r() - 0.5) * 0.3, 0.1, (r() - 0.5) * 0.3);
    } else if (enter) {
      const s = side ?? (r() < 0.5 ? -1 : 1);
      f.pos.set(s * 15.5, lerp(zone[0], zone[1], 0.3 + r() * 0.4), -3 + r() * 5);
      f.vel.set(-s * spec.swim.cruise, 0, 0);
      f.target.set(s * 6.5, f.pos.y, f.pos.z * 0.5);
      f.state = 'enter';
    } else {
      this.placeRandomly(f, zone);
    }
    f.yaw = Math.atan2(-f.vel.z, f.vel.x);
    kind.list.push(f);
    this.all.push(f);
    this.byId.set(f.id, f);
    kind.colors.setXYZ(f.idx, 0.9 + r() * 0.18, 0.9 + r() * 0.18, 0.9 + r() * 0.18);
    kind.colors.needsUpdate = true;
    for (const m of kind.meshes) m.count = kind.list.length;
    if (f.B.ai === 'shark') this.predators.push(f);
    return f;
  }

  placeRandomly(f, zone) {
    const r = f.r;
    if (f.B.home === 'anemone') {
      const a = this.reef.anchors.anemone;
      f.pos.set(a.x + (r() - 0.5) * 2, a.y + r() * 1.2, a.z + (r() - 0.5) * 2);
    } else if (f.B.home === 'coral') {
      const a = this.reef.anchors.coral;
      f.pos.set(a.x + (r() - 0.5) * 3, a.y + (r() - 0.5) * 1.2, a.z + (r() - 0.5) * 2);
    } else {
      f.pos.set(-9 + r() * 18, lerp(zone[0], zone[1], r()), -4 + r() * 6.5);
    }
    const a = r() * Math.PI * 2;
    f.vel.set(Math.cos(a), 0, Math.sin(a) * 0.4).multiplyScalar(f.sw.cruise);
  }

  /** Make the tank match the server's roster (on connect / reconnect). */
  sync(records, nowMs = Date.now()) {
    const byId = new Map(records.map((r) => [r.id, r]));
    for (const f of [...this.all]) {
      // The shark's victim is already gone from the world; it stays until the shark gets it.
      if (f.visitor || f.doomed) continue;
      const rec = byId.get(f.id);
      // Gone, or the id now means another fish (e.g. the world was reset): rebuild it.
      if (!rec || rec.species !== f.species || (rec.bornAt ?? nowMs) !== f.bornAt) this.destroy(f);
    }
    for (const rec of records) if (!this.byId.has(rec.id)) this.add(rec, { nowMs });
  }

  remove(id, { exit = true } = {}) {
    const f = this.byId.get(id);
    if (!f) return;
    if (!exit) return this.destroy(f);
    this.startLeaving(f);
  }

  startLeaving(f) {
    f.state = 'leave';
    const s = f.pos.x < 0 ? -1 : 1;
    f.target.set(s * 20, clamp(f.pos.y, 2, 8), f.pos.z);
  }

  destroy(f) {
    const kind = f.kind;
    if (!this.byId.has(f.id)) return;
    const last = kind.list.pop();
    if (last !== f) {
      kind.list[f.idx] = last;
      kind.colors.setXYZ(f.idx, kind.colors.getX(last.idx), kind.colors.getY(last.idx), kind.colors.getZ(last.idx));
      last.idx = f.idx;
      kind.colors.needsUpdate = true;
      this.write(last); // move its transform too, or it blinks for a frame
      kind.body.instanceMatrix.needsUpdate = true;
      kind.swim.needsUpdate = true;
      kind.jaw.needsUpdate = true;
    }
    for (const m of kind.meshes) m.count = kind.list.length;
    this.all.splice(this.all.indexOf(f), 1);
    this.byId.delete(f.id);
    const p = this.predators.indexOf(f);
    if (p >= 0) this.predators.splice(p, 1);
  }

  /** A shark or the golden fish. The shark may come with a victim chosen by the Director. */
  spawnVisitor(species, { durationMs = 60000, side = null, victimId = null, huntAtMs = 12000 } = {}) {
    const s = side === 'left' ? -1 : side === 'right' ? 1 : null;
    const f = this.add({ id: `${species}-${Math.random().toString(36).slice(2, 8)}`, species, bornAt: 0 }, { enter: true, side: s });
    if (!f) return null;
    f.visitor = true;
    f.leaveAt = performance.now() + durationMs;
    f.victimId = victimId;
    const victim = victimId && this.byId.get(victimId);
    if (victim) victim.doomed = true;
    f.huntAt = this.t + huntAtMs / 1000;
    return f;
  }

  visitors(species) { return this.kinds[species]?.list.filter((f) => f.state !== 'leave') ?? []; }

  // ---- what events do to the fish ---------------------------------------------------
  /** FEED: the whole tank hears food hitting the water and rushes there. */
  feed(x = 0) {
    this.mood.frenzy = { until: this.t + 16, pos: new THREE.Vector3(x, 8.6, 0.4) };
    for (const f of this.all) if (!f.visitor) f.hunger = Math.max(f.hunger, 0.7);
    for (const k of Object.values(this.kinds)) k.schoolUntil = 0;
  }

  /** BUBBLES: playful fish swim into the curtain and ride it up. */
  bubbles(durationMs = 12000) {
    this.mood.bubblesUntil = this.t + durationMs / 1000;
    for (const k of Object.values(this.kinds)) k.schoolUntil = 0;
  }

  /** DAY: the reef wakes up with a burst of activity. */
  wake() {
    this.mood.wakeUntil = this.t + 25;
    for (const k of Object.values(this.kinds)) k.schoolUntil = 0;
  }

  /** !myfish: the fish swims up to the front glass and poses for its owner. */
  spotlight(id, durationMs = 10000) {
    const f = this.byId.get(id);
    if (f) f.spotUntil = this.t + durationMs / 1000;
  }

  /** A newcomer is met by a few fish of its own kind. */
  greet(newcomer) {
    const mates = newcomer.kind.list
      .filter((o) => o !== newcomer && o.state === 'live' && !o.visitor)
      .sort((a, b) => a.pos.distanceToSquared(newcomer.pos) - b.pos.distanceToSquared(newcomer.pos))
      .slice(0, 3);
    for (const m of mates) m.greet = { id: newcomer.id, until: this.t + 6 };
  }

  // ---- simulation -----------------------------------------------------------------
  update(dt, t, env) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    this.t = t;
    this.updateMood(dt, t, env);
    this.buildGrid();
    for (const kind of Object.values(this.kinds)) {
      if (!kind.list.length) continue;
      if (kind.spec.behavior.school) this.updateSchoolTarget(kind, t, env);
      for (const f of kind.list) {
        if (f.caught) continue;
        f.size = f.visitor ? f.sw.size : f.sw.size * f.sizeK * growth(env.nowMs - f.bornAt);
        this.think(f, dt, t, env);
        this.move(f, dt);
        this.write(f);
        if (env.night > 0.45) this.trail(f, dt, env.night);
      }
      kind.body.instanceMatrix.needsUpdate = true;
      kind.swim.needsUpdate = true;
      if (kind.spec.jaw) kind.jaw.needsUpdate = true;
    }
    for (const f of this.toDestroy) this.destroy(f);
    this.toDestroy.length = 0;
  }

  updateMood(dt, t, env) {
    const m = this.mood;
    let threat = null;
    for (const p of this.predators) {
      if (p.state !== 'leave' && Math.abs(p.pos.x) < 12) threat = p;
    }
    m.threat = threat;
    // Alarm spreads fast and fades slowly after the shark is gone.
    m.alarm = damp(m.alarm, threat ? 1 : 0, threat ? 2.5 : 0.22, dt);
    if (threat) m.hide.set((threat.pos.x > 0 ? -1 : 1) * 7.8, 2.6, -2.6);
    if (m.frenzy && t > m.frenzy.until) m.frenzy = null;
    m.golden = this.kinds.golden.list.find((g) => g.state === 'live') ?? null;
    m.jellies = env.jellies ?? [];
  }

  cellKey(p) {
    return ((Math.floor(p.x / 2.5) + 64) * 128 + (Math.floor(p.y / 2.5) + 64)) * 128 + (Math.floor(p.z / 2.5) + 64);
  }

  buildGrid() {
    this.grid.clear();
    for (const f of this.all) {
      if (f.caught) continue;
      const k = this.cellKey(f.pos);
      const cell = this.grid.get(k);
      if (cell) cell.push(f);
      else this.grid.set(k, [f]);
    }
  }

  forNeighbors(f, fn) {
    const cx = Math.floor(f.pos.x / 2.5), cy = Math.floor(f.pos.y / 2.5), cz = Math.floor(f.pos.z / 2.5);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = this.grid.get(((cx + dx + 64) * 128 + (cy + dy + 64)) * 128 + (cz + dz + 64));
          if (cell) for (const n of cell) if (n !== f) fn(n);
        }
      }
    }
  }

  updateSchoolTarget(kind, t, env) {
    const m = this.mood;
    const B = kind.spec.behavior;
    if (m.alarm > 0.3) { kind.schoolTarget.copy(m.hide); return; }
    if (m.frenzy) { kind.schoolTarget.copy(m.frenzy.pos); return; }
    if (m.golden && B.escort) {
      // Escort the golden fish: stay a little behind and above it.
      const g = m.golden;
      T.v.copy(g.vel).setY(0);
      if (T.v.lengthSq() < 1e-4) T.v.set(1, 0, 0);
      kind.schoolTarget.copy(g.pos).addScaledVector(T.v.normalize(), -2.6);
      kind.schoolTarget.y += 0.5;
      return;
    }
    if (t < m.bubblesUntil && B.playful) {
      if (t >= kind.schoolUntil) {
        kind.schoolTarget.set(-8 + this.rnd() * 16, 3 + this.rnd() * 5, CURTAIN_Z + 0.3);
        kind.schoolUntil = t + 2.5 + this.rnd() * 2;
      }
      return;
    }
    if (t < kind.schoolUntil) return;
    const z = B.zone ?? [3, 8];
    const night = env.night > 0.5;
    const awake = t < m.wakeUntil;
    const ylo = night ? Math.max(1, z[0] - 1.5) : z[0];
    const yhi = night ? z[0] + 1.5 : z[1];
    kind.schoolTarget.set(-8.5 + this.rnd() * 17, ylo + this.rnd() * (yhi - ylo), -3.5 + this.rnd() * 5.5);
    kind.schoolUntil = t + (awake ? 2.5 : night ? 12 : 6) + this.rnd() * (awake ? 2 : 7);
  }

  seek(f, goal, speed, weight, arrive = 1.2) {
    const d = T.desired.subVectors(goal, f.pos);
    const dist = d.length();
    if (dist < 1e-4) return;
    d.multiplyScalar((speed * Math.min(1, dist / arrive)) / dist);
    f.acc.addScaledVector(d.sub(f.vel), weight);
  }

  homeOf(f) {
    if (f.B.home === 'anemone') return this.reef.anchors.anemone;
    if (f.B.home === 'coral') return this.reef.anchors.coral;
    if (f.B.home === 'rocks') return (f.home ??= this.rocks[Math.floor(f.r() * this.rocks.length)]).center;
    return null;
  }

  nearestRock(p) {
    let best = this.rocks[0], bd = Infinity;
    for (const o of this.rocks) {
      const d = o.center.distanceToSquared(p);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /** Where a frightened fish goes: anemone, coral, school ball, or behind a rock away from the shark. */
  hideSpot(f) {
    const { B } = f;
    const m = this.mood;
    if (B.home === 'anemone') return T.goal.copy(this.reef.anchors.anemone).addScaledVector(f.offset, 0.15).setY(this.reef.anchors.anemone.y - 0.45);
    if (B.home === 'coral') return T.goal.copy(this.reef.anchors.coral).addScaledVector(f.offset, 0.3);
    if (B.school && !B.home && !B.graze) return T.goal.copy(m.hide).addScaledVector(f.offset, 0.45);
    const rock = B.home === 'rocks' ? (f.home ??= this.rocks[0]) : this.nearestRock(f.pos);
    const from = m.threat ? m.threat.pos : T.b.set(0, 5, 12);
    T.a.subVectors(rock.center, from).setY(0).normalize();
    return T.goal.copy(rock.center).addScaledVector(T.a, Math.max(...rock.size) * 1.05 + 0.5).setY(rock.center.y + 0.3 + f.offset.y * 0.3);
  }

  pickTarget(f, t, env) {
    const { B, r } = f;
    const zone = B.zone ?? [2.5, 7.5];
    const night = env.night > 0.5;
    const ylo = night ? Math.max(0.8, zone[0] - 1) : zone[0];
    const yhi = night ? Math.min(zone[1], zone[0] + 2.2) : zone[1];
    const slow = night ? 1.8 : t < this.mood.wakeUntil ? 0.5 : 1;
    if (B.home === 'anemone') {
      const a = this.reef.anchors.anemone;
      const rad = night ? 0.45 : B.homeR;
      f.target.set(a.x + (r() - 0.5) * 2 * rad, a.y - 0.2 + r() * (night ? 0.4 : 1.5), a.z + (r() - 0.5) * 2 * rad);
      f.targetUntil = t + (1.5 + r() * 3) * slow;
    } else if (B.home === 'rocks') {
      f.home ??= this.rocks[Math.floor(r() * this.rocks.length)];
      const o = f.home;
      T.v.set(r() - 0.5, r() * 0.8 - 0.1, 0.3 + r() * 0.7).normalize();
      f.target.copy(o.center).addScaledVector(T.v, Math.max(...o.size) * 1.15 + 0.3 + r() * B.homeR);
      f.targetUntil = t + (2 + r() * 4) * slow;
    } else if (B.home === 'coral') {
      const a = this.reef.anchors.coral;
      f.target.set(a.x + (r() - 0.5) * 2 * B.homeR, a.y + (r() - 0.5) * 1.4 - (night ? 0.8 : 0), a.z + (r() - 0.5) * 1.8);
      f.targetUntil = t + (3 + r() * 5) * slow;
    } else if (B.graze && r() < B.graze && this.rocks.length) {
      const o = this.rocks[Math.floor(r() * this.rocks.length)];
      T.v.set(r() - 0.5, 0.2 + r() * 0.6, 0.3 + r() * 0.7).normalize();
      f.target.copy(o.center).addScaledVector(T.v, Math.max(...o.size) * 1.2 + 0.5);
      f.targetUntil = t + 3 + r() * 4;
    } else {
      f.target.set(-10 + r() * 20, ylo + r() * (yhi - ylo), -4.5 + r() * 7.5);
      f.targetUntil = t + (4 + r() * 7) * slow;
    }
    f.target.y = Math.max(f.target.y, this.terrain.heightAt(f.target.x, f.target.z) + 0.6);
  }

  think(f, dt, t, env) {
    const { sw, B } = f;
    f.acc.set(0, 0, 0);
    f.panic = Math.max(0, f.panic - dt);
    f.hunger = Math.min(1, f.hunger + dt / 420);
    f.feeding = false;
    if (B.ai === 'shark') return this.thinkShark(f, dt, t, env);
    if (B.ai === 'golden') return this.thinkGolden(f, dt, t, env);

    if (f.state === 'enter' || f.state === 'leave') {
      this.seek(f, f.target, sw.cruise * 1.2, 2, 0.5);
      if (f.state === 'enter' && Math.abs(f.pos.x) < 10.5) { f.state = 'live'; f.targetUntil = 0; }
      if (f.state === 'leave' && Math.abs(f.pos.x) > 17.5) this.toDestroy.push(f);
      this.avoidFloor(f);
      return;
    }

    // The fish the shark has picked runs for its life.
    if (f.hunted) return this.flee(f, dt, t);

    const m = this.mood;
    const scared = m.alarm > 0.3;
    const sleepy = env.night * (1 - m.alarm);
    const cruise = sw.cruise * (1 - 0.6 * sleepy) * (t < m.wakeUntil ? 1.35 : 1) * (1 + 0.5 * m.alarm);

    // Food: during a feeding frenzy the whole tank smells it.
    const frenzy = m.frenzy;
    if (!scared && f.hunger > 0.12 && t > f.eatCd) {
      if (this.food.count) {
        let best = null;
        let bd = (frenzy ? 14 : B.home ? 5.5 : 9) ** 2;
        for (const fl of this.food.flakes) {
          if (fl.eaten) continue;
          const d2 = fl.pos.distanceToSquared(f.pos);
          if (d2 < bd) { bd = d2; best = fl; }
        }
        if (best) {
          f.feeding = true;
          this.seek(f, best.pos, sw.max * 0.85, 3.2, 0.4);
          const eatR = 0.12 + f.size * 0.3;
          if (bd < eatR * eatR) {
            this.food.consume(best);
            f.hunger = Math.max(0, f.hunger - 0.2);
            f.eatCd = t + 0.3 + f.r() * 0.6;
            f.gulp = 0.35;
            this.onEat?.(f);
          }
        }
      }
      if (!f.feeding && frenzy && f.hunger > 0.25) {
        // Rush to where the food hit the water; homebodies only peek out halfway.
        const home = this.homeOf(f);
        T.goal.copy(frenzy.pos).addScaledVector(f.offset, 0.9);
        if (home) T.goal.lerpVectors(home, T.goal, 0.4);
        this.seek(f, T.goal, sw.max * 0.8, 2.4, 1.5);
        f.feeding = true;
      }
    }

    if (!f.feeding) {
      let goal;
      let speed = cruise, weight = B.hover ? 0.6 : 1, arrive = B.hover ? 2.5 : 1.2;
      const mate = f.greet && t < f.greet.until ? this.byId.get(f.greet.id) : null;
      if (scared) {
        goal = this.hideSpot(f);
        speed = sw.max * 0.75;
        weight = 2.2;
        arrive = 0.6;
      } else if (f.spotUntil > t) {
        // Pose at the front glass so the owner can see it.
        goal = T.goal.set(clamp(f.pos.x, -5, 5) * 0.6, 4.4, 3.3);
        speed = cruise * 1.2;
        weight = 2;
        arrive = 1.6;
      } else if (mate) {
        goal = T.goal.copy(mate.pos).addScaledVector(f.offset, 0.4);
        speed = cruise * 1.5;
        weight = 1.5;
      } else if (B.school && !B.home) {
        goal = T.goal.copy(f.kind.schoolTarget).add(f.offset);
      } else {
        if (t > f.targetUntil || f.pos.distanceToSquared(f.target) < 0.35) this.pickTarget(f, t, env);
        goal = f.target;
      }
      this.seek(f, goal, speed, weight, arrive);
    }

    // Neighbours: keep distance from everyone, school with your own kind (tighter when scared).
    const school = B.school;
    const sepR = (school?.sepR ?? 0.45) * (1 - 0.4 * m.alarm);
    T.ali.set(0, 0, 0);
    T.coh.set(0, 0, 0);
    T.sep.set(0, 0, 0);
    let n = 0;
    this.forNeighbors(f, (o) => {
      if (o.B.ai === 'shark' || o.caught) return;
      const dx = f.pos.x - o.pos.x, dy = f.pos.y - o.pos.y, dz = f.pos.z - o.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const minD = sepR + (f.size + o.size) * 0.35;
      if (d2 < minD * minD && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const k = (minD - d) / minD;
        T.sep.x += (dx / d) * k;
        T.sep.y += (dy / d) * k;
        T.sep.z += (dz / d) * k;
      }
      if (school && o.species === f.species && d2 < school.r * school.r) {
        T.ali.add(o.vel);
        T.coh.add(o.pos);
        n++;
      }
    });
    f.acc.addScaledVector(T.sep, (school?.sep ?? 1.2) * 3);
    if (n && !f.feeding) {
      const tight = (1 + 2.5 * m.alarm) * (1 - 0.5 * sleepy);
      T.ali.divideScalar(n).sub(f.vel);
      f.acc.addScaledVector(T.ali, school.ali * 0.6 * (1 + m.alarm) * (f.panic > 0 ? 1.6 : 1));
      T.coh.divideScalar(n).sub(f.pos);
      f.acc.addScaledVector(T.coh, school.coh * 0.35 * tight * (f.panic > 0 ? 1.8 : 1));
    }

    // A shark close by: scatter (clownfish dive into their anemone instead).
    for (const p of this.predators) {
      if (p.state === 'leave') continue;
      const d = p.pos.distanceTo(f.pos) - p.size * 0.3;
      const R = (3.2 + (B.shy ?? 0.7) * 3) * (p.mode === 'hunt' ? 1.3 : 1);
      if (d < R) {
        const k = 1 - Math.max(0, d) / R;
        f.panic = Math.max(f.panic, 0.4 + 1.2 * k);
        if (B.home === 'anemone') {
          this.seek(f, this.reef.anchors.anemone, sw.max, 4 * k, 0.3);
        } else {
          T.v.subVectors(f.pos, p.pos);
          T.v.y *= 0.4;
          T.v.normalize();
          f.acc.addScaledVector(T.v, k * k * 16);
        }
      }
    }

    // Jellyfish sting: everyone but the clownfish keeps clear.
    if (B.home !== 'anemone') {
      for (const j of m.jellies) {
        const d = f.pos.distanceTo(j.pos);
        const R = j.r + 1.1;
        if (d < R && d > 1e-4) {
          T.v.subVectors(f.pos, j.pos).divideScalar(d);
          f.acc.addScaledVector(T.v, (1 - d / R) * 8);
        }
      }
    }

    // Riding the bubble curtain.
    if (t < m.bubblesUntil && B.playful && Math.abs(f.pos.z - CURTAIN_Z) < 1.3) f.acc.y += 3.2;

    this.avoidBounds(f);
    this.avoidObstacles(f);
  }

  /**
   * The hunted fish: flat out away from the shark, jinking; it tires after a few seconds.
   * It is kept in open water the shark can reach - pinned in a corner or under a rock it would
   * just sit there, and the chase would never end.
   */
  flee(f, dt, t) {
    const shark = this.byId.get(f.huntedBy);
    if (!shark || shark.mode !== 'hunt') {
      f.hunted = false;
      return;
    }
    const p = f.pos, box = PREY_BOX;
    const low = this.terrain.heightAt(p.x, p.z) + box.above;
    T.v.subVectors(p, shark.pos);
    T.v.y *= 0.35;
    // Slide along the edges of the box instead of pressing into them...
    if ((p.x > box.x - 0.8 && T.v.x > 0) || (p.x < -box.x + 0.8 && T.v.x < 0)) T.v.x = 0;
    if ((p.z > box.zMax - 0.8 && T.v.z > 0) || (p.z < box.zMin + 0.8 && T.v.z < 0)) T.v.z = 0;
    if ((p.y > box.yMax - 0.8 && T.v.y > 0) || (p.y < low + 0.8 && T.v.y < 0)) T.v.y = 0;
    // ...and when cornered, dart past the shark towards open water.
    if (T.v.lengthSq() < 0.3) T.v.set(-p.x, 0.3, -p.z * 0.5);
    T.v.normalize();
    T.a.set(-T.v.z, 0, T.v.x).multiplyScalar(Math.sin(t * 5 + f.phase0) * 0.7);
    T.v.add(T.a).normalize();
    f.acc.addScaledVector(T.v, 14);
    if (p.x > box.x) f.acc.x -= (p.x - box.x) * 30;
    if (p.x < -box.x) f.acc.x += (-box.x - p.x) * 30;
    if (p.z > box.zMax) f.acc.z -= (p.z - box.zMax) * 30;
    if (p.z < box.zMin) f.acc.z += (box.zMin - p.z) * 30;
    if (p.y < low) f.acc.y += (low - p.y) * 30;
    if (p.y > box.yMax) f.acc.y -= (p.y - box.yMax) * 30;
    f.panic = 1;
    const tired = t - f.huntedAt;
    f.maxOverride = f.sw.max * (tired > 7 ? 0.2 : tired > 4 ? 0.55 : 1.05);
    this.avoidObstacles(f);
  }

  thinkShark(f, dt, t, env) {
    const sw = f.sw;
    f.shake = Math.max(0, f.shake - dt);
    f.burst = false;
    // Cruising sharks keep their mouth slightly open to breathe.
    f.jawTarget = 0.05 + 0.06 * (0.5 + 0.5 * Math.sin(t * 0.8 + f.phase0));
    if (f.state === 'enter') {
      this.seek(f, f.target, sw.cruise * 1.1, 1.2, 1);
      if (Math.abs(f.pos.x) < 9) { f.state = 'live'; f.targetUntil = 0; }
      return;
    }
    if (f.state === 'leave') {
      this.seek(f, f.target, sw.cruise * 1.3, 1.2, 1);
      if (Math.abs(f.pos.x) > 20) this.toDestroy.push(f);
      return;
    }
    if (performance.now() > f.leaveAt && f.mode !== 'hunt') {
      // Never leave a doomed fish behind: it slips away off screen instead (the world already lost it).
      const v = f.victimId && this.byId.get(f.victimId);
      if (v) {
        v.hunted = false;
        this.startLeaving(v);
      }
      f.victimId = null;
      return this.startLeaving(f);
    }

    if (f.mode === 'patrol' && f.victimId && t >= f.huntAt) {
      const v = this.byId.get(f.victimId);
      if (v && v.state === 'live' && !v.caught) {
        f.mode = 'hunt';
        f.huntStart = t;
        v.hunted = true;
        v.huntedBy = f.id;
        v.huntedAt = t;
      } else f.victimId = null;
    }

    let floorExtra = 1.6;
    if (f.mode === 'hunt') {
      const v = this.byId.get(f.victimId);
      if (!v || v.caught) {
        f.mode = 'patrol';
        f.victimId = null;
      } else {
        floorExtra = -0.5;
        // The jaws: ahead of the body along its heading (pitch included), just under the snout.
        const cp = Math.cos(f.pitch);
        T.a.set(cp * Math.cos(f.yaw), Math.sin(f.pitch), -cp * Math.sin(f.yaw)).multiplyScalar(f.size * 0.44).add(f.pos);
        T.a.y -= f.size * 0.04;
        // A hunt must end (the Director has already taken the fish out of the world): an exhausted
        // prey is caught from further and further away, so the chase cannot drag on.
        const reach = 0.6 + v.size * 0.5 + Math.max(0, t - f.huntStart - 8) * 0.6;
        const dj = T.a.distanceTo(v.pos);
        f.jawTarget = clamp(1.45 - dj / 4, 0.25, 1); // the mouth gapes as the prey gets close
        if (dj < reach) {
          this.catchFish(f, v, t);
        } else {
          // Steer the jaws, not the middle of the body, at where the prey is about to be
          // (never lower than the shark can go, or it fights the floor instead of swimming).
          T.goal.copy(v.pos).addScaledVector(v.vel, 0.25);
          T.goal.y = Math.max(T.goal.y, this.terrain.heightAt(T.goal.x, T.goal.z) + 1.2);
          T.desired.subVectors(T.goal, T.a).setLength(sw.max);
          f.acc.addScaledVector(T.desired.sub(f.vel), 2.4);
        }
      }
    }
    if (f.mode !== 'hunt') {
      if (f.mode === 'eat' && t > f.eatUntil) {
        f.mode = 'patrol';
        f.leaveAt = Math.min(f.leaveAt, performance.now() + 9000);
      }
      if (f.mode === 'eat') {
        // Snap shut on the catch, then a few bites while shaking the head.
        const since = t - f.caughtAt;
        f.jawTarget = since < 0.3 ? 0 : 0.12 + 0.42 * Math.max(0, Math.sin((since - 0.3) * 9));
      }
      // A few seconds before the strike the shark quietly closes in on its victim.
      const stalked = f.mode === 'patrol' && f.victimId && t > f.huntAt - 4 ? this.byId.get(f.victimId) : null;
      if (stalked) {
        f.target.copy(stalked.pos);
        f.targetUntil = t + 0.5;
        f.charge = 0;
        f.jawTarget = 0.16;
      } else if (t > f.targetUntil || f.pos.distanceToSquared(f.target) < 2) {
        // Patrol from side to side, sometimes cutting towards the glass; now and then dart at the school.
        const prey = this.kinds.chromis.list;
        if (f.mode === 'patrol' && prey.length && f.r() < 0.3) {
          T.v.set(0, 0, 0);
          for (const p of prey) T.v.add(p.pos);
          f.target.copy(T.v.divideScalar(prey.length));
          f.charge = t + 2.2;
        } else {
          const side = f.pos.x > 0 ? -1 : 1;
          f.target.set(side * (5 + f.r() * 3.5), 3 + f.r() * 4.2, -2.6 + f.r() * 5.2);
        }
        f.targetUntil = t + 6 + f.r() * 5;
      }
      f.target.x = clamp(f.target.x, -9, 9);
      f.target.y = clamp(f.target.y, 2.6, 8.2);
      f.target.z = clamp(f.target.z, -3.5, 2.8);
      const speed = f.mode === 'eat' ? sw.cruise * 0.6 : stalked ? sw.cruise * 1.3 : t < f.charge ? sw.max * 0.85 : sw.cruise;
      this.seek(f, f.target, speed, stalked ? 1.6 : 1, stalked ? 4 : 2.5);
    }
    // Attacks are bursts: full speed and a quicker start than the lazy patrol allows.
    if (f.mode === 'hunt' || t < f.charge) {
      f.burst = true;
      f.maxOverride = sw.max * (f.mode === 'hunt' ? 1 : 0.85);
    }
    // Patrols stay in the middle of the picture; a hunt follows the prey wherever it can run.
    const hunting = f.mode === 'hunt';
    const xLim = hunting ? PREY_BOX.x + 0.6 : 6;
    if (f.pos.x > xLim) f.acc.x -= (f.pos.x - xLim) * (hunting ? 3 : 0.8);
    if (f.pos.x < -xLim) f.acc.x += (-xLim - f.pos.x) * (hunting ? 3 : 0.8);
    const zLo = hunting ? PREY_BOX.zMin - 0.4 : TANK.zMin + 1.2;
    if (f.pos.z > TANK.zMax - 1.2) f.acc.z -= (f.pos.z - (TANK.zMax - 1.2)) * 3;
    if (f.pos.z < zLo) f.acc.z += (zLo - f.pos.z) * 3;
    this.avoidFloor(f, floorExtra);
    this.avoidObstacles(f);
  }

  catchFish(shark, victim, t) {
    shark.mode = 'eat';
    shark.caughtAt = t;
    shark.eatUntil = t + 2.4;
    shark.shake = 1.3;
    shark.victimId = null;
    victim.caught = true;
    this.toDestroy.push(victim);
    const at = victim.pos.clone();
    this.glow?.emit(at, 26, SCALES, 0.8, 1.4);
    // Everyone near the bite scatters.
    for (const o of this.all) {
      if (o.visitor || o === victim) continue;
      if (o.pos.distanceToSquared(at) < 49) o.panic = Math.max(o.panic, 2.2);
    }
    this.onCatch?.({ id: victim.id, name: victim.name, species: victim.species, pos: at });
  }

  thinkGolden(f, dt, t, env) {
    const sw = f.sw;
    if (f.state === 'enter' || f.state === 'leave') {
      this.seek(f, f.target, sw.cruise * 1.3, 1.5, 0.8);
      if (f.state === 'enter' && Math.abs(f.pos.x) < 9) f.state = 'live';
      if (f.state === 'leave' && Math.abs(f.pos.x) > 18) this.toDestroy.push(f);
    } else {
      if (performance.now() > f.leaveAt) return this.startLeaving(f);
      const ph = t * 0.12 + f.phase0;
      T.goal.set(Math.sin(ph) * 7.5, 5.3 + Math.sin(ph * 2) * 1.5, 1.2 + Math.cos(ph) * 1.3);
      this.seek(f, T.goal, sw.cruise, 1.2, 1.5);
      this.avoidObstacles(f);
    }
    if (f.r() < dt * 22) this.sparkles?.emit(f.pos, 1);
  }

  /** At night, plankton lights up wherever a fish moves fast. */
  trail(f, dt, night) {
    if (!this.glow || f.caught) return;
    const shark = f.B.ai === 'shark';
    const sp = f.vel.length();
    const rate = (shark ? 9 : 4) * Math.max(0, sp - f.sw.cruise * 0.6) * night;
    if (f.r() > rate * dt) return;
    T.a.set(Math.cos(f.yaw), 0, -Math.sin(f.yaw)).multiplyScalar(-f.size * 0.42).add(f.pos);
    this.glow.emit(T.a, shark ? 2 : 1, GLOW, shark ? 0.6 : 0.12, shark ? 1.1 : 0.8);
  }

  avoidFloor(f, extra = 0) {
    const floor = this.terrain.heightAt(f.pos.x, f.pos.z) + 0.3 + f.size * 0.2 + extra;
    if (f.pos.y < floor + 0.8) f.acc.y += 10 * (floor + 0.8 - f.pos.y);
    if (f.pos.y > TANK.yMax - 0.8) f.acc.y -= 10 * (f.pos.y - (TANK.yMax - 0.8));
  }

  avoidBounds(f) {
    const m = 1.8, k = 8;
    const p = f.pos;
    if (p.x > TANK.xMax - m) f.acc.x -= (k * (p.x - (TANK.xMax - m))) / m;
    if (p.x < TANK.xMin + m) f.acc.x += (k * (TANK.xMin + m - p.x)) / m;
    if (p.z > TANK.zMax - 1.2) f.acc.z -= (k * (p.z - (TANK.zMax - 1.2))) / 1.2;
    if (p.z < TANK.zMin + 1.2) f.acc.z += (k * (TANK.zMin + 1.2 - p.z)) / 1.2;
    this.avoidFloor(f);
  }

  avoidObstacles(f) {
    for (const o of this.terrain.obstacles) {
      const [sx, sy, sz] = o.size;
      const dx = f.pos.x - o.center.x, dy = f.pos.y - o.center.y, dz = f.pos.z - o.center.z;
      const q = Math.sqrt((dx / sx) ** 2 + (dy / sy) ** 2 + (dz / sz) ** 2);
      const lim = 1.25 + (f.size * 0.45) / Math.min(sx, sy, sz);
      if (q < lim + 0.6) {
        T.n.set(dx / (sx * sx), dy / (sy * sy), dz / (sz * sz)).normalize();
        f.acc.addScaledVector(T.n, (lim + 0.6 - q) * 7);
        if (q < lim) f.pos.addScaledVector(T.n, (lim - q) * Math.min(sx, sy, sz) * 0.25);
      }
    }
  }

  move(f, dt) {
    const sw = f.sw;
    const leaving = f.state !== 'live';
    const maxA = sw.accel * (f.panic > 0 || f.burst ? 2.6 : 1) * (f.feeding ? 1.6 : 1);
    const al = f.acc.length();
    if (al > maxA) f.acc.multiplyScalar(maxA / al);
    f.vel.addScaledVector(f.acc, dt);
    const hs = Math.hypot(f.vel.x, f.vel.z);
    // Fish do not swim straight up or down; a striking shark may dive steeply.
    const vy = f.burst ? 0.9 * hs + 0.8 : 0.55 * hs + 0.12;
    f.vel.y = clamp(f.vel.y, -vy, vy);
    const maxS = f.maxOverride ?? (f.panic > 0 ? sw.max : f.feeding ? sw.max * 0.85 : Math.max(sw.cruise * 1.7, 0.3));
    f.maxOverride = undefined;
    const minS = f.B.hover ? 0.03 : sw.cruise * 0.25;
    let sp = f.vel.length();
    if (sp > maxS) {
      f.vel.multiplyScalar(maxS / sp);
      sp = maxS;
    } else if (sp < minS) {
      if (sp < 1e-4) f.vel.set(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
      f.vel.setLength(minS);
      sp = minS;
    }
    f.pos.addScaledVector(f.vel, dt);
    if (!leaving && !f.visitor) {
      f.pos.x = clamp(f.pos.x, TANK.xMin - 0.5, TANK.xMax + 0.5);
      f.pos.z = clamp(f.pos.z, TANK.zMin - 0.3, TANK.zMax + 0.3);
    }
    const floor = this.terrain.heightAt(f.pos.x, f.pos.z) + 0.15 + f.size * 0.15;
    f.pos.y = clamp(f.pos.y, floor, TANK.yMax);

    const prevYaw = f.yaw;
    const targetYaw = Math.atan2(-f.vel.z, f.vel.x);
    const shark = f.B.ai === 'shark';
    const turn = sp < 0.15 ? 1.8 : shark ? (f.burst ? 4 : 2.2) : 5;
    f.yaw = wrapAngle(f.yaw + wrapAngle(targetYaw - f.yaw) * (1 - Math.exp(-turn * dt)));
    f.yawRate = damp(f.yawRate, wrapAngle(f.yaw - prevYaw) / dt, 8, dt);
    f.pitch = damp(f.pitch, clamp(Math.atan2(f.vel.y, hs + 1e-4), -0.6, 0.6), 4, dt);
    f.roll = damp(f.roll, clamp(-f.yawRate * 0.16, -0.4, 0.4), 4, dt);
    const bendMax = shark ? 0.32 : 0.16;
    f.bend = damp(f.bend, clamp(f.yawRate * (shark ? 0.22 : 0.1), -bendMax, bendMax), 6, dt);

    const speedK = clamp(sp / sw.cruise, 0.2, 3);
    const freq = sw.tailHz * (0.35 + 0.65 * speedK) * (f.gulp > 0 ? 1.4 : 1);
    f.phase = (f.phase + dt * freq * Math.PI * 2) % (Math.PI * 2000);
    f.amp = damp(f.amp, clamp(0.45 + 0.55 * speedK, 0.4, 1.7), 3, dt);
    f.flap = (f.flap + dt * sw.pecHz * Math.PI * 2 * (1.3 - 0.5 * clamp(speedK, 0, 1))) % (Math.PI * 2000);
    f.gulp = Math.max(0, f.gulp - dt);
    // Jaws snap shut much faster than they open.
    f.jaw = damp(f.jaw, f.jawTarget, f.jawTarget > f.jaw ? 9 : 24, dt);
  }

  write(f) {
    let yaw = f.yaw;
    // The head swings a little with every tail beat (big, slow swimmers show it most).
    if (f.sw.headYaw) yaw += Math.sin(f.phase + 0.6) * f.sw.headYaw * f.amp;
    // Shaking its head with the catch.
    if (f.shake > 0) yaw += Math.sin(this.t * 26) * 0.24 * Math.min(1, f.shake);
    T.e.set(f.roll, yaw, f.pitch, 'YZX');
    T.q.setFromEuler(T.e);
    T.s.setScalar(f.size);
    T.m.compose(f.pos, T.q, T.s);
    f.kind.body.setMatrixAt(f.idx, T.m);
    f.kind.swim.setXYZW(f.idx, f.phase, f.amp, f.bend, f.flap);
    f.kind.jaw.setX(f.idx, f.jaw);
  }

  /** Screen position (CSS px) above a fish, for name labels. */
  screenPos(id, camera, width, height) {
    const f = this.byId.get(id);
    if (!f) return null;
    T.v.copy(f.pos);
    T.v.y += f.size * 0.35;
    T.v.project(camera);
    return {
      x: (T.v.x * 0.5 + 0.5) * width,
      y: (-T.v.y * 0.5 + 0.5) * height,
      visible: T.v.z < 1 && Math.abs(T.v.x) < 1.05 && Math.abs(T.v.y) < 1.05,
      fish: f,
    };
  }
}
