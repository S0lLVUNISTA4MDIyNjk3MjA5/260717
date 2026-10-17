Human Evaluation Pilot Protocol 0.1 — 実データで Human Evaluation 0.1 を使うための Pilot / 評価プロトコル
=============================================================================================

状態: **HUMAN-APPROVED FOR PILOT 1B**（2026-10-17）。手順書としてのversionは0.1のまま。Pilot 1Aの実施条件はS20.1、Pilot 1B（Human blind review）の実施条件と環境固定はS20.2に固定した（手順そのものは変更していない）。この「状態」はProtocol文書のものであり、Human Evaluation Contract 0.1の状態とは別である。Pilot 1Bは**まだ実施していない**。
本書は設計文書であり、製品コード・Contract・Core・UI・release・guard・dictionary・quantity・canonical・Graph・Trace Review・workbook・logic JSON・ML のいずれも変更しない。
通常のdata correctness（品質評価の運用手順）であり、security / G2 / 暗号 / 信頼アーキテクチャは扱わない。

「**実測**」は、固定baseline（S4）のツールを実ブラウザ（Chromium）で、下記の既存ファイルを**既定のまま読み込み**（照合設定の手動変更なし）、
Human Evaluationタブ／診断accessorを**読み取り専用**で参照して得た値である。実測していない値は **NOT MEASURED** と記す。

---

## 1. Purpose

現在のmatching toolが**生成した照合comparison**を、人間がどのように評価するかを実測する。確認したいこと:

- `CORRECT` / `INCORRECT` / `UNSURE` が、評価済みcomparisonの中でどの程度の件数・構成になるか。
- `INCORRECT` がどの理由（issue category）で発生するか。
- Human Evaluation UI / artifact（`human_evaluation.json`）が実運用に耐えるか（Save / Resume / 状態導出）。
- UIに表示される情報（evidence等）が、人間の判断に十分か。
- 評価者が迷うケースに共通パターンがあるか。

## 2. Scope

- Human Evaluation 0.1（Contract / Core / UI / runtime / release、HEAD `2593e8e`）を**変更せずに**使う運用手順。
- 評価対象dataset候補の棚卸し（S7）、サンプリング設計（S8）、判定基準（S9・S10）、手順（S11・S12）、完了条件（S13）、成果物（S14）、集計（S15）、定性整理（S16）、再現性記録（S17）。

## 3. Explicit Non-Goals

- **accuracy / precision / recall / F1 / overall matching accuracy / true system accuracy は測らない・主張しない**（S18）。
- **未生成のmatch（false negative / missing match）は測らない**。`MISSING_MATCH` categoryは追加しない。本来存在すべき別pairを artifact に追加しない（S10.4）。
- matching algorithm・辞書・数量・canonical・Graph・Trace Review・UI・Core・Contract・release・guardの**変更**。評価結果からの**自動remediation**（matching rule・dictionary・threshold の自動変更）。
- Human Evaluation stateの ML training label / Trace Review training / auto-learning / dictionary learning への**流用**。
- 複数評価者の inter-rater agreement・consensus merge・adjudication artifact（S19.4に将来optionとして整理するのみ）。
- 新しいNode / Chromium verification suiteの追加。

## 4. Fixed Baseline

| 項目 | 値 |
|---|---|
| repository HEAD | `2593e8eb216a519d7a6d837cda17eef1c22ea8f0`（branch `claude/knowledge-matching-core-next`、upstreamなし） |
| matching tool | `tools/json_ab_trace_matching_tool_v12.1.15.html`（SHA-256 `44d66399923d5af6dd215bbd43b433893c7119f9bf80cc0e9bc5e4215b7fe2c4`） |
| Contract | `tools/knowledge_builder/design/human_evaluation_contract_0.1.md`（CLOSED） |
| Core | `tools/knowledge_builder/core/human_evaluation_core.js`（CLOSED） |
| 成果物 | `human_evaluation.json`（artifact schema `human-evaluation-persistence/0.1`） |
| 現行active guard | Human Evaluation guard（historical guard count 8） |

Pilotは、上記baselineのツールで実施する。baselineが変わった場合（ツールのSHA-256が異なる等）は、Pilotを開始せず本書を再確認する。

## 5. Evaluation Unit

**評価単位 = Human Evaluation persistent eligible machine-generated comparison（pair単位）。**

- identityは Contract の `pair_id`（`hev-pair-v1:` + netstring(requirement_trace_id) + netstring(actual_trace_id)）。**position index / 表示順 / 行番号は評価identityに使わない。**
- 機械が生成したcomparisonだけが対象。matching行のうち「A未対応」「B未参照」（相手のいない行）はcomparisonではなく、評価対象にならない。
- **ineligible comparison**（Coreで定義済みreason）はPilotの評価対象件数に**含めず**、別集計とする:

| reason（Core `INELIGIBLE_REASONS`） | 意味 |
|---|---|
| `NOT_MATCHING_ENGINE` | 照合エンジン由来でない |
| `MISSING_SIDE` | A側／B側のrecordが無い |
| `NO_TRACE_ID` | raw trace_idが無い |
| `NON_STRING_TRACE_ID` | raw trace_idがJSON stringでない（数値など） |
| `DUPLICATE_TRACE_ID` | 同一side datasetで raw trace_id が重複 |
| `DUPLICATE_PAIR` | 同一pairが重複 |

ineligibleは閲覧できるが保存できない（`PERSISTENT_EVALUATION_UNAVAILABLE`）。Pilot summaryには `total ineligible` と reasonごとの件数を記録する。

## 6. Dataset Eligibility

Pilot datasetとして使うには、最低限次を満たすこと（S7の表で確認する）。

1. A側・B側とも**raw `trace_id`（JSON string・非空）が全recordに存在**し、各side datasetで一意である（永続評価できるcomparisonが成立する）。
2. 既定読込で matching result が生成される（Human Evaluationタブが `available` になる）。
3. eligible comparison数が、S8のいずれかの案で**評価可能な規模**である。
4. 入力ファイルがrepository内に存在し、SHA-256で同一性を記録できる（S17）。
5. 期待する関連（ground truth）が付属していても、**Pilot中は参照しない**（S18。ground truthはMissing Match／Recall評価の将来設計の材料であり、本Pilotの評価入力ではない）。

## 7. Dataset Candidate Inventory

### 7.1 調査方法

repository内を read-only で調査した。**新しいデータは作っていない。** 照合は「JSON A / JSON B を読み込み → 読込ボタン」だけの**既定条件**で実測した（各sampleのREADMEが指定する個別の照合設定・辞書・タグ語彙は、Snapshot指定のある2件を除き**適用していない**）。

### 7.2 一次候補（JSON A/B が既に存在し、実測できたもの）

| candidate | A records | B records | stable trace IDs（A/B） | eligible | ineligible | 主な特徴（実測） |
|---|---|---|---|---|---|---|
| **medium** `samples/knowledge_builder_alpha01/medium/` | 80 | 100 | 80/80・100/100・重複なし | **653**（A側77件・B側96件に由来） | 0 | method: exact 497 / tag 149 / partial 6 / vector 1。classification: 対応あり 497 / 要確認 156。confidence帯: ≥0.90 が 497、0.70–0.89 が 156。dictionary contribution: none 653（Snapshotなし）。Aあたり最大10件・Bあたり最大8件。数値＋単位を含む文を持つcomparison 341（proxy。下記注） |
| hvac_small `samples/hvac_trace_sample_small/` | 4 | 5 | 全件・重複なし | 6 | 0 | tag 4 / partial 2、すべて要確認 |
| cp2d_user_HVAC（`runtime_fixtures/checkpoint2d_user_HVAC`） | 5 | 4 | 全件 | 4 | 0 | partial 4、要確認 |
| cp2d_RA01 | 7 | 7 | 全件 | 6 | 0 | exact 6、対応あり |
| cp2e_RA02 | 2 | 2 | 全件 | 2 | 0 | exact 2 |
| he1_rem_c / d | 5 | 4 | 全件 | 4 | 0 | vector 4、要確認 |
| he1_rem_i / j（Snapshotなし） | 6 | 6 | 全件 | 5 | 0 | exact 5 |
| he1_rem_i / j + he1_rem_k Snapshot | 6 | 6 | 全件 | 5 | 0 | exact 5。**dictionary contribution: present_unused 1 / none 4** |
| cp2g_11_PRIVATE_DICTIONARY + K Snapshot | 6 | 6 | 全件 | 5 | 0 | 上と同様（present_unused 1） |
| cp2g（照合方式サンプル16組の合計、既定読込） | 1〜6 | 1〜6 | 全件 | **32**（組ごと0〜5） | 0 | 組ごとの内訳は下記7.3 |

注: 「数値＋単位」はproxyであり、**本ツールの数量機能（quantity sidecar）の判定ではない**。レコードJSON全体の文字列に `\d+(\.\d+)?\s*(℃|°C|度|MPa|kPa|Pa|kW|W|dB|V|A|Hz|kg|g|mm|cm|m|%|rpm|L|ppm)` が出現するかを調べたもの（S8.3の層化にだけ使う）。

全一次候補で、**ineligible comparison は実測0**だった（全recordにstringのtrace_idが存在し重複もない）。したがって**ineligibleの扱い（S5）を実データで確認できる候補はない**（NOT MEASURED）。

### 7.3 cp2g（照合方式サンプル集）の既定読込での内訳

| 組 | A/B | eligible | 備考 |
|---|---|---|---|
| 00_AUTO / 01_EXACT | 2/2 / 2/2 | 2 / 2 | exact |
| 02_PARTIAL | 3/3 | 3 | vector 2 / partial 1 |
| 03_CODE / 04_MODEL | 2/2 / 2/2 | 2 / 2 | partial |
| 05_SYNONYM | 2/2 | 0 | 既定読込では comparison 生成なし（READMEの業務辞書設定を未適用）。NOT MEASURED（指定設定下） |
| 06_FUZZY / 07_VECTOR | 3/3 / 3/3 | 3 / 3 | vector |
| 08_TAG | 2/2 | 2 | tag |
| 09_HIERARCHY / 10_AMBIGUOUS_EXACT_NEGATIVE / 15_LONG_TEXT_CHUNK | 1/2・2/2・1/1 | 0 | 既定読込では matching result が確定せず（Human Evaluation: NO_CURRENT_RESULT）。NOT MEASURED（指定設定下） |
| 11_PRIVATE_DICTIONARY（K Snapshot適用） | 6/6 | 5 | present_unused 1 |
| 12_CONFIG_ALL_OFF | 2/2 | 2 | **注意**: 本来は全照合ペアOFFで edge 0 を確認する組。既定読込では設定を適用しないため代表性なし |
| 13_AUTO_SYNONYM | 3/3 | 3 | exact 1 / partial 2 |
| 14_ML_FEEDBACK | 3/4 | 3 | exact |

### 7.4 実測できなかった候補・対象外

| 資料 | 理由 |
|---|---|
| `sample_data/`（HVAC PDF・Excel）、`sample_data/spacecraft_cabin/`（PDF 4・Excel 1）、`tools/knowledge_builder/samples/p2a3/`（PDF・Excel） | JSON A/Bではなく原本（PDF/Excel）。変換ツールを経由しないと比較できない。**NOT MEASURED**（変換は新規データ生成にあたるため本sliceでは行っていない） |
| `he1_rem_e` / `he1_rem_f`（metadata only） | 既定読込でmatching resultが確定しない（comparison 0）。NOT MEASURED |
| `l32_*` `RA-QB01/QB04_records.json` | 数量コア用recordであり、JSON A/Bの照合入力ではない |
| `trace_comparison_example_verified.json`、`quantity_annotation_*` | 数量sidecar／比較recordのfixtureで、JSON A/Bではない。**数量comparisonは本Pilotで評価しない**（Human Evaluationの機械結果にはquantity sidecarの数量判定は含まれない。Contract S9） |
| `tools/design_notes/human_evaluation_package/`（KMS L3-1 Human Evaluation Checklist 等） | 同名の「Human Evaluation」だが、**ツール全体の機能受入れチェックリスト**（JSON作成〜照合の機能確認）であり、Human Evaluation 0.1（comparison品質評価）とは別物。Pilotの入力ではない |
| `medium/expected_relations.json`、cp2g `GROUND_TRUTH.json` 等 | 期待関連のground truth。**Pilotでは使用しない**（S6-5、S18） |

### 7.5 唯一の正式評価fixtureは存在するか

**存在しない。** Human Evaluation 0.1専用の評価fixtureはrepository内になく、上記はいずれも別目的（Knowledge Builder評価・照合方式確認・reviewer fixture）で作られた既存データである。よって**1つに自動固定しない**（Human判断待ち。S20）。

### 7.6 比較と推奨（Human最終選択待ち）

| candidate | 規模 | 代表性 | 弱点 | 想定評価volume | 判定 |
|---|---|---|---|---|---|
| **medium** | 大（653） | method 4種（exact／tag／partial／vector）、classification 2種、confidence 2帯、数値条件を含む文と含まない文 | 辞書なし（dictionary contributionは全件none）。ineligibleなし。数量機能なし。method構成が exact 76% に偏る。**合成sampleであり実運用データではない**。UIのリストは先頭500件までしか表示されない（S11.4） | S8の3案（60／160／653） | **推奨** |
| hvac_small | 小（6） | tag／partialのみ | 件数が少なく分布を語れない | 6（全件） | 操作確認・予行向き |
| cp2g（16組）＋he1_rem | 極小の集合（合計約40） | method網羅的、辞書1件 | 組ごとに個別設定が必要なものがあり、既定読込では代表性が崩れる組あり。件数が少ない | 32＋5 | 補助（method網羅の補完）向き |
| he1_rem_i/j＋k Snapshot、cp2g_11＋K | 極小（5） | **dictionary contribution（present_unused）を含む唯一の実測候補** | 5件のみ | 5 | **辞書観点の補助**（オプション） |

**推奨**: **medium**を主datasetとする。理由: 唯一、評価の分布を語れる規模（653）と複数のmethod／confidence帯を持ち、層化サンプリングが成立する。
**弱点**: 辞書・数量・ineligibleの経路は実測0で、Pilotでは検証できない。必要なら辞書の補助setを**別セッション・別artifact**で追加する（Human判断）。

## 8. Sampling Strategy

### 8.1 方式

- **A. Full pilot**: eligible全件を評価する（mediumでは653）。
- **B. Stratified pilot**: 層化＋決定的な等間隔抽出（S8.2〜S8.5）。複雑な統計設計は使わない。

### 8.2 再現可能性（禁止事項）

人間が適当に選ぶ・UIで目についたものだけを選ぶ・高confidenceだけを選ぶ・INCORRECTらしいものだけを選ぶことを**禁止**する。乱数・seedは使わず、**`pair_id` の正準順序と決定的な等間隔抽出**だけで選ぶ（security用途の乱数設計は不要）。

### 8.3 アルゴリズム（決定的）

1. eligible comparison全件を `HumanEvaluationCore.comparePairIds` の順（pair_idのUTF-8バイト順）に並べる。
2. 層キー = `classification | method | confidence帯 | dictionary有無 | 数値条件有無` を連結（confidence帯 = `H`（≥0.90）／`M`（0.70–0.89）／`L`（<0.70）、dictionary有無 = `nodict`（none）／`dict`（none以外）、数値条件有無 = `num`／`nonnum`（S7.2注のproxy））。層名を辞書順に並べる。
3. 目標件数Nに対し、**層内件数が M(=10) 以下の層は全件採用**し、残りの目標件数を残りの層へ**件数比例**で配分する（端数は小数部の大きい順、同値は層名の辞書順）。
4. 各層の中では、層内をpair_id順に並べ、`i = 0..q−1` について位置 `floor((i + 0.5) × 層内件数 / q)` のcomparisonを採用する（**等間隔・乱数なし**）。
5. 採用したcomparisonを `pair_id` 順に並べ、`requirement_trace_id<TAB>actual_trace_id` の行として**sample sheet**にする。

sample sheetは**Human Evaluation stateの正式artifactではない**（作業用の一覧）。評価の記録は `human_evaluation.json` のみ（S14）。

### 8.4 層の次元について

mediumでは `classification` と `confidence帯` が `method` から一意に決まる（exact→対応あり・H、tag／partial／vector→要確認・M）ため、実効的な層は `method × 数値条件有無`（7層）になる。辞書は全件noneのため次元として効かない。他datasetではすべての次元が効き得るので、層キーは上記5次元で固定する。

### 8.5 mediumでの規模案（実測・決定的）

層の件数（実測）: exact・nonnum 233 ／ exact・num 264 ／ tag・nonnum 74 ／ tag・num 75 ／ partial・nonnum 4 ／ partial・num 2 ／ vector・nonnum 1。

| 案 | 評価pair数 | 全体に占める割合 | A側カバー（77中）／ B側カバー（96中） | 長所 | 短所 |
|---|---|---|---|---|---|
| **Small pilot** | 60 | 9.2% | 51／48 | 負荷が小さい。操作・基準の確認に十分。partial・vectorは全件（7件）を含む | 分布の語れる粒度が粗い。B側カバーが半数 |
| **Recommended pilot** | 160 | 24.5% | **77／85** | A側recordを全件カバーし、tag・partial・vectorを一通り含む。再現可能 | 全件ではない。層化標本のため構成比を全体へ外挿しない（S18） |
| **Full evaluation** | 653 | 100% | 77／96 | 抽出の恣意性が無く、構成比をそのままdataset全体の記述として示せる | 件数が多い。UIのリストは先頭500件までの表示（S11.4）。評価者の疲労・一貫性の管理が必要 |

sample sheetの参照値（baseline `2593e8e` ・既定読込・付録Aのsnippet）: Small（60行）の SHA-256 は `f81676b4a419d55ad7704df0223a59f9194b6391aea66e10a6e6b0a4d7fd4a95`（先頭行 `req-maint-log → design-maint-interval`）、Recommended（160行）は `1c1fbe726fd940a8deb143d8be51a9a92b8ac71f9d8fd9d8e22bbd375b4eeb28`（先頭行 `req-test-emc → design-test-vibration`）。機械結果全体（pair_idと7項目射影）の決定性は、独立した2回の読込で一致することを確認した（射影ハッシュ `eb2a66af06a633c0b4e6192191b303147b1e3cd36984a1f310ea828133aa577b`）。
Pilot実施時にsample sheetのSHA-256がこの参照値と異なる場合、入力・設定・ツールのいずれかがbaselineと異なる。**原因を記録し、Human確認まで評価を始めない。**

## 9. Decision Rules

使用するdecisionは Contract のとおり `CORRECT` / `INCORRECT` / `UNSURE` のみ（`SKIP` は保存されない）。

| decision | 基準 |
|---|---|
| `CORRECT` | machine-generated comparisonが、人間判断でも妥当（対応づけとして受け入れられる）。 |
| `INCORRECT` | comparison自体、利用field、辞書、数量解釈などに**具体的な誤り**がある。issue categoryを必ず1つ付ける。 |
| `UNSURE` | 提示された情報では、人間が `CORRECT` / `INCORRECT` を**合理的に確定できない**。**UNSUREは失敗ではない**（評価不能を正直に記録する手段）。 |

- `CORRECT` と `UNSURE` では issue category は `null`。`INCORRECT` で category を選ぶと decision と同時に確定する（自動補完・`OTHER` への自動設定はない）。
- 迷ったからといって `CORRECT` に倒さない。確定できなければ `UNSURE`。

## 10. Issue Category Rules

`INCORRECT` のときは次の6つから**ちょうど1つ**（複数選択なし。`MISSING_MATCH` は存在しない）。

| category | 判断基準 |
|---|---|
| `WRONG_MATCH` | AとBが**別物同士**である。用いられたfieldや辞書に問題がなくても、対応そのものが成立しない。 |
| `WRONG_FIELD` | 対応先自体は妥当になり得るが、照合に**使われたfield**（matched A/B field、tag等）が不適切で、そのfieldでの一致は根拠にならない。 |
| `DICTIONARY` | 辞書による解決・寄与（dictionary contribution）が誤対応の**原因**である。 |
| `QUANTITY` | 数値・単位・条件の**不一致または解釈の誤り**が誤対応の原因である。 |
| `INSUFFICIENT_EVIDENCE` | 提示された根拠（method・field・evidence）では対応と**断定できず**、評価者はその出力を**正しいものとして受け入れられない**。 |
| `OTHER` | 上記のどれにも当てはまらない具体的な誤り。`OTHER` を選ぶときは**noteに理由を書く**ことを推奨する。 |

### 10.1 境界の判断

- **`WRONG_MATCH` vs `WRONG_FIELD`**: 「そもそも別物」なら `WRONG_MATCH`。「対応先は妥当かもしれないが、一致の根拠になったfieldが不適切」なら `WRONG_FIELD`。タグ共有・見出し共有だけで一致している場合は、まず fieldの不適切さ（`WRONG_FIELD`）か別物か（`WRONG_MATCH`）を判断する。
- **`DICTIONARY` vs `WRONG_FIELD`**: 辞書（dictionary contribution が `used` ／ `present_unused`）が誤対応の**原因**なら `DICTIONARY`。辞書が関与せず、通常のfield選択が原因なら `WRONG_FIELD`。dictionary contribution が `none` のcomparisonに `DICTIONARY` を付けない。
- **`QUANTITY` vs `WRONG_MATCH`**: 同じ事項について数値・単位・条件が食い違うなら `QUANTITY`。事項そのものが別物なら `WRONG_MATCH`。なお一般のcomparisonは**数量情報を持たない**（Contract S9）ため、`QUANTITY` は評価者が原文から判断して付ける理由ラベルである。
- **`INSUFFICIENT_EVIDENCE` vs `UNSURE`**: S10.2。
- **`OTHER`**: 上記5つに**当てはまらないことを確認した**うえでのみ使う。迷ったときの逃げ先にしない。使ったらnote推奨。

### 10.2 UNSURE と INSUFFICIENT_EVIDENCE

Contractの定義は、`UNSURE` =「判断できない」、`INSUFFICIENT_EVIDENCE` =「証拠が弱く、対応と断定できない」（`INCORRECT`のcategory）。
両者は文面上**重なり得る**（本書の整理で曖昧さを解消する。**Contractの意味とは矛盾しない**が、運用上の曖昧さとして報告する）。評価者は次の順で判断する。

1. 提示された情報（machine result）だけで、「この出力は、示された根拠では対応と受け入れられない」と**判断できるか**。
   - 判断できる → `INCORRECT` + `INSUFFICIENT_EVIDENCE`（出力の根拠不足を指摘する。評価者自身の判断は確定している）。
   - 判断できない（原文を見ても、外部知識や追加情報なしには、正しいとも誤りとも言えない）→ `UNSURE`（最終decision自体を確定できない）。
2. `INSUFFICIENT_EVIDENCE` は `INCORRECT` の件数に**含まれる**。報告では category 別に分けて示し、「誤り」と同一視しない（S18）。

### 10.3 Missing Match が気になった場合

「このpairではなく、別のrecordとmatchすべきだった」と気付いた場合は S10.4。

### 10.4 Missing Match の扱い（artifactに追加しない）

既存のcomparisonは、必要に応じて `INCORRECT`（通常は `WRONG_MATCH`）として評価してよい。
しかし**本来存在すべき別pairそのもの**を Human Evaluation artifact に追加してはならない。気付いた事項は note ／ summary の「Missing Match候補」欄に**記録するだけ**とし、将来の Missing Match 設計の材料とする。

## 11. Evaluation Procedure

### 11.1 準備（operator）

1. baseline（S4）のHEAD・ツールSHA-256を確認する。
2. 入力ファイル（JSON A / JSON B）のSHA-256を記録する（S17）。
3. `file://` で matching tool を開き、JSON A / JSON B を読み込んで**読込**を実行する（既定の照合設定。**Pilot中は照合設定・辞書Snapshot・nested選択・threshold等を変更しない**。変更すると結果が古くなり、`NO_CURRENT_RESULT` / `STALE` の原因になる）。
4. 「Human Evaluation」タブを開き、`eligible total`・`ineligible` が想定（mediumなら eligible 653、ineligible 0）と一致することを確認する。
5. sampleを使う場合は、S8.3の手順でsample sheetを作成し、SHA-256を記録する（付録A）。

### 11.2 評価者の確認順序（毎回同じ順序）

1. requirement trace ID
2. actual trace ID
3. classification
4. confidence
5. method
6. matched A / matched B field
7. evidence
8. dictionary contribution
9. 必要なら**原文の文脈**（Human Evaluationタブには表示されない。必要な場合のみ、同じツールの既存の「入力JSON表」タブでtrace IDの行を**読むだけ**で確認する。設定は変更しない）
10. decision（CORRECT / INCORRECT / UNSURE）
11. INCORRECTの場合は issue category を1つ
12. 任意のnote

UIに存在しない情報は要求しない。9は任意で、**UIに原文が表示されないこと**は運用上の制限として記録する（S16.1）。

### 11.3 note方針

noteは**必須ではない**。次の場合は記入を**推奨**する: `UNSURE` ／ `OTHER` ／ 想定外のmatching挙動 ／ evidence不足の具体例 ／ 同じ誤りパターンの代表例。
**個人情報等を新たに書き込まない**（noteには、判断理由に必要な語だけを書く）。上限は4096文字（Contract）。

### 11.4 UI上の実務上の制限（実測・事実）

- Human Evaluationタブの対象リストは**先頭500件までの表示**（それを超える場合は注記が出る）。653件のmediumでは、501件目以降は Previous / Next でのみ到達できる。
- リストの順序は照合結果の順序であり、`pair_id` 順ではない。sample sheetの行を探すには、リスト上の「requirement_trace_id → actual_trace_id」表示でtrace IDを照らし合わせる。**UIにはsample専用のfilterは無い**。
- Skipは何も保存しない（未評価のまま）。
- sampleを使う案（Small / Recommended）では、上記の探索が手作業になり、見落としや**sample外の評価**が起きやすい。sample外に評価した分は削除せず、summaryで**sample外**として別集計する（S15）。
- 「sample選択・移動を支援するUI」は将来の別sliceの候補（**FUTURE UI CANDIDATE**）であり、今回は着手しない。

### 11.5 evaluator

evaluatorは**optionalのまま**。複数評価者を使う可能性があるため、使う場合の命名は `Evaluator-A`、`Evaluator-B` のように**実名を含まない識別子**とし、同一評価者は常に同じ識別子を使う。実名・所属・メールアドレスを入れない。

## 12. Save / Resume Procedure

- **Human Evaluationの状態はページ内にだけあり、localStorageには保存されない。ページを再読込すると空に戻る。**
- 保存: 「Human Evaluationを保存」で `human_evaluation.json` をダウンロードする。**定期的に**保存する（目安: 25件評価するごと、または15分ごと、およびページを閉じる・移動する前）。保存ごとに日時付きのコピーを保存先に残してよいが、**正式な成果物は最後に保存した `human_evaluation.json`**。
- 再開: 同じツール・同じ入力ファイル・同じ照合設定で読込→照合を行い、「Human Evaluationを読込」で artifact を Load する。
- Load後の確認:
  - `CURRENT` が保存件数と一致すること。`STALE` と `ORPHANED` が 0 であること（0でなければ、入力・照合結果・設定のどれかが保存時と異なる。原因を記録し、再評価する前にHumanへ報告する）。
  - **dataset mismatch warning が出た場合は、内容を記録する**（artifactは拒否されないが、入力データが保存時と異なる可能性がある）。
  - `NO_CURRENT_RESULT` の場合は、先に照合を実行してから評価を続ける。
- Loadは現在の状態を**置き換える**（未保存の変更がある場合は確認が出る）。不正なartifactは状態を変えずに拒否される（表示は `{code, path}` のみ）。

## 13. Pilot Completion Criteria

次をすべて満たしたときに、Pilotを「完了」とする（具体値はdataset確定後に本節へ追記する。medium・Recommendedの場合の例を併記）。

1. 選んだsample（またはFull）の**全件にdecisionが付いている**（例: sample sheet 160行すべて、`UNSURE`を含む）。
2. 評価済みの全件が **CURRENT** である。**STALE の entry が残っていない**。ORPHANED が 0（残る場合は理由を記録）。
3. ineligible（あれば）は評価件数に含めず、`total ineligible` と reason別件数を別記する。
4. sample外に付けた評価があれば、件数を別記し、sample集計から除く。
5. 最後の評価の後に `human_evaluation.json` を**保存済み**で、artifactの **SHA-256 を記録**している。
6. 最終確認: ページを再読込→同じ入力で読込→照合→artifactをLoadして、`CURRENT` 件数が一致し、`STALE` / `ORPHANED` が 0 であることを確認する。
7. S15のsummaryを作成できる状態である。

## 14. Evaluation Artifact

- 正式な成果物は **`human_evaluation.json` のみ**。Human Evaluation stateを正式に記録する独自の artifact は作らない。
- 次は別文書（正式なHuman Evaluation stateではない）: sample sheet（作業用）、Pilot summary（S15）、再現性記録（S17）。
- 保存先は Human 判断（S20-5）。repository内に置く場合は、通常のcommitではなく**別途Human判断**とする。

## 15. Summary Metrics

### 15.1 集計する項目（件数）

| 項目 | 内容 |
|---|---|
| generated comparison total | 機械が生成したcomparisonの総数（eligible＋ineligible） |
| eligible total | 永続評価可能なcomparison数 |
| evaluated CURRENT | CURRENTの評価済み件数 |
| unevaluated | eligible total − evaluated CURRENT |
| CORRECT / INCORRECT / UNSURE | CURRENTのdecision別件数（和 = evaluated CURRENT） |
| STALE / ORPHANED | 過去評価の件数（decision別件数に含めない） |
| ineligible | 合計とreason別件数 |
| INCORRECT category別件数 | `WRONG_MATCH` / `WRONG_FIELD` / `DICTIONARY` / `QUANTITY` / `INSUFFICIENT_EVIDENCE` / `OTHER` |
| sample外の評価件数 | sampleを使った場合のみ |

### 15.2 構成比（説明的な表現に限る）

構成比を示してよい。ただし名称は **`CORRECT share among evaluated generated comparisons`** のような説明的表現にし、**accuracy とは呼ばない**。
層化sampleの構成比は、**そのsampleの構成比**であり、dataset全体へ外挿しない（Fullを除く）。層ごとの件数も併記する。

### 15.3 集計の出し方

`human_evaluation.json` をCoreでdecodeした内容（decision・category・note・evaluator）と、ツール表示の件数（`eligible total` 等）、およびsample sheetから作る。集計用スクリプトは**今回は作らない**（製品コード・verificationの追加を伴わない手作業または別sliceの作業）。

## 16. Qualitative Findings

数だけでなく、Pilot後に次を整理する。各項目は**代表例（pair_idとnote）**を添える。

- repeated error patterns（同じ原因の `INCORRECT`）
- repeated UNSURE patterns
- evidence presentation problems（表示された情報が判断に足りない／分かりにくい例）
- dictionary-related patterns
- quantity-related patterns
- field-selection patterns
- examples requiring future investigation
- Missing Match候補（S10.4）

同じパターンが**3件以上**あれば、パターンとして整理する（提案値。Humanが変更してよい）。
各findingは「finding → recommended investigation」までを書く。**コード・ruleの修正はしない**（S19.2）。

### 16.1 運用上の制限の記録

Human Evaluationタブに原文が表示されない点、リスト表示が先頭500件までである点、sample用のfilterが無い点など、**UI／運用上の不便**は評価結果とは別に記録する。

## 17. Reproducibility Record

Pilot実施ごとに、次を記録する（evaluation reproducibility用。security architectureではない。SHA-256はデータ同一性の確認にのみ使う）。

| 記録項目 | 内容 |
|---|---|
| baseline HEAD | 例: `2593e8eb216a519d7a6d837cda17eef1c22ea8f0` |
| ツール | ファイル名とSHA-256（`sha256sum`） |
| source dataset | JSON A / JSON Bのファイル名・SHA-256・record数 |
| 照合設定 | 既定のままか。変更した場合は内容（任意: 照合ロジックJSONを既存機能でexportし、そのSHA-256を記録） |
| 辞書Snapshot | 使用の有無（使用時はファイル名・SHA-256） |
| sample | 方式（Small／Recommended／Full）、sample sheetのファイル名・SHA-256・行数 |
| Human Evaluation artifact | ファイル名、SHA-256、サイズ |
| 件数 | generated comparison総数、eligible、ineligible（reason別）、evaluated（CURRENT）、評価済みpair数 |
| 日付 | 実施日・最終Save日 |
| evaluator identifier | 使用した場合のみ（`Evaluator-A` 等） |
| warning | dataset mismatch warning の有無と内容 |

## 18. Interpretation Restrictions

- **禁止する表現**: accuracy、precision、recall、F1、overall matching accuracy、true system accuracy。「正解率」「精度」「再現率」も同様。
- **false negativeは測っていない**: 機械が生成しなかった対応は評価対象外であり、見逃しの量は分からない。
- `CORRECT` の件数や構成比は、**機械が生成したcomparisonの中での記述**にとどまる。
- `INCORRECT` には `INSUFFICIENT_EVIDENCE` が含まれる（S10.2）。`UNSURE` は `CORRECT` ／ `INCORRECT` に読み替えない。
- 単一評価者の評価は評価者間の一致を示さない。
- medium等は**合成・説明用のsample**であり、実運用データの品質を示さない。
- ground truth（`expected_relations.json` 等）は使わない。使えば本Pilotの範囲を超え、Missing Match／Recall評価の設計になる。
- 層化sampleの構成比をdataset全体へ外挿しない。

## 19. Future Decision Gates

Pilotの結果から考えられる次の分岐（**今回はどれにも着手しない**。判断基準の提案: 「支配的」= 当該categoryが最大かつ `INCORRECT` 全体の40%以上、かつ `INCORRECT` が10件以上。基準はHumanが変更してよい）。

### 19.1 Category別

| 結果 | 次の候補 |
|---|---|
| `WRONG_MATCH` が支配的 | matching candidate generation / scoring の調査候補 |
| `WRONG_FIELD` が支配的 | field-selection / attribution の調査候補 |
| `DICTIONARY` が支配的 | dictionary quality の調査候補 |
| `QUANTITY` が支配的 | quantity semantics の調査候補 |
| `UNSURE` / `INSUFFICIENT_EVIDENCE` が支配的 | evidence presentation / evidence sufficiency の調査候補 |
| 評価者が欠落関係を繰り返し指摘 | **Missing Match / Recall Evaluation Contract** の候補 |

### 19.2 自動remediationの禁止

Pilot結果から、matching rule・dictionary・thresholdを**自動で変更しない**。Pilotとremediationは分離する。

### 19.3 学習への流用の禁止

Human Evaluation stateを、ML training label・Trace Review training・auto-learning・dictionary learningへ流さない。Human Evaluationは独立した評価artifactである。

### 19.4 複数評価者（将来option）

複数評価者を使う場合の inter-rater agreement、consensus merge、adjudication artifact は**今回実装しない**。必要性が出た場合の将来optionとして、Pilot後に別途検討する。

## 20. Human Decisions Required Before Execution

Pilot実行前に Human が決める事項（最小限）:

1. **Pilot dataset**: S7.6の候補から選ぶ（推奨: medium。辞書の補助setを別セッションで追加するか）。
2. **sample size / full evaluation**: Small（60）／Recommended（160）／Full（653）。
3. **evaluator identifier policy**: 識別子を使うか（使う場合は `Evaluator-A` 等の命名）。
4. **single evaluator / multiple evaluator**: 単一評価者か、複数評価者か（複数の場合も、合意形成の仕組みは今回含めない）。
5. **Pilot artifact保存場所**: `human_evaluation.json` と記録（sample sheet・summary・再現性記録）を置く場所。
6. **Pilot終了条件**: S13をそのまま採用するか、修正するか。

本書の承認には、**UNSURE と INSUFFICIENT_EVIDENCE の運用上の整理（S10.2）の確認が含まれる**（別途の判断項目としては扱わない）。

### 20.1 Pilot 1A 実施条件（Human承認済み・2026-10-16。AI evaluator operational pilot）

上記6項目に対するHuman判断。**Pilot execution parametersのみ**を固定する（手順・判定基準は変更なし）。

| 項目 | Pilot 1A |
|---|---|
| dataset | medium（`samples/knowledge_builder_alpha01/medium`） |
| sample | **Small 60**（S8.3の決定的アルゴリズム、参照SHA-256はS8.5） |
| evaluator | 単一評価者、識別子 `Evaluator-A` |
| 補助dictionary session | **使用しない** |
| 終了条件 | **S13を採用**（60件にdecision／CURRENT 60／STALE 0／ORPHANED 0／sample外評価 0／最終artifact保存とSHA記録／再読込＋Load後もCURRENT 60／summary作成済み。1つでも欠ければ PILOT INCOMPLETE） |
| Missing Match | Human Evaluation artifactへ追加しない。観察事項としてsummaryに `FUTURE MISSING-MATCH EVALUATION CANDIDATE` で記録 |
| 成果物の保存先 | repository外 `/home/user/human_evaluation_pilot_0.1/pilot_1_medium_small60/`（`human_evaluation.json`、`pilot_manifest.txt`、`pilot_summary.md`、`sample_pairs.txt`）。Git管理対象外 |
| 実測結果 | 本書には書かない。`pilot_summary.md` に分離する |
| 製品コード変更 | なし |

### 20.2 Pilot 1A の位置づけと Pilot 1B の実施条件（Human承認済み・2026-10-17）

#### 20.2.1 Pilot 1A の正式な位置づけ

Pilot 1A は **`PILOT 1A COMPLETE — AI EVALUATOR OPERATIONAL PILOT`**。単一のAI evaluator（識別子 `Evaluator-A`）による operational pilot である。

- 有効な範囲: UI／runtimeの運用検証、Save／Loadの運用証拠、sample再現性の証拠、AI evaluatorの観察。
- **Human ground truth ではない**。matching accuracyを示さない。Human／AI agreementは未測定。
- Pilot 1A の成果物（artifact、manifest、summary、sample）は Protocol 本文へ転記しない。結果は Pilot summary 側の責務である。Pilot 1A の artifact は変更しない。

#### 20.2.2 Pilot 1B の実施条件

Pilot 1B は、**人間が Pilot 1A と同じ60 pairを独立に評価する Human blind review** である。

| 項目 | Pilot 1B |
|---|---|
| dataset | medium（`samples/knowledge_builder_alpha01/medium`） |
| sample | **Pilot 1A の固定sample**（60 pair、`sample_pairs.txt` のみを使用。再生成しない） |
| evaluator | 人間（識別子の扱いは S11.5。実名を必須にしない） |
| 判定基準・手順 | S9〜S13（変更なし） |
| 終了条件 | S13（60件にdecision／CURRENT 60／STALE 0／ORPHANED 0／sample外評価 0／最終artifact保存とSHA記録／再読込＋Load後もCURRENT 60／summary作成済み。欠ければ PILOT INCOMPLETE） |
| 成果物の保存先 | **Pilot 1A のdirectoryとは別**の、repository外の専用directory（実施開始時に指定する。Pilot 1A の成果物と同じ場所へ書かない） |
| 補助UI | 原文（A／B original record）の読み取り専用表示と、Sample pair list（`sample_pairs.txt` の読込、Sample only）を使う。どちらもartifactへ保存されない |

#### 20.2.3 Blindness（盲検の固定）

Pilot 1B の evaluator に**表示してはいけない／参照させてはいけない**もの:

- Pilot 1A の decision、issue category、note、summary
- CORRECT／INCORRECT／UNSURE の件数、`WRONG_MATCH` 等のcategory分布、Pilot 1A の定性的findings
- Pilot 1A の `human_evaluation.json` を Load すること

使用してよい Pilot 1A の資料は **`sample_pairs.txt` のみ**。Pilot 1B の開始状態は、Human Evaluation entries = 0、Pilot 1A artifact 未Load、`sample_pairs.txt` のみ読込済み、であること。

#### 20.2.4 Pilot 1B 実施環境の固定

Pilot 1B は **Pilot 1A と同一の環境**で実施する。

- **dev source HTML**（`tools/json_ab_trace_matching_tool_v12.1.15.html`）を使う。release／dist版は使わない。
- Pilot 1A と同じ **network-blocked** 条件（外部ネットワークへの要求を遮断した状態でファイルを開く）。
- 期待される固定状態: generated comparisons = **653**、sample = **60**、sample resolved = **60**、unresolved = **0**。

#### 20.2.5 Mandatory pre-check（評価を始める前に必ず行う）

次を**すべて**確認する。1つでも一致しなければ**評価を開始しない**（Abort）。原因を記録し、Humanへ報告する。

| 確認 | 期待値 |
|---|---|
| generated comparison count | 653 |
| eligible／ineligible | 653／0 |
| sample pair count（読み込んだ行数） | 60 |
| resolved count | 60 |
| unresolved count | 0 |
| sample identity（付録Aのsnippetで再生成したTSVのSHA-256） | `f81676b4a419d55ad7704df0223a59f9194b6391aea66e10a6e6b0a4d7fd4a95` |
| 読み込む `sample_pairs.txt` のSHA-256 | `8aaa36a937173aa9c9abf82f2b1d4a1d2ad779b1587d96c7e2621a60dbb05043` |
| machine result projection identity（付録Dのsnippet） | `eb2a66af06a633c0b4e6192191b303147b1e3cd36984a1f310ea828133aa577b`（Pilot 1A の manifest に完全値が記録されているもの） |
| Human Evaluation entries | 0（Pilot 1A artifact 未Load） |

- ツールのHTMLのSHA-256は、実施時に記録する。Pilot 1A 時点のツールからUI補助が加わっているため、HTMLそのものの一致は要求せず、上の機械結果の同一性で判定する。
- 値は完全値だけを使う。省略されたhashから値を推測しない。

#### 20.2.6 KNOWN ENVIRONMENT DIFFERENCE — NOT USED FOR PILOT 1B

| 環境 | generated comparisons | Pilot 1A の sample |
|---|---|---|
| dev／network-blocked | 653 | 60／60 resolved |
| release／tokenizer-present（同梱のtokenizerが有効） | 654 | 58／60 resolved（不明2件。Sample pair listの読込は全体拒否される） |

- これは **Pilot 1B の対象環境ではない**。release版では Pilot 1B を実施しない。
- 本Protocolでは修正しない（releaseを653に合わせる、devを654に合わせる、tokenizerの挙動変更、sample listの作り直し、未解決2 pairの置換のいずれも行わない）。原因の調査もしない。
- 別の調査候補: **DEV/RELEASE MATCHING ENVIRONMENT DIFFERENCE INVESTIGATION**。

#### 20.2.7 解釈の制限

Pilot 1B でも、accuracy・precision・recall・F1・正解率として解釈しない（false negativeは測らない。S18）。Pilot 1A の結果との一致を評価に先立って示さない。Human／AI の比較は、Pilot 1B の完了後に別途行う。

---

## 付録A. sample sheet 生成手順（読み取り専用）

用途: S8.3の手順を、ツールの診断accessorを使って**読み取り専用**で実行する。結果は作業用の一覧であり、artifactではない。

手順:
1. 11.1の手順で読込・照合を行い、「Human Evaluation」タブを開く。
2. ブラウザの開発者コンソールで次を実行する（`__N__` を目標件数 Small=`60` ／ Recommended=`160` に置き換える）。出力はTSV（`requirement_trace_id` TAB `actual_trace_id`）。
3. 出力を `sample_<N>.tsv` として保存し、SHA-256を記録する。S8.5の参照値と比較する。

注意: このsnippetが使う `window.__humanEvaluationDiagnostics.projections()` はHuman Evaluationタブの診断accessor（読み取り専用）で、Contractの公開仕様ではない。accessorが変更された場合は手順を再検証する。

```js
(() => {
  const C = HumanEvaluationCore;
  const E = window.__humanEvaluationDiagnostics.projections().filter(p => p.eligible).sort((x, y) => C.comparePairIds(x.pair_id, y.pair_id));
  const flag = p => /\d+(\.\d+)?\s*(℃|°C|度|MPa|kPa|Pa|kW|W|dB|V|A|Hz|kg|g|mm|cm|m|%|rpm|L|ppm)/.test(JSON.stringify(mergedResult.sysList.find(r => r.trace_id === p.input.requirement_trace_id)) + JSON.stringify(mergedResult.plmList.find(r => r.trace_id === p.input.actual_trace_id)));
  const N = __N__, M = 10, strata = {};
  E.forEach(p => { const c = p.projection.confidence, k = [p.projection.classification, p.projection.method, c >= 0.9 ? 'H' : c >= 0.7 ? 'M' : 'L', p.projection.dictionary_contribution === 'none' ? 'nodict' : 'dict', flag(p) ? 'num' : 'nonnum'].join('|'); (strata[k] = strata[k] || []).push(p); });
  const names = Object.keys(strata).sort(), alloc = {}; let rem = N;
  names.forEach(n => { if (strata[n].length <= M) { alloc[n] = strata[n].length; rem -= alloc[n]; } });
  const big = names.filter(n => !(n in alloc)), tot = big.reduce((s, n) => s + strata[n].length, 0);
  const rows = big.map(n => ({ n, q: rem * strata[n].length / tot })); rows.forEach(o => { alloc[o.n] = Math.floor(o.q); });
  let left = rem - rows.reduce((s, o) => s + Math.floor(o.q), 0);
  rows.sort((a, b) => (b.q - Math.floor(b.q)) - (a.q - Math.floor(a.q)) || a.n.localeCompare(b.n));
  for (let i = 0; i < left; i++) alloc[rows[i].n]++;
  const sel = [];
  names.forEach(n => { const L = strata[n], q = alloc[n]; for (let i = 0; i < q; i++) sel.push(L[Math.floor((i + 0.5) * L.length / q)]); });
  sel.sort((x, y) => C.comparePairIds(x.pair_id, y.pair_id));
  return sel.map(p => p.input.requirement_trace_id + '\t' + p.input.actual_trace_id).join('\n');
})()
```

## 付録B. Summary テンプレート（記入用）

| 項目 | 値 |
|---|---|
| generated comparison total | |
| eligible total | |
| evaluated CURRENT | |
| unevaluated | |
| CORRECT／INCORRECT／UNSURE | |
| STALE／ORPHANED | |
| ineligible（reason別） | |
| INCORRECT category別（6種） | |
| sample外の評価件数 | |
| CORRECT share among evaluated generated comparisons | （説明的表現。accuracyと呼ばない） |
| dataset mismatch warning | |
| 定性的findings（S16）／Missing Match候補 | |

## 付録C. 本書の根拠となった実測の条件

- 照合: baseline `2593e8e` のツールを `file://` で開き、JSON A／Bを読み込んで読込を実行（外部ネットワークは遮断、既定の照合設定）。Snapshot指定の2件（`he1_rem_k`、cp2g_11の `K_dictionary_snapshot`）のみ、読込前に `PrivateDictionaryMatchingSession.setSnapshot` で適用。
- 取得: Human Evaluationタブの診断accessor（読み取り専用）による件数・射影。ページエラー0。
- 一時的なsmoke評価: medium上でUIから3件を評価→Save→再読込→Loadして `CURRENT` 3件・STALE／ORPHANED 0・warningなしを確認した。**このstateと生成したartifactは破棄済みで、保存していない。**
- 入力ファイルのSHA-256（medium）: A=`418bfc7378e2d7068f19783f45a9a24b5e65159c818f06de89f3a8672043f8d1`、B=`bbe32bdb0d4f89888579b6d3ecd31c0972d02768efa44f72b8cf1cf8440b068e`。

## 付録D. Pilot 1B pre-check 用 snippet（読み取り専用）

用途: S20.2.5 の machine result の同一性を確認する。11.1の手順で読込・照合を行い、「Human Evaluation」タブを開いたうえで、開発者コンソールで実行する。出力のJSONを S20.2.5 の期待値と比較する。

```js
(async () => {
  const P = window.__humanEvaluationDiagnostics.projections();
  const v = window.__humanEvaluationDiagnostics.view();
  const text = JSON.stringify(P.map(p => [p.pair_id, p.eligible, p.projection]).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  return JSON.stringify({
    generated_comparisons: P.length,
    eligible: P.filter(p => p.eligible).length,
    ineligible: P.filter(p => !p.eligible).length,
    available: v.available,
    machine_projection_identity: await QuantitySidecarBinding.rawSha256Utf8(text)
  });
})()
```

`machine_projection_identity` は、現在の全comparisonの `[pair_id, eligible, machine result 射影]` を `pair_id` の文字順に並べたJSON文字列のSHA-256（UTF-8、正規化なし）。Pilot 1A の manifest に記録された値と同じ手順で得られることを確認済み。
