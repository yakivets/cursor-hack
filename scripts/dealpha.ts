// Post-process the generated character PNGs: chroma-key the near-white
// background to transparent, write back as RGBA PNGs.
// Run with: npx tsx scripts/dealpha.ts

import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";

const ASSETS_DIR = path.resolve("public/assets");
// All 3 channels must exceed this for a pixel to be considered "background".
// Safe vs. all 5 shirt colors (none have all RGB above ~220).
const WHITE_THRESHOLD = 225;

async function dealpha(file: string): Promise<void> {
  const inPath = path.join(ASSETS_DIR, file);
  const img = sharp(inPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  if (channels < 3) throw new Error(`${file}: unexpected channels=${channels}`);

  const out = Buffer.alloc(width * height * 4);
  let kept = 0;
  let removed = 0;
  for (let i = 0, j = 0; i < data.length; i += channels, j += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    out[j] = r;
    out[j + 1] = g;
    out[j + 2] = b;
    if (r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD) {
      out[j + 3] = 0;
      removed++;
    } else {
      out[j + 3] = 255;
      kept++;
    }
  }

  await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(inPath);

  const total = kept + removed;
  const pct = ((removed / total) * 100).toFixed(1);
  console.log(`${file}: ${width}x${height} → cleared ${pct}% (${removed} px), kept ${kept} px`);
}

async function main(): Promise<void> {
  const files = await fs.readdir(ASSETS_DIR);
  const targets = files.filter((f) => /^character(-\d+)?\.png$/.test(f));
  if (targets.length === 0) {
    console.log("No character PNGs found.");
    return;
  }
  for (const f of targets) await dealpha(f);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
