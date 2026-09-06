"""
Score a skin bind: how much arm weight bled onto geometry that is not the arm,
and how close the two get in the first place. Runs inside Blender:

  blender --background out/chars/<c>/rig.blend \
      --python scripts/blender/check_bind.py -- [--group arm] [--threshold 0.15]

Voxel-based binders weld anything closer than one voxel. On a hands-down A-pose
the hands hang millimetres from the hips, so a hand bone ends up driving the
belt pouch. This prints the clearance the binder had to resolve and the share of
non-arm vertices that came out with arm weight on them, so "Voxelized at 7 vs
VHDS at 1024" is a number instead of an impression.

Run it headless, never through the Blender MCP: the MCP executes on Blender's
main thread, and anything that takes more than a few seconds freezes the UI and
drops the connection with the scene unsaved.
"""

import sys
import traceback

import bpy
from mathutils.kdtree import KDTree

# Bone/vertex-group name fragments that make something "the arm side".
ARM_KEYS = ("hand", "forearm", "arm_", "index", "thumb", "middle", "ring", "pinky")
# Points sampled along each bone segment for the nearest-bone lookup. A bone is
# short enough that 8 samples put the error well under a millimetre.
SAMPLES = 8


def log(msg):
    print("[check_bind] " + msg, flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"threshold": "0.15", "keys": ""}
    key = None
    for a in argv:
        if a.startswith("--"):
            key = a[2:]
            opts[key] = True
        elif key:
            opts[key] = a
            key = None
    return opts


def bone_tree(rig, keys):
    """KDTree over points sampled along every deform bone, plus an is-arm flag."""
    bones = [b.bone for b in rig.pose.bones if b.bone.use_deform]
    if not bones:
        raise SystemExit("the armature has no deforming bones")
    tree = KDTree(len(bones) * SAMPLES)
    flags = []
    for b in bones:
        h = rig.matrix_world @ b.head_local
        t = rig.matrix_world @ b.tail_local
        is_arm = any(k in b.name for k in keys)
        for i in range(SAMPLES):
            tree.insert(h.lerp(t, i / (SAMPLES - 1)), len(flags))
            flags.append(is_arm)
    tree.balance()
    return tree, flags


def self_check():
    tree = KDTree(2)
    tree.insert((0.0, 0.0, 0.0), 0)
    tree.insert((1.0, 0.0, 0.0), 1)
    tree.balance()
    assert tree.find((0.9, 0.0, 0.0))[1] == 1
    assert min_gap([(0.0, 0.0, 0.0)], [(0.0, 0.0, 0.004)]) - 0.004 < 1e-9


def min_gap(a_points, b_points):
    """Closest approach between two point clouds."""
    if not a_points or not b_points:
        return None
    tree = KDTree(len(b_points))
    for i, p in enumerate(b_points):
        tree.insert(p, i)
    tree.balance()
    return min(tree.find(p)[2] for p in a_points)


def main():
    self_check()
    opts = parse_args()
    threshold = float(opts["threshold"])
    keys = tuple(opts["keys"].split(",")) if opts["keys"] else ARM_KEYS

    rigs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not rigs:
        raise SystemExit("no armature in this .blend — rig and bind it first, then save")
    rig = rigs[0]
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() == rig]
    if not meshes:
        raise SystemExit(f"no mesh bound to {rig.name}")

    for mesh in meshes:
        mw = mesh.matrix_world
        tree, is_arm_sample = bone_tree(rig, keys)
        arm_vgs = {vg.index for vg in mesh.vertex_groups if any(k in vg.name for k in keys)}
        if not arm_vgs:
            log(f"{mesh.name}: no arm vertex groups — not bound yet?")
            continue

        arm_pts, other_pts, bled = [], [], 0
        for v in mesh.data.vertices:
            p = mw @ v.co
            if is_arm_sample[tree.find(p)[1]]:
                arm_pts.append(p)
                continue
            other_pts.append(p)
            if sum(g.weight for g in v.groups if g.group in arm_vgs) > threshold:
                bled += 1

        gap = min_gap(arm_pts, other_pts)
        share = 100 * bled / len(other_pts) if other_pts else 0
        log(f"{mesh.name}: {len(arm_pts)} arm verts, {len(other_pts)} other")
        log(f"  closest arm<->body surface gap : "
            + ("n/a" if gap is None else f"{gap * 1000:.1f} mm"))
        log(f"  non-arm verts with arm weight > {threshold}: {bled} ({share:.1f}%)")
        if gap is not None:
            log(f"  a voxel binder needs cells under {gap * 1000:.1f} mm to keep them apart")


try:
    main()
except SystemExit as e:
    if e.code:
        log(f"ERROR: {e.code}")
        sys.exit(1)
except Exception:
    traceback.print_exc()
    sys.exit(1)
