import { TABLER_ICONS } from "../lib/tablerIcons";
import { combinedTablerContent } from "../db/icons";
import { editUrl, iconRow } from "./helpers";
import type { Scenario } from "./types";

/**
 * The editor loaded with every starter icon overlaid: many paths, arcs turned
 * into cubics, closed and open subpaths, and a long Tabler credit list.
 */
export const editorComplex: Scenario = {
  name: "editor-complex",
  description: `複雑なエディタ。スターター ${TABLER_ICONS.length} 種の全ストロークを重ねた高密度アイコン（閉パス・曲線混在）を /icons/:id/edit で開く。`,
  needs: "user",
  build: (ctx) => {
    const icon = iconRow(ctx, {
      name: "complex",
      content: combinedTablerContent(TABLER_ICONS),
      tablerSources: TABLER_ICONS.map((i) => i.name),
    });
    return { icons: [icon], redirectTo: editUrl(icon.id) };
  },
};
