import * as THREE from 'three';
import { U } from '../shaders.js';
import { smoothstep } from '../util.js';

// Look of the tank over a day. tod: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
// Night uses the "actinic" deep-blue lighting of real reef tanks, so fish stay visible.
const KEYS = [
  { tod: 0.0, sun: 0.0, moon: 0.8, sunColor: '#8fa8ff', sky: '#2f63b8', ground: '#13203c', hemi: 0.72, fog: '#082a4d', density: 0.03, top: '#12407a', bottom: '#020c1c', caustic: 0.1, rays: 0.06, fluoro: 1.0 },
  { tod: 0.2, sun: 0.0, moon: 0.7, sunColor: '#8fa8ff', sky: '#2f63b8', ground: '#13203c', hemi: 0.7, fog: '#0a2f52', density: 0.03, top: '#14467e', bottom: '#030e20', caustic: 0.1, rays: 0.06, fluoro: 0.95 },
  { tod: 0.27, sun: 0.9, moon: 0.15, sunColor: '#ffb888', sky: '#5d93c4', ground: '#6b5a4c', hemi: 0.75, fog: '#16617f', density: 0.027, top: '#3a86ad', bottom: '#072a40', caustic: 0.45, rays: 0.4, fluoro: 0.35 },
  { tod: 0.36, sun: 2.0, moon: 0.0, sunColor: '#ffe9c9', sky: '#8ccdf0', ground: '#b8a57f', hemi: 1.0, fog: '#1b7a9c', density: 0.024, top: '#3aa6cf', bottom: '#08364f', caustic: 0.85, rays: 0.6, fluoro: 0.05 },
  { tod: 0.5, sun: 2.5, moon: 0.0, sunColor: '#fff7e3', sky: '#9fdcff', ground: '#d8c39a', hemi: 1.15, fog: '#2089ab', density: 0.022, top: '#44b6dc', bottom: '#0a3d57', caustic: 1.0, rays: 0.7, fluoro: 0.0 },
  { tod: 0.64, sun: 2.0, moon: 0.0, sunColor: '#ffe9c9', sky: '#8ccdf0', ground: '#b8a57f', hemi: 1.0, fog: '#1b7a9c', density: 0.024, top: '#3aa6cf', bottom: '#08364f', caustic: 0.85, rays: 0.6, fluoro: 0.05 },
  { tod: 0.73, sun: 0.9, moon: 0.1, sunColor: '#ffa36b', sky: '#6c8fbe', ground: '#6e5446', hemi: 0.75, fog: '#1a5f7c', density: 0.027, top: '#4a86a8', bottom: '#082a40', caustic: 0.45, rays: 0.42, fluoro: 0.35 },
  { tod: 0.8, sun: 0.0, moon: 0.7, sunColor: '#8fa8ff', sky: '#2f63b8', ground: '#13203c', hemi: 0.7, fog: '#0a2f52', density: 0.03, top: '#14467e', bottom: '#030e20', caustic: 0.1, rays: 0.06, fluoro: 0.95 },
  { tod: 1.0, sun: 0.0, moon: 0.8, sunColor: '#8fa8ff', sky: '#2f63b8', ground: '#13203c', hemi: 0.72, fog: '#082a4d', density: 0.03, top: '#12407a', bottom: '#020c1c', caustic: 0.1, rays: 0.06, fluoro: 1.0 },
].map((k) => {
  const out = { ...k };
  for (const f of ['sunColor', 'sky', 'ground', 'fog', 'top', 'bottom']) out[f] = new THREE.Color(k[f]);
  return out;
});

const COLOR_FIELDS = ['sunColor', 'sky', 'ground', 'fog', 'top', 'bottom'];
const NUM_FIELDS = ['sun', 'moon', 'hemi', 'density', 'caustic', 'rays', 'fluoro'];

export function paletteAt(tod) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].tod <= tod) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smoothstep(0, 1, (tod - a.tod) / (b.tod - a.tod));
  const p = {};
  for (const f of NUM_FIELDS) p[f] = a[f] + (b[f] - a[f]) * t;
  for (const f of COLOR_FIELDS) p[f] = a[f].clone().lerp(b[f], t);
  return p;
}

export class Environment {
  constructor(scene, { quality }) {
    this.scene = scene;
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.position.set(5, 30, 7);
    this.sun.target.position.set(0, 0, -1);
    if (quality !== 'low') {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
      const c = this.sun.shadow.camera;
      c.left = -16; c.right = 16; c.top = 12; c.bottom = -12; c.near = 5; c.far = 60;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.03;
      this.sun.shadow.radius = 4;
    }
    this.moon = new THREE.DirectionalLight(0x8fa8ff, 0.4);
    this.moon.position.set(-8, 30, 10);
    this.hemi = new THREE.HemisphereLight(0x9fdcff, 0xd8c39a, 1);
    scene.add(this.sun, this.sun.target, this.moon, this.hemi);

    scene.fog = new THREE.FogExp2(0x2089ab, 0.022);

    // Background: gradient dome, brighter towards the surface.
    this.skyUniforms = {
      uTop: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uGlow: { value: 1 },
      uTime: U.uTime,
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(300, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uBottom, uFog;
          uniform float uGlow, uTime;
          varying vec3 vDir;
          void main() {
            float y = vDir.y;
            vec3 col = mix(uBottom, uFog, smoothstep(-0.35, 0.0, y));
            col = mix(col, uTop, smoothstep(0.0, 0.55, y));
            float glow = pow(max(y, 0.0), 3.0) * uGlow;
            float shimmer = 0.85 + 0.15 * sin(vDir.x * 40.0 + uTime * 0.8) * sin(vDir.z * 33.0 - uTime * 0.6);
            col += uTop * glow * 0.6 * shimmer;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    dome.renderOrder = -10;
    scene.add(dome);
    this.dome = dome;
    this.palette = paletteAt(0.5);
    this.night = 0;
  }

  update(tod) {
    const p = paletteAt(tod);
    this.palette = p;
    this.sun.intensity = p.sun;
    this.sun.color.copy(p.sunColor);
    this.moon.intensity = p.moon;
    this.hemi.color.copy(p.sky);
    this.hemi.groundColor.copy(p.ground);
    this.hemi.intensity = p.hemi;
    this.scene.fog.color.copy(p.fog);
    this.scene.fog.density = p.density;
    this.skyUniforms.uTop.value.copy(p.top);
    this.skyUniforms.uBottom.value.copy(p.bottom);
    this.skyUniforms.uFog.value.copy(p.fog);
    this.skyUniforms.uGlow.value = 0.4 + p.caustic * 0.8;
    U.uCaustic.value = p.caustic;
    U.uFluoro.value = p.fluoro;
    U.uCausticColor.value.copy(p.sunColor).lerp(new THREE.Color(1, 1, 1), 0.5);
    U.uDay.value = Math.min(1, p.sun / 2.5);
    this.night = 1 - smoothstep(0.1, 1.2, p.sun);
    return p;
  }
}
