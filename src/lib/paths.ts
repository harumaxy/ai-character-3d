import { join } from "node:path";

/** Repo root resolved from this file, not cwd — `bun run` inherits whatever cwd the shell had. */
export const REPO_ROOT = join(import.meta.dir, "../..");
export const OUT_DIR = join(REPO_ROOT, "out");
export const IN_DIR = join(REPO_ROOT, "in");
export const CHARS_DIR = join(REPO_ROOT, "chars");
export const SCRIPTS_DIR = join(REPO_ROOT, "scripts");

/**
 * Namespace every SaveImage filename_prefix under, so this project's files sit
 * apart from other projects inside ComfyUI's output/ directory.
 */
export const GEN_PREFIX = "c3d";
export const genPrefix = (...parts: string[]): string => [GEN_PREFIX, ...parts].join("/");

/** Per-character output tree. Every stage reads the previous stage's directory here. */
export const charDir = (name: string) => join(OUT_DIR, "chars", name);
export const conceptDir = (name: string) => join(charDir(name), "concept");
export const viewsDir = (name: string) => join(charDir(name), "views");
export const modelDir = (name: string) => join(charDir(name), "model");
export const renderDir = (name: string) => join(charDir(name), "render");
export const sheetDir = (name: string) => join(charDir(name), "sheet");
