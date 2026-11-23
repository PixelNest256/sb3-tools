#!/usr/bin/env node
"use strict";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");
const SB3 = require("../../docs/sb3/compressor.js");
const FullProject = require("../../docs/full/project.js");

function vmConstructor() {
  const candidates = [
    process.env.SCRATCH_VM_MODULE,
    "@scratch/scratch-vm"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) {
      if (candidate === process.env.SCRATCH_VM_MODULE) throw error;
    }
  }
  throw new Error("Scratch VM not found. Install @scratch/scratch-vm or set NODE_PATH / SCRATCH_VM_MODULE.");
}

const VirtualMachine = vmConstructor();

function block(opcode, parent = null, next = null, inputs = {}, fields = {}, topLevel = false) {
  return { opcode, next, parent, inputs, fields, shadow: false, topLevel,
    ...(topLevel ? { x: 10, y: 10 } : {}) };
}

function literal(value, type = 4) {
  return [1, [type, String(value)]];
}

function reporter(opcode, parent, inputs) {
  return block(opcode, parent, null, inputs);
}

function makeProject(condition, { useElse = true } = {}) {
  const blocks = {};
  const hat = "hat";
  const sayThen = "sayThen";
  const sayElse = "sayElse";
  const sayAfter = "sayAfter";
  const after = "after";
  const condId = "condition";
  const control = useElse ? "control_if_else" : "control_if";

  blocks[hat] = block("event_whenflagclicked", null, control, {}, {}, true);
  blocks[control] = block(control, hat, after, {
    CONDITION: [2, condId],
    SUBSTACK: [2, sayThen],
    ...(useElse ? { SUBSTACK2: [2, sayElse] } : {})
  });
  blocks[sayThen] = block("looks_say", control, useElse ? null : sayAfter, {
    MESSAGE: literal("then", 10)
  });
  if (useElse) {
    blocks[sayElse] = block("looks_say", control, sayAfter, {
      MESSAGE: literal("else", 10)
    });
  }
  blocks[sayAfter] = block("looks_say", useElse ? sayElse : sayThen, null, {
    MESSAGE: literal("after", 10)
  });
  blocks[after] = block("looks_say", control, null, {
    MESSAGE: literal("tail", 10)
  });

  const addCondition = (node, parent) => {
    if (typeof node === "boolean" || typeof node === "number" || typeof node === "string") {
      return literal(node, typeof node === "boolean" ? 10 : 4);
    }
    const id = node.id;
    const inputs = {};
    for (const [name, value] of Object.entries(node.inputs)) {
      if (value && typeof value === "object" && value.opcode) {
        const childId = addCondition(value, id);
        inputs[name] = [2, childId];
      } else if (value && typeof value === "object" && "numeric" in value) {
        inputs[name] = literal(value.numeric, value.type);
      } else {
        inputs[name] = literal(value, 4);
      }
    }
    blocks[id] = reporter(node.opcode, parent, inputs);
    return id;
  };
  const condBlock = addCondition(condition, control);
  blocks[control].inputs.CONDITION = [2, condBlock];

  return {
    targets: [
      {
        isStage: true, name: "Stage", variables: {}, lists: {}, broadcasts: {}, blocks: {},
        comments: {}, costumes: [{ name: "blank", assetId: "5cafd5c0be93a7066041f9aa051a208f", dataFormat: "svg", md5ext: "5cafd5c0be93a7066041f9aa051a208f.svg" }], sounds: [], currentCostume: 0, volume: 100, layerOrder: 0, visible: true, rotationStyle: "all around"
      },
      {
        isStage: false, name: "Sprite1",
        variables: {}, lists: {}, broadcasts: {}, blocks, comments: {},
        costumes: [{ name: "blank", assetId: "5cafd5c0be93a7066041f9aa051a208f", dataFormat: "svg", md5ext: "5cafd5c0be93a7066041f9aa051a208f.svg" }], sounds: [], currentCostume: 0, volume: 100, layerOrder: 1,
        visible: true, x: 0, y: 0, size: 100, direction: 90,
        draggable: false, rotationStyle: "all around"
      }
    ],
    monitors: [], extensions: [], meta: { semver: "3.0.0", vm: "0.2.0", agent: "sb3-tools-runtime-test" }
  };
}

function options(foldConstants) {
  return new SB3.Options({
    stripDefaults: false, shortenIds: false, renameStores: false,
    removeUnused: false, removeUnreachable: false, compressProcs: false,
    dropObscuredShadows: false, extractDuplicates: false, nearDuplicates: false,
    reuseReporters: false, simplifyIfElse: false, removeNoops: false,
    inlineSingleCall: false, propagateConstants: false, loopDuplicates: false,
    foldConstants
  });
}

async function execute(project, durationMs = 500) {
  const originalRandom = Math.random;
  let seed = 0x12345678;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const vm = new VirtualMachine();
  const observed = [];
  vm.runtime.on("SAY", (target, type, message) => observed.push([
    target.getName(), type, String(message)
  ]));
  try {
    await new Promise((resolve, reject) => require("scratch-parser")(
      JSON.stringify(project), false, (error, parsed) => error ? reject(error) : resolve(parsed)
    ));
    await vm.loadProject(project);
    vm.greenFlag();
    vm.start();
    await new Promise(resolve => setTimeout(resolve, durationMs));
    vm.quit();
    const targets = vm.runtime.targets;
    const snapshot = {
      say: observed,
      variables: targets.map(target => ({
        name: target.getName(),
        values: Object.fromEntries(Object.entries(target.variables || {})
          .filter(([, variable]) => variable.type !== "list")
          .map(([id, variable]) => [id, variable.value]))
      })),
      lists: targets.map(target => ({
        name: target.getName(),
        values: Object.fromEntries(Object.entries(target.variables || {})
          .filter(([, variable]) => variable.type === "list")
          .map(([id, variable]) => [id, variable.value.slice()]))
      })),
      sprites: targets.map(target => ({
        name: target.getName(), isStage: target.isStage,
        x: target.x, y: target.y, direction: target.direction,
        size: target.size, visible: target.visible, currentCostume: target.currentCostume
      }))
    };
    return snapshot;
  } finally {
    vm.quit();
    Math.random = originalRandom;
  }
}

function deepClone(value) { return JSON.parse(JSON.stringify(value)); }

async function compareCase(name, condition, expected, settings = {}) {
  const source = makeProject(condition, settings);
  const baseline = await execute(deepClone(source));
  const compressed = SB3.compressProject(deepClone(source), options(true), () => {});
  const optimized = await execute(compressed.project);
  if (process.env.DEBUG_VM && JSON.stringify(optimized) !== JSON.stringify(baseline)) {
    console.error("DIFF", name, JSON.stringify({ baseline, optimized, blocks: compressed.project.targets[1].blocks }, null, 2));
  }
  assert.deepEqual(optimized, baseline, name + ": Scratch VM observable state differs after constant folding");
  assert.deepEqual(baseline.say.map((entry) => entry[2]), expected, name + ": unexpected branch execution");
  return { name, folded: compressed.stats.constant_conditions_folded, observed: baseline.say.map(x => x[2]) };
}

async function main() {
  const cases = [
    ["equals-true-if", { id: "eq", opcode: "operator_equals", inputs: { OPERAND1: 4, OPERAND2: 4 } }, ["then", "tail"]],
    ["equals-false-else", { id: "eq", opcode: "operator_equals", inputs: { OPERAND1: 4, OPERAND2: 5 } }, ["else", "after", "tail"]],
    ["greater-than", { id: "gt", opcode: "operator_gt", inputs: { OPERAND1: 9, OPERAND2: 2 } }, ["then", "tail"]],
    ["less-than-false", { id: "lt", opcode: "operator_lt", inputs: { OPERAND1: 3, OPERAND2: 1 } }, ["else", "after", "tail"]],
    ["nested-not-and", { id: "and", opcode: "operator_and", inputs: {
      OPERAND1: { id: "not", opcode: "operator_not", inputs: {
        OPERAND: { id: "eq2", opcode: "operator_equals", inputs: { OPERAND1: 2, OPERAND2: 3 } }
      }},
      OPERAND2: { id: "eq3", opcode: "operator_equals", inputs: { OPERAND1: 9, OPERAND2: 9 } }
    } }, ["then", "tail"]],
    ["nested-or", { id: "or", opcode: "operator_or", inputs: {
      OPERAND1: { id: "eq4", opcode: "operator_equals", inputs: { OPERAND1: 1, OPERAND2: 0 } },
      OPERAND2: { id: "gt2", opcode: "operator_gt", inputs: { OPERAND1: 8, OPERAND2: 3 } }
    } }, ["then", "tail"]],
    ["if-true-no-else", { id: "eqIf", opcode: "operator_equals", inputs: { OPERAND1: 7, OPERAND2: 7 } }, ["then", "after", "tail"], { useElse: false }],
    ["if-false-no-else", { id: "eqIf", opcode: "operator_equals", inputs: { OPERAND1: 7, OPERAND2: 8 } }, ["tail"], { useElse: false }],
    ["dynamic-random-reporter", { id: "eqDynamic", opcode: "operator_equals", inputs: {
      OPERAND1: { id: "random", opcode: "operator_random", inputs: { FROM: 0, TO: 0 } },
      OPERAND2: 0
    } }, ["then", "tail"]]
  ];

  const results = [];
  for (const [name, condition, expected, settings] of cases) {
    results.push(await compareCase(name, condition, expected, settings || {}));
  }

  const edgeCases = [
    ["negative-numbers", -4, -2, false, 4],
    ["decimal-numbers", 1.5, 1.25, false, 5],
    ["positive-integers", 2, 3, false, 6],
    ["signed-integers", -3, -2, false, 7],
    ["angle-literals", 90, 180, false, 8],
    ["zero-equality", 0, -0, true, 4],
    ["numeric-string-coercion", "2", 2, true, 4]
  ];
  for (const [name, left, right, truth, type] of edgeCases) {
    const condition = { id: "edge", opcode: "operator_equals", inputs: {
      OPERAND1: { numeric: left, type }, OPERAND2: { numeric: right, type }
    } };
    const expected = truth ? ["then", "tail"] : ["else", "after", "tail"];
    results.push(await compareCase(name, condition, expected));
  }

  const original = makeProject({ id: "eq5", opcode: "operator_equals", inputs: { OPERAND1: 1, OPERAND2: 1 } });
  const fullResult = FullProject.compressProject(deepClone(original), new FullProject.Options({
    stripDefaults: false, shortenIds: false, renameStores: false,
    removeUnused: false, removeUnreachable: false, compressProcs: false,
    dropObscuredShadows: false, extractDuplicates: false, nearDuplicates: false,
    reuseReporters: false, simplifyIfElse: false, removeNoops: false,
    inlineSingleCall: false, propagateConstants: false, loopDuplicates: false,
    foldConstants: true
  }), () => {});
  const fullBaseline = await execute(deepClone(original));
  const fullOptimized = await execute(fullResult.project);
  assert.deepEqual(fullOptimized, fullBaseline, "Full Compressor: runtime behavior changed");

  let realProject = null;
  const fixturePath = process.env.GOBOSCRIPT_SB3 || process.argv[2];
  if (fixturePath) {
    const zip = await JSZip.loadAsync(fs.readFileSync(fixturePath));
    const projectEntry = zip.file("project.json");
    assert.ok(projectEntry, "SB3 fixture does not contain project.json");
    const fixture = JSON.parse(await projectEntry.async("string"));
    const fixtureCompressed = SB3.compressProject(deepClone(fixture), options(true), () => {});
    const fixtureBaseline = await execute(fixture, 1800);
    const fixtureOptimized = await execute(fixtureCompressed.project, 1800);
    assert.deepEqual(fixtureOptimized, fixtureBaseline, "Goboscript fixture: runtime behavior changed");
    realProject = {
      fixture: path.basename(fixturePath),
      targets: fixture.targets.length,
      folded: fixtureCompressed.stats.constant_conditions_folded,
      runtimeEquivalent: true
    };
  }

  const vmPackage = require(path.resolve(path.dirname(require.resolve("@scratch/scratch-vm")), "../..", "package.json"));
  console.log(JSON.stringify({
    ok: true, vmVersion: vmPackage.version,
    cases: results.length + 1, results, realProject
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
