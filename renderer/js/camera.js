import * as THREE from 'three';
import { mulberry32 } from './util.js';

// Static compositions. TV mode holds a shot for minutes and glides slowly
// between them; interactive mode stays on the wide shot with a gentle drift.
const SHOTS = [
  { name: 'wide', pos: [0, 5.2, 16.2], look: [0, 4.3, -1], fov: 40 },
  { name: 'anemone', pos: [-5.2, 3.3, 9.8], look: [-6.2, 2.3, -1.2], fov: 38 },
  { name: 'right reef', pos: [5.6, 4.3, 11.2], look: [7.0, 3.5, -2.5], fov: 38 },
  { name: 'low', pos: [0.5, 2.1, 12.5], look: [0, 3.6, -3], fov: 44 },
  { name: 'high', pos: [-2.0, 7.4, 14.5], look: [0.5, 3.9, -2], fov: 40 },
];

const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export class CameraRig {
  constructor(camera, { style = 'drift' } = {}) {
    this.camera = camera;
    this.style = style;
    this.rnd = mulberry32(3);
    this.from = SHOTS[0];
    this.to = SHOTS[0];
    this.blend = 1;
    this.blendDur = 28;
    this.nextSwitch = 150 + this.rnd() * 60;
    this.shotIndex = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
  }

  setStyle(style) {
    this.style = style;
    if (style !== 'cinematic' && this.to !== SHOTS[0]) this.go(0);
  }

  go(index) {
    this.from = this.current();
    this.to = SHOTS[index];
    this.shotIndex = index;
    this.blend = 0;
  }

  current() {
    const k = ease(Math.min(1, this.blend));
    const f = this.from, t = this.to;
    return {
      pos: f.pos.map((v, i) => v + (t.pos[i] - v) * k),
      look: f.look.map((v, i) => v + (t.look[i] - v) * k),
      fov: f.fov + (t.fov - f.fov) * k,
    };
  }

  update(dt, t) {
    if (this.style === 'cinematic' && t > this.nextSwitch && this.blend >= 1) {
      // Every other move returns to the wide shot, so the whole tank is shown often.
      const next = this.shotIndex !== 0 ? 0 : 1 + Math.floor(this.rnd() * (SHOTS.length - 1));
      this.go(next);
      this.nextSwitch = t + this.blendDur + 180 + this.rnd() * 120;
    }
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / this.blendDur);
    const c = this.current();
    this.pos.fromArray(c.pos);
    this.look.fromArray(c.look);
    if (this.style !== 'static') {
      const amt = this.style === 'cinematic' ? 0.6 : 1;
      this.pos.x += Math.sin(t * 0.071) * 0.45 * amt + Math.sin(t * 0.023) * 0.3 * amt;
      this.pos.y += Math.sin(t * 0.053 + 1.3) * 0.18 * amt;
      this.pos.z += Math.sin(t * 0.037 + 0.4) * 0.35 * amt;
      this.look.x += Math.sin(t * 0.047 + 2.1) * 0.25 * amt;
      this.look.y += Math.sin(t * 0.061) * 0.1 * amt;
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - c.fov) > 1e-3) {
      this.camera.fov = c.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
