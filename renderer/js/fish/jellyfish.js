import * as THREE from 'three';
import { U } from '../shaders.js';
import { mulberry32, clamp, damp } from '../util.js';

const rnd = mulberry32(808);

const BELL_VERT = /* glsl */ `
  uniform float uPulse;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float rr = length(p.xz);
    float k = smoothstep(0.1, 1.0, rr);
    p.xz *= 1.0 - uPulse * 0.17 * k;
    p.y *= 1.0 + uPulse * 0.1;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vV = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;

const BELL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGonad;
  uniform float uGlow;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float ang = vUv.x * 6.2831853;
    float ring = smoothstep(0.18, 0.26, vUv.y) * (1.0 - smoothstep(0.36, 0.46, vUv.y));
    float lobes = smoothstep(0.35, 0.9, cos(ang * 4.0) * 0.5 + 0.5);
    float gonad = ring * lobes;
    float rim = smoothstep(0.86, 1.0, vUv.y);
    vec3 col = uColor * (0.12 + fres * 0.9 + rim * 0.5) + uGonad * gonad * 0.7;
    col *= 1.0 + uGlow * 0.9;
    float a = (0.06 + fres * 0.42 + gonad * 0.35 + rim * 0.22) * uOpacity;
    gl_FragColor = vec4(col, a);
  }`;

/** Moon jellyfish: pulsing translucent bells with trailing tentacles; glow at night. */
export class Jellies {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const r = Math.sin(t * Math.PI * 0.5) * 0.5;
      const y = Math.pow(Math.max(0, 1 - (r / 0.5) ** 2), 0.7) * 0.22;
      pts.push(new THREE.Vector2(Math.max(0.001, r), y));
    }
    pts.push(new THREE.Vector2(0.485, -0.02));
    this.bellGeo = new THREE.LatheGeometry(pts, 40);
    const arm = new THREE.PlaneGeometry(0.07, 1, 1, 16);
    arm.translate(0, -0.5, 0);
    this.armGeo = arm;
  }

  spawn(count = 4, durationMs = 90000) {
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const scale = 0.55 + rnd() * 0.75;
      const uniforms = {
        uPulse: { value: 0 },
        uColor: { value: new THREE.Color(0.75, 0.86, 1.0) },
        uGonad: { value: new THREE.Color(1.0, 0.55, 0.75) },
        uGlow: { value: 0 },
        uOpacity: { value: 0 },
      };
      const bellMat = new THREE.ShaderMaterial({
        uniforms, vertexShader: BELL_VERT, fragmentShader: BELL_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const group = new THREE.Group();
      const bell = new THREE.Mesh(this.bellGeo, bellMat);
      group.add(bell);
      const armMat = new THREE.MeshBasicMaterial({ color: 0xffc8e6, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const arms = [];
      for (let a = 0; a < 4; a++) {
        const m = new THREE.Mesh(this.armGeo, armMat);
        m.rotation.y = (a / 4) * Math.PI;
        m.position.y = 0.02;
        m.scale.set(1, 0.55 + rnd() * 0.3, 1);
        group.add(m);
        arms.push(m);
      }
      const nT = 70, seg = 7;
      const linePos = new Float32Array(nT * seg * 2 * 3);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
      const lineMat = new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const lines = new THREE.LineSegments(lineGeo, lineMat);
      lines.frustumCulled = false;
      this.scene.add(group, lines);
      group.scale.setScalar(scale);
      const fromBelow = rnd() < 0.6;
      const x = -9 + rnd() * 18;
      const pos = new THREE.Vector3(fromBelow ? x : (x < 0 ? -14 : 14), fromBelow ? 0.5 + rnd() * 1.5 : 3 + rnd() * 4, -4 + rnd() * 5);
      this.list.push({
        group, bell, arms, lines, uniforms, armMat, lineMat, scale, nT, seg,
        pos, vel: new THREE.Vector3(fromBelow ? 0 : (pos.x < 0 ? 0.35 : -0.35), 0.2, 0),
        lens: Float32Array.from({ length: nT }, () => 0.35 + rnd() * rnd() * 1.6),
        phase: rnd() * 6, period: 1.6 + rnd() * 0.9, born: now, until: now + durationMs * (0.8 + rnd() * 0.3),
        tilt: new THREE.Vector2(), fade: 0, seed: rnd() * 100,
      });
    }
  }

  get count() { return this.list.length; }

  update(dt, t, env) {
    const now = performance.now();
    this.list = this.list.filter((j) => {
      const leaving = now > j.until;
      j.fade = damp(j.fade, leaving ? 0 : 1, leaving ? 0.8 : 0.5, dt);
      if (leaving && j.fade < 0.02) {
        this.scene.remove(j.group, j.lines);
        j.bell.material.dispose();
        j.armMat.dispose();
        j.lineMat.dispose();
        j.lines.geometry.dispose();
        return false;
      }
      j.phase += (dt * Math.PI * 2) / j.period;
      const s = Math.sin(j.phase);
      const pulse = Math.pow(Math.max(0, s), 2.0);
      j.uniforms.uPulse.value = pulse;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(j.group.quaternion);
      j.vel.addScaledVector(up, pulse * 0.55 * dt);
      j.vel.y -= 0.05 * dt;
      j.vel.x += Math.sin(t * 0.2 + j.seed) * 0.02 * dt;
      j.vel.multiplyScalar(1 - 0.6 * dt);
      if (j.pos.y > 9) j.vel.y -= 0.3 * dt;
      if (j.pos.y < 1.5) j.vel.y += 0.3 * dt;
      if (!leaving) {
        if (j.pos.x > 10) j.vel.x -= 0.2 * dt;
        if (j.pos.x < -10) j.vel.x += 0.2 * dt;
      }
      j.pos.addScaledVector(j.vel, dt);
      j.tilt.x = damp(j.tilt.x, clamp(j.vel.z * 0.8, -0.35, 0.35), 1.5, dt);
      j.tilt.y = damp(j.tilt.y, clamp(-j.vel.x * 0.8, -0.35, 0.35), 1.5, dt);
      j.group.position.copy(j.pos);
      j.group.rotation.set(j.tilt.x, j.seed, j.tilt.y);
      const glow = env.night * 0.9 + 0.1;
      j.uniforms.uGlow.value = env.night * 0.8;
      j.uniforms.uOpacity.value = j.fade * (0.75 + 0.25 * glow);
      j.uniforms.uColor.value.setRGB(0.6 + 0.2 * glow, 0.8, 1.0).multiplyScalar(0.6 + env.day * 0.4);
      j.armMat.opacity = j.fade * 0.22 * (0.6 + glow * 0.6);
      j.lineMat.opacity = j.fade * 0.22 * (0.5 + glow);
      j.arms.forEach((a, k) => {
        a.rotation.z = Math.sin(t * 0.9 + k * 1.7 + j.seed) * 0.25;
        a.rotation.x = Math.sin(t * 0.7 + k) * 0.15 - j.vel.z * 0.6;
      });
      this.updateTentacles(j, t, pulse);
      return true;
    });
  }

  updateTentacles(j, t, pulse) {
    const arr = j.lines.geometry.attributes.position.array;
    const r = 0.48 * j.scale * (1 - pulse * 0.15);
    const q = j.group.quaternion;
    const v = new THREE.Vector3();
    let o = 0;
    for (let i = 0; i < j.nT; i++) {
      const a = (i / j.nT) * Math.PI * 2 + j.seed;
      const segLen = 0.045 * j.scale * j.lens[i];
      v.set(Math.cos(a) * r, -0.015 * j.scale, Math.sin(a) * r).applyQuaternion(q).add(j.pos);
      let px = v.x, py = v.y, pz = v.z;
      // Tentacles fan slightly outwards and curl with the water.
      const outX = Math.cos(a) * 0.012 * j.scale, outZ = Math.sin(a) * 0.012 * j.scale;
      for (let k = 1; k <= j.seg; k++) {
        const w = Math.sin(t * 1.6 - k * 0.7 + i * 1.37) * 0.02 * k * j.scale;
        const nx = px + outX + w * Math.sin(a) - j.vel.x * 0.04 * k;
        const ny = py - segLen * (1 - pulse * 0.3);
        const nz = pz + outZ - w * Math.cos(a) - j.vel.z * 0.04 * k;
        arr[o++] = px; arr[o++] = py; arr[o++] = pz;
        arr[o++] = nx; arr[o++] = ny; arr[o++] = nz;
        px = nx; py = ny; pz = nz;
      }
    }
    j.lines.geometry.attributes.position.needsUpdate = true;
  }
}
