/**
 * `c3d export <char> [--out path] [--blend path] [--target name]
 *                    [--rig-type universal] [--blender exe]`
 *
 * Blender headless: hand out/chars/<char>/anim.blend to Auto-Rig Pro's own
 * exporter and write out/chars/<char>/<char>.glb — the deform skeleton with
 * Godot humanoid bone names, the skinned meshes, and one glTF animation per
 * retargeted action. Godot 4 imports it as a Skeleton3D + AnimationPlayer.
 *
 * This is the game-engine branch of the pipeline; `c3d render` is the sprite
 * one. Both read the same anim.blend and neither needs the other.
 */

import { runBlender } from "../lib/blender";
import { loadChar } from "../lib/chars";
import { die, flag, positional } from "../lib/cli";
import { animBlend, godotGlb } from "../lib/paths";

const VALUE_FLAGS = new Set(["--out", "--blend", "--target", "--rig-type", "--blender"]);

export async function run(argv: string[]): Promise<void> {
  const name = positional(argv, VALUE_FLAGS);
  if (!name)
    die(
      "usage: bun run c3d export <char> [--out path] [--blend path] " +
        "[--target armature] [--rig-type universal] [--blender exe]",
    );
  const char = await loadChar(name);

  const blend = flag(argv, "blend") ?? animBlend(char.name);
  if (!(await Bun.file(blend).exists()))
    die(`[export] no ${blend} — run \`bun run c3d retarget ${char.name}\` first`);

  const out = flag(argv, "out") ?? godotGlb(char.name);
  const rigType = flag(argv, "rig-type");
  await runBlender({
    script: "export_godot.py",
    exe: flag(argv, "blender"),
    blend,
    args: [
      "--out",
      out,
      ...(flag(argv, "target") ? ["--target", flag(argv, "target")!] : []),
      ...(rigType ? ["--rig-type", rigType] : []),
    ],
  });
  console.log(`[export] -> ${out}`);
}
