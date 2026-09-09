import { editUrl, iconRow } from "./helpers";
import type { Scenario } from "./types";

/** The editor right after "+ 新規作成": an untitled icon with no strokes. */
export const editorBlank: Scenario = {
  name: "editor-blank",
  description: "白紙のエディタ。新規作成直後の Untitled アイコンを /icons/:id/edit で開く。",
  needs: "user",
  build: (ctx) => {
    const icon = iconRow(ctx, { name: "Untitled", content: "[]" });
    return { icons: [icon], redirectTo: editUrl(icon.id) };
  },
};
