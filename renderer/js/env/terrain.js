import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise, mulberry32, clamp, smoothstep } from '../util.js';
import { withCaustics, canvasTexture } from '../shaders.js';

const noise = makeNoise(7);

/** Height of the sand at (x, z). Rises towards the back so the far bottom is visible. */
export function sandHeight(x, z) {
  const dunes = noise.fbm2(x * 0.045, z * 0.06, 3) * 0.9;
  const back = Math.max(0, -z - 4) * 0.075 + Math.max(0, -z - 16) * 0.12;
  const ripple = Math.sin(x * 2.1 + noise.noise2(x * 0.25, z * 0.25) * 3.5 + z * 0.4) * 0.035;
  const sides = Math.max(0, Math.abs(x) - 13) * 0.12;
  return 0.25 + dunes + back + ripple + sides;
}

// Rock clusters of the aquascape; the middle stays open for swimming and feeding.
const ROCKS = [
  // left reef
  [-9.2, -2.6, 2.6, 1.9, 2.1], [-7.2, -3.4, 2.0, 2.6, 1.8], [-8.4, -1.0, 1.5, 1.1, 1.4], [-10.6, -4.2, 2.3, 3.2, 2.0],
  [-6.2, -1.6, 1.1, 0.8, 1.0], [-8.1, -4.3, 1.8, 1.4, 1.6],
  // right reef
  [8.3, -3.0, 2.4, 2.3, 2.0], [10.2, -1.8, 1.7, 1.3, 1.6], [6.6, -2.2, 1.3, 1.0, 1.2], [9.4, -4.6, 2.2, 3.3, 1.9],
  // back centre
  [-1.6, -6.4, 2.6, 1.5, 1.8], [1.8, -6.9, 2.2, 1.9, 1.6], [0.2, -8.2, 3.2, 2.6, 2.0],
  // pebbles in front
  [-3.6, 2.2, 0.45, 0.3, 0.42], [3.2, 2.8, 0.35, 0.25, 0.4], [4.8, 0.8, 0.55, 0.38, 0.5], [-4.6, 0.4, 0.4, 0.32, 0.38],
];

export class Terrain {
  constructor(scene, { quality }) {
    this.scene = scene;
    this.obstacles = [];
    this.rockTops = [];
    this.buildSand(quality);
    this.buildRocks(quality);
  }

  heightAt(x, z) { return sandHeight(x, z); }

  buildSand(quality) {
    const seg = quality === 'low' ? 120 : 220;
    const geo = new THREE.PlaneGeometry(110, 70, seg, Math.round(seg * 0.64));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -20);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color('#dccaa3');
    const dark = new THREE.Color('#a8926b');
    const light = new THREE.Color('#f1e6c8');
    const pink = new THREE.Color('#d6b4a4');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, sandHeight(x, z));
      const n1 = noise.fbm2(x * 0.18 + 9, z * 0.18, 3);
      const n2 = noise.noise2(x * 1.1, z * 1.1);
      c.copy(base).lerp(dark, clamp(0.45 - n1 * 1.6, 0, 0.7)).lerp(light, clamp(n1 * 1.4, 0, 0.5));
      c.lerp(pink, clamp(noise.noise2(x * 0.07 + 40, z * 0.07) * 1.5, 0, 0.35));
      c.multiplyScalar(0.92 + n2 * 0.08);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // Fine grain as a bump map (tileable speckle).
    const grain = canvasTexture(256, (ctx, s) => {
      const img = ctx.createImageData(s, s);
      const rnd = mulberry32(3);
      for (let i = 0; i < s * s; i++) {
        const v = 110 + rnd() * 110 + (rnd() < 0.04 ? 35 : 0);
        img.data.set([v, v, v, 255], i * 4);
      }
      ctx.putImageData(img, 0, 0);
    }, { srgb: false, repeat: 60 });

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, bumpMap: grain, bumpScale: 0.6 });
    withCaustics(mat, 1.35);
    const sand = new THREE.Mesh(geo, mat);
    sand.receiveShadow = true;
    this.scene.add(sand);
    this.sand = sand;
  }

  buildRocks(quality) {
    const detail = quality === 'low' ? 3 : 4;
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    withCaustics(rockMat, 1.0);
    const bases = ['#7b6f62', '#8a7d6b', '#6a6159', '#80776d'].map((h) => new THREE.Color(h));
    const deep = new THREE.Color('#3b332d');
    const coralline = new THREE.Color('#b47d9b');
    const coralline2 = new THREE.Color('#9a7aa8');
    const algae = new THREE.Color('#6e7d45');
    const c = new THREE.Color();
    ROCKS.forEach(([x, z, sx, sy, sz], k) => {
      // Icosahedron geometry is non-indexed; weld it so normals come out smooth.
      const raw = new THREE.IcosahedronGeometry(1, detail);
      raw.deleteAttribute('normal');
      raw.deleteAttribute('uv');
      const geo = mergeVertices(raw);
      const pos = geo.attributes.position;
      const base = bases[k % bases.length];
      const seed = k * 13.7;
      const disp = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
        const n = noise.fbm3(vx * 1.25 + seed, vy * 1.25, vz * 1.25 - seed, 5);
        const ridge = Math.abs(noise.noise3(vx * 3.2 + seed, vy * 3.2, vz * 3.2)) * 0.12;
        const r = 1 + n * 0.55 - ridge;
        disp[i] = n;
        let ny = vy * r;
        if (ny < -0.25) ny = -0.25 - (-0.25 - ny) * 0.25;
        pos.setXYZ(i, vx * r, ny, vz * r);
      }
      geo.scale(sx, sy, sz);
      geo.computeVertexNormals();
      const nrm = geo.attributes.normal;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
        const up = nrm.getY(i);
        const patch = noise.fbm3(vx * 0.9 + 50 + seed, vy * 0.9, vz * 0.9, 3);
        c.copy(base).lerp(deep, clamp(0.3 - disp[i] * 2.0, 0, 0.75));
        c.lerp(patch > 0.14 ? coralline : coralline2, smoothstep(0.06, 0.2, Math.abs(patch)) * 0.7);
        c.lerp(algae, smoothstep(0.5, 0.9, up) * smoothstep(0.0, 0.3, noise.noise3(vx * 2 + seed, vy * 2, vz * 2)) * 0.75);
        c.multiplyScalar(0.8 + noise.noise3(vx * 7, vy * 7, vz * 7 + seed) * 0.3);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(geo, rockMat);
      const y = sandHeight(x, z) + sy * 0.45 - 0.15;
      mesh.position.set(x, y, z);
      mesh.rotation.y = k * 1.37;
      mesh.castShadow = quality !== 'low';
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      const r = Math.max(sx, sy, sz) * 0.95;
      this.obstacles.push({ center: new THREE.Vector3(x, y, z), radius: r, rock: mesh, size: [sx, sy, sz] });
      if (sx > 1) this.rockTops.push(new THREE.Vector3(x, y + sy * 0.9, z));
    });
  }
}
