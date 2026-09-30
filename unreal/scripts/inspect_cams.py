"""Временные камеры Tmp_<метка> для осмотра групп актёров (сканы рифа, рыбы).

Список меток-префиксов — в Saved/lt_inspect.txt через запятую (по умолчанию все Reef_*).
Камера смотрит на общий габарит группы в три четверти сверху; build_scene.py их убирает.
Запуск: python ue_remote.py inspect_cams.py, затем shots.ps1 -Cams Tmp_...
"""
import math
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402
import lt_common  # noqa: E402
importlib.reload(lt_common)  # редактор держит модули между запусками
from lt_common import actors, log, setp, spawn

SAVED = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir())
LIST = os.path.join(SAVED, "lt_inspect.txt")

all_actors = actors.get_all_level_actors()
for a in all_actors:
    if a.get_actor_label().startswith("Tmp_"):
        actors.destroy_actor(a)

prefixes = []
if os.path.exists(LIST):
    with open(LIST, encoding="utf-8-sig") as f:
        prefixes = [x.strip() for x in f.read().split(",") if x.strip()]
if not prefixes:
    prefixes = sorted({a.get_actor_label().rsplit("_", 1)[0] for a in all_actors
                       if a.get_actor_label().startswith("Reef_")})

names = []
for p in prefixes:
    group = [a for a in all_actors if a.get_actor_label() == p or a.get_actor_label().startswith(p + "_")]
    if not group:
        log("inspect: nothing for " + p)
        continue
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for a in group:
        o, e = a.get_actor_bounds(False)
        for i, (c, x) in enumerate(((o.x, e.x), (o.y, e.y), (o.z, e.z))):
            lo[i] = min(lo[i], c - x)
            hi[i] = max(hi[i], c + x)
    c = [(lo[i] + hi[i]) / 2 for i in range(3)]
    size = max(hi[i] - lo[i] for i in range(3))
    dist = max(size * 1.4, 120.0)
    # три четверти со стороны камеры общего плана (-X), чуть сверху
    yaw = math.radians(200.0)
    cam_loc = (c[0] + dist * math.cos(yaw), c[1] + dist * math.sin(yaw), c[2] + dist * 0.45)
    d = [c[i] - cam_loc[i] for i in range(3)]
    rot = (0, math.degrees(math.atan2(d[2], math.hypot(d[0], d[1]))), math.degrees(math.atan2(d[1], d[0])))
    name = "Tmp_" + p
    cam = spawn(unreal.CineCameraActor, name, cam_loc, rot)
    cc = cam.get_cine_camera_component()
    setp(cc, current_focal_length=35.0, current_aperture=8.0)
    fs = cc.focus_settings
    fs.focus_method = unreal.CameraFocusMethod.MANUAL
    fs.manual_focus_distance = math.sqrt(sum(x * x for x in d))
    cc.set_editor_property("focus_settings", fs)
    names.append(name)
    log("inspect {}: {} actors, size {:.0f} cm".format(p, len(group), size))
log("inspect cams: " + ",".join(names))
