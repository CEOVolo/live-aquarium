import * as THREE from 'three';
import { pchip, clamp } from '../util.js';

// Fish are authored in a unit "fish space": nose at x = +0.5, tail tip at
// x = -0.5, y up, z to the fish's right. Texture coordinates are a planar side
// projection (u = x + 0.5, v = y + 0.5), so one painted side view colours the
// body, the fins and even the eyes consistently.

export function makeProfile(spec) {
  const top = pchip(spec.top);
  const bot = pchip(spec.bot);
  const wid = pchip(spec.wid);
  const X = (s) => 0.5 - s * spec.bodyLen;
  const e = spec.boxy ?? 0.9;
  const mid = (s) => (top(s) + bot(s)) / 2;
  /** z of the body surface at body-parameter s and height y. */
  const surfaceZ = (s, y) => {
    const yt = top(s), yb = bot(s);
    const yc = (yt + yb) / 2, hh = Math.max(1e-3, (yt - yb) / 2);
    const t = clamp((y - yc) / hh, -0.97, 0.97);
    const sn = Math.sign(t) * Math.pow(Math.abs(t), 1 / e);
    const c = Math.sqrt(Math.max(0, 1 - sn * sn));
    return wid(s) * Math.pow(c, e);
  };
  return { top, bot, wid, X, mid, surfaceZ, e };
}

export function tailLenFactor(shape, tb) {
  const t = Math.abs(tb);
  switch (shape) {
    case 'forked': return 0.5 + 0.5 * Math.pow(t, 1.3);
    case 'deepfork': return 0.32 + 0.68 * Math.pow(t, 1.05);
    case 'lunate': return 0.78 + 0.22 * t * t;
    case 'truncate': return 0.95 + 0.05 * t;
    case 'round': return 1.0 - 0.34 * t * t;
    case 'veil': return 1.0 - 0.1 * t * t + 0.08 * Math.sin(tb * 3.0);
    case 'hetero': return tb > 0 ? 0.5 + 0.5 * t : 0.42 + 0.1 * t;
    default: return 1;
  }
}

/** Point on the caudal fin: a (0 at peduncle, 1 at trailing edge), tb (-1 bottom .. 1 top). */
export function tailPoint(spec, P, a, tb) {
  const t = spec.tail;
  const x0 = P.X(1) + 0.035;
  const yt = P.top(1), yb = P.bot(1);
  const yc = (yt + yb) / 2, h0 = Math.max(0.01, (yt - yb) / 2);
  const upper = tb > 0;
  const target = upper ? t.spreadUp ?? t.spread : t.spreadDown ?? t.spread;
  const spread = h0 + (target - h0) * Math.pow(a, 0.75);
  const x = x0 - a * (t.len + 0.035) * tailLenFactor(t.shape, tb);
  const y = yc + tb * spread + (t.lift ?? 0) * a * (upper ? Math.abs(tb) : 0.3 * Math.abs(tb));
  return [x, y];
}

/** Point on a median fin: c (0..1 along its base), e (0 base .. 1 edge). */
export function medianFinPoint(spec, P, fin, c, e, hf = pchip(fin.h)) {
  const dir = fin.type.startsWith('dorsal') ? 1 : -1;
  const s = fin.from + c * (fin.to - fin.from);
  const x0 = P.X(s);
  const yb = dir > 0 ? P.top(s) - 0.012 : P.bot(s) + 0.012;
  const h = Math.max(0.004, hf(c)) + 0.012;
  return [x0 - Math.pow(e, 1.3) * (fin.sweep ?? 0.03), yb + dir * e * h];
}

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.fin = [];
    this.idx = [];
  }

  vertex(x, y, z, finType = 0, finT = 0, u = null, v = null) {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.uv.push(u ?? x + 0.5, v ?? y + 0.5);
    this.fin.push(finType, finT);
    return i;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  quad(a, b, c, d) { this.idx.push(a, b, d, b, c, d); }

  gridQuads(rows) {
    for (let i = 0; i < rows.length - 1; i++) {
      for (let j = 0; j < rows[i].length - 1; j++) this.quad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]);
    }
  }

  append(geo, matrix, finType = 0) {
    const g = geo.index ? geo : geo;
    const p = g.attributes.position;
    const base = this.pos.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.vertex(v.x, v.y, v.z, finType, 0);
    }
    const index = g.index ? g.index.array : [...Array(p.count).keys()];
    for (let i = 0; i < index.length; i++) this.idx.push(base + index[i]);
  }

  toGeometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('aFin', new THREE.Float32BufferAttribute(this.fin, 2));
    geo.setIndex(this.idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}

const NT = 28; // vertices around the body

/** Normalised heights of the two ring vertices on either side of the jaw cut (upper and lower lip). */
function lipLevels(e, cut) {
  let upper = Infinity, lower = -Infinity;
  for (let j = 0; j < NT; j++) {
    const sn = Math.sin((j / NT) * Math.PI * 2);
    const cy = Math.sign(sn) * Math.pow(Math.abs(sn), e);
    if (cy < cut) lower = Math.max(lower, cy);
    else upper = Math.min(upper, cy);
  }
  return { upper, lower };
}

/** Height of the closed mouth line at body parameter s (for species with a jaw). */
export function jawLipY(spec, P, s) {
  const { upper, lower } = lipLevels(P.e, spec.jaw.cut);
  const yt = P.top(s), yb = P.bot(s);
  return (yt + yb) / 2 + Math.max(0.002, (yt - yb) / 2) * (upper + lower) / 2;
}

function buildBody(spec, P, g) {
  const NS = 40;
  const e = P.e;
  const jaw = spec.jaw;
  const tip = g.vertex(0.502, P.mid(0), 0);
  const rings = [];
  for (let i = 1; i <= NS; i++) {
    const s = Math.pow(i / NS, 1.25);
    const x = P.X(s);
    const yt = P.top(s), yb = P.bot(s), w = Math.max(0.002, P.wid(s));
    const yc = (yt + yb) / 2, hh = Math.max(0.002, (yt - yb) / 2);
    const inJaw = jaw && s > jaw.from && s < jaw.hinge;
    const ring = [];
    for (let j = 0; j < NT; j++) {
      const th = (j / NT) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      const cy = Math.sign(sn) * Math.pow(Math.abs(sn), e);
      const cz = Math.sign(c) * Math.pow(Math.abs(c), e);
      // Lower-jaw vertices are tagged (aFin.y = 1 on the body); the shader swings them open.
      ring.push(g.vertex(x, yc + hh * cy, w * cz, 0, inJaw && cy < jaw.cut ? 1 : 0));
    }
    rings.push(ring);
  }
  const r0 = rings[0];
  for (let j = 0; j < NT; j++) g.tri(tip, r0[(j + 1) % NT], r0[j]);
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let j = 0; j < NT; j++) {
      const j2 = (j + 1) % NT;
      g.quad(a[j], a[j2], b[j2], b[j]);
    }
  }
  const last = rings[rings.length - 1];
  const cap = g.vertex(P.X(1) - 0.004, P.mid(1), 0);
  for (let j = 0; j < NT; j++) g.tri(cap, last[j], last[(j + 1) % NT]);
}

function buildEyes(spec, P, g) {
  const { s, y, r } = spec.eye;
  const x = P.X(s);
  const zs = P.surfaceZ(s, y);
  const sphere = new THREE.SphereGeometry(r, 14, 10);
  for (const side of [1, -1]) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, side * (zs - r * 0.3)),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 0.75),
    );
    g.append(sphere, m, 0);
  }
}

// A fin with `thick` is a solid wedge: two skins that are apart at the base (hidden in the body)
// and meet at the edge, so it grows out of the back instead of looking like a card stuck on.
const finSides = (thick) => (thick ? [1, -1] : [0]);

function buildMedianFin(spec, P, fin, g) {
  const N = 18, M = 6;
  const hf = pchip(fin.h);
  for (const side of finSides(fin.thick)) {
    const rows = [];
    for (let i = 0; i <= N; i++) {
      const c = i / N;
      const row = [];
      for (let j = 0; j <= M; j++) {
        const e = j / M;
        const [x, y] = medianFinPoint(spec, P, fin, c, e, hf);
        row.push(g.vertex(x, y, side * (fin.thick ?? 0) * Math.pow(1 - e, 1.6), 1, e));
      }
      rows.push(row);
    }
    g.gridQuads(rows);
  }
}

function buildTail(spec, P, g) {
  const N = 12, M = 18;
  const thick = spec.tail.thick;
  for (const side of finSides(thick)) {
    const rows = [];
    for (let i = 0; i <= N; i++) {
      const a = i / N;
      const row = [];
      for (let j = 0; j <= M; j++) {
        const tb = (j / M) * 2 - 1;
        const [x, y] = tailPoint(spec, P, a, tb);
        row.push(g.vertex(x, y, side * (thick ?? 0) * Math.pow(1 - a, 1.5), 1, Math.min(1, 0.15 + a)));
      }
      rows.push(row);
    }
    g.gridQuads(rows);
  }
}

// Pectoral fins sample a reserved corner of the texture (bottom right of the
// canvas, below the nose) so they do not pick up the body pattern.
export const PEC_UV = { u0: 0.87, u1: 0.99, v0: 0.01, v1: 0.11 };

function buildPectoral(spec, P, side, g) {
  const p = spec.pec;
  if (p.wing) return buildPectoralWing(spec, P, side, g);
  const N = 7, M = 5;
  const x0 = P.X(p.s);
  const zb = P.surfaceZ(p.s, p.y) * 0.92;
  const dirX = -Math.cos(p.out ?? 0.5), dirZ = side * Math.sin(p.out ?? 0.5);
  const rows = [];
  for (let i = 0; i <= N; i++) {
    const a = i / N;
    const w = p.width * (1 - 0.45 * a) * (a > 0.75 ? Math.sqrt(Math.max(0.05, 1 - ((a - 0.75) / 0.25) * 0.85)) : 1);
    const row = [];
    for (let j = 0; j <= M; j++) {
      const b = j / M;
      const x = x0 + a * p.len * dirX;
      const y = p.y + (b - 0.5) * w - a * p.len * (p.down ?? 0.2);
      const z = side * zb + a * p.len * dirZ;
      const u = PEC_UV.u0 + a * (PEC_UV.u1 - PEC_UV.u0);
      const v = PEC_UV.v0 + b * (PEC_UV.v1 - PEC_UV.v0);
      row.push(g.vertex(x, y, z, side > 0 ? 2 : 3, a, u, v));
    }
    rows.push(row);
  }
  g.gridQuads(rows);
}

/**
 * A shark's pectoral fin is a wing, not a paddle: the chord runs along the body, the span goes out
 * and a little down, and the tip is swept back into a sickle.
 */
function buildPectoralWing(spec, P, side, g) {
  const p = spec.pec;
  const N = 9, M = 5;
  const x0 = P.X(p.s);
  const zb = P.surfaceZ(p.s, p.y) * 0.9;
  const rows = [];
  for (let i = 0; i <= N; i++) {
    const a = i / N;
    const chord = p.chord * Math.pow(1 - a, 0.9) + 0.008;
    const lead = x0 - p.sweep * Math.pow(a, 1.6);
    const y = p.y - a * p.len * p.down;
    const z = side * (zb + a * p.len);
    const row = [];
    for (let j = 0; j <= M; j++) {
      const b = j / M;
      // A little camber: the middle of the chord is slightly higher than its edges.
      const yy = y + Math.sin(b * Math.PI) * chord * 0.08;
      const u = PEC_UV.u0 + a * (PEC_UV.u1 - PEC_UV.u0);
      const v = PEC_UV.v0 + b * (PEC_UV.v1 - PEC_UV.v0);
      row.push(g.vertex(lead - b * chord, yy, z, side > 0 ? 2 : 3, a, u, v));
    }
    rows.push(row);
  }
  g.gridQuads(rows);
}

export function buildFishGeometry(spec) {
  const P = makeProfile(spec);
  const body = new GeoBuilder();
  buildBody(spec, P, body);
  buildEyes(spec, P, body);
  const fins = new GeoBuilder();
  for (const fin of spec.fins) buildMedianFin(spec, P, fin, fins);
  buildTail(spec, P, fins);
  if (spec.pec) {
    buildPectoral(spec, P, 1, fins);
    buildPectoral(spec, P, -1, fins);
  }
  const jawHinge = spec.jaw ? [P.X(spec.jaw.hinge), jawLipY(spec, P, spec.jaw.hinge)] : [0, 0];
  return { body: body.toGeometry(), fins: fins.toGeometry(), profile: P, jawHinge };
}
