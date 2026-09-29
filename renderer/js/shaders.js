import * as THREE from 'three';

// Uniforms shared by every underwater material. Updating a value here updates
// all materials at once (the same objects are referenced by every shader).
export const U = {
  uTime: { value: 0 },
  uDay: { value: 1 },
  uCaustic: { value: 1 },
  uCausticColor: { value: new THREE.Color(1.0, 0.97, 0.88) },
  uSunDir: { value: new THREE.Vector3(-0.22, -1, -0.12).normalize() },
  uSurfaceY: { value: 11 },
  uFluoro: { value: 0 },
  uGrowth: { value: 0.8 },
};

export const CAUSTICS_GLSL = /* glsl */ `
uniform float uTime;
uniform float uCaustic;
uniform vec3 uCausticColor;
uniform vec3 uSunDir;
uniform float uSurfaceY;
vec2 uwHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// Distance to the nearest Voronoi cell border: bright thin lines where it is ~0.
float uwCellEdge(vec2 x, float t) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = uwHash2(n + g);
    o = 0.5 + 0.42 * sin(t + 6.2831 * o);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(d2) - sqrt(d1);
}
float causticsAt(vec3 wp) {
  float h = max(uSurfaceY - wp.y, 0.0);
  // Trace back along the light direction to where the ray entered the water.
  vec2 p = wp.xz + uSunDir.xz / max(-uSunDir.y, 0.25) * h;
  float t = uTime * 0.5;
  float e1 = uwCellEdge(p * 0.62 + vec2(t * 0.06, t * 0.035), t);
  float e2 = uwCellEdge(p * 0.62 * 1.41 + vec2(-t * 0.045, t * 0.05) + 7.31, t * 1.17);
  float c1 = 1.0 - smoothstep(0.0, 0.13, e1);
  float c2 = 1.0 - smoothstep(0.0, 0.13, e2);
  float c = c1 * 0.55 + c2 * 0.55 + c1 * c2 * 1.6;
  return c * exp(-h * 0.03);
}
`;

const WORLD_VARYINGS = 'varying vec3 vUwPos;\nvarying vec3 vUwNrm;\n';

/**
 * Chain several shader patches on one material. `key` must be unique per
 * variant so three.js compiles separate programs for different patches.
 */
export function addPatch(material, key, patch) {
  const patches = (material.userData.uwPatches ??= []);
  patches.push({ key, patch });
  material.onBeforeCompile = (shader) => {
    for (const p of patches) p.patch(shader);
  };
  material.customProgramCacheKey = () => patches.map((p) => p.key).join('|');
  material.needsUpdate = true;
  return material;
}

function ensureWorldVaryings(shader) {
  if (shader.vertexShader.includes('vUwPos')) return;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 uwP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        uwP = instanceMatrix * uwP;
      #endif
      uwP = modelMatrix * uwP;
      vUwPos = uwP.xyz;
      vec3 uwN = objectNormal;
      #ifdef USE_INSTANCING
        uwN = mat3(instanceMatrix) * uwN;
      #endif
      vUwNrm = normalize(mat3(modelMatrix) * uwN);`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`);
}

/** Moving caustic light on everything that faces the surface. */
export function withCaustics(material, strength = 1) {
  return addPatch(material, `caustics${strength}`, (shader) => {
    Object.assign(shader.uniforms, {
      uTime: U.uTime, uCaustic: U.uCaustic, uCausticColor: U.uCausticColor, uSunDir: U.uSunDir, uSurfaceY: U.uSurfaceY,
    });
    ensureWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CAUSTICS_GLSL}`)
      .replace('#include <opaque_fragment>', `
        {
          float uwC = causticsAt(vUwPos) * uCaustic * ${strength.toFixed(3)};
          float uwUp = clamp(vUwNrm.y * 0.75 + 0.3, 0.0, 1.0);
          outgoingLight += diffuseColor.rgb * uCausticColor * uwC * uwUp;
        }
        #include <opaque_fragment>`);
  });
}

/**
 * Night-time fluorescence (actinic "blue light" look of reef tanks): adds an
 * emissive glow scaled by uFluoro. `mask` is GLSL returning 0..1 from vUwPos/vUv.
 */
export function withFluorescence(material, color, strength = 1, mask = '1.0') {
  const c = new THREE.Color(color);
  return addPatch(material, `fluoro${c.getHexString()}${strength}${mask}`, (shader) => {
    shader.uniforms.uFluoro = U.uFluoro;
    ensureWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFluoro;')
      .replace('#include <opaque_fragment>', `
        outgoingLight += vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)}) * uFluoro * ${strength.toFixed(3)} * (${mask});
        #include <opaque_fragment>`);
  });
}

/**
 * Plants and tentacles swaying in the current. Geometry must be authored with
 * its base at y=0; displacement grows with height^2. Works with InstancedMesh.
 */
export function withSway(material, { amp = 0.25, speed = 0.9, stiffness = 2.0, scale = 1 } = {}) {
  return addPatch(material, `sway${amp}${speed}${stiffness}${scale}`, (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uGrowth = U.uGrowth;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uGrowth;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 base = vec3(0.0);
          #ifdef USE_INSTANCING
            base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          base += (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float h = max(transformed.y, 0.0) * ${scale.toFixed(3)};
          float bend = pow(h, ${stiffness.toFixed(2)});
          float ph = uTime * ${speed.toFixed(3)} + base.x * 0.31 + base.z * 0.17;
          float gust = 0.65 + 0.35 * sin(uTime * 0.21 + base.x * 0.05);
          transformed.x += (sin(ph) * 0.8 + sin(ph * 2.3 + 1.7) * 0.2) * bend * ${amp.toFixed(3)} * gust;
          transformed.z += cos(ph * 0.77 + 0.9) * bend * ${(amp * 0.55).toFixed(3)} * gust;
          transformed.y *= mix(0.72, 1.0, uGrowth);
        }`);
  });
}

// ---- tiny procedural textures ------------------------------------------------

export function canvasTexture(size, draw, { srgb = true, repeat = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
  }
  tex.anisotropy = 4;
  return tex;
}

/** Soft round sprite for particles. */
export function dotTexture() {
  return canvasTexture(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Normal map from a height function painted on a canvas (tileable when the painter is). */
export function normalMapFromHeight(size, heightPainter, strength = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  heightPainter(ctx, size);
  const src = ctx.getImageData(0, 0, size, size).data;
  const out = ctx.createImageData(size, size);
  const h = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
