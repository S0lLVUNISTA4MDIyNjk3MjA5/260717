# Private Dictionary Candidate Review UI Contract 0.1

P2-A3 / 非公開辞書候補レビューUI 設計契約

- 正本 base: `af6ba3283afa3cf042871f1ed4f8277a3abb16d0`（integration branch `claude/child-handover-qcycsj`）
- 依存 contract: `private_dictionary_rule_extraction_contract_0.1.md`（P2-A2、変更しない）
- 状態: Checkpoint 1（設計確定 + 操作モック）。実装は後続 checkpoint

---

## S1. Scope

### S1.1 目的

利用者が JSON / Markdown を直接扱わずに、ブラウザ画面上で辞書候補キーワードを確認し、
`ACCEPT` / `REJECT` / `UNCERTAIN` を判定し、判定結果を Excel として保存・再開できるようにする。

### S1.2 このUIがすること

候補の**表示・レビュー・判断の記録**だけを行う。

### S1.3 このUIがしないこと

- 抽出 rule の再実装・変更
- candidate ID / alias candidate ID / conflict ID の生成・変更
- alias conflict の自動解決
- `scope` / `status` の変更（生成物は常に `SESSION` / `PROBATION`）
- 辞書への自動登録・merge
- P2-A2 が定めた privacy 契約の緩和

P2-A2 の以下は**変更禁止**であり、UI から再実装してはならない。

```text
tools/knowledge_builder/core/private_dictionary_rule_extraction_core.js
tools/knowledge_builder/core/pdf_direct_adapter.js
tools/knowledge_builder/core/excel_direct_adapter.js
tools/knowledge_builder/core/id_hash_utils.js
tools/knowledge_builder/evaluation/private_dictionary_candidate_evaluation_cli.js
tools/knowledge_builder/verification/private_dictionary_rule_extraction_core_verification.js
tools/knowledge_builder/design/private_dictionary_rule_extraction_contract_0.1.md
```

---

## S2. Architecture

### S2.1 採用方式：browser-memory processing

```text
local Node server (static only)
  └─ HTML / JS / CSS / vendor asset を配信するだけ
browser
  ├─ File API で PDF / Excel を読む（server へ送らない）
  ├─ PDF.js / SheetJS で adapter を実行
  ├─ P2-A2 extraction core を実行
  ├─ Extraction Result をメモリ保持
  ├─ Review State を別オブジェクトで保持
  └─ Excel 成果物を生成（SheetJS + Blob download）
```

### S2.2 禁止事項（アーキテクチャ制約）

- private 入力の HTTP API 経由 server upload
- server 側の一時 input 保存
- server 側の candidate JSON 保存
- CLI subprocess への private path 引き渡し
- 配布 directory 内への runtime fallback 保存（`.p2a2-ui-runtime` 相当）

### S2.3 実現性の根拠

Checkpoint 1 にて Chromium 実測済み。固定 base SHA の Node 実行結果と
`candidate_evaluation.json` / `candidate_review.md` / `shareable_summary.json` が
**byte 完全一致**することを確認した（`p2a3_attached_ui_assessment.md` §13）。
製品コード側の変更は不要である。

### S2.4 browser で利用する global

| global | 供給元 | 用途 |
|---|---|---|
| `QuantitySidecarBinding` | `tools/quantity_sidecar_binding_core.js` | normalize / hash 基盤 |
| `KnowledgeIdHashUtils` | `core/id_hash_utils.js` | ID / fingerprint |
| `KnowledgePdfDirectAdapter` | `core/pdf_direct_adapter.js` | PDF → KnowledgeNode |
| `KnowledgeExcelDirectAdapter` | `core/excel_direct_adapter.js` | Excel → KnowledgeNode |
| `PrivateDictionaryRuleExtractionCore` | `core/private_dictionary_rule_extraction_core.js` | projection / 抽出 / 直列化 |
| `pdfjsLib` | `ui/vendor/pdfjs/pdf.min.js` | PDF 解析 |
| `XLSX` | `ui/vendor/xlsx.full.min.js` | Excel 読み書き |

読み込み順は依存順に固定する：
`xlsx` → `pdfjs cmaps-data` → `pdfjs fonts-data` → `pdfjs alpha-local-factories` → `pdf.min.js`
→ `quantity_sidecar_binding_core` → `id_hash_utils` → `pdf_direct_adapter` → `excel_direct_adapter`
→ `private_dictionary_rule_extraction_core` → app。

`pdfjsLib.GlobalWorkerOptions.workerSrc` は同一 origin の `pdf.worker.min.js` を指す。

---

## S3. Module 責務

| module | 責務 | private data を保持するか |
|---|---|---|
| `server.js` | static asset 配信、browser 起動、token 発行 | **しない** |
| `ingest.js` | File → ArrayBuffer → adapter → projection | する（メモリのみ） |
| `extraction.js` | projection → `extractLocalDictionaryCandidates` | する（メモリのみ） |
| `evidence_index.js` | adapter result / projection → Evidence Display Index | する（メモリのみ） |
| `review_state.js` | Review State の生成・更新・集計 | する（判断のみ） |
| `table_view.js` | candidate table 描画、filter / sort / pagination | 表示のみ |
| `evidence_panel.js` | 詳細 panel 描画、highlight | 表示のみ |
| `conflict_view.js` | conflict tab 描画・解決記録 | 表示のみ |
| `dashboard.js` | 集計表示 | 集計のみ |
| `workbook_private.js` | private review workbook 生成・読込 | する |
| `workbook_shareable.js` | content-free workbook 生成 | **しない** |
| `advanced_export.js` | JSON / MD 出力（監査用） | する |

`Extraction Result` を保持する module は、それを**書き換えてはならない**。

---

## S4. Data flow

```text
[File 選択 / drag&drop]
   ↓ File API (browser memory)
[ArrayBuffer]
   ↓ crypto.subtle.digest('SHA-256') → content_digest
[adapter result]  ← KnowledgePdfDirectAdapter / KnowledgeExcelDirectAdapter
   ├──────────────→ [Evidence Display Index]  (表示専用)
   ↓
[Extraction Input Projection]
   ↓ validateExtractionInputProjection  (invalid なら fail-closed)
[Extraction Result]  (immutable)
   ↓
[candidate table / alias tab / conflict tab / dashboard]
   ↓ 人間の判断
[Review State]  (Extraction Result とは別オブジェクト)
   ↓
├─ private_dictionary_candidate_review.xlsx     (private)
├─ shareable_review_summary.xlsx                (content-free)
└─ advanced export: JSON / Markdown             (通常操作から分離)
```

### S4.1 run snapshot（入力の原子性）

run の途中で入力選択が変わっても、**解析対象が入れ替わってはならない**。

- 解析開始時に **`runSelection` / `runSelectionRevision` / `runInputSignature` を snapshot する**。
  snapshot は `Object.freeze` 済みで、以後の選択操作に影響されない。
- ingest は live な選択ではなく **snapshot の `runSelection` を消費する**。
- 成功した run が session に記録する入力同一性は、snapshot 側の値である
  （run 完了時点の live な選択ではない）。
- **`revision` は選択に対する任意の変更（追加 / 削除 / 全消去）で単調増加する。**
  `name` と `size` が同一の別内容ファイルへ差し替えられた場合、metadata 由来の
  `runInputSignature` は変化しないが、`revision` は変化する。両方を保持することで
  この差し替えを検出できる。
- **run 中は選択の変更操作を禁止する。** 禁止は
  **DOM（`disabled` 属性）と handler 側 guard の両方**で行う。DOM だけの抑止では、
  実行中に到達した handler が state を書き換え得るため不足である。
- 実行中フラグの変化は再描画に反映されなければならない
  （app state と DOM が乖離してはならない）。

---

## S5. データ3層

### S5.1 Extraction Result（immutable）

`private-dictionary-candidate-evaluation/0.1`。P2-A2 core が生成し `Object.freeze` 済み。
UI は読み取りのみ。複製して書き換えることも禁止する。

### S5.2 Evidence Display Index（local private、表示専用）

`source_unit_id` / `provenance_ref_id` から画面表示に必要な情報を引くための index。
**adapter result から実際に取得できる項目のみ**を使用し、取得できない項目を推測で作らない。

| field | 出所 | 備考 |
|---|---|---|
| `source_document_id` | projection | |
| `source_unit_id` | projection unit | key |
| `provenance_ref_id` | projection unit | key |
| `source_kind` | projection | `PDF` / `EXCEL` |
| `display_file_name` | adapter `sourceDocument.file_name` | private |
| `structural_role` | projection unit | |
| `normalized_text` | projection unit | private。excerpt 表示に使用 |
| `parent_source_unit_id` | projection unit | |
| `page` | PDF: `provenance.locator.page` | Excel では `null` |
| `section_title` | PDF: `provenance.locator.section_title` | `null` 可 |
| `sheet` | Excel: `provenance.locator.sheet` | PDF では `null` |
| `row` | Excel: `provenance.locator.row` | PDF では `null` |
| `column` | Excel: KEY/VALUE unit の由来 column header | PDF では `null` |

取得できない値は `null` とし、画面では「—」と表示する。捏造しない。
この index は shareable 成果物へ**含めない**。

### S5.3 Review State（人間の判断のみ）

```jsonc
{
  "review_schema_version": "private-dictionary-candidate-review/0.1",
  "extraction_schema_version": "private-dictionary-candidate-evaluation/0.1",
  "source_fingerprints": [
    { "source_document_id": "sd-…", "document_fingerprint": "<64hex>" }
  ],
  "candidate_decisions": [
    {
      "candidate_id": "pdc-…",
      "decision": "UNREVIEWED|ACCEPT|REJECT|UNCERTAIN",
      "reason_code": "GENERAL_TERM|…|OTHER|null",
      "note": "自由記述（private）",
      "decided_at": "ISO8601|null"
    }
  ],
  "alias_decisions": [
    {
      "alias_candidate_id": "pda-…",
      "decision": "UNREVIEWED|ACCEPT|REJECT|UNCERTAIN",
      "reason_code": "…|null",
      "note": "…",
      "decided_at": "ISO8601|null"
    }
  ],
  "conflict_resolutions": [
    {
      "conflict_id": "pdx-…",
      "resolution": "UNRESOLVED|SELECT_CANONICAL|REJECT_ALL|CONTEXT_DEPENDENT|UNCERTAIN",
      "selected_candidate_id": "pdc-…|null",
      "reason_code": "…|null",
      "note": "…",
      "decided_at": "ISO8601|null"
    }
  ],
  "reviewer_notes": { "session_note": "…" },
  "review_summary": {
    "candidate_total": 0, "candidate_reviewed": 0,
    "accept": 0, "reject": 0, "uncertain": 0, "unreviewed": 0,
    "alias_total": 0, "alias_reviewed": 0,
    "conflict_total": 0, "conflict_resolved": 0,
    "by_reason_code": {}, "by_rule": {}
  }
}
```

**制約**

- Review State と Extraction Result を混ぜて破壊的更新しない。
- 保存値は固定英語 enum。画面表示は日本語でよい。
- `selected_candidate_id` は `resolution === "SELECT_CANONICAL"` のときのみ非 `null`。
- canonical を `ACCEPT` しても alias は自動 `ACCEPT` しない（別判断）。

### S5.4 Decision enum

```text
UNREVIEWED  ACCEPT  REJECT  UNCERTAIN
```

### S5.5 Reason code enum

| code | 画面表示 |
|---|---|
| `GENERAL_TERM` | 一般語すぎる |
| `NUMERIC_OR_SYMBOLIC` | 数値・記号中心 |
| `CONTEXT_DEPENDENT` | 文脈依存 |
| `EXTRACTION_ERROR` | 誤抽出 |
| `DUPLICATE_CANDIDATE` | 別候補と重複 |
| `ALIAS_UNCLEAR` | alias 関係が不明 |
| `CANONICAL_TOO_LONG` | canonical が長すぎる |
| `NEWLINE_BOUNDARY_OVER_CAPTURE` | 改行境界の過剰取得（NB-01 確認用） |
| `INSUFFICIENT_EVIDENCE` | evidence 不足 |
| `OTHER` | その他 |

`REJECT` / `UNCERTAIN` では理由選択を促す（未選択でも保存は可能だが警告表示）。
`ACCEPT` の理由入力は任意。

---

## S6. private / shareable 境界

### S6.1 区分

| 区分 | 内容 |
|---|---|
| **private** (`private_dictionary_candidate_review.xlsx`, advanced JSON/MD) | canonical term、alias term、evidence excerpt、file 名、sheet 名、reviewer note、全 ID を含んでよい |
| **shareable** (`shareable_review_summary.xlsx`) | **集計値のみ**。S6.2 の allowlist に列挙した項目だけを含む |

### S6.2 shareable 許可項目（allowlist / 完全列挙）

shareable 成果物へ含めてよいのは次だけである。ここに無いものは含めない。

```text
schema version
source fingerprints
candidate 総数
alias 総数
conflict 総数
decision 別件数
reason code 別件数
rule 別件数
review 進捗
tool build 情報
```

### S6.3 shareable 禁止項目（denylist）

**candidate 系 ID を含む一切の識別子と、あらゆる本文・名称を含めてはならない。**

```text
candidate_id
alias_candidate_id
conflict_id
selected_candidate_id
source_unit_id
provenance_ref_id
canonical term
alias term
file 名
sheet 名
PDF 本文
evidence excerpt
reviewer note
private path
```

`source_fingerprints` は例外的に許可する。これは入力バイト列に対する不可逆ハッシュであり、
候補や本文を復元できないためである（`source_document_id` と `document_fingerprint` のみ）。

### S6.4 conflict の扱い

conflict は **件数と解決状態の分布のみ**を共有する。
どの alias がどの canonical と競合したか、どちらを選んだかは shareable へ出さない。
`selected_candidate_id` は ID であっても共有不可である
（Extraction Result を持つ相手には candidate ID から本文が逆引きできるため、
「表示名を伴わなければ共有可」という緩和は成立しない）。

### S6.5 共有前確認

shareable 成果物の生成時は、内容のプレビューと人間の明示的な確認を必須とする。
確認画面にも「用語本文・ID は含まれていない」ことを明示する。

---

## S7. Candidate table

主画面は Markdown ではなく interactive table。

| 列 | 内容 | 既定表示 |
|---|---|---|
| 選択 | 一括操作用 checkbox | ○ |
| 判定 | ACCEPT / REJECT / UNCERTAIN / 未判定 | ○ |
| キーワード | `canonical_term`（**最も見やすい主列**） | ○ |
| Alias | 対応する alias 候補 | ○ |
| Rule | `rule_ids` | ○ |
| 出典 | PDF / Excel | ○ |
| 出現数 | `exposure_count` | ○ |
| 文書数 | `document_support_count` | ○ |
| Conflict | `alias_conflict_count` | ○ |
| 理由 | reason code | ○ |
| メモ | reviewer note | ○ |
| 詳細 | evidence panel を開く | ○ |

`candidate_id` / `source_unit_id` / `provenance_ref_id` は**通常列へ出さない**。
詳細 panel および advanced export（監査情報）でのみ表示する。

### S7.1 一括操作

行単位判定ボタン、keyboard 操作、複数行選択、一括 REJECT / UNCERTAIN / ACCEPT。
**一括 ACCEPT は確認 dialog を必須**とする（誤操作防止）。判定変更は即座に dashboard へ反映する。

---

## S8. Filter / sort / pagination

filter：`すべて` / `未判定` / `ACCEPT` / `REJECT` / `UNCERTAIN` / `PDF由来` / `Excel由来` /
`Aliasあり` / `Conflictあり` / `Rule別`

keyword 検索：canonical term、alias term

sort：keyword / exposure count / document count / conflict 優先 / rule / decision

pagination：50 / 100 / 200 件単位、または同等の virtualized rendering。
**全候補を無制限に DOM へ追加しない。**

### S8.1 pagination の必須要件

「先頭 N 件だけを描画して残りを到達不能にする」実装は **pagination ではない**。以下を必須とする。

- **candidate / alias / conflict の 3 tab すべて**に、実際にページを移動できる操作
  （先頭 / 前 / 次 / 末尾、および現在位置と総ページ数の表示）を持たせる。
  N 件目以降が UI 上で到達不能であってはならない。
- **alias tab と conflict tab は、candidate tab とは独立した page / pageSize state を持つ。**
  片方のページ移動が他方のページ位置を動かしてはならない。
- page 番号は 1-origin とし、要求ページが範囲外のときは **clamp する**（例外を投げない）。
  filter によって件数が減った場合、最後の有効ページに着地する。
- filter / sort / keyword 検索 / pageSize 変更のいずれかが起きたら、
  **candidate のページ位置を 1 に戻す**。
- **select-all は現在ページの範囲に限定する**（`ページ内 n 件を選択 / 全体 m 件中` のように
  ページ内選択数と全体件数の両方を表示する）。
- 一括操作の確認表示には、**実際に操作対象となる件数**を出す。
  画面外の件数を含めた誤った数を表示してはならない。
- 検証は 451 candidate / 451 alias / 451 conflict の synthetic session を用い、
  pageSize 50 / 100 / 200 の各条件で恒久 check として実行する。

---

## S9. Evidence panel

候補行選択で右 side panel または modal に表示：

- canonical keyword / alias 候補 / rule / scope / status
- exposure count / document count / conflict
- evidence 一覧（source 種別、file 名、page または sheet / row / column、excerpt）
- 同一候補の別出現

excerpt 内では候補文字列を highlight する。highlight は **DOM 分割**で行い、
`innerHTML` へ利用者由来文字列を渡さない。panel 内にも private 表示を出す。

---

## S10. Alias review

alias candidate は canonical の補助表示にとどめず、個別にレビュー可能とする。
状態は S5.4 と同じ 4 値。canonical の ACCEPT が alias へ波及しないことを UI 上も明示する。

---

## S11. Conflict review

alias conflict 専用 tab。表示例：

```text
Alias: CA
  Controller A
  Controller B
```

人間が選べる状態：

```text
UNRESOLVED  SELECT_CANONICAL  REJECT_ALL  CONTEXT_DEPENDENT  UNCERTAIN
```

- **自動解決しない。**
- `SELECT_CANONICAL` では選択した candidate ID を Review State へ保存する。
- 抽出 core の conflict object は変更しない。
- conflict は件数に関わらず全件確認を促す。

---

## S12. Dashboard

常時表示：候補総数 / 未判定 / ACCEPT / REJECT / UNCERTAIN / Alias 総数 / Alias 未判定 /
Conflict 総数 / 未解決 Conflict / PDF 由来 / Excel 由来 / Rule 別件数 / レビュー進捗率。

```text
レビュー進捗率 = 判定済 candidate 数 / candidate 総数
```

alias と conflict の進捗は**別に表示**する。

---

## S13. Save / resume と Excel workbook schema

### S13.1 private review workbook

`private_dictionary_candidate_review.xlsx`（**private content を含む**）

| sheet | 内容 |
|---|---|
| `Summary` | S13.1.5 で確定する固定 metric 集合（review 集計、進捗、reason code 別件数、rule 別件数） |
| `Candidates` | S13.1.1 の確定列 |
| `Aliases` | S13.1.2 の確定列 |
| `Alias Conflicts` | conflict_id、alias_display、conflicting_candidate_ids、resolution、selected_candidate_id、reason_code、note |
| `Evidence Index` | S13.1.6 で確定する 11 列（`page`／`sheet`／`row`／`column` は分離した独立列） |
| `Source Documents` | source_document_id、document_fingerprint、source_kind、file 名 |
| `Build Information` | S13.1.4 で確定する 3 key（`review_schema_version` / `extraction_schema_version` / `tool_build`） |

#### S13.1.1 sheet `Candidates` 確定列

```text
candidate_id
canonical_term
scope
status
rule_ids
exposure_count
document_support_count
alias_conflict_count
decision
reason_code
note
```

保存値：`scope` は常に `SESSION`、`status` は常に `PROBATION`。

#### S13.1.2 sheet `Aliases` 確定列

```text
alias_candidate_id
alias_term
canonical_candidate_id
canonical_term
scope
status
rule_ids
decision
reason_code
note
```

保存値：`scope` は常に `SESSION`、`status` は常に `PROBATION`。

#### S13.1.3 scope / status 列の位置づけ

`scope` / `status` は Extraction Result 由来の値であり、**照合・検証専用**である。

- Workbook から読み込んだ `scope` / `status` を **Extraction Result へ適用してはならない**。
- Review State へも書き込まない（Review State は人間の判断のみを保持する / S5.3）。
- import 時に「Workbook 側の値」「Extraction Result 側の値」「契約上の固定値」の
  三者が一致することを確認するためだけに用いる（S13.2）。

#### S13.1.4 sheet `Build Information` 確定 key（P2-A3 0.1 正式版・Checkpoint 3-R1 是正）

private Workbook・shareable Workbook のいずれも、`Build Information` sheet の `key` 列は
**次の 3 つに確定する。これ以外の key を含めない。**

```text
review_schema_version
extraction_schema_version
tool_build
```

| key | 内容 |
|---|---|
| `review_schema_version` | Review State の schema version（S5.3 の `REVIEW_SCHEMA_VERSION`） |
| `extraction_schema_version` | Extraction Result の schema version（P2-A2 evaluation の `schema_version`） |
| `tool_build` | 固定の環境非依存 identifier（例：`p2a3-candidate-review-ui/0.1`）。ビルドごと・実行環境ごとに変化しない |

**旧記載（`生成時刻` / `generated_at` / `tool_version` / `source_commit`）は削除する。** 理由：

- **`generated_at`（生成時刻）**：同一 state から複数回生成した Workbook が **byte-identical**
  であることを P2-A3 0.1 は要件とする（S13.1 の byte determinism 要件、および Checkpoint 3
  測定報告）。壁時計時刻を Workbook データへ記録すると、生成するたびに値が変わり、この要件と
  両立しない。したがって `generated_at` は **P2-A3 0.1 では保存しない**。
- **`source_commit`**：実行中の runtime source から、対応する commit SHA を自己参照的かつ正確に
  特定する仕組みが Checkpoint 3 の時点では存在しない（誤った値を記録する方が実害が大きい）。
  この情報を扱う場合は、最終 packaging 時点の MANIFEST／build provenance に属する**後続事項**
  とし、P2-A3 0.1 の Workbook contract には含めない。
- **`tool_version`**：`tool_build` に統合した。ビルドごとに変わる値ではなく、固定の
  環境非依存 identifier 1 本で足りる。

`generated_at` を含め、環境依存値（path、ホスト名、ユーザー名、OS username、timezone、
temporary directory）は Build Information へ一切含めない。

#### S13.1.5 sheet `Summary` 確定 metric 集合（Checkpoint 3-R1 是正）

`Summary` sheet の行集合は次を **固定・完全列挙**とし、行数・順序も固定する。ここに無い
metric を含めてはならず、ここにある metric が欠落してもならない。

```text
scalar metric（S12 dashboard の値と対応する固定集合。件数・進捗率）
reason_code:<CANDIDATE|ALIAS|CONFLICT>:<S5.5 の 10 reason code>   の全組合せ
rule_candidate_count:<P2-A2 の 6 rule_id（TERM_STRUCTURAL_KEY / TERM_STRUCTURAL_HEADING /
  TERM_REPEATED_VALUE / TERM_EXPLICIT_QUOTED / ALIAS_EXPLICIT_PARENTHETICAL /
  ALIAS_EXPLICIT_DEFINED_AS）>
rule_alias_count:<同上>
```

`value` は非負の有限数とする。`*_progress_percent` で終わる metric は `0`〜`100` の範囲とする。

**`Summary` は resume の正本ではない**（S13.2 の完全一致条件に含まれない）。ただし、tool 自身が
生成した private Workbook の監査コピーであるため、破損した `Summary` を黙って受理してはならない。
import 時は次の 2 段階で検証する。

1. **構造検証**：行数の完全一致、metric の固定集合との完全一致（duplicate なし・欠落なし・
   未知 metric なし）、value の型・範囲。
2. **集計再計算による値検証**：Candidates／Aliases／Alias Conflicts から pending Review State を
   構築した後、現在の Extraction Result と pending Review State から `Summary` の期待値を
   再計算し、Workbook `Summary` の全値と比較する。1 件でも不一致があれば Workbook 全体を
   atomic rejection する。

いずれの段階の不整合も、Workbook の import を拒否する理由になる。

#### S13.1.6 sheet `Evidence Index` 確定列と対象範囲（Checkpoint 3-R1 是正）

確定列（11 列、`page`／`sheet`／`row`／`column` は分離した独立列とする）：

```text
source_document_id
source_unit_id
provenance_ref_id
source_kind
file_name
role
page
sheet
row
column
excerpt
```

**この sheet の行集合は「candidate／alias／conflict の evidence_refs から到達可能な
source_unit_id」だけに限定する。** 現在の projection に存在する全 unit を無差別に列挙しない
（S9 の evidence panel から実際に到達できる範囲と一致させ、UI に一度も表示されない構造的な
unit まで書き出さない）。この対象範囲の限定は実装都合ではなく、**この Workbook contract の
確定事項**である。

**Evidence Index は resume の正本ではない**（S5.2 の Evidence Display Index が正本のまま）。
import 時は監査／表示コピーとして次を検証し、1 件でも不一致があれば Workbook 全体を
atomic rejection する。

- **範囲の完全一致**：Workbook の `source_unit_id` 集合が、現在の evaluation から再計算した
  「参照済み unit 集合」と完全に一致すること（欠落・余分・duplicate のいずれも拒否）。
- **各行の参照整合性**：`source_unit_id` が現在の Evidence Display Index の `byUnitId` に、
  `provenance_ref_id` が `byProvenanceRefId` に、それぞれ存在し、かつ両者が**同一の
  entry** を指すこと（prefix が正しいだけでは受理しない）。
- **`source_document_id` と `source_kind` の整合**：Workbook の値が、現在の Evidence Display
  Index の該当 entry の値と一致すること。
- **descriptive column の型検証**：`file_name`／`role`／`page`／`sheet`／`row`／`column`／
  `excerpt` は identity として使用しないが、型は検証する（`page`／`row` は数値または空欄、
  `sheet`／`column`／`file_name`／`excerpt` は文字列または空欄、`role` は非空文字列）。
  現行仕様で `page`／`row` が常に空欄になる、あるいは `sheet`／`column` が Excel の
  KEY/VALUE 交互構造以外で空欄になることは、そのまま許可する（S5.2）。

Workbook の Evidence Index から、現在の Evidence Display Index を再構築・置換することは禁止する。

### S13.2 再開時の検証（完全一致のみ許可 / all-or-nothing）

P2-A3 0.1 では、**次のすべてが完全一致した場合にのみ** review 再開を許可する。

```text
review_schema_version                    完全一致
extraction_schema_version                完全一致
source_fingerprints                      完全一致（集合として）
candidate ID 集合                         完全一致
alias candidate ID 集合                   完全一致
conflict ID 集合                          完全一致
全 candidate / alias の scope             すべて SESSION
全 candidate / alias の status            すべて PROBATION
```

**順序差のみ**は不一致として扱わない。比較は canonical sort（ID 昇順、fingerprint は
`source_document_id` 昇順）を適用したうえで行う。

#### S13.2.0 scope / status の照合手順

Workbook 内の**各 candidate 行・各 alias 行**について、次を順に確認する。

1. `scope` 列が存在する（sheet の header に含まれる）
2. `status` 列が存在する（sheet の header に含まれる）
3. その行の `scope === "SESSION"`（文字列として厳密一致）
4. その行の `status === "PROBATION"`（文字列として厳密一致）
5. 同じ ID を持つ**現在の Extraction Result 側**の要素も `scope === "SESSION"` かつ
   `status === "PROBATION"` である
6. Workbook 側の値と Extraction Result 側の値が**一致する**

1 行でも上記のいずれかを満たさない場合、**Workbook 全体を atomic rejection** する（S13.2.2）。
`scope` / `status` は照合専用であり、Extraction Result へ適用しない（S13.1.3）。

#### S13.2.1 拒否条件

次のいずれかに該当した場合、**Workbook 全体の import を拒否**する。1 件でも該当すれば全体を拒否し、
一部だけを取り込むことはしない。

```text
欠落 ID                                   期待される ID が Workbook に無い
余分な ID                                 Extraction Result に存在しない ID がある
fingerprint 差異                          source_fingerprints が一致しない
schema 差異                               review / extraction の schema version が一致しない
scope 列欠落                              Candidates / Aliases sheet に scope 列が無い
status 列欠落                             Candidates / Aliases sheet に status 列が無い
scope 空値                                scope セルが空
status 空値                               status セルが空
scope 型不正                              scope が文字列でない
status 型不正                             status が文字列でない
scope 差異                                SESSION 以外が含まれる
status 差異                               PROBATION 以外が含まれる
scope / status の照合不一致                Workbook 側の値が Extraction Result 側の値と一致しない
duplicate ID                             同一 ID が複数行に現れる
malformed cell                           必須セルが空・型不正・長さ超過
unknown enum                             decision / reason_code / resolution が既定値以外
invalid selected candidate               selected_candidate_id が candidate 集合に存在しない
conflict に属さない candidate の選択        selected_candidate_id がその conflict の
                                          conflicting_candidate_ids に含まれない
```

#### S13.2.2 拒否時の要件（atomic rejection）

| 要件 | 内容 |
|---|---|
| Extraction Result | **変更しない**（元々 immutable） |
| Review State | **変更しない**。読み込み前の状態をそのまま維持する |
| 部分適用 | **行わない**。1 件の decision も適用しない |
| error 表示 | private term、alias term、file 名、sheet 名、evidence excerpt、note、path を**表示しない** |
| 表示してよいもの | content-free な不一致分類（S13.2.1 の分類名）と**件数**のみ |

実装上は、検証を完全に通過してから Review State へ一括適用する
（検証しながら適用する方式は、途中失敗時に部分適用が残るため禁止）。

#### S13.2.3 表示例（content-free）

```text
このファイルは現在の抽出結果と一致しないため、読み込みませんでした。
  不一致分類: 欠落 ID (3件) / 余分な ID (1件)
  現在のレビュー内容は変更されていません。
```

**部分適用は P2-A3 0.1 の out-of-scope**（S23）。

### S13.3 shareable workbook

`shareable_review_summary.xlsx`。**集計のみ**を含む content-free 成果物。
S6.2 の allowlist に無い項目は含めない。生成前に人間確認 dialog を出す。

sheet と column を次に確定列挙する。**この表に無い column を追加してはならない。**

#### sheet `Summary`

| column | 内容 | 例 |
|---|---|---|
| `metric` | 集計項目名（固定文字列） | `candidate_total` |
| `value` | 数値 | `24` |

`metric` の取り得る値（固定集合）：

```text
candidate_total          candidate_reviewed       review_progress_percent
alias_total              alias_reviewed           alias_progress_percent
conflict_total           conflict_resolved        conflict_progress_percent
```

#### sheet `Decisions`

| column | 内容 |
|---|---|
| `target_kind` | `CANDIDATE` / `ALIAS` |
| `decision` | `UNREVIEWED` / `ACCEPT` / `REJECT` / `UNCERTAIN` |
| `count` | 件数 |

#### sheet `Reason Codes`

| column | 内容 |
|---|---|
| `target_kind` | `CANDIDATE` / `ALIAS` / `CONFLICT` |
| `reason_code` | S5.5 の固定 enum |
| `count` | 件数 |

#### sheet `Rules`

| column | 内容 |
|---|---|
| `rule_id` | 6 rule の固定 ID |
| `candidate_count` | その rule が寄与した candidate 件数 |
| `alias_count` | その rule が寄与した alias 件数 |

#### sheet `Conflict Resolutions`

| column | 内容 |
|---|---|
| `resolution` | `UNRESOLVED` / `SELECT_CANONICAL` / `REJECT_ALL` / `CONTEXT_DEPENDENT` / `UNCERTAIN` |
| `count` | 件数 |

**`selected_candidate_id` およびどの canonical が選ばれたかは出力しない**（S6.4）。

#### sheet `Source Documents`

| column | 内容 |
|---|---|
| `source_document_id` | `sd-` + 32hex |
| `document_fingerprint` | 64hex |

**この 2 列のみ。**`source_kind` と file 名は含めない。

P2-A2 の承認済み `source_fingerprints` 構造は `source_document_id` と `document_fingerprint` の
2 項目だけである。P2-A3 の shareable 成果物もこの境界を拡張せず、そのまま踏襲する
（`source_kind` は入力の種別という追加情報であり、承認済み構造に含まれない）。
`source_kind` は private 側（S5.2 の Evidence Display Index、S13.1 の private workbook）でのみ扱う。

#### sheet `Build Information`

| column | 内容 |
|---|---|
| `key` | S13.1.4 で確定した 3 key（`review_schema_version` / `extraction_schema_version` / `tool_build`）と同一。private 側・shareable 側で key 集合を分けない |
| `value` | 対応する値 |

環境依存値（path、ホスト名、ユーザー名、生成時刻）は一切含めない。根拠は S13.1.4 を参照。

---

## S14. Advanced export（future / out-of-scope for P2-A3 0.1・Checkpoint 4 是正）

**P2-A3 0.1 では実装しない。** 通常運用は private Workbook 保存／resume と shareable Workbook
生成で完結しており（S13）、advanced JSON／Markdown export を UI へ追加すると、private 内容を
外部へ送出できる経路が増えるだけで、通常運用に必要な機能を何も追加しない。

理由：

- 通常運用は Excel 保存／resume で完結している（S13.2 の resume、S13.3 の shareable 出力）。
- private JSON／Markdown 出力経路を UI に増やすと、誤共有（外部 AI・チャット・issue への
  貼り付けなど）のリスクが増える。
- P2-A2 CLI（`private_dictionary_candidate_evaluation_cli.js`）に、`candidate_evaluation.json`／
  `candidate_review.md`／`shareable_summary.json` を生成する既存の監査成果物生成経路がある。
  これは変更禁止 7 ファイルの一つであり、P2-A3 UI が重複させる必要はない。
- P2-A3 UI の役割は人間レビューであり、監査用 export UI を重複して持つことは必須要件ではない。

この節が P2-A3 0.1 より前に検討していた出力候補は、次のとおり整理する。

| 出力 | 区分 | 状態 |
|---|---|---|
| `candidate_evaluation.json` | private | P2-A2 CLI が既に生成。P2-A3 UI からは export しない |
| `candidate_review.md` | private | 同上 |
| `shareable_summary.json` | shareable | 同上（P2-A3 UI 独自の shareable 出力は `shareable_review_summary.xlsx`、S13.3） |
| `review_session.json` | private | **out of scope**。P2-A3 のどの Checkpoint でも実装しない |

将来 P2-A3 0.2 以降で advanced export を追加する場合は、この節を改訂した上で
独立した Checkpoint として設計・承認を経ること。P2-A3 0.1 の画面に、export 用の
disabled button を「将来実装」として残してはならない（未実装ボタンは削除する）。

---

## S15. Error contract

- 画面へ native Error、stack、file path、private 本文を表示しない。
- P2-A2 core が throw する `{code, path}` は **code のみ**を短い日本語説明とともに表示する。
- adapter 由来のエラー（暗号化 PDF、利用可能 sheet なし等）は分類済みの日本語メッセージへ写像する。
- 分類できない失敗は「処理に失敗しました」の汎用表示とし、詳細を出さない。
- console へ candidate / evidence / private 本文を出力しない。

---

## S16. Browser security

**禁止**：localStorage への自動保存 / IndexedDB への自動保存 / Service Worker cache /
browser cache / console への candidate・evidence 出力 / crash report / telemetry /
外部 analytics / remote font / remote image / external fetch / clipboard への自動コピー。

- レビューは browser memory 内で保持する。
- `sessionStorage` は**起動 token の保持のみ**に限定し、candidate / review data を置かない。
- 未保存変更がある状態での画面終了・再読込は `beforeunload` で警告する。
- 利用者入力（note）は `textContent` または form value として扱い、`innerHTML` へ渡さない。

---

## S17. Local server contract

static-only。private 入力・結果を受け取らない。

| 項目 | 契約 |
|---|---|
| bind | `127.0.0.1` のみ |
| port | 動的（`listen(0)`） |
| directory listing | なし |
| 配信対象 | 固定 allowlist map のみ（path traversal 構造的に不可） |
| header | 全レスポンスで統一適用（JSON 応答含む） |

```text
Cache-Control: no-store
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy:
  default-src 'none';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  connect-src 'self';
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
  form-action 'self'
```

- `default-src 'none'` を baseline とし、必要な directive のみ開ける（旧UIの `'self'` baseline から変更）。
- `worker-src` は PDF.js worker のため必須（旧UIには存在しなかった）。
- server log に private 情報を出さない。
- 配布 directory 内への runtime fallback を**禁止**する。tmp 確保失敗は fail-closed。

### S17.1 起動 token の扱い

**まず「token が必要か」を設計上再評価する。** P2-A3 の server は static asset 配信のみで、
private 入力も評価結果も受け取らない。認証対象の API が存在しないなら、token は
「配信しているのが自分の起動した server か」の確認以上の意味を持たない。

| 構成 | token の要否 | 判断 |
|---|---|---|
| static-only（認証対象 API なし） | **不要** | 第一選択。token 機構自体を持たない |
| 何らかの local API を追加した場合 | 必要 | S17.2 の fragment 方式で渡す |

Checkpoint 2 で local API を追加しない限り、**token を持たない構成を既定とする**。

### S17.2 token を用いる場合の受け渡し方式

token を導入する場合は、URL query ではなく **URL fragment** を用いる。

```text
http://127.0.0.1:<port>/#token=<value>
```

fragment は HTTP request 行に含まれず、server log にも proxy にも送信されない
（query 方式はリクエストごとに送信され、server log に残る）。

- app 起動後、token を JS のメモリ、または **token 専用の sessionStorage キー**へ移す。
  candidate / review data を sessionStorage へ置くことは S16 のとおり引き続き禁止。
- 移送後ただちに `history.replaceState` で URL から fragment を除去する。
- それでも **browser 履歴に残り得る**ことを README に明記する。

---

## S18. Resource bounds

### S18.1 入力サイズ上限（Checkpoint 2 の実測で確定 / Checkpoint 2 承認済）

browser-memory 方式では、上限は「ファイルとして扱えるか」ではなく
「browser のメモリ内で adapter → projection → 抽出 → 表示まで完走できるか」で決まる。
未実測の値を対応保証として記載してはならない。

| 項目 | 状態 | 承認値 | 上限直前の実測（上限比） | 根拠 |
|---|---|---|---|---|
| `MAX_FILE_BYTES`（1 ファイル上限） | **Checkpoint 2 承認済 / Chromium 基準** | 1 MB (1,048,576) | 単一 PDF 0.91 MB（**90.9%**）が **3/3 成功・応答維持** | 不安定点 3.68 MB の約 1/3.7 |
| `MAX_TOTAL_SELECTED_BYTES`（選択合計上限） | **Checkpoint 2 承認済 / Chromium 基準** | 2 MB (2,097,152) | distinct PDF 3 件 計 1.84 MB（**91.9%**）が **3/3 成功・応答維持** | 不安定点の約 1/1.8。標準サンプル 31 KB の約 65 倍 |
| `MAX_FILE_COUNT`（ファイル数上限） | **Checkpoint 2 承認済 / Chromium 基準** | 20 | distinct PDF 20 件（**100%**）が **3/3 成功・応答維持** | 件数はメモリより時間に効くため時間側の余裕で担保 |

実測は `p2a3_browser_memory_measurement_report.md` に記録し、値は `limits.js` に実装した。
**Chromium 実測のみ**であり、Windows Edge／Chrome 実機、macOS Safari は未検証である。
上記 3 値は Checkpoint 2 レビューで P2-A3 0.1 の Chromium 基準として承認された
（`PASS / P2-A3 CHECKPOINT 2 CLOSED`）。

**上限値の裏づけ規則**：各上限は、**その値の 90% 以上の入力で 3 回連続成功**していなければ
提案してはならない。成功判定に使う測定は、目的の limit に到達している必要がある——重複
`source_document_id` 検出など**別の guard が先に発火して停止した run を、その limit 試験の成功
として数えてはならない**。この条件を満たせない場合は、値を引き下げて再測定する。

> 旧記載の「1 ファイルサイズ 512 MB」は実測に基づかない値だったため撤回した。
> 512 MB を対応保証された上限として扱わない。

#### S18.1.1 上限の適用規則（値が未確定でも先に確定する挙動）

- ファイル数だけでなく、**選択されたファイルの合計 byte 数**も制限する。
- サイズ検査は **`File.arrayBuffer()` を呼ぶ前**に `File.size` で行う。
  読み込んでから判定してはならない（読み込んだ時点でメモリを消費するため）。
- 上限を超えたファイルは **読み込まない**（`arrayBuffer()` を呼ばない）。
- 上限超過時に、**既存の Review State を変更しない**。抽出済みの結果も破棄しない。
- 超過は content-free に通知する（file 名を出さず、「選択したファイルが上限を超えています」
  と件数のみ）。
- **上限値を未測定のまま正式配布しない。** 測定と Checkpoint 2 レビューでの確定を経てから配布する。

### S18.2 確定済みの UI 側 bounds

| 項目 | 上限 | 超過時 |
|---|---|---|
| DOM 描画行数 | 200 行 / page | pagination or virtualized |
| evidence excerpt 長 | 400 文字 | 中略表示 |
| reviewer note 長 | 2000 文字 | 入力時に制限 |

### S18.3 P2-A2 core 側 bounds

`MAX_UNITS` 200000、`MAX_NORMALIZED_TEXT_LENGTH` 4000、`MAX_CHILDREN_PER_PARENT` 2000、
`MAX_COLUMNS_PER_ROW` 1000、`MAX_INPUT_UTF8_BYTES` 8388608 等は core が fail-closed で扱う。
UI はそのエラー code を表示するだけで、**独自に緩和しない**。

### S18.4 Checkpoint 2 browser-memory 測定 matrix

次の全ケースを測定し、結果に安全余裕を設けたうえで Checkpoint 2 レビューで最終上限を決定する。

| # | ケース |
|---|---|
| 1 | PDF 単体 |
| 2 | XLSX 単体 |
| 3 | PDF ＋ XLSX 混在 |
| 4 | 複数 PDF |
| 5 | 複数 XLSX |
| 6 | 最大ファイル数近傍 |
| 7 | 合計 byte 数近傍 |
| 8a | adapter 上限ちょうど（PDF `MAX_PAGES` = 2,000 ページ） |
| 8b | adapter 上限超過（2,001 ページ）→ `PDF_LIMIT_EXCEEDED` |
| 9 | P2-A2 projection 上限到達 |
| 10 | 暗号化 PDF → `PDF_ENCRYPTED`（**本番 browser pipeline で測定すること**。Node の分類 unit test は代替にならない） |

ケース 8a / 8b は、`MAX_FILE_BYTES` の pre-read guard が先に発火するサイズになるため、
**本番 `browser_ingest.run()` を browser 上で直接呼ぶ**経路で測定してよい。adapter・projection・
抽出は本番と同一実装でなければならない。同一ファイルを複数指定して重複検出を先に発火させた run は、
adapter 上限の測定として認めない。

各ケースで記録する測定項目：

```text
入力 bytes                     合計および最大単一ファイル
処理時間                       ingest / extraction / 初回描画を分けて計測
候補数                         candidate / alias / conflict
unit 数                        projection の units.length
browser が応答を維持したか      UI 操作が可能な状態を保ったか
利用可能なメモリ指標            performance.memory 等、取得可能なもの（取得不可なら「取得不可」と記録）
結果区分                       下記 6 区分のいずれか 1 つ
処理後の Review State          既存 Review State が破壊されていないこと
```

**結果区分（この 6 種以外を使わない）**

| 区分 | 意味 |
|---|---|
| 成功 | 完走し、session が更新され、完走後も UI が応答した |
| 分類済み安全失敗 | 意図した `{uiCode, count}` で停止した。既存 session / Evidence Index / Review State は不変 |
| 入力事前拒否 | pre-read 検査が metadata だけで拒否した（`arrayBuffer()` 未呼び出し） |
| 不安定 | クラッシュはしないが実用時間内に確定せず、後続操作がタイムアウトした |
| browser crash | タブ／レンダラが異常終了した（**不合格**） |
| 別guard先行（未測定） | 目的の limit の手前で別の guard が発火した。**その limit は未測定**であり、成功にも安全失敗にも数えない |

**合否の考え方**：完走できることは必須ではない。**安全に失敗すること**（クラッシュせず、
Review State を壊さず、content-free なエラーを出して停止すること）が必須である。
確定する上限は、安全に完走できた最大規模に余裕を掛けた値とし、S18.1 の裏づけ規則
（提案値の 90% 以上で 3 回連続成功）を満たさなければならない。

### S18.5 Review Workbook 上限（Checkpoint 3 承認済 / Chromium 基準）

`MAX_FILE_BYTES` 等の source 入力上限を、private review Workbook（resume 用）へそのまま
流用してはならない。Review Workbook は数万 candidate を含み得るため、source 入力より
大きくなり得る。

| 項目 | 状態 | 承認値 | 根拠 |
|---|---|---|---|
| `MAX_REVIEW_WORKBOOK_BYTES` | **Checkpoint 3 approved / Chromium baseline** | 60 MB (62,914,560) | S18.6 参照 |

実測は `p2a3_review_workbook_measurement_report.md` に記録し、値は `limits.js` の
`REVIEW_WORKBOOK_LIMITS` に実装した。Checkpoint 3 レビューで正式承認済み。

**この承認の意味を限定する**：60 MB の Workbook を性能保証した、という意味ではない。
実測された最大正常 Workbook は 35.48 MB（66,000 candidate 規模）であり、60 MB はそこから
安全余裕を取った **pre-read 拒否上限**である。真の不安定点は S18.6 のとおり未特定のまま。
**Windows Edge／Chrome 実機、macOS Safari は未検証**であり、最終配布判断の前に実機検証が
必要（この制約は実際に検証するまで残す）。

### S18.6 Review Workbook 測定サマリー

Checkpoint 2 で承認された source 入力上限（1 MB / 2 MB / 20 件）から生成される最大規模の
candidate/alias/conflict 集合を、実 PDF を再生成せず synthetic session として直接構築し、
private/shareable Workbook の生成・resume を実測した（S18.4 と異なり、この測定はブラウザに
インストール済みの Chromium で `private_review_export.js` / `private_review_import.js` を
直接呼び出す形で行った。ingest pipeline は Checkpoint 2 から変更していない）。

| ケース | candidate 数 | private Workbook | export | import (resume) | heap | 応答 | crash |
|---|---|---|---|---|---|---|---|
| 451/451/451 synthetic | 451 | 0.54 MB | 101.7 ms | 127.0 ms | 19→31 MB | ○ | なし |
| Checkpoint 2 の 0.91MB 入力相当（32,500/8,000/2,000） | 32,500 | 17.45 MB | 4,067 ms | 2,825 ms | 40→190 MB | ○ | なし |
| Checkpoint 2 の 1.84MB 入力相当（66,000/16,000/4,000） | 66,000 | **35.48 MB** | 9,707 ms | 5,601 ms | 134→231 MB | ○ | なし |

**§61 の判定**：Checkpoint 2 で承認された source 入力上限から生成される最大規模の session
（66,000 candidate 相当）で、private Workbook の生成・resume は完走し、応答を維持し、
crash しなかった。**BLOCKED の条件（source は成功するが Workbook 側が不安定化する）には
該当しない。**

**`MAX_REVIEW_WORKBOOK_BYTES` の根拠**：測定範囲内では Workbook 側の不安定点は観測されなかった
（66,000 candidate まで安定）。そのため、S18.1 のように「不安定点からの倍率」では表現できず、
**観測された最大成功値（35.48 MB）に対する安全余裕**として 60 MB を提案する（約 1.7 倍）。
これは撤回された「未実測 512 MB」とは異なり、実測された成功点からの明示的な安全余裕である。
真の不安定点は本 Checkpoint では未特定であり、より高い規模での追加測定が必要であれば
Checkpoint 3 レビューで指示されたい。

---

## S19. Packaging allowlist

配布直前に **allowlist 方式で package tree を新規構築**する。既存作業 directory を
そのまま ZIP 化してはならない。

**denylist（恒久検査項目）**

```text
.p2a2-ui-runtime/   run-*/   input/   output/
candidate_evaluation.json   candidate_review.md   shareable_summary.json
review_session.json         実行済み review workbook
synthetic test output       private marker        temporary file
log   stack trace   absolute path   .git/   node_modules/   .DS_Store   Thumbs.db
```

---

## S20. Launcher contract

```text
start_review_ui.bat  start_review_ui.command  start_review_ui.sh
```

Windows：bundled Node x64 / ARM64、architecture 自動判定、runtime 存在確認、runtime version 確認、
ZIP 内直接実行の検出と注意、browser 自動起動、**error 時に window が即時閉じない**、
32-bit Windows は明示的に非対応、セキュリティ設定の無断解除を案内しない。

macOS / Linux：system Node.js を利用。**動作確認済み version を表示**し、
最低 version を推測しない。未検証 version を「対応済み」と書かない。

runtime binary は Checkpoint 1 の source commit へ追加しない（packaging checkpoint で扱う）。

---

## S21. Sample data contract

テーマ：鉄道車両用空調装置。**完全 synthetic**（実在企業・製品・案件を含めない）。
詳細は `p2a3_train_hvac_sample_plan.md`。

- 期待値は人手で推測せず、固定 base SHA の P2-A2 core による**実測結果**を基準とする。
- 生成は deterministic（同一入力 → 同一 PDF / XLSX bytes）。
- 最終 sample PDF / XLSX は Checkpoint 1 では commit しない。

---

## S22. Verification strategy

| 段階 | 内容 |
|---|---|
| P2-A2 回帰 | `private_dictionary_rule_extraction_core_verification.js` が 144 PASS / 0 FAIL / 1 SKIP、exit 0 |
| browser 一致 | browser 実行の `candidate_evaluation.json` が Node CLI 出力と byte 一致 |
| static scan | mock / UI に external URL、remote font、external fetch、localStorage、IndexedDB、Service Worker、candidate の console 出力、`innerHTML` 経由の利用者入力が無いこと |
| 操作 | filter / sort / decision / reason / note / evidence / conflict / dashboard が動作 |
| viewport | 1280×720 で主要操作が見える。1920×1080 で横幅を活用。narrow でも操作不能にならない |
| privacy | S22.1 の private marker 検査 |
| resume | S22.2 の完全一致 / atomic rejection 検査 |
| resource bounds | S18.4 の測定 matrix を実施し、上限を確定してから配布 |
| packaging | allowlist / denylist 検査 |

### S22.1 private marker 検査（shareable 境界）

candidate term、alias term、reviewer note、file 名のそれぞれに一意の private marker
（例 `PRIVATE_MARKER_P2A3_<場所>`）を仕込んだ入力でレビューを実施し、次を検査する。

- 生成された **shareable object の全プロパティ値**に、いずれの marker も出現しないこと
- 生成された **shareable Workbook の全 sheet・全 cell**（数式・コメント・ドキュメントプロパティを含む）に、
  いずれの marker も出現しないこと
- 併せて、shareable の全 cell 値に `pdc-` / `pda-` / `pdx-` / `psu-` / `pref-` の
  **ID prefix パターンが出現しないこと**（S6.3 の ID 禁止を機械的に担保する）
- `source_fingerprints` の値（`sd-` + 32hex、および 64hex）は S6.3 の例外として許可する

marker が 1 件でも出現した場合、その時点で **blocking failure** とする。

### S22.2 resume 検査

S13.2.1 の各拒否条件について、1 条件につき最低 1 件の異常 Workbook を用意し、次を検査する。

- import が拒否されること（exit / 戻り値が失敗であること）
- Extraction Result が変更されていないこと
- Review State が読み込み前と **完全に同一**であること（1 件の decision も適用されていないこと）
- error 表示に private term、alias term、file 名、sheet 名、excerpt、note、path が
  **含まれないこと**
- 表示されるのが分類名と件数のみであること

併せて、正常系（完全一致する Workbook）で resume が成功し、全 decision が復元されることを検査する。

#### S22.2.1 scope 異常 fixture

| fixture | 改変内容 |
|---|---|
| scope-1 | candidate の `scope` を `PROJECT` へ改変 |
| scope-2 | alias の `scope` を `DOMAIN` へ改変 |
| scope-3 | `scope` 列を削除 |
| scope-4 | `scope` を空にする |
| scope-5 | `scope` を非文字列にする（数値・boolean 等） |

#### S22.2.2 status 異常 fixture

| fixture | 改変内容 |
|---|---|
| status-1 | candidate の `status` を `ACTIVE` へ改変 |
| status-2 | alias の `status` を未知値へ改変 |
| status-3 | `status` 列を削除 |
| status-4 | `status` を空にする |
| status-5 | `status` を非文字列にする |

上記 10 fixture すべてについて、次を検査する。

- **Workbook 全体が拒否される**こと（1 件も適用されないこと）
- Review State が読み込み前と**不変**であること。判定は byte 比較
  （canonical 直列化の一致）または deep-equality のいずれかで行う
- Extraction Result が不変であること
- error 表示が content-free であること

#### S22.2.3 shareable column 検査

shareable Workbook の `Source Documents` sheet について、次を検査する。

- header が **`source_document_id`, `document_fingerprint` の 2 列だけ**であること
- **header 数・header 名・header 順序を完全一致**で検査する（部分一致・順不同を許さない）
- `source_kind` が header にも cell にも存在しないこと

併せて shareable Workbook 全体に対し、次が**全 cell・全数式・全コメント・全 Workbook property**
のいずれにも存在しないことを検査する。

```text
source_kind の値（"PDF" / "EXCEL"）
file 名
candidate 系 ID（pdc- / pda- / pdx- / psu- / pref- prefix）
private marker（S22.1）
```

`source_fingerprints` 由来の `sd-` + 32hex と 64hex は S6.3 の例外として許可する。

---

## S23. Out of scope（P2-A3 では扱わない）

- 辞書への自動登録・merge
- matching engine の変更
- P2-A2 抽出 rule の追加・変更
- 日本語形態素解析の追加
- 外部 AI / network / telemetry の追加
- 複数利用者の同時編集・サーバ側永続化
- Knowledge DataSet への書き込み
- **review Workbook の部分適用（partial import）**
  不一致 Workbook から一部の decision だけを取り込む機能は P2-A3 0.1 では提供しない。
  S13.2 のとおり完全一致のみを許可し、不一致は全体を拒否する。
  部分適用を導入する場合は、どの decision がどの根拠で適用されたかを追跡可能にする設計が
  別途必要であり、後続バージョンの検討事項とする。
- **shareable 成果物への ID 出力**
  集計以外の粒度（candidate 単位・alias 単位・conflict 単位の行）を共有する機能は提供しない。
