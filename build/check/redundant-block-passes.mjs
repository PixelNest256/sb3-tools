import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const engines = [
  ["SB3", require("../../docs/sb3/compressor.js")],
  ["Full", require("../../docs/full/project.js")]
];
const b = (opcode, parent = null, next = null, inputs = {}, fields = {}, extra = {}) =>
  ({ opcode, parent, next, inputs, fields, ...extra });

for (const [name, engine] of engines) {
  const comp = new engine.Compressor({});
  assert.equal(comp.options.removeDuplicateAssignments, false, name + ": duplicate pass opt-in");
  assert.equal(comp.options.removeEmptyIfs, false, name + ": empty-if pass opt-in");

  const assignments = {
    hat: b("event_whenflagclicked", null, "a1", {}, {}, { topLevel: true }),
    a1: b("data_setvariableto", "hat", "a2", { VALUE: [1, [4, "7"]] }, { VARIABLE: ["score", "var1"] }),
    a2: b("data_setvariableto", "a1", "a3", { VALUE: [1, [4, "7"]] }, { VARIABLE: ["score", "var1"] }),
    a3: b("data_setvariableto", "a2", "say", { VALUE: [1, [4, "7"]] }, { VARIABLE: ["score", "var1"] }),
    say: b("looks_say", "a3", null, { MESSAGE: [1, [10, "done"]] })
  };
  comp._removeDuplicateAssignments(assignments);
  assert.equal(comp.stats.duplicate_assignments_removed, 2, name + ": remove second and third identical writes");
  assert.equal(assignments.hat.next, "a1", name + ": keep first write");
  assert.equal(assignments.a1.next, "say", name + ": reconnect continuation");
  assert.equal(assignments.say.parent, "a1", name + ": repair continuation parent");
  assert.equal("a2" in assignments, false);
  assert.equal("a3" in assignments, false);

  const unsafeAssignments = {
    x1: b("data_setvariableto", "hat", "x2", { VALUE: [1, [4, "5"]] }, { VARIABLE: ["score", "var1"] }),
    x2: b("data_setvariableto", "x1", "x3", { VALUE: [1, [4, "6"]] }, { VARIABLE: ["score", "var1"] }),
    x3: b("data_setvariableto", "x2", null, { VALUE: [2, "dynamic"] }, { VARIABLE: ["score", "var1"] }),
    dynamic: b("data_variable", "x3", null, {}, { VARIABLE: ["other", "var2"] })
  };
  comp._removeDuplicateAssignments(unsafeAssignments);
  assert.equal(Object.keys(unsafeAssignments).length, 4, name + ": preserve different/dynamic assignments");

  const commentedAssignment = {
    a1: b("data_setvariableto", "hat", "a2", { VALUE: [1, [4, "3"]] }, { VARIABLE: ["score", "var1"] }),
    a2: b("data_setvariableto", "a1", null, { VALUE: [1, [4, "3"]] }, { VARIABLE: ["score", "var1"] })
  };
  comp._removeDuplicateAssignments(commentedAssignment, { note: { blockId: "a2", text: "keep this note" } });
  assert.equal("a2" in commentedAssignment, true, name + ": preserve assignment with attached comment");

  const emptyIf = {
    hat: b("event_whenflagclicked", null, "if1", {}, {}, { topLevel: true }),
    if1: b("control_if", "hat", "after", {
      CONDITION: [2, "eq"],
      SUBSTACK: [2, null]
    }),
    eq: b("operator_equals", "if1", null, {
      OPERAND1: [1, [10, "x"]],
      OPERAND2: [1, [10, "y"]]
    }),
    after: b("looks_say", "if1", null, { MESSAGE: [1, [10, "after"]] })
  };
  comp._removeEmptyIfs(emptyIf);
  assert.equal(comp.stats.empty_ifs_removed, 1, name + ": remove pure empty if");

  const hiddenSubstack = {
    hat: b("event_whenflagclicked", null, "if1", {}, {}, { topLevel: true }),
    if1: b("control_if", "hat", null, {
      CONDITION: [1, [10, ""]],
      SUBSTACK: [3, null, "body"]
    }),
    body: b("looks_say", "if1", null, { MESSAGE: [1, [10, "must stay"]] })
  };
  comp._removeEmptyIfs(hiddenSubstack);
  assert.equal("if1" in hiddenSubstack, true, name + ": preserve hidden substack references");
  assert.equal("if1" in emptyIf, false);
  assert.equal("eq" in emptyIf, false);
  assert.equal(emptyIf.hat.next, "after", name + ": splice continuation");
  assert.equal(emptyIf.after.parent, "hat", name + ": repair continuation parent");

  const commentedIf = {
    hat: b("event_whenflagclicked", null, "if1", {}, {}, { topLevel: true }),
    if1: b("control_if", "hat", "after", { CONDITION: [2, "eq"], SUBSTACK: [2, null] }),
    eq: b("operator_equals", "if1", null, {
      OPERAND1: [1, [10, "a"]], OPERAND2: [1, [10, "b"]]
    }),
    after: b("looks_say", "if1", null, { MESSAGE: [1, [10, "after"]] })
  };
  comp._removeEmptyIfs(commentedIf, { note: { blockId: "if1", text: "keep this note" } });
  assert.equal("if1" in commentedIf, true, name + ": preserve empty if with attached comment");

  const variableCondition = {
    hat: b("event_whenflagclicked", null, "if1", {}, {}, { topLevel: true }),
    if1: b("control_if", "hat", "after", {
      CONDITION: [2, "eq"],
      SUBSTACK: [2, null]
    }),
    eq: b("operator_equals", "if1", null, {
      OPERAND1: [2, [12, "mode", "var-mode"]],
      OPERAND2: [1, [10, "active"]]
    }),
    after: b("looks_say", "if1", null, { MESSAGE: [1, [10, "after"]] })
  };
  comp._removeEmptyIfs(variableCondition);
  assert.equal("if1" in variableCondition, false, name + ": allow read-only variable primitives");

  const listCondition = {
    hat: b("event_whenflagclicked", null, "if1", {}, {}, { topLevel: true }),
    if1: b("control_if", "hat", null, {
      CONDITION: [2, "eq"],
      SUBSTACK: [2, null]
    }),
    eq: b("operator_equals", "if1", null, {
      OPERAND1: [2, [13, "items", "list-items"]],
      OPERAND2: [1, [10, "active"]]
    })
  };
  comp._removeEmptyIfs(listCondition);
  assert.equal("if1" in listCondition, false, name + ": allow read-only list primitives");

  const unsafeIf = {
    hat: b("event_whenflagclicked", null, "badIf", {}, {}, { topLevel: true }),
    badIf: b("control_if", "hat", "after", { CONDITION: [2, "unknown"], SUBSTACK: [2, null] }),
    unknown: b("extension_unknown_reporter", "badIf", null, {}),
    after: b("looks_say", "badIf", null, { MESSAGE: [1, [10, "keep"]] })
  };
  comp._removeEmptyIfs(unsafeIf);
  assert.equal("badIf" in unsafeIf, true, name + ": preserve unknown reporter condition");

  const sharedIf = {
    hat: b("event_whenflagclicked", null, "sharedIf", {}, {}, { topLevel: true }),
    sharedIf: b("control_if", "hat", "after", { CONDITION: [2, "shared"], SUBSTACK: [2, null] }),
    shared: b("operator_not", "sharedIf", null, { OPERAND: [1, [10, ""]] }),
    other: b("looks_say", null, null, { MESSAGE: [2, "shared"] }, {}, { topLevel: true }),
    after: b("looks_say", "sharedIf", null, { MESSAGE: [1, [10, "keep"]] })
  };
  comp._removeEmptyIfs(sharedIf);
  assert.equal("sharedIf" in sharedIf, true, name + ": preserve shared reporter");

  const nonEmptyIf = {
    hat: b("event_whenflagclicked", null, "if1", {}, {}, { topLevel: true }),
    if1: b("control_if", "hat", null, {
      CONDITION: [2, "eq"],
      SUBSTACK: [2, "body"]
    }),
    eq: b("operator_equals", "if1", null, {
      OPERAND1: [1, [10, "a"]], OPERAND2: [1, [10, "b"]]
    }),
    body: b("looks_say", "if1", null, { MESSAGE: [1, [10, "body"]] })
  };
  comp._removeEmptyIfs(nonEmptyIf);
  assert.equal("if1" in nonEmptyIf, true, name + ": preserve non-empty if");

  const topLevelIf = {
    if1: b("control_if", null, "after", {
      CONDITION: [1, [10, ""]],
      SUBSTACK: [2, null]
    }, {}, { topLevel: true, x: 12, y: 34 }),
    after: b("looks_say", "if1", null, { MESSAGE: [1, [10, "next"]] })
  };
  comp._removeEmptyIfs(topLevelIf);
  assert.equal("if1" in topLevelIf, false, name + ": remove top-level empty if");
  assert.equal(topLevelIf.after.parent, null);
  assert.equal(topLevelIf.after.topLevel, true);
  assert.equal(topLevelIf.after.x, 12);
  assert.equal(topLevelIf.after.y, 34);

  const integrationBlocks = {
    hat: b("event_whenflagclicked", null, "a1", {}, {}, { topLevel: true }),
    a1: b("data_setvariableto", "hat", "a2", { VALUE: [1, [4, "9"]] }, { VARIABLE: ["score", "var1"] }),
    a2: b("data_setvariableto", "a1", "if1", { VALUE: [1, [4, "9"]] }, { VARIABLE: ["score", "var1"] }),
    if1: b("control_if", "a2", "after", {
      CONDITION: [2, "eq"], SUBSTACK: [2, null]
    }),
    eq: b("operator_equals", "if1", null, {
      OPERAND1: [1, [10, "a"]], OPERAND2: [1, [10, "b"]]
    }),
    after: b("looks_say", "if1", null, { MESSAGE: [1, [10, "after"]] })
  };
  const integrationProject = {
    targets: [{
      isStage: false, name: "Sprite1", variables: { var1: ["score", 0] },
      lists: {}, broadcasts: {}, blocks: integrationBlocks, comments: {},
      currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0,
      visible: true, x: 0, y: 0, size: 100, direction: 90,
      draggable: false, rotationStyle: "all around"
    }],
    monitors: [], extensions: [], meta: { semver: "3.0.0" }
  };
  const off = Object.fromEntries(Object.keys(new engine.Options({})).map((key) => [key, false]));
  off.removeDuplicateAssignments = true;
  off.removeEmptyIfs = true;
  const integrated = engine.compressProject(integrationProject, new engine.Options(off), () => {});
  const ib = integrated.project.targets[0].blocks;
  assert.equal(integrated.stats.duplicate_assignments_removed, 1, name + ": run() invokes duplicate pass");
  assert.equal(integrated.stats.empty_ifs_removed, 1, name + ": run() invokes empty-if pass");
  assert.equal(ib.hat.next, "a1", name + ": integrated stack keeps first setter");
  assert.equal(ib.a1.next, "after", name + ": integrated passes preserve stack continuation");
  assert.equal(ib.after.parent, "a1", name + ": integrated passes repair parent link");
}
console.log("redundant-block-passes: all checks passed for SB3 and Full engines");
