"""Импорт рыб из assets/models/raw/ (glTF через Interchange).

Запуск (все рыбы или перечисленные через LOOKTEST_FISH=a,b):
  UnrealEditor-Cmd.exe LiveAquarium.uproject -run=pythonscript -script=unreal/scripts/import_fish.py
"""
import os
import unreal

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(REPO, "assets", "models", "raw")

# путь от assets/models/raw без .glb; fish/* — скачанные fetch_sketchfab.ps1 -Folder fish
FISH = ["great_white", "ryukin_goldfish", "clownfish",
        "fish/damselfish", "fish/french_angelfish", "fish/blue_tang"]
DEST_ROOT = "/Game/LookTest/Fish"


def make_pipeline():
    # Модели Sketchfab разбиты на куски (тело, плавники, глаза) — статические собираем в один меш.
    # Скелетные и так объединяются по скелету; у золотой рыбки части висят на разных узлах
    # и остаются отдельными — в сцене они ведомые у тела (leader pose).
    p = unreal.InterchangeGenericAssetsPipeline()
    p.mesh_pipeline.set_editor_property(
        "combine_static_meshes_behavior", unreal.InterchangeCombineStaticMeshesBehavior.ALL)
    return p


def import_glb(rel):
    name = rel.rsplit("/", 1)[-1]
    dest = DEST_ROOT + "/" + name
    if unreal.EditorAssetLibrary.does_directory_exist(dest):
        unreal.EditorAssetLibrary.delete_directory(dest)
    task = unreal.AssetImportTask()
    task.filename = os.path.join(RAW, *rel.split("/")) + ".glb"
    task.destination_path = dest
    task.automated = True
    task.replace_existing = True
    task.save = True
    task.options = make_pipeline()
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    return task.imported_object_paths or []


def describe(path):
    asset = unreal.load_asset(path)
    if asset is None:
        return path + "  (not loaded)"
    info = "{}  [{}]".format(path, asset.get_class().get_name())
    if isinstance(asset, (unreal.StaticMesh, unreal.SkeletalMesh)):
        b = asset.get_bounds()
        info += "  size(cm) {:.1f} x {:.1f} x {:.1f}".format(
            b.box_extent.x * 2, b.box_extent.y * 2, b.box_extent.z * 2)
    if isinstance(asset, unreal.AnimSequence):
        info += "  length {:.2f}s".format(unreal.AnimationLibrary.get_sequence_length(asset))
    return info


def materials_of(path):
    a = unreal.load_asset(path)
    if isinstance(a, unreal.MaterialInstance):
        parent = a.get_editor_property("parent")
        return "{} <- {}".format(a.get_name(), parent.get_name() if parent else None)
    return None


# только часть: Saved/lt_fish.txt со списком через запятую (как в FISH)
lst = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir()), "lt_fish.txt")
wanted = None
if os.path.exists(lst):
    with open(lst, encoding="utf-8-sig") as f:
        wanted = [x.strip() for x in f.read().split(",") if x.strip()]
for fish in (wanted or FISH):
    paths = import_glb(fish)
    unreal.log("LOOKTEST import {}: {} objects".format(fish, len(paths)))
    for p in paths:
        if "/Textures/" in p:
            continue
        info = materials_of(p) if "/Materials/" in p else describe(p)
        if info:
            unreal.log("LOOKTEST   " + info)
