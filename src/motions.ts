/**
 * Motion catalogue. `c3d retarget` bakes each entry onto the character's
 * Auto-Rig Pro rig as an action of the same id, and `c3d render` renders that
 * action from eight directions.
 *
 * The clips live under motions/ and are gitignored; the READMEs there say where
 * to download them.
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
  /** Also the name of the baked action in anim.blend, and the sprite folder. */
  id: string;
  /** Source FBX under motions/, repo-relative. */
  fbx: string;
  /** Action inside `fbx`. Omit for one-clip files (Mixamo); the UAL packs need it. */
  action?: string;
  /**
   * Auto-Rig Pro bone map: a built-in preset name (ARP's remap_presets/) or a
   * path to a .bmap. FK maps, not IK — sprite frames never see a pole vector,
   * and IK poles are what goes wrong first on a rig ARP did not generate itself.
   */
  preset: string;
  /** Frames to sample from the clip. */
  frames: number;
  /** true: the last sample stops just before the clip wraps (cycles). false: include the clip's end. */
  loop: boolean;
  /** Playback fps written to the sheet JSON. */
  fps: number;
}

const MIXAMO = "mixamo_fk";
// Quaternius/UAL is UE Mannequin naming, so ARP's built-in Unreal map is the
// starting point — but ARP spells the head bone "head" and UAL spells it
// "Head", and the mismatch silently drops the head from the bone list.
// motions/quaternius/ual.bmap is that preset with the one name corrected.
const UAL1 = "motions/quaternius/UAL1_Standard.fbx";
const UAL_MAP = "motions/quaternius/ual.bmap";

export const MOTIONS: Motion[] = [
  { id: "idle", fbx: "motions/mixamo/idle.fbx", preset: MIXAMO, frames: 4, loop: true, fps: 4 },
  { id: "walk", fbx: "motions/mixamo/walking.fbx", preset: MIXAMO, frames: 8, loop: true, fps: 8 },
  { id: "run", fbx: "motions/mixamo/running.fbx", preset: MIXAMO, frames: 8, loop: true, fps: 10 },
  {
    id: "sneak",
    fbx: "motions/mixamo/crouched sneaking right.fbx",
    preset: MIXAMO,
    frames: 8,
    loop: true,
    fps: 8,
  },
  {
    id: "jump",
    fbx: UAL1,
    action: "Jump_Start",
    preset: UAL_MAP,
    frames: 4,
    loop: false,
    fps: 10,
  },
];
