"""Секвенция ролика пробы (LS_LookTest): планы камер, пролёт и бросок акулы.

Сначала build_scene.py. Запуск: python ue_remote.py build_sequence.py
Рендер — render_movie.py.
"""
import math
import os
import random
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402
import lt_common  # noqa: E402
importlib.reload(lt_common)  # редактор держит модули между запусками
from lt_common import FISH_SPECIES, SCHOOLS, actors, asset_tools, log

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


# --- рыбы плывут по маршрутам ---------------------------------------------------
# Маршрут задаёт центр рыбы P(t) (см) по времени t (с); курс — по направлению движения.
# Рыба в сцене — корневой актёр <метка>_00 (остальные куски прикреплены), золотая рыбка — Goldfish.

FISH_KEY_STEP = 5   # ключ каждые 5 кадров, между ними — сглаживание кривых


def group(prefix):
    return [a for a in actors.get_all_level_actors()
            if a.get_actor_label() == prefix or a.get_actor_label().startswith(prefix + "_")]


def group_center(members):
    lo, hi = [1e9] * 3, [-1e9] * 3
    for a in members:
        o, e = a.get_actor_bounds(False)
        for i, (c, x) in enumerate(((o.x, e.x), (o.y, e.y), (o.z, e.z))):
            lo[i], hi[i] = min(lo[i], c - x), max(hi[i], c + x)
    return [(lo[i] + hi[i]) / 2 for i in range(3)]


def rot2(v, deg):
    a = math.radians(deg)
    return (v[0] * math.cos(a) - v[1] * math.sin(a), v[0] * math.sin(a) + v[1] * math.cos(a))


def heading_of(path, t, dt=0.1):
    a, b = path(t - dt), path(t + dt)
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))


def unwrap(prev, deg):
    while deg - prev > 180:
        deg -= 360
    while deg - prev < -180:
        deg += 360
    return deg


def animate_fish(seq, root, members, path, nose_offset=None):
    """Ключи положения и курса корневого актёра рыбы, чтобы центр её габарита шёл по path(t).

    nose_offset — поправка курса вида (FISH_SPECIES: угол оси носа модели); None — курс не менять.
    """
    loc0 = root.get_actor_location()
    yaw0 = root.get_actor_rotation().yaw
    s = root.get_actor_scale3d()
    c = group_center(members)
    # смещение центра от опорной точки — в осях актёра (без поворота)
    local = rot2((c[0] - loc0.x, c[1] - loc0.y), -yaw0)
    dz = c[2] - loc0.z
    b = seq.add_possessable(root)
    ch = transform_section(b, 0, END)
    prev = yaw0
    for frame in range(0, END + 1, FISH_KEY_STEP):
        t = frame / FPS
        p = path(t)
        yaw = yaw0 if nose_offset is None else unwrap(prev, heading_of(path, t) - nose_offset)
        prev = yaw
        off = rot2(local, yaw)
        key(ch, frame, (p[0] - off[0], p[1] - off[1], p[2] - dz), (0, 0, yaw))
    for chan, v in zip(ch[6:9], (s.x, s.y, s.z)):
        chan.add_key(fn(0), v)


def nose_offset(species):
    n = FISH_SPECIES[species]["nose"]
    return math.degrees(math.atan2(n[1], n[0]))


def ellipse_path(center, a, b, period_s, theta_at, t_at, z_amp=20.0, direction=1):
    """Эллипс вокруг center; в момент t_at угол theta_at (град)."""
    w = direction * 2 * math.pi / period_s
    th0 = math.radians(theta_at) - w * t_at

    def path(t):
        th = th0 + w * t
        return (center[0] + a * math.cos(th), center[1] + b * math.sin(th),
                center[2] + z_amp * math.sin(2 * th))
    return path


def school_paths(seq, prefix, place_center, place_heading, route, seed):
    """Стайка: рыбы держат строй (смещения от центра при расстановке), строй поворачивается
    вместе с курсом стаи; у каждой — своё небольшое блуждание."""
    rng = random.Random(seed)
    roots = sorted({a.get_actor_label().rsplit("_", 1)[0] for a in group(prefix)})
    for label in roots:
        members = group(label)
        root = [a for a in members if a.get_actor_label().endswith("_00")][0]
        c = group_center(members)
        offset = (c[0] - place_center[0], c[1] - place_center[1], c[2] - place_center[2])
        ph = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
        amp = rng.uniform(8, 16)

        def path(t, offset=offset, ph=ph, amp=amp):
            p = route(t)
            h = heading_of(route, t)
            o = rot2(offset, h - place_heading)
            return (p[0] + o[0] + amp * math.sin(0.8 * t + ph[0]),
                    p[1] + o[1] + amp * math.sin(0.6 * t + ph[1]),
                    p[2] + offset[2] + 0.5 * amp * math.sin(0.9 * t + ph[2]))
        animate_fish(seq, root, members, path, nose_offset("damselfish"))
    return len(roots)


def fish_life(seq):
    # большая стайка кружит вокруг рифа; на плане Cam_School (кадр 390) — в его кадре
    n0 = school_paths(seq, "School0", SCHOOLS[0][0], SCHOOLS[0][2],
                      ellipse_path((794, -110, 205), 420, 380, 40.0, 150, 390 / FPS), seed=5)
    # малая — у мозгового коралла
    c1 = SCHOOLS[1][0]
    n1 = school_paths(seq, "School1", c1, SCHOOLS[1][2],
                      ellipse_path(c1, 130, 100, 24.0, 0, 0, z_amp=10), seed=6)
    # клоуны снуют маленькими кругами каждый у своего места
    rng = random.Random(7)
    clowns = sorted({a.get_actor_label().rsplit("_", 1)[0] for a in actors.get_all_level_actors()
                     if a.get_actor_label().startswith("Clown")})   # Clown0_00, Clown0_01, Clown1_00...
    for label in clowns:
        members = group(label)
        root = [a for a in members if a.get_actor_label().endswith("_00")][0]
        c = group_center(members)
        animate_fish(seq, root, members,
                     ellipse_path(c, rng.uniform(15, 25), rng.uniform(10, 18), rng.uniform(5, 9),
                                  rng.uniform(0, 360), 0, z_amp=6, direction=rng.choice((1, -1))),
                     nose_offset("clownfish"))
    # французский ангел: большая дуга, на плане Cam_Reef (кадр 585) проходит мимо камеры боком
    ang = group("Angelfish")
    root = [a for a in ang if a.get_actor_label() == "Angelfish_00"][0]
    u = (0.938, 0.346)          # направление взгляда Cam_Reef
    c = group_center(ang)
    r = 220.0
    cc = (c[0] + r * u[0], c[1] + r * u[1])
    w = 2 * math.pi / 45.0
    th0 = math.pi - w * 585 / FPS

    def angel(t):
        th = th0 + w * t
        v = (-u[1], u[0])
        return (cc[0] + r * (math.cos(th) * u[0] + math.sin(th) * v[0]),
                cc[1] + r * (math.cos(th) * u[1] + math.sin(th) * v[1]),
                c[2] + 10 * math.sin(0.4 * t))
    animate_fish(seq, root, ang, angel, nose_offset("french_angelfish"))
    # золотая рыбка медленно дрейфует туда, куда смотрит (влево в кадре Cam_Gold), 6 см/с
    gold = group("Goldfish")
    g = group_center(gold)
    d = (-0.264, -0.964)
    animate_fish(seq, [a for a in gold if a.get_actor_label() == "Goldfish"][0], gold,
                 lambda t: (g[0] + d[0] * 6 * (t - 33), g[1] + d[1] * 6 * (t - 33),
                            g[2] + 3 * math.sin(0.7 * t)))
    log("fish life: schools {} + {}, clowns {}, angelfish, goldfish".format(n0, n1, len(clowns)))


seq = new_sequence()
camera_cuts(seq)
shark(seq)
fish_life(seq)
unreal.EditorAssetLibrary.save_loaded_asset(seq)
log("sequence {}/{}: {} frames, {:.0f} s".format(SEQ_DIR, SEQ_NAME, END, END / FPS))
