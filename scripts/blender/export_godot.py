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

Blender exits 0 even on an uncaught exception, so main() is wrapped and exits 1.
"""

import os
import sys
import traceback

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


def main():
    opts = parse_args(("out",))
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
