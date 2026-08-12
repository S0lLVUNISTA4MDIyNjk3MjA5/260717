P2-A4 Checkpoint 1 — Matching Tool Current-State Analysis
===========================================================

目的: P2-A4（Private Dictionary Application / Matching Integration）の設計に先立ち、既存の照合ツール
（"matching tool"）の実装を実コードから調査し、architecture・責務境界・既存の辞書/tag相当処理を
正確に把握する。本書は調査結果のみを記述し、新設計は
`private_dictionary_matching_integration_contract_0.1.md` 側に記載する。

本書の内容は固定head `32465b65cd30f219bf7780fc0b623570e2ca4c7b` の実コードを直接読んで確認した事実
であり、推測は含まない（確認方法が実装コード読解でなくschema/testからの推定に留まる箇所のみ
「Confidence: Medium」と明記する）。

---

## 0. スコープの誤解を避けるための前提

このrepositoryには互いに独立した2つのtool系統が存在する。

1. **matching tool**（本書の調査対象） — `tools/json_ab_trace_matching_tool_v12.1.15.html` を
   中心とする、PDF由来JSON（要求仕様）とExcel由来JSON（設計レビュー実績）を照合するbrowser tool。
2. **knowledge_builder**（P2-A1〜P2-A3、既にintegration branchへmerge済み） —
   `tools/knowledge_builder/` 配下。非公開辞書候補の抽出・レビュー・Workbook化を行う別系統。

P2-A4はこの2系統を**接続する**layerである。したがって本書はmatching tool側の実装を対象とし、
knowledge_builder側の実装は「§9 既存のPROJECT/DOMAIN/ACTIVEスコープ・状態機構」でのみ、
P2-A4設計に直接影響する事実として言及する。

---

## 1. TraceRecord / TraceRecordSet 入力

matching toolへの入力には性質の異なる2つの概念がある。

- **生JSON A/B**（実運用時の主入力）: JSON A =「要求仕様」（`spec_to_json_conversion_tool_v1.18.html`
  が生成するPDF由来JSON）、JSON B =「実績」（`excel_to_json_conversion_tool_v2.0.8.html` が生成する
  Excel由来JSON）。matching tool内での正規化は `adaptDocumentJsonToTraceRecords()` /
  `prepareInputData()`（`tools/json_ab_trace_matching_tool_v12.1.15.html` 付近 L2878-2935）が
  ヒューリスティックに行っており、これらJSON自体には厳密なformal schemaは存在しない。
- **formal `trace-comparison/1.0-rc2` record_set**: schema定義は
  `tools/design_notes/trace_comparison_schema_v2.json`（browser向けコピー
  `tools/generated/trace_comparison_schema_v2.browser.js`）。validatorは
  `tools/design_notes/trace_comparison_record_set_validator.js` の `validateTraceComparisonRecordSet()`
  （schema検証 + 意味的再計算による2段階検証）。ただしこれは**照合結果として生成される派生
  artifact**であり、raw入力ではない。

Confidence: High.

---

## 2. matching開始 entry point

`loadBtn` クリック（HTML L9166）→ JSON A/B読み込み → `prepareInputData()` →
`runAsyncMatchPipeline()`（L2210）で初回照合を実行。再照合は `rerunMatchBtn`（L6589-6629）から
同じpipelineを呼ぶ。

Confidence: High.

---

## 3. comparison生成

- テキスト/tag照合: `matchPlmParts()`（L5665）がA各行に対しB候補行をスコアリングし、
  `buildTraceMatrixRows()`（L7971）が結果全体（`traceMatrixRows` / `mergedResult`）を組み立てる。
- 数量照合: `quantity_sidecar_binding_core.js` の `generateTraceComparisonRecordSet()`（L2586、
  `generateConditionResolutions` 等L1341以降のhelperを利用）。

Confidence: High.

---

## 4. comparison ID生成

**互いに無関係な2方式が併存している。**

- テキスト照合側にはformalなcomparison IDが**存在しない**。行は `matcher_a_id` / `matcher_b_id`
  で識別され、各々 `rowStableId()` / `sysRowId()` / `plmUniqueKey()`（L4727-4785）が「コード的な列」
  をヒューリスティックに選んで生成する。ハッシュではなく、`A-001` / `B-001` のような連番へ
  フォールバックすることもある。
- 数量subsystem側は決定的な合成キー: `comparison_id = "cmp-v1:" + utf8-netstring(requirement_trace_id,
  actual_trace_id, quantity_pair_id)`（`decodeUtf8NetstringElements()` で復元可能なことを
  validatorが確認）。`quantity_id` 自体はschema `idContracts` により `SHA-256/128`。

Confidence: High.

**P2-A4への含意**: 新設計のresolution/comparisonがどちらのID方式と結びつくかは、テキスト照合と
数量照合で別々に検討する必要がある。単一のID契約を両方へ強制すると既存契約を破壊する。

---

## 5. tag / term / property等の照合処理

`matchLogic` object（L3130-3180付近）が手法別スコア（完全一致/コード一致/synonym/自動synonym/
fuzzy/vector/partial）を固定する。`bestMatchForPlm()` / `bestDeterministicMatchForPlm()` が
これらを実行し、`normalizeForMatch()` / `normalizeTagValue()` が正規化、`tokenize()`（L3954）+
`cosineSim()`（L4041）がvector類似度を実装する。

synonym照合は `matchLogic.synonymMap`（利用者編集の base→[synonyms]）と
`matchLogic.synonymAuto`（自動生成候補。「要確認」フラグ付きで、無条件マージされない）の2層。
別途opt-in（既定OFF）のtag機構: `evaluateTagMatch()` / `buildTagIndex()`（明示tag + 業務辞書base term
+ code列から構築）。

Confidence: High.

---

## 6. quantity sidecar統合点

`loadQuantityBindings()`（L1799）が読み込み時に `QuantitySidecarBinding.bindInputPair()` を呼び、
要求/実績trace JSON + 別途の数量annotation JSONから `quantityBindingState` を生成する。
**この処理はテキスト照合と並行して走り、内部で結合されない。** 結合が起きるのは、利用者が
明示的にrecord_setをダウンロードする時（`downloadTraceComparisonRecordSet()`、L1854）か
review sessionを開始する時のみで、その時点で `relationRows()`（`traceMatrixRows` から構築）と
bindingが `generateTraceComparisonRecordSet()` へ渡される。annotation fileが未指定なら
この経路は一切実行されない、完全にadditiveな機構。

Confidence: High.

---

## 7. review state

`trace_comparison_review_state_core.js` — in-memoryのみ（deep-frozen JS object。review core内に
localStorage/sessionStorageの使用は無い）。`comparison_id` ごとに4つの上流target
（`quantity_extraction` / `property_mapping` / `interval_semantics` / `comparison_mode`）、各々
`{status, reviewer, reviewed_at, verdict:'accept', note}`。加えて `satisfaction` target
（verdict: `accept` / `override_satisfied` / `override_unsatisfied`）は4上流targetが全てacceptされて
初めて操作可能（`upstreamAccepted()`、L221）。

session shape: `{overlay_version, session_id, session_status(active|stale), session_revision,
started_at, started_by, stale_runtime, live_source_marker, snapshot_identity, comparisons}`。
純粋reducer `transitionReviewState(session, action)`。

Confidence: High.

---

## 8. review session

`trace_comparison_review_session_core.js` — `createReviewSessionCoordinator()`（L723）が
state coreをclosureでwrapし、session + binding runtime + record_set snapshotを保持。公開API:
`startReviewSession` / `coordinateReviewTransition` / `beginBindingRefresh` /
`completeBindingRefresh` / `invalidateReviewSource` / `getReviewSession` / `getRecordSetSnapshot`。

lifecycle: none → active（`startReviewSession`。reviewer名 + 新鮮なmatch結果 +
quantity binding readyが必須） → stale（file入替・再match commit・Phase-7手動relation編集等、
signature diffで検出、HTML L12879-12897で配線） → discarded。永続化なし、reload で消失。

Confidence: High.

---

## 9. ACCEPT/REJECT等の照合review処理

`b4bHandleAction(actionType, target, verdict)`（HTML L13135）がaction objectを組み立て、
`b4bCoordinator.coordinateReviewTransition()` を呼び、無条件に `recomputeAndCacheProjection()` を
実行する。UIボタン: 「承認」（target別accept_review_target）、「自動判定を承認」/
「override satisfied」/「override unsatisfied」（review_satisfaction、上記4 targetが
全てacceptされて初めて有効）、「reset」（reset_review_target）。

**明示的な二値REJECTは存在しない** — 不一致の表明は `override_satisfied` /
`override_unsatisfied`（satisfactionのみ、かつ4 target全acceptが前提）を通じてのみ行われるか、
単に承認しないことで表現される。

Confidence: High.

---

## 10. detailed table

`renderDetailTableFull()` が `traceMatrixRows`（行builder群 `buildDetailRows*`、L8278-8350）から
「照合結果一覧」を構築する。B-4b拡張はadditiveにラップ: `renderDetailTableFull = function(){
base(); b4bDecorateDetailTable(); }`（L13220-13224） — review状態列と詳細ボタンを追加するのみで、
読むのは `b4bProjectionCache` のindexのみ。core行dataには一切触れない。

Confidence: High.

---

## 11. knowledge graph

Cytoscapeベース。基本edge/nodeは `traceMatrixRows` に由来。B-4b装飾（`b4bDecorateGraph`、L13228+）は
edge着色と `b4bProjectionCache.matcherPairIndex` からのreview-id data付与のみを行い、コード内コメントで
明示的に「read-only表示のみ...edgeタップから承認等のmutationができるパネルは開かない」とされている
（read-only、再計算なし、edgeタップ起点のmutationなし）。

Confidence: High.

---

## 12. Excel export

独立した2経路がある。

- **main結果Workbook**（L8188）: sheet構成 = Trace Matrix（`traceMatrixRows` から `_` prefix隠しfield
  を除いた全内容 — A/B field値・マッチしたtext・confidence・evidence・review labelを含む。
  **これはID等の要約情報ではなくsource contentそのもの**）、概要、詳細（optional）、B集約ビュー、
  filtered views、Review Summary、Settings。
- **B-4b Checkpoint-3 formal export**: `trace_comparison_review_export_core.js` の
  `buildReviewedExportArtifact()` / `buildReviewedExcelSheets()` — 既に計算済みのprojection +
  rc2 record_set + review sessionを結合して `trace-comparison-reviewed/1.0` artifactを生成する。
  再計算は一切行わず、自身が生成したartifactのみを信頼する（`attestedArtifacts` WeakSet）。

Confidence: High.

**P2-A4への含意**: main結果Workbookは既にsource contentをそのまま出力しており、privacy境界の
考え方がP2-A2/P2-A3のprivacy契約とは異なる（そもそも別tool系統のため）。P2-A4がdictionary
resolution情報をExcel exportへ追加する際は、この既存2経路のどちらに載せるか、またprivate
dictionary termsを不用意にshareable相当の出力へ混入させない設計が必要（§31参照）。

---

## 13. provenance

rc2 schemaの `provenance` object: `hash_algorithm=SHA-256`、`id_hash_algorithm=SHA-256/128`、
`id_contracts`（固定encoding契約）、`normalization=v12-normalize-v1`、
`requirement_dataset_signature` / `actual_dataset_signature`（`QA-SHA256:<hex64>`形式）、
`ruleset_version`（`SUPPORTED_RULESETS` と照合）。各comparison recordはさらに
`mapping.{requirement,actual}_resolution.candidates[]`（順位付け・confidence付き）と
`auto_applicability.basis`（warning件数・mode confidence・condition margin・反証flag等、各々
`_meets_threshold` boolean付きの完全な導出記録）を持つ。

テキスト照合engine側の対応物は `根拠`（evidence）列と隠しrow prop（`_tagEvidence` /
`_candidateSources`）で、半構造化・自由記述に留まりformal provenance objectではない。

Confidence: High.

---

## 14. error boundary

全体としてfail-closed。`validateTraceComparisonRecordSet()` は例外を投げない契約（try/catchで
明示的に「総関数」）。`preflightJsonGraph()` はschema検証**前**に非plain-JSON構造
（循環参照・sparse array・prototype汚染・過大size）を拒否し、正しさとcompute量の両方を
bound する（`MAX_GRAPH_DEPTH=64`、`MAX_GRAPH_NODES=200000`、`MAX_ARRAY_ITEMS=20000`）。
review state遷移は例外ではなく型付き `{ok:false, diagnostics:[...]}` を返す。HTML側のflow
（例: `downloadTraceComparisonRecordSet`、L1854-1906）は前提条件（新鮮なmatch・binding ready・
実行中jobなし）をhard-gateし、部分的なartifactを出すよりも生成を拒否する。

Confidence: High.

---

## 15. 既存の dictionary / tag-vocabulary 相当処理（matching tool内部）

2つの単純な機構があり、いずれもlifecycleを持たない。

- `matchLogic.synonymMap`（利用者編集のbase→[synonyms]）+ `matchLogic.synonymAuto`
  （自動生成候補、レビュー待ちflag付きで無条件昇格されない）+ CSV/JSON「業務辞書」import
  （`synonymMap` へマージ） — 実行時/in-memoryのみ、ad hocなexport/import JSONのみ、
  scope/statusの概念なし。
- `shared/tag_vocabulary.json`（schema `trace-tag-vocabulary/1.0`: flat
  `{vocabulary_id, vocabulary_version, allowed_tags[], aliases{}}`）— PDF/Excel生成tool側が消費し、
  matching tool自体は直接消費しない。

いずれもPROJECT/DOMAIN/ACTIVEの概念を持たない。それは§9記載のknowledge_builder側にのみ存在する。

Confidence: High.

---

## 16. comparison結果とUI境界

数量/review subsystemは設計上明確に分離: `recomputeAndCacheProjection()`（L12965）が
projection計算の唯一の場所であり、全renderer は凍結された `b4bProjectionCache` のみを読む。
`projectEffectiveReviewedResultSet()` 自体が純粋/非破壊であることが
`trace_comparison_review_projection_core.js` のheaderに明記されている。

一方、テキスト照合本流は緩い: `mergedResult` / `traceMatrixRows` は素のmutable objectであり、
多くのrender関数から直接読まれる。matching engineのfieldとUI/review系field（`レビュー判定`、
隠し`_` prop）が**同じrow objectに同居**しており、immutability境界は無い。

Confidence: High.

---

## 17. graphのsource of truth

自動生成edge: graphとtableは共に同じ `traceMatrixRows` / `mergedResult`（`buildTraceMatrixRows()` が
一度だけ計算）に由来し、graph独自の再計算は無い。review装飾: tableとgraphは全く同じ
`b4bProjectionCache` objectを、異なるindex map（table側 `matcherAIndex` / `matcherBIndex`、
graph側 `matcherPairIndex`）経由で読む — 単一のsource、lookup方法だけが異なる。

Confidence: High.

---

## 18. 既存のPROJECT/DOMAIN/ACTIVEスコープ・状態機構（knowledge_builder側、P2-A4への最重要インプット）

matching tool側にはPROJECT/DOMAIN/ACTIVEスコープ・状態や自動promotionの概念は**存在しない**。

しかし、別系統である `tools/knowledge_builder/core/private_dictionary_learning_core.js`
（design: `tools/knowledge_builder/design/private_dictionary_learning_contract_0.1.md`、P2-A1）に、
**既にほぼそのまま使えるscope/status語彙が実装済みで存在する**ことを実コードで確認した
（`private_dictionary_learning_core.js` L165-191、L172-180で直接確認）。

```js
const STATUSES = Object.freeze(['PROBATION', 'ACTIVE', 'OBSERVING', 'QUARANTINED', 'RETIRED']);
const ALLOWED_TRANSITIONS = Object.freeze([
  'PROBATION>ACTIVE', 'PROBATION>QUARANTINED', 'PROBATION>RETIRED',
  'ACTIVE>OBSERVING', 'ACTIVE>QUARANTINED', 'ACTIVE>RETIRED',
  'OBSERVING>ACTIVE', 'OBSERVING>QUARANTINED', 'OBSERVING>RETIRED',
  'QUARANTINED>ACTIVE', 'QUARANTINED>OBSERVING', 'QUARANTINED>RETIRED',
]);
const PRIVATE_SCOPE_VALUES = Object.freeze(['DOMAIN', 'PROJECT', 'SESSION']);
// index 0 = 最高lookup優先度（"SESSION > PROJECT > DOMAIN > STANDARD"）
const SCOPE_PRIORITY = Object.freeze(['SESSION', 'PROJECT', 'DOMAIN', 'STANDARD']);
```

ただし同ファイルのheader（L1-12）は明示的に「promotion/quarantine/rollback policyは実装しない」
「filesystem/Blob/download/FileReader/network/persistence APIには触れない」と自ら宣言しており、
候補抽出（`private_dictionary_rule_extraction_core.js`）は常に `PROBATION` のみを生成する
（同ファイルheader「never generates status other than PROBATION」）。つまり
**語彙・状態遷移表という「文法」は既に存在するが、それを駆動する昇格処理そのものは
どこにも実装されていない**。

**P2-A4への含意（重要）**: P2-A4指示書§12/§13で「scope設計」「status lifecycle設計」を求めているが、
ゼロから新しい語彙を発明すべきではない。`private_dictionary_learning_core.js` が既に
`SESSION`/`PROJECT`/`DOMAIN`（+ `STANDARD`）というscope集合と、`PROBATION → ACTIVE → OBSERVING →
QUARANTINED/RETIRED` という状態遷移表を契約として固定している。P2-A4のPromotion boundaryは
この既存語彙・遷移表と**整合**させるべきであり、独自の
`APPROVED_FOR_PROMOTION`/`SUPERSEDED` のような別語彙を新たに導入すると、同じ概念に対して
2つの矛盾した状態機械が並立することになる。詳細な採用方針は contract 側 §13相当（Status
lifecycle）に記載する。

このファイルはP2-A4 Checkpoint 1では**read-only**として扱い、変更しない（既存実装読解のみ）。

Confidence: High（実コード直接確認）。

### 18.1 P2-A1 の公開APIの正確な形（R1で追加確認、`private_dictionary_learning_core.js` 直接読解）

`private_dictionary_matching_integration_contract_0.1.md` をこれらの既存関数のSource of Truth
として設計するため、R1にて実装を再確認した。すべて `private_dictionary_learning_core.js` の
`module.exports`（L1318-1324付近）に含まれ、外部から呼び出し可能。

- **`schema_version` 固定値**: `'private-dictionary-overlay/1.0'`（L574で検証。他の値は
  `DICTIONARY_SCHEMA_VERSION_INVALID` で拒否）。単一辞書（1レイヤー分）のcanonical payload
  schemaはこの1つのみで、P2-A4が第二の辞書本文schemaを作る必要はない。
- **`serializePrivateDictionaryCanonical(input)`**（L733、§13/§14.2）: 入力を`validatePrivateDictionary()`
  で検証後、`{schema_version, dictionary_id, version, scope, entries}` の形へ正規化して
  `canonicalJson()` へ渡す。`entries` は `entry_id` のordinal順にsortされ、各entryは
  `{entry_id, canonical_term, aliases(正規化key→ordinal順にsort), status, source:{kind,
  content_included}, utility:{7つの整数field}}` のみを含む（L691-729）。**timestampに相当する
  fieldはこの構造に一切含まれない。**
- **`hashPrivateDictionaryCanonical(input)`**（L741、§13.1）: 上記のcanonical文字列を
  `TextEncoder().encode()` でUTF-8 bytesにし、SHA-256 hexを返す（`sha256DirectHex`）。
- **`canonicalJson(value)`**（`tools/quantity_sidecar_binding_core.js` L128、id_hash_utils系の
  共有実装と同型）: `Object.keys(value).sort()` によるkeyのordinal順ソートを再帰的に適用し、
  `JSON.stringify()` する。配列はソートせず、呼び出し側（`serializeValidatedPrivateDictionary()`）
  が事前に`entries`/`aliases`をordinal順へsortしてから渡す。
- **`createPrivateDictionaryLayerView(dictionary)`**（L766）: 1レイヤー分の辞書を検証・fingerprint化
  （`hashPrivateDictionaryCanonical()` を内部で呼ぶ）し、
  `{scope, dictionary_fingerprint, entries:[{entry_ref_id, canonical_display, canonical_key,
  aliases:[{display,key}], status, source_kind}]}` を返す。
- **`detectDictionaryLookupConflicts(layerViews)`**（L1120、§9.2）: 複数layerViewを横断して、
  同じnormalized lookup keyが複数の異なるcanonical keyへ解決される場合を`conflictedKeys`として
  検出する（L1097-1103のコメントで、canonical同士の自己解決は`byCanonical.size===1`のため
  conflict扱いされないことを明示）。conflict 1件ごとに `{code:'DICTIONARY_LOOKUP_CONFLICT',
  normalized_key_token, entry_refs[]}` を生成（`normalized_key_token` はkey文字列そのものではなく
  `safeHashParts('private-dictionary-lookup-key-v1',[key])` によるhash — 元の語を露出しない）。
  `MAX_CONFLICT_RECORDS` を超えるconflict集合はhash生成前に即rejectされる（L1131、fail-closed）。
- **`mergeDictionaryLayers(layerViews)`**（L1164、§14.4）: 内部で`detectDictionaryLookupConflicts()`
  を呼び、**conflictedKeys（canonical keyとしてもalias keyとしても）を持つentry/aliasは
  effective_vocabularyの構築から丸ごとskipされる**（L1178-1179, L1184-1185の
  `if (conflictedKeys.has(...)) continue;`）。非conflictのentryは通常通り採用される
  — 「1件のconflictがDictionary全体を無効化する」ことはなく、**局所的に該当lookup keyのみ
  除外**される設計であることを実装で直接確認した。戻り値:
  `{effective_vocabulary:{allowed_tags:[canonical表示名の配列], aliases:{alias表示名→canonical
  表示名}}, conflicts:[...], excluded_lookup_key_tokens:[...], source_fingerprints:[...]}`。
  `SCOPE_PRIORITY`（`SESSION > PROJECT > DOMAIN > STANDARD`）が同一canonical_keyの複数候補間の
  優先順位（どのscopeのcanonical表示名を採用するか）に使われる（L1176, L1187, L1199）。

**P2-A4への含意（確定）**: `effective_vocabulary`（`allowed_tags`/`aliases`のflatな解決済み
mapping）こそがDictionary resolutionのSource of Truthであり、P2-A4は独自の辞書本文schemaや
独自のconflict解決ロジックを作らず、`createPrivateDictionaryLayerView()` →
`mergeDictionaryLayers()` の出力をそのまま消費する設計とする。詳細な統合方針は
contract文書 R1修正後のS4/S5/S12を参照。

---

## 19. まとめ: P2-A4統合候補点

| # | 統合候補点 | 現状の実装 | 備考 |
|---|---|---|---|
| 1 | matching開始前のTraceRecord正規化・matching input生成 | `prepareInputData()` 〜 `matchPlmParts()`/`buildTraceMatrixRows()` 呼び出し直前 | **matchingの結果に実際に影響しうる唯一の統合点**。Dictionary Resolverはここでのみ動作し、`matchLogic`（既存スコア体系）への追加入力信号を作る（R1修正: 旧版は「comparison生成後」も統合点として並記していたが撤回。詳細はcontract側S4/S13参照） |
| 2 | comparison生成後・review開始前 | `buildTraceMatrixRows()` の出力〜review session開始まで | **display/provenance binding専用**。この段階でのsidecar付与はUI表示・Excel export向けのprovenance注記であり、matching結果そのものには一切影響しない（matching inputではない） |
| 3 | review UIのACCEPT/REJECT | `b4bHandleAction()` | dictionary由来のcomparison判断への影響はここではなくresolution段階（#1）で吸収すべき |
| 4 | Excel export | `trace_comparison_review_export_core.js` | dictionary使用有無の出力先候補（§31） |
| 5 | knowledge_builder側status/scope語彙 | `private_dictionary_learning_core.js` | P2-A4が再利用すべき既存契約 |

---

## 20. 保護境界（P2-A4 Checkpoint 1でread-onlyとして扱った実装）

- `tools/json_ab_trace_matching_tool_v12.1.15.html`
- `tools/json_ab_trace_matching_tool_lite_v1.5.html`
- `tools/trace_comparison_review_state_core.js`
- `tools/trace_comparison_review_session_core.js`
- `tools/trace_comparison_review_export_core.js`
- `tools/trace_comparison_review_projection_core.js`
- `tools/quantity_sidecar_binding_core.js`
- `tools/design_notes/trace_comparison_record_set_validator.js`
- `tools/design_notes/trace_comparison_schema_v2.json` / `tools/generated/trace_comparison_schema_v2.browser.js`
- `tools/knowledge_builder/core/*`（P2-A2/P2-A3 core、`private_dictionary_learning_core.js` を含む）
- `tools/knowledge_builder/ui/*`（P2-A3 production UI）
- `tools/knowledge_builder/packaging/*`

いずれも本Checkpointで一切変更していない（§36 regression章参照）。
