import { expect, test } from "bun:test";
import sharp from "sharp";
import { facesRight } from "./views";

/** A torso with the head offset to one side — the only cue facesRight uses. */
const figure = (headLeft: number) =>
  sharp({ create: { width: 400, height: 500, channels: 3, background: "#fff" } })
    .composite([
      {
        input: { create: { width: 90, height: 60, channels: 3, background: "#000" } },
        left: headLeft,
        top: 15,
      },
      {
        input: { create: { width: 110, height: 200, channels: 3, background: "#000" } },
        left: 145,
        top: 180,
      },
    ])
    .png()
    .toBuffer();

test("facesRight follows the head offset, not the prompt", async () => {
  expect(await facesRight(await figure(230))).toBe(true);
  expect(await facesRight(await figure(80))).toBe(false);
});
