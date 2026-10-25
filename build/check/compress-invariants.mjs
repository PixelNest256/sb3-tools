/*
 * Regression guard for the SB3 project pass (docs/sb3/compressor.js).
 *
 * Run:  node build/check/compress-invariants.mjs
 *
 * It compresses a small synthetic project and asserts the invariants that the
 * Scratch VM and its editor depend on:
 *
 *   1. every block mutation carries `tagName` (string) and `children` (array),
 *      because scratch-vm's Blocks.mutationToXML() reads both when it emits a
 *      workspace update; a missing key makes the project fail to load;
 *   2. top-level blocks keep an explicit `parent: null` and reachable
 *      end-of-stack blocks keep an explicit `next: null`;
 *   3. no input points at a block id that does not exist, and no field points
 *      at a store id that does not exist;
 *   4. blanking an initial value only happens when it shortens the JSON by a
 *      meaningful amount, so short values (numbers, booleans, "1") survive.
 *
 * Invariants 1-3 were broken by "remove legacy mutation keys"; 4 by clearing
 * every overwritten value. Both reached users and made projects fail to load
 * or behave differently.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const require = createRequire(import.meta.url);
const JSZip = require(path.join(root, "docs", "sb3", "jszip.min.js"));
globalThis.JSZip = JSZip;
const SB3 = require(path.join(root, "docs", "sb3", "compressor.js"));

const VID_COUNT = "varCount0000000001";
const VID_TEXT = "varText00000000001";
const LID_LIST = "list00000000000001";
const ARG_ID = "argumentIdLong000001";

let failures = 0;
function check(ok, message) {
  if (ok) return;
  failures += 1;
  console.error("FAIL: " + message);
}

function blk(opcode, extra) {
  return Object.assign(
    { opcode, next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: false },
    extra || {}
  );
}

function buildProject() {
  return {
    targets: [{
      isStage: false, name: "Sprite1",
      variables: {
        [VID_COUNT]: ["count", 0],
        [VID_TEXT]: ["text", "a fairly long default value"]
      },
      lists: { [LID_LIST]: ["items", [1, 2, 3]] },
      broadcasts: {},
      blocks: {
        // Definition of "do %s": initialises both variables, then reads one.
        hat: blk("procedures_definition", {
          topLevel: true, x: 12587, y: 1043, next: "setCount",
          inputs: { custom_block: [1, "proto"] }
        }),
        proto: blk("procedures_prototype", {
          shadow: true, parent: "hat", inputs: { [ARG_ID]: [1, [10, "x"]] },
          // Deliberately without tagName / children: the compressor must add them.
          mutation: {
            proccode: "do %s",
            argumentids: JSON.stringify([ARG_ID]),
            argumentnames: JSON.stringify(["x"]),
            argumentdefaults: JSON.stringify([""]),
            warp: "false"
          }
        }),
        setCount: blk("data_setvariableto", {
          parent: "hat", next: "setText",
          inputs: { VALUE: [1, [4, "0"]] },
          fields: { VARIABLE: ["count", VID_COUNT] }
        }),
        setText: blk("data_setvariableto", {
          parent: "setCount", next: "sayCount",
          inputs: { VALUE: [1, [10, "a fairly long default value"]] },
          fields: { VARIABLE: ["text", VID_TEXT] }
        }),
        sayCount: blk("looks_say", {
          parent: "setText",
          inputs: { MESSAGE: [3, "readCount", [10, ""]] }
        }),
        readCount: blk("data_variable", { parent: "sayCount", fields: { VARIABLE: ["count", VID_COUNT] } }),

        // Green flag: call the definition, then clear/add/read the list.
        flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 9000, next: "call" }),
        call: blk("procedures_call", {
          parent: "flag", next: "clearList",
          mutation: { proccode: "do %s", argumentids: JSON.stringify([ARG_ID]), warp: "false" },
          inputs: { [ARG_ID]: [1, [10, "5"]] }
        }),
        clearList: blk("data_deletealloflist", {
          parent: "call", next: "addItem",
          fields: { LIST: ["items", LID_LIST] }
        }),
        addItem: blk("data_addtolist", {
          parent: "clearList", next: "sayItem",
          inputs: { ITEM: [1, [10, "x"]] },
          fields: { LIST: ["items", LID_LIST] }
        }),
        sayItem: blk("looks_say", {
          parent: "addItem",
          inputs: { MESSAGE: [3, "readItem", [10, ""]] }
        }),
        readItem: blk("data_itemoflist", {
          parent: "sayItem",
          inputs: { INDEX: [1, [7, "1"]] },
          fields: { LIST: ["items", LID_LIST] }
        })
      },
      comments: { c1: { blockId: "hat", x: 12587, y: 1043, width: 200, height: 100, text: "note" } },
      currentCostume: 0,
      costumes: [{
        name: "c", dataFormat: "svg", assetId: "0".repeat(32),
        rotationCenterX: 96.99250489598867, rotationCenterY: 61.39895949833303
      }],
      sounds: [],
      volume: 100, layerOrder: 0, visible: true, x: 0, y: 0, size: 100,
      direction: 90, draggable: false, rotationStyle: "all around"
    }],
    monitors: [
      { id: LID_LIST, opcode: "data_listcontents", params: { LIST: "items" }, spriteName: "Sprite1",
        x: 5, y: 5, visible: false, mode: "default", width: 0, height: 0, sliderMin: 0, sliderMax: 100, isDiscrete: true }
    ],
    extensions: [], meta: { semver: "3.0.0" }
  };
}

function audit(project) {
  const issues = [];
  const stores = new Set();
  for (const t of project.targets) {
    for (const id of Object.keys(t.variables || {})) stores.add(id);
    for (const id of Object.keys(t.lists || {})) stores.add(id);
    for (const id of Object.keys(t.broadcasts || {})) stores.add(id);
  }
  for (const t of project.targets) {
    const blocks = t.blocks || {};
    const ids = new Set(Object.keys(blocks));
    for (const [bid, b] of Object.entries(blocks)) {
      if (Array.isArray(b) || !b || typeof b !== "object") continue;
      if (b.mutation) {
        check(typeof b.mutation.tagName === "string", `${bid}: mutation.tagName missing`);
        check(Array.isArray(b.mutation.children), `${bid}: mutation.children missing`);
      }
      if (b.parent !== null && b.parent !== undefined && !ids.has(b.parent)) issues.push(`${bid}: dangling parent`);
      if (b.next !== undefined && b.next !== null && !ids.has(b.next)) issues.push(`${bid}: dangling next`);
      if (b.topLevel === true && b.parent !== null && b.parent !== undefined) issues.push(`${bid}: topLevel with parent`);
      if (b.parent === null && b.topLevel !== true) issues.push(`${bid}: root without topLevel`);
      for (const [key, value] of Object.entries(b.inputs || {})) {
        check(Array.isArray(value), `${bid}.${key}: input is not an array`);
        if (!Array.isArray(value)) continue;
        if ((value[0] === 1 || value[0] === 2 || value[0] === 3) && typeof value[1] === "string" && !ids.has(value[1])) {
          issues.push(`${bid}.${key}: input points at missing block ${value[1]}`);
        }
      }
      for (const [fk, fv] of Object.entries(b.fields || {})) {
        if (!Array.isArray(fv)) continue;
        if ((fk === "VARIABLE" || fk === "LIST" || fk === "BROADCAST_OPTION") && fv[1] != null && !stores.has(fv[1])) {
          issues.push(`${bid}.${fk}: field points at missing store ${fv[1]}`);
        }
      }
    }
    for (const [bid, b] of Object.entries(blocks)) {
      if (Array.isArray(b) || !b || b.topLevel !== true) continue;
      const seen = new Set();
      let cur = bid;
      while (cur && blocks[cur] && !Array.isArray(blocks[cur])) {
        if (seen.has(cur)) { issues.push(`${bid}: cycle`); break; }
        seen.add(cur);
        cur = blocks[cur].next;
      }
      if (cur !== null && cur !== undefined) issues.push(`${bid}: chain end is not null`);
    }
  }
  issues.forEach((i) => check(false, i));
}

const options = new SB3.Options({});
const out = SB3.compressProject(buildProject(), options, () => {});
audit(out.project);

check(out.stats.mutation_keys_added >= 2, "mutations without tagName/children were not restored");
check(out.stats.blocks_renamed > 0, "block ids were not renamed");
check(out.stats.arg_ids_shortened === 1, "argument ids were not shortened");

const t0 = out.project.targets[0];
const vars = Object.values(t0.variables || {});
check(vars.length === 2, `expected 2 variables, found ${vars.length}`);
check(vars.some((v) => v[1] === 0), "a numeric initial value was blanked (should be kept)");
check(vars.some((v) => v[1] === ""), "a long initial value was not blanked");

const lists = Object.values(t0.lists || {});
check(lists.length === 1, `expected 1 list, found ${lists.length}`);
if (lists.length === 1) {
  check(Array.isArray(lists[0][1]) && lists[0][1].length === 0, "a list initial value was not blanked");
}

const costume = t0.costumes[0];
check(Number(costume.rotationCenterX.toFixed(4)) === costume.rotationCenterX, "rotation centre was not rounded");
check(SB3.dumpsCompact(out.project).length > 0, "serialization failed");
check(out.stats.monitors_removed === 1, "the hidden monitor was not removed");

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("compress-invariants: all checks passed");
console.log("  " + JSON.stringify({
  origJsonSize: out.origJsonSize,
  newJsonSize: out.newJsonSize,
  blocks_renamed: out.stats.blocks_renamed,
  arg_ids_shortened: out.stats.arg_ids_shortened,
  mutation_keys_added: out.stats.mutation_keys_added,
  vars_initialized: out.stats.vars_initialized,
  lists_initialized: out.stats.lists_initialized,
  monitors_removed: out.stats.monitors_removed
}));
