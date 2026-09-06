/**
 * chars/<name>.yaml -> Char. One file per character: the design prompt for the
 * concept stage plus whatever the later stages need to know (height, style).
 */

import { join } from "node:path";
import { CHARS_DIR } from "./paths";

const KNOWN = ["name", "positive", "negative", "style", "height", "tripo"] as const;
type Key = (typeof KNOWN)[number];

export interface Char {
  name: string;
  /** Design description. Prose for FLUX/Qwen, tags for Anima/Illustrious — the model decides. */
  positive: string;
  negative: string;
  /** Free-text style phrase appended to every prompt (e.g. "cel-shaded anime"). */
  style: string;
  /** Standing height in metres; drives the Blender camera framing. */
  height: number;
  /** Overrides for the Tripo task (face_limit, quad, texture_quality ...). */
  tripo: Record<string, unknown>;
}

/** One phrase per line -> one comma-separated run; `#` / `//` to end of line is a comment. */
function joinLines(body: unknown): string {
  return String(body ?? "")
    .split("\n")
    .map((line) =>
      line
        .replace(/(#|\/\/).*$/, "")
        .trim()
        .replace(/,+$/, ""),
    )
    .filter(Boolean)
    .join(", ");
}

export function parseChar(src: string, label = "<string>"): Char {
  const doc = Bun.YAML.parse(src);
  if (doc === null || typeof doc !== "object" || Array.isArray(doc))
    throw new Error(`${label}: expected a YAML mapping of ${KNOWN.join(", ")}`);
  const f = doc as Record<string, unknown>;

  for (const key of Object.keys(f))
    if (!KNOWN.includes(key as Key))
      throw new Error(`${label}: unknown key "${key}", expected one of ${KNOWN.join(", ")}`);

  const name = String(f.name ?? "").trim();
  if (!name) throw new Error(`${label}: "name" is required`);
  const positive = joinLines(f.positive);
  if (!positive) throw new Error(`${label}: "positive" is required and cannot be empty`);

  const height = f.height == null ? 1.7 : Number(f.height);
  if (Number.isNaN(height) || height <= 0) throw new Error(`${label}: "height" must be > 0`);

  const tripo = f.tripo ?? {};
  if (typeof tripo !== "object" || Array.isArray(tripo))
    throw new Error(`${label}: "tripo" must be a mapping`);

  return {
    name,
    positive,
    negative: joinLines(f.negative),
    style: joinLines(f.style),
    height,
    tripo: tripo as Record<string, unknown>,
  };
}

export async function loadChar(name: string): Promise<Char> {
  const id = name.replace(/\.yaml$/, "");
  const file = Bun.file(join(CHARS_DIR, `${id}.yaml`));
  if (!(await file.exists())) throw new Error(`no such character: chars/${id}.yaml`);
  return parseChar(await file.text(), `chars/${id}.yaml`);
}
