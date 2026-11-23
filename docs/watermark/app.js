/* SB3 Watermark Checker — page controller. */
(function () {
  "use strict";

  var LANG = /^ja\b/i.test(document.documentElement.lang || "") ? "ja" : "en";
  var WM = window.SB3Watermark;

  var STRINGS = {
    en: {
      ready: "Ready",
      reading: "Reading {name}…",
      scanning: "Scanning SVG costumes…",
      complete: "Complete",
      failed: "Failed",
      invalidFile: "Choose an .sb3 file.",
      emptyFile: "That file is empty. Choose a Scratch project.",
      readFileError: "Could not read that file: {error}",
      analyzeFailed: "Could not read the watermark: {error}",
      engineMissing: "The watermark engine did not load. Reload the page and try again.",
      noProject: "project.json was not found inside the archive.",
      badProject: "Could not parse project.json: {error}",
      // Scratch project fetch
      fetchingMeta: "Looking up project #{id}…",
      fetchingProject: "Downloading project.json…",
      fetchingAssets: "Downloading SVG assets ({done}/{total})…",
      fetchInvalidId: "Enter a Scratch project ID (digits) or a project URL.",
      fetchNoToken: "Scratch did not return a project token. The project may be unshared.",
      fetchNotFound: "Scratch project #{id} was not found or is not shared.",
      fetchStatus: "Could not fetch {what} (HTTP {status}).",
      fetchFailed: "Could not fetch {what}: {error}",
      fetchEmptyProject: "The Scratch project data was empty.",
      missingTargets: "missing targets",
      fetchAssetMissing: "Could not download SVG asset {name}.",
      assetMissing: "The SVG asset is missing from the input.",
      metaResource: "project information",
      projectResource: "project.json",
      assetResource: "SVG assets",
      remoteSource: "Scratch project #{id}",
      localSource: "local file",
      downloaded: "downloaded",
      // summary
      file: "file",
      projectJson: "project.json",
      svgCostumes: "SVG costumes",
      svgAssets: "SVG assets",
      markedAssets: "watermarked assets",
      unmarkedAssets: "unmarked assets",
      invalidPayloads: "invalid payloads",
      records: "watermark records",
      uniquePayloads: "unique payloads",
      referenced: "referenced",
      unreferenced: "unreferenced",
      // status
      statusOk: "Fully watermarked",
      statusPartial: "Partially watermarked",
      statusNone: "No watermark",
      statusInvalid: "Invalid watermark",
      statusMixed: "Mixed payloads",
      statusNoSvg: "No SVG costumes",
      statusReadError: "Read error",
      noteOk: "Every referenced SVG asset carries a readable SB3 Tools watermark.",
      notePartial: "Some SVG assets are unmarked or their watermark could not be decoded.",
      noteNone: "No SB3 Tools watermark was found in the referenced SVG assets.",
      noteInvalid: "A watermark entry exists, but its payload is not valid base64 JSON.",
      noteMixed: "The SVG assets contain more than one watermark payload. They may come from different compression runs.",
      noteNoSvg: "This project has no SVG costumes, so there is nothing for the compressor to watermark.",
      noteReadError: "The archive could not be scanned. Check that it is a valid .sb3 file.",
      // sections
      secRecord: "Watermark",
      secFlags: "Option flags",
      secAssets: "SVG assets",
      // details
      timestamp: "timestamp (UTC)",
      originalName: "original project name",
      toolVersion: "tool version",
      schema: "schema",
      kind: "compressor",
      kindProject: "project.json Compressor",
      kindFull: "SB3 Full Compressor",
      kindMedia: "SB3 Media Compressor",
      optionsHex: "option flags (hex)",
      mediaHex: "media flags (hex)",
      optionCount: "{on} of {total} enabled",
      mediaOptionCount: "{on} of {total} enabled",
      enabledOptions: "enabled options",
      enabledMediaOptions: "enabled media options",
      projectOptions: "project.json options",
      mediaOptions: "media options",
      asset: "asset",
      usedBy: "used by",
      mark: "mark",
      version: "version",
      on: "ON",
      off: "OFF",
      unknown: "—",
      none: "None",
      invalidRecord: "invalid payload",
      multipleRecords: "{n} watermark entries",
      recordMetaOne: "1 unique payload",
      recordMetaMany: "{n} unique payloads",
      recordAssetCount: "{n} asset(s)",
      assetsMeta: "{assets} assets · {costumes} costumes",
      noRecord: "No readable watermark.",
      noRecordHint: "Run the project through project.json Compressor or SB3 Full Compressor to add one.",
      invalidHint: "The watermark marker is present but the encoded payload could not be decoded. It may have been edited by another tool.",
      mixedHint: "Showing each distinct payload. A project normally has one payload shared by all SVG costumes.",
      warningInvalidCount: "{n} watermark entry/entries could not be decoded.",
      warningUnmarkedCount: "{n} SVG asset(s) have no watermark.",
      warningMultipleInAsset: "{file} contains {n} watermark entries.",
      // buttons
      copy: "Copy JSON report",
      copied: "Copied",
      copyFailed: "Copy failed",
      download: "Download JSON report",
      // footer
      analyzedAt: "analyzed at",
      source: "source"
    },
    ja: {
      ready: "準備完了",
      reading: "{name} を読み込んでいます…",
      scanning: "SVG コスチュームを調べています…",
      complete: "完了",
      failed: "失敗",
      invalidFile: ".sb3 を選んでください。",
      emptyFile: "ファイルが空です。Scratch プロジェクトを選んでください。",
      readFileError: "ファイルを読み込めませんでした: {error}",
      analyzeFailed: "透かしを読み取れませんでした: {error}",
      engineMissing: "透かしエンジンが読み込まれませんでした。ページを再読み込みしてください。",
      noProject: "アーカイブ内に project.json が見つかりません。",
      badProject: "project.json を解析できませんでした: {error}",
      // Scratch プロジェクトの取得
      fetchingMeta: "プロジェクト #{id} を照会しています…",
      fetchingProject: "project.json をダウンロードしています…",
      fetchingAssets: "SVG アセットをダウンロードしています（{done}/{total}）…",
      fetchInvalidId: "Scratch のプロジェクト ID（数字）またはプロジェクト URL を入力してください。",
      fetchNoToken: "Scratch からプロジェクトトークンが返りませんでした。非公開プロジェクトの可能性があります。",
      fetchNotFound: "Scratch プロジェクト #{id} が見つからないか、共有されていません。",
      fetchStatus: "{what} を取得できませんでした（HTTP {status}）。",
      fetchFailed: "{what} を取得できませんでした: {error}",
      fetchEmptyProject: "Scratch のプロジェクトデータが空です。",
      missingTargets: "targets がありません",
      fetchAssetMissing: "SVG アセット {name} をダウンロードできませんでした。",
      assetMissing: "入力に SVG アセットが見つかりません。",
      metaResource: "プロジェクト情報",
      projectResource: "project.json",
      assetResource: "SVG アセット",
      remoteSource: "Scratch プロジェクト #{id}",
      localSource: "ローカルファイル",
      downloaded: "取得量",
      file: "ファイル",
      projectJson: "project.json",
      svgCostumes: "SVG コスチューム",
      svgAssets: "SVG アセット",
      markedAssets: "透かしあり",
      unmarkedAssets: "透かしなし",
      invalidPayloads: "不正なペイロード",
      records: "透かしレコード",
      uniquePayloads: "異なるペイロード",
      referenced: "参照あり",
      unreferenced: "未参照",
      statusOk: "すべて透かし入り",
      statusPartial: "一部のみ透かし入り",
      statusNone: "透かしなし",
      statusInvalid: "透かしが不正",
      statusMixed: "ペイロードが混在",
      statusNoSvg: "SVG コスチュームなし",
      statusReadError: "読み込みエラー",
      noteOk: "参照されているすべての SVG アセットに、読み取り可能な SB3 Tools 透かしがあります。",
      notePartial: "一部の SVG アセットに透かしがないか、透かしを復号できませんでした。",
      noteNone: "参照されている SVG アセットに SB3 Tools 透かしは見つかりませんでした。",
      noteInvalid: "透かし要素はありますが、ペイロードが正しい base64 JSON ではありません。",
      noteMixed: "SVG アセットに複数の透かしペイロードがあります。別々の圧縮で作られた可能性があります。",
      noteNoSvg: "このプロジェクトには SVG コスチュームがないため、圧縮ツールが透かしを入れる対象がありません。",
      noteReadError: "アーカイブを調べられませんでした。有効な .sb3 か確認してください。",
      secRecord: "透かし",
      secFlags: "オプションフラグ",
      secAssets: "SVG アセット",
      timestamp: "日時（UTC）",
      originalName: "圧縮前のプロジェクト名",
      toolVersion: "ツールのバージョン",
      schema: "スキーマ",
      kind: "圧縮ツール",
      kindProject: "project.json Compressor",
      kindFull: "SB3 Full Compressor",
      kindMedia: "SB3 Media Compressor",
      optionsHex: "オプションフラグ（16進）",
      mediaHex: "メディアフラグ（16進）",
      optionCount: "{total} 個中 {on} 個が有効",
      mediaOptionCount: "{total} 個中 {on} 個が有効",
      enabledOptions: "有効なオプション",
      enabledMediaOptions: "有効なメディアオプション",
      projectOptions: "project.json オプション",
      mediaOptions: "メディアオプション",
      asset: "アセット",
      usedBy: "使用先",
      mark: "透かし",
      version: "バージョン",
      on: "ON",
      off: "OFF",
      unknown: "—",
      none: "なし",
      invalidRecord: "不正なペイロード",
      multipleRecords: "透かし {n} 件",
      recordMetaOne: "異なるペイロード 1 件",
      recordMetaMany: "異なるペイロード {n} 件",
      recordAssetCount: "{n} アセット",
      assetsMeta: "アセット {assets} 件 · コスチューム {costumes} 件",
      noRecord: "読み取り可能な透かしがありません。",
      noRecordHint: "project.json Compressor または SB3 Full Compressor で圧縮すると追加されます。",
      invalidHint: "透かしの目印はありますが、ペイロードを復号できませんでした。別のツールで編集された可能性があります。",
      mixedHint: "異なるペイロードをそれぞれ表示しています。通常、1つのプロジェクトの SVG は同じペイロードを共有します。",
      warningInvalidCount: "{n} 件の透かしを復号できませんでした。",
      warningUnmarkedCount: "{n} 件の SVG アセットに透かしがありません。",
      warningMultipleInAsset: "{file} に透かしが {n} 件あります。",
      copy: "JSON レポートをコピー",
      copied: "コピーしました",
      copyFailed: "コピーできませんでした",
      download: "JSON レポートをダウンロード",
      analyzedAt: "解析日時",
      source: "入力"
    }
  };

  var L = STRINGS[LANG];
  var PROJECT_LABELS = {
    stripDefaults: "Strip default fields",
    shortenIds: "Shorten IDs",
    renameStores: "Rename stores",
    removeUnused: "Remove unused code",
    removeMonitors: "Remove monitors",
    compressProcs: "Compress custom blocks",
    freqIds: "Frequent IDs",
    dropObscuredShadows: "Drop obscured shadows",
    removeUnreachable: "Remove unreachable code",
    clearInitialValues: "Clear initial values",
    extractDuplicates: "Extract duplicates",
    nearDuplicates: "Merge near-duplicates",
    simplifyIfElse: "Simplify if/else",
    removeNoops: "Remove no-ops",
    inlineSingleCall: "Inline single calls",
    foldConstants: "Fold constants",
    loopDuplicates: "Loop duplicates",
    propagateConstants: "Propagate constants",
    reuseReporters: "Reuse reporters",
    stripComments: "Strip comments",
    compactWorkspace: "Compact workspace",
    removeDeadAssets: "Remove dead assets",
    removeWriteOnly: "Remove write-only variables",
    normalizeTypes: "Normalize types",
    stripNullFieldIds: "Strip null field IDs",
    zeroTopLevelCoords: "Zero top-level coordinates",
    compactMenuShadows: "Compact tested menu shadows"
  };
  var MEDIA_LABELS = {
    pngOptimize: "OxiPNG after palette",
    pngPalette: "PNG palette compression",
    pngLossless: "PNG lossless (OxiPNG)",
    svgToPng: "SVG to PNG",
    minPx: "Minimum pixels",
    wavToMp3: "WAV to MP3",
    reencodeMp3: "Re-encode MP3"
  };
  var PROJECT_LABELS_JA = {
    stripDefaults: "Scratch が復元する値を削除",
    shortenIds: "内部 ID を短縮",
    renameStores: "変数・リスト名を短縮",
    removeUnused: "未使用の変数・リストを削除",
    removeMonitors: "モニターと位置を保持しない",
    compressProcs: "カスタムブロックを圧縮",
    freqIds: "頻出ブロックの ID を短縮",
    dropObscuredShadows: "隠れた入力の既定値を削除",
    removeUnreachable: "到達しないコードを削除",
    clearInitialValues: "上書きされる初期値を削除",
    extractDuplicates: "繰り返すコードを抽出",
    nearDuplicates: "似たコードを統合",
    simplifyIfElse: "空の if-else を if に",
    removeNoops: "何もしないブロックを削除",
    inlineSingleCall: "1回だけの定義を展開",
    foldConstants: "定数式を計算",
    loopDuplicates: "繰り返しをループ化",
    propagateConstants: "定数変数を値に置換",
    reuseReporters: "同じレポーター値を再利用",
    stripComments: "コメントを削除",
    compactWorkspace: "ワークスペースを再配置",
    removeDeadAssets: "未使用アセットを削除",
    removeWriteOnly: "書き込みだけの変数を削除",
    normalizeTypes: "型と表現を正規化",
    stripNullFieldIds: "null のフィールド ID を削除",
    zeroTopLevelCoords: "トップレベル座標を 0 に",
    compactMenuShadows: "確認済みメニューシャドウを圧縮"
  };
  var MEDIA_LABELS_JA = {
    pngOptimize: "パレット後の OxiPNG",
    pngPalette: "PNG パレット圧縮",
    pngLossless: "PNG 無劣化（OxiPNG）",
    svgToPng: "SVG を PNG に変換",
    minPx: "最小 1px に拡大",
    wavToMp3: "WAV を MP3 に変換",
    reencodeMp3: "MP3 を再エンコード"
  };

  var $ = function (id) { return document.getElementById(id); };
  var state = { report: null, objectUrl: null };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmt(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (_, key) {
      return values && Object.prototype.hasOwnProperty.call(values, key) ? values[key] : "";
    });
  }
  function humanSize(n) {
    var units = ["B", "KB", "MB", "GB"];
    for (var i = 0; i < units.length; i++) {
      if (Math.abs(n) < 1024 || i === units.length - 1) {
        return (i === 0 ? Math.round(n) : n.toFixed(1)) + " " + units[i];
      }
      n /= 1024;
    }
    return Math.round(n) + " B";
  }
  function fileName(path) {
    return String(path || "").split(/[\\/]/).pop() || "";
  }
  function entryStem(name) {
    return fileName(name).replace(/\.[^.]+$/, "");
  }
  function baseName(path) {
    return String(path || "project.sb3").split(/[\\/]/).pop() || "project.sb3";
  }
  function utcText(value) {
    var date = new Date(value);
    if (!value || isNaN(date.getTime())) return String(value || L.unknown);
    return date.toISOString().replace(".000Z", "Z");
  }
  function countFlags(flags) {
    return flags.filter(function (flag) { return flag.enabled; }).length;
  }
  function payloadKey(payload) {
    return payload ? JSON.stringify(payload) : "";
  }
  function setStatus(text, note, kind) {
    $("statusValue").textContent = text;
    $("statusNote").textContent = note;
    var tag = $("statusTag");
    if (kind) {
      tag.hidden = false;
      tag.textContent = kind;
    } else {
      tag.hidden = true;
    }
  }
  function setPhase(text) {
    $("phaseLabel").textContent = text;
  }

  function findEntry(entries, name) {
    var wanted = String(name || "").toLowerCase();
    if (!wanted) return null;
    for (var i = 0; i < entries.length; i++) {
      if (String(entries[i].name || "").toLowerCase() === wanted) return entries[i];
    }
    var base = wanted.split("/").pop();
    for (var j = 0; j < entries.length; j++) {
      if (String(entries[j].name || "").toLowerCase().split("/").pop() === base) return entries[j];
    }
    return null;
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

  function decodeRecord(record) {
    var payload = record.payload;
    if (!payload) {
      return {
        schema: record.schema,
        payload: null,
        flags: [],
        mediaFlags: [],
        valid: false
      };
    }
    var flags = record.flags && record.flags.length
      ? record.flags
      : WM.decodeFlags(payload.o, WM.PROJECT_OPTION_KEYS);
    var mediaFlags = record.mediaFlags && record.mediaFlags.length
      ? record.mediaFlags
      : ((payload.k === "full" || payload.k === "media")
        ? WM.decodeFlags(payload.m, WM.MEDIA_OPTION_KEYS)
        : []);
    return {
      schema: record.schema,
      payload: payload,
      flags: flags,
      mediaFlags: mediaFlags,
      valid: payload.s === WM.SCHEMA && typeof payload.t === "string" &&
        typeof payload.n === "string" && typeof payload.v === "string" &&
        typeof payload.o === "string"
    };
  }

  // Run an async worker over an array with a bounded number in flight.
  function eachLimit(items, limit, worker) {
    var next = 0;
    var runners = [];
    var count = Math.min(limit, items.length);
    for (var i = 0; i < count; i++) {
      runners.push((async function () {
        while (true) {
          var index = next++;
          if (index >= items.length) return;
          await worker(items[index], index);
        }
      })());
    }
    return Promise.all(runners);
  }

  function scanProject(project, entries, readEntry) {
    var assetData = new Map();
    var byName = new Map();
    entries.forEach(function (entry) { byName.set(entry.name.toLowerCase(), entry); });
    function find(name) {
      var wanted = String(name || "").toLowerCase();
      if (!wanted) return null;
      var hit = byName.get(wanted);
      if (hit) return hit;
      var base = wanted.split("/").pop();
      for (var i = 0; i < entries.length; i++) {
        if (fileName(entries[i].name).toLowerCase() === base) return entries[i];
      }
      return null;
    }

    var rows = new Map();
    var rowsOrder = [];
    function rowFor(entry, referenced) {
      var key = entry ? entry.name : "";
      if (!rows.has(key)) {
        var row = {
          file: entry ? entry.name : "",
          assetId: entry ? entryStem(entry.name) : "",
          referenced: false,
          costumes: [],
          records: [],
          error: "",
          entry: entry
        };
        rows.set(key, row);
        rowsOrder.push(row);
      }
      var row = rows.get(key);
      if (referenced) row.referenced = true;
      return row;
    }

    var costumeCount = 0;
    var targets = Array.isArray(project.targets) ? project.targets : [];
    targets.forEach(function (target) {
      if (!target || !Array.isArray(target.costumes)) return;
      target.costumes.forEach(function (costume) {
        if (!costume || String(costume.dataFormat || "").toLowerCase() !== "svg") return;
        costumeCount += 1;
        var expected = entryNameForCostume(costume);
        var entry = find(expected);
        var row = entry ? rowFor(entry, true) : rowFor({ name: expected, missing: true }, true);
        row.assetId = String(costume.assetId || row.assetId || "");
        if (row.costumes.indexOf(String(costume.name || "")) < 0) {
          row.costumes.push(String(costume.name || ""));
        }
      });
    });

    // Also show SVG entries that no costume references, so a stray marked
    // asset is not silently ignored.
    entries.forEach(function (entry) {
      if (!rows.has(entry.name)) rowFor(entry, false);
    });

    var scan = {
      entries: entries,
      rows: rowsOrder,
      svgCostumes: costumeCount,
      assetBytes: 0,
      load: function (onDone) {
        eachLimit(rowsOrder, ASSET_CONCURRENCY, function (row) {
          if (!row.entry) return Promise.resolve();
          if (row.entry.missing) {
            row.error = L.assetMissing;
            return Promise.resolve();
          }
          return Promise.resolve().then(function () {
            return readEntry(row.entry);
          }).then(function (bytes) {
            if (!bytes) throw new Error(L.assetMissing);
            assetData.set(row.file, bytes);
            scan.assetBytes += bytes.byteLength;
          }).catch(function (error) {
            row.error = String(error && error.message || error);
          });
        }).then(function () {
          rowsOrder.forEach(function (row) {
            if (row.error || !assetData.has(row.file)) return;
            var bytes = assetData.get(row.file);
            var text;
            try {
              text = new TextDecoder("utf-8").decode(bytes);
            } catch (error) {
              row.error = String(error && error.message || error);
              return;
            }
            var parsed = WM.parseSvg(text);
            row.records = parsed.map(decodeRecord);
          });
          onDone();
        });
      }
    };
    return scan;
  }

  function flagSummary(record) {
    if (record.payload.k === "media") {
      return fmt(L.mediaOptionCount, {
        on: countFlags(record.mediaFlags), total: record.mediaFlags.length
      });
    }
    var project = fmt(L.optionCount, {
      on: countFlags(record.flags), total: record.flags.length
    });
    if (record.payload.k === "full") {
      return project + " · " + fmt(L.mediaOptionCount, {
        on: countFlags(record.mediaFlags), total: record.mediaFlags.length
      });
    }
    return project;
  }

  function render(report) {
    state.report = report;
    $("report").hidden = false;
    var rows = report.rows;
    var records = [];
    rows.forEach(function (row) {
      row.records.forEach(function (record) {
        records.push(Object.assign({ file: row.file, costumes: row.costumes.slice() }, record));
      });
    });
    var validRecords = records.filter(function (record) { return record.valid; });
    var invalidRecords = records.filter(function (record) { return !record.valid; });
    var unique = [];
    var uniqueKeys = new Set();
    validRecords.forEach(function (record) {
      var key = payloadKey(record.payload);
      if (!uniqueKeys.has(key)) {
        uniqueKeys.add(key);
        unique.push(record);
      }
    });
    var markedAssets = rows.filter(function (row) { return row.records.length > 0; }).length;
    var unmarkedAssets = rows.filter(function (row) { return row.records.length === 0; }).length;
    var invalidAssets = rows.filter(function (row) {
      return row.invalidCount || row.error ||
        (row.records.length > 0 && row.records.every(function (r) { return !r.valid; }));
    }).length;
    var referencedRows = rows.filter(function (row) { return row.referenced; });

    var summary = [
      [L.source, report.source
        ? (report.source.type === "scratch"
          ? fmt(L.remoteSource, { id: report.source.id })
          : L.localSource)
        : L.localSource],
      [L.svgCostumes, report.svgCostumes],
      [L.svgAssets, rows.length],
      [L.markedAssets, markedAssets],
      [L.unmarkedAssets, unmarkedAssets],
      [L.records, records.length],
      [L.invalidPayloads, invalidRecords.length],
      [L.uniquePayloads, unique.length],
      [L.projectJson, report.projectJsonSize == null ? L.unknown : humanSize(report.projectJsonSize)]
    ];
    $("summaryGrid").innerHTML = summary.map(function (pair) {
      return '<div class="summary-row"><span>' + esc(pair[0]) + '</span><span>' +
        esc(pair[1]) + '</span></div>';
    }).join("");

    $("costumeValue").textContent = report.svgCostumes;
    $("assetValue").textContent = rows.length;
    $("recordValue").textContent = records.length;
    $("markedValue").textContent = markedAssets;
    $("unmarkedValue").textContent = unmarkedAssets;
    $("invalidValue").textContent = invalidRecords.length;
    $("uniqueValue").textContent = unique.length;

    var status;
    var note;
    var tag;
    if (!rows.length || !report.svgCostumes) {
      status = L.statusNoSvg;
      note = L.noteNoSvg;
      tag = "NO SVG";
    } else if (!records.length) {
      if (invalidAssets) {
        status = L.statusInvalid;
        note = L.noteReadError;
        tag = "ERROR";
      } else {
        status = L.statusNone;
        note = L.noteNone;
        tag = "NONE";
      }
    } else if (invalidRecords.length && !validRecords.length) {
      status = L.statusInvalid;
      note = L.noteInvalid;
      tag = "ERROR";
    } else if (unique.length > 1) {
      status = L.statusMixed;
      note = L.noteMixed;
      tag = "MIXED";
    } else if (unmarkedAssets || invalidRecords.length) {
      status = L.statusPartial;
      note = invalidRecords.length ? L.noteInvalid : L.notePartial;
      tag = "PARTIAL";
    } else {
      status = L.statusOk;
      note = L.noteOk;
      tag = "OK";
    }
    setStatus(status, note, tag);

    // Watermark detail cards, one per distinct payload.
    var recordSection = $("recordSection");
    var recordBox = $("recordBox");
    if (!records.length) {
      recordSection.hidden = false;
      $("recordMeta").textContent = L.noRecord;
      recordBox.innerHTML = '<p class="wm-note">' + esc(L.noRecord) + '</p>' +
        '<p class="wm-note">' + esc(L.noRecordHint) + '</p>';
    } else {
      recordSection.hidden = false;
      $("recordMeta").textContent = unique.length === 1
        ? L.recordMetaOne
        : fmt(L.recordMetaMany, { n: unique.length });
      var cards = unique.map(function (record, index) {
        var payload = record.payload;
        var flags = record.flags;
        var mediaFlags = record.mediaFlags;
        var card = '<div class="wm-record">';
        card += '<div class="wm-record-head"><strong>' +
          esc(LANG === "ja" ? "ペイロード " + (index + 1) : "Payload " + (index + 1)) +
          '</strong><span>' + esc(record.file) + '</span></div>';
        card += '<div class="wm-meta">';
        card += kv(L.timestamp, utcText(payload.t), true);
        card += kv(L.originalName, payload.n, true);
        card += kv(L.toolVersion, payload.v);
        card += kv(L.schema, payload.s);
        var kind = payload.k === "full" ? L.kindFull
          : payload.k === "media" ? L.kindMedia : L.kindProject;
        card += kv(L.kind, kind);
        if (payload.k === "media") {
          card += kv(L.enabledMediaOptions, fmt(L.mediaOptionCount, {
            on: countFlags(mediaFlags), total: mediaFlags.length
          }));
        } else {
          card += kv(L.enabledOptions, fmt(L.optionCount, {
            on: countFlags(flags), total: flags.length
          }));
        }
        card += '</div>';
        if (payload.k !== "media") {
          card += '<div class="wm-hex"><span>' + esc(L.optionsHex) + '</span> ' +
            esc(payload.o || L.none) + '</div>';
        }
        if (payload.k === "full" || payload.k === "media") {
          card += '<div class="wm-hex"><span>' + esc(L.mediaHex) + '</span> ' +
            esc(payload.m || L.none) + '</div>';
        }
        if (record.costumes.length) {
          card += '<p class="wm-note">' + esc(L.usedBy) + ': ' +
            esc(record.costumes.join(", ")) + '</p>';
        }
        card += '</div>';
        return card;
      });
      var warnings = [];
      if (invalidRecords.length) {
        warnings.push(fmt(L.warningInvalidCount, { n: invalidRecords.length }));
      }
      if (unmarkedAssets) {
        warnings.push(fmt(L.warningUnmarkedCount, { n: unmarkedAssets }));
      }
      rows.forEach(function (row) {
        if (row.records.length > 1) {
          warnings.push(fmt(L.warningMultipleInAsset, { file: row.file, n: row.records.length }));
        }
      });
      if (unique.length > 1) warnings.push(L.mixedHint);
      if (invalidRecords.length) warnings.push(L.invalidHint);
      recordBox.innerHTML = cards.join("") +
        warnings.map(function (warning) {
          return '<p class="wm-warn">' + esc(warning) + '</p>';
        }).join("");
    }

    // Flags for every distinct payload.
    var flagsSection = $("flagsSection");
    var flagGrid = $("flagGrid");
    if (!unique.length) {
      flagsSection.hidden = true;
    } else {
      flagsSection.hidden = false;
      $("flagsMeta").textContent = unique.length === 1
        ? flagSummary(unique[0])
        : L.recordMetaMany.replace("{n}", unique.length);
      flagGrid.innerHTML = unique.map(function (record) {
        var block = '<div class="wm-record">';
        if (record.payload.k !== "media") {
          block += '<div class="wm-record-head"><strong>' +
            esc(L.projectOptions) + '</strong><span>' + esc(utcText(record.payload.t)) +
            '</span></div><div class="flag-grid">';
          block += record.flags.map(function (flag, i) {
            return flagRow(flag, i);
          }).join("");
          block += '</div>';
        }
        if ((record.payload.k === "full" || record.payload.k === "media") &&
            record.mediaFlags.length) {
          block += '<div class="wm-record-head"' +
            (record.payload.k === "media"
              ? ''
              : ' style="border-top:1px solid var(--rule-light);border-bottom:0"') +
            '><strong>' + esc(L.mediaOptions) + '</strong><span>' +
            esc(fmt(L.mediaOptionCount, {
              on: countFlags(record.mediaFlags), total: record.mediaFlags.length
            })) + '</span></div><div class="flag-grid">';
          block += record.mediaFlags.map(function (flag, i) {
            return flagRow(flag, i, true);
          }).join("");
          block += '</div>';
        }
        block += '</div>';
        return block;
      }).join("");
    }

    // Asset table.
    var assetSection = $("assetsSection");
    if (!rows.length) {
      assetSection.hidden = true;
    } else {
      assetSection.hidden = false;
      $("assetsMeta").textContent = fmt(L.assetsMeta, {
        assets: rows.length, costumes: report.svgCostumes
      });
      var sorted = rows.slice().sort(function (a, b) {
        if (a.referenced !== b.referenced) return a.referenced ? -1 : 1;
        return a.file.localeCompare(b.file);
      });
      $("assetsTbody").innerHTML = sorted.map(function (row) {
        var first = row.records[0] || null;
        var firstPayload = first && first.payload;
        var statusBadge;
        if (row.error) statusBadge = '<span class="wm-badge invalid">' + esc(L.invalidRecord) + '</span>';
        else if (!row.records.length) statusBadge = '<span class="wm-badge missing">' + esc(L.statusNone) + '</span>';
        else if (row.records.some(function (r) { return !r.valid; })) {
          statusBadge = '<span class="wm-badge invalid">' + esc(L.invalidRecord) + '</span>';
        } else statusBadge = '<span class="wm-badge ok">' + esc(L.on) + '</span>';
        var used = row.costumes.length ? row.costumes.join(", ") : L.unreferenced;
        var nameCell = '<td class="name">' + esc(entryStem(row.file)) +
          '<span class="sub">' + esc(row.file) + '</span></td>';
        var usedCell = '<td>' + esc(used) + (row.records.length > 1
          ? '<span class="sub">' + esc(fmt(L.multipleRecords, { n: row.records.length })) + '</span>'
          : '') + '</td>';
        return '<tr>' + nameCell + usedCell + '<td>' + statusBadge + '</td>' +
          '<td class="num">' + esc(firstPayload ? utcText(firstPayload.t) : L.unknown) + '</td>' +
          '<td class="name">' + esc(firstPayload ? firstPayload.n : L.unknown) + '</td>' +
          '<td class="num">' + esc(firstPayload ? firstPayload.v : L.unknown) + '</td></tr>';
      }).join("");
    }

    var fileLabel = $("fileLabel");
    if (fileLabel) {
      fileLabel.textContent = report.source && report.source.type === "scratch"
        ? L.downloaded : L.file;
    }
    $("fileValue").textContent = humanSize(report.fileSize);
    $("copyBtn").disabled = false;
    $("downloadReport").hidden = false;
    setPhase(L.complete);
  }

  function kv(key, value, wide) {
    return '<div class="wm-kv"><span class="k">' + esc(key) + '</span><span class="v' +
      (wide ? ' is-wide' : '') + '">' + esc(value == null || value === "" ? L.unknown : value) +
      '</span></div>';
  }

  function flagRow(flag, index, media) {
    var labels = media
      ? (LANG === "ja" ? MEDIA_LABELS_JA : MEDIA_LABELS)
      : (LANG === "ja" ? PROJECT_LABELS_JA : PROJECT_LABELS);
    var label = labels[flag.key] || flag.key;
    return '<div class="flag-row' + (flag.enabled ? '' : ' is-off') + '">' +
      '<span class="flag-name"><span class="flag-bit">' + esc(media ? "M" : "P") + index +
      ' </span>' + esc(label) + '</span><span class="flag-state"><span class="wm-badge ' +
      (flag.enabled ? 'ok' : 'plain') + '">' + esc(flag.enabled ? L.on : L.off) +
      '</span></span></div>';
  }

  async function analyze(file) {
    setPhase(fmt(L.reading, { name: file.name }));
    var buffer = await file.arrayBuffer();
    if (!buffer.byteLength) throw new Error(L.emptyFile);
    var zip = await JSZip.loadAsync(buffer);
    var projectName = Object.keys(zip.files).find(function (name) {
      return /(^|\/)project\.json$/i.test(name) && !zip.files[name].dir;
    });
    if (!projectName) throw new Error(L.noProject);
    var projectText = await zip.file(projectName).async("text");
    var project;
    try {
      project = JSON.parse(projectText);
    } catch (error) {
      throw new Error(fmt(L.badProject, { error: error.message || error }));
    }
    setPhase(L.scanning);
    var entries = [];
    Object.keys(zip.files).forEach(function (name) {
      var entry = zip.files[name];
      if (entry.dir || /(^|\/)project\.json$/i.test(name)) return;
      if (/\.svg$/i.test(name)) entries.push({ name: name, zipEntry: entry });
    });
    var scan = scanProject(project, entries, function (entry) {
      return entry.zipEntry.async("uint8array");
    });
    await new Promise(function (resolve) { scan.load(resolve); });
    render({
      file: file.name,
      fileSize: buffer.byteLength,
      projectJsonSize: new TextEncoder().encode(projectText).length,
      svgCostumes: scan.svgCostumes,
      rows: scan.rows,
      source: { type: "file", name: file.name }
    });
  }

  // ------------------------------------------------- Scratch project fetch

  var SCRATCH_META = [
    "https://trampoline.turbowarp.org/api/projects/",
    "https://trampoline.turbowarp.xyz/api/projects/"
  ];
  var SCRATCH_PROJECT = "https://projects.scratch.mit.edu/";
  var SCRATCH_ASSET = "https://assets.scratch.mit.edu/internalapi/asset/";
  var FETCH_TIMEOUT = 20000;
  var ASSET_CONCURRENCY = 6;

  function parseProjectId(value) {
    var text = String(value || "").trim();
    if (/^\d{1,20}$/.test(text)) return text;
    var match = text.match(/(?:scratch\.mit\.edu|turbowarp\.org)\/(?:projects\/)?(\d{1,20})/i);
    return match ? match[1] : "";
  }

  function request(url, what, responseType) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT) : null;
    var options = { cache: "no-store" };
    if (controller) options.signal = controller.signal;
    return fetch(url, options).then(function (response) {
      if (timer) clearTimeout(timer);
      if (!response.ok) {
        var statusError = new Error(fmt(L.fetchStatus, {
          what: what, status: response.status
        }));
        statusError.status = response.status;
        throw statusError;
      }
      return responseType === "text" ? response.text() : response.arrayBuffer();
    }, function (error) {
      if (timer) clearTimeout(timer);
      throw new Error(fmt(L.fetchFailed, {
        what: what, error: String(error && error.message || error)
      }));
    });
  }

  async function fetchScratchMeta(id) {
    var lastError = null;
    for (var i = 0; i < SCRATCH_META.length; i++) {
      try {
        return JSON.parse(await request(
          SCRATCH_META[i] + encodeURIComponent(id), L.metaResource, "text"
        ));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(fmt(L.fetchNotFound, { id: id }));
  }

  function remoteEntries(project) {
    var found = new Map();
    var targets = Array.isArray(project.targets) ? project.targets : [];
    targets.forEach(function (target) {
      if (!target || !Array.isArray(target.costumes)) return;
      target.costumes.forEach(function (costume) {
        if (!costume || String(costume.dataFormat || "").toLowerCase() !== "svg") return;
        var name = entryNameForCostume(costume);
        if (name && !found.has(name.toLowerCase())) {
          found.set(name.toLowerCase(), { name: name, remote: true });
        }
      });
    });
    return Array.from(found.values());
  }

  async function analyzeProjectId(value) {
    var id = parseProjectId(value);
    if (!id) throw new Error(L.fetchInvalidId);
    setPhase(fmt(L.fetchingMeta, { id: id }));
    var meta;
    try {
      meta = await fetchScratchMeta(id);
    } catch (error) {
      if (error && error.status === 404) {
        throw new Error(fmt(L.fetchNotFound, { id: id }));
      }
      throw error;
    }
    if (!meta || !meta.project_token) {
      if (meta && (meta.id || meta.title)) throw new Error(fmt(L.fetchNoToken, { id: id }));
      throw new Error(fmt(L.fetchNotFound, { id: id }));
    }
    $("fileName").textContent = String(meta.title || fmt(L.remoteSource, { id: id }));
    $("fileSize").textContent = "#" + id;

    setPhase(fmt(L.fetchingProject, { id: id }));
    var projectText = await request(
      SCRATCH_PROJECT + encodeURIComponent(id) + "?token=" + encodeURIComponent(meta.project_token),
      L.projectResource,
      "text"
    );
    if (!projectText) throw new Error(L.fetchEmptyProject);
    var project;
    try {
      project = JSON.parse(projectText);
    } catch (error) {
      throw new Error(fmt(L.badProject, { error: error.message || error }));
    }
    if (!project || !Array.isArray(project.targets)) {
      throw new Error(fmt(L.badProject, { error: L.missingTargets }));
    }

    var entries = remoteEntries(project);
    var done = 0;
    setPhase(fmt(L.fetchingAssets, { done: 0, total: entries.length }));
    var scan = scanProject(project, entries, async function (entry) {
      var buffer = await request(
        SCRATCH_ASSET + encodeURIComponent(entry.name) + "/get/",
        L.assetResource
      );
      done += 1;
      setPhase(fmt(L.fetchingAssets, { done: done, total: entries.length }));
      return new Uint8Array(buffer);
    });
    await new Promise(function (resolve) { scan.load(resolve); });
    var failed = scan.rows.filter(function (row) { return row.error; });
    if (failed.length) {
      throw new Error(failed[0].error || fmt(L.fetchAssetMissing, {
        name: failed[0].file || L.unknown
      }));
    }
    var projectJsonSize = new TextEncoder().encode(projectText).length;
    render({
      file: "scratch-" + id + ".sb3",
      fileSize: projectJsonSize + scan.assetBytes,
      projectJsonSize: projectJsonSize,
      svgCostumes: scan.svgCostumes,
      rows: scan.rows,
      source: {
        type: "scratch",
        id: Number(id),
        title: String(meta.title || ""),
        url: "https://scratch.mit.edu/projects/" + id + "/"
      }
    });
  }

  function buildJsonReport() {
    var report = state.report;
    if (!report) return null;
    return {
      tool: "SB3 Watermark Checker",
      schema: WM.SCHEMA,
      analyzedAt: new Date().toISOString(),
      file: report.file,
      source: report.source || null,
      summary: {
        svgCostumes: report.svgCostumes,
        svgAssets: report.rows.length,
        markedAssets: report.rows.filter(function (row) { return row.records.length > 0; }).length,
        unmarkedAssets: report.rows.filter(function (row) { return row.records.length === 0; }).length,
        records: report.rows.reduce(function (sum, row) { return sum + row.records.length; }, 0),
        uniquePayloads: Array.from(new Set(report.rows.reduce(function (all, row) {
          return all.concat(row.records.filter(function (r) { return r.valid; }).map(function (r) {
            return payloadKey(r.payload);
          }));
        }, []))).length
      },
      assets: report.rows.map(function (row) {
        return {
          file: row.file,
          referenced: row.referenced,
          costumes: row.costumes,
          error: row.error || undefined,
          records: row.records.map(function (record) {
            return {
              valid: record.valid,
              schema: record.schema,
              payload: record.payload,
              flags: record.flags,
              mediaFlags: record.mediaFlags
            };
          })
        };
      })
    };
  }

  function fetchProjectId(value) {
    if ($("fetchBtn").disabled) return;
    var id = parseProjectId(value);
    if (!id) {
      $("report").hidden = true;
      $("copyBtn").disabled = true;
      $("downloadReport").hidden = true;
      showError(L.fetchInvalidId);
      return;
    }
    setFile(null);
    $("fileName").textContent = fmt(L.remoteSource, { id: id });
    $("fileSize").textContent = "";
    $("fileRow").hidden = false;
    $("fetchBtn").disabled = true;
    setPhase(fmt(L.fetchingMeta, { id: id }));
    analyzeProjectId(value).then(function () {
      $("fetchBtn").disabled = false;
    }).catch(function (error) {
      $("report").hidden = true;
      $("copyBtn").disabled = true;
      $("downloadReport").hidden = true;
      setStatus(L.statusReadError, String(error && error.message || error), "ERROR");
      setPhase(L.failed);
      $("fetchBtn").disabled = false;
    });
  }

  function setFile(file) {
    if (!file) {
      $("fileRow").hidden = true;
      $("fileName").textContent = "project.sb3";
      $("fileSize").textContent = "—";
      if ($("fileLabel")) $("fileLabel").textContent = L.file;
      $("fileValue").textContent = "—";
      $("report").hidden = true;
      $("statusValue").textContent = "—";
      $("statusNote").textContent = L.ready;
      $("statusTag").hidden = true;
      $("phaseLabel").textContent = L.ready;
      $("copyBtn").disabled = true;
      $("downloadReport").hidden = true;
      state.report = null;
      return;
    }
    if (!/\.sb3$/i.test(file.name)) {
      showError(L.invalidFile);
      return;
    }
    $("fileName").textContent = file.name;
    $("fileSize").textContent = humanSize(file.size);
    if ($("fileLabel")) $("fileLabel").textContent = L.file;
    $("fileValue").textContent = humanSize(file.size);
    $("fileRow").hidden = false;
    $("report").hidden = true;
    $("copyBtn").disabled = true;
    $("downloadReport").hidden = true;
    $("statusValue").textContent = "—";
    $("statusNote").textContent = L.ready;
    $("statusTag").hidden = true;
    analyze(file).catch(function (error) {
      $("report").hidden = true;
      setStatus(L.statusReadError, String(error && error.message || error), "ERROR");
      setPhase(L.failed);
      $("copyBtn").disabled = true;
      $("downloadReport").hidden = true;
    });
  }

  function showError(message) {
    setStatus(L.statusReadError, message, "ERROR");
    setPhase(L.failed);
  }

  // ------------------------------------------------------------- events

  var dropzone = $("dropzone");
  var input = $("fileInput");
  dropzone.addEventListener("click", function () { input.click(); });
  dropzone.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", function () {
    setFile(input.files && input.files[0]);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      dropzone.classList.add("is-drag");
    });
  });
  ["dragleave", "drop"].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      dropzone.classList.remove("is-drag");
    });
  });
  dropzone.addEventListener("drop", function (event) {
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    setFile(file);
  });
  $("clearBtn").addEventListener("click", function () { setFile(null); input.value = ""; });

  var idForm = $("idForm");
  if (idForm) {
    idForm.addEventListener("submit", function (event) {
      event.preventDefault();
      fetchProjectId($("projectId").value);
    });
  }

  $("copyBtn").addEventListener("click", function () {
    var report = buildJsonReport();
    if (!report) return;
    var text = JSON.stringify(report, null, 2);
    var done = function () {
      $("copyBtn").textContent = L.copied;
      setTimeout(function () { $("copyBtn").textContent = L.copy; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  });
  function fallbackCopy(text, done) {
    var area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); done(); }
    catch (_) { $("copyBtn").textContent = L.copyFailed; }
    area.remove();
  }

  $("downloadReport").addEventListener("click", function (event) {
    var report = buildJsonReport();
    if (!report) { event.preventDefault(); return; }
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json"
    }));
    this.href = state.objectUrl;
    this.download = baseName(state.report.file).replace(/\.sb3$/i, "") + "_watermark.json";
  });

  // Theme switch.
  var themeButtons = document.querySelectorAll("[data-theme-set]");
  themeButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      var theme = button.getAttribute("data-theme-set") === "dark" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", theme);
      try { localStorage.setItem("sb3-watermark-theme-v1", theme); } catch (_) {}
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", theme === "dark" ? "#15180f" : "#e7e8e1");
    });
  });

  if (!WM) {
    showError(L.engineMissing);
    return;
  }
  $("engineVersion").textContent = "v" + WM.VERSION;
  setPhase(L.ready);
})();
