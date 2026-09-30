"""Кадры 1920x1080 со всех камер Cam_* уровня пробы (в открытом редакторе).

Запуск: python ue_remote.py render_shots.py, затем ждать файл-метку
  unreal/LiveAquarium/Saved/Screenshots/lt_done.txt
Кадры: unreal/LiveAquarium/Saved/Screenshots/WindowsEditor/lt_<камера>.png
Только часть камер: файл Saved/lt_cams.txt со списком через запятую.
"""
import os
import sys
import time

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402
import lt_common  # noqa: E402
importlib.reload(lt_common)  # редактор держит модули между запусками
from lt_common import MAP, actors, levels, log

WARMUP_S = 10.0    # Lumen, объёмный туман и стриминг текстур сходятся не сразу
SHOT_DELAY_S = 3.0
TIMEOUT_S = 1800.0

SAVED = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir())
DONE = os.path.join(SAVED, "Screenshots", "lt_done.txt")
CAMS_FILE = os.path.join(SAVED, "lt_cams.txt")

if os.path.exists(DONE):
    os.remove(DONE)

world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
if world is None or world.get_path_name().split(".")[0] != MAP:
    levels.load_level(MAP)

wanted = []
if os.path.exists(CAMS_FILE):
    with open(CAMS_FILE, encoding="utf-8-sig") as f:  # PowerShell пишет UTF-8 с BOM
        wanted = [c.strip() for c in f.read().split(",") if c.strip()]
cams = sorted((a for a in actors.get_all_level_actors() if isinstance(a, unreal.CineCameraActor)
               and (not wanted or a.get_actor_label() in wanted)), key=lambda a: a.get_actor_label())
log("cameras: " + ", ".join(c.get_actor_label() for c in cams))

state = {"t0": time.time(), "i": 0, "task": None, "busy": False, "handle": None}

# Прошлый запуск мог зависнуть — снимаем его обработчик (хранится между запусками в builtins).
import builtins  # noqa: E402
if getattr(builtins, "_lt_shots_handle", None) is not None:
    unreal.unregister_slate_post_tick_callback(builtins._lt_shots_handle)
    builtins._lt_shots_handle = None


def finish(msg):
    unreal.unregister_slate_post_tick_callback(state["handle"])
    builtins._lt_shots_handle = None
    log(msg)
    os.makedirs(os.path.dirname(DONE), exist_ok=True)
    with open(DONE, "w", encoding="utf-8") as f:
        f.write(msg + "\n")


def tick(dt):
    if state["busy"]:
        return
    state["busy"] = True
    try:
        # вьюпорт не в realtime-режиме перерисовывается только по запросу — снимок иначе не случится
        levels.editor_invalidate_viewports()
        now = time.time()
        if now - state["t0"] > TIMEOUT_S:
            finish("timeout")
        elif now - state["t0"] < WARMUP_S:
            pass
        elif state["task"] is not None and not state["task"].is_task_done():
            pass
        elif state["i"] >= len(cams):
            finish("shots done")
        else:
            cam = cams[state["i"]]
            name = "lt_" + cam.get_actor_label()
            state["task"] = unreal.AutomationLibrary.take_high_res_screenshot(
                1920, 1080, name, camera=cam, delay=SHOT_DELAY_S, force_game_view=True)
            log("shot " + name)
            state["i"] += 1
    finally:
        state["busy"] = False


state["handle"] = unreal.register_slate_post_tick_callback(tick)
builtins._lt_shots_handle = state["handle"]
