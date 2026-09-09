import { TABLER_ICONS } from "../lib/tablerIcons";
import { combinedTablerContent, tablerContent } from "../db/icons";
import { iconRow } from "./helpers";
import type { Scenario } from "./types";

export const LARGE_ICON_COUNT = 60;

const LONG_NAME =
  "a-very-long-icon-name-that-keeps-going-without-any-spaces-to-see-how-the-card-title-truncates-or-wraps-0123456789";

/**
 * Enough icons to scroll, plus names built to stress the card layout: an
 * unbreakable long name, Japanese with emoji, and a dense many-stroke icon.
 */
export const large: Scenario = {
  name: "large",
  description: `件数が多い状態。${LARGE_ICON_COUNT} 件のマイアイコン（超長い名前・日本語＋絵文字・全スターターを重ねた高密度アイコンを含む）。`,
  needs: "user",
  build: (ctx) => {
    const icons = [
      iconRow(ctx, { name: LONG_NAME, content: tablerContent(TABLER_ICONS[0]), isPublic: true, ageMinutes: 0 }),
      iconRow(ctx, { name: "日本語の名前と絵文字 🎨✨ のアイコン", content: tablerContent(TABLER_ICONS[1]), ageMinutes: 1 }),
      iconRow(ctx, {
        name: "dense",
        content: combinedTablerContent(TABLER_ICONS),
        isPublic: true,
        tablerSources: TABLER_ICONS.map((i) => i.name),
        ageMinutes: 2,
      }),
    ];
    for (let i = icons.length; i < LARGE_ICON_COUNT; i++) {
      const src = TABLER_ICONS[i % TABLER_ICONS.length];
      icons.push(
        iconRow(ctx, {
          name: `${src.name}-${String(i + 1).padStart(2, "0")}`,
          content: tablerContent(src),
          isPublic: i % 3 === 0,
          tablerSources: [src.name],
          ageMinutes: i,
        })
      );
    }
    return { icons, redirectTo: "/icons" };
  },
};
