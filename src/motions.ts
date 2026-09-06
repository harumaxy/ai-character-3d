/**
 * Motion catalogue. Every motion ends up as out/chars/<char>/model/anim/<id>.glb
 * carrying mesh + armature + one clip, which is all the render stage reads.
 *
 * Two routes produce that file:
 *   `c3d retarget` — the normal one. `fbx`/`action` name a clip in motions/,
 *      retargeted onto the character's Auto-Rig Pro rig with `preset`.
 *   `c3d model --animate` — Tripo's own preset animations, named by `tripo`.
 *      Kept for the Tripo-rig route; see docs/research/tripo-ai.md.
 */

export const DIRS8 = [
  "down",
  "downright",
  "right",
  "upright",
  "up",
  "upleft",
  "left",
  "downleft",
] as const;
export type Dir8 = (typeof DIRS8)[number];

export interface Motion {
  id: string;
  /** Tripo animation preset (`preset:<name>`), if this motion comes from Tripo. */
  tripo?: string;
  /** Source FBX under motions/, repo-relative. Read by `c3d retarget`. */
  fbx?: string;
  /** Action inside `fbx`. Omit for one-clip files (Mixamo); required for the UAL packs. */
  action?: string;
  /**
   * Auto-Rig Pro bone map: a built-in preset name (ARP's remap_presets/) or a
   * path to a .bmap. FK maps, not IK — sprite frames never see a pole vector,
   * and IK poles are what goes wrong first on a rig ARP did not generate itself.
   */
  preset?: string;
  /** Frames to sample from the clip. */
  frames: number;
  /** true: the last sample stops just before the clip wraps (cycles). false: include the clip's end. */
  loop: boolean;
  /** Playback fps written to the sheet JSON. */
  fps: number;
}

const MIXAMO = { preset: "mixamo_fk" } as const;
// Quaternius/UAL is UE Mannequin naming, so ARP's Unreal map is the starting
// point. Case differences (UAL "Head" vs the preset's "head") show up as
// unmapped bones in `c3d retarget --dry-run`; fix them once in ARP's Remap
// panel, export to motions/quaternius/ual.bmap, and point `preset` at that.
const UAL = { fbx: "motions/quaternius/UAL1_Standard.fbx", preset: "unreal_mannequin_remap" };

export const MOTIONS: Motion[] = [
  {
    id: "idle",
    tripo: "preset:idle",
    fbx: "motions/mixamo/idle.fbx",
    ...MIXAMO,
    frames: 4,
    loop: true,
    fps: 4,
  },
  {
    id: "walk",
    tripo: "preset:walk",
    fbx: "motions/mixamo/walking.fbx",
    ...MIXAMO,
    frames: 8,
    loop: true,
    fps: 8,
  },
  {
    id: "run",
    tripo: "preset:run",
    fbx: "motions/mixamo/running.fbx",
    ...MIXAMO,
    frames: 8,
    loop: true,
    fps: 10,
  },
  {
    id: "sneak",
    fbx: "motions/mixamo/crouched sneaking right.fbx",
    ...MIXAMO,
    frames: 8,
    loop: true,
    fps: 8,
  },
  { id: "jump", ...UAL, action: "Jump_Start", frames: 4, loop: false, fps: 10 },
];
