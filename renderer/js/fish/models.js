import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Fish models prepared by scripts/models/prepare.py: one mesh in "fish space" (nose at x = +0.5,
// length 1, back up) with an _AFIN attribute that tags fins and the lower jaw for the swim shader.
// A species whose model fails to load simply keeps its procedural body.

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/**
 * Images embedded in a GLB are normally fetched from blob: URLs, which a strict Content Security
 * Policy (the shared demo page) refuses. Decoding the bytes with createImageBitmap needs no request.
 */
function decodeEmbeddedImages(parser) {
  const original = parser.loadImageSource.bind(parser);
  parser.loadImageSource = function (sourceIndex, loader) {
    const def = parser.json.images[sourceIndex];
    if (def.bufferView === undefined || typeof createImageBitmap === 'undefined') return original(sourceIndex, loader);
    if (parser.sourceCache[sourceIndex] !== undefined) return parser.sourceCache[sourceIndex].then((t) => t.clone());
    const promise = parser.getDependency('bufferView', def.bufferView).then(async (view) => {
      const blob = new Blob([view], { type: def.mimeType });
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' }).catch(() => createImageBitmap(blob));
      const texture = new THREE.Texture(bitmap);
      texture.needsUpdate = true;
      texture.userData.mimeType = def.mimeType;
      return texture;
    });
    parser.sourceCache[sourceIndex] = promise;
    return promise;
  };
  return { name: 'decode_embedded_images' };
}

/** The shared demo page carries each model as base64 text (its host does not serve .glb files). */
async function load(loader, url) {
  if (!window.AQUARIUM_DEMO) return loader.loadAsync(url);
  const res = await fetch(`${url}.b64.txt`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bin = Uint8Array.from(atob(await res.text()), (c) => c.charCodeAt(0));
  return loader.parseAsync(bin.buffer, '');
}

/** @returns {Promise<Record<string, {geometry: THREE.BufferGeometry, material: THREE.Material}[]>>} */
export async function loadFishModels(species, { timeoutMs = 10000 } = {}) {
  const loader = new GLTFLoader().register(decodeEmbeddedImages);
  const out = {};
  await Promise.all(Object.entries(species).filter(([, s]) => s.model).map(async ([key, s]) => {
    try {
      const gltf = await withTimeout(load(loader, s.model.url), timeoutMs);
      gltf.scene.updateMatrixWorld(true);
      const parts = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
        const fin = geometry.getAttribute('_afin');
        geometry.setAttribute('aFin', fin ?? new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
        if (fin) geometry.deleteAttribute('_afin');
        parts.push({ geometry, material: o.material });
      });
      if (parts.length) out[key] = parts;
    } catch (e) {
      console.warn(`[fish] model for ${key} not loaded, using the procedural one:`, e.message);
    }
  }));
  return out;
}
