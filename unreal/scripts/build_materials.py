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
from lt_common import WATER_HORIZON, asset_tools, color, expr, fresh_material, link, log, mel, setp

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
    rough = expr(m, unreal.MaterialExpressionScalarParameter, -450, 350, parameter_name="Roughness",
                 default_value=0.8)
    mel.connect_material_property(rough, "", MP.MP_ROUGHNESS)
    spec = expr(m, unreal.MaterialExpressionConstant, -450, 450, r=0.3)
    mel.connect_material_property(spec, "", MP.MP_SPECULAR)
    mel.recompile_material(m)
    unreal.EditorAssetLibrary.save_loaded_asset(m)
    log("material M_Scan ok")
    return m


def build_scan_instances(master):
    """Для каждого скана в REEF_DIR: MI_<скан> от M_Scan с его текстурой; назначить всем кускам."""
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    for folder in unreal.EditorAssetLibrary.list_assets(REEF_DIR, recursive=False, include_folder=True):
        name = folder.rstrip("/").rsplit("/", 1)[-1]
        assets = ar.get_assets_by_path(REEF_DIR + "/" + name, recursive=True)
        by_class = lambda c: [a.get_asset() for a in assets if str(a.asset_class_path.asset_name) == c]
        texs = [x for x in by_class("Texture2D") if "texture_0" in x.get_name()] or by_class("Texture2D")
        meshes = by_class("StaticMesh")
        if not texs or not meshes:
            continue
        mi_path = REEF_DIR + "/" + name + "/MI_" + name
        if unreal.EditorAssetLibrary.does_asset_exist(mi_path):
            mi = unreal.load_asset(mi_path)
        else:
            mi = asset_tools.create_asset("MI_" + name, REEF_DIR + "/" + name, unreal.MaterialInstanceConstant,
                                          unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, master)
        mel.set_material_instance_texture_parameter_value(mi, "BaseColor", texs[0])
        mel.set_material_instance_vector_parameter_value(mi, "Tint", SCAN_TINTS.get(name, SCAN_TINT))
        unreal.EditorAssetLibrary.save_loaded_asset(mi)
        for mesh in meshes:
            mesh.set_material(0, mi)
            unreal.EditorAssetLibrary.save_loaded_asset(mesh)
        log("scan {}: MI + {} meshes".format(name, len(meshes)))


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
build_scan_instances(build_scan_master())
