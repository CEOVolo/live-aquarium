"""
Prepares downloaded fish models for the aquarium (run with Blender):

  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/models/prepare.py -- [name ...]

For every model: bake the rest pose, drop the rig, turn it nose to +X with the back up, scale it to
length 1 (nose at x = +0.5, the "fish space" the swim shader expects), tag fins and the jaw in the
_AFIN attribute (x: 0 body, 1 median fin, 2/3 pectoral fin; y: 0 at the base .. 1 at the edge on fins;
on the body the jaw bone's weight, negative on the upper lip), shrink the textures and export a GLB
to renderer/assets/models. The printed jawHinge goes to the species' model config.
"""
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.path.join(ROOT, 'assets', 'models', 'raw')
OUT = os.path.join(ROOT, 'renderer', 'assets', 'models')
PREVIEW = os.environ.get('PREVIEW_DIR')

MODELS = {
    'clownfish': {
        'src': 'clownfish.glb', 'nose': ('y', '-'), 'up': ('z', '+'),
        'fins': {'transparent'}, 'textures': {'*': 1024},
        # a school of them lives in the anemone: keep each one light
        'maxTris': 4000,
    },
    'golden': {
        # its rest pose differs from the posed thumbnail: nose along +Z (the eyes), back along +Y (the dorsal fin)
        'src': 'ryukin_goldfish.glb', 'nose': ('z', '+'), 'up': ('y', '+'),
        'fins': {'M_RyukinFins2'}, 'masked': {'M_RyukinEyes'}, 'textures': {'M_RyukinBody2': 2048, '*': 1024},
    },
    'shark': {
        # A great white with a modelled mouth: gums, throat and rows of teeth. Its rig's jaw bone tells
        # which vertices open (by weight) and where the hinge is; the upper lip lifts a little on a bite.
        'src': 'great_white.glb', 'nose': ('y', '-'), 'up': ('z', '+'),
        'fins': set(), 'textures': {'*': 2048},
        'jawBone': 'Jaw.6', 'lipBones': ['Center_upper_Lip.10', 'L_upper_Lip.11', 'R_upper_Lip.9'], 'lipLift': 0.35,
    },
}


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in list(bpy.context.scene.objects):
        # the importer's custom bone shape
        if o.type == 'MESH' and o.name.startswith('Icosphere') and o.parent is None:
            bpy.data.objects.remove(o, do_unlink=True)
    for a in bpy.data.objects:
        if a.type == 'ARMATURE':
            a.data.pose_position = 'REST'
    bpy.context.view_layer.update()


def bone_weights(names):
    """Source mesh name -> per-vertex max weight over the vertex groups of the given bones."""
    out = {}
    for o in bpy.context.scene.objects:
        if o.type != 'MESH': continue
        idx = {g.index for g in o.vertex_groups if g.name in names}
        if not idx: continue
        w = [0.0] * len(o.data.vertices)
        for v in o.data.vertices:
            for g in v.groups:
                if g.group in idx: w[v.index] = max(w[v.index], g.weight)
        out[o.name] = w
    return out


def bone_head(name):
    for a in bpy.data.objects:
        if a.type == 'ARMATURE' and name in a.data.bones:
            return a.matrix_world @ a.data.bones[name].head_local
    raise KeyError(name)


def bake():
    """Mesh copies with modifiers (the rig in rest pose) and world transforms applied; everything else removed."""
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(o.matrix_world)
        n = bpy.data.objects.new(o.name + '_baked', me)
        n['src'] = o.name
        bpy.context.scene.collection.objects.link(n)
        out.append(n)
    for o in list(bpy.context.scene.objects):
        if o not in out:
            bpy.data.objects.remove(o, do_unlink=True)
    return out


def bbox(objs):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            mn = Vector(map(min, mn, v.co)); mx = Vector(map(max, mx, v.co))
    return mn, mx


def orient(objs, nose, up):
    """Returns the matrix that was applied, for points that must follow the mesh (like a jaw hinge)."""
    axis = lambda a, s: Vector([(1 if s == '+' else -1) if 'xyz'[i] == a else 0 for i in range(3)])
    fwd, upv = axis(*nose), axis(*up)
    R = Matrix((fwd, upv.cross(fwd), upv)).to_4x4()
    for o in objs:
        o.data.transform(R)
    mn, mx = bbox(objs)
    S = Matrix.Scale(1.0 / (mx.x - mn.x), 4)
    for o in objs:
        o.data.transform(S)
    mn, mx = bbox(objs)
    T = Matrix.Translation(Vector((0.5 - mx.x, -(mn.y + mx.y) / 2, -(mn.z + mx.z) / 2)))
    for o in objs:
        o.data.transform(T)
        o.data.update()
    return T @ S @ R


def material_names(o):
    return {m.name for m in o.data.materials if m}


def components(me):
    """Connected parts of a mesh as lists of vertex indices."""
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen: continue
        stack, part = [v], []
        seen.add(v.index)
        while stack:
            u = stack.pop(); part.append(u.index)
            for e in u.link_edges:
                w = e.other_vert(u)
                if w.index not in seen:
                    seen.add(w.index); stack.append(w)
        parts.append(part)
    bm.free()
    return parts


def tag(objs, cfg, weights):
    fins = [o for o in objs if material_names(o) & cfg['fins']]
    body = [o for o in objs if o not in fins]
    tree_pts = [v.co.copy() for o in body for v in o.data.vertices]
    kd = KDTree(len(tree_pts))
    for i, p in enumerate(tree_pts): kd.insert(p, i)
    kd.balance()
    report = []
    for o in objs:
        me = o.data
        attr = me.attributes.new('_AFIN', 'FLOAT2', 'POINT')
        vals = [0.0] * (2 * len(me.vertices))
        if o in fins:
            for part in components(me):
                d = [kd.find(me.vertices[i].co)[2] for i in part]
                dmax = max(max(d), 1e-6)
                c = sum((me.vertices[i].co for i in part), Vector()) / len(part)
                # pectoral fins: front half, off to the side, low
                pect = c.x > -0.1 and abs(c.y) > 0.05 and c.z < 0.02 and len(part) < 400
                kind = (2.0 if c.y < 0 else 3.0) if pect else 1.0
                for i, di in zip(part, d):
                    vals[2 * i] = kind
                    vals[2 * i + 1] = min(1.0, di / dmax)
                report.append(f"fin part {len(part)} verts at {tuple(round(v, 3) for v in c)} -> {'pectoral' if pect else 'median'}")
        jaw = weights.get('jaw', {}).get(o['src'])
        if jaw:
            lip = weights.get('lip', {}).get(o['src']) or [0.0] * len(jaw)
            lift = cfg.get('lipLift', 0.0)
            n = 0
            for i, (wj, wl) in enumerate(zip(jaw, lip)):
                # lower jaw opens by its weight; the upper lip turns the other way a little (negative weight)
                if wj > 0.001:
                    vals[2 * i + 1] = wj; n += 1
                elif wl > 0.001:
                    vals[2 * i + 1] = -lift * wl
            report.append(f"jaw: {n} vertices weighted by the jaw bone")
        attr.data.foreach_set('vector', vals)
    return report


def join(objs):
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    return objs[0]


def decimate(obj, max_tris):
    """Collapse-decimate to about max_tris triangles, keeping UV seams and custom attributes."""
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris <= max_tris: return
    mod = obj.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = max_tris / tris
    mod.use_collapse_triangulate = True
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def fix_materials(cfg):
    fins, masked = cfg['fins'], cfg.get('masked', set())
    for m in bpy.data.materials:
        if not m.use_nodes: continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf: continue
        a = bsdf.inputs['Alpha']
        if m.name in fins:
            m.surface_render_method = 'BLENDED'
        elif m.name in masked:
            m.surface_render_method = 'DITHERED'
        else:
            # bodies are opaque: an alpha channel in their texture only causes sorting trouble
            for l in list(a.links): m.node_tree.links.remove(l)
            a.default_value = 1.0
            m.surface_render_method = 'DITHERED'


def shrink_textures(cfg):
    sizes = cfg['textures']
    for m in bpy.data.materials:
        if not m.use_nodes: continue
        target = sizes.get(m.name, sizes['*'])
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and max(n.image.size) > target:
                w, h = n.image.size
                k = target / max(w, h)
                n.image.scale(max(1, round(w * k)), max(1, round(h * k)))


def preview(obj, path):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x, scene.render.resolution_y = 960, 540
    scene.world = scene.world or bpy.data.worlds.new('w')
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam); scene.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.1
    for name, loc in (('side', (0, -3, 0)), ('top', (0, 0, 3))):
        cam.location = loc
        cam.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y' if name == 'top' else 'Z').to_euler()
        scene.render.filepath = f"{path}_{name}.png"
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def process(name, cfg):
    load(os.path.join(RAW, cfg['src']))
    weights, hinge = {}, None
    if cfg.get('jawBone'):
        weights['jaw'] = bone_weights({cfg['jawBone']})
        weights['lip'] = bone_weights(set(cfg.get('lipBones', [])))
        hinge = bone_head(cfg['jawBone'])
    objs = bake()
    M = orient(objs, cfg['nose'], cfg['up'])
    report = tag(objs, cfg, weights)
    obj = join(objs)
    obj.name = name
    if cfg.get('maxTris'):
        decimate(obj, cfg['maxTris'])
    fix_materials(cfg)
    shrink_textures(cfg)
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=False, export_skins=False, export_morph=False,
                              export_attributes=True, export_vertex_color='NONE', export_image_format='WEBP', export_image_quality=85,
                              export_yup=True, export_apply=True, export_extras=False, export_tangents=False)
    mn, mx = bbox([obj])
    info = {'name': name, 'verts': len(obj.data.vertices), 'tris': sum(len(p.vertices) - 2 for p in obj.data.polygons),
            'materials': [m.name for m in obj.data.materials if m], 'bytes': os.path.getsize(out),
            'bbox': [[round(v, 4) for v in mn], [round(v, 4) for v in mx]], 'report': report}
    if hinge is not None:
        h = M @ hinge
        info['jawHinge'] = [round(h.x, 4), round(h.z, 4)]  # fish space x and up (three.js y)
    if PREVIEW:
        preview(obj, os.path.join(PREVIEW, name))
    print('MODEL', json.dumps(info))


names = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
for name in names or MODELS:
    process(name, MODELS[name])
