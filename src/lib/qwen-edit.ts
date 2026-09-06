/**
 * Qwen-Image-Edit 2511 graph builder: re-draw an existing image from an
 * instruction. Identity travels as pixels (the reference), the prompt says only
 * what to change — which is exactly what a turnaround needs.
 *
 * Ported from ../ai-game-asset-workflow/src/lib/qwen-edit.ts, plus optional
 * extra LoRAs and an RMBG matte on the way out.
 */

import {
  WorkflowBuilder,
  type LoadImageInputs,
  type LoraLoaderModelOnlyInputs,
} from "../types/nodes";
import type { Lora } from "./comfy";

const UNET = "qwen-image-edit-2511-Q5_0.gguf";
const CLIP = "qwen_2.5_vl_7b_fp8_scaled.safetensors";
const VAE = "qwen_image_vae.safetensors";
const LIGHTNING_LORA = "qwen\\Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors";

export type Matte = "white" | "alpha" | "none";

export interface QwenEditOpts {
  /** Filename(s) already inside ComfyUI's input/ directory. Up to 3 references. */
  images: string[];
  /** The edit instruction. */
  prompt: string;
  /**
   * Inert while the Lightning LoRA is on: it forces cfg 1.0, and at cfg 1.0
   * ComfyUI skips the unconditional branch entirely. Wired anyway so dropping
   * the LoRA (steps ~20, cfg ~3) makes it live again.
   */
  negative?: string;
  seed: number;
  /** filename_prefix for SaveImage. */
  prefix: string;
  /** Extra model-only LoRAs stacked after Lightning (e.g. VNCCS PoseStudio). */
  loras?: Lora[];
  /** Background treatment of the result. Default "none". */
  matte?: Matte;
  /** Lightning on (4 steps, cfg 1) — default true. Off: 20 steps, cfg 3, ~6x slower. */
  lightning?: boolean;
}

export function buildQwenEdit(o: QwenEditOpts): ReturnType<WorkflowBuilder["build"]> {
  const w = new WorkflowBuilder();
  const lightning = o.lightning ?? true;

  const unet = w.UnetLoaderGGUF({ unet_name: UNET });
  const clip = w.CLIPLoader({ clip_name: CLIP, type: "qwen_image" });
  const vae = w.VAELoader({ vae_name: VAE });

  let model = unet.MODEL;
  if (lightning) {
    model = w.LoraLoaderModelOnly({ model, lora_name: LIGHTNING_LORA, strength_model: 1 }).MODEL;
  }
  for (const lora of o.loras ?? []) {
    model = w.LoraLoaderModelOnly({
      model,
      lora_name: lora.name as LoraLoaderModelOnlyInputs["lora_name"],
      strength_model: lora.strength,
    }).MODEL;
  }

  // Input filenames are a codegen snapshot of ComfyUI's input/ dir, so a freshly
  // staged image is not in the union yet — cast rather than regenerate.
  const scaled = o.images.slice(0, 3).map(
    (image) =>
      w.ImageScaleToTotalPixels({
        image: w.LoadImage({ image: image as LoadImageInputs["image"] }).IMAGE,
        upscale_method: "lanczos",
        megapixels: 1,
        resolution_steps: 16,
      }).IMAGE,
  );
  if (!scaled.length) throw new Error("buildQwenEdit: at least one image is required");

  const ref = {
    clip: clip.CLIP,
    vae: vae.VAE,
    image1: scaled[0]!,
    ...(scaled[1] ? { image2: scaled[1] } : {}),
    ...(scaled[2] ? { image3: scaled[2] } : {}),
  };
  const positive = w.TextEncodeQwenImageEditPlus({ ...ref, prompt: o.prompt });
  const negative = w.TextEncodeQwenImageEditPlus({ ...ref, prompt: o.negative ?? "" });

  const latent = w.VAEEncode({ pixels: scaled[0]!, vae: vae.VAE });
  const sampled = w.KSampler({
    model,
    positive: positive.CONDITIONING,
    negative: negative.CONDITIONING,
    latent_image: latent.LATENT,
    seed: o.seed,
    steps: lightning ? 4 : 20,
    cfg: lightning ? 1 : 3,
    sampler_name: "euler",
    scheduler: "simple",
    denoise: 1,
  });

  const decoded = w.VAEDecode({ samples: sampled.LATENT, vae: vae.VAE });
  const image = matte(w, decoded.IMAGE, o.matte ?? "none");
  const save = w.SaveImage({ images: image, filename_prefix: o.prefix });

  return w.build({ outputs: { images: save.__id } });
}

/**
 * RMBG-2.0 matte (ComfyUI-RMBG). Every "optional" input must be passed: the
 * node reads them from kwargs unconditionally and KeyErrors when one is missing.
 */
export function matte(
  w: WorkflowBuilder,
  image: ReturnType<WorkflowBuilder["VAEDecode"]>["IMAGE"],
  mode: Matte,
): ReturnType<WorkflowBuilder["VAEDecode"]>["IMAGE"] {
  if (mode === "none") return image;
  return w.RMBG({
    image,
    model: "RMBG-2.0",
    background: mode === "white" ? "Color" : "Alpha",
    background_color: w.AILab_ColorInput({ preset: "white", color: "#FFFFFF" }).COLOR,
    refine_foreground: true,
    sensitivity: 1,
    process_res: 1024,
    mask_blur: 0,
    mask_offset: 0,
    invert_output: false,
  }).IMAGE;
}
