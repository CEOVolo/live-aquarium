"""Общие помощники для скриптов пробы картинки."""
import os
import unreal

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MAP = "/Game/LookTest/Maps/Reef"
MAT_DIR = "/Game/LookTest/Materials"

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)


def log(msg):
    unreal.log("LOOKTEST " + str(msg))


def setp(obj, **props):
    """set_editor_property для нескольких свойств; неизвестное имя — в лог, а не падение."""
    for k, v in props.items():
        try:
            obj.set_editor_property(k, v)
        except Exception as e:  # имена свойств меняются между версиями движка
            log("warn: {}.{}: {}".format(obj.get_class().get_name(), k, e))


def fresh_material(name, folder=MAT_DIR, domain=None):
    """Пустой материал name. Существующий не удаляется (иначе уровень теряет ссылки на него) —
    из него вычищаются все узлы."""
    path = folder + "/" + name
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        m = unreal.load_asset(path)
        mel.delete_all_material_expressions(m)
    else:
        m = asset_tools.create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew())
    if domain is not None:
        m.set_editor_property("material_domain", domain)
    return m


def expr(mat, cls, x=0, y=0, **props):
    e = mel.create_material_expression(mat, cls, x, y)
    setp(e, **props)
    return e


def link(a, a_out, b, b_in):
    mel.connect_material_expressions(a, a_out, b, b_in)


def spawn(cls, label, loc=(0, 0, 0), rot=(0, 0, 0)):
    a = actors.spawn_actor_from_class(
        cls, unreal.Vector(*loc), unreal.Rotator(roll=rot[0], pitch=rot[1], yaw=rot[2]))
    a.set_actor_label(label)
    return a


def color(r, g, b, a=1.0):
    return unreal.LinearColor(r, g, b, a)


# Цвет воды у горизонта: один и тот же для тумана и купола «неба», чтобы не было шва
WATER_HORIZON = color(0.01, 0.075, 0.095)

# Статичные рыбы (плывут за счёт World Position Offset в M_Fish). Оси — в локальных координатах
# модели (определены по fish_lineup.py): nose — куда смотрит нос, up — спина.
# Параметры плавания — как withSwim в renderer/js/fish/school.js: amp — амплитуда хвоста
# в долях длины, amp_head — у головы, hz — частота взмахов, k — число радиан волны вдоль тела.
FISH_SPECIES = {
    "clownfish": dict(nose=(0, 1, 0), up=(0, 0, 1), length_cm=10, hz=3.2, amp=0.09, amp_head=0.015, k=4.5),
    "damselfish": dict(nose=(0, 1, 0), up=(0, 0, 1), length_cm=15, hz=2.6, amp=0.08, amp_head=0.012, k=4.5),
    "french_angelfish": dict(nose=(1, 0, 0), up=(0, 0, 1), length_cm=35, hz=1.1, amp=0.05, amp_head=0.008,
                             k=3.5),
}


def fish_side(spec):
    """Боковая ось = up x nose (в локальных координатах)."""
    n, u = spec["nose"], spec["up"]
    return (u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0])
