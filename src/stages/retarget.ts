/**
 * `c3d retarget <char> [--only walk,run] [--blend path] [--target name]
 *                      [--dry-run] [--blender exe]`
 *
 * Blender headless: retarget the Mixamo / Quaternius clips named in MOTIONS onto
 * the character's Auto-Rig Pro rig, and bake each one to
 * out/chars/<char>/model/anim/<id>.glb — the same files `c3d render` reads, so
 * this replaces `c3d model --animate` rather than adding a stage after it.
 *
 * Needs out/chars/<char>/rig.blend: the Tripo model rigged with ARP Smart and
 * skinned (ARP Bind or Voxel Heat Diffuse). That part is hand work; see
 * docs/research/blender-arp-retarget.md.
 *
 * Start with --dry-run. It maps the bones and reports what the preset failed to
 * match, without baking anything.
 */

import { join } from "node:path";
import { runBlender } from "../lib/blender";
import { loadChar } from "../lib/chars";
import { die, ensureDir, flag, has, pick, positional } from "../lib/cli";
import { charDir, modelDir, REPO_ROOT } from "../lib/paths";
import { MOTIONS } from "../motions";

const VALUE_FLAGS = new Set(["--only", "--blend", "--target", "--blender"]);

export async function run(argv: string[]): Promise<void> {
  const name = positional(argv, VALUE_FLAGS);
  if (!name)
    die(
      "usage: bun run c3d retarget <char> [--only walk,run] [--blend path] " +
        "[--target armature] [--dry-run] [--blender exe]",
    );
  const char = await loadChar(name);

  const blend = flag(argv, "blend") ?? join(charDir(char.name), "rig.blend");
  if (!(await Bun.file(blend).exists()))
    die(
      `[retarget] no ${blend} — rig out/chars/${char.name}/model/model.glb with ` +
        "Auto-Rig Pro and save it there first (docs/research/blender-arp-retarget.md)",
    );

  const clips = [];
  for (const m of pick(argv, "only", MOTIONS)) {
    if (!m.fbx || !m.preset) {
      console.log(`[retarget] ${m.id}: no fbx/preset in MOTIONS, skipped`);
      continue;
    }
    const fbx = join(REPO_ROOT, m.fbx);
    if (!(await Bun.file(fbx).exists())) {
      // motions/**/*.fbx is gitignored, so a fresh clone has the catalogue but
      // not the clips. Say which file, not just "missing".
      console.error(`[retarget] ${m.id}: missing ${fbx} — see ${m.fbx.split("/")[1]}/README.md`);
      process.exitCode = 1;
      continue;
    }
    clips.push({ id: m.id, fbx, preset: m.preset, ...(m.action ? { action: m.action } : {}) });
  }
  if (!clips.length) die("[retarget] nothing to do");

  const dir = modelDir(char.name);
  await ensureDir(dir);
  const clipsJson = join(dir, "clips.json");
  await Bun.write(clipsJson, JSON.stringify(clips, null, 2));

  const target = flag(argv, "target");
  await runBlender({
    script: "retarget.py",
    exe: flag(argv, "blender"),
    blend,
    args: [
      "--clips",
      clipsJson,
      "--out",
      join(dir, "anim"),
      ...(target ? ["--target", target] : []),
      ...(has(argv, "dry-run") ? ["--dry-run"] : []),
    ],
  });
  console.log(`[retarget] -> ${join(dir, "anim")}`);
}
