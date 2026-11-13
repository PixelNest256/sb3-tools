/* SB3 Repair — engine.
 *
 * Reads a damaged Scratch / TurboWarp .sb3, recovers what it can, repairs the
 * project structure, validates the result, and repacks a loadable .sb3.
 *
 * The engine has no network access and no dependencies beyond JSZip. It is
 * written as a UMD module so the browser page and the Node regression checks
 * share exactly the same code.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.REPAIR = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const VERSION = "1.0.0";

  // Scratch's core extension prefixes. Anything else in an opcode is treated
  // as an extension id by scratch-vm's sb3 serializer.
  const CORE_EXTENSIONS = [
    "argument", "colour", "control", "data", "event", "looks", "math",
    "motion", "operator", "procedures", "sensing", "sound"
  ];

  const PRIMITIVE_OPCODES = {
    4: "math_number",
    5: "math_positive_number",
    6: "math_whole_number",
    7: "math_integer",
    8: "math_angle",
    9: "colour_picker",
    10: "text",
    11: "event_broadcast_menu",
    12: "data_variable",
    13: "data_listcontents"
  };

  const COSTUME_FORMATS = ["png", "svg", "jpeg", "jpg", "bmp", "gif"];
  const SOUND_FORMATS = ["wav", "wave", "mp3"];

  const SEV = { error: "error", warning: "warning", info: "info" };

  // A transparent 1x1 PNG and a silent 16-bit mono WAV. Both are fixed bytes,
  // so their MD5s are constants (checked by build/check/repair-invariants.mjs).
  const PLACEHOLDER_PNG = b64ToBytes(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII="
  );
  const PLACEHOLDER_WAV = makeSilentWav(22050, 1 / 22050);

  // ---------------------------------------------------------------- basics

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function isObj(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isScalar(value) {
    return typeof value === "string" || typeof value === "number" ||
      typeof value === "boolean";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function utf8Decode(bytes) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  function utf8Encode(text) {
    return new TextEncoder().encode(text);
  }

  function hex(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out;
  }

  function b64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function bytesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function makeSilentWav(sampleRate, seconds) {
    const frames = Math.max(1, Math.floor(sampleRate * seconds));
    const dataSize = frames * 2;
    const out = new Uint8Array(44 + dataSize);
    const view = new DataView(out.buffer);
    writeAscii(out, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(out, 8, "WAVE");
    writeAscii(out, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(out, 36, "data");
    view.setUint32(40, dataSize, true);
    return out;
  }

  function writeAscii(bytes, offset, text) {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i) & 0xff;
  }

  // ------------------------------------------------------------- checksums

  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // MD5 over raw bytes. Asset ids are the MD5 of the asset bytes, so this is
  // what lets us detect and repair a renamed or mismatched asset.
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const MD5_K = (function () {
    const out = new Uint32Array(64);
    for (let i = 0; i < 64; i++) out[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    return out;
  })();

  function md5(bytes) {
    const len = bytes.length;
    const padded = new Uint8Array(((len + 8) >>> 6) * 64 + 64);
    padded.set(bytes);
    padded[len] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, (len * 8) >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(len / 536870912), true);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const m = new Uint32Array(16);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) m[i] = view.getUint32(off + i * 4, true);
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
        else { f = c ^ (b | ~d); g = (7 * i) & 15; }
        const tmp = d;
        d = c;
        c = b;
        const sum = (a + f + MD5_K[i] + m[g]) >>> 0;
        b = (b + ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i])))) >>> 0;
        a = tmp;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }
    const out = new Uint8Array(16);
    const ov = new DataView(out.buffer);
    ov.setUint32(0, a0, true);
    ov.setUint32(4, b0, true);
    ov.setUint32(8, c0, true);
    ov.setUint32(12, d0, true);
    return out;
  }

  function md5hex(bytes) {
    return hex(md5(bytes));
  }

  // ------------------------------------------------------------- zip salvage

  const SIG_LOCAL = 0x04034b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_EOCD = 0x06054b50;
  const SIG_DESCRIPTOR = 0x08074b50;

  function u16(buf, off) {
    return buf[off] | (buf[off + 1] << 8);
  }
  function u32(buf, off) {
    return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
  }
  function u64(buf, off) {
    return u32(buf, off) + u32(buf, off + 4) * 4294967296;
  }
  function findSignature(buf, sig, from, to) {
    const limit = Math.min(to === undefined ? buf.length : to, buf.length) - 4;
    for (let i = Math.max(0, from || 0); i <= limit; i++) {
      if (buf[i] === (sig & 0xff) && buf[i + 1] === ((sig >>> 8) & 0xff) &&
        buf[i + 2] === ((sig >>> 16) & 0xff) && buf[i + 3] === ((sig >>> 24) & 0xff)) {
        return i;
      }
    }
    return -1;
  }

  function zip64Extra(extra, needUncomp, needComp, needOffset) {
    const out = { uncompSize: null, compSize: null, localOffset: null };
    let p = 0;
    while (p + 4 <= extra.length) {
      const id = u16(extra, p);
      const size = u16(extra, p + 2);
      p += 4;
      if (p + size > extra.length) break;
      if (id === 0x0001) {
        let q = p;
        if (needUncomp && q + 8 <= p + size) { out.uncompSize = u64(extra, q); q += 8; }
        if (needComp && q + 8 <= p + size) { out.compSize = u64(extra, q); q += 8; }
        if (needOffset && q + 8 <= p + size) { out.localOffset = u64(extra, q); q += 8; }
      }
      p += size;
    }
    return out;
  }

  function parseLocalHeader(buf, off) {
    if (off + 30 > buf.length || u32(buf, off) !== SIG_LOCAL) return null;
    const version = u16(buf, off + 4);
    const flags = u16(buf, off + 6);
    const method = u16(buf, off + 8);
    if (version > 63 || (flags & 1)) return null;
    const crc = u32(buf, off + 14);
    let compSize = u32(buf, off + 18);
    let uncompSize = u32(buf, off + 22);
    const nameLen = u16(buf, off + 26);
    const extraLen = u16(buf, off + 28);
    if (nameLen < 1 || nameLen > 4096) return null;
    const nameStart = off + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (dataStart > buf.length) return null;
    let name;
    try {
      name = utf8Decode(buf.subarray(nameStart, nameStart + nameLen));
    } catch (_) {
      return null;
    }
    if (!name || name.indexOf("\u0000") >= 0) return null;
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || compSize === 0 && (flags & 8)) {
      const z = zip64Extra(buf.subarray(nameStart + nameLen, dataStart), uncompSize === 0xffffffff, compSize === 0xffffffff, false);
      if (z.uncompSize !== null) uncompSize = z.uncompSize;
      if (z.compSize !== null) compSize = z.compSize;
    }
    return {
      offset: off, version, flags, method, crc, compSize, uncompSize,
      name: normalizeEntryName(name), dataStart
    };
  }

  function parseCentralHeader(buf, off) {
    if (off + 46 > buf.length || u32(buf, off) !== SIG_CENTRAL) return null;
    const flags = u16(buf, off + 8);
    const method = u16(buf, off + 10);
    const crc = u32(buf, off + 16);
    let compSize = u32(buf, off + 20);
    let uncompSize = u32(buf, off + 24);
    const nameLen = u16(buf, off + 28);
    const extraLen = u16(buf, off + 30);
    const commentLen = u16(buf, off + 32);
    let localOffset = u32(buf, off + 42);
    if (nameLen < 1 || nameLen > 4096) return null;
    const nameStart = off + 46;
    const extraStart = nameStart + nameLen;
    const end = extraStart + extraLen + commentLen;
    if (end > buf.length) return null;
    const z = zip64Extra(buf.subarray(extraStart, extraStart + extraLen),
      uncompSize === 0xffffffff, compSize === 0xffffffff, localOffset === 0xffffffff);
    if (z.uncompSize !== null) uncompSize = z.uncompSize;
    if (z.compSize !== null) compSize = z.compSize;
    if (z.localOffset !== null) localOffset = z.localOffset;
    let name;
    try {
      name = utf8Decode(buf.subarray(nameStart, extraStart));
    } catch (_) {
      return null;
    }
    if (!name || name.indexOf("\u0000") >= 0) return null;
    return {
      offset: off, flags, method, crc, compSize, uncompSize,
      localOffset, name: normalizeEntryName(name)
    };
  }

  function normalizeEntryName(name) {
    return String(name).replace(/\\/g, "/").replace(/^\.?\//, "");
  }

  function basename(name) {
    return String(name).split("/").pop();
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser does not support raw DEFLATE decompression.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  function findDescriptor(buf, start, limit) {
    let sig = findSignature(buf, SIG_DESCRIPTOR, start, limit);
    if (sig >= 0 && sig + 16 <= limit) {
      const comp = u32(buf, sig + 8);
      const uncomp = u32(buf, sig + 12);
      return { at: sig, crc: u32(buf, sig + 4), compSize: comp, uncompSize: uncomp, signed: true };
    }
    // Unsigned descriptor: look for a triple whose compressed size lands at
    // the position being examined. Only try the aligned spot and a small
    // window; it is a fallback, not the primary path.
    for (let at = start + 4; at + 12 <= limit; at++) {
      const comp = u32(buf, at + 4);
      const uncomp = u32(buf, at + 8);
      if (comp === at - start && uncomp <= 0x7fffffff) {
        return { at, crc: u32(buf, at), compSize: comp, uncompSize: uncomp, signed: false };
      }
    }
    return null;
  }

  /**
   * Recover entries by scanning local file headers. This is what lets a file
   * whose central directory or EOCD is missing (an interrupted download, a
   * truncated upload) still open. Compressed data is inflated directly; the
   * central directory, when present, supplies exact sizes.
   */
  async function salvageZip(raw) {
    const buf = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const central = [];
    for (let off = 0; off < buf.length - 4;) {
      const found = findSignature(buf, SIG_CENTRAL, off);
      if (found < 0) break;
      const rec = parseCentralHeader(buf, found);
      if (rec) central.push(rec);
      off = found + 4;
    }
    const centralByName = new Map();
    central.forEach((rec) => {
      if (!centralByName.has(rec.name)) centralByName.set(rec.name, []);
      centralByName.get(rec.name).push(rec);
    });

    const locals = [];
    for (let off = 0; off < buf.length - 4;) {
      const found = findSignature(buf, SIG_LOCAL, off);
      if (found < 0) break;
      const rec = parseLocalHeader(buf, found);
      if (rec) locals.push(rec);
      off = found + 4;
    }

    const nextStart = (index) => {
      for (let i = index + 1; i < locals.length; i++) {
        if (locals[i].offset > locals[index].offset) return locals[i].offset;
      }
      const cd = findSignature(buf, SIG_CENTRAL, locals[index].dataStart);
      if (cd >= 0) return cd;
      const eocd = findSignature(buf, SIG_EOCD, locals[index].dataStart);
      if (eocd >= 0) return eocd;
      return buf.length;
    };

    const candidates = [];
    const notes = [];
    for (let i = 0; i < locals.length; i++) {
      const local = locals[i];
      if (local.method !== 0 && local.method !== 8) {
        notes.push({ code: "ZIP_UNSUPPORTED_METHOD", name: local.name, method: local.method });
        continue;
      }
      let cds = centralByName.get(local.name) || [];
      let centralRec = null;
      let bestDistance = Infinity;
      cds.forEach((c) => {
        const distance = Math.abs(c.localOffset - local.offset);
        if (distance < bestDistance) { bestDistance = distance; centralRec = c; }
      });
      if (centralRec && bestDistance > 64 * 1024 * 1024) centralRec = null;

      const method = centralRec ? centralRec.method : local.method;
      const flags = centralRec ? centralRec.flags : local.flags;
      let crc = centralRec ? centralRec.crc : local.crc;
      let compSize = centralRec ? centralRec.compSize : local.compSize;
      let uncompSize = centralRec ? centralRec.uncompSize : local.uncompSize;
      if (!compSize && local.compSize) compSize = local.compSize;
      if (!uncompSize && local.uncompSize) uncompSize = local.uncompSize;

      const limit = nextStart(i);
      let descriptor = null;
      if ((flags & 8) || !compSize) {
        descriptor = findDescriptor(buf, local.dataStart, Math.min(limit, buf.length));
        if (descriptor) {
          if (!crc) crc = descriptor.crc;
          if (!compSize) compSize = descriptor.compSize;
          if (!uncompSize) uncompSize = descriptor.uncompSize;
        }
      }

      let ends = [];
      if (compSize && local.dataStart + compSize <= buf.length) ends.push(local.dataStart + compSize);
      if (descriptor && descriptor.at >= local.dataStart) ends.push(descriptor.at);
      ends.push(limit);
      ends.push(buf.length);
      ends = Array.from(new Set(ends)).filter((v) => v >= local.dataStart && v <= buf.length);

      let data = null;
      let usedEnd = -1;
      let lastError = null;
      for (const end of ends) {
        const compressed = buf.subarray(local.dataStart, end);
        if (method === 0) {
          if (!compSize || compressed.length === compSize || compressed.length === uncompSize) {
            if (uncompSize && compressed.length !== uncompSize) continue;
            data = compressed;
            usedEnd = end;
            break;
          }
          continue;
        }
        // Raw DEFLATE tolerates trailing padding in some implementations but
        // not all. Try the exact candidate, then trim a small trailer (data
        // descriptor/padding) before giving up.
        for (let trim = 0; trim <= 16 && trim < compressed.length; trim++) {
          const slice = trim ? compressed.subarray(0, compressed.length - trim) : compressed;
          try {
            data = await inflateRaw(slice);
            usedEnd = end - trim;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (data) break;
      }

      if (!data) {
        notes.push({
          code: "ZIP_ENTRY_UNREADABLE", name: local.name,
          message: lastError ? String(lastError.message || lastError) : "could not decompress"
        });
        continue;
      }

      const actualCrc = crc32(data);
      const crcOk = !crc || actualCrc === crc;
      candidates.push({
        name: local.name,
        data,
        actualCrc,
        crcOk,
        crc,
        method,
        localOffset: local.offset,
        usedEnd
      });
    }

    // Deduplicate by name. Prefer a CRC-valid copy, then the largest copy,
    // then an entry backed by a central-directory record.
    const byName = new Map();
    for (const cand of candidates) {
      const prev = byName.get(cand.name);
      if (!prev) { byName.set(cand.name, cand); continue; }
      if (cand.crcOk !== prev.crcOk) {
        if (cand.crcOk) byName.set(cand.name, cand);
        continue;
      }
      if (cand.data.length > prev.data.length) byName.set(cand.name, cand);
    }

    const entries = new Map();
    const order = [];
    for (const cand of byName.values()) {
      entries.set(cand.name, cand.data);
      order.push(cand.name);
      if (!cand.crcOk) {
        notes.push({ code: "ZIP_ENTRY_CRC", name: cand.name, expected: cand.crc, actual: cand.actualCrc });
      }
    }
    return { entries, order, notes, centralCount: central.length, localCount: locals.length };
  }

  // --------------------------------------------------------- JSON recovery

  function stripBom(text) {
    return text.replace(/^\uFEFF+/, "");
  }

  function scratchBackspaceFix(text) {
    return text.replace(/(\\+)(b|u0008)/g, (match, backslash, code) => {
      if (backslash.length % 2) return match.replace("\\" + code, "");
      return match;
    });
  }

  function escapeControlChars(text) {
    let out = "";
    let inString = false;
    let escaped = false;
    let changed = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const code = text.charCodeAt(i);
      if (inString) {
        if (escaped) { out += ch; escaped = false; continue; }
        if (ch === "\\") { out += ch; escaped = true; continue; }
        if (ch === "\"") { out += ch; inString = false; continue; }
        if (code < 0x20) {
          changed = true;
          if (ch === "\n") out += "\\n";
          else if (ch === "\r") out += "\\r";
          else if (ch === "\t") out += "\\t";
          else out += "\\u" + code.toString(16).padStart(4, "0");
          continue;
        }
        out += ch;
      } else {
        if (ch === "\"") { out += ch; inString = true; continue; }
        if (code < 0x20) {
          if (ch === "\n" || ch === "\r" || ch === "\t") out += ch;
          else { out += " "; changed = true; }
          continue;
        }
        out += ch;
      }
    }
    return { text: out, changed };
  }

  function removeTrailingCommas(text) {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        out += ch;
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") { inString = true; out += ch; continue; }
      if (ch === ",") {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] === "}" || text[j] === "]") continue;
      }
      out += ch;
    }
    return out;
  }

  function scanJsonState(text) {
    let inString = false;
    let escaped = false;
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") inString = true;
      else if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    return { inString, escaped, stack };
  }

  function extractFirstJsonValue(text) {
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "{" || text[i] === "[") { start = i; break; }
    }
    if (start < 0) return null;
    let inString = false;
    let escaped = false;
    const stack = [];
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") { inString = true; continue; }
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") {
        stack.pop();
        if (!stack.length) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  function closeTruncatedJson(text) {
    let out = text.replace(/[\s\u0000]+$/g, "");
    // A trailing comma or colon cannot be closed into a valid value. Move back
    // to the previous member boundary.
    if (/[,:]$/.test(out)) {
      let depth = 0, inString = false, escaped = false, cut = -1;
      for (let i = out.length - 1; i >= 0; i--) {
        const ch = out[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === "\"") inString = false;
          continue;
        }
        if (ch === "\"") { inString = true; continue; }
        if (ch === "}" || ch === "]") depth++;
        else if (ch === "{" || ch === "[") {
          if (depth === 0) break;
          depth--;
        } else if ((ch === "," || ch === ":") && depth === 0) {
          cut = i;
          break;
        }
      }
      if (cut >= 0) out = out.slice(0, cut);
    }
    out = out.replace(/,\s*$/, "");
    const state = scanJsonState(out);
    if (state.inString) out += "\"";
    for (let i = state.stack.length - 1; i >= 0; i--) out += state.stack[i] === "{" ? "}" : "]";
    return out;
  }

  /**
   * A last-resort tolerant parser. It builds the largest well-formed prefix
   * of an object/array and drops an incomplete trailing member. Used only
   * after JSON.parse and every string-level repair has failed.
   */
  function parseJsonLoose(text) {
    let i = 0;
    const len = text.length;
    function ws() { while (i < len && /\s/.test(text[i])) i++; }
    function parseString() {
      if (text[i] !== "\"") throw new Error("string");
      i++;
      let out = "";
      while (i < len) {
        const ch = text[i++];
        if (ch === "\"") return out;
        if (ch === "\\") {
          if (i >= len) return out;
          const esc = text[i++];
          if (esc === "u") {
            const h = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) return out;
            out += String.fromCharCode(parseInt(h, 16));
            i += 4;
          } else if (esc === "n") out += "\n";
          else if (esc === "r") out += "\r";
          else if (esc === "t") out += "\t";
          else if (esc === "b") out += "\b";
          else if (esc === "f") out += "\f";
          else out += esc;
          continue;
        }
        out += ch;
      }
      return out;
    }
    function parseNumber() {
      const start = i;
      while (i < len && /[0-9eE+\-.]/.test(text[i])) i++;
      const token = text.slice(start, i);
      if (!token) throw new Error("number");
      const n = Number(token);
      return Number.isFinite(n) ? n : 0;
    }
    function skipJunk() {
      while (i < len && text[i] !== "," && text[i] !== "}" && text[i] !== "]" &&
        text[i] !== "\"" && text[i] !== "{" && text[i] !== "[") i++;
    }
    function parseObject() {
      const out = {};
      i++;
      while (true) {
        ws();
        if (i >= len) return out;
        if (text[i] === "}") { i++; return out; }
        if (text[i] === ",") { i++; continue; }
        if (text[i] !== "\"") {
          skipJunk();
          if (i >= len) return out;
          if (text[i] === "," || text[i] === "}") continue;
          if (text[i] !== "\"") return out;
        }
        let key;
        try { key = parseString(); } catch (_) { return out; }
        ws();
        if (i >= len) return out;
        if (text[i] !== ":") {
          skipJunk();
          if (i >= len) return out;
          if (text[i] !== ":") continue;
        }
        i++;
        let value;
        try { value = parseValue(); } catch (_) { return out; }
        out[key] = value;
        ws();
        if (i >= len) return out;
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return out; }
        skipJunk();
      }
    }
    function parseArray() {
      const out = [];
      i++;
      while (true) {
        ws();
        if (i >= len) return out;
        if (text[i] === "]") { i++; return out; }
        if (text[i] === ",") { i++; continue; }
        let value;
        try { value = parseValue(); } catch (_) { return out; }
        out.push(value);
        ws();
        if (i >= len) return out;
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return out; }
        skipJunk();
      }
    }
    function parseValue() {
      ws();
      if (i >= len) throw new Error("eof");
      const ch = text[i];
      if (ch === "{") return parseObject();
      if (ch === "[") return parseArray();
      if (ch === "\"") return parseString();
      if (text.startsWith("true", i)) { i += 4; return true; }
      if (text.startsWith("false", i)) { i += 5; return false; }
      if (text.startsWith("null", i)) { i += 4; return null; }
      return parseNumber();
    }
    const result = parseValue();
    ws();
    return result;
  }

  function normalizeJsonLiterals(text) {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        out += ch;
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") { inString = true; out += ch; continue; }
      if (text.startsWith("True", i) && !/[\w]/.test(text[i + 4] || "")) {
        out += "true"; i += 3; continue;
      }
      if (text.startsWith("False", i) && !/[\w]/.test(text[i + 5] || "")) {
        out += "false"; i += 4; continue;
      }
      if (text.startsWith("None", i) && !/[\w]/.test(text[i + 4] || "")) {
        out += "null"; i += 3; continue;
      }
      out += ch;
    }
    return out;
  }

  function normalizeLeadingZeroNumbers(text) {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        out += ch;
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") { inString = true; out += ch; continue; }
      if (ch === "-" || (ch >= "0" && ch <= "9")) {
        const prev = i > 0 ? text[i - 1] : "";
        if ((prev >= "0" && prev <= "9") || prev === "." || prev === "e" || prev === "E") {
          out += ch;
          continue;
        }
        const rest = text.slice(i);
        const match = rest.match(/^-?0+(\d+)(?=$|[\s,\]}])/);
        if (match) {
          out += (ch === "-" ? "-" : "") + match[1];
          i += match[0].length - 1;
          continue;
        }
      }
      out += ch;
    }
    return out;
  }

  function repairMissingStringQuote(text) {
    // A quote moved past the comma: `"value,"next":` -> `"value","next":`.
    return text.replace(/([:,\[]\s*)"([^",]+),("(?:[A-Za-z_][\w-]*)"\s*:)/g, '$1"$2",$3');
  }

  function repairMismatchedBracket(text) {
    // An empty object closed by `]` instead of `}`.
    return text.replace(/\{(\s*)\]/g, "{$1}");
  }

  function parseProjectText(rawText) {
    const notes = [];
    let text = stripBom(rawText);
    text = text.replace(/^\u0000+|\u0000+$/g, "");
    try {
      return { project: JSON.parse(text), method: "direct", notes };
    } catch (_) { /* fall through */ }

    const attempts = [];
    const backspace = scratchBackspaceFix(text);
    if (backspace !== text) attempts.push({ text: backspace, method: "backspace", note: "Removed Scratch 2.0 backspace escapes." });
    const controls = escapeControlChars(text);
    if (controls.changed) attempts.push({ text: controls.text, method: "controls", note: "Escaped raw control characters inside JSON strings." });
    const literals = normalizeJsonLiterals(text);
    if (literals !== text) attempts.push({ text: literals, method: "literals", note: "Converted Python-style JSON literals to JSON." });
    const numbers = normalizeLeadingZeroNumbers(text);
    if (numbers !== text) attempts.push({ text: numbers, method: "numbers", note: "Removed leading zeroes from JSON numbers." });
    const noCommas = removeTrailingCommas(text);
    if (noCommas !== text) attempts.push({ text: noCommas, method: "trailing-commas", note: "Removed trailing commas." });
    const brackets = repairMismatchedBracket(text);
    if (brackets !== text) attempts.push({ text: brackets, method: "brackets", note: "Replaced an object-closing bracket." });
    const quotes = repairMissingStringQuote(text);
    if (quotes !== text) attempts.push({ text: quotes, method: "string-quote", note: "Restored a string's closing quote before a comma." });
    const repairedSyntax = repairMissingStringQuote(repairMismatchedBracket(normalizeLeadingZeroNumbers(normalizeJsonLiterals(removeTrailingCommas(controls.text)))));
    if (!attempts.some((a) => a.text === repairedSyntax)) {
      attempts.push({ text: repairedSyntax, method: "syntax", note: "Repaired JSON string quotes, brackets, literals and trailing commas." });
    }
    const closed = closeTruncatedJson(text);
    if (closed !== text) attempts.push({ text: closed, method: "truncated", note: "Closed a truncated JSON document." });
    const combined = closeTruncatedJson(removeTrailingCommas(controls.text));
    if (!attempts.some((a) => a.text === combined)) {
      attempts.push({ text: combined, method: "combined", note: "Repaired control characters, trailing commas, and truncation." });
    }
    const extracted = extractFirstJsonValue(controls.text);
    if (extracted && !attempts.some((a) => a.text === extracted)) {
      attempts.push({ text: extracted, method: "extracted", note: "Discarded bytes outside the JSON document." });
    }

    for (const attempt of attempts) {
      try {
        return { project: JSON.parse(attempt.text), method: attempt.method, notes: [attempt.note] };
      } catch (_) { /* next */ }
    }

    // Tolerant parse before cutting: it can tolerate a missing comma while
    // keeping the rest of the document, which a prefix cut would discard.
    try {
      const loose = parseJsonLoose(removeTrailingCommas(controls.text));
      if (loose && typeof loose === "object" &&
        (Array.isArray(loose.targets) || Array.isArray(loose.target) || isObj(loose.blocks))) {
        notes.push("Parsed the JSON with the tolerant recovery parser; incomplete members were dropped.");
        return { project: loose, method: "loose", notes };
      }
    } catch (_) { /* fall through */ }

    // Cut back to earlier member boundaries and try again. This recovers the
    // largest prefix when a file was cut in the middle of a value.
    const cuts = [];
    let inString = false, escaped = false;
    for (let p = text.length - 1; p >= 0 && cuts.length < 400; p--) {
      const ch = text[p];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") { inString = true; continue; }
      if (ch === "," || ch === "}" || ch === "]") cuts.push(p);
    }
    for (const cut of cuts) {
      const candidate = closeTruncatedJson(removeTrailingCommas(text.slice(0, cut)));
      try {
        return {
          project: JSON.parse(candidate),
          method: "cut",
          notes: ["Discarded an incomplete tail of the JSON document."]
        };
      } catch (_) { /* next cut */ }
    }

    return { project: null, method: "failed", notes, error: "project.json is not valid JSON and could not be rebuilt." };
  }

  // ------------------------------------------------------------- validation

  function issue(code, severity, message, extra) {
    const out = { code, severity, message };
    if (extra) Object.assign(out, extra);
    return out;
  }

  function err(code, message, extra) {
    return issue(code, SEV.error, message, extra);
  }
  function warn(code, message, extra) {
    return issue(code, SEV.warning, message, extra);
  }
  function info(code, message, extra) {
    return issue(code, SEV.info, message, extra);
  }

  function getStage(project) {
    const targets = isObj(project) && Array.isArray(project.targets) ? project.targets : [];
    return targets.find((t) => isObj(t) && (t.isStage === true || t.name === "Stage"));
  }

  function targetLabel(target, index) {
    return isObj(target) && typeof target.name === "string" && target.name ? target.name : "targets[" + index + "]";
  }

  function blockPath(target, index, id, key) {
    return "targets[" + index + "](" + targetLabel(target, index) + ").blocks[" + id + "]" + (key ? "." + key : "");
  }

  function findEntry(entries, name) {
    if (!entries || !name) return null;
    if (entries.has(name)) return name;
    const lower = String(name).toLowerCase();
    for (const key of entries.keys()) {
      if (key.toLowerCase() === lower) return key;
    }
    const base = basename(name).toLowerCase();
    for (const key of entries.keys()) {
      if (basename(key).toLowerCase() === base) return key;
    }
    return null;
  }

  function assetCandidates(asset) {
    const out = [];
    if (!isObj(asset)) return out;
    if (typeof asset.md5ext === "string" && asset.md5ext) out.push(asset.md5ext);
    if (typeof asset.assetId === "string" && asset.assetId && typeof asset.dataFormat === "string") {
      out.push(asset.assetId + "." + asset.dataFormat);
    }
    if (typeof asset.assetId === "string" && asset.assetId) out.push(asset.assetId);
    return out;
  }

  function validateAsset(entries, asset, target, index, kind, path, out) {
    if (!isObj(asset)) {
      out.push(err("ASSET_NOT_OBJECT", kind + " entry is not an object.", { target: targetLabel(target, index), path }));
      return;
    }
    if (typeof asset.name !== "string") {
      out.push(warn("ASSET_NAME_MISSING", kind + " has no name; a default name is needed.", { target: targetLabel(target, index), path }));
    }
    if (typeof asset.dataFormat !== "string" || !asset.dataFormat) {
      out.push(err("ASSET_FORMAT", kind + " has no dataFormat.", { target: targetLabel(target, index), path }));
    } else if (kind === "costume" && !COSTUME_FORMATS.includes(asset.dataFormat.toLowerCase())) {
      out.push(err("ASSET_FORMAT", "Costume dataFormat is not supported.", { target: targetLabel(target, index), path, detail: asset.dataFormat }));
    } else if (kind === "sound" && !SOUND_FORMATS.includes(asset.dataFormat.toLowerCase())) {
      out.push(err("ASSET_FORMAT", "Sound dataFormat is not supported.", { target: targetLabel(target, index), path, detail: asset.dataFormat }));
    }
    const candidates = assetCandidates(asset);
    let entryName = null;
    let bytes = null;
    for (const candidate of candidates) {
      const found = findEntry(entries, candidate);
      if (found) { entryName = found; bytes = entries.get(found); break; }
    }
    if (!entryName && typeof asset.assetId === "string") {
      const id = asset.assetId.toLowerCase();
      for (const key of entries.keys()) {
        if (basename(key).toLowerCase().startsWith(id)) { entryName = key; bytes = entries.get(key); break; }
      }
    }
    if (!entryName) {
      out.push(err("ASSET_MISSING", kind + " file is not present in the archive.", {
        target: targetLabel(target, index), path,
        detail: candidates.join(" / ") || "(no asset id)"
      }));
      return;
    }
    const ext = (basename(entryName).split(".").pop() || "").toLowerCase();
    if (kind === "costume" && !COSTUME_FORMATS.includes(ext)) {
      out.push(err("ASSET_FORMAT", "Costume file has an unsupported extension ." + ext + ".", {
        target: targetLabel(target, index), path, detail: entryName
      }));
    }
    if (kind === "sound" && !SOUND_FORMATS.includes(ext)) {
      out.push(err("ASSET_FORMAT", "Sound file has an unsupported extension ." + ext + ".", {
        target: targetLabel(target, index), path, detail: entryName
      }));
    }
    if (bytes) {
      const actual = md5hex(bytes);
      if (typeof asset.assetId !== "string" || asset.assetId.toLowerCase() !== actual) {
        out.push(err("ASSET_ID_MISMATCH", kind + " assetId does not match the file contents.", {
          target: targetLabel(target, index), path,
          detail: "expected " + actual + ", found " + String(asset.assetId)
        }));
      }
      const sig = mediaSignature(bytes, kind, ext);
      if (!sig.ok) {
        out.push(err("ASSET_INVALID", kind + " file is not a valid " + ext + " file.", {
          target: targetLabel(target, index), path, detail: sig.reason
        }));
      }
      if (typeof asset.dataFormat === "string") {
        const declared = asset.dataFormat.toLowerCase() === "wave" ? "wav" :
          asset.dataFormat.toLowerCase() === "jpg" ? "jpeg" : asset.dataFormat.toLowerCase();
        const actualFormat = ext === "jpg" ? "jpeg" : ext;
        if (declared && actualFormat && declared !== actualFormat) {
          out.push(warn("ASSET_FORMAT_MISMATCH", kind + " dataFormat does not match the file extension.", {
            target: targetLabel(target, index), path, detail: asset.dataFormat + " vs ." + ext
          }));
        }
      }
    }
    if (kind === "costume") {
      if (!isFiniteNumber(asset.rotationCenterX) || !isFiniteNumber(asset.rotationCenterY)) {
        out.push(warn("COSTUME_CENTER", "Costume has no valid rotation center.", { target: targetLabel(target, index), path }));
      }
      if (!Number.isInteger(asset.bitmapResolution) || asset.bitmapResolution <= 0) {
        out.push(warn("COSTUME_RESOLUTION", "Costume has no valid integer bitmap resolution.", { target: targetLabel(target, index), path }));
      }
    } else {
      if (!Number.isInteger(asset.rate) || asset.rate <= 0) {
        out.push(warn("SOUND_RATE", "Sound has no valid sample rate.", { target: targetLabel(target, index), path }));
      }
      if (!Number.isInteger(asset.sampleCount) || asset.sampleCount < 0) {
        out.push(warn("SOUND_SAMPLES", "Sound has no valid sample count.", { target: targetLabel(target, index), path }));
      }
    }
  }

  function mediaSignature(bytes, kind, ext) {
    if (!bytes || !bytes.length) return { ok: false, reason: "empty file" };
    const starts = (arr) => arr.every((v, i) => bytes[i] === v);
    if (kind === "costume") {
      if (ext === "png") return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        ? { ok: true } : { ok: false, reason: "missing PNG signature" };
      if (ext === "jpg" || ext === "jpeg") return starts([0xff, 0xd8])
        ? { ok: true } : { ok: false, reason: "missing JPEG signature" };
      if (ext === "gif") return starts([0x47, 0x49, 0x46, 0x38])
        ? { ok: true } : { ok: false, reason: "missing GIF signature" };
      if (ext === "bmp") return starts([0x42, 0x4d])
        ? { ok: true } : { ok: false, reason: "missing BMP signature" };
      if (ext === "svg") {
        const head = utf8Decode(bytes.subarray(0, Math.min(bytes.length, 8192))).toLowerCase();
        return head.indexOf("<svg") >= 0 ? { ok: true } : { ok: false, reason: "missing <svg> element" };
      }
      return { ok: false, reason: "unknown image format" };
    }
    const head = utf8Decode(bytes.subarray(0, Math.min(bytes.length, 12)));
    if (ext === "wav" || ext === "wave") {
      return head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WAVE"
        ? { ok: true } : { ok: false, reason: "missing WAV header" };
    }
    if (ext === "mp3") {
      const id3 = head.slice(0, 3) === "ID3";
      const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
      return (id3 || frame) ? { ok: true } : { ok: false, reason: "missing MP3 header" };
    }
    return { ok: false, reason: "unknown sound format" };
  }

  function detectMediaFormat(bytes, kind) {
    if (!bytes || !bytes.length) return null;
    const starts = (arr) => arr.every((v, i) => bytes[i] === v);
    if (kind === "costume") {
      if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
      if (starts([0xff, 0xd8])) return "jpeg";
      if (starts([0x47, 0x49, 0x46, 0x38])) return "gif";
      if (starts([0x42, 0x4d])) return "bmp";
      const head = utf8Decode(bytes.subarray(0, Math.min(bytes.length, 8192))).toLowerCase();
      if (head.indexOf("<svg") >= 0) return "svg";
      return null;
    }
    const head = utf8Decode(bytes.subarray(0, Math.min(bytes.length, 12)));
    if (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WAVE") return "wav";
    if (head.slice(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
    return null;
  }

  function inferExtension(opcode) {
    if (typeof opcode !== "string") return null;
    const index = opcode.indexOf("_");
    if (index <= 0) return null;
    const prefix = opcode.slice(0, index).replace(/[^\w-]/g, "-");
    if (!prefix || CORE_EXTENSIONS.includes(prefix)) return null;
    return prefix;
  }

  function storeNames(store) {
    return isObj(store) ? new Set(Object.keys(store)) : new Set();
  }

  function lookupVariable(target, stage, id, name, kind) {
    const key = kind === "list" ? "lists" : "variables";
    const local = target && isObj(target[key]) ? target[key] : null;
    if (id && local && hasOwn(local, id)) {
      const item = local[id];
      return { target, id, item, name: Array.isArray(item) && typeof item[0] === "string" ? item[0] : name, local: true };
    }
    if (id && stage && isObj(stage[key]) && hasOwn(stage[key], id)) {
      const item = stage[key][id];
      return { target: stage, id, item, name: Array.isArray(item) && typeof item[0] === "string" ? item[0] : name, local: false };
    }
    if (name) {
      if (local) {
        for (const vid of Object.keys(local)) {
          const item = local[vid];
          if (Array.isArray(item) && item[0] === name) return { target, id: vid, item, name, local: true };
        }
      }
      if (stage && isObj(stage[key])) {
        for (const vid of Object.keys(stage[key])) {
          const item = stage[key][vid];
          if (Array.isArray(item) && item[0] === name) return { target: stage, id: vid, item, name, local: false };
        }
      }
    }
    return null;
  }

  function validateVariableRefs(target, stage, blocks, index, out) {
    for (const [id, block] of Object.entries(blocks)) {
      if (Array.isArray(block)) {
        if ((block[0] === 12 || block[0] === 13) && typeof block[2] === "string") {
          const kind = block[0] === 12 ? "variable" : "list";
          const found = lookupVariable(target, stage, block[2], block[1], kind);
          if (!found) {
            out.push(warn("STORE_MISSING", "Top-level " + kind + " reporter uses an undeclared " + kind + ".", {
              target: targetLabel(target, index), path: "targets[" + index + "].blocks[" + id + "]",
              detail: String(block[1])
            }));
          }
        }
        continue;
      }
      if (!isObj(block) || !isObj(block.fields)) continue;
      for (const fieldName of Object.keys(block.fields)) {
        const field = block.fields[fieldName];
        if (!Array.isArray(field) || !field.length) continue;
        const value = field[0];
        const fieldId = typeof field[1] === "string" ? field[1] : null;
        if (fieldName === "VARIABLE" || fieldName === "LIST") {
          const kind = fieldName === "VARIABLE" ? "variable" : "list";
          const found = lookupVariable(target, stage, fieldId, value, kind);
          if (!found) {
            out.push(warn("STORE_MISSING", block.opcode + " uses an undeclared " + kind + ".", {
              target: targetLabel(target, index),
              path: blockPath(target, index, id, "fields." + fieldName),
              detail: String(value)
            }));
          }
        } else if (fieldName === "BROADCAST_OPTION") {
          const broadcast = stage && isObj(stage.broadcasts) ? stage.broadcasts : null;
          let found = false;
          if (fieldId && broadcast && hasOwn(broadcast, fieldId)) found = true;
          if (!found && broadcast) {
            for (const bid of Object.keys(broadcast)) {
              if (broadcast[bid] === value) { found = true; break; }
            }
          }
          if (!found) {
            out.push(warn("BROADCAST_MISSING", "Block uses an undeclared broadcast message.", {
              target: targetLabel(target, index),
              path: blockPath(target, index, id, "fields." + fieldName),
              detail: String(value)
            }));
          }
        }
      }
    }
  }

  function validatePrimitive(ref, target, stage, index, path, out) {
    if (!Array.isArray(ref)) return;
    const type = ref[0];
    const label = targetLabel(target, index);
    if (!hasOwn(PRIMITIVE_OPCODES, type)) {
      out.push(err("PRIMITIVE_UNKNOWN", "Unknown primitive type in an input.", { target: label, path, detail: String(type) }));
      return;
    }
    if (type === 9) {
      if (typeof ref[1] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(ref[1])) {
        out.push(err("PRIMITIVE_COLOR", "Colour picker value is not #rrggbb.", { target: label, path, detail: String(ref[1]) }));
      }
    } else if (type === 11) {
      if (typeof ref[1] !== "string") {
        out.push(err("PRIMITIVE_SHAPE", "Broadcast menu has no message name.", { target: label, path }));
      }
      if (ref[2] !== undefined && typeof ref[2] !== "string") {
        out.push(err("PRIMITIVE_SHAPE", "Broadcast menu id is not a string.", { target: label, path }));
      }
      if (typeof ref[2] === "string" || typeof ref[1] === "string") {
        const found = lookupBroadcast(stage, typeof ref[2] === "string" ? ref[2] : null, typeof ref[1] === "string" ? ref[1] : null);
        if (!found) out.push(warn("BROADCAST_MISSING", "Broadcast menu uses an undeclared message.", { target: label, path, detail: String(ref[1]) }));
      }
    } else if (type === 12 || type === 13) {
      const kind = type === 12 ? "variable" : "list";
      if (typeof ref[1] !== "string" || typeof ref[2] !== "string") {
        out.push(err("PRIMITIVE_SHAPE", "Variable/list reporter is missing its name or id.", { target: label, path }));
      } else {
        const found = lookupVariable(target, stage, ref[2], ref[1], kind);
        if (!found) out.push(warn("STORE_MISSING", "Reporter uses an undeclared " + kind + ".", { target: label, path, detail: ref[1] }));
      }
      if (ref.length > 3 && (!isFiniteNumber(ref[3]) || !isFiniteNumber(ref[4]))) {
        out.push(warn("PRIMITIVE_POSITION", "Workspace reporter has an invalid x/y position.", { target: label, path }));
      }
    } else {
      if (type === 4 || type === 5 || type === 6 || type === 7 || type === 8 || type === 10) {
        if (!isScalar(ref[1])) {
          out.push(err("PRIMITIVE_VALUE", "Primitive value is not a string or number.", { target: label, path }));
        }
      }
    }
  }

  function validateMutation(block, id, target, index, kind, out) {
    const label = targetLabel(target, index);
    const path = blockPath(target, index, id) + ".mutation";
    const m = block.mutation;
    if (!isObj(m)) {
      out.push(err(kind === "prototype" ? "PROC_MUTATION" : "PROC_CALL_MUTATION",
        "Custom block " + kind + " has no mutation object.", { target: label, path }));
      return;
    }
    const code = typeof m.proccode === "string" ? m.proccode : "";
    if (!code) {
      out.push(err(kind === "prototype" ? "PROC_MUTATION" : "PROC_CALL_MUTATION",
        "Custom block " + kind + " has no proccode.", { target: label, path }));
    }
    let ids = null;
    if (typeof m.argumentids === "string") {
      try {
        const parsed = JSON.parse(m.argumentids);
        if (Array.isArray(parsed)) ids = parsed;
        else out.push(err("PROC_ARG_IDS", "argumentids is not a JSON array.", { target: label, path }));
      } catch (_) {
        out.push(err("PROC_ARG_IDS", "argumentids is not valid JSON.", { target: label, path }));
      }
    } else if (Array.isArray(m.argumentids)) {
      ids = m.argumentids;
    } else {
      out.push(err("PROC_ARG_IDS", "argumentids is missing.", { target: label, path }));
    }
    if (ids) {
      if (ids.some((v) => typeof v !== "string")) {
        out.push(err("PROC_ARG_IDS", "argumentids contains a non-string value.", { target: label, path }));
      }
      const placeholders = (code.match(/%[sb]/g) || []).length;
      if (ids.length !== placeholders) {
        out.push(warn("PROC_ARG_MISMATCH", "argumentids count does not match the proccode.", {
          target: label, path, detail: ids.length + " ids, " + placeholders + " placeholders"
        }));
      }
      if (new Set(ids).size !== ids.length) {
        out.push(warn("PROC_ARG_DUPLICATE", "argumentids contains duplicate ids.", { target: label, path }));
      }
    }
    if (kind === "prototype") {
      for (const key of ["argumentnames", "argumentdefaults"]) {
        let arr = null;
        if (typeof m[key] === "string") {
          try { arr = JSON.parse(m[key]); } catch (_) { arr = null; }
          if (!Array.isArray(arr)) out.push(err("PROC_ARG_LIST", key + " is not a JSON array.", { target: label, path }));
        } else if (Array.isArray(m[key])) {
          arr = m[key];
        } else {
          out.push(err("PROC_ARG_LIST", key + " is missing.", { target: label, path }));
        }
        if (arr && ids) {
          if (key === "argumentdefaults" ? arr.length < ids.length : arr.length !== ids.length) {
            out.push(warn("PROC_ARG_LIST", key + " length does not match argumentids.", {
              target: label, path, detail: arr.length + " vs " + ids.length
            }));
          }
        }
      }
    }
    for (const key of ["warp", "hasnext"]) {
      if (m[key] !== undefined && typeof m[key] !== "boolean" &&
        !["true", "false", "null"].includes(String(m[key]))) {
        out.push(warn("PROC_MUTATION_FLAG", key + " is not a boolean flag.", { target: label, path }));
      }
    }
  }

  function validateProcedures(target, blocks, index, out) {
    const byProccode = new Map();
    const prototypes = new Map();
    const definitions = new Map();
    for (const [id, block] of Object.entries(blocks)) {
      if (!isObj(block)) continue;
      if (block.opcode === "procedures_prototype") {
        prototypes.set(id, block);
        const code = block.mutation && typeof block.mutation.proccode === "string" ? block.mutation.proccode : "";
        if (code) {
          if (!byProccode.has(code)) byProccode.set(code, []);
          byProccode.get(code).push(id);
        }
      }
      if (block.opcode === "procedures_definition") definitions.set(id, block);
    }
    const linked = new Set();
    for (const [id, block] of definitions.entries()) {
      const input = isObj(block.inputs) ? block.inputs.custom_block : null;
      const ref = Array.isArray(input) && typeof input[1] === "string" ? input[1] : null;
      if (!ref || !prototypes.has(ref)) {
        out.push(err("PROC_DEF_NO_PROTOTYPE", "Custom block definition has no prototype block.", {
          target: targetLabel(target, index), path: blockPath(target, index, id)
        }));
      } else {
        linked.add(ref);
      }
    }
    for (const [id, block] of prototypes.entries()) {
      if (!linked.has(id)) {
        out.push(warn("PROC_PROTOTYPE_ORPHAN", "Custom block prototype is not linked from a definition.", {
          target: targetLabel(target, index), path: blockPath(target, index, id)
        }));
      }
      validateMutation(block, id, target, index, "prototype", out);
    }
    for (const [id, block] of Object.entries(blocks)) {
      if (!isObj(block) || block.opcode !== "procedures_call") continue;
      validateMutation(block, id, target, index, "call", out);
      const code = block.mutation && typeof block.mutation.proccode === "string" ? block.mutation.proccode : "";
      if (!code) {
        // validateMutation already reported the missing mutation.
      } else if (!byProccode.has(code)) {
        out.push(warn("PROC_CALL_ORPHAN", "Custom block call has no matching definition.", {
          target: targetLabel(target, index), path: blockPath(target, index, id), detail: code
        }));
      }
    }
    for (const [code, ids] of byProccode.entries()) {
      if (ids.length > 1) {
        out.push(warn("PROC_DUPLICATE_PROCODE", "More than one custom block definition uses the same proccode.", {
          target: targetLabel(target, index), detail: code, count: ids.length
        }));
      }
    }
  }

  function validateBlocks(target, stage, index, out, projectExtensions) {
    const blocks = isObj(target.blocks) ? target.blocks : null;
    if (!blocks) {
      out.push(err("BLOCKS_MISSING", "Target has no blocks object.", { target: targetLabel(target, index) }));
      return;
    }
    const ids = new Set(Object.keys(blocks));
    const refs = new Map();
    for (const id of ids) refs.set(id, []);

    for (const [id, block] of Object.entries(blocks)) {
      const where = "targets[" + index + "](" + targetLabel(target, index) + ").blocks[" + id + "]";
      if (Array.isArray(block)) {
        if (![12, 13].includes(block[0])) {
          out.push(err("PRIMITIVE_TOPLEVEL", "Top-level primitive is not a variable or list reporter.", {
            target: targetLabel(target, index), path: where, detail: String(block[0])
          }));
        } else {
          validatePrimitive(block, target, stage, index, where, out);
        }
        continue;
      }
      if (!isObj(block)) {
        out.push(err("BLOCK_NOT_OBJECT", "Block is not an object.", { target: targetLabel(target, index), path: where }));
        continue;
      }
      if (typeof block.opcode !== "string" || !block.opcode) {
        out.push(err("BLOCK_OPCODE", "Block has no opcode.", { target: targetLabel(target, index), path: where }));
      } else {
        const ext = inferExtension(block.opcode);
        if (ext) {
          const projectExt = Array.isArray(projectExtensions) ? projectExtensions : [];
          if (!projectExt.includes(ext)) {
            out.push(warn("EXTENSION_MISSING", "Block uses extension " + ext + " but the project does not declare it.", {
              target: targetLabel(target, index), path: where, detail: ext
            }));
          }
        }
      }
      if (!isObj(block.inputs)) {
        out.push(err("BLOCK_INPUTS", "Block inputs is not an object.", { target: targetLabel(target, index), path: where + ".inputs" }));
      } else {
        for (const [name, input] of Object.entries(block.inputs)) {
          if (!Array.isArray(input) || input.length < 2) {
            out.push(err("INPUT_SHAPE", "Input " + name + " is not a [type, value] array.", {
              target: targetLabel(target, index), path: where + ".inputs." + name
            }));
            continue;
          }
          if (![1, 2, 3].includes(input[0])) {
            out.push(err("INPUT_TYPE", "Input " + name + " has an invalid shadow type.", {
              target: targetLabel(target, index), path: where + ".inputs." + name, detail: String(input[0])
            }));
          }
          if (input.length > 3) {
            out.push(warn("INPUT_EXTRA", "Input " + name + " has extra elements.", {
              target: targetLabel(target, index), path: where + ".inputs." + name
            }));
          }
          for (let slot = 1; slot < input.length; slot++) {
            const ref = input[slot];
            if (ref === null) continue;
            if (typeof ref === "string") {
              if (!ids.has(ref)) {
                out.push(err("INPUT_DANGLING", "Input " + name + " points at a missing block.", {
                  target: targetLabel(target, index), path: where + ".inputs." + name, detail: ref
                }));
              } else {
                refs.get(ref).push(id);
              }
            } else if (Array.isArray(ref)) {
              if (!hasOwn(PRIMITIVE_OPCODES, ref[0])) {
                out.push(err("PRIMITIVE_UNKNOWN", "Input " + name + " contains an unknown primitive type.", {
                  target: targetLabel(target, index), path: where + ".inputs." + name, detail: String(ref[0])
                }));
              } else {
                validatePrimitive(ref, target, stage, index, where + ".inputs." + name, out);
              }
            } else {
              out.push(err("INPUT_REF", "Input " + name + " contains an invalid reference.", {
                target: targetLabel(target, index), path: where + ".inputs." + name
              }));
            }
          }
        }
      }
      if (block.mutation !== undefined) {
        if (!isObj(block.mutation)) {
          out.push(warn("PROC_MUTATION", "Block mutation is not an object.", { target: targetLabel(target, index), path: where + ".mutation" }));
        } else {
          if (block.mutation.tagName !== undefined && block.mutation.tagName !== "mutation") {
            out.push(warn("PROC_MUTATION", "Block mutation tagName is not mutation.", { target: targetLabel(target, index), path: where + ".mutation" }));
          }
          if (block.mutation.children !== undefined && !Array.isArray(block.mutation.children)) {
            out.push(warn("PROC_MUTATION", "Block mutation children is not an array.", { target: targetLabel(target, index), path: where + ".mutation" }));
          }
        }
      }
      if (!isObj(block.fields)) {
        out.push(err("BLOCK_FIELDS", "Block fields is not an object.", { target: targetLabel(target, index), path: where + ".fields" }));
      } else {
        for (const [name, field] of Object.entries(block.fields)) {
          if (!Array.isArray(field) || !field.length) {
            out.push(err("FIELD_SHAPE", "Field " + name + " is not an array.", {
              target: targetLabel(target, index), path: where + ".fields." + name
            }));
          }
        }
      }
      if (block.next !== null && block.next !== undefined) {
        if (typeof block.next !== "string" || !ids.has(block.next)) {
          out.push(err("NEXT_DANGLING", "Block next points at a missing block.", {
            target: targetLabel(target, index), path: where + ".next", detail: String(block.next)
          }));
        } else {
          refs.get(block.next).push(id);
        }
      }
      if (block.parent !== null && block.parent !== undefined) {
        if (typeof block.parent !== "string" || !ids.has(block.parent)) {
          out.push(err("PARENT_DANGLING", "Block parent points at a missing block.", {
            target: targetLabel(target, index), path: where + ".parent", detail: String(block.parent)
          }));
        }
      }
      if (block.topLevel !== undefined && typeof block.topLevel !== "boolean") {
        out.push(warn("BLOCK_TOPLEVEL_TYPE", "Block topLevel is not a boolean.", { target: targetLabel(target, index), path: where }));
      }
      if (block.shadow !== undefined && typeof block.shadow !== "boolean") {
        out.push(warn("BLOCK_SHADOW_TYPE", "Block shadow is not a boolean.", { target: targetLabel(target, index), path: where }));
      }
      if (block.topLevel === true) {
        if (block.x !== undefined && !isFiniteNumber(block.x)) {
          out.push(warn("BLOCK_POSITION", "Block x is not a number.", { target: targetLabel(target, index), path: where }));
        }
        if (block.y !== undefined && !isFiniteNumber(block.y)) {
          out.push(warn("BLOCK_POSITION", "Block y is not a number.", { target: targetLabel(target, index), path: where }));
        }
      }
      if (block.topLevel === true && block.parent) {
        out.push(err("TOPLEVEL_PARENT", "Top-level block also has a parent.", {
          target: targetLabel(target, index), path: where
        }));
      }
      if (block.topLevel !== true && !block.parent) {
        out.push(warn("BLOCK_NO_PARENT", "Block is not top-level but has no parent.", {
          target: targetLabel(target, index), path: where
        }));
      }
      if (block.comment !== undefined && block.comment !== null) {
        const comments = isObj(target.comments) ? target.comments : {};
        if (typeof block.comment !== "string" || !hasOwn(comments, block.comment)) {
          out.push(warn("BLOCK_COMMENT_DANGLING", "Block points at a missing comment.", {
            target: targetLabel(target, index), path: where + ".comment"
          }));
        }
      }
    }

    // Cycles through next or input edges. These make the editor and VM walk
    // forever. Shared reporters (a diamond, not a cycle) are allowed.
    const state = new Map();
    function visit(id) {
      const current = state.get(id);
      if (current === 2) return;
      if (current === 1) return;
      state.set(id, 1);
      const block = blocks[id];
      if (isObj(block)) {
        if (typeof block.next === "string" && ids.has(block.next)) {
          if (state.get(block.next) === 1) {
            out.push(err("BLOCK_CYCLE", "Block next links form a cycle.", {
              target: targetLabel(target, index), path: "targets[" + index + "].blocks[" + id + "].next"
            }));
          } else {
            visit(block.next);
          }
        }
        if (isObj(block.inputs)) {
          for (const [name, input] of Object.entries(block.inputs)) {
            if (!Array.isArray(input)) continue;
            for (let slot = 1; slot < input.length; slot++) {
              const ref = input[slot];
              if (typeof ref !== "string" || !ids.has(ref)) continue;
              if (state.get(ref) === 1) {
                out.push(err("BLOCK_CYCLE", "Block input links form a cycle.", {
                  target: targetLabel(target, index),
                  path: "targets[" + index + "].blocks[" + id + "].inputs." + name
                }));
              } else {
                visit(ref);
              }
            }
          }
        }
      }
      state.set(id, 2);
    }
    for (const id of ids) if (!Array.isArray(blocks[id])) visit(id);

    // More than one parent is legal in projects written by some optimisers
    // (a reporter shared by two inputs), so this is informational only.
    for (const [id, parents] of refs.entries()) {
      if (parents.length > 1) {
        out.push(info("BLOCK_MULTI_PARENT", "Block is referenced from more than one place.", {
          target: targetLabel(target, index), path: "targets[" + index + "].blocks[" + id + "]", count: parents.length
        }));
      }
    }

    validateVariableRefs(target, stage, blocks, index, out);
    validateProcedures(target, blocks, index, out);
  }

  function validateComments(target, index, out) {
    const blocks = isObj(target.blocks) ? target.blocks : {};
    if (target.comments === undefined) return;
    if (!isObj(target.comments)) {
      out.push(err("COMMENTS_NOT_OBJECT", "Comments is not an object.", { target: targetLabel(target, index) }));
      return;
    }
    for (const [id, comment] of Object.entries(target.comments)) {
      const path = "targets[" + index + "](" + targetLabel(target, index) + ").comments[" + id + "]";
      if (!isObj(comment)) {
        out.push(err("COMMENT_NOT_OBJECT", "Comment is not an object.", { target: targetLabel(target, index), path }));
        continue;
      }
      if (typeof comment.text !== "string") {
        out.push(warn("COMMENT_TEXT", "Comment has no text.", { target: targetLabel(target, index), path }));
      } else if (comment.text.length > 8000) {
        out.push(warn("COMMENT_TEXT_LONG", "Comment is longer than Scratch's 8000-character limit.", {
          target: targetLabel(target, index), path, detail: String(comment.text.length)
        }));
      }
      if (comment.blockId !== undefined && comment.blockId !== null) {
        if (typeof comment.blockId !== "string" || !hasOwn(blocks, comment.blockId)) {
          out.push(warn("COMMENT_DANGLING", "Comment points at a missing block.", {
            target: targetLabel(target, index), path: path + ".blockId"
          }));
        }
      }
    }
  }

  function validateStores(target, index, out) {
    for (const kind of ["variables", "lists", "broadcasts"]) {
      const store = target[kind];
      if (store === undefined) continue;
      if (!isObj(store)) {
        out.push(err("STORE_NOT_OBJECT", kind + " is not an object.", { target: targetLabel(target, index) }));
        continue;
      }
      for (const [id, item] of Object.entries(store)) {
        const path = "targets[" + index + "](" + targetLabel(target, index) + ")." + kind + "[" + id + "]";
        if (!id) {
          out.push(warn("STORE_ID", kind + " has an empty id.", { target: targetLabel(target, index), path }));
        } else if (/[<>&'"]/.test(id)) {
          out.push(warn("STORE_ID_UNSAFE", kind + " id contains characters the VM rewrites.", { target: targetLabel(target, index), path }));
        }
        if (kind === "broadcasts") {
          if (typeof item !== "string") {
            out.push(err("BROADCAST_SHAPE", "Broadcast message is not a string.", { target: targetLabel(target, index), path }));
          }
          continue;
        }
        if (!Array.isArray(item)) {
          out.push(err("STORE_SHAPE", kind + " entry is not an array.", { target: targetLabel(target, index), path }));
          continue;
        }
        if (typeof item[0] !== "string") {
          out.push(warn("STORE_NAME", kind + " entry has no name.", { target: targetLabel(target, index), path }));
        }
        if (kind === "variables") {
          if (item.length < 2 || !isScalar(item[1])) {
            out.push(warn("VARIABLE_VALUE", "Variable value is not a scalar.", { target: targetLabel(target, index), path }));
          }
          if (item.length > 3) {
            out.push(warn("VARIABLE_SHAPE", "Variable entry has extra elements.", { target: targetLabel(target, index), path }));
          }
          if (item[2] && !target.isStage) {
            out.push(warn("CLOUD_ON_SPRITE", "A sprite variable is marked as a cloud variable.", { target: targetLabel(target, index), path }));
          }
        } else {
          if (item.length !== 2 || !Array.isArray(item[1])) {
            out.push(err("LIST_SHAPE", "List entry is not [name, values].", { target: targetLabel(target, index), path }));
          } else {
            for (let i = 0; i < item[1].length; i++) {
              if (!isScalar(item[1][i])) {
                out.push(warn("LIST_VALUE", "List contains a non-scalar value.", { target: targetLabel(target, index), path }));
                break;
              }
            }
          }
        }
      }
    }
  }

  function validateMonitors(project, out) {
    if (project.monitors === undefined) return;
    if (!Array.isArray(project.monitors)) {
      out.push(err("MONITORS_NOT_ARRAY", "Monitors is not an array."));
      return;
    }
    const targets = Array.isArray(project.targets) ? project.targets : [];
    const stage = getStage(project);
    const byName = new Map();
    targets.forEach((t) => { if (isObj(t) && typeof t.name === "string") byName.set(t.name, t); });
    const seen = new Set();
    project.monitors.forEach((monitor, index) => {
      const path = "monitors[" + index + "]";
      if (!isObj(monitor)) {
        out.push(err("MONITOR_NOT_OBJECT", "Monitor is not an object.", { path }));
        return;
      }
      if (typeof monitor.opcode !== "string" || !monitor.opcode) {
        out.push(err("MONITOR_OPCODE", "Monitor has no opcode.", { path }));
        return;
      }
      if (typeof monitor.id !== "string" || !monitor.id) {
        out.push(warn("MONITOR_ID", "Monitor has no id.", { path }));
      } else if (seen.has(monitor.id)) {
        out.push(warn("MONITOR_DUPLICATE", "Monitor id is duplicated.", { path, detail: monitor.id }));
      } else {
        seen.add(monitor.id);
      }
      let target = null;
      if (typeof monitor.spriteName === "string" && monitor.spriteName) {
        target = byName.get(monitor.spriteName) || null;
        if (!target) {
          out.push(warn("MONITOR_SPRITE_MISSING", "Monitor names a sprite that does not exist.", {
            path, detail: monitor.spriteName
          }));
          return;
        }
      } else {
        target = stage;
      }
      if (monitor.opcode === "data_variable") {
        const name = isObj(monitor.params) ? monitor.params.VARIABLE : null;
        const found = lookupVariable(target, stage, monitor.id, name, "variable");
        if (!found) {
          out.push(warn("MONITOR_STORE_MISSING", "Variable monitor has no matching variable.", {
            path, detail: String(name)
          }));
        } else if (found.id !== monitor.id) {
          out.push(warn("MONITOR_ID_MISMATCH", "Variable monitor id does not match the variable.", {
            path, detail: String(monitor.id) + " vs " + found.id
          }));
        }
      } else if (monitor.opcode === "data_listcontents") {
        const name = isObj(monitor.params) ? monitor.params.LIST : null;
        const found = lookupVariable(target, stage, monitor.id, name, "list");
        if (!found) {
          out.push(warn("MONITOR_STORE_MISSING", "List monitor has no matching list.", {
            path, detail: String(name)
          }));
        } else if (found.id !== monitor.id) {
          out.push(warn("MONITOR_ID_MISMATCH", "List monitor id does not match the list.", {
            path, detail: String(monitor.id) + " vs " + found.id
          }));
        }
      }
      if (!isObj(monitor.params)) {
        out.push(warn("MONITOR_PARAMS", "Monitor params is not an object.", { path }));
      }
    });
  }

  function validateProject(project, entries, options) {
    const out = [];
    const opts = options || {};
    if (!isObj(project)) {
      return { issues: [err("PROJECT_NOT_OBJECT", "project.json is not a JSON object.")], stats: {} };
    }
    if (!isObj(project.meta)) {
      out.push(err("META_MISSING", "Project has no meta object."));
    } else {
      if (typeof project.meta.semver !== "string" || !/^3\.\d+\.\d+$/.test(project.meta.semver)) {
        out.push(err("META_SEMVER", "Project meta.semver is not 3.x.y."));
      }
      if (typeof project.meta.vm !== "string" || !project.meta.vm) {
        out.push(warn("META_VM", "Project meta.vm is missing."));
      } else if (!/^\d+\.\d+\.\d+($|-)/.test(project.meta.vm)) {
        out.push(warn("META_VM", "Project meta.vm is not a version string."));
      }
      if (project.meta.agent !== undefined && typeof project.meta.agent !== "string") {
        out.push(warn("META_AGENT", "Project meta.agent is not a string."));
      }
      if (project.meta.origin !== undefined && typeof project.meta.origin !== "string") {
        out.push(warn("META_AGENT", "Project meta.origin is not a string."));
      }
    }
    if (!Array.isArray(project.targets)) {
      out.push(err("TARGETS_MISSING", "Project targets is not an array."));
      return { issues: out, stats: {} };
    }
    if (!project.targets.length) out.push(err("TARGETS_EMPTY", "Project has no targets."));
    const stageCount = project.targets.filter((t) => isObj(t) && t.isStage === true).length;
    if (stageCount === 0) out.push(err("STAGE_MISSING", "Project has no stage."));
    if (stageCount > 1) out.push(err("STAGE_MULTIPLE", "Project has more than one stage."));
    if (project.targets.length && isObj(project.targets[0]) && project.targets[0].isStage !== true) {
      out.push(err("STAGE_NOT_FIRST", "The first target must be the stage."));
    }
    if (stageCount === 1) {
      const stage = project.targets.find((t) => isObj(t) && t.isStage === true);
      if (stage.name !== "Stage") {
        out.push(err("STAGE_NAME", "The stage must be named Stage.", { detail: String(stage.name) }));
      }
    }

    const names = new Map();
    project.targets.forEach((target, index) => {
      if (!isObj(target)) {
        out.push(err("TARGET_NOT_OBJECT", "Target is not an object.", { path: "targets[" + index + "]" }));
        return;
      }
      const label = targetLabel(target, index);
      if (typeof target.name !== "string" || !target.name) {
        out.push(err("TARGET_NAME", "Target has no name.", { path: "targets[" + index + "]" }));
      } else if (target.isStage !== true) {
        if (target.name === "_stage_") {
          out.push(err("TARGET_NAME", "Sprite uses the reserved name _stage_.", { target: label }));
        }
        if (!names.has(target.name)) names.set(target.name, []);
        names.get(target.name).push(index);
      }
      if (typeof target.isStage !== "boolean") {
        out.push(err("TARGET_ISSTAGE", "Target isStage is not a boolean.", { target: label }));
      }
      for (const key of ["variables", "lists", "blocks"]) {
        if (!isObj(target[key])) {
          out.push(err("TARGET_FIELD", "Target " + key + " is not an object.", { target: label }));
        }
      }
      if (!Array.isArray(target.costumes)) {
        out.push(err("COSTUMES_MISSING", "Target costumes is not an array.", { target: label }));
      } else if (!target.costumes.length) {
        out.push(err("COSTUMES_EMPTY", "Target has no costumes.", { target: label }));
      }
      if (!Array.isArray(target.sounds)) {
        out.push(err("SOUNDS_MISSING", "Target sounds is not an array.", { target: label }));
      }
      if (target.costumes !== undefined && !Array.isArray(target.costumes)) target.costumes = [];
      if (target.sounds !== undefined && !Array.isArray(target.sounds)) target.sounds = [];
      const current = target.currentCostume;
      if (current !== undefined && (!Number.isInteger(current) || current < 0 ||
        (Array.isArray(target.costumes) && current >= target.costumes.length))) {
        out.push(warn("CURRENT_COSTUME", "currentCostume is outside the costume list.", { target: label }));
      }
      if (typeof target.isStage !== "boolean") {
        target.isStage = target.name === "Stage";
      }
      validateStores(target, index, out);
      if (isObj(target.blocks)) {
        validateBlocks(target, project.targets.find((t) => isObj(t) && t.isStage === true), index, out, project.extensions);
      }
      validateComments(target, index, out);
      if (Array.isArray(target.costumes)) {
        target.costumes.forEach((asset, i) => validateAsset(entries, asset, target, index, "costume", "targets[" + index + "].costumes[" + i + "]", out));
      }
      if (Array.isArray(target.sounds)) {
        target.sounds.forEach((asset, i) => validateAsset(entries, asset, target, index, "sound", "targets[" + index + "].sounds[" + i + "]", out));
      }
      if (target.layerOrder !== undefined) {
        if (!Number.isInteger(target.layerOrder)) {
          out.push(warn("LAYER_ORDER", "layerOrder is not an integer.", { target: label }));
        } else if (target.isStage === true && target.layerOrder !== 0) {
          out.push(warn("LAYER_ORDER", "Stage layerOrder is not 0.", { target: label }));
        } else if (target.isStage !== true && target.layerOrder < 1) {
          out.push(warn("LAYER_ORDER", "Sprite layerOrder is not positive.", { target: label }));
        }
      }
      if (target.isStage !== true) {
        if (target.rotationStyle !== undefined &&
          !["all around", "don't rotate", "left-right"].includes(target.rotationStyle)) {
          out.push(warn("ROTATION_STYLE", "Sprite rotationStyle is not valid.", { target: label, detail: String(target.rotationStyle) }));
        }
        for (const key of ["visible", "draggable"]) {
          if (target[key] !== undefined && typeof target[key] !== "boolean") {
            out.push(warn("TARGET_PROP", key + " is not a boolean.", { target: label }));
          }
        }
        for (const key of ["x", "y", "size", "direction", "volume"]) {
          if (target[key] !== undefined && !isFiniteNumber(target[key])) {
            out.push(warn("TARGET_PROP", key + " is not a number.", { target: label }));
          }
        }
      } else {
        for (const key of ["tempo", "videoTransparency", "volume"]) {
          if (target[key] !== undefined && !isFiniteNumber(target[key])) {
            out.push(warn("TARGET_PROP", key + " is not a number.", { target: label }));
          }
        }
        if (target.videoState !== undefined && !["on", "off", "on-flipped"].includes(target.videoState)) {
          out.push(warn("VIDEO_STATE", "Stage videoState is not valid.", { target: label, detail: String(target.videoState) }));
        }
        if (target.textToSpeechLanguage !== undefined && target.textToSpeechLanguage !== null &&
          typeof target.textToSpeechLanguage !== "string") {
          out.push(warn("TARGET_PROP", "textToSpeechLanguage is not a string or null.", { target: label }));
        }
      }
    });
    const layerCounts = new Map();
    project.targets.forEach((t) => {
      if (!isObj(t) || t.isStage === true || !Number.isInteger(t.layerOrder)) return;
      layerCounts.set(t.layerOrder, (layerCounts.get(t.layerOrder) || 0) + 1);
    });
    layerCounts.forEach((count, value) => {
      if (count > 1) out.push(warn("LAYER_ORDER_DUPLICATE", "More than one sprite uses layerOrder " + value + ".", { count }));
    });
    names.forEach((indices, name) => {
      if (indices.length > 1) {
        out.push(warn("TARGET_NAME_DUPLICATE", "More than one sprite uses the name " + name + ".", { detail: name, count: indices.length }));
      }
    });

    if (project.extensions !== undefined) {
      if (!Array.isArray(project.extensions)) {
        out.push(err("EXTENSIONS_NOT_ARRAY", "extensions is not an array."));
      } else {
        const seen = new Set();
        project.extensions.forEach((ext) => {
          if (typeof ext !== "string" || !ext) out.push(err("EXTENSION_ID", "Extension id is not a string."));
          else if (seen.has(ext)) out.push(warn("EXTENSION_DUPLICATE", "Extension is declared twice.", { detail: ext }));
          else seen.add(ext);
        });
      }
    }
    validateMonitors(project, out);

    // Unreferenced media is not a load error, but it is useful to report.
    if (entries && entries.size) {
      const referenced = new Set();
      project.targets.forEach((t) => {
        if (!isObj(t)) return;
        for (const kind of ["costumes", "sounds"]) {
          if (!Array.isArray(t[kind])) continue;
          for (const asset of t[kind]) {
            for (const candidate of assetCandidates(asset)) {
              const found = findEntry(entries, candidate);
              if (found) { referenced.add(found); break; }
            }
          }
        }
      });
      for (const name of entries.keys()) {
        if (name === "project.json") continue;
        if (!referenced.has(name)) {
          out.push(info("ASSET_UNREFERENCED", "Archive contains an unreferenced file.", { detail: name }));
        }
      }
    }
    const errors = out.filter((i) => i.severity === SEV.error).length;
    const warnings = out.filter((i) => i.severity === SEV.warning).length;
    return {
      issues: out,
      stats: {
        errors,
        warnings,
        targets: project.targets.length,
        blocks: project.targets.reduce((n, t) => n + (isObj(t) && isObj(t.blocks) ? Object.keys(t.blocks).length : 0), 0),
        assets: project.targets.reduce((n, t) => n + (isObj(t) && Array.isArray(t.costumes) ? t.costumes.length : 0) + (isObj(t) && Array.isArray(t.sounds) ? t.sounds.length : 0), 0),
        entries: entries ? entries.size : 0
      }
    };
  }

  // ---------------------------------------------------------------- repairs

  function nextId(existing, prefix) {
    let n = existing.__next || 1;
    let id;
    do {
      id = (prefix || "r") + n;
      n++;
    } while (existing.has(id));
    existing.__next = n;
    return id;
  }

  function blankStage() {
    return {
      isStage: true,
      name: "Stage",
      variables: {},
      lists: {},
      broadcasts: {},
      blocks: {},
      comments: {},
      currentCostume: 0,
      costumes: [],
      sounds: [],
      volume: 100,
      layerOrder: 0,
      tempo: 60,
      videoTransparency: 50,
      videoState: "on",
      textToSpeechLanguage: null
    };
  }

  function blankSprite(name) {
    return {
      isStage: false,
      name,
      variables: {},
      lists: {},
      broadcasts: {},
      blocks: {},
      comments: {},
      currentCostume: 0,
      costumes: [],
      sounds: [],
      volume: 100,
      layerOrder: 1,
      visible: true,
      x: 0,
      y: 0,
      size: 100,
      direction: 90,
      draggable: false,
      rotationStyle: "all around"
    };
  }

  function looksLikeSprite(value) {
    return isObj(value) && (isObj(value.blocks) || Array.isArray(value.costumes)) &&
      typeof value.name === "string";
  }

  function ensureObject(value) {
    return isObj(value) ? value : {};
  }
  function ensureArray(value) {
    return Array.isArray(value) ? value : [];
  }
  function ensureString(value, fallback) {
    return typeof value === "string" && value ? value : fallback;
  }
  function ensureNumber(value, fallback) {
    return isFiniteNumber(value) ? value : fallback;
  }
  function ensureBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function uniqueName(base, used) {
    let name = base;
    let n = 2;
    while (used.has(name)) { name = base + n; n++; }
    used.add(name);
    return name;
  }

  function addAction(actions, code, severity, message, extra) {
    actions.push(issue(code, severity, message, extra));
  }

  function sanitizeStoreId(id, used) {
    if (typeof id !== "string" || !id) {
      let n = 1;
      while (used.has("var" + n)) n++;
      const fresh = "var" + n;
      used.add(fresh);
      return fresh;
    }
    const safe = id.replace(/[<>&'"]/g, (c) => ({
      "<": "lt", ">": "gt", "&": "amp", "'": "apos", "\"": "quot"
    }[c]));
    if (safe !== id) {
      let candidate = safe;
      let n = 2;
      while (used.has(candidate)) { candidate = safe + n; n++; }
      used.add(candidate);
      return candidate;
    }
    used.add(id);
    return id;
  }

  function valueToString(value) {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value === null || value === undefined) return "";
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  function repairStores(target, actions, label) {
    target.variables = ensureObject(target.variables);
    target.lists = ensureObject(target.lists);
    target.broadcasts = ensureObject(target.broadcasts);
    const usedVarIds = new Set();
    const usedListIds = new Set();
    for (const kind of ["variables", "lists"]) {
      const store = target[kind];
      const used = kind === "variables" ? usedVarIds : usedListIds;
      const next = {};
      for (const [id, item] of Object.entries(store)) {
        const newId = sanitizeStoreId(id, used);
        if (newId !== id) {
          addAction(actions, "STORE_ID", SEV.warning, "Renamed an unsafe " + kind + " id.", { target: label, detail: id + " -> " + newId });
        }
        if (kind === "variables") {
          let entry;
          if (Array.isArray(item)) entry = item.slice();
          else { entry = [valueToString(item), 0]; addAction(actions, "VARIABLE_SHAPE", SEV.warning, "Rebuilt a malformed variable entry.", { target: label, detail: id }); }
          if (typeof entry[0] !== "string") entry[0] = valueToString(entry[0]) || "variable";
          if (entry.length < 2) entry[1] = 0;
          if (!isScalar(entry[1])) entry[1] = valueToString(entry[1]);
          if (entry.length > 3) entry = entry.slice(0, 3);
          if (entry.length === 3 && !target.isStage) entry = entry.slice(0, 2);
          if (entry.length === 3) entry[2] = !!entry[2];
          next[newId] = entry;
        } else {
          let entry;
          if (Array.isArray(item)) entry = item.slice();
          else { entry = [valueToString(item), []]; addAction(actions, "LIST_SHAPE", SEV.warning, "Rebuilt a malformed list entry.", { target: label, detail: id }); }
          if (typeof entry[0] !== "string") entry[0] = valueToString(entry[0]) || "list";
          if (!Array.isArray(entry[1])) entry[1] = [];
          entry[1] = entry[1].map((v) => isScalar(v) ? v : valueToString(v));
          entry = [entry[0], entry[1]];
          next[newId] = entry;
        }
      }
      target[kind] = next;
    }
    const broadcasts = {};
    for (const [id, name] of Object.entries(target.broadcasts)) {
      if (typeof name !== "string") {
        addAction(actions, "BROADCAST_SHAPE", SEV.warning, "Rebuilt a malformed broadcast entry.", { target: label, detail: id });
        broadcasts[id] = valueToString(name) || "message1";
      } else {
        broadcasts[id] = name;
      }
    }
    target.broadcasts = broadcasts;
  }

  function ensureStore(target, stage, kind, id, name) {
    const key = kind === "list" ? "lists" : "variables";
    const owner = kind === "broadcast" ? stage : target;
    if (!owner) return null;
    if (kind === "broadcast") {
      owner.broadcasts = ensureObject(owner.broadcasts);
      if (id && hasOwn(owner.broadcasts, id)) return { target: owner, id, name: owner.broadcasts[id] };
      if (name) {
        for (const bid of Object.keys(owner.broadcasts)) {
          if (owner.broadcasts[bid] === name) return { target: owner, id: bid, name };
        }
      }
      let newId = id;
      if (!newId || hasOwn(owner.broadcasts, newId)) {
        let n = 1;
        while (hasOwn(owner.broadcasts, "message" + n)) n++;
        newId = "message" + n;
      }
      owner.broadcasts[newId] = name || "message" + (Object.keys(owner.broadcasts).length + 1);
      return { target: owner, id: newId, name: owner.broadcasts[newId] };
    }
    owner[key] = ensureObject(owner[key]);
    const item = owner[key][id];
    if (id && hasOwn(owner[key], id)) {
      const actualName = Array.isArray(item) && typeof item[0] === "string" ? item[0] : name;
      return { target: owner, id, name: actualName };
    }
    if (name) {
      for (const sid of Object.keys(owner[key])) {
        const existing = owner[key][sid];
        if (Array.isArray(existing) && existing[0] === name) return { target: owner, id: sid, name };
      }
    }
    let newId = id;
    if (!newId || hasOwn(owner[key], newId)) {
      let n = 1;
      while (hasOwn(owner[key], "var" + n) || hasOwn(owner[key], "list" + n)) n++;
      newId = (kind === "list" ? "list" : "var") + n;
    }
    owner[key][newId] = kind === "list" ? [name || "list", []] : [name || "variable", 0];
    return { target: owner, id: newId, name: owner[key][newId][0] };
  }

  function repairStoreReferences(target, stage, actions, label) {
    const blocks = ensureObject(target.blocks);
    const resolvePrimitive = (value) => {
      if (!Array.isArray(value) || ![11, 12, 13].includes(value[0])) return;
      if (value[0] === 11) {
        const id = typeof value[2] === "string" ? value[2] : null;
        const name = typeof value[1] === "string" ? value[1] : null;
        const found = lookupBroadcast(stage, id, name);
        const resolved = found || ensureStore(target, stage, "broadcast", null, name);
        if (!resolved) return;
        value[1] = resolved.name;
        value[2] = resolved.id;
        if (!found) {
          addAction(actions, "STORE_CREATED", SEV.warning, "Created a missing broadcast used by a menu.", {
            target: label, detail: resolved.name
          });
        }
        return;
      }
      const kind = value[0] === 12 ? "variable" : "list";
      const id = typeof value[2] === "string" ? value[2] : null;
      const name = typeof value[1] === "string" ? value[1] : null;
      const found = lookupVariable(target, stage, id, name, kind);
      const resolved = found || ensureStore(target, stage, kind, null, name);
      if (!resolved) return;
      if (!found) {
        addAction(actions, "STORE_CREATED", SEV.warning, "Created a missing " + kind + " for a reporter.", { target: label, detail: resolved.name });
      } else if (value[1] !== resolved.name || value[2] !== resolved.id) {
        addAction(actions, "STORE_REFERENCE", SEV.warning, "Corrected a " + kind + " reference.", {
          target: label, detail: String(value[1]) + " -> " + resolved.name
        });
      }
      value[1] = resolved.name;
      value[2] = resolved.id;
    };
    for (const block of Object.values(blocks)) {
      if (Array.isArray(block)) {
        resolvePrimitive(block);
        continue;
      }
      if (!isObj(block)) continue;
      if (isObj(block.inputs)) {
        for (const input of Object.values(block.inputs)) {
          if (!Array.isArray(input)) continue;
          input.slice(1).forEach(resolvePrimitive);
        }
      }
      if (!isObj(block.fields)) continue;
      for (const fieldName of Object.keys(block.fields)) {
        const field = block.fields[fieldName];
        if (!Array.isArray(field)) continue;
        let kind = null;
        if (fieldName === "VARIABLE") kind = "variable";
        else if (fieldName === "LIST") kind = "list";
        else if (fieldName === "BROADCAST_OPTION") kind = "broadcast";
        if (!kind) continue;
        const id = typeof field[1] === "string" ? field[1] : null;
        const name = typeof field[0] === "string" ? field[0] : null;
        let found = kind === "broadcast"
          ? lookupBroadcast(stage, id, name)
          : lookupVariable(target, stage, id, name, kind);
        const resolved = found || ensureStore(target, stage, kind, null, name);
        if (!resolved) continue;
        const oldName = field[0];
        const oldId = field[1];
        field[0] = resolved.name;
        field[1] = resolved.id;
        if (!found) {
          addAction(actions, "STORE_CREATED", SEV.warning, "Created a missing " + kind + " used by " + block.opcode + ".", {
            target: label, detail: resolved.name
          });
        } else if (oldName !== resolved.name || oldId !== resolved.id) {
          addAction(actions, "STORE_REFERENCE", SEV.warning, "Corrected a " + kind + " reference.", {
            target: label,
            detail: String(oldName) + " (" + String(oldId) + ") -> " + resolved.name + " (" + resolved.id + ")"
          });
        }
      }
    }
  }

  function lookupBroadcast(stage, id, name) {
    if (!stage) return null;
    stage.broadcasts = ensureObject(stage.broadcasts);
    if (id && hasOwn(stage.broadcasts, id)) return { target: stage, id, name: stage.broadcasts[id] };
    if (name) {
      for (const bid of Object.keys(stage.broadcasts)) {
        if (stage.broadcasts[bid] === name) return { target: stage, id: bid, name };
      }
    }
    return null;
  }

  function normalizeMutation(mutation, kind, actions, label) {
    const m = isObj(mutation) ? mutation : {};
    if (!isObj(mutation)) addAction(actions, "PROC_MUTATION", SEV.warning, "Rebuilt a missing custom-block mutation.", { target: label });
    let proccode = typeof m.proccode === "string" && m.proccode ? m.proccode : "recovered procedure";
    if (!m.proccode) addAction(actions, "PROC_MUTATION", SEV.warning, "Custom block had no proccode; assigned a recovery name.", { target: label, detail: proccode });
    let ids = [];
    if (typeof m.argumentids === "string") {
      try {
        const parsed = JSON.parse(m.argumentids);
        if (Array.isArray(parsed)) ids = parsed.filter((v) => typeof v === "string");
      } catch (_) { /* rebuild below */ }
    } else if (Array.isArray(m.argumentids)) {
      ids = m.argumentids.filter((v) => typeof v === "string");
    }
    const placeholders = (proccode.match(/%[sb]/g) || []).length;
    if (ids.length !== placeholders) {
      if (ids.length < placeholders) {
        for (let i = ids.length; i < placeholders; i++) {
          let id = "arg" + (i + 1);
          while (ids.includes(id)) id += "_";
          ids.push(id);
        }
      } else if (ids.length > placeholders) {
        ids = ids.slice(0, placeholders);
      }
      addAction(actions, "PROC_ARG_MISMATCH", SEV.warning, "Custom block argument ids did not match its proccode.", {
        target: label, detail: proccode
      });
    }
    const uniqueIds = [];
    ids.forEach((id) => { if (!uniqueIds.includes(id)) uniqueIds.push(id); else {
      let n = 2, candidate = id + n;
      while (uniqueIds.includes(candidate)) { n++; candidate = id + n; }
      uniqueIds.push(candidate);
    } });
    let names = [];
    if (typeof m.argumentnames === "string") {
      try {
        const parsed = JSON.parse(m.argumentnames);
        if (Array.isArray(parsed)) names = parsed.filter((v) => typeof v === "string");
      } catch (_) { /* rebuild */ }
    } else if (Array.isArray(m.argumentnames)) {
      names = m.argumentnames.filter((v) => typeof v === "string");
    }
    while (names.length < uniqueIds.length) names.push("arg" + (names.length + 1));
    names = names.slice(0, Math.max(uniqueIds.length, 1));
    let defaults = [];
    if (typeof m.argumentdefaults === "string") {
      try {
        const parsed = JSON.parse(m.argumentdefaults);
        if (Array.isArray(parsed)) defaults = parsed.map(valueToString);
      } catch (_) { /* rebuild */ }
    } else if (Array.isArray(m.argumentdefaults)) {
      defaults = m.argumentdefaults.map(valueToString);
    }
    while (defaults.length < uniqueIds.length) defaults.push("");
    m.tagName = "mutation";
    m.children = Array.isArray(m.children) ? m.children : [];
    m.proccode = proccode;
    m.argumentids = JSON.stringify(uniqueIds);
    if (kind === "prototype") {
      m.argumentnames = JSON.stringify(names.length ? names : (uniqueIds.length ? uniqueIds : []));
      m.argumentdefaults = JSON.stringify(defaults);
    }
    if (m.warp === undefined) m.warp = "false";
    if (kind === "prototype" && m.hasnext === undefined) m.hasnext = "false";
    return m;
  }

  function repairProcedures(target, actions, label, options) {
    const blocks = ensureObject(target.blocks);
    const ids = new Set(Object.keys(blocks));
    const prototypes = new Map();
    const definitions = new Map();
    for (const [id, block] of Object.entries(blocks)) {
      if (!isObj(block)) continue;
      if (block.opcode === "procedures_prototype") prototypes.set(id, block);
      if (block.opcode === "procedures_definition") definitions.set(id, block);
    }
    const linked = new Set();
    for (const [defId, block] of definitions.entries()) {
      block.inputs = ensureObject(block.inputs);
      const input = block.inputs.custom_block;
      const ref = Array.isArray(input) && typeof input[1] === "string" ? input[1] : null;
      let protoId = ref && prototypes.has(ref) ? ref : null;
      if (!protoId) {
        for (const [pid, candidate] of prototypes.entries()) {
          if (candidate.parent === defId) { protoId = pid; break; }
        }
      }
      if (!protoId) {
        protoId = nextId(ids, "proto");
        const mutation = normalizeMutation({
          proccode: "recovered procedure " + String(defId).replace(/%/g, "_"), argumentids: "[]", warp: "false"
        }, "prototype", actions, label);
        blocks[protoId] = {
          opcode: "procedures_prototype", next: null, parent: defId, inputs: {}, fields: {},
          shadow: true, topLevel: false, mutation
        };
        prototypes.set(protoId, blocks[protoId]);
        addAction(actions, "PROC_DEF_PROTOTYPE", SEV.warning, "Created a prototype for a custom block definition.", {
          target: label, detail: defId
        });
      }
      const inputType = Array.isArray(input) && input[0] === 1 ? 1 : 2;
      block.inputs.custom_block = [inputType, protoId];
      if (prototypes.has(protoId)) {
        prototypes.get(protoId).parent = defId;
        prototypes.get(protoId).topLevel = false;
        prototypes.get(protoId).shadow = true;
        linked.add(protoId);
      }
    }
    for (const [pid, proto] of prototypes.entries()) {
      proto.mutation = normalizeMutation(proto.mutation, "prototype", actions, label);
      if (!linked.has(pid)) {
        addAction(actions, "PROC_PROTOTYPE_ORPHAN", SEV.warning, "Custom block prototype is not linked from a definition.", {
          target: label, detail: pid
        });
      }
    }
    // Orphan calls: create a do-nothing definition so the editor and the VM
    // can resolve the procedure. Do not invent arguments beyond the call's
    // own mutation.
    const byCode = new Map();
    for (const [pid, proto] of prototypes.entries()) {
      if (proto.mutation && typeof proto.mutation.proccode === "string") byCode.set(proto.mutation.proccode, pid);
    }
    for (const [id, block] of Object.entries(blocks)) {
      if (!isObj(block) || block.opcode !== "procedures_call") continue;
      const m = normalizeMutation(block.mutation, "call", actions, label);
      block.mutation = m;
      if (!byCode.has(m.proccode)) {
        if (options && options.stubOrphanCalls === false) continue;
        const defId = nextId(ids, "def");
        const protoId = nextId(ids, "proto");
        const protoMutation = normalizeMutation({
          proccode: m.proccode,
          argumentids: m.argumentids,
          warp: m.warp,
          hasnext: "false"
        }, "prototype", actions, label);
        blocks[protoId] = {
          opcode: "procedures_prototype", next: null, parent: defId, inputs: {}, fields: {},
          shadow: true, topLevel: false, mutation: protoMutation
        };
        let y = 0;
        for (const candidate of Object.values(blocks)) {
          if (isObj(candidate) && candidate.topLevel === true) y = Math.max(y, ensureNumber(candidate.y, 0) + 80);
        }
        blocks[defId] = {
          opcode: "procedures_definition", next: null, parent: null,
          inputs: { custom_block: [2, protoId] }, fields: {}, shadow: false,
          topLevel: true, x: 0, y: y
        };
        prototypes.set(protoId, blocks[protoId]);
        linked.add(protoId);
        byCode.set(m.proccode, protoId);
        addAction(actions, "PROC_CALL_ORPHAN", SEV.warning, "Created an empty definition for a custom block call.", {
          target: label, detail: m.proccode
        });
      } else {
        const proto = blocks[byCode.get(m.proccode)];
        if (proto && proto.mutation) {
          let pids = [];
          let cids = [];
          try { pids = JSON.parse(proto.mutation.argumentids || "[]"); } catch (_) { pids = []; }
          try { cids = JSON.parse(m.argumentids || "[]"); } catch (_) { cids = []; }
          if (pids.length !== cids.length) {
            addAction(actions, "PROC_CALL_ARGS", SEV.warning, "Custom block call and definition use different argument counts.", {
              target: label, detail: m.proccode
            });
          }
        }
      }
    }
  }

  function fixPrimitive(value, actions, label, path) {
    if (!Array.isArray(value)) return value;
    if (!hasOwn(PRIMITIVE_OPCODES, value[0])) return null;
    const type = value[0];
    const out = value.slice(0, 2);
    if (type === 9) {
      out[1] = typeof value[1] === "string" && /^#[0-9a-fA-F]{6}$/.test(value[1]) ? value[1] : "#000000";
    } else if (type === 12 || type === 13) {
      out[1] = typeof value[1] === "string" ? value[1] : "";
      out[2] = typeof value[2] === "string" ? value[2] : "";
      if (value.length > 3) { out[3] = ensureNumber(value[3], 0); out[4] = ensureNumber(value[4], 0); }
    } else {
      if (type === 11) out[1] = typeof value[1] === "string" ? value[1] : "";
      else out[1] = isScalar(value[1]) ? value[1] : valueToString(value[1]);
      if (type === 11 && typeof value[2] === "string") out[2] = value[2];
    }
    if (out.length !== value.length) {
      addAction(actions, "PRIMITIVE_SHAPE", SEV.warning, "Rebuilt a malformed primitive input.", { target: label, path });
    }
    return out;
  }

  function fixInputs(block, blocks, ids, actions, label, path) {
    const inputs = block.inputs;
    for (const name of Object.keys(inputs)) {
      let input = inputs[name];
      if (typeof input === "string") {
        input = [2, input];
        inputs[name] = input;
        addAction(actions, "INPUT_SHAPE", SEV.warning, "Rebuilt a bare block-id input.", { target: label, path: path + ".inputs." + name });
      } else if (Array.isArray(input) && hasOwn(PRIMITIVE_OPCODES, input[0])) {
        input = [1, input];
        inputs[name] = input;
        addAction(actions, "INPUT_SHAPE", SEV.warning, "Wrapped a bare primitive input in an input descriptor.", { target: label, path: path + ".inputs." + name });
      }
      if (!Array.isArray(input) || input.length < 2) {
        delete inputs[name];
        addAction(actions, "INPUT_SHAPE", SEV.warning, "Removed a malformed input.", { target: label, path: path + ".inputs." + name });
        continue;
      }
      let type = input[0];
      if (![1, 2, 3].includes(type)) {
        // Some old/foreign writers omitted the shadow type. A bare block id
        // is a no-shadow input; a primitive array or null is a shadow.
        type = typeof input[0] === "string" ? 2 : 1;
        input.unshift(type);
        addAction(actions, "INPUT_TYPE", SEV.warning, "Repaired an input shadow type.", { target: label, path: path + ".inputs." + name });
      }
      if (input.length > 3) input.length = 3;
      let primitiveBad = false;
      for (let slot = 1; slot < input.length; slot++) {
        if (Array.isArray(input[slot])) {
          const fixed = fixPrimitive(input[slot], actions, label, path + ".inputs." + name);
          if (!fixed) { primitiveBad = true; break; }
          input[slot] = fixed;
        }
      }
      if (primitiveBad) {
        delete inputs[name];
        addAction(actions, "PRIMITIVE_UNKNOWN", SEV.warning, "Removed an input with an unknown primitive type.", { target: label, path: path + ".inputs." + name });
        continue;
      }
      const refs = input.slice(1);
      if (type === 1) {
        if (refs[0] === null) { inputs[name] = [1, null]; continue; }
        if (typeof refs[0] === "string" && !ids.has(refs[0])) {
          delete inputs[name];
          addAction(actions, "INPUT_DANGLING", SEV.warning, "Removed an input that pointed at a missing block.", { target: label, path: path + ".inputs." + name, detail: refs[0] });
          continue;
        }
        if (refs[0] !== null && typeof refs[0] !== "string" && !Array.isArray(refs[0])) {
          delete inputs[name];
          addAction(actions, "INPUT_REF", SEV.warning, "Removed an input with an invalid reference.", { target: label, path: path + ".inputs." + name });
          continue;
        }
        input.length = 2;
      } else if (type === 2) {
        if (refs[0] === null) { inputs[name] = [2, null]; continue; }
        if (typeof refs[0] === "string" && !ids.has(refs[0])) {
          delete inputs[name];
          addAction(actions, "INPUT_DANGLING", SEV.warning, "Removed an input that pointed at a missing block.", { target: label, path: path + ".inputs." + name, detail: refs[0] });
          continue;
        }
        if (typeof refs[0] !== "string" && !Array.isArray(refs[0])) {
          delete inputs[name];
          addAction(actions, "INPUT_REF", SEV.warning, "Removed an input with an invalid reference.", { target: label, path: path + ".inputs." + name });
          continue;
        }
        input.length = 2;
      } else {
        let base = refs[0];
        let shadow = refs.length > 1 ? refs[1] : null;
        if (typeof base === "string" && !ids.has(base)) base = null;
        if (typeof shadow === "string" && !ids.has(shadow)) shadow = null;
        if (base !== null && typeof base !== "string" && !Array.isArray(base)) base = null;
        if (shadow !== null && typeof shadow !== "string" && !Array.isArray(shadow)) shadow = null;
        if (base === null && shadow === null) {
          delete inputs[name];
          addAction(actions, "INPUT_DANGLING", SEV.warning, "Removed an input with two missing blocks.", { target: label, path: path + ".inputs." + name });
          continue;
        }
        if (base === null) inputs[name] = [1, shadow];
        else if (shadow === null) inputs[name] = [2, base];
        else inputs[name] = [3, base, shadow];
      }
    }
  }

  function repairBlocks(target, actions, label) {
    const blocks = ensureObject(target.blocks);
    const ids = new Set(Object.keys(blocks));
    for (const [id, block] of Object.entries(blocks)) {
      if (Array.isArray(block)) {
        if (![12, 13].includes(block[0])) {
          delete blocks[id];
          addAction(actions, "PRIMITIVE_TOPLEVEL", SEV.warning, "Removed an invalid top-level primitive.", { target: label, detail: id });
          continue;
        }
        if (typeof block[1] !== "string") block[1] = "";
        if (typeof block[2] !== "string") block[2] = "";
        if (block.length > 3) {
          block[3] = ensureNumber(block[3], 0);
          block[4] = ensureNumber(block[4], 0);
        }
        continue;
      }
      if (!isObj(block)) {
        delete blocks[id];
        addAction(actions, "BLOCK_NOT_OBJECT", SEV.warning, "Removed a block that was not an object.", { target: label, detail: id });
        continue;
      }
      if (typeof block.opcode !== "string" || !block.opcode) {
        delete blocks[id];
        addAction(actions, "BLOCK_OPCODE", SEV.warning, "Removed a block with no opcode.", { target: label, detail: id });
        continue;
      }
      block.inputs = ensureObject(block.inputs);
      block.fields = ensureObject(block.fields);
      for (const fieldName of Object.keys(block.fields)) {
        const field = block.fields[fieldName];
        if (!Array.isArray(field)) {
          block.fields[fieldName] = [valueToString(field)];
          addAction(actions, "FIELD_SHAPE", SEV.warning, "Rebuilt a malformed field.", { target: label, detail: id + "." + fieldName });
        } else if (!field.length) {
          block.fields[fieldName] = [""];
          addAction(actions, "FIELD_SHAPE", SEV.warning, "Rebuilt an empty field.", { target: label, detail: id + "." + fieldName });
        } else if (field.length > 2) {
          field.length = 2;
        } else if (!isScalar(field[0])) {
          field[0] = valueToString(field[0]);
        }
      }
      if (isObj(block.mutation)) {
        if (block.mutation.tagName !== undefined && block.mutation.tagName !== "mutation") {
          block.mutation.tagName = "mutation";
          addAction(actions, "PROC_MUTATION", SEV.warning, "Reset an invalid mutation tagName.", { target: label, detail: id });
        }
        if (block.mutation.children !== undefined && !Array.isArray(block.mutation.children)) {
          block.mutation.children = [];
          addAction(actions, "PROC_MUTATION", SEV.warning, "Rebuilt a mutation children array.", { target: label, detail: id });
        }
      }
      fixInputs(block, blocks, ids, actions, label, "blocks[" + id + "]");
    }
    // Drop references to blocks removed above.
    const liveIds = new Set(Object.keys(blocks));
    for (const [id, block] of Object.entries(blocks)) {
      if (!isObj(block)) continue;
      // A second pass with the surviving id set removes inputs that pointed
      // at a block deleted for a missing opcode or invalid shape.
      fixInputs(block, blocks, liveIds, actions, label, "blocks[" + id + "]");
      if (block.next !== null && block.next !== undefined) {
        if (typeof block.next !== "string" || !liveIds.has(block.next) || block.next === id) {
          addAction(actions, "NEXT_DANGLING", SEV.warning, "Cleared a next link to a missing block.", { target: label, detail: id });
          block.next = null;
        }
      } else {
        block.next = null;
      }
      if (block.parent !== null && block.parent !== undefined) {
        if (typeof block.parent !== "string" || !liveIds.has(block.parent) || block.parent === id) {
          addAction(actions, "PARENT_DANGLING", SEV.warning, "Cleared a parent link to a missing block.", { target: label, detail: id });
          block.parent = null;
        }
      } else {
        block.parent = null;
      }
      if (typeof block.topLevel !== "boolean") {
        block.topLevel = block.parent === null;
        addAction(actions, "BLOCK_TOPLEVEL_TYPE", SEV.warning, "Rebuilt a missing topLevel flag.", { target: label, detail: id });
      }
      if (typeof block.shadow !== "boolean") {
        block.shadow = false;
        addAction(actions, "BLOCK_SHADOW_TYPE", SEV.warning, "Rebuilt a missing shadow flag.", { target: label, detail: id });
      }
      if (block.x !== undefined && !isFiniteNumber(block.x)) block.x = 0;
      if (block.y !== undefined && !isFiniteNumber(block.y)) block.y = 0;
      // A block with no parent is a top-level block. A block with a parent is
      // not. This marker is what the editor and serializer use.
      if (block.topLevel === true && block.parent) {
        if (liveIds.has(block.parent)) {
          block.topLevel = false;
        } else {
          block.parent = null;
        }
        addAction(actions, "TOPLEVEL_PARENT", SEV.warning, "Cleared a contradictory top-level flag.", { target: label, detail: id });
      }
      if (block.topLevel !== true && !block.parent && !hasIncoming(liveIds, blocks, id)) {
        block.topLevel = true;
        addAction(actions, "TOPLEVEL_RESTORED", SEV.warning, "Marked a loose block as top-level.", { target: label, detail: id });
      }
      if (block.topLevel === true) {
        block.x = ensureNumber(block.x, 0);
        block.y = ensureNumber(block.y, 0);
      }
      if (block.comment !== undefined && block.comment !== null) {
        const comments = ensureObject(target.comments);
        if (typeof block.comment !== "string" || !hasOwn(comments, block.comment)) block.comment = null;
      }
    }
    // Break cycles through next or input edges. Keep the first path of each
    // loop by clearing the edge that closes it.
    const state = new Map();
    function dropInputRef(block, name, slot) {
      const input = block.inputs[name];
      if (!Array.isArray(input)) return;
      if (input[0] === 3) {
        if (slot === 1) {
          if (input[2] !== null && input[2] !== undefined) block.inputs[name] = [1, input[2]];
          else delete block.inputs[name];
        } else {
          if (input[1] !== null && input[1] !== undefined) block.inputs[name] = [2, input[1]];
          else delete block.inputs[name];
        }
      } else {
        delete block.inputs[name];
      }
    }
    function walk(id) {
      const block = blocks[id];
      if (!isObj(block)) return;
      const current = state.get(id);
      if (current === 2) return;
      if (current === 1) return;
      state.set(id, 1);
      const next = block.next;
      if (typeof next === "string" && liveIds.has(next)) {
        if (state.get(next) === 1) {
          block.next = null;
          addAction(actions, "BLOCK_CYCLE", SEV.warning, "Broke a cycle in a block stack.", { target: label, detail: id });
        } else {
          walk(next);
        }
      }
      if (isObj(block.inputs)) {
        for (const [name, input] of Object.entries(block.inputs)) {
          if (!Array.isArray(input)) continue;
          for (let slot = 1; slot < input.length; slot++) {
            const ref = input[slot];
            if (typeof ref !== "string" || !liveIds.has(ref)) continue;
            if (state.get(ref) === 1) {
              dropInputRef(block, name, slot);
              addAction(actions, "BLOCK_CYCLE", SEV.warning, "Broke a cycle in an input.", { target: label, detail: id + "." + name });
              break;
            } else {
              walk(ref);
            }
          }
        }
      }
      state.set(id, 2);
    }
    for (const id of liveIds) if (state.get(id) !== 2) walk(id);

    // Fill in a missing parent when exactly one block points here. This is
    // the repair for a block whose parent id was lost; multi-parent sharing
    // is intentionally left alone because it is used by valid projects.
    const incoming = incomingMap(liveIds, blocks);
    for (const [id, block] of Object.entries(blocks)) {
      if (!isObj(block)) continue;
      if (block.parent === null && block.topLevel !== true && incoming.get(id) && incoming.get(id).length === 1) {
        block.parent = incoming.get(id)[0];
        addAction(actions, "PARENT_RESTORED", SEV.warning, "Restored a missing parent link.", { target: label, detail: id });
      } else if (block.parent === null && block.topLevel !== true && (!incoming.get(id) || !incoming.get(id).length)) {
        block.topLevel = true;
        addAction(actions, "TOPLEVEL_RESTORED", SEV.warning, "Marked an unlinked block as top-level.", { target: label, detail: id });
      }
    }
    target.blocks = blocks;
  }

  function hasIncoming(ids, blocks, targetId) {
    for (const [id, block] of Object.entries(blocks)) {
      if (!isObj(block) || id === targetId) continue;
      if (block.next === targetId) return true;
      if (isObj(block.inputs)) {
        for (const input of Object.values(block.inputs)) {
          if (Array.isArray(input) && input.slice(1).includes(targetId)) return true;
        }
      }
    }
    return false;
  }

  function incomingMap(ids, blocks) {
    const map = new Map();
    ids.forEach((id) => map.set(id, []));
    for (const [id, block] of Object.entries(blocks)) {
      if (!isObj(block)) continue;
      if (typeof block.next === "string" && ids.has(block.next)) map.get(block.next).push(id);
      if (isObj(block.inputs)) {
        for (const input of Object.values(block.inputs)) {
          if (!Array.isArray(input)) continue;
          input.slice(1).forEach((ref) => {
            if (typeof ref === "string" && ids.has(ref)) map.get(ref).push(id);
          });
        }
      }
    }
    return map;
  }

  function repairComments(target, actions, label) {
    if (target.comments === undefined) { target.comments = {}; return; }
    if (!isObj(target.comments)) {
      target.comments = {};
      addAction(actions, "COMMENTS_NOT_OBJECT", SEV.warning, "Rebuilt the comments object.", { target: label });
      return;
    }
    const blocks = ensureObject(target.blocks);
    const out = {};
    for (const [id, comment] of Object.entries(target.comments)) {
      if (!isObj(comment)) {
        addAction(actions, "COMMENT_NOT_OBJECT", SEV.warning, "Removed a comment that was not an object.", { target: label, detail: id });
        continue;
      }
      comment.text = typeof comment.text === "string" ? comment.text : "";
      if (comment.text.length > 8000) {
        comment.text = comment.text.slice(0, 8000);
        addAction(actions, "COMMENT_TEXT_LONG", SEV.warning, "Truncated a comment to Scratch's 8000-character limit.", { target: label, detail: id });
      }
      comment.x = isFiniteNumber(comment.x) ? comment.x : 0;
      comment.y = isFiniteNumber(comment.y) ? comment.y : 0;
      comment.width = isFiniteNumber(comment.width) && comment.width >= 0 ? comment.width : 200;
      comment.height = isFiniteNumber(comment.height) && comment.height >= 0 ? comment.height : 100;
      comment.minimized = ensureBoolean(comment.minimized, false);
      if (comment.blockId !== undefined && comment.blockId !== null) {
        if (typeof comment.blockId !== "string" || !hasOwn(blocks, comment.blockId)) {
          comment.blockId = null;
          addAction(actions, "COMMENT_DANGLING", SEV.warning, "Detached a comment from a missing block.", { target: label, detail: id });
        }
      }
      out[id] = comment;
    }
    target.comments = out;
  }

  function parsePngSize(bytes) {
    if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  function parseGifSize(bytes) {
    if (bytes.length < 10) return null;
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
  }
  function parseBmpSize(bytes) {
    if (bytes.length < 26) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  }
  function parseJpegSize(bytes) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8]
        };
      }
      i += 2 + len;
    }
    return null;
  }
  function parseSvgSize(bytes) {
    const text = utf8Decode(bytes.subarray(0, Math.min(bytes.length, 32768)));
    const tag = text.match(/<svg\b[^>]*>/i);
    if (!tag) return null;
    const attr = (name) => {
      const m = tag[0].match(new RegExp("\\b" + name + "\\s*=\\s*[\"']([^\"']+)[\"']", "i"));
      return m ? m[1] : null;
    };
    const dim = (value) => {
      if (!value) return null;
      const n = parseFloat(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    let width = dim(attr("width"));
    let height = dim(attr("height"));
    if ((!width || !height) && attr("viewBox")) {
      const parts = attr("viewBox").split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        width = width || parts[2];
        height = height || parts[3];
      }
    }
    return width && height ? { width, height } : null;
  }
  function imageSize(bytes, format) {
    if (format === "png") return parsePngSize(bytes);
    if (format === "gif") return parseGifSize(bytes);
    if (format === "bmp") return parseBmpSize(bytes);
    if (format === "jpg" || format === "jpeg") return parseJpegSize(bytes);
    if (format === "svg") return parseSvgSize(bytes);
    return null;
  }

  function wavInfo(bytes) {
    if (bytes.length < 44) return null;
    const head = utf8Decode(bytes.subarray(0, 12));
    if (head.slice(0, 4) !== "RIFF" || head.slice(8, 12) !== "WAVE") return null;
    let p = 12;
    let rate = 0, channels = 0, bits = 0, dataBytes = 0;
    while (p + 8 <= bytes.length) {
      const id = utf8Decode(bytes.subarray(p, p + 4));
      const size = u32(bytes, p + 4);
      if (id === "fmt " && p + 16 <= bytes.length) {
        channels = u16(bytes, p + 10);
        rate = u32(bytes, p + 12);
        bits = u16(bytes, p + 22);
      } else if (id === "data") {
        dataBytes = Math.min(size, bytes.length - p - 8);
        break;
      }
      p += 8 + size + (size & 1);
    }
    if (!rate || !channels) return null;
    return { rate, sampleCount: Math.floor(dataBytes / (channels * Math.max(1, bits / 8))) };
  }

  function placeholderFor(kind) {
    if (kind === "costume") {
      return {
        bytes: PLACEHOLDER_PNG, dataFormat: "png", md5: md5hex(PLACEHOLDER_PNG),
        width: 1, height: 1
      };
    }
    return {
      bytes: PLACEHOLDER_WAV, dataFormat: "wav", md5: md5hex(PLACEHOLDER_WAV), wav: wavInfo(PLACEHOLDER_WAV)
    };
  }

  function repairAssets(project, entries, actions, options) {
    const opts = options || {};
    const fill = opts.fillMissingAssets !== false;
    const replace = opts.replaceInvalidAssets !== false;
    const addEntry = (name, bytes) => {
      entries.set(name, bytes);
      return name;
    };
    // When an asset is renamed to its content hash, later references to the
    // old name (a shared costume, a duplicated sound) must still find it.
    const alias = new Map();
    const resolveEntry = (candidate) => {
      if (alias.has(candidate)) return alias.get(candidate);
      return findEntry(entries, candidate);
    };
    const targets = Array.isArray(project.targets) ? project.targets : [];
    targets.forEach((target, index) => {
      if (!isObj(target)) return;
      const label = targetLabel(target, index);
      for (const kind of ["costume", "sound"]) {
        const key = kind === "costume" ? "costumes" : "sounds";
        const list = ensureArray(target[key]);
        target[key] = list;
        list.forEach((asset, assetIndex) => {
          if (!isObj(asset)) {
            const placeholder = placeholderFor(kind);
            const replacement = { name: kind + (assetIndex + 1) };
            applyPlaceholder(replacement, placeholder, kind);
            list[assetIndex] = replacement;
            addEntry(placeholder.md5 + "." + placeholder.dataFormat, placeholder.bytes);
            addAction(actions, "ASSET_NOT_OBJECT", SEV.warning, "Replaced a malformed " + kind + " entry.", { target: label, detail: String(assetIndex) });
            return;
          }
          if (typeof asset.name !== "string") {
            asset.name = kind + (assetIndex + 1);
            addAction(actions, "ASSET_NAME_MISSING", SEV.warning, "Named an unnamed " + kind + ".", { target: label, detail: asset.name });
          }
          let format = normalizeFormat(asset, kind);
          let entryName = null;
          const candidates = assetCandidates(asset);
          for (const candidate of candidates) {
            const found = resolveEntry(candidate);
            if (found) { entryName = found; break; }
          }
          if (!entryName && typeof asset.assetId === "string" && /^[a-fA-F0-9]{32}$/.test(asset.assetId)) {
            const id = asset.assetId.toLowerCase();
            for (const name of entries.keys()) {
              if (basename(name).toLowerCase().startsWith(id)) { entryName = alias.get(name) || name; break; }
            }
          }
          if (!entryName) {
            if (!fill) return;
            const placeholder = placeholderFor(kind);
            applyPlaceholder(asset, placeholder, kind);
            addEntry(placeholder.md5 + "." + placeholder.dataFormat, placeholder.bytes);
            addAction(actions, "ASSET_MISSING", SEV.warning, "Replaced a missing " + kind + " with a placeholder.", { target: label, detail: asset.name });
            return;
          }
          let bytes = entries.get(entryName);
          const actualExt = (basename(entryName).split(".").pop() || "").toLowerCase();
          if (kind === "costume" && COSTUME_FORMATS.includes(actualExt)) format = actualExt;
          if (kind === "sound" && SOUND_FORMATS.includes(actualExt)) format = actualExt;
          if (kind === "sound" && format === "wave") format = "wav";
          if (!format) format = actualExt;
          const detected = detectMediaFormat(bytes, kind);
          if (detected && detected !== (format === "jpg" ? "jpeg" : format)) {
            addAction(actions, "ASSET_FORMAT_MISMATCH", SEV.warning, "Corrected a " + kind + " format from its file signature.", {
              target: label, detail: format + " -> " + detected
            });
            format = detected;
          }
          const sig = mediaSignature(bytes, kind, format);
          if (!sig.ok) {
            if (!replace) return;
            const placeholder = placeholderFor(kind);
            applyPlaceholder(asset, placeholder, kind);
            addEntry(placeholder.md5 + "." + placeholder.dataFormat, placeholder.bytes);
            addAction(actions, "ASSET_INVALID", SEV.warning, "Replaced an unreadable " + kind + " with a placeholder.", {
              target: label, detail: asset.name + " (" + sig.reason + ")"
            });
            return;
          }
          const actualId = md5hex(bytes);
          if (typeof asset.assetId !== "string" || asset.assetId.toLowerCase() !== actualId) {
            addAction(actions, "ASSET_ID_MISMATCH", SEV.warning, "Corrected a " + kind + " asset id to match its bytes.", {
              target: label, detail: String(asset.assetId) + " -> " + actualId
            });
          }
          asset.assetId = actualId;
          asset.dataFormat = format;
          const desiredName = actualId + "." + format;
          if (basename(entryName) !== desiredName) {
            const old = entryName;
            entries.delete(old);
            if (!entries.has(desiredName)) entries.set(desiredName, bytes);
            alias.set(old, desiredName);
            entryName = desiredName;
            addAction(actions, "ASSET_RENAMED", SEV.warning, "Renamed an asset file to its content hash.", {
              target: label, detail: old + " -> " + desiredName
            });
          }
          asset.md5ext = desiredName;
          if (kind === "costume") {
            let resolution = asset.bitmapResolution;
            if (format === "svg") {
              if (resolution !== 1) asset.bitmapResolution = 1;
            } else if (!Number.isInteger(resolution) || resolution <= 0) {
              asset.bitmapResolution = 2;
              addAction(actions, "COSTUME_RESOLUTION", SEV.warning, "Set a valid integer bitmap resolution.", { target: label, detail: asset.name });
            }
            const size = imageSize(bytes, format);
            if (!isFiniteNumber(asset.rotationCenterX) || !isFiniteNumber(asset.rotationCenterY)) {
              const w = size ? size.width : 1;
              const h = size ? size.height : 1;
              asset.rotationCenterX = isFiniteNumber(asset.rotationCenterX) ? asset.rotationCenterX : w / 2;
              asset.rotationCenterY = isFiniteNumber(asset.rotationCenterY) ? asset.rotationCenterY : h / 2;
              addAction(actions, "COSTUME_CENTER", SEV.warning, "Set a missing costume rotation center.", { target: label, detail: asset.name });
            }
          } else {
            const info = format === "wav" ? wavInfo(bytes) : null;
            if (info) {
              if (!Number.isInteger(asset.rate) || asset.rate <= 0) { asset.rate = info.rate; addAction(actions, "SOUND_RATE", SEV.warning, "Set a missing sound sample rate.", { target: label, detail: asset.name }); }
              if (!Number.isInteger(asset.sampleCount) || asset.sampleCount < 0) { asset.sampleCount = info.sampleCount; addAction(actions, "SOUND_SAMPLES", SEV.warning, "Set a missing sound sample count.", { target: label, detail: asset.name }); }
            } else {
              if (!Number.isInteger(asset.rate) || asset.rate <= 0) asset.rate = 44100;
              if (!Number.isInteger(asset.sampleCount) || asset.sampleCount < 0) asset.sampleCount = 0;
            }
          }
        });
      }
      if (Array.isArray(target.costumes) && target.costumes.length) {
        const current = target.currentCostume;
        if (!Number.isInteger(current) || current < 0 || current >= target.costumes.length) {
          target.currentCostume = Math.max(0, Math.min(target.costumes.length - 1, Number.isInteger(current) ? current : 0));
          addAction(actions, "CURRENT_COSTUME", SEV.warning, "Clamped currentCostume into the costume list.", { target: label });
        }
      }
    });
  }

  function normalizeFormat(asset, kind) {
    let format = typeof asset.dataFormat === "string" ? asset.dataFormat.toLowerCase() : "";
    if (kind === "sound" && format === "wave") format = "wav";
    if (kind === "costume" && format === "jpg") format = "jpeg";
    if (typeof asset.md5ext === "string") {
      const ext = (asset.md5ext.split(".").pop() || "").toLowerCase();
      if (ext) format = ext === "jpg" ? "jpeg" : ext;
    }
    return format;
  }

  function applyPlaceholder(asset, placeholder, kind) {
    asset.assetId = placeholder.md5;
    asset.dataFormat = placeholder.dataFormat;
    asset.md5ext = placeholder.md5 + "." + placeholder.dataFormat;
    if (kind === "costume") {
      asset.bitmapResolution = 1;
      asset.rotationCenterX = 0.5;
      asset.rotationCenterY = 0.5;
    } else {
      asset.rate = placeholder.wav ? placeholder.wav.rate : 22050;
      asset.sampleCount = placeholder.wav ? placeholder.wav.sampleCount : 1;
    }
  }

  function repairTargetOrder(project, actions) {
    const targets = project.targets;
    let stage = targets.find((t) => isObj(t) && t.isStage === true);
    if (!stage) {
      // A sprite that was renamed to Stage is still the project's stage in
      // intent; prefer it over inventing a second, empty stage.
      const namedStage = targets.find((t) => isObj(t) && t.name === "Stage");
      if (namedStage) {
        namedStage.isStage = true;
        stage = namedStage;
        addAction(actions, "STAGE_RESTORED", SEV.warning, "Restored the stage flag from the target named Stage.", {});
      }
    }
    if (!stage) {
      // A project with a single sprite-shaped object can be wrapped with a
      // blank stage instead of discarding the sprite.
      const sprite = targets.find(looksLikeSprite);
      stage = blankStage();
      stage.costumes.push(placeholderCostume());
      targets.unshift(stage);
      addAction(actions, "STAGE_CREATED", SEV.warning, "Created a blank stage for a project that had none.", {});
      if (sprite && targets.length === 1) targets.push(sprite);
    }
    const others = targets.filter((t) => t !== stage);
    const usedNames = new Set(others.filter(isObj).map((t) => t.name).filter((n) => typeof n === "string"));
    for (const t of others) {
      if (isObj(t) && t.isStage === true) {
        const oldName = t.name;
        t.isStage = false;
        if (typeof t.name !== "string" || !t.name || t.name === "Stage") {
          t.name = uniqueName("Sprite", usedNames);
        }
        addAction(actions, "STAGE_MULTIPLE", SEV.warning, "Converted an extra stage into a sprite.", {
          detail: String(oldName) + " -> " + t.name
        });
      }
    }
    const ordered = [stage].concat(others);
    project.targets = ordered;
    ordered.forEach((t, index) => {
      if (!isObj(t)) return;
      if (index === 0) {
        if (t.name !== "Stage") {
          addAction(actions, "STAGE_NAME", SEV.warning, "Renamed the stage to Stage.", { detail: String(t.name) });
          t.name = "Stage";
        }
        t.isStage = true;
        t.layerOrder = 0;
        t.volume = ensureNumber(t.volume, 100);
        t.tempo = ensureNumber(t.tempo, 60);
        t.videoTransparency = ensureNumber(t.videoTransparency, 50);
        if (!["on", "off", "on-flipped"].includes(t.videoState)) {
          if (t.videoState !== undefined) addAction(actions, "VIDEO_STATE", SEV.warning, "Reset an invalid video state.", { detail: String(t.videoState) });
          t.videoState = "on";
        }
        if (!("textToSpeechLanguage" in t)) t.textToSpeechLanguage = null;
        else if (t.textToSpeechLanguage !== null && typeof t.textToSpeechLanguage !== "string") {
          t.textToSpeechLanguage = String(t.textToSpeechLanguage);
          addAction(actions, "TARGET_PROP", SEV.warning, "Rebuilt textToSpeechLanguage as a string.", {});
        }
      } else {
        t.isStage = false;
        t.name = ensureString(t.name, "Sprite" + index);
        if (t.name === "_stage_") {
          t.name = "Sprite" + index;
          addAction(actions, "TARGET_NAME", SEV.warning, "Renamed a sprite that used the reserved name _stage_.", { detail: t.name });
        }
        t.volume = ensureNumber(t.volume, 100);
        t.visible = ensureBoolean(t.visible, true);
        t.x = ensureNumber(t.x, 0);
        t.y = ensureNumber(t.y, 0);
        t.size = ensureNumber(t.size, 100);
        t.direction = ensureNumber(t.direction, 90);
        t.draggable = ensureBoolean(t.draggable, false);
        if (!["all around", "don't rotate", "left-right"].includes(t.rotationStyle)) {
          if (t.rotationStyle !== undefined) addAction(actions, "ROTATION_STYLE", SEV.warning, "Reset an invalid rotation style.", { target: t.name, detail: String(t.rotationStyle) });
          t.rotationStyle = "all around";
        }
      }
      t.variables = ensureObject(t.variables);
      t.lists = ensureObject(t.lists);
      t.broadcasts = ensureObject(t.broadcasts);
      t.blocks = ensureObject(t.blocks);
      t.comments = ensureObject(t.comments);
      t.costumes = ensureArray(t.costumes);
      t.sounds = ensureArray(t.sounds);
    });
    const sprites = project.targets.slice(1).filter(isObj);
    project.targets = [project.targets[0]].concat(sprites);
    const seenLayers = new Set();
    project.targets.forEach((t, index) => {
      if (index === 0) {
        if (t.layerOrder !== 0) {
          t.layerOrder = 0;
          addAction(actions, "LAYER_ORDER", SEV.warning, "Set the stage layer order to 0.", {});
        }
        return;
      }
      const old = t.layerOrder;
      if (!Number.isInteger(old) || old < 1 || seenLayers.has(old)) {
        let next = 1;
        while (seenLayers.has(next)) next++;
        t.layerOrder = next;
        addAction(actions, "LAYER_ORDER", SEV.warning, "Repaired an invalid sprite layer order.", { target: t.name, detail: String(old) + " -> " + next });
      }
      seenLayers.add(t.layerOrder);
    });
  }

  function placeholderCostume() {
    const p = placeholderFor("costume");
    return {
      name: "costume1", assetId: p.md5, dataFormat: "png", md5ext: p.md5 + ".png",
      bitmapResolution: 1, rotationCenterX: 0.5, rotationCenterY: 0.5
    };
  }

  function repairMonitors(project, actions) {
    if (project.monitors === undefined) { project.monitors = []; return; }
    if (!Array.isArray(project.monitors)) {
      project.monitors = [];
      addAction(actions, "MONITORS_NOT_ARRAY", SEV.warning, "Rebuilt the monitors array.", {});
      return;
    }
    const targets = project.targets;
    const stage = getStage(project);
    const byName = new Map();
    targets.forEach((t) => { if (isObj(t) && typeof t.name === "string") byName.set(t.name, t); });
    const seen = new Set();
    const out = [];
    project.monitors.forEach((monitor, index) => {
      if (!isObj(monitor)) {
        addAction(actions, "MONITOR_NOT_OBJECT", SEV.warning, "Removed a malformed monitor.", { detail: String(index) });
        return;
      }
      if (typeof monitor.opcode !== "string" || !monitor.opcode) {
        addAction(actions, "MONITOR_OPCODE", SEV.warning, "Removed a monitor with no opcode.", {});
        return;
      }
      let target = stage;
      if (typeof monitor.spriteName === "string" && monitor.spriteName) {
        target = byName.get(monitor.spriteName) || null;
        if (!target) {
          // If the monitor is for a global store, it can fall back to the
          // stage; otherwise it can never show anything.
          const global = monitor.opcode === "data_variable" || monitor.opcode === "data_listcontents";
          if (global) {
            addAction(actions, "MONITOR_SPRITE_MISSING", SEV.warning, "Pointed a global monitor at the stage instead of a missing sprite.", { detail: monitor.spriteName });
            monitor.spriteName = null;
            target = stage;
          } else {
            addAction(actions, "MONITOR_SPRITE_MISSING", SEV.warning, "Removed a monitor for a missing sprite.", { detail: monitor.spriteName });
            return;
          }
        }
      }
      if (monitor.opcode === "data_variable" || monitor.opcode === "data_listcontents") {
        const kind = monitor.opcode === "data_variable" ? "variable" : "list";
        const key = kind === "variable" ? "VARIABLE" : "LIST";
        monitor.params = ensureObject(monitor.params);
        const found = lookupVariable(target, stage, typeof monitor.id === "string" ? monitor.id : null,
          typeof monitor.params[key] === "string" ? monitor.params[key] : null, kind);
        if (!found) {
          addAction(actions, "MONITOR_STORE_MISSING", SEV.warning, "Removed a monitor whose " + kind + " no longer exists.", { detail: String(monitor.params[key]) });
          return;
        }
        monitor.id = found.id;
        monitor.params[key] = found.name;
        monitor.spriteName = found.local && found.target !== stage ? found.target.name : null;
        monitor.mode = kind === "list" ? "list" : (typeof monitor.mode === "string" ? monitor.mode : "default");
      } else {
        if (!isObj(monitor.params)) monitor.params = {};
        monitor.mode = typeof monitor.mode === "string" ? monitor.mode : "default";
      }
      if (typeof monitor.id !== "string" || !monitor.id) {
        monitor.id = monitor.opcode + "_" + (monitor.spriteName || "stage");
      }
      if (seen.has(monitor.id)) {
        addAction(actions, "MONITOR_DUPLICATE", SEV.warning, "Removed a duplicate monitor.", { detail: monitor.id });
        return;
      }
      seen.add(monitor.id);
      monitor.visible = ensureBoolean(monitor.visible, true);
      monitor.x = isFiniteNumber(monitor.x) ? monitor.x : null;
      monitor.y = isFiniteNumber(monitor.y) ? monitor.y : null;
      monitor.width = isFiniteNumber(monitor.width) && monitor.width >= 0 ? monitor.width : 0;
      monitor.height = isFiniteNumber(monitor.height) && monitor.height >= 0 ? monitor.height : 0;
      monitor.sliderMin = ensureNumber(monitor.sliderMin, 0);
      monitor.sliderMax = ensureNumber(monitor.sliderMax, 100);
      monitor.isDiscrete = ensureBoolean(monitor.isDiscrete, true);
      out.push(monitor);
    });
    project.monitors = out;
  }

  function repairExtensions(project, actions) {
    const extensions = [];
    const seen = new Set();
    if (Array.isArray(project.extensions)) {
      project.extensions.forEach((ext) => {
        if (typeof ext !== "string" || !ext) {
          addAction(actions, "EXTENSION_ID", SEV.warning, "Removed an invalid extension id.", {});
          return;
        }
        if (seen.has(ext)) {
          addAction(actions, "EXTENSION_DUPLICATE", SEV.warning, "Removed a duplicate extension declaration.", { detail: ext });
          return;
        }
        seen.add(ext);
        extensions.push(ext);
      });
    } else if (project.extensions !== undefined) {
      addAction(actions, "EXTENSIONS_NOT_ARRAY", SEV.warning, "Rebuilt the extensions array.", {});
    }
    const add = (opcode) => {
      const ext = inferExtension(opcode);
      if (ext && !seen.has(ext)) {
        seen.add(ext);
        extensions.push(ext);
        addAction(actions, "EXTENSION_MISSING", SEV.warning, "Declared an extension used by a block.", { detail: ext });
      }
    };
    if (Array.isArray(project.targets)) {
      project.targets.forEach((t) => {
        if (!isObj(t) || !isObj(t.blocks)) return;
        for (const block of Object.values(t.blocks)) {
          if (isObj(block) && typeof block.opcode === "string") add(block.opcode);
        }
      });
    }
    if (Array.isArray(project.monitors)) {
      project.monitors.forEach((m) => { if (isObj(m) && typeof m.opcode === "string") add(m.opcode); });
    }
    project.extensions = extensions;
  }

  function repairMeta(project, actions) {
    if (!isObj(project.meta)) {
      project.meta = { semver: "3.0.0", vm: "0.2.0", agent: "SB3 Repair" };
      addAction(actions, "META_MISSING", SEV.warning, "Created the project meta object.", {});
      return;
    }
    if (typeof project.meta.semver !== "string" || !/^3\.\d+\.\d+$/.test(project.meta.semver)) {
      addAction(actions, "META_SEMVER", SEV.warning, "Set meta.semver to 3.0.0.", { detail: String(project.meta.semver) });
      project.meta.semver = "3.0.0";
    }
    if (typeof project.meta.vm !== "string" || !/^\d+\.\d+\.\d+($|-)/.test(project.meta.vm)) {
      addAction(actions, "META_VM", SEV.warning, "Set meta.vm to a valid version string.", { detail: String(project.meta.vm) });
      project.meta.vm = "0.2.0";
    }
    if (project.meta.agent !== undefined && typeof project.meta.agent !== "string") {
      project.meta.agent = String(project.meta.agent);
      addAction(actions, "META_AGENT", SEV.warning, "Rebuilt meta.agent as a string.", {});
    }
    if (project.meta.origin !== undefined && typeof project.meta.origin !== "string") {
      project.meta.origin = String(project.meta.origin);
      addAction(actions, "META_AGENT", SEV.warning, "Rebuilt meta.origin as a string.", {});
    }
  }

  function repairTargets(project, actions, options) {
    if (!Array.isArray(project.targets) && Array.isArray(project.target)) {
      project.targets = project.target;
      delete project.target;
      addAction(actions, "TARGETS_ALIAS", SEV.warning, "Moved a misspelled target list to targets.", {});
    } else if (!Array.isArray(project.targets) && isObj(project.target)) {
      project.targets = [project.target];
      delete project.target;
      addAction(actions, "TARGETS_ALIAS", SEV.warning, "Wrapped a single target object in a targets array.", {});
    }
    if (!Array.isArray(project.targets) || !project.targets.length) {
      if (!Array.isArray(project.targets) && looksLikeSprite(project)) {
        const sprite = clone(project);
        project.targets = [blankStage(), sprite];
        delete project.name;
        delete project.isStage;
        delete project.blocks;
        delete project.costumes;
        delete project.sounds;
        delete project.variables;
        delete project.lists;
        delete project.broadcasts;
        delete project.comments;
        addAction(actions, "TARGETS_WRAPPED", SEV.warning, "Wrapped a sprite-shaped JSON file in a project.", {});
      } else {
        project.targets = [];
        addAction(actions, "TARGETS_MISSING", SEV.warning, "Created an empty target list.", {});
      }
    }
    project.targets = project.targets.filter((t, index) => {
      if (isObj(t)) return true;
      addAction(actions, "TARGET_NOT_OBJECT", SEV.warning, "Removed a target that was not an object.", { detail: String(index) });
      return false;
    });
    repairTargetOrder(project, actions);
    project.targets.forEach((target, index) => {
      if (!isObj(target)) return;
      const label = targetLabel(target, index);
      repairStores(target, actions, label);
      repairBlocks(target, actions, label);
      repairComments(target, actions, label);
      if (!Array.isArray(target.costumes) || !target.costumes.length) {
        target.costumes = ensureArray(target.costumes);
        if (!options || options.fillMissingAssets !== false) {
          target.costumes.push(placeholderCostume());
          const p = placeholderFor("costume");
          // The entry is added by repairAssets, which runs after this pass.
          target.__placeholderCostume = p;
          addAction(actions, "COSTUMES_EMPTY", SEV.warning, "Added a placeholder costume.", { target: label });
        }
      }
      if (!Array.isArray(target.sounds)) {
        target.sounds = [];
        addAction(actions, "SOUNDS_MISSING", SEV.warning, "Rebuilt the sounds array.", { target: label });
      }
    });
    // Repair store references only after every target has a valid store map.
    const stage = getStage(project);
    project.targets.forEach((target, index) => {
      if (!isObj(target)) return;
      repairStoreReferences(target, stage, actions, targetLabel(target, index));
    });
    project.targets.forEach((target, index) => {
      if (!isObj(target)) return;
      repairProcedures(target, actions, targetLabel(target, index), options);
    });
  }

  function addPlaceholderEntries(project, entries) {
    // repairAssets handles normal assets; this covers the placeholder costume
    // added to a target with an empty costume list.
    project.targets.forEach((t) => {
      if (!isObj(t) || !t.__placeholderCostume) return;
      const p = t.__placeholderCostume;
      entries.set(p.md5 + "." + p.dataFormat, p.bytes);
      delete t.__placeholderCostume;
    });
  }

  // ---------------------------------------------------------------- pipeline

  async function loadEntriesFromJSZip(zip) {
    const entries = new Map();
    const notes = [];
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    for (const name of names) {
      try {
        entries.set(normalizeEntryName(name), await zip.files[name].async("uint8array"));
      } catch (error) {
        notes.push({ code: "ZIP_ENTRY_UNREADABLE", name, message: String(error && error.message || error) });
      }
    }
    return { entries, notes };
  }

  function findProjectEntry(entries) {
    if (entries.has("project.json")) return "project.json";
    for (const name of entries.keys()) {
      if (/^([^/]+\/)?project\.json$/i.test(name)) return name;
    }
    return null;
  }

  function flattenEntries(entries, actions) {
    const out = new Map();
    for (const [name, bytes] of entries.entries()) {
      const flat = basename(name);
      if (name === flat) { out.set(flat, bytes); continue; }
      if (out.has(flat)) {
        if (!bytesEqual(out.get(flat), bytes)) {
          addAction(actions, "ZIP_FLATTEN_COLLISION", SEV.warning, "Two archive entries shared a file name; kept the first.", { detail: flat });
        }
        continue;
      }
      out.set(flat, bytes);
      addAction(actions, "ZIP_FLATTEN", SEV.warning, "Flattened an asset path so Scratch can find it.", { detail: name + " -> " + flat });
    }
    return out;
  }

  async function openProject(raw, options, actions, progress) {
    const opts = options || {};
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const container = { kind: "zip", salvaged: false, notes: [], sourceBytes: bytes.length };
    let entries = null;
    let projectBytes = null;
    let needsSalvage = false;

    // A bare project.json is accepted as a last resort. The assets cannot be
    // recovered, but the project data and structure can.
    const head = bytes.subarray(0, Math.min(bytes.length, 512));
    const headText = utf8Decode(head).replace(/^\uFEFF/, "").trimStart();
    if (headText.startsWith("{")) {
      container.kind = "json";
      entries = new Map();
      projectBytes = bytes;
      container.notes.push({ code: "CONTAINER_JSON", message: "Input was a bare project.json; media placeholders will be used." });
      return { entries, projectBytes, container };
    }

    if (typeof JSZipLib === "function" || (JSZipLib && typeof JSZipLib.loadAsync === "function")) {
      try {
        if (progress) progress("load", 0.15, "Reading the archive");
        const zip = await JSZipLib.loadAsync(bytes);
        const loaded = await loadEntriesFromJSZip(zip);
        entries = loaded.entries;
        loaded.notes.forEach((n) => container.notes.push(n));
        needsSalvage = loaded.notes.length > 0;
        const projectEntry = findProjectEntry(entries);
        if (projectEntry) {
          projectBytes = entries.get(projectEntry);
          if (projectEntry !== "project.json") {
            entries.set("project.json", projectBytes);
            entries.delete(projectEntry);
            container.notes.push({ code: "PROJECT_PATH", message: "Moved project.json to the archive root." });
          }
        }
      } catch (error) {
        container.notes.push({ code: "ZIP_LOAD_FAILED", message: String(error && error.message || error) });
      }
    } else {
      container.notes.push({ code: "ZIP_LIBRARY_MISSING", message: "JSZip is not loaded." });
    }

    if (!projectBytes) needsSalvage = true;
    if (needsSalvage) {
      if (progress) progress("load", 0.3, "Scanning for recoverable archive entries");
      const salvaged = await salvageZip(bytes);
      container.salvaged = true;
      salvaged.notes.forEach((n) => container.notes.push(n));
      if (entries && entries.size) {
        // Keep successfully-read original entries and fill gaps from salvage.
        for (const [name, data] of salvaged.entries) {
          if (!entries.has(name)) entries.set(name, data);
        }
      } else {
        entries = salvaged.entries;
      }
      if (!projectBytes) {
        const projectEntry = findProjectEntry(entries);
        if (projectEntry) {
          projectBytes = entries.get(projectEntry);
          if (projectEntry !== "project.json") {
            entries.set("project.json", projectBytes);
            entries.delete(projectEntry);
            container.notes.push({ code: "PROJECT_PATH", message: "Moved project.json to the archive root." });
          }
        }
      }
    }

    if (!projectBytes) {
      throw new Error("project.json was not found, and the archive could not be scanned for one.");
    }
    entries = flattenEntries(entries, actions);
    if (entries.has("project.json")) projectBytes = entries.get("project.json");
    return { entries, projectBytes, container };
  }

  async function repairBuffer(buffer, filename, options, progress) {
    const opts = Object.assign({
      fillMissingAssets: true,
      replaceInvalidAssets: true,
      rebuildBlocks: true,
      stubOrphanCalls: true,
      removeStaleMonitors: true
    }, options || {});
    const name = String(filename || "project.sb3").split(/[\\/]/).pop() || "project.sb3";
    const actions = [];
    const report = { version: VERSION, input: name, actions };
    if (progress) progress("load", 0.02, "Opening the project");
    const opened = await openProject(buffer, opts, actions, progress);
    const entries = opened.entries;
    const container = opened.container;
    report.container = container;

    if (progress) progress("json", 0.35, "Parsing project.json");
    const parsed = parseProjectText(utf8Decode(opened.projectBytes));
    if (!parsed.project) {
      throw new Error(parsed.error || "project.json could not be parsed.");
    }
    report.json = { method: parsed.method, notes: parsed.notes, bytes: opened.projectBytes.length };
    if (parsed.method !== "direct") {
      addAction(actions, "JSON_RECOVERED", SEV.warning, "Recovered project.json with the " + parsed.method + " JSON repair.", {
        detail: parsed.notes.join(" ")
      });
    }
    if (!isObj(parsed.project)) throw new Error("project.json did not contain a JSON object.");

    const beforeJson = JSON.stringify(parsed.project);
    const original = clone(parsed.project);
    const before = validateProject(original, entries, opts);
    report.before = before;

    if (progress) progress("structure", 0.5, "Repairing targets and stores");
    const project = clone(parsed.project);
    repairMeta(project, actions);
    repairTargets(project, actions, opts);
    addPlaceholderEntries(project, entries);
    if (progress) progress("blocks", 0.62, "Repairing block links");
    // repairTargets already walked blocks; a second pass sees store ids that
    // were created while resolving references.
    const stage = getStage(project);
    project.targets.forEach((target) => {
      if (!isObj(target)) return;
      repairStoreReferences(target, stage, actions, target.name);
    });
    if (progress) progress("assets", 0.72, "Checking costumes and sounds");
    repairAssets(project, entries, actions, opts);
    if (progress) progress("monitors", 0.82, "Repairing monitors");
    if (opts.removeStaleMonitors !== false) repairMonitors(project, actions);
    repairExtensions(project, actions);
    cleanInternal(project);

    if (progress) progress("validate", 0.88, "Validating the repaired project");
    const after = validateProject(project, entries, opts);
    report.after = after;
    report.changed = actions.length > 0 || JSON.stringify(project) !== beforeJson || container.salvaged;
    report.unresolved = after.issues.filter((i) => i.severity === SEV.error);
    report.projectJson = JSON.stringify(project);

    if (progress) progress("package", 0.94, "Repacking the .sb3");
    const zipBytes = await packProject(project, entries);
    report.outputBytes = zipBytes;
    report.outputName = name.replace(/\.(sb3|json)$/i, "") + "_repaired.sb3";
    report.inputSize = (buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)).length;
    report.outputSize = zipBytes.length;
    report.summary = {
      beforeErrors: before.stats.errors || 0,
      beforeWarnings: before.stats.warnings || 0,
      afterErrors: after.stats.errors || 0,
      afterWarnings: after.stats.warnings || 0,
      fixed: actions.length,
      entries: entries.size
    };
    if (progress) progress("done", 1, "Repair complete");
    return report;
  }

  async function inspectBuffer(buffer, filename, options, progress) {
    const name = String(filename || "project.sb3").split(/[\\/]/).pop() || "project.sb3";
    const actions = [];
    const opened = await openProject(buffer, options, actions, progress);
    const parsed = parseProjectText(utf8Decode(opened.projectBytes));
    if (!parsed.project || !isObj(parsed.project)) {
      return {
        version: VERSION, input: name, container: opened.container,
        json: { method: parsed.method, notes: parsed.notes },
        before: {
          issues: [err("JSON_PARSE_FAILED", parsed.error || "project.json did not contain a JSON object.")],
          stats: { errors: 1, warnings: 0 }
        },
        actions,
        canRepair: false
      };
    }
    const project = clone(parsed.project);
    const before = validateProject(project, opened.entries, options);
    return {
      version: VERSION, input: name, container: opened.container,
      json: { method: parsed.method, notes: parsed.notes, bytes: opened.projectBytes.length },
      before,
      actions,
      canRepair: true
    };
  }

  async function packProject(project, entries) {
    const zip = new JSZipLib();
    zip.file("project.json", JSON.stringify(project), { compression: "DEFLATE" });
    const used = new Set(["project.json"]);
    for (const [name, bytes] of entries.entries()) {
      if (name === "project.json") continue;
      let outName = basename(name);
      let n = 2;
      while (used.has(outName)) {
        const dot = outName.lastIndexOf(".");
        outName = (dot > 0 ? outName.slice(0, dot) : outName) + "_" + n + (dot > 0 ? outName.slice(dot) : "");
        n++;
      }
      used.add(outName);
      zip.file(outName, bytes, { binary: true, compression: "DEFLATE" });
    }
    if (typeof zip.generateAsync !== "function") throw new Error("JSZip is not loaded.");
    const out = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      platform: "DOS"
    });
    return out;
  }

  function cleanInternal(project) {
    if (!Array.isArray(project.targets)) return;
    project.targets.forEach((t) => {
      if (!isObj(t)) return;
      delete t.__placeholderCostume;
    });
  }

  // --------------------------------------------------------------- exports

  let JSZipLib = (typeof JSZip !== "undefined") ? JSZip : null;
  function setJSZip(lib) { JSZipLib = lib; }
  function getJSZip() { return JSZipLib; }

  return {
    VERSION,
    SEV,
    setJSZip,
    getJSZip,
    repairBuffer,
    inspectBuffer,
    validateProject,
    parseProjectText,
    salvageZip,
    packProject,
    mediaSignature,
    detectMediaFormat,
    imageSize,
    wavInfo,
    md5,
    md5hex,
    crc32,
    placeholderFor,
    placeholderMd5: (kind) => placeholderFor(kind).md5
  };
});
