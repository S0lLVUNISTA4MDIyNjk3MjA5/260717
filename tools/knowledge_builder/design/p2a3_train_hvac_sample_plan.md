# P2-A3 サンプルデータ設計（鉄道車両用空調装置）

Checkpoint 1 成果物 / デモ・検証用 synthetic サンプルの設計。

**Checkpoint 1 では最終 PDF / XLSX を作成・commit しない。** 本書は構成と期待値の設計のみ。

---

## S1. 方針

- テーマ：鉄道車両用空調装置
- **完全 synthetic**。実在企業・実在製品・実案件・実在人名の情報を一切含めない。
  型番・記号はすべて架空（`HV-101` 等）。
- 期待値は人手で推測せず、**固定 base SHA `af6ba3283afa3cf042871f1ed4f8277a3abb16d0` の
  P2-A2 core による実測結果**を基準とする。
- 生成は deterministic（S6）。

### S1.1 Checkpoint 1 における実測の位置づけ

本 Checkpoint では、実現性確認（browser / Node 一致検証）のために縮小版の synthetic PDF（3ページ）と
XLSX（2 sheet）をリポジトリ外で生成し、P2-A2 core で実測した。その結果を本書の期待値レンジの
根拠として用いる。**この縮小版はリポジトリへ commit していない。**

縮小版の実測結果：

```text
candidates 19 / aliases 3 / conflicts 0 / rejected 20
rule 別: TERM_STRUCTURAL_KEY 7, TERM_STRUCTURAL_HEADING 4, TERM_REPEATED_VALUE 4,
         TERM_EXPLICIT_QUOTED 4, ALIAS_EXPLICIT_PARENTHETICAL 1, ALIAS_EXPLICIT_DEFINED_AS 2
```

6 rule すべてが発火することを確認済み。standard sample はこの約 1.5〜2 倍の規模を狙う。

---

## S2. Standard sample

### S2.1 予定ファイル

```text
train_hvac_requirement_spec_sample.pdf
train_hvac_design_review_sample.xlsx
train_hvac_expected_review.xlsx
```

### S2.2 PDF 章構成（5〜8ページ）

| ページ | 章 | 目的 / 含める rule |
|---|---|---|
| 1 | 第1章 適用範囲 | `TERM_STRUCTURAL_HEADING`、日本語 defined-as、括弧 alias |
| 2 | 第2章 用語の定義 | `ALIAS_EXPLICIT_DEFINED_AS`（日英両方）、`TERM_EXPLICIT_QUOTED` |
| 3 | 第3章 性能要件 | 繰返し用語、`TERM_EXPLICIT_QUOTED` |
| 4 | 第4章 制御機能 | 複数語 canonical の英語 defined-as |
| 5 | 第5章 試験方法 | 引用語、数字のみ行（候補にならないことの確認） |
| 6 | 第6章 保守・点検 | alias の再出現、複数文書にまたがる用語 |
| 7 | 第7章 付表 | 見出しノイズの確認 |

### S2.3 Excel sheet 構成（3 sheet、合計 30〜50 行）

| sheet | 列 | 行数 | 目的 |
|---|---|---|---|
| `機器一覧` | 機器記号 / 名称 / 数量 / 備考 | 18〜22 | `TERM_STRUCTURAL_KEY`、`TERM_REPEATED_VALUE` |
| `性能確認` | 項目 / 要求値 / 実測 / 判定 | 10〜14 | KEY、繰返し VALUE、判定値の定型文 |
| `変更履歴` | 版数 / 日付 / 変更内容 / 承認 | 6〜10 | 汎用列名ノイズの確認 |

### S2.4 用語一覧（synthetic）

| 用語 | 想定 rule | 備考 |
|---|---|---|
| 車内設定温度 | `TERM_EXPLICIT_QUOTED` + `TERM_REPEATED_VALUE` | PDF・Excel 両方に出現（文書数 2） |
| 冷房能力 | `TERM_REPEATED_VALUE` | 同上 |
| 暖房能力 | `TERM_REPEATED_VALUE` | Excel のみ |
| 温度制御装置 | `ALIAS_EXPLICIT_DEFINED_AS` + `TERM_REPEATED_VALUE` | alias `TCU` |
| 送風機制御装置 | `ALIAS_EXPLICIT_PARENTHETICAL` + `TERM_REPEATED_VALUE` | alias `FCU` |
| 外気導入制御装置 | `ALIAS_EXPLICIT_DEFINED_AS` + `TERM_REPEATED_VALUE` | alias `FACU`（conflict 用） |
| Fresh Air Control Unit | `ALIAS_EXPLICIT_DEFINED_AS` | alias `FACU`（conflict 用、英語複数語 canonical） |
| 試験モード | `TERM_EXPLICIT_QUOTED` | |
| 定格条件 | `TERM_EXPLICIT_QUOTED` | |
| 機器記号 / 名称 / 数量 / 備考 / 項目 / 要求値 / 判定 | `TERM_STRUCTURAL_KEY` | 汎用列名ノイズの評価対象 |
| 第N章 … | `TERM_STRUCTURAL_HEADING` | 見出しノイズの評価対象 |

### S2.5 alias 一覧

| alias | canonical | rule |
|---|---|---|
| `TCU` | 温度制御装置 | `ALIAS_EXPLICIT_DEFINED_AS`（日本語） |
| `FCU` | 送風機制御装置 | `ALIAS_EXPLICIT_PARENTHETICAL` |
| `FACU` | Fresh Air Control Unit | `ALIAS_EXPLICIT_DEFINED_AS`（英語） |
| `FACU` | 外気導入制御装置 | `ALIAS_EXPLICIT_DEFINED_AS`（日本語）← **conflict** |
| `BCU` | 送風制御ユニット | `ALIAS_EXPLICIT_PARENTHETICAL` |
| `EVU` | 換気ユニット | `ALIAS_EXPLICIT_DEFINED_AS` |

### S2.6 conflict

`FACU` が `Fresh Air Control Unit` と `外気導入制御装置` の 2 canonical を指す構成を 1 件だけ含める。
日英をまたぐ conflict を意図的に作ることで、conflict 画面と「自動解決しない」契約を確認できる。

### S2.7 rule coverage matrix

| rule | standard sample | edge-case sample |
|---|---|---|
| `TERM_STRUCTURAL_KEY` | ○ | ○（multi_sheet） |
| `TERM_STRUCTURAL_HEADING` | ○ | ○ |
| `TERM_REPEATED_VALUE` | ○ | ○（multi_sheet） |
| `TERM_EXPLICIT_QUOTED` | ○ | ○ |
| `ALIAS_EXPLICIT_PARENTHETICAL` | ○ | ○ |
| `ALIAS_EXPLICIT_DEFINED_AS` | ○（日英両方） | ○（日英両方） |

### S2.8 期待 candidate 件数レンジ

| 指標 | 目標レンジ | 根拠 |
|---|---|---|
| candidate | 20〜40 | 縮小版 19 件（PDF 3p + XLSX 2sheet）から規模比で外挿 |
| alias | 5〜10 | S2.5 の 6 件を基準に前後 |
| conflict | 1 | S2.6 |
| rejected | 20〜45 | 縮小版 20 件から外挿 |

**レンジは目安であり合否条件ではない。**確定値は生成後の実測で確定し、
`train_hvac_expected_review.xlsx` へ記録する。

### S2.9 期待レビュー判定（suggested decision）

| 候補分類 | suggested decision | suggested reason code |
|---|---|---|
| 装置名（温度制御装置、送風機制御装置 等） | `ACCEPT` | — |
| 性能項目（車内設定温度、冷房能力 等） | `ACCEPT` | — |
| 略称（TCU、FCU、FACU） | `ACCEPT`（alias 側で判断） | — |
| 汎用列名（名称、備考、数量、項目、判定） | `REJECT` | `GENERAL_TERM` |
| 章見出し（第N章 …） | `REJECT` | `GENERAL_TERM` |
| 定型判定値（合格、保留） | `REJECT` | `GENERAL_TERM` |
| 数字のみ・記号のみ | `REJECT` | `NUMERIC_OR_SYMBOLIC` |
| 見出し誤検出（数字始まりの本文） | `REJECT` | `EXTRACTION_ERROR` |
| 改行境界の過剰取得（NB-01） | `REJECT` | `NEWLINE_BOUNDARY_OVER_CAPTURE` |
| conflict 対象（FACU） | `UNCERTAIN` | `ALIAS_UNCLEAR` |

---

## S3. Edge-case sample

### S3.1 予定ファイル

```text
alias_conflict_sample.pdf
newline_boundary_sample.pdf
multi_sheet_sample.xlsx
```

### S3.2 確認対象

| 対象 | 収録先 | 期待される観察 |
|---|---|---|
| alias conflict | `alias_conflict_sample.pdf` | 同一 alias が 2 canonical を指し、conflict 1 件。自動解決なし。両 canonical の `alias_conflict_count` が 1 |
| NB-01 | `newline_boundary_sample.pdf` | 改行正規化後、英語 defined-as canonical に直前の短い語句が含まれ得る |
| quoted term | 両 PDF | `TERM_EXPLICIT_QUOTED` の発火と、単なる強調表現の混入 |
| 日本語 defined-as | `alias_conflict_sample.pdf` | `以下「X」という` が `ALIAS_EXPLICIT_DEFINED_AS` のみで処理される |
| 英語 defined-as | 両 PDF | `hereinafter "X"` が複数語 canonical を取る |
| duplicate occurrence | `multi_sheet_sample.xlsx` | 同一 unit の重複マッチが exposure 1 に集約される |
| hidden sheet | `multi_sheet_sample.xlsx` | 非表示 sheet が抽出対象外 |
| empty sheet | `multi_sheet_sample.xlsx` | 空 sheet が抽出対象外 |
| 複数 sheet | `multi_sheet_sample.xlsx` | 可視 3 sheet + hidden 1 + empty 1 |

### S3.3 NB-01 の扱い

`NEWLINE_BOUNDARY_OVER_CAPTURE` は reason code として UI に用意済み。
`newline_boundary_sample.pdf` は、この現象を**再現できる形**で意図的に構成する
（英語 defined-as の直前に短い語句を置き、PDF 側で改行させる）。
発生件数を集計し、少数なら nonblocking のまま、頻発して review を妨げる場合に改善 slice で対応する。

---

## S4. Expected review workbook

`train_hvac_expected_review.xlsx` に記録する項目：

| 列 | 内容 |
|---|---|
| candidate | canonical term |
| expected rule | 実測された `rule_ids` |
| expected alias | 対応する alias |
| expected conflict | conflict の有無 |
| suggested decision | `ACCEPT` / `REJECT` / `UNCERTAIN` |
| suggested reason code | S2.9 の reason code |
| デモ時の確認点 | その候補で何を見せたいか |

**suggested decision / reason code は「推奨」であり正解の強制ではない。**
candidate / rule / alias / conflict の各列は P2-A2 core の実測結果をそのまま転記する。

このワークブックは canonical term を含むため **private 扱い**とし、
配布物へ同梱する場合も「synthetic なので共有可」と明示したうえで扱いを分ける。

---

## S5. サンプル生成方法

| ファイル | 生成方法 | 既存の踏襲元 |
|---|---|---|
| PDF | Python + reportlab（`HeiseiKakuGo-W5` CID フォント） | `tools/knowledge_builder/verification/fixtures/generate_pdf_direct_fixtures.py` の方式 |
| XLSX | Node + vendored SheetJS（`tools/knowledge_builder/ui/vendor/xlsx.full.min.js`） | `generate_excel_direct_fixtures.js` の方式 |
| expected review | Node + vendored SheetJS。P2-A2 core の実測結果から生成 | 新規 |

生成スクリプトはリポジトリへ commit し、生成物の再現手順を残す。

---

## S6. Deterministic generation 方針

| 要因 | 対策 |
|---|---|
| PDF の生成時刻メタデータ | reportlab の `Canvas` に固定 `creationDate` / `producer` を設定 |
| XLSX の生成時刻メタデータ | SheetJS の `Props.CreatedDate` を固定値に設定 |
| ZIP エントリ順・タイムスタンプ | 生成順を固定。必要なら書き出し後に正規化 |
| ID / fingerprint | 入力 bytes と file 名のみに依存（`ingested_at` は評価出力に含まれないため無関係） |
| 抽出結果 | P2-A2 core は同一 projection に対し byte 一致（Checkpoint 1 で実測確認済み） |

**受け入れ条件**：同一スクリプトを 2 回実行して生成した PDF / XLSX の SHA-256 が一致すること。
一致しない場合は、差分の原因（timestamp / metadata / 圧縮）を特定して正規化する。

---

## S7. Checkpoint 1 での作成範囲

| 項目 | Checkpoint 1 |
|---|---|
| 本設計書 | ○ 作成 |
| 縮小版 synthetic による実現性実測 | ○ 実施（リポジトリ外、commit しない） |
| standard sample PDF / XLSX の作成 | × 後続 checkpoint |
| edge-case sample の作成 | × 後続 checkpoint |
| expected review workbook の作成 | × 後続 checkpoint |
| 生成スクリプトの commit | × 後続 checkpoint |
