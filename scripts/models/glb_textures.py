"""Извлечь текстуры из GLB — посмотреть атласы фотосканов.

  python scripts/models/glb_textures.py model.glb out_dir
"""
import io
import json
import os
import struct
import sys

from PIL import Image


def read_glb(path):
    data = open(path, "rb").read()
    magic, _version, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    off, chunks = 12, []
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunks.append(data[off + 8:off + 8 + clen])
        off += 8 + clen
    return json.loads(chunks[0].decode("utf-8")), (chunks[1] if len(chunks) > 1 else b"")


def extract(src, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    doc, binary = read_glb(src)
    for n, img in enumerate(doc.get("images", [])):
        bv = doc["bufferViews"][img["bufferView"]]
        raw = binary[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        ext = ".png" if img.get("mimeType") == "image/png" else ".jpg"
        path = os.path.join(out_dir, "image{}{}".format(n, ext))
        open(path, "wb").write(raw)
        print(path, Image.open(io.BytesIO(raw)).size)


if __name__ == "__main__":
    extract(*sys.argv[1:3])
