"""
Put a Tripo model into the frame everything downstream assumes: facing -Y,
standing at its real height, feet on z=0, with every object transform applied.
Do this before Auto-Rig Pro's Smart, not after.

  # headless: import the GLB, orient it, save a .blend to start rigging from
  blender --background --python scripts/blender/orient_model.py -- \
      --model out/chars/<c>/model/model.glb --height 1.7 \
      --blend out/chars/<c>/rig.blend

  # inside a running Blender (Text Editor / MCP): the active object
  blender --python scripts/blender/orient_model.py -- --height 1.7

Tripo returns the character facing +X, normalised to 1.0 unit tall, so both the
rotation and the scale have to be fixed. That matters because ARP's retarget
copies world-space rotations from the Mixamo source (which imports facing -Y at
human scale), and because `c3d render` frames the camera from the metre height
in chars/<name>.yaml.

--yaw is worked out from the bounding box: shoulders wider along Y means the
character faces +/-X, so it turns -90 degrees. Tripo's own orientation is +X;
if a model comes out facing away, pass --yaw 90 and it turns the other way.
Re-running is a no-op once the shoulders already span X.

Blender exits 0 even on an uncaught exception, so main() is wrapped and exits 1.
"""

import math
import os
import sys
import traceback

import bpy
from mathutils import Matrix


def log(msg):
    print("[orient_model] " + msg, flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"model": "", "blend": "", "height": "0", "yaw": ""}
    key = None
    for a in argv:
        if a.startswith("--"):
            key = a[2:]
            opts[key] = True
        elif key:
            opts[key] = a
            key = None
    return opts


def auto_yaw(dims):
    """Degrees about Z that put the character's shoulders on X, i.e. facing -Y.

    The wider of the two horizontal extents is the shoulder span. Tripo hands
    back a +X-facing model, so a Y-spanning one turns -90; one already spanning
    X is left alone, which keeps a second run from turning it into the ground.
    """
    return -90.0 if dims.x < dims.y else 0.0


def self_check():
    from mathutils import Vector
    assert auto_yaw(Vector((0.233, 0.495, 1.0))) == -90.0  # Tripo, facing +X
    assert auto_yaw(Vector((0.842, 0.396, 1.7))) == 0.0  # already facing -Y


def import_model(path):
    before = set(bpy.data.objects)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=os.path.abspath(path))
    else:
        raise SystemExit(f"unsupported model format: {path}")
    meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"no mesh in {path}")
    if len(meshes) > 1:
        raise SystemExit(f"{len(meshes)} meshes in {path}; join them first")
    return meshes[0]


def active_mesh():
    o = bpy.context.object
    if o is None or o.type != "MESH":
        meshes = [m for m in bpy.data.objects if m.type == "MESH"]
        if len(meshes) != 1:
            raise SystemExit("select the character mesh, or pass --model")
        return meshes[0]
    return o


def orient(o, height, yaw):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o

    # The glTF importer sets rotation_mode to QUATERNION, where assigning
    # rotation_euler is silently dropped — location and scale still take, so it
    # looks like only the turn failed. Composing matrix_world works either way.
    if yaw:
        o.matrix_world = Matrix.Rotation(math.radians(yaw), 4, "Z") @ o.matrix_world
    if height:
        o.dimensions = o.dimensions * (height / o.dimensions.z)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    o.location.z -= min((o.matrix_world @ v.co).z for v in o.data.vertices)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def main():
    self_check()
    opts = parse_args()
    o = import_model(opts["model"]) if opts["model"] else active_mesh()

    height = float(opts["height"])
    yaw = float(opts["yaw"]) if opts["yaw"] else auto_yaw(o.dimensions)
    log(f"{o.name}: dimensions {tuple(round(v, 4) for v in o.dimensions)}, yaw {yaw:+.0f} deg"
        + (f", scaling to {height} m" if height else ", keeping scale"))

    orient(o, height, yaw)

    d = o.dimensions
    log(f"-> dimensions {tuple(round(v, 4) for v in d)} (x = shoulders, y = depth, z = height)")
    if d.x < d.y:
        log("WARNING: depth still wider than the shoulders — this is not a -Y-facing character")
    log("check it in Blender's Front view (Numpad 1): you should see the face, not the back. "
        "If it is the back, re-run with --yaw 90")

    if opts["blend"]:
        path = os.path.abspath(opts["blend"])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=path)
        log(f"-> {path}")


try:
    main()
except SystemExit as e:
    if e.code:
        log(f"ERROR: {e.code}")
        sys.exit(1)
except Exception:
    traceback.print_exc()
    sys.exit(1)
