"""
Export the retargeted character to one Godot 4 .glb with Auto-Rig Pro's own
exporter. Runs inside Blender against out/chars/<c>/anim.blend:

  blender --background out/chars/<c>/anim.blend \
      --python scripts/blender/export_godot.py -- \
      --out out/chars/<c>/<c>.glb [--target <armature object>] \
      [--rig-type universal]

ARP's exporter is a different job from `render`: it builds a throwaway copy of
the rig with the control bones stripped, the deform bones renamed to Godot's
humanoid convention, and every action baked onto it as its own glTF animation.
Godot 4 then imports the file as a Skeleton3D plus an AnimationPlayer holding
one clip per motion, and its BoneMap picks up SkeletonProfileHumanoid straight
off the renamed bones.

--rig-type universal skips the humanoid renaming, for a rig that is not a full
ARP humanoid; Godot's humanoid retargeting will not recognise the bones.

--anim-only swaps the character's meshes for a one-triangle stand-in, for the
shared-skeleton setup: one animation file imported as an AnimationLibrary, and
per-character files that carry only mesh and skeleton. See dummy_mesh() for why
the triangle has to be there at all.

Blender exits 0 even on an uncaught exception, so main() is wrapped and exits 1.
"""

import os
import sys
import traceback

import bmesh
import bpy

# find_target and the argv parser are the same job here as in the retarget
# stage; importing them keeps one definition. retarget.py only defines things at
# import time (its main() is guarded).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from retarget import find_target, parse_args  # noqa: E402


def log(msg):
    print("[export] " + msg, flush=True)


def configure(scn, rig_type):
    """ARP Game Engine settings for a Godot 4 glTF: every action, no x100 scale.

    Set explicitly rather than trusted: these live in the .blend, so whatever
    the rig was hand-exported with last would otherwise leak into the batch.
    """
    scn.arp_engine_type = "GODOT"
    scn.arp_export_rig_type = rig_type
    # Godot names its humanoid bones Hips/Spine/LeftUpperArm/...; the root bone
    # has to be Y up, Z forward or root motion comes out sideways.
    scn.arp_rename_for_godot = True
    scn.arp_godot_root_axes = True
    scn.arp_ge_master_traj = True  # c_traj -> Root; Godot has no armature-level root motion
    scn.arp_ge_sel_only = False  # every skinned mesh, not just what is selected
    scn.arp_bake_anim = True
    scn.arp_bake_type = "ACTIONS"  # one glTF animation per action, not one NLA track
    scn.arp_bake_only_active = False
    scn.arp_export_name_string = ""  # no name filter: export all of them
    scn.arp_export_use_actlist = False
    # Meters. The x100 scale is an Unreal/Unity workaround and Godot does not
    # want it; arp_units_x100 is the FBX knob, the gltf one is separate.
    scn.arp_units_x100 = False
    scn.arp_ge_gltf_unitsx100 = False
    scn.arp_ge_gltf_format = "GLB"
    # Each clip was baked over its source's own frame range. Without this every
    # animation keeps that offset and Godot plays a silent lead-in.
    scn.arp_ge_gltf_anim_start_zero = True


def skinned_meshes(rig):
    return [o for o in bpy.data.objects if o.type == "MESH"
            and any(m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]


def dummy_mesh(rig):
    """Replace the character's meshes with a one-triangle copy of one of them.

    Not decoration: glTF only writes a `skin` for a skinned *mesh*, and Godot
    only builds a Skeleton3D from a skin. An armature exported on its own lands
    as plain Node3Ds, and the animation tracks then address "Armature/Hips"
    instead of "Skeleton3D:Hips" -- unusable as a library for the character
    files. A copy rather than a fresh triangle so the vertex groups keep the
    exact names ARP expects to rename alongside the bones.

    The materials go with the geometry; the textures are the bulk of the file.
    """
    meshes = skinned_meshes(rig)
    if not meshes:
        raise SystemExit(f"no mesh is skinned to {rig.name} — nothing to build a skin from")
    src = meshes[0]
    dup = src.copy()
    dup.data = src.data.copy()
    dup.name = "anim_lib_dummy"
    bpy.context.scene.collection.objects.link(dup)

    bm = bmesh.new()
    bm.from_mesh(dup.data)
    bm.faces.ensure_lookup_table()
    if not bm.faces:
        raise SystemExit(f"{src.name} has no faces to keep")
    keep = bm.faces[0]
    # 'FACES' takes the verts and edges left loose by the deleted faces with it.
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f != keep], context="FACES")
    bm.to_mesh(dup.data)
    bm.free()

    dup.data.materials.clear()
    if dup.data.shape_keys:
        dup.shape_key_clear()
    log(f"anim-only: {len(dup.data.polygons)} triangle stand-in for "
        f"{len(meshes)} skinned mesh(es)")
    return dup


def main():
    opts = parse_args(("out",))
    opts.setdefault("anim-only", False)
    rig_type = str(opts.get("rig-type") or "humanoid").upper()
    if rig_type not in ("HUMANOID", "UNIVERSAL"):
        raise SystemExit(f"--rig-type expects humanoid or universal, got {opts['rig-type']!r}")

    rig = find_target(opts["target"])
    log(f"target rig: {rig.name}")
    actions = sorted(a.name for a in bpy.data.actions)
    if not actions:
        raise SystemExit("no actions in this .blend — run `c3d retarget` first")
    log(f"{len(actions)} action(s): {', '.join(actions)}")

    configure(bpy.context.scene, rig_type)

    bpy.ops.object.select_all(action="DESELECT")
    if opts["anim-only"]:
        # Selected-only, so ARP exports the stand-in instead of the character.
        bpy.context.scene.arp_ge_sel_only = True
        dummy_mesh(rig).select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig

    path = os.path.abspath(opts["out"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # EXEC_DEFAULT: the operator is an ExportHelper, so calling it without an
    # event runs execute() directly instead of opening a file browser.
    bpy.ops.arp.arp_export_gltf_panel("EXEC_DEFAULT", filepath=path)
    if not os.path.isfile(path):
        raise SystemExit(f"ARP reported no error but wrote no {path}")
    log(f"{len(actions)} animation(s) -> {path} ({os.path.getsize(path) // 1024} KB)")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        if e.code:
            log(f"ERROR: {e.code}")
            sys.exit(1)
    except Exception:
        traceback.print_exc()
        sys.exit(1)
