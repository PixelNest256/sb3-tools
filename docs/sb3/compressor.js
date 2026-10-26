/* SB3 Compressor — browser edition.
 * A behavior-preserving compressor for Scratch / TurboWarp .sb3 files.
 * Everything runs in the tab; it never uploads a project.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SB3 = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const CLOUD_PREFIX = "\u2601";
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  const VAR_WRITE_OPS = new Set(["data_setvariableto", "data_changevariableby", "control_for_each"]);
  const VAR_READ_OPS = new Set(["data_variable"]);
  const LIST_READ_OPS = new Set(["data_listcontents", "data_itemoflist", "data_itemnumoflist",
    "data_lengthoflist", "data_listcontainsitem"]);
  const LIST_WRITE_OPS = new Set(["data_addtolist", "data_deleteoflist", "data_deletealloflist",
    "data_insertatlist", "data_replaceitemoflist"]);
  const DATA_REPORTER_OPS = new Set(["data_variable", "data_listcontents", "data_itemoflist",
    "data_itemnumoflist", "data_lengthoflist", "data_listcontainsitem"]);
  const LOOSE_STACK_OPS = new Set([
    "event_broadcast", "event_broadcastandwait", "procedures_call",
    "procedures_prototype", "control_stop", "control_wait",
    "control_wait_until", "control_create_clone_of", "control_delete_this_clone",
    "control_stop_other_scripts",
    "data_setvariableto", "data_changevariableby", "data_showvariable",
    "data_hidevariable", "data_showlist", "data_hidelist",
    "data_addtolist", "data_deleteoflist", "data_deletealloflist",
    "data_insertatlist", "data_replaceitemoflist"
  ]);
  const SENSING_STACK_OPS = new Set(["sensing_askandwait", "sensing_setdragmode",
    "sensing_resettimer"]);
  const EXTRACT_EXCLUDE_OPS = new Set([
    "procedures_definition", "procedures_prototype",
    "argument_reporter_string_number", "argument_reporter_boolean",
    "control_stop", "procedures_return"
  ]);
  const EXTRACT_FORBIDDEN_OPS = new Set([
    "procedures_definition", "procedures_prototype", "control_stop",
    "procedures_return"
  ]);
  const LITERAL_PRIMITIVE_TYPES = new Set([4, 5, 6, 7, 8, 10]);
  const SENSING_STAGE_PROPERTIES = new Set(["background #", "backdrop #", "backdrop name", "volume"]);
  const SENSING_SPRITE_PROPERTIES = new Set(["x position", "y position", "direction",
    "costume #", "costume name", "size", "volume"]);

  const REUSE_REPORTER_OPS = new Set([
    "operator_add", "operator_subtract", "operator_multiply", "operator_divide",
    "operator_lt", "operator_equals", "operator_gt", "operator_and", "operator_or",
    "operator_not", "operator_join", "operator_letter_of", "operator_length",
    "operator_contains", "operator_mod", "operator_round", "operator_mathop",
    "data_variable", "data_listcontents", "data_itemoflist", "data_itemnumoflist",
    "data_lengthoflist", "data_listcontainsitem",
    "argument_reporter_string_number", "argument_reporter_boolean",
    "motion_xposition", "motion_yposition", "motion_direction",
    "looks_size", "looks_costumenumbername", "looks_backdropnumbername",
    "sound_volume",
    "sensing_timer", "sensing_current", "sensing_dayssince2000",
    "sensing_keypressed", "sensing_mousedown", "sensing_mousex", "sensing_mousey",
    "sensing_touchingobject", "sensing_touchingcolor", "sensing_coloristouchingcolor",
    "sensing_distanceto", "sensing_answer", "sensing_loudness", "sensing_of",
    "sensing_username", "sensing_online"
  ]);
  const REUSE_PURE_REPORTER_OPS = REUSE_REPORTER_OPS;
  const REUSE_YIELD_OPS = new Set([
    "control_wait", "control_wait_until", "event_broadcastandwait",
    "sensing_askandwait", "motion_glidesecstoxy", "motion_glideto",
    "looks_sayforsecs", "looks_thinkforsecs", "sound_playuntildone"
  ]);

  const TARGET_DEFAULTS = [
    ["volume", 100], ["currentCostume", 0], ["tempo", 60],
    ["videoTransparency", 50], ["videoState", "on"], ["textToSpeechLanguage", null],
    ["visible", true], ["x", 0], ["y", 0], ["size", 100], ["direction", 90],
    ["draggable", false], ["rotationStyle", "all around"]
  ];
  const MONITOR_DEFAULTS = [
    ["mode", "default"], ["spriteName", null], ["width", 0], ["height", 0],
    ["visible", true], ["sliderMin", 0], ["sliderMax", 100], ["isDiscrete", true]
  ];

  // ------------------------------------------------------------------
  // small helpers

  const isDict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const isArr = Array.isArray;
  const isStr = (v) => typeof v === "string";
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // TurboWarp keeps its advanced-settings overrides in a comment on the stage:
  // one line holds JSON followed by " // _twconfig_" (runtime.js looks for a
  // line that ends with that marker).  The comment is project data, not
  // documentation, so removing it would silently reset the framerate, stage
  // size, interpolation, and every other setting the project relies on.
  const TW_CONFIG_MAGIC = " // _twconfig_";
  const isTwConfigComment = (tgt, comment) =>
    isDict(tgt) && !!tgt.isStage && isDict(comment) && isStr(comment.text) &&
    comment.text.includes(TW_CONFIG_MAGIC);

  // A comment survives when it is the TurboWarp config or when the block it is
  // anchored to survived.  A config comment that lost its anchor is detached
  // rather than dropped: TurboWarp reads it straight from the target's comment
  // table and no block is needed.
  const commentSurvives = (tgt, comment, blocks) => {
    if (isTwConfigComment(tgt, comment)) {
      if (isStr(comment.blockId) && !has(blocks, comment.blockId)) comment.blockId = null;
      return true;
    }
    const anchor = comment.blockId;
    return anchor === null || anchor === undefined || !isStr(anchor) || has(blocks, anchor);
  };

  const deepCopy = (v) => {
    if (typeof structuredClone === "function") return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  };
  const jsonLen = (s) => {
    // Count code points, so astral characters count once.
    let n = s.length;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) n--;
    }
    return n;
  };
  const jlen = (v) => jsonLen(JSON.stringify(v));
  const addAll = (target, source) => { for (const v of source) target.add(v); };
  const union = (...sets) => {
    const out = new Set();
    for (const s of sets) for (const v of s) out.add(v);
    return out;
  };
  const intersect = (a, b) => {
    const out = new Set();
    for (const v of a) if (b.has(v)) out.add(v);
    return out;
  };
  const setHasIntersection = (a, b) => {
    if (a.size > b.size) [a, b] = [b, a];
    for (const v of a) if (b.has(v)) return true;
    return false;
  };
  const cmpTuple = (a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return a.length - b.length;
  };
  const parseArray = (raw) => {
    if (typeof raw !== "string") return null;
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : null;
    } catch (_) {
      return null;
    }
  };
  const pairEq = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

  function encodeId(n) {
    if (n <= 0) n = 1;
    let out = "";
    while (n) {
      const r = (n - 1) % 62;
      n = Math.floor((n - 1) / 62);
      out = ALPHABET[r] + out;
    }
    return out;
  }

  // The shortest string in the id alphabet that `used` does not contain.
  // Prefixes are never required by the formats we write: a block id, a store
  // id, an argument id, and a generated name are all free-form strings.  Every
  // caller therefore starts at "A" and only moves on when a real collision
  // forces it.
  function shortestFreeId(used) {
    for (let n = 1; ; n++) {
      const id = encodeId(n);
      if (!used.has(id)) return id;
    }
  }

  function proccodePlaceholders(code) {
    const out = [];
    let i = 0;
    while (i < code.length) {
      if (code[i] === "%" && i + 1 < code.length) {
        const nxt = code[i + 1];
        if (nxt === "%") { i += 2; continue; }
        if (nxt === "s" || nxt === "b") { out.push("%" + nxt); i += 2; continue; }
      }
      i++;
    }
    return out;
  }

  function jsToNumber(value) {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number") return Number.isNaN(value) ? 0 : value;
    let text;
    try { text = String(value).trim(); } catch (_) { return 0; }
    if (!text) return 0;
    if (text === "Infinity" || text === "+Infinity") return Infinity;
    if (text === "-Infinity") return -Infinity;
    const low = text.toLowerCase();
    if (low.includes("nan") || low.includes("inf") || text.includes("_")) return 0;
    const out = Number(text);
    return Number.isNaN(out) ? 0 : out;
  }

  function jsNumberStr(value) {
    if (typeof value === "boolean") value = value ? 1 : 0;
    if (typeof value !== "number") return null;
    if (Number.isNaN(value)) return null;
    if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
    if (value === 0) return Object.is(value, -0) ? "-0" : "0";
    return String(value);
  }

  function looseEq(a, b) {
    if (typeof a === "boolean" || typeof b === "boolean") {
      return typeof a === "boolean" && typeof b === "boolean" && a === b;
    }
    if (a === null || a === undefined || b === null || b === undefined) {
      return (a === null || a === undefined) && (b === null || b === undefined);
    }
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) || !Number.isNaN(nb)) return na === nb;
    // Fall back to a string comparison when the numeric cast fails.
    return String(a) === String(b);
  }

  function groupDigits(text) {
    const parts = text.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function humanSize(n) {
    const units = ["B", "KB", "MB", "GB"];
    for (const unit of units) {
      if (Math.abs(n) < 1024 || unit === "GB") {
        if (unit === "B") return `${groupDigits(String(Math.trunc(n)))} B`;
        return `${groupDigits(n.toFixed(1))} ${unit}`;
      }
      n /= 1024;
    }
    return `${groupDigits(n.toFixed(1))} GB`;
  }

  // ------------------------------------------------------------------
  class CompressError extends Error {}

  // The three restructuring steps below are cheap enough to re-run on the
  // rewritten code: each pass may expose new duplicate groups or reporter
  // candidates.  Repetition stops as soon as a pass changes nothing or the
  // hard cap is reached.
  const MAX_OPTIMIZATION_PASSES = 10;

  const DEFAULT_OPTIONS = {
    stripDefaults: true,
    shortenIds: true,
    renameStores: true,
    removeUnused: true,
    removeMonitors: false,
    compressProcs: true,
    freqIds: true,
    dropObscuredShadows: true,
    removeUnreachable: true,
    clearInitialValues: true,
    extractDuplicates: true,
    nearDuplicates: true,
    simplifyIfElse: true,
    removeNoops: true,
    inlineSingleCall: true,
    foldConstants: true,
    loopDuplicates: true,
    propagateConstants: true,
    reuseReporters: true,
    stripComments: false,
    compactWorkspace: false,
    removeDeadAssets: false,
    removeWriteOnly: false,
    normalizeTypes: false
  };

  class Options {
    constructor(values) {
      Object.assign(this, DEFAULT_OPTIONS);
      if (isDict(values)) {
        for (const key of Object.keys(DEFAULT_OPTIONS)) {
          if (key in values) this[key] = !!values[key];
        }
      }
    }
  }

  // ------------------------------------------------------------------
  class Compressor {
    constructor(options, progress, cancelled) {
      this.options = options instanceof Options ? options : new Options(options);
      this.progress = typeof progress === "function" ? progress : () => {};
      this.cancelled = typeof cancelled === "function" ? cancelled : () => false;
      this.stats = {
        blocks_renamed: 0, vars_renamed: 0, lists_renamed: 0, broadcasts_renamed: 0,
        fields_removed: 0, monitors_updated: 0,
        vars_removed: 0, lists_removed: 0, procs_renamed: 0, args_renamed: 0,
        obscured_shadows_removed: 0, unreachable_blocks_removed: 0,
        unreachable_comments_removed: 0, broadcasts_removed: 0, procs_removed: 0,
        vars_initialized: 0, lists_initialized: 0,
        duplicates_extracted: 0, dup_blocks_saved: 0,
        near_duplicates_extracted: 0, near_blocks_saved: 0,
        ifelse_converted: 0, noop_procs_removed: 0, noop_calls_removed: 0,
        noop_receivers_removed: 0, noop_broadcasts_removed: 0,
        reporter_values_cached: 0, reporter_uses_reused: 0, temp_vars_created: 0,
        noop_messages_removed: 0, procs_inlined: 0, const_values_folded: 0,
        loops_created: 0, loop_blocks_saved: 0,
        const_vars_inlined: 0, const_reads_inlined: 0,
        arg_ids_shortened: 0, mutation_keys_added: 0, monitors_removed: 0,
        dead_hide_blocks_removed: 0,
        comments_removed: 0, workspace_compacted: 0, float_values_rounded: 0,
        optimization_passes: 0,
        dead_costumes_removed: 0, dead_sounds_removed: 0, dead_sprites_removed: 0,
        writeonly_vars_removed: 0, writeonly_lists_removed: 0,
        md5ext_removed: 0, numeric_strings_normalized: 0, meta_agent_cleared: 0
      };
      this.varMap = new Map();
      this.listMap = new Map();
      this.bcMap = new Map();
      this.varByName = new Map();
      this.listByName = new Map();
      this.bcByName = new Map();
      this.varNameIds = new Map();
      this.listNameIds = new Map();
      this.varByTarget = new Map();
      this.listByTarget = new Map();
      this.varOrigName = new Map();
      this.listOrigName = new Map();
      this.varCloudIds = new Set();
      this.stageName = null;
      this.usedVarIds = new Set();
      this.usedListIds = new Set();
      this.droppedVarIds = new Set();
      this.droppedListIds = new Set();
      this.readVarIds = new Set();
      this.readListIds = new Set();
      this.writeVarIds = new Set();
      this.writeListIds = new Set();
      this.showVarIds = new Set();
      this.showListIds = new Set();
      this.keptMonVarIds = new Set();
      this.keptMonListIds = new Set();
      this.visibleVarIds = new Set();
      this.visibleListIds = new Set();
      this.standaloneVarIds = new Set();
      this.standaloneListIds = new Set();
      this.sensedVarIds = new Set();
      this.unknownReadVarIds = new Set();
      this.unknownReadListIds = new Set();
      this.displayVarIds = new Set();
      this.displayListIds = new Set();
      this.layerExpect = 0;
    }

    run(project) {
      const targets = project.targets;
      if (!isArr(targets) || !targets.length) {
        throw new CompressError("'targets' not found. Please provide a project.json.");
      }
      const o = this.options;
      this.progress("collect", 0.0, "Collecting variables, lists, and broadcasts...");
      if (!o.removeMonitors) this._collectMonitorStores(targets, project.monitors);
      if (o.dropObscuredShadows) this._dropObscuredShadows(targets);
      if (o.removeUnreachable) {
        this.progress("collect", 1.0, "Removing unreachable blocks and comments...");
        this._removeUnreachable(project);
      }
      this._collect(targets);
      this.progress("collect", 1.0, "Analyzing variables, lists, and monitors...");
      this._scanUsage(targets, project.monitors);
      if (!o.removeUnused) {
        this.usedVarIds = new Set(this.varMap.keys());
        this.usedListIds = new Set(this.listMap.keys());
        this.droppedVarIds = new Set();
        this.droppedListIds = new Set();
      } else {
        if (!o.removeMonitors) {
          for (const id of this.keptMonVarIds) this.usedVarIds.add(id);
          for (const id of this.keptMonListIds) this.usedListIds.add(id);
        }
        this.droppedVarIds = new Set([...this.varMap.keys()].filter((k) => !this.usedVarIds.has(k)));
        this.droppedListIds = new Set([...this.listMap.keys()].filter((k) => !this.usedListIds.has(k)));
      }
      if (o.clearInitialValues) {
        this.progress("collect", 1.0, "Analyzing initial values...");
        this._clearInitialValues(targets);
      }
      if (o.simplifyIfElse || o.removeNoops || o.inlineSingleCall ||
          o.foldConstants || o.loopDuplicates || o.propagateConstants) {
        this.progress("collect", 1.0, "Simplifying scripts...");
        this._simplifyProject(project);
      }
      if (o.removeDeadAssets) {
        this.progress("collect", 1.0, "Removing dead assets...");
        project.targets = this._removeDeadAssets(targets, project.monitors);
      }
      if (o.removeWriteOnly) {
        this.progress("collect", 1.0, "Removing write-only variables and lists...");
        this._removeWriteOnly(targets, project.monitors);
      }
      if (o.normalizeTypes) {
        this.progress("collect", 1.0, "Normalizing types and representations...");
        this._normalizeTypes(project);
      }
      if (o.shortenIds) {
        if (o.removeUnused) {
          // A simplify pass (inlining a constant variable, for example) can
          // drop a store after the sets above were computed, so refresh them
          // before the survivors are numbered.
          this.droppedVarIds = new Set([...this.varMap.keys()].filter((k) => !this.usedVarIds.has(k)));
          this.droppedListIds = new Set([...this.listMap.keys()].filter((k) => !this.usedListIds.has(k)));
          this._compactStoreMappings(targets);
        } else if (this.droppedVarIds.size || this.droppedListIds.size) {
          // With `removeUnused` off every store normally survives, but the
          // constant inliner can still delete the store it folded away.  That
          // leaves a hole in the numbering, so pack the survivors again.
          this._compactStoreMappings(targets);
        }
        this._compactBroadcasts(targets);
        this._renameStores(targets);
      } else if (o.removeUnused) this._dropUnused(targets);

      this.layerExpect = 0;
      const n = targets.length;
      // Re-running the cheap restructure steps is part of the option itself:
      // keep going while a pass still finds something (or the 10-pass cap is
      // reached).  A project where the first pass leaves nothing behind is
      // therefore processed exactly once, as before.
      const extra = o.extractDuplicates || o.nearDuplicates || o.reuseReporters;
      const maxPasses = extra ? MAX_OPTIMIZATION_PASSES : 1;
      let pass = 0;
      const frac = (within) => (extra ? 1 - 1 / (pass + 1 + within) : within);
      while (pass < maxPasses) {
        if (this.cancelled()) throw new Error("Cancelled");
        const label = pass === 0
          ? null
          : `Repeating optimizations (pass ${pass + 1})...`;
        const before = this._optimizationSignature();
        for (let i = 0; i < n; i++) {
          if (this.cancelled()) throw new Error("Cancelled");
          const text = label || `Processing target ${i + 1}/${n}`;
          this.progress("targets", frac(i / n), text);
          if (pass === 0) this._processTarget(targets[i]);
          else this._extractTargetDuplicates(targets[i]);
          this.progress("targets", frac((i + 1) / n), text);
        }
        if (o.reuseReporters) {
          this.progress("targets", frac(1),
            label || "Reusing repeated reporter values...");
          this._reuseReporters(targets);
        }
        // The blocks reporter reuse inserts are only normalised on the extra
        // passes.  The first pass keeps the historical order exactly, so a
        // project without leftover candidates serialises byte-for-byte the
        // same as before this repetition existed.
        if (pass > 0) {
          for (const tgt of targets) {
            if (this.cancelled()) throw new Error("Cancelled");
            this._finalizeTargetBlocks(tgt, false);
          }
        }
        const changed = this._optimizationSignature() !== before;
        pass += 1;
        if (!changed) break;
      }
      this.stats.optimization_passes = pass;
      if (pass > 1 && o.compactWorkspace) {
        for (const tgt of targets) this._compactWorkspace(tgt);
      }
      if (extra) this.progress("targets", 1.0, "Optimizations complete");
      if (this.cancelled()) throw new Error("Cancelled");
      this.progress("finalize", 0.5, "Processing monitors and metadata...");
      this._processMonitors(project);
      this._processRoot(project);
      this.progress("finalize", 1.0, "Done");
      return project;
    }

    // Total of the counters the repeatable steps touch.  If a pass leaves it
    // unchanged there is nothing left to find, so the outer loop can stop
    // instead of rescanning every target.
    _optimizationSignature() {
      const st = this.stats;
      return st.duplicates_extracted + st.dup_blocks_saved +
        st.near_duplicates_extracted + st.near_blocks_saved +
        st.reporter_values_cached + st.reporter_uses_reused +
        st.temp_vars_created;
    }

    // ------------------------------------------------------------------
    // Stores a monitor points at, resolved by id first and then by name.
    // Keeping monitors (the default) leaves those stores and the monitor
    // entries alone so a displayed variable keeps its label and a hidden
    // monitor keeps its saved position.  `removeMonitors` opts out: hidden
    // monitors are dropped and their stores can be shortened or removed.
    _collectMonitorStores(targets, monitors) {
      const varIds = new Set(), listIds = new Set();
      this.keptMonVarIds = varIds;
      this.keptMonListIds = listIds;
      if (!isArr(monitors) || !monitors.length) return;
      const scopes = { v: new Map(), l: new Map() };
      let stageName = null;
      const note = (kind, tname, name, id) => {
        if (!isStr(tname) || !isStr(name)) return;
        const table = scopes[kind];
        if (!table.has(tname)) table.set(tname, new Map());
        const byName = table.get(tname);
        if (!byName.has(name)) byName.set(name, new Set());
        byName.get(name).add(id);
      };
      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        if (tgt.isStage) stageName = tgt.name;
        const varTable = isDict(tgt.variables) ? tgt.variables : {};
        for (const [id, ent] of Object.entries(varTable)) {
          note("v", tgt.name, isArr(ent) && ent.length ? ent[0] : String(ent), id);
        }
        const listTable = isDict(tgt.lists) ? tgt.lists : {};
        for (const [id, ent] of Object.entries(listTable)) {
          note("l", tgt.name, isArr(ent) && ent.length ? ent[0] : String(ent), id);
        }
      }
      const allIds = (kind) => {
        const out = new Set();
        for (const byName of scopes[kind].values()) {
          for (const ids of byName.values()) for (const id of ids) out.add(id);
        }
        return out;
      };
      const idsV = allIds("v"), idsL = allIds("l");
      for (const mon of monitors) {
        if (!isDict(mon)) continue;
        const isVar = mon.opcode === "data_variable";
        if (!isVar && mon.opcode !== "data_listcontents") continue;
        const kind = isVar ? "v" : "l";
        const out = isVar ? varIds : listIds;
        const mid = mon.id;
        const known = isVar ? idsV : idsL;
        if (isStr(mid) && known.has(mid)) { out.add(mid); continue; }
        const pname = (mon.params || {})[isVar ? "VARIABLE" : "LIST"];
        if (!isStr(pname)) continue;
        const owner = mon.spriteName !== null && mon.spriteName !== undefined
          ? mon.spriteName : stageName;
        const scope = scopes[kind].get(owner);
        const scoped = scope ? scope.get(pname) : null;
        if (scoped) {
          for (const id of scoped) out.add(id);
          continue;
        }
        for (const byName of scopes[kind].values()) {
          const ids = byName.get(pname);
          if (ids) for (const id of ids) out.add(id);
        }
      }
    }

    // ------------------------------------------------------------------
    // Shortest-free-string allocators.  The "☁ " marker on cloud variables is
    // required by Scratch, so it is added around the short name rather than
    // being counted as part of it.  Cloud and ordinary names therefore have
    // their own counters: a cloud variable may take "☁ A" while an ordinary
    // one also takes "A", because the marker alone keeps the two names
    // distinct.
    _storeNameGenerators(reservedVarNames, reservedListNames) {
      let varNameSeq = 0, cloudNameSeq = 0, listNameSeq = 0;
      return {
        nextVarName: (cloud) => {
          let name;
          do {
            if (cloud) {
              cloudNameSeq += 1;
              name = CLOUD_PREFIX + " " + encodeId(cloudNameSeq);
            } else {
              varNameSeq += 1;
              name = encodeId(varNameSeq);
            }
          } while (reservedVarNames.has(name));
          return name;
        },
        nextListName: () => {
          let name;
          do {
            listNameSeq += 1;
            name = encodeId(listNameSeq);
          } while (reservedListNames.has(name));
          return name;
        }
      };
    }

    _storeGenerators(reservedStoreIds, reservedVarNames, reservedListNames) {
      let storeSeq = 0;
      return {
        nextStoreId: () => {
          let id;
          do {
            storeSeq += 1;
            id = encodeId(storeSeq);
          } while (reservedStoreIds.has(id));
          return id;
        },
        ...this._storeNameGenerators(reservedVarNames, reservedListNames)
      };
    }

    // Number every surviving store.  Ids are shared by variables and lists
    // (the VM keeps both in one map) and are numbered across the whole
    // project: a sprite looks an id up in its own map first and then in the
    // stage's, so an id reused by two targets would silently retarget one of
    // them.  Names are counted per kind and per scope.  The stage is numbered
    // first and avoids every name that has to stay, because a stage name is
    // visible from every sprite.  Sprite names then avoid the stage's final
    // names; sprite-to-sprite repeats are legal (each target keeps its own
    // map) and save the most space.
    _planStoreMappings(targets, dropV, dropL) {
      const keepV = this.keptMonVarIds, keepL = this.keptMonListIds;
      const renameStores = this.options.renameStores;
      const infos = [];
      const keptIds = new Set();
      const keptVarNames = new Set();
      const keptListNames = new Set();
      let stageInfo = null;
      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        const info = {
          tgt,
          tname: isStr(tgt.name) ? tgt.name : null,
          vars: [],
          lists: []
        };
        for (const [id, ent] of Object.entries(isDict(tgt.variables) ? tgt.variables : {})) {
          if (dropV && dropV.has(id)) continue;
          const name = isArr(ent) && ent.length ? ent[0] : String(ent);
          const kept = keepV.has(id);
          info.vars.push({ id, name, kept });
          if (kept) {
            keptIds.add(id);
            if (isStr(name)) keptVarNames.add(name);
          }
        }
        for (const [id, ent] of Object.entries(isDict(tgt.lists) ? tgt.lists : {})) {
          if (dropL && dropL.has(id)) continue;
          const name = isArr(ent) && ent.length ? ent[0] : String(ent);
          const kept = keepL.has(id);
          info.lists.push({ id, name, kept });
          if (kept) {
            keptIds.add(id);
            if (isStr(name)) keptListNames.add(name);
          }
        }
        if (tgt.isStage && !stageInfo) stageInfo = info;
        infos.push(info);
      }

      let storeSeq = 0;
      const nextStoreId = () => {
        let id;
        do {
          storeSeq += 1;
          id = encodeId(storeSeq);
        } while (keptIds.has(id));
        return id;
      };

      const assign = (info, reservedVars, reservedLists) => {
        const gen = this._storeNameGenerators(reservedVars, reservedLists);
        const varNames = new Map();
        const listNames = new Map();
        const finalVars = new Set(reservedVars);
        const finalLists = new Set(reservedLists);
        for (const e of info.vars) {
          let name;
          if (e.kept || !renameStores) name = e.name;
          else name = gen.nextVarName(isStr(e.name) && e.name.startsWith(CLOUD_PREFIX));
          varNames.set(e.id, name);
          if (isStr(name)) finalVars.add(name);
        }
        for (const e of info.lists) {
          const name = e.kept || !renameStores ? e.name : gen.nextListName();
          listNames.set(e.id, name);
          if (isStr(name)) finalLists.add(name);
        }
        info.plan = { varNames, listNames };
        return { finalVars, finalLists };
      };

      let stageNames = { finalVars: keptVarNames, finalLists: keptListNames };
      if (stageInfo) stageNames = assign(stageInfo, keptVarNames, keptListNames);
      for (const info of infos) {
        if (info === stageInfo) continue;
        const resVars = new Set(stageNames.finalVars);
        const resLists = new Set(stageNames.finalLists);
        for (const e of info.vars) {
          if (e.kept && isStr(e.name)) resVars.add(e.name);
        }
        for (const e of info.lists) {
          if (e.kept && isStr(e.name)) resLists.add(e.name);
        }
        assign(info, resVars, resLists);
      }

      this.varByName = new Map();
      this.listByName = new Map();
      this.varByTarget = new Map();
      this.listByTarget = new Map();
      this.varMap = new Map();
      this.listMap = new Map();
      const order = stageInfo
        ? [stageInfo, ...infos.filter((info) => info !== stageInfo)]
        : infos;
      for (const info of order) {
        const tname = info.tname;
        let varScope = null, listScope = null;
        if (tname) {
          if (!this.varByTarget.has(tname)) this.varByTarget.set(tname, new Map());
          varScope = this.varByTarget.get(tname);
          if (!this.listByTarget.has(tname)) this.listByTarget.set(tname, new Map());
          listScope = this.listByTarget.get(tname);
        }
        for (const e of info.vars) {
          const name = info.plan.varNames.get(e.id);
          const mapping = e.kept ? [e.id, name] : [nextStoreId(), name];
          this.varMap.set(e.id, mapping);
          if (!this.varByName.has(e.name) || e.kept) this.varByName.set(e.name, mapping);
          if (varScope && (!varScope.has(e.name) || e.kept)) varScope.set(e.name, mapping);
        }
        for (const e of info.lists) {
          const name = info.plan.listNames.get(e.id);
          const mapping = e.kept ? [e.id, name] : [nextStoreId(), name];
          this.listMap.set(e.id, mapping);
          if (!this.listByName.has(e.name) || e.kept) this.listByName.set(e.name, mapping);
          if (listScope && (!listScope.has(e.name) || e.kept)) listScope.set(e.name, mapping);
        }
      }
    }

    // Broadcasts are numbered before `removeNoops` drops the messages nothing
    // sends or receives, which leaves a gap in the sequence ("A".."D", "F").
    // Renumber the survivors once the removals are done.  A broadcast's id and
    // name may be the same string, so one counter drives both.
    _compactBroadcasts(targets) {
      const renameStores = this.options.renameStores;
      let seq = 0;
      this.bcMap = new Map();
      this.bcByName = new Map();
      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        const broadcasts = isDict(tgt.broadcasts) ? tgt.broadcasts : {};
        for (const [bid, ent] of Object.entries(broadcasts)) {
          const name = isArr(ent) && ent.length ? ent[0] : ent;
          const short = encodeId(++seq);
          const mapping = [short, renameStores ? short : name];
          this.bcMap.set(bid, mapping);
          if (!this.bcByName.has(name)) this.bcByName.set(name, mapping);
        }
      }
      this.stats.broadcasts_renamed = this.bcMap.size;
    }

    // `_collect` numbers every store, including the ones that `removeUnused`
    // is about to drop, so a survivor could inherit "Bb" merely because 50
    // dropped stores were numbered before it.  Once the drop set is known,
    // number the survivors again: kept monitor stores still keep their id and
    // name, everything else is packed into the shortest free strings.  Only
    // the rename maps change here; the store tables are rewritten later by
    // `_renameStores`.
    _compactStoreMappings(targets) {
      this._planStoreMappings(targets, this.droppedVarIds, this.droppedListIds);
      let renamedV = 0, renamedL = 0;
      for (const [id, m] of this.varMap) {
        if (m[0] !== id || m[1] !== this.varOrigName.get(id)) renamedV += 1;
      }
      for (const [id, m] of this.listMap) {
        if (m[0] !== id || m[1] !== this.listOrigName.get(id)) renamedL += 1;
      }
      this.stats.vars_renamed = renamedV;
      this.stats.lists_renamed = renamedL;
    }

    _collect(targets) {
      let bcIdSeq = 0, bcNameSeq = 0;
      const total = Math.max(targets.length, 1);
      // IDs and names are separate passes: shortenIds owns internal ids,
      // renameStores owns the names people can see.
      const renameStores = this.options.renameStores;
      const nextBcId = () => encodeId(++bcIdSeq);
      const nextBcName = () => encodeId(++bcNameSeq);
      for (let idx = 0; idx < targets.length; idx++) {
        const tgt = targets[idx];
        if (!isDict(tgt)) continue;
        const tname = tgt.name;
        if (tgt.isStage) this.stageName = tname;
        const variables = isDict(tgt.variables) ? tgt.variables : {};
        const lists = isDict(tgt.lists) ? tgt.lists : {};
        // Original names are indexed before anything is renamed: block fields
        // and monitors still point at them when the mappings are applied.
        for (const [vid, ent] of Object.entries(variables)) {
          const name = isArr(ent) && ent.length ? ent[0] : String(ent);
          this.varOrigName.set(vid, name);
          if (isStr(name) && name.startsWith(CLOUD_PREFIX)) this.varCloudIds.add(vid);
          if (!this.varNameIds.has(name)) this.varNameIds.set(name, new Set());
          this.varNameIds.get(name).add(vid);
        }
        for (const [lid, ent] of Object.entries(lists)) {
          const name = isArr(ent) && ent.length ? ent[0] : String(ent);
          this.listOrigName.set(lid, name);
          if (!this.listNameIds.has(name)) this.listNameIds.set(name, new Set());
          this.listNameIds.get(name).add(lid);
        }
        const broadcasts = isDict(tgt.broadcasts) ? tgt.broadcasts : {};
        for (const [bid, ent] of Object.entries(broadcasts)) {
          const name = isArr(ent) && ent.length ? ent[0] : ent;
          const mapping = [nextBcId(), renameStores ? nextBcName() : name];
          this.bcMap.set(bid, mapping);
          if (!this.bcByName.has(name)) this.bcByName.set(name, mapping);
        }
        this.progress("collect", (idx + 1) / total, "Collecting variables, lists, and broadcasts...");
      }
      this._planStoreMappings(targets, null, null);
      let renamedV = 0, renamedL = 0;
      for (const [id, m] of this.varMap) {
        if (m[0] !== id || m[1] !== this.varOrigName.get(id)) renamedV += 1;
      }
      for (const [id, m] of this.listMap) {
        if (m[0] !== id || m[1] !== this.listOrigName.get(id)) renamedL += 1;
      }
      this.stats.vars_renamed = renamedV;
      this.stats.lists_renamed = renamedL;
      this.stats.broadcasts_renamed = this.bcMap.size;
    }

    // ------------------------------------------------------------------
    _scanUsage(targets, monitors) {
      const usedV = new Set(), usedL = new Set();
      const readV = new Set(), readL = new Set();
      const writeV = new Set(), writeL = new Set();
      const showV = new Set(), showL = new Set();
      const visibleV = new Set(), visibleL = new Set();
      const standaloneV = new Set(), standaloneL = new Set();
      const sensedV = new Set();
      const unknownReadV = new Set(), unknownReadL = new Set();

      const mark = (kind, pid, name) => {
        const used = kind === "v" ? usedV : usedL;
        const known = kind === "v" ? this.varMap : this.listMap;
        const byName = kind === "v" ? this.varNameIds : this.listNameIds;
        if (isStr(pid) && known.has(pid)) used.add(pid);
        else if (name !== null && name !== undefined) {
          const ids = byName.get(name);
          if (ids) addAll(used, ids);
        }
      };
      const markUnknownField = (pid) => {
        if (!isStr(pid)) return;
        if (this.varMap.has(pid)) {
          usedV.add(pid); readV.add(pid); unknownReadV.add(pid);
        } else if (this.listMap.has(pid)) {
          usedL.add(pid); readL.add(pid); unknownReadL.add(pid);
        }
      };
      const markRead = (kind, pid, name) => {
        const table = kind === "v" ? this.varMap : this.listMap;
        const byName = kind === "v" ? this.varNameIds : this.listNameIds;
        const out = kind === "v" ? readV : readL;
        if (isStr(pid) && table.has(pid)) out.add(pid);
        else if (name !== null && name !== undefined) {
          const ids = byName.get(name);
          if (ids) addAll(out, ids);
        }
      };
      const scanInput = (node) => {
        if (!isArr(node)) return;
        if (node.length && (node[0] === 12 || node[0] === 13)) {
          const name = node.length > 1 ? node[1] : null;
          const pid = node.length > 2 ? node[2] : null;
          const kind = node[0] === 12 ? "v" : "l";
          mark(kind, pid, name);
          markRead(kind, pid, name);
          return;
        }
        for (const item of node) scanInput(item);
      };
      const scanIds = (node) => {
        if (isDict(node)) {
          for (const value of Object.values(node)) scanIds(value);
        } else if (isArr(node)) {
          for (const value of node) scanIds(value);
        } else if (isStr(node)) {
          if (this.varMap.has(node)) usedV.add(node);
          else if (this.listMap.has(node)) usedL.add(node);
        }
      };

      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        scanIds(tgt.blocks);
        const blocks = isDict(tgt.blocks) ? tgt.blocks : {};
        for (const blk of Object.values(blocks)) {
          if (isArr(blk)) {
            if (blk.length && (blk[0] === 12 || blk[0] === 13)) {
              const name = blk.length > 1 ? blk[1] : null;
              const pid = blk.length > 2 ? blk[2] : null;
              const kind = blk[0] === 12 ? "v" : "l";
              mark(kind, pid, name);
              const table = kind === "v" ? this.varMap : this.listMap;
              const byName = kind === "v" ? this.varNameIds : this.listNameIds;
              const targetSet = kind === "v" ? standaloneV : standaloneL;
              if (isStr(pid) && table.has(pid)) targetSet.add(pid);
              else if (name !== null && name !== undefined) {
                const ids = byName.get(name);
                if (ids) addAll(targetSet, ids);
              }
            }
            continue;
          }
          if (!isDict(blk)) continue;
          const op = blk.opcode;
          const fields = blk.fields;
          if (isDict(fields)) {
            for (const [k, fv] of Object.entries(fields)) {
              if (!isArr(fv) || !fv.length) continue;
              const fid = fv.length > 1 ? fv[1] : null;
              const fname = fv[0];
              if (k === "VARIABLE") {
                mark("v", fid, fname);
                const ids = isStr(fid) && this.varMap.has(fid)
                  ? new Set([fid])
                  : (this.varNameIds.get(fname) || new Set());
                if (VAR_WRITE_OPS.has(op)) addAll(writeV, ids);
                else if (op === "data_showvariable") addAll(showV, ids);
                else if (op === "data_hidevariable") { /* hidden only */ }
                else addAll(readV, ids);
              } else if (k === "LIST") {
                mark("l", fid, fname);
                const ids = isStr(fid) && this.listMap.has(fid)
                  ? new Set([fid])
                  : (this.listNameIds.get(fname) || new Set());
                if (LIST_WRITE_OPS.has(op)) addAll(writeL, ids);
                else if (op === "data_showlist") addAll(showL, ids);
                else if (op === "data_hidelist") { /* hidden only */ }
                else addAll(readL, ids);
              } else {
                markUnknownField(fid);
              }
            }
            if (op === "sensing_of") {
              const prop = fields.PROPERTY;
              if (isArr(prop) && prop.length && prop[0] !== null && prop[0] !== undefined) {
                const ids = this.varNameIds.get(prop[0]);
                if (ids) { addAll(usedV, ids); addAll(readV, ids); addAll(sensedV, ids); }
              }
            }
          }
          if (isDict(blk.inputs)) {
            for (const value of Object.values(blk.inputs)) scanInput(value);
          }
          if (blk.topLevel === true && (op === "data_variable" || op === "data_listcontents")) {
            const fv = (fields || {})[op === "data_variable" ? "VARIABLE" : "LIST"];
            let ids = new Set();
            if (isArr(fv) && fv.length) {
              const fid = fv.length > 1 ? fv[1] : null;
              const table = op === "data_variable" ? this.varMap : this.listMap;
              const byName = op === "data_variable" ? this.varNameIds : this.listNameIds;
              if (isStr(fid) && table.has(fid)) ids = new Set([fid]);
              else {
                const found = byName.get(fv[0]);
                if (found) ids = new Set(found);
              }
            }
            addAll(op === "data_variable" ? standaloneV : standaloneL, ids);
          }
        }
      }

      for (const mon of (isArr(monitors) ? monitors : [])) {
        if (!isDict(mon)) continue;
        scanIds(mon);
        const op = mon.opcode;
        if (op !== "data_variable" && op !== "data_listcontents") continue;
        const mid = mon.id;
        const pkey = op === "data_variable" ? "VARIABLE" : "LIST";
        const pname = (mon.params || {})[pkey];
        const table = op === "data_variable" ? this.varMap : this.listMap;
        const byName = op === "data_variable" ? this.varNameIds : this.listNameIds;
        const used = op === "data_variable" ? usedV : usedL;
        let ids = new Set();
        if (isStr(mid) && table.has(mid)) {
          ids = new Set([mid]); used.add(mid);
        } else if (pname !== null && pname !== undefined) {
          ids = new Set(byName.get(pname) || []); addAll(used, ids);
        }
        if (mon.visible !== false) {
          addAll(op === "data_variable" ? visibleV : visibleL, ids);
        }
      }

      this.usedVarIds = intersect(usedV, union(readV, writeV, showV, visibleV, standaloneV));
      this.usedListIds = intersect(usedL, union(readL, writeL, showL, visibleL, standaloneL));
      this.readVarIds = readV; this.readListIds = readL;
      this.writeVarIds = writeV; this.writeListIds = writeL;
      this.showVarIds = showV; this.showListIds = showL;
      this.visibleVarIds = visibleV; this.visibleListIds = visibleL;
      this.standaloneVarIds = standaloneV; this.standaloneListIds = standaloneL;
      this.sensedVarIds = sensedV;
      this.unknownReadVarIds = unknownReadV; this.unknownReadListIds = unknownReadL;
      this.displayVarIds = union(visibleV, showV, standaloneV);
      this.displayListIds = union(visibleL, showL, standaloneL);
    }

    _dropObscuredShadows(targets) {
      const st = this.stats;
      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        const blocks = tgt.blocks;
        if (!isDict(blocks)) continue;
        for (const blk of Object.values(blocks)) {
          if (!isDict(blk) || !isDict(blk.inputs)) continue;
          for (const [key, value] of Object.entries(blk.inputs)) {
            if (!isArr(value) || value.length < 3 || value[0] !== 3) continue;
            const covered = value[1];
            if (isStr(covered)) {
              if (!has(blocks, covered)) continue;
            } else if (isArr(covered)) {
              if (!covered.length || !isInt(covered[0])) continue;
            } else {
              continue;
            }
            blk.inputs[key] = [2, covered];
            st.obscured_shadows_removed += 1;
          }
        }
      }
    }

    _removeUnreachable(project) {
      const targets = project.targets;
      if (!isArr(targets)) return;
      const st = this.stats;
      const blocksByTi = targets.map((tgt) => (isDict(tgt) && isDict(tgt.blocks) ? tgt.blocks : {}));

      const defsByCode = new Map();
      const receivers = [];
      blocksByTi.forEach((blocks, ti) => {
        for (const [bid, blk] of Object.entries(blocks)) {
          if (!isDict(blk)) continue;
          const op = blk.opcode;
          if (op === "procedures_definition") {
            const cb = (blk.inputs || {}).custom_block;
            const pid = isArr(cb) && cb.length > 1 ? cb[1] : null;
            const proto = isStr(pid) ? blocks[pid] : null;
            const mut = (proto || {}).mutation || {};
            const code = mut.proccode;
            if (isStr(code)) {
              const key = ti + "\u0000" + code;
              if (!defsByCode.has(key)) defsByCode.set(key, []);
              defsByCode.get(key).push(bid);
            }
          } else if (op === "event_whenbroadcastreceived") {
            const fv = (blk.fields || {}).BROADCAST_OPTION;
            if (isArr(fv) && fv.length) {
              const bidId = fv.length > 1 ? fv[1] : null;
              receivers.push([ti, bid, isStr(bidId) ? bidId : null, isStr(fv[0]) ? fv[0] : null]);
            }
          }
        }
      });

      const isTopRoot = (op) => {
        if (!isStr(op)) return true;
        if (op === "event_whenbroadcastreceived") return false;
        if (op === "procedures_definition" || op === "procedures_prototype") return false;
        if (op === "control_start_as_clone" || op.startsWith("event_when")) return true;
        if (DATA_REPORTER_OPS.has(op)) return true;
        if (op.startsWith("data_")) return false;
        if (op.startsWith("motion_") || op.startsWith("looks_") ||
            op.startsWith("sound_") || op.startsWith("pen_")) return false;
        if (op.startsWith("control_")) return false;
        if (SENSING_STACK_OPS.has(op)) return false;
        if (op.startsWith("sensing_")) return true;
        if (op.startsWith("operator_") || op.startsWith("argument_reporter")) return true;
        if (LOOSE_STACK_OPS.has(op)) return false;
        return true;
      };

      const reachable = targets.map(() => new Set());
      const queue = [];
      let qhead = 0;
      const sentIds = new Set();
      const sentNames = new Set();
      const enqueue = (ti, bid) => {
        if (isStr(bid) && ti >= 0 && ti < blocksByTi.length &&
            has(blocksByTi[ti], bid) && !reachable[ti].has(bid)) {
          queue.push([ti, bid]);
        }
      };

      blocksByTi.forEach((blocks, ti) => {
        for (const [bid, blk] of Object.entries(blocks)) {
          if (isArr(blk)) enqueue(ti, bid);
          else if (isDict(blk) && blk.topLevel === true && isTopRoot(blk.opcode)) enqueue(ti, bid);
        }
      });

      const addBroadcastValue = (value, ti, seen) => {
        if (!seen) seen = new Set();
        if (isArr(value)) {
          if (value.length && value[0] === 11) {
            if (value.length > 1 && isStr(value[1])) sentNames.add(value[1]);
            if (value.length > 2 && isStr(value[2])) sentIds.add(value[2]);
            return;
          }
          for (let i = 1; i < value.length; i++) addBroadcastValue(value[i], ti, seen);
        } else if (isDict(value)) {
          if (has(value, "opcode") || has(value, "inputs") || has(value, "fields")) {
            const fv = (value.fields || {}).BROADCAST_OPTION;
            if (isArr(fv) && fv.length) {
              if (isStr(fv[0])) sentNames.add(fv[0]);
              if (fv.length > 1 && isStr(fv[1])) sentIds.add(fv[1]);
            }
            const inputs = value.inputs;
            if (isDict(inputs)) {
              for (const item of Object.values(inputs)) addBroadcastValue(item, ti, seen);
            }
          } else {
            for (const item of Object.values(value)) addBroadcastValue(item, ti, seen);
          }
        } else if (isStr(value)) {
          if (seen.has(value)) return;
          seen.add(value);
          const blk = blocksByTi[ti][value];
          if (isDict(blk)) addBroadcastValue(blk, ti, seen);
        }
      };

      const processQueue = () => {
        while (qhead < queue.length) {
          const [ti, bid] = queue[qhead++];
          if (reachable[ti].has(bid)) continue;
          const blk = blocksByTi[ti][bid];
          if (blk === undefined) continue;
          reachable[ti].add(bid);
          if (isArr(blk) || !isDict(blk)) continue;
          const op = blk.opcode;
          const inputs = blk.inputs;
          if (isDict(inputs)) {
            for (const value of Object.values(inputs)) {
              if (!isArr(value)) continue;
              for (let i = 1; i < value.length; i++) {
                if (isStr(value[i])) enqueue(ti, value[i]);
              }
            }
          }
          if (isStr(blk.next)) enqueue(ti, blk.next);
          if (op === "procedures_definition") {
            const cb = (blk.inputs || {}).custom_block;
            if (isArr(cb) && cb.length > 1) enqueue(ti, cb[1]);
          } else if (op === "procedures_call") {
            const code = (blk.mutation || {}).proccode;
            if (isStr(code)) {
              for (const hat of (defsByCode.get(ti + "\u0000" + code) || [])) enqueue(ti, hat);
            }
          }
          if (op === "event_broadcast" || op === "event_broadcastandwait") {
            addBroadcastValue(blk.inputs, ti);
            addBroadcastValue(blk.fields, ti);
          }
        }
      };

      processQueue();
      for (;;) {
        let activated = false;
        for (const [ti, bid, bidId, name] of receivers) {
          if (reachable[ti].has(bid)) continue;
          if ((bidId !== null && sentIds.has(bidId)) ||
              (name !== null && sentNames.has(name))) {
            enqueue(ti, bid);
            activated = true;
          }
        }
        if (!activated) break;
        processQueue();
      }

      targets.forEach((tgt, ti) => {
        if (!isDict(tgt)) return;
        const blocks = blocksByTi[ti];
        const kept = {};
        for (const [bid, blk] of Object.entries(blocks)) {
          if (reachable[ti].has(bid)) kept[bid] = blk;
        }
        st.unreachable_blocks_removed += Object.keys(blocks).length - Object.keys(kept).length;
        for (const [bid, blk] of Object.entries(blocks)) {
          if (!has(kept, bid) && isDict(blk) && blk.opcode === "procedures_definition") {
            st.procs_removed += 1;
          }
        }
        for (const blk of Object.values(kept)) {
          if (!isDict(blk)) continue;
          if (isStr(blk.next) && !has(kept, blk.next)) blk.next = null;
          if (isStr(blk.parent) && !has(kept, blk.parent)) blk.parent = null;
        }
        tgt.blocks = kept;
        const comments = tgt.comments;
        if (isDict(comments)) {
          const out = {};
          for (const [cid, c] of Object.entries(comments)) {
            if (!isDict(c)) continue;
            if (commentSurvives(tgt, c, kept)) out[cid] = c;
          }
          st.unreachable_comments_removed += Object.keys(comments).length - Object.keys(out).length;
          tgt.comments = out;
        }
      });

      const usedBcIds = new Set(sentIds);
      const usedBcNames = new Set(sentNames);
      blocksByTi.forEach((blocks, ti) => {
        for (const [bid, blk] of Object.entries(blocks)) {
          if (!reachable[ti].has(bid) || !isDict(blk)) continue;
          const fv = (blk.fields || {}).BROADCAST_OPTION;
          if (isArr(fv) && fv.length) {
            if (isStr(fv[0])) usedBcNames.add(fv[0]);
            if (fv.length > 1 && isStr(fv[1])) usedBcIds.add(fv[1]);
          }
          addBroadcastValue(blk.inputs, ti);
        }
      });
      addAll(usedBcIds, sentIds);
      addAll(usedBcNames, sentNames);
      for (const tgt of targets) {
        if (!isDict(tgt) || !isDict(tgt.broadcasts)) continue;
        const out = {};
        for (const [bid, ent] of Object.entries(tgt.broadcasts)) {
          const name = isArr(ent) && ent.length ? ent[0] : ent;
          if ((isStr(bid) && usedBcIds.has(bid)) ||
              (isStr(name) && usedBcNames.has(name))) {
            out[bid] = ent;
          }
        }
        st.broadcasts_removed += Object.keys(tgt.broadcasts).length - Object.keys(out).length;
        tgt.broadcasts = out;
      }
    }

    _dropUnused(targets) {
      const st = this.stats;
      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        if (isDict(tgt.variables)) {
          let n = 0;
          for (const k of Object.keys(tgt.variables)) {
            if (!this.usedVarIds.has(k)) { delete tgt.variables[k]; n++; }
          }
          st.vars_removed += n;
        }
        if (isDict(tgt.lists)) {
          let n = 0;
          for (const k of Object.keys(tgt.lists)) {
            if (!this.usedListIds.has(k)) { delete tgt.lists[k]; n++; }
          }
          st.lists_removed += n;
        }
      }
    }

    _clearInitialValues(targets) {
      const st = this.stats;
      const self = this;
      const scripts = [];
      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        const blocks = tgt.blocks;
        if (!isDict(blocks)) continue;
        for (const [bid, blk] of Object.entries(blocks)) {
          if (!isDict(blk) || blk.topLevel !== true) continue;
          if (blk.opcode === "procedures_definition") {
            const nxt = blk.next;
            if (isStr(nxt) && has(blocks, nxt)) scripts.push([blocks, nxt]);
          } else {
            scripts.push([blocks, bid]);
          }
        }
      }

      const fieldMatches = (fv, kind, sid, sname) => {
        if (!isArr(fv) || !fv.length) return false;
        const fid = fv.length > 1 ? fv[1] : null;
        const table = kind === "v" ? self.varMap : self.listMap;
        if (isStr(fid) && fid === sid) return true;
        if (!isStr(fid) || !table.has(fid)) return fv[0] === sname;
        return false;
      };
      const primitiveMatches = (p, kind, sid, sname) => {
        if (!isArr(p) || !p.length) return false;
        if (kind === "v" && p[0] !== 12) return false;
        if (kind === "l" && p[0] !== 13) return false;
        const pid = p.length > 2 ? p[2] : null;
        const table = kind === "v" ? self.varMap : self.listMap;
        if (isStr(pid) && pid === sid) return true;
        if (!isStr(pid) || !table.has(pid)) return p.length > 1 && p[1] === sname;
        return false;
      };
      const reporterReads = (blocks, blk, kind, sid, sname, seen) => {
        if (!isDict(blk)) return false;
        const op = blk.opcode;
        const fields = blk.fields || {};
        if (kind === "v") {
          const fv = fields.VARIABLE;
          if (isArr(fv) && fieldMatches(fv, "v", sid, sname)) {
            // A set used as an expression is unusual, but reading is the safe
            // direction.
            return true;
          }
          if (op === "sensing_of") {
            const prop = fields.PROPERTY;
            if (isArr(prop) && prop.length && prop[0] === sname) return true;
          }
        } else {
          const fv = fields.LIST;
          if (isArr(fv) && fieldMatches(fv, "l", sid, sname)) return true;
        }
        const inputs = blk.inputs;
        if (isDict(inputs)) {
          for (const [key, value] of Object.entries(inputs)) {
            if (key === "SUBSTACK" || key === "SUBSTACK2") continue;
            if (exprReads(blocks, value, kind, sid, sname, seen)) return true;
          }
        }
        return false;
      };
      const exprReads = (blocks, value, kind, sid, sname, seen) => {
        if (!isArr(value)) return false;
        if (value.length && isInt(value[0]) && (value[0] === 12 || value[0] === 13)) {
          return primitiveMatches(value, kind, sid, sname);
        }
        for (const item of value) {
          if (isArr(item)) {
            if (exprReads(blocks, item, kind, sid, sname, seen)) return true;
          } else if (isStr(item) && has(blocks, item)) {
            if (seen.has(item)) continue;
            seen.add(item);
            if (reporterReads(blocks, blocks[item], kind, sid, sname, seen)) return true;
          }
        }
        return false;
      };
      const blockAccess = (blocks, blk, kind, sid, sname) => {
        if (!isDict(blk)) return [false, false, false];
        const op = blk.opcode;
        const fields = blk.fields || {};
        const inputs = blk.inputs || {};
        let inputReads = false;
        for (const [key, value] of Object.entries(inputs)) {
          if (key === "SUBSTACK" || key === "SUBSTACK2") continue;
          if (exprReads(blocks, value, kind, sid, sname, new Set())) {
            inputReads = true;
            break;
          }
        }
        let reads = inputReads;
        let writes = false;
        let pure = false;
        const fv = fields[kind === "v" ? "VARIABLE" : "LIST"];
        const matches = fieldMatches(fv, kind, sid, sname);
        if (kind === "v") {
          if (matches) {
            if (op === "data_setvariableto") {
              writes = true;
              // Reading the same variable in VALUE means the old value is
              // used, so this is not an initialization.
              pure = !inputReads;
            } else if (op === "data_changevariableby") {
              reads = true;
              writes = true;
            } else if (op === "control_for_each") {
              writes = true;
            } else if (op === "data_variable") {
              reads = true;
            } else if (op === "data_showvariable" || op === "data_hidevariable") {
              /* display only */
            } else {
              // Unknown extension block using a VARIABLE field.
              reads = true;
            }
          }
          if (op === "sensing_of") {
            const prop = fields.PROPERTY;
            if (isArr(prop) && prop.length && prop[0] === sname) reads = true;
          }
        } else if (matches) {
          if (op === "data_deletealloflist") {
            writes = true;
            pure = true;
          } else if (LIST_WRITE_OPS.has(op)) {
            writes = true;
          } else if (LIST_READ_OPS.has(op)) {
            reads = true;
          } else if (op === "data_showlist" || op === "data_hidelist") {
            /* display only */
          } else {
            reads = true;
          }
        }
        return [reads, writes, pure];
      };
      const successors = (blocks, blk) => {
        const out = [];
        const nxt = blk.next;
        if (isStr(nxt) && has(blocks, nxt)) out.push(nxt);
        const inputs = blk.inputs || {};
        for (const key of ["SUBSTACK", "SUBSTACK2"]) {
          const value = inputs[key];
          if (!isArr(value)) continue;
          for (let i = 1; i < value.length; i++) {
            if (isStr(value[i]) && has(blocks, value[i])) out.push(value[i]);
          }
        }
        return out;
      };
      const analyzeScript = (blocks, start, kind, sid, sname) => {
        let touched = false;
        let hasInit = false;
        const work = [[start, false]];
        const seen = new Set();
        while (work.length) {
          let [bid, initialized] = work.pop();
          const sKey = bid + "|" + (initialized ? 1 : 0);
          if (seen.has(sKey)) continue;
          seen.add(sKey);
          const blk = blocks[bid];
          if (!isDict(blk)) continue;
          const [reads, writes, pure] = blockAccess(blocks, blk, kind, sid, sname);
          if (reads || writes) touched = true;
          if (reads && !initialized) return [touched, false, hasInit];
          if (writes && pure) {
            initialized = true;
            hasInit = true;
          }
          for (const nxt of successors(blocks, blk)) work.push([nxt, initialized]);
        }
        return [touched, true, hasInit];
      };
      const eligible = (kind, sid) => {
        const used = kind === "v" ? self.usedVarIds : self.usedListIds;
        if (!used.has(sid)) return false;
        if (kind === "v") {
          if (self.varCloudIds.has(sid)) return false;
          if (self.displayVarIds.has(sid)) return false;
          if (self.unknownReadVarIds.has(sid)) return false;
        } else {
          if (self.displayListIds.has(sid)) return false;
          if (self.unknownReadListIds.has(sid)) return false;
        }
        return true;
      };
      const canClear = (kind, sid, sname) => {
        let touchedAny = false;
        let initializedAny = false;
        for (const [blocks, start] of scripts) {
          const [touched, safe, hasInit] = analyzeScript(blocks, start, kind, sid, sname);
          if (!touched) continue;
          touchedAny = true;
          if (!safe) return false;
          initializedAny = initializedAny || hasInit;
        }
        return touchedAny && initializedAny;
      };

      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        if (isDict(tgt.variables)) {
          for (const [vid, ent] of Object.entries(tgt.variables)) {
            if (!isArr(ent) || ent.length < 2) continue;
            if (!eligible("v", vid)) continue;
            if (ent[1] === "") continue;
            const oldSize = JSON.stringify(ent[1]);
            // Blanking must save a meaningful amount of JSON.  A short value
            // (a number, a boolean, "1") is barely shorter than "" while still
            // changing what the project stores, so leave those alone.
            if (!oldSize || oldSize.length < 6) continue;
            const name = ent.length ? ent[0] : this.varOrigName.get(vid);
            if (canClear("v", vid, name)) {
              ent[1] = "";
              st.vars_initialized += 1;
            }
          }
        }
        if (isDict(tgt.lists)) {
          for (const [lid, ent] of Object.entries(tgt.lists)) {
            if (!isArr(ent) || ent.length < 2) continue;
            if (!eligible("l", lid)) continue;
            if (isArr(ent[1]) && ent[1].length === 0) continue;
            const oldSize = JSON.stringify(ent[1]);
            if (!oldSize || oldSize.length < 6) continue;
            const name = ent.length ? ent[0] : this.listOrigName.get(lid);
            if (canClear("l", lid, name)) {
              ent[1] = [];
              st.lists_initialized += 1;
            }
          }
        }
      }
    }

    _renameStores(targets) {
      const dropV = this.options.removeUnused;
      const st = this.stats;
      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        if (isDict(tgt.variables) && Object.keys(tgt.variables).length) {
          const out = {};
          for (const [k, ent] of Object.entries(tgt.variables)) {
            if (dropV && this.droppedVarIds.has(k)) { st.vars_removed += 1; continue; }
            const m = this.varMap.get(k);
            if (!m) { out[k] = ent; continue; }
            out[m[0]] = [m[1], ...ent.slice(1)];
          }
          tgt.variables = out;
        }
        if (isDict(tgt.lists) && Object.keys(tgt.lists).length) {
          const out = {};
          for (const [k, ent] of Object.entries(tgt.lists)) {
            if (dropV && this.droppedListIds.has(k)) { st.lists_removed += 1; continue; }
            const m = this.listMap.get(k);
            if (!m) { out[k] = ent; continue; }
            out[m[0]] = [m[1], ...ent.slice(1)];
          }
          tgt.lists = out;
        }
        if (isDict(tgt.broadcasts) && Object.keys(tgt.broadcasts).length) {
          const out = {};
          for (const [k, ent] of Object.entries(tgt.broadcasts)) {
            const m = this.bcMap.get(k);
            if (!m) out[k] = ent;
            else if (isArr(ent)) out[m[0]] = [m[1], ...ent.slice(1)];
            else out[m[0]] = m[1];
          }
          tgt.broadcasts = out;
        }
      }
    }

    // ------------------------------------------------------------------
    _processTarget(tgt) {
      if (!isDict(tgt)) return;
      const o = this.options;
      const st = this.stats;
      if (o.stripDefaults) {
        for (const [key, dflt] of TARGET_DEFAULTS) {
          if (has(tgt, key) && looseEq(tgt[key], dflt)) {
            delete tgt[key];
            st.fields_removed += 1;
          }
        }
        for (const key of ["lists", "broadcasts", "comments"]) {
          if (has(tgt, key) && isDict(tgt[key]) && Object.keys(tgt[key]).length === 0) {
            delete tgt[key];
            st.fields_removed += 1;
          }
        }
        if (has(tgt, "layerOrder") && looseEq(tgt.layerOrder, this.layerExpect)) {
          delete tgt.layerOrder;
          this.layerExpect += 1;
          st.fields_removed += 1;
        }
        for (const cos of (isArr(tgt.costumes) ? tgt.costumes : [])) {
          if (!isDict(cos)) continue;
          // `bitmapResolution` is ignored for SVG costumes, but it is
          // load-bearing for bitmaps: scratch-vm doubles a bitmap only when it
          // sees exactly 1 (load-costume.js: `scale = bitmapResolution === 1 ?
          // 2 : 1`) and then records it as resolution 2.  Without the key the
          // pixels stay 1x while the costume is still treated as resolution 2,
          // so it renders at half size.  Drop it for SVG only.
          // `rotationCenterX/Y: 0` is never droppable: an explicit 0 is the
          // top-left corner, while a missing key makes the VM use the centre of
          // the image as the pivot.
          // `md5ext` is only redundant when it matches assetId.dataFormat, the
          // name the VM actually reads out of the zip.  Keep any other value so
          // an unusual project still loads the same file it did before.
          if (has(cos, "bitmapResolution") && isStr(cos.dataFormat) &&
              cos.dataFormat.toLowerCase() === "svg" && looseEq(cos.bitmapResolution, 1)) {
            delete cos.bitmapResolution;
            st.fields_removed += 1;
          }
          if (has(cos, "md5ext") && isStr(cos.assetId) && isStr(cos.dataFormat) &&
              cos.md5ext === `${cos.assetId}.${cos.dataFormat}`) {
            delete cos.md5ext;
            st.fields_removed += 1;
          }
          for (const key of ["rotationCenterX", "rotationCenterY"]) {
            const v = cos[key];
            if (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v)) {
              const r = Number(v.toFixed(4));
              if (r !== v) {
                cos[key] = r;
                st.float_values_rounded += 1;
              }
            }
          }
        }
      }

      const blocks = tgt.blocks;
      if (isDict(blocks) && Object.keys(blocks).length) this._dropDeadHideBlocks(blocks);
      this._extractTargetDuplicates(tgt);
      this._finalizeTargetBlocks(tgt, true);

      if (o.stripComments) this._stripComments(tgt);
      if (o.compactWorkspace) this._compactWorkspace(tgt);
    }

    _extractTargetDuplicates(tgt) {
      if (!isDict(tgt)) return;
      const blocks = tgt.blocks;
      if (!isDict(blocks) || !Object.keys(blocks).length) return;
      const o = this.options;
      if (o.extractDuplicates) this._extractDuplicates(blocks);
      if (o.nearDuplicates) this._extractNearDuplicates(blocks);
    }

    // Normalise the blocks a target has after a pass.  Extra optimization
    // passes reuse this with `rename = false`: their generated blocks already
    // have short ids, and renumbering every existing block once per pass would
    // inflate the reported rename count without making the project smaller.
    _finalizeTargetBlocks(tgt, rename) {
      if (!isDict(tgt)) return;
      const o = this.options;
      const blocks = tgt.blocks;
      let idMap = new Map();
      if (isDict(blocks) && Object.keys(blocks).length) {
        this._normalizeParentMarkers(blocks);
        this._normalizeMutations(blocks);
        if (o.compressProcs && rename) this._compressProcs(blocks);
        if (o.shortenIds) this._shortenArgumentIds(blocks);
        if (o.shortenIds && rename) {
          const pair = this._renameBlocks(blocks, tgt);
          tgt.blocks = pair[0];
          idMap = pair[1];
        } else {
          this._stripBlockDefaults(blocks);
        }
      }

      if (idMap.size && isDict(tgt.comments)) {
        for (const c of Object.values(tgt.comments)) {
          if (isDict(c) && isStr(c.blockId) && idMap.has(c.blockId)) {
            c.blockId = idMap.get(c.blockId);
          }
        }
      }

      const finalBlocks = tgt.blocks;
      const comments = tgt.comments;
      if (isDict(finalBlocks) && isDict(comments)) {
        const out = {};
        for (const [cid, c] of Object.entries(comments)) {
          if (!isDict(c)) continue;
          if (commentSurvives(tgt, c, finalBlocks)) out[cid] = c;
        }
        tgt.comments = out;
      }
    }

    static _isHatOpcode(op) {
      if (!isStr(op)) return false;
      return op === "control_start_as_clone" || op === "procedures_definition" ||
        op.startsWith("event_when");
    }

    _isHatOpcode(op) { return Compressor._isHatOpcode(op); }

    _chainIds(blocks, start, limit) {
      const out = [];
      const seen = new Set();
      let cur = start;
      while (isStr(cur) && has(blocks, cur) && !seen.has(cur) && out.length < limit) {
        const blk = blocks[cur];
        if (!isDict(blk)) break;
        out.push(cur);
        seen.add(cur);
        cur = blk.next;
      }
      return out;
    }

    _collectSubgraph(blocks, start, followNext = true) {
      const out = new Set();
      const stack = [[start, followNext]];
      while (stack.length) {
        const [bid, follow] = stack.pop();
        if (!isStr(bid) || out.has(bid) || !has(blocks, bid)) continue;
        out.add(bid);
        const blk = blocks[bid];
        if (!isDict(blk)) continue;
        if (isDict(blk.inputs)) {
          for (const value of Object.values(blk.inputs)) {
            if (!isArr(value)) continue;
            for (let i = 1; i < value.length; i++) {
              if (isStr(value[i]) && has(blocks, value[i])) stack.push([value[i], true]);
            }
          }
        }
        if (follow && isStr(blk.next)) stack.push([blk.next, true]);
      }
      return out;
    }

    _simplifyProject(project) {
      const targets = isArr(project.targets) ? project.targets : [];
      const o = this.options;
      if (o.simplifyIfElse) {
        for (const tgt of targets) {
          if (isDict(tgt) && isDict(tgt.blocks) && Object.keys(tgt.blocks).length) {
            this._simplifyIfElse(tgt.blocks);
          }
        }
      }
      if (o.removeNoops) {
        for (const tgt of targets) {
          if (isDict(tgt) && isDict(tgt.blocks) && Object.keys(tgt.blocks).length) {
            this._removeNoopProcedures(tgt.blocks);
          }
        }
        this._removeNoopBroadcasts(project);
      }
      if (o.inlineSingleCall) {
        for (const tgt of targets) {
          if (isDict(tgt) && isDict(tgt.blocks) && Object.keys(tgt.blocks).length) {
            this._inlineSingleCallProcs(tgt.blocks);
          }
        }
      }
      if (o.propagateConstants) this._propagateConstants(targets, project.monitors);
      if (o.foldConstants) {
        for (const tgt of targets) {
          if (isDict(tgt) && isDict(tgt.blocks) && Object.keys(tgt.blocks).length) {
            this._foldNumeric(tgt.blocks);
          }
        }
      }
      if (o.loopDuplicates) {
        for (const tgt of targets) {
          if (isDict(tgt) && isDict(tgt.blocks) && Object.keys(tgt.blocks).length) {
            this._loopizeConsecutive(tgt.blocks);
          }
        }
      }
    }

    _simplifyIfElse(blocks) {
      const st = this.stats;
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk) || blk.opcode !== "control_if_else") continue;
        const inputs = blk.inputs;
        if (!isDict(inputs)) continue;
        const branch = inputs.SUBSTACK2;
        let empty = branch === undefined || branch === null;
        if (isArr(branch)) {
          if (branch.length < 2 || branch[1] === null || branch[1] === undefined) empty = true;
          else if (isStr(branch[1]) && !has(blocks, branch[1])) empty = true;
        }
        if (!empty) continue;
        delete inputs.SUBSTACK2;
        blk.opcode = "control_if";
        st.ifelse_converted += 1;
      }
    }

    _dropDeadHideBlocks(blocks) {
      // "hide variable/list" for a store that removeUnused deleted does nothing
      // at run time, and keeping it would leave the output pointing at a store
      // that no longer exists.  Splice those blocks out.
      const dropped = new Set();
      for (const id of this.droppedVarIds) dropped.add(id);
      for (const id of this.droppedListIds) dropped.add(id);
      if (!dropped.size) return;
      const st = this.stats;
      for (const bid of Object.keys(blocks)) {
        const b = blocks[bid];
        if (!isDict(b)) continue;
        if (b.opcode !== "data_hidevariable" && b.opcode !== "data_hidelist") continue;
        const key = b.opcode === "data_hidevariable" ? "VARIABLE" : "LIST";
        const fv = (b.fields || {})[key];
        const fid = isArr(fv) && fv.length > 1 ? fv[1] : null;
        if (isStr(fid) && dropped.has(fid) && this._spliceOut(blocks, bid)) {
          st.dead_hide_blocks_removed += 1;
        }
      }
    }

    _chainIsNoop(blocks, first) {
      if (!isStr(first) || !has(blocks, first)) return true;
      const ids = this._chainIds(blocks, first, 100000);
      if (!ids.length) return true;
      for (const bid of ids) {
        const blk = blocks[bid];
        if (!isDict(blk) || blk.opcode !== "control_stop") return false;
        const fv = (blk.fields || {}).STOP_OPTION;
        if (!(isArr(fv) && fv.length && fv[0] === "this script")) return false;
      }
      return true;
    }

    _spliceOut(blocks, bid) {
      const blk = blocks[bid];
      if (!isDict(blk)) return false;
      let nxt = blk.next;
      nxt = isStr(nxt) && has(blocks, nxt) ? nxt : null;
      let parentId = blk.parent;
      const parent = isStr(parentId) ? blocks[parentId] : null;
      let linked = false;
      if (isDict(parent)) {
        if (parent.next === bid) {
          parent.next = nxt;
          linked = true;
        }
        if (isDict(parent.inputs)) {
          for (const value of Object.values(parent.inputs)) {
            if (isArr(value) && value.length > 1 && value[1] === bid) {
              value[1] = nxt;
              linked = true;
            }
          }
        }
        if (!linked) parentId = null;
      }
      if (!linked) {
        if (nxt !== null) {
          const nb = blocks[nxt];
          if (isDict(nb)) {
            nb.parent = null;
            nb.topLevel = true;
            if (has(blk, "x")) nb.x = blk.x;
            if (has(blk, "y")) nb.y = blk.y;
          }
        }
      } else if (nxt !== null) {
        const nb = blocks[nxt];
        if (isDict(nb)) nb.parent = parentId;
      }
      for (const x of this._collectSubgraph(blocks, bid, false)) delete blocks[x];
      return true;
    }

    _removeNoopProcedures(blocks) {
      const st = this.stats;
      for (let pass = 0; pass < 200; pass++) {
        const calls = new Map();
        for (const [bid, b] of Object.entries(blocks)) {
          if (!isDict(b)) continue;
          if (b.opcode === "procedures_call") {
            const code = (b.mutation || {}).proccode;
            if (!calls.has(code)) calls.set(code, []);
            calls.get(code).push(bid);
          }
        }
        const codeCount = new Map();
        const defs = [];
        for (const [bid, b] of Object.entries(blocks)) {
          if (!isDict(b) || b.opcode !== "procedures_definition") continue;
          const cb = (b.inputs || {}).custom_block;
          const pid = isArr(cb) && cb.length > 1 ? cb[1] : null;
          const proto = isStr(pid) ? blocks[pid] : null;
          const mut = (proto || {}).mutation || {};
          const code = mut.proccode;
          if (!isStr(code)) continue;
          codeCount.set(code, (codeCount.get(code) || 0) + 1);
          defs.push([bid, pid, code]);
        }
        const targets = [];
        for (const [hat, pid, code] of defs) {
          if ((codeCount.get(code) || 0) !== 1) continue;
          const body = blocks[hat].next;
          if (this._chainIsNoop(blocks, body)) targets.push([hat, pid, code, body]);
        }
        if (!targets.length) break;
        for (const [hat, pid, code, body] of targets) {
          for (const cid of [...(calls.get(code) || [])]) {
            if (has(blocks, cid) && this._spliceOut(blocks, cid)) st.noop_calls_removed += 1;
          }
          if (isStr(body) && has(blocks, body)) {
            for (const x of this._collectSubgraph(blocks, body, true)) delete blocks[x];
          }
          delete blocks[hat];
          if (isStr(pid)) delete blocks[pid];
          st.noop_procs_removed += 1;
        }
      }
    }

    _removeNoopBroadcasts(project) {
      const st = this.stats;
      const targets = isArr(project.targets) ? project.targets : [];
      const defs = new Map();
      for (const tgt of targets) {
        if (!isDict(tgt) || !isDict(tgt.broadcasts)) continue;
        for (const [bid, ent] of Object.entries(tgt.broadcasts)) {
          defs.set(bid, isArr(ent) && ent.length ? ent[0] : ent);
        }
      }
      const messageKey = (name, mid) => (isStr(mid) && defs.has(mid) ? mid : name);

      const effective = new Set();
      const noopReceivers = [];
      for (const tgt of targets) {
        if (!isDict(tgt) || !isDict(tgt.blocks)) continue;
        const blocks = tgt.blocks;
        for (const [bid, blk] of Object.entries(blocks)) {
          if (!isDict(blk) || blk.opcode !== "event_whenbroadcastreceived") continue;
          const fv = (blk.fields || {}).BROADCAST_OPTION;
          if (!isArr(fv) || !fv.length) continue;
          const name = isStr(fv[0]) ? fv[0] : null;
          const mid = fv.length > 1 && isStr(fv[1]) ? fv[1] : null;
          if (this._chainIsNoop(blocks, blk.next)) noopReceivers.push([blocks, bid]);
          else effective.add(messageKey(name, mid));
        }
      }
      for (const [blocks, hatId] of noopReceivers) {
        for (const x of this._collectSubgraph(blocks, hatId, true)) delete blocks[x];
        st.noop_receivers_removed += 1;
      }

      const sends = [];
      for (const tgt of targets) {
        if (!isDict(tgt) || !isDict(tgt.blocks)) continue;
        const blocks = tgt.blocks;
        for (const [bid, blk] of Object.entries(blocks)) {
          if (!isDict(blk) || (blk.opcode !== "event_broadcast" &&
              blk.opcode !== "event_broadcastandwait")) continue;
          let name = null, mid = null;
          const inp = (blk.inputs || {}).BROADCAST_INPUT;
          if (isArr(inp) && inp.length > 1 && isArr(inp[1])) {
            const arr = inp[1];
            if (arr.length > 1 && isStr(arr[1])) name = arr[1];
            if (arr.length > 2 && isStr(arr[2])) mid = arr[2];
          }
          if (!effective.has(messageKey(name, mid))) sends.push([blocks, bid]);
        }
      }
      for (const [blocks, bid] of sends) {
        if (this._spliceOut(blocks, bid)) st.noop_broadcasts_removed += 1;
      }

      const used = new Set();
      for (const tgt of targets) {
        if (!isDict(tgt) || !isDict(tgt.blocks)) continue;
        for (const blk of Object.values(tgt.blocks)) {
          if (!isDict(blk)) continue;
          const fv = (blk.fields || {}).BROADCAST_OPTION;
          if (isArr(fv) && fv.length) {
            if (isStr(fv[0])) used.add(fv[0]);
            if (fv.length > 1 && isStr(fv[1])) used.add(fv[1]);
          }
          if (blk.opcode === "event_broadcast" || blk.opcode === "event_broadcastandwait") {
            const inp = (blk.inputs || {}).BROADCAST_INPUT;
            if (isArr(inp) && inp.length > 1 && isArr(inp[1])) {
              const arr = inp[1];
              if (arr.length > 1 && isStr(arr[1])) used.add(arr[1]);
              if (arr.length > 2 && isStr(arr[2])) used.add(arr[2]);
            }
          }
        }
      }
      for (const tgt of targets) {
        if (!isDict(tgt) || !isDict(tgt.broadcasts)) continue;
        const out = {};
        for (const [bid, ent] of Object.entries(tgt.broadcasts)) {
          const name = isArr(ent) && ent.length ? ent[0] : ent;
          if (used.has(bid) || (isStr(name) && used.has(name))) out[bid] = ent;
        }
        const removed = Object.keys(tgt.broadcasts).length - Object.keys(out).length;
        if (removed) {
          st.noop_messages_removed += removed;
          tgt.broadcasts = out;
        }
      }
    }

    _containsThisScriptStop(blocks, start) {
      if (!isStr(start) || !has(blocks, start)) return false;
      for (const bid of this._collectSubgraph(blocks, start, true)) {
        const blk = blocks[bid];
        if (!isDict(blk) || blk.opcode !== "control_stop") continue;
        const fv = (blk.fields || {}).STOP_OPTION;
        if (isArr(fv) && fv.length && fv[0] === "this script") return true;
      }
      return false;
    }

    _enclosingDefinitionIsWarp(blocks, blockId) {
      const seen = new Set();
      let cur = isStr(blockId) ? blocks[blockId] : null;
      while (isDict(cur)) {
        const parent = cur.parent;
        if (!isStr(parent) || seen.has(parent) || !has(blocks, parent)) return false;
        seen.add(parent);
        const blk = blocks[parent];
        if (!isDict(blk)) return false;
        if (blk.opcode === "procedures_definition") {
          const cb = (blk.inputs || {}).custom_block;
          const pid = isArr(cb) && cb.length > 1 ? cb[1] : null;
          const proto = isStr(pid) ? blocks[pid] : null;
          const mut = (proto || {}).mutation || {};
          return String(mut.warp) === "true";
        }
        cur = blk;
      }
      return false;
    }

    _inlineSingleCallProcs(blocks) {
      const st = this.stats;
      for (;;) {
        const defs = [];
        const calls = new Map();
        for (const [bid, b] of Object.entries(blocks)) {
          if (!isDict(b)) continue;
          if (b.opcode === "procedures_call") {
            const code = (b.mutation || {}).proccode;
            if (!calls.has(code)) calls.set(code, []);
            calls.get(code).push(bid);
          } else if (b.opcode === "procedures_definition") {
            const cb = (b.inputs || {}).custom_block;
            const pid = isArr(cb) && cb.length > 1 ? cb[1] : null;
            const proto = isStr(pid) ? blocks[pid] : null;
            const mut = (proto || {}).mutation || {};
            defs.push([bid, pid, mut.proccode, mut]);
          }
        }
        const codeCount = new Map();
        for (const [, , code] of defs) {
          if (isStr(code)) codeCount.set(code, (codeCount.get(code) || 0) + 1);
        }

        let done = false;
        for (const [hat, pid, code, mut] of defs) {
          if (!isStr(code) || (codeCount.get(code) || 0) !== 1) continue;
          if (String(mut.warp) === "true") continue;
          const argIds = parseArray(mut.argumentids) || [];
          if (argIds.length) continue;
          const ids = calls.get(code) || [];
          if (ids.length !== 1) continue;
          const body = blocks[hat].next;
          if (!isStr(body) || !has(blocks, body)) continue;
          if (this._containsThisScriptStop(blocks, body)) continue;
          let hasArgReporter = false;
          for (const x of this._collectSubgraph(blocks, body, true)) {
            const xb = blocks[x];
            if (isDict(xb) && String(xb.opcode || "").startsWith("argument_reporter")) {
              hasArgReporter = true;
              break;
            }
          }
          if (hasArgReporter) continue;
          const callId = ids[0];
          const call = blocks[callId];
          if (!isDict(call)) continue;
          const parentId = call.parent;
          if (!isStr(parentId) || !has(blocks, parentId)) continue;
          if (this._enclosingDefinitionIsWarp(blocks, parentId)) continue;
          const parent = blocks[parentId];
          let replaced = false;
          if (parent.next === callId) {
            parent.next = body;
            replaced = true;
          }
          if (isDict(parent.inputs)) {
            for (const value of Object.values(parent.inputs)) {
              if (isArr(value) && value.length > 1 && value[1] === callId) {
                value[1] = body;
                replaced = true;
              }
            }
          }
          if (!replaced) continue;
          const chain = this._chainIds(blocks, body, 1000000);
          if (!chain.length) continue;
          const last = chain[chain.length - 1];
          let callNext = call.next;
          callNext = isStr(callNext) ? callNext : null;
          blocks[body].parent = parentId;
          blocks[last].next = callNext;
          if (callNext !== null && has(blocks, callNext)) blocks[callNext].parent = last;
          for (const x of this._collectSubgraph(blocks, callId, false)) delete blocks[x];
          delete blocks[hat];
          if (isStr(pid)) delete blocks[pid];
          st.procs_inlined += 1;
          done = true;
          break;
        }
        if (!done) break;
      }
    }

    // ------------------------------------------------------------------
    _literalNumber(entry) {
      if (!isArr(entry) || entry.length < 2) return 0;
      const item = entry[1];
      if (isArr(item)) {
        if (!item.length) return 0;
        if (item.length >= 2 && LITERAL_PRIMITIVE_TYPES.has(item[0])) return jsToNumber(item[1]);
        return null;
      }
      if (isStr(item)) return null;
      if (item === null || item === undefined) return 0;
      return jsToNumber(item);
    }

    _evalFoldable(blk) {
      const op = blk.opcode;
      const inputs = blk.inputs || {};
      if (op === "operator_add" || op === "operator_subtract" ||
          op === "operator_multiply" || op === "operator_divide" ||
          op === "operator_mod") {
        if (!("NUM1" in inputs) && !("NUM2" in inputs)) return null;
        const left = this._literalNumber(inputs.NUM1);
        const right = this._literalNumber(inputs.NUM2);
        if (left === null || right === null) return null;
        if (op === "operator_add") return left + right;
        if (op === "operator_subtract") return left - right;
        if (op === "operator_multiply") return left * right;
        if (op === "operator_divide") return left / right;
        let result = left % right;
        if (!Number.isNaN(result)) {
          if (result / right < 0) result += right;
        }
        return result;
      }
      if (op === "operator_round") {
        if (!("NUM" in inputs)) return null;
        const value = this._literalNumber(inputs.NUM);
        return value === null ? null : Math.round(value);
      }
      if (op === "operator_mathop") {
        if (!("NUM" in inputs)) return null;
        const value = this._literalNumber(inputs.NUM);
        if (value === null) return null;
        const fv = (blk.fields || {}).OPERATOR;
        const name = isArr(fv) && fv.length ? fv[0] : null;
        if (name === "abs") return Math.abs(value);
        if (name === "floor") return Math.floor(value);
        if (name === "ceiling") return Math.ceil(value);
        if (name === "sqrt") return Math.sqrt(value);
        return null;
      }
      return null;
    }

    _foldNumeric(blocks) {
      const st = this.stats;
      const foldable = new Set(["operator_add", "operator_subtract", "operator_multiply",
        "operator_divide", "operator_mod", "operator_round", "operator_mathop"]);
      const refs = new Map();
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk)) continue;
        for (const value of Object.values(blk.inputs || {})) {
          if (!isArr(value)) continue;
          for (let i = 1; i < value.length; i++) {
            if (isStr(value[i])) refs.set(value[i], (refs.get(value[i]) || 0) + 1);
          }
        }
      }
      for (let pass = 0; pass < 100000; pass++) {
        let changed = false;
        for (const [pid, parent] of Object.entries(blocks)) {
          if (!isDict(parent) || !isDict(parent.inputs)) continue;
          for (const [key, entry] of Object.entries(parent.inputs)) {
            if (!isArr(entry) || entry.length < 2 || !isStr(entry[1]) ||
                key.startsWith("SUBSTACK")) continue;
            const cid = entry[1];
            const child = blocks[cid];
            if (!isDict(child)) continue;
            if (!foldable.has(child.opcode)) continue;
            if (child.topLevel === true) continue;
            if (child.parent !== pid && child.parent !== null && child.parent !== undefined) continue;
            if ((refs.get(cid) || 0) !== 1) continue;
            const value = this._evalFoldable(child);
            if (value === null || Number.isNaN(value)) continue;
            const text = jsNumberStr(value);
            if (text === null || text.length > 64) continue;
            parent.inputs[key] = [1, [4, text]];
            for (const x of this._collectSubgraph(blocks, cid, false)) {
              delete blocks[x];
              refs.delete(x);
            }
            st.const_values_folded += 1;
            changed = true;
            break;
          }
          if (changed) break;
        }
        if (!changed) break;
      }
    }

    static _valueLiteral(value) {
      if (typeof value === "boolean") return null;
      if (typeof value === "number") {
        const text = jsNumberStr(value);
        return text === null ? null : [4, text];
      }
      if (typeof value === "string") return [10, value];
      return null;
    }

    static _setLiteral(blk) {
      const entry = (blk.inputs || {}).VALUE;
      if (!isArr(entry) || entry.length < 2) return null;
      const item = entry[1];
      if (!isArr(item) || !item.length) return null;
      const kind = item[0];
      if (kind === 4 || kind === 5 || kind === 6 || kind === 7 || kind === 8) {
        return [4, String(item.length > 1 ? item[1] : "0")];
      }
      if (kind === 10) return [10, String(item.length > 1 ? item[1] : "")];
      return null;
    }

    _propagateConstants(targets, monitors) {
      const st = this.stats;
      const store = new Map();
      for (const tgt of targets) {
        if (!isDict(tgt) || !isDict(tgt.variables)) continue;
        for (const [vid, ent] of Object.entries(tgt.variables)) {
          let name, value;
          if (isArr(ent) && ent.length) {
            name = ent[0];
            value = ent.length > 1 ? ent[1] : "";
          } else {
            name = String(ent); value = "";
          }
          store.set(vid, { tgt, name, value });
        }
      }
      if (!store.size) return;
      const storeKeys = new Set(store.keys());

      let bad = union(this.varCloudIds, this.displayVarIds, this.sensedVarIds,
        this.unknownReadVarIds);
      for (const mon of (isArr(monitors) ? monitors : [])) {
        if (!isDict(mon) || mon.opcode !== "data_variable") continue;
        const mid = mon.id;
        if (isStr(mid) && store.has(mid)) bad.add(mid);
        const pname = (mon.params || {}).VARIABLE;
        if (isStr(pname)) addAll(bad, this.varNameIds.get(pname) || new Set());
      }

      const refVid = (arr) => {
        if (!isArr(arr) || !arr.length || arr[0] !== 12) return null;
        const pid = arr.length > 2 ? arr[2] : null;
        if (isStr(pid) && store.has(pid)) return pid;
        const name = arr.length > 1 ? arr[1] : null;
        if (isStr(name)) {
          const ids = this.varNameIds.get(name);
          if (ids && ids.size === 1) {
            const vid = ids.values().next().value;
            if (store.has(vid)) return vid;
          }
        }
        return null;
      };
      const blockVid = (blk) => {
        const fv = (blk.fields || {}).VARIABLE;
        if (!isArr(fv) || !fv.length) return null;
        const fid = fv.length > 1 ? fv[1] : null;
        if (isStr(fid) && store.has(fid)) return fid;
        const name = fv[0];
        if (isStr(name)) {
          const ids = this.varNameIds.get(name);
          if (ids && ids.size === 1) {
            const vid = ids.values().next().value;
            if (store.has(vid)) return vid;
          }
        }
        return null;
      };

      const blocksByTgt = targets.map((tgt) =>
        (isDict(tgt) && isDict(tgt.blocks) ? tgt.blocks : {}));

      const writes = new Map();
      for (const blocks of blocksByTgt) {
        for (const blk of Object.values(blocks)) {
          if (!isDict(blk)) continue;
          const fv = (blk.fields || {}).VARIABLE;
          if (!isArr(fv) || !fv.length) continue;
          const op = blk.opcode;
          const fid = fv.length > 1 ? fv[1] : null;
          let ids;
          if (isStr(fid) && store.has(fid)) ids = new Set([fid]);
          else ids = intersect(this.varNameIds.get(fv[0]) || new Set(), storeKeys);
          if (!ids.size) continue;
          if (op === "data_setvariableto") {
            const pair = Compressor._setLiteral(blk);
            if (pair === null) addAll(bad, ids);
            else for (const vid of ids) {
              if (!writes.has(vid)) writes.set(vid, []);
              writes.get(vid).push(pair);
            }
          } else if (VAR_WRITE_OPS.has(op)) {
            addAll(bad, ids);
          } else if (op === "data_variable" || op === "data_showvariable" ||
              op === "data_hidevariable") {
            /* read or display only */
          } else {
            addAll(bad, ids);
          }
        }
      }

      const always = new Map();
      const dominated = new Map();
      for (const [vid, info] of store) {
        if (bad.has(vid)) continue;
        const init = Compressor._valueLiteral(info.value);
        const ws = writes.get(vid);
        if (ws === undefined) {
          if (init !== null) always.set(vid, init);
          continue;
        }
        if (!ws.length) continue;
        const first = ws[0];
        if (ws.some((w) => !pairEq(w, first))) continue;
        if (init !== null && pairEq(init, first)) always.set(vid, first);
        else dominated.set(vid, first);
      }
      if (!always.size && !dominated.size) return;

      const refCount = new Map();
      const countRefs = (node) => {
        if (isArr(node)) {
          if (node.length && node[0] === 12) {
            const vid = refVid(node);
            if (vid !== null) refCount.set(vid, (refCount.get(vid) || 0) + 1);
            return;
          }
          for (const item of node) countRefs(item);
        } else if (isDict(node)) {
          for (const value of Object.values(node)) countRefs(value);
        }
      };
      const inputRefs = new Map();
      for (const blocks of blocksByTgt) {
        for (const [bid, blk] of Object.entries(blocks)) {
          if (isArr(blk)) { countRefs(blk); continue; }
          if (!isDict(blk)) continue;
          if (blk.opcode === "data_variable") {
            const vid = blockVid(blk);
            if (vid !== null) refCount.set(vid, (refCount.get(vid) || 0) + 1);
          }
          countRefs(blk.inputs);
          for (const entry of Object.values(blk.inputs || {})) {
            if (!isArr(entry)) continue;
            for (let i = 1; i < entry.length; i++) {
              if (isStr(entry[i]) && has(blocks, entry[i])) {
                inputRefs.set(entry[i], (inputRefs.get(entry[i]) || 0) + 1);
              }
            }
          }
        }
      }

      const edits = new Map();
      const recordPrim = (owner, key, entry, vid, pair) => {
        const newEntry = [1, [pair[0], pair[1]]];
        if (!edits.has(vid)) edits.set(vid, []);
        edits.get(vid).push({
          inputs: owner, key, new: newEntry, remove: null,
          delta: jlen(newEntry) - jlen(entry)
        });
      };
      const recordBlock = (blocks, owner, key, entry, vid, bid, blk, pair) => {
        if ((inputRefs.get(bid) || 0) !== 1 || blk.next !== null && blk.next !== undefined) return;
        const newEntry = [1, [pair[0], pair[1]]];
        const delta = jlen(newEntry) - jlen(entry) - (jlen(bid) + jlen(blk) + 2);
        if (!edits.has(vid)) edits.set(vid, []);
        edits.get(vid).push({
          inputs: owner, key, new: newEntry, remove: bid, blocks, delta
        });
      };

      for (let ti = 0; ti < targets.length; ti++) {
        const tgt = targets[ti];
        const blocks = blocksByTgt[ti];
        if (!isDict(tgt) || !blocks || !Object.keys(blocks).length) continue;
        const done = new Set();

        const scanInputs = (blk, known, ownerId) => {
          const inputs = blk.inputs;
          if (!isDict(inputs)) return;
          for (const [key, entry] of Object.entries(inputs)) {
            if (!isArr(entry) || entry.length < 2) continue;
            if (key.startsWith("SUBSTACK")) continue;
            const child = entry[1];
            if (isArr(child)) {
              const vid = refVid(child);
              if (vid !== null && known.has(vid)) recordPrim(inputs, key, entry, vid, known.get(vid));
            } else if (isStr(child) && has(blocks, child)) {
              const cb = blocks[child];
              if (!isDict(cb) || done.has(child)) continue;
              if (cb.opcode === "data_variable") {
                const vid = blockVid(cb);
                if (vid !== null && known.has(vid)) {
                  recordBlock(blocks, inputs, key, entry, vid, child, cb, known.get(vid));
                }
              } else {
                done.add(child);
                scanInputs(cb, known, child);
              }
            }
          }
        };

        const walkChain = (start, known) => {
          let cur = start;
          const seen = new Set();
          while (isStr(cur) && has(blocks, cur) && !seen.has(cur) && !done.has(cur)) {
            seen.add(cur);
            const blk = blocks[cur];
            if (!isDict(blk)) break;
            done.add(cur);
            scanInputs(blk, known, cur);
            if (blk.opcode === "data_setvariableto") {
              const vid = blockVid(blk);
              if (vid !== null && dominated.has(vid) &&
                  pairEq(Compressor._setLiteral(blk), dominated.get(vid))) {
                known = new Map(known);
                known.set(vid, dominated.get(vid));
              }
            }
            for (const [key, entry] of Object.entries(blk.inputs || {})) {
              if (!key.startsWith("SUBSTACK")) continue;
              if (isArr(entry) && entry.length > 1 && isStr(entry[1])) {
                walkChain(entry[1], new Map(known));
              }
            }
            cur = blk.next;
          }
        };

        for (const [bid, blk] of Object.entries(blocks)) {
          if (!isDict(blk) || done.has(bid)) continue;
          const parent = blk.parent;
          if (blk.topLevel === true || !(isStr(parent) && has(blocks, parent))) {
            walkChain(bid, new Map(always));
          }
        }
      }

      for (const vid of [...edits.keys()]) {
        const items = edits.get(vid);
        const pair = always.get(vid);
        let total = items.reduce((sum, e) => sum + e.delta, 0);
        let dropStore = false;
        let variables = null;
        if (pair !== undefined && writes.get(vid) === undefined &&
            (refCount.get(vid) || 0) - items.length === 0) {
          const info = store.get(vid);
          variables = info.tgt.variables;
          if (isDict(variables) && has(variables, vid)) {
            total -= jlen(vid) + jlen(variables[vid]) + 2;
            dropStore = true;
          }
        }
        if (total >= 0) continue;
        for (const e of items) {
          e.inputs[e.key] = e.new;
          if (e.remove !== null) delete e.blocks[e.remove];
        }
        st.const_vars_inlined += 1;
        st.const_reads_inlined += items.length;
        if (dropStore) {
          delete variables[vid];
          this.usedVarIds.delete(vid);
          this.readVarIds.delete(vid);
          this.droppedVarIds.add(vid);
        }
      }
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // Reuse repeated reporter values through temporary variables.
    //
    // A reporter is only cached inside one `next` chain.  That keeps the
    // transformation local: the assignment sits immediately before the
    // statement that holds the first copy, and every other copy in the same
    // chain is dominated by it.  The gap between two copies is then checked
    // for writes to the values the reporter reads, for screen-refresh points,
    // and for blocks whose effects cannot be modelled.  Reporters that read
    // the clock, the date, the keyboard, the mouse, or another sprite are
    // only considered inside a warp ("run without screen refresh") definition.
    //
    // This runs after every target has been rewritten, so the before/after
    // size check below sees the final block and variable shapes.
    // ------------------------------------------------------------------
    _reuseReporters(targets) {
      const varsByTarget = new Map();
      const listsByTarget = new Map();
      const storeIds = new Set();
      let stage = null;

      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        if (tgt.isStage) stage = tgt;
        const vmap = new Map();
        const lmap = new Map();
        const variables = isDict(tgt.variables) ? tgt.variables : {};
        for (const [id, ent] of Object.entries(variables)) {
          storeIds.add(id);
          const name = isArr(ent) ? ent[0] : ent;
          if (!isStr(name)) continue;
          if (!vmap.has(name)) vmap.set(name, new Set());
          vmap.get(name).add(id);
        }
        const lists = isDict(tgt.lists) ? tgt.lists : {};
        for (const [id, ent] of Object.entries(lists)) {
          storeIds.add(id);
          const name = isArr(ent) ? ent[0] : ent;
          if (!isStr(name)) continue;
          if (!lmap.has(name)) lmap.set(name, new Set());
          lmap.get(name).add(id);
        }
        if (isStr(tgt.name)) {
          varsByTarget.set(tgt.name, vmap);
          listsByTarget.set(tgt.name, lmap);
        }
      }

      const ctx = { varsByTarget, listsByTarget, storeIds, targets, stage };
      for (const tgt of targets) {
        if (!isDict(tgt) || !isDict(tgt.blocks)) continue;
        if (!Object.keys(tgt.blocks).length) continue;
        if (this.cancelled()) throw new Error("Cancelled");
        this._reuseReportersInTarget(tgt, ctx);
      }
    }

    _reuseReportersInTarget(tgt, ctx) {
      const blocks = tgt.blocks;
      if (!isDict(blocks) || Object.keys(blocks).length < 2) return;
      const before = jlen({ blocks, variables: tgt.variables || {} });
      const hadVars = has(tgt, "variables");
      const snapshotBlocks = deepCopy(blocks);
      const snapshotVars = deepCopy(isDict(tgt.variables) ? tgt.variables : {});
      const snapshotComments = deepCopy(tgt.comments);
      const created = [];
      const pool = [];
      const applied = this._applyReporterReuse(blocks, tgt, ctx, created, pool);
      for (const temp of created) {
        if (temp.uses) continue;
        if (isDict(tgt.variables) && has(tgt.variables, temp.id)) delete tgt.variables[temp.id];
        ctx.storeIds.delete(temp.id);
      }
      if (!hadVars && isDict(tgt.variables) && !Object.keys(tgt.variables).length) {
        delete tgt.variables;
      }
      if (!applied) return;
      this._dropDetachedComments(tgt);
      const after = jlen({ blocks, variables: tgt.variables || {} });
      if (after >= before) {
        tgt.blocks = snapshotBlocks;
        if (hadVars) tgt.variables = snapshotVars;
        else delete tgt.variables;
        if (snapshotComments === undefined) delete tgt.comments;
        else tgt.comments = snapshotComments;
        for (const temp of created) ctx.storeIds.delete(temp.id);
        return;
      }
      this.stats.reporter_values_cached += applied.groups;
      this.stats.reporter_uses_reused += applied.uses;
      this.stats.temp_vars_created += created.length;
    }

    _dropDetachedComments(tgt) {
      if (!isDict(tgt.comments) || !isDict(tgt.blocks)) return;
      for (const [id, com] of Object.entries(tgt.comments)) {
        if (!isDict(com)) continue;
        const anchor = com.blockId;
        if (!isStr(anchor) || has(tgt.blocks, anchor)) continue;
        if (isTwConfigComment(tgt, com)) com.blockId = null;
        else delete tgt.comments[id];
      }
    }

    _applyReporterReuse(blocks, tgt, ctx, created, pool) {
      let groups = 0, uses = 0;
      for (let pass = 0; pass < 30; pass++) {
        if (this.cancelled()) throw new Error("Cancelled");
        const cands = this._reporterReuseCandidates(blocks, tgt, ctx);
        if (!cands.length) break;
        cands.sort((a, b) => (b.net - a.net) || (a.startOrder - b.startOrder));
        const group = cands[0];
        if (!this._reporterGroupStillValid(blocks, group)) break;
        const temp = this._tempVarForRange(tgt, ctx, pool, group, created);
        const info = this._applyReporterReuseGroup(blocks, group, temp, ctx);
        if (!info) break;
        temp.uses += 1;
        temp.lastStmt = group.lastStmt;
        groups += 1;
        uses += info.uses;
      }
      return groups ? { groups, uses } : null;
    }

    _reporterGroupStillValid(blocks, group) {
      if (!group || !isArr(group.occs) || !group.occs.length) return false;
      for (const occ of group.occs) {
        if (!isStr(occ.blockId) || !has(blocks, occ.blockId)) return false;
        if (!isArr(occ.entry) || occ.entry[occ.itemIndex] !== occ.blockId) return false;
        const stmt = group.chain.ids[occ.index];
        if (!isStr(stmt) || !has(blocks, stmt)) return false;
      }
      return true;
    }

    _tempVarForRange(tgt, ctx, pool, group, created) {
      let best = null;
      let bestOrder = -1;
      for (const temp of pool) {
        if (temp.script !== group.script) continue;
        if (!isStr(temp.lastStmt)) continue;
        const last = group.order.get(temp.lastStmt);
        const start = group.order.get(group.firstStmt);
        if (last === undefined || start === undefined) continue;
        if (last < start && last > bestOrder) {
          best = temp;
          bestOrder = last;
        }
      }
      if (best) return best;
      const temp = this._newTempVar(tgt, ctx, group.script);
      pool.push(temp);
      created.push(temp);
      return temp;
    }

    _newTempVar(tgt, ctx, script) {
      // The id is numbered across the whole project, not just this target: a
      // sprite resolves an id in its own map first and then in the stage's, so
      // reusing a stage id here would make the sprite's global reads resolve
      // to the temporary.  A sprite-local name only has to avoid the names its
      // scripts can see (its own and the stage's); a stage name additionally
      // has to avoid every sprite's name, or the editor reports a global/local
      // clash.
      const isStage = !!tgt.isStage || tgt === ctx.stage;
      const usedNames = new Set();
      const addNames = (target) => {
        if (!isDict(target)) return;
        for (const ent of Object.values(isDict(target.variables) ? target.variables : {})) {
          const n = isArr(ent) ? ent[0] : ent;
          if (isStr(n)) usedNames.add(n);
        }
      };
      if (isStage) {
        for (const target of ctx.targets) addNames(target);
      } else {
        addNames(tgt);
        addNames(ctx.stage);
      }
      const name = shortestFreeId(usedNames);
      const id = shortestFreeId(ctx.storeIds);
      if (!isDict(tgt.variables)) tgt.variables = {};
      tgt.variables[id] = [name, 0];
      ctx.storeIds.add(id);
      return { id, name, script, lastStmt: null, uses: 0 };
    }

    _newReuseBlockId(blocks) {
      return shortestFreeId(new Set(Object.keys(blocks)));
    }

    _reporterReuseCandidates(blocks, tgt, ctx) {
      const chains = this._reporterChains(blocks);
      if (!chains.length) return [];
      const orderInfo = this._reporterScriptOrder(blocks);
      const order = orderInfo.order;
      const canonCache = new Map();
      const memo = new Map();
      const out = [];

      for (const chain of chains) {
        const script = orderInfo.scriptOf.get(chain.head);
        if (!script) continue;
        const occs = [];
        for (let i = 0; i < chain.ids.length; i++) {
          const stmtId = chain.ids[i];
          const stmt = blocks[stmtId];
          if (!isDict(stmt)) continue;
          if (this._isHatOpcode(stmt.opcode)) continue;
          if (stmt.topLevel === true && !isStr(stmt.next)) continue;
          if (this._reporterStatementUnsafe(blocks, stmtId)) continue;
          this._collectReporterOccurrences(blocks, stmtId, i, occs, canonCache, memo, ctx);
        }
        if (occs.length < 2) continue;

        const groups = new Map();
        for (const occ of occs) {
          if (!groups.has(occ.sig)) groups.set(occ.sig, []);
          groups.get(occ.sig).push(occ);
        }
        for (const list of groups.values()) {
          if (list.length < 2) continue;
          list.sort((a, b) => (a.index - b.index) || (a.order - b.order));
          let run = [list[0]];
          const flush = () => {
            if (run.length < 2) return;
            const info = this._reporterCandidateInfo(chain, script, run, order);
            if (info) out.push(info);
          };
          for (let i = 1; i < list.length; i++) {
            if (this._reporterGapClean(blocks, chain, run[run.length - 1], list[i])) {
              run.push(list[i]);
            } else {
              flush();
              run = [list[i]];
            }
          }
          flush();
        }
      }
      return out;
    }

    _reporterChains(blocks) {
      const nextTargets = new Set();
      for (const blk of Object.values(blocks)) {
        if (isDict(blk) && isStr(blk.next) && has(blocks, blk.next)) nextTargets.add(blk.next);
      }
      const chains = [];
      for (const bid of Object.keys(blocks)) {
        if (!isDict(blocks[bid]) || nextTargets.has(bid)) continue;
        const ids = this._chainIds(blocks, bid, 1000000);
        if (ids.length) chains.push({ head: bid, ids });
      }
      return chains;
    }

    _reporterScriptOrder(blocks) {
      const order = new Map();
      const scriptOf = new Map();
      const visited = new Set();
      let n = 0;
      const visitChain = (start, script) => {
        for (const bid of this._chainIds(blocks, start, 1000000)) {
          if (visited.has(bid)) return;
          visited.add(bid);
          order.set(bid, n);
          scriptOf.set(bid, script);
          n += 1;
          const blk = blocks[bid];
          if (!isDict(blk) || !isDict(blk.inputs)) continue;
          for (const key of ["SUBSTACK", "SUBSTACK2"]) {
            const value = blk.inputs[key];
            if (isArr(value) && isStr(value[1]) && has(blocks, value[1])) {
              visitChain(value[1], script);
            }
          }
        }
      };
      for (const bid of Object.keys(blocks)) {
        const blk = blocks[bid];
        if (!isDict(blk)) continue;
        if (blk.topLevel === true || blk.parent === null) {
          if (visited.has(bid)) continue;
          visitChain(bid, bid);
        }
      }
      for (const bid of Object.keys(blocks)) {
        if (!isDict(blocks[bid]) || visited.has(bid)) continue;
        visitChain(bid, bid);
      }
      return { order, scriptOf };
    }

    _reporterStatementUnsafe(blocks, stmtId) {
      const stmt = blocks[stmtId];
      if (!isDict(stmt) || this._isHatOpcode(stmt.opcode)) return true;
      let unsafe = false;
      const seen = new Set();
      const visit = (bid) => {
        if (unsafe || !isStr(bid) || seen.has(bid) || !has(blocks, bid)) return;
        seen.add(bid);
        const blk = blocks[bid];
        if (!isDict(blk)) return;
        if (blk.shadow !== true && !REUSE_PURE_REPORTER_OPS.has(blk.opcode)) {
          unsafe = true;
          return;
        }
        if (!isDict(blk.inputs)) return;
        for (const [key, entry] of Object.entries(blk.inputs)) {
          if (key === "SUBSTACK" || key === "SUBSTACK2") continue;
          if (!isArr(entry)) continue;
          for (let i = 1; i < entry.length; i++) {
            if (isStr(entry[i])) visit(entry[i]);
          }
        }
      };
      if (isDict(stmt.inputs)) {
        for (const [key, entry] of Object.entries(stmt.inputs)) {
          if (key === "SUBSTACK" || key === "SUBSTACK2") continue;
          if (!isArr(entry)) continue;
          for (let i = 1; i < entry.length; i++) {
            if (isStr(entry[i])) visit(entry[i]);
          }
        }
      }
      return unsafe;
    }

    _collectReporterOccurrences(blocks, stmtId, index, out, canonCache, memo, ctx) {
      const stmt = blocks[stmtId];
      if (!isDict(stmt) || !isDict(stmt.inputs)) return;
      const seen = new Set();
      let order = 0;
      const visit = (bid, parentId, entry, itemIndex) => {
        if (!isStr(bid) || seen.has(bid) || !has(blocks, bid)) return;
        seen.add(bid);
        const blk = blocks[bid];
        if (!isDict(blk)) return;
        order += 1;
        if (blk.shadow !== true && blk.topLevel !== true) {
          let info = memo.get(bid);
          if (info === undefined) {
            info = this._reporterCandidateRoot(blocks, bid, ctx, canonCache);
            memo.set(bid, info);
          }
          if (info) {
            out.push({
              blockId: bid, parentId, entry, itemIndex, index, order,
              sig: info.sig, deps: info.deps, cost: info.cost, inWarp: info.inWarp
            });
          }
        }
        if (!isDict(blk.inputs)) return;
        for (const [key, childEntry] of Object.entries(blk.inputs)) {
          if (key === "SUBSTACK" || key === "SUBSTACK2") continue;
          if (!isArr(childEntry)) continue;
          for (let i = 1; i < childEntry.length; i++) {
            if (isStr(childEntry[i])) visit(childEntry[i], bid, childEntry, i);
          }
        }
      };
      for (const [key, entry] of Object.entries(stmt.inputs)) {
        if (key === "SUBSTACK" || key === "SUBSTACK2") continue;
        if (this._reporterInputReevaluated(stmt, key)) continue;
        if (!isArr(entry)) continue;
        for (let i = 1; i < entry.length; i++) {
          if (isStr(entry[i])) visit(entry[i], stmtId, entry, i);
        }
      }
    }

    _reporterInputReevaluated(stmt, key) {
      const op = stmt.opcode;
      if (key === "CONDITION") {
        return op === "control_repeat_until" || op === "control_while" ||
          op === "control_wait_until";
      }
      if (key === "VALUE") return op === "control_for_each";
      return false;
    }

    _reporterCandidateRoot(blocks, rootId, ctx, canonCache) {
      const root = blocks[rootId];
      if (!isDict(root) || root.shadow === true || root.topLevel === true) return null;
      if (!REUSE_REPORTER_OPS.has(root.opcode)) return null;
      const seen = new Set();
      const stack = [rootId];
      let cost = 0, nodes = 0;
      while (stack.length) {
        const bid = stack.pop();
        if (!isStr(bid) || seen.has(bid) || !has(blocks, bid)) continue;
        seen.add(bid);
        const blk = blocks[bid];
        if (!isDict(blk)) return null;
        if (isStr(blk.next) && blk.next) return null;
        if (blk.shadow === true) {
          // Menu and literal shadows are constants; they never run code.
        } else {
          if (blk.topLevel === true) return null;
          if (!REUSE_REPORTER_OPS.has(blk.opcode)) return null;
          nodes += 1;
        }
        cost += 4 + bid.length + JSON.stringify(blk).length;
        if (!isDict(blk.inputs)) continue;
        for (const [key, entry] of Object.entries(blk.inputs)) {
          if (key === "SUBSTACK" || key === "SUBSTACK2") return null;
          if (!isArr(entry)) continue;
          for (let i = 1; i < entry.length; i++) {
            const item = entry[i];
            if (isStr(item)) stack.push(item);
            else if (isArr(item)) cost += JSON.stringify(item).length;
          }
        }
      }
      if (!nodes) return null;
      const sig = this._canonicalBlock(blocks, rootId, canonCache, false);
      const deps = this._reporterDeps(blocks, rootId, ctx);
      const inWarp = this._enclosingDefinitionIsWarp(blocks, rootId);
      if (deps.frame && !inWarp) return null;
      return { cost, nodes, sig, deps, inWarp };
    }

    _reporterDeps(blocks, rootId, ctx) {
      const deps = {
        vars: new Set(), lists: new Set(), varNames: new Set(), listNames: new Set(),
        anyVar: false, anyList: false, state: false, frame: false
      };
      const seen = new Set();
      const addVar = (name, id) => {
        if (isStr(id)) deps.vars.add(id);
        if (isStr(name)) deps.varNames.add(name);
        if (!isStr(id) && !isStr(name)) deps.anyVar = true;
      };
      const addList = (name, id) => {
        if (isStr(id)) deps.lists.add(id);
        if (isStr(name)) deps.listNames.add(name);
        if (!isStr(id) && !isStr(name)) deps.anyList = true;
      };
      const fromArray = (value) => {
        if (!isArr(value) || !value.length) return;
        if (value[0] === 12) addVar(value[1], value[2]);
        else if (value[0] === 13) addList(value[1], value[2]);
      };
      const visit = (bid) => {
        if (!isStr(bid) || seen.has(bid) || !has(blocks, bid)) return;
        seen.add(bid);
        const blk = blocks[bid];
        if (!isDict(blk)) return;
        const op = blk.opcode;
        if (op === "data_variable") {
          const fv = (blk.fields || {}).VARIABLE;
          if (isArr(fv) && fv.length) addVar(fv[0], fv.length > 1 ? fv[1] : null);
          else deps.anyVar = true;
        } else if (LIST_READ_OPS.has(op)) {
          const fv = (blk.fields || {}).LIST;
          if (isArr(fv) && fv.length) addList(fv[0], fv.length > 1 ? fv[1] : null);
          else deps.anyList = true;
        } else if (op === "sensing_of") {
          deps.state = true;
          deps.frame = true;
          const pv = (blk.fields || {}).PROPERTY;
          const pname = isArr(pv) ? pv[0] : null;
          if (isStr(pname) && !SENSING_STAGE_PROPERTIES.has(pname) &&
              !SENSING_SPRITE_PROPERTIES.has(pname)) {
            let objName = this._reporterSensingObject(blocks, blk);
            if (objName === "_stage_") objName = this.stageName;
            const vscope = isStr(objName) ? ctx.varsByTarget.get(objName) : null;
            const lscope = isStr(objName) ? ctx.listsByTarget.get(objName) : null;
            const vids = vscope ? vscope.get(pname) : null;
            const lids = lscope ? lscope.get(pname) : null;
            if (vids) addAll(deps.vars, vids);
            else if (lids) addAll(deps.lists, lids);
            else { deps.anyVar = true; deps.anyList = true; }
            if (isStr(pname)) {
              deps.varNames.add(pname);
              deps.listNames.add(pname);
            }
          }
        } else if (op === "motion_xposition" || op === "motion_yposition" ||
                   op === "motion_direction" || op === "looks_size" ||
                   op === "looks_costumenumbername" || op === "looks_backdropnumbername" ||
                   op === "sound_volume") {
          deps.state = true;
        } else if (isStr(op) && op.startsWith("sensing_")) {
          deps.state = true;
          deps.frame = true;
        }
        if (!isDict(blk.inputs)) return;
        for (const entry of Object.values(blk.inputs)) {
          if (!isArr(entry)) continue;
          for (let i = 1; i < entry.length; i++) {
            const item = entry[i];
            if (isStr(item)) visit(item);
            else if (isArr(item)) fromArray(item);
          }
        }
      };
      visit(rootId);
      return deps;
    }

    _reporterSensingObject(blocks, blk) {
      const fv = (blk.fields || {}).OBJECT;
      if (isArr(fv) && isStr(fv[0])) return fv[0];
      const entry = (blk.inputs || {}).OBJECT;
      if (isArr(entry)) {
        for (let i = 1; i < entry.length; i++) {
          if (!isStr(entry[i]) || !has(blocks, entry[i])) continue;
          const menu = blocks[entry[i]];
          const mf = isDict(menu) ? (menu.fields || {}).OBJECT : null;
          if (isArr(mf) && isStr(mf[0])) return mf[0];
        }
      }
      return null;
    }

    _reporterCandidateInfo(chain, script, run, order) {
      const first = run[0], last = run[run.length - 1];
      const firstStmt = chain.ids[first.index];
      const lastStmt = chain.ids[last.index];
      const startOrder = order.get(firstStmt);
      if (startOrder === undefined || order.get(lastStmt) === undefined) return null;
      const n = run.length;
      const readCost = 70, setCost = 130, varCost = 30;
      const net = (n - 1) * first.cost - n * readCost - setCost - varCost;
      if (net <= 0) return null;
      return {
        chain, script, occs: run, deps: first.deps, cost: first.cost, net,
        firstStmt, lastStmt, startOrder, order
      };
    }

    _reporterGapClean(blocks, chain, prev, cur) {
      if (prev.index === cur.index) return true;
      const deps = prev.deps;
      const inWarp = prev.inWarp;
      const state = {
        universal: false, state: false, frame: false,
        vars: new Set(), varNames: new Set(), lists: new Set(), listNames: new Set(),
        anyVarWrite: false, anyListWrite: false
      };
      const seen = new Set();
      const scanNode = (bid) => {
        if (state.universal || !isStr(bid) || seen.has(bid) || !has(blocks, bid)) return;
        seen.add(bid);
        const blk = blocks[bid];
        if (!isDict(blk)) return;
        if (blk.shadow !== true) this._scanReporterEffect(blk, state, inWarp);
        if (state.universal || !isDict(blk.inputs)) return;
        for (const [key, entry] of Object.entries(blk.inputs)) {
          if (!isArr(entry)) continue;
          if (key === "SUBSTACK" || key === "SUBSTACK2") continue;
          for (let i = 1; i < entry.length; i++) {
            const item = entry[i];
            if (isStr(item)) scanNode(item);
          }
        }
      };
      const scanStatement = (bid) => {
        if (state.universal || !isStr(bid)) return;
        scanNode(bid);
        const blk = blocks[bid];
        if (state.universal || !isDict(blk) || !isDict(blk.inputs)) return;
        for (const key of ["SUBSTACK", "SUBSTACK2"]) {
          const value = blk.inputs[key];
          if (!isArr(value) || !isStr(value[1])) continue;
          for (const sid of this._chainIds(blocks, value[1], 1000000)) scanStatement(sid);
        }
      };
      for (let i = prev.index; i < cur.index; i++) {
        scanStatement(chain.ids[i]);
        if (state.universal) return false;
      }
      if (this._reporterStatementUnsafe(blocks, chain.ids[cur.index])) return false;
      if (deps.state && state.state) return false;
      if (deps.frame && (state.frame || !inWarp)) return false;
      if (deps.anyVar && state.anyVarWrite) return false;
      if (deps.anyList && state.anyListWrite) return false;
      for (const id of state.vars) if (deps.vars.has(id)) return false;
      for (const name of state.varNames) if (deps.varNames.has(name)) return false;
      for (const id of state.lists) if (deps.lists.has(id)) return false;
      for (const name of state.listNames) if (deps.listNames.has(name)) return false;
      return true;
    }

    _scanReporterEffect(blk, state, inWarp) {
      const op = blk.opcode;
      if (!isStr(op)) { state.universal = true; return; }
      if (REUSE_PURE_REPORTER_OPS.has(op)) return;
      if (op === "control_repeat" || op === "control_forever" ||
          op === "control_repeat_until" || op === "control_while" ||
          op === "control_for_each") {
        if (!inWarp) { state.universal = true; return; }
      }
      if (op === "data_setvariableto" || op === "data_changevariableby" ||
          op === "control_for_each") {
        const fv = (blk.fields || {}).VARIABLE;
        state.anyVarWrite = true;
        if (isArr(fv) && fv.length) {
          if (isStr(fv[1])) state.vars.add(fv[1]);
          if (isStr(fv[0])) state.varNames.add(fv[0]);
        }
        return;
      }
      if (LIST_WRITE_OPS.has(op)) {
        const fv = (blk.fields || {}).LIST;
        state.anyListWrite = true;
        if (isArr(fv) && fv.length) {
          if (isStr(fv[1])) state.lists.add(fv[1]);
          if (isStr(fv[0])) state.listNames.add(fv[0]);
        }
        return;
      }
      if (op === "data_showvariable" || op === "data_hidevariable" ||
          op === "data_showlist" || op === "data_hidelist") return;
      if (op === "sensing_resettimer") { state.frame = true; return; }
      if (op === "sensing_setdragmode") return;
      if (op === "control_if" || op === "control_if_else" ||
          op === "control_all_at_once") return;
      if (REUSE_YIELD_OPS.has(op)) { state.universal = true; return; }
      if (op === "event_broadcast" || op === "event_broadcastandwait") {
        state.universal = true;
        return;
      }
      if (op === "control_create_clone_of") { state.state = true; return; }
      if (op.startsWith("sensing_")) { state.frame = true; state.state = true; return; }
      if (op.startsWith("motion_") || op.startsWith("looks_") || op.startsWith("sound_")) {
        state.state = true;
        return;
      }
      if (op.startsWith("argument_reporter") || this._isHatOpcode(op)) return;
      state.universal = true;
    }

    _applyReporterReuseGroup(blocks, group, temp, ctx) {
      const occs = group.occs;
      const first = occs[0];
      const stmtId = group.chain.ids[first.index];
      if (!isStr(stmtId) || !has(blocks, stmtId)) return null;
      for (const occ of occs) {
        if (!isArr(occ.entry) || occ.entry[occ.itemIndex] !== occ.blockId) return null;
      }
      const stmt = blocks[stmtId];
      if (!isDict(stmt)) return null;

      const setId = this._newReuseBlockId(blocks);
      const setBlk = {
        opcode: "data_setvariableto",
        next: stmtId,
        parent: null,
        inputs: { VALUE: [2, first.blockId] },
        fields: { VARIABLE: [temp.name, temp.id] }
      };

      const parentId = stmt.parent;
      const parent = isStr(parentId) && has(blocks, parentId) ? blocks[parentId] : null;
      let linked = false;
      if (isDict(parent)) {
        if (parent.next === stmtId) {
          parent.next = setId;
          setBlk.parent = parentId;
          linked = true;
        }
        if (!linked && isDict(parent.inputs)) {
          for (const entry of Object.values(parent.inputs)) {
            if (isArr(entry) && entry.length > 1 && entry[1] === stmtId) {
              entry[1] = setId;
              setBlk.parent = parentId;
              linked = true;
              break;
            }
          }
        }
      }
      if (!linked) {
        if (stmt.topLevel !== true) return null;
        setBlk.topLevel = true;
        if (has(stmt, "x")) { setBlk.x = stmt.x; delete stmt.x; }
        if (has(stmt, "y")) { setBlk.y = stmt.y; delete stmt.y; }
        delete stmt.topLevel;
      }
      stmt.parent = setId;
      blocks[setId] = setBlk;

      for (const occ of occs) {
        const readId = this._newReuseBlockId(blocks);
        const read = {
          opcode: "data_variable",
          parent: occ.parentId,
          fields: { VARIABLE: [temp.name, temp.id] }
        };
        blocks[readId] = read;
        occ.entry[occ.itemIndex] = readId;
        if (occ === first) {
          const root = blocks[occ.blockId];
          if (isDict(root)) root.parent = setId;
        } else {
          for (const bid of this._collectSubgraph(blocks, occ.blockId, false)) delete blocks[bid];
        }
      }
      return { uses: occs.length };
    }

    _freeze(value) {
      if (isDict(value)) {
        const keys = Object.keys(value).sort();
        return "{" + keys.map((k) => JSON.stringify(k) + ":" + this._freeze(value[k])).join(",") + "}";
      }
      if (isArr(value)) return "[" + value.map((v) => this._freeze(v)).join(",") + "]";
      if (isStr(value)) return "s" + JSON.stringify(value);
      if (typeof value === "number") return "n" + String(value);
      if (typeof value === "boolean") return value ? "b1" : "b0";
      if (value === null || value === undefined) return "z";
      return "?" + String(value);
    }

    _hashCanon(parts) {
      // Signatures are compared for exact equality, so a 64-bit structural
      // hash keeps long `next` chains from duplicating whole suffix strings.
      const s = JSON.stringify(parts);
      let h1 = 0x811c9dc5;
      let h2 = 0x9e3779b9;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
        h2 = (h2 ^ (h2 >>> 13)) >>> 0;
      }
      return h1.toString(16).padStart(8, "0") +
        h2.toString(16).padStart(8, "0") + ":" + s.length.toString(36);
    }

    _canonicalBlock(blocks, bid, cache, includeNext = false, stack = new Set()) {
      const key = bid + "|" + (includeNext ? 1 : 0);
      if (cache.has(key)) return cache.get(key);
      if (stack.has(bid)) return "cycle";
      const blk = blocks[bid];
      let out;
      if (isArr(blk)) {
        out = "prim:" + this._hashCanon(this._freeze(blk));
        cache.set(key, out);
        return out;
      }
      if (!isDict(blk)) return "missing";
      const nstack = new Set(stack);
      nstack.add(bid);
      const fieldKeys = Object.keys(blk.fields || {}).sort();
      const fields = fieldKeys.map((k) => [k, this._freeze(blk.fields[k])]);
      const inputKeys = Object.keys(blk.inputs || {}).sort();
      const inputs = [];
      for (const k of inputKeys) {
        const value = blk.inputs[k];
        if (!isArr(value)) {
          inputs.push([k, ["value", this._freeze(value)]]);
          continue;
        }
        const items = [];
        for (const item of value) {
          if (isStr(item) && has(blocks, item)) {
            items.push(["ref", this._canonicalBlock(blocks, item, cache, true, nstack)]);
          } else if (isArr(item)) {
            items.push(["list", this._freeze(item)]);
          } else {
            items.push(["value", item === undefined ? null : item]);
          }
        }
        inputs.push([k, items]);
      }
      const parts = ["B", blk.opcode === undefined ? null : blk.opcode, fields, inputs,
        this._freeze(blk.mutation || {}), !!blk.shadow];
      if (includeNext) {
        const nxt = blk.next;
        parts.push(isStr(nxt) && has(blocks, nxt)
          ? this._canonicalBlock(blocks, nxt, cache, true, nstack)
          : null);
      }
      out = this._hashCanon(parts);
      cache.set(key, out);
      return out;
    }

    _loopizeConsecutive(blocks) {
      const st = this.stats;
      if (!isDict(blocks) || Object.keys(blocks).length < 3) return;
      for (let pass = 0; pass < 200; pass++) {
        const cache = new Map();
        const nextTargets = new Set();
        for (const blk of Object.values(blocks)) {
          if (isDict(blk) && isStr(blk.next)) nextTargets.add(blk.next);
        }
        const starts = Object.keys(blocks).filter((bid) => !nextTargets.has(bid) && isDict(blocks[bid]));
        let best = null;
        for (const start of starts) {
          let chain, firstIndex;
          if (Compressor._isHatOpcode(blocks[start].opcode)) {
            chain = this._chainIds(blocks, start, 100000);
            if (!chain.length) continue;
            firstIndex = 1;
          } else {
            chain = this._chainIds(blocks, start, 100000);
            firstIndex = 0;
            if (blocks[start].topLevel === true) firstIndex = 1;
          }
          if (chain.length - firstIndex < 2) continue;
          const keys = chain.map((bid) => this._canonicalBlock(blocks, bid, cache, false));
          const limit = Math.min(40, chain.length);
          for (let i = firstIndex; i < chain.length - 1; i++) {
            const maxL = Math.min(limit, Math.floor((chain.length - i) / 2));
            for (let length = 1; length <= maxL; length++) {
              let count = 1;
              while (i + (count + 1) * length <= chain.length) {
                let ok = true;
                for (let j = 0; j < length; j++) {
                  if (keys[i + count * length + j] !== keys[i + j]) { ok = false; break; }
                }
                if (!ok) break;
                count++;
              }
              if (count < 2) continue;
              const removed = new Set();
              for (let k = 1; k < count; k++) {
                for (const bid of chain.slice(i + k * length, i + (k + 1) * length)) {
                  addAll(removed, this._collectSubgraph(blocks, bid, false));
                }
              }
              for (const bid of chain.slice(i, i + length)) removed.delete(bid);
              const saved = removed.size;
              if (saved < 2) continue;
              const score = [saved, length, count];
              if (best === null || cmpTuple(score, best.score) > 0) {
                best = { score, chain, i, length, count, removed };
              }
            }
          }
        }
        if (best === null) return;
        const { chain, i, length, count, removed } = best;
        const saved = best.score[0];
        const first = chain[i];
        const lastFirstUnit = chain[i + length - 1];
        const last = chain[i + length * count - 1];
        const parentId = blocks[first].parent;
        if (!isStr(parentId) || !has(blocks, parentId)) return;
        let cont = blocks[last].next;
        cont = isStr(cont) && has(blocks, cont) ? cont : null;
        const before = deepCopy(blocks);
        let rid;
        let n = 0;
        do { n += 1; rid = encodeId(n); } while (has(blocks, rid));
        const rep = {
          opcode: "control_repeat",
          next: cont,
          parent: parentId,
          inputs: {
            TIMES: [1, [6, String(count)]],
            SUBSTACK: [2, first]
          },
          fields: {},
          shadow: false,
          topLevel: false
        };
        blocks[rid] = rep;
        blocks[first].parent = rid;
        blocks[lastFirstUnit].next = null;
        const parent = blocks[parentId];
        if (parent.next === first) {
          parent.next = rid;
        } else {
          for (const value of Object.values(parent.inputs || {})) {
            if (isArr(value) && value.length > 1 && value[1] === first) value[1] = rid;
          }
        }
        if (cont !== null) blocks[cont].parent = rid;
        for (const bid of removed) delete blocks[bid];
        const oldSize = jlen(before);
        const newSize = jlen(blocks);
        if (newSize >= oldSize) {
          for (const k of Object.keys(blocks)) delete blocks[k];
          Object.assign(blocks, before);
          return;
        }
        st.loops_created += 1;
        st.loop_blocks_saved += saved;
      }
    }

    /*
     * Collect the argument reporters inside the given roots, in a stable order,
     * so a merged copy can turn them into parameters of the generated block.
     *
     * A root's own `next` chain is deliberately not scanned: `_findDuplicateGroup`
     * passes every block of the chain explicitly, and `_findNearDuplicateGroup`
     * passes one block whose `next` belongs to the surrounding script, not to
     * the subtree being merged.  Nested chains are different: when we descend
     * into a C-block's SUBSTACK, everything below it (including the following
     * blocks of that substack) is copied along, so those `next` chains have to
     * be scanned as well.  Missing them left argument reporters inside the
     * generated procedure, where they no longer named a parameter and read as
     * an empty string.
     */
    _chainArgumentParams(blocks, ids) {
      const params = [];
      const kinds = new Map();
      const scan = (bid, stack, follow) => {
        if (!isStr(bid) || !has(blocks, bid) || stack.has(bid)) return true;
        const blk = blocks[bid];
        if (!isDict(blk)) return true;
        const op = blk.opcode;
        if (op === "argument_reporter_string_number" || op === "argument_reporter_boolean") {
          const fv = (blk.fields || {}).VALUE;
          const name = isArr(fv) && fv.length ? fv[0] : null;
          if (!isStr(name) || !name) return false;
          const isBool = op === "argument_reporter_boolean";
          if (kinds.has(name)) {
            if (kinds.get(name) !== isBool) return false;
          } else {
            kinds.set(name, isBool);
            params.push([name, isBool]);
          }
          return true;
        }
        const nextStack = new Set(stack);
        nextStack.add(bid);
        if (isDict(blk.inputs)) {
          for (const key of Object.keys(blk.inputs).sort()) {
            const value = blk.inputs[key];
            if (!isArr(value)) continue;
            for (let i = 1; i < value.length; i++) {
              const item = value[i];
              if (isStr(item) && has(blocks, item)) {
                if (!scan(item, nextStack, true)) return false;
              }
            }
          }
        }
        if (follow && isStr(blk.next) && has(blocks, blk.next)) {
          if (!scan(blk.next, nextStack, true)) return false;
        }
        return true;
      };
      for (const bid of ids) {
        if (!scan(bid, new Set(), false)) return null;
      }
      return params;
    }

    _paramsEq(a, b) {
      if (!a || !b || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
      }
      return true;
    }

    _findDuplicateGroup(blocks, banned) {
      if (!isDict(blocks)) return null;
      banned = banned || new Set();
      const canonCache = new Map();
      const chainCache = new Map();
      const paramCache = new Map();
      const canonBlock = (bid, includeNext, stack) =>
        this._canonicalBlock(blocks, bid, canonCache, includeNext, stack || new Set());
      const seqKey = (ids) => JSON.stringify(ids.map((bid) => canonBlock(bid, false)));
      const chainParams = (ids) => {
        const ck = JSON.stringify(ids);
        if (!paramCache.has(ck)) paramCache.set(ck, this._chainArgumentParams(blocks, ids));
        return paramCache.get(ck);
      };
      const chainOf = (bid) => {
        if (!chainCache.has(bid)) chainCache.set(bid, this._chainIds(blocks, bid, 100000));
        return chainCache.get(bid);
      };
      const commonLength = (a, b) => {
        const ca = chainOf(a);
        const cb = chainOf(b);
        let n = 0;
        while (n < ca.length && n < cb.length &&
               canonBlock(ca[n], false) === canonBlock(cb[n], false)) n++;
        return [n, ca, cb];
      };

      const groups = new Map();
      const warpBodies = new Set();
      const owners = new Map();
      const ownerConflicts = new Set();
      const defArgNames = new Map();
      for (const [bid, blk] of Object.entries(blocks)) {
        if (!isDict(blk) || blk.opcode !== "procedures_definition") continue;
        const cb = (blk.inputs || {}).custom_block;
        const pid = isArr(cb) && cb.length > 1 ? cb[1] : null;
        const proto = isStr(pid) ? blocks[pid] : null;
        const mut = (proto || {}).mutation || {};
        const names = parseArray(mut.argumentnames) || [];
        defArgNames.set(bid, new Set(names.filter(isStr)));
        const body = blk.next;
        if (isStr(body) && has(blocks, body)) {
          for (const cid of this._collectSubgraph(blocks, body, true)) {
            if (owners.has(cid) && owners.get(cid) !== bid) ownerConflicts.add(cid);
            else owners.set(cid, bid);
          }
        }
        if (mut.warp === true || mut.warp === "true") {
          const wbody = blk.next;
          if (isStr(wbody) && has(blocks, wbody)) {
            addAll(warpBodies, this._collectSubgraph(blocks, wbody, true));
          }
        }
      }
      for (const cid of ownerConflicts) owners.delete(cid);

      const reporterIds = new Set();
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk) || !isDict(blk.inputs)) continue;
        for (const [key, value] of Object.entries(blk.inputs)) {
          if (!isArr(value) || value.length < 2 || !isStr(value[1])) continue;
          if (key !== "SUBSTACK" && key !== "SUBSTACK2") reporterIds.add(value[1]);
        }
      }

      for (const [bid, blk] of Object.entries(blocks)) {
        if (!isDict(blk) || blk.shadow === true) continue;
        const op = blk.opcode;
        if (!isStr(op) || EXTRACT_EXCLUDE_OPS.has(op)) continue;
        if (op.startsWith("argument_reporter")) continue;
        if (reporterIds.has(bid)) continue;
        if (Compressor._isHatOpcode(op)) continue;
        const ids = this._chainIds(blocks, bid, 1);
        if (ids.length < 1) continue;
        const context = warpBodies.has(bid);
        const sig = seqKey(ids);
        const key = (context ? "1" : "0") + "\u0000" + sig;
        if (!groups.has(key)) groups.set(key, { context, sig, starts: [] });
        groups.get(key).starts.push(bid);
      }

      let best = null;
      for (const group of groups.values()) {
        const { context, sig, starts } = group;
        if (starts.length < 2) continue;
        const base = starts[0];
        const pairResults = [];
        for (let oi = 1; oi < starts.length; oi++) {
          const [length, ca, cb] = commonLength(base, starts[oi]);
          if (length < 1) continue;
          if (setHasIntersection(new Set(ca.slice(0, length)), new Set(cb.slice(0, length)))) continue;
          pairResults.push([length, base, starts[oi]]);
        }
        if (starts.length > 2) {
          for (let i = 1; i < Math.min(starts.length, 8); i++) {
            for (let j = i + 1; j < Math.min(starts.length, 12); j++) {
              const [length, ca, cb] = commonLength(starts[i], starts[j]);
              if (length >= 1 &&
                  !setHasIntersection(new Set(ca.slice(0, length)), new Set(cb.slice(0, length)))) {
                pairResults.push([length, starts[i], starts[j]]);
              }
            }
          }
        }
        for (const [length, a, b] of pairResults) {
          const idsA = this._chainIds(blocks, a, length);
          const idsB = this._chainIds(blocks, b, length);
          if (idsA.length < length || idsB.length < length) continue;
          const key = seqKey(idsA);
          if (key !== seqKey(idsB)) continue;
          const subA = new Set();
          for (const cid of idsA) addAll(subA, this._collectSubgraph(blocks, cid, false));
          let bad = false;
          for (const cid of subA) {
            const cb = blocks[cid];
            if (!isDict(cb)) continue;
            const op = cb.opcode;
            if (!isStr(op) || EXTRACT_FORBIDDEN_OPS.has(op) || Compressor._isHatOpcode(op)) {
              bad = true; break;
            }
          }
          if (bad) continue;
          const params = chainParams(idsA);
          if (params === null) continue;
          let owner = null;
          if (params.length) {
            owner = owners.get(a);
            if (owner === undefined) continue;
            const known = defArgNames.get(owner) || new Set();
            if (params.some(([name]) => !known.has(name))) continue;
          }

          const selected = [];
          const used = new Set();
          for (const cand of starts) {
            const cids = this._chainIds(blocks, cand, length);
            if (cids.length < length || seqKey(cids) !== key) continue;
            if (params.length) {
              if (owners.get(cand) !== owner) continue;
              if (!this._paramsEq(chainParams(cids), params)) continue;
            }
            const csub = new Set();
            for (const cid of cids) addAll(csub, this._collectSubgraph(blocks, cid, false));
            if (setHasIntersection(csub, used)) continue;
            selected.push(cand);
            addAll(used, csub);
          }
          if (selected.length < 2) continue;
          const copyBlocks = new Set();
          for (const cid of this._chainIds(blocks, selected[0], length)) {
            addAll(copyBlocks, this._collectSubgraph(blocks, cid, false));
          }
          const blocksPerCopy = copyBlocks.size;
          const savings = (selected.length - 1) * blocksPerCopy -
            selected.length - 2 - selected.length * params.length;
          if (savings <= 0) continue;
          const score = [savings, length, selected.length];
          const candSig = (context ? "1" : "0") + "\u0000" + length + "\u0000" + key;
          if (banned.has(candSig)) continue;
          if (best === null || cmpTuple(score, best.score) > 0) {
            best = { score, selected, length, context, params, sig: candSig };
          }
        }
      }
      if (best === null) return null;
      return {
        starts: best.selected, length: best.length, warp: best.context,
        params: best.params, sig: best.sig
      };
    }

    _restoreBlocks(blocks, before) {
      for (const k of Object.keys(blocks)) delete blocks[k];
      Object.assign(blocks, before);
    }

    _extractDuplicates(blocks) {
      const st = this.stats;
      const banned = new Set();
      for (let pass = 0; pass < 200; pass++) {
        if (this.cancelled()) throw new Error("Cancelled");
        const found = this._findDuplicateGroup(blocks, banned);
        if (!found) break;
        const before = deepCopy(blocks);
        const oldCount = Object.keys(before).length;
        const oldSize = jlen(before);
        if (!this._applyDuplicateGroup(blocks, found.starts, found.length,
            found.warp, found.params)) {
          this._restoreBlocks(blocks, before);
          banned.add(found.sig);
          continue;
        }
        const newCount = Object.keys(blocks).length;
        const newSize = jlen(blocks);
        if (newCount >= oldCount || newSize >= oldSize) {
          this._restoreBlocks(blocks, before);
          banned.add(found.sig);
          continue;
        }
        st.duplicates_extracted += 1;
        st.dup_blocks_saved += oldCount - newCount;
      }
    }

    _applyDuplicateGroup(blocks, starts, length, warp, params) {
      if (starts.length < 2) return false;
      const donor = starts[0];
      const donorIds = this._chainIds(blocks, donor, length);
      if (donorIds.length < length) return false;
      const infos = [];
      for (const start of starts) {
        const ids = this._chainIds(blocks, start, length);
        if (ids.length < length) return false;
        const first = blocks[start];
        const last = blocks[ids[ids.length - 1]];
        if (!isDict(first) || !isDict(last)) return false;
        const prev = first.parent;
        const cont = last.next;
        infos.push({
          start, ids,
          prev: isStr(prev) && has(blocks, prev) ? prev : null,
          cont: isStr(cont) && has(blocks, cont) ? cont : null,
          top: first.topLevel === true,
          x: first.x === undefined ? 0 : first.x,
          y: first.y === undefined ? 0 : first.y
        });
      }

      const reserved = new Set(Object.keys(blocks));
      const newId = () => {
        const bid = shortestFreeId(reserved);
        reserved.add(bid);
        return bid;
      };

      const existingCodes = new Set();
      const inputKeys = new Set();
      const oldArgIds = new Set();
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk)) continue;
        if (blk.opcode === "procedures_prototype" || blk.opcode === "procedures_call") {
          const code = (blk.mutation || {}).proccode;
          if (isStr(code)) existingCodes.add(code);
          const argIds = parseArray((blk.mutation || {}).argumentids);
          if (argIds) for (const a of argIds) if (isStr(a)) oldArgIds.add(a);
        }
        if (isDict(blk.inputs)) {
          for (const key of Object.keys(blk.inputs)) inputKeys.add(key);
        }
      }
      const placeholders = params.map(([, isBool]) => isBool ? "%b" : "%s").join(" ");
      const suffix = placeholders ? " " + placeholders : "";
      let codeSeq = 0;
      let proccode;
      do {
        codeSeq += 1;
        proccode = encodeId(codeSeq) + suffix;
      } while (existingCodes.has(proccode));

      // Argument ids only have to avoid the input keys that are not themselves
      // argument ids; this mirrors `_shortenArgumentIds`.
      const argReserved = new Set();
      for (const key of inputKeys) if (!oldArgIds.has(key)) argReserved.add(key);
      const newArgIds = [];
      for (let k = 0; k < params.length; k++) {
        const aid = shortestFreeId(argReserved);
        argReserved.add(aid);
        newArgIds.push(aid);
      }

      const argIdsJson = JSON.stringify(newArgIds);
      const argNamesJson = JSON.stringify(params.map(([name]) => name));
      const argDefaultsJson = JSON.stringify(params.map(([, isBool]) => isBool ? false : ""));

      const defId = newId();
      const protoId = newId();
      const callIds = infos.map(() => newId());

      const ownerCall = new Map();
      for (let idx = 0; idx < infos.length; idx++) {
        const callId = callIds[idx];
        for (const cid of infos[idx].ids) {
          if (!ownerCall.has(cid)) ownerCall.set(cid, callId);
          for (const sub of this._collectSubgraph(blocks, cid, false)) {
            if (!ownerCall.has(sub)) ownerCall.set(sub, callId);
          }
        }
      }

      const bodyFirst = blocks[donor];
      bodyFirst.parent = defId;
      delete bodyFirst.topLevel;
      delete bodyFirst.x;
      delete bodyFirst.y;
      blocks[donorIds[donorIds.length - 1]].next = null;

      blocks[defId] = {
        opcode: "procedures_definition",
        next: donor,
        parent: null,
        inputs: { custom_block: [1, protoId] },
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 1000 + this.stats.duplicates_extracted * 100
      };
      blocks[protoId] = {
        opcode: "procedures_prototype",
        next: null,
        parent: defId,
        inputs: {},
        fields: {},
        shadow: true,
        topLevel: false,
        mutation: {
          tagName: "mutation",
          children: [],
          proccode,
          argumentids: argIdsJson,
          argumentnames: argNamesJson,
          argumentdefaults: argDefaultsJson,
          warp: warp ? "true" : "false"
        }
      };

      for (let idx = 0; idx < infos.length; idx++) {
        const info = infos[idx];
        const callId = callIds[idx];
        const start = info.start;
        const prev = ownerCall.has(info.prev) ? ownerCall.get(info.prev) : info.prev;
        const cont = ownerCall.has(info.cont) ? ownerCall.get(info.cont) : info.cont;
        if (idx !== 0) {
          const sub = new Set();
          for (const cid of info.ids) addAll(sub, this._collectSubgraph(blocks, cid, false));
          for (const cid of sub) delete blocks[cid];
        }
        const callInputs = {};
        for (let k = 0; k < params.length; k++) {
          const [argName, isBool] = params[k];
          const reporterId = newId();
          blocks[reporterId] = {
            opcode: isBool ? "argument_reporter_boolean" : "argument_reporter_string_number",
            next: null,
            parent: callId,
            inputs: {},
            fields: { VALUE: [argName, null] },
            shadow: false,
            topLevel: false
          };
          if (isBool) callInputs[newArgIds[k]] = [2, reporterId];
          else callInputs[newArgIds[k]] = [3, reporterId, [10, ""]];
        }
        const call = {
          opcode: "procedures_call",
          next: cont,
          parent: prev,
          inputs: callInputs,
          fields: {},
          shadow: false,
          topLevel: !!(info.top && prev === null),
          mutation: {
            tagName: "mutation",
            children: [],
            proccode,
            argumentids: argIdsJson,
            warp: warp ? "true" : "false"
          }
        };
        if (call.topLevel) { call.x = info.x; call.y = info.y; }
        blocks[callId] = call;
        if (prev !== null && has(blocks, prev)) {
          const parent = blocks[prev];
          let replaced = false;
          if (isDict(parent)) {
            if (parent.next === start) { parent.next = callId; replaced = true; }
            else if (parent.next === callId) replaced = true;
            if (!replaced && isDict(parent.inputs)) {
              for (const value of Object.values(parent.inputs)) {
                if (!isArr(value)) continue;
                for (let i = 1; i < value.length; i++) {
                  if (value[i] === start) { value[i] = callId; replaced = true; }
                }
              }
            }
          }
          if (!replaced) { call.parent = null; call.topLevel = true; }
        }
        if (cont !== null && has(blocks, cont) && !ownerCall.has(cont)) {
          blocks[cont].parent = callId;
        }
      }
      return true;
    }

    _nearHole(entry) {
      if (isArr(entry) && entry.length === 2 && entry[0] === 1 &&
          isArr(entry[1]) && entry[1].length >= 2 &&
          LITERAL_PRIMITIVE_TYPES.has(entry[1][0])) {
        return { type: entry[1][0], value: entry[1][1] };
      }
      return null;
    }

    _nearCanon(blocks, bid, cache) {
      if (!cache) cache = new Map();
      const canon = (current, stack) => {
        if (cache.has(current)) return cache.get(current);
        if (stack.has(current)) return { sig: "cycle", holes: [] };
        const blk = blocks[current];
        let value;
        if (isArr(blk)) {
          value = { sig: "prim:" + this._hashCanon(this._freeze(blk)), holes: [] };
          cache.set(current, value);
          return value;
        }
        if (!isDict(blk)) {
          value = { sig: "missing", holes: [] };
          cache.set(current, value);
          return value;
        }
        const nstack = new Set(stack);
        nstack.add(current);
        const fieldKeys = Object.keys(blk.fields || {}).sort();
        const fields = fieldKeys.map((k) => [k, this._freeze(blk.fields[k])]);
        const holes = [];
        const inputs = [];
        for (const key of Object.keys(blk.inputs || {}).sort()) {
          const entry = blk.inputs[key];
          const hole = this._nearHole(entry);
          if (hole) {
            holes.push({ parent: current, entry, type: hole.type, value: hole.value });
            inputs.push([key, ["literal"]]);
            continue;
          }
          if (!isArr(entry)) {
            inputs.push([key, ["value", this._freeze(entry)]]);
            continue;
          }
          const parts = [];
          for (const item of entry) {
            if (isStr(item) && has(blocks, item)) {
              const child = canon(item, nstack);
              parts.push(["ref", child.sig]);
              for (const h of child.holes) holes.push(h);
            } else if (isArr(item)) {
              parts.push(["list", this._freeze(item)]);
            } else {
              parts.push(["value", item === undefined ? null : item]);
            }
          }
          inputs.push([key, parts]);
        }
        value = {
          sig: this._hashCanon(["NB", blk.opcode === undefined ? null : blk.opcode,
            fields, inputs, this._freeze(blk.mutation || {}), !!blk.shadow]),
          holes
        };
        cache.set(current, value);
        return value;
      };
      return canon(bid, new Set());
    }

    _findNearDuplicateGroup(blocks, banned) {
      if (!isDict(blocks)) return null;
      banned = banned || new Set();
      const cache = new Map();

      const warpBodies = new Set();
      const owners = new Map();
      const ownerConflicts = new Set();
      const defArgNames = new Map();
      for (const [bid, blk] of Object.entries(blocks)) {
        if (!isDict(blk) || blk.opcode !== "procedures_definition") continue;
        const cb = (blk.inputs || {}).custom_block;
        const pid = isArr(cb) && cb.length > 1 ? cb[1] : null;
        const proto = isStr(pid) ? blocks[pid] : null;
        const mut = (proto || {}).mutation || {};
        const names = parseArray(mut.argumentnames) || [];
        defArgNames.set(bid, new Set(names.filter(isStr)));
        const body = blk.next;
        if (isStr(body) && has(blocks, body)) {
          for (const cid of this._collectSubgraph(blocks, body, true)) {
            if (owners.has(cid) && owners.get(cid) !== bid) ownerConflicts.add(cid);
            else owners.set(cid, bid);
          }
        }
        if (mut.warp === true || mut.warp === "true") {
          const wbody = blk.next;
          if (isStr(wbody) && has(blocks, wbody)) {
            addAll(warpBodies, this._collectSubgraph(blocks, wbody, true));
          }
        }
      }
      for (const cid of ownerConflicts) owners.delete(cid);

      const reporterIds = new Set();
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk) || !isDict(blk.inputs)) continue;
        for (const [key, value] of Object.entries(blk.inputs)) {
          if (!isArr(value) || value.length < 2 || !isStr(value[1])) continue;
          if (key !== "SUBSTACK" && key !== "SUBSTACK2") reporterIds.add(value[1]);
        }
      }

      const groups = new Map();
      for (const [bid, blk] of Object.entries(blocks)) {
        if (!isDict(blk) || blk.shadow === true) continue;
        const op = blk.opcode;
        if (!isStr(op) || EXTRACT_EXCLUDE_OPS.has(op)) continue;
        if (op.startsWith("argument_reporter")) continue;
        if (reporterIds.has(bid)) continue;
        if (Compressor._isHatOpcode(op)) continue;
        const sigObj = this._nearCanon(blocks, bid, cache);
        if (!sigObj.holes.length) continue;
        const context = warpBodies.has(bid);
        const key = (context ? "1" : "0") + "\u0000" + sigObj.sig;
        if (!groups.has(key)) groups.set(key, { context, sig: sigObj.sig, starts: [] });
        groups.get(key).starts.push(bid);
      }

      let best = null;
      for (const [key, group] of groups) {
        const { context, sig, starts } = group;
        if (starts.length < 2 || banned.has(key)) continue;
        const selected = [];
        const used = new Set();
        const info = [];
        for (const cand of starts) {
          const sub = this._collectSubgraph(blocks, cand, false);
          if (setHasIntersection(sub, used)) continue;
          let forbidden = false;
          for (const cid of sub) {
            const cb = blocks[cid];
            if (!isDict(cb)) continue;
            const cop = cb.opcode;
            if (!isStr(cop) || EXTRACT_FORBIDDEN_OPS.has(cop) ||
                Compressor._isHatOpcode(cop)) {
              forbidden = true;
              break;
            }
          }
          if (forbidden) continue;
          selected.push(cand);
          addAll(used, sub);
          info.push([cand, sub]);
        }
        if (selected.length < 2) continue;

        const base = selected[0];
        const params = this._chainArgumentParams(blocks, [base]);
        if (params === null) continue;
        if (params.length) {
          const owner = owners.get(base);
          if (owner === undefined) continue;
          const known = defArgNames.get(owner) || new Set();
          if (params.some(([name]) => !known.has(name))) continue;
          if (selected.some((cand) => owners.get(cand) !== owner)) continue;
        }

        const holeLists = selected.map((cand) => this._nearCanon(blocks, cand, cache).holes);
        const count = holeLists[0].length;
        if (holeLists.some((h) => h.length !== count)) continue;
        const diffIdx = [];
        for (let i = 0; i < count; i++) {
          const values = new Set(holeLists.map((h) => JSON.stringify([h[i].type, h[i].value])));
          if (values.size > 1) diffIdx.push(i);
        }
        if (!diffIdx.length) continue;

        const size = info[0][1].size;
        const n = selected.length;
        const savings = (n - 1) * size - (2 + n + n * params.length + diffIdx.length);
        if (savings <= 0) continue;
        const score = [savings, size, n];
        if (best === null || cmpTuple(score, best.score) > 0) {
          best = { score, selected, diffIdx, params, context, sig: key };
        }
      }
      if (best === null) return null;
      return {
        starts: best.selected, diffIdx: best.diffIdx, params: best.params,
        warp: best.context, sig: best.sig
      };
    }

    _extractNearDuplicates(blocks) {
      const st = this.stats;
      const banned = new Set();
      for (let pass = 0; pass < 200; pass++) {
        if (this.cancelled()) throw new Error("Cancelled");
        const found = this._findNearDuplicateGroup(blocks, banned);
        if (!found) break;
        const before = deepCopy(blocks);
        const oldCount = Object.keys(before).length;
        const oldSize = jlen(before);
        if (!this._applyNearDuplicateGroup(blocks, found.starts, found.diffIdx,
            found.params, found.warp)) {
          this._restoreBlocks(blocks, before);
          banned.add(found.sig);
          continue;
        }
        const newCount = Object.keys(blocks).length;
        const newSize = jlen(blocks);
        if (newCount >= oldCount || newSize >= oldSize) {
          this._restoreBlocks(blocks, before);
          banned.add(found.sig);
          continue;
        }
        st.near_duplicates_extracted += 1;
        st.near_blocks_saved += oldCount - newCount;
      }
    }

    _applyNearDuplicateGroup(blocks, starts, diffIdx, params, warp) {
      if (starts.length < 2) return false;
      const infos = [];
      const cache = new Map();
      for (const start of starts) {
        const blk = blocks[start];
        if (!isDict(blk)) return false;
        const sigObj = this._nearCanon(blocks, start, cache);
        const holes = sigObj.holes;
        if (holes.length < Math.max(...diffIdx) + 1) return false;
        const prev = blk.parent;
        const cont = blk.next;
        infos.push({
          start,
          sub: this._collectSubgraph(blocks, start, false),
          holes,
          prev: isStr(prev) && has(blocks, prev) ? prev : null,
          cont: isStr(cont) && has(blocks, cont) ? cont : null,
          top: blk.topLevel === true,
          x: blk.x === undefined ? 0 : blk.x,
          y: blk.y === undefined ? 0 : blk.y
        });
      }

      const reserved = new Set(Object.keys(blocks));
      const newId = () => {
        const bid = shortestFreeId(reserved);
        reserved.add(bid);
        return bid;
      };

      const existingCodes = new Set();
      const inputKeys = new Set();
      const oldArgIds = new Set();
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk)) continue;
        if (blk.opcode === "procedures_prototype" || blk.opcode === "procedures_call") {
          const mut = blk.mutation || {};
          const code = mut.proccode;
          if (isStr(code)) existingCodes.add(code);
          const argIds = parseArray(mut.argumentids);
          if (argIds) for (const a of argIds) if (isStr(a)) oldArgIds.add(a);
        }
        if (isDict(blk.inputs)) {
          for (const key of Object.keys(blk.inputs)) inputKeys.add(key);
        }
      }

      const usedNames = new Set(params.map(([name]) => name));
      const litNames = [];
      while (litNames.length < diffIdx.length) {
        const name = shortestFreeId(usedNames);
        usedNames.add(name);
        litNames.push(name);
      }
      const allParams = params.concat(litNames.map((name) => [name, false]));

      const placeholders = allParams.map(([, isBool]) => isBool ? "%b" : "%s").join(" ");
      const suffix = placeholders ? " " + placeholders : "";
      let codeSeq = 0;
      let proccode;
      do {
        codeSeq += 1;
        proccode = encodeId(codeSeq) + suffix;
      } while (existingCodes.has(proccode));

      // Argument ids only have to avoid the input keys that are not themselves
      // argument ids; this mirrors `_shortenArgumentIds`.
      const argReserved = new Set();
      for (const key of inputKeys) if (!oldArgIds.has(key)) argReserved.add(key);
      const newArgIds = [];
      for (let k = 0; k < allParams.length; k++) {
        const aid = shortestFreeId(argReserved);
        argReserved.add(aid);
        newArgIds.push(aid);
      }

      const argIdsJson = JSON.stringify(newArgIds);
      const argNamesJson = JSON.stringify(allParams.map(([name]) => name));
      const argDefaultsJson = JSON.stringify(allParams.map(([, isBool]) => isBool ? false : ""));

      const defId = newId();
      const protoId = newId();
      const callIds = infos.map(() => newId());
      const bodyReporterIds = diffIdx.map(() => newId());
      const callReporterIds = infos.map(() => params.map(() => newId()));

      const donor = starts[0];
      const body = blocks[donor];
      body.parent = defId;
      delete body.topLevel;
      delete body.x;
      delete body.y;
      body.next = null;
      for (let j = 0; j < diffIdx.length; j++) {
        const hole = infos[0].holes[diffIdx[j]];
        const rid = bodyReporterIds[j];
        blocks[rid] = {
          opcode: "argument_reporter_string_number",
          next: null,
          parent: hole.parent,
          inputs: {},
          fields: { VALUE: [litNames[j], null] },
          shadow: false,
          topLevel: false
        };
        hole.entry.splice(0, hole.entry.length, 2, rid);
      }

      blocks[defId] = {
        opcode: "procedures_definition",
        next: donor,
        parent: null,
        inputs: { custom_block: [1, protoId] },
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 1000 + (this.stats.duplicates_extracted +
          this.stats.near_duplicates_extracted) * 100
      };
      blocks[protoId] = {
        opcode: "procedures_prototype",
        next: null,
        parent: defId,
        inputs: {},
        fields: {},
        shadow: true,
        topLevel: false,
        mutation: {
          tagName: "mutation",
          children: [],
          proccode,
          argumentids: argIdsJson,
          argumentnames: argNamesJson,
          argumentdefaults: argDefaultsJson,
          warp: warp ? "true" : "false"
        }
      };

      for (let idx = 0; idx < infos.length; idx++) {
        const info = infos[idx];
        const callId = callIds[idx];
        const reporterIds = callReporterIds[idx];
        const callInputs = {};
        for (let p = 0; p < params.length; p++) {
          const [argName, isBool] = params[p];
          const rid = reporterIds[p];
          blocks[rid] = {
            opcode: isBool ? "argument_reporter_boolean" : "argument_reporter_string_number",
            next: null,
            parent: callId,
            inputs: {},
            fields: { VALUE: [argName, null] },
            shadow: false,
            topLevel: false
          };
          const aid = newArgIds[p];
          if (isBool) callInputs[aid] = [2, rid];
          else callInputs[aid] = [3, rid, [10, ""]];
        }
        for (let j = 0; j < litNames.length; j++) {
          const aid = newArgIds[params.length + j];
          const hole = info.holes[diffIdx[j]];
          callInputs[aid] = [1, [hole.type, hole.value]];
        }
        blocks[callId] = {
          opcode: "procedures_call",
          next: null,
          parent: null,
          inputs: callInputs,
          fields: {},
          shadow: false,
          topLevel: false,
          mutation: {
            tagName: "mutation",
            children: [],
            proccode,
            argumentids: argIdsJson,
            warp: warp ? "true" : "false"
          }
        };
      }

      const ownerCall = new Map();
      for (let idx = 0; idx < infos.length; idx++) {
        for (const cid of infos[idx].sub) {
          if (!ownerCall.has(cid)) ownerCall.set(cid, callIds[idx]);
        }
      }
      for (let idx = 1; idx < infos.length; idx++) {
        for (const cid of infos[idx].sub) delete blocks[cid];
      }

      for (let idx = 0; idx < infos.length; idx++) {
        const info = infos[idx];
        const callId = callIds[idx];
        const start = info.start;
        const prev = ownerCall.has(info.prev) ? ownerCall.get(info.prev) : info.prev;
        const cont = ownerCall.has(info.cont) ? ownerCall.get(info.cont) : info.cont;
        const call = blocks[callId];
        call.next = cont;
        call.parent = prev;
        if (info.top && prev === null) {
          call.topLevel = true;
          call.x = info.x;
          call.y = info.y;
        }
        if (prev !== null && has(blocks, prev)) {
          const parent = blocks[prev];
          let replaced = false;
          if (isDict(parent)) {
            if (parent.next === start) { parent.next = callId; replaced = true; }
            else if (parent.next === callId) replaced = true;
            if (!replaced && isDict(parent.inputs)) {
              for (const value of Object.values(parent.inputs)) {
                if (!isArr(value)) continue;
                for (let i = 1; i < value.length; i++) {
                  if (value[i] === start) { value[i] = callId; replaced = true; }
                }
              }
            }
          }
          if (!replaced) { call.parent = null; call.topLevel = true; }
        }
        if (cont !== null && has(blocks, cont) && !ownerCall.has(cont)) {
          blocks[cont].parent = callId;
        }
      }
      return true;
    }

    _compressProcs(blocks) {
      const st = this.stats;
      const protos = new Map();
      const defs = [];
      const calls = [];
      const reporters = new Set();
      for (const [bid, b] of Object.entries(blocks)) {
        if (!isDict(b)) continue;
        const op = b.opcode;
        if (op === "procedures_prototype") {
          protos.set(bid, b);
        } else if (op === "procedures_definition") {
          const cb = (b.inputs || {}).custom_block;
          const pid = isArr(cb) && cb.length > 1 && isStr(cb[1]) ? cb[1] : null;
          if (pid) defs.push([bid, pid]);
        } else if (op === "procedures_call") {
          calls.push(b);
        } else if (isStr(op) && op.startsWith("argument_reporter")) {
          reporters.add(bid);
        }
      }
      if (!protos.size || !defs.length) return;

      const groups = new Map();
      for (const [hat, pid] of defs) {
        const p = protos.get(pid);
        const mut = (p || {}).mutation || {};
        const old = mut.proccode;
        if (isStr(old) && old) {
          if (!groups.has(old)) groups.set(old, []);
          groups.get(old).push([hat, pid]);
        }
      }

      const retained = new Set();
      const renameCodes = new Set();
      for (const [old, group] of groups) {
        if (group.length > 1) retained.add(old);
        else renameCodes.add(old);
      }
      const procMap = new Map();
      const argMaps = new Map();
      // Only codes that survive unchanged must block a new name.  A unique
      // definition's own code is about to move, so reserving it (and the code
      // of calls that move with it) would bump every custom block one letter
      // longer than necessary.
      const reservedCodes = new Set(retained);
      for (const p of protos.values()) {
        const code = isDict(p) ? (p.mutation || {}).proccode : null;
        if (isStr(code) && !renameCodes.has(code)) reservedCodes.add(code);
      }
      for (const b of calls) {
        const code = isDict(b) ? (b.mutation || {}).proccode : null;
        if (isStr(code) && !renameCodes.has(code)) reservedCodes.add(code);
      }
      const assignedCodes = new Set();
      let i = 0;
      for (const [old, group] of groups) {
        if (group.length > 1) continue;
        const placeholders = proccodePlaceholders(old);
        const suffix = placeholders.length ? " " + placeholders.join(" ") : "";
        let newCode;
        do {
          i++;
          newCode = encodeId(i) + suffix;
        } while (reservedCodes.has(newCode) || assignedCodes.has(newCode));
        assignedCodes.add(newCode);
        procMap.set(old, newCode);
        if (newCode !== old) st.procs_renamed += 1;
      }

      for (const [, pid] of defs) {
        const p = protos.get(pid);
        if (!p) continue;
        const mut = p.mutation;
        if (!isDict(mut)) continue;
        const oldCode = mut.proccode;
        if (procMap.has(oldCode)) mut.proccode = procMap.get(oldCode);
        const names = parseArray(mut.argumentnames);
        if (!names || !names.length) continue;
        const newNames = names.map((_, j) => encodeId(j + 1));
        const amap = new Map();
        for (let j = 0; j < names.length; j++) {
          if (names[j] !== newNames[j]) amap.set(names[j], newNames[j]);
        }
        if (amap.size) {
          argMaps.set(pid, amap);
          st.args_renamed += amap.size;
        }
        mut.argumentnames = JSON.stringify(newNames);
      }

      for (const b of calls) {
        const mut = b.mutation;
        if (isDict(mut) && procMap.has(mut.proccode)) mut.proccode = procMap.get(mut.proccode);
      }

      for (const [hat, pid] of defs) {
        const amap = argMaps.get(pid);
        if (!amap || !amap.size) continue;
        const stack = [hat];
        const visited = new Set();
        while (stack.length) {
          const cur = stack.pop();
          if (visited.has(cur)) continue;
          visited.add(cur);
          const blk = blocks[cur];
          if (!isDict(blk)) continue;
          if (reporters.has(cur)) {
            const fv = (blk.fields || {}).VALUE;
            if (isArr(fv) && fv.length && amap.has(fv[0])) fv[0] = amap.get(fv[0]);
          }
          if (isDict(blk.inputs)) {
            for (const v of Object.values(blk.inputs)) {
              if (!isArr(v)) continue;
              for (let j = 1; j < v.length; j++) if (isStr(v[j])) stack.push(v[j]);
            }
          }
          if (isStr(blk.next) && blk.next) stack.push(blk.next);
        }
      }
    }

    _normalizeMutations(blocks) {
      // scratch-vm's Blocks.mutationToXML() reads `mutation.tagName` and
      // iterates `mutation.children`, so every mutation must carry both.
      // Exported projects sometimes drop them; without them the Scratch editor
      // and any VM that emits a workspace update fail to load the project.
      const st = this.stats;
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk) || !isDict(blk.mutation)) continue;
        const mut = blk.mutation;
        if (!isStr(mut.tagName)) {
          mut.tagName = "mutation";
          st.mutation_keys_added += 1;
        }
        if (!isArr(mut.children)) {
          mut.children = [];
          st.mutation_keys_added += 1;
        }
      }
    }

    _shortenArgumentIds(blocks) {
      const st = this.stats;
      const oldIds = new Map();
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk)) continue;
        if (blk.opcode !== "procedures_call" && blk.opcode !== "procedures_prototype") continue;
        if (!isDict(blk.mutation)) continue;
        const raw = blk.mutation.argumentids;
        if (!isStr(raw)) continue;
        let ids = null;
        try {
          ids = JSON.parse(raw);
        } catch (_) {
          ids = null;
        }
        if (!isArr(ids)) continue;
        for (const a of ids) {
          if (isStr(a) && a && !oldIds.has(a)) oldIds.set(a, true);
        }
      }
      if (!oldIds.size) return;

      const reserved = new Set();
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk) || !isDict(blk.inputs)) continue;
        for (const k of Object.keys(blk.inputs)) {
          if (!oldIds.has(k)) reserved.add(k);
        }
      }
      const newMap = new Map();
      let n = 0;
      for (const old of oldIds.keys()) {
        let cand;
        do {
          n += 1;
          cand = encodeId(n);
        } while (reserved.has(cand));
        reserved.add(cand);
        newMap.set(old, cand);
      }
      st.arg_ids_shortened += newMap.size;

      for (const blk of Object.values(blocks)) {
        if (!isDict(blk)) continue;
        if (isDict(blk.mutation) && isStr(blk.mutation.argumentids)) {
          let ids = null;
          try {
            ids = JSON.parse(blk.mutation.argumentids);
          } catch (_) {
            ids = null;
          }
          if (isArr(ids)) {
            blk.mutation.argumentids = JSON.stringify(
              ids.map((a) => (isStr(a) && newMap.has(a)) ? newMap.get(a) : a));
          }
        }
        if (isDict(blk.inputs)) {
          const renamed = {};
          for (const [k, v] of Object.entries(blk.inputs)) {
            renamed[newMap.has(k) ? newMap.get(k) : k] = v;
          }
          blk.inputs = renamed;
        }
        // Note: deliberately leave `fields.VALUE` alone.  On an
        // `argument_reporter_*` block that field holds the argument *name*, not
        // an argument id, and names are not renamed here.  Argument ids live in
        // a separate namespace that is local to each custom block, so renaming
        // a name that happens to equal some other block's argument id (e.g.
        // "x", "y", "index") would make that reporter resolve to nothing.
      }
    }

    _stripComments(tgt) {
      const st = this.stats;
      let keptIds = new Set();
      if (isDict(tgt.comments)) {
        const kept = {};
        for (const [cid, c] of Object.entries(tgt.comments)) {
          if (!isTwConfigComment(tgt, c)) continue;
          kept[cid] = c;
          keptIds.add(cid);
        }
        st.comments_removed += Object.keys(tgt.comments).length - keptIds.size;
        if (keptIds.size) tgt.comments = kept;
        else delete tgt.comments;
      }
      if (isDict(tgt.blocks)) {
        for (const blk of Object.values(tgt.blocks)) {
          if (!isDict(blk) || !has(blk, "comment")) continue;
          if (keptIds.has(blk.comment)) continue;
          delete blk.comment;
        }
      }
    }

    _scriptSize(blocks, start) {
      let total = 0;
      const seen = new Set();
      const stack = [start];
      while (stack.length) {
        const bid = stack.pop();
        if (seen.has(bid)) continue;
        seen.add(bid);
        const blk = blocks[bid];
        if (!isDict(blk)) continue;
        total += 1;
        if (isStr(blk.next) && blk.next) stack.push(blk.next);
        if (isDict(blk.inputs)) {
          for (const key of ["SUBSTACK", "SUBSTACK2"]) {
            const value = blk.inputs[key];
            if (!isArr(value)) continue;
            for (let i = 1; i < value.length; i++) {
              if (isStr(value[i])) stack.push(value[i]);
            }
          }
        }
      }
      return total;
    }

    _compactWorkspace(tgt) {
      const st = this.stats;
      const blocks = tgt.blocks;
      if (!isDict(blocks) || !Object.keys(blocks).length) return;
      const roots = Object.keys(blocks).filter(
        (bid) => isDict(blocks[bid]) && blocks[bid].topLevel === true);
      if (!roots.length) return;
      const columns = new Map();
      for (const bid of roots) {
        const x = blocks[bid].x;
        const key = (typeof x === "number" && Number.isFinite(x)) ? x : 0;
        if (!columns.has(key)) columns.set(key, []);
        columns.get(key).push(bid);
      }
      const xs = [...columns.keys()].sort((a, b) => a - b);
      xs.forEach((oldX, ci) => {
        const newX = 40 + ci * 340;
        let y = 40;
        const ordered = columns.get(oldX).slice().sort((a, b) => {
          const ya = (typeof blocks[a].y === "number") ? blocks[a].y : 0;
          const yb = (typeof blocks[b].y === "number") ? blocks[b].y : 0;
          if (ya !== yb) return ya - yb;
          return a < b ? -1 : (a > b ? 1 : 0);
        });
        for (const bid of ordered) {
          const blk = blocks[bid];
          if (blk.x !== newX || blk.y !== y) {
            blk.x = newX;
            blk.y = y;
            st.workspace_compacted += 1;
          }
          y += 60 + 52 * this._scriptSize(blocks, bid);
        }
      });
      if (isDict(tgt.comments)) {
        for (const c of Object.values(tgt.comments)) {
          if (!isDict(c) || !isStr(c.blockId)) continue;
          const blk = blocks[c.blockId];
          if (isDict(blk) && has(blk, "x")) {
            c.x = blk.x + 200;
            c.y = blk.y;
          }
        }
      }
    }

    _normalizeParentMarkers(blocks) {
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk) || blk.parent === null || blk.parent === undefined) continue;
        delete blk.topLevel;
        delete blk.x;
        delete blk.y;
      }
    }

    _stripBlockDefaults(blocks) {
      const st = this.stats;
      for (const blk of Object.values(blocks)) {
        if (!isDict(blk)) continue;
        if (blk.shadow === false) {
          delete blk.shadow;
          st.fields_removed += 1;
        }
        if (blk.topLevel !== true && has(blk, "topLevel")) {
          delete blk.topLevel;
          st.fields_removed += 1;
        }
        for (const key of ["inputs", "fields"]) {
          if (has(blk, key) && isDict(blk[key]) && Object.keys(blk[key]).length === 0) {
            delete blk[key];
            st.fields_removed += 1;
          }
        }
      }
    }

    _renameBlocks(blocks, tgt) {
      const o = this.options;
      const st = this.stats;
      const tname = isDict(tgt) && isStr(tgt.name) ? tgt.name : null;
      const localV = tname ? this.varByTarget.get(tname) : null;
      const localL = tname ? this.listByTarget.get(tname) : null;
      const stageV = this.stageName ? this.varByTarget.get(this.stageName) : null;
      const stageL = this.stageName ? this.listByTarget.get(this.stageName) : null;
      // A bare name resolves in the target first and then (for a sprite) in
      // the stage, matching the VM's lookup order.  Generated names may repeat
      // in different targets, so the global maps are only a last resort.
      const varByName = (name) =>
        (localV && localV.get(name)) ||
        (tname !== this.stageName && stageV && stageV.get(name)) ||
        this.varByName.get(name);
      const listByName = (name) =>
        (localL && localL.get(name)) ||
        (tname !== this.stageName && stageL && stageL.get(name)) ||
        this.listByName.get(name);
      const idMap = new Map();
      const processed = new Set();
      const counts = new Map();
      const seen = new Map();
      const touch = (key, pos) => {
        if (counts.has(key)) counts.set(key, counts.get(key) + 1);
        else { counts.set(key, 1); seen.set(key, pos); }
      };
      let pos = 0;
      for (const [bid, blk] of Object.entries(blocks)) {
        touch(bid, pos);
        pos += 1;
        if (!isDict(blk)) continue;
        if (isDict(blk.inputs)) {
          for (const v of Object.values(blk.inputs)) {
            if (!isArr(v)) continue;
            for (let i = 1; i < v.length; i++) {
              if (isStr(v[i])) touch(v[i], pos);
            }
          }
        }
        if (isStr(blk.next) && blk.next) touch(blk.next, pos);
        if (isStr(blk.parent) && blk.parent) touch(blk.parent, pos);
      }

      let ordered;
      if (o.freqIds) {
        ordered = [...counts.keys()].sort((a, b) =>
          (counts.get(b) - counts.get(a)) || (seen.get(a) - seen.get(b)));
      } else {
        ordered = [...counts.keys()].sort((a, b) => seen.get(a) - seen.get(b));
      }
      for (let i = 0; i < ordered.length; i++) idMap.set(ordered[i], encodeId(i + 1));
      const counter = [ordered.length];
      const nid = (old) => {
        if (idMap.has(old)) return idMap.get(old);
        counter[0] += 1;
        const m = encodeId(counter[0]);
        idMap.set(old, m);
        return m;
      };

      const mapPrimitive = (p) => {
        if (!isArr(p) || !p.length) return p;
        const t = p[0];
        if (t === 11) {
          const name = p.length > 1 ? p[1] : "";
          const pid = p.length > 2 ? p[2] : null;
          let m = pid ? this.bcMap.get(pid) : null;
          if (!m) m = this.bcByName.get(name);
          if (!m) return p;
          if (p.length > 2) return [11, m[1], m[0], ...p.slice(3)];
          return [11, m[1], ...p.slice(2)];
        }
        if (t === 12 || t === 13) {
          const name = p.length > 1 ? p[1] : "";
          const pid = p.length > 2 ? p[2] : null;
          const table = t === 12 ? this.varMap : this.listMap;
          const byName = t === 12 ? varByName : listByName;
          let m = pid ? table.get(pid) : null;
          if (!m) m = byName(name);
          if (!m) return p;
          return [t, m[1], m[0], ...p.slice(3)];
        }
        return p;
      };

      const sensingObjectName = (blk) => {
        const f = (blk.fields || {}).OBJECT;
        if (isArr(f) && f.length) return f[0];
        const inp = (blk.inputs || {}).OBJECT;
        if (isArr(inp)) {
          for (let i = 1; i < inp.length; i++) {
            if (isStr(inp[i])) {
              const menu = blocks[inp[i]];
              if (isDict(menu) && menu.opcode === "sensing_of_object_menu") {
                const mf = (menu.fields || {}).OBJECT;
                if (isArr(mf) && mf.length) return mf[0];
              }
            }
          }
        }
        return null;
      };

      const processFrom = (oldStart, reachable = false) => {
        const work = [[oldStart, reachable]];
        while (work.length) {
          const [old, isReach] = work.pop();
          if (processed.has(old)) continue;
          nid(old);
          const blk = blocks[old];
          if (isArr(blk)) {
            processed.add(old);
            blocks[old] = mapPrimitive(blk);
            continue;
          }
          if (!isDict(blk)) continue;
          processed.add(old);

          const senseObj = blk.opcode === "sensing_of" ? sensingObjectName(blk) : null;

          if (isDict(blk.inputs)) {
            for (const [k, v] of Object.entries(blk.inputs)) {
              if (!isArr(v) || v.length < 2) continue;
              const out = [v[0]];
              let changed = false;
              for (let i = 1; i < v.length; i++) {
                const item = v[i];
                if (isStr(item)) {
                  out.push(nid(item));
                  work.push([item, isReach]);
                  changed = true;
                } else if (isArr(item) && item.length && isInt(item[0])) {
                  out.push(mapPrimitive(item));
                  changed = true;
                } else {
                  out.push(item);
                }
              }
              if (changed) blk.inputs[k] = out;
            }
            if (Object.keys(blk.inputs).length === 0) {
              delete blk.inputs;
              st.fields_removed += 1;
            }
          }

          if (isDict(blk.fields)) {
            for (const [k, fv] of Object.entries(blk.fields)) {
              if (!isArr(fv) || !fv.length) continue;
              const name = fv[0];
              const fid = fv.length > 1 ? fv[1] : null;
              if (k === "PROPERTY" && blk.opcode === "sensing_of") {
                let objName = senseObj;
                if (objName === "_stage_") objName = this.stageName;
                if (isStr(objName)) {
                  if (objName === this.stageName) {
                    if (SENSING_STAGE_PROPERTIES.has(name)) continue;
                  } else if (SENSING_SPRITE_PROPERTIES.has(name)) {
                    continue;
                  }
                }
                const vScope = isStr(objName) ? this.varByTarget.get(objName) : null;
                const lScope = isStr(objName) ? this.listByTarget.get(objName) : null;
                const sm = (vScope && vScope.get(name)) || (lScope && lScope.get(name));
                if (sm !== undefined) blk.fields[k] = [sm[1], ...fv.slice(1)];
                continue;
              }
              let m = null;
              if (k === "VARIABLE") {
                m = (fid ? this.varMap.get(fid) : null) || varByName(name);
              } else if (k === "LIST") {
                m = (fid ? this.listMap.get(fid) : null) || listByName(name);
              } else if (k === "BROADCAST_OPTION") {
                m = (fid ? this.bcMap.get(fid) : null) || this.bcByName.get(name);
              }
              if (m) blk.fields[k] = [m[1], m[0], ...fv.slice(2)];
            }
            if (Object.keys(blk.fields).length === 0) {
              delete blk.fields;
              st.fields_removed += 1;
            }
          }

          if (blk.shadow === false) {
            delete blk.shadow;
            st.fields_removed += 1;
          }
          if (blk.topLevel !== true && has(blk, "topLevel")) {
            delete blk.topLevel;
            st.fields_removed += 1;
          }

          if (isStr(blk.next) && blk.next) {
            const oldNext = blk.next;
            blk.next = nid(oldNext);
            work.push([oldNext, isReach]);
          } else if (isReach) {
            blk.next = null;
          } else {
            delete blk.next;
          }
        }
      };

      const tops = Object.keys(blocks).filter((bid) => isDict(blocks[bid]) && blocks[bid].topLevel === true);
      for (const top of tops) processFrom(top, true);
      for (const old of Object.keys(blocks)) {
        if (!processed.has(old)) processFrom(old, false);
      }

      for (const blk of Object.values(blocks)) {
        if (!isDict(blk)) continue;
        const p = blk.parent;
        if (isStr(p) && idMap.has(p)) blk.parent = idMap.get(p);
        else if (p === null || p === undefined) blk.parent = null;
      }

      st.blocks_renamed += counter[0];
      const newBlocks = {};
      for (const [k, v] of Object.entries(blocks)) {
        newBlocks[idMap.has(k) ? idMap.get(k) : k] = v;
      }
      if (Object.keys(newBlocks).length !== Object.keys(blocks).length) {
        throw new CompressError("Internal error: block ID collision during renaming");
      }
      return [newBlocks, idMap];
    }

    _processMonitors(project) {
      const mons = project.monitors;
      if (!isArr(mons)) return;
      const st = this.stats;
      const referenced = new Set([...this.showVarIds, ...this.showListIds]);
      const keptMons = [];
      for (const mon of mons) {
        if (!isDict(mon)) { keptMons.push(mon); continue; }
        const op = mon.opcode;
        if (op === "data_variable" || op === "data_listcontents") {
          const mid = mon.id;
          let table, byname, dropped, pkey;
          if (op === "data_variable") {
            table = this.varMap; byname = this.varNameIds;
            dropped = this.droppedVarIds; pkey = "VARIABLE";
          } else {
            table = this.listMap; byname = this.listNameIds;
            dropped = this.droppedListIds; pkey = "LIST";
          }
          const pname = (mon.params || {})[pkey];
          if (isStr(mid) && dropped.has(mid)) continue;
          if (!(isStr(mid) && table.has(mid)) && pname !== null && pname !== undefined) {
            const ids = byname.get(pname);
            if (ids && ids.size && [...ids].every((id) => dropped.has(id))) continue;
          }
          if (this.options.removeUnused && this.options.removeMonitors && mon.visible === false) {
            const ids = new Set();
            if (isStr(mid)) ids.add(mid);
            const byName = (pname !== null && pname !== undefined) ? byname.get(pname) : null;
            if (byName) for (const id of byName) ids.add(id);
            let hits = false;
            for (const id of ids) if (referenced.has(id)) { hits = true; break; }
            if (!hits) {
              st.monitors_removed += 1;
              continue;
            }
          }
        }
        if (this.options.shortenIds && (op === "data_variable" || op === "data_listcontents")) {
          const table = op === "data_variable" ? this.varMap : this.listMap;
          const byname = op === "data_variable" ? this.varByName : this.listByName;
          const pkey = op === "data_variable" ? "VARIABLE" : "LIST";
          const pname = (mon.params || {})[pkey];
          const mid = mon.id;
          let m = isStr(mid) ? table.get(mid) : null;
          if (!m && pname !== null && pname !== undefined) {
            // Names may repeat in different targets, so resolve a monitor by
            // its own sprite first, then the stage, then the global fallback.
            const mname = isStr(mon.spriteName) ? mon.spriteName : this.stageName;
            const localScope = op === "data_variable"
              ? this.varByTarget.get(mname) : this.listByTarget.get(mname);
            const stageScope = op === "data_variable"
              ? this.varByTarget.get(this.stageName) : this.listByTarget.get(this.stageName);
            m = (localScope && localScope.get(pname)) ||
              (mname !== this.stageName && stageScope && stageScope.get(pname)) ||
              byname.get(pname);
          }
          if (m) {
            const before = mon.id;
            const beforeName = (mon.params || {})[pkey];
            mon.id = m[0];
            const params = mon.params || (mon.params = {});
            if (pkey in params) params[pkey] = m[1];
            if (before !== m[0] || beforeName !== m[1]) st.monitors_updated += 1;
          }
        }
        if (this.options.stripDefaults) {
          // Only the cached value and the default-valued fields go; `x`/`y`
          // (the monitor's saved position) is never touched.
          delete mon.value;
          for (const [key, dflt] of MONITOR_DEFAULTS) {
            if (has(mon, key) && looseEq(mon[key], dflt)) {
              delete mon[key];
              st.fields_removed += 1;
            }
          }
        }
        keptMons.push(mon);
      }
      project.monitors = keptMons;
      if (!keptMons.length) delete project.monitors;
    }

    _processRoot(project) {
      const st = this.stats;
      if (isArr(project.extensions) && project.extensions.length === 0) {
        delete project.extensions;
        st.fields_removed += 1;
      }
      const meta = project.meta;
      if (isDict(meta)) {
        for (const key of ["vm", "agent"]) {
          if (has(meta, key)) {
            delete meta[key];
            st.fields_removed += 1;
          }
        }
        if (!Object.keys(meta).length) delete project.meta;
      }
    }

    // ------------------------------------------------------------------
    // Proposal 1: Remove dead assets (costumes, sounds, sprites)
    _removeDeadAssets(targets, monitors) {
      const st = this.stats;
      const stageName = this.stageName;

      // Collect sprite name references
      const referencedSpriteNames = new Set();
      for (const mon of (isArr(monitors) ? monitors : [])) {
        if (!isDict(mon)) continue;
        if (mon.spriteName !== null && mon.spriteName !== undefined) {
          referencedSpriteNames.add(mon.spriteName);
        }
      }

      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        const isStage = !!tgt.isStage;
        const tname = tgt.name;
        const blocks = isDict(tgt.blocks) ? tgt.blocks : {};

        // Check for costume/backdrop references
        const usesNextCostume = Object.values(blocks).some(blk =>
          isDict(blk) && (blk.opcode === "looks_nextcostume" ||
            (isStage && blk.opcode === "looks_nextbackdrop")));
        const usesCostumeReporter = Object.values(blocks).some(blk =>
          isDict(blk) && (blk.opcode === "looks_costumenumbername" ||
            (isStage && blk.opcode === "looks_backdropnumbername")));
        const usesSensingOfCostume = Object.values(blocks).some(blk =>
          isDict(blk) && blk.opcode === "sensing_of" &&
          isDict(blk.fields) && isArr(blk.fields.PROPERTY) &&
          blk.fields.PROPERTY[0] &&
          ["costume #", "costume name", "backdrop #", "backdrop name"].includes(
            blk.fields.PROPERTY[0].toLowerCase()));

        const allCostumesNeeded = usesNextCostume || usesCostumeReporter || usesSensingOfCostume;

        // Collect explicitly referenced costume names
        const referencedCostumeNames = new Set();
        for (const blk of Object.values(blocks)) {
          if (!isDict(blk)) continue;
          const op = blk.opcode;
          const fields = blk.fields || {};
          if (op === "looks_switchcostumeto" || op === "looks_switchbackdropto") {
            const fv = fields.COSTUME || fields.BACKDROP;
            if (isArr(fv) && fv[0]) referencedCostumeNames.add(fv[0]);
          }
        }

        // Check for sound references
        const usesAnySound = Object.values(blocks).some(blk =>
          isDict(blk) && blk.opcode && blk.opcode.startsWith("sound_"));

        // Collect explicitly referenced sound names
        const referencedSoundNames = new Set();
        for (const blk of Object.values(blocks)) {
          if (!isDict(blk)) continue;
          const fields = blk.fields || {};
          const fv = fields.SOUND_MENU;
          if (isArr(fv) && fv[0]) referencedSoundNames.add(fv[0]);
        }

        // Remove dead costumes
        if (isArr(tgt.costumes)) {
          const currentCostumeIndex = tgt.currentCostume || 0;
          const currentCostume = tgt.costumes[currentCostumeIndex];
          const currentCostumeName = currentCostume ? currentCostume.name : null;

          const keptCostumes = [];
          for (const c of tgt.costumes) {
            if (allCostumesNeeded) {
              keptCostumes.push(c);
            } else if (c.name === currentCostumeName || referencedCostumeNames.has(c.name)) {
              keptCostumes.push(c);
            } else {
              st.dead_costumes_removed += 1;
            }
          }
          tgt.costumes = keptCostumes;
        }

        // Remove dead sounds
        if (isArr(tgt.sounds)) {
          const keptSounds = [];
          for (const s of tgt.sounds) {
            if (usesAnySound || referencedSoundNames.has(s.name)) {
              keptSounds.push(s);
            } else {
              st.dead_sounds_removed += 1;
            }
          }
          tgt.sounds = keptSounds;
        }
      }

      // Remove dead sprites (visible: false, no scripts, no references)
      // Return the filtered targets array to be assigned by the caller
      const keptTargets = [];
      for (const tgt of targets) {
        if (!isDict(tgt) || tgt.isStage) {
          keptTargets.push(tgt);
          continue;
        }

        const hasScripts = isDict(tgt.blocks) && Object.keys(tgt.blocks).length > 0;
        const isVisible = tgt.visible !== false;
        const isReferenced = referencedSpriteNames.has(tgt.name);

        if (!hasScripts && !isVisible && !isReferenced) {
          st.dead_sprites_removed += 1;
        } else {
          keptTargets.push(tgt);
        }
      }
      return keptTargets;
    }

    // ------------------------------------------------------------------
    // Proposal 2: Remove write-only variables and lists
    _removeWriteOnly(targets, monitors) {
      const st = this.stats;

      // In Scratch 3.0, sensing_of does NOT reference variables directly.
      // It only references sprite properties. So we don't need to check sensing_of.

      // A variable/list is "write-only" if:
      // - It is written to (set/change/add/etc.)
      // - It is NOT read from (variable reporter, list contents, item of, etc.)
      // - It is NOT shown (monitor)
      // - It is NOT a cloud variable
      // - It is NOT a standalone reporter (top-level)

      // Build read/write sets again (excluding write from "used")
      const readV = new Set();
      const writeV = new Set();
      const readL = new Set();
      const writeL = new Set();
      const showV = new Set();
      const showL = new Set();
      const standaloneV = new Set();
      const standaloneL = new Set();

      const VAR_WRITE_OPS = new Set(["data_setvariableto", "data_changevariableby", "control_for_each"]);
      const VAR_READ_OPS = new Set(["data_variable"]);
      const LIST_WRITE_OPS = new Set(["data_addtolist", "data_deleteoflist", "data_deletealloflist",
        "data_insertatlist", "data_replaceitemoflist"]);
      const LIST_READ_OPS = new Set(["data_listcontents", "data_itemoflist", "data_itemnumoflist",
        "data_lengthoflist", "data_listcontainsitem"]);

      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        const blocks = isDict(tgt.blocks) ? tgt.blocks : {};

        for (const [bid, blk] of Object.entries(blocks)) {
          if (!isDict(blk)) continue;
          const op = blk.opcode;
          const fields = blk.fields || {};

          // Variable references
          if (fields.VARIABLE) {
            const fv = fields.VARIABLE;
            const vname = fv[0];
            const vid = fv[1];

            if (VAR_WRITE_OPS.has(op)) {
              if (isStr(vid)) writeV.add(vid);
            } else if (op === "data_showvariable") {
              if (isStr(vid)) showV.add(vid);
            } else if (op === "data_hidevariable") {
              // hidden only
            } else {
              if (isStr(vid)) readV.add(vid);
            }
          }

          // List references
          if (fields.LIST) {
            const fv = fields.LIST;
            const lname = fv[0];
            const lid = fv[1];

            if (LIST_WRITE_OPS.has(op)) {
              if (isStr(lid)) writeL.add(lid);
            } else if (op === "data_showlist") {
              if (isStr(lid)) showL.add(lid);
            } else if (op === "data_hidelist") {
              // hidden only
            } else {
              if (isStr(lid)) readL.add(lid);
            }
          }

          // Top-level reporters
          if (blk.topLevel === true) {
            if (op === "data_variable") {
              const fv = fields.VARIABLE;
              if (fv && isStr(fv[1])) standaloneV.add(fv[1]);
            } else if (op === "data_listcontents") {
              const fv = fields.LIST;
              if (fv && isStr(fv[1])) standaloneL.add(fv[1]);
            }
          }
        }
      }

      // Monitor references
      for (const mon of (isArr(monitors) ? monitors : [])) {
        if (!isDict(mon)) continue;
        const op = mon.opcode;
        const params = mon.params || {};

        if (op === "data_variable") {
          const mid = mon.id;
          if (isStr(mid)) showV.add(mid);
        } else if (op === "data_listcontents") {
          const mid = mon.id;
          if (isStr(mid)) showL.add(mid);
        }
      }

      // Remove write-only variables
      for (const tgt of targets) {
        if (!isDict(tgt)) continue;
        if (isDict(tgt.variables)) {
          for (const [id, ent] of Object.entries(tgt.variables)) {
            const name = isArr(ent) && ent.length ? ent[0] : String(ent);
            const isCloud = isStr(name) && name.startsWith(CLOUD_PREFIX);

            if (isCloud) continue; // Never remove cloud variables
            if (readV.has(id) || showV.has(id) || standaloneV.has(id)) continue; // Not write-only
            if (!writeV.has(id)) continue; // Not written to at all

            delete tgt.variables[id];
            st.writeonly_vars_removed += 1;
          }
        }

        // Remove write-only lists
        if (isDict(tgt.lists)) {
          for (const [id, ent] of Object.entries(tgt.lists)) {
            if (readL.has(id) || showL.has(id) || standaloneL.has(id)) continue; // Not write-only
            if (!writeL.has(id)) continue; // Not written to at all

            delete tgt.lists[id];
            st.writeonly_lists_removed += 1;
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Proposal 4: Normalize types and representations
    _normalizeTypes(project) {
      const st = this.stats;

      // Remove md5ext from costumes and sounds
      for (const tgt of project.targets) {
        if (!isDict(tgt)) continue;

        if (isArr(tgt.costumes)) {
          for (const c of tgt.costumes) {
            if (isDict(c) && has(c, "md5ext")) {
              delete c.md5ext;
              st.md5ext_removed += 1;
            }
          }
        }

        if (isArr(tgt.sounds)) {
          for (const s of tgt.sounds) {
            if (isDict(s) && has(s, "md5ext")) {
              delete s.md5ext;
              st.md5ext_removed += 1;
            }
          }
        }
      }

      // Normalize numeric strings to numbers in variables and lists
      for (const tgt of project.targets) {
        if (!isDict(tgt)) continue;

        if (isDict(tgt.variables)) {
          for (const [id, ent] of Object.entries(tgt.variables)) {
            if (!isArr(ent) || !ent.length) continue;
            const val = ent[1];
            if (isStr(val)) {
              const num = Number(val);
              if (!Number.isNaN(num) && String(num) === val) {
                ent[1] = num;
                st.numeric_strings_normalized += 1;
              }
            }
          }
        }

        if (isDict(tgt.lists)) {
          for (const [id, ent] of Object.entries(tgt.lists)) {
            if (!isArr(ent) || !ent.length) continue;
            const arr = ent[1];
            if (isArr(arr)) {
              for (let i = 0; i < arr.length; i++) {
                const val = arr[i];
                if (isStr(val)) {
                  const num = Number(val);
                  if (!Number.isNaN(num) && String(num) === val) {
                    arr[i] = num;
                    st.numeric_strings_normalized += 1;
                  }
                }
              }
            }
          }
        }
      }

      // Clear meta.agent (already done in _processRoot, but count here if normalizeTypes is enabled)
      const meta = project.meta;
      if (isDict(meta) && has(meta, "agent")) {
        delete meta.agent;
        st.meta_agent_cleared += 1;
      }
    }

    // __PART6__
  }

  // ------------------------------------------------------------------
  // file I/O and the public API

  let JSZipLib = (typeof JSZip !== "undefined") ? JSZip : null;
  function setJSZip(lib) { JSZipLib = lib; }
  function getJSZip() {
    if (!JSZipLib) throw new CompressError("The ZIP library is not loaded.");
    return JSZipLib;
  }

  function decodeUtf8(bytes) {
    let arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (arr.length >= 3 && arr[0] === 0xEF && arr[1] === 0xBB && arr[2] === 0xBF) {
      arr = arr.subarray(3);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(arr);
    } catch (e) {
      throw new CompressError("Could not decode project.json as UTF-8.");
    }
  }

  async function loadInput(buffer, filename, progress) {
    const name = filename || "project.sb3";
    progress("load", 0.2, `Loading: ${name}`);
    let raw;
    if (buffer instanceof Uint8Array) raw = buffer;
    else raw = new Uint8Array(buffer);
    progress("load", 1.0, `Loaded (${humanSize(raw.length)})`);

    const lower = name.toLowerCase();
    let entries = [];
    let pjRaw = raw;
    let container;
    if (lower.endsWith(".json")) {
      entries = [];
      container = "json";
    } else {
      let zip;
      try {
        zip = await getJSZip().loadAsync(raw);
      } catch (e) {
        throw new CompressError(lower.endsWith(".sb3")
          ? "Could not read the .sb3 file. Is it a valid Scratch project?"
          : "Unsupported format. Expected .sb3 or project.json (.json)");
      }
      const pj = zip.file("project.json");
      if (!pj) throw new CompressError("project.json was not found inside the .sb3 file");
      pjRaw = await pj.async("uint8array");
      for (const [entryName, entry] of Object.entries(zip.files)) {
        if (entryName === "project.json" || entry.dir) continue;
        entries.push({ name: entryName, data: await entry.async("uint8array") });
      }
      container = entries.length || lower.endsWith(".sb3") ? "sb3" : "json";
    }

    const text = decodeUtf8(pjRaw);
    progress("parse", 0.4, "Parsing JSON...");
    let project;
    try {
      project = JSON.parse(text);
    } catch (e) {
      throw new CompressError("JSON parse error: " + e.message);
    }
    if (!isDict(project)) {
      throw new CompressError("The root of the JSON document is not an object");
    }
    progress("parse", 1.0, `JSON parsed (${humanSize(pjRaw.length)})`);
    return { project, container, pjRaw, entries };
  }

  async function packageSb3(entries, projectBytes, progress) {
    const zip = new (getJSZip())();
    const total = entries.length + 1;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      zip.file(entry.name, entry.data, { binary: true });
      progress("package", i / total, "Repacking .sb3...");
    }
    zip.file("project.json", projectBytes, { binary: true });
    const out = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 }
    });
    progress("package", 1.0, "Repack complete");
    return out;
  }

  function dumpsCompact(project) {
    const text = JSON.stringify(project);
    return new TextEncoder().encode(text);
  }

  function defaultOutputName(inPath) {
    const base = String(inPath || "project.sb3").split(/[\\/]/).pop() || "project.sb3";
    const dot = base.lastIndexOf(".");
    const root = dot > 0 ? base.slice(0, dot) : base;
    let ext = dot > 0 ? base.slice(dot).toLowerCase() : ".sb3";
    if (ext !== ".sb3" && ext !== ".json") ext = ".sb3";
    return root + "_compressed" + ext;
  }

  function compressProject(project, options, progress) {
    const comp = new Compressor(options, progress);
    const out = comp.run(project);
    return { project: out, stats: comp.stats };
  }

  async function compressBuffer(buffer, filename, options, progress) {
    const report = typeof progress === "function" ? progress : () => {};
    const loaded = await loadInput(buffer, filename, report);
    const comp = new Compressor(options, report);
    const project = comp.run(loaded.project);
    report("serialize", 0.5, "Serializing JSON...");
    const outBytes = dumpsCompact(project);
    report("serialize", 1.0, `JSON serialized (${humanSize(outBytes.length)})`);
    const finalBytes = loaded.container === "sb3"
      ? await packageSb3(loaded.entries, outBytes, report)
      : outBytes;
    const origJson = loaded.pjRaw.length;
    const newJson = outBytes.length;
    return {
      container: loaded.container,
      finalBytes,
      outputName: defaultOutputName(filename),
      origJsonSize: origJson,
      newJsonSize: newJson,
      origFileSize: buffer.byteLength !== undefined ? buffer.byteLength : buffer.length,
      newFileSize: finalBytes.length,
      ratio: origJson ? (1 - newJson / origJson) * 100 : 0,
      stats: comp.stats
    };
  }

  const PROGRESS_WEIGHTS = {
    load: [4, 0], parse: [6, 4], collect: [10, 10], targets: [55, 20],
    finalize: [5, 75], serialize: [10, 80], package: [10, 90]
  };
  function progressPercent(phase, frac) {
    const entry = PROGRESS_WEIGHTS[phase];
    if (!entry) return 90;
    return entry[1] + entry[0] * Math.min(Math.max(frac, 0), 1);
  }

  return {
    Options,
    Compressor,
    CompressError,
    compressProject,
    compressBuffer,
    dumpsCompact,
    defaultOutputName,
    humanSize,
    progressPercent,
    setJSZip
  };
});
