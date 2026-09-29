import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise, mulberry32, clamp } from '../util.js';
import { withCaustics, withSway, withFluorescence, canvasTexture } from '../shaders.js';
import { sandHeight } from './terrain.js';

const noise = makeNoise(21);

/**
 * Living decoration: sea grass, kelp, the clownfish anemone, branching and
 * brain corals, sea fans, glowing zoanthid polyps. Everything sways.
 */
export class Reef {
  constructor(scene, terrain, { quality }) {
    this.scene = scene;
    this.terrain = terrain;
    this.rnd = mulberry32(5);
    this.quality = quality;
    this.anchors = {};
    this.buildSeagrass();
    this.buildKelp();
    this.buildAnemone(new THREE.Vector3(-5.2, 0, 0.2));
    this.buildCorals();
    this.buildSeaFans();
    this.buildPolyps();
  }

  sandY(x, z) { return sandHeight(x, z); }

  // ---- sea grass: thousands of instanced blades ------------------------------
  buildSeagrass() {
    const blade = new THREE.PlaneGeometry(0.07, 1, 1, 7);
    blade.translate(0, 0.5, 0);
    const p = blade.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) * (1 - y * 0.75));
    }
    blade.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide });
    withSway(mat, { amp: 0.32, speed: 0.85, stiffness: 1.8 });
    withCaustics(mat, 0.5);
    const patches = [
      [-12.5, -5.5, 3.2, 1.0], [-3.8, -9.5, 4.5, 1.0], [4.5, -10.2, 4.2, 1.0], [12.4, -6.8, 3.0, 1.0],
      [-11.5, 1.2, 1.8, 0.7], [11.8, 1.6, 1.8, 0.7], [-0.5, -4.6, 1.7, 0.6], [6.0, 3.4, 1.3, 0.5],
      [-7.0, 3.6, 1.2, 0.5], [0.0, -14.0, 9.0, 1.2],
    ];
    const count = this.quality === 'low' ? 1400 : 3200;
    const mesh = new THREE.InstancedMesh(blade, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const greens = ['#3f8f3a', '#5aa845', '#2f7a42', '#77b851', '#4c9a5e', '#8cbf4a'].map((h) => new THREE.Color(h));
    const c = new THREE.Color();
    // Where the grass grows; by day these patches release tiny oxygen bubbles.
    this.grassSpots = patches.filter(([, z]) => z > -11).map(([x, z, r]) => ({ x, z, r }));
    const total = patches.reduce((a, pt) => a + pt[2] * pt[2] * pt[3], 0);
    let i = 0;
    for (const [px, pz, r, dens] of patches) {
      const n = Math.round((count * r * r * dens) / total);
      for (let k = 0; k < n && i < count; k++, i++) {
        const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * r;
        const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d * 0.7;
        v.set(x, this.sandY(x, z) - 0.05, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * Math.PI);
        const h = (0.9 + this.rnd() * 1.9) * (1.15 - d / r * 0.5);
        s.set(0.8 + this.rnd() * 0.8, h, 1);
        m.compose(v, q, s);
        mesh.setMatrixAt(i, m);
        c.copy(greens[Math.floor(this.rnd() * greens.length)]).multiplyScalar(0.75 + this.rnd() * 0.45);
        mesh.setColorAt(i, c);
      }
    }
    mesh.count = i;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ---- tall ribbon grass (Vallisneria-like) in the back corners -------------------
  buildKelp() {
    const ribbon = new THREE.PlaneGeometry(0.16, 1, 1, 28);
    ribbon.translate(0, 0.5, 0);
    const p = ribbon.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const baseC = new THREE.Color('#2f5f2a'), tipC = new THREE.Color('#9fbf55');
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), x = p.getX(i);
      const twist = y * 2.6;
      const w = x * (1 - Math.pow(y, 6));
      p.setX(i, Math.cos(twist) * w);
      p.setZ(i, Math.sin(twist) * w);
      c.copy(baseC).lerp(tipC, Math.pow(y, 0.8));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    ribbon.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    ribbon.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55 });
    withSway(mat, { amp: 0.16, speed: 0.55, stiffness: 1.5 });
    withCaustics(mat, 0.45);
    const clusters = [[-12.4, -6.8, 1.8, 34], [-10.6, -8.6, 1.4, 22], [12.2, -6.4, 1.7, 30], [10.4, -8.9, 1.3, 20],
      [-7.6, -9.4, 1.1, 14], [6.8, -10.1, 1.1, 14]];
    const total = clusters.reduce((a, cl) => a + cl[3], 0);
    const mesh = new THREE.InstancedMesh(ribbon, mat, total);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const tint = new THREE.Color();
    let i = 0;
    for (const [x, z, r, n] of clusters) {
      for (let k = 0; k < n; k++, i++) {
        const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * r;
        const xx = x + Math.cos(a) * d, zz = z + Math.sin(a) * d * 0.6;
        v.set(xx, this.sandY(xx, zz) - 0.1, zz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * Math.PI);
        s.set(0.8 + this.rnd() * 0.7, 4 + this.rnd() * 5.5, 1);
        m.compose(v, q, s);
        mesh.setMatrixAt(i, m);
        tint.setHSL(0.22 + this.rnd() * 0.08, 0.35 + this.rnd() * 0.3, 0.75 + this.rnd() * 0.35);
        mesh.setColorAt(i, tint);
      }
    }
    mesh.castShadow = this.quality === 'high';
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  // ---- anemone (home of the clownfish) ----------------------------------------
  buildAnemone(at) {
    at.y = this.sandY(at.x, at.z) - 0.05;
    const group = new THREE.Group();
    group.position.copy(at);
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.7, 0.45, 24, 1, true),
      withCaustics(new THREE.MeshStandardMaterial({ color: '#b0566a', roughness: 0.6, side: THREE.DoubleSide }), 0.6),
    );
    column.position.y = 0.2;
    group.add(column);
    // Tentacle: tapered tube with a bulb tip ("bubble-tip anemone").
    const tube = new THREE.CylinderGeometry(0.022, 0.04, 1, 6, 8, true);
    tube.translate(0, 0.5, 0);
    const bulb = new THREE.SphereGeometry(0.045, 8, 6);
    bulb.translate(0, 0.98, 0);
    const tent = mergeGeometries([tube, bulb]);
    const tp = tent.attributes.position;
    const tipColor = new Float32Array(tp.count * 3);
    const baseC = new THREE.Color('#c98fae'), tipC = new THREE.Color('#e9b8d2');
    const cc = new THREE.Color();
    for (let i = 0; i < tp.count; i++) {
      cc.copy(baseC).lerp(tipC, clamp((tp.getY(i) - 0.3) / 0.7, 0, 1));
      if (tp.getY(i) > 0.93) cc.set('#a6e8c4');
      tipColor.set([cc.r, cc.g, cc.b], i * 3);
    }
    tent.setAttribute('color', new THREE.BufferAttribute(tipColor, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
    withSway(mat, { amp: 0.35, speed: 1.4, stiffness: 1.6 });
    withCaustics(mat, 0.6);
    withFluorescence(mat, '#3dff9a', 0.5, 'smoothstep(0.35, 0.9, vUwPos.y - ' + (at.y + 0.2).toFixed(2) + ')');
    const count = 260;
    const mesh = new THREE.InstancedMesh(tent, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const ring = Math.sqrt(i / count);
      const a = i * 2.399963;
      const r = 0.05 + ring * 0.62;
      v.set(at.x + Math.cos(a) * r, at.y + 0.42, at.z + Math.sin(a) * r);
      const tilt = 0.15 + ring * 0.9;
      e.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt, 'XYZ');
      q.setFromEuler(e);
      const len = 0.7 + this.rnd() * 0.45 - ring * 0.15;
      s.set(1, len, 1);
      m.compose(v, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.frustumCulled = false;
    mesh.castShadow = this.quality !== 'low';
    this.scene.add(group, mesh);
    this.anchors.anemone = at.clone().add(new THREE.Vector3(0, 0.9, 0));
  }

  // ---- corals ------------------------------------------------------------------
  buildCorals() {
    const obstacles = this.terrain.obstacles;
    const branchMatA = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
    withCaustics(branchMatA, 0.8);
    withFluorescence(branchMatA, '#4fd8ff', 0.8, 'smoothstep(0.55, 1.0, vColor.b)');
    const brainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    withCaustics(brainMat, 0.9);
    withFluorescence(brainMat, '#9dff5a', 0.45, 'vColor.g');

    const tops = this.terrain.rockTops;
    const branchPalettes = [['#6e4fc4', '#9fd6ff'], ['#c9577a', '#ffd0e0'], ['#4f9f6a', '#d6ff8a'], ['#d08a3a', '#ffe6a0']];
    tops.forEach((top, k) => {
      if (k % 2 === 1 && k !== 3) return;
      const pal = branchPalettes[k % branchPalettes.length];
      const coral = this.branchingCoral(mulberry32(100 + k), pal[0], pal[1]);
      coral.scale.setScalar(0.8 + (k % 3) * 0.2);
      coral.position.copy(top).add(new THREE.Vector3(0, -0.25, 0));
      coral.material = branchMatA;
      coral.castShadow = this.quality !== 'low';
      this.scene.add(coral);
    });
    this.anchors.coral = tops[1] ? tops[1].clone().add(new THREE.Vector3(0, 1.0, 1.0)) : new THREE.Vector3(7, 4, -1);

    const brainSpots = [[-2.8, -3.2, 0.8], [3.4, -4.0, 1.0], [5.2, -1.2, 0.6]];
    for (const [x, z, r] of brainSpots) {
      const b = this.brainCoral(r);
      b.material = brainMat;
      b.position.set(x, this.sandY(x, z) + r * 0.25, z);
      b.castShadow = this.quality !== 'low';
      b.receiveShadow = true;
      this.scene.add(b);
      obstacles.push({ center: b.position.clone(), radius: r * 1.1, size: [r, r * 0.7, r] });
    }
    // Vase sponges.
    const spongeMat = withCaustics(new THREE.MeshStandardMaterial({ color: '#e0822f', roughness: 0.85, side: THREE.DoubleSide }), 0.7);
    const profile = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      profile.push(new THREE.Vector2(0.18 + Math.pow(t, 1.6) * 0.42 + Math.sin(t * 9) * 0.015, t * 1.6));
    }
    const vase = new THREE.LatheGeometry(profile, 20);
    for (const [x, z, s, color] of [[-1.2, -9.4, 1.0, '#e0822f'], [2.9, -8.8, 0.8, '#d9b23a'], [-5.0, -6.2, 0.7, '#c9502f']]) {
      const mesh = new THREE.Mesh(vase, color === '#e0822f' ? spongeMat : withCaustics(new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }), 0.7));
      mesh.position.set(x, this.sandY(x, z) - 0.1, z);
      mesh.scale.setScalar(s);
      mesh.castShadow = this.quality !== 'low';
      this.scene.add(mesh);
    }
  }

  branchingCoral(rnd, baseHex, tipHex) {
    const parts = [];
    const base = new THREE.Color(baseHex), tip = new THREE.Color(tipHex);
    const up = new THREE.Vector3(0, 1, 0);
    const grow = (origin, dir, len, radius, depth) => {
      const geo = new THREE.CylinderGeometry(radius * 0.7, radius, len, 6, 1);
      geo.translate(0, len / 2, 0);
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
      geo.translate(origin.x, origin.y, origin.z);
      const colors = new Float32Array(geo.attributes.position.count * 3);
      const t = clamp(depth / 4, 0, 1);
      const c = base.clone().lerp(tip, t * t);
      for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(geo);
      const end = origin.clone().addScaledVector(dir, len);
      if (depth >= 4) {
        const cap = new THREE.SphereGeometry(radius * 0.75, 6, 4);
        cap.translate(end.x, end.y, end.z);
        const cc = new Float32Array(cap.attributes.position.count * 3);
        for (let i = 0; i < cc.length; i += 3) cc.set([tip.r, tip.g, tip.b], i);
        cap.setAttribute('color', new THREE.BufferAttribute(cc, 3));
        parts.push(cap);
        return;
      }
      const n = depth === 0 ? 4 : 2 + (rnd() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const nd = dir.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.2, rnd() * 0.5 + 0.2, (rnd() - 0.5) * 1.2)).normalize();
        grow(end, nd, len * (0.7 + rnd() * 0.2), radius * 0.72, depth + 1);
      }
    };
    grow(new THREE.Vector3(0, 0, 0), up.clone(), 0.55, 0.13, 0);
    const geo = mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo);
  }

  brainCoral(r) {
    const geo = new THREE.SphereGeometry(r, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const p = geo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const ridgeC = new THREE.Color('#b8c774'), valleyC = new THREE.Color('#5a7a3a');
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const n = noise.fbm3(v.x * 3, v.y * 3, v.z * 3, 2);
      const ridge = Math.abs(Math.sin((v.x * 7 + v.z * 5 + n * 9) * 2.2));
      const k = 1 + (ridge - 0.5) * 0.06;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
      c.copy(valleyC).lerp(ridgeC, ridge);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo);
  }

  // ---- sea fans: flat branching gorgonians ------------------------------------
  buildSeaFans() {
    const tex = canvasTexture(512, (ctx, s) => {
      const rnd = mulberry32(77);
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      const branch = (x, y, a, len, w, d) => {
        const x2 = x + Math.cos(a) * len, y2 = y - Math.sin(a) * len;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (d > 7) return;
        branch(x2, y2, a + 0.25 + rnd() * 0.35, len * 0.8, w * 0.75, d + 1);
        branch(x2, y2, a - 0.25 - rnd() * 0.35, len * 0.8, w * 0.75, d + 1);
      };
      branch(s / 2, s, Math.PI / 2, s * 0.2, 14, 0);
      // fine mesh between branches
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1;
      for (let i = 0; i < 260; i++) {
        const x = s * (0.1 + rnd() * 0.8), y = s * (0.05 + rnd() * 0.75);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 40);
        ctx.stroke();
      }
    });
    const geo = new THREE.PlaneGeometry(2.6, 2.6, 8, 8);
    geo.translate(0, 1.3, 0);
    for (const [x, z, color, rot, sc] of [[-6.6, -5.4, '#c2408f', 0.3, 1.1], [7.4, -5.6, '#e0703a', -0.4, 1.0], [2.4, -7.6, '#9a4fd0', 0.1, 1.2]]) {
      const mat = new THREE.MeshStandardMaterial({ map: tex, color, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7 });
      withSway(mat, { amp: 0.06, speed: 0.6, stiffness: 1.5 });
      withCaustics(mat, 0.5);
      withFluorescence(mat, color, 0.35);
      const fan = new THREE.Mesh(geo, mat);
      fan.position.set(x, this.sandY(x, z) - 0.1, z);
      fan.rotation.y = rot;
      fan.scale.setScalar(sc);
      fan.castShadow = this.quality === 'high';
      this.scene.add(fan);
    }
  }

  // ---- zoanthid polyps: tiny discs that glow at night ------------------------
  buildPolyps() {
    const geo = new THREE.CylinderGeometry(0.045, 0.035, 0.04, 10);
    geo.translate(0, 0.02, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
    withFluorescence(mat, '#ffffff', 0.9, 'vColor.rgb');
    withCaustics(mat, 0.5);
    const count = this.quality === 'low' ? 120 : 260;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const palette = ['#ff8a3d', '#6dff9c', '#ff5fa2', '#5fd6ff', '#fff06a'].map((h) => new THREE.Color(h));
    const c = new THREE.Color();
    const rocks = this.terrain.obstacles.filter((o) => o.rock && o.size[0] > 1);
    for (const o of rocks) o.rock.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    let i = 0;
    let guard = 0;
    while (i < count && guard++ < count * 8) {
      const o = rocks[Math.floor(this.rnd() * rocks.length)];
      const dir = new THREE.Vector3(this.rnd() - 0.5, 0.35 + this.rnd() * 0.8, this.rnd() * 0.8 + 0.1).normalize();
      const from = o.center.clone().addScaledVector(dir, 6);
      raycaster.set(from, dir.clone().negate());
      const hit = raycaster.intersectObject(o.rock, false)[0];
      if (!hit) continue;
      const cluster = palette[Math.floor(this.rnd() * palette.length)];
      for (let k = 0; k < 6 && i < count; k++, i++) {
        const n = hit.face.normal.clone().transformDirection(o.rock.matrixWorld);
        v.copy(hit.point).add(new THREE.Vector3((this.rnd() - 0.5) * 0.35, (this.rnd() - 0.5) * 0.2, (this.rnd() - 0.5) * 0.35));
        q.setFromUnitVectors(up, n);
        s.setScalar(0.7 + this.rnd() * 0.6);
        m.compose(v, q, s);
        mesh.setMatrixAt(i, m);
        c.copy(cluster).lerp(new THREE.Color('#8a6f63'), 0.35).multiplyScalar(0.8 + this.rnd() * 0.3);
        mesh.setColorAt(i, c);
      }
    }
    mesh.count = i;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }
}
