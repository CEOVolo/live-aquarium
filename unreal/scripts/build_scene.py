"""Сцена пробы: уголок рифа 20 x 10 м, вода, свет, камеры, рыбы.

Пересобирает уровень /Game/LookTest/Maps/Reef с нуля. Сначала: import_fish.py, build_materials.py.
Запуск: run.ps1 build_scene.py

Оси: X — от камеры вглубь рифа, Y — вдоль «стекла», Z — вверх. Единицы — сантиметры.
"""
import math
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402
import lt_common  # noqa: E402
importlib.reload(lt_common)  # редактор держит модули между запусками
from lt_common import MAP, MAT_DIR, WATER_HORIZON, actors, color, levels, log, setp, spawn

FISH = "/Game/LookTest/Fish"
SHARK = FISH + "/great_white/great_white/SkeletalMeshes/"
GOLD = FISH + "/ryukin_goldfish/ryukin_goldfish/SkeletalMeshes/"
CLOWN = FISH + "/clownfish/clownfish/StaticMeshes/"

ROCKS = "/Game/LookTest/Rocks/"
REEF = "/Game/LookTest/Reef/"

# Размеры сцены
REEF_X, REEF_Y = 2000.0, 1000.0
WATER_DENSITY = 2.0


def load(path):
    a = unreal.load_asset(path)
    if a is None:
        raise RuntimeError("asset not found: " + path)
    return a


def mesh_length(mesh):
    """Самая длинная ось bounding box — длина рыбы (см)."""
    e = mesh.get_bounds().box_extent
    return 2.0 * max(e.x, e.y, e.z)


# --- уровень -------------------------------------------------------------------

def new_level():
    """Пустой уровень MAP: новый или существующий, очищенный от всех актёров."""
    if unreal.EditorAssetLibrary.does_asset_exist(MAP):
        levels.load_level(MAP)
        for a in actors.get_all_level_actors():
            actors.destroy_actor(a)
    else:
        levels.new_level(MAP)


# --- вода и свет ---------------------------------------------------------------

def water_and_light():
    # «Солнце»: светит сверху сквозь поверхность, каустики — light function.
    sun = spawn(unreal.DirectionalLight, "Sun", (0, 0, 2000), (0, -68, 25))
    lc = sun.light_component
    # на глубине 5-10 м красное уже поглощено толщей воды — свет сине-зелёный
    lc.set_intensity(10.0)
    lc.set_light_color(color(0.62, 0.88, 1.0))
    setp(lc, volumetric_scattering_intensity=3.0, cast_shadows=True,
         light_function_scale=unreal.Vector(1, 1, 1))
    lc.set_light_function_material(unreal.load_asset(MAT_DIR + "/M_Caustics"))
    setp(lc, disabled_brightness=0.35)

    # Рассеянный свет толщи воды. Нижняя полусфера — тёмная сине-зелёная.
    sky = spawn(unreal.SkyLight, "WaterAmbient", (0, 0, 800))
    sc = sky.light_component
    setp(sc, real_time_capture=True, source_type=unreal.SkyLightSourceType.SLS_CAPTURED_SCENE,
         lower_hemisphere_is_black=True, lower_hemisphere_color=color(0.0, 0.02, 0.03),
         intensity=1.0)

    # Вода = плотный экспоненциальный туман + объёмный туман (лучи, поглощение).
    # Плотность в UE — на 1000 см: WATER_DENSITY 2.0 ≈ ослабление в e раз на ~5 м, видимость ~15 м.
    # Высота тумана z=600 (поверхность ~6 м над дном), ниже — гуще.
    fog = spawn(unreal.ExponentialHeightFog, "Water", (0, 0, 600))
    fc = fog.component
    setp(fc, fog_density=WATER_DENSITY, fog_height_falloff=0.08, start_distance=0.0,
         fog_max_opacity=1.0, enable_volumetric_fog=True,
         volumetric_fog_albedo=unreal.Color(r=60, g=170, b=190, a=255),
         volumetric_fog_extinction_scale=1.0,
         volumetric_fog_scattering_distribution=0.75,
         volumetric_fog_distance=3000.0,
         volumetric_fog_start_distance=0.0)
    # имя свойства цвета в разных версиях разное
    for prop in ("fog_inscattering_luminance", "fog_inscattering_color"):
        try:
            fc.set_editor_property(prop, WATER_HORIZON)
            break
        except Exception:
            pass

    # Купол «неба» воды (M_WaterSky, IsSky): его захватывает SkyLight как рассеянный свет толщи.
    dome = spawn(unreal.StaticMeshActor, "WaterSkyDome", (0, 0, 0))
    dc = dome.static_mesh_component
    dc.set_static_mesh(load("/Engine/BasicShapes/Sphere"))
    dc.set_material(0, load(MAT_DIR + "/M_WaterSky"))
    dome.set_actor_scale3d(unreal.Vector(4000, 4000, 4000))  # 4 км в диаметре
    setp(dc, cast_shadow=False, affect_distance_field_lighting=False,
         collision_enabled=unreal.CollisionEnabled.NO_COLLISION)

    # Постобработка: ручная экспозиция (стабильная картинка для стрима), мягкий bloom, зерно.
    ppv = spawn(unreal.PostProcessVolume, "Post", (0, 0, 0))
    ppv.set_editor_property("unbound", True)
    s = ppv.settings
    setp(s,
         override_auto_exposure_method=True, auto_exposure_method=unreal.AutoExposureMethod.AEM_MANUAL,
         override_auto_exposure_bias=True, auto_exposure_bias=0.0,
         override_auto_exposure_apply_physical_camera_exposure=True,
         auto_exposure_apply_physical_camera_exposure=False,
         override_bloom_intensity=True, bloom_intensity=0.35,
         override_bloom_threshold=True, bloom_threshold=1.0,
         override_film_grain_intensity=True, film_grain_intensity=0.12,
         override_vignette_intensity=True, vignette_intensity=0.45,
         override_scene_fringe_intensity=True, scene_fringe_intensity=0.4,
         override_white_temp=True, white_temp=7200.0)
    ppv.set_editor_property("settings", s)


# --- дно -----------------------------------------------------------------------

def seabed():
    plane = load("/Engine/BasicShapes/Plane")
    floor = spawn(unreal.StaticMeshActor, "Seabed", (0, 0, 0))
    smc = floor.static_mesh_component
    smc.set_static_mesh(plane)
    # запас за пределами рифа, чтобы край дна не попадал в кадр
    floor.set_actor_scale3d(unreal.Vector(REEF_X * 2.5 / 100, REEF_Y * 4 / 100, 1))
    smc.set_material(0, load(MAT_DIR + "/M_Sand"))


def rock(label, name, loc, yaw=0.0, scale=1.0, tilt=(0.0, 0.0)):
    mesh = load("{0}{1}/{1}_2k/StaticMeshes/{1}_2k".format(ROCKS, name))
    a = spawn(unreal.StaticMeshActor, label, loc, (tilt[0], tilt[1], yaw))
    a.static_mesh_component.set_static_mesh(mesh)
    a.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    return a


def scan_meshes(name):
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    return [a.get_asset() for a in ar.get_assets_by_path(REEF + name, recursive=True)
            if str(a.asset_class_path.asset_name) == "StaticMesh"]


def reef_piece(label, name, loc, yaw=0.0, size_m=None, sink_cm=5.0):
    """Скан рифа из кусков: все куски — в одной точке (у них общие координаты скана).

    Общий габарит считается по кускам; скан ставится центром по XY и низом на дно в loc.
    size_m — вписать по большей горизонтальной стороне (иначе натуральный размер).
    """
    meshes = scan_meshes(name)
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for m in meshes:
        b = m.get_bounds()
        o, e = b.origin, b.box_extent
        for i, (c, x) in enumerate(((o.x, e.x), (o.y, e.y), (o.z, e.z))):
            lo[i] = min(lo[i], c - x)
            hi[i] = max(hi[i], c + x)
    size = [hi[i] - lo[i] for i in range(3)]
    k = (size_m * 100.0 / max(size[0], size[1])) if size_m else 1.0
    # опорная точка скана: центр по XY, низ по Z — повернуть на yaw и масштабировать
    cx, cy, cz = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]
    a = math.radians(yaw)
    ox = (cx * math.cos(a) - cy * math.sin(a)) * k
    oy = (cx * math.sin(a) + cy * math.cos(a)) * k
    at = (loc[0] - ox, loc[1] - oy, loc[2] - cz * k - sink_cm)
    first = None
    for i, m in enumerate(meshes):
        act = spawn(unreal.StaticMeshActor, "{}_{:02d}".format(label, i), at, (0, 0, yaw))
        act.static_mesh_component.set_static_mesh(m)
        act.set_actor_scale3d(unreal.Vector(k, k, k))
        if first is None:
            first = act
        else:
            act.attach_to_actor(first, "", unreal.AttachmentRule.KEEP_WORLD,
                                unreal.AttachmentRule.KEEP_WORLD, unreal.AttachmentRule.KEEP_WORLD)
    log("{} ({}): {} pieces, natural {:.0f} x {:.0f} x {:.0f} cm, scale {:.2f}".format(
        label, name, len(meshes), size[0], size[1], size[2], k))
    return first


def reef():
    """Риф из фотосканов (Sketchfab, CC BY). Центр композиции — большой скан рифа."""
    # sink_cm: сканы захватили кусок дна («подол») — утапливаем его в песок
    reef_piece("Reef_Main", "reef_photogrammetry", (750, 0, 0), yaw=0, size_m=8.0, sink_cm=45)
    reef_piece("Reef_Outcrop", "reef_outcrop", (350, -520, 0), yaw=30, size_m=4.0, sink_cm=30)
    reef_piece("Reef_BarrelLedge", "barrel_sponge", (850, 600, 0), yaw=200, size_m=4.5, sink_cm=20)
    reef_piece("Reef_Elkhorn", "elkhorn_coral", (320, 380, 0), yaw=60, size_m=2.6, sink_cm=15)
    reef_piece("Reef_Stovepipe", "stovepipe_sponge", (480, 180, 0), yaw=0, size_m=1.6)
    reef_piece("Reef_GreatStar", "great_star_coral", (-80, -300, 0), yaw=120, size_m=1.6, sink_cm=25)
    reef_piece("Reef_Brain", "brain_coral", (-250, 180, 0), yaw=0, size_m=1.2)
    reef_piece("Reef_Lettuce", "lettuce_coral", (80, 120, 0), yaw=300, size_m=1.3)


def rocks():
    """Камни Poly Haven по краям рифа."""
    rock("ReefBase_C", "coast_rocks_05", (150, 650, -20), yaw=260, scale=0.8)
    # валуны (1.8 м)
    rock("Boulder_A", "boulder_01", (-120, -460, -15), yaw=40, scale=1.0)
    rock("Boulder_B", "boulder_01", (260, 120, -20), yaw=200, scale=0.7)
    rock("Boulder_C", "boulder_01", (950, -60, -30), yaw=95, scale=1.7)
    # дальний каменистый склон — уходит в синеву
    rock("FarSlope", "coast_rocks_02", (2300, 0, -80), yaw=0, scale=0.6)


# --- рыбы ----------------------------------------------------------------------

def skeletal_fish(label, mesh_path, anim_path, length_cm, loc, yaw, pitch=0.0, parts=()):
    """Скелетная рыба с зацикленной анимацией.

    parts — дополнительные меши на том же скелете (золотая рыбка разбита на куски):
    каждый — свой актёр, прикреплённый к телу, с той же анимацией.
    """
    mesh = load(mesh_path)
    anim = load(anim_path)
    k = length_cm / mesh_length(mesh)
    body = None
    for i, m in enumerate([mesh] + [load(p) for p in parts]):
        a = spawn(unreal.SkeletalMeshActor, label if i == 0 else "{}_part{}".format(label, i),
                  loc, (0, pitch, yaw))
        a.set_actor_scale3d(unreal.Vector(k, k, k))
        c = a.skeletal_mesh_component
        c.set_skinned_asset_and_update(m)
        c.set_editor_property("animation_mode", unreal.AnimationMode.ANIMATION_SINGLE_NODE)
        c.set_editor_property("animation_data", unreal.SingleAnimationPlayData(
            anim_to_play=anim, saved_looping=True, saved_playing=True, saved_position=0.0,
            saved_play_rate=1.0))
        c.set_update_animation_in_editor(True)
        if body is None:
            body = a
        else:
            a.attach_to_actor(body, "", unreal.AttachmentRule.KEEP_WORLD,
                              unreal.AttachmentRule.KEEP_WORLD, unreal.AttachmentRule.KEEP_WORLD)
    log("{}: mesh {:.0f} cm -> scale {:.3f}, parts {}".format(label, mesh_length(mesh), k, len(parts)))
    return body


def static_fish(label, mesh_paths, length_cm, loc, yaw, pitch=0.0):
    meshes = [load(p) for p in mesh_paths]
    size = max(mesh_length(m) for m in meshes)
    k = length_cm / size
    first = None
    for i, m in enumerate(meshes):
        a = spawn(unreal.StaticMeshActor, "{}_{}".format(label, i), loc, (0, pitch, yaw))
        a.static_mesh_component.set_static_mesh(m)
        a.set_actor_scale3d(unreal.Vector(k, k, k))
        if first is None:
            first = a
        else:
            a.attach_to_actor(first, "", unreal.AttachmentRule.KEEP_WORLD,
                              unreal.AttachmentRule.KEEP_WORLD, unreal.AttachmentRule.KEEP_WORLD)
    return first


def fish():
    # Большая белая ~4.5 м, проходит поперёк кадра на среднем плане.
    skeletal_fish("GreatWhite", SHARK + "great_white", SHARK + "great_whiteswimming",
                  450, (700, -150, 260), yaw=0)

    # Золотая рыбка (редкий гость) ~22 см.
    gold_parts = [GOLD + n for n in ("Object_16", "Object_18", "Object_20", "Object_22", "Object_24",
                                     "Object_80", "Object_82", "Object_84", "Object_86")]
    skeletal_fish("Goldfish", GOLD + "Object_14", GOLD + "ryukin_goldfish_Anim",
                  22, (-350, 120, 110), yaw=200, parts=gold_parts)

    # Клоуны ~10 см, группка у дна (анемона появится вместе со сканами).
    clown = [CLOWN + "defaultMaterial_ea81d87f7946c9e896f7f6a321736db5", CLOWN + "defaultMaterial"]
    for i, (x, y, z, yaw) in enumerate([(-420, -60, 60, 30), (-440, -20, 75, 160), (-400, -100, 50, 250)]):
        static_fish("Clown%d" % i, clown, 10, (x, y, z), yaw)


# --- камеры --------------------------------------------------------------------

def camera(label, loc, look_at, focal=24.0, focus=None):
    d = unreal.Vector(look_at[0] - loc[0], look_at[1] - loc[1], look_at[2] - loc[2])
    yaw = math.degrees(math.atan2(d.y, d.x))
    pitch = math.degrees(math.atan2(d.z, math.hypot(d.x, d.y)))
    cam = spawn(unreal.CineCameraActor, label, loc, (0, pitch, yaw))
    cc = cam.get_cine_camera_component()
    setp(cc, current_focal_length=focal, current_aperture=2.8)
    fs = cc.focus_settings
    fs.focus_method = unreal.CameraFocusMethod.MANUAL
    fs.manual_focus_distance = focus or d.length()
    cc.set_editor_property("focus_settings", fs)
    return cam


def cameras():
    camera("Cam_Wide", (-900, 0, 180), (600, 0, 150), focal=20.0, focus=1200)
    camera("Cam_Shark", (250, -700, 240), (700, -150, 260), focal=35.0)
    camera("Cam_Clowns", (-560, -40, 90), (-420, -60, 62), focal=50.0)
    camera("Cam_Gold", (-460, 160, 120), (-350, 120, 110), focal=50.0)


new_level()
water_and_light()
seabed()
rocks()
reef()
fish()
cameras()
levels.save_current_level()
log("scene built: " + MAP)
