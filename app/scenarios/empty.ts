import type { Scenario } from "./types";

/**
 * A brand-new account opening the dashboard for the first time. The dashboard
 * itself seeds the starter icons on that first visit, so this is exactly what
 * a first-time user sees — not an empty grid.
 */
export const empty: Scenario = {
  name: "empty",
  description:
    "初回利用者のマイアイコン。データ無しの新規ユーザで /icons を開く（初回訪問時にスターターアイコンが seed される）。",
  needs: "fresh-user",
  build: () => ({ icons: [], redirectTo: "/icons" }),
};
