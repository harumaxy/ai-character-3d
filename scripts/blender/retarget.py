"""
Retarget Mixamo / Quaternius clips onto an Auto-Rig Pro rig with ARP's Remap
module, and write one GLB per motion where the render stage already looks for
them. Runs inside Blender against a .blend holding the rigged, skinned character:

  blender --background out/chars/<c>/rig.blend \
      --python scripts/blender/retarget.py -- \
      --clips out/chars/<c>/clips.json --out out/chars/<c>/model/anim \
      [--target <armature object>] [--dry-run]

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
import os
import sys
import traceback

import bpy

# ARP puts its built-in maps next to the addon. Resolved lazily: the addon may
# be installed as a legacy addon or as an extension, with different roots.
BUILTIN_PRESET_DIR = "remap_presets"


def log(msg):
    print("[retarget] " + msg, flush=True)


def parse_args():
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
    for k in ("clips", "out"):
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
    """Import an FBX, returning (armature, every object it brought in)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(path))
    new = [o for o in bpy.data.objects if o not in before]
    rig = next((o for o in new if o.type == "ARMATURE"), None)
    if rig is None:
        raise SystemExit(f"no armature in {path}")
    return rig, new


def assign_action(rig, action):
    """Put `action` on `rig`, picking a slot too (Blender 4.4+ needs one)."""
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    if hasattr(rig.animation_data, "action_slot") and len(action.slots):
        if rig.animation_data.action_slot is None:
            rig.animation_data.action_slot = action.slots[0]


def source_actions(rig, new_objects, wanted):
    """Actions to retarget from this FBX: the named one, or whatever it carries."""
    if wanted:
        act = bpy.data.actions.get(wanted)
        if act is None:
            names = sorted(a.name for a in bpy.data.actions)
            raise SystemExit(f"action {wanted!r} not in the file. Available: {names}")
        return [act]
    for o in new_objects:
        if o.animation_data and o.animation_data.action:
            return [o.animation_data.action]
    raise SystemExit(f"{rig.name} came in without an action; name one with \"action\"")


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
    bpy.ops.arp.import_config("EXEC_DEFAULT", filepath=preset, clear_current=True)
    return unmatched(scene)


def export_clip(target_rig, action, path):
    """Write target_rig + its meshes with `action` active as a one-clip GLB."""
    assign_action(target_rig, action)
    start, end = action.frame_range
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = int(start), int(end)
    bpy.ops.object.select_all(action="DESELECT")
    target_rig.select_set(True)
    for o in bpy.data.objects:
        if o.type == "MESH" and o.find_armature() == target_rig:
            o.select_set(True)
    bpy.context.view_layer.objects.active = target_rig
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        # ACTIVE_ACTIONS, not ACTIONS: every earlier clip is still in the .blend
        # and ACTIONS would pack all of them into every file.
        export_animation_mode="ACTIVE_ACTIONS",
    )


def remove(objects):
    for o in objects:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)


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

    failures = []
    for fbx, group in by_fbx.items():
        log(f"{fbx}: {len(group)} clip(s)")
        source, imported = import_source(fbx)
        try:
            for c in group:
                preset = resolve_preset(c["preset"], preset_dir)
                if not os.path.isfile(preset):
                    raise SystemExit(f"no such preset: {preset}")
                act = source_actions(source, imported, c.get("action"))[0]
                missing = map_bones(bpy.context.scene, source, target, act, preset)
                if missing:
                    log(f"  {c['id']}: {len(missing)} unmapped source bone(s): "
                        + ", ".join(missing))
                    failures.append(c["id"])
                if dry:
                    log(f"  {c['id']}: mapped {len(bpy.context.scene.bones_map_v2)} bones "
                        f"from {act.name} (dry run, not baked)")
                    continue
                bpy.ops.arp.auto_scale()
                start, end = act.frame_range
                bpy.ops.arp.retarget("EXEC_DEFAULT", frame_start=int(start),
                                     frame_end=int(end))
                baked = target.animation_data.action
                baked.name = c["id"]
                baked.use_fake_user = True
                out = os.path.join(opts["out"], c["id"] + ".glb")
                export_clip(target, baked, out)
                log(f"  {c['id']} -> {out} ({int(end - start) + 1} frames)")
        finally:
            remove(imported)

    if dry and failures:
        raise SystemExit(f"unmapped bones in: {', '.join(failures)} — fix the preset "
                         "in the ARP Remap panel and re-export it")
    log("done")


try:
    main()
except SystemExit as e:
    if e.code:
        log(f"ERROR: {e.code}")
        sys.exit(1)
except Exception:
    traceback.print_exc()
    sys.exit(1)
