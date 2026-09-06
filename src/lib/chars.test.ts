import { describe, expect, test } from "bun:test";
import { parseChar } from "./chars";

describe("parseChar", () => {
  test("joins lines, strips comments, applies defaults", () => {
    const c = parseChar(`
name: hero
positive: |
  a knight in blue armour,  # comment
  short red hair
negative: blurry
`);
    expect(c.positive).toBe("a knight in blue armour, short red hair");
    expect(c.negative).toBe("blurry");
    expect(c.style).toBe("");
    expect(c.height).toBe(1.7);
    expect(c.tripo).toEqual({});
  });

  test("rejects unknown keys and missing fields", () => {
    expect(() => parseChar("name: x\npositive: y\nfoo: 1")).toThrow(/unknown key "foo"/);
    expect(() => parseChar("name: x")).toThrow(/positive/);
    expect(() => parseChar("positive: x")).toThrow(/name/);
    expect(() => parseChar("name: x\npositive: y\nheight: tall")).toThrow(/height/);
  });
});
