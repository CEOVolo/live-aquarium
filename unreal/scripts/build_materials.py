"""Материалы пробы: каустики (light function солнца) и песок из CC0-текстур.

Сначала import_env.py. Запуск: python ue_remote.py build_materials.py
"""
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402
import lt_common  # noqa: E402
importlib.reload(lt_common)  # редактор держит модули между запусками
from lt_common import (FISH_SPECIES, WATER_HORIZON, asset_tools, color, expr, fish_side, fresh_material,
                       link, log, mel, setp)

MP = unreal.MaterialProperty


# Бесшовные каустики (формула Dave_Hoskins, «Tileable Water Caustic»): сеть ярких линий,
# ячейки ~1/5 тайла. UV — координата в тайлах, T — время.
CAUSTIC_HLSL = """
float2 p = frac(UV) * 6.2831853 - 250.0;
float2 i = p;
float c = 1.0;
const float inten = 0.005;
for (int n = 0; n < 5; n++) {
    float t = T * (1.0 - (3.5 / float(n + 1)));
    i = p + float2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(float2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
}
c /= 5.0;
c = 1.17 - pow(c, 1.4);
return pow(abs(c), 8.0);
"""

# Размер тайла каустик (см) и яркость: свет солнца = FLOOR + GAIN * узор
CAUSTIC_TILE_CM = 350.0
CAUSTIC_FLOOR = 0.3
CAUSTIC_GAIN = 2.2


def custom_input(name):
    ci = unreal.CustomInput()
    ci.set_editor_property("input_name", name)
    return ci


def caustic_layer(m, xy, t, tile, speed, offset, y):
    uv = expr(m, unreal.MaterialExpressionDivide, -900, y, const_b=tile)
    link(xy, "", uv, "A")
    uv2 = expr(m, unreal.MaterialExpressionAdd, -750, y, const_b=offset)
    link(uv, "", uv2, "A")
    tt = expr(m, unreal.MaterialExpressionMultiply, -900, y + 120, const_b=speed)
    link(t, "", tt, "A")
    c = expr(m, unreal.MaterialExpressionCustom, -550, y, code=CAUSTIC_HLSL,
             output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT1, description="Caustic",
             inputs=[custom_input("UV"), custom_input("T")])
    link(uv2, "", c, "UV")
    link(tt, "", c, "T")
    return c


def build_caustics():
    """Каустики — light function солнца: умножает его свет узором.

    Тот же узор проецируется в объёмный туман — лучи в воде получаются «рваными».
    Два слоя разного масштаба и скорости, берём минимум — так сетка тоньше и не повторяется.
    """
    m = fresh_material("M_Caustics", domain=unreal.MaterialDomain.MD_LIGHT_FUNCTION)
    wp = expr(m, unreal.MaterialExpressionWorldPosition, -1300, 0)
    xy = expr(m, unreal.MaterialExpressionComponentMask, -1100, 0, r=True, g=True, b=False, a=False)
    link(wp, "", xy, "")
    t = expr(m, unreal.MaterialExpressionTime, -1300, 250)

    a = caustic_layer(m, xy, t, CAUSTIC_TILE_CM, 0.45, 0.0, 0)
    b = caustic_layer(m, xy, t, CAUSTIC_TILE_CM * 1.37, 0.33, 0.37, 300)
    mn = expr(m, unreal.MaterialExpressionMax, -300, 150)
    link(a, "", mn, "A")
    link(b, "", mn, "B")
    gain = expr(m, unreal.MaterialExpressionMultiply, -150, 150, const_b=CAUSTIC_GAIN)
    link(mn, "", gain, "A")
    base = expr(m, unreal.MaterialExpressionAdd, 0, 150, const_b=CAUSTIC_FLOOR)
    link(gain, "", base, "A")
    mel.connect_material_property(base, "", MP.MP_EMISSIVE_COLOR)
    mel.recompile_material(m)
    unreal.EditorAssetLibrary.save_loaded_asset(m)
    log("material M_Caustics ok")


def build_water_sky():
    """«Небо» под водой для купола (IsSky): его захватывает SkyLight как рассеянный свет толщи воды.

    По направлению взгляда: снизу почти чёрное, по горизонту — цвет тумана воды,
    вверху — светлая бирюза и яркое «окно Снелла» прямо над головой.
    """
    m = fresh_material("M_WaterSky")
    setp(m, shading_model=unreal.MaterialShadingModel.MSM_UNLIT, is_sky=True, two_sided=True)
    cam = expr(m, unreal.MaterialExpressionCameraVectorWS, -1200, 0)   # от пикселя к камере
    view = expr(m, unreal.MaterialExpressionMultiply, -1000, 0, const_b=-1.0)
    link(cam, "", view, "A")
    z = expr(m, unreal.MaterialExpressionComponentMask, -850, 0, r=False, g=False, b=True, a=False)
    link(view, "", z, "")

    deep = expr(m, unreal.MaterialExpressionConstant3Vector, -700, -300, constant=color(0.0, 0.012, 0.02))
    horizon = expr(m, unreal.MaterialExpressionConstant3Vector, -700, -200, constant=WATER_HORIZON)
    top = expr(m, unreal.MaterialExpressionConstant3Vector, -700, -100, constant=color(0.05, 0.28, 0.34))

    # вниз: horizon -> deep
    down = expr(m, unreal.MaterialExpressionSaturate, -700, 100)
    zneg = expr(m, unreal.MaterialExpressionMultiply, -850, 100, const_b=-2.5)
    link(z, "", zneg, "A")
    link(zneg, "", down, "")
    low = expr(m, unreal.MaterialExpressionLinearInterpolate, -500, -250)
    link(horizon, "", low, "A")
    link(deep, "", low, "B")
    link(down, "", low, "Alpha")
    # вверх: -> top (плавно)
    up = expr(m, unreal.MaterialExpressionSaturate, -700, 250)
    link(z, "", up, "")
    upp = expr(m, unreal.MaterialExpressionPower, -550, 250, const_exponent=0.7)
    link(up, "", upp, "Base")
    grad = expr(m, unreal.MaterialExpressionLinearInterpolate, -300, -150)
    link(low, "", grad, "A")
    link(top, "", grad, "B")
    link(upp, "", grad, "Alpha")
    # окно Снелла: узкое яркое пятно в зените
    win = expr(m, unreal.MaterialExpressionPower, -550, 400, const_exponent=24.0)
    link(up, "", win, "Base")
    winc = expr(m, unreal.MaterialExpressionMultiply, -400, 400)
    link(win, "", winc, "A")
    wcol = expr(m, unreal.MaterialExpressionConstant3Vector, -550, 550, constant=color(0.6, 1.2, 1.4))
    link(wcol, "", winc, "B")
    total = expr(m, unreal.MaterialExpressionAdd, -150, 0)
    link(grad, "", total, "A")
    link(winc, "", total, "B")
    mel.connect_material_property(total, "", MP.MP_EMISSIVE_COLOR)
    mel.recompile_material(m)
    unreal.EditorAssetLibrary.save_loaded_asset(m)
    log("material M_WaterSky ok")


SCAN_TINT = color(1.35, 1.0, 0.82)  # снять синеву воды, «впечатанную» в подводные сканы
# сканы, снятые глубже / в более мутной воде, синеют сильнее — своя коррекция
SCAN_TINTS = {
    "reef_photogrammetry": color(1.75, 0.95, 0.7),
    "reef_outcrop": color(1.6, 0.95, 0.75),
}
REEF_DIR = "/Game/LookTest/Reef"


def scalar(m, name, value, x, y):
    return expr(m, unreal.MaterialExpressionScalarParameter, x, y, parameter_name=name, default_value=value)


def scan_ground_mask(m, tex_sample):
    """Вырезать из скана захваченное дно (рваный бирюзовый песок с дырами).

    Отбрасываются пиксели ниже CutZ (см, мировая высота; дно сцены — z=0) и, в зоне ниже KeyZ,
    бирюзовые пиксели песка: (G+B)/2 - R > KeyThreshold по исходной текстуре.
    """
    setp(m, blend_mode=unreal.BlendMode.BLEND_MASKED, opacity_mask_clip_value=0.5)
    wp = expr(m, unreal.MaterialExpressionWorldPosition, -1300, 700)
    z = expr(m, unreal.MaterialExpressionComponentMask, -1150, 700, r=False, g=False, b=True, a=False)
    link(wp, "", z, "")

    def soft_below(limit_param, sharpness, y):
        # 1, когда z < limit (мягкий край в 1/sharpness см)
        d = expr(m, unreal.MaterialExpressionSubtract, -950, y)
        link(limit_param, "", d, "A")
        link(z, "", d, "B")
        k = expr(m, unreal.MaterialExpressionMultiply, -800, y, const_b=sharpness)
        link(d, "", k, "A")
        s = expr(m, unreal.MaterialExpressionSaturate, -650, y)
        link(k, "", s, "")
        return s

    below = soft_below(scalar(m, "CutZ", 8.0, -1150, 800), 0.2, 800)
    low = soft_below(scalar(m, "KeyZ", 70.0, -1150, 950), 0.05, 950)

    def channel(name, y):
        c = expr(m, unreal.MaterialExpressionComponentMask, -950, y,
                 r=name == "r", g=name == "g", b=name == "b", a=False)
        link(tex_sample, "RGB", c, "")
        return c

    r, g, b = channel("r", 1100), channel("g", 1180), channel("b", 1260)
    gb = expr(m, unreal.MaterialExpressionAdd, -800, 1200)
    link(g, "", gb, "A")
    link(b, "", gb, "B")
    half = expr(m, unreal.MaterialExpressionMultiply, -650, 1200, const_b=0.5)
    link(gb, "", half, "A")
    cyan = expr(m, unreal.MaterialExpressionSubtract, -500, 1150)
    link(half, "", cyan, "A")
    link(r, "", cyan, "B")
    thr = expr(m, unreal.MaterialExpressionSubtract, -350, 1150)
    link(cyan, "", thr, "A")
    link(scalar(m, "KeyThreshold", 0.06, -500, 1300), "", thr, "B")
    kk = expr(m, unreal.MaterialExpressionMultiply, -200, 1150, const_b=10.0)
    link(thr, "", kk, "A")
    key = expr(m, unreal.MaterialExpressionSaturate, -50, 1150)
    link(kk, "", key, "")
    low_key = expr(m, unreal.MaterialExpressionMultiply, 100, 1000)
    link(low, "", low_key, "A")
    link(key, "", low_key, "B")
    cut = expr(m, unreal.MaterialExpressionMax, 250, 900)
    link(below, "", cut, "A")
    link(low_key, "", cut, "B")
    keep = expr(m, unreal.MaterialExpressionOneMinus, 400, 900)
    link(cut, "", keep, "")
    mel.connect_material_property(keep, "", MP.MP_OPACITY_MASK)


def build_scan_master():
    """Освещаемый мастер-материал для сканов рифа (Sketchfab отдаёт их как unlit).

    Альбедо = текстура x Tint (снимает синеву), затем насыщенность; шероховатость — константа.
    """
    m = fresh_material("M_Scan")
    setp(m, two_sided=True)
    t = expr(m, unreal.MaterialExpressionTextureSampleParameter2D, -900, 0, parameter_name="BaseColor",
             texture=unreal.load_asset("/Engine/EngineResources/DefaultTexture"))
    tint = expr(m, unreal.MaterialExpressionVectorParameter, -900, 250, parameter_name="Tint",
                default_value=SCAN_TINT)
    mul = expr(m, unreal.MaterialExpressionMultiply, -650, 100)
    link(t, "RGB", mul, "A")
    link(tint, "", mul, "B")
    # насыщенность: lerp(яркость, цвет, Saturation); >1 — насыщеннее
    # (узел Desaturation не годится: его безымянный вход не подключается из Python)
    w = expr(m, unreal.MaterialExpressionConstant3Vector, -650, 250, constant=color(0.3, 0.59, 0.11))
    lum = expr(m, unreal.MaterialExpressionDotProduct, -500, 200)
    link(mul, "", lum, "A")
    link(w, "", lum, "B")
    satp = expr(m, unreal.MaterialExpressionScalarParameter, -500, 320, parameter_name="Saturation",
                default_value=1.15)
    sat = expr(m, unreal.MaterialExpressionLinearInterpolate, -300, 100)
    link(lum, "", sat, "A")
    link(mul, "", sat, "B")
    link(satp, "", sat, "Alpha")
    mel.connect_material_property(sat, "", MP.MP_BASE_COLOR)
    scan_ground_mask(m, t)
    rough = expr(m, unreal.MaterialExpressionScalarParameter, -450, 350, parameter_name="Roughness",
                 default_value=0.8)
    mel.connect_material_property(rough, "", MP.MP_ROUGHNESS)
    spec = expr(m, unreal.MaterialExpressionConstant, -450, 450, r=0.3)
    mel.connect_material_property(spec, "", MP.MP_SPECULAR)
    mel.recompile_material(m)
    unreal.EditorAssetLibrary.save_loaded_asset(m)
    log("material M_Scan ok")
    return m


def scan_mi(master, name, texture, cache):
    """MI_<скан>_<текстура> от M_Scan (один на атлас; у больших сканов атласов до 16)."""
    key = texture.get_name()
    if key in cache:
        return cache[key]
    folder = REEF_DIR + "/" + name
    mi_name = "MI_{}_{}".format(name, key)
    path = folder + "/" + mi_name
    mi = unreal.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else \
        asset_tools.create_asset(mi_name, folder, unreal.MaterialInstanceConstant,
                                 unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, master)
    mel.set_material_instance_texture_parameter_value(mi, "BaseColor", texture)
    mel.set_material_instance_vector_parameter_value(mi, "Tint", SCAN_TINTS.get(name, SCAN_TINT))
    unreal.EditorAssetLibrary.save_loaded_asset(mi)
    cache[key] = mi
    return mi


def build_scan_instances(master):
    """Каждому куску каждого скана — наш освещаемый MI с той текстурой, что была в его исходном
    (Interchange glTF) материале. Повторный запуск берёт текстуру уже из нашего MI."""
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    for folder in unreal.EditorAssetLibrary.list_assets(REEF_DIR, recursive=False, include_folder=True):
        name = folder.rstrip("/").rsplit("/", 1)[-1]
        assets = ar.get_assets_by_path(REEF_DIR + "/" + name, recursive=True)
        meshes = [a.get_asset() for a in assets if str(a.asset_class_path.asset_name) == "StaticMesh"]
        cache, missing = {}, 0
        for mesh in meshes:
            for slot in range(len(mesh.get_editor_property("static_materials"))):
                src = mesh.get_material(slot)
                tex = None
                for param in ("BaseColor", "BaseColorTexture"):
                    try:
                        tex = mel.get_material_instance_texture_parameter_value(src, param)
                    except Exception:
                        tex = None
                    if tex is not None and tex.get_name() != "DefaultTexture":
                        break
                    tex = None
                if tex is None:
                    missing += 1
                    continue
                mesh.set_material(slot, scan_mi(master, name, tex, cache))
            unreal.EditorAssetLibrary.save_loaded_asset(mesh)
        log("scan {}: {} meshes, {} atlases{}".format(
            name, len(meshes), len(cache), ", {} slots without texture".format(missing) if missing else ""))


SNOW_DRIFT_HLSL = """
// медленный дрейф частицы (см): фаза R из цвета вершины, у каждой частицы своя
float p = R * 6.2831853;
return float3(sin(T * 0.37 + p) * 5.0 + sin(T * 0.11 + p * 3.0) * 8.0,
              cos(T * 0.29 + p * 1.7) * 5.0 + cos(T * 0.07 + p * 2.0) * 8.0,
              sin(T * 0.21 + p * 2.3) * 4.0);
"""


def build_marine_snow():
    """Взвесь: неосвещаемые аддитивные точки, яркость из цвета вершин; дрейф — World Position Offset."""
    m = fresh_material("M_MarineSnow")
    setp(m, blend_mode=unreal.BlendMode.BLEND_ADDITIVE, shading_model=unreal.MaterialShadingModel.MSM_UNLIT,
         two_sided=True)
    vc = expr(m, unreal.MaterialExpressionVertexColor, -900, 0)
    t = expr(m, unreal.MaterialExpressionTime, -900, 250)
    drift = expr(m, unreal.MaterialExpressionCustom, -600, 250, code=SNOW_DRIFT_HLSL,
                 output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3, description="Drift",
                 inputs=[custom_input("R"), custom_input("T")])
    link(vc, "R", drift, "R")
    link(t, "", drift, "T")
    mel.connect_material_property(drift, "", MP.MP_WORLD_POSITION_OFFSET)
    # яркость: 0.3..1 по G, общий множитель — параметр
    g = expr(m, unreal.MaterialExpressionMultiply, -600, 0, const_b=0.7)
    link(vc, "G", g, "A")
    g2 = expr(m, unreal.MaterialExpressionAdd, -450, 0, const_b=0.3)
    link(g, "", g2, "A")
    col = expr(m, unreal.MaterialExpressionVectorParameter, -600, -150, parameter_name="Color",
               default_value=color(0.35, 0.5, 0.5))
    em = expr(m, unreal.MaterialExpressionMultiply, -250, -50)
    link(col, "", em, "A")
    link(g2, "", em, "B")
    mel.connect_material_property(em, "", MP.MP_EMISSIVE_COLOR)
    mel.recompile_material(m)
    unreal.EditorAssetLibrary.save_loaded_asset(m)
    log("material M_MarineSnow ok")


FISH_DIR = "/Game/LookTest/Fish"

# Волна плавания в локальных координатах модели (как withSwim в renderer/js/fish/school.js):
# s — от носа (0) к хвосту (1); боковое смещение = A(s) * sin(phase - s * K),
# A(s) = lerp(AmpHead, Amp, s^2) * Len. Фаза своя у каждой рыбы — от её положения в мире.
FISH_SWIM_HLSL = """
float s = saturate((Nose - dot(P, Axis)) / Len);
float a = lerp(AmpHead, Amp, s * s) * Len;
float seed = frac(sin(dot(Obj, float3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2831853;
float ph = T * Hz * 6.2831853 + seed;
return Side * (a * sin(ph - s * K));
"""


def build_fish_master():
    """Рыба: текстура (альфа — маска плавников), блеск чешуи, плавание через World Position Offset."""
    m = fresh_material("M_Fish")
    setp(m, two_sided=True, blend_mode=unreal.BlendMode.BLEND_MASKED, opacity_mask_clip_value=0.33)
    t = expr(m, unreal.MaterialExpressionTextureSampleParameter2D, -900, -200, parameter_name="BaseColor",
             texture=unreal.load_asset("/Engine/EngineResources/DefaultTexture"))
    mel.connect_material_property(t, "RGB", MP.MP_BASE_COLOR)
    mel.connect_material_property(t, "A", MP.MP_OPACITY_MASK)
    mel.connect_material_property(scalar(m, "Roughness", 0.38, -600, 0), "", MP.MP_ROUGHNESS)
    mel.connect_material_property(scalar(m, "Specular", 0.5, -600, 80), "", MP.MP_SPECULAR)

    ins = ["P", "Axis", "Side", "Nose", "Len", "Amp", "AmpHead", "K", "Hz", "T", "Obj"]
    swim = expr(m, unreal.MaterialExpressionCustom, -400, 400, code=FISH_SWIM_HLSL,
                output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3, description="Swim",
                inputs=[custom_input(n) for n in ins])
    link(expr(m, unreal.MaterialExpressionLocalPosition, -800, 300), "", swim, "P")
    for i, (name, default) in enumerate([("NoseAxis", color(0, 1, 0)), ("SideAxis", color(1, 0, 0))]):
        v = expr(m, unreal.MaterialExpressionVectorParameter, -800, 380 + i * 80, parameter_name=name,
                 default_value=default)
        link(v, "RGB", swim, "Axis" if i == 0 else "Side")
    for i, (pin, name, default) in enumerate([("Nose", "NoseCoord", 50.0), ("Len", "BodyLength", 100.0),
                                              ("Amp", "Amp", 0.08), ("AmpHead", "AmpHead", 0.012),
                                              ("K", "WaveK", 4.5), ("Hz", "Hz", 2.5)]):
        link(scalar(m, name, default, -800, 560 + i * 70), "", swim, pin)
    link(expr(m, unreal.MaterialExpressionTime, -800, 1000), "", swim, "T")
    link(expr(m, unreal.MaterialExpressionObjectPositionWS, -800, 1070), "", swim, "Obj")
    to_world = expr(m, unreal.MaterialExpressionTransform, -150, 400,
                    transform_source_type=unreal.MaterialVectorCoordTransformSource.TRANSFORMSOURCE_LOCAL,
                    transform_type=unreal.MaterialVectorCoordTransform.TRANSFORM_WORLD)
    link(swim, "", to_world, "")
    mel.connect_material_property(to_world, "", MP.MP_WORLD_POSITION_OFFSET)
    mel.recompile_material(m)
    unreal.EditorAssetLibrary.save_loaded_asset(m)
    log("material M_Fish ok")
    return m


def source_texture(mat):
    for param in ("BaseColor", "BaseColorTexture"):
        try:
            t = mel.get_material_instance_texture_parameter_value(mat, param)
        except Exception:
            t = None
        if t is not None and t.get_name() != "DefaultTexture":
            return t
    return None


def build_fish_instances(master):
    """MI_Fish_<вид>: текстура из исходного материала + оси и параметры плавания из FISH_SPECIES."""
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    for species, spec in FISH_SPECIES.items():
        meshes = [a.get_asset() for a in ar.get_assets_by_path(FISH_DIR + "/" + species, recursive=True)
                  if str(a.asset_class_path.asset_name) == "StaticMesh"]
        if not meshes:
            log("warn: no meshes for " + species)
            continue
        # габарит вдоль оси носа (локально) — по всем кускам
        n = spec["nose"]
        lo, hi = 1e9, -1e9
        for mesh in meshes:
            b = mesh.get_bounds()
            c = b.origin.x * n[0] + b.origin.y * n[1] + b.origin.z * n[2]
            e = abs(b.box_extent.x * n[0]) + abs(b.box_extent.y * n[1]) + abs(b.box_extent.z * n[2])
            lo, hi = min(lo, c - e), max(hi, c + e)
        cache = {}
        for mesh in meshes:
            for slot in range(len(mesh.get_editor_property("static_materials"))):
                tex = source_texture(mesh.get_material(slot))
                if tex is None:
                    continue
                key = tex.get_name()
                if key not in cache:
                    folder = FISH_DIR + "/" + species
                    mi_name = "MI_Fish_{}_{}".format(species, len(cache))
                    path = folder + "/" + mi_name
                    mi = unreal.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else \
                        asset_tools.create_asset(mi_name, folder, unreal.MaterialInstanceConstant,
                                                 unreal.MaterialInstanceConstantFactoryNew())
                    mel.set_material_instance_parent(mi, master)
                    mel.set_material_instance_texture_parameter_value(mi, "BaseColor", tex)
                    mel.set_material_instance_vector_parameter_value(mi, "NoseAxis", color(*n))
                    mel.set_material_instance_vector_parameter_value(mi, "SideAxis", color(*fish_side(spec)))
                    for name, value in (("NoseCoord", hi), ("BodyLength", hi - lo), ("Amp", spec["amp"]),
                                        ("AmpHead", spec["amp_head"]), ("WaveK", spec["k"]),
                                        ("Hz", spec["hz"])):
                        mel.set_material_instance_scalar_parameter_value(mi, name, value)
                    unreal.EditorAssetLibrary.save_loaded_asset(mi)
                    cache[key] = mi
                mesh.set_material(slot, cache[key])
            unreal.EditorAssetLibrary.save_loaded_asset(mesh)
        log("fish {}: {} meshes, {} MIs, body {:.1f} local units".format(species, len(meshes), len(cache), hi - lo))


def tex(set_name, suffix):
    """Текстура из import_env.py: /Game/LookTest/Textures/<набор>/<набор>_<suffix>."""
    path = "/Game/LookTest/Textures/{0}/{0}_{1}".format(set_name, suffix)
    t = unreal.load_asset(path)
    if t is None:
        raise RuntimeError("texture not found: " + path)
    return t


def build_sand(name="M_Sand", set_name="coast_sand_01", tile_cm=220.0):
    """Песок из CC0-текстур Poly Haven, UV по XY мира (тайл tile_cm).

    Против заметного повтора: крупный шум слегка меняет яркость альбедо.
    """
    S = unreal.MaterialSamplerType
    m = fresh_material(name)
    wp = expr(m, unreal.MaterialExpressionWorldPosition, -1200, 0)
    xy = expr(m, unreal.MaterialExpressionComponentMask, -1000, 0, r=True, g=True, b=False, a=False)
    link(wp, "", xy, "")
    uv = expr(m, unreal.MaterialExpressionDivide, -850, 0, const_b=tile_cm)
    link(xy, "", uv, "A")

    def sample(suffix, y, sampler):
        s = expr(m, unreal.MaterialExpressionTextureSample, -600, y,
                 texture=tex(set_name, suffix), sampler_type=sampler)
        link(uv, "", s, "UVs")
        return s

    diff = sample("diff_2k", -300, S.SAMPLERTYPE_COLOR)
    nor = sample("nor_gl_2k", 0, S.SAMPLERTYPE_NORMAL)
    arm = sample("arm_2k", 300, S.SAMPLERTYPE_MASKS)

    big = expr(m, unreal.MaterialExpressionNoise, -600, -550, scale=0.0025, quality=1, levels=3,
               output_min=0.8, output_max=1.1)
    link(wp, "", big, "Position")
    tint = expr(m, unreal.MaterialExpressionMultiply, -300, -350)
    link(diff, "RGB", tint, "A")
    link(big, "", tint, "B")
    mel.connect_material_property(tint, "", MP.MP_BASE_COLOR)
    mel.connect_material_property(nor, "RGB", MP.MP_NORMAL)
    mel.connect_material_property(arm, "R", MP.MP_AMBIENT_OCCLUSION)
    mel.connect_material_property(arm, "G", MP.MP_ROUGHNESS)
    mel.recompile_material(m)
    unreal.EditorAssetLibrary.save_loaded_asset(m)
    log("material {} ok".format(name))


build_caustics()
build_sand()
build_water_sky()
build_marine_snow()
build_scan_instances(build_scan_master())
build_fish_instances(build_fish_master())
