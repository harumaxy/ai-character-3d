/** argv helpers shared by every stage. No dependency on ComfyUI so Tripo/Blender stages stay light. */

import { mkdir } from "node:fs/promises";

export const ensureDir = (path: string) => mkdir(path, { recursive: true }).then(() => {});

/** `--name value` from argv; `alias` adds a short form (`-n`). */
export function flag(argv: string[], name: string, alias?: string): string | undefined {
  const i = argv.findIndex((a) => a === `--${name}` || (alias !== undefined && a === `-${alias}`));
  return i === -1 ? undefined : argv[i + 1];
}

/** Every value of a repeatable flag, in argv order: `--lora a --lora b` -> ["a", "b"]. */
export const flags = (argv: string[], name: string): string[] =>
  argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));

/** `--name` present at all (boolean flag). */
export const has = (argv: string[], name: string): boolean => argv.includes(`--${name}`);

/** `--name 1,2,3` -> ["1","2","3"]; undefined when absent. */
export const list = (argv: string[], name: string): string[] | undefined =>
  flag(argv, name)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** `--name 30` as a number with a fallback; NaN is an error, not a silent default. */
export function num(argv: string[], name: string, fallback: number): number {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`--${name} expects a number, got ${JSON.stringify(raw)}`);
  return n;
}

/**
 * First argv token that is neither a flag nor a flag's value. `valueFlags` is
 * the set of flags that eat the next token; a flag missing from it swallows
 * its own value as the positional.
 */
export const positional = (argv: string[], valueFlags: Set<string>): string | undefined =>
  argv.find((a, i) => !a.startsWith("-") && !valueFlags.has(argv[i - 1] ?? ""));

/** Random 32-bit seed unless `--seed` pinned one. */
export function resolveSeed(argv: string[]): number {
  const pinned = flag(argv, "seed");
  return pinned === undefined ? Math.floor(Math.random() * 2 ** 32) : Number(pinned);
}

/** Print usage and exit 1. */
export function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** `--only walk,run` validated against a catalogue of ids. */
export function pick<T extends { id: string }>(argv: string[], name: string, all: T[]): T[] {
  const only = list(argv, name);
  if (!only) return all;
  const unknown = only.filter((id) => !all.some((m) => m.id === id));
  if (unknown.length)
    die(`unknown --${name} ${unknown.join(", ")}; expected ${all.map((m) => m.id).join(", ")}`);
  return all.filter((m) => only.includes(m.id));
}
