// Checks for the PNG mode split: palette, lossless OxiPNG, and keep.
// The full and media engines share the same auto-setting logic.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const engines = [
  ["media", require(path.join(root, "docs", "media", "compressor.js"))],
  ["full", require(path.join(root, "docs", "full", "media.js"))]
];

let failures = 0;
function check(ok, label, detail) {
  if (ok) return;
  failures += 1;
  console.error("FAIL " + label + (detail ? " — " + detail : ""));
}
function equal(actual, expected, label) {
  check(actual === expected, label, JSON.stringify(actual) + " !== " + JSON.stringify(expected));
}

for (const [name, MEDIA] of engines) {
  const preset = MEDIA.presetFor("balanced");
  const png = { kind: "image", ext: "png" };
  const svg = { kind: "vector", ext: "svg" };
  const base = { svgToPng: true, minPx: true };

  const palette = MEDIA.autoSetting(png, preset, { ...base, pngMode: "palette" });
  equal(palette.method, "png", name + ": palette PNG uses the indexed writer");
  equal(palette.oxilevel, 0, name + ": palette PNG does not add an OxiPNG pass");
  const paletteSvg = MEDIA.autoSetting(svg, preset, { ...base, pngMode: "palette" });
  equal(paletteSvg.toPng, true, name + ": palette mode may rasterise SVG");

  const lossless = MEDIA.autoSetting(png, preset, { ...base, pngMode: "lossless" });
  equal(lossless.method, "pnglossless", name + ": lossless PNG uses OxiPNG only");
  equal(lossless.colors, undefined, name + ": lossless PNG has no palette colours");
  const losslessSvg = MEDIA.autoSetting(svg, preset, { ...base, pngMode: "lossless" });
  equal(losslessSvg.toPng, false, name + ": lossless mode keeps SVG vectors");

  const keep = MEDIA.autoSetting(png, preset, { ...base, pngMode: "keep" });
  equal(keep.method, "keep", name + ": keep mode copies PNG");
  const keepSvg = MEDIA.autoSetting(svg, preset, { ...base, pngMode: "keep" });
  equal(keepSvg.toPng, false, name + ": keep mode does not rasterise SVG");

  // The boolean flags are also readable without pngMode, for watermark callers
  // and for assets planned from stored settings.
  equal(MEDIA.autoSetting(png, preset, { ...base, pngPalette: true }).method, "png",
    name + ": pngPalette flag selects palette");
  equal(MEDIA.autoSetting(png, preset, { ...base, pngLossless: true }).method, "pnglossless",
    name + ": pngLossless flag selects lossless");
  equal(MEDIA.autoSetting(png, preset, { ...base, pngPalette: false }).method, "keep",
    name + ": no palette and no lossless keeps PNG");
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("media-invariants: all checks passed");
console.log("  " + JSON.stringify({ engines: engines.map(([name]) => name) }));
