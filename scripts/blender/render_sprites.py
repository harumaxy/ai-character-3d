"""
Render 8-direction sprite frames from animated character files. Runs inside Blender:

  blender --background --python scripts/blender/render_sprites.py -- \
      --motions out/chars/<c>/render/motions.json --out out/chars/<c>/render \
      [--size 512] [--elev 30] [--height 1.7] [--margin 1.15] \
      [--engine eevee|workbench] [--light camera|world] [--passes color,normal] \
      [--aa on|off] [--track xy|none] [--dirs 8|5]

motions.json: [{"id": "walk", "file": "<abs path .glb|.fbx>", "frames": 8, "loop": true}, ...]
Each file carries mesh + armature + one clip (Tripo animate_retarget / Mixamo).
Writes <out>/<id>/<dir>/<k>.png (RGBA, transparent) and <k>.normal.png, plus
<out>/meta.json. Blender exits 0 even on an uncaught exception, so main() is
wrapped and exits 1 on failure.

Camera: orthographic, azimuth stepped 45 deg around the character, elevation
--elev above the ground plane (30 = classic 3/4 top-down, 0 = side view,
90 = true top-down). ortho_scale = height * margin so every direction and every
motion shares one pixel-per-metre scale.
"""

import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Vector

DIRS8 = ["down", "downright", "right", "upright", "up", "upleft", "left", "downleft"]
# Directions rendered when --dirs 5; the sheet stage mirrors right->left.
DIRS5 = ["down", "downright", "right", "upright", "up"]
# Camera azimuth per direction for a character facing -Y. az 0 puts the camera
# at -Y looking at the front, i.e. the character walks "down" toward the viewer;
# az 270 (-X) sees it walk to the viewer's right.
AZIMUTH = {"down": 0, "downright": 315, "right": 270, "upright": 225,
           "up": 180, "upleft": 135, "left": 90, "downleft": 45}
# Which world axis the imported character faces. glTF (+Z forward) imports as -Y
# in Blender, which is what Tripo GLBs and Mixamo FBXs give; Quaternius/UE-style
# FBX faces +Y. --facing overrides.
FACING_YAW = {"-y": 0, "+x": 90, "+y": 180, "-x": 270}
CAM_DIST = 20.0


def log(msg):
    print("[render_sprites] " + msg, flush=True)


def frame_times(start, end, n, loop):
    """Clip frame numbers for n samples. loop: stop before the wrap; else include the end."""
    if n == 1:
        return [start]
    span = end - start
    step = span / n if loop else span / (n - 1)
    return [start + k * step for k in range(n)]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"size": "512", "elev": "30", "height": "0", "margin": "1.15", "engine": "eevee",
            "light": "camera", "passes": "color,normal", "aa": "on", "track": "xy", "dirs": "8",
            "facing": "-y"}
    key = None
    for a in argv:
        if a.startswith("--"):
            key = a[2:]
            opts[key] = True
        elif key:
            opts[key] = a
            key = None
    for k in ("out", "motions"):
        if k not in opts or opts[k] is True:
            raise SystemExit(f"missing --{k}")
    if opts["facing"] not in FACING_YAW:
        raise SystemExit(f"--facing must be one of {', '.join(FACING_YAW)}")
    return opts


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials,
                 bpy.data.images):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


def import_model(path):
    before = set(bpy.data.objects)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        raise SystemExit(f"unsupported model format: {path}")
    new = [o for o in bpy.data.objects if o not in before]
    rig = next((o for o in new if o.type == "ARMATURE"), None)
    meshes = [o for o in new if o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"no mesh in {path}")
    return rig, meshes, new


def set_engine(scene, engine):
    if engine == "workbench":
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "TEXTURE"
        return
    # 4.2-4.x call it BLENDER_EEVEE_NEXT, 5.x went back to BLENDER_EEVEE.
    for name in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = name
            return
        except TypeError:
            continue
    raise SystemExit("no EEVEE engine available")


def setup_scene(scene, opts):
    size = int(opts["size"])
    set_engine(scene, opts["engine"])
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    # Standard: no tone-mapping so flat colours stay the colours in the texture.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    if opts["aa"] == "off":
        # Pixel-art path: one sample, no filter — hard edges the pixelate step can quantise.
        scene.render.filter_size = 0.01
        if hasattr(scene, "eevee"):
            scene.eevee.taa_render_samples = 1
    else:
        scene.render.filter_size = 1.0
        if hasattr(scene, "eevee"):
            scene.eevee.taa_render_samples = 16
    ee = getattr(scene, "eevee", None)
    if ee is not None:
        # Soft shadows / AO / raytraced GI look muddy at sprite scale; keep the shading crisp.
        # Attribute names moved between 4.2 (EEVEE Next) and 5.x, so probe each one.
        for attr, value in (("use_shadows", True), ("use_gtao", False), ("use_raytracing", False),
                            ("use_fast_gi", False), ("use_volumetric_shadows", False)):
            if hasattr(ee, attr):
                setattr(ee, attr, value)
    # World: neutral grey ambient so the unlit side is readable, not black.
    world = bpy.data.worlds.new("sprite_world") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (1, 1, 1, 1)
        bg.inputs["Strength"].default_value = 0.35


def setup_camera(scene):
    cam_data = bpy.data.cameras.new("sprite_cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100
    cam = bpy.data.objects.new("sprite_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def setup_light(scene, cam, mode):
    """Key + fill. camera: parented to the camera so every direction is lit the same
    (game readability). world: fixed in the world so the sun stays put as the
    character turns (DKC-style consistent shading)."""
    key_data = bpy.data.lights.new("sprite_key", "SUN")
    key_data.energy = 3.0
    key_data.angle = math.radians(5)
    key = bpy.data.objects.new("sprite_key", key_data)
    scene.collection.objects.link(key)
    fill_data = bpy.data.lights.new("sprite_fill", "SUN")
    fill_data.energy = 1.0
    fill_data.use_shadow = False
    fill = bpy.data.objects.new("sprite_fill", fill_data)
    scene.collection.objects.link(fill)
    if mode == "camera":
        for o, (rx, rz) in ((key, (-35, 30)), (fill, (-20, -50))):
            o.parent = cam
            # Camera looks down its local -Z; tilt the sun off that axis: from upper-left / lower-right.
            o.rotation_euler = (math.radians(rx), 0, math.radians(rz))
    else:
        key.rotation_euler = (math.radians(50), 0, math.radians(35))
        fill.rotation_euler = (math.radians(60), 0, math.radians(-140))
    return key, fill


def place_camera(cam, target, az_deg, el_deg):
    az, el = math.radians(az_deg), math.radians(el_deg)
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.location = target + d * CAM_DIST
    cam.rotation_euler = d.to_track_quat("Z", "Y").to_euler()


def bounds(meshes, depsgraph):
    """World-space AABB of the evaluated (posed) meshes."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        ev = o.evaluated_get(depsgraph)
        for v in ev.data.vertices:
            p = ev.matrix_world @ v.co
            lo.x, lo.y, lo.z = min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)
            hi.x, hi.y, hi.z = max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)
    return lo, hi


def normal_material():
    """Camera-space normal as colour, tangent-space-map convention: facing the
    camera = (0.5, 0.5, 1), +X right, +Y up. Blender's camera space has Z going
    into the screen, hence the -0.5 on Z. Render it with the Raw view transform
    so the PNG holds the linear values, not sRGB-encoded ones."""
    mat = bpy.data.materials.new("sprite_normal")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    xf = nt.nodes.new("ShaderNodeVectorTransform")
    xf.vector_type = "NORMAL"
    xf.convert_from = "WORLD"
    xf.convert_to = "CAMERA"
    scale = nt.nodes.new("ShaderNodeVectorMath")
    scale.operation = "MULTIPLY_ADD"
    scale.inputs[1].default_value = (0.5, 0.5, -0.5)
    scale.inputs[2].default_value = (0.5, 0.5, 0.5)
    emit = nt.nodes.new("ShaderNodeEmission")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(geo.outputs["Normal"], xf.inputs["Vector"])
    nt.links.new(xf.outputs["Vector"], scale.inputs[0])
    nt.links.new(scale.outputs["Vector"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def render(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    assert frame_times(1, 33, 4, True) == [1, 9, 17, 25]
    assert frame_times(1, 31, 4, False) == [1, 11, 21, 31]
    if bpy.app.version < (4, 2):
        sys.exit(f"render_sprites.py needs Blender 4.2+ (found {bpy.app.version_string})")
    opts = parse_args()
    out_dir = os.path.abspath(opts["out"])
    os.makedirs(out_dir, exist_ok=True)
    with open(opts["motions"], encoding="utf-8") as f:
        motions = json.load(f)
    missing = [m["file"] for m in motions if not os.path.exists(m["file"])]
    if missing:
        sys.stderr.write("missing model files:\n  " + "\n  ".join(missing) + "\n")
        sys.exit(1)

    passes = [p for p in opts["passes"].split(",") if p]
    dirs = DIRS8 if opts["dirs"] == "8" else DIRS5
    yaw = FACING_YAW[opts["facing"]]
    elev, margin = float(opts["elev"]), float(opts["margin"])
    size = int(opts["size"])

    scene = bpy.context.scene
    clear_scene()
    setup_scene(scene, opts)
    cam = setup_camera(scene)
    setup_light(scene, cam, opts["light"])
    view_layer = bpy.context.view_layer
    normal_mat = normal_material() if "normal" in passes else None
    log(f"blender {bpy.app.version_string}, engine {scene.render.engine}, {len(motions)} motions, "
        f"elev {elev}, size {size}, passes {passes}")

    meta = {"size": size, "elev": elev, "dirs": dirs, "facing": opts["facing"], "motions": []}
    written = 0
    for m in motions:
        rig, meshes, objs = import_model(m["file"])
        anim_obj = rig or meshes[0]
        action = anim_obj.animation_data.action if anim_obj.animation_data else None
        if action is None:
            # Some importers hang the action on a mesh or leave it in bpy.data only.
            action = next(iter(bpy.data.actions), None)
            if action is not None and rig is not None:
                rig.animation_data_create()
                rig.animation_data.action = action
        if action is None:
            log(f"{m['id']}: no animation in {m['file']} — rendering the rest pose once")
            start, end = 1.0, 1.0
        else:
            start, end = action.frame_range
        times = frame_times(start, end, int(m["frames"]), bool(m["loop"]))
        log(f"{m['id']}: frames {start:.0f}..{end:.0f} -> {[round(t, 1) for t in times]}")

        # Height from the rest/first frame; explicit --height wins so every
        # character of a party shares one scale.
        scene.frame_set(int(times[0]), subframe=times[0] - int(times[0]))
        view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        lo, hi = bounds(meshes, depsgraph)
        height = float(opts["height"]) or (hi.z - lo.z)
        ground_z = lo.z
        cam.data.ortho_scale = height * margin
        base_center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0))
        log(f"{m['id']}: height {hi.z - lo.z:.2f} m (framing {height:.2f}), ground z {ground_z:.2f}")

        for d in dirs:
            dest = os.path.join(out_dir, m["id"], d)
            os.makedirs(dest, exist_ok=True)
            for k, t in enumerate(times):
                scene.frame_set(int(t), subframe=t - int(t))
                view_layer.update()
                if opts["track"] == "xy":
                    depsgraph = bpy.context.evaluated_depsgraph_get()
                    lo, hi = bounds(meshes, depsgraph)
                    center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0))
                else:
                    center = base_center
                # Camera aims at mid-height above the ground so feet sit on one line.
                target = Vector((center.x, center.y, ground_z + height / 2))
                place_camera(cam, target, AZIMUTH[d] + yaw, elev)
                view_layer.update()
                if "color" in passes:
                    view_layer.material_override = None
                    scene.view_settings.view_transform = "Standard"
                    render(scene, os.path.join(dest, f"{k}.png"))
                if normal_mat is not None:
                    view_layer.material_override = normal_mat
                    scene.view_settings.view_transform = "Raw"
                    render(scene, os.path.join(dest, f"{k}.normal.png"))
                    view_layer.material_override = None
                    scene.view_settings.view_transform = "Standard"
                written += 1
        meta["motions"].append({"id": m["id"], "frames": len(times), "height": height})
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
        for a in list(bpy.data.actions):
            bpy.data.actions.remove(a)

    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    log(f"done: {written} frames x {len(passes)} passes -> {out_dir}")


try:
    main()
except SystemExit:
    raise
except Exception:
    sys.stderr.write(traceback.format_exc())
    sys.exit(1)
