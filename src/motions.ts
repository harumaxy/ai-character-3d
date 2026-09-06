/**
 * Motion catalogue for the render stage. Each motion is an animated model file
 * under out/chars/<char>/model/anim/<id>.glb (Tripo animate_retarget output or
 * a Mixamo download) — the file carries mesh + armature + one clip, so Blender
 * never has to retarget anything itself.
 *
 * `tripo` is the Tripo preset animation name used by `c3d model --animate`.
 * See docs/research/tripo-ai.md for the preset list.
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
  /** Frames to sample from the clip. */
  frames: number;
  /** true: the last sample stops just before the clip wraps (cycles). false: include the clip's end. */
  loop: boolean;
  /** Playback fps written to the sheet JSON. */
  fps: number;
}

export const MOTIONS: Motion[] = [
  { id: "idle", tripo: "preset:idle", frames: 4, loop: true, fps: 4 },
  { id: "walk", tripo: "preset:walk", frames: 8, loop: true, fps: 8 },
  { id: "run", tripo: "preset:run", frames: 8, loop: true, fps: 10 },
];
