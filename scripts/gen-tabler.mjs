/**
 * Generates `app/lib/tabler-icons.json` — a trimmed search index of every
 * Tabler *outline* icon, used by the in-editor "Add from Tabler" dialog.
 *
 * It downloads the published `@tabler/icons` tarball from the npm registry,
 * extracts the two metadata files it ships, and merges them:
 *   - icons.json                 → { name, category, tags[] }  (search terms)
 *   - tabler-nodes-outline.json  → [["path", { d }], ...]       (path data)
 *
 * Output is a compact array (keys shortened to keep the bundle small):
 *   [{ n: "heart", t: ["heart","love",...], p: ["M19.5 12.5..."] }, ...]
 *
 * The path data holds only the visible strokes (Tabler's invisible
 * `M0 0h24v24H0z` bounding box lives in the .svg files, not in the node JSON),
 * so each `p` array feeds straight into `pathsToSegments()`.
 *
 * Run:  node scripts/gen-tabler.mjs
 * Re-run whenever you want to pull in newer Tabler icons; commit the result.
 */
import { gunzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PKG = "@tabler/icons";
const REGISTRY = `https://registry.npmjs.org/${PKG}`;
const OUT = fileURLToPath(new URL("../app/lib/tabler-icons.json", import.meta.url));

/** Minimal tar (ustar) reader — enough to pull named files out of the archive. */
function parseTar(buf) {
  const files = new Map();
  for (let off = 0; off + 512 <= buf.length; ) {
    const name = buf.toString("utf8", off, off + 100).replace(/\0.*$/s, "");
    if (!name) {
      off += 512; // padding / end-of-archive blocks
      continue;
    }
    const sizeOct = buf.toString("utf8", off + 124, off + 136).replace(/[\0 ]/g, "");
    const size = parseInt(sizeOct, 8) || 0;
    const start = off + 512;
    files.set(name, buf.subarray(start, start + size));
    off = start + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function main() {
  console.log(`Resolving ${PKG}@latest…`);
  const meta = await fetch(`${REGISTRY}/latest`).then((r) => r.json());
  console.log(`  version ${meta.version}`);

  console.log("Downloading tarball…");
  const tgz = Buffer.from(await fetch(meta.dist.tarball).then((r) => r.arrayBuffer()));
  const files = parseTar(gunzipSync(tgz));

  const read = (p) => {
    const f = files.get(`package/${p}`);
    if (!f) throw new Error(`missing ${p} in tarball`);
    return JSON.parse(f.toString("utf8"));
  };
  const icons = read("icons.json");
  const nodes = read("tabler-nodes-outline.json");

  const out = [];
  for (const [name, info] of Object.entries(icons)) {
    const node = nodes[name];
    if (!node) continue; // filled-only icon, no outline variant
    const paths = node
      .filter((el) => el[0] === "path" && el[1] && el[1].d)
      .map((el) => el[1].d);
    if (paths.length === 0) continue;
    const tags = (info.tags || []).map(String);
    out.push({ n: name, t: tags, p: paths });
  }
  out.sort((a, b) => a.n.localeCompare(b.n));

  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${out.length} icons → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
