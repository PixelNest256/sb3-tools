#!/usr/bin/env node
"use strict";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const assert = require("node:assert/strict");
const fs = require("node:fs");
const JSZip = require("../../docs/sb3/jszip.min.js");
const SB3 = require("../../docs/sb3/compressor.js");
const FullProject = require("../../docs/full/project.js");

function block(opcode, extra = {}) {
  return {
    opcode, next: null, parent: null, inputs: {}, fields: {},
    shadow: false, topLevel: false, ...extra
  };
}

function projectWithConstantConditions() {
  const blocks = {
    flagTrue: block("event_whenflagclicked", {
      topLevel: true, x: 10, y: 10, next: "ifTrue"
    }),
    ifTrue: block("control_if", {
      parent: "flagTrue", next: "afterTrue",
      inputs: { CONDITION: [2, "eqTrue"], SUBSTACK: [2, "keptTrue"] }
    }),
    eqTrue: block("operator_equals", {
      parent: "ifTrue",
      inputs: { OPERAND1: [1, [4, "1"]], OPERAND2: [1, [4, "1"]] }
    }),
    keptTrue: block("looks_say", { parent: "ifTrue" }),
    afterTrue: block("looks_say", { parent: "keptTrue" }),

    flagFalse: block("event_whenflagclicked", {
      topLevel: true, x: 10, y: 100, next: "ifFalse"
    }),
    ifFalse: block("control_if_else", {
      parent: "flagFalse", next: "afterFalse",
      inputs: {
        CONDITION: [2, "eqFalse"],
        SUBSTACK: [2, "deadThen"],
        SUBSTACK2: [2, "keptElse"]
      }
    }),
    eqFalse: block("operator_equals", {
      parent: "ifFalse",
      inputs: { OPERAND1: [1, [4, "1"]], OPERAND2: [1, [4, "0"]] }
    }),
    deadThen: block("looks_say", { parent: "ifFalse" }),
    keptElse: block("looks_say", { parent: "ifFalse" }),
    afterFalse: block("looks_say", { parent: "keptElse" }),

    // A nested NOT/AND tree is also constant and should be folded recursively.
    flagNested: block("event_whenflagclicked", {
      topLevel: true, x: 10, y: 200, next: "ifNested"
    }),
    ifNested: block("control_if", {
      parent: "flagNested",
      inputs: { CONDITION: [2, "andExpr"], SUBSTACK: [2, "keptNested"] }
    }),
    andExpr: block("operator_and", {
      parent: "ifNested",
      inputs: { OPERAND1: [2, "notExpr"], OPERAND2: [2, "eqTrue2"] }
    }),
    notExpr: block("operator_not", {
      parent: "andExpr", inputs: { OPERAND: [2, "eqFalse2"] }
    }),
    eqFalse2: block("operator_equals", {
      parent: "notExpr",
      inputs: { OPERAND1: [1, [4, "2"]], OPERAND2: [1, [4, "3"]] }
    }),
    eqTrue2: block("operator_equals", {
      parent: "andExpr",
      inputs: { OPERAND1: [1, [4, "9"]], OPERAND2: [1, [4, "9"]] }
    }),
    keptNested: block("looks_say", { parent: "ifNested" }),

    // Dynamic variable comparisons must never be folded.
    flagDynamic: block("event_whenflagclicked", {
      topLevel: true, x: 10, y: 300, next: "ifDynamic"
    }),
    ifDynamic: block("control_if", {
      parent: "flagDynamic",
      inputs: { CONDITION: [2, "eqDynamic"], SUBSTACK: [2, "keptDynamic"] }
    }),
    eqDynamic: block("operator_equals", {
      parent: "ifDynamic",
      inputs: {
        OPERAND1: [3, "readDynamic", [12, "runtimeValue", "runtimeValue"]],
        OPERAND2: [1, [4, "0"]]
      }
    }),
    readDynamic: block("data_variable", {
      parent: "eqDynamic", fields: { VARIABLE: ["runtimeValue", "runtimeValue"] }
    }),
    keptDynamic: block("looks_say", { parent: "ifDynamic" }),

    flagGreater: block("event_whenflagclicked", {
      topLevel: true, x: 10, y: 400, next: "ifGreater"
    }),
    ifGreater: block("control_if", {
      parent: "flagGreater", inputs: { CONDITION: [2, "gtExpr"], SUBSTACK: [2, "keptGreater"] }
    }),
    gtExpr: block("operator_gt", {
      parent: "ifGreater",
      inputs: { OPERAND1: [1, [4, "3"]], OPERAND2: [1, [4, "2"]] }
    }),
    keptGreater: block("looks_say", { parent: "ifGreater" }),

    flagLess: block("event_whenflagclicked", {
      topLevel: true, x: 10, y: 500, next: "ifLess"
    }),
    ifLess: block("control_if_else", {
      parent: "flagLess",
      inputs: {
        CONDITION: [2, "ltExpr"],
        SUBSTACK: [2, "deadLess"],
        SUBSTACK2: [2, "keptNotLess"]
      }
    }),
    ltExpr: block("operator_lt", {
      parent: "ifLess",
      inputs: { OPERAND1: [1, [4, "1"]], OPERAND2: [1, [4, "0"]] }
    }),
    deadLess: block("looks_say", { parent: "ifLess" }),
    keptNotLess: block("looks_say", { parent: "ifLess" })
  };

  return {
    targets: [{
      isStage: false, name: "Sprite1",
      variables: { runtimeValue: ["runtimeValue", 7] },
      lists: {}, broadcasts: {}, blocks, comments: {},
      costumes: [], sounds: [], currentCostume: 0,
      volume: 100, layerOrder: 1, visible: true, x: 0, y: 0,
      size: 100, direction: 90, draggable: false, rotationStyle: "all around"
    }],
    monitors: [], extensions: [], meta: { semver: "3.0.0" }
  };
}

function checkGraph(blocks) {
  for (const [id, blk] of Object.entries(blocks)) {
    for (const [key, entry] of Object.entries(blk.inputs || {})) {
      if (!Array.isArray(entry)) continue;
      for (const child of entry.slice(1)) {
        if (typeof child === "string" && blocks[child]) {
          assert.equal(blocks[child].parent, id, `${id}.${key}: child parent mismatch`);
        }
      }
    }
    if (blk.next && blocks[blk.next]) {
      assert.equal(blocks[blk.next].parent, id, `${id}.next: next parent mismatch`);
    }
  }
}

async function main() {
  const synthetic = SB3.compressProject(projectWithConstantConditions(), new SB3.Options({
    stripDefaults: false, shortenIds: false, renameStores: false,
    removeUnused: false, removeUnreachable: false, compressProcs: false,
    dropObscuredShadows: false, extractDuplicates: false, nearDuplicates: false,
    reuseReporters: false, simplifyIfElse: false, removeNoops: false,
    inlineSingleCall: false, propagateConstants: false, loopDuplicates: false,
    foldConstants: true
  }), () => {});
  const blocks = synthetic.project.targets[0].blocks;
  assert.equal(blocks.flagTrue.next, "keptTrue", "true branch should be spliced into its parent stack");
  assert.equal(blocks.keptTrue.next, "afterTrue", "selected branch must reconnect to the original continuation");
  assert.equal(blocks.flagFalse.next, "keptElse", "false if/else should select its else branch");
  assert.equal(blocks.keptElse.next, "afterFalse", "else branch must reconnect to the original continuation");
  assert.equal(blocks.flagNested.next, "keptNested", "nested NOT/AND constants should fold recursively");
  assert.equal(blocks.ifTrue, undefined);
  assert.equal(blocks.ifFalse, undefined);
  assert.equal(blocks.ifNested, undefined);
  assert.equal(blocks.flagGreater.next, "keptGreater");
  assert.equal(blocks.flagLess.next, "keptNotLess");
  assert.equal(blocks.ifGreater, undefined);
  assert.equal(blocks.ifLess, undefined);
  assert.equal(blocks.eqTrue, undefined);
  assert.equal(blocks.deadThen, undefined);
  assert.equal(blocks.ifDynamic.opcode, "control_if", "dynamic variable conditions must be preserved");
  assert.ok(synthetic.stats.constant_conditions_folded >= 5);
  checkGraph(blocks);

  const fullSynthetic = FullProject.compressProject(projectWithConstantConditions(), new FullProject.Options({
    stripDefaults: false, shortenIds: false, renameStores: false,
    removeUnused: false, removeUnreachable: false, compressProcs: false,
    dropObscuredShadows: false, extractDuplicates: false, nearDuplicates: false,
    reuseReporters: false, simplifyIfElse: false, removeNoops: false,
    inlineSingleCall: false, propagateConstants: false, loopDuplicates: false,
    foldConstants: true
  }), () => {});
  assert.ok(fullSynthetic.stats.constant_conditions_folded >= 5,
    "Full Compressor project pass must apply the same constant-condition rule");
  assert.equal(fullSynthetic.project.targets[0].blocks.ifDynamic.opcode, "control_if");
  checkGraph(fullSynthetic.project.targets[0].blocks);

  // The integration fixture is optional and supplied by the caller. Accept an
  // environment variable or positional argument; never depend on a developer
  // machine-specific absolute path.
  const sb3Path = process.env.GOBOSCRIPT_SB3 || process.argv[2];
  if (sb3Path) {
    assert.ok(fs.existsSync(sb3Path), `Goboscript SB3 fixture does not exist: ${sb3Path}`);
    const zip = await JSZip.loadAsync(fs.readFileSync(sb3Path));
    const source = JSON.parse(await zip.file("project.json").async("string"));
    const before = Buffer.byteLength(JSON.stringify(source));
    const sourceForFull = JSON.parse(JSON.stringify(source));
    const isolate = {
      stripDefaults: false, shortenIds: false, renameStores: false,
      removeUnused: false, removeUnreachable: false, compressProcs: false,
      dropObscuredShadows: false, extractDuplicates: false, nearDuplicates: false,
      reuseReporters: false, simplifyIfElse: false, removeNoops: false,
      inlineSingleCall: false, propagateConstants: false, loopDuplicates: false
    };
    const baseline = SB3.compressProject(JSON.parse(JSON.stringify(sourceForFull)),
      new SB3.Options({ ...isolate, foldConstants: false }), () => {});
    const folded = SB3.compressProject(JSON.parse(JSON.stringify(sourceForFull)),
      new SB3.Options({ ...isolate, foldConstants: true }), () => {});
    const countBlocks = (project) => project.targets.reduce(
      (sum, target) => sum + Object.keys(target.blocks || {}).length, 0);
    const baselineBlocks = countBlocks(baseline.project);
    const foldedBlocks = countBlocks(folded.project);
    assert.equal(baseline.stats.constant_conditions_folded, 0);
    assert.equal(folded.stats.constant_conditions_folded, 1);
    assert.ok(foldedBlocks < baselineBlocks, "foldConstants must remove blocks from the real Goboscript project");
    const foldedAgain = SB3.compressProject(JSON.parse(JSON.stringify(folded.project)),
      new SB3.Options({ ...isolate, foldConstants: true }), () => {});
    assert.equal(foldedAgain.stats.constant_conditions_folded, 0,
      "constant-condition optimization should reach a fixed point");
    assert.equal(JSON.stringify(foldedAgain.project), JSON.stringify(folded.project),
      "second optimization pass should not change the project");

    const originalMain = source.targets.find((target) => target.name === "main");
    const originalBlocks = Object.keys(originalMain.blocks).length;
    const real = SB3.compressProject(source, new SB3.Options({
      extractDuplicates: false, nearDuplicates: false, reuseReporters: false,
      shortenIds: false, renameStores: false
    }), () => {});
    const mainTarget = real.project.targets.find((target) => target.name === "main");
    const after = Buffer.byteLength(JSON.stringify(real.project));
    const finalBlocks = Object.keys(mainTarget.blocks).length;
    const names = new Set(Object.values(mainTarget.variables || {}).map((entry) => entry[0]));
    assert.ok(real.stats.constant_conditions_folded >= 1, "actual Goboscript constant condition was not folded");
    assert.ok(finalBlocks < originalBlocks, "actual Goboscript target did not lose blocks");
    assert.ok(!names.has("unused_helper_return"), "unused Goboscript function return store survived cleanup");
    assert.ok(!names.has("unused_scalar"), "unused Goboscript scalar survived cleanup");
    assert.ok(!Object.values(mainTarget.lists || {}).some((entry) => entry[0] === "unused_list"),
      "unused Goboscript list survived cleanup");
    checkGraph(mainTarget.blocks);

    const fullReal = FullProject.compressProject(sourceForFull,
      new FullProject.Options({
        extractDuplicates: false, nearDuplicates: false, reuseReporters: false,
        shortenIds: false, renameStores: false
      }), () => {});
    const fullMain = fullReal.project.targets.find((target) => target.name === "main");
    assert.ok(fullReal.stats.constant_conditions_folded >= 1,
      "Full Compressor failed to fold the real Goboscript condition");
    assert.equal(Object.keys(fullMain.blocks).length, finalBlocks,
      "project and full engines should produce matching block counts for the same project options");
    assert.equal(fullReal.stats.constant_branch_blocks_removed, real.stats.constant_branch_blocks_removed);

    console.log("actual Goboscript SB3:");
    console.log(JSON.stringify({
      originalMainBlocks: originalBlocks,
      compressedMainBlocks: finalBlocks,
      blocksRemoved: originalBlocks - finalBlocks,
      jsonBytesBefore: before,
      jsonBytesAfter: after,
      jsonBytesSaved: before - after,
      isolatedFoldBlocksBefore: baselineBlocks,
      isolatedFoldBlocksAfter: foldedBlocks,
      isolatedFoldBlocksRemoved: baselineBlocks - foldedBlocks,
      isolatedConditionFolds: folded.stats.constant_conditions_folded,
      isolatedBranchBlocksRemoved: folded.stats.constant_branch_blocks_removed,
      constantConditionsFolded: real.stats.constant_conditions_folded,
      branchBlocksRemoved: real.stats.constant_branch_blocks_removed,
      unusedVariablesRemoved: real.stats.vars_removed,
      unusedListsRemoved: real.stats.lists_removed
    }, null, 2));
  } else {
    console.log("GOBOSCRIPT_SB3 or argv[2] not provided; real-project integration check skipped");
  }

  console.log("goboscript-rules: all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
