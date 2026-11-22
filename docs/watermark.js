/* SB3 Tools watermark.
 *
 * A watermark is a single XML comment inside each SVG costume:
 *
 *   <!-- SB3TOOLS-WATERMARK:1:<base64(JSON)> -->
 *
 * The payload carries the UTC compression time, the original file name, the
 * tool version, and a fixed-order bit field of the options.  XML comments are
 * ignored by Scratch and TurboWarp, and the raw SVG asset is copied through a
 * normal project save.
 *
 * All option keys are encoded least-significant-bit first: key 0 is bit 0 of
 * byte 0, key 7 is bit 7 of byte 0, key 8 is bit 0 of byte 1, and so on.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SB3Watermark = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const VERSION = "1.0.0";
  const MARKER = "SB3TOOLS-WATERMARK";
  const SCHEMA = 1;

  // The order is part of the on-disk format.  Keep it stable: the checker and
  // older watermarks depend on these positions.
  const PROJECT_OPTION_KEYS = [
    "stripDefaults", "shortenIds", "renameStores", "removeUnused", "removeMonitors",
    "compressProcs", "freqIds", "dropObscuredShadows", "removeUnreachable",
    "clearInitialValues", "extractDuplicates", "nearDuplicates", "simplifyIfElse",
    "removeNoops", "inlineSingleCall", "foldConstants", "loopDuplicates",
    "propagateConstants", "reuseReporters", "stripComments", "compactWorkspace",
    "removeDeadAssets", "removeWriteOnly", "normalizeTypes", "stripNullFieldIds",
    "zeroTopLevelCoords"
  ];

  // The full compressor has a second group of boolean media options.  The
  // project compressor uses only PROJECT_OPTION_KEYS.  New flags are appended
  // so existing watermark bit positions stay readable.
  const MEDIA_OPTION_KEYS = [
    "pngOptimize", "svgToPng", "minPx", "wavToMp3", "reencodeMp3",
    "pngPalette", "pngLossless"
  ];

  function isDict(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isArr(value) {
    return Array.isArray(value);
  }

  function baseName(value) {
    return String(value || "project.sb3").split(/[\\/]/).pop() || "project.sb3";
  }

  function encodeFlags(options, keys) {
    const bytes = new Uint8Array(Math.ceil(keys.length / 8));
    for (let i = 0; i < keys.length; i++) {
      if (options && options[keys[i]] === true) {
        bytes[i >> 3] |= 1 << (i & 7);
      }
    }
    let out = "";
    for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
    return out;
  }

  function decodeFlags(hex, keys) {
    const clean = String(hex || "").replace(/[^0-9a-f]/gi, "");
    const bytes = [];
    for (let i = 0; i + 1 < clean.length; i += 2) {
      bytes.push(parseInt(clean.slice(i, i + 2), 16));
    }
    return keys.map((key, i) => ({
      key,
      enabled: !!(bytes[i >> 3] & (1 << (i & 7)))
    }));
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
    // This fallback is only for very old runtimes; the rest of the tools
    // already require TextEncoder for project.json.
    const escaped = unescape(encodeURIComponent(text));
    const out = new Uint8Array(escaped.length);
    for (let i = 0; i < escaped.length; i++) out[i] = escaped.charCodeAt(i);
    return out;
  }

  function utf8Text(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return decodeURIComponent(escape(binary));
  }

  function base64Encode(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64Decode(text) {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(text, "base64"));
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  // --- MD5 over bytes -------------------------------------------------
  // Assets are content-addressed by MD5.  WebCrypto deliberately does not
  // implement MD5, so the browser build carries this small byte-oriented
  // implementation.  It is tested against Node's crypto in the regression
  // suite.
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const MD5_K = (() => {
    const table = new Uint32Array(64);
    for (let i = 0; i < 64; i++) table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    return table;
  })();

  function rotl(value, bits) {
    return ((value << bits) | (value >>> (32 - bits))) | 0;
  }

  function md5Bytes(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const length = bytes.length;
    const total = (((length + 8) >>> 6) + 1) * 64;
    const data = new Uint8Array(total);
    data.set(bytes);
    data[length] = 0x80;
    const view = new DataView(data.buffer);
    const bitLength = length * 8;
    view.setUint32(total - 8, bitLength >>> 0, true);
    view.setUint32(total - 4, Math.floor(bitLength / 0x100000000) >>> 0, true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const words = new Uint32Array(16);

    for (let offset = 0; offset < total; offset += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, true);
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let i = 0; i < 64; i++) {
        let f;
        let g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) & 15;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) & 15;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) & 15;
        }
        const nextD = d;
        d = c;
        c = b;
        b = (b + rotl((a + f + MD5_K[i] + words[g]) | 0, MD5_S[i])) | 0;
        a = nextD;
      }
      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }

    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, a0 >>> 0, true);
    outView.setUint32(4, b0 >>> 0, true);
    outView.setUint32(8, c0 >>> 0, true);
    outView.setUint32(12, d0 >>> 0, true);
    let hex = "";
    for (const byte of out) hex += byte.toString(16).padStart(2, "0");
    return hex;
  }

  // --- payload and SVG helpers ---------------------------------------
  function createPayload(info) {
    const source = isDict(info) ? info : {};
    const kind = source.kind === "full" ? "full"
      : source.kind === "media" ? "media" : "project";
    const payload = {
      s: SCHEMA,
      k: kind,
      t: source.time || new Date().toISOString(),
      n: baseName(source.name || "project.sb3"),
      v: String(source.version || VERSION),
      o: encodeFlags(source.options || {}, PROJECT_OPTION_KEYS)
    };
    if (kind === "full" || kind === "media") {
      payload.m = encodeFlags(source.media || {}, MEDIA_OPTION_KEYS);
    }
    return payload;
  }

  function encodePayload(payload) {
    return base64Encode(utf8Bytes(JSON.stringify(payload)));
  }

  function decodePayload(text) {
    try {
      const value = JSON.parse(utf8Text(base64Decode(String(text || ""))));
      return isDict(value) ? value : null;
    } catch (_) {
      return null;
    }
  }

  function makeComment(payload) {
    return "<!-- " + MARKER + ":" + SCHEMA + ":" + encodePayload(payload) + " -->";
  }

  function stripWatermarks(svgText) {
    return String(svgText).replace(/<!--\s*SB3TOOLS-WATERMARK(?::[^]*?)?-->/gi, "");
  }

  function insertWatermark(svgText, comment) {
    const text = String(svgText);
    const root = /<svg\b[^>]*>/i.exec(text);
    if (!root) return null;
    const tag = root[0];
    const at = root.index + tag.length;
    // A self-closing root would put the comment outside the SVG element,
    // where Scratch's SVG loader may discard it. Turn it into a normal root
    // and keep the watermark inside.
    if (/\/\s*>$/.test(tag)) {
      const open = tag.replace(/\/\s*>$/, ">");
      return text.slice(0, root.index) + open + "\n  " + comment + "\n</svg>" + text.slice(at);
    }
    return text.slice(0, at) + "\n  " + comment + text.slice(at);
  }

  function applyToSvg(svgText, payload) {
    const stripped = stripWatermarks(svgText);
    return insertWatermark(stripped, makeComment(payload));
  }

  function parseSvg(svgText) {
    const text = String(svgText || "");
    const out = [];
    const re = /<!--\s*SB3TOOLS-WATERMARK:(\d+):([A-Za-z0-9+/=]+)\s*-->/gi;
    let match;
    while ((match = re.exec(text))) {
      const payload = decodePayload(match[2]);
      out.push({
        schema: Number(match[1]),
        raw: match[0],
        payload,
        flags: payload ? decodeFlags(payload.o, PROJECT_OPTION_KEYS) : [],
        mediaFlags: payload && (payload.k === "full" || payload.k === "media")
          ? decodeFlags(payload.m, MEDIA_OPTION_KEYS)
          : []
      });
    }
    return out;
  }

  function findEntry(entries, name) {
    const wanted = String(name || "").toLowerCase();
    if (!wanted) return null;
    let found = entries.find((entry) => String(entry.name || "").toLowerCase() === wanted);
    if (found) return found;
    const base = wanted.split("/").pop();
    found = entries.find((entry) =>
      String(entry.name || "").toLowerCase().split("/").pop() === base);
    return found || null;
  }

  function entryNameForCostume(costume) {
    if (costume && typeof costume.md5ext === "string" && /\.svg$/i.test(costume.md5ext)) {
      return costume.md5ext;
    }
    if (costume && typeof costume.assetId === "string" && costume.assetId) {
      return costume.assetId + ".svg";
    }
    return "";
  }

  /**
   * Add/replace the watermark on every referenced SVG costume asset.
   *
   * `project` is modified in place and returned for convenience.  `entries` is
   * an array of `{name, data}` zip entries; a new array is returned.  The
   * function updates assetId/md5ext on every costume that shared an old SVG.
   */
  function applyToProject(project, entries, info) {
    const source = isDict(project) ? project : {};
    const inputEntries = isArr(entries) ? entries.slice() : [];
    const payload = createPayload(info);
    const comment = makeComment(payload);
    const seenById = new Map();
    const seenByName = new Map();
    let watermarked = 0;
    let skipped = 0;

    const targets = isArr(source.targets) ? source.targets : [];
    for (const target of targets) {
      if (!isDict(target) || !isArr(target.costumes)) continue;
      for (const costume of target.costumes) {
        if (!isDict(costume) || String(costume.dataFormat || "").toLowerCase() !== "svg") continue;
        const oldId = typeof costume.assetId === "string" ? costume.assetId : "";
        const oldName = entryNameForCostume(costume);
        let change = seenById.get(oldId) || seenByName.get(String(oldName).toLowerCase());
        if (!change) {
          const entry = findEntry(inputEntries, oldName);
          if (!entry || !entry.data) {
            skipped += 1;
            continue;
          }
          let text;
          try {
            text = utf8Text(entry.data instanceof Uint8Array
              ? entry.data
              : new Uint8Array(entry.data));
          } catch (_) {
            skipped += 1;
            continue;
          }
          const changedText = applyToSvg(text, payload);
          if (changedText === null) {
            skipped += 1;
            continue;
          }
          const changedBytes = utf8Bytes(changedText);
          const newId = md5Bytes(changedBytes);
          const slash = String(entry.name).lastIndexOf("/");
          const dir = slash >= 0 ? String(entry.name).slice(0, slash + 1) : "";
          const newName = dir + newId + ".svg";
          const index = inputEntries.indexOf(entry);
          if (index >= 0) inputEntries[index] = { name: newName, data: changedBytes };
          change = { oldId, oldName: entry.name, newId, newName };
          seenById.set(oldId, change);
          seenByName.set(String(entry.name).toLowerCase(), change);
          seenByName.set(String(newName).toLowerCase(), change);
          watermarked += 1;
        }
        costume.assetId = change.newId;
        if (Object.prototype.hasOwnProperty.call(costume, "md5ext")) {
          costume.md5ext = change.newName;
        }
        if (Object.prototype.hasOwnProperty.call(costume, "md5")) {
          costume.md5 = change.newName;
        }
      }
    }

    return {
      project: source,
      entries: inputEntries,
      payload,
      watermarked,
      skipped
    };
  }

  /**
   * Read watermark records from the referenced SVG costumes.
   * Returns one row per referenced SVG asset, including unmarked ones.
   */
  function inspectProject(project, entries) {
    const source = isDict(project) ? project : {};
    const inputEntries = isArr(entries) ? entries : [];
    const byOldId = new Map();
    const rows = [];
    const targets = isArr(source.targets) ? source.targets : [];

    for (const target of targets) {
      if (!isDict(target) || !isArr(target.costumes)) continue;
      for (const costume of target.costumes) {
        if (!isDict(costume) || String(costume.dataFormat || "").toLowerCase() !== "svg") continue;
        const oldId = typeof costume.assetId === "string" ? costume.assetId : "";
        const oldName = entryNameForCostume(costume);
        let row = byOldId.get(oldId) || byOldId.get(oldName.toLowerCase());
        if (!row) {
          const entry = findEntry(inputEntries, oldName);
          let text = null;
          let error = "";
          if (!entry) error = "missing SVG asset";
          else {
            try {
              text = utf8Text(entry.data instanceof Uint8Array
                ? entry.data
                : new Uint8Array(entry.data));
            } catch (_) {
              error = "unreadable SVG asset";
            }
          }
          row = {
            assetId: oldId,
            file: entry ? entry.name : oldName,
            costumeNames: [],
            records: text === null ? [] : parseSvg(text),
            error
          };
          rows.push(row);
          byOldId.set(oldId, row);
          byOldId.set(oldName.toLowerCase(), row);
          byOldId.set(String(row.file).toLowerCase(), row);
        }
        row.costumeNames.push(String(costume.name || ""));
      }
    }

    const records = [];
    for (const row of rows) {
      for (const record of row.records) {
        records.push(Object.assign({ file: row.file, costumeNames: row.costumeNames.slice() }, record));
      }
    }
    return {
      rows,
      records,
      svgAssets: rows.length,
      svgCostumes: rows.reduce((sum, row) => sum + row.costumeNames.length, 0),
      watermarkedAssets: rows.filter((row) => row.records.length > 0).length,
      unmarkedAssets: rows.filter((row) => row.records.length === 0).length,
      invalidAssets: rows.filter((row) => row.error).length
    };
  }

  return {
    VERSION,
    MARKER,
    SCHEMA,
    PROJECT_OPTION_KEYS,
    MEDIA_OPTION_KEYS,
    encodeFlags,
    decodeFlags,
    md5Bytes,
    baseName,
    createPayload,
    encodePayload,
    decodePayload,
    makeComment,
    stripWatermarks,
    insertWatermark,
    applyToSvg,
    parseSvg,
    applyToProject,
    inspectProject
  };
});
