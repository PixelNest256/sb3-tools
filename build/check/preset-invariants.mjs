#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const excluded = [
  "extractDuplicates",
  "nearDuplicates",
  "loopDuplicates",
  "reuseReporters"
].sort();

function loadPresets(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const match = source.match(/var PRESETS = (\(function \(\) \{[\s\S]*?\}\)\(\));/);
  assert.ok(match, relativePath + ": PRESETS initializer not found");
  return JSON.parse(JSON.stringify(vm.runInNewContext(match[1])));
}

for (const app of ["docs/sb3/app.js", "docs/full/app.js"]) {
 const source = fs.readFileSync(path.join(root, app), "utf8");
  const presets = loadPresets(app);
  assert.deepEqual(presets.map(p => p.id), ["clean", "safe", "cleanup", "optimize", "speed", "max"], app + ": preset order");
  const optimize = presets.find(p => p.id === "optimize").keys.slice().sort();
  const speed = presets.find(p => p.id === "speed").keys.slice().sort();
  const max = presets.find(p => p.id === "max").keys.slice().sort();
 assert.ok(max.includes("renameStores"), app + ": Maximum should shorten variable and list names");
 if (app === "docs/sb3/app.js") {
 assert.match(source, /renameStores:\s*true/, app + ": variable and list name shortening should be enabled by default");
 } else {
 assert.ok(source.includes("\"stripDefaults\", \"shortenIds\", \"renameStores\"") &&
 source.includes("PROJECT_KEYS.forEach(function (key) { out[key] = true; })"),
 app + ": variable and list name shortening should be enabled by default");
 }
  assert.deepEqual(speed, max.filter(key => !excluded.includes(key) && !["removeDuplicateAssignments", "removeEmptyIfs", "counterLoopToForEach"].includes(key)).sort(), app + ": Speed excludes the runtime-costly and Max-only transforms");
  for (const key of excluded) {
    assert.ok(optimize.includes(key), app + ": Code optimization should retain " + key);
    assert.ok(!speed.includes(key), app + ": Runtime speed must disable " + key);
    assert.ok(max.includes(key), app + ": Maximum should retain " + key);
  }
  for (const key of ["removeDuplicateAssignments", "removeEmptyIfs", "counterLoopToForEach"]) {
    assert.ok(max.includes(key), app + ": Maximum should enable " + key);
    assert.ok(!speed.includes(key), app + ": Runtime speed should not implicitly enable " + key);
  }
  for (const key of ["inlineSingleCall", "removeNoops", "simplifyIfElse"]) {
    assert.ok(speed.includes(key), app + ": Runtime speed should retain " + key);
  }
}

const pages = [
  ["docs/sb3/index.html", "Runtime speed"],
  ["docs/full/index.html", "Runtime speed"],
  ["docs/sb3/ja/index.html", "速度優先"],
  ["docs/full/ja/index.html", "速度優先"]
];
for (const [relativePath, label] of pages) {
  const html = fs.readFileSync(path.join(root, relativePath), "utf8");
  const speed = html.indexOf('data-preset="speed"');
  const max = html.indexOf('data-preset="max"');
  assert.ok(speed >= 0 && max > speed, relativePath + ": speed preset must appear immediately before Maximum");
  assert.ok(html.slice(speed, max).includes(">" + label + "</button>"), relativePath + ": localized label missing");
 assert.match(html, /<input type="checkbox" checked data-(?:popt|opt)="renameStores">/, relativePath + ": variable and list name shortening must be available and enabled");
 assert.ok(html.includes("sensing_of"), relativePath + ": reference-safety tooltip must document sensing_of behavior");
}

console.log("Preset invariants passed: both engines and four localized pages; Max enables the redundant-block passes while Speed excludes the Max-only additions.");
