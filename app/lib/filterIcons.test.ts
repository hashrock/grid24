import { describe, expect, it } from "vitest";
import { FILTER_THRESHOLD, filterByName } from "./filterIcons";

const icons = [
  { name: "heart", authorName: "Pat" },
  { name: "日本語の名前と絵文字 🎨✨ のアイコン", authorName: null },
  { name: "Arrow-Right", authorName: "Sam" },
];

describe("filterByName", () => {
  it("returns everything, in order, for an empty or blank query", () => {
    expect(filterByName(icons, "")).toEqual(icons);
    expect(filterByName(icons, "   ")).toEqual(icons);
  });

  it("matches the name case-insensitively on a partial string", () => {
    expect(filterByName(icons, "ARROW").map((i) => i.name)).toEqual(["Arrow-Right"]);
    expect(filterByName(icons, "本語").map((i) => i.name)).toEqual([icons[1].name]);
  });

  it("also matches the author when one is present", () => {
    expect(filterByName(icons, "sam").map((i) => i.name)).toEqual(["Arrow-Right"]);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    expect(filterByName(icons, "zzz")).toEqual([]);
  });

  it("the filter box appears only once a list is long enough to need it", () => {
    expect(FILTER_THRESHOLD).toBeGreaterThan(3);
  });
});
