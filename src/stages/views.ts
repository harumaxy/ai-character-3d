/**
 * `c3d views <char> --image <png> [-i <png>] [--only back,right] [--seed n] [--matte white|alpha]
 *                   [--no-angles] [--angles-strength 0.9] [--dry]`
 *
 * From one chosen front image, derive the other orthographic views with
 * Qwen-Image-Edit 2511 (Lightning 4-step). The character's identity is the
 * pixels of --image; the prompts here only say how to turn it.
 *
 * When the fal "Multiple-Angles" LoRA is on the ComfyUI server it is used
 * automatically with its `<sks> <azimuth> <elevation> <distance>` vocabulary,
 * which pins camera height and distance across views (docs/research/
 * comfyui-charsheet.md §2). `--no-angles` falls back to plain instructions.
 *
 * Every view is matted (RMBG-2.0) and normalised to a 1024x1024 canvas so
 * Tripo sees four clean silhouettes at the same scale.
 *
 * Output: out/chars/<char>/views/{front,back,left,right}.png
 *
 * Only one side is generated. Neither the LoRA nor plain instructions steer
 * "left" vs "right" reliably — the same prompt returns either flank depending
 * on the seed — so the side that comes back is measured, not trusted, and the
 * pair is assigned from what the picture actually shows. Getting this backwards
 * is what makes Tripo build a two-faced head with twisted feet: it reads
 * left.png as 90 degrees and right.png as 270, and a swapped pair leaves no
 * consistent way to place the face.
 */

import { basename, join } from "node:path";
import sharp from "sharp";
import { loadChar } from "../lib/chars";
import { die, ensureDir, flag, has, list, num, positional, resolveSeed } from "../lib/cli";
import { connect, matchLora, runWorkflow, uploadImage, type Lora } from "../lib/comfy";
import { conceptDir, genPrefix, viewsDir } from "../lib/paths";
import { buildQwenEdit, type Matte } from "../lib/qwen-edit";

/** Appended to every plain-instruction prompt so identity stays locked across rotations. */
const KEEP = `Keep the exact same character design, face, hairstyle, outfit, colours, proportions and art style unchanged. Same relaxed A-pose with arms slightly away from the body, feet shoulder-width apart. Full body from head to toe at the same scale and the same position in the frame. Orthographic straight-on camera, flat even lighting, no shadows, plain pure white background.`;

/** Fallback wording without the LoRA. */
const PLAIN = {
  back: `Rotate the character 180 degrees to show the back view, seen from directly behind. ${KEEP}`,
  right: `Rotate the character 90 degrees to show a full right side profile view, the character's right side facing the camera, the character facing to the viewer's right. ${KEEP}`,
} satisfies Record<string, string>;

/**
 * Multiple-Angles LoRA vocabulary. One distance word for every view keeps the
 * scale identical; "medium shot" frames a full body at 1 MP.
 */
const ANGLES = {
  back: `<sks> back view eye-level shot medium shot. Same character, same A-pose, plain white background.`,
  right: `<sks> right side view eye-level shot medium shot. Same character, same A-pose, plain white background.`,
} satisfies Record<keyof typeof PLAIN, string>;

/** Filename fragment of the fal LoRA as it sits in ComfyUI's loras/. */
const ANGLES_LORA = "Multiple-Angles";

export type View = keyof typeof PLAIN;
export const VIEWS = Object.keys(PLAIN) as View[];

const VALUE_FLAGS = new Set(["--image", "-i", "--only", "--seed", "--matte", "--angles-strength"]);

/**
 * Tripo's tutorials ask for 2048 or better, but ComfyUI renders these at 1024
 * and upscaling adds no detail for Tripo to read. Raise this once the views
 * themselves are generated (or ESRGAN'd) larger.
 */
const CANVAS = 1024;

/**
 * Which way the subject faces. A head sticks out ahead of the torso, so the
 * centroid of the head band sits towards the side the character looks at.
 */
export async function facesRight(src: string | Buffer): Promise<boolean> {
  const { data, info } = await sharp(src)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const centroid = (from: number, to: number) => {
    let sum = 0;
    let n = 0;
    for (let y = Math.round(h * from); y < Math.round(h * to); y++) {
      for (let x = 0; x < w; x++) {
        if (data[y * w + x]! < 240) {
          sum += x;
          n++;
        }
      }
    }
    return n ? sum / n : w / 2;
  };
  return centroid(0.02, 0.15) > centroid(0.35, 0.7);
}

/** Square the image onto the canvas with the subject centred. */
const square = (src: string | Buffer, dest: string, bg: string) =>
  sharp(src).resize(CANVAS, CANVAS, { fit: "contain", background: bg }).png().toFile(dest);

export async function run(argv: string[]): Promise<void> {
  const name = positional(argv, VALUE_FLAGS);
  const mode = (flag(argv, "matte") ?? "white") as Matte;
  const hero = flag(argv, "image", "i");
  if (!name || !["white", "alpha"].includes(mode))
    die(
      "usage: bun run c3d views <char> --image f.png [-i f.png] [--only back,right] [--seed n] " +
        "[--matte white|alpha] [--no-angles] [--angles-strength 0.9] [--dry]",
    );
  if (!hero)
    die("--image/-i is required (path to a concept image under out/chars/<name>/concept/)");

  const char = await loadChar(name);
  const views = (list(argv, "only") ?? VIEWS) as View[];
  const bad = views.filter((v) => !(v in PLAIN));
  if (bad.length) die(`unknown view ${bad.join(", ")}; expected ${VIEWS.join(", ")}`);

  const out = viewsDir(char.name);
  await ensureDir(out);
  // The front view is the hero itself, squared onto white so all four match.
  await square(
    await sharp(hero).flatten({ background: "#fff" }).toBuffer(),
    join(out, "front.png"),
    "#fff",
  );

  const dry = has(argv, "dry");
  const api = dry ? undefined : await connect();
  const image = api ? await uploadImage(api, hero, `c3d_${char.name}_hero.png`) : basename(hero);
  const baseSeed = resolveSeed(argv);

  // Use the Multiple-Angles LoRA when the server has it, unless told not to.
  let angles: Lora | undefined;
  if (!has(argv, "no-angles")) {
    const names = api ? await api.getLoras() : [ANGLES_LORA];
    try {
      angles = { name: matchLora(names, ANGLES_LORA), strength: num(argv, "angles-strength", 0.9) };
    } catch {
      console.warn(`[views] ${ANGLES_LORA} LoRA not on the server; using plain instructions`);
    }
  }
  const prompts = angles ? ANGLES : PLAIN;
  console.log(
    `[views] hero=${basename(hero)} prompts=${angles ? "multiple-angles" : "plain"} matte=${mode}`,
  );

  for (const [i, view] of views.entries()) {
    const seed = baseSeed + i;
    const workflow = buildQwenEdit({
      images: [image],
      prompt: prompts[view],
      seed,
      matte: mode,
      loras: angles ? [angles] : [],
      // Raw ComfyUI output (numbered) goes under views/raw/; <view>.png is the squared canonical.
      prefix: genPrefix("chars", char.name, "views", "raw", view),
    });
    if (dry) {
      console.log(JSON.stringify(workflow.prompt, null, 2));
      continue;
    }
    console.log(`[views] ${view} seed=${seed}`);
    try {
      const files = await runWorkflow(api!, workflow, view);
      const dest = join(out, `${view}.png`);
      await square(files.at(-1)!, dest, mode === "alpha" ? "#0000" : "#fff");
      console.log(`\r[views] ${view} seed=${seed} -> ${dest}`);
    } catch (e) {
      console.error(`\r[views] ${view} failed: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
  api?.destroy();

  // Assign the pair from the picture, not from the prompt we sent. Tripo reads
  // left.png at 90 degrees (character facing screen-left, its left flank to the
  // camera) and right.png at 270.
  const side = join(out, "right.png");
  if (!dry && (await Bun.file(side).exists())) {
    const buf = Buffer.from(await Bun.file(side).arrayBuffer());
    const right = await facesRight(buf);
    const mirrored = await sharp(buf).flop().png().toBuffer();
    await Bun.write(side, right ? buf : mirrored);
    await Bun.write(join(out, "left.png"), right ? mirrored : buf);
    console.log(`[views] side faces ${right ? "right" : "left"}; mirrored for the other flank`);
  }
}
