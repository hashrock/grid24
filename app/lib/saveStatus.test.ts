import { describe, expect, it } from "vitest";
import { describeSaveFailure, hasUnsavedWork, saveStatusLabel } from "./saveStatus";

describe("describeSaveFailure", () => {
  it("tells the user to log in again when the server no longer sees them as the owner", () => {
    for (const status of [401, 403, 404]) {
      expect(describeSaveFailure(status)).toContain("ログイン");
      expect(describeSaveFailure(status)).toContain("再試行");
    }
  });

  it("blames the network when there was no response at all", () => {
    expect(describeSaveFailure(null)).toContain("通信");
  });

  it("blames the server on 5xx", () => {
    expect(describeSaveFailure(500)).toContain("サーバー");
    expect(describeSaveFailure(503)).toContain("サーバー");
  });

  it("falls back to showing the status code", () => {
    expect(describeSaveFailure(418)).toContain("418");
  });
});

describe("saveStatusLabel / hasUnsavedWork", () => {
  it("only a completed save counts as safe to leave", () => {
    expect(hasUnsavedWork({ kind: "saved" })).toBe(false);
    expect(hasUnsavedWork({ kind: "saving" })).toBe(true);
    expect(hasUnsavedWork({ kind: "dirty" })).toBe(true);
    expect(hasUnsavedWork({ kind: "error", message: "x" })).toBe(true);
  });

  it("a failed save is never labelled as saved", () => {
    expect(saveStatusLabel({ kind: "error", message: "x" })).toBe("保存失敗");
    expect(saveStatusLabel({ kind: "saved" })).toBe("保存済み");
    expect(saveStatusLabel({ kind: "saving" })).toBe("保存中…");
    expect(saveStatusLabel({ kind: "dirty" })).toBe("未保存");
  });
});
