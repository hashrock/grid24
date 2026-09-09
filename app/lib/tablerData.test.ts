import { describe, expect, it } from "vitest";
import {
  expandQuery,
  isNonAscii,
  noResultsHint,
  searchTablerIcons,
  type TablerIconEntry,
} from "./tablerData";

const icons: TablerIconEntry[] = [
  { n: "cat", t: ["animal", "pet"], p: [] },
  { n: "category", t: [], p: [] },
  { n: "home", t: ["house"], p: [] },
  { n: "arrow-right", t: ["direction"], p: [] },
  { n: "paw", t: ["animal", "cat", "dog"], p: [] },
];

describe("expandQuery", () => {
  it("is empty for a blank query", () => {
    expect(expandQuery("  ")).toEqual([]);
  });

  it("keeps an English query as-is, lower-cased", () => {
    expect(expandQuery(" Cat ")).toEqual(["cat"]);
  });

  it("adds English aliases for a Japanese word", () => {
    expect(expandQuery("猫")).toContain("cat");
    expect(expandQuery("家")).toEqual(expect.arrayContaining(["home", "house"]));
  });

  it("finds aliases inside a longer Japanese phrase", () => {
    expect(expandQuery("猫の顔")).toContain("cat");
  });
});

describe("searchTablerIcons", () => {
  it("a Japanese query reaches the English icon", () => {
    expect(searchTablerIcons(icons, "猫").map((i) => i.n)).toEqual(["cat", "category", "paw"]);
  });

  it("name matches rank above tag-only matches", () => {
    expect(searchTablerIcons(icons, "cat").map((i) => i.n)).toEqual(["cat", "category", "paw"]);
  });

  it("an empty query returns the head of the list", () => {
    expect(searchTablerIcons(icons, "", 2).map((i) => i.n)).toEqual(["cat", "category"]);
  });
});

describe("noResultsHint", () => {
  it("tells Japanese input that the names are English", () => {
    expect(isNonAscii("象")).toBe(true);
    expect(noResultsHint("象")).toContain("英語");
  });

  it("does not lecture an English query", () => {
    expect(isNonAscii("zebra")).toBe(false);
    expect(noResultsHint("zebra")).not.toContain("英語");
    expect(noResultsHint("zebra")).toContain("zebra");
  });
});
