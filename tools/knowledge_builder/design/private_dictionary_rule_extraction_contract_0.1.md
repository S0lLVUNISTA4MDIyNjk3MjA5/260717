# Private Dictionary Rule Extraction — Input Projection Contract 0.1

Checkpoint: P2-A2 / A2-2R3（constructor bounds error contractの欠落を解消した修正版）

**本checkpointは、決定論的rule extraction処理そのものは実装しない。**
ここで固定するのは「PDF/Excel adapter出力から、後続のterm候補・alias候補抽出処理
（A2-3以降）へ渡すための、安全で検証可能な中間表現（Extraction Input Projection）」の
入力契約だけである。抽出ルール本体・候補生成・SESSION登録・P2-A1 dictionary entryへの
変換は、すべて後続checkpointの対象であり、本Contractは対象としない。

**A2-2Rでの変更点（サマリ）**: §9（ID Contract）を新設し、全ID形式・生成材料を
確定した。これに伴い、`provenance_ref_id`はKEY/VALUEユニット間で共有せず、
各unitごとに独立した値を持つよう設計を変更した（A2-2案からの変更。理由は§9.3）。
error contractを§13の完全な表として確定した。validationのTier構造・戻り値形式・
決定論的な順序を§14で確定した。boundsに`MAX_COLUMNS_PER_ROW` /
`MAX_CHILDREN_PER_PARENT`を追加した（§15）。occurrence_ordinalの割当アルゴリズムを
§16で確定した。Constructor Trust Boundaryを§18として新設した。A2-2報告の
未解決事項はすべて本版で解消した（§21）。

**A2-2R2での変更点（サマリ・GitHub独立レビュー findings対応）**: Finding 1 —
`normalized_text`に対するpath/URI様文字列拒否（`EXTRACTION_INPUT_PATH_LIKE_VALUE_REJECTED`）
を廃止した（§10）。文書本文がpath/URLを含むことは正常なcontentであり、
文字列の見た目とfilesystem/networkアクセスの可否は無関係であるため
（constructorはいかなる場合もpath/URIをdereferenceしない。§2/§10）。
Finding 2 — Excelの`source_record`/`source_record_display`読取りを、
`Object.getOwnPropertyDescriptor()`ベースのdescriptor方式へ全面的に置換した
（§11.2。旧`hasOwnProperty.call`方式を置換）。Finding 3 — Constructor Trust
Boundary（§18）を、独立した防御層としてではなく、§13/§14の単一の固定error
contractへ統合した。constructorが投げうる値も`{code,path}`の同一shapeのみで
あり、既存Tier A codeの一部を再利用しつつ、constructor固有の7種を新規に
定義した（§14.4 Tier C）。これに伴いerror code総数は30→36種（Tier A 6種
[validator/constructor共用] + Tier B 23種 + Tier C固有7種）に更新した。
top-level schema（§3）・unit schema（§4）・illustrative examples（§20）は
変更していない。

**A2-2R3での変更点（サマリ・constructor bounds error contractの確定）**:
GitHub独立確認により、constructorが§15.1のbounds違反（`MAX_UNITS`分解前
見積り超過・分解中実件数超過、`MAX_COLUMNS_PER_ROW`超過、構築時canonical
UTF-8サイズ超過）を検出した際の固定codeが未定義であることが判明した。
`EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED`と
`EXTRACTION_INPUT_UTF8_BYTES_LIMIT_EXCEEDED`をvalidator/constructor共用に、
新規`EXTRACTION_INPUT_COLUMNS_PER_ROW_LIMIT_EXCEEDED`をconstructor専用に
追加した（§13/§14.3/§14.4/§15.1/§23）。§15.1の見積りアルゴリズムを、
列数チェック先行・残容量比較後加算・短絡による安全な逐次処理へ確定した。
`MAX_CHILDREN_PER_PARENT`の説明にあった「B-22」の誤記を「B-21」へ訂正
した（§15）。error code総数は36→37種に更新した（Tier A 6種
[validator/constructor共用] + Tier B 23種[うち2種はconstructorとも共用]
+ Tier C固有8種）。top-level schema（§3）・unit schema（§4）は変更
していない。

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
  責務**であることを本Contractの前提とする（§19で再確認する）。
- Knowledge Data Contract 0.1 §11は `aliases` / `external_ids` をNode向けの将来拡張
  予約名として確保済み。本Contractはこれらの名前と衝突するfieldをKnowledgeNodeへ
  追加しない（P2-A2の「alias候補」はNodeとは別の独立schemaで表現する）。

---

## 1. Scope

P2-A2は、既存PDF／Excel adapter出力（KnowledgeNode配列およびSourceDocument）から
安全なprojectionを生成し、後続の決定論的rule extraction（A2-3以降）へ渡すための
入力契約である。本checkpoint（A2-2R）は、このprojectionの**schemaとvalidation方針の
確定**のみを行う。抽出処理そのものの実装は行わない。

---

## 2. 処理境界

- local-only。networkアクセスなし。
- external AI通信なし。
- projection構築処理はfilesystemへ直接アクセスしない（adapterが既に返した
  KnowledgeNode/SourceDocumentオブジェクトのみを入力とする）。
- 元ファイル（PDF/Excelの実バイト列）の再読込は行わない。
- adapter出力（KnowledgeNode/KnowledgeEdge/SourceDocument）は読み取り専用として扱う。
  projection構築は新しいオブジェクトを生成するだけであり、入力を変更しない（§17）。
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
  "units": [ /* §4 */ ]                      // 必須。最低1件（空配列拒否。§14）
}
```

top-level fieldはこの6個に固定する。未知fieldは拒否する（§14）。

### 3.1 `content_export_included`（field名の変更とその理由）

指示書の `content_included` をそのまま採用すると、「このprojectionは
`normalized_text` という限定的なtext保持を内部に持っている」という事実と
矛盾しているように誤読される。実際には2つの別概念が存在する。

| 概念 | 意味 | 本Contractでの扱い |
|---|---|---|
| ローカル処理用の限定的text保持 | rule extractionのために各unitが`normalized_text`（正規化済み・境界内の文字列）を保持すること | 常に発生する。これ自体は禁止していない |
| 外部向けcontent inclusion | このprojectionオブジェクトを、外部向けexport・summary・conflict token・error等の**境界外**の成果物へ、生テキストを含む形でそのまま転記してよいか | 常に `false`。P2-A2のいかなる外部出力（report/summary/error）も、`normalized_text`をそのまま埋め込まない |

このため、field名は **`content_export_included`** で確定する。値は固定 `false`。
将来 `true` を許す設計変更は本Contractの対象外（schema_versionの更新を要する）。

---

## 4. Unit Schema

```jsonc
{
  "source_unit_id":        "psu-<32桁hex>",  // 必須。決定的・projection内で一意（§9/§16）
  "structural_role":       "BODY_STATEMENT", // 必須。enum（§5）
  "normalized_text":       "空調ユニットは...", // 必須。§6の正規化規則に従う。空文字列不可
  "occurrence_ordinal":    12,               // 必須。0以上の整数。unit配列index値と厳密一致（§16）
  "provenance_ref_id":     "pref-<32桁hex>", // 必須。§9参照
  "parent_source_unit_id": "psu-<32桁hex>"   // 必須field（値はnull許容）。§4.1参照
}
```

unit fieldはこの6個に固定する。未知fieldは拒否する（§14）。

### 4.1 `parent_source_unit_id`

- 該当する親unitが存在する場合のみ、その親の `source_unit_id` を指す。
- 該当しない場合（document直下のunit、または「親」という概念自体が
  意味を持たないunit）に限り `null` を許可する。
- 自己参照（`parent_source_unit_id === source_unit_id`）は常に拒否する（§14）。
- 循環参照（親を辿った結果、自分自身に戻る）は常に拒否する（§14）。
- 親unitの `occurrence_ordinal` は、常に子unitの `occurrence_ordinal` より
  **厳密に小さい**（§16の構築アルゴリズムにより常にこの関係が成立する。
  違反はvalidationで検出する。§14 TB20）。

---

## 5. `structural_role`

### 5.1 方針

現行adapter（`pdf_direct_adapter.js` / `excel_direct_adapter.js`）が実際に生成する
Node構造・field値から**根拠を持って導出できるroleだけ**をこのcheckpointで
「対応済み」として定義する。根拠のないroleは予約すら追加しない。
未対応のroleを検出した場合、`BODY_STATEMENT` へ黙って fallback することは禁止する
（§14: `EXTRACTION_INPUT_UNSUPPORTED_STRUCTURAL_ROLE` で拒否する）。

### 5.2 対応済み role（このcheckpointで採用）

| role | 適用source_kind | 根拠（adapter側の実データ） |
|---|---|---|
| `DOCUMENT_TITLE` | PDF, EXCEL | 両adapterとも、document Node（`node_type:'document'`）を必ず1件生成し、その `text`/`title` はファイル名（`opts.fileName`）に決定的に一致する。空・欠落はない。 |
| `SECTION_HEADING` | PDF | 非synthetic section Nodeの `title`。**`headingConfidence === 'high'` の場合のみ**（§5.3参照。`'low'`の場合、そもそもsection Node自体が生成されないため対象外）。 |
| `BODY_STATEMENT` | PDF | statement Node（`node_type:'statement'`）の `text`（=`normalizedText`、段落単位）。 |
| `SHEET_NAME` | EXCEL | section Node（sheet）の `text` = `extraction.sheetName`。 |
| `ROW_RECORD` | EXCEL | statement Node（1行=1Node）の `text`（"見出し: 値 / ..." 形式の連結済みテキスト）。 |
| `KEY` | EXCEL | 行Nodeの `provenance.verbatim.source_record` を列単位に分解して得る（§11）。 |
| `VALUE` | EXCEL | 行Nodeの `provenance.verbatim.source_record_display` を列単位に分解して得る（§11）。 |

### 5.3 heading_confidenceの扱い（確定方針）

**確定方針**:

- high-confidenceの非synthetic sectionだけを `SECTION_HEADING` とする。
- low-confidence headingは `BODY_STATEMENT` へfallbackしない。
- synthetic sectionはunit化しない（section unitとしては生成しない。§5.4）。
- `heading_confidence` fieldは0.1 unit schemaへ追加しない。

**この方針は追加のfilteringロジックを必要としない**（重要）。
`pdf_direct_adapter.js` の `segmentPdfContent()` の実装を確認した結果、
`matchFixedHeadingLine()` が `confidence:'low'` を返した行は、そもそも
**新しいsection Nodeを生成する分岐に入らない**（`if (headingMatch &&
headingMatch.confidence === 'high') { ...currentSection = {...}... }` の
分岐のみが新sectionを開始し、`'low'`は単に `lowConfidenceHeadingCandidate`
フラグを立てて通常の段落行として `pendingLines` に積まれ、最終的に
`BODY_STATEMENT` の一部として自然にflushされる）。
つまり、「low-confidence見出しのためのsection Node」自体が存在しないため、
それを`SECTION_HEADING`にもBODY_STATEMENTにも**わざわざfallbackさせる
判断が発生しない**。§5.2の対応済みrole定義（`headingConfidence === 'high'`
の非synthetic sectionのみ）は、この既存adapter実装の帰結を正確に反映した
ものであり、本checkpointで新たに追加した制約ではない。

### 5.4 synthetic section除外規則

`segmentPdfContent()` が返す section のうち `synthetic === true` のものは、
`SECTION_HEADING` unitを生成しない（`本文`は実文書の見出しテキストではなく、
adapterが挿入した固定placeholderであるため）。ただし、そのsynthetic section
配下の `BODY_STATEMENT`（paragraph）unitは通常どおり生成する
（`parent_source_unit_id` はdocument unitを指す。中間のsection unitが
存在しないため）。

### 5.5 除外・予約（このcheckpointでは非対応。理由付き）

| role | 状態 | 理由 |
|---|---|---|
| `TABLE_HEADER` | **予約のみ・未実装** | Excel adapterは「物理的なヘッダー行」を独立したNode/locatorとして生成しない。ヘッダー文字列そのものの実体は `KEY` roleで既にprojection可能であり、`TABLE_HEADER` を別途追加すると同一根拠に対して2つのroleが存在することになる。将来、adapterがヘッダー行に独立したlocator/Node粒度を持つよう変更された場合にのみ再検討する。 |
| `TABLE_CELL` | **予約のみ・未実装** | 同上の理由。個々のセルへの独立したlocatorは現行adapter出力に存在せず、`VALUE` roleが同じ根拠を表す。 |

---

## 6. normalized_text 生成責任

**呼出側が渡した `normalized_text` をそのまま信用しない。** 採用方式は
projection constructorがNodeの`text`/`title`（またはExcelの列単位分解値。
§11）から正規化する方式である。

正規化規則（PDF/Excel共通・一律適用。source_kindによって規則を変えない）:

1. Unicode NFKC正規化
2. CR / LF / TAB を半角スペースへ変換
3. 連続する空白の圧縮（1個へ）
4. 先頭・末尾のtrim

この規則は `pdf_direct_adapter.js` の `normalizePdfText()` と同一である。
**PDF側の `text` は既にadapter内部でこの正規化を経ているが、projection
constructorは「既に正規化済みだから」と信用せず、無条件に同じ正規化を
再適用する**（べき等な操作なので副作用はない）。

**Excel側の `text`（`deriveText()`）および分解元の`source_record`/
`source_record_display`個々の値はNFKC正規化を行っていない。**
projection constructorが独自にNFKC正規化を適用して初めて、PDF/Excel
共通の `normalized_text` 契約を満たす。

### 6.1 ASCII case folding

**保存する `normalized_text` はcaseを保持する**（大文字小文字を変更しない）。
比較用key（ASCII case-fold済み）は projection schemaの一部としては
**永続化しない**。比較が必要な場面（将来のrule extraction時の一致判定）
では、既存adapterの `foldForTagCompare()` 相当のロジックを、その都度
`normalized_text` から算出する（projectionの永続fieldには含めない）。

### 6.2 text fingerprintを併用しない

unit schema（§4）を6 fieldに固定する方針を優先し、text fingerprintという
追加fieldは持たない。再現性の検証はA2-7の検証スイート側に委ねる。

---

## 7. document_fingerprint

**形式**: `^[0-9a-f]{64}$`（64桁小文字16進数）で固定する。

**意味**: 既存 `SourceDocument.content_digest`（実ファイルのSHA-256）を
**そのまま参照した値**。P2-A2 coreは元ファイルを再読込しない。
validationは値の**形式だけ**を検証し（正規表現一致）、再計算は行わない。

**projection自体のcanonical fingerprint（projection fingerprint）は
0.1 contractでは不採用として確定する。** `document_fingerprint`（元文書の
fingerprint）と projection fingerprint（projection自身の内容ハッシュ）を
混同しない。canonical serializationのfield順・unit順は本Contractで定義済み
だが（§16）、projection fingerprintの生成自体は今回の実装対象外とする。
将来これを追加する場合は `schema_version` の更新を要する（0.1のままでの
無破壊追加は行わない。トップレベルfield集合の変更になるため）。

---

## 8. provenance

最低限、次の4つが「provenance境界」を構成する。

- `source_document_id`（projection top-level。§3）
- `source_unit_id`（unit毎。§4/§9）
- `provenance_ref_id`（unit毎。§4/§9）
- `occurrence_ordinal`（unit毎。§4/§16）

**セクション名・シート名・見出しテキスト・列見出し名など、private termを
含み得るfieldは、error・summary・conflict tokenへ一切出力しない。**
error/summary/conflict recordで安全に使ってよいのは `source_unit_id` /
`provenance_ref_id` / `structural_role` / `occurrence_ordinal` /
`source_document_id` のみであり、`normalized_text` はこれらの文脈へ
一切転記しない。

`provenance_ref_id` の値そのものの生成規則は §9 で確定する。

---

## 9. ID Contract（確定）

本sectionで、4種類のIDすべての形式・生成規則を確定する。
**実装（core実装）は本checkpointの対象外。** ここで確定するのは
「core実装時にそのまま定数化・実装できる、曖昧さのない仕様」である。

### 9.1 形式一覧

| ID種別 | prefix | 本体 | 正規表現 | 固定長 | case |
|---|---|---|---|---|---|
| `source_document_id` | `sd-` | 32桁16進数 | `^sd-[0-9a-f]{32}$` | 35文字 | 小文字固定 |
| `source_unit_id` | `psu-` | 32桁16進数 | `^psu-[0-9a-f]{32}$` | 36文字 | 小文字固定 |
| `provenance_ref_id` | `pref-` | 32桁16進数 | `^pref-[0-9a-f]{32}$` | 37文字 | 小文字固定 |
| `parent_source_unit_id` | `psu-`（`source_unit_id`と同一形式） | 32桁16進数 | `^psu-[0-9a-f]{32}$`、または値`null` | 36文字（null以外） | 小文字固定 |

`source_document_id` は既存 `id_hash_utils.js` の `sourceDocumentId()` が
生成した値をそのまま参照するのみで、P2-A2は独自に生成しない
（adapterが既に発行済みの値の形式検証のみ行う）。

`source_unit_id` / `provenance_ref_id` は、いずれもP2-A2固有の**新規**
決定的IDであり、`id_hash_utils.js` の `id128(namespace, parts)` を
**そのまま**（変更せず）利用して生成する方針とする（namespaceのみ
新規に定義する。§9.2）。

**許可文字**: いずれのID種別も、prefix部分は固定ASCII文字列（英小文字と
ハイフンのみ）、本体部分は`[0-9a-f]`(小文字16進数)のみ。大文字・
アンダースコア・その他の記号は一切許可しない。

**MAX_ID_LENGTH（§15）との関係**: 上表の固定長により、正規表現一致
チェックの前段階として、まず文字列長が `MAX_ID_LENGTH` 以下であることを
安価に確認してから正規表現検査を行う（極端に長い文字列に対する
正規表現評価コストを避けるための多層防御。§15参照）。

### 9.2 生成材料（namespaceとparts）

`source_unit_id` と `provenance_ref_id` は、**同一のparts構成**を、
**異なるnamespace文字列**で`id128()`へ渡すことで生成する
（2つのID種別が偶然にも同じ値になることを構造的に防ぐため）。

- `source_unit_id` 用namespace（案）: `'private-dictionary-rule-extraction-unit-id-v1'`
- `provenance_ref_id` 用namespace（案）: `'private-dictionary-rule-extraction-provenance-ref-v1'`

いずれのpartsも、**raw text・sheet名・section title・cell valueを一切含まない**
「安全な構造識別子」だけで構成する。

#### PDF

| role | parts（先頭は常に`source_document_id`） |
|---|---|
| `DOCUMENT_TITLE` | `[source_document_id, 'DOCUMENT_TITLE']` |
| `SECTION_HEADING` | `[source_document_id, 'SECTION_HEADING', String(page), section_id]` |
| `BODY_STATEMENT` | `[source_document_id, 'BODY_STATEMENT', String(page), section_id, block_id]` |

`page` はNodeの `provenance.locator.page`、`section_id`/`block_id` は
`provenance.locator.section_id`/`block_id`（例: `sec-2`, `blk-2-0`。
これらはadapterが生成する安全な構造識別子であり、見出しテキストその
ものではない）。

#### EXCEL

| role | parts（先頭は常に`source_document_id`） |
|---|---|
| `DOCUMENT_TITLE` | `[source_document_id, 'DOCUMENT_TITLE']` |
| `SHEET_NAME` | `[source_document_id, 'SHEET_NAME', String(sheet_index)]` |
| `ROW_RECORD` | `[source_document_id, 'ROW_RECORD', String(sheet_index), String(row)]` |
| `KEY` | `[source_document_id, 'KEY', String(sheet_index), String(row), String(column_ordinal)]` |
| `VALUE` | `[source_document_id, 'VALUE', String(sheet_index), String(row), String(column_ordinal)]` |

`sheet_index` はNodeの `provenance.extensions.sheet_index`、`row` は
`provenance.verbatim.source_row`、`column_ordinal` は§11で定義する
列の0始まり相対位置。いずれも整数であり、raw key/valueそのものを
hash材料にしない（指示書の禁止事項に合致）。

### 9.3 KEY/VALUEの区別と、A2-2からの変更点

parts に `'KEY'` / `'VALUE'` というrole token を含めることで、
`source_unit_id` と `provenance_ref_id` の**両方**が、同一セル
（同一sheet_index/row/column_ordinal）由来であっても KEY と VALUE で
**異なる値**になる。したがって:

- `ROW_RECORD` と、それから分解された `KEY`/`VALUE` は、常に異なる
  `source_unit_id` を持つ（role tokenが異なるため）。
- `KEY` と `VALUE` は、`source_unit_id` はもちろん、**`provenance_ref_id`
  も共有しない**（role tokenがpartsに含まれるため）。

**A2-2からの変更点**: A2-2の設計書では「同一セルに由来するKEY/VALUEは
`provenance_ref_id` を共有する」としていたが、本指示（A2-2R item 4）が
`provenance_ref_id` の生成材料に明示的に `unit role` を含めるよう求めて
いるため、この共有方針を撤回し、KEY/VALUEそれぞれが独立した
`provenance_ref_id` を持つよう変更した。これに伴い、旧A2-2 §5.4の
「両者で同一の値を用いる」という記述は本版で削除・置換した
（§15の `MAX_DISTINCT_PROVENANCE_REFERENCES` の扱いにも影響する。
§15参照）。

`source_unit_id` と `provenance_ref_id` は、現時点では同一partsから
異なるnamespaceで導出される「並行した」値だが、概念上は別の役割
（前者はunit自身の識別子・親子参照に使う、後者はprovenance監査の
参照ポインタとして使う）を持つ独立したfieldとして維持する。

### 9.4 duplicate判定・raw private termの非混入

- `source_unit_id` の重複判定は、正規化なしの厳密な文字列完全一致で
  行う（§16）。
- 上記のparts構成は、いずれもraw text・見出し文字列・セル値そのものを
  含まない（page/row/column_ordinal/section_id/block_id/sheet_index/role
  tokenのみ）。したがって、生成されたID文字列自体からraw private term
  を読み取ることはできない。

---

## 10. path／locator安全性（確定。A2-2Rの設計から変更）

**A2-2Rでは`normalized_text`に対してpath/URI様文字列を拒否する設計として
いたが、これは誤りであったため撤回する（GitHub独立レビュー Finding 1）。**
文字列の見た目（絶対パス・UNCパス・`file:`/`http(s):` URI等に似ている）と、
実際にfilesystem/networkへアクセスするかどうかは**別の話**である。技術文書の
本文が、設定ファイルのパスやマニュアルの参照URLを文言として含むことは
ごく正常であり、それを理由にunit全体を拒否するのは行き過ぎた制約だった。

**確定した契約**:

- projection schema（top-level・unit level）のいずれにも `source_path` /
  ファイルシステムpathに相当するfieldを**含めない**（この方針自体は変更
  しない。§3/§4のschemaにこの種のfieldは存在しない）。
- projection constructor・将来のrule extraction coreのいずれも、
  `normalized_text`に含まれるpath/URI様の文字列を**一切dereferenceしない**
  （ファイルを開かない・ネットワークへアクセスしない。§2の処理境界は
  変更なし）。
- `normalized_text`内にpath様・URL様の表記が含まれることは、通常の
  文書contentとして問題なく保持できる。これを理由にunitを拒否する
  validationルールは存在しない。
- ただし、`normalized_text`はいかなる場合もerror・summary・conflict token
  へ転記しない（§8の既存原則。これは変更していない。「pathを含むかどうか」
  ではなく「private/raw contentを外部境界へ出さない」という一般原則の一部）。
- ID系field（`source_document_id`/`source_unit_id`/`provenance_ref_id`/
  `parent_source_unit_id`/`document_fingerprint`）は、引き続き§9/§7の
  **それぞれの固定正規表現**でのみ検査する（`^sd-[0-9a-f]{32}$`等）。
  これらの正規表現は元々hex文字と固定prefixだけで構成されるため、
  path/URIに使われる文字（`/`, `\`, `:`, `.`等）を自然に排除できており、
  path-like拒否ルールを廃止しても、ID系fieldに新たな抜け穴は生じない。

`EXTRACTION_INPUT_PATH_LIKE_VALUE_REJECTED` は0.1 error code一覧から
**削除する**（§13/§14参照。廃止理由は本節のとおり）。

---

## 11. Excel派生unit（KEY/VALUE分解の完全規則）

### 11.1 列順序の材料

列順序は **adapterの明示的な列順（`extraction.headers` /
`provenance.extensions.column_headers`。実効範囲の列index昇順で
adapter自身が確定済みの配列）だけを使用する**。
`Object.keys(source_record)` には**無条件に依存しない**（JSのobject
key順序はnumeric-likeキー等で仕様上並び替えが起こりうるため、
順序の正本にしない）。

`column_ordinal` は、この `column_headers` 配列内での**0始まりの
相対位置**として定義する（シート上の絶対列index（`firstCol+ci`）
ではない。絶対列indexは最終KnowledgeNodeのextensionsに個別に
保持されていないため、そもそも参照できない）。

### 11.2 値の安全な取得（descriptor方式に確定。`__proto__` / `prototype` /
`constructor` を含む。GitHub独立レビュー Finding 2への対応）

各 `column_ordinal` について、対応する見出し文字列は
`column_headers[column_ordinal]`（配列アクセス。常に安全）から得る。
対応する生値・表示値は、`provenance.verbatim.source_record` /
`source_record_display`（以下、まとめて`record`と呼ぶ。**両方に対して
同一の手順を独立に適用する**）に対して、次の手順で**descriptorベースで
のみ**読み取る。bracket直接アクセス（`record[header]`）は一切行わない。
`in`演算子・`for...in`・`Object.keys(record)` は、列順決定にも値取得にも
使用しない（列順は§11.1のとおり`column_headers`のみを正本とする）。

**手順（`record`と`header`のペアごとに、この順序で適用する）**:

1. `record`自体が安全に読み取れることを事前確認する（§18 Constructor
   Trust Boundaryの一部。`Reflect.getPrototypeOf(record)`
   / `Reflect.ownKeys(record)` の呼び出し自体が例外を投げないか、
   プロトタイプが`Object.prototype`と厳密一致するか、own keyにsymbolが
   含まれないかを検査する。違反があれば`record`全体をfail-closedで
   拒否する。§18参照）。
2. 次のように、descriptorを取得する。

   ```js
   const descriptor = Object.getOwnPropertyDescriptor(record, header);
   ```

3. この呼び出し自体が例外を投げた場合（hostileなProxy trapを含む）、
   catchして拒否する。
4. `descriptor === undefined` の場合（`header`という名前のown property
   が存在しない）、拒否する（§11.3「欠落header」の判定はこの条件に
   一本化する）。
5. `descriptor`がaccessor descriptor（`'get' in descriptor` または
   `'set' in descriptor` が真。すなわちdata descriptorではない）の場合、
   拒否する。
6. `descriptor.enumerable !== true` の場合（non-enumerable property）、
   拒否する。
7. 上記5点をすべて通過した場合のみ、`descriptor.value` から値を取得する
   （`record[header]`のような再アクセスは行わない。descriptor取得時点の
   値をそのまま用いる）。

**`source_record`で拒否が発生した場合は`EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD`、
`source_record_display`で拒否が発生した場合は
`EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD_DISPLAY`を用いる（§14.4 Tier C）。**

この方式により、次の3つの危険なproperty nameを、名前ごとの特別扱い
（denylist）なしに、統一的かつ安全に処理できる:

- **`__proto__`**: プレーンオブジェクトへ `obj['__proto__'] = v` で
  代入した場合、`v` がobjectまたはnullであれば実際に`record`自身の
  プロトタイプが書き換わる（`__proto__`はown propertyを作らないため）。
  この場合、手順1の「プロトタイプが`Object.prototype`と厳密一致するか」
  の検査で`record`ごと拒否される。`v`がobject/nullでない場合は代入自体が
  no-opとなり、`Object.getOwnPropertyDescriptor(record, '__proto__')`は
  正しく`undefined`を返すため、手順4で拒否される。いずれの経路でも
  安全側に倒れる。
- **`prototype`** / **`constructor`**: これらはプレーンオブジェクトへの
  bracket代入で通常どおり自身のenumerableなown data propertyになるため、
  手順2-7がそのまま正しく通過し、実際に代入された値を安全に取得できる。

いずれの場合も、名前で分岐する特別なコードパスは持たない（descriptorの
検査を一律に適用するだけで正しく振る舞う）。

### 11.3 空key・空value・重複header・欠落headerの扱い

- **空header（見出し文字列が空）**: 現行adapterは見出し欠落時に
  `columnLetter()`（列記号: A, B, C...）へフォールバックするため、
  `column_headers` の要素が空文字列になることは adapter仕様上ない。
  もし空文字列を検出した場合、`EXTRACTION_INPUT_INVALID_COLUMN_HEADERS`
  （§14.4 Tier C）でprojection構築自体をfail-closedで中止する。
- **重複header（正規化後に同一文字列が2列以上に存在）**: 現行adapterは
  重複見出しに `(列記号)` を付与して一意化するため、adapter仕様上
  発生しない。防御的に再検証し、検出した場合は空headerと同じ
  `EXTRACTION_INPUT_INVALID_COLUMN_HEADERS` で構築時fail-closedとする。
- **欠落header（`column_headers` の要素数が実際の列数と一致しない）**:
  同様に adapter仕様上発生しないはずだが、防御的に
  `column_headers.length` を列範囲の期待値と照合し、不一致なら
  同じく `EXTRACTION_INPUT_INVALID_COLUMN_HEADERS` で構築時fail-closedと
  する。
- **空key（個々の列について、`column_headers[column_ordinal]`という
  headerがそもそも`record`のown propertyとして存在しない場合）**: §11.2の
  手順4により `EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD`（または
  `_DISPLAY`）として拒否される。`column_headers`自体が空文字列を含む
  ケースは上記の`INVALID_COLUMN_HEADERS`で既に排除されているため、
  「headerは非空だが対応するown propertyがない」ケースのみがこの経路に
  残る。
- **正規化後に`normalized_text`が空文字列になるKEY/VALUE unit**: 通常の
  空text拒否（§14 `EXTRACTION_INPUT_EMPTY_NORMALIZED_TEXT`）で拒否する
  （こちらはvalidation側のTier Bで検出する。ペア生成自体を行わない
  ケースは次項）。
- **空value（KEY/VALUEペアの生成可否）**: 列の表示値（`cellTextValue()`
  相当を正規化した結果）が空文字列になる列については、**KEYとVALUEの
  ペアをまるごと生成しない**（KEYだけを残す、VALUEだけを残すという
  片方だけの生成は行わない。key/value構造のevidenceとして意味を持つのは
  両方が揃っている場合のみであるため）。この判定はprojection構築時に
  行われ、validation側での特別なエラーコードは不要（生成されない
  ペアはvalidation対象にすらならない）。

---

## 12. metrics（本checkpointでは含めない）

**Input Projection Contract（本Contract）にはmetricsを含めない。**

理由: `exposure_count` 等7項目は「候補（candidate）」に対する評価指標であり、
本Contractが扱う「adapter出力の安全な射影」の段階では、まだ候補というもの
自体が存在しない。責務分離の原則に従い、metrics schema（`metrics`/
`unmeasured_metrics` の組を含む）は **A2-3以降のcandidate output contractで
新規に定義する**。本Contractのtop-level schema（§3）・unit schema（§4）の
いずれにもmetrics関連fieldは存在しない。

（参考: P2-A1の `entry.utility` は非負整数を必須とし「未計測」を表現できない
ため、A2-3以降で定義するmetrics schemaはP2-A1の`utility`shapeとは独立した
別schemaとする。）

---

## 13. Error Contract

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
- `code` は§14の固定コード一覧に属する文字列のみ
- `path` は `$` から始まる、次のallowlisted field名のみで構成される
  JSONPath風文字列（P2-A1のものとは独立した集合）:

```
schema_version, source_kind, source_document_id, document_fingerprint,
content_export_included, units, source_unit_id, structural_role,
normalized_text, occurrence_ordinal, provenance_ref_id,
parent_source_unit_id
```

**本Contractのerror codeは、validator（既に構築済みのprojection候補を
検査する。§14.2/14.3のTier A/B）とconstructor（adapter出力からprojectionを
構築する過程。§14.4のTier C）の両方が、この単一の`{code,path}`契約から
共有する。「constructor errorはvalidation codeとは別」という区別は
本Contractには存在しない（GitHub独立レビュー Finding 3。詳細は§14.4）。
Tier Cのerrorは、`path`に常に固定値`$`を用いる（構築途中の時点では
`$.units[i]`のような添字付きpathを安全に特定できないため。§14.4参照）。

**Tier B由来でconstructorとも共用するcodeが2つ存在する（A2-2R3で確定。
§14.3/§14.4/§15.1参照）**: `EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED`
（`MAX_UNITS`の分解前見積り超過・分解中実件数超過にも用いる）と
`EXTRACTION_INPUT_UTF8_BYTES_LIMIT_EXCEEDED`（constructorが構築時に
canonical UTF-8サイズを逐次検査する場合に用いる）。これらはTier Bの
表（B-8/B-23）にもTier Cの表（§14.4）にも同一codeとして現れる、
validator/constructor共用のcodeである。

**禁止事項**（すべて）: `Error` インスタンス, `message`, `stack`, `name`,
raw term（正規化前後を問わず抽出対象の生テキスト）, raw alias,
シート名・セクション名そのものの値, filesystem path, module path,
依存先ライブラリの生エラー内容, symbol, 非enumerableな隠しproperty。

**「unknown field」系エラーのpath規則**: 未知fieldを検出した場合、
`path` にはその**親コンテナのpath**（`$` または `$.units[i]`）のみを
用い、未知field自身の名前（攻撃者が自由に設定できる文字列でありうる）
は`path`へ一切含めない。

**実装時にerror codeを追加・改名してはいけない。** 変更が必要な場合は、
本Contractの更新・再承認を先に求める。

---

## 14. Fail-closed Validation

### 14.1 validation APIの戻り方（確定）

概念上のsignature（設計のみ。実装はA2-3以降）:

```
validateExtractionInputProjection(candidate)
  -> { valid: boolean, errors: FrozenExtractionInputError[] }
```

- `errors` は必ず配列（`valid === true` のとき空配列）。
- **Tier A（構造安全性）で1件でも違反があれば、その時点で即座に
  `{valid:false, errors:[単一のエラー]}` を返す**（それ以降のTier B検査は
  一切行わない）。
- **Tier B（schema/semantic）は、違反をすべて収集し、固定された決定論的
  順序で配列に積んで返す**（1件目で打ち切らない）。

### 14.2 Tier A（構造安全性。短絡・単一エラー）

次の順序で、root → `units`（配列自体） → `units[0]` → `units[1]` → ...
→ `units[n-1]` の順に走査し、**最初に違反したノードで即座に停止**する。
各ノードでは、次のサブ順序で検査する（同一ノード内でも最初の違反で
そのノードの検査を打ち切り、Tier A全体を打ち切る）。

| 順序 | 検査 | code |
|---|---|---|
| A-1 | 対象がplainなobject/arrayとして読み取り可能か（`typeof`/`null`チェック、`Reflect.ownKeys`等の呼び出しが例外を投げないか。Proxy trap失敗を含む。`units`は`Array.isArray()`で判定） | `EXTRACTION_INPUT_ROOT_NOT_OBJECT` |
| A-2 | 循環・同一参照の重複（root自身が`units`に含まれる、同一unitオブジェクトが複数indexに現れる等） | `EXTRACTION_INPUT_CYCLIC_OBJECT_REJECTED` |
| A-3 | symbol keyの存在（`Reflect.ownKeys`にsymbolが含まれる） | `EXTRACTION_INPUT_SYMBOL_KEY_REJECTED` |
| A-4 | 非enumerableな追加own propertyの存在 | `EXTRACTION_INPUT_NON_ENUMERABLE_FIELD_REJECTED` |
| A-5 | accessor property（getter/setter）の存在 | `EXTRACTION_INPUT_ACCESSOR_PROPERTY_REJECTED` |
| A-6 | プロトタイプが`Object.prototype`と厳密一致しない | `EXTRACTION_INPUT_CUSTOM_PROTOTYPE_REJECTED` |

### 14.3 Tier B（schema/semantic。累積）

Tier Aを全ノードで通過した場合のみ実行する。次の固定順序ですべての
違反を収集する（1件見つかっても継続する）。

**root（1回だけ、この順序で）**

| 順序 | 検査 | code | path |
|---|---|---|---|
| B-1 | 未知top-level field | `EXTRACTION_INPUT_UNKNOWN_TOP_LEVEL_FIELD` | `$` |
| B-2 | `schema_version`がconstと不一致 | `EXTRACTION_INPUT_SCHEMA_VERSION_INVALID` | `$.schema_version` |
| B-3 | `source_kind`が`"PDF"`/`"EXCEL"`以外 | `EXTRACTION_INPUT_INVALID_SOURCE_KIND` | `$.source_kind` |
| B-4 | `source_document_id`形式不正 | `EXTRACTION_INPUT_SOURCE_DOCUMENT_ID_FORMAT_INVALID` | `$.source_document_id` |
| B-5 | `document_fingerprint`形式不正（§7の正規表現） | `EXTRACTION_INPUT_INVALID_FINGERPRINT` | `$.document_fingerprint` |
| B-6 | `content_export_included`が`false`以外 | `EXTRACTION_INPUT_CONTENT_EXPORT_INCLUDED_INVALID` | `$.content_export_included` |
| B-7 | `units`が空配列 | `EXTRACTION_INPUT_UNITS_EMPTY_REJECTED` | `$.units` |
| B-8 | `units.length > MAX_UNITS`（§15。分解後の最終件数に適用）。**このcodeはconstructorとも共用**（§14.4/§15.1: 分解前の見積り超過・分解中の逐次件数超過のいずれも同じcodeを用いる） | `EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED` | `$.units` |

**各unit（配列index順。各unit内はこの順序）**

| 順序 | 検査 | code | path |
|---|---|---|---|
| B-9 | 未知unit field | `EXTRACTION_INPUT_UNKNOWN_UNIT_FIELD` | `$.units[i]` |
| B-10 | `source_unit_id`形式不正（長さ→正規表現の順） | `EXTRACTION_INPUT_SOURCE_UNIT_ID_FORMAT_INVALID` | `$.units[i].source_unit_id` |
| B-11 | `source_unit_id`重複（projection内） | `EXTRACTION_INPUT_DUPLICATE_SOURCE_UNIT_ID` | `$.units[i].source_unit_id` |
| B-12 | `structural_role`が未対応（§5.5含む） | `EXTRACTION_INPUT_UNSUPPORTED_STRUCTURAL_ROLE` | `$.units[i].structural_role` |
| B-13 | `normalized_text`が空文字列 | `EXTRACTION_INPUT_EMPTY_NORMALIZED_TEXT` | `$.units[i].normalized_text` |
| B-14 | `normalized_text`長さ超過（§15） | `EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED` | `$.units[i].normalized_text` |
| B-15 | `occurrence_ordinal`が非負整数でない、またはindexと不一致（§16） | `EXTRACTION_INPUT_INVALID_OCCURRENCE_ORDINAL` | `$.units[i].occurrence_ordinal` |
| B-16 | `provenance_ref_id`形式不正 | `EXTRACTION_INPUT_PROVENANCE_REF_ID_FORMAT_INVALID` | `$.units[i].provenance_ref_id` |
| B-17 | `parent_source_unit_id`が自己参照 | `EXTRACTION_INPUT_SELF_PARENT_REJECTED` | `$.units[i].parent_source_unit_id` |
| B-18 | `parent_source_unit_id`が存在しないunitを指す | `EXTRACTION_INPUT_INVALID_PARENT_REFERENCE` | `$.units[i].parent_source_unit_id` |
| B-19 | 親の`occurrence_ordinal`が子以上（循環含む） | `EXTRACTION_INPUT_PARENT_CYCLE_DETECTED` | `$.units[i].parent_source_unit_id` |
| B-20 | 親子連鎖の深さ超過（§15） | `EXTRACTION_INPUT_NESTING_LIMIT_EXCEEDED` | `$.units[i].parent_source_unit_id` |

**projection全体（すべての個別チェックを終えた後、最後にまとめて）**

| 順序 | 検査 | code | path |
|---|---|---|---|
| B-21 | 同一`parent_source_unit_id`を持つunit数が上限超過（§15） | `EXTRACTION_INPUT_EXCESSIVE_CHILDREN_PER_PARENT` | `$.units` |
| B-22 | 相異なる`provenance_ref_id`数が上限超過（§15） | `EXTRACTION_INPUT_DISTINCT_PROVENANCE_REFERENCES_LIMIT_EXCEEDED` | `$.units` |
| B-23 | projection全体のUTF-8バイト数上限超過（§15。B-1〜B-22がすべて通過した場合のみ計算する）。**このcodeはconstructorとも共用**（§14.4/§15.1: 構築時に逐次UTF-8サイズを検査する場合、任意でこのcodeを用いる） | `EXTRACTION_INPUT_UTF8_BYTES_LIMIT_EXCEEDED` | `$` |

Tier Bは合計23種（B-1〜B-23）。旧A2-2R案にあった`EXTRACTION_INPUT_PATH_LIKE_VALUE_REJECTED`
（旧B-15）は、GitHub独立レビューFinding 1により廃止した（§10参照）。

### 14.4 Tier C（constructor時。短絡・単一エラー。GitHub独立レビュー
Finding 3への対応）

projection constructorが、adapter出力（KnowledgeNode等）からprojectionを
構築する過程で検出する事象にも、**Tier A/Bと同一の`{code,path}`契約**を
適用する。constructor errorを「validation codeとは別の独立した仕組み」
として記述しない（§13参照）。

**Tier Cの性質はTier Aと同様、常に短絡・単一エラーである**（construction
は単一の線形処理であり、最初に検出した1件で構築全体を即座に中止する。
部分的なprojectionを返さない。個々のNode/行だけを黙ってスキップしない）。
`path`は常に固定値`$`を用いる。

**Tier A由来の6種（validator/constructor共用。同一codeをconstructorが
adapter入力読取り時にも用いる）**

| code | 発生条件（constructor視点） | 優先順位 |
|---|---|---|
| `EXTRACTION_INPUT_ROOT_NOT_OBJECT` | 読み取り対象のadapter object（Node/verbatim等）がplainなobjectとして読み取れない。Proxy trap失敗を含む（instruction「unsafe adapter object」「proxy trap failure」の両方をこのcodeへ統合する） | C-1 |
| `EXTRACTION_INPUT_CYCLIC_OBJECT_REJECTED` | 読み取り対象が循環参照を持つ（instruction「cyclic input」） | C-2 |
| `EXTRACTION_INPUT_SYMBOL_KEY_REJECTED` | 読み取り対象own keyにsymbolが含まれる | C-3 |
| `EXTRACTION_INPUT_NON_ENUMERABLE_FIELD_REJECTED` | 読み取り対象に非enumerableな追加own propertyが存在する | C-4 |
| `EXTRACTION_INPUT_ACCESSOR_PROPERTY_REJECTED` | 読み取り対象にaccessor property（getter/setter）が存在する（instruction「accessor property」） | C-5 |
| `EXTRACTION_INPUT_CUSTOM_PROTOTYPE_REJECTED` | 読み取り対象のプロトタイプが`Object.prototype`と厳密一致しない | C-6 |

**Tier B由来の2種（validator/constructor共用。A2-2R3で追加。§15.1の
bounds違反に対応）**

| code | 発生条件（constructor視点） | 優先順位 |
|---|---|---|
| `EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED` | (a) 分解前の推定unit数（§15.1段階1）が`MAX_UNITS`を超える、または(b) 分解中の実生成unit数（§15.1段階2）が`MAX_UNITS`を超える。いずれもTier B B-8と同一code | C-7 |
| `EXTRACTION_INPUT_UTF8_BYTES_LIMIT_EXCEEDED` | constructorが構築時にcanonical UTF-8サイズを逐次検査する場合（§15.1任意の段階3）、累積バイト数が`MAX_INPUT_UTF8_BYTES`を超える。Tier B B-23と同一code | C-8 |

**Tier C固有の新規8種（constructorのみが使用する）**

| code | 発生条件 | 優先順位 |
|---|---|---|
| `EXTRACTION_INPUT_COLUMNS_PER_ROW_LIMIT_EXCEEDED` | `column_headers.length`が`MAX_COLUMNS_PER_ROW`を超える（§15.1段階1(a)。A2-2R3で新規追加。見積り算術で使う前に必ずこのcheckが先行する） | C-9 |
| `EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD` | `provenance.verbatim.source_record`からのKEY値読取りが§11.2の手順2-6のいずれかで拒否される（instruction「malformed source_record」） | C-10 |
| `EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD_DISPLAY` | `provenance.verbatim.source_record_display`からのVALUE値読取りが§11.2の手順2-6のいずれかで拒否される（instruction「malformed source_record_display」） | C-11 |
| `EXTRACTION_INPUT_INVALID_COLUMN_HEADERS` | `column_headers`が配列でない、空文字列要素を含む、正規化後に重複する、列範囲の期待長と一致しない（§11.3。instruction「invalid column_headers」） | C-12 |
| `EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE` | `provenance.locator.kind`が`'pdf'`/`'excel'`以外、または期待するfieldが欠落している（instruction「unsupported locator」） | C-13 |
| `EXTRACTION_INPUT_DEPENDENCY_RESOLUTION_FAILED` | `id_hash_utils.js`（`KnowledgeIdHashUtils`）等、必須の内部依存モジュールが解決できない（instruction「dependency resolution failure」。既存adapterの`resolveIdHashUtils()`同様の失敗を、native Errorのまま伝播させずここで吸収する） | C-14 |
| `EXTRACTION_INPUT_ID_GENERATION_FAILED` | `id128()`/`hashParts()`の呼び出しが失敗する（例外・非string戻り値・不正な長さ等。P2-A1の`safeHashParts()`と同種の吸収をここで行う。instruction「ID generation failure」） | C-15 |
| `EXTRACTION_INPUT_NORMALIZATION_FAILED` | §6の正規化処理（NFKC正規化等）が失敗する（instruction「normalization failure」） | C-16 |

Tier Cは合計**16種**（Tier A由来6種 + Tier B由来2種 + 固有8種）。これらは
いずれも§13の単一`{code,path}`契約に従う（`Error`インスタンス・
`message`・`stack`・raw text・header名・sheet名・filesystem pathを
一切含まない）。**constructorが起こしうるfail-closed事象は、以上の
16種のいずれか1つに必ず対応する（native Errorへfallbackする経路は
存在しない）。**

### 14.5 優先順位に関する一般原則

- **Tier CはTier A/Bより時間的に先に発生する**（constructorがprojectionを
  構築できて初めて、そのprojection候補がvalidatorのTier A/B検査対象になる。
  Tier Cで構築が中止された場合、Tier A/Bの検査対象となる候補自体が
  存在しない）。したがって「Tier C > Tier A > Tier B」という優先順位では
  なく、**Tier Cは別の処理段階（構築時）、Tier A/Bはそれに後続する別の
  処理段階（検査時）**であり、両者が同時に競合することはない。
- Tier CはTier A同様、走査順・サブ順序で**最初に見つかった1件だけ**を
  報告する（§14.4）。
- Tier AはTier Bに常に優先する（Tier A違反があればTier Bは実行しない）。
- Tier A内では、§14.2の走査順・サブ順序で**最初に見つかった1件だけ**を
  報告する。
- Tier B内では、上記表の順序ですべての違反を収集する。ある1つの
  field・1つの条件について複数のcodeが理論上該当しうる場合
  （例: `parent_source_unit_id`の自己参照・不存在参照・循環は互いに
  排他的なサブ判定として順番に検査するため、1つのunitについて
  B-17/B-18/B-19のうち最大1つだけが発火する）、表の順序が優先順位を
  兼ねる。
- `EXTRACTION_INPUT_DUPLICATE_OCCURRENCE_ORDINAL`（A2-2案に存在したcode）は
  **本版で廃止する**。§16の構築アルゴリズムにより
  `occurrence_ordinal`は配列indexと厳密一致する設計（B-15）となったため、
  重複は「index不一致」として既にB-15で捕捉され、独立したcodeとして
  存在させる必要がなくなったため。
- `EXTRACTION_INPUT_PATH_LIKE_VALUE_REJECTED`（A2-2R案に存在したcode）は
  **本版で廃止する**（GitHub独立レビュー Finding 1。§10参照）。

---

## 15. Bounds

すべて一つの定数表として定義する（core実装時にこの表をそのまま定数化する）。

| 定数 | 値 | 理由 |
|---|---|---|
| `MAX_INPUT_UTF8_BYTES` | 8,388,608（8 MiB） | 個々のunit数・text長の上限から積み上げた安全側の総量backstop。主たる制御は`MAX_UNITS`/`MAX_NORMALIZED_TEXT_LENGTH`。超過時のcodeは`EXTRACTION_INPUT_UTF8_BYTES_LIMIT_EXCEEDED`（validator/constructor共用。§14.3 B-23/§14.4）。 |
| `MAX_UNITS` | 200,000 | **KEY/VALUE分解後の最終projection unit数**に適用する（入力Node数ではない。§15.1参照）。SESSION scopeでの人間レビューが現実的に成立する規模を基準に、adapter側上限（Excel 500,000セル等）より意図的に厳しく設定する。超過時のcodeは`EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED`（validator/constructor共用。§14.3 B-8/§14.4/§15.1）。 |
| `MAX_NORMALIZED_TEXT_LENGTH` | 4,000（文字数） | 一般的な技術文書の段落・セル値を十分収める長さ。超過は切り詰めず拒否する（切り詰めはevidenceを損なうため）。 |
| `MAX_ID_LENGTH` | 80（文字数） | §9の実際のID長（最大37文字）に対する安全余裕。正規表現評価前の安価な事前ゲート。 |
| `MAX_PARENT_DEPTH` | 6 | 現行adapterが生成しうる実際の最大深さは3（`document(0)→sheet(1)→row_record(2)→key/value(3)`）。将来の軽微な拡張余地を見込み2倍の余裕を持たせた。 |
| `MAX_DISTINCT_PROVENANCE_REFERENCES` | `MAX_UNITS`と同値（200,000） | §9.3の変更（KEY/VALUEが`provenance_ref_id`を共有しない）により、実質的に`provenance_ref_id`はunitごとに一意となるため、本boundは事実上`MAX_UNITS`と等価になる。契約上は独立した定数として維持するが、値は`MAX_UNITS`と同一に固定する。 |
| `MAX_COLUMNS_PER_ROW`（新規） | 1,000 | Excelの1行あたりの列数上限。Excel自体の物理列上限（16,384）より大幅に低いが、実務上のBOM/部品表等の技術文書シートを十分収める規模であり、`MAX_UNITS`と組み合わせた見積り（§15.1）を現実的に保つための上限。超過時のcodeは`EXTRACTION_INPUT_COLUMNS_PER_ROW_LIMIT_EXCEEDED`（constructor専用の新規code。§14.4）。 |
| `MAX_CHILDREN_PER_PARENT`（新規） | 2,000（`2 × MAX_COLUMNS_PER_ROW`） | 1つの`ROW_RECORD`から生成されるKEY+VALUEの組の上限（列数上限の2倍）。validation時（B-21。**A2-2R3で誤記訂正**: 旧版はB-22と誤記していたが、B-21が`EXCESSIVE_CHILDREN_PER_PARENT`でありB-22は`DISTINCT_PROVENANCE_REFERENCES_LIMIT_EXCEEDED`であるため、正しくはB-21である）にも再検証する。 |

**全unit間の全直積（総当たり）を前提にした上限設計は行わない。** 上記は
いずれも「1projectionあたりの単純な件数・長さ上限」であり、A2-3以降の
候補抽出ロジックが独自にO(n²)的な組合せ処理を行う場合は、そちらの
checkpointで別途、対象を絞る仕組みを設計する。

### 15.1 分解前の見積りと逐次上限検査（安全な見積りアルゴリズムに確定）

`MAX_UNITS` はKEY/VALUE分解後の最終unit数に適用するが、次の2段階の
防御を併用する。**`1 + 2 × column_headers.length` や `Σ(...)` を無制御に
一括評価すること（全行分の中間配列や全unitを先に生成してから検出する
こと）は禁止する。** 必ず次の逐次アルゴリズムに従う。

**段階1: 分解前の上限見積り（構築開始前のゲート。行ごとの逐次処理）**

```
runningEstimate = 行Node以外のNode数   // adapterのNode一覧から数えるだけの小さい値
if runningEstimate > MAX_UNITS:
    abort with EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED

for each 行Node in 行Node一覧（adapterの決定的順序で）:
    columnCount = その行の column_headers.length

    // (a) 列数チェックを、その値を算術式へ使う前に必ず先に行う
    if columnCount > MAX_COLUMNS_PER_ROW:
        abort with EXTRACTION_INPUT_COLUMNS_PER_ROW_LIMIT_EXCEEDED

    // (b) columnCount は既に MAX_COLUMNS_PER_ROW（1,000）以下と保証された
    //     後にのみ掛け算する。EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED
    rowContribution = 1 + 2 * columnCount   // 高々2,001。桁あふれの余地なし

    // (c) 加算する「前」に残容量と比較する（加算してから比較しない）
    remaining = MAX_UNITS - runningEstimate
    if rowContribution > remaining:
        abort with EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED

    runningEstimate = runningEstimate + rowContribution
    // ここで runningEstimate は常に MAX_UNITS 以下であることが保証される
```

この手順により: `column_headers.length` を上限確認前に算術式で使わない
（`MAX_COLUMNS_PER_ROW`確認が常に先行する）。`runningEstimate`は
`MAX_UNITS`（200,000）を一度も超えないよう、加算前に残容量と比較して
から加算する（超えてから気づく設計にしない）。`Number.MAX_SAFE_INTEGER`
（約9×10^15）を超える計算は、`runningEstimate`が常に`MAX_UNITS`以下・
`rowContribution`が常に`1 + 2 × MAX_COLUMNS_PER_ROW`（2,001）以下という
2つの上限に既に縛られているため、構造的に発生しない。上限超過を検出
した時点（列数超過・行寄与超過のいずれか）で、残りの行を処理せず
即座に短絡する。全行を走査し終えてから合計を判定することはしない。

**段階2: 分解中の逐次上限検査**: 実際にunitを1件生成するたびに、その
時点の累積件数を `MAX_UNITS` と比較し、超過した瞬間に構築を中止する
（`EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED`。見積りが誤っていた場合や、
悪意ある/破損した入力による想定外の拡大を防ぐため）。

**任意の段階3: canonical UTF-8サイズの構築時逐次検査（optional）**:
constructorは、unit生成のたびにそのunitのUTF-8バイト長を加算し、
累積が`MAX_INPUT_UTF8_BYTES`を超えた瞬間に構築を中止することができる
（必須ではない早期防御。validator側のB-23が本来の権威的な検査である
ことに変わりはない）。この検査を行う場合は、全unit生成後に一括で
canonical文字列を作ってから長さを測るのではなく、生成のたびに逐次
加算し、超過した時点で即座に短絡する。用いるcodeは
`EXTRACTION_INPUT_UTF8_BYTES_LIMIT_EXCEEDED`（validator/constructor共用）。

`MAX_COLUMNS_PER_ROW`は、上記の見積り計算自体が発散しないようにする
ための、行あたり列数の独立した上限として機能する
（`EXTRACTION_INPUT_COLUMNS_PER_ROW_LIMIT_EXCEEDED`）。

---

## 16. Determinism

### 16.1 比較規則

- **ordinal comparator**: 数値は厳密な数値比較（`a - b`）。文字列ID
  （`source_unit_id`等）はP2-A1の`ordinalCompare(a,b){return a<b?-1:a>b?1:0;}`
  と同一パターンの、コードポイント順の厳密比較を用いる。
- **`localeCompare()`禁止**。文字列比較は上記のordinal比較のみを用いる。
- **canonical field order**（固定順序。シリアライズ時はこの順序で出力する）
  - top-level: `schema_version, source_kind, source_document_id, document_fingerprint, content_export_included, units`
  - unit: `source_unit_id, structural_role, normalized_text, occurrence_ordinal, provenance_ref_id, parent_source_unit_id`

### 16.2 `occurrence_ordinal` 割当アルゴリズム（確定）

**単一のグローバルな0始まり整数counterを、下記の決定的走査順で
1unitごとに1ずつ加算しながら割り当てる。** この方式により、同順位
（duplicate ordinal）は構造的に発生し得ない（counterが単調増加する
ため、2つのunitが同じ値を得ることは不可能）。

**PDF（推奨順どおり: document title → page順 → section順 → statement順）**

adapterが生成する `segmented.sections` 配列とその `paragraphs` 配列は、
既にページ順・出現順を保った状態で決定的に確定しているため、P2-A2は
この配列順をそのまま採用する（独自の並べ替えは行わない）。

1. `ordinal = 0`: `DOCUMENT_TITLE`
2. `segmented.sections` を配列順に走査:
   a. 非synthetic かつ `headingConfidence === 'high'` の場合のみ、次の
      ordinalで `SECTION_HEADING` を生成
   b. そのsectionの `paragraphs` を配列順に走査し、各paragraphについて
      次のordinalで `BODY_STATEMENT` を生成

**EXCEL（推奨順どおり: sheet_index → row → column ordinal → KEY → VALUE）**

adapterの `sortedExtractions`（`sheetIndex`昇順）と各シートの `rows`
（`rowNumber`昇順）配列順をそのまま採用する。

1. `ordinal = 0`: `DOCUMENT_TITLE`
2. `sortedExtractions` を`sheet_index`昇順に走査:
   a. 次のordinalで `SHEET_NAME` を生成
   b. そのシートの `rows` を`rowNumber`昇順に走査し、`!row.isEmpty` の
      行についてのみ:
      i. 次のordinalで `ROW_RECORD` を生成
      ii. `column_ordinal` を`0`から`column_headers.length - 1`まで昇順に
         走査し、§11.3のペア生成条件を満たす列についてのみ:
         - 次のordinalで `KEY` を生成
         - その直後、次のordinalで `VALUE` を生成

### 16.3 その他の決定性規則

- **input orderを意味として保持するfield**: `occurrence_ordinal`
  （元文書中の出現順そのものを表す。A2-3以降の隣接性ベースの抽出
  ルールの根拠になる）。
- **input orderに依存してはいけないfield**: `source_unit_id` /
  `provenance_ref_id` / `document_fingerprint`。これらは内容（安全な
  構造識別子）から決定的に導出される値であり、構築時の反復順序や
  配列位置に一切依存しない。
- **duplicateの判定方法**: `source_unit_id`の重複判定は正規化なしの
  厳密な文字列完全一致で行う。

---

## 17. Non-mutation

- projection constructorは、入力として受け取るKnowledgeNode/KnowledgeEdge/
  SourceDocument/DataSetのいずれも変更しない。
- projection（top-levelオブジェクト・各unitオブジェクト）は、既存Nodeへの
  参照ではなく、**すべて新規に生成したplain objectで構成する**。
- core実装時には、P2-A1の`deepFreezeCopyPrivateDictionary`と同様の
  deep-freeze（またはmutation検知）を、構築済みprojectionに対して適用する
  ことを推奨する（本checkpointでは設計上の推奨のみであり、実装はしない）。

---

## 18. Constructor Trust Boundary

**本sectionはconstructorが従うべき「読み取り時の振る舞い」を定義する。
throwするerrorの形・code一覧そのものは、独立した防御層としてではなく、
§13/§14（特に§14.4 Tier C）の単一のerror contractに統合済みである
（GitHub独立レビュー Finding 3）。**

projection constructorがadapter output（KnowledgeNode等）を読み取る際、
次の事象を拒否する（構築時fail-closed）。各事象に対応する固定codeは
§14.4のTier C表を参照すること（本sectionではcode自体を重複して定義
しない）。

- custom prototype（読み取り対象のNode/verbatimオブジェクトの
  prototypeが`Object.prototype`と一致しない。§14.4
  `EXTRACTION_INPUT_CUSTOM_PROTOTYPE_REJECTED`）
- accessor property（getter/setterとして実装されたfield。§14.4
  `EXTRACTION_INPUT_ACCESSOR_PROPERTY_REJECTED`）
- symbol key（§14.4 `EXTRACTION_INPUT_SYMBOL_KEY_REJECTED`）
- non-enumerable extra field（§14.4
  `EXTRACTION_INPUT_NON_ENUMERABLE_FIELD_REJECTED`）
- Proxy trap failure（property読み取りが例外を投げる。§14.4
  `EXTRACTION_INPUT_ROOT_NOT_OBJECT`に統合）
- cyclic object（Node自身やそのprovenance構造が循環参照を持つ。§14.4
  `EXTRACTION_INPUT_CYCLIC_OBJECT_REJECTED`）
- malformed `source_record` / `source_record_display`（§11.2のdescriptor
  手順による拒否、§11.3の空/重複/欠落header検出を含む。§14.4
  `EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD` /
  `EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD_DISPLAY` /
  `EXTRACTION_INPUT_INVALID_COLUMN_HEADERS`）
- unsupported locator shape（`locator.kind`が`'pdf'`/`'excel'`以外、
  または期待するfieldが欠落している。§14.4
  `EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE`）
- 依存モジュール解決失敗・ID生成失敗・正規化処理失敗（§14.4
  `EXTRACTION_INPUT_DEPENDENCY_RESOLUTION_FAILED` /
  `EXTRACTION_INPUT_ID_GENERATION_FAILED` /
  `EXTRACTION_INPUT_NORMALIZATION_FAILED`）

いずれかを検出した場合、projection構築全体を中止する（部分的な
projectionを返さない。個々のNode/行だけを黙ってスキップしない。§14.4の
とおりTier Cは常に短絡・単一エラーである）。

**入力adapter objectは変更しない**（§17と同一の原則をここでも適用する。
読み取り専用アクセスのみ行う）。

---

## 19. P2-A1との接続境界

- A2-2/A2-2Rでは、P2-A1の`validatePrivateDictionary`等のvalidator関数を
  一切呼び出さない。
- A2-2/A2-2Rでは、P2-A1の`entry`（dictionary entry）を一切生成しない。
- A2-2/A2-2Rでは、`scope`（`SESSION`等）や`status`（`PROBATION`等）を
  一切生成しない。本Contractのprojection/unitのいずれにも、これらに
  相当するfieldは存在しない。
- `SESSION`スコープ・`PROBATION`ステータスの強制は、**後続のA2-5
  （SESSION候補projection）でのみ**行う。
- P2-A1のsnapshot validator（`validatePrivateDictionary`）は、
  `status:'ACTIVE'`や`scope:'DOMAIN'/'PROJECT'`を持つ`DOCUMENT_EXTRACTED`
  entryを技術的には拒否しない（§0参照）。したがって、A2-5以降の
  実装は、**P2-A1側の検証に頼らず、P2-A2自身の生成ロジックの中で**
  PROBATION/SESSION限定を強制しなければならない。

---

## 20. 付録: illustrative examples（設計検証用。contract内埋め込み）

独立したfixtureファイルは作成せず、本Contract内に例示として埋め込む
（A2-2Rでもfixtureファイルは追加しない。作成ファイルを設計文書1点に
限定するため）。

### 20.1 PDF由来projectionの例

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
      "provenance_ref_id": "pref-1111111111111111111111111111111",
      "parent_source_unit_id": null
    },
    {
      "source_unit_id": "psu-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "structural_role": "SECTION_HEADING",
      "normalized_text": "第2章 使用条件",
      "occurrence_ordinal": 1,
      "provenance_ref_id": "pref-2222222222222222222222222222222",
      "parent_source_unit_id": "psu-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    {
      "source_unit_id": "psu-cccccccccccccccccccccccccccccccc",
      "structural_role": "BODY_STATEMENT",
      "normalized_text": "空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。",
      "occurrence_ordinal": 2,
      "provenance_ref_id": "pref-3333333333333333333333333333333",
      "parent_source_unit_id": "psu-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ]
}
```

### 20.2 EXCEL由来projectionの例（KEY/VALUE分解を含む。KEYとVALUEが
独立した`provenance_ref_id`を持つ点に注意 — §9.3の変更を反映）

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
      "provenance_ref_id": "pref-4444444444444444444444444444444",
      "parent_source_unit_id": null
    },
    {
      "source_unit_id": "psu-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "structural_role": "SHEET_NAME",
      "normalized_text": "設計検討表",
      "occurrence_ordinal": 1,
      "provenance_ref_id": "pref-5555555555555555555555555555555",
      "parent_source_unit_id": "psu-dddddddddddddddddddddddddddddddd"
    },
    {
      "source_unit_id": "psu-ffffffffffffffffffffffffffffffff",
      "structural_role": "ROW_RECORD",
      "normalized_text": "部品番号: A-102 / 名称: 制御弁 / 数量: 4",
      "occurrence_ordinal": 2,
      "provenance_ref_id": "pref-6666666666666666666666666666666",
      "parent_source_unit_id": "psu-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    },
    {
      "source_unit_id": "psu-1010101010101010101010101010101a",
      "structural_role": "KEY",
      "normalized_text": "名称",
      "occurrence_ordinal": 3,
      "provenance_ref_id": "pref-7777777777777777777777777777777",
      "parent_source_unit_id": "psu-ffffffffffffffffffffffffffffffff"
    },
    {
      "source_unit_id": "psu-2020202020202020202020202020202b",
      "structural_role": "VALUE",
      "normalized_text": "制御弁",
      "occurrence_ordinal": 4,
      "provenance_ref_id": "pref-8888888888888888888888888888888",
      "parent_source_unit_id": "psu-ffffffffffffffffffffffffffffffff"
    }
  ]
}
```

---

## 21. 解消済み事項の記録（A2-2からの持ち越し。すべて本版で解消）

| A2-2時点の未解決事項 | A2-2Rでの結論 |
|---|---|
| projection自体のcanonical fingerprintを追加すべきか | **不採用として確定**（§7）。将来追加時はschema_version更新が必要と明記した。 |
| `heading_confidence`をunit schemaへ反映すべきか | **反映しない**まま確定（§5.3）。既存adapter実装の帰結として、追加ロジックなしに方針が満たされることを確認した。 |
| fixtureを独立ファイルとして切り出すか | **A2-2Rでも作成しない**。設計doc内埋め込み例のみ（§20）。 |
| `MAX_ID_LENGTH`の正確な正規表現形式 | **確定**（§9.1の表）。 |
| `EXTRACTION_INPUT_*` エラーコード一覧の最終確定 | A2-2Rで一旦確定（全30種、Tier A 6種+Tier B 24種）。**A2-2R2でさらに更新**（§22参照）。 |

本版時点で、A2-2報告に記載していた未解決事項はすべて解消した。

## 22. A2-2R2 修正記録（GitHub独立レビュー 3件のblocking finding）

| finding | 内容 | 対応 |
|---|---|---|
| Finding 1 | `normalized_text`に対するpath/URI様文字列拒否が、文書本文の正常なcontentと、実際のfilesystem/networkアクセス可否を混同していた | `EXTRACTION_INPUT_PATH_LIKE_VALUE_REJECTED`を廃止。projection schemaにfilesystem locator fieldを含めない方針・constructorがpath/URIをdereferenceしない方針は維持（§10）。 |
| Finding 2 | Excelの`source_record`/`source_record_display`読取りが`hasOwnProperty.call`ベースで、accessor/non-enumerable propertyを明示的に区別していなかった | `Object.getOwnPropertyDescriptor()`ベースのdescriptor手順へ全面置換。data descriptor・enumerable:trueのみを許可し、`descriptor.value`からのみ値を取得する（§11.2）。 |
| Finding 3 | Constructor Trust Boundary（§18）が、validationのerror contract（§13/§14）とは別の独立した防御層として記述されていた | Tier C（§14.4）として単一のerror contractへ統合。Tier Aの6 codeを再利用しつつ、constructor固有の7 codeを新設した。 |

本版時点で、GitHub独立レビューの3件のblocking findingはすべて解消した。
error code総数は36種（Tier A 6種[validator/constructor共用] + Tier B 23種
+ Tier C固有7種）としていたが、**この総数はA2-2R3でさらに更新された
（§23参照。constructorのbounds違反に対応するcodeが未定義だったため）**。

## 23. A2-2R3 修正記録（GitHub独立確認: constructor bounds error contract）

**背景**: A2-2R2までの版では、constructorが§15.1のbounds（`MAX_UNITS`の
分解前見積り超過・分解中実件数超過、`MAX_COLUMNS_PER_ROW`超過、構築時に
canonical UTF-8サイズを検査する場合の超過）を検出した際にthrowすべき
固定codeが定義されていなかった。GitHub独立確認でこれを検出した。

**必須修正1（constructor bounds code）への対応**:

- `EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED`をvalidator（Tier B B-8）と
  constructor（Tier C C-7）の共用codeとして明記した（§13/§14.3/§14.4/
  §15.1）。分解前の見積り超過・分解中の実件数超過のいずれもこのcodeを
  用いる。
- `EXTRACTION_INPUT_UTF8_BYTES_LIMIT_EXCEEDED`も同様にvalidator（Tier B
  B-23）とconstructor（Tier C C-8）の共用codeとして明記した。constructor
  が構築時に逐次UTF-8サイズを検査する場合（任意）に用いる。
- `EXTRACTION_INPUT_COLUMNS_PER_ROW_LIMIT_EXCEEDED`をTier C固有の新規code
  （C-9）として追加した。

**必須修正2（安全な見積り）への対応**: §15.1を全面改稿し、
`column_headers.length`を`MAX_COLUMNS_PER_ROW`と比較してから初めて算術式
（`1 + 2 × columnCount`）へ使う、行ごとに残容量（`MAX_UNITS -
runningEstimate`）と比較してから加算する、`runningEstimate`が
`MAX_UNITS`を一度も超えない設計にする、上限超過を検出した時点で残りの
行を処理せず短絡する、という逐次アルゴリズムに確定した。`columnCount`が
`MAX_COLUMNS_PER_ROW`（1,000）以下、`rowContribution`が高々2,001に
既に縛られているため、`Number.MAX_SAFE_INTEGER`を超える計算は構造的に
発生しない。

**必須修正3（B番号誤記）への対応**: §15の`MAX_CHILDREN_PER_PARENT`の説明
にあった「validation時（B-22）」を「B-21」に訂正した（B-21が
`EXCESSIVE_CHILDREN_PER_PARENT`、B-22は`DISTINCT_PROVENANCE_REFERENCES_LIMIT_EXCEEDED`
であるため）。

**更新後の総数**: Tier C合計16種（Tier A由来6種 + Tier B由来2種 + 固有
8種）。error code総数は37種（Tier A 6種[validator/constructor共用] +
Tier B 23種[うち2種はconstructorとも共用] + Tier C固有8種）で確定する。
`EXTRACTION_INPUT_DUPLICATE_OCCURRENCE_ORDINAL`・
`EXTRACTION_INPUT_PATH_LIKE_VALUE_REJECTED`の2種は引き続き廃止済みの
まま（文書内には廃止理由の記録としてのみ残る）。

本版時点で、GitHub独立確認で指摘されたconstructor bounds error
contractの欠落は解消した。新たな未解決事項は生じていない。
top-level schema（§3）・unit schema（§4）は変更していない。
