/**
 * A starter set of Tabler Icons (https://tabler.io/icons) — MIT License,
 * (c) Tabler. Each icon is designed on a 24x24 grid with a 2px stroke, which
 * matches this editor's grid. The invisible `M0 0h24v24H0z` bounding-box path
 * that Tabler ships in every SVG is intentionally omitted.
 */
export type TablerIcon = {
  /** Icon name (also used as the stored icon name & dedupe key). */
  name: string;
  /** The visible `<path d>` strings from the Tabler SVG. */
  paths: string[];
};

export const TABLER_ICONS: TablerIcon[] = [
  { name: "heart", paths: [
    "M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572",
  ] },
  { name: "star", paths: [
    "M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z",
  ] },
  { name: "home", paths: [
    "M5 12l-2 0l9 -9l9 9l-2 0",
    "M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7",
    "M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6",
  ] },
  { name: "check", paths: ["M5 12l5 5l10 -10"] },
  { name: "x", paths: ["M18 6l-12 12", "M6 6l12 12"] },
  { name: "bolt", paths: ["M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"] },
  { name: "user", paths: [
    "M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0",
    "M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
  ] },
  { name: "bell", paths: [
    "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6",
    "M9 17v1a3 3 0 0 0 6 0v-1",
  ] },
  { name: "arrow-right", paths: [
    "M5 12l14 0",
    "M13 18l6 -6",
    "M13 6l6 6",
  ] },
  { name: "circle-plus", paths: [
    "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0",
    "M9 12h6",
    "M12 9v6",
  ] },
];
