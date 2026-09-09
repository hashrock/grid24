import { TABLER_ICONS } from "../lib/tablerIcons";
import { tablerContent } from "../db/icons";
import { iconRow } from "./helpers";
import type { Scenario } from "./types";

const byName = (name: string) => TABLER_ICONS.find((i) => i.name === name)!;

/** A few icons, some published, some still private, one drawn from scratch. */
export const typical: Scenario = {
  name: "typical",
  description: "ふつうの利用状態。公開 2 件・非公開 3 件（うち 1 件は白紙）のマイアイコン。",
  needs: "user",
  build: (ctx) => ({
    icons: [
      iconRow(ctx, { name: "heart", content: tablerContent(byName("heart")), isPublic: true, tablerSources: ["heart"], ageMinutes: 0 }),
      iconRow(ctx, { name: "home", content: tablerContent(byName("home")), isPublic: true, tablerSources: ["home"], ageMinutes: 10 }),
      iconRow(ctx, { name: "star", content: tablerContent(byName("star")), tablerSources: ["star"], ageMinutes: 20 }),
      iconRow(ctx, { name: "check", content: tablerContent(byName("check")), tablerSources: ["check"], ageMinutes: 30 }),
      iconRow(ctx, { name: "Untitled", content: "[]", ageMinutes: 40 }),
    ],
    redirectTo: "/icons",
  }),
};
