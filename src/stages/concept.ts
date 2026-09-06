/**
 * `c3d concept <char> [--model flux2|anima] [--count 4] [--seed n] [--matte white|alpha|none] [--dry]`
 *
 * Front-view design candidates for a character: full body, A-pose, flat
 * lighting, white background — the framing Tripo wants. The character is the
 * `positive` in chars/<char>.yaml; the framing text lives here so every
 * character gets the same one. Pick a winner, then `c3d views <char> --hero <png>`.
 *
 * Output: out/chars/<char>/concept/<char>_NNNNN_.png
 */

import { WorkflowBuilder } from "../types/nodes";
import type { Char } from "../lib/chars";
import { loadChar } from "../lib/chars";
import { die, flag, has, num, positional, resolveSeed } from "../lib/cli";
import { connect, runWorkflow } from "../lib/comfy";
import { genPrefix } from "../lib/paths";
import { matte, type Matte } from "../lib/qwen-edit";

/**
 * Framing for an image-to-3D reference. Prose, because FLUX.2 / Qwen read
 * prose; Anima gets the tag version below. "A-pose" beats "T-pose" for auto
 * rigging (Tripo, AccuRig) and keeps the arms clear of the torso silhouette.
 */
const FRAMING_PROSE = `Full body character reference sheet, front view, standing in a relaxed A-pose with arms held slightly away from the body and palms facing inward, feet shoulder-width apart, looking straight ahead with a neutral expression. Entire body visible from the top of the head to the soles of the feet, centered, nothing cropped. Orthographic-looking straight-on camera at chest height, no perspective distortion. Flat even studio lighting, no cast shadows, no rim light, plain pure white background, no props, no text.`;

const FRAMING_TAGS = `character reference, full body, standing, straight-on, front view, a-pose, arms slightly away from body, looking at viewer, expressionless, white background, simple background, no shadow, flat lighting, head to toe visible, solo`;

const NEGATIVE_TAGS = `worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, text, watermark, signature, multiple views, multiple girls, multiple boys, cropped, out of frame, blurry, scenery, floor, ground, grey background, gradient background, drop shadow, dynamic pose, holding weapon`;

// --- FLUX.2 klein 9B (default): prose prompt, 4 steps, fits 16GB as fp8 -------

const FLUX2_UNET = "flux-2-klein-9b-fp8.safetensors";
const FLUX2_TEXT_ENCODER = "qwen_3_8b_fp8mixed.safetensors";
const FLUX2_VAE = "flux2-vae.safetensors";

// Tripo wants a tall subject; 832x1216 keeps the whole body at a usable size.
const WIDTH = 832;
const HEIGHT = 1216;

function buildFlux2(o: { char: Char; seed: number; count: number; matte: Matte; argv: string[] }) {
  const w = new WorkflowBuilder();
  const unet = w.UNETLoader({ unet_name: FLUX2_UNET, weight_dtype: "default" });
  const clip = w.CLIPLoader({ clip_name: FLUX2_TEXT_ENCODER, type: "flux2" });
  const vae = w.VAELoader({ vae_name: FLUX2_VAE });

  const text = [o.char.positive, o.char.style, FRAMING_PROSE].filter(Boolean).join(". ");
  const positive = w.CLIPTextEncode({ clip: clip.CLIP, text });
  // Distilled klein has no separate negative branch — zero the conditioning.
  const negative = w.ConditioningZeroOut({ conditioning: positive.CONDITIONING });

  const guider = w.CFGGuider({
    model: unet.MODEL,
    positive: positive.CONDITIONING,
    negative: negative.CONDITIONING,
    cfg: num(o.argv, "cfg", 1),
  });
  const sigmas = w.Flux2Scheduler({ steps: num(o.argv, "steps", 4), width: WIDTH, height: HEIGHT });
  const sampler = w.KSamplerSelect({ sampler_name: "euler" });
  const noise = w.RandomNoise({ noise_seed: o.seed });
  const latent = w.EmptyFlux2LatentImage({ width: WIDTH, height: HEIGHT, batch_size: o.count });
  const sampled = w.SamplerCustomAdvanced({
    noise: noise.NOISE,
    guider: guider.GUIDER,
    sampler: sampler.SAMPLER,
    sigmas: sigmas.SIGMAS,
    latent_image: latent.LATENT,
  });
  const decoded = w.VAEDecode({ samples: sampled.output, vae: vae.VAE });
  const save = w.SaveImage({
    images: matte(w, decoded.IMAGE, o.matte),
    filename_prefix: genPrefix("chars", o.char.name, "concept", o.char.name),
  });
  return w.build({ outputs: { images: save.__id } });
}

// --- Anima (anime / tag prompts) --------------------------------------------

const ANIMA_UNET = "anima-aesthetic-v1.1.safetensors";
const ANIMA_CLIP = "qwen_3_06b_base.safetensors";
const ANIMA_VAE = "qwen_image_vae.safetensors";

function buildAnima(o: { char: Char; seed: number; count: number; matte: Matte; argv: string[] }) {
  const w = new WorkflowBuilder();
  const unet = w.UNETLoader({ unet_name: ANIMA_UNET, weight_dtype: "default" });
  const clip = w.CLIPLoader({ clip_name: ANIMA_CLIP, type: "stable_diffusion" });
  const vae = w.VAELoader({ vae_name: ANIMA_VAE });

  const positive = w.CLIPTextEncode({
    clip: clip.CLIP,
    text: [FRAMING_TAGS, o.char.positive, o.char.style].filter(Boolean).join(", "),
  });
  const negative = w.CLIPTextEncode({
    clip: clip.CLIP,
    text: [NEGATIVE_TAGS, o.char.negative].filter(Boolean).join(", "),
  });
  const latent = w.EmptyLatentImage({ width: WIDTH, height: HEIGHT, batch_size: o.count });
  const sampled = w.KSampler({
    model: unet.MODEL,
    positive: positive.CONDITIONING,
    negative: negative.CONDITIONING,
    latent_image: latent.LATENT,
    seed: o.seed,
    steps: num(o.argv, "steps", 30),
    cfg: num(o.argv, "cfg", 4.5),
    sampler_name: "er_sde",
    scheduler: "simple", // karras / exponential break this model
    denoise: 1,
  });
  const decoded = w.VAEDecode({ samples: sampled.LATENT, vae: vae.VAE });
  const save = w.SaveImage({
    images: matte(w, decoded.IMAGE, o.matte),
    filename_prefix: genPrefix("chars", o.char.name, "concept", o.char.name),
  });
  return w.build({ outputs: { images: save.__id } });
}

const MODELS = { flux2: buildFlux2, anima: buildAnima } as const;
type ModelId = keyof typeof MODELS;

const VALUE_FLAGS = new Set(["--model", "--count", "--seed", "--matte", "--steps", "--cfg"]);

export async function run(argv: string[]): Promise<void> {
  const name = positional(argv, VALUE_FLAGS);
  const model = (flag(argv, "model") ?? "flux2") as ModelId;
  const mode = (flag(argv, "matte") ?? "white") as Matte;
  if (!name || !(model in MODELS) || !["white", "alpha", "none"].includes(mode))
    die(
      `usage: bun run c3d concept <char> [--model ${Object.keys(MODELS).join("|")}] [--count 4] [--seed n] [--matte white|alpha|none] [--steps n] [--cfg n] [--dry]`,
    );

  const char = await loadChar(name);
  const seed = resolveSeed(argv);
  const count = num(argv, "count", 4);
  const workflow = MODELS[model]({ char, seed, count, matte: mode, argv });

  if (has(argv, "dry")) {
    console.log(JSON.stringify(workflow.prompt, null, 2));
    return;
  }

  const api = await connect();
  console.log(`[concept] ${char.name} model=${model} seed=${seed} count=${count} matte=${mode}`);
  try {
    const files = await runWorkflow(api, workflow, "concept");
    console.log(`\r[concept] seed=${seed}`);
    for (const f of files) console.log(`  ${f}`);
  } catch (e) {
    console.error(`\r[concept] failed: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    api.destroy();
  }
}
