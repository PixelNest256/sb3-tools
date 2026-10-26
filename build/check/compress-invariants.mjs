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
 *      meaningful amount, so short values (numbers, booleans, "1") survive;
 *   5. an argument reporter (`fields.VALUE`) keeps naming a parameter of its
 *      own custom block: shortening argument *ids* must not rewrite argument
 *      *names*, and merging near-duplicate code must carry a reporter from a
 *      nested substack chain over as a parameter instead of leaving it behind
 *      in the generated procedure;
 *   6. `shortenIds` and `renameStores` are independent: shortening ids can
 *      leave every visible name (variables, lists, messages, custom blocks,
 *      arguments) exactly as it was;
 *   7. near-duplicate merging never moves a `control_stop` into the generated
 *      procedure, where "stop this script" would only end the procedure.
 *
 * Invariants 1-3 were broken by "remove legacy mutation keys"; 4 by clearing
 * every overwritten value; 5 by "shorten internal IDs" and by near-duplicate
 * merging. All of these reached users and made projects fail to load or behave
 * differently.
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
const VID_DEAD = "varNeverUsed0000001";
const LID_LIST = "list00000000000001";
const LID_DEAD = "listNeverUsed0000001";
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
        [VID_TEXT]: ["text", "a fairly long default value"],
        [VID_DEAD]: ["neverUsed", "x"]
      },
      lists: {
        [LID_LIST]: ["items", [1, 2, 3]],
        [LID_DEAD]: ["deadList", [9]]
      },
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
          parent: "clearList", next: "hideDead",
          inputs: { ITEM: [1, [10, "x"]] },
          fields: { LIST: ["items", LID_LIST] }
        }),
        // "hide variable/list" for stores nothing else touches: removeUnused
        // drops the stores, so these blocks must be spliced out rather than left
        // pointing at something that no longer exists.
        hideDead: blk("data_hidevariable", {
          parent: "addItem", next: "hideDead2",
          fields: { VARIABLE: ["neverUsed", VID_DEAD] }
        }),
        hideDead2: blk("data_hidelist", {
          parent: "hideDead", next: "sayItem",
          fields: { LIST: ["deadList", LID_DEAD] }
        }),
        sayItem: blk("looks_say", {
          parent: "hideDead2",
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
        md5ext: "0".repeat(32) + ".svg", bitmapResolution: 1,
        rotationCenterX: 96.99250489598867, rotationCenterY: 61.39895949833303
      }, {
        // Loading a bitmap with bitmapResolution 1 is what tells scratch-vm to
        // double it; an explicit 0 rotation centre is the top-left corner.
        name: "bmp1", dataFormat: "png", assetId: "1".repeat(32),
        md5ext: "1".repeat(32) + ".png", bitmapResolution: 1,
        rotationCenterX: 0, rotationCenterY: 0
      }, {
        // md5ext that disagrees with assetId.dataFormat must not be dropped.
        name: "odd", dataFormat: "png", assetId: "2".repeat(32),
        md5ext: "deadbeef.png", bitmapResolution: 2,
        rotationCenterX: 10, rotationCenterY: 20
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

const options = new SB3.Options({ removeMonitors: true });
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
check(costume.md5ext === undefined, "a matching md5ext was not removed");
check(costume.bitmapResolution === undefined, "bitmapResolution on an SVG costume was not removed");

const byName = Object.fromEntries((t0.costumes || []).map((c) => [c.name, c]));
check(byName.bmp1 && byName.bmp1.bitmapResolution === 1,
  "bitmapResolution: 1 on a bitmap was removed (it would render at half size)");
check(byName.bmp1 && byName.bmp1.rotationCenterX === 0 && byName.bmp1.rotationCenterY === 0,
  "rotationCenterX/Y: 0 was removed (the pivot would move to the image centre)");
check(byName.bmp1 && byName.bmp1.md5ext === undefined, "a matching md5ext was not removed");
check(byName.odd && byName.odd.md5ext === "deadbeef.png",
  "an md5ext that disagrees with assetId.dataFormat was removed");
check(SB3.dumpsCompact(out.project).length > 0, "serialization failed");
check(out.stats.monitors_removed === 1, "the hidden monitor was not removed");
check(out.stats.dead_hide_blocks_removed === 2, "hide blocks for removed stores were not spliced out");
check(!Object.keys(t0.blocks).some((b) => ["data_hidevariable", "data_hidelist"].includes(t0.blocks[b].opcode)),
  "a hide block for a removed store is still present");

// Keeping monitors (the default): a displayed variable keeps its name and a
// hidden monitor keeps its saved position, so neither the store nor the monitor
// may be renamed or dropped.
const monProject = buildProject();
monProject.monitors = [
  { id: VID_COUNT, opcode: "data_variable", params: { VARIABLE: "count" }, spriteName: "Sprite1",
    x: 12, y: 34, visible: true, mode: "default", width: 0, height: 0, sliderMin: 0, sliderMax: 100, isDiscrete: true },
  { id: LID_DEAD, opcode: "data_listcontents", params: { LIST: "deadList" }, spriteName: "Sprite1",
    x: 56, y: 78, visible: false, mode: "default", width: 0, height: 0, sliderMin: 0, sliderMax: 100, isDiscrete: true }
];
const kept = SB3.compressProject(monProject, new SB3.Options({}), () => {});
const keptTarget = kept.project.targets[0];
const keptMons = kept.project.monitors || [];
check(kept.stats.monitors_removed === 0, "keeping monitors removed one");
check(keptMons.length === 2, `keeping monitors dropped one (${keptMons.length} left)`);
if (keptMons.length === 2) {
  check(keptMons[0].id === VID_COUNT && keptMons[0].params.VARIABLE === "count",
    "keeping monitors renamed the displayed variable");
  check(keptMons[0].x === 12 && keptMons[0].y === 34, "keeping monitors dropped the displayed monitor position");
  check(keptMons[1].id === LID_DEAD && keptMons[1].params.LIST === "deadList",
    "keeping monitors renamed the hidden monitor's list");
  check(keptMons[1].x === 56 && keptMons[1].y === 78, "keeping monitors dropped the hidden monitor position");
}
check(keptTarget.variables && keptTarget.variables[VID_COUNT] && keptTarget.variables[VID_COUNT][0] === "count",
  "keeping monitors renamed the displayed variable's store");
check(keptTarget.lists && keptTarget.lists[LID_DEAD] && keptTarget.lists[LID_DEAD][0] === "deadList",
  "keeping monitors removed or renamed the hidden monitor's list");
// Renaming is off for kept stores, but every other store is still shortened.
check(Object.keys(keptTarget.variables || {}).length === 2, "keeping monitors preserved a variable it should not have");

/*
 * shortenIds owns ids; renameStores owns visible names. With the "no visible
 * change" mix (ids on, names off) every variable, list, message, custom block,
 * and argument name must survive untouched.
 */
const namedProject = buildProject();
const namedTarget = namedProject.targets[0];
const BID_GO = "broadcastLongId0001";
namedTarget.broadcasts = { [BID_GO]: "go" };
namedTarget.blocks.flag.next = "broadcastGo";
namedTarget.blocks.broadcastGo = blk("event_broadcast", {
  parent: "flag", next: "call",
  inputs: { BROADCAST_INPUT: [1, [11, "go", BID_GO]] }
});
namedTarget.blocks.receiveGo = blk("event_whenbroadcastreceived", {
  topLevel: true, x: 0, y: 0, next: "receiveSay",
  fields: { BROADCAST_OPTION: ["go", BID_GO] }
});
namedTarget.blocks.receiveSay = blk("looks_say", {
  parent: "receiveGo", next: null,
  inputs: { MESSAGE: [1, [10, "go!"]] }
});
const noRename = SB3.compressProject(namedProject, new SB3.Options({
  renameStores: false, compressProcs: false, removeUnused: false, removeMonitors: true
}), () => {});
const nt = noRename.project.targets[0];
const namesOf = (table) => Object.values(table || {}).map((v) => (Array.isArray(v) ? v[0] : v));
check(namesOf(nt.variables).includes("count") && namesOf(nt.variables).includes("text") &&
  namesOf(nt.variables).includes("neverUsed"), "renameStores=false changed a variable name");
check(!(VID_COUNT in (nt.variables || {})), "shortenIds did not shorten variable ids when names were kept");
check(namesOf(nt.lists).includes("items") && namesOf(nt.lists).includes("deadList"),
  "renameStores=false changed a list name");
check(!(LID_LIST in (nt.lists || {})), "shortenIds did not shorten list ids when names were kept");
check(namesOf(nt.broadcasts).includes("go"), "renameStores=false changed a message name");
check(!(BID_GO in (nt.broadcasts || {})), "shortenIds did not shorten message ids when names were kept");

let keptField = null;
for (const b of Object.values(nt.blocks || {})) {
  if (!b || Array.isArray(b) || b.opcode !== "data_setvariableto") continue;
  if (b.fields && b.fields.VARIABLE && b.fields.VARIABLE[0] === "count") keptField = b;
}
check(!!keptField, "a block's VARIABLE name was rewritten with renameStores=false");
if (keptField) {
  check(keptField.fields.VARIABLE[1] !== VID_COUNT, "the block's variable id was not shortened");
  check(keptField.fields.VARIABLE[1] in (nt.variables || {}), "the block points at a missing variable id");
}
const keptProto = Object.values(nt.blocks || {}).find((b) => b && !Array.isArray(b) && b.opcode === "procedures_prototype");
check(keptProto && keptProto.mutation && keptProto.mutation.proccode === "do %s",
  "compressProcs=false changed a custom block name");
check(keptProto && parseArr(keptProto.mutation.argumentnames)[0] === "x",
  "compressProcs=false changed an argument name");
const keptCall = Object.values(nt.blocks || {}).find((b) => b && !Array.isArray(b) && b.opcode === "procedures_call");
check(keptCall && keptCall.mutation && keptCall.mutation.proccode === "do %s",
  "compressProcs=false left a call pointing at a renamed custom block");

// The default mix still shortens both, so existing output is unchanged.
const bothOut = SB3.compressProject(buildProject(), new SB3.Options({ removeMonitors: true }), () => {});
const bothNames = namesOf(bothOut.project.targets[0].variables);
check(bothNames.length === 2 && bothNames.every((n) => /^[A-Z]$/.test(String(n))),
  `the default no longer emits the shortest variable names (${JSON.stringify(bothNames)})`);

// A cloud variable keeps Scratch's "☁ " marker, but that marker is not a
// reason to make an ordinary variable skip a letter: "☁ A" and "A" are two
// different names.
const cloudOut = SB3.compressProject({
  targets: [{
    isStage: true, name: "Stage",
    variables: {
      cloud: ["\u2601 points", 0],
      alpha: ["alpha", 0],
      beta: ["beta", 0]
    },
    lists: {}, broadcasts: {},
    blocks: {
      hat: blk("event_whenflagclicked", { topLevel: true, next: "setA", x: 0, y: 0 }),
      setA: blk("data_setvariableto", {
        parent: "hat", next: "setB",
        inputs: { VALUE: [1, [4, "1"]] }, fields: { VARIABLE: ["alpha", "alpha"] }
      }),
      setB: blk("data_setvariableto", {
        parent: "setA", next: "setC",
        inputs: { VALUE: [1, [4, "2"]] }, fields: { VARIABLE: ["beta", "beta"] }
      }),
      setC: blk("data_setvariableto", {
        parent: "setB",
        inputs: { VALUE: [1, [4, "3"]] }, fields: { VARIABLE: ["\u2601 points", "cloud"] }
      })
    }
  }],
  monitors: []
}, new SB3.Options({}), () => {});
const cloudVars = cloudOut.project.targets[0].variables;
const cloudNames = namesOf(cloudVars).sort();
check(cloudNames.length === 3 &&
  cloudNames[0] === "A" && cloudNames[1] === "B" && cloudNames[2] === "\u2601 A",
  `cloud variables did not get the shortest names (${JSON.stringify(cloudNames)})`);
check(Object.keys(cloudVars).sort().join("") === "ABC",
  `cloud variables did not get the shortest store ids (${JSON.stringify(Object.keys(cloudVars))})`);

/*
 * Extra regressions, both of which reached users as "the project breaks or the
 * pictures move": an argument reporter whose VALUE is one of its own custom
 * block's parameters must keep naming that parameter.
 */
function parseArr(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch (_) { return []; }
  }
  return [];
}

function argReporterProblems(project) {
  const problems = [];
  for (const t of project.targets || []) {
    const blocks = t.blocks || {};
    for (const def of Object.values(blocks)) {
      if (!def || Array.isArray(def) || def.opcode !== "procedures_definition") continue;
      const cb = (def.inputs || {}).custom_block;
      const proto = blocks[Array.isArray(cb) ? cb[1] : null];
      const code = proto && proto.mutation ? proto.mutation.proccode : null;
      const names = new Set(parseArr(proto && proto.mutation && proto.mutation.argumentnames));
      const stack = [def.next];
      const seen = new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (typeof cur !== "string" || seen.has(cur)) continue;
        const b = blocks[cur];
        if (!b || Array.isArray(b)) continue;
        seen.add(cur);
        if (typeof b.opcode === "string" && b.opcode.startsWith("argument_reporter")) {
          const value = ((b.fields || {}).VALUE || [])[0];
          if (typeof value === "string" && value && !names.has(value)) {
            problems.push(`${t.name}.${cur}: reporter ${JSON.stringify(value)} inside ${JSON.stringify(code)} `
              + `is not one of ${JSON.stringify([...names])}`);
          }
        }
        for (const entry of Object.values(b.inputs || {})) {
          if (!Array.isArray(entry)) continue;
          for (let i = 1; i < entry.length; i++) {
            if (typeof entry[i] === "string") stack.push(entry[i]);
          }
        }
        if (typeof b.next === "string") stack.push(b.next);
      }
    }
  }
  return problems;
}

// 1. "Shorten internal IDs" used to rewrite fields.VALUE (the argument *name*)
//    with the shortened argument *id*, so a parameter named "x" became the id
//    of some unrelated argument.  The name and the id deliberately collide here.
function buildCollisionProject() {
  const NAME = "x";
  const ID_COLLIDING = "x";
  const ID_LONG = "argumentIdLong000001";
  return {
    targets: [{
      isStage: false, name: "Sprite1",
      variables: {}, lists: {}, broadcasts: {},
      blocks: {
        useHat: blk("procedures_definition", {
          topLevel: true, x: 0, y: 0, next: "sayName", inputs: { custom_block: [1, "useProto"] }
        }),
        useProto: blk("procedures_prototype", {
          shadow: true, parent: "useHat", inputs: { [ID_COLLIDING]: [1, [10, NAME]] },
          mutation: {
            proccode: "use %s", argumentids: JSON.stringify([ID_COLLIDING]),
            argumentnames: JSON.stringify([NAME]), argumentdefaults: JSON.stringify([""]), warp: "false"
          }
        }),
        sayName: blk("looks_say", {
          parent: "useHat", inputs: { MESSAGE: [3, "readName", [10, ""]] }
        }),
        readName: blk("argument_reporter_string_number", {
          parent: "sayName", fields: { VALUE: [NAME, null] }
        }),
        otherHat: blk("procedures_definition", {
          topLevel: true, x: 0, y: 400, next: "sayOther", inputs: { custom_block: [1, "otherProto"] }
        }),
        otherProto: blk("procedures_prototype", {
          shadow: true, parent: "otherHat", inputs: { [ID_LONG]: [1, [10, "k"]] },
          mutation: {
            proccode: "other %s", argumentids: JSON.stringify([ID_LONG]),
            argumentnames: JSON.stringify(["k"]), argumentdefaults: JSON.stringify([""]), warp: "false"
          }
        }),
        sayOther: blk("looks_say", {
          parent: "otherHat", inputs: { MESSAGE: [3, "readOther", [10, ""]] }
        }),
        readOther: blk("argument_reporter_string_number", {
          parent: "sayOther", fields: { VALUE: ["k", null] }
        }),
        flag2: blk("event_whenflagclicked", { topLevel: true, x: 0, y: 800, next: "callUse" }),
        callUse: blk("procedures_call", {
          parent: "flag2", next: "callOther",
          mutation: { proccode: "use %s", argumentids: JSON.stringify([ID_COLLIDING]), warp: "false" },
          inputs: { [ID_COLLIDING]: [1, [10, "1"]] }
        }),
        callOther: blk("procedures_call", {
          parent: "callUse",
          mutation: { proccode: "other %s", argumentids: JSON.stringify([ID_LONG]), warp: "false" },
          inputs: { [ID_LONG]: [1, [10, "2"]] }
        })
      },
      comments: {},
      currentCostume: 0,
      costumes: [{
        name: "c", dataFormat: "svg", assetId: "0".repeat(32),
        md5ext: "0".repeat(32) + ".svg", bitmapResolution: 1,
        rotationCenterX: 10, rotationCenterY: 10
      }],
      sounds: [], volume: 100, layerOrder: 0, visible: true, x: 0, y: 0, size: 100,
      direction: 90, draggable: false, rotationStyle: "all around"
    }],
    monitors: [], extensions: [], meta: { semver: "3.0.0" }
  };
}

const collision = SB3.compressProject(buildCollisionProject(), new SB3.Options({
  shortenIds: true,
  compressProcs: false,
  nearDuplicates: false,
  extractDuplicates: false,
  removeUnused: false
}), () => {});
argReporterProblems(collision.project).forEach((p) => check(false, "arg name/id collision: " + p));
{
  const cb = collision.project.targets[0].blocks;
  const reporters = Object.entries(cb)
    .filter(([, b]) => b && typeof b.opcode === "string" && b.opcode.startsWith("argument_reporter"))
    .map(([, b]) => (b.fields.VALUE || [])[0]);
  check(reporters.includes("x"),
    `the reporter for the parameter "x" lost its name (reporters: ${JSON.stringify(reporters)})`);
  check(collision.stats.arg_ids_shortened >= 2, "argument ids were not shortened in the collision project");
}

// 2. Near-duplicate merging used to scan only the first block of a SUBSTACK, so
//    a reporter further down that substack stayed inside the generated
//    procedure, where it no longer named a parameter and read as empty.
function buildNestedMergeProject() {
  const PID = "paintArgumentId00001";
  const LAYER_ID = "layerArgumentId00001";
  const blocks = {
    paintHat: blk("procedures_definition", {
      topLevel: true, x: 0, y: 0, next: "rootA", inputs: { custom_block: [1, "paintProto"] }
    }),
    paintProto: blk("procedures_prototype", {
      shadow: true, parent: "paintHat",
      inputs: { [PID]: [1, [10, "amount"]], [LAYER_ID]: [1, [10, "layer"]] },
      mutation: {
        proccode: "paint %s %s", argumentids: JSON.stringify([PID, LAYER_ID]),
        argumentnames: JSON.stringify(["amount", "layer"]),
        argumentdefaults: JSON.stringify(["", ""]), warp: "false"
      }
    })
  };
  const addCopy = (tag, literal, parent, next, text) => {
    const root = `root${tag}`;
    const cond = `eq${tag}`;
    const arg = `arg${tag}`;
    blocks[root] = blk("control_if_else", {
      parent, next, inputs: { CONDITION: [2, cond], SUBSTACK: [2, `say${tag}1`] }
    });
    blocks[cond] = blk("operator_equals", {
      parent: root, inputs: { OPERAND1: [3, arg, [10, ""]], OPERAND2: [1, [10, literal]] }
    });
    blocks[arg] = blk("argument_reporter_string_number", { parent: cond, fields: { VALUE: ["amount", null] } });
    let prev = null;
    for (let i = 1; i <= 20; i++) {
      const id = `say${tag}${i}`;
      const last = i === 20;
      blocks[id] = blk("looks_say", {
        parent: prev || root,
        inputs: { MESSAGE: [1, [10, text + i]] }
      });
      if (prev) blocks[prev].next = id;
      prev = id;
      if (last) {
        // The reporter sits in the *second* half of the substack chain.
        blocks[id].inputs.MESSAGE = [3, `read${tag}`, [10, ""]];
        blocks[`read${tag}`] = blk("argument_reporter_string_number", {
          parent: id, fields: { VALUE: ["layer", null] }
        });
      }
    }
  };
  addCopy("A", "1", "paintHat", "rootB", "same");
  addCopy("B", "2", "rootA", null, "same");
  blocks.flag3 = blk("event_whenflagclicked", { topLevel: true, x: 0, y: 600, next: "callPaint" });
  blocks.callPaint = blk("procedures_call", {
    parent: "flag3",
    mutation: { proccode: "paint %s %s", argumentids: JSON.stringify([PID, LAYER_ID]), warp: "false" },
    inputs: { [PID]: [1, [10, "3"]], [LAYER_ID]: [1, [10, "4"]] }
  });
  return {
    targets: [{
      isStage: false, name: "Sprite1",
      variables: {}, lists: {}, broadcasts: {},
      blocks,
      comments: {},
      currentCostume: 0,
      costumes: [{
        name: "c", dataFormat: "svg", assetId: "0".repeat(32),
        md5ext: "0".repeat(32) + ".svg", bitmapResolution: 1,
        rotationCenterX: 10, rotationCenterY: 10
      }],
      sounds: [], volume: 100, layerOrder: 0, visible: true, x: 0, y: 0, size: 100,
      direction: 90, draggable: false, rotationStyle: "all around"
    }],
    monitors: [], extensions: [], meta: { semver: "3.0.0" }
  };
}

const merged = SB3.compressProject(buildNestedMergeProject(), new SB3.Options({
  nearDuplicates: true,
  shortenIds: false,
  compressProcs: false,
  extractDuplicates: false,
  removeUnused: false
}), () => {});
argReporterProblems(merged.project).forEach((p) => check(false, "nested near-duplicate: " + p));
check(merged.stats.near_duplicates_extracted >= 1,
  "the nested near-duplicate fixture did not merge anything (test no longer exercises the bug)");
{
  const blocks = merged.project.targets[0].blocks;
  let reportersInGeneratedBodies = 0;
  for (const def of Object.values(blocks)) {
    if (!def || Array.isArray(def) || def.opcode !== "procedures_definition") continue;
    const cb = (def.inputs || {}).custom_block;
    const proto = blocks[Array.isArray(cb) ? cb[1] : null];
    const code = (proto && proto.mutation && proto.mutation.proccode) || "";
    // The nested fixture ships one hand-written definition ("paint %s %s").
    // Every other definition is a newly generated near-duplicate merge.
    if (!code || code === "paint %s %s") continue;
    // Count reporters that belong to this definition body.
    const stack = [def.next];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (typeof cur !== "string" || seen.has(cur)) continue;
      const b = blocks[cur];
      if (!b || Array.isArray(b)) continue;
      seen.add(cur);
      if (typeof b.opcode === "string" && b.opcode.startsWith("argument_reporter")) reportersInGeneratedBodies += 1;
      for (const entry of Object.values(b.inputs || {})) {
        if (!Array.isArray(entry)) continue;
        for (let i = 1; i < entry.length; i++) if (typeof entry[i] === "string") stack.push(entry[i]);
      }
      if (typeof b.next === "string") stack.push(b.next);
    }
  }
  check(reportersInGeneratedBodies >= 1,
    "the merged procedure did not keep its argument reporter (the nested chain was not parametrised)");
}

// 3. Near-duplicate merging must not move `control_stop` into a generated
//    procedure.  A "stop this script" inside the generated definition stops
//    that procedure and returns to the caller, so the code after the call runs
//    instead of being skipped.  Scripts whose copied subtree contains a stop
//    therefore have to stay inline, while stop-free look-alikes must still
//    merge (otherwise the guard would disable the whole feature).
function buildStopMergeProject() {
  const blocks = {};
  const addScript = (tag, y, stopOption) => {
    const hat = `stopHat${tag}`;
    const root = `stopIf${tag}`;
    const cond = `stopEq${tag}`;
    const first = `stopSay${tag}1`;
    blocks[hat] = blk("event_whenflagclicked", {
      topLevel: true, x: 0, y, next: root
    });
    blocks[root] = blk("control_if", {
      parent: hat,
      inputs: { CONDITION: [2, cond], SUBSTACK: [2, first] }
    });
    blocks[cond] = blk("operator_equals", {
      parent: root,
      inputs: { OPERAND1: [1, [10, tag]], OPERAND2: [1, [10, "x"]] }
    });
    let prev = null;
    for (let i = 1; i <= 12; i++) {
      const id = `stopSay${tag}${i}`;
      blocks[id] = blk("looks_say", {
        parent: prev || root,
        inputs: { MESSAGE: [1, [10, tag + i]] }
      });
      if (prev) blocks[prev].next = id;
      prev = id;
    }
    if (stopOption) {
      const sid = `stopBlock${tag}`;
      blocks[prev].next = sid;
      blocks[sid] = blk("control_stop", {
        parent: prev, fields: { STOP_OPTION: [stopOption, null] }
      });
    }
  };
  addScript("A", 0, "this script");
  addScript("B", 500, "this script");
  addScript("E", 2000, "other scripts in sprite");
  addScript("F", 2500, "other scripts in sprite");
  addScript("C", 1000, null);
  addScript("D", 1500, null);
  return {
    targets: [{
      isStage: false, name: "Sprite1",
      variables: {}, lists: {}, broadcasts: {},
      blocks,
      comments: {},
      currentCostume: 0,
      costumes: [{
        name: "c", dataFormat: "svg", assetId: "0".repeat(32),
        md5ext: "0".repeat(32) + ".svg", bitmapResolution: 1,
        rotationCenterX: 10, rotationCenterY: 10
      }],
      sounds: [], volume: 100, layerOrder: 0, visible: true, x: 0, y: 0, size: 100,
      direction: 90, draggable: false, rotationStyle: "all around"
    }],
    monitors: [], extensions: [], meta: { semver: "3.0.0" }
  };
}

const stopMerged = SB3.compressProject(buildStopMergeProject(), new SB3.Options({
  nearDuplicates: true,
  shortenIds: false,
  compressProcs: false,
  extractDuplicates: false,
  removeUnused: false
}), () => {});
{
  const blocks = stopMerged.project.targets[0].blocks;
  let totalStops = 0;
  let stopsInGeneratedBodies = 0;
  let generatedBodies = 0;
  for (const b of Object.values(blocks)) {
    if (!b || Array.isArray(b) || b.opcode !== "control_stop") continue;
    totalStops += 1;
  }
  for (const def of Object.values(blocks)) {
    if (!def || Array.isArray(def) || def.opcode !== "procedures_definition") continue;
    const cb = (def.inputs || {}).custom_block;
    const proto = blocks[Array.isArray(cb) ? cb[1] : null];
    const code = (proto && proto.mutation && proto.mutation.proccode) || "";
    if (!code) continue;
    generatedBodies += 1;
    const stack = [def.next];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (typeof cur !== "string" || seen.has(cur)) continue;
      const b = blocks[cur];
      if (!b || Array.isArray(b)) continue;
      seen.add(cur);
      if (b.opcode === "control_stop") stopsInGeneratedBodies += 1;
      for (const entry of Object.values(b.inputs || {})) {
        if (!Array.isArray(entry)) continue;
        for (let i = 1; i < entry.length; i++) if (typeof entry[i] === "string") stack.push(entry[i]);
      }
      if (typeof b.next === "string") stack.push(b.next);
    }
  }
  check(totalStops === 4,
    `a control_stop block was lost or duplicated (found ${totalStops}, expected 4)`);
  check(stopsInGeneratedBodies === 0,
    `a control_stop was moved into a generated procedure (${stopsInGeneratedBodies} found)`);
  check(generatedBodies >= 1,
    "the stop-free near-duplicate fixture did not merge anything (test no longer exercises the merge path)");
}

/*
 * 4. Automatic repetition of the cheap restructure steps.  Reporter reuse
 *    applies at most 30 groups per call, so a target with more candidates only
 *    finishes on a later pass.  The fixture below has enough independent
 *    reporters to prove that the loop keeps going on its own: a single
 *    compressProject() call must cache more than 30 groups.  Exact and
 *    near-duplicate extraction have their own internal 200-group caps, which
 *    the same outer loop covers.  A second compression of the result must be a
 *    fixed point, and turning the three steps off must keep the loop at one
 *    pass.
 */
function buildRepeatReporterProject() {
  const VID = "variableLongIdForRepeatTest01";
  const blocks = {
    hat: blk("event_whenflagclicked", { topLevel: true, x: 0, y: 0 })
  };
  let prev = "hat";
  for (let g = 0; g < 31; g++) {
    for (let copy = 0; copy < 10; copy++) {
      const sayId = `say_${g}_${copy}`;
      blocks[prev].next = sayId;
      blocks[sayId] = blk("looks_say", {
        parent: prev,
        inputs: { MESSAGE: [3, `join_${g}_${copy}_0`, [10, ""]] }
      });
      prev = sayId;
      const varBlock = `var_${g}_${copy}`;
      let child = varBlock;
      for (let d = 11; d >= 0; d--) {
        const joinId = `join_${g}_${copy}_${d}`;
        blocks[joinId] = blk("operator_join", {
          parent: d === 0 ? sayId : `join_${g}_${copy}_${d - 1}`,
          inputs: {
            STRING1: [3, child, [10, ""]],
            STRING2: [1, [10, `v${g}-${d}`]]
          }
        });
        child = joinId;
      }
      blocks[varBlock] = blk("data_variable", {
        parent: `join_${g}_${copy}_11`, fields: { VARIABLE: ["x", VID] }
      });
    }
  }
  return {
    targets: [{
      isStage: false, name: "Sprite1",
      variables: { [VID]: ["x", 0] }, lists: {}, broadcasts: {},
      blocks, comments: {},
      currentCostume: 0,
      costumes: [{
        name: "c", dataFormat: "svg", assetId: "0".repeat(32),
        md5ext: "0".repeat(32) + ".svg", bitmapResolution: 1,
        rotationCenterX: 10, rotationCenterY: 10
      }],
      sounds: [], volume: 100, layerOrder: 0, visible: true, x: 0, y: 0, size: 100,
      direction: 90, draggable: false, rotationStyle: "all around"
    }],
    monitors: [], extensions: [], meta: { semver: "3.0.0" }
  };
}

const repeatBase = {
  extractDuplicates: false,
  nearDuplicates: false,
  loopDuplicates: false,
  inlineSingleCall: false,
  removeNoops: false,
  simplifyIfElse: false,
  foldConstants: false,
  propagateConstants: false,
  removeUnused: false,
  clearInitialValues: false,
  stripDefaults: false,
  renameStores: false,
  compressProcs: false,
  removeMonitors: true
};
const autoOnce = SB3.compressProject(buildRepeatReporterProject(), new SB3.Options(repeatBase), () => {});
const autoTwice = SB3.compressProject(autoOnce.project, new SB3.Options(repeatBase), () => {});
audit(autoOnce.project);
audit(autoTwice.project);
check(autoOnce.stats.reporter_values_cached > 30,
  "automatic repetition stopped after a single reporter-reuse call");
check(autoOnce.stats.optimization_passes >= 2,
  "the reporter fixture did not need a second pass");
check(autoOnce.stats.optimization_passes <= 10,
  "automatic repetition ran more than the 10-pass cap");
check(SB3.dumpsCompact(autoTwice.project).length ===
  SB3.dumpsCompact(autoOnce.project).length,
  "compressing the result again still found savings (the loop stopped early)");
check(autoTwice.stats.optimization_passes === 1,
  "a fixed point still needed more than one pass");
const repeatOff = SB3.compressProject(buildRepeatReporterProject(), new SB3.Options(
  Object.assign({}, repeatBase, {
    extractDuplicates: false, nearDuplicates: false, reuseReporters: false
  })), () => {});
check(repeatOff.stats.optimization_passes === 1,
  "the loop ran extra passes with all three repeatable steps disabled");

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
  dead_hide_blocks_removed: out.stats.dead_hide_blocks_removed,
  vars_initialized: out.stats.vars_initialized,
  lists_initialized: out.stats.lists_initialized,
  monitors_removed: out.stats.monitors_removed
}));
