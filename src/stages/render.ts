/**
 * `c3d render <char> [--only walk,run] [--size 512] [--elev 30] [--dirs 5|8]
 *                    [--engine workbench|eevee] [--light camera|world]
 *                    [--passes color[,normal]] [--aa on|off] [--blender exe]`
 *
 * Blender headless: open out/chars/<char>/anim.blend (written by `c3d retarget`)
 * and, for every motion whose action it holds, render N frames x 5 directions to
 * out/chars/<char>/render/<id>/<dir>/<k>.png. No ComfyUI.
 *
 * The defaults are tuned for iteration speed, since the frames end up pixelated
 * anyway. Measured on the 11-motion scavenger set: eevee + 8 directions +
 * color,normal takes 364 s; the defaults below take 38 s. Each lever, timed on
 * one 8-frame motion -- drop the normal pass (39.5 -> 24.1 s), workbench instead
 * of eevee (-> 12.9 s), five directions with the sheet stage mirroring
 * right->left (-> 8.6 s at eight, 5.9 s at five). Resolution is NOT a lever:
 * 256 px costs the same as 512, because the ~0.3 s a frame is per-render
 * overhead on the CPU, not rasterisation.
 *
 * Pass --engine eevee --passes color,normal --dirs 8 for a final, lit render
 * with normal maps and no mirrored halves.
 */

import { join } from "node:path";
import { runBlender } from "../lib/blender";
import { loadChar } from "../lib/chars";
import { die, ensureDir, flag, num, pick, positional } from "../lib/cli";
import { animBlend, renderDir } from "../lib/paths";
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

export async function run(argv: string[]): Promise<void> {
  const name = positional(argv, VALUE_FLAGS);
  if (!name) {
    console.error(
      "usage: bun run c3d render <char> [--only walk,run] [--size 512] [--elev 30] [--dirs 5|8] " +
        "[--engine workbench|eevee] [--light camera|world] [--passes color[,normal]] [--aa on|off] [--facing -y|+y|+x|-x] [--blender exe]",
    );
    process.exit(1);
  }
  const char = await loadChar(name);
  const motions = pick(argv, "only", MOTIONS);

  const blend = animBlend(char.name);
  if (!(await Bun.file(blend).exists()))
    die(`[render] no ${blend} — run \`c3d retarget ${name}\` first`);

  // One action per motion, by id. render_sprites.py checks they are all there
  // and lists what the .blend does have if one is missing.
  const entries = motions.map((m) => ({
    id: m.id,
    action: m.id,
    frames: m.frames,
    loop: m.loop,
  }));

  const out = renderDir(char.name);
  await ensureDir(out);
  const motionsJson = join(out, "motions.json");
  await Bun.write(motionsJson, JSON.stringify(entries, null, 2));

  const opt = (k: string, d: string) => [`--${k}`, flag(argv, k) ?? d];
  await runBlender({
    script: "render_sprites.py",
    exe: flag(argv, "blender"),
    blend,
    args: [
      "--motions",
      motionsJson,
      "--out",
      out,
      // The metre height the camera frames, so every character of a party comes
      // out at one pixels-per-metre. rig.blend must be at real scale for it to
      // mean anything — see orient_model.py.
      "--height",
      String(char.height),
      ...opt("size", String(num(argv, "size", 512))),
      ...opt("elev", "30"),
      // Five: the sheet stage mirrors right->left. A motion that is not
      // left/right symmetric comes out handed the other way on those three
      // directions -- fine for a sword swing at sprite scale, --dirs 8 if not.
      ...opt("dirs", "5"),
      ...opt("engine", "workbench"),
      ...opt("light", "camera"),
      ...opt("passes", "color"),
      ...opt("aa", "on"),
      ...opt("margin", "1.15"),
      ...opt("track", "xy"),
      // Tripo GLB / Mixamo FBX face -Y after import; Quaternius/UE FBX face +Y.
      ...opt("facing", "-y"),
    ],
  });
  console.log(`[render] -> ${out}`);
}
