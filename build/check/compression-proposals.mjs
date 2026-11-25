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
 assert.equal(new engine.Options({}).aggressiveFoldConstants,false,name+": approximate folding is off by default");
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

 // Max removes hidden monitors and their stores while retaining visible
 // monitor stores; renameStores must still shorten the surviving names.
 const monitorCleanupProject = {
  targets:[{isStage:false,name:"MonitorCleanup",variables:{hiddenVar:["hiddenVariableName",1],visibleVar:["visibleVariableName",2],usedVar:["usedVariableName",0]},lists:{hiddenList:["hiddenListName",["h"]],visibleList:["visibleListName",["v"]]},broadcasts:{},blocks:{flag:{...block("event_whenflagclicked",{}),topLevel:true}},comments:{},currentCostume:0,costumes:[],sounds:[]}],
  monitors:[
   {id:"hiddenVar",opcode:"data_variable",params:{VARIABLE:"hiddenVariableName"},spriteName:"MonitorCleanup",visible:false},
   {id:"hiddenList",opcode:"data_listcontents",params:{LIST:"hiddenListName"},spriteName:"MonitorCleanup",visible:false},
   {id:"visibleVar",opcode:"data_variable",params:{VARIABLE:"visibleVariableName"},spriteName:"MonitorCleanup",visible:true},
   {id:"visibleList",opcode:"data_listcontents",params:{LIST:"visibleListName"},spriteName:"MonitorCleanup",visible:true}
  ],extensions:[],meta:{semver:"3.0.0"}
 };
 const monitorCleanup = engine.compressProject(monitorCleanupProject,
  new engine.Options({renameStores:true,removeMonitors:true,removeUnused:true}),()=>{});
 const monitorTarget = monitorCleanup.project.targets[0];
 assert.equal(monitorCleanup.project.monitors.length,2,name+": remove hidden monitors but keep visible monitors");
 assert.ok(!Object.values(monitorTarget.variables||{}).some(v=>v[0]==="hiddenVariableName"),name+": hidden monitor must not keep its variable store");
 assert.ok(!Object.values(monitorTarget.lists||{}).some(v=>v[0]==="hiddenListName"),name+": hidden monitor must not keep its list store");
 for(const mon of monitorCleanup.project.monitors){
  const isVar=mon.opcode==="data_variable",table=isVar?monitorTarget.variables:monitorTarget.lists,key=isVar?"VARIABLE":"LIST";
  const original=isVar?"visibleVariableName":"visibleListName";
  assert.ok(table[mon.id],name+": visible monitor store is retained");
  assert.equal(table[mon.id][0],mon.params[key],name+": visible monitor name matches its store");
  assert.notEqual(mon.params[key],original,name+": visible monitor store name is shortened");
 }

 const nested = {
 say: block("looks_say", {MESSAGE: [2, "length"]}),
 length: block("operator_length", {STRING: [1, "join"]}, "say"),
 join: block("operator_join", {
 STRING1: [1, [10, "ab"]],
 STRING2: [1, [10, "cd"]]
 }, "length")
 };
 const nestedBeforeSize = JSON.stringify(nested).length;
 comp._foldNumeric(nested);
 assert.ok(JSON.stringify(nested).length < nestedBeforeSize, name + ": constant folding must reduce serialized block JSON");
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
 assert.equal(comp.bcMap.get("longId")[1], "A very long broadcast label",
 name + ": preserve broadcast display labels while shortening IDs");
 assert.notEqual(comp.bcMap.get("longId")[0], "longId", name + ": still shorten broadcast IDs");
 assert.equal(comp.bcMap.get("longId")[1], comp.bcMap.get("secondId")[1],
 name + ": preserve duplicate broadcast-name equivalence");
 assert.equal(comp.stats.broadcast_names_renamed, 0, name + ": do not shorten broadcast display labels");


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
 assert.equal(collision.bcMap.get("longId")[1], "A very long broadcast label",
 name + ": preserve broadcast label regardless of variable names");

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
 ["ln", "1", 0],
 ["log", "100", 2],
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
 const asinBlocks={say:block("looks_say",{MESSAGE:[3,"asin",[10,""]]}),asin:{...block("operator_mathop",{NUM:[1,[4,"0.5"]]},"say"),fields:{OPERATOR:["asin",null]}}};
 comp._foldNumeric(asinBlocks);
 assert.ok(asinBlocks.asin,name+": skip long decimal mathop result by default");
 const aggressiveMathComp=new engine.Compressor({aggressiveFoldConstants:true});
 const eBlocks={say:block("looks_say",{MESSAGE:[3,"e",[10,""]]}),e:{...block("operator_mathop",{NUM:[1,[4,"1"]]},"say"),fields:{OPERATOR:["e ^",null]}}};
 aggressiveMathComp._foldNumeric(eBlocks);
 assert.ok(!eBlocks.e,name+": aggressive mode folds long e^x result");
 aggressiveMathComp._foldNumeric(asinBlocks);
 assert.ok(!asinBlocks.asin,name+": fold long decimal mathop result in aggressive mode");

 const decimalBlocks={say:{...block("looks_say",{MESSAGE:[3,"sum",[10,""]]})},sum:block("operator_add",{NUM1:[3,"third",[10,""]],NUM2:[3,"five",[10,""]]},"say"),third:block("operator_divide",{NUM1:[1,[4,"1"]],NUM2:[1,[4,"3"]]},"sum"),five:block("operator_add",{NUM1:[1,[4,"2"]],NUM2:[1,[4,"3"]]},"sum")};
 comp._foldNumeric(decimalBlocks);
 assert.ok(decimalBlocks.third,name+": skip only the non-terminating decimal subexpression");
 assert.deepEqual(decimalBlocks.sum.inputs.NUM2,[1,[4,"5"]],name+": still fold an independent exact subexpression");
 const aggressiveDecimalComp=new engine.Compressor({aggressiveFoldConstants:true});
 aggressiveDecimalComp._foldNumeric(decimalBlocks);
 assert.ok(!decimalBlocks.third,name+": aggressive mode continues folding the repeating decimal");

 // Variable-dependent multiplicative chains should collapse only when the
 // resulting coefficient is short enough for the conservative mode.
 const factorBlocks = {
 say: block("looks_say", {MESSAGE:[3,"outer",[10,""]]}),
 outer: block("operator_multiply", {NUM1:[3,"inner",[10,""]],NUM2:[1,[4,"3"]]}, "say"),
 inner: block("operator_divide", {NUM1:[3,"variable",[10,""]],NUM2:[1,[4,"2"]]}, "outer"),
 variable: block("data_variable", {}, "inner")
 };
 const factorBeforeSize = JSON.stringify(factorBlocks).length;
 comp._foldNumericFactors(factorBlocks);
 assert.ok(JSON.stringify(factorBlocks).length < factorBeforeSize, name + ": factor folding must reduce serialized block JSON");
 assert.equal(factorBlocks.outer.inputs.NUM1[1],"variable",name+": combine ((x / 2) * 3)");
 assert.equal(factorBlocks.outer.inputs.NUM2[1][1],"1.5",name+": exact short coefficient");
 assert.ok(!factorBlocks.inner,name+": remove the now-redundant intermediate reporter");
 const pipelineProject={targets:[{isStage:true,name:"Stage",variables:{x:["x",4]},lists:{},broadcasts:{},blocks:{
 hat:{...block("event_whenflagclicked",{}),topLevel:true,next:"say"},
 say:{...block("looks_say",{MESSAGE:[3,"outer",[10,""]]},"hat"),next:null},
 outer:block("operator_multiply",{NUM1:[3,"inner",[10,""]],NUM2:[1,[4,"3"]]},"say"),
 inner:block("operator_divide",{NUM1:[3,"variable",[10,""]],NUM2:[1,[4,"2"]]},"outer"),
 variable:block("sensing_answer",{},"inner")
 },comments:{},costumes:[],sounds:[],currentCostume:0}] ,monitors:[],extensions:[],meta:{}};
 const pipelineResult=engine.compressProject(JSON.parse(JSON.stringify(pipelineProject)),new engine.Options({foldConstants:true,aggressiveFoldConstants:false,removeUnused:false}));
 const pipelineBlocks=pipelineResult.project.targets[0].blocks;
 assert.ok(Object.values(pipelineBlocks).some(b=>b.opcode==="operator_multiply"&&b.inputs&&b.inputs.NUM2&&b.inputs.NUM2[1][1]==="1.5"),name+": factor folding runs through compressProject pipeline");
 assert.equal(Object.values(pipelineBlocks).filter(b=>b.opcode==="operator_divide").length,0,name+": pipeline removes the intermediate arithmetic reporter");
 assert.ok(pipelineResult.stats.const_values_folded>=1,name+": pipeline records algebraic folding");
 const disabledPipeline=engine.compressProject(JSON.parse(JSON.stringify(pipelineProject)),new engine.Options({foldConstants:false,aggressiveFoldConstants:true,removeUnused:false}));
 assert.equal(Object.values(disabledPipeline.project.targets[0].blocks).filter(b=>b.opcode==="operator_divide").length,1,name+": aggressive option cannot run when constant folding is disabled");



 const negativeZero = {
 say:block("looks_say",{MESSAGE:[3,"outer",[10,""]]}),
 outer:block("operator_multiply",{NUM1:[3,"inner",[10,""]],NUM2:[1,[4,"-0"]]},"say"),
 inner:block("operator_divide",{NUM1:[3,"variable",[10,""]],NUM2:[1,[4,"2"]]},"outer"),
 variable:block("data_variable",{},"inner")
 };
 comp._foldNumericFactors(negativeZero);
 assert.equal(negativeZero.outer.inputs.NUM2[1][1],"-0",name+": preserve negative zero in coefficients");
 assert.ok(!negativeZero.inner,name+": negative-zero coefficient chain is folded");

 const repeating = {
 say: block("looks_say", {MESSAGE:[3,"outer",[10,""]]}),
 outer: block("operator_multiply", {NUM1:[3,"inner",[10,""]],NUM2:[1,[4,"2"]]}, "say"),
 inner: block("operator_divide", {NUM1:[3,"variable",[10,""]],NUM2:[1,[4,"3"]]}, "outer"),
 variable: block("data_variable", {}, "inner")
 };
 comp._foldNumericFactors(repeating);
 assert.ok(repeating.inner,name+": skip long repeating coefficients by default");
 const riskyComp = new engine.Compressor({aggressiveFoldConstants:true});
 riskyComp._foldNumericFactors(repeating);
 assert.ok(!repeating.inner,name+": permit long coefficient only in aggressive mode");
 assert.equal(Number(repeating.outer.inputs.NUM2[1][1]),2/3,name+": aggressive coefficient value");

 // Scratch comparison and boolean primitives fold in ordinary reporter inputs.
 const compareBlocks = {
 say:block("looks_say",{MESSAGE:[3,"eq",[10,""]]}),
 eq:block("operator_equals",{OPERAND1:[1,[10,"A"]],OPERAND2:[1,[10,"a"]]},"say")
 };
 comp._foldNumeric(compareBlocks);
 assert.ok(compareBlocks.eq,name+": preserve boolean reporter type in string contexts");
 assert.equal(comp._constantBooleanBlock(compareBlocks,"eq",new Set()),true,name+": case-insensitive Scratch equality is available to conditional folding");
 const notBlocks={say:block("looks_say",{MESSAGE:[3,"not",[10,""]]}),not:block("operator_not",{OPERAND:[1,[10,"0"]]},"say")};
 comp._foldNumeric(notBlocks);
 assert.ok(notBlocks.not,name+": preserve boolean reporter type in string contexts");
 assert.equal(comp._constantBooleanBlock(notBlocks,"not",new Set()),true,name+": Scratch not(false) evaluates true in conditions");
 const conditionBlocks={hat:{...block("event_whenflagclicked",{}),topLevel:true,next:"if"},if:block("control_if",{CONDITION:[2,"cond"]},"hat"),cond:block("operator_equals",{OPERAND1:[1,[10,"A"]],OPERAND2:[1,[10,"a"]]},"if")};
 comp._foldNumeric(conditionBlocks);
 assert.ok(conditionBlocks.cond,name+": keep boolean condition reporter as a typed block");
 assert.equal(comp._constantBooleanBlock(conditionBlocks,"cond",new Set()),true,name+": fold string comparison conditions safely");

 // A second reference prevents deleting a shared intermediate block.
 const shared = {
 say: block("looks_say", {MESSAGE:[3,"outer",[10,""]]}),
 outer: block("operator_multiply", {NUM1:[3,"inner",[10,""]],NUM2:[1,[4,"3"]]}, "say"),
 inner: block("operator_divide", {NUM1:[3,"variable",[10,""]],NUM2:[1,[4,"2"]]}, "outer"),
 variable: block("data_variable", {}, "inner"),
 other: block("looks_say", {MESSAGE:[3,"inner",[10,""]]})
 };
 comp._foldNumericFactors(shared);
 assert.ok(shared.inner,name+": keep shared intermediate reporter");

 const sharedBase = {
 say:block("looks_say",{MESSAGE:[3,"outer",[10,""]]}),
 outer:block("operator_multiply",{NUM1:[3,"inner",[10,""]],NUM2:[1,[4,"3"]]},"say"),
 inner:block("operator_divide",{NUM1:[3,"variable",[10,""]],NUM2:[1,[4,"2"]]},"outer"),
 variable:block("data_variable",{},"inner"),
 other:block("looks_say",{MESSAGE:[3,"variable",[10,""]]})
 };
 comp._foldNumericFactors(sharedBase);
 assert.ok(sharedBase.inner,name+": preserve a base reporter shared by another script");

 const reachComp = new engine.Compressor({});
 const reachProject = {targets:[{blocks:{
 hat:{...block("event_whenflagclicked",{}),topLevel:true,next:"loose"},
 say:{...block("looks_say",{MESSAGE:[3,"used",[10,""]]},"loose"),next:"say2"},
 say2:block("looks_say",{MESSAGE:[3,"shared",[10,""]]},"say"),
 used:{...block("operator_add",{NUM1:[1,[4,"1"]],NUM2:[1,[4,"2"]]}),topLevel:true},
 floating:{...block("operator_add",{NUM1:[3,"innerFloat",[10,""]],NUM2:[1,[4,"4"]]}),topLevel:true},
 deadStack:{...block("looks_say",{MESSAGE:[3,"deadNested",[10,""]]}),topLevel:true},
 deadNested:block("operator_add",{NUM1:[3,"deadLeaf",[10,""]],NUM2:[1,[4,"2"]]},"deadStack"),
 deadLeaf:block("sensing_answer",{},"deadNested"),
 innerFloat:block("operator_multiply",{NUM1:[3,"varFloat",[10,""]],NUM2:[1,[4,"2"]]},"floating"),
 varFloat:block("data_variable",{},"innerFloat"),
 floatingShared:{...block("operator_add",{NUM1:[3,"shared",[10,""]],NUM2:[1,[4,"4"]]}),topLevel:true},
 shared:block("data_variable",{},"floatingShared"),
 loose:{...block("looks_say",{MESSAGE:[1,[10,"standalone stack"]]}),topLevel:true,next:"say"}
 },comments:{floatingComment:{blockId:"floating",text:"orphan",x:0,y:0,width:100,height:40,minimized:false}}}]};
 reachComp._removeUnreachable(reachProject);
 const remaining=reachProject.targets[0].blocks;
 assert.ok(remaining.used,name+": keep referenced top-level reporter");
 assert.ok(!remaining.floating && !remaining.innerFloat && !remaining.varFloat,name+": remove detached reporter island and nested children");
 assert.ok(!remaining.deadStack && !remaining.deadNested && !remaining.deadLeaf,name+": remove reporter islands orphaned by a deleted parent stack");
 assert.ok(!reachProject.targets[0].comments.floatingComment,name+": remove comments attached to deleted reporter islands");
 assert.ok(remaining.floatingShared && remaining.shared,name+": preserve a reporter island with a child shared by a live script");
 assert.ok(remaining.loose,name+": never delete a standalone stack command");

}

console.log("compression proposal constant-folding checks passed");
