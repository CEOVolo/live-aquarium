"""Импорт сканов рифа (assets/models/raw/sketchfab/*.glb) как Nanite-меши.

Сначала scripts/assets/fetch_sketchfab.ps1. Запуск: python ue_remote.py import_reef.py
Только часть: файл Saved/lt_reef.txt со списком имён через запятую.
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

SRC = os.path.join(REPO, "assets", "models", "raw", "sketchfab")
DEST = "/Game/LookTest/Reef"
SAVED = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir())


def pipeline():
    p = unreal.InterchangeGenericAssetsPipeline()
    m = p.mesh_pipeline
    m.set_editor_property("combine_static_meshes_behavior", unreal.InterchangeCombineStaticMeshesBehavior.ALL)
    m.set_editor_property("build_nanite", True)
    # сканы — статика; скелет и анимации (если есть в файле) не нужны
    m.set_editor_property("import_skeletal_meshes", False)
    return p


def import_scan(path):
    name = os.path.splitext(os.path.basename(path))[0]
    dest = DEST + "/" + name
    if unreal.EditorAssetLibrary.does_directory_exist(dest):
        unreal.EditorAssetLibrary.delete_directory(dest)
    t = unreal.AssetImportTask()
    t.filename = path
    t.destination_path = dest
    t.automated = True
    t.replace_existing = True
    t.save = True
    t.options = pipeline()
    asset_tools.import_asset_tasks([t])
    for p in t.imported_object_paths or []:
        a = unreal.load_asset(p)
        if isinstance(a, unreal.StaticMesh):
            e = a.get_bounds().box_extent
            tris = a.get_num_triangles(0) if hasattr(a, "get_num_triangles") else -1
            log("reef {}: {} ({:.0f} x {:.0f} x {:.0f} cm, {} tris)".format(
                name, p, e.x * 2, e.y * 2, e.z * 2, tris))


wanted = None
lst = os.path.join(SAVED, "lt_reef.txt")
if os.path.exists(lst):
    with open(lst, encoding="utf-8-sig") as f:
        wanted = [x.strip() for x in f.read().split(",") if x.strip()]
for path in sorted(glob.glob(os.path.join(SRC, "*.glb"))):
    if wanted and os.path.splitext(os.path.basename(path))[0] not in wanted:
        continue
    import_scan(path)
log("reef import done")
