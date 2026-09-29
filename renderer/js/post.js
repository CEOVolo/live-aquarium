import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// Camera-like finishing: slight water wobble, chromatic fringe at the edges,
// vignette, a touch of film grain. Runs in linear HDR before tone mapping.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1920, 1080) },
    uVignette: { value: 0.38 },
    uGrain: { value: 0.012 },
    uCA: { value: 0.0022 },
    uWobble: { value: 1 },
    uLift: { value: new THREE.Color(0.0, 0.012, 0.02) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uCA, uWobble;
    uniform vec2 uRes;
    uniform vec3 uLift;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      uv += vec2(sin(uv.y * 17.0 + uTime * 1.1), cos(uv.x * 13.0 + uTime * 0.8)) * 0.0007 * uWobble;
      vec2 dir = uv - 0.5;
      float d = length(dir);
      vec3 col;
      col.r = texture2D(tDiffuse, uv - dir * uCA * d).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + dir * uCA * d).b;
      col += uLift;
      col *= mix(1.0, smoothstep(0.98, 0.22, d), uVignette);
      float n = fract(sin(dot(uv * uRes + fract(uTime * 7.3) * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain * (0.5 + col);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, { quality, msaa = false }) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // Hardware MSAA on a half-float target is very expensive on some GPUs (it cost ~40 % of the
    // frame on an Apple M4), so 'high' uses SMAA and only 'ultra' pays for MSAA.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: msaa ? 4 : 0,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.7, 0.85);
      // A soft glow does not need full resolution: run the bloom chain at half size.
      const setBloomSize = this.bloom.setSize.bind(this.bloom);
      this.bloom.setSize = (w, h) => setBloomSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
      this.composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    if (!msaa && quality !== 'low') this.composer.addPass(new SMAAPass());
    this.composer.addPass(new OutputPass());
  }

  setSize(width, height, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.grade.uniforms.uRes.value.set(width * pixelRatio, height * pixelRatio);
  }

  render(t, night) {
    this.grade.uniforms.uTime.value = t;
    if (this.bloom) this.bloom.strength = 0.38 + night * 0.35;
    this.composer.render();
  }
}
