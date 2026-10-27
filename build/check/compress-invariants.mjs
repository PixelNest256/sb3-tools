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
 *      procedure, where "stop this script" would only end the procedure;
 *   8. removing a run of blocks (adjacent write-only stores) re-points every
 *      link past the whole run, so no block ends up detached from its script;
 *   9. a costume chosen at run time (or named by a menu) survives, and
 *      `currentCostume` still points at the costume it named.
 *
 * Invariants 1-3 were broken by "remove legacy mutation keys"; 4 by clearing
 * every overwritten value; 5 by "shorten internal IDs" and by near-duplicate
 * merging; 8 and 9 by "remove write-only variables" and "remove dead assets".
 * All of these reached users and made projects fail to load or behave
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

/*
 * 5. Store scoping across targets.  scratch-vm resolves a store id in the
 *    sprite first and then in the stage, so an id reused by two targets makes
 *    a sprite's global reads hit its own store.  The editor also rejects a
 *    stage variable whose name equals any sprite's local variable.  Check both
 *    rules, while still allowing two sprites to share a local name (which is
 *    legal and saves the most space).
 */
function buildScopeProject() {
  const GV_SCORE = "globalScore000000001";
  const GL_GLOBAL = "globalList0000000001";
  const S1_VAR = "spriteOneLocal000001";
  const S1_LIST = "spriteOneList0000001";
  const S2_VAR = "spriteTwoLocal000001";
  const S2_LIST = "spriteTwoList0000001";
  return {
    targets: [{
      isStage: false, name: "Sprite1",
      variables: { [S1_VAR]: ["localOne", 0] },
      lists: { [S1_LIST]: ["listOne", []] },
      broadcasts: {},
      blocks: {
        flag: blk("event_whenflagclicked", { topLevel: true, x: 0, y: 0, next: "setLocal" }),
        setLocal: blk("data_setvariableto", {
          parent: "flag", next: "changeGlobal",
          inputs: { VALUE: [1, [10, "1"]] },
          fields: { VARIABLE: ["localOne", S1_VAR] }
        }),
        changeGlobal: blk("data_changevariableby", {
          parent: "setLocal", next: "addGlobal",
          inputs: { VALUE: [1, [4, "1"]] },
          fields: { VARIABLE: ["score", GV_SCORE] }
        }),
        addGlobal: blk("data_addtolist", {
          parent: "changeGlobal", next: "addLocal",
          inputs: { ITEM: [1, [10, "1"]] },
          fields: { LIST: ["highscores", GL_GLOBAL] }
        }),
        addLocal: blk("data_addtolist", {
          parent: "addGlobal", next: "sayGlobal",
          inputs: { ITEM: [1, [10, "2"]] },
          fields: { LIST: ["listOne", S1_LIST] }
        }),
        sayGlobal: blk("looks_say", {
          parent: "addLocal",
          inputs: { MESSAGE: [3, "readGlobal", [10, ""]] }
        }),
        readGlobal: blk("data_variable", {
          parent: "sayGlobal", fields: { VARIABLE: ["score", GV_SCORE] }
        })
      },
      costumes: [], sounds: []
    }, {
      isStage: true, name: "Stage",
      variables: { [GV_SCORE]: ["score", 0] },
      lists: { [GL_GLOBAL]: ["highscores", []] },
      broadcasts: {}, blocks: {}, costumes: [], sounds: []
    }, {
      isStage: false, name: "Sprite2",
      variables: { [S2_VAR]: ["localTwo", 0] },
      lists: { [S2_LIST]: ["listTwo", []] },
      broadcasts: {},
      blocks: {
        flag2: blk("event_whenflagclicked", { topLevel: true, x: 0, y: 0, next: "setLocal2" }),
        setLocal2: blk("data_setvariableto", {
          parent: "flag2", next: "addLocal2",
          inputs: { VALUE: [1, [10, "1"]] },
          fields: { VARIABLE: ["localTwo", S2_VAR] }
        }),
        addLocal2: blk("data_addtolist", {
          parent: "setLocal2",
          inputs: { ITEM: [1, [10, "2"]] },
          fields: { LIST: ["listTwo", S2_LIST] }
        })
      },
      costumes: [], sounds: []
    }],
    extensions: [], meta: { semver: "3.0.0" }
  };
}

// Keep the scoping checks independent of constant folding and other rewrites:
// only the store numbering/renaming path is under test here.
const SCOPE_OPTIONS = {
  removeMonitors: true,
  propagateConstants: false,
  foldConstants: false,
  simplifyIfElse: false,
  removeNoops: false,
  inlineSingleCall: false,
  extractDuplicates: false,
  nearDuplicates: false,
  loopDuplicates: false,
  reuseReporters: false,
  compressProcs: false,
  clearInitialValues: false,
  stripDefaults: false
};

const namesOfStores = (table) =>
  Object.values(table || {}).map((v) => (Array.isArray(v) ? v[0] : v));
const idsOfTarget = (t) => [
  ...Object.keys(t.variables || {}),
  ...Object.keys(t.lists || {})
];

function checkScopeProject(project, label) {
  const storeIds = project.targets.flatMap(idsOfTarget);
  check(new Set(storeIds).size === storeIds.length,
    `${label}: store ids repeat across targets (${JSON.stringify(storeIds)})`);
  const stage = project.targets.find((t) => t.isStage);
  const sprites = project.targets.filter((t) => !t.isStage);
  for (const sprite of sprites) {
    for (const key of ["variables", "lists"]) {
      const stageNames = new Set(namesOfStores(stage[key]));
      const clash = namesOfStores(sprite[key]).filter((n) => stageNames.has(n));
      check(!clash.length,
        `${label}: ${sprite.name} ${key} reuse the stage name(s) ${JSON.stringify(clash)}`);
    }
  }
  return { stage, sprites };
}

const scopeOut = SB3.compressProject(buildScopeProject(),
  new SB3.Options(SCOPE_OPTIONS), () => {});
audit(scopeOut.project);
const scope = checkScopeProject(scopeOut.project, "removeMonitors");
const [scopeS1, scopeS2] = scope.sprites;
check(namesOfStores(scopeS1.variables)[0] === namesOfStores(scopeS2.variables)[0],
  "two sprites no longer share the shortest local variable name");
check(namesOfStores(scopeS1.lists)[0] === namesOfStores(scopeS2.lists)[0],
  "two sprites no longer share the shortest local list name");

const readGlobal = Object.values(scopeS1.blocks || {}).find(
  (b) => b && !Array.isArray(b) && b.opcode === "data_variable");
check(!!readGlobal, "the scope fixture lost its global read");
if (readGlobal) {
  const [name, id] = readGlobal.fields.VARIABLE;
  check(!!scope.stage.variables[id] && scope.stage.variables[id][0] === name,
    "a sprite's read of a stage variable no longer points at the stage store");
  check(!(id in (scopeS1.variables || {})),
    "a sprite's read of a stage variable resolves to its own store id");
}
const setLocal = Object.values(scopeS1.blocks || {}).find(
  (b) => b && !Array.isArray(b) && b.opcode === "data_setvariableto");
check(!!setLocal, "the scope fixture lost its local write");
if (setLocal) {
  const [name, id] = setLocal.fields.VARIABLE;
  check(!!scopeS1.variables[id] && scopeS1.variables[id][0] === name,
    "a sprite's local write no longer points at its own store");
}

// A monitor keeps a sprite-local name that is already a short string.  The
// stage must skip that name, and a later sprite may still reuse it locally.
const keptScopeProject = buildScopeProject();
keptScopeProject.targets[2].variables.spriteTwoLocal000001 = ["A", 0];
keptScopeProject.monitors = [{
  id: "spriteTwoLocal000001", opcode: "data_variable", params: { VARIABLE: "A" },
  spriteName: "Sprite2", x: 1, y: 2, visible: false, mode: "default",
  width: 0, height: 0, sliderMin: 0, sliderMax: 100, isDiscrete: true
}];
const keptScopeOut = SB3.compressProject(keptScopeProject,
  new SB3.Options(Object.assign({}, SCOPE_OPTIONS, { removeMonitors: false })), () => {});
audit(keptScopeOut.project);
const keptScope = checkScopeProject(keptScopeOut.project, "kept monitor");
const keptS2 = keptScope.sprites.find((t) => t.name === "Sprite2");
check(keptS2.variables.spriteTwoLocal000001 &&
  keptS2.variables.spriteTwoLocal000001[0] === "A",
  "a kept monitor store was renamed");
check(!namesOfStores(keptScope.stage.variables).includes("A"),
  "the stage reused a sprite's kept local variable name");

/*
 * 6. TurboWarp's "store settings in project" comment.  runtime.js looks on the
 *    stage for a comment whose text includes " // _twconfig_" and parses the
 *    JSON on the line before the marker.  Deleting it would silently reset the
 *    project's framerate, stage size, interpolation, and other settings, so
 *    neither comment stripping nor unreachable-code removal may drop it, even
 *    when the block it was anchored to disappears.  Ordinary comments must
 *    still be removed as before.
 */
const TW_CONFIG_TEXT = '{"framerate":60,"stageWidth":640} // _twconfig_';

function buildTwConfigProject() {
  return {
    targets: [{
      isStage: true, name: "Stage",
      variables: {}, lists: {}, broadcasts: {},
      blocks: {
        // Kept: a hat that is reachable but does nothing.
        flag: blk("event_whenflagclicked", { topLevel: true, x: 0, y: 0 }),
        // Removed: no hat, no parent, never referenced.
        orphan: blk("motion_movesteps", {
          inputs: { STEPS: [1, [4, "10"]] }, comment: "anchored"
        })
      },
      comments: {
        cfg: {
          blockId: "orphan", x: 1, y: 2, width: 300, height: 160,
          minimized: false, text: TW_CONFIG_TEXT
        },
        notes: {
          blockId: null, x: 3, y: 4, width: 200, height: 120,
          minimized: false, text: "a normal comment"
        },
        anchored: {
          blockId: "orphan", x: 5, y: 6, width: 200, height: 120,
          minimized: true, text: "a comment on a removed block"
        }
      },
      costumes: [], sounds: []
    }],
    extensions: [], meta: { semver: "3.0.0" }
  };
}

const twStripped = SB3.compressProject(buildTwConfigProject(),
  new SB3.Options({ stripComments: true }), () => {});
const twStage = twStripped.project.targets[0];
const twComments = twStage.comments || {};
check(!!twComments.cfg, "stripping comments deleted TurboWarp's _twconfig_ comment");
check(twComments.cfg && twComments.cfg.text === TW_CONFIG_TEXT,
  "TurboWarp's _twconfig_ comment text was rewritten");
check(twComments.cfg && twComments.cfg.blockId === null,
  "TurboWarp's _twconfig_ comment still points at a removed block");
check(!twComments.notes && !twComments.anchored,
  `ordinary comments survived comment stripping (${JSON.stringify(Object.keys(twComments))})`);
check(twStripped.stats.comments_removed === 1,
  `comment stripping counted the preserved config comment (${twStripped.stats.comments_removed})`);
check(!(twStage.blocks || {}).orphan, "the unreachable block was kept");
const noStripTw = SB3.compressProject(buildTwConfigProject(), new SB3.Options({}), () => {});
const noStripComments = noStripTw.project.targets[0].comments || {};
check(!!noStripComments.cfg && noStripComments.cfg.text === TW_CONFIG_TEXT,
  "unreachable-code removal deleted TurboWarp's _twconfig_ comment");
check(noStripComments.cfg && noStripComments.cfg.blockId === null,
  "the config comment was not detached from its removed block");
check(!!noStripComments.notes, "a detached ordinary comment was dropped without stripComments");
check(!noStripComments.anchored, "a comment on a removed block survived unreachable-code removal");

/*
 * 7. Removing a block must not leave a link behind.  Write-only stores that sit
 *    next to each other are removed as a run: re-pointing the block before the
 *    run at the *next removed* block left a dangling `next`/`parent`, which
 *    detaches everything after it from the script (the editor stops drawing
 *    it, and a second compression deletes it as unreachable).
 */
function buildRemovalRunProject() {
  return {
    targets: [{
      isStage: false, name: "Sprite1",
      variables: {
        DEAD_A: ["deadA", 0], DEAD_B: ["deadB", 0], DEAD_C: ["deadC", 0],
        KEPT: ["kept", 0]
      },
      lists: {}, broadcasts: {},
      blocks: {
        // Two adjacent write-only stores, then real work.
        flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "setDeadA" }),
        setDeadA: blk("data_setvariableto", {
          parent: "flag", next: "setDeadB",
          inputs: { VALUE: [1, [4, "1"]] }, fields: { VARIABLE: ["deadA", "DEAD_A"] }
        }),
        setDeadB: blk("data_setvariableto", {
          parent: "setDeadA", next: "repeat",
          inputs: { VALUE: [1, [4, "2"]] }, fields: { VARIABLE: ["deadB", "DEAD_B"] }
        }),
        repeat: blk("control_repeat", {
          parent: "setDeadB", next: "sayKept",
          inputs: { TIMES: [1, [6, "5"]], SUBSTACK: [2, "setDeadC"] }
        }),
        // A removed store as the *first* block of a substack: the SUBSTACK
        // input has to be re-pointed past it.
        setDeadC: blk("data_setvariableto", {
          parent: "repeat", next: "changeKept",
          inputs: { VALUE: [1, [4, "3"]] }, fields: { VARIABLE: ["deadC", "DEAD_C"] }
        }),
        // Grows every iteration, so the read below is not a constant and the
        // store has to survive as a regular store.
        changeKept: blk("data_changevariableby", {
          parent: "setDeadC", inputs: { VALUE: [1, [4, "1"]] },
          fields: { VARIABLE: ["kept", "KEPT"] }
        }),
        sayKept: blk("looks_say", { parent: "repeat", inputs: { MESSAGE: [3, "readKept", [10, ""]] } }),
        readKept: blk("data_variable", { parent: "sayKept", fields: { VARIABLE: ["kept", "KEPT"] } })
      },
      comments: {},
      currentCostume: 0,
      costumes: [{
        name: "c", dataFormat: "svg", assetId: "3".repeat(32),
        md5ext: "3".repeat(32) + ".svg", bitmapResolution: 1,
        rotationCenterX: 0, rotationCenterY: 0
      }],
      sounds: [], volume: 100, layerOrder: 0, visible: true, x: 0, y: 0, size: 100,
      direction: 90, draggable: false, rotationStyle: "all around"
    }],
    monitors: [], extensions: [], meta: { semver: "3.0.0" }
  };
}

// Counts the blocks a script walk from the hats reaches: anything left over is
// detached (the editor would not draw it and the VM would not run it).
function scriptReachability(project) {
  let total = 0, inScripts = 0;
  for (const t of project.targets || []) {
    const blocks = t.blocks || {};
    const seen = new Set();
    const visit = (id) => {
      if (typeof id !== "string" || seen.has(id)) return;
      const b = blocks[id];
      if (b === undefined) return;
      seen.add(id);
      if (Array.isArray(b)) { for (let i = 1; i < b.length; i++) visit(b[i]); return; }
      if (!b || typeof b !== "object") return;
      for (const value of Object.values(b.inputs || {})) {
        if (Array.isArray(value)) for (let i = 1; i < value.length; i++) visit(value[i]);
      }
      visit(b.next);
    };
    for (const [bid, b] of Object.entries(blocks)) {
      if (b && !Array.isArray(b) && b.topLevel === true) visit(bid);
    }
    for (const [bid, b] of Object.entries(blocks)) {
      if (Array.isArray(b) || !b || typeof b.opcode !== "string") continue;
      total += 1;
      if (seen.has(bid)) inScripts += 1;
    }
  }
  return { total, inScripts };
}

const removalRun = SB3.compressProject(buildRemovalRunProject(),
  new SB3.Options({ removeWriteOnly: true }), () => {});
audit(removalRun.project);
check(removalRun.stats.writeonly_vars_removed === 3,
  `expected 3 write-only stores to go, removed ${removalRun.stats.writeonly_vars_removed}`);
const removalRunReach = scriptReachability(removalRun.project);
check(removalRunReach.inScripts === removalRunReach.total,
  `${removalRunReach.total - removalRunReach.inScripts} block(s) were detached from their script by removing write-only stores`);
const rrBlocks = removalRun.project.targets[0].blocks;
const rrFlag = Object.keys(rrBlocks).find((id) => rrBlocks[id].opcode === "event_whenflagclicked");
const rrRepeat = (rrFlag && rrBlocks[rrFlag].next) || null;
const rrRepeatBlk = rrRepeat ? rrBlocks[rrRepeat] : null;
check(!!rrRepeatBlk && rrRepeatBlk.opcode === "control_repeat",
  "the chain after a run of removed stores did not skip to the next surviving block");
const rrSubstack = (rrRepeatBlk && rrRepeatBlk.inputs.SUBSTACK[1]) || null;
check(!!rrSubstack && rrBlocks[rrSubstack] && rrBlocks[rrSubstack].opcode === "data_changevariableby",
  "a substack whose first block was removed was not re-pointed");
const removalRunTwice = SB3.compressProject(removalRun.project,
  new SB3.Options({ removeWriteOnly: true }), () => {});
check(removalRunTwice.stats.unreachable_blocks_removed === 0 &&
  Object.keys(removalRunTwice.project.targets[0].blocks).length === Object.keys(rrBlocks).length,
  "a second pass deleted blocks that the first pass had left detached");

/*
 * 8. Costume references.  `switch costume to (…)` points at a `looks_costume`
 *    menu block whose field names the costume; when the input is computed at
 *    run time the switch can land on any costume, so all of them have to stay.
 *    Dropping a costume also shifts the indices that `currentCostume` counts.
 */
function buildCostumeSwitchProject(switchBlock, costumes, currentCostume) {
  return {
    targets: [{
      isStage: false, name: "Sprite1",
      variables: {}, lists: {}, broadcasts: {},
      blocks: Object.assign({
        flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "switch" }),
        readX: blk("motion_xposition", { parent: "compute" }),
        compute: blk("operator_add", {
          parent: "switch", inputs: { NUM1: [1, [4, "1"]], NUM2: [3, "readX", [4, ""]] }
        }),
        menu: blk("looks_costume", { shadow: true, parent: "switch", fields: { COSTUME: ["c", null] } })
      }, switchBlock),
      comments: {},
      currentCostume: currentCostume,
      costumes: costumes.map((name, i) => ({
        name, dataFormat: "svg", assetId: String(i + 5).repeat(32),
        md5ext: String(i + 5).repeat(32) + ".svg", bitmapResolution: 1,
        rotationCenterX: 0, rotationCenterY: 0
      })),
      sounds: [], volume: 100, layerOrder: 0, visible: true, x: 0, y: 0, size: 100,
      direction: 90, draggable: false, rotationStyle: "all around"
    }],
    monitors: [], extensions: [], meta: { semver: "3.0.0" }
  };
}

const dynamicSwitch = SB3.compressProject(buildCostumeSwitchProject({
  switch: blk("looks_switchcostumeto", {
    parent: "flag", inputs: { COSTUME: [3, "compute", "menu"] }
  })
}, ["a", "b", "c"], 1), new SB3.Options({ removeDeadAssets: true }), () => {});
audit(dynamicSwitch.project);
check(dynamicSwitch.project.targets[0].costumes.length === 3,
  `a costume chosen at run time lost ${3 - dynamicSwitch.project.targets[0].costumes.length} costume(s)`);
check(dynamicSwitch.project.targets[0].currentCostume === 1,
  "the current costume moved although nothing was dropped");

// A menu input keeps the costume it names, and the current costume keeps its
// meaning even when a costume in front of it is dropped (the menu names "a",
// the sprite currently wears "c", so dropping "b" renumbers it).
const menuSwitch = SB3.compressProject(buildCostumeSwitchProject({
  switch: blk("looks_switchcostumeto", {
    parent: "flag", inputs: { COSTUME: [1, "menu"] }
  }),
  menu: blk("looks_costume", { shadow: true, parent: "switch", fields: { COSTUME: ["a", null] } })
}, ["a", "b", "c"], 2), new SB3.Options({ removeDeadAssets: true }), () => {});
audit(menuSwitch.project);
const menuTarget = menuSwitch.project.targets[0];
const menuCostumes = menuTarget.costumes.map((c) => c.name);
check(menuCostumes.join(",") === "a,c" || menuCostumes.join(",") === "c,a",
  `expected the current costume and the one the menu names, kept ${JSON.stringify(menuCostumes)}, removed ${menuSwitch.stats.dead_costumes_removed}`);
check(menuTarget.currentCostume === menuCostumes.indexOf("c"),
  "currentCostume no longer points at the costume it named");

// A numeric menu value is a 1-based index, not a name: `_setCostume` casts it
// with Number and `_getSoundIndex` with parseInt, so it can land anywhere.
const numericCostume = SB3.compressProject(buildCostumeSwitchProject({
  switch: blk("looks_switchcostumeto", {
    parent: "flag", inputs: { COSTUME: [1, "menu"] }
  }),
  menu: blk("looks_costume", { shadow: true, parent: "switch", fields: { COSTUME: ["2", null] } })
}, ["a", "b", "c"], 0), new SB3.Options({ removeDeadAssets: true }), () => {});
check(numericCostume.project.targets[0].costumes.length === 3,
  "`switch costume to [2]` dropped costumes it can still land on");

function buildSoundProject(menuValue) {
  return {
    targets: [{
      isStage: false, name: "Sprite1",
      variables: {}, lists: {}, broadcasts: {}, comments: {},
      blocks: {
        flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "play" }),
        play: blk("sound_play", { parent: "flag", inputs: { SOUND_MENU: [1, "menu"] } }),
        menu: blk("sound_sounds_menu", {
          shadow: true, parent: "play",
          fields: { SOUND_MENU: [String(menuValue), null] }
        })
      },
      currentCostume: 0,
      costumes: [{
        name: "costume1", dataFormat: "svg", assetId: "d".repeat(32),
        md5ext: "d".repeat(32) + ".svg", bitmapResolution: 1, rotationCenterX: 0, rotationCenterY: 0
      }],
      sounds: ["one", "two", "three"].map((name, i) => ({
        name, assetId: String(i + 1).repeat(32), dataFormat: "wav",
        rate: 48000, sampleCount: 1, md5ext: String(i + 1).repeat(32) + ".wav"
      })),
      volume: 100, layerOrder: 0, visible: true, x: 0, y: 0, size: 100,
      direction: 90, draggable: false, rotationStyle: "all around"
    }],
    monitors: [], extensions: [], meta: { semver: "3.0.0" }
  };
}
const numericSound = SB3.compressProject(buildSoundProject("2"),
  new SB3.Options({ removeDeadAssets: true }), () => {});
audit(numericSound.project);
check(numericSound.project.targets[0].sounds.length === 3,
  "`play sound [2]` dropped sounds it can still reach by index");
const namedSound = SB3.compressProject(buildSoundProject("two"),
  new SB3.Options({ removeDeadAssets: true }), () => {});
audit(namedSound.project);
const namedSoundNames = namedSound.project.targets[0].sounds.map((s) => s.name);
check(namedSoundNames.join(",") === "two",
  `expected only the sound the menu names, kept ${JSON.stringify(namedSoundNames)}`);

/*
 * 9. What else `removeWriteOnly` and `removeDeadAssets` must not touch.
 *    Each fixture targets a resolution rule that is easy to get wrong:
 *      * `control_for_each` owns its variable (the VM re-creates it if the
 *        store is missing);
 *      * `sensing_of` reads a scalar variable when PROPERTY is not a sprite
 *        attribute (`lookupVariableByNameAndType`);
 *      * a target without a `lists` key still has to lose its writers;
 *      * the Stage's backdrop list is reachable from every sprite, and
 *        `next` / `previous` / `random` / numeric or missing names keep it all;
 *      * `when backdrop switches to [X]` needs X;
 *      * a sprite named by a menu (`goto`, `touching`, `distance to`, clone,
 *        `sensing_of`) is not dead;
 *      * `stripNullFieldIds` / `zeroTopLevelCoords` do not depend on
 *        `normalizeTypes`;
 *      * the zip loses the asset files the dead-asset pass dropped.
 */
function buildTarget(name, isStage, extra) {
  return Object.assign({
    isStage: isStage, name,
    variables: {}, broadcasts: {},
    blocks: {}, comments: {},
    currentCostume: 0,
    costumes: [{
      name: isStage ? "backdrop1" : "costume1", dataFormat: "svg",
      assetId: (isStage ? "c" : "d").repeat(32),
      md5ext: (isStage ? "c" : "d").repeat(32) + ".svg",
      bitmapResolution: 1, rotationCenterX: 0, rotationCenterY: 0
    }],
    sounds: [], volume: 100, layerOrder: 0, visible: true, x: 0, y: 0, size: 100,
    direction: 90, draggable: false, rotationStyle: "all around"
  }, extra || {});
}
function buildMiniProject(targets, monitors) {
  return {
    targets: targets, monitors: monitors || [],
    extensions: [], meta: { semver: "3.0.0" }
  };
}
const stageOf = (extra) => buildTarget("Stage", true, extra);
const findTarget = (project, name) => project.targets.find((t) => t.name === name);
const opcodesOf = (target) => Object.values(target.blocks || {})
  .filter((b) => b && !Array.isArray(b)).map((b) => b.opcode);

// A target with no `lists` key at all: the cleanup used to be nested inside
// `if (isDict(tgt.lists))`, so the store went but its writer stayed behind.
const noListsRun = SB3.compressProject(buildMiniProject([
  stageOf(),
  buildTarget("Sprite1", false, {
    variables: { DEAD1: ["dead", 0] },
    blocks: {
      flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "setDead" }),
      setDead: blk("data_setvariableto", {
        parent: "flag", next: "say",
        inputs: { VALUE: [1, [4, "1"]] }, fields: { VARIABLE: ["dead", "DEAD1"] }
      }),
      say: blk("looks_say", { parent: "setDead", inputs: { MESSAGE: [1, [10, "hi"]] } })
    }
  })
]), new SB3.Options({ removeWriteOnly: true }), () => {});
audit(noListsRun.project);
const noListsSprite = findTarget(noListsRun.project, "Sprite1");
check(!Object.keys(noListsSprite.variables || {}).length,
  "the write-only store survived because the target has no lists");
check(!opcodesOf(noListsSprite).includes("data_setvariableto"),
  "the writer of a removed store survived in a target without lists");
check(opcodesOf(noListsSprite).includes("looks_say"),
  "the block after a removed writer was lost");

// `control_for_each` writes its variable every iteration, and a `set` before
// the loop makes it look write-only to the scanner; removing the store would
// make the VM recreate it, so both have to stay.
const loopRun = SB3.compressProject(buildMiniProject([
  stageOf(),
  buildTarget("Sprite1", false, {
    lists: {},
    variables: { I1: ["i", 0] },
    blocks: {
      flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "setI" }),
      setI: blk("data_setvariableto", {
        parent: "flag", next: "loop",
        inputs: { VALUE: [1, [4, "0"]] }, fields: { VARIABLE: ["i", "I1"] }
      }),
      loop: blk("control_for_each", {
        parent: "setI",
        inputs: { VALUE: [1, [4, "3"]], SUBSTACK: [2, "say"] },
        fields: { VARIABLE: ["i", "I1"] }
      }),
      say: blk("looks_say", { parent: "loop", inputs: { MESSAGE: [1, [10, "x"]] } })
    }
  })
]), new SB3.Options({ removeWriteOnly: true, shortenIds: false }), () => {});
audit(loopRun.project);
const loopSprite = findTarget(loopRun.project, "Sprite1");
check(!!(loopSprite.variables || {}).I1, "control_for_each lost its loop variable");
check(opcodesOf(loopSprite).includes("control_for_each"), "control_for_each itself was removed");
check(opcodesOf(loopSprite).includes("looks_say"), "the body of control_for_each was removed");

// `sensing_of [variable] of [sprite]` reads a scalar variable by name.
const sensedRun = SB3.compressProject(buildMiniProject([
  stageOf(),
  buildTarget("Sprite1", false, {
    variables: { V1: ["v", 0] },
    blocks: {
      flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "setV" }),
      setV: blk("data_setvariableto", {
        parent: "flag",
        inputs: { VALUE: [1, [4, "7"]] }, fields: { VARIABLE: ["v", "V1"] }
      })
    }
  }),
  buildTarget("Sprite2", false, {
    blocks: {
      flag2: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "of" }),
      of: blk("sensing_of", {
        parent: "flag2",
        inputs: { OBJECT: [1, "ofMenu"] },
        fields: { PROPERTY: ["v", null] }
      }),
      ofMenu: blk("sensing_of_object_menu", {
        shadow: true, parent: "of", fields: { OBJECT: ["Sprite1", null] }
      })
    }
  })
]), new SB3.Options({ removeWriteOnly: true, removeUnused: true, shortenIds: false }), () => {});
audit(sensedRun.project);
const sensedSprite = findTarget(sensedRun.project, "Sprite1");
check(!!(sensedSprite.variables || {}).V1, "a variable read by sensing_of was removed");
check(opcodesOf(sensedSprite).includes("data_setvariableto"),
  "the writer of a variable read by sensing_of was removed");

// ------------------------------------------------------------------
// Backdrops are shared: a sprite's `next backdrop` changes the Stage.
function buildBackdropProject(spriteBlocks, stageBlocks, currentCostume) {
  return buildMiniProject([
    stageOf({
      costumes: ["b1", "b2", "b3"].map((name, i) => ({
        name, dataFormat: "svg", assetId: String(i + 1).repeat(32),
        md5ext: String(i + 1).repeat(32) + ".svg",
        bitmapResolution: 1, rotationCenterX: 0, rotationCenterY: 0
      })),
      currentCostume: currentCostume || 0,
      blocks: stageBlocks || {}
    }),
    buildTarget("Sprite1", false, { blocks: spriteBlocks })
  ]);
}
const nextBackdropRun = SB3.compressProject(buildBackdropProject({
  flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "next" }),
  next: blk("looks_nextbackdrop", { parent: "flag" })
}), new SB3.Options({ removeDeadAssets: true }), () => {});
check(findTarget(nextBackdropRun.project, "Stage").costumes.length === 3,
  "a sprite's `next backdrop` did not keep the Stage's backdrops");

function backdropSwitchRun(name) {
  return SB3.compressProject(buildBackdropProject({
    flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "sw" }),
    sw: blk("looks_switchbackdropto", { parent: "flag", inputs: { BACKDROP: [1, "menu"] } }),
    menu: blk("looks_backdrops", { shadow: true, parent: "sw", fields: { BACKDROP: [name, null] } })
  }), new SB3.Options({ removeDeadAssets: true }), () => {});
}
const namedBackdrop = backdropSwitchRun("b2");
audit(namedBackdrop.project);
const namedNames = findTarget(namedBackdrop.project, "Stage").costumes.map((c) => c.name);
check(namedNames.join(",") === "b1,b2",
  `a backdrop the sprite names (and the current one) were not the only survivors: ${namedNames}`);
for (const tricky of ["random backdrop", "next backdrop", "previous backdrop", "2"]) {
  const run = backdropSwitchRun(tricky);
  check(findTarget(run.project, "Stage").costumes.length === 3,
    `\`switch backdrop to [${tricky}]\` dropped backdrops that it can still land on`);
}
const hatBackdrop = SB3.compressProject(buildMiniProject([
  stageOf({
    costumes: ["b1", "b2", "b3"].map((name, i) => ({
      name, dataFormat: "svg", assetId: String(i + 1).repeat(32),
      md5ext: String(i + 1).repeat(32) + ".svg",
      bitmapResolution: 1, rotationCenterX: 0, rotationCenterY: 0
    })),
    blocks: {
      hat: blk("event_whenbackdropswitchesto", {
        topLevel: true, x: 40, y: 40, fields: { BACKDROP: ["b3", null] }
      })
    }
  })
]), new SB3.Options({ removeDeadAssets: true }), () => {});
const hatNames = findTarget(hatBackdrop.project, "Stage").costumes.map((c) => c.name);
check(hatNames.includes("b3"), "the backdrop a `when backdrop switches to` hat needs was removed");

// A sprite another script names is alive even when it is invisible and empty.
function spriteRefProject(reference) {
  const sprite2 = { blocks: {} };
  if (reference) {
    Object.assign(sprite2, {
      blocks: {
        flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "go" }),
        go: blk("motion_goto", { parent: "flag", inputs: { TO: [1, "goMenu"] } }),
        goMenu: blk("motion_goto_menu", { shadow: true, parent: "go", fields: { TO: ["Sprite1", null] } })
      }
    });
  }
  return buildMiniProject([
    stageOf(),
    buildTarget("Sprite1", false, { visible: false }),
    buildTarget("Sprite2", false, sprite2)
  ]);
}
const namedSprite = SB3.compressProject(spriteRefProject(true),
  new SB3.Options({ removeDeadAssets: true }), () => {});
check(!!findTarget(namedSprite.project, "Sprite1"),
  "a sprite named by `go to [sprite]` was removed");
const unnamedSprite = SB3.compressProject(spriteRefProject(false),
  new SB3.Options({ removeDeadAssets: true }), () => {});
check(!findTarget(unnamedSprite.project, "Sprite1"),
  "an invisible, scriptless, unreferenced sprite was not removed");

// A reporter in the menu can name any sprite, so none of them is dead.
const dynamicSpriteRun = SB3.compressProject(buildMiniProject([
  stageOf(),
  buildTarget("Sprite1", false, { visible: false }),
  buildTarget("Sprite2", false, {
    blocks: {
      flag: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "go" }),
      go: blk("motion_goto", { parent: "flag", inputs: { TO: [1, "nameJoin"] } }),
      nameJoin: blk("operator_join", {
        parent: "go",
        inputs: { STRING1: [1, [10, "Sprite"]], STRING2: [1, [10, "1"]] }
      })
    }
  })
]), new SB3.Options({ removeDeadAssets: true }), () => {});
check(!!findTarget(dynamicSpriteRun.project, "Sprite1"),
  "a sprite that a computed `go to` menu can still name was removed");

// The two cheap representations do not need `normalizeTypes`.
const repRun = SB3.compressProject(buildMiniProject([
  stageOf(),
  buildTarget("Sprite1", false, {
    blocks: {
      flag: blk("event_whenflagclicked", { topLevel: true, x: 123, y: 456, next: "sw" }),
      sw: blk("looks_switchcostumeto", {
        parent: "flag", inputs: { COSTUME: [1, "menu"] },
        fields: { COSTUME: ["costume1", null] }
      }),
      menu: blk("looks_costume", {
        shadow: true, parent: "sw", fields: { COSTUME: ["costume1", null], NUMBER_NAME: ["number", null] }
      })
    }
  })
]), new SB3.Options({
  normalizeTypes: false, stripNullFieldIds: true, zeroTopLevelCoords: true,
  shortenIds: false
}), () => {});
const repSprite = findTarget(repRun.project, "Sprite1");
const repMenu = Object.values(repSprite.blocks).find((b) => b && b.opcode === "looks_costume");
check(repMenu && Array.isArray(repMenu.fields.NUMBER_NAME) && repMenu.fields.NUMBER_NAME.length === 1,
  "stripNullFieldIds did nothing without normalizeTypes");
const repFlag = Object.keys(repSprite.blocks).find((id) => repSprite.blocks[id].opcode === "event_whenflagclicked");
check(repFlag && repSprite.blocks[repFlag].x === 0 && repSprite.blocks[repFlag].y === 0,
  "zeroTopLevelCoords did nothing without normalizeTypes");
check(repRun.stats.md5ext_removed === 0 && repRun.stats.numeric_strings_normalized === 0,
  "normalizeTypes was applied even though it is off");

// The zip has to lose the files the dead-asset pass dropped, or the project
// only gets smaller as JSON.
const assetIdStage = "a".repeat(32);
const assetIdSprite = "b".repeat(32);
const assetIdDead = "e".repeat(32);
const zipProject = buildMiniProject([
  stageOf({
    costumes: [{
      name: "backdrop1", dataFormat: "svg", assetId: assetIdStage,
      md5ext: assetIdStage + ".svg", bitmapResolution: 1, rotationCenterX: 0, rotationCenterY: 0
    }]
  }),
  buildTarget("Sprite1", false, {
    costumes: [{
      name: "costume1", dataFormat: "svg", assetId: assetIdSprite,
      md5ext: assetIdSprite + ".svg", bitmapResolution: 1, rotationCenterX: 0, rotationCenterY: 0
    }]
  })
]);
const zip = new JSZip();
zip.file("project.json", JSON.stringify(zipProject));
zip.file(assetIdStage + ".svg", "<svg/>");
zip.file(assetIdSprite + ".svg", "<svg/>");
zip.file(assetIdDead + ".svg", "<svg/>");
zip.file("notes/readme.txt", "keep me");
const zipBytes = await zip.generateAsync({ type: "uint8array" });
const prunedZip = await SB3.compressBuffer(zipBytes, "p.sb3",
  new SB3.Options({ removeDeadAssets: true }), () => {});
const prunedNames = Object.keys((await JSZip.loadAsync(prunedZip.finalBytes)).files).sort();
check(!prunedNames.includes(assetIdDead + ".svg"),
  "an asset file no costume or sound names survived in the zip");
check(prunedNames.includes(assetIdStage + ".svg") && prunedNames.includes(assetIdSprite + ".svg"),
  "a live asset file was dropped from the zip");
check(prunedNames.includes("notes/readme.txt"),
  "a non-asset entry next to project.json was dropped from the zip");
const untouchedZip = await SB3.compressBuffer(zipBytes, "p.sb3", new SB3.Options({}), () => {});
const untouchedNames = Object.keys((await JSZip.loadAsync(untouchedZip.finalBytes)).files);
check(untouchedNames.includes(assetIdDead + ".svg"),
  "asset files were pruned although removeDeadAssets is off");

// A monitor is tied to a store by id: another sprite's same-named local
// variable must keep its own monitor.
const monRun = SB3.compressProject(buildMiniProject([
  stageOf(),
  buildTarget("SpriteA", false, {
    lists: {},
    variables: { AX: ["x", 0] },
    blocks: {
      flagA: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "setA" }),
      setA: blk("data_setvariableto", {
        parent: "flagA", inputs: { VALUE: [1, [4, "1"]] }, fields: { VARIABLE: ["x", "AX"] }
      })
    }
  }),
  buildTarget("SpriteB", false, {
    lists: {},
    variables: { BX: ["x", 0] },
    blocks: {
      flagB: blk("event_whenflagclicked", { topLevel: true, x: 40, y: 40, next: "setB" }),
      setB: blk("data_setvariableto", {
        parent: "flagB", inputs: { VALUE: [1, [4, "2"]] }, fields: { VARIABLE: ["x", "BX"] }
      })
    }
  })
], [
  { id: "AX", opcode: "data_variable", params: { VARIABLE: "x" }, spriteName: "SpriteA",
    x: 1, y: 2, visible: false, mode: "default", width: 0, height: 0,
    sliderMin: 0, sliderMax: 100, isDiscrete: true },
  { id: "BX", opcode: "data_variable", params: { VARIABLE: "x" }, spriteName: "SpriteB",
    x: 3, y: 4, visible: true, mode: "default", width: 0, height: 0,
    sliderMin: 0, sliderMax: 100, isDiscrete: true }
]), new SB3.Options({ removeWriteOnly: true, removeMonitors: true, shortenIds: false }), () => {});
const monIds = (monRun.project.monitors || []).map((m) => m.id);
check(!monIds.includes("AX"), "the monitor of a removed write-only store survived");
check(monIds.includes("BX"), "another sprite's same-named variable lost its monitor");
check(!!(findTarget(monRun.project, "SpriteB").variables || {}).BX,
  "a visible monitor's variable was removed");

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
