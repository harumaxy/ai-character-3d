/**
 * Run Blender headless (`blender -b --python script.py -- args`) from bun.
 * MCP is for poking at a live Blender; this is for reproducible batch jobs.
 */

import { join } from "node:path";
import { SCRIPTS_DIR } from "./paths";

/**
 * `--blender` > $BLENDER > PATH > the Windows installer's default location
 * (newest version first). The Microsoft Store build is not usable: its exe is
 * ACL-locked and its launcher alias swallows stdout.
 */
export async function findBlender(explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit;
  if (process.env.BLENDER) return process.env.BLENDER;
  const onPath = Bun.which("blender");
  if (onPath) return onPath;
  if (process.platform !== "win32") return undefined;
  const root = "C:\\Program Files\\Blender Foundation";
  const hits = await Array.fromAsync(new Bun.Glob("Blender */blender.exe").scan({ cwd: root }));
  // "Blender 5.2" < "Blender 5.10" lexically; compare the numeric version instead.
  const ver = (p: string) =>
    (p.match(/Blender (\d+)\.(\d+)/) ?? []).slice(1, 3).map(Number) as [number, number];
  hits.sort((a, b) => ver(a)[0] - ver(b)[0] || ver(a)[1] - ver(b)[1]);
  return hits.length ? join(root, hits.at(-1)!) : undefined;
}

export interface BlenderRun {
  /** Script under scripts/blender/. */
  script: string;
  /** Arguments after `--`, handed to the script's own parser. */
  args: string[];
  /** Explicit exe (`--blender` flag). */
  exe?: string;
  /** Open this .blend before running the script (defaults to the factory scene). */
  blend?: string;
}

/** Spawn Blender, stream its stdout/stderr, and throw on a non-zero exit. */
export async function runBlender(o: BlenderRun): Promise<void> {
  const exe = await findBlender(o.exe);
  if (!exe) throw new Error("blender not found — install it, pass --blender <exe>, or set BLENDER");
  const script = join(SCRIPTS_DIR, "blender", o.script);
  const argv = [exe, "--background"];
  if (o.blend) argv.push(o.blend);
  argv.push("--python", script, "--", ...o.args);
  console.log(`[blender] ${exe}\n[blender] ${o.script} ${o.args.join(" ")}`);
  const proc = Bun.spawn(argv, { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`blender exited ${code}`);
}
