#!/usr/bin/env node
"use strict";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const q = String.fromCharCode(34);
const pages = ["docs/sb3/index.html", "docs/sb3/ja/index.html", "docs/full/index.html", "docs/full/ja/index.html"];
for (const relativePath of pages) {
 const html = fs.readFileSync(path.join(root, relativePath), "utf8");
 const chunks = html.split("<label class=" + q + "opt" + q).slice(1);
 const options = chunks.map(chunk => chunk.split("</label>", 1)[0]).filter(chunk => chunk.includes("data-opt=" + q) || chunk.includes("data-popt=" + q));
 assert.ok(options.length > 0, relativePath + ": no compression options found");
 for (const option of options) {
 const key = (option.match(new RegExp("data-(?:p)?opt=" + q + "([^" + q + "]+)" + q)) || [])[1] || "unknown";
 const title = (option.match(new RegExp("title=" + q + "([^" + q + "]+)" + q)) || [])[1] || "";
 assert.ok(title.length >= 20, relativePath + ": missing or vague tooltip for " + key);
 assert.ok(option.includes("<span>"), relativePath + ": option label missing for " + key);
 }
 console.log(relativePath + ": " + options.length + " options have specific tooltips");
}
console.log("Option tooltip invariants passed for all four localized pages.");
