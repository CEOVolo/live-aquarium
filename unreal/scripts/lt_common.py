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
