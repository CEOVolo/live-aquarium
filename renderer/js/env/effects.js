import * as THREE from 'three';
import { U, CAUSTICS_GLSL } from '../shaders.js';
import { mulberry32 } from '../util.js';

/** Shafts of sunlight coming down through the surface. */
export class GodRays {
  constructor(scene, { quality }) {
    const rnd = mulberry32(11);
    this.rays = [];
    this.intensity = { value: 0.7 };
    this.color = { value: new THREE.Color(1, 0.97, 0.88) };
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, -0.5, 0);
    const count = quality === 'low' ? 7 : 13;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uIntensity: this.intensity, uColor: this.color, uSeed: { value: rnd() } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vDepth = -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uIntensity, uSeed;
          uniform vec3 uColor;
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            float across = abs(vUv.x - 0.5) * 2.0;
            float edge = pow(1.0 - smoothstep(0.0, 1.0, across), 1.7);
            float along = vUv.y;
            float fall = smoothstep(0.0, 0.8, along) * mix(0.3, 1.0, along);
            float flick = 0.55 + 0.45 * sin(uTime * 0.55 + uSeed * 17.0) * sin(uTime * 0.31 + uSeed * 5.0 + vUv.x * 2.0);
            float streak = 0.7 + 0.3 * sin(vUv.x * 21.0 + uSeed * 9.0 + uTime * 0.15);
            float fade = exp(-vDepth * 0.018);
            float a = edge * fall * flick * streak * uIntensity * 0.13 * fade;
            gl_FragColor = vec4(uColor, a);
          }`,
      });
      const ray = new THREE.Mesh(geo, mat);
      const x = -13 + (26 * (i + rnd() * 0.8)) / count;
      const z = -9 + rnd() * 10;
      ray.position.set(x, 11.4, z);
      ray.scale.set(0.8 + rnd() * 2.4, 13 + rnd() * 5, 1);
      ray.rotation.set(-0.08, (rnd() - 0.5) * 0.4, 0.2 + (rnd() - 0.5) * 0.12);
      ray.renderOrder = 5;
      ray.userData = { x, drift: 0.3 + rnd() * 0.9, phase: rnd() * 10 };
      scene.add(ray);
      this.rays.push(ray);
    }
  }

  update(t, palette) {
    this.intensity.value = palette.rays;
    this.color.value.copy(palette.sunColor).lerp(new THREE.Color(0.75, 0.9, 1.0), 0.35);
    for (const r of this.rays) r.position.x = r.userData.x + Math.sin(t * 0.04 + r.userData.phase) * r.userData.drift;
  }
}

/** The water surface seen from below: a rippling, shimmering ceiling. */
export class Surface {
  constructor(scene) {
    this.uniforms = {
      uTime: U.uTime, uCaustic: U.uCaustic, uCausticColor: U.uCausticColor, uSunDir: U.uSunDir, uSurfaceY: U.uSurfaceY,
      uDeep: { value: new THREE.Color() },
      uBright: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.02 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${CAUSTICS_GLSL}
        uniform vec3 uDeep, uBright, uFogColor;
        uniform float uFogDensity;
        varying vec3 vW;
        void main() {
          vec3 V = normalize(vW - cameraPosition);
          float cosT = clamp(V.y, 0.0, 1.0);
          float t = uTime * 0.7;
          vec2 p = vW.xz * 0.42;
          float e1 = uwCellEdge(p + vec2(t * 0.08, t * 0.05), t);
          float e2 = uwCellEdge(p * 1.7 + vec2(-t * 0.06, t * 0.07) + 3.1, t * 1.3);
          float lines = (1.0 - smoothstep(0.0, 0.3, e1)) * 0.45 + (1.0 - smoothstep(0.0, 0.22, e2)) * 0.3;
          float swell = 0.5 + 0.5 * sin(vW.x * 0.35 + uTime * 0.3) * sin(vW.z * 0.42 - uTime * 0.25);
          float window = smoothstep(0.5, 0.9, cosT);
          vec3 col = mix(uDeep, uBright, window * 0.7 + 0.1 + swell * 0.08);
          col += uBright * lines * lines * (0.3 + 0.5 * window) * uCaustic;
          float d = length(vW - cameraPosition);
          float fogF = 1.0 - exp(-uFogDensity * uFogDensity * d * d * 0.55);
          col = mix(col, uFogColor, fogF);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(160, 110), mat);
    plane.rotation.x = Math.PI / 2;
    plane.position.set(0, U.uSurfaceY.value + 0.3, -30);
    plane.renderOrder = -5;
    scene.add(plane);
  }

  update(palette) {
    this.uniforms.uDeep.value.copy(palette.fog).multiplyScalar(0.85);
    this.uniforms.uBright.value.copy(palette.top).multiplyScalar(1.1 + palette.caustic * 0.9);
    this.uniforms.uFogColor.value.copy(palette.fog);
    this.uniforms.uFogDensity.value = palette.density;
  }
}

/** Suspended particles ("marine snow") give the water depth; a few glow at night. */
export class MarineSnow {
  constructor(scene, { quality }) {
    const n = quality === 'low' ? 900 : 2600;
    const rnd = mulberry32(99);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = -24 + rnd() * 48;
      pos[i * 3 + 1] = rnd() * 11.5;
      pos[i * 3 + 2] = -28 + rnd() * 40;
      seed[i] = rnd();
      size[i] = 0.6 + rnd() * rnd() * 2.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.uniforms = {
      uTime: U.uTime,
      uPixelRatio: { value: 1 },
      uNight: { value: 0 },
      uColor: { value: new THREE.Color(0.85, 0.9, 0.85) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute float aSize;
        uniform float uTime, uPixelRatio, uNight;
        varying float vAlpha;
        varying float vGlow;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * (0.025 + aSeed * 0.05), 11.5);
          p.x += sin(uTime * 0.11 + aSeed * 40.0) * 0.5;
          p.z += cos(uTime * 0.09 + aSeed * 23.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = aSize * uPixelRatio * (38.0 / max(d, 0.5));
          vAlpha = smoothstep(0.8, 3.5, d) * exp(-d * 0.032);
          vGlow = step(0.93, aSeed) * uNight * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 1.7 + aSeed * 91.0), 4.0));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        varying float vGlow;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, r);
          vec3 col = mix(uColor, vec3(0.35, 0.9, 1.3) * 2.5, clamp(vGlow, 0.0, 1.0));
          gl_FragColor = vec4(col, a * (vAlpha * 0.45 + vGlow * 0.9));
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  update(palette, night, pixelRatio) {
    this.uniforms.uNight.value = night;
    this.uniforms.uPixelRatio.value = pixelRatio;
    this.uniforms.uColor.value.copy(palette.sky).lerp(new THREE.Color(1, 1, 0.9), 0.5).multiplyScalar(0.4 + palette.hemi * 0.5);
  }
}
