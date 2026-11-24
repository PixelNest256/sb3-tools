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
 // Store-name shortening must update every ID/name reference and respect
 // sensing_of name-only lookups, including dynamic OBJECT reporters.
 const stage = {isStage:true,name:"Stage",variables:{SD:["A",0],S1:["stageLongName",0]},lists:{},blocks:{},broadcasts:{}};
 const spriteA = {isStage:false,name:"SpriteA",variables:{A1:["staticLongName",0],DUP:["A",0],U1:["unrelatedLongName",0],M1:["monitoredLongName",0]},lists:{L1:["longListName",[]],L2:["monitoredListName",[]]},blocks:{write:{...block("data_setvariableto",{}),fields:{VARIABLE:["staticLongName","A1"]}},read:{...block("data_variable",{}),fields:{VARIABLE:["staticLongName","A1"]}},listWrite:{...block("data_addtolist",{}),fields:{LIST:["longListName","L1"]}},say:{...block("looks_say",{MESSAGE:[1,[12,"staticLongName","A1"]]})},listRead:{...block("looks_say",{MESSAGE:[1,[13,"longListName","L1"]]})}},broadcasts:{}};
 const spriteB = {isStage:false,name:"SpriteB",variables:{DUP:["A",0],M1:["otherMonitoredLongName",0]},lists:{L2:["otherMonitoredListName",[]]},blocks:{},broadcasts:{}};
 const stageReader = {isStage:false,name:"StageReader",variables:{},lists:{},blocks:{of:{...block("sensing_of",{OBJECT:[1,"menu"]}),fields:{PROPERTY:["stageLongName",null]}},menu:{...block("sensing_of_object_menu",{}),shadow:true,fields:{OBJECT:["_stage_",null]}}},broadcasts:{}};
 const staticReader = {isStage:false,name:"StaticReader",variables:{},lists:{},blocks:{of:{...block("sensing_of",{OBJECT:[1,"menu"]}),fields:{PROPERTY:["staticLongName",null]}},menu:{...block("sensing_of_object_menu",{}),shadow:true,fields:{OBJECT:["SpriteA",null]}}},broadcasts:{}};
 const dynamicReader = {isStage:false,name:"DynamicReader",variables:{},lists:{},blocks:{of:{...block("sensing_of",{OBJECT:[3,"AReporter","menu"]}),fields:{PROPERTY:["A",null]}},AReporter:block("operator_join",{STRING1:[1,[10,"SpriteA"]],STRING2:[1,[10,""]]}),menu:{...block("sensing_of_object_menu",{}),shadow:true,fields:{OBJECT:["SpriteA",null]}}},broadcasts:{}};
 const storeTargets = [stage,spriteA,spriteB,staticReader,stageReader,dynamicReader];
 const storeComp = new engine.Compressor({shortenIds:true,renameStores:true,removeUnused:false});
 storeComp.stageName = "Stage";
 const storeMonitors = [{id:"M1",opcode:"data_variable",params:{VARIABLE:"monitoredLongName"},spriteName:"SpriteA",visible:true},{id:"L2",opcode:"data_listcontents",params:{LIST:"monitoredListName"},spriteName:"SpriteA",visible:true},{id:"S1",opcode:"data_variable",params:{VARIABLE:"stageLongName"},spriteName:null,visible:true}];
 storeComp._collectMonitorStores(storeTargets,storeMonitors,false);
 storeComp._planStoreMappings(storeTargets,null,null);
 const stageMap = storeComp.storePlanByTarget.get(stage).varMap;
 const mapA = storeComp.storePlanByTarget.get(spriteA).varMap;
 const mapB = storeComp.storePlanByTarget.get(spriteB).varMap;
 const staticMap = mapA.get("A1");
 const monitorMap = mapA.get("M1");
 const monitorMapB = mapB.get("M1");
 const dynamicMapA = mapA.get("DUP");
 const dynamicMapB = mapB.get("DUP");
 const listMap = storeComp.storePlanByTarget.get(spriteA).listMap.get("L1");
 const monitorListMap = storeComp.storePlanByTarget.get(spriteA).listMap.get("L2");
 const monitorListMapB = storeComp.storePlanByTarget.get(spriteB).listMap.get("L2");
 assert.notEqual(staticMap[1],"staticLongName",name+": shorten ordinary variable names");
 assert.equal(monitorMap[0],"M1",name+": preserve monitor store ID");
 assert.notEqual(monitorMap[1],"monitoredLongName",name+": shorten monitored variable name");
 assert.notEqual(monitorMap[1],monitorMapB[1],name+": monitor mapping must be scoped when local IDs are reused");
 assert.equal(monitorListMap[0],"L2",name+": preserve list monitor ID");
 assert.notEqual(monitorListMap[1],"monitoredListName",name+": shorten monitored list name");
 assert.notEqual(monitorListMap[1],monitorListMapB[1],name+": list monitor mapping must be scoped when local IDs are reused");
 assert.equal(stageMap.get("SD")[1],"A",name+": keep dynamic sensing_of property name on Stage");
 assert.equal(dynamicMapA[1],"A",name+": keep dynamic sensing_of property name on first sprite");
 assert.equal(dynamicMapB[1],"A",name+": keep dynamic sensing_of property name on every possible sprite");
 assert.notEqual(dynamicMapA[0],"DUP",name+": shorten internal ID even when its name must stay");
 assert.notEqual(dynamicMapA[0],dynamicMapB[0],name+": do not collide reused local IDs across targets");
 assert.notEqual(mapA.get("U1")[1],"unrelatedLongName",name+": continue shortening unrelated names");
 assert.notEqual(mapA.get("U1")[1],"A",name+": generated names must not collide with a dynamic sensing_of property name");
 assert.notEqual(listMap[1],"longListName",name+": shorten list names");
 storeComp._renameBlocks(spriteA.blocks,spriteA);
 storeComp._renameBlocks(staticReader.blocks,staticReader);
 storeComp._renameBlocks(stageReader.blocks,stageReader);
 storeComp._renameBlocks(dynamicReader.blocks,dynamicReader);
 storeComp._renameStores(storeTargets);
 storeComp._processMonitors({monitors:storeMonitors});
 assert.deepEqual(spriteA.blocks.write.fields.VARIABLE,[staticMap[1],staticMap[0]],name+": rewrite variable writer field");
 assert.deepEqual(spriteA.blocks.read.fields.VARIABLE,[staticMap[1],staticMap[0]],name+": rewrite variable reporter field");
 assert.deepEqual(spriteA.blocks.say.inputs.MESSAGE[1], [12,staticMap[1],staticMap[0]],name+": rewrite variable primitive input");
 assert.deepEqual(spriteA.blocks.listWrite.fields.LIST,[listMap[1],listMap[0]],name+": rewrite list writer field");
 assert.deepEqual(spriteA.blocks.listRead.inputs.MESSAGE[1], [13,listMap[1],listMap[0]],name+": rewrite list primitive input");
 assert.equal(staticReader.blocks.of.fields.PROPERTY[0],staticMap[1],name+": rewrite static sensing_of PROPERTY");
 assert.equal(stageReader.blocks.of.fields.PROPERTY[0],stageMap.get("S1")[1],name+": rewrite static Stage sensing_of PROPERTY");
 assert.equal(dynamicReader.blocks.of.fields.PROPERTY[0],"A",name+": preserve dynamic sensing_of PROPERTY");
 assert.ok(spriteA.variables[staticMap[0]],name+": store table uses the new variable ID");
 assert.ok(spriteA.variables.M1 && spriteA.variables.M1[0] === monitorMap[1],name+": monitor store name follows its mapping");
 assert.equal(storeMonitors[0].id,"M1",name+": variable monitor ID remains valid");
 assert.equal(storeMonitors[0].params.VARIABLE,monitorMap[1],name+": variable monitor name follows renamed store");
 assert.ok(spriteA.lists.L2 && spriteA.lists.L2[0] === monitorListMap[1],name+": list monitor store name follows its mapping");
 assert.ok(spriteB.variables.M1 && spriteB.variables.M1[0] === monitorMapB[1],name+": reused variable ID keeps the other sprite mapping");
 assert.ok(spriteB.lists.L2 && spriteB.lists.L2[0] === monitorListMapB[1],name+": reused list ID keeps the other sprite mapping");
 assert.equal(storeMonitors[1].id,"L2",name+": list monitor ID remains valid");
 assert.equal(storeMonitors[1].params.LIST,monitorListMap[1],name+": list monitor name follows renamed store");
 assert.equal(stageMap.get("S1")[0],"S1",name+": Stage monitor ID remains stable");
 assert.equal(storeMonitors[2].params.VARIABLE,stageMap.get("S1")[1],name+": Stage monitor name follows renamed store");
 assert.ok(spriteA.lists[listMap[0]],name+": list table uses the new list ID");

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
