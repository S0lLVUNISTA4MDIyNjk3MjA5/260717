# Private Dictionary Rule Extraction — Input Projection Contract 0.1

Checkpoint: P2-A2 / A2-2 (design only)

**本checkpointは、決定論的rule extraction処理そのものは実装しない。**
ここで固定するのは「PDF/Excel adapter出力から、後続のterm候補・alias候補抽出処理
（A2-3以降）へ渡すための、安全で検証可能な中間表現（Extraction Input Projection）」の
入力契約だけである。抽出ルール本体・候補生成・SESSION登録・P2-A1 dictionary entryへの
変換は、すべて後続checkpointの対象であり、本Contractは対象としない。

---

## 0. 前提（P2-A1調査結果からの継承）

Checkpoint A2-1調査で確認済みの事実を、本Contractの前提として明記する。

- `tools/knowledge_builder/core/pdf_direct_adapter.js` / `excel_direct_adapter.js` は
  それぞれ独立した純関数群であり、KnowledgeNode/KnowledgeEdge/SourceDocumentを生成する
  （既存Knowledge Data Contract 0.1準拠）。P2-A2はこれらのファイルを一切変更しない。
- `tools/knowledge_builder/core/id_hash_utils.js`（`KnowledgeIdHashUtils`）は
  `normalize` / `hashParts` / `canonicalJson` / `id128` / `encodeUtf8Netstring` を提供する。
  P2-A2は将来のcore実装でこれらを**そのまま**再利用する（このファイルも変更しない）。
- `tools/knowledge_builder/core/private_dictionary_learning_core.js` は
  `entry.utility` の7項目（`exposure_count` 等）を**非負整数として必須**とし、
  `entry.source.kind` に `'DOCUMENT_EXTRACTED'` を含み、かつ
  「初期status制約はP2-A2の新規生成時policyであり、snapshot validationはここでは
  検査しない」という実装コメントを既に持つ（同ファイル651-653行目付近）。
  これは、P2-A1 validatorが `status:'ACTIVE'` や `scope:'DOMAIN'/'PROJECT'` を
  技術的に拒否しないことを意味し、**PROBATION/SESSION限定はP2-A2側が自前で強制する
  責務**であることを本Contractの前提とする（§16で再確認する）。
- Knowledge Data Contract 0.1 §11は `aliases` / `external_ids` をNode向けの将来拡張
  予約名として確保済み。本Contractはこれらの名前と衝突するfieldをKnowledgeNodeへ
  追加しない（P2-A2の「alias候補」はNodeとは別の独立schemaで表現する）。

---

## 1. Scope

P2-A2は、既存PDF／Excel adapter出力（KnowledgeNode配列およびSourceDocument）から
安全なprojectionを生成し、後続の決定論的rule extraction（A2-3以降）へ渡すための
入力契約である。本checkpoint（A2-2）は、このprojectionの**schemaとvalidation方針の
設計**のみを行う。抽出処理そのものの実装は行わない。

---

## 2. 処理境界

- local-only。networkアクセスなし。
- external AI通信なし。
- projection構築処理はfilesystemへ直接アクセスしない（adapterが既に返した
  KnowledgeNode/SourceDocumentオブジェクトのみを入力とする）。
- 元ファイル（PDF/Excelの実バイト列）の再読込は行わない。
- adapter出力（KnowledgeNode/KnowledgeEdge/SourceDocument）は読み取り専用として扱う。
  projection構築は新しいオブジェクトを生成するだけであり、入力を変更しない（§15）。
- Knowledge DataSetへの書込み（`knowledge_store.js` の `ingestAdapterResult` 等）は
  一切呼び出さない。
- private dictionaryへのmerge・matching engineのmatching score変更は行わない。
- UI変更・persistence（保存・自動保存・自動ダウンロード）は行わない。

---

## 3. Projection Top-level Schema

```jsonc
{
  "schema_version": "private-dictionary-rule-extraction-input/0.1", // 必須。const
  "source_kind": "PDF",                      // 必須。"PDF" | "EXCEL"
  "source_document_id": "sd-<32桁hex>",      // 必須。adapterのSourceDocument.source_document_idをそのまま参照
  "document_fingerprint": "<64桁hex>",       // 必須。§7参照
  "content_export_included": false,          // 必須。const false。§3.1参照
  "units": [ /* §4 */ ]                      // 必須。空配列は許容しない（§12: 最低1件）
}
```

top-level fieldはこの6個に固定する。未知fieldは拒否する（§12）。

### 3.1 `content_export_included`（field名の変更提案とその理由）

指示書の `content_included` をそのまま採用すると、「このprojectionは
`normalized_text` という限定的なtext保持を内部に持っている」という事実と
矛盾しているように誤読される。実際には2つの別概念が存在する。

| 概念 | 意味 | 本Contractでの扱い |
|---|---|---|
| ローカル処理用の限定的text保持 | rule extractionのために各unitが`normalized_text`（正規化済み・境界内の文字列）を保持すること | 常に発生する。これ自体は禁止していない |
| 外部向けcontent inclusion | このprojectionオブジェクトを、外部向けexport・summary・conflict token・error等の**境界外**の成果物へ、生テキストを含む形でそのまま転記してよいか | 常に `false`。P2-A2のいかなる外部出力（report/summary/error）も、`normalized_text`をそのまま埋め込まない |

このため、field名を **`content_export_included`** に変更して提案する
（P2-A1の `entry.source.content_included` と意味は対応させつつ、
「projection内部のtext保持」と「境界外export可否」を名前レベルで区別する）。
値は固定 `false`。将来 `true` を許す設計変更は本Contractの対象外。

---

## 4. Unit Schema

```jsonc
{
  "source_unit_id":        "psu-<32桁hex>",  // 必須。決定的・projection内で一意（§14）
  "structural_role":       "BODY_STATEMENT", // 必須。enum（§5）
  "normalized_text":       "空調ユニットは...", // 必須。§6の正規化規則に従う。空文字列不可
  "occurrence_ordinal":    12,               // 必須。0以上の整数。projection内で一意・昇順（§14）
  "provenance_ref_id":     "pref-<32桁hex>", // 必須。§7/§8参照
  "parent_source_unit_id": "psu-<32桁hex>"   // 必須field（値はnull許容）。§4.1参照
}
```

unit fieldはこの6個に固定する。未知fieldは拒否する（§12）。

### 4.1 `parent_source_unit_id`

- 該当する親unitが存在する場合のみ、その親の `source_unit_id` を指す。
- 該当しない場合（document直下のunit、または「親」という概念自体が
  意味を持たないunit）に限り `null` を許可する。
- 自己参照（`parent_source_unit_id === source_unit_id`）は常に拒否する（§12）。
- 循環参照（親を辿った結果、自分自身に戻る）は常に拒否する（§12）。

---

## 5. `structural_role`

### 5.1 方針

現行adapter（`pdf_direct_adapter.js` / `excel_direct_adapter.js`）が実際に生成する
Node構造・field値から**根拠を持って導出できるroleだけ**をこのcheckpointで
「対応済み」として定義する。根拠のないroleは予約すら追加しない
（指示書「現行adapterから根拠を持って生成できないroleを予約だけで追加しないでください」）。
未対応のroleを検出した場合、`BODY_STATEMENT` へ黙って fallback することは禁止する
（§12: `EXTRACTION_INPUT_UNSUPPORTED_STRUCTURAL_ROLE` で拒否する）。

### 5.2 対応済み role（このcheckpointで採用）

| role | 適用source_kind | 根拠（adapter側の実データ） |
|---|---|---|
| `DOCUMENT_TITLE` | PDF, EXCEL | 両adapterとも、document Node（`node_type:'document'`）を必ず1件生成し、その `text`/`title` はファイル名（`opts.fileName`）に決定的に一致する。空・欠落はない。 |
| `SECTION_HEADING` | PDF | 非synthetic section Node（`provenance.extensions.synthetic === false`）の `title`。`matchFixedHeadingLine()` が実際に検出した見出し行のテキストであり、fabricationではない。 |
| `BODY_STATEMENT` | PDF | statement Node（`node_type:'statement'`）の `text`（=`normalizedText`、段落単位）。 |
| `SHEET_NAME` | EXCEL | section Node（sheet）の `text` = `extraction.sheetName`。 |
| `ROW_RECORD` | EXCEL | statement Node（1行=1Node）の `text`（"見出し: 値 / ..." 形式の連結済みテキスト）。 |
| `KEY` | EXCEL | statement Nodeの `provenance.verbatim.source_record` のキー（列見出し文字列）を、行Nodeから分解して得る（§5.4）。 |
| `VALUE` | EXCEL | statement Nodeの `provenance.verbatim.source_record_display`（表示値）を、同じく行Nodeから分解して得る（§5.4）。 |

### 5.3 除外・予約（このcheckpointでは非対応。理由付き）

| role | 状態 | 理由 |
|---|---|---|
| PDFのsynthetic section（`本文`固定タイトル） | **projection対象外**（unit化しない） | `本文` は実文書の見出しテキストではなく、adapterが挿入した固定placeholderである。これを `SECTION_HEADING` として扱うと、実在しない「見出し語」を候補抽出の根拠にしてしまう。§5.4に除外規則を明記する。 |
| `TABLE_HEADER` | **予約のみ・未実装** | Excel adapterは「物理的なヘッダー行」を独立したNode/locatorとして生成しない（ヘッダー行自体はcontent Node化されず、`extraction.headers`という行Nodeの付帯メタデータとしてのみ存在する）。ヘッダー文字列そのものの実体は `KEY` roleで既にprojection可能であり、`TABLE_HEADER` を別途追加すると同一根拠に対して2つのroleが存在することになり、指示書の「曖昧にならないenumを定義」に反する。将来、adapterがヘッダー行に独立したlocator/Node粒度を持つよう変更された場合にのみ再検討する。 |
| `TABLE_CELL` | **予約のみ・未実装** | 同上の理由。個々のセルへの独立したlocator（セル参照等）は現行adapter出力に存在せず、`VALUE` roleが同じ根拠（`source_record_display`の1エントリ）を表す。 |

### 5.4 EXCELにおけるROW_RECORDからのKEY/VALUE分解規則

1つの `ROW_RECORD` unit（adapterの行Node由来）に対し、その `provenance.verbatim.source_record`
（キー: 列見出し文字列, 値: 生値）と `source_record_display`（表示値）を、
列の出現順（`extraction.headers` の並び = 実効範囲の列index昇順。既にadapter側で
決定的に固定されている）に走査し、列ごとに次の2つの子unitを生成する。

- `KEY` unit: `normalized_text` = その列の見出し文字列（正規化後）
- `VALUE` unit: `normalized_text` = その列の表示値（`cellTextValue()`相当。正規化後）

両unitの `parent_source_unit_id` は、分解元 `ROW_RECORD` unitの `source_unit_id` を指す
（`KEY` と `VALUE` は互いに親子ではなく兄弟）。`provenance_ref_id` は両者で**同一の値**を
用いる（§7/§8: 同一セル＝同一(行,列)原点を指すため）。`occurrence_ordinal` は
`KEY` → `VALUE` の順で個別に割り当てる（§14）。

表示値・見出しがともに空欄の列（元々`cellHasContent()`がfalseの列）は
`KEY`/`VALUE`いずれも生成しない（空の `normalized_text` を持つunitを作らない。§12）。

### 5.5 PDFにおけるsynthetic section除外規則

`segmentPdfContent()` が返す section のうち `synthetic === true` のものは、
`SECTION_HEADING` unitを生成しない。ただし、そのsynthetic section配下の
`BODY_STATEMENT`（paragraph）unitは通常どおり生成する
（`parent_source_unit_id` はdocument unitを指す。中間のsection unitが
存在しないため）。

---

## 6. normalized_text 生成責任

**呼出側が渡した `normalized_text` をそのまま信用しない。** 採用方式は
指示書の選択肢1：

> projection constructorがNodeの`text`/`title`から正規化する。

正規化規則（PDF/Excel共通・一律適用。source_kindによって規則を変えない）:

1. Unicode NFKC正規化
2. CR / LF / TAB を半角スペースへ変換
3. 連続する空白の圧縮（1個へ）
4. 先頭・末尾のtrim

この規則は `pdf_direct_adapter.js` の `normalizePdfText()` と同一である。
**PDF側の `text` は既にadapter内部でこの正規化を経ているが、projection
constructorは「既に正規化済みだから」と信用せず、無条件に同じ正規化を
再適用する**（べき等な操作なので副作用はない）。これにより、将来
adapter内部の正規化実装が変わっても、projection側の契約が独立して
安定する。

**Excel側の `text`（`deriveText()`）はNFKC正規化を行っていない。**
projection constructorが独自にNFKC正規化を適用して初めて、PDF/Excel
共通の `normalized_text` 契約を満たす。

### 6.1 ASCII case folding

推奨方式を採用する: **保存する `normalized_text` はcaseを保持する
（大文字小文字を変更しない）**。比較用key（ASCII case-fold済み）は
projection schemaの一部としては**永続化しない**。比較が必要な場面
（将来のrule extraction時の一致判定）では、既存adapterの
`foldForTagCompare()`相当のロジックを、その都度 `normalized_text` から
算出する（P2-A1 の `normalize()` とは別の、比較専用の一時的な変換であり、
projectionの永続fieldには含めない）。

### 6.2 text fingerprintを併用しない理由

指示書の選択肢2（normalized textとdeterministic text fingerprintを
組で持つ）は採用しない。理由: unit schema（§4）を6 fieldに固定する
方針と整合させるため、fingerprintという追加fieldを持たない。
再現性の検証はA2-7の検証スイート側（同一入力から同一projectionが
再構築されることをテストで確認する）に委ねる。

---

## 7. document_fingerprint

**P2-A2 coreは元ファイルのバイト列へアクセスしない。** `document_fingerprint`
は、adapterの呼び出し元が既に計算し `opts.contentDigest` として渡し、
`SourceDocument.content_digest` に格納済みの値（実ファイルのSHA-256）を
**そのまま参照する**。P2-A2側で再計算・再読込は行わない。

**元文書fingerprint（`document_fingerprint` = `SourceDocument.content_digest`）と、
projection自体のcanonical fingerprint（projectionのunits配列内容から算出する
ハッシュ）は別概念であり、混同しない。** 後者は本checkpointのtop-level schema
（§3）には含めない。§18（未解決事項）で扱いを保留する。

---

## 8. provenance

最低限、次の4つが「provenance境界」を構成する。

- `source_document_id`（projection top-level。§3）
- `source_unit_id`（unit毎。§4）
- `provenance_ref_id`（unit毎。§4）
- `occurrence_ordinal`（unit毎。§4）

`provenance_ref_id` の値の意味:

- adapterのKnowledgeNodeに1:1対応するunit（`DOCUMENT_TITLE` /
  `SECTION_HEADING` / `BODY_STATEMENT` / `SHEET_NAME` / `ROW_RECORD`）では、
  そのNodeの `node_id`（既存の `kn-<32桁hex>` 形式）をそのまま
  `provenance_ref_id` として再利用する。
- 行Nodeから分解された `KEY`/`VALUE` unit（§5.4）では、既存Nodeに
  対応する `node_id` が存在しないため、新しい決定的IDを
  `id_hash_utils.js` の `id128()` を使って算出する（**実装はA2-2の
  対象外。ここではID算出の方針のみを固定する**）。namespaceは
  P2-A1・既存adapterのnamespace（`'knowledge-node-id-v1'` 等）と
  衝突しない新規文字列（例: `'private-dictionary-rule-extraction-provenance-ref-v1'`）
  とし、partsに親ROW_RECORDの `node_id` と列位置を含める。同一セルに
  由来する `KEY`/`VALUE` unitは**同一の `provenance_ref_id` を共有する**
  （§5.4）。

**セクション名・シート名・見出しテキスト・列見出し名など、private termを
含み得るfieldは、error・summary・conflict tokenへ一切出力しない。**
error/summary/conflict recordで安全に使ってよいのは `source_unit_id` /
`provenance_ref_id` / `structural_role` / `occurrence_ordinal` /
`source_document_id` のみであり、`normalized_text` はこれらの文脈へ
一切転記しない（P2-A1のraw term漏洩禁止方針をprojection層でも継承する）。

---

## 9. path／locator安全性

- projection schema（top-level・unit level）のいずれにも `source_path` /
  ファイルシステムpathに相当するfieldを**含めない**（指示書の推奨に従う）。
- ただし、hostileな入力・不正なfixtureに対する多層防御として、validationは
  **schemaに存在するすべての文字列値**（`source_unit_id` /
  `provenance_ref_id` / `parent_source_unit_id` / `document_fingerprint` /
  `normalized_text` を含む）に対し、次のパターンを検出したら拒否する
  （`EXTRACTION_INPUT_PATH_LIKE_VALUE_REJECTED`）:
  - 絶対Unixパス（`/`始まり）
  - Windowsドライブパス（`C:\` 等）
  - UNCパス（`\\`始まり）
  - `..` パスセグメントを含むもの
  - `file:` URI
  - `http:` / `https:` URI
  - モジュールパス（`./` / `../` で始まる相対パス、または `node_modules` を
    含む文字列）
- これは「特定のfieldだけを見る」のではなく、**projection全体の文字列値
  すべてに対する横断的検査**として設計する（特定fieldの存在を前提にしない
  ため、将来fieldが増えても抜け漏れが起きにくい）。

---

## 10. metrics（本checkpointでは含めない）

**Input Projection Contract（本Contract）にはmetricsを含めない。**

理由: `exposure_count` 等7項目は「候補（candidate）」に対する評価指標であり、
本Contractが扱う「adapter出力の安全な射影」の段階では、まだ候補というもの
自体が存在しない。指示書の提案どおり、責務分離の原則に従い、metrics schema
（`metrics`/`unmeasured_metrics` の組を含む）は **A2-3以降のcandidate output
contractで新規に定義する**。本Contractのtop-level schema（§3）・unit
schema（§4）のいずれにもmetrics関連fieldは存在しない。

（参考: P2-A1の `entry.utility` は非負整数を必須とし「未計測」を表現できない
ため、A2-3以降で定義するmetrics schemaはP2-A1の`utility`shapeとは独立した
別schemaとする。Checkpoint A2-1報告の項目8で既に指摘済み。）

---

## 11. Error Contract

P2-A1の内部実装（`dictError`/`isSanitizedDictionaryError` 等、いずれも
`private_dictionary_learning_core.js`の非exportな内部関数）への暗黙の依存
としてではなく、**独立したcontractとして**、同じ外部セキュリティ方針
（frozen plain object・Errorインスタンス禁止・raw content禁止）に適合する
形で定義する。

外部へthrow可能な値は、次の形だけに制限する。

```jsonc
{
  "code": "EXTRACTION_INPUT_<FIXED_CODE>",
  "path": "$"
}
```

- plain object（`Object.getPrototypeOf(value) === Object.prototype`）
- `Object.isFrozen(value) === true`
- own keyは `code` と `path` の2つだけ（`Reflect.ownKeys()` で厳密一致）
- 各propertyは data property（accessorではない）・
  `enumerable:true, writable:false, configurable:false`
- `code` は固定コード一覧（§12）に属する文字列のみ
- `path` は `$` から始まる、§14のcanonical field order・
  allowlisted field名のみで構成されるJSONPath風文字列

**禁止事項**（すべて）: `Error` インスタンス, `message`, `stack`, `name`,
raw term（正規化前後を問わず抽出対象の生テキスト）, raw alias,
シート名・セクション名そのものの値, filesystem path, module path,
依存先ライブラリの生エラー内容, symbol, 非enumerableな隠しproperty。

`path` のallowlisted field名（P2-A1のものとは独立集合。§3/§4のfield名の
みで構成する）:

```
schema_version, source_kind, source_document_id, document_fingerprint,
content_export_included, units, source_unit_id, structural_role,
normalized_text, occurrence_ordinal, provenance_ref_id,
parent_source_unit_id
```

---

## 12. Fail-closed Validation

最低限、次の検査をfail-closedで行う。各行にエラーコード案を対応させる
（コード自体はA2-2時点での設計案。core実装時に最終確定する）。

| 検査項目 | エラーコード案 |
|---|---|
| top-level未知field拒否 | `EXTRACTION_INPUT_UNKNOWN_TOP_LEVEL_FIELD` |
| unit未知field拒否 | `EXTRACTION_INPUT_UNKNOWN_UNIT_FIELD` |
| symbol key拒否 | `EXTRACTION_INPUT_SYMBOL_KEY_REJECTED` |
| non-enumerable extra field拒否 | `EXTRACTION_INPUT_NON_ENUMERABLE_FIELD_REJECTED` |
| accessor property拒否 | `EXTRACTION_INPUT_ACCESSOR_PROPERTY_REJECTED` |
| custom prototype拒否（`Object.prototype`以外） | `EXTRACTION_INPUT_CUSTOM_PROTOTYPE_REJECTED` |
| `source_unit_id`重複拒否 | `EXTRACTION_INPUT_DUPLICATE_SOURCE_UNIT_ID` |
| `parent_source_unit_id`が存在しないunitを指す場合の拒否 | `EXTRACTION_INPUT_INVALID_PARENT_REFERENCE` |
| self-parent拒否 | `EXTRACTION_INPUT_SELF_PARENT_REJECTED` |
| parent cycle拒否 | `EXTRACTION_INPUT_PARENT_CYCLE_DETECTED` |
| `occurrence_ordinal`が非負整数でない場合の拒否 | `EXTRACTION_INPUT_INVALID_OCCURRENCE_ORDINAL` |
| `occurrence_ordinal`重複の扱い（§12.1） | `EXTRACTION_INPUT_DUPLICATE_OCCURRENCE_ORDINAL` |
| `source_kind`が `"PDF"`/`"EXCEL"` 以外の場合の拒否 | `EXTRACTION_INPUT_INVALID_SOURCE_KIND` |
| 未対応`structural_role`拒否（§5.3。`BODY_STATEMENT`への暗黙fallback禁止） | `EXTRACTION_INPUT_UNSUPPORTED_STRUCTURAL_ROLE` |
| 空`normalized_text`拒否 | `EXTRACTION_INPUT_EMPTY_NORMALIZED_TEXT` |
| UTF-8バイト数上限超過拒否（projection全体。§13） | `EXTRACTION_INPUT_UTF8_BYTES_LIMIT_EXCEEDED` |
| unit数上限超過拒否（§13） | `EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED` |
| `normalized_text`長さ上限超過拒否（§13） | `EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED` |
| 親子nesting深さ上限超過拒否（§13） | `EXTRACTION_INPUT_NESTING_LIMIT_EXCEEDED` |
| `document_fingerprint`形式不正拒否（64桁hex以外） | `EXTRACTION_INPUT_INVALID_FINGERPRINT` |
| `provenance_ref_id`/`source_unit_id`形式不正拒否 | `EXTRACTION_INPUT_INVALID_PROVENANCE_REFERENCE` |
| path様文字列値拒否（§9） | `EXTRACTION_INPUT_PATH_LIKE_VALUE_REJECTED` |
| root自体がplain objectでない場合の拒否 | `EXTRACTION_INPUT_ROOT_NOT_OBJECT` |

### 12.1 `occurrence_ordinal` 重複の扱い（方針決定）

**重複は常に拒否する。例外を設けない。** `KEY`/`VALUE`のように同一
`provenance_ref_id`を共有するunitのペアであっても、`occurrence_ordinal`
自体は個別の値を持たなければならない（§5.4・§14: `KEY`→`VALUE`の順で
個別採番）。これにより、「provenance共有は許すが順序は常に一意」という
単純で誤解のないルールになる。

---

## 13. Bounds

すべて一つの定数表として定義する（core実装時にこの表をそのまま定数化する）。

| 定数 | 値（案） | 理由 |
|---|---|---|
| `MAX_INPUT_UTF8_BYTES` | 8,388,608（8 MiB） | 個々のunit数・text長の上限（下記）から積み上げた安全側の総量上限。主たる制御は`MAX_UNITS`/`MAX_NORMALIZED_TEXT_LENGTH`であり、これはそれらを補完する多層防御の総量backstop。 |
| `MAX_UNITS` | 200,000 | Excel adapterの`MAX_MEANINGFUL_RANGE_CELLS`(500,000)やPDF adapterの`MAX_STATEMENTS`(50,000)を踏まえた技術的上限ではなく、**SESSION scopeでの人間レビューが現実的に成立する規模**を基準に、adapter側上限より意図的に厳しく設定する。数十万unit規模のprojectionは、そもそもPROBATION候補としてレビュー可能な量ではなく、この上限を超える文書/シートは呼び出し側での事前絞り込み・分割が必要（絞り込み処理自体はA2-2の対象外）。 |
| `MAX_NORMALIZED_TEXT_LENGTH` | 4,000（文字数） | 一般的な技術文書の段落・セル値を十分収める長さ。これを超えるテキストは「1 unitとして扱うべき粒度ではない」構造的な兆候とみなし、切り詰めではなく拒否する（切り詰めはevidenceを損なうため採用しない）。 |
| `MAX_ID_LENGTH` | 80（文字数） | `id128()`が生成する実際のID長（prefix込みで最大40文字程度）に対し、十分な安全余裕を持たせた上限。正確な文字クラス・正規表現はcore実装時に確定する。 |
| `MAX_PARENT_DEPTH` | 6 | 現行adapterが生成しうる最大の親子連鎖は document→section→row_record→(key\|value) の4段。将来の軽微な拡張余地を見込み、破壊的なcontract改定なしに吸収できるよう余裕を持たせた値。 |
| `MAX_DISTINCT_PROVENANCE_REFERENCES` | `MAX_UNITS`と同値（200,000） | `KEY`/`VALUE`ペアが`provenance_ref_id`を共有する設計（§5.4）により、実際の使用値は`MAX_UNITS`を常に下回る。安全側の単純な上限として`MAX_UNITS`と同値に固定する。 |

**全unit間の全直積（総当たり）を前提にした上限設計は行わない。** 上記は
いずれも「1projectionあたりの単純な件数・長さ上限」であり、A2-3以降の
候補抽出ロジックが独自にO(n²)的な組合せ処理を行う場合は、そちらの
checkpointで別途、対象を絞る仕組み（同一`provenance_ref_id`内限定、
隣接`occurrence_ordinal`限定等）を設計する。本Contractの責務は入力側の
サイズ上限までとする。

---

## 14. Determinism

- **ordinal comparator**: 数値は厳密な数値比較（`a - b`）。文字列ID
  （`source_unit_id`等）はP2-A1の`ordinalCompare(a,b){return a<b?-1:a>b?1:0;}`
  と同一パターンの、コードポイント順の厳密比較を用いる。
- **`localeCompare()`禁止**。文字列比較は上記のordinal比較のみを用いる。
- **canonical field order**（固定順序。シリアライズ時はこの順序で出力する）
  - top-level: `schema_version, source_kind, source_document_id, document_fingerprint, content_export_included, units`
  - unit: `source_unit_id, structural_role, normalized_text, occurrence_ordinal, provenance_ref_id, parent_source_unit_id`
- **canonical unit order**: `units` 配列は `occurrence_ordinal` の昇順で
  格納する。projection constructorはこの順序で構築する責務を持ち、
  validationは配列index順と`occurrence_ordinal`の昇順が一致することを
  追加のsanity checkとして検証してよい（§12の`occurrence_ordinal`検査群に
  含める）。
- **input orderを意味として保持するfield**: `occurrence_ordinal`
  （元文書中の出現順そのものを表す。A2-3以降の「見出しの直後の本文」等、
  隣接性に基づく抽出ルールの根拠になる）。
- **input orderに依存してはいけないfield**: `source_unit_id` /
  `provenance_ref_id` / `document_fingerprint`。これらは内容から決定的に
  導出される値であり、構築時の反復順序や配列位置に一切依存しない
  （同じ入力Nodeから何度projectionを再構築しても同じ値になる）。
- **duplicateの判定方法**: `source_unit_id`の重複判定は正規化なしの
  厳密な文字列完全一致で行う（IDは既に決定的なhash由来のトークンであり、
  人間可読テキストの表記ゆれ吸収は不要）。

---

## 15. Non-mutation

- projection constructorは、入力として受け取るKnowledgeNode/KnowledgeEdge/
  SourceDocument/DataSetのいずれも変更しない。
- projection（top-levelオブジェクト・各unitオブジェクト）は、既存Nodeへの
  参照ではなく、**すべて新規に生成したplain objectで構成する**。
- core実装時には、P2-A1の`deepFreezeCopyPrivateDictionary`と同様の
  deep-freeze（またはmutation検知）を、構築済みprojectionに対して適用する
  ことを推奨する（本checkpointでは設計上の推奨のみであり、実装はしない）。

---

## 16. P2-A1との接続境界

- A2-2では、P2-A1の`validatePrivateDictionary`等のvalidator関数を一切
  呼び出さない。
- A2-2では、P2-A1の`entry`（dictionary entry）を一切生成しない。
- A2-2では、`scope`（`SESSION`等）や`status`（`PROBATION`等）を一切生成
  しない。本Contractのprojection/unitのいずれにも、これらに相当するfield
  は存在しない。
- `SESSION`スコープ・`PROBATION`ステータスの強制は、**後続のA2-5
  （SESSION候補projection）でのみ**行う。
- P2-A1のsnapshot validator（`validatePrivateDictionary`）は、
  `status:'ACTIVE'`や`scope:'DOMAIN'/'PROJECT'`を持つ`DOCUMENT_EXTRACTED`
  entryを技術的には拒否しない（§0参照）。したがって、A2-5以降の
  実装は、**P2-A1側の検証に頼らず、P2-A2自身の生成ロジックの中で**
  PROBATION/SESSION限定を強制しなければならない。

---

## 17. 付録: illustrative examples（設計検証用。fixtureファイルではなくcontract内埋め込み）

本checkpointでは、独立したfixtureファイルは作成せず、本Contract内に
例示として埋め込む（作成ファイルを設計文書1点に限定するため）。
別途fixtureファイルとして切り出すかどうかは§18の未解決事項とする。

### 17.1 PDF由来projectionの例

```jsonc
{
  "schema_version": "private-dictionary-rule-extraction-input/0.1",
  "source_kind": "PDF",
  "source_document_id": "sd-0123456789abcdef0123456789abcdef",
  "document_fingerprint": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a1",
  "content_export_included": false,
  "units": [
    {
      "source_unit_id": "psu-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "structural_role": "DOCUMENT_TITLE",
      "normalized_text": "customer_hvac_requirements.pdf",
      "occurrence_ordinal": 0,
      "provenance_ref_id": "kn-1111111111111111111111111111111",
      "parent_source_unit_id": null
    },
    {
      "source_unit_id": "psu-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "structural_role": "SECTION_HEADING",
      "normalized_text": "第2章 使用条件",
      "occurrence_ordinal": 1,
      "provenance_ref_id": "kn-2222222222222222222222222222222",
      "parent_source_unit_id": "psu-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    {
      "source_unit_id": "psu-cccccccccccccccccccccccccccccccc",
      "structural_role": "BODY_STATEMENT",
      "normalized_text": "空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。",
      "occurrence_ordinal": 2,
      "provenance_ref_id": "kn-3333333333333333333333333333333",
      "parent_source_unit_id": "psu-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ]
}
```

### 17.2 EXCEL由来projectionの例（KEY/VALUE分解を含む）

```jsonc
{
  "schema_version": "private-dictionary-rule-extraction-input/0.1",
  "source_kind": "EXCEL",
  "source_document_id": "sd-fedcba9876543210fedcba9876543210",
  "document_fingerprint": "3b23e807dc0c0c9c8dc4d8f7b4c0f8d1e6a2c4b6d8f0a2c4e6b8d0f2a4c6e8b0",
  "content_export_included": false,
  "units": [
    {
      "source_unit_id": "psu-dddddddddddddddddddddddddddddddd",
      "structural_role": "DOCUMENT_TITLE",
      "normalized_text": "design_review.xlsx",
      "occurrence_ordinal": 0,
      "provenance_ref_id": "kn-4444444444444444444444444444444",
      "parent_source_unit_id": null
    },
    {
      "source_unit_id": "psu-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "structural_role": "SHEET_NAME",
      "normalized_text": "設計検討表",
      "occurrence_ordinal": 1,
      "provenance_ref_id": "kn-5555555555555555555555555555555",
      "parent_source_unit_id": "psu-dddddddddddddddddddddddddddddddd"
    },
    {
      "source_unit_id": "psu-ffffffffffffffffffffffffffffffff",
      "structural_role": "ROW_RECORD",
      "normalized_text": "部品番号: A-102 / 名称: 制御弁 / 数量: 4",
      "occurrence_ordinal": 2,
      "provenance_ref_id": "kn-6666666666666666666666666666666",
      "parent_source_unit_id": "psu-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    },
    {
      "source_unit_id": "psu-1111111111111111111111111111111a",
      "structural_role": "KEY",
      "normalized_text": "名称",
      "occurrence_ordinal": 3,
      "provenance_ref_id": "pref-7777777777777777777777777777777",
      "parent_source_unit_id": "psu-ffffffffffffffffffffffffffffffff"
    },
    {
      "source_unit_id": "psu-2222222222222222222222222222222b",
      "structural_role": "VALUE",
      "normalized_text": "制御弁",
      "occurrence_ordinal": 4,
      "provenance_ref_id": "pref-7777777777777777777777777777777",
      "parent_source_unit_id": "psu-ffffffffffffffffffffffffffffffff"
    }
  ]
}
```

---

## 18. 未解決事項（Open Questions）

次回以降のcheckpoint、または本Contractの改訂で判断する。

1. **projection自体のcanonical fingerprint**（§7で言及した「projection
   fingerprint」）を、top-level schemaへ正式に追加すべきか。現時点では
   追加していない（§3のtop-level schemaは6 fieldに固定）。追加する場合、
   `document_fingerprint`との混同を避けるため別field名（例:
   `projection_content_fingerprint`）が必要になる。
2. **heading_confidence（`high`/`low`）をunit schemaへ反映すべきか。**
   現行adapterは見出し検出のconfidenceを持つが、本Contractのunit schema
   （§4）はこれを含めていない。A2-3のrule設計で必要になった場合、
   unit schemaの拡張（非破壊的な追加）として再検討する。
3. **fixtureを独立ファイルとして切り出すか。** 本checkpointでは§17の
   埋め込み例のみとした。A2-3以降のcore実装・検証スイート設計で、
   `tools/knowledge_builder/verification/fixtures/` 配下への正式な
   fixtureファイル追加が必要になった時点で行う。
4. **`MAX_ID_LENGTH`の正確な正規表現形式**（§13）は、core実装時に
   `id128()`の実出力形式を踏まえて最終確定する。
5. **`EXTRACTION_INPUT_*` エラーコード一覧の最終確定**は、実際の
   core実装（A2-3以降）で、本Contract §11/§12の設計を土台に行う。
   本checkpointでの一覧はあくまで設計案。
