import { TABLER_ICONS } from "../lib/tablerIcons";
import { tablerContent } from "../db/icons";
import { iconRow, showUrl } from "./helpers";
import type { Scenario } from "./types";

/** A published icon's public page, seen as a visitor who is not signed in. */
export const publicIcon: Scenario = {
  name: "public-icon",
  description:
    "公開アイコンの個別ページ /i/:id を未ログインの訪問者として開く（Tabler クレジット付き）。バイパス無効時は所有者として表示。",
  needs: "user",
  viewAsGuest: true,
  build: (ctx) => {
    const src = TABLER_ICONS.find((i) => i.name === "heart")!;
    const icon = iconRow(ctx, {
      name: "heart",
      content: tablerContent(src),
      isPublic: true,
      tablerSources: [src.name],
    });
    return { icons: [icon], redirectTo: showUrl(icon.id) };
  },
};
