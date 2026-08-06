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

| 区分 | 含めてよい | 含めてはいけない |
|---|---|---|
| **private** (`private_dictionary_candidate_review.xlsx`, advanced JSON/MD) | canonical term、alias term、evidence excerpt、file 名、sheet 名、reviewer note、全 ID | — |
| **shareable** (`shareable_review_summary.xlsx`) | schema version、source fingerprints、各種件数、reason code 別件数、rule 別件数、review 進捗、tool build 情報 | canonical term、alias term、file 名、sheet 名、PDF 本文、evidence excerpt、reviewer note、private path、selected canonical の表示名 |

shareable 側に `selected_candidate_id` を出す場合も、**表示名を伴わない ID のみ**とする。
共有前に人間確認を促す UI を必須とする。

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
| `Summary` | review 集計、進捗、reason code 別件数、rule 別件数 |
| `Candidates` | candidate_id、canonical_term、rule_ids、exposure、document、conflict、decision、reason_code、note |
| `Aliases` | alias_candidate_id、alias_term、canonical_candidate_id、canonical_term、rule_ids、decision、reason_code、note |
| `Alias Conflicts` | conflict_id、alias_display、conflicting_candidate_ids、resolution、selected_candidate_id、reason_code、note |
| `Evidence Index` | source_document_id、source_unit_id、provenance_ref_id、source_kind、file 名、role、page/sheet/row/column、excerpt |
| `Source Documents` | source_document_id、document_fingerprint、source_kind、file 名 |
| `Build Information` | review_schema_version、extraction_schema_version、tool build 情報、生成時刻 |

### S13.2 再開時の検証

読み込み時に以下を検証し、**一致しないデータを黙って結合しない**。

```text
review schema version / extraction schema version / source fingerprints
candidate ID / alias candidate ID / conflict ID / scope / status
```

不一致時は差分を提示して、利用者に「中止」または「明示的な部分適用」を選ばせる。
自動 merge は行わない。

### S13.3 shareable workbook

`shareable_review_summary.xlsx`。S6 の shareable 列のみ。生成前に人間確認 dialog を出す。

---

## S14. Advanced export（Checkpoint 1 では実装不要、契約のみ）

通常操作から分離した折りたたみ領域「監査用詳細出力」に配置する。

| 出力 | 区分 |
|---|---|
| `candidate_evaluation.json` | private |
| `candidate_review.md` | private |
| `shareable_summary.json` | shareable |
| `review_session.json` | private |

private / shareable の区分を UI 上に明示する。

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
- server log に URL token 以外の private 情報を出さない。
- 起動 token を URL クエリで渡す場合、`history.replaceState` で除去しても **browser 履歴に残り得る**
  ことを README に明記する。
- 配布 directory 内への runtime fallback を**禁止**する。tmp 確保失敗は fail-closed。

---

## S18. Resource bounds

| 項目 | 上限 | 超過時 |
|---|---|---|
| 1 ファイルサイズ | 512 MB | 選択時に拒否 |
| 入力ファイル数 | 50 | 選択時に拒否 |
| DOM 描画行数 | 200 行 / page | pagination or virtualized |
| evidence excerpt 長 | 400 文字 | 中略表示 |
| reviewer note 長 | 2000 文字 | 入力時に制限 |

P2-A2 core 側の bounds（`MAX_UNITS` 200000、`MAX_NORMALIZED_TEXT_LENGTH` 4000、
`MAX_CHILDREN_PER_PARENT` 2000 等）は core が fail-closed で扱う。UI はそのエラー code を
表示するだけで、独自に緩和しない。

browser メモリ上限は未実測（Checkpoint 2 以降の測定対象）。

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
| privacy | shareable 成果物に private marker が現れない |
| packaging | allowlist / denylist 検査 |

---

## S23. Out of scope（P2-A3 では扱わない）

- 辞書への自動登録・merge
- matching engine の変更
- P2-A2 抽出 rule の追加・変更
- 日本語形態素解析の追加
- 外部 AI / network / telemetry の追加
- 複数利用者の同時編集・サーバ側永続化
- Knowledge DataSet への書き込み
