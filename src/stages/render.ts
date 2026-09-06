/**
 * `c3d render <char> [--only walk,run] [--size 512] [--elev 30] [--dirs 8|5]
 *                    [--engine eevee|workbench] [--light camera|world]
 *                    [--passes color,normal] [--aa on|off] [--blender exe]`
 *
 * Blender headless: for every motion under out/chars/<char>/model/anim/<id>.glb
 * render N frames x 8 directions to out/chars/<char>/render/<id>/<dir>/<k>.png
 * (+ <k>.normal.png). No ComfyUI involved.
 */

import { join } from "node:path";
import { runBlender } from "../lib/blender";
import { loadChar } from "../lib/chars";
import { ensureDir, flag, num, pick, positional } from "../lib/cli";
import { modelDir, renderDir } from "../lib/paths";
import { MOTIONS } from "../motions";

const VALUE_FLAGS = new Set([
  "--only",
  "--size",
  "--elev",
  "--dirs",
  "--engine",
  "--light",
  "--passes",
  "--aa",
  "--blender",
  "--margin",
  "--track",
  "--facing",
]);

export const animPath = (char: string, motion: string) =>
  join(modelDir(char), "anim", `${motion}.glb`);

export async function run(argv: string[]): Promise<void> {
  const name = positional(argv, VALUE_FLAGS);
  if (!name) {
    console.error(
      "usage: bun run c3d render <char> [--only walk,run] [--size 512] [--elev 30] [--dirs 8|5] " +
        "[--engine eevee|workbench] [--light camera|world] [--passes color,normal] [--aa on|off] [--facing -y|+y|+x|-x] [--blender exe]",
    );
    process.exit(1);
  }
  const char = await loadChar(name);
  const motions = pick(argv, "only", MOTIONS);

  const entries = [];
  for (const m of motions) {
    const file = animPath(char.name, m.id);
    if (!(await Bun.file(file).exists())) {
      console.error(
        `[render] ${m.id}: missing ${file} — run \`c3d model ${name} --animate\` first`,
      );
      process.exitCode = 1;
      continue;
    }
    entries.push({ id: m.id, file, frames: m.frames, loop: m.loop });
  }
  if (!entries.length) process.exit(1);

  const out = renderDir(char.name);
  await ensureDir(out);
  const motionsJson = join(out, "motions.json");
  await Bun.write(motionsJson, JSON.stringify(entries, null, 2));

  const opt = (k: string, d: string) => [`--${k}`, flag(argv, k) ?? d];
  await runBlender({
    script: "render_sprites.py",
    exe: flag(argv, "blender"),
    args: [
      "--motions",
      motionsJson,
      "--out",
      out,
      "--height",
      String(char.height),
      ...opt("size", String(num(argv, "size", 512))),
      ...opt("elev", "30"),
      ...opt("dirs", "8"),
      ...opt("engine", "eevee"),
      ...opt("light", "camera"),
      ...opt("passes", "color,normal"),
      ...opt("aa", "on"),
      ...opt("margin", "1.15"),
      ...opt("track", "xy"),
      // Tripo GLB / Mixamo FBX face -Y after import; Quaternius/UE FBX face +Y.
      ...opt("facing", "-y"),
    ],
  });
  console.log(`[render] -> ${out}`);
}
