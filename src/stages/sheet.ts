/**
 * `c3d sheet <char> [--only walk,run] [--size 128] [--pass color|normal]`
 *
 * Grid the rendered frames into one sprite sheet: one row per (motion, dir),
 * one column per frame, optionally downscaled to --size with nearest-neighbour
 * (pixel art) — the 8x supersampled render is what makes nearest look right.
 * Writes out/chars/<char>/sheet/<char>[.normal].png + .json (Aseprite-friendly).
 */

import { join } from "node:path";
import sharp from "sharp";
import { loadChar } from "../lib/chars";
import { ensureDir, flag, num, pick, positional } from "../lib/cli";
import { renderDir, sheetDir } from "../lib/paths";
import { DIRS8, MOTIONS, type Dir8 } from "../motions";

const VALUE_FLAGS = new Set(["--only", "--size", "--pass"]);

export interface SheetMeta {
  frameSize: number;
  columns: number;
  rows: { motion: string; dir: Dir8; row: number; frames: number; fps: number }[];
}

export async function run(argv: string[]): Promise<void> {
  const name = positional(argv, VALUE_FLAGS);
  if (!name) {
    console.error(
      "usage: bun run c3d sheet <char> [--only walk,run] [--size 128] [--pass color|normal]",
    );
    process.exit(1);
  }
  const char = await loadChar(name);
  const motions = pick(argv, "only", MOTIONS);
  const pass = flag(argv, "pass") ?? "color";
  const suffix = pass === "normal" ? ".normal" : "";

  const meta = JSON.parse(await Bun.file(join(renderDir(char.name), "meta.json")).text()) as {
    size: number;
    dirs: Dir8[];
  };
  const size = num(argv, "size", meta.size);
  const dirs = meta.dirs;

  const rows: { motion: string; dir: Dir8; files: string[]; fps: number; flip: boolean }[] = [];
  for (const m of motions)
    for (const dir of DIRS8) {
      // 5-direction renders: mirror right-side frames for the left side.
      const src = dirs.includes(dir) ? dir : (dir.replace("left", "right") as Dir8);
      const files = [];
      for (let k = 0; ; k++) {
        const f = join(renderDir(char.name), m.id, src, `${k}${suffix}.png`);
        if (!(await Bun.file(f).exists())) break;
        files.push(f);
      }
      if (!files.length) {
        console.error(`[sheet] ${m.id}/${dir}: no frames — run \`c3d render ${name}\` first`);
        process.exitCode = 1;
        continue;
      }
      rows.push({ motion: m.id, dir, files, fps: m.fps, flip: src !== dir });
    }
  if (!rows.length) process.exit(1);

  const columns = Math.max(...rows.map((r) => r.files.length));
  const composites = [];
  for (const [r, row] of rows.entries())
    for (const [c, file] of row.files.entries()) {
      let img = sharp(file);
      if (row.flip) img = img.flop();
      if (size !== meta.size) img = img.resize(size, size, { kernel: "nearest" });
      composites.push({ input: await img.png().toBuffer(), left: c * size, top: r * size });
    }

  const out = sheetDir(char.name);
  await ensureDir(out);
  const png = join(out, `${char.name}${suffix}.png`);
  await sharp({
    create: { width: columns * size, height: rows.length * size, channels: 4, background: "#0000" },
  })
    .composite(composites)
    .png()
    .toFile(png);

  const json: SheetMeta = {
    frameSize: size,
    columns,
    rows: rows.map((row, r) => ({
      motion: row.motion,
      dir: row.dir,
      row: r,
      frames: row.files.length,
      fps: row.fps,
    })),
  };
  await Bun.write(join(out, `${char.name}${suffix}.json`), JSON.stringify(json, null, 2));
  console.log(`[sheet] ${rows.length} rows x ${columns} frames @ ${size}px -> ${png}`);
}
