Human Evaluation Contract 0.1 — Read-Only Quality Evaluation Overlay for Automatic Matching Results
==============================================================================================

状態: **FINAL CANDIDATE — HUMAN-APPROVED DESIGN, IMPLEMENTATION PENDING**（2026-10-13）。
本書の設計方針・仕様判断はHumanが確定済みである。**製品コードは存在しない**（実装・検証・release済みではない）。
本書は設計文書であり、HTML・core・test・fixture・build・release・既存contract・guardのいずれも変更しない。
通常のdata correctness（品質評価の記録）の設計であり、security / G2 / 暗号 / 信頼アーキテクチャは扱わない。

「**確認済み事実**」は、現行HEAD（`6c7c3bf`）の実コード・既存documentをread-onlyで調査して確認した事柄である。
Human判断が必要な未確定事項は本書に**残っていない**（S26）。実装時に調べる事項はHuman判断ではなく「実装時の調査項目」（S28）に分けた。

---

## S1. Purpose

自動照合（matching tool）が出した各comparisonに対し、**人間が品質を評価した記録**を、
**matching結果へ一切副作用を与えない専用overlay**として保持・保存・再読込できるようにする。

目的は「その自動結果は正しかったか」の記録であり、結果の修正・採否・学習・辞書更新ではない。
ここでいうread-onlyとは、**evaluation state自体は保存・変更できるが、matching product stateには副作用を与えない**という意味である。

## S2. Scope

0.1が定めるもの:

- 評価の単位（comparison）、評価対象の条件（eligibility）、永続identity（pair identity）。
- 評価の内容（decision / issue category / note / evaluator / evaluated_at）。
- 機械結果のfull projectionとfingerprint、表示用snapshot、入力recordのsource identity、CURRENT / STALE / ORPHANED / NO_CURRENT_RESULTの導出規則。
- runtime state、専用JSON artifact（schema・直列化・サイズ上限・Save・Load・atomicity・error code）。
- UIの振る舞い契約（matching tool内の独立タブ）、件数表示、副作用の隔離。
- release挙動、互換性、verification要件、guard移行計画。

## S3. Non-goals

- 評価結果によるmatching結果・effective relation・Graph・score・threshold・dictionary・ML・training labelの変更。
- Trace Reviewの変更・表示・変換・提案。
- 複数reviewerのconsensus、reviewer権限、署名、外部DB、cloud sync。
- tag単位・evidence単位の個別評価。
- **存在しないcomparison（missing relationship / 欠落）そのものの評価**。0.1は「既に生成されたcomparison」の品質評価のみを扱う。
  欠落や見逃しは評価できないため、**率指標（正解率・適合率・再現率等）は0.1で定義も表示もしない**（S19）。
- session限定の一時評価、評価履歴の保持、migration framework。
- CSV / workbook export（S25）。

## S4. Terminology

- **comparison**: matching toolが機械的に生成した、AとBの対応1件（Trace Matrix行の機械結果）。
  **確認済み事実**: 行は`buildTraceMatrixRows()`が生成し、`requirement_trace_id` / `actual_trace_id` / `matcher_a_id` / `matcher_b_id` /
  `A_ID` / `B_ID` / `分類` / `信頼度` / `方式` / `根拠` / `_matchedSysField` / `_matchedPlmField` を持つ。
  機械生成行は隠しprop `_traceComparisonRelationship.source === 'matching_engine'` を持つ。
- **machine row / machine result**: 機械結果のみ（Trace Reviewや手動関係を反映した**effective row**とは区別する）。
- **eligible comparison**: S6を満たす、永続評価の対象になれるcomparison。**ineligible comparison**: 満たさないcomparison。
- **pair identity (`pair_id`)**: S7の`hev-pair-v1:…`。
- **evaluation entry**: 1つの`pair_id`に対するHumanの評価記録（S14）。
- **full machine-result projection**: 状態判定に使う、省略・切り詰めのない機械結果の完全なprojection（S10）。
- **machine-result fingerprint**: full projectionの決定的fingerprint（S10）。**display snapshot**: Human確認用に長さを制限した表示用の値（S10）。
- **source identity**: pairを構成する2つの**入力record**の内容fingerprint（S11）。
- **status**: CURRENT / STALE / ORPHANED / NO_CURRENT_RESULT。**導出値**で、artifactには保存しない（S12）。

## S5. Relationship to Trace Review

**確認済み事実**: 既存Trace Reviewは、人手判定がeffective relationを上書きし得る（`resolveEffectiveRelation()`）、
Graph・出力に反映され得る、`useForTraining`が「教師ラベル同期」を通じてMLの学習ラベルになり得る、localStorage（`v11_trace_review_store`）に保存される、
読込は未検証マージである。すなわちTrace Reviewは**operational review**である。

**Human決定**: Human EvaluationとTrace Reviewは**完全に別機能として並存する**。

| | Trace Review（既存） | Human Evaluation（本書） |
|---|---|---|
| 効果 | effective relation / Graph / output / training labelに影響し得る | matching結果に一切影響しない |
| 保存領域 | localStorage `v11_trace_review_store`、レビューJSON | 専用artifact（S14）。localStorageは使わない |
| 識別 | `profile‖A_ID‖B_ID`（位置番号・照合テキスト由来） | `hev-pair-v1`（trace_idペアのみ） |
| 対象 | machine / manual / orphan等を含む | machine rowのみ |

規定:

1. 両者は**保存領域・state・キー・artifactを共有しない**。Human EvaluationのstateをTrace Review storeへ保存しない。逆も同じ。
2. Human EvaluationはTrace Reviewを**変更しない**。Trace Review操作によってHuman Evaluationのentryを**自動更新しない**。
3. Human Evaluationのstatus・machine-result fingerprintは**machine rowのみ**から導出し、Trace Reviewの判定・effective relationに依存しない。
   したがってTrace Review操作でHuman EvaluationがSTALEになることはない。
4. Trace ReviewのJSONをHuman Evaluation artifactとして読み込まない（S22）。
5. 評価からTrace Review候補を提案する機能は0.1で**禁止**する（将来slice）。
6. **Human Evaluation UIにTrace Reviewの状態を表示しない。** 両者の意味を明確に分離するため。将来のread-only表示は別sliceである。

## S6. Evaluation eligibility

評価の単位は**comparison単位**である。issue detail（S9）はcomparison entryに任意で付与できる。

comparisonは次を**すべて**満たすとき**eligible**（永続評価可）である:

1. **matching engine生成**: `_traceComparisonRelationship.source === 'matching_engine'`。手動追加・付け替え・人手保持・A未対応行・B未参照行は対象外
   （そもそも機械comparisonではない／片側が無い）。
2. **A/B両側が存在**する。
3. **`requirement_trace_id`が有効**かつ**`actual_trace_id`が有効**。ここで有効とは、元の入力recordのraw `trace_id`が**JSON stringで、空でも空白のみでもない**こと。
   null・empty・whitespace-only・non-string（number等）は無効。identityには行の`requirement_trace_id` / `actual_trace_id`の値を**無加工で**使う
   （既存`normalizeText`済みの値。identity生成時に新しい正規化・trim・大小変換をしない）。
   **確認済み事実**: 元recordは`rowSourceMaps()`から`A_ID` / `B_ID`で引ける。行の`*_trace_id`は`normalizeText`で文字列化されるため、型の検査は元recordで行う。
4. **各trace_idが対応するdataset側で一意**: A側dataset内で当該`requirement_trace_id`が1件のみ、B側dataset内で当該`actual_trace_id`が1件のみ。
   重複trace_idを持つpairは**すべて不適格**。同じ`(requirement_trace_id, actual_trace_id)`が現在の機械行に複数現れる場合も不適格。

**persistent evaluation不可**（ineligible）: trace_idなし／null／empty／whitespace-only／non-string／duplicate trace_id／重複pair／
**position-derived identity（`A-001`・`_reviewKey`・`B_ID`等）しか無いpair**。
これらは**閲覧できる**が、**decisionを保存できない**。session限定の評価も作らない。UIは `PERSISTENT_EVALUATION_UNAVAILABLE` 状態を明示し、
理由を表示する（理由ラベル例: `NO_TRACE_ID` / `NON_STRING_TRACE_ID` / `DUPLICATE_TRACE_ID` / `DUPLICATE_PAIR`。UI用の表示語であり、artifactには現れない）。
位置番号・`_reviewKey`・`B_ID`のfallback値を永続identityへ**昇格させてはならない**。

> **確認済み事実**: `B_ID`は`plmBusinessKey`（コード列→テキスト列→位置）由来で、実測では`PART-1`ではなく照合テキストが入る。
> 位置番号はtrace_idの無い入力で並べ替えに脆弱（`A-001`が別行を指す）。これが上記の昇格禁止の根拠である。

## S7. Pair identity

```
pair_id = "hev-pair-v1:" + netstring(requirement_trace_id) + netstring(actual_trace_id)
netstring(s) = <sのUTF-8 byte長を10進で> ":" <s> ","
```

- **確認済み先例**: 数量comparison IDは`'cmp-v1:' + encodeUtf8Netstring(req) + encodeUtf8Netstring(act) + …`（`quantity_sidecar_binding_core.js`）。
  `id_hash_utils.js`も同仕様`${byte長}:${値},`を独立実装している。`encodeUtf8Netstring`自体は非exportなので、**同一仕様の独立実装**とする。
  `prefix-v1:`命名もこれに倣う。
- 単純なdelimiter連結（`a + "|" + b`等）は**禁止**（衝突し得る）。新しいhash・暗号・security機構は定義しない（identityは構造化エンコードのみ）。
- 例: `("REQ-1","PART-1")` → `hev-pair-v1:5:REQ-1,6:PART-1,`。
  Unicode例: `("要求-1","P-1")` → `hev-pair-v1:8:要求-1,3:P-1,`（`要`・`求`は各3 byte）。
- `pair_id`は**順序付き**（A側=requirement、B側=actual）。入れ替えたペアは別identity。
- entryは`requirement_trace_id` / `actual_trace_id`の**両値も保存**し、`pair_id`を**再生成して完全一致を検証**する（不一致は`PAIR_IDENTITY_MISMATCH`）。

## S8. Decision semantics

保存されるdecisionは次の3値**のみ**:

- `CORRECT`: 現在の自動結果は正しい対応である。
- `INCORRECT`: 正しい対応ではない。
- `UNSURE`: 判断できない。

規定:

1. **未評価** = entryが存在しないこと。artifact上に「未評価」状態は無い。
2. **`SKIP`はartifactのdecisionではない。** SKIPはUI操作で、**評価を変更せず次のcomparisonへ進む**。未評価とSKIP済みを永続stateで区別しない。
3. decisionの変更は同一`pair_id`のentryの**置換**である（履歴は保持しない）。decisionが`INCORRECT`以外へ変わるとき、`issue_category`は`null`になる。
4. 評価の削除（Clear）はS16。

## S9. Issue category

`issue_category`は **`decision === "INCORRECT"` のときのみstring**、それ以外は`null`でなければならない（違反は`ISSUE_CATEGORY_INVALID`）。
decisionとissue categoryは別fieldで、混同しない。`INCORRECT`でも`null`（未選択）は許す。

**正式enum（6値）**:

| 値 | 意味 |
|---|---|
| `WRONG_MATCH` | 別物同士の対応である |
| `WRONG_FIELD` | 照合に使われたfieldが不適切である |
| `DICTIONARY` | 辞書による解決・寄与が誤対応の原因である |
| `QUANTITY` | 数量の不一致・数量解釈が誤対応の原因である |
| `INSUFFICIENT_EVIDENCE` | 証拠が弱く、対応と断定できない |
| `OTHER` | 上記以外 |

- **`MISSING_MATCH`は0.1から除外**する。Human Evaluation 0.1は「存在するcomparison」の品質評価であり、欠落（missing match）の評価は別問題である
  （評価entryは存在するcomparisonに付くため、「あるべき対応が存在しない」を理由にするのは粒度と矛盾する）。
- `QUANTITY`は**人間が付与する理由ラベル**として採用する。**確認済み事実**として、一般のcomparison行は数量情報を持たない（数量はcmp-v1の別系統）。
  したがって一般entryに数量専用の巨大snapshotを追加せず、0.1のmachine-resultに数量fieldは含めない（S10）。
- comparison + optional issue detailの将来拡張は、新schema versionでentryへkeyを追加して行う（S22）。

## S10. Machine-result: full projection / fingerprint / display snapshot

**目的**: (a) 評価時点の機械結果と現在の機械結果が同一かを判定する（stale判定）、(b) 人間が何を見て評価したかを識別する。
機械結果の復元・matching stateの上書きには**使わない**。

### S10.1 full machine-result projection（stale判定の対象）

次の7 fieldからなる、**省略・切り詰めのない**projectionをstale判定に使う。値は**machine row（機械結果）**から取る。
Trace Review適用後のeffective resultは使わない。

| field | 内容 | 由来（確認済み事実） |
|---|---|---|
| `classification` | 機械の分類文字列 | 機械行の`分類`（review前） |
| `confidence` | 信頼度（有限number） | `信頼度` |
| `method` | 照合方式 | `方式` |
| `evidence` | 根拠テキスト（**全文**） | `根拠` |
| `matched_a_field` | 照合に使われたA側field名 | `_matchedSysField` |
| `matched_b_field` | 照合に使われたB側field名 | `_matchedPlmField` |
| `dictionary_contribution` | `none` / `present_unused` / `used` | `dictionaryContributionForEdge()`のstatus |

- 数量fieldは含めない（上記S9）。

### S10.2 machine-result fingerprint

```
machine_result.identity = "hev-sha256:" + hex64( rawSha256Utf8( "hev-machine-result-v1" + NUL + canonicalJson(fullProjection) ) )
```

- **既存先例のみ**を使う: `QuantitySidecarBinding.canonicalJson`（キーを再帰ソート）と`rawSha256Utf8`（SHA-256、**値を正規化しない**）。
  `hashParts`は値を`normalize`するため使わない（内容の差を潰すため）。新しいhash・暗号・security機構は作らない。
- stale判定は**このfingerprintの一致/不一致のみ**で行う。**切り詰めた値で判定してはならない**
  （切り詰め後の後半だけが変化した場合に誤ってCURRENTと判定するのを防ぐ）。

### S10.3 display snapshot（Human確認用）

`machine_result.display`は、人間が評価時に何を見たかを後で確認するための表示用値で、**長さを制限してよい**。stale判定には使わない。

- key: `classification` / `confidence` / `dictionary_contribution` / `evidence` / `matched_a_field` / `matched_b_field` / `method` / `truncated`。
- 文字列の上限（決定的に先頭からcode point単位で切り詰め、記号を付けない）: `evidence` 1024 code points、その他の文字列 256 code points。
- `truncated`: いずれかの値を切り詰めたときtrue。
- displayはfull projectionの検証対象ではない（形式と上限のみ検証する）。

## S11. Source identity / Dataset context

**entry単位: `source_identity`**（Human決定）

- 各entryは、pairを構成する2つの**入力record**の内容識別 `source_identity = { "actual": <fp>, "requirement": <fp> }` を持つ。
  目的は、trace_idが同じでも入力record内容が変化した場合にSTALEを検出すること。
- `fp = "hev-sha256:" + hex64( rawSha256Utf8( "hev-record-v1" + NUL + canonicalJson(record projection) ) )`。
- record projectionは、**読み込んだ入力record由来**の決定的projection（非hidden・先頭`_`でない自前enumerable propertyを`canonicalJson`で正規化したもの）。
  **matching後の派生state（辞書annotation・タグ・hidden prop・Trace Review・照合結果）を含めてはならない**。
  したがってfingerprintは、辞書Snapshot有効化・nested allowlist変更・タグ生成・再照合・Trace Review操作で変化してはならない。
- 既存先例（`canonicalJson`、`rawSha256Utf8`）のみを使う。新しいcryptographic/security architectureは作らない。

**root: `dataset_context`**（advisory）

- Save時点の入力dataset概要: `{ "actual": { "record_count": n, "signature": s|null }, "requirement": { ... } }`、またはdatasetが無ければ`null`。
- `signature`は**確認済み先例**の`QuantitySidecarBinding.computeDatasetSignature(records)`（`QA-SHA256:…`）を再利用する。同関数は全recordに一意なtrace_idを要するため、
  **計算できない側は`null`**（`record_count`は常に値を持つ）。
- `dataset_context`は**warning / context用途のみ**。**dataset_contextの不一致だけでartifact全体をinvalidにしない**。
  個々のentryの現在性は、pairごとのsource identityとmachine-result fingerprintで決める（S12）。

**設定全体のfingerprintは作らない。** keyPairs / threshold / matching logic / Snapshot / allowlist / canonical推定 / tag設定の変更は、
その結果が**machine-result projection（fingerprint）を変えたときにのみ**検出する。設定schemaへ依存しない。

## S12. Status（CURRENT / STALE / ORPHANED / NO_CURRENT_RESULT）

statusは**導出値**であり、**artifactへ保存しない**。`(saved entries, 現在のeligible comparison集合, 現在の入力record)`から**毎回導出**する。
entryを自動変更・削除しない。

導出順序:

1. **NO_CURRENT_RESULT**: matching未実行など、現在結果そのものが無く、安全に判定できない。次を含む: matching結果が存在しない、matching実行中、
   またはtool自身が「再照合が必要」とマークした結果（既存のstale表示）。この状態では全entryをNO_CURRENT_RESULTとし、decisionの新規保存も許さない。
2. entryの`pair_id`が、現在の**eligible**集合に**存在しない** → **ORPHANED**。例: pair削除、trace_id変更、duplicate化、eligibility喪失。
3. 存在するが、(a) 現在の2つの入力recordのsource identityがsavedと異なる、または(b) 現在のmachine-result fingerprintがsavedと異なる → **STALE**
   （pairは現在もeligibleだが、source record内容またはmachine resultが変化した）。
4. それ以外（pair identity一致 ∧ source identity一致 ∧ full machine-result projection（fingerprint）一致） → **CURRENT**。

- 結果が変わらない設定変更はSTALEにしない（評価対象の機械結果が同一）。
- **STALE / ORPHANED評価の扱い**: 削除しない／現在のdecision件数に含めない／ORPHANEDは現在のeligible分母に含めない／matching結果へ反映しない／
  Trace Reviewへ変換しない。UIでは**過去評価として閲覧**できる。保存はする（S16）。
- STALEなpairを再評価（新decisionをcommit）すると、同一`pair_id`のentryが現在のmachine-result・source identityで**置換**される（`evaluated_at`も更新、S14.3）。

## S13. Runtime state

Human Evaluation**専用のstate**を持つ（名称は実装時決定、例: `humanEvaluationState`）。以下へ**埋め込まない**:
`traceReviewStore`、`matchLogic`、comparison record、`mergedResult`、辞書session、`effectiveCache` / `autoCache`。

- **applied evaluation state**: `Map<pair_id, entry>`（Save対象）と`dirty`（未Save変更の有無）。
- **lifetime**: session。localStorage等へ**自動保存・自動復元しない**。ページ再読込でstateは空になり、Loadで復元する。
- **mutation point**: decision commit / issue・note・evaluatorの確定 / Clear / Load のみ。matching再実行・Trace Review操作・タブ切替・navigation・filter・Save・statusの再導出では
  entryを変更しない。
- statusと件数は派生値。キャッシュする場合もmatching run・entry変更・Trace Review以外の入力変更で無効化する。

**UI draftとappliedの関係（検討結果）**:

- **離散的な操作**（decisionの選択、issue categoryの選択）は**即時にapplied stateへ反映**する単純構造とする。
- **自由入力**（note・evaluator）は、キー入力ごとに反映すると、途中の文字列がentryになり、`evaluated_at`の更新規則（S14.3）と衝突するため、
  **UI draftとして保持し、明示的な確定操作（フォーカス離脱または確定ボタン）でappliedへ反映**する。確定時、appliedと比較して**実質変更が無ければ何も変更しない**。
- entryが無い状態で入力したnote・evaluatorは、decisionの選択時に一緒にcommitされる（noteだけのentryは作らない）。
- 未確定のdraftをnavigationで黙って失わない（保持するか確認する。方式は実装時決定）。
- **artifact Loadのatomicity（S17）とUI editing draftは別物**である。Loadはapplied stateを一括置換し、置換前のdraftは確認の後に破棄する。
  draftはartifactにもstatusにも入らない。

**実装上の制約（確認済み事実）**: `buildTraceMatrixRows()`は`traceReviewKeyFromValues()`を呼び、旧キー移行時に`saveTraceReviewStore()`でTrace Review storeを書き換え得る。
Human Evaluationは機械行を得る際に**Trace Review storeを変更し得る経路を呼んではならない**（S28）。

## S14. Artifact schema

専用artifactであり、Trace Review JSON・logic JSON・Snapshot・Pin・Nested Selection・workbookへ埋め込まない。

- `artifact_schema_version`: **`human-evaluation-persistence/0.1`**。schema idの接頭辞は`human-evaluation-persistence/`。
- 既定ファイル名: **`human_evaluation.json`**。
- **root（strict、ちょうど3 key）**: `artifact_schema_version` / `dataset_context` / `evaluations`。

```
{
  "artifact_schema_version": "human-evaluation-persistence/0.1",
  "dataset_context": null | { "actual": {...}, "requirement": {...} },
  "evaluations": [ <entry>, ... ]
}
```

- `dataset_context.{actual,requirement}` = `{ "record_count": <非負safe integer>, "signature": <string|null> }`。
- **entry（strict、ちょうど10 key。任意値は省略せず`null`）**:

| key | 型・規則 |
|---|---|
| `pair_id` | S7の文字列。`requirement_trace_id` / `actual_trace_id`から再生成した値と一致 |
| `requirement_trace_id`, `actual_trace_id` | 有効な文字列（空・空白のみ不可）。無加工 |
| `decision` | `"CORRECT"` / `"INCORRECT"` / `"UNSURE"` |
| `issue_category` | S9の6値のstring（`INCORRECT`のときのみ可）または`null` |
| `note` | `null` または 1〜4096 code pointsの文字列（S14.1） |
| `evaluator` | `null` または 1〜256 code pointsの文字列（S14.2） |
| `evaluated_at` | 正規ISO文字列 `YYYY-MM-DDTHH:mm:ss.sssZ`（必須。S14.3） |
| `machine_result` | `{ "display": {…S10.3の8 key…}, "identity": "hev-sha256:<64hex>" }`（ちょうど2 key） |
| `source_identity` | `{ "actual": "hev-sha256:<64hex>", "requirement": "hev-sha256:<64hex>" }`（ちょうど2 key） |

- unexpected keyは**reject**。`evaluations: []`は**valid**（保存済みHuman Evaluation 0件の明示状態）。statusはartifactに**保存しない**。

**S14.1 note**: optional。plain text。HTMLとして**解釈しない**（UIはtext nodeで表示）。**exact round-trip**: normalization・trim・改行変換をしない。
最大**4096 code points**（B-4bの`validNote`先例）。空文字列は保存しない（artifactの`""`は不正、UIの空入力は`null`）。matching stateへ影響しない。

**S14.2 evaluator**: field名は`evaluator`。optional。plain string。認可・権限の用途に**使わない**。最大**256 code points**。空は`null`。
（Trace Review / B-4bの`reviewer`と区別するため`evaluator`とする。）

**S14.3 evaluated_at**: entryは`evaluated_at`を持つ。**Humanが評価内容を実質変更した時だけ更新する**:

- 更新する: 新規entry作成、decision変更、issue category変更、note変更、evaluator変更、**STALE entryを再評価して現在結果へ更新**（decisionが同じでも
  machine_result / source_identityが現在値へ更新されるため実質変更）。
- **更新しない**: Load、Save、navigation、filter、変更の無い再確定（unchanged re-apply）、status（CURRENT/STALE等）の再導出のみ。
- したがって、**Load→Saveでstateが同一ならbyte-identical**である。

## S15. Serialization

- **UTF-8**、**BOMなし**、**compact**（indentなし）、**末尾改行なし**。既存`canonicalJson`相当の**object key順（昇順）**。
- **evaluationsは`pair_id`でcanonical sort**: `pair_id`の**UTF-8バイト列の昇順**（= Unicode code point順。JS既定の`sort()`はUTF-16 code unit順で、
  BMP外文字ではcode point順と異なり得るため、実装は注意する）。UI上の評価順・navigation順・評価日時順とは**独立**。
- **exact Unicode string preservation**。normalizationしない。
- Parseは空白を許容するが、Saveは常にcanonical形を出力する（valid artifactについて冪等）。
- **同じevaluation state（および同じ`dataset_context`）は常にbyte-identicalな出力**を生む。

### S15.1 Artifact size limit

**最大serialized UTF-8サイズ = 8 MiB = `8388608` bytes**（Human決定）。通常のdata correctness境界であり、security hardeningではない。
`8388608` bytesまでを有効、`8388609` bytes以上は`SIZE_EXCEEDED`として**parse前に**拒否する。**件数上限は設けない**。
（サイズはファイルの生バイト長で測る。parseは空白を許容するため、境界のverificationは末尾空白で調整できる。）

## S16. Save semantics / Clear

- Save対象は**current Human Evaluation state（applied）**で、**STALE entryとORPHANED entryを含む**。
- **保存しない**: Trace Review、matching結果本体、logic JSON、Snapshot、Pin、nested Selection artifact、statusのfield、UIのfilter state、現在のnavigation index、UI draft。
- entry 0件でもSaveできる（`evaluations: []`）。`dataset_context`はSave時点の入力dataset概要（無ければ`null`）。
- Saveはmatching・Trace Review・辞書・Graphを変更せず、`dirty`のみ解除する。

**Clear**（Human決定。どちらもHuman Evaluation stateだけを変更し、matching / Trace Review / Graph / MLへ影響しない）:

1. **current entry clear**: 選択中pairのentryを削除する（STALE / ORPHANEDの過去評価の個別削除を含む）。
2. **all evaluations clear**: 全entryを削除する。誤操作を避けるため、**件数を示した明示的な確認操作を必須**とする。

## S17. Load / validation / atomicity

順序（Pin / Nested Selectionの先例を踏襲）:

1. read bytes
2. size validation（`8388608` bytes）
3. strict parse（重複key・`__proto__`/`prototype`/`constructor` key・非標準JSON・末尾の余剰内容・不正UTF-8を拒否）
4. root / schema validation（rootのkey集合が厳密に3つ。schema接頭辞違いは`ROOT_INVALID`、同接頭辞で版が異なれば`UNSUPPORTED_VERSION`）
5. semantic validation（entryのkey集合・型、decision / issue category・整合、note / evaluator / evaluated_at、machine_result、source_identity、dataset_context）
6. pair identity regeneration validation（`pair_id`を再生成して一致検証）
7. duplicate validation（同一`pair_id`が複数ならreject。**last-wins・first-wins・dedup・skipはしない**）
8. whole artifact acceptance
9. runtime state replacement（evaluation stateを**置換**。マージしない）
10. current status derivation

- **atomic whole-artifact rejection**: invalidなら、既存Human Evaluation stateを**変更せず**、partial importなし、valid entryだけの取り込みなし、
  Trace Review不変、matching不変。
- **dataset mismatch（Human決定: Option C）**: validなartifactは**Loadする**。その後**pair単位**にCURRENT / STALE / ORPHANEDを分類する。
  `dataset_context`が現在のdatasetと**明確に異なる**（両側のsignatureが計算でき、どちらかが異なる）場合は**warningを表示**するが、artifactはrejectせず、evaluationを消さず、
  matchingへ反映しない。CURRENTが0件で全件がSTALE/ORPHANEDなら、別データセットの可能性を強調してよい。
- Loadがmatching・Trace Review・辞書・Graphを変更してはならない。未Saveの変更（dirty / draft）がある場合は、黙って失わず確認する。

## S18. UI behavioral contract

matching tool内の**独立「Human Evaluation」タブ**を正式な第一候補とする（既存runtime stateを再利用できる、Trace Reviewとの意味的分離が明確、順次評価UIを作りやすい）。
**確認済み事実**: 現タブは8つでタブ追加の前例がある。前へ／次へ・選択中comparisonの単一state・キーボード操作は既存に無く、新設が必要である。DOMの詳細は固定しない。

0.1の最小要件:

1. **eligible comparison list**（statusフィルタ付き。S19の件数表示）。
2. **current pair**: `requirement_trace_id` / `actual_trace_id`、current machine result（classification、**confidence**、**method**、**evidence**、**dictionary contribution**）。
   既存の`relationPresentation`等と同じ情報源を使い、根拠を再選定しない。
3. **操作**: decision（CORRECT / INCORRECT / UNSURE）、issue category（INCORRECT時のみ有効）、note、optional evaluator。
4. **Previous / Next / Skip**: Skipは評価を変更せず次へ進む（保存されない）。ナビゲーションはフィルタ結果の順を使う。
5. **status filter**: 全て／未評価／CORRECT／INCORRECT／UNSURE／STALE／ORPHANED／評価不可（ineligible）。
   ORPHANEDは現在のcomparison一覧に存在しないため、過去評価のグループとして閲覧し、個別にclearできる。
6. **progress / counts**（S19）。
7. **Save / Load**（専用artifact。Loadは確認とwarningを伴う）。**current entry clear**と**all clear**（all clearは確認必須）。
8. **ineligible pair**: 閲覧可能で、`PERSISTENT_EVALUATION_UNAVAILABLE`相当の状態と理由を明示し、decision controlsをdisabled等にして保存評価できないことを明確にする。
9. **NO_CURRENT_RESULT**: 現在結果が無い間は、評価の新規保存を許さず、その旨を表示する。
10. **Trace Review操作もTrace Review状態の表示も置かない**（S5）。
11. note・evidence等は**text nodeで描画**し、HTMLとして解釈しない（既存の`escapeHtml`方式を踏襲）。
12. 大量件数は、既存の分割表示（500件ごとの「さらに表示」）の先例を踏襲してよい。

## S19. Progress / counts

- **分母 = 現在eligibleなcomparison数（eligible total）**。ineligibleは分母に含めず、**別件数**として表示する。
- **evaluated（CURRENT）**: statusがCURRENTのentry数のみ。**STALEは「過去評価はあるが現在結果は未評価」**として扱い、unevaluatedに数える。ORPHANEDは分母にも分子にも入れない。
- 0.1 UIが表示する件数は**次のみ**:
  `eligible total` / `evaluated (CURRENT)` / `unevaluated` / `CORRECT` / `INCORRECT` / `UNSURE` / `STALE` / `ORPHANED` / `ineligible`。
  - `CORRECT` / `INCORRECT` / `UNSURE`は**CURRENTのentryのみ**を数える（和 = evaluated）。`unevaluated` = `eligible total` − `evaluated (CURRENT)`。
  - `STALE`・`ORPHANED`は過去評価の件数で、current decision countsに含めない。`UNSURE`を`CORRECT` / `INCORRECT`へ読み替えない。
  - NO_CURRENT_RESULT中は、現在の件数を出さず、保存済みentry数のみを示す。
- **率指標（正解率・適合率・再現率など）は0.1ではUIに表示しない。定義もしない。** 0.1は既に生成されたcomparisonのみを評価し、欠落や見逃しを評価できないため、
  一般的な「率」と呼べない。将来追加する場合は、別のContract updateで定義する。

## S20. Side-effect isolation

Human Evaluationのどの操作（decision commit / note・evaluator確定 / Clear / Load / Save / Previous・Next・Skip / filter / タブ切替）も、次を**変化させてはならない**:

`mergedResult`、`traceMatrixRows`の機械結果、effective relation（`effectiveCache` / `autoCache`の内容）、Graph topology、score、confidence、
dictionary state、Snapshot、Project Pin、nested allowlist（Selection）、ML model（`matchLogic.mlModel`）、training labels、matching logic（`matchLogic`）、
**Trace Reviewのstore（`traceReviewStore`とlocalStorage `v11_trace_review_store`）**、manual relation、workbook/Excel出力のmatching結果、
logic JSON / trace profile / Pin / Snapshot / Nested Selection artifact。

- Human Evaluationのデータは、ML同期関数（`syncAllReviewDecisionsToTrainingLabels`系）、effective view構築、Excel出力、Graph構築から**参照されてはならない**。
- 許す副作用: 表示用の隠しprop（例: `_presentation`のキャッシュ）の生成のみ。これは観測可能な照合結果ではない。
- 逆方向: Trace Review・matching・辞書・Snapshot・allowlistの変更でHuman Evaluationの**entry**は変更されない（statusの再導出のみ）。

## S21. Release behavior

Human Evaluation 0.1を将来実装する場合、**dev版とrelease版の双方で同一機能を提供する**。**dev-onlyにしてはならない**。
source HTMLのinline実装のみなら、release HTMLは`build_alpha_release.js`が継承するため、bundle変更は不要である。**専用coreを作る場合は、release bundleへの同梱が必須**で、
`SELF_AUTHORED_RUNTIME` / `SCRIPT_SRC_REWRITES` / package検証の期待一覧への追加が必要になる
（**確認済み事実**: buildは、rewrite後の全`<script src>`が`runtime/`配下で実在するかをfail-closedで検査する）。
release文書（README_ja / KNOWN_LIMITATIONS）の更新とrelease検証の追加も要る。
推奨: Pin / Nested Selectionと同様の**依存なしのpure core**（codec・検証・pair identity・状態比較）をstorage-neutralで持ち、
fingerprintの計算（`canonicalJson` / `rawSha256Utf8` / `computeDatasetSignature`）は既にbundle済みの`QuantitySidecarBinding`をadapter側から利用する
（coreは他coreを`require`しない）。

## S22. Compatibility / future versions

- 0.1ではmigration frameworkを作らない。未知のschema version（同接頭辞・異なる版）はreject、**best-effort importをしない**。
- Trace Review JSONをHuman Evaluation artifactとして読み込まない（root key・schema idの不一致でrejectされる）。
- 将来のversionは新しい`artifact_schema_version`で、strict key集合を更新して行う（entryへのkey追加、issue detail、欠落comparisonの評価、率指標の定義など）。

## S23. Error boundary

エラーは`{ code, path }`のみをsurfaceとする（artifact内容・entry内容を表示しない。既存Pin / Nested Selectionの先例）。`path`は`$.evaluations[3].decision`のように位置のみを示す。
接頭辞は **`HUMAN_EVALUATION_PERSISTENCE_*`**:

| code | 内容 |
|---|---|
| `…_SERIALIZED_INVALID` | 文字列でない／非JSON／重複key／禁止key／末尾の余剰内容／不正UTF-8 |
| `…_SIZE_EXCEEDED` | `8388608` bytes超過 |
| `…_UNSUPPORTED_VERSION` | schema接頭辞は同じで版が異なる |
| `…_ROOT_INVALID` | rootのkey集合が厳密でない／rootが非object／schema接頭辞違い |
| `…_ENTRY_INVALID` | entryのkey集合・型、trace_id、note、evaluator、evaluated_atの不正 |
| `…_PAIR_IDENTITY_MISMATCH` | `pair_id`の形式不正、または再生成値との不一致 |
| `…_DUPLICATE_PAIR` | 同一`pair_id`が複数 |
| `…_DECISION_INVALID` | decisionがenum外 |
| `…_ISSUE_CATEGORY_INVALID` | enum外、またはdecisionと不整合（`INCORRECT`以外でnon-null） |
| `…_MACHINE_RESULT_INVALID` | `machine_result`（display / identity）の形式・上限の不正 |
| `…_SOURCE_IDENTITY_INVALID` | `source_identity`の形式不正 |
| `…_DATASET_CONTEXT_INVALID` | `dataset_context`の形式不正（現在datasetとの**不一致**ではない） |

UIレベルの状態（artifactエラーではない）: `PERSISTENT_EVALUATION_UNAVAILABLE`（S6）、`NO_CURRENT_RESULT`（S12）。

## S24. Verification requirements / Guard planning

### S24.1 実装時の必須verification

**Identity**
- V-I1: golden pair ID（`hev-pair-v1:5:REQ-1,6:PART-1,`）。V-I2: Unicode byte-length netstring（`hev-pair-v1:8:要求-1,3:P-1,`、絵文字等のBMP外文字を含む）。
- V-I3: delimiter collision resistance（`"a|b"`型の連結で衝突する対が別identity）。V-I4: A/B入れ替えで別identity。
- V-I5: row reorderで`pair_id`不変（trace_idあり）。V-I6: missing trace ID（null / empty / whitespace-only / non-string）→ ineligible（閲覧可・保存不可）。位置番号・`B_ID`がidentityに使われない。
- V-I7: duplicate trace ID（A側・B側）・重複pair → ineligible。V-I8: malformed pair ID（形式不正・再生成不一致）→ `PAIR_IDENTITY_MISMATCH`。

**Decision / Issue category**
- V-D1: CORRECT / INCORRECT / UNSURE の設定と置換。V-D2: SKIPが状態を変えず、未評価と区別されない。V-D3: clear current / clear all（matching等に影響しない。all clearは確認必須）。
- V-D4: issue category全6値、`INCORRECT`のみnon-null、他decisionでnull、decision変更時の`null`化、`MISSING_MATCH`が不正。
- V-D5: note exact round-trip（改行・絵文字・前後空白・`<script>`文字列がそのまま保存・表示され、HTMLとして解釈されない）、4096 code points境界、空→null。V-D6: evaluator 256境界。
- V-D7: evaluated_atの更新規則（実質変更でのみ更新、Load/Save/navigation/filter/unchanged re-applyでは不変、STALE再評価で更新）。

**Persistence**
- V-P1: empty artifact（`[]`）のSave/Load。V-P2: 8 MiB境界（`8388608`有効、`8388609`で`SIZE_EXCEEDED`）。
- V-P3: deterministic byte（同state→同bytes、無変更のLoad→Saveがbyte-identical）。V-P4: Unicode exact preservation。V-P5: `pair_id` canonical sort（UTF-8 byte順、BMP外文字を含む）。
- V-P6: duplicate pair reject。V-P7: extra key / missing key reject。V-P8: future version reject（`UNSUPPORTED_VERSION`）。Trace Review JSONの拒否。
- V-P9: atomic rejection（invalid時に既存state・Trace Review・matchingが不変、部分importなし）。V-P10: STALE / ORPHANEDもSave対象、statusがartifactに含まれない。
- V-P11: dataset_context不一致でrejectされずwarningが出る。V-P12: 各error codeと`{code,path}`のみのsurface（内容を含まない）。

**Stale**
- V-T1: 結果不変 → CURRENT。V-T2: source record変更 → STALE。V-T3: machine result変更（**truncate後に同一となるevidenceの後半のみの変更を含む**）→ STALE。
- V-T4: pair消失 → ORPHANED。V-T5: eligibility喪失（trace_id重複化・変更）→ ORPHANED。V-T6: matching結果なし／実行中／再照合要求中 → NO_CURRENT_RESULT。
- V-T7: 結果が変わらない設定変更 → CURRENT。V-T8: 辞書Snapshot有効化・allowlist変更・タグ生成・Trace Review操作で`source_identity`とmachine-result fingerprint（machine rowベース）が変わらない。
- V-T9: STALE再評価でentryが現在値へ置換される。

**Isolation**（操作の前後でdeep比較）
- V-S1: matching、Graph、Trace Review（localStorageのbyte列を含む）、ML、training labels、dictionary、Snapshot、Pin、nested Selection、logic JSONが不変。
- V-S2: Trace Review操作でentry・statusが変化しない。機械行の取得経路がTrace Review storeを書き換えない。
- V-S3: 静的検査: ML同期・effective view・Excel・Graph構築がHuman Evaluation stateを参照しない。

**Browser（実Chromium）**
- V-B1: tab、eligible list、current pair。V-B2: decision、issue category、note、evaluator。V-B3: Previous / Next / Skip。V-B4: filters、counts（S19の9項目のみ。率指標が存在しない）。
- V-B5: Save / Load、clear（個別・全件）。V-B6: ineligible表示（`PERSISTENT_EVALUATION_UNAVAILABLE`、decision controls無効）。V-B7: NO_CURRENT_RESULT表示。V-B8: pageerror 0。

**Release**
- V-R1: source HTMLとrelease bundleの同機能（parity）。V-R2: coreを追加する場合のbundle同梱とfail-closed検査。V-R3: release実Chromiumで上記Browser主要項目。

**Regression**
- V-G1: 新しいcloneで全suiteを直列実行し、raw結果とevaluationを分けて報告。active new regression = 0。
- V-G2: negative control: Human Evaluation stateがmatching / Trace Review / ML / 辞書へ到達する変更、またはtruncate後の値でstale判定する変更を注入し、V-S1 / V-S3 / V-T3が確実にFAILすること。

### S24.2 Guard planning（今回は実行しない）

Human Evaluation実装時はsource HTML差分が入るため、HTML authorized diff guardの**次世代化**が必要になる見込みである。移行計画:

1. **現Persistence active guard selftest**（`…selftest_nested_selection_persistence.js`）は、HTML差分が入った時点で**historical candidate**となる（8本目）。**今回は分類を変更しない。**
2. **既存historical 7本は未変更**で維持する。
3. Human Evaluation用の**新しいactive guard selftest**を追加し、新hunkのみを許可する。新規追加行がmatching / score / ranking / 学習 / Trace Review storeを変更する識別子に触れないことの検査を含める。
4. 実装開始までは、Persistence active guardがcurrent activeのままである。

## S25. Explicit out-of-scope

自動学習、辞書への自動登録、threshold調整、score再較正、モデル訓練、複数reviewer consensus、reviewer権限、security governance、署名・暗号、外部DB、cloud sync、
tag/evidence単位評価、missing comparison（欠落）の評価、率指標の定義と表示、評価履歴の保持、Trace Reviewへの変換・提案・表示、
**CSV / workbook export**（評価contractを先に安定させ、既存workbookのoperational reviewとの混同を避ける。JSON artifactを唯一の正式保存形式とする）、
session限定の一時評価、評価の自動復元（localStorage等）、G2 / security関連。

## S26. Human decisions — 状態

**OPEN HUMAN DECISION: 0件。** 以前のdraftのOHDは、すべてHuman判断によりCLOSEDとなった。

| 旧ID | 事項 | 決定（本書の節） |
|---|---|---|
| OHD-1 | issue category enum | 6値（`MISSING_MATCH`除外、`QUANTITY`採用）— S9 |
| OHD-2 | artifactサイズ上限 | `8388608` bytes、件数上限なし — S15.1 |
| OHD-3 | 率指標の表示 | 率指標は0.1で表示も定義もしない — S19 |
| OHD-4 | `source_identity` | entry単位で採用 — S11 |
| OHD-5 | `evaluator` / `evaluated_at` | 採用、実質変更時のみ更新 — S14.2 / S14.3 |
| OHD-6 | machine snapshot | full projectionのfingerprintでstale判定、表示用snapshotは別 — S10 |
| OHD-7 | dataset mismatch | Option C — S17 |
| OHD-8 | Trace Review表示 | 表示しない — S5 / S18 |
| OHD-9 | entry順序 | `pair_id` canonical sort — S15 |
| OHD-10 | note上限・pair接頭辞・ファイル名・error接頭辞 | 4096 / `hev-pair-v1` / `human_evaluation.json` / `HUMAN_EVALUATION_PERSISTENCE_*` — S14 / S23 |

## S27. 参照した既存の確認済み事実（要約）

- 一般comparisonに正式な`comparison_id`は無い。`cmp-v1`は数量comparison専用（`quantity_sidecar_binding_core.js`）。
- `_reviewKey`（`profile‖A_ID‖B_ID`）、`A-001`、`B_ID`は永続identityとして不適（位置・照合テキスト・field推定に依存。実測済み）。
- 内容を含む決定的fingerprintの先例: `computeDatasetSignature`（`QA-SHA256`）、`rawSha256Utf8`、`canonicalJson`。評価時点の機械結果を持つ先例`autoAtReview`（Trace Review）。
- 専用artifactの先例: Project Snapshot Pin（64 KiB）、Nested Selection（1 MiB）。strict root、`{code,path}`、atomic Load、canonical出力。
- B-4b（数量comparisonレビュー）はcomparison_id単位のoperational reviewで、reviewer必須・`reviewed_at`は正規ISO・note 4096 code points。0.1とは別機能。
- Trace Reviewはoperational reviewで、効果とlocalStorage保存を持つため、Human Evaluationと保存領域・stateを共有しない（S5）。

## S28. 実装時の調査項目（Human判断ではない）

実装sliceの冒頭で調べ、verificationで固定する。いずれもContractの規定（S5 / S11 / S12 / S20）を満たす方法を選ぶ。

1. **機械行の取得経路**: Trace Review storeを書き換えない経路（既構築の`traceMatrixRows` / `autoCache`の読み取り等）。`buildTraceMatrixRows()`の旧キー移行副作用を避ける。
2. **入力record由来のprojection**: 読み込み後にtoolが付与し得る列挙可能な派生propertyの有無を確認し、入力由来のみをprojectionする方法。
3. **dictionary contributionの取得**: `dictionaryContributionForEdge()`が機械行から副作用なく呼べること。
4. **再照合が必要な状態（NO_CURRENT_RESULT）の検出**: 既存のstale / 実行中フラグ（`traceMatrixStale`、`activeMatchingJob`等）の利用。
5. UIの具体（DOM、確定操作の形式、draft保持/確認の方式）。
