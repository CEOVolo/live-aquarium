"""Взвесь в воде («морской снег»): GLB из тысяч крошечных октаэдров в объёме над рифом.

Каждая частица — 6 вершин; в цвете вершин R — случайная фаза дрейфа, G — яркость.
Дрейф делает материал (M_MarineSnow, World Position Offset), меш статичный.

  python scripts/models/make_marine_snow.py [out.glb] [count]
Выход по умолчанию: assets/models/generated/marine_snow.glb (не в git — генерируется).
"""
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "assets", "models", "generated", "marine_snow.glb")

# объём (м), glTF: Y — вверх. По горизонтали симметрично — оси glTF/UE не важны.
HALF_X, HALF_Z, HEIGHT = 11.0, 9.0, 6.0
RADIUS = (0.0015, 0.006)


def build(count, seed=7):
    rng = np.random.default_rng(seed)
    centers = np.stack([rng.uniform(-HALF_X, HALF_X, count),
                        rng.uniform(0.05, HEIGHT, count),
                        rng.uniform(-HALF_Z, HALF_Z, count)], axis=1)
    # мелких больше, чем крупных
    radius = RADIUS[0] + (RADIUS[1] - RADIUS[0]) * rng.random(count) ** 3
    octa = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], dtype=np.float64)
    faces = np.array([[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
                      [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]], dtype=np.uint32)
    pos = (centers[:, None, :] + octa[None, :, :] * radius[:, None, None]).reshape(-1, 3).astype(np.float32)
    idx = (faces[None, :, :] + (np.arange(count, dtype=np.uint32) * 6)[:, None, None]).reshape(-1)
    col = np.zeros((count, 4), dtype=np.uint8)
    col[:, 0] = rng.integers(0, 256, count)                       # фаза
    col[:, 1] = (rng.random(count) ** 2 * 255).astype(np.uint8)    # яркость
    col[:, 3] = 255
    col = np.repeat(col, 6, axis=0)
    return pos, col, idx


def write_glb(path, pos, col, idx):
    blobs = [pos.tobytes(), col.tobytes(), idx.astype(np.uint32).tobytes()]
    views, off = [], 0
    for b in blobs:
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b)})
        off += len(b)
    binary = b"".join(blobs)
    doc = {
        "asset": {"version": "2.0", "generator": "live-aquarium make_marine_snow.py"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "MarineSnow"}],
        "meshes": [{"name": "MarineSnow", "primitives": [{
            "attributes": {"POSITION": 0, "COLOR_0": 1}, "indices": 2, "material": 0}]}],
        "materials": [{"name": "MarineSnow", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1]}}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3",
             "min": pos.min(axis=0).tolist(), "max": pos.max(axis=0).tolist()},
            {"bufferView": 1, "componentType": 5121, "normalized": True, "count": len(col), "type": "VEC4"},
            {"bufferView": 2, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
        ],
    }
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    binary += b"\0" * ((4 - len(binary) % 4) % 4)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(binary), 0x004E4942) + binary)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else OUT
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 6000
    p, c, i = build(n)
    write_glb(out, p, c, i)
    print("{}: {} particles, {} triangles".format(os.path.abspath(out), n, len(i) // 3))
