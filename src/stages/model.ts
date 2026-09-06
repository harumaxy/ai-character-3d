/**
 * `c3d model <char> [--version v3.1-20260211] [--faces 20000] [--low-poly]
 *                   [--draft] [--seed n]`
 *
 * Tripo API v3: the four views -> one textured mesh. That is all Tripo does in
 * this pipeline; rigging and animation are Auto-Rig Pro's job (`c3d retarget`).
 *
 *   out/chars/<char>/model/model.glb     textured PBR model (multiview-to-model)
 *   out/chars/<char>/model/preview.webp  Tripo's rendered preview
 *   out/chars/<char>/model/tasks.json    the task id, so a re-run does not re-pay
 *
 * `--faces n` costs nothing; `--low-poly` (+10) buys game-ready edge flow.
 * `--draft` skips texture (20 credits instead of 40) to check geometry first.
 * Anything else Tripo accepts goes in `tripo:` in chars/<char>.yaml.
 * Credit costs: docs/research/tripo-ai.md section 2.
 */

import { join } from "node:path";
import { loadChar } from "../lib/chars";
import { die, ensureDir, flag, has, num, positional } from "../lib/cli";
import { modelDir, viewsDir } from "../lib/paths";
import { download, modelUrl, runTask, tripoClient, uploadFile } from "../lib/tripo";

const VALUE_FLAGS = new Set(["--version", "--faces", "--seed"]);

interface Tasks {
  model?: string;
}

export async function run(argv: string[]): Promise<void> {
  const name = positional(argv, VALUE_FLAGS);
  if (!name)
    die(
      "usage: bun run c3d model <char> [--version v3.1-20260211] [--faces n] " +
        "[--low-poly] [--draft] [--seed n]",
    );
  const client = tripoClient();

  const char = await loadChar(name);
  const dir = modelDir(char.name);
  await ensureDir(dir);
  const tasksFile = Bun.file(join(dir, "tasks.json"));
  const tasks: Tasks = (await tasksFile.exists()) ? await tasksFile.json() : {};
  const save = () => Bun.write(tasksFile, JSON.stringify(tasks, null, 2));

  const geometry = {
    model: flag(argv, "version") ?? "v3.1-20260211",
    texture: true,
    pbr: true,
    texture_quality: "detailed" as const,
    // The views were made to match the front image; keep Tripo's frame on it.
    orientation: "align_image" as const,
    // Bake what the views show instead of re-deriving the texture from geometry.
    texture_alignment: "original_image" as const,
    ...(flag(argv, "faces") ? { face_limit: num(argv, "faces", 0) } : {}),
    // Direct low-poly with usable edge flow (+10 credits, face_limit 500-20000).
    ...(has(argv, "low-poly") ? { smart_low_poly: true } : {}),
    // Geometry only, 20 credits instead of 40 — for checking shape before
    // paying for texture. `orientation: align_image` needs texture, so a draft
    // comes out in Tripo's own frame.
    ...(has(argv, "draft") ? { texture: false, pbr: false } : {}),
    ...(flag(argv, "seed") ? { model_seed: num(argv, "seed", 0) } : {}),
    ...char.tripo,
  };

  // --- geometry -----------------------------------------------------------
  if (!tasks.model) {
    const views = viewsDir(char.name);
    const view = async (v: string) => {
      const p = join(views, `${v}.png`);
      return (await Bun.file(p).exists()) ? uploadFile(client, p) : undefined;
    };
    const front = await view("front");
    if (!front) die(`no ${join(views, "front.png")} — run \`c3d views ${name}\` first`);
    const [left, back, right] = await Promise.all([view("left"), view("back"), view("right")]);
    const missing = [left, back, right].filter((v) => !v).length;
    if (missing) console.warn(`[model] ${missing} side view(s) missing; Tripo will infer them`);
    const task = await runTask(
      client,
      client.multiviewToModel,
      { files: [front, left, back, right], ...geometry },
      "multiview-to-model",
    );
    tasks.model = task.task_id;
    await save();
    await download(modelUrl(task), join(dir, "model.glb"));
    const preview = task.output?.rendered_image_url ?? task.output?.rendered_image;
    if (preview) await download(preview, join(dir, "preview.webp"));
    console.log(`[model] -> ${join(dir, "model.glb")}`);
  } else {
    console.log(`[model] reusing model task ${tasks.model}`);
  }
}
