/*
 * Regression guard for the SB3 Tools watermark.
 *
 * Run: node build/check/watermark-invariants.mjs
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const require = createRequire(import.meta.url);
const JSZip = require(path.join(root, "docs", "sb3", "jszip.min.js"));
globalThis.JSZip = JSZip;
const SB3 = require(path.join(root, "docs", "sb3", "compressor.js"));
const WM = require(path.join(root, "docs", "watermark.js"));
SB3.setJSZip(JSZip);
SB3.setWatermark(WM);

let failures = 0;
let checks = 0;
function check(ok, message) {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error("FAIL: " + message);
}
function equal(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected),
    message + ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

// 1. MD5 -------------------------------------------------------------
for (const text of ["", "abc", "hello", "日本語のSVG", "a".repeat(1000), "\0\x01\xff"]) {
  const bytes = Buffer.from(text, "utf8");
  equal(WM.md5Bytes(bytes), crypto.createHash("md5").update(bytes).digest("hex"),
    "MD5 matches Node crypto for " + JSON.stringify(text.slice(0, 20)));
}

// 2. Fixed option order and bit packing ------------------------------
{
  const allOn = {};
  for (const key of WM.PROJECT_OPTION_KEYS) allOn[key] = true;
  const allHex = WM.encodeFlags(allOn, WM.PROJECT_OPTION_KEYS);
  equal(allHex.length, Math.ceil(WM.PROJECT_OPTION_KEYS.length / 8) * 2,
    "all project option bits fit the fixed byte length");
  const allFlags = WM.decodeFlags(allHex, WM.PROJECT_OPTION_KEYS);
  check(allFlags.every((flag) => flag.enabled), "all project option bits decode as enabled");
  equal(allFlags.map((flag) => flag.key), WM.PROJECT_OPTION_KEYS,
    "decoded project option keys keep the fixed order");

  const sparse = { stripDefaults: true, freqIds: true, removeMonitors: true, zeroTopLevelCoords: true };
  const sparseHex = WM.encodeFlags(sparse, WM.PROJECT_OPTION_KEYS);
  const sparseFlags = WM.decodeFlags(sparseHex, WM.PROJECT_OPTION_KEYS);
  equal(sparseFlags.filter((flag) => flag.enabled).map((flag) => flag.key),
    WM.PROJECT_OPTION_KEYS.filter((key) => sparse[key]),
    "sparse project option bits decode to the original keys");
  equal(WM.encodeFlags(sparse, WM.PROJECT_OPTION_KEYS), sparseHex,
    "option encoding is deterministic");

  const mediaOn = {};
  for (const key of WM.MEDIA_OPTION_KEYS) mediaOn[key] = true;
  equal(WM.encodeFlags(mediaOn, WM.MEDIA_OPTION_KEYS).length,
    Math.ceil(WM.MEDIA_OPTION_KEYS.length / 8) * 2,
    "media option bits fit their fixed byte length");
}

// 3. Fixtures --------------------------------------------------------
const SVG_A = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">\n<rect width="10" height="10" fill="#f00"/>\n</svg>';
const SVG_B = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><circle cx="2" cy="1.5" r="1"/></svg>';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const utf8 = (text) => new TextEncoder().encode(text);
const md5 = (data) => WM.md5Bytes(data);

const oldMarker = '<!-- SB3TOOLS-WATERMARK:1:' +
  Buffer.from(JSON.stringify({ s: 1, k: "project", t: "2000-01-01T00:00:00Z",
    n: "old.sb3", v: "0.0.0", o: "00" })).toString("base64") + ' -->';
const svgAOld = SVG_A.replace("<svg", oldMarker + "\n<svg");
const sharedId = md5(utf8(SVG_A));
const otherId = md5(utf8(SVG_B));
const pngId = md5(PNG);

function projectFixture() {
  return {
    targets: [
      {
        isStage: true, name: "Stage", variables: {}, lists: {}, broadcasts: {},
        blocks: {}, comments: {}, currentCostume: 0, sounds: [], volume: 100,
        layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: "on",
        textToSpeechLanguage: null,
        costumes: [{
          name: "backdrop1", assetId: sharedId, md5ext: sharedId + ".svg",
          dataFormat: "svg", rotationCenterX: 5, rotationCenterY: 5
        }]
      },
      {
        isStage: false, name: "Sprite1", variables: {}, lists: {}, broadcasts: {},
        blocks: {}, comments: {}, currentCostume: 0, sounds: [], volume: 100,
        layerOrder: 1, visible: true, x: 0, y: 0, size: 100, direction: 90,
        draggable: false, rotationStyle: "all around",
        costumes: [
          {
            name: "shared", assetId: sharedId, md5ext: sharedId + ".svg",
            dataFormat: "svg", rotationCenterX: 5, rotationCenterY: 5
          },
          {
            name: "other", assetId: otherId, md5ext: otherId + ".svg",
            dataFormat: "svg", rotationCenterX: 2, rotationCenterY: 1.5
          },
          {
            name: "still-png", assetId: pngId, md5ext: pngId + ".png",
            dataFormat: "png", rotationCenterX: 1, rotationCenterY: 1
          }
        ]
      }
    ],
    monitors: [], extensions: [], meta: { semver: "3.0.0" }
  };
}
function entriesFixture() {
  return [
    { name: sharedId + ".svg", data: utf8(svgAOld) },
    { name: otherId + ".svg", data: utf8(SVG_B) },
    { name: pngId + ".png", data: PNG }
  ];
}

// 4. Direct application ----------------------------------------------
{
  const project = projectFixture();
  const entries = entriesFixture();
  const beforePng = Buffer.from(entries.find((e) => e.name.endsWith(".png")).data);
  const marked = WM.applyToProject(project, entries, {
    kind: "project", name: "My Project.sb3", version: "1.2.3",
    time: "2026-02-03T04:05:06.000Z", options: { stripDefaults: true, freqIds: true }
  });
  equal(marked.watermarked, 2, "two distinct SVG assets were watermarked");
  equal(marked.skipped, 0, "no SVG asset was skipped");
  equal(marked.payload.n, "My Project.sb3", "payload keeps the original project name");
  equal(marked.payload.v, "1.2.3", "payload keeps the tool version");
  equal(marked.payload.t, "2026-02-03T04:05:06.000Z", "payload keeps the UTC time");
  equal(marked.payload.o,
    WM.encodeFlags({ stripDefaults: true, freqIds: true }, WM.PROJECT_OPTION_KEYS),
    "project compressor option hex uses the fixed order");

  for (const target of marked.project.targets) {
    for (const costume of target.costumes) {
      if (String(costume.dataFormat).toLowerCase() !== "svg") continue;
      const entry = marked.entries.find((e) => e.name === costume.md5ext);
      check(!!entry, `costume ${costume.name} points at a watermarked SVG entry`);
      if (!entry) continue;
      const text = new TextDecoder().decode(entry.data);
      equal((text.match(/SB3TOOLS-WATERMARK/g) || []).length, 1,
        `costume ${costume.name} has exactly one watermark comment`);
      check(!text.includes("old.sb3"), `costume ${costume.name} replaced the old watermark`);
      equal(md5(entry.data), costume.assetId,
        `costume ${costume.name} assetId is the MD5 of its bytes`);
      equal(costume.md5ext, entry.name,
        `costume ${costume.name} md5ext names the rewritten entry`);
    }
  }
  equal(Array.from(new Uint8Array(marked.entries.find((e) => e.name.endsWith(".png")).data)),
    Array.from(beforePng), "non-SVG asset bytes are untouched");
  equal(marked.entries.length, entries.length,
    "watermarking does not add or remove archive entries");

  const inspection = WM.inspectProject(marked.project, marked.entries);
  equal(inspection.svgAssets, 2, "inspection sees both SVG assets");
  equal(inspection.watermarkedAssets, 2, "inspection reads both watermarks");
  equal(inspection.svgCostumes, 3, "inspection counts the shared SVG costume twice");
  equal(inspection.records.length, 2, "inspection returns one record per SVG asset");

  // A self-closing root must be expanded so the marker lives inside <svg>.
  const selfClosing = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
  const selfMarked = WM.applyToSvg(selfClosing, {
    s: 1, k: "project", t: "2026-01-01T00:00:00Z", n: "a.sb3", v: "1.0.0", o: "00"
  });
  check(selfMarked.indexOf("SB3TOOLS-WATERMARK") < selfMarked.indexOf("</svg>"),
    "self-closing SVG keeps the watermark inside the root element");
  equal(WM.parseSvg(selfMarked).length, 1, "self-closing SVG still parses one watermark");

  // Same metadata: stripping and reinserting must be idempotent.
  const again = WM.applyToProject(marked.project, marked.entries, {
    kind: "project", name: "My Project.sb3", version: "1.2.3",
    time: "2026-02-03T04:05:06.000Z", options: { stripDefaults: true, freqIds: true }
  });
  for (const target of again.project.targets) {
    for (const costume of target.costumes) {
      if (String(costume.dataFormat).toLowerCase() !== "svg") continue;
      const entry = again.entries.find((e) => e.name === costume.md5ext);
      if (!entry) continue;
      const text = new TextDecoder().decode(entry.data);
      equal((text.match(/SB3TOOLS-WATERMARK/g) || []).length, 1,
        `second application leaves one marker on ${costume.name}`);
      equal(md5(entry.data), costume.assetId,
        `second application keeps the same asset id on ${costume.name}`);
    }
  }

  // Different metadata must replace the old payload, not append a second one.
  const changed = WM.applyToProject(again.project, again.entries, {
    kind: "project", name: "Renamed.sb3", version: "2.0.0",
    time: "2027-03-04T05:06:07.000Z", options: { shortenIds: true }
  });
  for (const target of changed.project.targets) {
    for (const costume of target.costumes) {
      if (String(costume.dataFormat).toLowerCase() !== "svg") continue;
      const entry = changed.entries.find((e) => e.name === costume.md5ext);
      if (!entry) continue;
      const text = new TextDecoder().decode(entry.data);
      equal((text.match(/SB3TOOLS-WATERMARK/g) || []).length, 1,
        `rename leaves one marker on ${costume.name}`);
      const parsed = WM.parseSvg(text);
      equal(parsed[0] && parsed[0].payload.n, "Renamed.sb3",
        `rename updates the project name on ${costume.name}`);
    }
  }
}

// 5. project.json compressor integration -----------------------------
async function zipFixture() {
  const zip = new JSZip();
  zip.file("project.json", JSON.stringify(projectFixture()));
  for (const entry of entriesFixture()) zip.file(entry.name, entry.data);
  return zip.generateAsync({ type: "uint8array" });
}

{
  const input = await zipFixture();
  const options = {};
  for (const key of WM.PROJECT_OPTION_KEYS) options[key] = false;
  options.stripDefaults = true;
  options.shortenIds = true;
  options.freqIds = true;
  const out = await SB3.compressBuffer(input, "Fixture.sb3", options);
  check(!!out.watermark, "compressBuffer reports watermark statistics");
  equal(out.watermark.watermarked, 2, "compressBuffer watermarks both SVG assets");
  const zip = await JSZip.loadAsync(out.finalBytes);
  check(!!zip.file("project.json"), "compressed archive has project.json");
  const projectText = await zip.file("project.json").async("text");
  check(!projectText.includes("SB3TOOLS-WATERMARK"),
    "project.json itself does not contain the SVG watermark");
  const project = JSON.parse(projectText);
  const entries = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === "project.json") continue;
    entries.push({ name, data: await entry.async("uint8array") });
  }
  const inspection = WM.inspectProject(project, entries);
  equal(inspection.svgAssets, 2, "compressed archive still has two SVG assets");
  equal(inspection.watermarkedAssets, 2, "both compressed SVG assets are watermarked");
  equal(inspection.records.length, 2, "both compressed SVG assets expose a watermark record");
  check(inspection.records.every((record) => record.payload && record.payload.n === "Fixture.sb3"),
    "compressed SVG assets record the original file name");
  equal(inspection.records[0].payload.o,
    WM.encodeFlags(options, WM.PROJECT_OPTION_KEYS),
    "compressed SVG assets record the requested option hex");
  for (const target of project.targets) {
    for (const costume of target.costumes) {
      if (String(costume.dataFormat).toLowerCase() !== "svg") continue;
      const entry = entries.find((e) => e.name === costume.md5ext) ||
        entries.find((e) => e.name === costume.assetId + ".svg");
      check(!!entry, `compressed costume ${costume.name} has an SVG entry`);
      if (entry) equal(md5(entry.data), costume.assetId,
        `compressed costume ${costume.name} assetId matches its bytes`);
    }
  }
}

// 6. full compressor integration -------------------------------------
{
  const fullMedia = require(path.join(root, "docs", "full", "media.js"));
  const fullProject = require(path.join(root, "docs", "full", "project.js"));
  globalThis.MEDIA = fullMedia;
  globalThis.SB3 = fullProject;
  globalThis.SB3Watermark = WM;
  fullMedia.setJSZip(JSZip);
  fullProject.setJSZip(JSZip);
  const FULL = require(path.join(root, "docs", "full", "engine.js"));

  const projectOptions = {};
  for (const key of WM.PROJECT_OPTION_KEYS) projectOptions[key] = false;
  projectOptions.stripDefaults = true;
  const mediaOptions = {
    pngOptimize: false, svgToPng: false, minPx: true,
    wavToMp3: false, reencodeMp3: false
  };
  const out = await FULL.compressBuffer(await zipFixture(), "Full Fixture.sb3",
    { project: projectOptions, media: mediaOptions }, null, () => {}, () => false, null);
  check(!!out.watermark, "full compressBuffer reports watermark statistics");
  equal(out.watermark.watermarked, 2, "full compressBuffer watermarks both SVG assets");
  equal(out.watermark.optionsHex, WM.encodeFlags(projectOptions, WM.PROJECT_OPTION_KEYS),
    "full watermark records the project option hex");
  equal(out.watermark.mediaOptionsHex, WM.encodeFlags(mediaOptions, WM.MEDIA_OPTION_KEYS),
    "full watermark records the media option hex");

  const zip = await JSZip.loadAsync(out.finalBytes);
  const project = JSON.parse(await zip.file("project.json").async("text"));
  const entries = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === "project.json") continue;
    entries.push({ name, data: await entry.async("uint8array") });
  }
  const inspection = WM.inspectProject(project, entries);
  equal(inspection.svgAssets, 2, "full output keeps both SVG assets");
  equal(inspection.watermarkedAssets, 2, "full output marks both SVG assets");
  check(inspection.records.every((record) => record.payload.k === "full"),
    "full output records kind=full");
  equal(inspection.records[0].payload.m,
    WM.encodeFlags(mediaOptions, WM.MEDIA_OPTION_KEYS),
    "full output records the media flags");
  for (const entry of entries.filter((item) => item.name.endsWith(".svg"))) {
    const text = new TextDecoder().decode(entry.data);
    check(text.indexOf("SB3TOOLS-WATERMARK") < text.indexOf("</svg>"),
      "full output keeps the watermark inside the SVG root");
  }
}

// 7. media compressor integration ------------------------------------
{
  const MEDIA = require(path.join(root, "docs", "media", "compressor.js"));
  MEDIA.setJSZip(JSZip);
  MEDIA.setWatermark(WM);
  const mediaOptions = {
    svgToPng: false, pngOptimize: false, minPx: true,
    wavToMp3: false, reencodeMp3: false
  };
  const out = await MEDIA.compressBuffer(await zipFixture(), "Media Fixture.sb3",
    mediaOptions, null, () => {}, () => false, null);
  check(!!out.watermark, "media compressBuffer reports watermark statistics");
  equal(out.watermark.watermarked, 2, "media compressBuffer watermarks both SVG assets");
  equal(out.watermark.mediaOptionsHex, WM.encodeFlags(mediaOptions, WM.MEDIA_OPTION_KEYS),
    "media watermark records the media option hex");
  const zip = await JSZip.loadAsync(out.finalBytes);
  const project = JSON.parse(await zip.file("project.json").async("text"));
  const entries = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === "project.json") continue;
    entries.push({ name, data: await entry.async("uint8array") });
  }
  const inspection = WM.inspectProject(project, entries);
  equal(inspection.watermarkedAssets, 2, "media output marks both SVG assets");
  check(inspection.records.every((record) => record.payload.k === "media"),
    "media output records kind=media");
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("watermark-invariants: all checks passed");
console.log("  " + JSON.stringify({
  projectOptionKeys: WM.PROJECT_OPTION_KEYS.length,
  mediaOptionKeys: WM.MEDIA_OPTION_KEYS.length,
  checks
}));
