/* SB3 Repair — background worker.
 * Loads the repair engine and JSZip, then reports progress to the page.
 */
"use strict";

importScripts("jszip.min.js", "repair.js");
REPAIR.setJSZip(JSZip);

function progress(phase, frac, message) {
  self.postMessage({ type: "progress", phase, percent: Math.round(frac * 100), message });
}

self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type !== "inspect" && data.type !== "repair") return;
  try {
    const result = data.type === "inspect"
      ? await REPAIR.inspectBuffer(data.buffer, data.filename, data.options, progress)
      : await REPAIR.repairBuffer(data.buffer, data.filename, data.options, progress);
    if (data.type === "repair") {
      const out = result.outputBytes;
      delete result.outputBytes;
      self.postMessage({ type: "done", kind: data.type, report: result, output: out }, [out.buffer]);
    } else {
      self.postMessage({ type: "done", kind: data.type, report: result });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      kind: data.type,
      message: error && error.message ? error.message : String(error)
    });
  }
};
