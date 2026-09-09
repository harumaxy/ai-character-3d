/**
 * `c3d` — the 3D character pipeline as one CLI with subcommands.
 *
 *   bun run c3d concept <char>            ComfyUI: front-view design candidates
 *   bun run c3d views   <char> --hero f   ComfyUI: front/back/left/right refs for Tripo
 *   bun run c3d model   <char>            Tripo: multiview -> GLB/FBX (+ rig)
 *   bun run c3d retarget <char>           Blender headless: Mixamo/UAL clips -> anim GLBs
 *   bun run c3d render  <char>            Blender headless: 8-direction sprite frames
 *   bun run c3d export  <char>            Blender headless: ARP -> Godot 4 .glb
 *
 * Stages are imported lazily so a broken sibling cannot stop the working ones.
 */

export const STAGES = {
  concept: () => import("./stages/concept"),
  views: () => import("./stages/views"),
  model: () => import("./stages/model"),
  retarget: () => import("./stages/retarget"),
  render: () => import("./stages/render"),
  export: () => import("./stages/export"),
  sheet: () => import("./stages/sheet"),
} satisfies Record<string, () => Promise<{ run(argv: string[]): Promise<void> }>>;

export type Stage = keyof typeof STAGES;

export const usage = () => `usage: bun run c3d <${Object.keys(STAGES).join("|")}> [options]`;

if (import.meta.main) {
  const [stage, ...rest] = process.argv.slice(2);
  if (stage === undefined || !Object.hasOwn(STAGES, stage)) {
    console.error(stage === undefined ? usage() : `unknown stage "${stage}"\n${usage()}`);
    process.exit(1);
  }
  const mod = await STAGES[stage as Stage]();
  await mod.run(rest);
}
