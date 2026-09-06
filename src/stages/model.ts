/**
 * `c3d model <char> [--single] [--version v3.1-20260211] [--faces 20000] [--quad]
 *                   [--rig] [--animate] [--only walk,run] [--fbx] [--task id] [--balance]`
 *
 * Tripo API v3: views -> 3D model (+ rig, + preset animations, + FBX for Blender).
 *
 *   out/chars/<char>/model/model.glb            textured PBR model (multiview-to-model)
 *   out/chars/<char>/model/preview.webp         Tripo's rendered preview
 *   out/chars/<char>/model/rigged.glb           animations/rig (--rig)
 *   out/chars/<char>/model/anim/<motion>.glb    animations/retarget per MOTIONS entry (--animate)
 *   out/chars/<char>/model/model.fbx            models/convert FBX, blender preset (--fbx)
 *   out/chars/<char>/model/tasks.json           every task id, so steps resume instead of re-paying
 *
 * `--single` uses image-to-model on views/front.png only (cheaper, less faithful).
 * `--task <task_id>` adopts an existing model task (rig / animate / fbx only).
 * Do mesh edits (decimate / segment) BEFORE rigging: they discard the rig.
 * Credit costs: docs/research/tripo-ai.md §2.
 */

import { join } from "node:path";
import { loadChar } from "../lib/chars";
import { die, ensureDir, flag, has, num, pick, positional } from "../lib/cli";
import { modelDir, viewsDir } from "../lib/paths";
import { download, modelUrl, runTask, tripoClient, uploadFile } from "../lib/tripo";
import { MOTIONS } from "../motions";

const VALUE_FLAGS = new Set(["--version", "--faces", "--only", "--task", "--seed"]);

interface Tasks {
  model?: string;
  rig?: string;
  anim?: Record<string, string>;
  fbx?: string;
}

export async function run(argv: string[]): Promise<void> {
  const name = positional(argv, VALUE_FLAGS);
  if (!name)
    die(
      "usage: bun run c3d model <char> [--single] [--version v3.1-20260211] [--faces n] [--quad] " +
        "[--rig] [--animate] [--only walk,run] [--fbx] [--task task_id] [--balance]",
    );
  const client = tripoClient();
  if (has(argv, "balance")) {
    const b = await client.getBalance();
    console.log(`[tripo] balance ${b.balance} credits (frozen ${b.frozen ?? 0})`);
  }

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
    ...(flag(argv, "faces") ? { face_limit: num(argv, "faces", 0) } : {}),
    ...(has(argv, "quad") ? { quad: true } : {}),
    ...(flag(argv, "seed") ? { model_seed: num(argv, "seed", 0) } : {}),
    ...char.tripo,
  };

  // --- 1. geometry --------------------------------------------------------
  const explicit = flag(argv, "task");
  if (explicit) tasks.model = explicit;
  if (!tasks.model) {
    const views = viewsDir(char.name);
    const view = async (v: string) => {
      const p = join(views, `${v}.png`);
      return (await Bun.file(p).exists()) ? uploadFile(client, p) : undefined;
    };
    const front = await view("front");
    if (!front) die(`no ${join(views, "front.png")} — run \`c3d views ${name}\` first`);

    const task = has(argv, "single")
      ? await runTask(client, client.imageToModel, { file: front, ...geometry }, "image-to-model")
      : await (async () => {
          const [left, back, right] = await Promise.all([
            view("left"),
            view("back"),
            view("right"),
          ]);
          const missing = [left, back, right].filter((v) => !v).length;
          if (missing)
            console.warn(`[model] ${missing} side view(s) missing; Tripo will infer them`);
          return runTask(
            client,
            client.multiviewToModel,
            { files: [front, left, back, right], ...geometry },
            "multiview-to-model",
          );
        })();
    tasks.model = task.task_id;
    await save();
    await download(modelUrl(task), join(dir, "model.glb"));
    const preview = task.output?.rendered_image_url ?? task.output?.rendered_image;
    if (preview) await download(preview, join(dir, "preview.webp"));
    console.log(`[model] -> ${join(dir, "model.glb")}`);
  } else {
    console.log(`[model] reusing model task ${tasks.model}`);
  }

  // --- 2. rig -------------------------------------------------------------
  if ((has(argv, "rig") || has(argv, "animate")) && !tasks.rig) {
    const check = await runTask(client, client.rigCheck, { input: tasks.model }, "rig-check");
    if (check.output?.riggable === false)
      throw new Error(`Tripo says this model is not riggable: ${JSON.stringify(check.output)}`);
    const rig = await runTask(
      client,
      client.rigModel,
      {
        input: tasks.model,
        model: "v2.5-20260210",
        rig_type: check.output?.rig_type ?? "biped",
        // Mixamo bone names, so Mixamo / UE / Rigify retargeting in Blender maps 1:1.
        spec: "mixamo",
        out_format: "glb",
      },
      "rig",
    );
    tasks.rig = rig.task_id;
    await save();
    await download(modelUrl(rig), join(dir, "rigged.glb"));
    console.log(`[model] rigged -> ${join(dir, "rigged.glb")}`);
  }

  // --- 3. animations -------------------------------------------------------
  if (has(argv, "animate")) {
    const animDir = join(dir, "anim");
    await ensureDir(animDir);
    tasks.anim ??= {};
    for (const m of pick(argv, "only", MOTIONS)) {
      if (!m.tripo) {
        console.log(`[model] ${m.id}: no Tripo preset, skipped`);
        continue;
      }
      const dest = join(animDir, `${m.id}.glb`);
      if (tasks.anim[m.id] && (await Bun.file(dest).exists())) {
        console.log(`[model] ${m.id}: already have ${dest}`);
        continue;
      }
      const t = await runTask(
        client,
        client.retargetAnimation,
        {
          input: tasks.rig!,
          animation: m.tripo,
          out_format: "glb",
          bake_animation: true,
          export_with_geometry: true,
          // Cycle on the spot: the sprite renderer keeps the camera on the character anyway.
          animate_in_place: true,
        },
        `retarget ${m.id}`,
      );
      tasks.anim[m.id] = t.task_id;
      await save();
      await download(modelUrl(t), dest);
      console.log(`[model] ${m.id} -> ${dest}`);
    }
  }

  // --- 4. FBX for Blender hand-work ----------------------------------------
  if (has(argv, "fbx") && !tasks.fbx) {
    const t = await runTask(
      client,
      client.convertModel,
      {
        input: tasks.rig ?? tasks.model!,
        format: "FBX",
        fbx_preset: "blender",
        with_animation: Boolean(tasks.rig),
        pivot_to_center_bottom: true,
      },
      "convert FBX",
    );
    tasks.fbx = t.task_id;
    await save();
    await download(modelUrl(t), join(dir, "model.fbx"));
    console.log(`[model] fbx -> ${join(dir, "model.fbx")}`);
  }
}
