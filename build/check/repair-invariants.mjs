#!/usr/bin/env node
/* Regression checks for docs/repair/repair.js.
 *
 * These checks are deliberately strict: every repaired output must pass the
 * engine's own validator with zero errors, every referenced asset must exist,
 * every ZIP must reopen, and a second repair must be a no-op.
 *
 * Run from the repository root:
 *   node build/check/repair-invariants.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("../../docs/repair/jszip.min.js");
const R = require("../../docs/repair/repair.js");
R.setJSZip(JSZip);

let checks = 0;
function ok(name) {
  checks++;
  console.log("ok " + checks + " - " + name);
}

function makeProject() {
  const png = R.placeholderFor("costume");
  const wav = R.placeholderFor("sound");
  const costume = (name) => ({
    name,
    assetId: png.md5,
    dataFormat: "png",
    md5ext: png.md5 + ".png",
    bitmapResolution: 1,
    rotationCenterX: 0.5,
    rotationCenterY: 0.5
  });
  const sound = (name) => ({
    name,
    assetId: wav.md5,
    dataFormat: "wav",
    md5ext: wav.md5 + ".wav",
    rate: 22050,
    sampleCount: 1
  });
  const project = {
    targets: [
      {
        isStage: true,
        name: "Stage",
        variables: { v1: ["score", 0], cloud: ["score high", 0, true] },
        lists: { l1: ["items", []] },
        broadcasts: { b1: "go" },
        blocks: {},
        comments: {
          stageNote: { blockId: null, text: "keep", x: 0, y: 0, width: 200, height: 100, minimized: false }
        },
        currentCostume: 0,
        costumes: [costume("backdrop1")],
        sounds: [sound("pop")],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: "on",
        textToSpeechLanguage: null
      },
      {
        isStage: false,
        name: "Sprite1",
        variables: { sv: ["local", 1] },
        lists: { sl: ["local list", ["a", 2]] },
        broadcasts: {},
        blocks: {
          a: {
            opcode: "event_whenflagclicked", next: "b", parent: null,
            inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0,
            comment: "cm"
          },
          b: {
            opcode: "data_setvariableto", next: "c", parent: "a",
            inputs: { VALUE: [3, "d", [10, "5"]] },
            fields: { VARIABLE: ["score", "v1"] }, shadow: false, topLevel: false
          },
          c: {
            opcode: "control_repeat", next: null, parent: "b",
            inputs: { TIMES: [1, [6, "10"]], SUBSTACK: [2, "e"] },
            fields: {}, shadow: false, topLevel: false
          },
          d: {
            opcode: "operator_add", next: null, parent: "b",
            inputs: { NUM1: [1, [4, "1"]], NUM2: [1, [10, "2"]] },
            fields: {}, shadow: false, topLevel: false
          },
          e: {
            opcode: "data_changevariableby", next: null, parent: "c",
            inputs: { VALUE: [1, [4, "1"]] },
            fields: { VARIABLE: ["local", "sv"] }, shadow: false, topLevel: false
          },
          f: {
            opcode: "event_whenbroadcastreceived", next: null, parent: null,
            inputs: {}, fields: { BROADCAST_OPTION: ["go", "b1"] },
            shadow: false, topLevel: true, x: 0, y: 120
          },
          g: {
            opcode: "procedures_definition", next: null, parent: null,
            inputs: { custom_block: [2, "h"] }, fields: {}, shadow: false,
            topLevel: true, x: 0, y: 240
          },
          h: {
            opcode: "procedures_prototype", next: null, parent: "g",
            inputs: {}, fields: {}, shadow: true, topLevel: false,
            mutation: {
              tagName: "mutation", children: [], proccode: "do %s",
              argumentids: '["arg1"]', argumentnames: '["x"]',
              argumentdefaults: '[""]', warp: "false", hasnext: "false"
            }
          },
          i: {
            opcode: "procedures_call", next: null, parent: null,
            inputs: { arg1: [1, [10, "hello"]] }, fields: {}, shadow: false,
            topLevel: true, x: 0, y: 320,
            mutation: { tagName: "mutation", children: [], proccode: "do %s", argumentids: '["arg1"]', warp: "false" }
          },
          j: {
            opcode: "data_showlist", next: null, parent: null,
            inputs: {}, fields: { LIST: ["items", "l1"] },
            shadow: false, topLevel: true, x: 0, y: 400
          }
        },
        comments: {
          cm: { blockId: "a", text: "hello", x: 10, y: 10, width: 200, height: 100, minimized: false }
        },
        currentCostume: 0,
        costumes: [costume("costume1")],
        sounds: [sound("meow")],
        volume: 100,
        layerOrder: 1,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: "all around"
      }
    ],
    monitors: [
      {
        id: "v1", mode: "default", opcode: "data_variable",
        params: { VARIABLE: "score" }, spriteName: null, value: 0,
        width: 0, height: 0, x: 5, y: 5, visible: true,
        sliderMin: 0, sliderMax: 100, isDiscrete: true
      }
    ],
    extensions: [],
    extensionStorage: { pen: { color: 1 } },
    customFonts: ["font1"],
    meta: { semver: "3.0.0", vm: "0.2.0", agent: "repair-invariants" }
  };
  return { project, png, wav };
}

async function pack(project, extra = {}) {
  const { png, wav } = makeProject();
  const zip = new JSZip();
  zip.file("project.json", typeof project === "string" ? project : JSON.stringify(project));
  if (extra.png !== false) zip.file(png.md5 + ".png", png.bytes);
  if (extra.wav !== false) zip.file(wav.md5 + ".wav", wav.bytes);
  for (const [name, bytes] of Object.entries(extra.files || {})) {
    if (bytes !== null) zip.file(name, bytes);
  }
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function assertOutput(report, label) {
  assert.equal(report.after.stats.errors, 0, label + ": output has validation errors\n" +
    JSON.stringify(report.after.issues.filter((i) => i.severity === "error"), null, 2));
  assert.ok(report.outputBytes && report.outputBytes.length > 0, label + ": no output bytes");
  const zip = await JSZip.loadAsync(report.outputBytes);
  assert.ok(zip.file("project.json"), label + ": output has no project.json");
  const project = JSON.parse(await zip.file("project.json").async("string"));
  assert.ok(Array.isArray(project.targets) && project.targets.length, label + ": output has no targets");
  assert.equal(project.targets[0].isStage, true, label + ": stage is not first");
  for (const target of project.targets) {
    for (const asset of [...(target.costumes || []), ...(target.sounds || [])]) {
      assert.ok(zip.file(asset.md5ext), label + ": asset missing from output: " + asset.md5ext);
    }
  }
  const after = R.validateProject(project, new Map(
    Object.keys(zip.files)
      .filter((name) => !zip.files[name].dir)
      .map((name) => [name, null])
  ), {});
  assert.equal(after.stats.errors, 0, label + ": validator rejects the output project");
  return { report, project, zip };
}

/* --------------------------------------------------------------- checks */

function checksums() {
  assert.equal(R.md5hex(new Uint8Array(0)), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(R.md5hex(new TextEncoder().encode("abc")), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(R.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  for (const kind of ["costume", "sound"]) {
    const placeholder = R.placeholderFor(kind);
    assert.equal(R.md5hex(placeholder.bytes), placeholder.md5, kind + " placeholder MD5 is not its content hash");
  }
  const png = R.placeholderFor("costume");
  assert.deepEqual(R.imageSize(png.bytes, "png"), { width: 1, height: 1 });
  assert.equal(R.mediaSignature(png.bytes, "costume", "png").ok, true);
  const sound = R.placeholderFor("sound");
  assert.equal(R.mediaSignature(sound.bytes, "sound", "wav").ok, true);
  assert.equal(R.wavInfo(sound.bytes).rate, 22050);
  ok("checksums, placeholder signatures and media metadata");
}

async function validProject() {
  const { project, png, wav } = makeProject();
  const buffer = await pack(project);
  const inspected = await R.inspectBuffer(buffer, "valid.sb3");
  assert.equal(inspected.before.stats.errors, 0);
  assert.equal(inspected.before.stats.warnings, 0);
  const report = await R.repairBuffer(buffer, "valid.sb3");
  assert.deepEqual(report.actions, []);
  assert.equal(report.changed, false);
  const { project: output } = await assertOutput(report, "valid");
  assert.deepEqual(output.extensionStorage, { pen: { color: 1 } });
  assert.deepEqual(output.customFonts, ["font1"]);
  assert.equal(output.targets[0].comments.stageNote.text, "keep");
  assert.equal(output.targets[0].variables.cloud[2], true);
  assert.equal(output.targets[1].blocks.d.opcode, "operator_add");
  assert.equal(output.targets[1].blocks.i.mutation.proccode, "do %s");
  assert.equal(output.targets[1].blocks.j.fields.LIST[1], "l1");
  ok("a valid project is untouched and unknown fields survive");

  const second = await R.repairBuffer(report.outputBytes, "valid-repaired.sb3");
  assert.deepEqual(second.actions, []);
  assert.equal(second.after.stats.errors, 0);
  ok("repair is idempotent");
}

async function containerRecovery() {
  const { project } = makeProject();
  const buffer = await pack(project);
  const eocd = (() => {
    for (let i = buffer.length - 22; i >= 0; i--) {
      if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b && buffer[i + 2] === 0x05 && buffer[i + 3] === 0x06) return i;
    }
    return -1;
  })();
  assert.ok(eocd > 0);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const noCentral = buffer.subarray(0, centralOffset);
  const report = await R.repairBuffer(noCentral, "no-central.sb3");
  assert.equal(report.container.salvaged, true);
  assert.equal(report.after.stats.errors, 0);
  await assertOutput(report, "zip-no-central");
  ok("a ZIP without a central directory is salvaged from local headers");

  const truncatedTail = buffer.subarray(0, buffer.length - 30);
  const tailReport = await R.repairBuffer(truncatedTail, "tail.sb3");
  assert.equal(tailReport.after.stats.errors, 0);
  await assertOutput(tailReport, "zip-tail");
  ok("a truncated ZIP tail is recovered or replaced with placeholders");

  const bare = Buffer.from(JSON.stringify(project));
  const bareReport = await R.repairBuffer(bare, "project.json");
  assert.equal(bareReport.container.kind, "json");
  assert.equal(bareReport.after.stats.errors, 0);
  await assertOutput(bareReport, "bare-json");
  ok("a raw project.json is wrapped and missing media receives placeholders");

  const noProject = await pack(project, { png: true, wav: true });
  const zip = await JSZip.loadAsync(noProject);
  zip.remove("project.json");
  const noProjectBytes = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  await assert.rejects(() => R.repairBuffer(noProjectBytes, "no-project.sb3"), /project\.json/i);
  ok("an archive without project.json fails with a clear error");
}

async function jsonRecovery() {
  const { project } = makeProject();
  const cases = [
    ["bom", "\uFEFF" + JSON.stringify(project)],
    ["nul", JSON.stringify(project) + "\u0000\u0000"],
    ["trailing-comma", JSON.stringify(project).replace(/\}$/, ",}")],
    ["truncated", JSON.stringify(project).slice(0, Math.floor(JSON.stringify(project).length * 0.9))]
  ];
  for (const [name, text] of cases) {
    const report = await R.repairBuffer(await pack(text), "json-" + name + ".sb3");
    assert.equal(report.after.stats.errors, 0, name + " was not recovered");
    await assertOutput(report, "json-" + name);
  }
  ok("BOM, NUL, trailing commas and truncation are recovered");
}

async function jsonSyntaxRepairs() {
  const { project } = makeProject();
  const valid = await pack(project);
  const baselineReport = await R.repairBuffer(valid, "syntax-baseline.sb3");
  assert.equal(baselineReport.after.stats.errors, 0);
  const baseline = JSON.parse(baselineReport.projectJson);
  const text = JSON.stringify(project);

  const cases = [
    ["leading-zero number", text.replace('"sampleCount":1', '"sampleCount":01')],
    ["missing property comma", text.replace('"currentCostume":0,"costumes"', '"currentCostume":0"costumes"')],
    ["trailing comma", text.replace(/"topLevel":false}/, '"topLevel":false,}')],
    ["missing string quote", text.replace('"opcode":"event_whenflagclicked","next"', '"opcode":"event_whenflagclicked,"next"')],
    ["mismatched object bracket", text.replace('"fields":{}', '"fields":{]')],
    ["Python literal", text.replace('"topLevel":true', '"topLevel":True')],
    ["singular target list", text.replace('"targets":', '"target":')]
  ];

  for (const [label, corrupted] of cases) {
    assert.notEqual(corrupted, text, label + ": test corruption did not apply");
    const report = await R.repairBuffer(await pack(corrupted), "syntax-" + label + ".sb3");
    assert.equal(report.after.stats.errors, 0, label + ": not repaired");
    assert.deepEqual(JSON.parse(report.projectJson), baseline, label + ": repaired project differs from the valid baseline");
    await assertOutput(report, label);
  }

  // A ZIP entry named Project.json is accepted case-insensitively and moved to
  // the canonical root name.
  const { png, wav } = makeProject();
  const zip = new JSZip();
  zip.file("Project.json", JSON.stringify(project));
  zip.file(png.md5 + ".png", png.bytes);
  zip.file(wav.md5 + ".wav", wav.bytes);
  const upper = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  const upperReport = await R.repairBuffer(upper, "Project.json.sb3");
  assert.equal(upperReport.after.stats.errors, 0);
  assert.deepEqual(JSON.parse(upperReport.projectJson), baseline);
  await assertOutput(upperReport, "Project.json");
  ok("JSON syntax damage (leading zero, missing comma/quote, trailing comma, bracket, Python literals, target alias) and Project.json case are repaired");
}

async function structuralRepairs() {
  const { project } = makeProject();

  let p = clone(project);
  p.targets.reverse();
  p.targets[1].isStage = false;
  const stageFirst = await R.repairBuffer(await pack(p), "stage.sb3");
  assert.equal(stageFirst.after.stats.errors, 0);
  await assertOutput(stageFirst, "stage-not-first");
  ok("stage order and stage flag are repaired");

  p = clone(project);
  p.targets.splice(1, 1);
  const noStage = await R.repairBuffer(await pack(p), "no-stage.sb3");
  assert.equal(noStage.after.stats.errors, 0);
  await assertOutput(noStage, "no-stage");
  ok("a missing stage is created");

  p = clone(project);
  const blocks = p.targets[1].blocks;
  blocks.b.next = "missing";
  blocks.c.parent = "missing";
  blocks.c.inputs.SUBSTACK = [2, "missing"];
  blocks.e.next = "b";
  const dangling = await R.repairBuffer(await pack(p), "dangling.sb3");
  assert.equal(dangling.after.stats.errors, 0);
  await assertOutput(dangling, "dangling");
  ok("dangling next/parent/input links and cycles are repaired");

  p = clone(project);
  delete p.targets[0].variables.v1;
  delete p.targets[1].lists.sl;
  delete p.targets[0].broadcasts.b1;
  const stores = await R.repairBuffer(await pack(p), "stores.sb3");
  assert.equal(stores.after.stats.errors, 0);
  const { project: storesOut } = await assertOutput(stores, "stores");
  assert.ok(storesOut.targets[1].variables.sv);
  assert.ok(storesOut.targets[1].blocks.e.fields.VARIABLE[1]);
  assert.ok(storesOut.targets[0].broadcasts.b1 || Object.values(storesOut.targets[0].broadcasts).includes("go"));
  ok("missing variables, lists and broadcasts are created or re-linked");

  p = clone(project);
  p.targets[1].blocks.z = [10, "invalid top-level"];
  p.targets[1].blocks.y = [12, "score", "v1"];
  const primitive = await R.repairBuffer(await pack(p), "primitive.sb3");
  assert.equal(primitive.after.stats.errors, 0);
  await assertOutput(primitive, "primitive");
  ok("invalid top-level primitives are removed; workspace reporters survive");

  p = clone(project);
  delete p.targets[1].blocks.h;
  p.targets[1].blocks.i.mutation.proccode = "ghost %s";
  const proc = await R.repairBuffer(await pack(p), "proc.sb3");
  assert.equal(proc.after.stats.errors, 0);
  const { project: procOut } = await assertOutput(proc, "proc");
  const opcodes = Object.values(procOut.targets[1].blocks).map((b) => b.opcode);
  assert.ok(opcodes.includes("procedures_prototype"));
  assert.ok(opcodes.includes("procedures_definition"));
  ok("missing and orphan custom-block definitions/prototypes are repaired");

  p = clone(project);
  p.targets[1].costumes = [];
  p.targets[1].currentCostume = 8;
  const empty = await R.repairBuffer(await pack(p), "empty-costume.sb3");
  assert.equal(empty.after.stats.errors, 0);
  await assertOutput(empty, "empty-costume");
  ok("an empty costume list receives a valid placeholder");
}

async function mediaRepairs() {
  const { project, png, wav } = makeProject();
  const bad = new Uint8Array([1, 2, 3, 4]);
  const badMd5 = R.md5hex(bad);

  let p = clone(project);
  p.targets[1].costumes[0] = { name: "gone", assetId: "0".repeat(32), dataFormat: "png", md5ext: "0".repeat(32) + ".png", bitmapResolution: 1, rotationCenterX: 0, rotationCenterY: 0 };
  p.targets[1].sounds[0] = { name: "gone sound", assetId: "1".repeat(32), dataFormat: "wav", md5ext: "1".repeat(32) + ".wav", rate: 22050, sampleCount: 1 };
  let report = await R.repairBuffer(await pack(p), "missing-media.sb3");
  assert.equal(report.after.stats.errors, 0);
  await assertOutput(report, "missing-media");
  ok("missing costumes and sounds are replaced with placeholders");

  p = clone(project);
  p.targets[1].costumes[0].assetId = badMd5;
  p.targets[1].costumes[0].md5ext = badMd5 + ".png";
  p.targets[1].sounds[0].assetId = badMd5;
  p.targets[1].sounds[0].md5ext = badMd5 + ".wav";
  report = await R.repairBuffer(await pack(p, { files: { [badMd5 + ".png"]: bad, [badMd5 + ".wav"]: bad } }), "bad-media.sb3");
  assert.equal(report.after.stats.errors, 0);
  await assertOutput(report, "bad-media");
  ok("unreadable media is replaced with placeholders");

  p = clone(project);
  const wrong = "2".repeat(32);
  p.targets[1].costumes[0].assetId = wrong;
  p.targets[1].costumes[0].md5ext = wrong + ".png";
  report = await R.repairBuffer(await pack(p), "wrong-id.sb3");
  assert.equal(report.after.stats.errors, 0);
  const { project: fixed } = await assertOutput(report, "wrong-id");
  assert.equal(fixed.targets[1].costumes[0].assetId, png.md5);
  assert.equal(fixed.targets[1].costumes[0].md5ext, png.md5 + ".png");
  ok("asset ids are corrected to the MD5 of the actual bytes and files are renamed");

  p = clone(project);
  p.targets[1].costumes.push(clone(p.targets[1].costumes[0]));
  report = await R.repairBuffer(await pack(p), "shared.sb3");
  assert.equal(report.after.stats.errors, 0);
  await assertOutput(report, "shared");
  ok("shared assets survive a rename");

  p = clone(project);
  p.targets[1].costumes[0] = { name: "lost", assetId: "3".repeat(32), dataFormat: "png", md5ext: "3".repeat(32) + ".png" };
  report = await R.repairBuffer(await pack(p), "no-fill.sb3", { fillMissingAssets: false, replaceInvalidAssets: false });
  assert.ok(report.after.stats.errors > 0);
  assert.ok(report.unresolved.some((i) => i.code === "ASSET_MISSING"));
  ok("turning off placeholder creation leaves a clear unresolved error");
}

async function monitorAndExtensionRepairs() {
  const { project } = makeProject();
  const p = clone(project);
  p.monitors.push({ id: "gone", opcode: "data_variable", params: { VARIABLE: "gone" }, spriteName: "NoSuchSprite", visible: true });
  p.monitors.push({ id: "v1", opcode: "data_variable", params: { VARIABLE: "score" }, spriteName: null, visible: true });
  p.extensions = null;
  p.targets[1].blocks.k = {
    opcode: "pen_clear", next: null, parent: null, inputs: {}, fields: {},
    shadow: false, topLevel: true, x: 0, y: 500
  };
  const report = await R.repairBuffer(await pack(p), "monitors.sb3");
  assert.equal(report.after.stats.errors, 0);
  const { project: fixed } = await assertOutput(report, "monitors");
  assert.ok(fixed.extensions.includes("pen"));
  assert.equal(fixed.monitors.filter((m) => m.id === "v1").length, 1);
  assert.ok(!fixed.monitors.some((m) => m.id === "gone"));
  ok("stale monitors are dropped and extension declarations are inferred");

  const keep = await R.repairBuffer(await pack(p), "monitors-keep.sb3", { removeStaleMonitors: false });
  assert.ok(keep.after.stats.errors === 0);
  assert.ok(keep.after.stats.warnings > 0);
  ok("turning off monitor removal leaves a warning, not an error");
}

async function commentRepair() {
  const { project } = makeProject();
  const p = clone(project);
  p.targets[1].comments.cm.blockId = "missing";
  const report = await R.repairBuffer(await pack(p), "comments.sb3");
  assert.equal(report.after.stats.errors, 0);
  const { project: fixed } = await assertOutput(report, "comments");
  assert.equal(fixed.targets[1].comments.cm.blockId, null);
  ok("comments attached to missing blocks are detached, not discarded");
}

async function strictness() {
  const { project } = makeProject();
  const p = clone(project);
  p.targets[1].blocks.a.next = "missing";
  p.meta.semver = "2.0.0";
  p.targets[1].blocks.e.fields.VARIABLE = ["missing", "nope"];
  const buffer = await pack(p);
  const inspected = await R.inspectBuffer(buffer, "strict.sb3");
  assert.ok(inspected.before.stats.errors >= 2);
  assert.equal(inspected.canRepair, true);
  const report = await R.repairBuffer(buffer, "strict.sb3");
  assert.equal(report.after.stats.errors, 0);
  assert.ok(report.actions.length >= 2);
  ok("inspection reports errors and repair clears them");
}

/* ----------------------------------------------------------------- run */

try {
  checksums();
  await validProject();
  await containerRecovery();
  await jsonRecovery();
  await jsonSyntaxRepairs();
  await structuralRepairs();
  await mediaRepairs();
  await monitorAndExtensionRepairs();
  await commentRepair();
  await strictness();
  console.log("\n" + checks + " repair invariant checks passed.");
} catch (error) {
  console.error("\nFAILED:", error);
  process.exit(1);
}
