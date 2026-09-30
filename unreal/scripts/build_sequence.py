"""Секвенция ролика пробы (LS_LookTest): планы камер, пролёт и бросок акулы.

Сначала build_scene.py. Запуск: python ue_remote.py build_sequence.py
Рендер — render_movie.py.
"""
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402
import lt_common  # noqa: E402
importlib.reload(lt_common)  # редактор держит модули между запусками
from lt_common import actors, asset_tools, log

SEQ_DIR = "/Game/LookTest/Cinematics"
SEQ_NAME = "LS_LookTest"
FPS = 30
SHARK = "/Game/LookTest/Fish/great_white/great_white/SkeletalMeshes/great_white"

# планы: камера, начало и конец (кадры), смещение камеры за план (см) — медленный наезд
SHOTS = [
    ("Cam_Wide", 0, 300, None),
    ("Cam_School", 300, 480, (60, 35, 5)),
    ("Cam_Reef", 480, 690, (80, 30, 0)),
    ("Cam_Bite", 690, 900, None),
    ("Cam_Gold", 900, 1080, (15, -8, 0)),
]
END = SHOTS[-1][2]

# акула: кадр -> (x, y, z опорной точки, курс yaw). Локальный нос модели — +Y: yaw 0 — плывёт по +Y,
# 90 — по -X. Опорная точка — середина тела: пасть на ~178 см впереди и на 26 см выше неё.
SHARK_KEYS = [
    (0, (650, -900, 430, 0)),
    (300, (650, 900, 430, 0)),
    (688, (650, 900, 430, 0)),          # за кадром, пока идут другие планы
    (689, (1600, 150, 260, 90)),        # вне кадра, в глубине перед Cam_Bite
    (870, (420, -35, 145, 90)),         # пасть ~1.8 м от камеры
    (900, (378, -40, 139, 90)),         # пасть ~1.4 м перед объективом, чуть ниже его
]
BITE_START = 858   # анимация укуса (1 с) — пасть раскрывается к концу плана


def fn(f):
    return unreal.FrameNumber(int(f))


def find(label):
    for a in actors.get_all_level_actors():
        if a.get_actor_label() == label:
            return a
    raise RuntimeError("actor not found: " + label)


def new_sequence():
    path = SEQ_DIR + "/" + SEQ_NAME
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    seq = asset_tools.create_asset(SEQ_NAME, SEQ_DIR, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    seq.set_display_rate(unreal.FrameRate(FPS, 1))
    seq.set_tick_resolution(unreal.FrameRate(FPS, 1))
    seq.set_playback_start(0)
    seq.set_playback_end(END)
    return seq


def binding_id(seq, binding):
    try:
        return unreal.MovieSceneSequenceExtensions.get_portable_binding_id(seq, seq, binding)
    except Exception:
        return seq.get_binding_id(binding)


def transform_section(binding, start, end):
    track = binding.add_track(unreal.MovieScene3DTransformTrack)
    sec = track.add_section()
    sec.set_range(start, end)
    return sec.get_all_channels()   # loc x y z, rot x(roll) y(pitch) z(yaw), scale x y z


def key(channels, frame, loc=None, rot=None):
    if loc is not None:
        for c, v in zip(channels[0:3], loc):
            c.add_key(fn(frame), float(v), interpolation=unreal.MovieSceneKeyInterpolation.AUTO)
    if rot is not None:
        for c, v in zip(channels[3:6], rot):
            c.add_key(fn(frame), float(v), interpolation=unreal.MovieSceneKeyInterpolation.AUTO)


def camera_cuts(seq):
    cut_track = seq.add_track(unreal.MovieSceneCameraCutTrack)
    for label, start, end, dolly in SHOTS:
        cam = find(label)
        b = seq.add_possessable(cam)
        sec = cut_track.add_section()
        sec.set_range(start, end)
        sec.set_camera_binding_id(binding_id(seq, b))
        if dolly:
            loc = cam.get_actor_location()
            rot = cam.get_actor_rotation()
            ch = transform_section(b, 0, END)
            r = (rot.roll, rot.pitch, rot.yaw)
            key(ch, start, (loc.x, loc.y, loc.z), r)
            key(ch, end, (loc.x + dolly[0], loc.y + dolly[1], loc.z + dolly[2]), r)
    log("camera cuts: {}".format(len(SHOTS)))


def shark(seq):
    a = find("GreatWhite")
    b = seq.add_possessable(a)
    ch = transform_section(b, 0, END)
    s = a.get_actor_scale3d()
    for frame, (x, y, z, yaw) in SHARK_KEYS:
        key(ch, frame, (x, y, z), (0, 0, yaw))
    for c, v in zip(ch[6:9], (s.x, s.y, s.z)):
        c.add_key(fn(0), v)
    anim_track = b.add_track(unreal.MovieSceneSkeletalAnimationTrack)
    for anim_name, start, end in (("great_whiteswimming", 0, BITE_START), ("great_whitebite", BITE_START, END)):
        sec = anim_track.add_section()
        sec.set_range(start, end)
        params = sec.get_editor_property("params")
        params.set_editor_property("animation", unreal.load_asset(
            SHARK.rsplit("/", 1)[0] + "/" + anim_name))
        sec.set_editor_property("params", params)
    log("shark: {} keys, bite at {:.1f}s".format(len(SHARK_KEYS), BITE_START / FPS))


seq = new_sequence()
camera_cuts(seq)
shark(seq)
unreal.EditorAssetLibrary.save_loaded_asset(seq)
log("sequence {}/{}: {} frames, {:.0f} s".format(SEQ_DIR, SEQ_NAME, END, END / FPS))
