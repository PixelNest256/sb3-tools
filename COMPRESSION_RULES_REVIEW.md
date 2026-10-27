# sb3-tools 新規圧縮ルール案 検証レポート

## 概要

`sb3-tools 新規圧縮ルール案.md` に記載された9提案＋2確認点の妥当性を、Scratch VM 実験・仕様調査・実測に基づいて検証する。

## 検証環境

- Scratch VM: `C:\Users\Kasam\AppData\Local\Temp\svm\node_modules\scratch-vm`
- テストプロジェクト: `C:\Users\Kasam\Playground\sb3_compressor\test.sb3`
- 現行実装: `docs/sb3/compressor.js`（提案1・2・4 実装後の作業ツリー。`docs/full/project.js` は同一内容）

## 確認点

### 確認点2: 整数風IDによるスクリプト順序の変化

**検証方法**: Scratch VM ソースコードでハット実行順序の決定ロジックを確認

**検証結果**: ✅ 問題なし

**根拠**:
- Scratch VM の `runtime.js` で `startHats()` は `allScriptsByOpcodeDo()` を呼び出す
- `allScriptsByOpcodeDo()` は `BlocksRuntimeCache.getScripts()` を使用
- `getScripts()` は `blocks._scripts` 配列を順に走査（挿入順序）
- ハット実行順序は `blocks._scripts` 配列の順序に依存し、Object.keys の順序には依存しない
- したがって、整数風ID（"0"〜"9"）が出現しても実行順序は変化しない

**結論**: 対策不要。現行 `encodeId` が "0"〜"9" を出力しても問題ない。

---

## 提案1: デッドアセット除去（効果：大）

### 検証: コスチューム/背景の参照条件

**検証方法**: test.sb3 でコスチューム参照ブロックをスキャン

**検証結果**: ⚠️ 参照条件を考慮する必要あり

**根拠**:
- `looks_switchcostumeto` / `looks_switchbackdropto`: メニュー（shadow ブロック）のフィールドに書かれた名前を参照
  - `next costume` / `previous costume`、`next backdrop` / `previous backdrop` / `random backdrop`、数値文字列（VM は名前で見つからなければインデックスとして解釈する）、レポーター（動的）は位置依存なので全コスチュームを保持
  - 名前がリテラルのときだけ、そのコスチューム1枚に絞れる
- `looks_nextcostume` / `looks_nextbackdrop`: 次のコスチューム/背景を動的に参照（全保持）。`looks_nextbackdrop` はスプライトから実行しても `getTargetForStage()` により Stage に作用する
- `looks_costumenumbername` / `looks_backdropnumbername`: `NUMBER_NAME = number` は番号を返すためインデックスがずれないよう全保持。`name` は名前を返すだけなので保持不要
- `event_whenbackdropswitchesto`: 指定した背景が存在しないと発火しないため、その背景を保持
- `sensing_of`: `costume #` / `backdrop #` / `background #` は対象ターゲットの全コスチュームを保持。`costume name` / `backdrop name` は保持不要
- コスチュームは各ターゲット最低1枚残す。削除後は `currentCostume` を名前で再ポイントする

**ガード条件**:
- 動的メニュー（レポーター）、`next` / `previous` / `random`、数値文字列、未知の名前は「全保持」
- 背景系は全ターゲット横断で判定する（スプライトの `next backdrop` は Stage の背景を進めるため）

### 検証: サウンドの参照条件

**検証方法**: test.sb3 でサウンド参照ブロックをスキャン

**検証結果**: ✅ 名前単位で判定可能

**根拠**:
- `sound_play` / `sound_playuntildone` は `SOUND_MENU` の名前だけを参照する。メニューがレポーターなら全保持
- 名前が見つからない場合、VM は `parseInt(name, 10)` を 1-based インデックスとして使う（`wrapClamp`）。数値文字列は全保持
- `sound_stopallsounds` / `sound_seteffectto` / `sound_changeeffectby` / `sound_cleareffects` / `sound_setvolumeto` / `sound_changevolumeby` / `sound_volume` は特定のサウンドを指さない
- 未知の `sound_*` ブロックは安全側で全保持（メニューの shadow は実行されないので除外）

### 検証: スプライト削除の参照条件

**検証方法**: スプライト名を参照するブロックを仕様調査

**根拠**:
- `motion_goto`, `motion_pointtowards`: スプライトメニューで指定
- `looks_touchingobject`: スプライトメニューで指定
- `sensing_distanceto`: スプライトメニューで指定
- `control_create_clone_of`: スプライトメニューで指定
- `sensing_of` (OBJECT): スプライト名を参照
- モニター: `spriteName` プロパティで参照

**ガード条件**:
- スクリプトが存在する場合、削除不可
- `visible: false` で、上記ブロックから名前が参照されていない場合、削除可能
- モニターから参照されている場合、削除不可
- レポーターのメニュー（動的）がある場合は全スプライトを保持
- 参照しているスプライトが消えると次が死ぬ連鎖があるため、不動点に達するまで繰り返す

### 検証: zip 内アセットの削除

**検証結果**: ✅ 実装可能

**根拠**:
- `project.json` からコスチューム/サウンドを消しても、zip 内のアセットファイルは残る
- `assetId` + `dataFormat` が実体の参照。`md5ext` がある場合はそれも参照として扱う
- `<32桁hex>.<拡張子>` の形のファイルだけを対象にし、`project.json` 以外の任意ファイルは保持する

**結論**:
- ✅ **実装可能**: 参照条件を適切に実装すれば安全
- ⚠️ **注意点**: `looks_nextcostume` 等の動的参照を見落とすとバグの原因
- 📊 **効果**: test.sb3 で Stage の未使用コスチューム4個を削除（背景 5→1）。サウンド・スプライトの削除は 0
- 🗜️ **zip 効果**: 削除したアセットのファイルも zip から消えるため、`project.json` だけでなく `.sb3` 自体も小さくなる

---

## 提案2: 書き込み専用変数/リストの除去（効果：中〜大）

### 検証: sensing_of による変数参照

**検証方法**: Scratch VM の `getAttributeOf` 実装を確認

**検証結果**: ⚠️ **変数を読む**（当初の「3.0 では読めない」は誤り）

**根拠**:
- `scratch3_sensing.js` の `getAttributeOf` は、組み込みプロパティ（x position / y position / direction / costume # / costume name / size / volume / background # / backdrop # / backdrop name）に一致しない場合、最後に
  `attrTarget.lookupVariableByNameAndType(args.PROPERTY, "", true)` を実行し、見つかった変数の値を返す（見つからなければ 0）
- 第3引数 `skipStage = true` のため、読まれるのは **OBJECT ターゲット自身のローカル（スカラー）変数** だけ。スプライトから Stage のグローバル変数を同名で読むことはできない。OBJECT が `_stage_` のときは Stage 自身の変数が読まれる
- したがって `sensing_of [<変数名>] of [...]` の `<変数名>` は「読み取り」として扱う必要がある（リストは対象外。`type = ""` はスカラー変数のみ）
- 実装は名前が一致する変数 ID を保守的にすべて保持する（OBJECT がレポーターで動的な場合も安全）

### 検証: test.sb3 での書き込み専用ストアの検出

**検証方法**: 実装（`_scanUsage` の read/write 分類と `_removeWriteOnly`）で実際に圧縮し、削除されたストアを列挙

**検証結果**:
- Stage: 書き込み専用変数 **1個**（`Query`）
- その他のターゲット: 0個
- 書き込み専用リスト: 0個
- 従来「Stage 2個 / UI 23個 / Chatbot 2個 = 27個」としていたのは、read/write の分類を誤った試算であり実測と一致しない

**修正前の実装の問題**:
- 旧 `_removeWriteOnly` は分類を作り直しており、`sensing_of` を「参照しない」と誤認していた
- モニターを ID ではなく名前で照合していたため、別スプライトの同名ローカル変数のモニターを巻き込む可能性があった
- 連続する削除ブロックの再連結が不完全で、スクリプトが途中で切れる回帰があった（回帰テストで検出）

### ガード条件

書き込み専用として安全に削除するには、以下を確認する:
- ✅ 読み取り（`data_variable`, `data_listcontents`, `data_itemoflist`, `data_lengthoflist`, `data_listcontainsitem`, `data_itemnumoflist`）がない
- ✅ `sensing_of` で名前参照される変数でない
- ✅ 残すモニター（`removeMonitors=false`）が指すストアでない
- ✅ クラウド変数でない（`☁` プレフィックス）
- ✅ `show variable` / `show list` で表示されていない（`hide` だけなら削除対象）
- ✅ トップレベルレポーターではない
- ✅ `control_for_each` のループ変数でない（VM は毎回 `lookupOrCreateVariable` するため、消しても同名で再作成される）
- ✅ 削除するのは書き込み系＋`hide` ブロックのみ（C ブロックは削除しない）
- ✅ 削除後に `next` / `parent` / `SUBSTACK` を再連結し、到達不能ブロックを掃除する
- ✅ モニターの削除は ID 完全一致で行う

### 結論

- ✅ **実装可能**: `sensing_of` の変数参照を読み取りとして扱えば安全
- ⚠️ **修正内容**: `used` から `write` を除外し、読み取りのみを「使用」とみなす
- 📊 **効果**: test.sb3 で書き込み専用変数 1個を削除（リスト 0個）
- 📌 **補足**: `removeMonitors=true` のときは非表示モニター付きの空リスト（test.sb3 の Stage `logs`）も削除対象になる

---

## 提案4: 値の型・表現の正規化（効果：小〜中、安全）

### 検証: md5ext 削除の安全性

**検証方法**: md5ext を削除したプロジェクトを Scratch VM でロード

**検証結果**: ✅ 安全

**根拠**:
- Scratch VM は md5ext を使用せず、`assetId` と `dataFormat` のみを使用
- md5ext = assetId + "." + dataFormat（冗長フィールド）
- 実験: md5ext 削除後のプロジェクトを Scratch VM で正常にロードできた

**結論**: ✅ **安全に削除可能**

### 検証: 数値文字列の正規化

**検証方法**: `String(Number(s)) === s` の条件で検証

**根拠**:
- 正規の数値文字列（"10", "3.14"）を数値リテラル（10, 3.14）に変換
- 変数/リストの初期値、ブロック入力値の両方に適用
- 浮動小数ノイズ（523.9999999）の丸め込みも可能

**結論**: ✅ **安全に実装可能**

### 検証: meta.agent の空化

**根拠**:
- meta.agent は UA 文字列（約150B）
- 実行に無関係

**結論**: ✅ **安全に削除可能**

### 検証: 隠れシャドウの削除

**現行実装**: `_dropObscuredShadows()` で既に実装済み
- `[3, blockId, [10, ""]]` → `[2, blockId]`

**結論**: ✅ **既に実装済み**

### 結論

- ✅ **実装可能**: md5ext, meta.agent, 数値文字列正規化は安全
- ✅ **既に実装済み**: 隠れシャドウ削除
- 📊 **効果**: md5ext 削除でコスチューム/サウンド毎に約32B節約
- 📊 **実測（test.sb3）**: md5ext 118件、数値文字列 126件、`meta.agent` 1件
- 📌 **独立性**: `stripNullFieldIds`（フィールドの `[name, null]` → `[name]`、既定 ON）と `zeroTopLevelCoords`（既定 OFF）は `normalizeTypes` とは独立したオプション。以前は `normalizeTypes` の内側に入っており、`normalizeTypes` を切ると効かなかった（修正済み）

---

## 提案7: スクリプトのピープホール最適化（効果：小〜中）

### 検証: set v to (v + c) → change v by c

**検証方法**: Scratch VM で実行等価性を確認

**検証結果**: ⚠️ 浮動小数点数では注意が必要

**根拠**:
- 整数の場合: Scratch の実装上、同一の結果になる
- 浮動小数点数の場合: `set` は代入、`change` は加算。丸め誤差の可能性
- 浮動小数点数の場合、変換を避けるか、ガード条件を追加

**現行実装**: `_foldNumeric` は数値演算の定数畳み込みのみ行い、この変換は行っていない

**ガード条件**:
- 整数リテラルのみ対象にする
- または、浮動小数点数でも安全な場合（整数値の浮動小数表現）に限定

**結論**: ⚠️ **条件付きで実装可能**（整数のみ、またはガード条件付き）

### 検証: 連続する同符号の整数 change / turn の合算

**根拠**:
- 符号が逆だとクランプで差が出る可能性
- 整数に限定して安全

**結論**: ⚠️ **条件付きで実装可能**（整数のみ、同符号のみ）

### 検証: if <not c> else の then/else 入替

**根拠**:
- `if <not c> then A else B` → `if c then B else A`
- ブロック数は変わらないが、簡潔化

**結論**: ✅ **安全に実装可能**

### 検証: not (not x) → x

**根拠**:
- x が真偽値型のブロックなら等価
- 文字列/数値では挙動が異なる可能性（Scratch の Cast.toBoolean に依存）

**結論**: ⚠️ **条件付きで実装可能**（真偽値型ブロックのみ）

### 検証: forever { if c {stop this script}; rest } → repeat until c { rest }

**根拠**:
- 3ブロックが1ブロックになる
- 後続ブロックの挙動を確認が必要

**結論**: ⚠️ **検証中**（後続ブロックのセマンティクスを確認）

---

## 提案9: 正規化による重複検出強化（効果：小〜中、実装は軽い）

### 検証: 可換演算の正規化

**検証方法**: Cast.compare の実装を確認

**検証結果**: ✅ 可能

**根拠**:
- `+`, `*`, `=`, `and`, `or` は可換
- `>` は `<` にオペランドを入れ替えて統一可能
- Cast.compare は反対称性を持つ（v1 < v2 → compare(v1, v2) < 0, compare(v2, v1) > 0）
- したがって、`a > b` は `b < a` と等価

**結論**: ✅ **安全に実装可能**

---

## 提案3: 定数分岐・リスト展開（効果：中〜大）

### 検証: 定数分岐の展開

**根拠**:
- `_propagateConstants` は既に実装済み
- 定数畳み込み後に条件が定数になった `if` / `if-else` を展開
- `repeat 0` や中身が空の `if` を削除

**結論**: ✅ **実装可能**（`_propagateConstants` の拡張）

### 検証: 読み取り専用リストの展開

**根拠**:
- 一度も変更されないリストで、`item (定数) of list` や `length of list` を定数に置換
- 全アクセスが定数インデックスなら、未使用の要素を `""` に潰す

**結論**: ⚠️ **検証中**（リスト変更の追跡が必要）

---

## 提案5: deflateを意識した最適化（効果：中）

### 検証: Zopfli の導入

**根拠**:
- npm zopfli 等を一時環境に導入可能
- zlib より数%縮むことが多い

**結論**: ✅ **実装可能**（外部依存の追加）

### 検証: ID文字集合拡張（約93文字）

**根拠**:
- ASCII の `"` `\` 以外（約93文字）にすると、1文字IDを約93個確保できる
- 現行は62文字（A-Z, a-z, 0-9）

**結論**: ✅ **実装可能**

### 検証: 参照頻度順のID割当

**根拠**:
- 変数IDは配列形式 `[12,name,id]` で大量に出現
- 頻度順に短い名前を割り当てると deflate 後サイズが小さくなる可能性

**結論**: ⚠️ **実測が必要**（生JSONサイズと圧縮後サイズのトレードオフ）

---

## 提案6: スプライト/コスチューム/サウンド名の短縮（効果：中）

### 検証: ガード条件

**根拠**:
- 参照がすべてリテラルのメニュー値であること
- `costume [name]` のような名前を露出するレポーターが無いこと
- `join` などで名前を動的に組み立てる指定が無いこと

**結論**: ⚠️ **検証中**（動的参照の検出が必要）

---

## 提案8: 展開されたコードの再ループ化（効果：大、ただし最も難しい）

### 検証: 等差数列の正規化

**根拠**:
- `go to x:10` / `x:20` / `x:30`… は `change x by 10` に正規化すると、既存のrepeat化に載る
- `switch costume to` の連続も、並び順が分かっていれば `next costume` に正規化できる

**結論**: ⚠️ **検証中**（パターン認識が必要）

### 検証: テーブル駆動

**根拠**:
- 定数だけが違う多数の呼び出しを、定数をリストに格納してループ化
- 生成系・データ埋め込み系のプロジェクトで劇的に効く

**結論**: ⚠️ **検証中**（複雑度高）

---

## 確認点1: repeat化の挙動差（非warpループのyield）

### 検証: 非 warp ループの yield 挙動

**根拠**:
- 非 warp のループは、反復内で再描画が要求されると1反復ごとに次フレームまで待つ
- 展開済みの `move` や `go to` を `repeat` に畳むと、アニメーションの速度が変わり得る
- "run without screen refresh" の中か、本体が再描画を要求しないときだけ畳む条件が必要

**結論**: ⚠️ **検証中**（warp フラグの追跡が必要）

---

## 残りの検証項目

- 提案3: 定数分岐・リスト展開（リスト変更追跡）
- 提案5: deflate意識最適化（実測）
- 提案6: アセット名短縮（動的参照検出）
- 提案8: 再ループ化（パターン認識）
- 確認点1: repeat化の挙動差（warp フラグ追跡）

---

## 優先順位の再評価

提案ドキュメントの推奨優先順位（1・2・5・9）に基づき、検証状況を考慮:

1. **提案1（デッドアセット除去）**: ✅ 実装済み（`_removeDeadAssets` / `pruneAssetEntries`）、効果大
2. **提案2（書き込み専用除去）**: ✅ 実装済み（`_removeWriteOnly`）、効果中
3. **提案5（deflate意識最適化）**: ⏳ 未検証
4. **提案9（正規化による重複検出強化）**: ⏳ 未検証
5. **提案4（型・表現正規化）**: ✅ 実装済み（`_normalizeTypes` / `_stripNullFieldIds` / `_zeroTopLevelCoords`）、効果小〜中

**推奨**: 提案1・2・4は実装・検証済み。提案5・9は実装が軽いので後回しでも可。

---

## 実装後の検証

- `build/check/compress-invariants.mjs`: 提案1・2・4の回帰テスト（不変条件、連続削除の再連結、C ブロック、ループ変数、`sensing_of` 変数、背景のクロスターゲット参照、スプライト名参照、zip アセット削除、モニター ID 一致）
- `build/check/test-new-features.cjs`: `test.sb3` での実測（dead costumes 4 / dead sounds 0 / dead sprites 0 / write-only vars 1 / write-only lists 0 / md5ext 118 / 数値文字列 126）
- Scratch VM でのロード検証: DEF / MAX / KEEP の3構成で、変数・リスト・ブロック参照の不整合 0
- UI 検証（`/sb3/`, `/sb3/ja/`, `/full/`, `/full/ja/`）: ダウンロードしたプロジェクトの JSON サイズ・SHA256・モニター数を確認

---

## 検証日時

- 2026-10-26: 確認点2, 提案1, 提案2, 提案4（一部）
- 2026-10-27: 提案1・2・4の実装に合わせて是正（`sensing_of` の変数参照、書き込み専用の実測値、zip アセット削除、オプションの独立性）
