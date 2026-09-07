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
   * path to a .bmap.
   */
  preset: string;
  /** Frames to sample from the clip. */
  frames: number;
  /** true: the last sample stops just before the clip wraps (cycles). false: include the clip's end. */
  loop: boolean;
  /** Playback fps written to the sheet JSON. */
  fps: number;
}

// ARP ships two generations of Mixamo map. mixamo_fk/mixamo_ik are the old
// ones: bare bone names (Hips, not mixamorig:Hips) and a two-bone spine, which
// drops Mixamo's Spine entirely and leaves c_spine_03.x unanimated on a rig
// built with ARP's own default of three. mixamo_fbx_ik is the current one --
// three spine bones, no unmapped rows, and it retargets the feet through
// c_foot_ik with a knee pole instead of FK, which is what ARP recommends for
// locomotion. Same hand placement as the FK map, measured against the source.
const MIXAMO = "mixamo_fbx_ik";

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
