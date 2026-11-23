import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engines = [
 ["SB3", require("../../docs/sb3/compressor.js")],
 ["Full", require("../../docs/full/project.js")]
];

function block(opcode, inputs, parent = null) {
 return {opcode, inputs, parent, next: null, topLevel: false, shadow: false};
}

for (const [name, engine] of engines) {
 const comp = new engine.Compressor({});

 const nested = {
 say: block("looks_say", {MESSAGE: [2, "length"]}),
 length: block("operator_length", {STRING: [1, "join"]}, "say"),
 join: block("operator_join", {
 STRING1: [1, [10, "ab"]],
 STRING2: [1, [10, "cd"]]
 }, "length")
 };
 comp._foldNumeric(nested);
 assert.deepEqual(nested.say.inputs.MESSAGE, [1, [4, "4"]], name + ": nested join + length");
 assert.equal("length" in nested, false, name + ": remove folded length");
 assert.equal("join" in nested, false, name + ": remove folded join");

 const letter = {
 say: block("looks_say", {MESSAGE: [2, "letter"]}),
 letter: block("operator_letter_of", {
 LETTER: [1, [4, "2"]],
 STRING: [1, [10, "abc"]]
 }, "say")
 };
 comp._foldNumeric(letter);
 assert.deepEqual(letter.say.inputs.MESSAGE, [1, [10, "b"]], name + ": letter_of");
 assert.equal("letter" in letter, false, name + ": remove folded letter_of");

 const dynamic = {
 say: block("looks_say", {MESSAGE: [2, "join"]}),
 join: block("operator_join", {
 STRING1: [1, "variable"],
 STRING2: [1, [10, "!"]]
 }, "say"),
 variable: block("data_variable", {}, "join")
 };
 comp._foldNumeric(dynamic);
 assert.equal(dynamic.say.inputs.MESSAGE[1], "join", name + ": preserve dynamic input");
 assert.equal(dynamic.join.opcode, "operator_join", name + ": do not fold dynamic input");



 const orphanProject = {targets: [{
 broadcasts: {unusedId: ["unused message"]},
 blocks: {
 hat: {...block("event_whenbroadcastreceived", {}, null), fields: {BROADCAST_OPTION: ["unused message", "unusedId"]}, next: "say"},
 say: block("looks_say", {MESSAGE: [1, [10, "still meaningful"]]}, "hat"),
 root: {...block("event_whenflagclicked", {}, null), topLevel: true}
 }
 }]};
 comp._removeNoopBroadcasts(orphanProject);
 assert.equal("hat" in orphanProject.targets[0].blocks, false, name + ": remove receiver with no sender");
 assert.equal(comp.stats.orphan_receivers_removed, 1, name + ": count orphan receiver");
 comp._removeUnreachable(orphanProject);
 assert.equal("say" in orphanProject.targets[0].blocks, false, name + ": clean orphaned receiver body");

 const dynamicProject = {targets: [{
 broadcasts: {dynamicId: ["dynamic message"]},
 blocks: {
 hat: {...block("event_whenbroadcastreceived", {}, null), fields: {BROADCAST_OPTION: ["dynamic message", "dynamicId"]}, next: "say"},
 say: block("looks_say", {MESSAGE: [1, [10, "keep me"]]}, "hat"),
 send: block("event_broadcast", {BROADCAST_INPUT: [1, "dynamicReporter"]}),
 dynamicReporter: block("operator_join", {
 STRING1: [1, [10, "dynamic"]],
 STRING2: [1, [10, " message"]]
 }, "send")
 }
 }]};
 comp._removeUnreachable(dynamicProject);
 assert.equal("hat" in dynamicProject.targets[0].blocks, true, name + ": preserve dynamic receiver in reachability pass");
 assert.equal("dynamicId" in dynamicProject.targets[0].broadcasts, true, name + ": preserve definitions for dynamic sender");
 comp._removeNoopBroadcasts(dynamicProject);
 assert.equal("hat" in dynamicProject.targets[0].blocks, true, name + ": preserve receiver for dynamic sender");
 assert.equal("send" in dynamicProject.targets[0].blocks, true, name + ": preserve dynamic broadcast");


 const staticBroadcasts = [{
 broadcasts: {
 longId: ["A very long broadcast label"],
 secondId: ["A very long broadcast label"]
 },
 blocks: {
 send: block("event_broadcast", {BROADCAST_INPUT: [1, [11, "A very long broadcast label", "longId"]]})
 }
 }];
 comp.storePlanByTarget = new Map();
 comp._compactBroadcasts(staticBroadcasts);
 assert.notEqual(comp.bcMap.get("longId")[1], "A very long broadcast label",
 name + ": shorten static broadcast label");
 assert.equal(comp.bcMap.get("longId")[1], comp.bcMap.get("secondId")[1],
 name + ": preserve duplicate broadcast-name equivalence");
 assert.equal(comp.stats.broadcast_names_renamed, 1, name + ": count shortened broadcast names");


 const unknownIdBroadcasts = [{
 broadcasts: {knownId: ["A very long broadcast label"]},
 blocks: {
 send: block("event_broadcast", {
 BROADCAST_INPUT: [1, [11, "A very long broadcast label", "missingId"]]
 })
 }
 }];
 comp._compactBroadcasts(unknownIdBroadcasts);
 assert.equal(comp.bcMap.get("knownId")[1], "A very long broadcast label",
 name + ": skip shortening when a broadcast ID is unresolved");

 const noRename = new engine.Compressor({renameStores: false});
 noRename.storePlanByTarget = new Map();
 noRename._compactBroadcasts(staticBroadcasts);
 assert.equal(noRename.bcMap.get("longId")[1], "A very long broadcast label",
 name + ": respect renameStores=false");

 const collision = new engine.Compressor({});
 collision.storePlanByTarget = new Map();
 collision.varMap.set("varId", ["shortVarId", "A"]);
 collision._compactBroadcasts([{
 broadcasts: {longId: ["A very long broadcast label"]},
 blocks: {
 send: block("event_broadcast", {
 BROADCAST_INPUT: [1, [11, "A very long broadcast label", "longId"]]
 })
 }
 }]);
 assert.notEqual(collision.bcMap.get("longId")[1], "A",
 name + ": avoid collision with a variable name");

 const dynamicBroadcasts = [{
 broadcasts: {longId: ["A very long broadcast label"]},
 blocks: {
 send: block("event_broadcast", {BROADCAST_INPUT: [1, "dynamicReporter"]}),
 dynamicReporter: block("operator_join", {
 STRING1: [1, [10, "A very long"]],
 STRING2: [1, [10, " broadcast label"]]
 }, "send")
 }
 }];
 comp._compactBroadcasts(dynamicBroadcasts);
 assert.equal(comp.bcMap.get("longId")[1], "A very long broadcast label",
 name + ": preserve names when sender is dynamic");
 assert.equal(comp.stats.broadcast_names_renamed, 0, name + ": skip name shortening globally");

 const contains = {
 contains: block("operator_contains", {
 STRING1: [1, [10, "Scratch Blocks"]],
 STRING2: [1, [10, "BLOCKS"]]
 })
 };
 assert.equal(comp._constantBooleanBlock(contains, "contains", new Set()), true,
 name + ": case-insensitive contains");

 const commutative = {
 sumAB: block("operator_add", {NUM1: [1, "varA"], NUM2: [1, "varB"]}),
 sumBA: block("operator_add", {NUM1: [1, "varB"], NUM2: [1, "varA"]}),
 varA: {...block("data_variable", {}), fields: {VARIABLE: ["A", "idA"]}},
 varB: {...block("data_variable", {}), fields: {VARIABLE: ["B", "idB"]}}
 };
 assert.equal(
 comp._canonicalBlock(commutative, "sumAB", new Map(), false),
 comp._canonicalBlock(commutative, "sumBA", new Map(), false),
 name + ": commutative reporter signature"
 );

 const ordered = {
 sumAB: block("operator_add", {NUM1: [1, "extA"], NUM2: [1, "extB"]}),
 sumBA: block("operator_add", {NUM1: [1, "extB"], NUM2: [1, "extA"]}),
 extA: {...block("extension_unknown_reporter", {}), fields: {VALUE: ["A", null]}},
 extB: {...block("extension_unknown_reporter", {}), fields: {VALUE: ["B", null]}}
 };
 assert.notEqual(
 comp._canonicalBlock(ordered, "sumAB", new Map(), false),
 comp._canonicalBlock(ordered, "sumBA", new Map(), false),
 name + ": do not reorder unknown reporters"
 );

 for (const [operator, input, expected] of [
 ["sin", "30", Math.sin(Math.PI / 6)],
 ["cos", "60", Math.cos(Math.PI / 3)],
 ["asin", "0.5", 30],
 ["ln", "1", 0],
 ["log", "100", 2],
 ["e ^", "1", Math.E],
 ["10 ^", "2", 100]
 ]) {
 const math = {
 say: block("looks_say", {MESSAGE: [2, "math"]}),
 math: {...block("operator_mathop", {NUM: [1, [4, input]]}, "say"),
 fields: {OPERATOR: [operator, null]}}
 };
 comp._foldNumeric(math);
 assert.ok(Math.abs(Number(math.say.inputs.MESSAGE[1][1]) - expected) < 1e-12,
 name + ": mathop " + operator);
 }
}

console.log("compression proposal constant-folding checks passed");
