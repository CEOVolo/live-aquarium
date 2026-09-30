"""Осмотр статичных рыб: каждая в своей точке без поворота, две камеры (вид вдоль +Y и вдоль +X).

По кадрам определяются локальные оси модели (где нос, где верх) для FISH_SPECIES в build_scene.py.
Актёры и камеры — Tmp_*, build_scene.py их убирает.
Запуск: python ue_remote.py fish_lineup.py, затем shots.ps1 -Cams <список из лога>
"""
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402
import lt_common  # noqa: E402
importlib.reload(lt_common)  # редактор держит модули между запусками
from lt_common import actors, log, setp, spawn

FISH = "/Game/LookTest/Fish/"
SPECIES = ["clownfish", "damselfish", "french_angelfish", "blue_tang"]
SIZE_CM = 40.0

for a in actors.get_all_level_actors():
    if a.get_actor_label().startswith("Tmp_"):
        actors.destroy_actor(a)

ar = unreal.AssetRegistryHelpers.get_asset_registry()
cams = []
for i, name in enumerate(SPECIES):
    meshes = [x.get_asset() for x in ar.get_assets_by_path(FISH + name, recursive=True)
              if str(x.asset_class_path.asset_name) == "StaticMesh"]
    lo, hi = [1e9] * 3, [-1e9] * 3
    for m in meshes:
        b = m.get_bounds()
        for k, (c, e) in enumerate(((b.origin.x, b.box_extent.x), (b.origin.y, b.box_extent.y),
                                    (b.origin.z, b.box_extent.z))):
            lo[k], hi[k] = min(lo[k], c - e), max(hi[k], c + e)
    size = [hi[k] - lo[k] for k in range(3)]
    s = SIZE_CM / max(size)
    center = [(lo[k] + hi[k]) / 2 * s for k in range(3)]
    base = (-2000.0 + i * 300.0, 2000.0, 300.0)   # в стороне от рифа
    at = tuple(base[k] - center[k] for k in range(3))
    for j, m in enumerate(meshes):
        act = spawn(unreal.StaticMeshActor, "Tmp_{}_{:02d}".format(name, j), at)
        act.static_mesh_component.set_static_mesh(m)
        act.set_actor_scale3d(unreal.Vector(s, s, s))
    for view, off, rot in (("Y", (0, -90, 0), (0, 0, 90)), ("X", (-90, 0, 0), (0, 0, 0))):
        cam = spawn(unreal.CineCameraActor, "Tmp_Cam_{}_{}".format(name, view),
                    tuple(base[k] + off[k] for k in range(3)), rot)
        setp(cam.get_cine_camera_component(), current_focal_length=35.0, current_aperture=16.0)
        cams.append(cam.get_actor_label())
    log("{}: {} meshes, local size {:.1f} x {:.1f} x {:.1f}, min {} max {}".format(
        name, len(meshes), size[0], size[1], size[2],
        ["{:.1f}".format(v) for v in lo], ["{:.1f}".format(v) for v in hi]))
log("lineup cams: " + ",".join(cams))
