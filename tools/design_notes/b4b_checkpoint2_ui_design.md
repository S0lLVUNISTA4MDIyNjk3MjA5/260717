# B-4b Checkpoint 2 設計: レビューsessionのHTML/UI接続（実装済み版）

状態: **実装済み・未commit**。本ドキュメントの§0〜§11は設計Approve時点の内容を保持し、
実装時に判明した5件の補正（rerun成功判定・projectionCacheのindex一本化・JSON B基準対応・
グラフread-only化・Phase 7 source invalidation hookの実関数名/no-op検出）は末尾の
**§12 実装時の補正**にまとめて記載する（設計の大枠・§0〜§11の方針そのものへの変更はない）。
最終変更対象ファイルは以下の4件。commit/pushは今回の静的レビュー結果を待つ。

- `tools/json_ab_trace_matching_tool_v12.1.15.html`（既存、追記のみ）
- `tools/design_notes/b4b_checkpoint2_ui_design.md`（本ファイル）
- `tools/design_notes/b4b_checkpoint2_ui_verification.js`（Playwright検証、53件）
- `tools/design_notes/runtime_fixtures/b4b_fake_cytoscape.js`（新規、テスト専用の最小cytoscapeフェイク）

## 0. 前提・対象ファイルの確認

対象のUIホストは `tools/json_ab_trace_matching_tool_v12.1.15.html`（以下「本ツール」）。

設計開始時点（Checkpoint 2着手前）では、本ツールがロードしていたreview関連scriptは
以下のみで、review state/session/projectionの3コアはまだ一つも読み込まれていなかった
（当時の54〜62行を確認済み）:

```
quantity_sidecar_binding_core.js
trace_comparison_schema_v2.browser.js（generated）
json_schema_minivalidator.js
trace_comparison_record_set_validator.js（design_notes配下）
```

Checkpoint 2実装後の現在は、§1に記載のとおりこの4本の直後に
`trace_comparison_review_state_core.js`/`trace_comparison_review_session_core.js`/
`trace_comparison_review_projection_core.js`の3コアを追加ロード済みである。

本ツールにはもう一つ、名前が紛らわしい既存機能がある。`.effective-mode-select`
（614/696/750/834行）と `human_review`（1271行、10728〜10795行）は、**Phase 7の手動トレース関係
編集・置き換え機能**であり、B-4a/B-4bの「数量比較レビュー（quantity_extraction /
property_mapping / interval_semantics / comparison_mode / satisfaction）」とは無関係の別機能である。
Checkpoint 2はこのPhase 7機能の**判定ロジック・状態遷移そのものは一切変更しない**。
新規に追加する識別子はすべて `b4bReview` 系のprefixを用いる（`effectiveMode`/`p7*` 系とは
別名前空間）。ただし、Phase 7の公開mutation API（`updateTraceReview`/
`addManualTraceRelationFromValues`/`replaceTraceRelationFromValues`/
`removeManualTraceRelation`/`deleteOrphanTraceEntry`/`importTraceReviewPackage`/
`applyBulkTraceReview`/`undoBulkTraceReview`）は、実際にB-4bのrelation source
（`manualTraceRelations`/`traceReviewStore`/`traceReplacementHistory`）を変更しうる
正式なUI経由の経路であるため、B-4bはこれらをsource invalidationのための
**read-only observer**としてもう1段ラップする（§12.5参照）。「Phase 7に一切手を
触れない」とは、この観測用ラップを除く判定ロジック・戻り値・UI挙動を変更しない
という意味であり、observerの追加自体はCheckpoint 2の設計方針の範囲内とする。

## 1. 変更予定ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `tools/json_ab_trace_matching_tool_v12.1.15.html` | 追記のみ | `<script src>` 3本の追加、レビューsessionパネルのHTML追加、詳細テーブル列・グラフ装飾を追加する関数ラッパー（p7と同じ手法）、新規スクリプトブロック |
| `tools/trace_comparison_review_session_core.js` (Stage 2/3) | **無変更** | `createReviewSessionCoordinator` をそのまま呼び出すのみ |
| `tools/trace_comparison_review_state_core.js` (Stage 1) | **無変更** | Checkpoint 1で追加済みのadditive exportのみで足りる |
| `tools/trace_comparison_review_projection_core.js` (Checkpoint 1) | **無変更** | `projectEffectiveReviewedResultSet` を読むだけ |
| `tools/design_notes/b4b_checkpoint2_ui_design.md` | 更新 | 本ドキュメント（再提出版） |

追加する `<script src>` 3本の読み込み順は、依存関係に沿って以下で固定する
（既存の4本の直後、62行の次に追記）:

```
quantity_sidecar_binding_core.js          ← 既存(59行)
trace_comparison_schema_v2.browser.js      ← 既存(60行)
json_schema_minivalidator.js               ← 既存(61行)
trace_comparison_record_set_validator.js   ← 既存(62行)
        ↓ (新規追加はここから)
trace_comparison_review_state_core.js      ← Stage 1
trace_comparison_review_session_core.js    ← Stage 2/3（QuantitySidecarBinding /
                                               TraceComparisonReviewStateCore /
                                               TraceComparisonRecordSetValidator を
                                               globalとして参照する）
trace_comparison_review_projection_core.js ← Checkpoint 1
```

## 2. HTML上のUI配置

（前回提出時と同じ内容のため変更なし。要点のみ再掲）

- **グローバル・レビューsessionパネル**: 454行の `<div class="card">`（タブ非依存の永続カード）内、
  既存の「trace-comparison成果物（opt-in）」パネル（556〜562行）の直後に追加。
  session状態バッジ（`#b4bSessionStatusBadge`）、reviewer名入力（`#b4bReviewerInput`）、
  「レビュー開始」（`#b4bStartReviewBtn`）、「レビューを破棄」（`#b4bDiscardReviewBtn`）。
- **comparison_id単位のレビュー操作**: 照合結果一覧タブ（`#tabDetail`）の
  `detailTableBody` に新列「レビュー」を追加し、クリックで
  `#b4bComparisonReviewPanel`（`#nodeDetailPanel` と同型の新規サイドパネル）を開く。
  1行が複数comparison_idを持ちうる理由（`comparison_id` は
  `requirement_trace_id + actual_trace_id + quantity_pair_id` から生成されるため。
  `quantity_sidecar_binding_core.js` 2752行）は前回提出時と同じ。
- **グラフタブ**: 承認ボタンは置かず、既存の `#nodeDetailPanel`（9008行）にread-onlyで
  projection結果を追記表示するのみ。

## 3. coordinatorのbinding lifecycle（新規節・最重要）

前回レビューで指摘のとおり、`startReviewSession()` は `current_binding_runtime` が
有効でない限り開始できない（`trace_comparison_review_session_core.js` 1262行
`if (!validBindingRuntime(current_binding_runtime)) return failure('review_artifact_invalid');`）。
そのため、単にcoordinatorを生成して「レビュー開始」を押すだけでは動かない。
初期化からsession開始までの経路を以下で固定する。

### 3.1 起動時の初期化経路

```
本ツール読み込み時
  ↓ (グローバル1回だけ)
coordinator = TraceComparisonReviewSessionCore.createReviewSessionCoordinator({
  quantitySidecarBinding: globalThis.QuantitySidecarBinding,
  reviewStateCore: globalThis.TraceComparisonReviewStateCore,
  recordSetValidator: globalThis.TraceComparisonRecordSetValidator
})
```

この時点では `current_binding_runtime` はまだ `null`。「レビュー開始」ボタンは
binding runtimeが有効になるまで無効（disabled）にしておく。

### 3.2 binding runtimeをready にする経路

```
既存入力が確定（sysFile/plmFile/sysQuantityFile/plmQuantityFile が全て揃っている）
  ↓
coordinator.beginBindingRefresh({ reasonCode, occurredAt:new Date().toISOString() })
  → token を受け取る（active sessionがあればここでstaleへ遷移する。3.3参照）
  ↓ (readJsonFile等、既存 loadQuantityBindings() と同じ読み込み処理を再利用)
coordinator.completeBindingRefresh({
  token,
  requirementTrace: sysData, requirementAnnotation,
  actualTrace: plmData, actualAnnotation
})
  → 成功で current_binding_runtime がセットされる
  ↓
「レビュー開始」ボタンを有効化
```

`completeBindingRefresh` の内部で `bindingApi.bindInputPair(...)` が独自に走る
（1176〜1182行）。これは既存の `loadQuantityBindings()` が `quantityBindingState` を
作る計算と入力は同じだが、**別インスタンスとして再計算**される（coordinator は
外部で計算済みのbindingを受け取る設計になっていないため）。これは二重計算になるが、
coordinator内部のbinding runtimeはレビューsessionの正本性検証専用であり、
既存の `quantityBindingState`（ダウンロードパネル等、既存機能が使う）とは役割が異なる
別々の状態として扱う。**既存の `quantityBindingState` 自体は変更しない。**

### 3.3 既存イベント → coordinator API 対応表

| 既存UIイベント / 状態変化 | 呼ぶAPI | affectsBinding | 根拠 |
|---|---|---|---|
| `sysFile`/`plmFile`（JSON A/B）の `change` | `beginBindingRefresh` → (再選択完了後) `completeBindingRefresh` | true相当（bindingそのものを作り直す） | 既存の `traceComparisonInputStale=true` 登録（1874〜1876行）と同じイベントに、新しいリスナーとしてもう一本追加登録する。既存の一行を書き換えない。 |
| `sysQuantityFile`/`plmQuantityFile`（annotation）の `change` | 同上 | 同上 | 同上。annotationは `bindInputPair` の直接入力のため。 |
| 照合（matching）の再実行完了 | `invalidateReviewSource({ affectsBinding:false, reasonCode:'matching_rerun', occurredAt })` | false | 再照合は `matching_run_id`/`matching_generation`/`matching_dataset_signature`/relationsを変えるが、`bindInputPair` の入力（JSON A/B本文・annotation）そのものは変えないため、bindingの作り直しは不要。`invalidateReviewSource` はactive sessionのみstaleへ遷移させ、binding runtimeはaffectsBinding:falseのため保持される（1234〜1237行）。 |
| Phase 7の手動トレース関係編集・置き換え（relation変更） | 同上 | false | relationsのみ変化するため、matching再実行と同じ扱い。 |
| ダウンロード前提条件チェックが失敗する状態（`activeMatchingJob` 実行中等） | 何も呼ばない | - | `captureSourceContext()` が返す `active_matching_job` 経由で、coordinator自身が `review_session_busy` を返す（1103行）。UI側で新たに判定を複製しない。 |

`invalidateReviewSource` はこの対応表のとおり「bindingは変わらないが照合結果/relationは
変わった」ケース専用に使い、JSON A/B・annotationの差し替えは必ず
`beginBindingRefresh`/`completeBindingRefresh` の対を使う。この区別は
`affectsBinding` フラグの意味（trueならbinding runtimeを破棄して作り直しを要求する。
1234〜1237行）に基づく。

### 3.4 レビュー開始

```
binding runtime ready（3.2完了）
  ↓ 「レビュー開始」クリック
coordinator.startReviewSession({
  captureSourceContext,   // 3.2/3.3と同じ状態を読む関数（後述）
  generatedAt: new Date().toISOString(),
  generator: { tool:'json_ab_trace_matching_tool_v12.1.15.html', version:'12.1.15' },
  sessionId: 新規UUID等,
  startedAt: new Date().toISOString(),
  startedBy: reviewerInput.value
})
```

`captureSourceContext` は既存の `downloadTraceComparisonRecordSet()` が使っている
前提条件チェック（`activeMatchingJob`、`traceComparisonInputStale`、`matchRunSeq`、
`traceComparisonReadyRunId`、`traceMatrixStale`、`mergedResult?.metadata?.matchStatus`、
`quantityBindingState`、`relationAccessor()`、`__currentDatasetSignature()`。1828〜1852行）
と同じ状態を読む関数として実装し、判定ロジック自体は複製しない。

## 4. projectionCacheのライフサイクル（修正）

前回提出時の設計には穴があった。`current_record_set_snapshot` は
`startReviewSession()` 成功時に初めてセットされ（1367〜1368行）、discard成功時には
`current_review_session` とともに `null` へ戻る（`commitReviewTransition`、
839〜840行）。したがって「開始前」「discard後」には**そもそも投影すべきrecord_set自体が
coordinator側に存在しない**。この状態で `projectEffectiveReviewedResultSet(null, null)`
を呼ぶのは誤りであり、Checkpoint 1コアの実装上は `review_artifact_invalid` で
即failするだけである（`recordSet` が `object` でも `Array.isArray(recordSet.comparisons)`
でもないため）。これを「投影失敗」としてエラーバナーを出すのは、実際には
「まだレビューが始まっていない／破棄された」という正常な状態を異常系として誤表示する
ことになるため、以下のとおり修正する。

### 4.1 状態モデル（4状態固定）

`recomputeAndCacheProjection()`（3節で確定した唯一の再計算関数、コーディネータの
`getReviewSession()`/`getRecordSetSnapshot()` を毎回読む。5節参照）は、
呼び出しのたびに以下のいずれかの `projectionCache.status` を確定させる。
**projection coreの呼び出しは `ready` と `stale` の場合のみ行う。**

| status | 条件 | session | snapshot | projection呼び出し | UI表示 |
|---|---|---|---|---|---|
| `unavailable` | `coordinator.getReviewSession() === null` | null | null | 呼ばない | 既存の詳細テーブル・グラフの自動表示のみ（rc2/レビュー列は「レビュー開始で表示されます」のプレースホルダ）。**開始前・discard後の両方がこの状態**であり、区別しない。 |
| `ready` | `session.session_status === 'active'` | active | あり | `projectEffectiveReviewedResultSet(snapshot, session)` | projection結果を表示。5節参照。 |
| `stale` | `session.session_status === 'stale'` | stale | あり | 同上（Checkpoint 1のprojectionは `structurallyUsableSession` が `'active'`/`'stale'` どちらも受理するため、staleでも投影は可能。ただし操作は不可） | projection結果＋「レビューが古くなっています」バナーを表示。承認・satisfaction・resetボタンは無効化。 |
| `error` | `session !== null` だが `projectEffectiveReviewedResultSet` が `ok:false` を返した場合 | - | - | 呼ぶ（結果がng） | 赤いエラーバナー＋バッジ「確認不可」。**この状態は正常運用では発生しないはずの配線異常/回帰の合図**として扱う（6節）。 |

`unavailable` を「discard済み投影」のような独自の第5状態にはしない。discard直後だけ
文言を変えたい場合（例:「破棄済み。再度レビュー開始できます」）は、`projectionCache.status`
とは別に、HTML側だけが持つ一時的な表示専用フラグ（discardボタン押下時にtrue、
`startReviewSession` 呼び出し時に必ずfalseへ戻す）で対応する。このフラグは
`projectionCache` にも `recomputeAndCacheProjection()` の判定にも入力されない
（表示文言の選択にのみ使う、read-only projectionの正本性に影響しない）。

## 5. `recomputeAndCacheProjection()`（UI独自sessionを正本にしない）

前回提出時の設計では `currentReviewSession` というHTML側モジュール変数を都度更新して
保持する案だったが、これは「coordinatorが既に公開している正式getterと別に、
UI側が第二の正本を持つ」ことになり危険なため撤回する。修正後は次のとおり、
毎回coordinatorから読み直す。

```js
function recomputeAndCacheProjection() {
  const session = coordinator.getReviewSession();       // null | active | stale
  const snapshot = coordinator.getRecordSetSnapshot();   // null | frozen record_set
  if (session === null) {
    projectionCache = Object.freeze({ status:'unavailable' });
  } else {
    const projected = TraceComparisonReviewProjectionCore
      .projectEffectiveReviewedResultSet(snapshot, session);
    projectionCache = Object.freeze({
      status: !projected.ok ? 'error'
        : session.session_status === 'stale' ? 'stale' : 'ready',
      projected
    });
  }
  renderDirty.detail = true;
  renderDirty.graph = true;
}
```

この関数は、`startReviewSession` 成功後・`coordinateReviewTransition` 成功後・
`beginBindingRefresh`/`invalidateReviewSource` 呼び出し後（active sessionが
staleへ変わりうるため）の**全ての呼び出し箇所の直後**で呼ぶ。逆に、これ以外の
場所からは `coordinator.getReviewSession()`/`getRecordSetSnapshot()` を直接
読まない（読み取り経路も1箇所に統一する）。

## 6. 各ボタンとStage 1〜3 APIの対応・stale時の操作可否

| UI操作 | 呼び出しAPI | action / 備考 | active | stale |
|---|---|---|---|---|
| レビュー開始 | `coordinator.startReviewSession(...)` | 3.4節参照 | - | - |
| quantity_extraction 承認 | `coordinateReviewTransition` | `{type:'accept_review_target', comparison_id, target:'quantity_extraction', reviewer, reviewed_at, verdict:'accept', note}` | 可 | **不可** |
| property_mapping 承認 | 同上 | `target:'property_mapping'` | 可 | 不可 |
| interval_semantics 承認 | 同上 | `target:'interval_semantics'` | 可 | 不可 |
| comparison_mode 承認 | 同上 | `target:'comparison_mode'` | 可 | 不可 |
| satisfaction: 自動判定を承認 | 同上 | `{type:'review_satisfaction', comparison_id, reviewer, reviewed_at, verdict:'accept', note}` | 可 | 不可 |
| satisfaction: override satisfied | 同上 | `verdict:'override_satisfied'` | 可 | 不可 |
| satisfaction: override unsatisfied | 同上 | `verdict:'override_unsatisfied'` | 可 | 不可 |
| reset（項目単位） | 同上 | `{type:'reset_review_target', comparison_id, target}` | 可 | 不可 |
| discard | 同上 | `{type:'discard_review_session'}`、`captureSourceContext:null, occurredAt:null` | 可 | **可** |

stale時の不可判定はUI側のボタン無効化による**事前ガードに過ぎない**。実際の拒否は
Stage 1 (`trace_comparison_review_state_core.js` 267行 `if (session.session_status
=== 'stale') return failure(session, 'review_session_stale');`) とcoordinator
（`trace_comparison_review_session_core.js` 1038行 `!isDiscard &&
current_review_session.session_status === 'stale'`）が行う。UI側の無効化を
誤って外しても二重に拒否されるため、UIのボタン制御はcoreの契約を上書きしない。

reviewer / note はAPI呼び出しを持たず、各アクション呼び出し時のペイロードに
その場の入力値を積むだけの、フォーム欄。session status / projection結果の確認は
`coordinator.getReviewSession()` / `coordinator.getRecordSetSnapshot()` /
`projectionCache` を読むだけの読み取り専用。

## 7. staleを実際のUIイベント経路から発生させる（新規節）

前回提出時は「Playwrightで `invalidateReviewSource` を直接叩いてstaleを作る」ことを
想定していたが、これでは「HTML/UI接続」の検証にならない、という指摘を反映し、
少なくとも1本のPlaywrightケースを、既存UIの実イベント経路のみで完結させる
（3.3節の対応表の実地検証を兼ねる）。

```
入力・照合・quantity binding・「レビュー開始」で active session
  ↓
（直接API呼び出しではなく）既存UI操作で照合sourceを変更する:
  例1: 照合プロファイルや設定を変更し、既存の「照合実行」ボタンを再度押して
       matchingを再実行する（3.3節「照合の再実行完了」の行に対応する
       既存イベントフックから invalidateReviewSource({affectsBinding:false}) を呼ぶ）
  例2: sysQuantityFile を別ファイルに差し替える（3.3節「annotationのchange」の
       行に対応する既存 `input.addEventListener('change', ...)` から
       beginBindingRefresh を呼ぶ）
  ↓
coordinatorのsession_statusがactive→staleへ遷移
  ↓
recomputeAndCacheProjection() が呼ばれ、projectionCache.status が 'stale' になる
  ↓
UI: session状態バッジが「レビューが古くなっています」に変わり、
    承認・satisfaction・resetボタンが無効化され、discardのみ有効なままであることを確認
```

このケースは、直接API呼び出しで作るstaleケース（境界値の単体的確認用に別途残す）とは
別に、**必ず1本**smoke testへ追加する。

## 8. 詳細テーブル・グラフが同一projectionを読む方法

- `projectionCache` は5節の `recomputeAndCacheProjection()` でのみ書き込まれる。
- 詳細テーブル側は、既存の `renderDetailTableFull` をPhase 7と同じ手法
  （`const p7BaseRenderDetail = renderDetailTableFull; renderDetailTableFull = function(){...}`、
  12513〜12524行）でさらにラップする新しい関数を追加する。ラッパーは元の関数を
  呼んだ後、行ごとのcomparison_id群から `projectionCache` を**読むだけ**でバッジを
  追加する。`projectionCache.status === 'unavailable'` の場合は何も追加しない
  （既存表示のまま）。ラッパー内部から `TraceComparisonReviewProjectionCore` を
  再度呼び出すことは禁止する。
- グラフ側も同様に、既存の `buildGraphElements`/`renderGraph` ラップ手法
  （12536〜12575行、`p7Base*` パターン）にもう一段ラッパーを追加し、
  `projectionCache` から読むだけでedgeの色・ラベルを装飾する。
- 両者が同じ `projectionCache` インスタンスを参照するため、判定ロジックの分岐や
  ズレが構造的に発生しない。将来Excel/JSON出力へ接続する場合も、この
  `projectionCache`（またはそれを生成する `recomputeAndCacheProjection()` 自体）を
  再利用することで、3箇所目の独自判定を作らずに済む（このCheckpointでは接続しない）。

## 9. 既存automatic resultを変更しない保証

不変保証の本体は個々のPlaywrightアサーションではなく、以下の構造的事実に置く。

- `coordinator.getRecordSetSnapshot()` が返すオブジェクトは
  `deepFreeze`/`recursivelyFrozen` 済み（1300行 `cloneAndFreeze(generated.record_set)`、
  1050行 `recursivelyFrozen` チェック）であり、UI側のどのコードもこのオブジェクトの
  プロパティに代入しない。
- Checkpoint 1のprojection core（`projectEffectiveComparisonResult`/
  `projectEffectiveReviewedResultSet`）は元々pure/read-only契約で、automatic判定は
  読み取りコピー（`cloneReviewOverlay`/`Object.freeze`）としてのみ扱う設計
  （Checkpoint 1で32件のテストにより確認済み、無変更のまま流用）。
- レビュー操作（承認・satisfaction・reset・discard）は全て`coordinator`内部の
  `current_review_session` にのみ影響し、`current_record_set_snapshot` の中身にも、
  ダウンロードされるrc2 JSONの中身にも影響しない（`transitionReviewState` が
  `session` だけを引数・戻り値にし、`recordSet` を一切受け取らないことからも構造的に
  保証される）。

これらを前提としたうえで、Playwrightでは補助的な確認として:

- レビュー開始直後に取得した `coordinator.getRecordSetSnapshot()` の canonical JSON
  （`bindingApi.canonicalJson` と同じ正規化、単純な `JSON.stringify` の文字列一致には
  依存しない）と、4項目承認＋satisfaction override＋reset＋discardを一通り実行した後に
  再取得した同スナップショットのcanonical JSONが完全一致することを確認する
  （discard後は `getRecordSetSnapshot()` が `null` に戻る点は4節の状態モデルどおりで、
  それ自体は不変性の破れではない。discard**前**の最終取得値と初回取得値を比較する）。
- Checkpoint 1のNode検証（projection core 32/32）およびStage 1検証（77/77）・
  Stage 2+3検証（152/152）をCheckpoint 2実装後も無変更のまま再実行し、
  全て変わらず合格することを確認する。

## 10. Checkpoint 2 テスト計画

Node側（既存3スイート、ファイル無変更なので再実行のみ）:
- projection core 32/32、Stage 1 77/77、Stage 2+3 152/152 を実装後・commit前に再実行し、
  全て変化なく合格することを確認する。

Playwright側（新規）:
1. 入力・照合・数量binding・trace-comparison生成までを既存フローで実行。
2. 3.2節の経路で `beginBindingRefresh`/`completeBindingRefresh` が実UIイベントから
   呼ばれ、「レビュー開始」ボタンが有効化されることを確認。
3. 「レビュー開始」→ `projectionCache.status === 'ready'`、session状態バッジが
   「レビュー中」になることを確認。
4. ある1つのcomparison_idについて4項目を承認→satisfactionを `accept` で承認。
   詳細テーブルの該当行バッジ、グラフの該当edge装飾が更新されることを確認。
5. 別のcomparison_idについてsatisfactionを `override_unsatisfied` で登録し、
   表示が自動判定と異なる形（override由来と分かる表示）になることを確認。
6. 9節のcanonical JSON不変アサーションを実行。
7. いずれかの承認済み項目を `reset` し、バッジが未レビュー相当に戻ることを確認。
8. **7節のend-to-end stale経路**（既存UI操作のみでactive→staleを発生させる）を実行し、
   `projectionCache.status === 'stale'`、承認・satisfaction・resetボタンが無効化され
   discardのみ有効であることを確認。
9. stale状態からdiscardを実行 → `projectionCache.status === 'unavailable'` に戻り、
   詳細テーブル・グラフが既存の自動表示のみに戻ることを確認。再度
   「レビュー開始」が可能なことを確認（3.2の経路をもう一度通す）。
10. テスト用フックで `coordinator.getRecordSetSnapshot()` 相当を意図的に不正な形へ
    差し替え、`projectionCache.status === 'error'` となり、赤いエラーバナー表示・
    バッジの「確認不可」化・数値の非表示になることを確認する（6.項目テーブルの
    「error」行がこのケースの正当な発生源であることの確認）。
11. 既存の非対象領域（Phase 7の手動トレース関係編集・置き換え、ML学習フィードバック、
    RO-Crate/Excel出力等）が、Checkpoint 2追加前と同じ挙動のままであることを
    既存smoke経路で確認する（回帰防止）。

## 11. 明示的な非対象（Checkpoint 2ではやらないこと）

- 値そのものの訂正（quantity値・property値等の書き換え）
- correct verdict / correct artifact 相当の機能
- 訂正後の下流再計算（数値比較・充足判定の再実行）
- レビューoverlayの永続化（ページリロードでsessionは消える。保存/復元は対象外）
- server保存・バックエンド送信
- 認証・アクセス制御
- 複数人での同時編集・排他制御のUI表現（coordinatorのCAS機構自体はStage 2/3の
  既存実装を使うが、複数タブ/複数ユーザーの共同編集UXの設計はしない）
- B-5に相当する範囲
- Excel/JSON出力（RO-Crate、Excel、trace-comparison JSON等）へのレビュー結果の本接続
  （`projectionCache`/`recomputeAndCacheProjection()` を将来再利用できる設計にはするが、
  実際の接続はしない）
- PDF/Excel α版への追加変更（別backlog、既存合意のとおり）
- Phase 7（`.effective-mode-select` / `human_review` / 手動トレース関係編集）への変更
- 既存 `quantityBindingState`（HTML側の独自binding計算）とcoordinator内部binding
  runtimeの二重計算の解消（3.2節で明記のとおり、これはcoordinatorの既存設計上の
  制約であり、Checkpoint 2ではこの二重計算自体を解消しない）

## 12. 実装時の補正（Checkpoint 2 実装済み版）

§0〜§11のApprove済み方針はそのままに、実装過程で3回の静的レビューを経て確定した
5件の補正を記録する。いずれも設計の大枠（コーディネータ経由・単一projectionCache・
fail-closed・graph read-only等）を変更するものではなく、実装の具体化に伴う修正である。

### 12.1 `#rerunMatchBtn`: クリックではなく「新runの実際のcommit」で判定する

§3.3の当初記述は「再照合完了(idle)」を条件としていたが、これだけでは
キャンセル・失敗した再照合でもactive sessionをstale化してしまう(false positive)。
実装では `b4bLastSyncedMatchingRunId` を追跡し、
`!traceComparisonInputStale && traceComparisonReadyRunId === matchRunSeq
&& mergedResult?.metadata?.matchStatus === 'matched' && traceComparisonReadyRunId
!== b4bLastSyncedMatchingRunId` の場合のみ `invalidateReviewSource()` を呼ぶ。
キャンセル・失敗時は `traceComparisonReadyRunId` が新しいrunに追いつかないため、
このガードで自然に除外される。

### 12.2 詳細テーブル・グラフの索引を`projectionCache`へ一本化する

当初実装は`b4bComparisonIndexByMatcherA()`/`b4bComparisonIndexByMatcherPair()`が
`coordinator.getRecordSetSnapshot()`を個別に呼んでいた。projectionと表示用索引で
異なるsource参照経路が並立すると、将来的に判定が分岐しうる。`recomputeAndCacheProjection()`
の中で`matcherAIndex`/`matcherBIndex`/`matcherPairIndex`（いずれも`comparison_id`を
`requirement_ref.matcher_id`/`actual_ref.matcher_id`で引けるMap）を構築し、
`projectionCache`へ格納するよう変更した。詳細テーブル・グラフの両rendererは
`projectionCache`だけを読み、`coordinator.getRecordSetSnapshot()`を直接呼ばない。

### 12.3 JSON B基準でも同一comparison_id projectionを表示する

当初実装はJSON B基準（`linkBasis==='plm'`）表示時に空のMapを渡し、レビュー列が
恒常的に空になる制約付き実装だったが、これは通常の照合結果一覧への接続として
望ましくない。`matcherBIndex`を追加し、JSON B基準の行が持つ`row['JSON Bキー']`
（`buildDetailRowsPlm`が保持する生の`plmUniqueKey`値、`buildTraceMatrixRows`の
`matcher_b_id`と同じ値）で引けるようにした。JSON A/B両基準で同一の
`b4bDecorateDetailTable()`が動作する。

### 12.4 グラフはread-only表示に限定する（edgeタップからmutationしない）

当初実装は`cy.on('tap','edge', handler)`でedgeタップ時に`b4bComparisonPanel`
（承認・satisfaction・resetボタンを持つ編集可能パネル）を開いていたが、これは
「グラフには承認ボタンを置かずread-only表示のみ」という元々の方針と矛盾する。
このタップハンドラを削除し、グラフはedgeの色装飾（`b4bReviewColor`データ）のみの
read-only表示とした。個別comparisonの承認・satisfaction・reset操作は照合結果一覧
（詳細テーブル）の「詳細」ボタンからのみ行える。

### 12.5 Phase 7 source invalidation hookの実関数名・no-op検出

§3.3の当初記述は「Phase 7の手動relation追加・付け替え・削除」をまとめて
`invalidateReviewSource({affectsBinding:false})`に接続するとしていたが、実装・レビューを
通じて2つの誤りが判明した。

1. 削除ボタンの実際のUI経路は `window.removeManualTraceRelation`（削除ボタンの
   `onclick`先）であり、`deleteManualTraceRelation` という名の関数はコードベースに
   存在しない（Phase 7自身の既存ラップ処理も同じ誤った名前を使っており、これは
   Checkpoint 2の対象外の既存の別問題として温存する）。
2. `removeManualTraceRelation`/`deleteOrphanTraceEntry` は内部で`confirm()`を呼び、
   ユーザーがキャンセルすると何も変更せず`return`する。「関数が呼ばれた」だけを
   条件に無条件で`invalidateReviewSource()`すると、キャンセル時にsourceが実際には
   変化していないのにactive sessionをstale化してしまう(no-op false positive)。

実装では、呼び出し前後で`window.getManualTraceState()`
（`manualRelations`/`replacements`/`orphans`/`audit`を含む、既存の公開読み取りAPI）と
共有トップレベル変数`traceReviewStore`のcanonical JSON署名を比較し、実際に変化した
場合のみ`invalidateReviewSource()`を呼ぶ`b4bPhase7SourceSignature()`を追加した
（`manualTraceRelations`/`traceReplacementHistory`はPhase 7スクリプトのIIFEに閉じた
private変数でありここから直接参照できないため、既存の公開APIを経由する）。

3回目のレビューで、監視対象がまだ不完全であることが判明した。`importTraceReviewPackage`
（レビューJSON読込。`traceReviewStore`/`manualTraceRelations`/`traceReplacementHistory`を
直接書き換え、その後有効トレースを再構築する）と`applyBulkTraceReview`/
`undoBulkTraceReview`（一括レビュー適用・取り消し。`traceReviewStore`を書き換え、
同じく有効トレースを再構築する）も、B-4bが参照するrelation sourceを変更しうる
正式なUI経由の経路であるにもかかわらず監視対象に含まれていなかった。

最終的な監視対象は次の8関数とし、個別に同じラップコードを重複させず
`b4bWrapPhase7SourceMutation(name)` という1つの共通ヘルパーへ集約した
（引数は監視対象の関数名のみ。before/after署名比較のロジックは1箇所にある
`b4bPhase7SourceSignature()`を再利用する）。

```
updateTraceReview
addManualTraceRelationFromValues
replaceTraceRelationFromValues
removeManualTraceRelation
deleteOrphanTraceEntry
importTraceReviewPackage
applyBulkTraceReview
undoBulkTraceReview
```

`applyBulkTraceReview`/`undoBulkTraceReview`も同様に`confirm()`によるユーザーキャンセルで
no-opになりうるため（前述のno-op検出の仕組みがそのまま適用される）、確認キャンセル時は
active sessionをstale化しない。
