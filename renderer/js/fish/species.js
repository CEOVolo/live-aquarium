import * as THREE from 'three';
import { makeProfile, medianFinPoint, tailPoint, jawLipY, PEC_UV } from './geometry.js';
import { pchip, mulberry32 } from '../util.js';

// Every species is data: body profile (top/bottom outline and width along the
// body, s = 0 at the nose .. 1 at the tail base), fins, a painter for the side
// view texture, material and swimming/behaviour parameters. Adding a species
// means adding an entry here.

export const SPECIES = {
  chromis: {
    label: 'Chromis',
    bodyLen: 0.76,
    top: [[0, 0], [0.05, 0.07], [0.15, 0.125], [0.3, 0.165], [0.45, 0.165], [0.65, 0.12], [0.85, 0.06], [1, 0.045]],
    bot: [[0, -0.01], [0.05, -0.06], [0.15, -0.11], [0.3, -0.145], [0.45, -0.15], [0.65, -0.105], [0.85, -0.05], [1, -0.04]],
    wid: [[0, 0], [0.05, 0.035], [0.2, 0.065], [0.4, 0.07], [0.7, 0.045], [1, 0.02]],
    eye: { s: 0.1, y: 0.03, r: 0.036 },
    fins: [
      { type: 'dorsal', from: 0.26, to: 0.86, h: [[0, 0.02], [0.1, 0.09], [0.5, 0.075], [0.85, 0.1], [1, 0]], sweep: 0.05 },
      { type: 'anal', from: 0.58, to: 0.88, h: [[0, 0.02], [0.2, 0.085], [0.8, 0.085], [1, 0]], sweep: 0.04 },
      { type: 'pelvic', from: 0.25, to: 0.33, h: [[0, 0.02], [0.5, 0.07], [1, 0.0]], sweep: 0.06 },
    ],
    tail: { len: 0.25, spread: 0.17, shape: 'forked' },
    pec: { s: 0.24, y: -0.02, len: 0.12, width: 0.05, out: 0.55, down: 0.15 },
    material: { roughness: 0.3, metalness: 0.25, clearcoat: 0.6, iridescence: 0.9 },
    swim: { size: 0.62, cruise: 1.3, max: 3.3, accel: 3.0, tailHz: 3.2, amp: 0.075, ampHead: 0.006, waveK: 5.8, finFlutter: 0.015, pecHz: 2.5 },
    behavior: { school: { r: 2.2, sep: 1.7, sepR: 0.42, ali: 1.1, coh: 0.9 }, zone: [3.8, 8.6], shy: 0.7, playful: true, escort: true },
    paint(ctx, H) {
      H.fillAll('rgba(130,225,215,0.5)');
      H.finRays('rgba(70,170,180,0.55)', 0.003, 16);
      H.clipBody(() => {
        H.fillAll(H.vgrad(-0.16, 0.17, [[0, '#e6fff8'], [0.4, '#93ecdc'], [0.75, '#52c4d2'], [1, '#2b93bc']]));
        H.lateralLine('rgba(40,120,150,0.25)');
      });
      H.eye({ iris: '#bfe6ff', pupil: '#05080c' });
      H.pecSwatch('rgba(170,235,225,0.45)', null);
    },
  },

  clownfish: {
    label: 'Clownfish',
    // A 3D model (see assets/models/CREDITS.md); the procedural description below is the fallback.
    model: { url: 'assets/models/clownfish.glb', roles: { transparent: 'fin' }, roughness: 0.45 },
    bodyLen: 0.8,
    top: [[0, 0], [0.04, 0.07], [0.12, 0.14], [0.3, 0.19], [0.5, 0.18], [0.7, 0.125], [0.9, 0.075], [1, 0.065]],
    bot: [[0, -0.03], [0.05, -0.085], [0.15, -0.14], [0.3, -0.17], [0.5, -0.16], [0.7, -0.105], [0.9, -0.068], [1, -0.06]],
    wid: [[0, 0], [0.06, 0.06], [0.25, 0.1], [0.5, 0.09], [0.8, 0.05], [1, 0.03]],
    boxy: 0.95,
    eye: { s: 0.1, y: 0.035, r: 0.045 },
    fins: [
      { type: 'dorsal', from: 0.24, to: 0.9, h: [[0, 0.02], [0.1, 0.09], [0.32, 0.07], [0.43, 0.05], [0.55, 0.11], [0.8, 0.1], [1, 0]], sweep: 0.03 },
      { type: 'anal', from: 0.6, to: 0.9, h: [[0, 0.02], [0.3, 0.1], [0.8, 0.09], [1, 0]], sweep: 0.03 },
      { type: 'pelvic', from: 0.24, to: 0.34, h: [[0, 0.02], [0.5, 0.08], [1, 0]], sweep: 0.05 },
    ],
    tail: { len: 0.2, spread: 0.155, shape: 'round' },
    pec: { s: 0.28, y: -0.04, len: 0.13, width: 0.075, out: 0.7, down: 0.2 },
    material: { roughness: 0.45, metalness: 0.0, clearcoat: 0.5, iridescence: 0.0 },
    swim: { size: 0.78, cruise: 0.75, max: 2.5, accel: 2.6, tailHz: 3.6, amp: 0.07, ampHead: 0.008, waveK: 5.0, finFlutter: 0.02, pecHz: 3.0 },
    behavior: { home: 'anemone', homeR: 1.5, zone: [0.8, 4.5], shy: 1.0 },
    paint(ctx, H) {
      H.fillAll('rgba(255,122,22,0.93)');
      H.finRays('rgba(190,60,0,0.35)', 0.004, 14);
      H.finEdges('#111', 0.042);
      H.finEdges('rgba(255,255,255,0.95)', 0.014);
      H.clipBody(() => {
        H.fillAll(H.vgrad(-0.18, 0.2, [[0, '#ffa24a'], [0.5, '#ff7a1a'], [1, '#ec5d00']]));
      });
      H.band(0.2, 0.3, '#fffaf2', { bulge: 0.03, outline: '#151515', outlineW: 0.028 });
      H.band(0.47, 0.6, '#fffaf2', { bulge: -0.07, outline: '#151515', outlineW: 0.028 });
      H.band(0.87, 0.97, '#fffaf2', { outline: '#151515', outlineW: 0.028 });
      H.eye({ iris: '#ff8a26', pupil: '#070707' });
      H.pecSwatch('rgba(255,130,30,0.95)', '#111');
    },
  },

  tang: {
    label: 'Blue Tang',
    bodyLen: 0.8,
    top: [[0, 0], [0.05, 0.1], [0.15, 0.19], [0.3, 0.245], [0.5, 0.245], [0.7, 0.185], [0.9, 0.08], [1, 0.05]],
    bot: [[0, -0.03], [0.05, -0.08], [0.15, -0.16], [0.3, -0.215], [0.5, -0.215], [0.7, -0.155], [0.9, -0.07], [1, -0.05]],
    wid: [[0, 0], [0.08, 0.04], [0.3, 0.07], [0.6, 0.06], [1, 0.02]],
    boxy: 0.85,
    eye: { s: 0.12, y: 0.06, r: 0.04 },
    fins: [
      { type: 'dorsal', from: 0.12, to: 0.92, h: [[0, 0.02], [0.1, 0.06], [0.9, 0.07], [1, 0]], sweep: 0.03 },
      { type: 'anal', from: 0.36, to: 0.92, h: [[0, 0.02], [0.1, 0.06], [0.9, 0.065], [1, 0]], sweep: 0.03 },
    ],
    tail: { len: 0.2, spread: 0.18, shape: 'lunate' },
    pec: { s: 0.26, y: 0.0, len: 0.14, width: 0.07, out: 0.6, down: 0.25 },
    material: { roughness: 0.4, metalness: 0.05, clearcoat: 0.6, iridescence: 0.25 },
    swim: { size: 1.31, cruise: 1.1, max: 3.0, accel: 2.2, tailHz: 1.6, amp: 0.06, ampHead: 0.006, waveK: 4.5, finFlutter: 0.018, pecHz: 1.4 },
    behavior: { school: { r: 3.2, sep: 1.3, sepR: 1.1, ali: 0.45, coh: 0.25 }, zone: [2.0, 8.0], shy: 0.5, graze: 0.3, playful: true, escort: true },
    paint(ctx, H) {
      const { P } = H;
      H.fillAll('rgba(36,82,222,0.92)');
      H.finRays('rgba(10,20,90,0.35)', 0.004, 18);
      H.finEdges('#0b0b16', 0.034);
      ctx.fillStyle = '#ffd21e';
      ctx.fillRect(-0.5, -0.5, P.X(1) + 0.035 + 0.5, 1);
      H.tailEdges('#121212', 0.03);
      H.clipBody(() => {
        H.fillAll(H.vgrad(-0.24, 0.24, [[0, '#4e8dff'], [0.5, '#2559e2'], [1, '#1a3cae']]));
        ctx.strokeStyle = '#0a0b12';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 0.075;
        ctx.beginPath();
        ctx.moveTo(P.X(0.1), 0.06);
        ctx.bezierCurveTo(P.X(0.25), 0.21, P.X(0.55), 0.2, P.X(0.8), 0.1);
        ctx.lineTo(P.X(1.02), 0.0);
        ctx.stroke();
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.ellipse(P.X(0.5), 0.06, 0.15 * 0.8, 0.07, -0.12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffd21e';
        ctx.beginPath();
        ctx.moveTo(P.X(0.8), 0.0);
        ctx.lineTo(P.X(1.03), 0.05);
        ctx.lineTo(P.X(1.03), -0.05);
        ctx.closePath();
        ctx.fill();
      });
      H.eye({ iris: '#20242e', pupil: '#000000' });
      H.pecSwatch('rgba(40,90,230,0.9)', null, 'rgba(255,210,30,0.95)');
    },
  },

  yellowtang: {
    label: 'Yellow Tang',
    bodyLen: 0.82,
    top: [[0, 0.04], [0.04, 0.08], [0.12, 0.19], [0.28, 0.27], [0.45, 0.27], [0.65, 0.2], [0.85, 0.09], [1, 0.055]],
    bot: [[0, 0.02], [0.04, -0.03], [0.14, -0.14], [0.3, -0.235], [0.5, -0.235], [0.7, -0.16], [0.88, -0.07], [1, -0.05]],
    wid: [[0, 0], [0.1, 0.032], [0.35, 0.05], [0.7, 0.042], [1, 0.02]],
    boxy: 0.85,
    eye: { s: 0.17, y: 0.1, r: 0.035 },
    fins: [
      { type: 'dorsal', from: 0.14, to: 0.9, h: [[0, 0.03], [0.2, 0.16], [0.6, 0.14], [0.9, 0.08], [1, 0]], sweep: 0.05 },
      { type: 'anal', from: 0.3, to: 0.9, h: [[0, 0.03], [0.2, 0.14], [0.6, 0.12], [1, 0]], sweep: 0.05 },
    ],
    tail: { len: 0.17, spread: 0.15, shape: 'truncate' },
    pec: { s: 0.3, y: 0.02, len: 0.11, width: 0.06, out: 0.6, down: 0.2 },
    material: { roughness: 0.5, metalness: 0.0, clearcoat: 0.45, iridescence: 0.05 },
    swim: { size: 1.19, cruise: 0.95, max: 2.8, accel: 2.2, tailHz: 1.5, amp: 0.055, ampHead: 0.006, waveK: 4.4, finFlutter: 0.022, pecHz: 1.6 },
    behavior: { school: { r: 3.0, sep: 1.3, sepR: 1.0, ali: 0.45, coh: 0.3 }, zone: [1.5, 7.5], shy: 0.5, graze: 0.45, playful: true },
    paint(ctx, H) {
      const { P } = H;
      H.fillAll('rgba(255,212,20,0.9)');
      H.finRays('rgba(200,150,0,0.35)', 0.004, 22);
      H.clipBody(() => {
        H.fillAll(H.vgrad(-0.27, 0.27, [[0, '#fff27a'], [0.5, '#ffe21a'], [1, '#f5c400']]));
        ctx.strokeStyle = 'rgba(225,175,0,0.2)';
        ctx.lineWidth = 0.006;
        for (let i = 0; i < 30; i++) {
          const x = P.X(0.15 + i * 0.027);
          ctx.beginPath();
          ctx.moveTo(x, -0.3);
          ctx.lineTo(x - 0.02, 0.3);
          ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(P.X(0.93), P.mid(0.93), 0.028, 0.008, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      H.eye({ iris: '#f0c000', pupil: '#050505' });
      H.pecSwatch('rgba(255,222,50,0.8)', null);
    },
  },

  gramma: {
    label: 'Royal Gramma',
    bodyLen: 0.8,
    top: [[0, 0], [0.05, 0.06], [0.15, 0.11], [0.35, 0.13], [0.6, 0.12], [0.85, 0.07], [1, 0.055]],
    bot: [[0, -0.02], [0.05, -0.06], [0.2, -0.11], [0.4, -0.12], [0.65, -0.1], [0.85, -0.06], [1, -0.05]],
    wid: [[0, 0], [0.1, 0.05], [0.4, 0.07], [1, 0.03]],
    eye: { s: 0.1, y: 0.03, r: 0.036 },
    fins: [
      { type: 'dorsal', from: 0.2, to: 0.92, h: [[0, 0.02], [0.15, 0.07], [0.9, 0.09], [1, 0]], sweep: 0.03 },
      { type: 'anal', from: 0.55, to: 0.92, h: [[0, 0.02], [0.3, 0.08], [1, 0]], sweep: 0.03 },
      { type: 'pelvic', from: 0.22, to: 0.3, h: [[0, 0.02], [0.5, 0.1], [1, 0]], sweep: 0.07 },
    ],
    tail: { len: 0.2, spread: 0.12, shape: 'round' },
    pec: { s: 0.22, y: -0.01, len: 0.11, width: 0.05, out: 0.6, down: 0.15 },
    material: { roughness: 0.45, metalness: 0.0, clearcoat: 0.5, iridescence: 0.15 },
    swim: { size: 0.6, cruise: 0.6, max: 2.4, accel: 2.6, tailHz: 3.0, amp: 0.07, ampHead: 0.007, waveK: 5.5, finFlutter: 0.02, pecHz: 3.2 },
    behavior: { home: 'rocks', homeR: 1.6, zone: [0.8, 5.5], shy: 1.2 },
    paint(ctx, H) {
      const { P } = H;
      H.fillAll(H.hgrad(0.5, -0.5, [[0, 'rgba(176,30,204,0.92)'], [0.42, 'rgba(176,30,204,0.92)'], [0.62, 'rgba(255,196,0,0.92)'], [1, 'rgba(255,196,0,0.92)']]));
      H.finRays('rgba(80,0,90,0.3)', 0.003, 16);
      H.clipBody(() => {
        H.fillAll(H.hgrad(P.X(0), P.X(1), [[0, '#a116c4'], [0.4, '#b61fd2'], [0.52, '#ff8a2a'], [0.6, '#ffc400'], [1, '#ffcf1a']]));
        H.fillAll(H.vgrad(-0.12, 0.13, [[0, 'rgba(255,255,255,0.12)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(40,0,50,0.25)']]));
        ctx.strokeStyle = 'rgba(25,0,35,0.85)';
        ctx.lineWidth = 0.012;
        ctx.beginPath();
        ctx.moveTo(P.X(0.0), P.mid(0) + 0.012);
        ctx.lineTo(P.X(0.17), 0.05);
        ctx.stroke();
      });
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(P.X(0.28), P.top(0.28) + 0.04, 0.018, 0.014, 0, 0, Math.PI * 2);
      ctx.fill();
      H.eye({ iris: '#ffd23a', pupil: '#050505' });
      H.pecSwatch('rgba(190,60,220,0.85)', null);
    },
  },

  cardinal: {
    label: 'Cardinalfish',
    bodyLen: 0.72,
    top: [[0, 0], [0.06, 0.1], [0.2, 0.185], [0.35, 0.205], [0.55, 0.165], [0.8, 0.08], [1, 0.05]],
    bot: [[0, -0.03], [0.08, -0.1], [0.25, -0.185], [0.4, -0.195], [0.6, -0.135], [0.8, -0.07], [1, -0.05]],
    wid: [[0, 0], [0.1, 0.05], [0.35, 0.07], [1, 0.02]],
    eye: { s: 0.12, y: 0.04, r: 0.055 },
    fins: [
      { type: 'dorsal', from: 0.24, to: 0.44, h: [[0, 0.02], [0.3, 0.28], [0.5, 0.2], [1, 0.02]], sweep: 0.06 },
      { type: 'dorsal2', from: 0.55, to: 0.8, h: [[0, 0.02], [0.3, 0.2], [1, 0.02]], sweep: 0.06 },
      { type: 'anal', from: 0.55, to: 0.82, h: [[0, 0.02], [0.3, 0.2], [1, 0.02]], sweep: 0.06 },
      { type: 'pelvic', from: 0.26, to: 0.36, h: [[0, 0.02], [0.4, 0.16], [1, 0.0]], sweep: 0.1 },
    ],
    tail: { len: 0.28, spread: 0.22, shape: 'deepfork' },
    pec: { s: 0.24, y: 0.0, len: 0.12, width: 0.06, out: 0.6, down: 0.2 },
    material: { roughness: 0.3, metalness: 0.35, clearcoat: 0.6, iridescence: 0.55 },
    swim: { size: 0.78, cruise: 0.28, max: 1.8, accel: 1.8, tailHz: 1.2, amp: 0.04, ampHead: 0.004, waveK: 4.5, finFlutter: 0.03, pecHz: 2.4 },
    behavior: { home: 'coral', homeR: 2.2, hover: 0.7, zone: [2.0, 6.5], shy: 0.8, school: { r: 2.6, sep: 1.1, sepR: 0.9, ali: 0.6, coh: 0.45 } },
    paint(ctx, H) {
      const { P } = H;
      H.fillAll('rgba(214,220,226,0.55)');
      H.finRays('rgba(90,90,95,0.4)', 0.003, 20);
      ctx.fillStyle = 'rgba(12,12,14,0.95)';
      ctx.fillRect(P.X(0.4), -0.5, P.X(0.3) - P.X(0.4), 1);
      ctx.fillRect(P.X(0.68), -0.5, P.X(0.58) - P.X(0.68), 1);
      H.tailEdges('#121212', 0.035);
      H.clipBody(() => {
        H.fillAll(H.vgrad(-0.2, 0.2, [[0, '#f6f9fa'], [0.5, '#dde5ea'], [1, '#b3bfc8']]));
        ctx.fillStyle = '#101012';
        for (const [a, b] of [[0.06, 0.15], [0.3, 0.4], [0.58, 0.68]]) ctx.fillRect(P.X(b), -0.5, P.X(a) - P.X(b), 1);
      });
      H.dots(90, { x0: -0.5, x1: P.X(0.68), y0: -0.4, y1: 0.4 }, 'rgba(255,255,255,0.95)', 0.004, 0.009, 3);
      H.eye({ iris: '#e8c060', pupil: '#050505' });
      H.pecSwatch('rgba(220,225,230,0.5)', null);
    },
  },

  golden: {
    label: 'Golden Fish',
    model: { url: 'assets/models/golden.glb', roles: { M_RyukinFins2: 'fin', M_RyukinEyes: 'masked' }, roughness: 0.4 },
    special: true,
    capacity: 4,
    bodyLen: 0.62,
    top: [[0, 0], [0.06, 0.07], [0.2, 0.13], [0.4, 0.14], [0.7, 0.1], [1, 0.06]],
    bot: [[0, -0.02], [0.06, -0.07], [0.2, -0.12], [0.4, -0.13], [0.7, -0.09], [1, -0.05]],
    wid: [[0, 0], [0.1, 0.05], [0.4, 0.08], [1, 0.03]],
    eye: { s: 0.1, y: 0.03, r: 0.035 },
    fins: [
      { type: 'dorsal', from: 0.2, to: 0.95, h: [[0, 0.03], [0.3, 0.2], [0.8, 0.18], [1, 0]], sweep: 0.12 },
      { type: 'anal', from: 0.5, to: 0.95, h: [[0, 0.03], [0.4, 0.16], [1, 0]], sweep: 0.12 },
      { type: 'pelvic', from: 0.25, to: 0.35, h: [[0, 0.02], [0.4, 0.14], [1, 0]], sweep: 0.12 },
    ],
    tail: { len: 0.38, spread: 0.3, shape: 'veil' },
    pec: { s: 0.22, y: -0.02, len: 0.15, width: 0.07, out: 0.7, down: 0.25 },
    material: { roughness: 0.25, metalness: 0.7, clearcoat: 0.8, iridescence: 0.35, emissive: '#ffab2e', emissiveIntensity: 0.55 },
    swim: { size: 1.69, cruise: 0.85, max: 2.2, accel: 1.6, tailHz: 1.3, amp: 0.1, ampHead: 0.012, waveK: 4.6, finFlutter: 0.06, pecHz: 1.8, headYaw: 0.035 },
    behavior: { ai: 'golden' },
    paint(ctx, H) {
      H.fillAll('rgba(255,190,70,0.72)');
      H.finRays('rgba(255,244,190,0.65)', 0.003, 28);
      H.finEdges('rgba(255,252,225,0.9)', 0.02);
      H.clipBody(() => {
        H.fillAll(H.vgrad(-0.14, 0.15, [[0, '#fff3b0'], [0.4, '#ffd23f'], [0.75, '#ffb000'], [1, '#e08a00']]));
        const g = ctx.createRadialGradient(0.42, 0.02, 0, 0.42, 0.02, 0.14);
        g.addColorStop(0, 'rgba(255,90,30,0.7)');
        g.addColorStop(1, 'rgba(255,90,30,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-0.5, -0.5, 1, 1);
        H.scales('rgba(255,255,220,0.35)', 0.022);
      });
      H.eye({ iris: '#ffe07a', pupil: '#050505' });
      H.pecSwatch('rgba(255,210,100,0.75)', null);
    },
  },

  shark: {
    label: 'Reef Shark',
    // A great white with a modelled mouth and teeth. jawHinge (from prepare.py) and jawAngle: where
    // the lower jaw turns and how far it opens.
    model: { url: 'assets/models/shark.glb', jawHinge: [0.2508, -0.081], jawAngle: 0.5, roughness: 0.55 },
    special: true,
    capacity: 4,
    textureSize: 1024,
    bodyLen: 0.75,
    top: [[0, -0.012], [0.03, 0.018], [0.1, 0.052], [0.25, 0.083], [0.4, 0.09], [0.6, 0.064], [0.8, 0.034], [1, 0.02]],
    bot: [[0, -0.03], [0.04, -0.05], [0.12, -0.066], [0.3, -0.078], [0.5, -0.068], [0.7, -0.044], [0.9, -0.025], [1, -0.018]],
    wid: [[0, 0], [0.05, 0.035], [0.2, 0.074], [0.4, 0.078], [0.7, 0.04], [1, 0.016]],
    boxy: 1.0,
    eye: { s: 0.08, y: 0.012, r: 0.012 },
    // The first dorsal is a solid wedge (thick) with a convex leading and a concave trailing edge.
    fins: [
      { type: 'dorsal', from: 0.33, to: 0.52, h: [[0, 0.0], [0.3, 0.075], [0.55, 0.12], [0.66, 0.13], [0.76, 0.075], [0.88, 0.028], [1, 0.0]], sweep: 0.06, thick: 0.016 },
      { type: 'dorsal2', from: 0.8, to: 0.87, h: [[0, 0.0], [0.4, 0.03], [1, 0.0]], sweep: 0.02 },
      { type: 'anal', from: 0.8, to: 0.87, h: [[0, 0.0], [0.4, 0.028], [1, 0.0]], sweep: 0.02 },
      { type: 'pelvic', from: 0.55, to: 0.62, h: [[0, 0.0], [0.4, 0.035], [1, 0.0]], sweep: 0.03 },
    ],
    tail: { len: 0.23, spreadUp: 0.14, spreadDown: 0.075, shape: 'hetero', lift: 0.045, thick: 0.012 },
    pec: { wing: true, s: 0.25, y: -0.058, len: 0.2, chord: 0.105, sweep: 0.1, down: 0.42 },
    // The lower jaw: body rings between `from` and `hinge` below `cut` swing down by up to `angle` rad.
    jaw: { from: 0.03, hinge: 0.165, cut: -0.52, angle: 0.72 },
    // Smooth skin (denticles, not scales): the scale bumps would read as stripes at this size.
    material: { roughness: 0.62, metalness: 0.0, clearcoat: 0.25, iridescence: 0.0, scales: 0 },
    // A shark swims with its whole body: a slow, deep S-wave (about one wavelength along the body)
    // and a head that swings with every stroke. A small wave with a short wavenumber reads as a stick.
    swim: { size: 6.5, cruise: 1.5, max: 4.4, accel: 1.5, tailHz: 0.9, amp: 0.19, ampHead: 0.03, waveK: 5.6, finFlutter: 0.003, pecHz: 0.25, headYaw: 0.05 },
    behavior: { ai: 'shark' },
    paint(ctx, H) {
      const { P, spec } = H;
      H.fillAll('rgba(112,123,132,0.97)');
      const dorsal = spec.fins[0];
      const apex = medianFinPoint(spec, P, dorsal, 0.64, 1);
      ctx.fillStyle = '#0c0d0f';
      ctx.beginPath();
      ctx.ellipse(apex[0] - 0.01, apex[1] - 0.012, 0.03, 0.022, 0.5, 0, Math.PI * 2);
      ctx.fill();
      const lower = tailPoint(spec, P, 1, -1);
      ctx.beginPath();
      ctx.ellipse(lower[0] + 0.012, lower[1] + 0.01, 0.028, 0.02, 0, 0, Math.PI * 2);
      ctx.fill();
      H.tailTrailing('rgba(30,33,37,0.85)', 0.014);
      H.clipBody(() => {
        H.fillAll(H.vgrad(-0.09, 0.1, [[0, '#f2f4f5'], [0.38, '#e3e8ea'], [0.5, '#8a949b'], [0.62, '#66717a'], [1, '#515c65']]));
        ctx.strokeStyle = 'rgba(40,46,52,0.6)';
        ctx.lineWidth = 0.003;
        for (let i = 0; i < 5; i++) {
          const x = P.X(0.17 + i * 0.016);
          ctx.beginPath();
          ctx.moveTo(x, 0.02);
          ctx.quadraticCurveTo(x - 0.006, -0.01, x, -0.04);
          ctx.stroke();
        }
        // The mouth line lies exactly on the lips of the jaw, so the mouth opens along it.
        ctx.strokeStyle = 'rgba(34,36,42,0.8)';
        ctx.lineWidth = 0.0035;
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
          const s = spec.jaw.from + ((spec.jaw.hinge - spec.jaw.from) * i) / 16;
          if (i) ctx.lineTo(P.X(s), jawLipY(spec, P, s));
          else ctx.moveTo(P.X(s), jawLipY(spec, P, s));
        }
        ctx.stroke();
      });
      H.eye({ iris: '#23302a', pupil: '#050505' });
      H.pecSwatch('rgba(96,107,116,0.98)', null, 'rgba(25,27,30,0.95)', false);
    },
  },
};

// ---- texture painting -------------------------------------------------------------

function makeHelpers(ctx, spec, P) {
  const rnd = mulberry32(spec.bodyLen * 1e4);
  const bodyPath = (grow = 0.005) => {
    ctx.beginPath();
    const n = 90;
    ctx.moveTo(0.51, P.mid(0));
    for (let i = 0; i <= n; i++) ctx.lineTo(P.X(i / n), P.top(i / n) + grow);
    ctx.lineTo(P.X(1) - 0.045, P.top(1));
    ctx.lineTo(P.X(1) - 0.045, P.bot(1));
    for (let i = n; i >= 0; i--) ctx.lineTo(P.X(i / n), P.bot(i / n) - grow);
    ctx.closePath();
  };
  const H = {
    P,
    spec,
    fillAll(style) {
      ctx.fillStyle = style;
      ctx.fillRect(-0.5, -0.5, 1, 1);
    },
    clipBody(fn) {
      ctx.save();
      bodyPath();
      ctx.clip();
      fn();
      ctx.restore();
    },
    vgrad(y0, y1, stops) {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      for (const [o, c] of stops) g.addColorStop(o, c);
      return g;
    },
    hgrad(x0, x1, stops) {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      for (const [o, c] of stops) g.addColorStop(o, c);
      return g;
    },
    band(s0, s1, fill, { bulge = 0, outline = null, outlineW = 0.012 } = {}) {
      H.clipBody(() => {
        const x0 = P.X(s0), x1 = P.X(s1), b = bulge * spec.bodyLen;
        ctx.beginPath();
        ctx.moveTo(x0, 0.5);
        ctx.quadraticCurveTo(x0 - b * 2, P.mid((s0 + s1) / 2), x0, -0.5);
        ctx.lineTo(x1, -0.5);
        ctx.quadraticCurveTo(x1 - b * 2, P.mid((s0 + s1) / 2), x1, 0.5);
        ctx.closePath();
        if (outline) {
          ctx.lineWidth = outlineW;
          ctx.strokeStyle = outline;
          ctx.stroke();
        }
        ctx.fillStyle = fill;
        ctx.fill();
      });
    },
    finRays(color, width, count) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (const fin of spec.fins) {
        const hf = pchip(fin.h);
        for (let k = 0; k <= count; k++) {
          const c = k / count;
          const a = medianFinPoint(spec, P, fin, c, 0, hf);
          const b = medianFinPoint(spec, P, fin, c, 1.05, hf);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
      }
      for (let k = 0; k <= count; k++) {
        const tb = (k / count) * 2 - 1;
        const a = tailPoint(spec, P, 0, tb * 0.4);
        const b = tailPoint(spec, P, 1.04, tb);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    },
    finEdges(color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      for (const fin of spec.fins) {
        const hf = pchip(fin.h);
        ctx.beginPath();
        for (let k = 0; k <= 30; k++) {
          const p = medianFinPoint(spec, P, fin, k / 30, 1, hf);
          if (k) ctx.lineTo(p[0], p[1]);
          else ctx.moveTo(p[0], p[1]);
        }
        ctx.stroke();
      }
      H.tailTrailing(color, width);
      H.tailEdges(color, width);
    },
    tailTrailing(color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let k = 0; k <= 30; k++) {
        const p = tailPoint(spec, P, 1, (k / 30) * 2 - 1);
        if (k) ctx.lineTo(p[0], p[1]);
        else ctx.moveTo(p[0], p[1]);
      }
      ctx.stroke();
    },
    tailEdges(color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (const tb of [-1, 1]) {
        ctx.beginPath();
        for (let k = 0; k <= 12; k++) {
          const p = tailPoint(spec, P, k / 12, tb);
          if (k) ctx.lineTo(p[0], p[1]);
          else ctx.moveTo(p[0], p[1]);
        }
        ctx.stroke();
      }
    },
    lateralLine(color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.004;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const s = 0.15 + (i / 40) * 0.8;
        const y = P.mid(s) + (P.top(s) - P.mid(s)) * 0.45;
        if (i) ctx.lineTo(P.X(s), y);
        else ctx.moveTo(P.X(s), y);
      }
      ctx.stroke();
    },
    scales(color, size) {
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 0.12;
      for (let x = 0.45; x > -0.2; x -= size * 0.8) {
        for (let y = -0.2; y < 0.2; y += size * 0.7) {
          ctx.beginPath();
          ctx.arc(x + ((Math.round(y / (size * 0.7)) % 2) * size) / 2, y, size * 0.5, Math.PI * 0.6, Math.PI * 1.4);
          ctx.stroke();
        }
      }
    },
    dots(n, box, color, rmin, rmax) {
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const x = box.x0 + rnd() * (box.x1 - box.x0), y = box.y0 + rnd() * (box.y1 - box.y0);
        ctx.beginPath();
        ctx.arc(x, y, rmin + rnd() * (rmax - rmin), 0, Math.PI * 2);
        ctx.fill();
      }
    },
    eye({ iris, pupil }) {
      const { s, y, r } = spec.eye;
      const x = P.X(s);
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pupil;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.66, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(x + r * 0.25, y + r * 0.28, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    },
    pecSwatch(fill, edge, tip = null, rays = true) {
      const x0 = PEC_UV.u0 - 0.5, x1 = PEC_UV.u1 - 0.5, y0 = PEC_UV.v0 - 0.5, y1 = PEC_UV.v1 - 0.5;
      ctx.clearRect(x0 - 0.01, y0 - 0.01, x1 - x0 + 0.02, y1 - y0 + 0.02);
      ctx.fillStyle = fill;
      ctx.fillRect(x0 - 0.01, y0 - 0.01, x1 - x0 + 0.02, y1 - y0 + 0.02);
      if (tip) {
        ctx.fillStyle = tip;
        ctx.fillRect(x0 + (x1 - x0) * 0.72, y0 - 0.01, (x1 - x0) * 0.3, y1 - y0 + 0.02);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.002;
      for (let k = 0; rays && k <= 6; k++) {
        const y = y0 + ((y1 - y0) * k) / 6;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      }
      if (edge) {
        ctx.strokeStyle = edge;
        ctx.lineWidth = 0.012;
        ctx.beginPath();
        ctx.moveTo(x1, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    },
  };
  return H;
}

export function paintSpecies(spec) {
  const size = spec.textureSize ?? 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(size, 0, 0, -size, size / 2, size / 2);
  const P = makeProfile(spec);
  spec.paint(ctx, makeHelpers(ctx, spec, P));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
