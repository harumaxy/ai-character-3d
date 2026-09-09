"""
Retarget Mixamo / Quaternius clips onto an Auto-Rig Pro rig with ARP's Remap
module, baking every clip into one .blend as a named action. Runs inside Blender
against a .blend holding the rigged, skinned character:

  blender --background out/chars/<c>/rig.blend \
      --python scripts/blender/retarget.py -- \
      --clips out/chars/<c>/clips.json --out out/chars/<c>/anim.blend \
      [--target <armature object>] [--dry-run]

The render stage opens that .blend and switches actions. Nothing is exported
here: a GLB per motion meant five copies of the same 27k-triangle mesh, and the
export/import round trip is what drags the glTF importer's hidden bone-display
icosphere into the camera framing. Taking the rigged character to a game engine
is a separate job — see export_godot.py, which drives ARP's own exporter.

clips.json: [{"id": "walk", "fbx": "motions/mixamo/walking.fbx",
              "preset": "mixamo_fk"},
             {"id": "idle", "fbx": "motions/quaternius/UAL1_Standard.fbx",
              "action": "Idle_Loop", "preset": "presets/ual.bmap"}]

`preset` is either an ARP built-in (remap_presets/<name>.bmap, no extension) or
a path to a .bmap file. `action` picks one clip out of a multi-clip FBX
(Quaternius ships every action in one file); omit it for one-clip Mixamo files.

--dry-run stops after the bone mapping and prints, per clip, which preset bones
found no match. Run it first: a preset that silently drops the legs bakes just
as happily as one that works.

Blender exits 0 even on an uncaught exception, so main() is wrapped and exits 1.
"""

import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Matrix

# ARP puts its built-in maps next to the addon. Resolved lazily: the addon may
# be installed as a legacy addon or as an extension, with different roots.
BUILTIN_PRESET_DIR = "remap_presets"

# Target-side names of the ARP arm chain, as the .bmap presets spell them. The
# arms are the only chain whose rest orientation differs between a mocap
# skeleton and an ARP rig; see align_rest_pose().
ARM_TARGETS = ("c_shoulder.", "c_arm_fk.", "c_forearm_fk.", "c_hand_fk.")


def log(msg):
    print("[retarget] " + msg, flush=True)


def parse_args(required=("clips", "out")):
    """`-- --flag value` into a dict. Shared with the sibling stage scripts."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"target": "", "dry-run": False}
    key = None
    for a in argv:
        if a.startswith("--"):
            key = a[2:]
            opts[key] = True
        elif key:
            opts[key] = a
            key = None
    for k in required:
        if k not in opts or opts[k] is True:
            raise SystemExit(f"missing --{k}")
    return opts


def arp_preset_dir():
    """Directory holding ARP's built-in .bmap presets, wherever it is installed."""
    import addon_utils
    for mod in addon_utils.modules():
        if mod.__name__.endswith("auto_rig_pro"):
            d = os.path.join(os.path.dirname(mod.__file__), BUILTIN_PRESET_DIR)
            if os.path.isdir(d):
                return d
    raise SystemExit("Auto-Rig Pro not found — enable the addon before retargeting")


def resolve_preset(preset, preset_dir):
    """A .bmap path stays a path; a bare name resolves against ARP's preset dir."""
    if preset.endswith(".bmap"):
        return os.path.abspath(preset)
    return os.path.join(preset_dir, preset + ".bmap")


def self_check():
    assert resolve_preset("mixamo_fk", "/p") == os.path.join("/p", "mixamo_fk.bmap")
    assert resolve_preset("a/b.bmap", "/p") == os.path.abspath("a/b.bmap")
    assert "c_arm_fk.l".startswith(ARM_TARGETS)
    assert not "c_spine_01.x".startswith(ARM_TARGETS)
    assert not "c_root_master.x".startswith(ARM_TARGETS)


def find_target(name):
    if name:
        rig = bpy.data.objects.get(name)
        if rig is None or rig.type != "ARMATURE":
            raise SystemExit(f"--target {name!r} is not an armature in this .blend")
        return rig
    rigs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    # An ARP rig carries c_traj/c_pos; prefer it over a stray imported skeleton.
    arp = [o for o in rigs if o.pose.bones.get("c_traj") and o.pose.bones.get("c_pos")]
    if len(arp) == 1:
        return arp[0]
    if len(rigs) == 1:
        return rigs[0]
    raise SystemExit(f"pass --target: {len(rigs)} armatures in the .blend "
                     f"({', '.join(o.name for o in rigs)})")


def import_source(path):
    """Import an FBX, returning (armature, its objects, its actions)."""
    objs, acts = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(path))
    new = [o for o in bpy.data.objects if o not in objs]
    new_acts = [a for a in bpy.data.actions if a not in acts]
    rig = next((o for o in new if o.type == "ARMATURE"), None)
    if rig is None:
        raise SystemExit(f"no armature in {path}")
    for a in new_acts:
        drop_object_channels(a)
    return rig, new, new_acts


def drop_object_channels(action):
    """Delete the action's object-level transform curves, keeping the bone ones.

    The FBX importer folds the file's axis convention into the armature object
    -- and keys it, so location/rotation_euler/scale sit in the action next to
    the pose.bones curves. Any frame change then snaps the object back to the
    keyed value, which silently undoes face_target() below. ARP's own
    _freeze_armature deletes the same curves later, so nothing downstream wants
    them; they only need to go before the rest pose is redefined, not after.
    """
    dropped = 0
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                bag = strip.channelbag(slot)
                if bag is None:
                    continue
                for fc in list(bag.fcurves):
                    if not fc.data_path.startswith("pose.bones"):
                        bag.fcurves.remove(fc)
                        dropped += 1
    return dropped


def side_vector(rig, left, right):
    """World vector from the rig's right bone to its left one, at rest, or None.

    Rest, not pose: a posed vector answers "which way is this skeleton facing on
    the frame that happens to be current", and the current frame here is whatever
    the previous clip's bake left behind. On a crouched or mid-roll frame the
    feet cross and the vector flips, so the same FBX would be judged differently
    from one clip to the next. The rest pose is also what ARP's _copy_bone_rest
    actually compares, so it is the honest input.
    """
    l, r = rig.data.bones.get(left), rig.data.bones.get(right)
    if l is None or r is None:
        return None
    return rig.matrix_world @ l.head_local - rig.matrix_world @ r.head_local


def face_target(scene, source_rig, target_rig):
    """Turn the source 180 degrees about Z if it faces away from the target.

    Mixamo exports face -Y once imported, the same way an ARP rig does. The
    Quaternius UAL packs are Unreal exports and come in facing +Y, and ARP's
    remap is not symmetric about that: _copy_bone_rest aims each source bone at
    its target's *world* direction, so on a source that is turned around it
    "aligns" the left arm by folding it across the chest, and every clip then
    bakes with the arms swapped and the torso twisted. Bone rotations are read
    in world space too (_retarget's mat_rest_diff), so the fix is to turn the
    whole armature, not to mirror the bone map.
    """
    # Both sides come out of the bone map, so this works whatever the source
    # calls its bones: upperarm_l/upperarm_r, mixamorig:LeftArm/RightArm...
    rows = {b.name: b.source_bone for b in scene.bones_map_v2 if b.source_bone}
    # Every mapped pair votes. One pair is enough in principle, but the first one
    # the bone map happens to yield is the toes (c_toes_ik.l), whose left/right
    # separation is the smallest on the skeleton -- a weak signal to hang a whole
    # clip on when a wrong answer swaps the arms.
    agree = 0.0
    for tgt_l, src_l in rows.items():
        src_r = rows.get(tgt_l[:-2] + ".r") if tgt_l.endswith(".l") else None
        if src_r is None:
            continue
        tgt = side_vector(target_rig, tgt_l, tgt_l[:-2] + ".r")
        src = side_vector(source_rig, src_l, src_r)
        if tgt is None or src is None or src.length < 1e-4 or tgt.length < 1e-4:
            continue
        agree += tgt.normalized().dot(src.normalized())
    if agree >= 0:
        return False
    source_rig.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ source_rig.matrix_world
    bpy.context.view_layer.update()
    return True


def assign_action(rig, action):
    """Put `action` on `rig`, picking a slot too (Blender 4.4+ needs one)."""
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    if hasattr(rig.animation_data, "action_slot") and len(action.slots):
        if rig.animation_data.action_slot is None:
            rig.animation_data.action_slot = action.slots[0]


def source_actions(rig, new_actions, wanted):
    """Actions to retarget from this FBX: the named one, or whatever it carries."""
    if wanted:
        # The FBX importer prefixes the take: Quaternius' "Jump_Start" arrives as
        # "Armature|Armature|Jump_Start". Match the bare name too.
        for a in new_actions:
            if a.name == wanted or a.name.split("|")[-1] == wanted:
                return [a]
        names = sorted(a.name.split("|")[-1] for a in new_actions)
        raise SystemExit(f"action {wanted!r} not in this file. Available: {names}")
    if rig.animation_data and rig.animation_data.action:
        return [rig.animation_data.action]
    if len(new_actions) == 1:
        return list(new_actions)
    raise SystemExit(f"{rig.name} came in with {len(new_actions)} actions and none active; "
                     'name one with "action"')


def unmatched(scene):
    """Preset rows whose target bone did not exist on the ARP rig."""
    return [b.source_bone for b in scene.bones_map_v2 if b.name in ("", "None")]


def map_bones(scene, source_rig, target_rig, action, preset):
    """Build the bone list and load `preset` over it. Returns unmatched sources."""
    assign_action(source_rig, action)
    scene.target_rig = target_rig.name
    # Setting source_rig fires ARP's update handler, which reads the action (and
    # its slot) off the object — do it after the action is assigned, not before.
    scene.source_rig = source_rig.name
    bpy.context.view_layer.objects.active = target_rig
    bpy.ops.arp.build_bones_list()
    # EXEC_DEFAULT: the operator's invoke() opens a confirmation dialog, which in
    # --background never gets answered.
    try:
        bpy.ops.arp.import_config("EXEC_DEFAULT", filepath=preset, clear_current=True)
    except RuntimeError as e:
        # ARP reports "some preset bones do not exist in the armature" at ERROR
        # level even though the import succeeded, and bpy.ops turns any ERROR
        # report into an exception. A preset built for a full facial rig always
        # trips it (LeftEye/RightEye) on a rig built without facial bones. The
        # bones that actually matter are reported by unmatched() below.
        if "do not exist in the armature" not in str(e):
            raise
        # Every name here is a preset row that never made it into the bone list,
        # so the joint simply does not animate. Case matters: the Unreal preset
        # says "head" and Quaternius' UAL rig says "Head", and that one silently
        # costs you the head. Print them all — this is the reason to --dry-run.
        missing = [ln.replace("Error:", "").strip() for ln in str(e).splitlines()[1:]]
        missing = [m for m in missing if m]
        log(f"  preset rows dropped ({len(missing)}): {', '.join(missing)}")
    return unmatched(scene)


def align_rest_pose(scene, source_rig):
    """Pose the source's arms into the target's rest pose before baking.

    ARP retargets a source bone's rotation *relative to its own rest pose*, so a
    T-posed Mixamo skeleton driving an A-posed ARP rig adds the whole 65 degrees
    between the two rest poses to every arm key: the upper arms swing past
    vertical and the hands cross over the chest. This is the Remap panel's
    "Redefine Rest Pose" -> "Copy Selected Bones Rotation" -> "Apply", which
    damped-tracks each selected source bone onto its target's rest direction and
    stores the result as a per-bone offset (preserve=True leaves the source
    armature's own rest pose alone).

    Only the arms. ARP's manual says to select the *misaligned* bones, and on
    these skeletons that is the arm chain alone -- spine, pelvis and legs rest in
    the same direction on both rigs. Handing copy_bone_rest the spine or the root
    aims them at a controller that is not a spine direction at all, and every
    clip that starts crouched (Mixamo's sneak, UAL's Jump_Start) bakes with the
    torso tipped flat forward. Fingers are skipped too: they are already aligned
    and invisible at sprite scale.
    """
    mapped = {b.source_bone for b in scene.bones_map_v2 if b.name.startswith(ARM_TARGETS)}
    if not mapped:
        return 0
    # EXEC_DEFAULT: invoke() opens a props dialog that --background never answers.
    bpy.ops.arp.redefine_rest_pose("EXEC_DEFAULT", preserve=True, rest_pose="REST")
    # Leaves the source rig active and in pose mode with nothing selected.
    # Blender 5 dropped Bone.select; PoseBone.select is what is left. Selecting
    # only the arms also dodges an ARP bug: _copy_bone_rest never resets its
    # target name between bones, so an unselected one would otherwise get aimed
    # at whatever the previous bone matched.
    for pb in source_rig.pose.bones:
        pb.select = pb.name in mapped
    bpy.ops.arp.copy_bone_rest()
    bpy.ops.arp.save_pose_rest()
    bpy.ops.object.mode_set(mode="OBJECT")
    return len(mapped)


def remove(objects, actions):
    """Drop an imported source: its objects and its takes.

    The FBX importer marks every take with a fake user, so they survive both the
    source armature's deletion and the save. Left alone, one Quaternius file
    parks 45 unused actions in the .blend next to the five that mean something.
    """
    for o in objects:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    for a in actions:
        if a.name in bpy.data.actions:
            a.use_fake_user = False
            bpy.data.actions.remove(a)


def main():
    self_check()
    opts = parse_args()
    dry = bool(opts["dry-run"])
    with open(opts["clips"], encoding="utf-8") as f:
        clips = json.load(f)

    preset_dir = arp_preset_dir()
    target = find_target(opts["target"])
    log(f"target rig: {target.name}")

    # One import per FBX: Quaternius keeps 45 clips in a 20 MB file, and Mixamo
    # files are re-used across motions too.
    by_fbx = {}
    for c in clips:
        by_fbx.setdefault(c["fbx"], []).append(c)

    failures, baked_names = [], []
    for fbx, group in by_fbx.items():
        log(f"{fbx}: {len(group)} clip(s)")
        source, imported, imported_acts = import_source(fbx)
        try:
            for c in group:
                preset = resolve_preset(c["preset"], preset_dir)
                if not os.path.isfile(preset):
                    raise SystemExit(f"no such preset: {preset}")
                act = source_actions(source, imported_acts, c.get("action"))[0]
                missing = map_bones(bpy.context.scene, source, target, act, preset)
                if face_target(bpy.context.scene, source, target):
                    log("  turned the source 180 deg: it faced away from the rig")
                if missing:
                    log(f"  {c['id']}: {len(missing)} unmapped source bone(s): "
                        + ", ".join(missing))
                    failures.append(c["id"])
                if dry:
                    log(f"  {c['id']}: mapped {len(bpy.context.scene.bones_map_v2)} bones "
                        f"from {act.name} (dry run, not baked)")
                    continue
                bpy.ops.arp.auto_scale()
                n = align_rest_pose(bpy.context.scene, source)
                log(f"  {c['id']}: rest pose aligned on {n} arm bone(s)")
                start, end = act.frame_range
                bpy.ops.arp.retarget("EXEC_DEFAULT", frame_start=int(start),
                                     frame_end=int(end))
                baked = target.animation_data.action
                baked.name = c["id"]
                # Nothing points at a baked action once the next clip replaces it
                # on the rig, and unused actions do not survive a save.
                baked.use_fake_user = True
                baked_names.append(c["id"])
                log(f"  {c['id']}: baked {int(end - start) + 1} frames")
        finally:
            remove(imported, imported_acts)

    if dry:
        if failures:
            raise SystemExit(f"unmapped bones in: {', '.join(failures)} — fix the preset "
                             "in the ARP Remap panel and re-export it")
        log("dry run, nothing saved")
        return

    path = os.path.abspath(opts["out"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    log(f"{len(baked_names)} action(s) -> {path}: {', '.join(baked_names)}")


# Guarded: export_godot.py imports this module for find_target/parse_args.
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
