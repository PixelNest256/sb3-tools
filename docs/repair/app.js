/* SB3 Repair — page controller. */
(function () {
  "use strict";

  var LANG = /^ja\b/i.test(document.documentElement.lang || "") ? "ja" : "en";
  var BASE = (function () {
    var src = document.currentScript && document.currentScript.src;
    if (src) return src.replace(/[^/]*$/, "");
    return /\/ja\//.test(location.pathname) ? "../" : "./";
  })();

  var STR = {
    en: {
      phases: { load: "Reading the file", json: "Parsing project.json", structure: "Repairing targets and stores", blocks: "Repairing block links", assets: "Checking media", monitors: "Repairing monitors", validate: "Validating the result", package: "Repacking the .sb3", done: "Done" },
      ready: "Ready", choose: "Choose a project to check it.",
      checking: "Checking {name}…", repairing: "Repairing {name}…", reading: "Reading {name}…",
      invalidFile: "Choose an .sb3 file or a project.json file.", emptyFile: "That file is empty.",
      readError: "Could not read that file: {error}", inspectFailed: "The check failed: {error}",
      repairFailed: "The repair failed: {error}", workerFailed: "The background worker stopped. Retrying in this tab.",
      mainThread: "Running in this tab. Keep the tab open.",
      checked: "Checked {name}.", repaired: "Repaired {name}.",
      status: { valid: "Valid", warnings: "Valid with warnings", needsRepair: "Needs repair", repaired: "Repaired", noChanges: "No changes needed", unresolved: "Unresolved errors", ready: "Ready to download", unrepairable: "Cannot repair automatically" },
      notes: { valid: "No structural errors were found.", warnings: "The project loads, but some issues are worth fixing.", needsRepair: "Run the repair to fix the errors above.", repaired: "The repaired project passed strict validation.", noChanges: "The file already passed strict validation.", unresolved: "Some errors could not be repaired. See the list below.", ready: "Download the repaired .sb3 below.", cannotRepair: "project.json is not recoverable JSON, so automatic repair cannot start." },
      summary: { container: "container", projectJson: "project.json", targets: "targets", blocks: "blocks", assets: "assets", output: "output", outputSize: "output size", salvaged: "salvaged ZIP", direct: "read directly", recovered: "recovered", jsonInput: "raw project.json", zip: "ZIP archive" },
      labels: { fixed: "repairs", containerNotes: "recovery notes", jsonNotes: "project.json notes", noIssues: "No issues.", noActions: "No repairs were recorded.", issueCount: "{errors} errors · {warnings} warnings · {infos} notes", more: "…and {count} more", optionsChanged: "Options changed. Run the repair to apply them." }
    },
    ja: {
      phases: { load: "ファイル読み込み", json: "project.json 解析", structure: "ターゲットと変数の修復", blocks: "ブロック参照の修復", assets: "メディアの確認", monitors: "モニターの修復", validate: "結果の検証", package: ".sb3 再パッケージ", done: "完了" },
      ready: "準備完了", choose: "プロジェクトを選ぶと検証します。",
      checking: "{name} を検証しています…", repairing: "{name} を修復しています…", reading: "{name} を読み込んでいます…",
      invalidFile: ".sb3 または project.json を選んでください。", emptyFile: "ファイルが空です。",
      readError: "ファイルを読み込めませんでした: {error}", inspectFailed: "検証に失敗しました: {error}",
      repairFailed: "修復に失敗しました: {error}", workerFailed: "バックグラウンド処理が停止しました。このタブで再試行します。",
      mainThread: "このタブで処理しています。タブを開いたままにしてください。",
      checked: "{name} を検証しました。", repaired: "{name} を修復しました。",
      status: { valid: "正常", warnings: "警告あり", needsRepair: "要修復", repaired: "修復済み", noChanges: "変更なし", unresolved: "未解決のエラー", ready: "ダウンロード可", unrepairable: "自動修復できません" },
      notes: { valid: "構造上のエラーは見つかりませんでした。", warnings: "読み込みはできますが、直した方がよい問題があります。", needsRepair: "上のエラーを修復してください。", repaired: "修復後のプロジェクトは厳格な検証に合格しました。", noChanges: "このファイルはすでに厳格な検証に合格しています。", unresolved: "修復できなかったエラーがあります。下の一覧を確認してください。", ready: "下から修復済みの .sb3 をダウンロードできます。", cannotRepair: "project.json を JSON として復元できないため、自動修復を開始できません。" },
      summary: { container: "コンテナ", projectJson: "project.json", targets: "ターゲット", blocks: "ブロック", assets: "アセット", output: "出力", outputSize: "出力サイズ", salvaged: "ZIP を復元", direct: "直接読み込み", recovered: "復元", jsonInput: "project.json 単体", zip: "ZIP アーカイブ" },
      labels: { fixed: "修復件数", containerNotes: "復元メモ", jsonNotes: "project.json メモ", noIssues: "問題はありません。", noActions: "記録された修復はありません。", issueCount: "エラー {errors} · 警告 {warnings} · 情報 {infos}", more: "…ほか {count} 件", optionsChanged: "設定を変更しました。修復を実行すると反映されます。" }
    }
  };

  var ISSUE_JA = {
    ZIP_LOAD_FAILED: "ZIP を通常の方法で開けませんでした。ローカルヘッダーから復元します。", ZIP_ENTRY_UNREADABLE: "ZIP 内のファイルを展開できませんでした。", ZIP_ENTRY_CRC: "ZIP 内のファイルの CRC が一致しません。", ZIP_UNSUPPORTED_METHOD: "ZIP の圧縮方式に対応していません。", ZIP_FLATTEN: "Scratch が読めるようにアセットのパスを平坦化しました。", ZIP_FLATTEN_COLLISION: "同名のアセットがあったため、最初の1つを残しました。", CONTAINER_JSON: "project.json 単体として読み込みました。", PROJECT_PATH: "project.json を ZIP のルートへ移動しました。", JSON_RECOVERED: "壊れた project.json を復元しました。", JSON_PARSE_FAILED: "project.json を JSON として解析できませんでした。", PROJECT_NOT_OBJECT: "project.json がオブジェクトではありません。",
    META_MISSING: "meta オブジェクトがありません。", META_SEMVER: "meta.semver が 3.x.y ではありません。", META_VM: "meta.vm がありません。", META_AGENT: "meta.agent が文字列ではありません。", TARGETS_MISSING: "targets が配列ではありません。", TARGETS_EMPTY: "ターゲットがありません。", TARGETS_WRAPPED: "スプライト単体の JSON をプロジェクトとして包みました。", TARGETS_ALIAS: "単数形の target キーを targets に移動しました。", TARGET_NOT_OBJECT: "ターゲットがオブジェクトではありません。", TARGET_NAME: "ターゲット名がありません。", TARGET_NAME_DUPLICATE: "同じ名前のスプライトがあります。", TARGET_ISSTAGE: "isStage が真偽値ではありません。", TARGET_FIELD: "ターゲットの必須フィールドがオブジェクトではありません。", STAGE_MISSING: "ステージがありません。", STAGE_MULTIPLE: "ステージが複数あります。", STAGE_NOT_FIRST: "先頭がステージではありません。", STAGE_NAME: "ステージ名が Stage ではありません。", STAGE_RESTORED: "Stage という名前からステージ属性を復元しました。", STAGE_CREATED: "空のステージを作成しました。",
    COSTUMES_MISSING: "costumes が配列ではありません。", COSTUMES_EMPTY: "コスチュームがありません。", SOUNDS_MISSING: "sounds が配列ではありません。", CURRENT_COSTUME: "currentCostume が範囲外です。", LAYER_ORDER: "layerOrder が不正です。", LAYER_ORDER_DUPLICATE: "同じ layerOrder のスプライトがあります。", ROTATION_STYLE: "rotationStyle が不正です。", VIDEO_STATE: "videoState が不正です。", TARGET_PROP: "スプライトのプロパティが不正です。",
    STORE_NOT_OBJECT: "変数／リスト／ブロードキャストがオブジェクトではありません。", STORE_ID: "ストア ID が空です。", STORE_ID_UNSAFE: "ストア ID に VM が書き換える文字が含まれています。", STORE_SHAPE: "変数／リストの形式が不正です。", STORE_NAME: "変数／リスト名がありません。", STORE_MISSING: "ブロックが未宣言の変数／リストを使っています。", STORE_CREATED: "不足していた変数／リスト／ブロードキャストを作成しました。", STORE_REFERENCE: "変数／リスト／ブロードキャスト参照を修正しました。", VARIABLE_SHAPE: "変数の形式が不正です。", VARIABLE_VALUE: "変数の値がスカラーではありません。", LIST_SHAPE: "リストの形式が不正です。", LIST_VALUE: "リストにスカラーでない値があります。", CLOUD_ON_SPRITE: "スプライト変数にクラウド属性があります。", BROADCAST_SHAPE: "ブロードキャストの形式が不正です。", BROADCAST_MISSING: "未宣言のブロードキャストを使っています。",
    BLOCKS_MISSING: "blocks がオブジェクトではありません。", BLOCK_NOT_OBJECT: "ブロックがオブジェクトではありません。", BLOCK_OPCODE: "opcode がありません。", BLOCK_INPUTS: "inputs がオブジェクトではありません。", BLOCK_FIELDS: "fields がオブジェクトではありません。", BLOCK_COMMENT_DANGLING: "ブロックが存在しないコメントを参照しています。", INPUT_SHAPE: "入力の形式が不正です。", INPUT_TYPE: "入力のシャドウ種別が不正です。", INPUT_EXTRA: "入力に余分な要素があります。", INPUT_DANGLING: "入力が存在しないブロックを参照しています。", INPUT_REF: "入力の参照が不正です。", FIELD_SHAPE: "フィールドの形式が不正です。", NEXT_DANGLING: "next が存在しないブロックを参照しています。", PARENT_DANGLING: "parent が存在しないブロックを参照しています。", TOPLEVEL_PARENT: "トップレベルブロックに parent があります。", TOPLEVEL_RESTORED: "親のないブロックをトップレベルにしました。", BLOCK_NO_PARENT: "トップレベルでないのに parent がありません。", BLOCK_MULTI_PARENT: "同じブロックが複数箇所から参照されています。", BLOCK_CYCLE: "ブロック参照が循環しています。", BLOCK_TOPLEVEL_TYPE: "topLevel が真偽値ではありません。", BLOCK_SHADOW_TYPE: "shadow が真偽値ではありません。", BLOCK_POSITION: "ブロックの x/y が数値ではありません。", PRIMITIVE_TOPLEVEL: "トップレベルのプリミティブが不正です。", PRIMITIVE_SHAPE: "プリミティブの形式が不正です。", PRIMITIVE_UNKNOWN: "不明なプリミティブ種別です。", PRIMITIVE_COLOR: "色の値が #rrggbb ではありません。", PRIMITIVE_VALUE: "プリミティブの値が文字列／数値ではありません。", PRIMITIVE_POSITION: "ワークスペース上の位置が不正です。",
    COMMENTS_NOT_OBJECT: "comments がオブジェクトではありません。", COMMENT_NOT_OBJECT: "コメントがオブジェクトではありません。", COMMENT_TEXT: "コメント本文がありません。", COMMENT_TEXT_LONG: "コメントが 8000 文字を超えています。", COMMENT_DANGLING: "コメントが存在しないブロックを参照しています。",
    ASSET_NOT_OBJECT: "アセットがオブジェクトではありません。", ASSET_NAME_MISSING: "アセット名がありません。", ASSET_MISSING: "アセットのファイルが ZIP 内にありません。", ASSET_ID_MISMATCH: "assetId がファイル内容の MD5 と一致しません。", ASSET_INVALID: "メディアファイルが壊れています。", ASSET_FORMAT: "アセットの拡張子が未対応です。", ASSET_FORMAT_MISMATCH: "dataFormat と拡張子が一致しません。", ASSET_RENAMED: "アセットを内容の MD5 名に変更しました。", COSTUME_CENTER: "コスチュームの回転中心がありません。", COSTUME_RESOLUTION: "bitmapResolution が不正です。", SOUND_RATE: "音のサンプルレートが不正です。", SOUND_SAMPLES: "音のサンプル数が不正です。",
    MONITORS_NOT_ARRAY: "monitors が配列ではありません。", MONITOR_NOT_OBJECT: "モニターがオブジェクトではありません。", MONITOR_OPCODE: "モニターに opcode がありません。", MONITOR_ID: "モニターに id がありません。", MONITOR_DUPLICATE: "モニター id が重複しています。", MONITOR_SPRITE_MISSING: "モニターの参照先スプライトがありません。", MONITOR_STORE_MISSING: "モニターの参照先の変数／リストがありません。", MONITOR_ID_MISMATCH: "モニター id が変数／リストと一致しません。", MONITOR_PARAMS: "モニターの params が不正です。",
    PROC_DEF_NO_PROTOTYPE: "カスタムブロック定義にプロトタイプがありません。", PROC_DEF_PROTOTYPE: "カスタムブロック定義のプロトタイプを作成しました。", PROC_PROTOTYPE_ORPHAN: "プロトタイプが定義から参照されていません。", PROC_MUTATION: "プロトタイプの mutation がありません。", PROC_CALL_MUTATION: "呼び出しの mutation がありません。", PROC_CALL_ORPHAN: "呼び出しに対応する定義がありません。", PROC_DUPLICATE_PROCODE: "同じ proccode の定義が複数あります。", PROC_ARG_IDS: "argumentids が不正です。", PROC_ARG_MISMATCH: "argumentids と proccode の引数数が一致しません。", PROC_ARG_DUPLICATE: "argumentids に重複があります。", PROC_ARG_LIST: "argumentnames／argumentdefaults が不正です。", PROC_MUTATION_FLAG: "mutation の真偽値が不正です。", PROC_CALL_ARGS: "呼び出しと定義の引数数が一致しません。",
    EXTENSION_MISSING: "使用している拡張機能が宣言されていません。", EXTENSION_DUPLICATE: "拡張機能が重複宣言されています。", EXTENSIONS_NOT_ARRAY: "extensions が配列ではありません。", EXTENSION_ID: "拡張機能 ID が不正です。", ASSET_UNREFERENCED: "どのターゲットからも参照されていないファイルがあります。"
  };

  var el = {};
  var state = { file: null, buffer: null, name: "", inspect: null, repair: null, output: null, report: null, worker: null, busy: false, urls: [] };

  function t(key, vars) {
    var value = STR[LANG] || STR.en;
    key.split(".").forEach(function (part) { if (value != null) value = value[part]; });
    if (value == null) value = key;
    if (typeof value !== "string") return value;
    return value.replace(/\{(\w+)\}/g, function (_m, k) {
      return vars && Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : "";
    });
  }

  function fmtBytes(n) {
    if (n == null || !isFinite(n)) return "—";
    var units = ["B", "KB", "MB", "GB"], i = 0, v = Math.abs(n);
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i === 0 ? String(Math.trunc(v)) : v.toFixed(1)) + " " + units[i];
  }

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function cache() {
    ["dropzone", "fileInput", "fileRow", "fileName", "fileSize", "clearBtn", "optFill", "optReplace", "optMonitors", "optCalls", "inspectBtn", "repairBtn", "inspectBtnSide", "repairBtnSide", "runHint", "phaseLabel", "statusValue", "statusTag", "statusNote", "fileValue", "jsonValue", "targetValue", "blockValue", "assetValue", "errorsBefore", "warningsBefore", "errorsAfter", "warningsAfter", "fixedValue", "report", "summaryGrid", "actionsSection", "actionsMeta", "actionList", "beforeSection", "beforeMeta", "beforeList", "afterSection", "afterMeta", "afterList", "downloadRow", "downloadSb3", "downloadJson", "downloadReport", "engineVersion"].forEach(function (id) {
      el[id] = document.getElementById(id);
    });
  }

  function setPhase(text) {
    if (!el.phaseLabel) return;
    el.phaseLabel.textContent = text || t("ready");
    el.phaseLabel.classList.remove("is-error");
  }
  function setError(message) {
    if (!el.phaseLabel) return;
    el.phaseLabel.textContent = message;
    el.phaseLabel.classList.add("is-error");
  }
  function setBusy(busy, label) {
    state.busy = busy;
    var cannotRepair = !!(state.inspect && state.inspect.canRepair === false);
    [el.inspectBtn, el.inspectBtnSide].forEach(function (b) {
      if (b) b.disabled = busy || !state.buffer;
    });
    [el.repairBtn, el.repairBtnSide].forEach(function (b) {
      if (b) b.disabled = busy || !state.buffer || cannotRepair;
    });
    if (busy && label) setPhase(label);
  }
  function readOptions() {
    return {
      fillMissingAssets: !!(el.optFill && el.optFill.checked),
      replaceInvalidAssets: !!(el.optReplace && el.optReplace.checked),
      removeStaleMonitors: !!(el.optMonitors && el.optMonitors.checked),
      stubOrphanCalls: !!(el.optCalls && el.optCalls.checked)
    };
  }

  function cancelWorker() {
    if (state.worker) {
      try { state.worker.terminate(); } catch (_) { /* ignore */ }
      state.worker = null;
    }
  }

  function ensureWorker() {
    if (state.worker) return state.worker;
    if (typeof Worker === "undefined") return null;
    try {
      state.worker = new Worker(BASE + "worker.js");
      state.worker.onmessage = onWorkerMessage;
      state.worker.onerror = function () {
        state.worker = null;
        if (state.busy) { fail("inspect", t("workerFailed")); }
      };
      return state.worker;
    } catch (_) { state.worker = null; return null; }
  }

  function onWorkerMessage(event) {
    var data = event.data || {};
    if (data.type === "progress") {
      var label = (STR[LANG].phases && STR[LANG].phases[data.phase]) || data.message || t("ready");
      setPhase(label + (data.percent != null ? " · " + data.percent + "%" : ""));
      return;
    }
    if (data.type === "error") { fail(data.kind, data.message); return; }
    if (data.type === "done") {
      if (data.kind === "repair") { state.report = data.report; state.output = data.output; }
      else { state.inspect = data.report; }
      finish(data.kind, data.report);
    }
  }

  function run(kind) {
    if (!state.buffer || state.busy) return;
    state.output = null;
    clearDownloads();
    el.downloadRow.hidden = true;
    var opts = readOptions();
    setBusy(true, t(kind === "repair" ? "repairing" : "checking", { name: state.name }));
    var worker = ensureWorker();
    if (worker) {
      var copy = state.buffer.slice(0);
      worker.postMessage({ type: kind, buffer: copy, filename: state.name, options: opts }, [copy]);
      return;
    }
    setPhase(t("mainThread"));
    var engine = window.REPAIR;
    if (!engine) { fail(kind, "The repair engine did not load."); return; }
    if (window.JSZip) engine.setJSZip(window.JSZip);
    var progress = function (phase, _frac, message) {
      setPhase((STR[LANG].phases && STR[LANG].phases[phase]) || message || t("ready"));
    };
    var promise = kind === "repair" ? engine.repairBuffer(state.buffer, state.name, opts, progress) : engine.inspectBuffer(state.buffer, state.name, opts, progress);
    promise.then(function (report) {
      if (kind === "repair") { state.report = report; state.output = report.outputBytes; delete report.outputBytes; }
      else { state.inspect = report; }
      finish(kind, report);
    }).catch(function (error) { fail(kind, error && error.message ? error.message : String(error)); });
  }

  function finish(kind, report) {
    setBusy(false);
    if (kind === "repair") renderRepair(report); else renderInspect(report);
    setPhase(kind === "repair" ? t("repaired", { name: state.name }) : t("checked", { name: state.name }));
  }
  function fail(kind, message) {
    setBusy(false);
    setError(t(kind === "repair" ? "repairFailed" : "inspectFailed", { error: message }));
    el.statusValue.textContent = "—";
    el.statusTag.hidden = true;
  }

  function issueCounts(container) {
    var counts = { errors: 0, warnings: 0, infos: 0 };
    ((container && container.issues) || []).forEach(function (i) {
      if (i.severity === "error") counts.errors++;
      else if (i.severity === "warning") counts.warnings++;
      else counts.infos++;
    });
    return counts;
  }
  function setStat(node, value, bad) {
    if (!node) return;
    node.textContent = value == null ? "—" : String(value);
    node.classList.remove("is-bad", "is-good");
    if (bad === true) node.classList.add("is-bad");
    else if (bad === false) node.classList.add("is-good");
  }

  function renderReadout(report) {
    var before = issueCounts(report.before);
    var after = report.after ? issueCounts(report.after) : null;
    var stats = (report.after && report.after.stats) || (report.before && report.before.stats) || {};
    el.fileValue.textContent = report.inputSize ? fmtBytes(report.inputSize) : (state.file ? fmtBytes(state.file.size) : "—");
    el.jsonValue.textContent = report.json && report.json.bytes ? fmtBytes(report.json.bytes) : "—";
    el.targetValue.textContent = stats.targets != null ? stats.targets : "—";
    el.blockValue.textContent = stats.blocks != null ? stats.blocks : "—";
    el.assetValue.textContent = stats.assets != null ? stats.assets : "—";
    setStat(el.errorsBefore, before.errors, before.errors > 0);
    setStat(el.warningsBefore, before.warnings, before.warnings > 0);
    if (after) {
      setStat(el.errorsAfter, after.errors, after.errors > 0);
      setStat(el.warningsAfter, after.warnings, after.warnings > 0);
    } else {
      setStat(el.errorsAfter, "—", null);
      setStat(el.warningsAfter, "—", null);
    }
    setStat(el.fixedValue, report.actions ? report.actions.length : 0, null);

    var status, note, cls;
    if (!after) {
      if (report.canRepair === false) { status = t("status.unrepairable"); note = t("notes.cannotRepair"); cls = "bad"; }
      else if (before.errors > 0) { status = t("status.needsRepair"); note = t("notes.needsRepair"); cls = "bad"; }
      else if (before.warnings > 0) { status = t("status.warnings"); note = t("notes.warnings"); cls = "warn"; }
      else { status = t("status.valid"); note = t("notes.valid"); cls = "good"; }
    } else if (after.errors > 0) {
      status = t("status.unresolved"); note = t("notes.unresolved"); cls = "bad";
    } else if (!report.changed) {
      status = t("status.noChanges"); note = t("notes.noChanges"); cls = "good";
    } else {
      status = t("status.repaired"); note = t("notes.repaired"); cls = "good";
    }
    el.statusValue.textContent = status;
    el.statusNote.textContent = note;
    el.statusTag.hidden = false;
    el.statusTag.textContent = cls === "good" ? "OK" : "!";
    el.statusTag.style.color = cls === "bad" ? "#ff8b6b" : (cls === "warn" ? "#ffcf6b" : "#9fe28b");

    var showDownloads = !!(state.output && report.after && report.after.stats.errors === 0);
    el.downloadRow.hidden = !showDownloads;
    if (showDownloads) setDownloads(report);
  }

  function renderInspect(report) {
    state.report = null;
    state.output = null;
    clearDownloads();
    el.downloadRow.hidden = true;
    el.report.hidden = false;
    el.actionsSection.hidden = true;
    el.afterSection.hidden = true;
    renderReadout(report);
    renderSummary(report, false);
    renderIssues(el.beforeList, report.before && report.before.issues, t("labels.noIssues"));
    var b = issueCounts(report.before);
    el.beforeMeta.textContent = t("labels.issueCount", b);
    el.runHint.textContent = report.canRepair === false ? t("notes.cannotRepair") : (b.errors > 0 ? t("notes.needsRepair") : (b.warnings > 0 ? t("notes.warnings") : t("notes.valid")));
  }

  function renderRepair(report) {
    el.report.hidden = false;
    el.actionsSection.hidden = false;
    el.afterSection.hidden = false;
    renderReadout(report);
    renderSummary(report, true);
    var b = issueCounts(report.before), a = issueCounts(report.after);
    el.beforeMeta.textContent = t("labels.issueCount", b);
    el.afterMeta.textContent = t("labels.issueCount", a);
    el.actionsMeta.textContent = String(report.actions ? report.actions.length : 0);
    renderIssues(el.beforeList, report.before && report.before.issues, t("labels.noIssues"));
    renderIssues(el.afterList, report.after && report.after.issues, t("labels.noIssues"));
    renderIssues(el.actionList, report.actions, t("labels.noActions"));
    el.runHint.textContent = a.errors > 0 ? t("notes.unresolved") : (a.warnings > 0 ? t("notes.warnings") : t("notes.repaired"));
  }

  function renderSummary(report, repaired) {
    var stats = (report.after && report.after.stats) || (report.before && report.before.stats) || {};
    var container = report.container || {};
    var containerLabel = container.kind === "json" ? t("summary.jsonInput") : t("summary.zip");
    if (container.salvaged) containerLabel += " · " + t("summary.salvaged");
    var json = report.json || {};
    var jsonLabel = json.method === "direct" ? t("summary.direct") : (json.method ? t("summary.recovered") + " (" + json.method + ")" : "—");
    var rows = [
      [t("summary.container"), containerLabel, true],
      [t("summary.projectJson"), jsonLabel, false],
      [t("summary.targets"), stats.targets != null ? stats.targets : "—", false],
      [t("summary.blocks"), stats.blocks != null ? stats.blocks : "—", false],
      [t("summary.assets"), stats.assets != null ? stats.assets : "—", false]
    ];
    if (container.notes && container.notes.length) {
      rows.push([t("labels.containerNotes"), container.notes.map(function (n) {
        return n.message || n.code || "";
      }).join(" · "), true]);
    }
    if (json.notes && json.notes.length) {
      rows.push([t("labels.jsonNotes"), json.notes.join(" · "), true]);
    }
    if (repaired && report.outputName) {
      rows.push([t("summary.output"), report.outputName, true]);
      rows.push([t("summary.outputSize"), fmtBytes(report.outputSize), false]);
    }
    el.summaryGrid.innerHTML = rows.map(function (row) {
      return '<div class="summary-row' + (row[2] ? " is-wide" : "") + '"><span>' + esc(row[0]) + "</span><span>" + esc(row[1]) + "</span></div>";
    }).join("");
  }

  function issueMessage(issue) {
    if (LANG === "ja" && ISSUE_JA[issue.code]) return ISSUE_JA[issue.code];
    return issue.message || issue.code;
  }

  function groupIssues(issues) {
    var map = new Map();
    (issues || []).forEach(function (issue) {
      var key = [issue.severity || "info", issue.code || "", issueMessage(issue), issue.target || ""].join("|");
      if (!map.has(key)) map.set(key, { issue: issue, count: 0, paths: [], details: [] });
      var group = map.get(key);
      group.count++;
      if (issue.path && group.paths.indexOf(issue.path) < 0 && group.paths.length < 4) group.paths.push(issue.path);
      if (issue.detail != null && group.details.indexOf(String(issue.detail)) < 0 && group.details.length < 4) group.details.push(String(issue.detail));
    });
    return Array.from(map.values()).sort(function (a, b) {
      var order = { error: 0, warning: 1, info: 2 };
      var oa = order[a.issue.severity] != null ? order[a.issue.severity] : 3;
      var ob = order[b.issue.severity] != null ? order[b.issue.severity] : 3;
      if (oa !== ob) return oa - ob;
      return (a.issue.code || "").localeCompare(b.issue.code || "");
    });
  }

  function renderIssues(container, issues, emptyText) {
    if (!container) return;
    var groups = groupIssues(issues);
    if (!groups.length) { container.innerHTML = '<div class="issue-empty">' + esc(emptyText) + "</div>"; return; }
    var html = "";
    groups.slice(0, 400).forEach(function (group) {
      var issue = group.issue, sev = issue.severity || "info";
      var pathText = group.paths.join(" · ");
      var detailText = group.details.join(" · ");
      html += '<div class="issue"><span class="sev sev-' + esc(sev) + '">' + esc(sev) + "</span>" +
        '<div class="msg"><code>' + esc(issue.code || "") + "</code> " + esc(issueMessage(issue)) +
        (issue.target ? ' <span class="issue-target">@ ' + esc(issue.target) + "</span>" : "") + "</div>" +
        (group.count > 1 ? '<span class="count">×' + group.count + "</span>" : "") +
        (pathText ? '<p class="path">' + esc(pathText) + "</p>" : "") +
        (detailText ? '<p class="path">' + esc(detailText) + "</p>" : "") + "</div>";
    });
    if (groups.length > 400) html += '<div class="issue-empty">' + esc(t("labels.more", { count: groups.length - 400 })) + "</div>";
    container.innerHTML = html;
  }

  function clearDownloads() {
    state.urls.forEach(function (url) { URL.revokeObjectURL(url); });
    state.urls = [];
    [el.downloadSb3, el.downloadJson, el.downloadReport].forEach(function (a) {
      if (a) { a.href = "#"; a.removeAttribute("download"); }
    });
  }
  function makeUrl(blob) {
    var url = URL.createObjectURL(blob);
    state.urls.push(url);
    return url;
  }
  function setDownloads(report) {
    clearDownloads();
    var base = (report.outputName || "project_repaired.sb3").replace(/\.sb3$/i, "");
    el.downloadSb3.href = makeUrl(new Blob([state.output], { type: "application/x.scratch.sb3" }));
    el.downloadSb3.setAttribute("download", report.outputName || base + "_repaired.sb3");
    el.downloadJson.href = makeUrl(new Blob([report.projectJson || "{}"], { type: "application/json" }));
    el.downloadJson.setAttribute("download", base + ".json");
    var summary = { version: report.version, input: report.input, outputName: report.outputName, outputSize: report.outputSize, container: report.container, json: report.json, summary: report.summary, actions: report.actions, before: report.before, after: report.after };
    el.downloadReport.href = makeUrl(new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" }));
    el.downloadReport.setAttribute("download", base + "_repair-report.json");
  }

  function handleFile(file) {
    if (!file) return;
    cancelWorker();
    var name = file.name || "project.sb3";
    if (!/\.(sb3|json)$/i.test(name)) { setError(t("invalidFile")); return; }
    if (!file.size) { setError(t("emptyFile")); return; }
    state.file = file;
    state.name = name;
    state.buffer = null;
    state.inspect = null;
    state.report = null;
    state.output = null;
    clearDownloads();
    el.fileRow.hidden = false;
    el.fileName.textContent = name;
    el.fileSize.textContent = fmtBytes(file.size);
    el.report.hidden = true;
    setPhase(t("reading", { name: name }));
    var reader = file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer();
    reader.then(function (buffer) {
      state.buffer = buffer;
      setBusy(false);
      run("inspect");
    }).catch(function (error) {
      setError(t("readError", { error: error && error.message ? error.message : String(error) }));
      setBusy(false);
    });
  }

  function reset() {
    cancelWorker();
    state.file = null; state.buffer = null; state.name = "";
    state.inspect = null; state.report = null; state.output = null;
    clearDownloads();
    el.fileInput.value = "";
    el.fileRow.hidden = true;
    el.report.hidden = true;
    el.downloadRow.hidden = true;
    el.statusValue.textContent = "—";
    el.statusTag.hidden = true;
    el.statusNote.textContent = t("choose");
    el.runHint.textContent = t("choose");
    ["fileValue", "jsonValue", "targetValue", "blockValue", "assetValue", "errorsBefore", "warningsBefore", "errorsAfter", "warningsAfter", "fixedValue"].forEach(function (id) {
      if (el[id]) { el[id].textContent = "—"; el[id].classList.remove("is-bad", "is-good"); }
    });
    setPhase(t("ready"));
    setBusy(false);
  }

  function chooseFile() { el.fileInput.value = ""; el.fileInput.click(); }
  function hasFiles(event) { return event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], "Files") >= 0; }

  function setTheme(theme, persist) {
    document.documentElement.setAttribute("data-theme", theme);
    if (persist) { try { localStorage.setItem("sb3-repair-theme-v1", theme); } catch (_) {} }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#15180f" : "#e7e8e1");
    document.querySelectorAll("[data-theme-set]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-set") === theme));
    });
  }
  function storedTheme() { try { return localStorage.getItem("sb3-repair-theme-v1"); } catch (_) { return null; } }

  function init() {
    cache();
    if (el.engineVersion && window.REPAIR && window.REPAIR.VERSION) el.engineVersion.textContent = "v" + window.REPAIR.VERSION;
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light", false);
    document.querySelectorAll("[data-theme-set]").forEach(function (button) {
      button.addEventListener("click", function () { setTheme(button.getAttribute("data-theme-set"), true); });
    });
    if (window.matchMedia) {
      var scheme = window.matchMedia("(prefers-color-scheme: dark)");
      var onScheme = function (event) { if (!storedTheme()) setTheme(event.matches ? "dark" : "light", false); };
      if (scheme.addEventListener) scheme.addEventListener("change", onScheme);
      else if (scheme.addListener) scheme.addListener(onScheme);
    }

    el.dropzone.addEventListener("click", chooseFile);
    el.dropzone.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseFile(); }
    });
    el.fileInput.addEventListener("change", function () { handleFile(el.fileInput.files && el.fileInput.files[0]); });
    el.clearBtn.addEventListener("click", reset);
    el.inspectBtn.addEventListener("click", function () { run("inspect"); });
    el.repairBtn.addEventListener("click", function () { run("repair"); });
    el.inspectBtnSide.addEventListener("click", function () { run("inspect"); });
    el.repairBtnSide.addEventListener("click", function () { run("repair"); });
    ["optFill", "optReplace", "optMonitors", "optCalls"].forEach(function (id) {
      if (el[id]) el[id].addEventListener("change", function () { if (state.report) el.runHint.textContent = t("labels.optionsChanged"); });
    });

    var dragDepth = 0;
    window.addEventListener("dragenter", function (event) {
      if (!hasFiles(event)) return; event.preventDefault(); dragDepth++; el.dropzone.classList.add("is-dragging");
    });
    window.addEventListener("dragover", function (event) {
      if (!hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", function (event) {
      if (!hasFiles(event)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) el.dropzone.classList.remove("is-dragging");
    });
    window.addEventListener("drop", function (event) {
      if (!hasFiles(event)) return; event.preventDefault(); dragDepth = 0; el.dropzone.classList.remove("is-dragging");
      handleFile(event.dataTransfer.files && event.dataTransfer.files[0]);
    });

    setBusy(false);
    setPhase(t("ready"));
    el.statusNote.textContent = t("choose");
    el.runHint.textContent = t("choose");

    window._repairRun = function (buffer, name, kind, options) {
      state.buffer = buffer; state.name = name || "project.sb3";
      var opts = Object.assign(readOptions(), options || {});
      var engine = window.REPAIR;
      if (window.JSZip) engine.setJSZip(window.JSZip);
      var promise = kind === "repair" ? engine.repairBuffer(state.buffer, state.name, opts) : engine.inspectBuffer(state.buffer, state.name, opts);
      return promise.then(function (report) {
        if (kind === "repair") { state.report = report; state.output = report.outputBytes; delete report.outputBytes; finish("repair", report); }
        else { state.inspect = report; finish("inspect", report); }
        return report;
      });
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
