"""Импорт окружения: CC0-текстуры (assets/textures/raw/) и камни Poly Haven (assets/models/raw/polyhaven/).

Сначала scripts/assets/fetch_polyhaven.ps1. Запуск: python ue_remote.py import_env.py
"""
import glob
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402
import lt_common  # noqa: E402
importlib.reload(lt_common)  # редактор держит модули между запусками
from lt_common import REPO, asset_tools, log

TEX_SRC = os.path.join(REPO, "assets", "textures", "raw")
ROCK_SRC = os.path.join(REPO, "assets", "models", "raw", "polyhaven")
TEX_DEST = "/Game/LookTest/Textures"
ROCK_DEST = "/Game/LookTest/Rocks"


def run(tasks):
    asset_tools.import_asset_tasks(tasks)
    return [p for t in tasks for p in (t.imported_object_paths or [])]


def task(src, dest, options=None):
    t = unreal.AssetImportTask()
    t.filename = src
    t.destination_path = dest
    t.automated = True
    t.replace_existing = True
    t.save = True
    if options is not None:
        t.options = options
    return t


def fix_texture(path):
    """Нормали Poly Haven — OpenGL (зелёный вверх): переворачиваем. ARM и высота — линейные."""
    tex = unreal.load_asset(path)
    if not isinstance(tex, unreal.Texture2D):
        return
    name = path.rsplit("/", 1)[-1].lower()
    if "_nor_gl" in name:
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        tex.set_editor_property("srgb", False)
        tex.set_editor_property("flip_green_channel", True)
    elif "_arm" in name or "_disp" in name:
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
        tex.set_editor_property("srgb", False)
    unreal.EditorAssetLibrary.save_loaded_asset(tex)


def import_textures():
    tasks = []
    for d in sorted(glob.glob(os.path.join(TEX_SRC, "*"))):
        for f in sorted(glob.glob(os.path.join(d, "*.jpg"))):
            tasks.append(task(f, TEX_DEST + "/" + os.path.basename(d)))
    paths = run(tasks)
    for p in paths:
        fix_texture(p)
    log("textures: {}".format(len(paths)))


def import_rocks():
    for d in sorted(glob.glob(os.path.join(ROCK_SRC, "*"))):
        gltf = glob.glob(os.path.join(d, "*.gltf"))
        if not gltf:
            continue
        name = os.path.basename(d)
        p = unreal.InterchangeGenericAssetsPipeline()
        p.mesh_pipeline.set_editor_property(
            "combine_static_meshes_behavior", unreal.InterchangeCombineStaticMeshesBehavior.ALL)
        p.mesh_pipeline.set_editor_property("build_nanite", True)
        paths = run([task(gltf[0], ROCK_DEST + "/" + name, p)])
        for path in paths:
            fix_texture(path)
            a = unreal.load_asset(path)
            if isinstance(a, unreal.StaticMesh):
                e = a.get_bounds().box_extent
                log("rock {}: {} ({:.0f} x {:.0f} x {:.0f} cm)".format(
                    name, path, e.x * 2, e.y * 2, e.z * 2))


import_textures()
import_rocks()
