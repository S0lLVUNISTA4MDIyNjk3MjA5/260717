# B-4 Stage 0 レビュー状態遷移設計

## 1. 目的と前提

本書は、B-4「人間レビュー状態遷移」の実装前契約を固定する。最初の実装単位であるB-4aは、browser validatorで検証済みの`trace-comparison/1.0-rc2` record setを不変スナップショットとして保持し、そのスナップショット専用のレビュー状態をブラウザのメモリ上にだけ持つ。

現行rc2の`comparisons[].review`はB-3生成時点の初期状態だけを表す。`quantity_extraction`、`property_mapping`、`interval_semantics`、`comparison_mode`は`unreviewed`、`satisfaction`は`not_eligible`固定である。人間確認後の状態をrc2へ書き戻してはならない。旧rc1設計の`condition_equivalence`および`comparison === null`を前提にしたモデルは使用しない。

本書は設計だけを定める。HTML、JavaScript、Schema、validator、producer、fixture、テストは変更しない。

## 2. B-4a／B-4b／B-5の境界

| 段階 | 対象 | 本書での扱い |
|---|---|---|
| B-4a | 検証済みrc2 record setの不変スナップショットに対する、セッション内の承認・最終判断・reset・破棄 | 本書で完全に設計する最初の実装単位 |
| B-4b | 人間による数量、property、interval semantics、comparison modeの訂正と、訂正後の下流再計算 | 境界と安全原則だけを定め、未着手とする |
| B-5 | review overlay、監査イベント、複数レビュアー情報の保存・再読込・外部artifact化 | 引き渡し事項だけを定め、未着手とする |

B-4aは自動結果の承認を扱い、上流値の訂正を扱わない。B-4aのoverlayはページ再読込で消える。B-4bとB-5はそれぞれ独立した設計レビューを経るまで実装しない。

### B-4a Stage 1実装記録

B-4a Stage 1では、`tools/trace_comparison_review_state_core.js`に、初期runtime overlay生成、純粋transition reducer、純粋invalidation reducer、satisfaction eligibility・human satisfaction・all reviewedの3導出関数を実装した。Nodeとbrowserで同一の凍結済みAPIオブジェクトを公開し、`tools/design_notes/trace_comparison_review_state_core_verification.js`を恒久Node検査とした。

Stage 1は同期的な純粋state coreだけを実装する。`startReviewSession`、validator/digest接続、binding lifecycle、live source marker計算、transition coordinator、commit CAS、source invalidation CAS、UI、既存出力接続、B-4b、B-5は未実装である。Stage 0で定めた上位coordinator責務をcoreへ移していない。

## 3. rc2 record_set不変方針

レビュー開始時に生成・検証した`record_set`は、セッションの基準となる不変スナップショットである。実装時はproducerの戻り値からdeep cloneした直後、validatorへ渡すより前に再帰freezeし、以後はその同一参照だけをvalidator入力、record set digest対象、session保持snapshotに使う。すべてのtransitionの前後でrecord set digestが同一であることも保証する。ただし安全性の根拠はfreezeだけでなく、reducerがrecord setを更新対象として受け取らないAPI境界とdigest照合に置く。

B-4aでは次を禁止する。

- `comparisons[].review`の直接書換え
- rc2 Schemaの状態enum拡張
- `automatic_judgement`または`numeric_comparison`の上書き
- review overlayを既存trace-comparison JSON downloadへ混入すること
- review overlayを既存ExcelまたはRO-Crate出力へ混入すること

レビューUIを一度も操作しない場合だけでなく、セッション開始・承認・reset・破棄を行った場合も、既存照合、表示、Excel、JSON、RO-Crateの内容と処理経路は変化してはならない。

## 4. review sessionとartifact identity

### 4.1 明示的な開始手順

review sessionはページ読込、入力読込、sidecar読込、照合開始、照合完了のいずれでも自動生成しない。ユーザーの`start_review_session`操作時だけ開始する。非同期digest計算を含むため、単一の同期処理であるという意味の「原子的」ではなく、開始tokenで保護したprepare/commit transactionとして次の順序を実行する。

1. global review sessionが`null`であることを最初に検査する。active/staleを問わず既存sessionがあれば、開始tokenを発行せず`review_transition_not_allowed`で拒否し、明示的な`discard_review_session`を要求する。
2. `review_source_epoch`を読み、開始ごとに一意な`review_start_token`を発行する。現在のmatching run ID/generation、bindingオブジェクト参照、`binding_generation`、`binding_snapshot_digest`、`binding_identity`、requirement/actual dataset signature、matching dataset signature、relation snapshotを開始contextへ値として捕捉する。
3. `activeMatchingJob`が存在しないこと、入力と照合結果がstaleでないこと、bindingがreadyであることを検査する。
4. 捕捉済みbinding、relation snapshot、照合世代からproducerを1回だけ実行する。
5. producerが`ready:true`、`result_complete:true`で、`record_set`を返したことを検査する。
6. 返されたrecord setを`structuredClone()`し、そのcloneを直ちに`deepFreeze()`してexact frozen snapshotを作る。最初の非同期digestより前かつvalidatorより前にfreezeを完了し、browser validatorへその同じfrozen参照を渡して、例外なく`valid:true`となることを確認する。独立した`validationResult`を呼出し元から受け取って信用しない。
7. 同じexact frozen snapshot参照から`record_set_digest`と`snapshot_identity`を計算する。validator入力、digest対象、session保持snapshotはすべてこの同一参照でなければならない。
8. 全comparisonの初期review overlayを`session_revision:0`で非公開に生成する。
9. session公開直前に、global sessionが引き続き`null`、`activeMatchingJob === null`、開始tokenが現行開始tokenと一致、`review_source_epoch`、matching run ID/generation、bindingオブジェクト参照、`binding_generation`、`binding_snapshot_digest`、`binding_identity`、3 dataset signature、relation snapshot digestが開始contextと一致することをlive stateから再取得・再確認する。
10. すべて一致した場合だけactive sessionを一度だけ公開する。1つでも変化していれば候補sessionを破棄し、変化がsource世代なら`review_session_stale`、digest/identity矛盾なら`review_artifact_identity_mismatch`、既存sessionとの競合なら`review_transition_not_allowed`で停止する。

途中で失敗した場合は新sessionを公開せず、既存sessionも変更しない。次のいずれかではfail closedとする。

- `activeMatchingJob`実行中
- 入力、binding、relation、または照合結果がstale
- bindingが欠落またはnot ready
- producerが欠落、not ready、incomplete、例外、またはrecord set欠落
- browser validatorが例外または`valid:false`
- artifact identityの構成要素が欠落、不正、または一意に確定不能
- 非同期開始処理中に開始token、epoch、matching、binding、dataset、relationのいずれかが変化
- activeまたはstaleの既存sessionが残っている

### 4.2 binding identity

現行`bindInputPair()`の戻り値にidentityフィールドは存在しないため、「既存のbinding identity」を参照してはならない。B-4a実装ではbindingオブジェクトを変更せず、binding lifecycle coordinatorが次のruntime metadataを別に管理する。

```text
binding_generation:
  binding開始、解除、入力/sidecar再読込の処理開始ごとに同期的に1増加する、
  1以上の単調増加safe integer

exact_frozen_binding_snapshot:
  bindInputPair()が返したdeepFreeze済みの戻り値全体
  （schema_version、ready、requirement/actualのsource record、annotation、
   property候補の導出元、interval semantics候補、ruleset_version、diagnostics等を含む）

binding_snapshot_digest =
  "SHA-256:" +
  rawSha256Utf8(canonicalJson(exact_frozen_binding_snapshot))

binding_identity =
  "b4-binding-v1:" +
  v12HashParts(
    "b4-review-binding-identity-v1",
    [
      String(binding_generation),
      binding_snapshot_digest
    ]
  )
```

binding開始・解除・再読込handlerは、元データへ触れる前に`review_source_epoch`と`binding_generation`を増加し、active review sessionをstale化し、現在のbinding runtime metadataを利用不能にする。`bindInputPair()`が完了したら、結果がdeepFreeze済みで`ready:true`であることを確認し、そのexact object参照からdigest/identityを計算する。計算完了後、公開直前にgenerationと入力参照を再照合し、開始時のgenerationがまだ現行の場合だけ、`{binding_ref, binding_generation, binding_snapshot_digest, binding_identity}`を一括公開する。generationが安全な整数範囲を超える場合はwrap/resetせず、ページ再読込まで新bindingとreview開始をfail closedする。

dataset signatureは元traceを表し、sidecar内容の同一性を表さない。同じrequirement/actual dataset signatureでも、property候補、interval semantics候補、ruleset、annotation、またはbinding結果の他要素が異なれば、exact frozen binding snapshotのraw digestと`binding_identity`は必ず異ならなければならない。review開始時にはbindingオブジェクト参照、generation、digest、identityを捕捉し、session公開直前と全transition commit直前に4項目を再確認する。

### 4.3 live source markerとsnapshot identity

`snapshot_identity`は生成済みの不変record setそのものを識別し、session中は変化しない。`live_source_marker`は現在の入力、binding、relation、照合世代を識別し、transition前に現在値と比較する。`generated_at`等のvolatileなproducer出力はlive markerへ含めない。transitionごとにproducerを再実行してはならない。

オブジェクトのdigestは、既存`hashParts()`の正規化を通してはならない。`canonicalJson(value)`が返す文字列のUTF-8バイト列へ、coreで共有する`sha256()`を直接適用する`rawSha256Utf8()`を唯一の実装として使用する。将来のB-4a実装では現行core内の`sha256()`をexportしてNode/browserで共用するか、同等の単一共有ヘルパーへ移す。Node用とbrowser用の別実装は禁止する。`v12HashParts()`は境界付きスカラー要素から最終marker/identityを作る用途に限定する。

canonical byte列の唯一の正本は、現行coreの`canonicalJson(value)`関数が実際に返す文字列とする。全object keyが中間の`Object.keys(value).sort()`順で最終直列化される、とは別途定義しない。現行関数は中間objectを構築した後に`JSON.stringify()`するため、integer-index形式のpropertyはECMAScriptの列挙規則に従って再配置されうる。独自serializerでこの挙動を再実装せず、Node/browserとも同じcore関数を呼ぶ。配列順は現行関数の実効出力どおり保持し、JSON非対応値は拒否する。relation snapshotは入力順に依存させないため、各relation itemを、その`canonicalJson()`実効出力文字列を比較キーとして現行の既定`sort()`で並べ、並べたitemオブジェクト配列を同じ`canonicalJson()`へ渡す。

integer-index形式キーを含む固定ベクトルは次とし、Node/browser双方で文字列とraw SHA-256をbyte単位で固定する。

```text
input:  {"10":"a","2":"b"}
output: {"2":"b","10":"a"}
UTF-8 raw SHA-256:
  b6e3a5de6007a9d717e70a63d7a5925fbad17a4c8b911a64354b0adf21956d06
```

```text
relation_item = {
  requirement_trace_id,
  actual_trace_id,
  matcher_a_id,
  matcher_b_id,
  relationship: {
    source,
    match_method,
    match_confidence,
    review_category,
    linked_at
  }
}

relation_snapshot_digest =
  "SHA-256:" + rawSha256Utf8(
    canonicalJson(sorted_relation_items)
  )

sorted_relation_items =
  relations.map(to_relation_item).sort(
    (a, b) => defaultSortCompare(canonicalJson(a), canonicalJson(b))
  )

record_set_digest =
  "SHA-256:" + rawSha256Utf8(canonicalJson(exact_record_set_snapshot))

live_source_marker_value =
  "b4-live-source-v1:" + v12HashParts(
    "b4-review-live-source-marker-v1",
    [
      requirement_dataset_signature,
      actual_dataset_signature,
      matching_dataset_signature,
      String(matching_generation),
      binding_identity,
      relation_snapshot_digest,
      String(review_source_epoch)
    ]
  )

snapshot_identity_value =
  "b4-snapshot-v1:" + v12HashParts(
    "b4-review-snapshot-identity-v1",
    [
      live_source_marker_value,
      exact_record_set_snapshot.schema_version,
      record_set_digest
    ]
  )
```

`matching_generation`は、正常完了した現在の照合にだけ割り当てられた単調増加の世代値であり、B-3dの利用可能世代と同じ実行を指す。0、非整数、実行中または過去世代は拒否する。`record_set.display_context`が`null`、または`matching_dataset_signature`が空ならidentityを確定できないため開始を拒否する。

`review_source_epoch`は0以上の安全な整数で、レビューsourceに影響するイベントの処理開始時に単調増加させる。`binding_identity`は4.2節の導出値とし、generation、digest、identityの空値や不整合を拒否する。この二層identityにより、`comparison_id`が同じでもsnapshotまたはlive sourceが異なればoverlayを再利用できない。sessionは両方を保持する。transition前は現在のsource要素からlive markerだけを再計算して照合し、record setのproducer再実行や新しい`generated_at`の生成は行わない。record set digestは保持snapshotの不変性検査にだけ使用する。

### 4.4 stale化

次のイベントを受けた時点で、元データを変更する処理より先に`review_source_epoch`を増加し、内部action `invalidate_review_session`をreducerへ渡してactive sessionを`stale`にする。以後は破棄以外の全transitionを拒否する。

- JSON AまたはJSON Bの入力ファイル変更
- requirementまたはactual sidecarの変更・再読込
- binding再読込、ready解除、またはbinding identity変更
- 再照合開始（成功前からstaleとする）
- relationの追加、削除、付替え、またはrelationship metadata変更
- 現在世代、binding identity、いずれかのdataset signature、relation snapshot digest、live source markerの不一致

`invalidate_review_session`はUI向け公開操作ではなく、入力変更、binding再読込、再照合開始、relation変更の制御経路だけが呼ぶ。`active → stale`だけを許可し、`stale → stale`は冪等、review targetは変更しない。`reasonCode`、`observedSourceEpoch`、`occurredAt`はruntime session metadataだけに保持し、B-5まで永続化しない。stale化はoverlay内容を自動変換しない。古いoverlayを新artifactへ自動移植、comparison ID一致だけで再接続、または部分的に継承してはならない。新artifactのレビューには新しい明示的なsession開始が必要である。

## 5. review overlayのデータ構造

overlayはrc2 artifactの外側にあるruntime専用オブジェクトである。保存フィールドは現在状態だけとし、`all_reviewed`や`confirmed`などの集約値は持たない。

```json
{
  "overlay_version": "b4-review-overlay/1.0-runtime",
  "session_id": "review-session:9b87a03e-0b2e-4c5f-b860-314fba1d87ab",
  "session_status": "active",
  "session_revision": 5,
  "started_at": "2026-07-23T03:04:05.678Z",
  "started_by": "reviewer@example",
  "stale_runtime": null,
  "live_source_marker": {
    "value": "b4-live-source-v1:1d4f1c8b5ce9b3b16aabdc40eaf9a64c8c1114551bc6d1b550c9ad51f06acd20",
    "review_source_epoch": 17,
    "matching_run_id": 42,
    "matching_generation": 42,
    "binding_generation": 9,
    "binding_snapshot_digest": "SHA-256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "binding_identity": "b4-binding-v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "requirement_dataset_signature": "QA-SHA256:1111111111111111111111111111111111111111111111111111111111111111",
    "actual_dataset_signature": "QA-SHA256:2222222222222222222222222222222222222222222222222222222222222222",
    "matching_dataset_signature": "matching-signature-example",
    "relation_snapshot_digest": "SHA-256:3333333333333333333333333333333333333333333333333333333333333333"
  },
  "snapshot_identity": {
    "value": "b4-snapshot-v1:4d4f1c8b5ce9b3b16aabdc40eaf9a64c8c1114551bc6d1b550c9ad51f06acd20",
    "schema_version": "trace-comparison/1.0-rc2",
    "record_set_digest": "SHA-256:4444444444444444444444444444444444444444444444444444444444444444"
  },
  "comparisons": {
    "cmp-v1:example": {
      "quantity_extraction": {
        "status": "reviewed",
        "reviewer": "reviewer@example",
        "reviewed_at": "2026-07-23T03:05:00.000Z",
        "verdict": "accept",
        "note": "抽出値と単位を確認"
      },
      "property_mapping": {
        "status": "reviewed",
        "reviewer": "reviewer@example",
        "reviewed_at": "2026-07-23T03:05:10.000Z",
        "verdict": "accept",
        "note": null
      },
      "interval_semantics": {
        "status": "reviewed",
        "reviewer": "reviewer@example",
        "reviewed_at": "2026-07-23T03:05:20.000Z",
        "verdict": "accept",
        "note": null
      },
      "comparison_mode": {
        "status": "reviewed",
        "reviewer": "reviewer@example",
        "reviewed_at": "2026-07-23T03:05:30.000Z",
        "verdict": "accept",
        "note": null
      },
      "satisfaction": {
        "status": "reviewed",
        "reviewer": "reviewer@example",
        "reviewed_at": "2026-07-23T03:06:00.000Z",
        "verdict": "override_unsatisfied",
        "note": "運用条件を考慮し不充足と判断"
      }
    }
  }
}
```

この例はruntime overlay単体であり、rc2 record setのプロパティでも、rc2 artifactを包む新envelopeでもない。exact record set snapshot自体はsessionの非直列化runtime参照として別に保持する。`session_id`は同一ページ内で衝突しないランダム識別子とするが、artifact同一性の根拠には使わない。`session_revision`はsession生成時の0から、承認、override、reset、active→staleの各成功commitごとに1増加する単調増加safe integerであり、transitionのCASに使う。`started_by`は非空文字列とする。stale時だけ`stale_runtime`へ`{reason_code, observed_source_epoch, occurred_at}`を保持する。B-4aはこのオブジェクトをメモリ以外へ直列化しない。

## 6. 5対象の状態定義

共通target値は`{status, reviewer, reviewed_at, verdict, note}`とする。未レビュー状態では後4項目をすべて`null`にし、レビュー済み状態では`reviewer`をtrim後の非空文字列、`reviewed_at`を実在するcanonical UTC timestamp（`YYYY-MM-DDTHH:mm:ss.sssZ`）、`note`を`null`または文字列とする。

| 対象 | 初期状態 | 許可するレビュー済み状態 |
|---|---|---|
| `quantity_extraction` | `unreviewed` | `reviewed`, verdict=`accept` |
| `property_mapping` | `unreviewed` | `reviewed`, verdict=`accept` |
| `interval_semantics` | `unreviewed` | `reviewed`, verdict=`accept` |
| `comparison_mode` | `unreviewed` | `reviewed`, verdict=`accept` |
| `satisfaction` | `not_eligible` | 上流4対象reviewed後に`unreviewed`、人間判断後は`reviewed`かつverdict=`accept`、`override_satisfied`、`override_unsatisfied`のいずれか |

B-4aに`correct` verdictは存在しない。上流4対象の`accept`は、スナップショット内の自動結果をそのまま承認したことだけを意味する。

## 7. actionと状態遷移表

公開actionは判別可能な共用体とし、未知の追加プロパティも拒否する。`accept_review_target`と`review_satisfaction`の`reviewed_at`はUIではなくaction生成境界で現在時刻から作って渡し、reducerは形式と実在性を検証する。テストでは固定時刻を注入できる。

実装時の最小API境界を次で固定する。関数名を変更する場合も、責務と入力方向は分離したままにする。

```javascript
startReviewSession({
  captureSourceContext,
  produceRecordSet,
  validateRecordSet,
  rawSha256Utf8,
  sessionId,
  startedAt,
  startedBy,
  reviewStartToken
})

createReviewSession({
  exactFrozenSnapshot,
  validateRecordSet,
  capturedSourceContext,
  rawSha256Utf8,
  sessionId,
  startedAt,
  startedBy
})

coordinateReviewTransition({ action, captureLiveSourceContext, rawSha256Utf8 })
commitReviewTransition(capturedTransition, nextSession)

transitionReviewState(session, action)
invalidateReviewSession(session, { reasonCode, observedSourceEpoch, occurredAt })

deriveSatisfactionEligibility(session, comparisonId)
deriveHumanSatisfaction(session, comparisonId, immutableRecordSet)
deriveAllReviewed(session, comparisonId)
```

`startReviewSession()`は非同期のapplication coordinatorで、4.1節のcapture、producer、freeze、exact snapshot検証、digest、公開直前再照合を統括する。`createReviewSession()`は候補sessionを作る純粋部分であり、呼出し元提供の独立した`validationResult`は受け取らず、注入されたvalidatorで`exactFrozenSnapshot`そのものを内部検証する。validatorへ渡した参照、digest対象、session保持参照が同一でなくても、snapshotの全object/arrayが再帰freeze済みでなくても拒否する。

`transitionReviewState()`と`invalidateReviewSession()`はsessionと入力を変更せず、結果を必ず次の3分類で返す純粋関数とする。

```javascript
{ ok: true,  changed: true,  session: newSession,      diagnostics: [] }
{ ok: true,  changed: false, session: originalSession, diagnostics: [] }
{ ok: false, changed: false, session: originalSession, diagnostics: [...] }
```

`changed:true`は実際の状態変更だけを表し、sessionを保持するtransitionでは`newSession !== originalSession`かつ`newSession.session_revision === originalSession.session_revision + 1`を必須とする。明示的discardだけは7.1節のsession削除CASを適用する例外である。`changed:false`は成功no-opで、入力と同じsession参照を返し、revision、target、metadataを一切変更しない。`ok:false`も入力と同じsession参照を返して部分更新しない。冗長な上流target resetと`stale → stale` invalidationは成功no-opに固定する。時刻、乱数、DOM、global state、download、storageへ関数内部からアクセスしない。3つの`derive*`関数も副作用を持たず、保存されているtarget状態と読取り専用snapshotだけから都度導出する。UIイベントハンドラと外部変更handlerはこれらの戻り値を受け取るだけで、target状態やsession statusを直接書き換えない。

### 7.1 transition coordinatorとcommit CAS

承認、satisfaction判断、reset、discardは`coordinateReviewTransition()`がprepare/commitを統括する。承認、satisfaction判断、resetでは非同期live marker digestをreducerから分離してcoordinatorで計算する。discardはactive/staleのどちらにも許すためlive marker一致を要求せず、session自体のCASだけを行う。coordinatorは通常transitionを同時に1件だけ許可する。別の通常transitionが進行中なら`review_session_busy`で拒否する。ただしsource変更による`invalidate_review_session`は通常transitionを待たず、現行tokenを失効させてstaleを先にcommitできる。

通常transitionのprepare時に、次を値または参照として捕捉し、一意な単調増加`transition_token`を現行tokenとして発行する。tokenはcoordinatorだけが保持するin-flight metadataであり、overlayやB-5 artifactへ保存しない。

```text
captured_session_ref
session_id
session_revision
session_status
review_source_epoch
binding_ref
binding_generation
binding_snapshot_digest
binding_identity
transition_token
```

coordinatorは、discard以外ではrelation item等のlive source値を同期的にclone/freezeしてcaptureし、そのcaptured contextからrelation snapshot digestとlive markerを非同期計算する。可変なlive配列をdigest中に参照し続けてはならない。sessionに保持されたmarkerとの一致を確認してから純粋reducerを呼ぶ。reducer成功後、`commitReviewTransition()`が同一JavaScript turn内の同期的なcompare-and-swapとして、次を再確認する。確認とglobal session代入の間に`await`、Promise callback、timer、DOM event dispatchを挟んではならない。

```text
global session参照 === captured_session_ref
global session.session_id === captured session_id
global session.session_revision === captured session_revision
非discard時はglobal review_source_epoch === captured review_source_epoch
current transition token === captured transition_token
global session.session_status === captured session_status
非discard時はcaptured/global session.session_status === "active"
非discard時はcurrent binding参照 === captured binding_ref
非discard時はcurrent binding_generation === captured binding_generation
非discard時はcurrent binding_snapshot_digest === captured binding_snapshot_digest
非discard時はcurrent binding_identity === captured binding_identity
非discard時は再計算したlive marker === session保持live marker
非discardかつreducerResult.changed === trueの場合だけ、nextSession.session_revision === captured session_revision + 1
reducerResult.changed === falseの場合は、nextSession === captured_session_refかつrevision/target/metadata不変
```

reducerが`changed:false`を返した場合、coordinatorはrevision `+1`条件を適用せず、globalへ代入しない。同じsession参照を「commitする」処理も行わず、成功no-op結果をそのまま返す。`changed:true`だけが上記CASを通過した後にnext session（discardでは`null`）をglobalへ一括代入する。

不一致理由は次の2経路へ分離する。現在世代、epoch、binding、dataset signature、relation snapshot digest、live markerのいずれかがsession保持値と異なるsource identity不一致を検出した場合、通常transitionの候補結果を破棄し、現行tokenを失効させ、同一JavaScript turn内で専用`commitSourceInvalidation()`を実行する。この経路は現在のglobal sessionを改めて捕捉し、activeなら`invalidateReviewSession()`の`changed:true`候補を作り、session参照、ID、revision、active statusを同期CASしてstaleへ代入する。すでにstaleなら`changed:false`として最初のstale理由とrevisionを維持する。source不一致を検出した操作は、stale commit後（または既存stale確認後）に`review_session_stale`を返す。active sessionを変更せずに同じ拒否を繰り返す経路は禁止する。

一方、source identityがsession保持値と一致したままsession参照、revision、またはtransition tokenだけが変化した通常transition同士の競合では、reducer結果をglobalへ代入せず、現行sessionを変更せず`review_session_busy`（または明示的な再試行要求）を返す。競合確認時にsessionがstaleなら`review_session_stale`を返す。source staleをbusyへ、通常競合をsource staleへ混同しない。discardも捕捉したsession参照、ID、revision、status、tokenをCAS条件に使うが、source epoch、binding、live markerは条件にせず、破棄後にsession revisionを保存しない。完了処理は、捕捉tokenがまだ現行の場合だけtokenを解放し、後発transition/invalidationのtokenを消去しない。

source変更handlerは、(1)`review_source_epoch`と必要なら`binding_generation`を増加、(2)進行中の`transition_token`を失効、(3)現在のglobal session参照とrevisionを捕捉、(4)`invalidateReviewSession()`でactive→stale候補を作成、(5)参照・session ID・revision・epochを同期CASしてstale sessionをcommit、(6)元データを変更、の順で処理する。active→staleの`changed:true` invalidation commitだけが`session_revision`を1増加させる。これにより、digest待機中の古い承認が後から完了しても、session参照、revision、epoch、tokenの少なくとも1つが一致せず、stale sessionをactive reviewed sessionとして復活させられない。stale→staleは`changed:false`で元session参照、最初のstale理由、revision、targetをすべて維持し、globalへ再代入しない。

次の状態遷移表で許可とされる承認、satisfaction判断、reset、discardも、reducer結果だけではcommit済みにならない。すべて7.1節のaction別CASを通過した場合だけglobalへ公開する。`invalidate_review_session`は同節の優先invalidation CASを通す。

| 対象 | 現在状態 | action | 前提条件 | 次状態 | 副作用 | 拒否時diagnostic |
|---|---|---|---|---|---|---|
| sessionなし | なし | `start_review_session` | 4.1節の全preflight、exact snapshotのvalidator `valid:true`、公開直前再照合、両identity確定 | active session、上流4対象=`unreviewed`、satisfaction=`not_eligible` | 不変snapshotと専用overlayをcommit時に一括公開 | busyなら`review_session_busy`、source変化なら`review_session_stale`、artifact不正なら`review_artifact_invalid`、identity不能なら`review_artifact_identity_mismatch` |
| active session | `active` | `start_review_session` | なし。既存sessionを暗黙置換しない | 変更なし | なし。明示的discardを要求 | `review_transition_not_allowed` |
| stale session | `stale` | `start_review_session` | なし。stale overlayを暗黙破棄しない | 変更なし | なし。明示的discardを要求 | `review_transition_not_allowed` |
| 上流4対象 | `unreviewed` | `accept_review_target` | activeかつnot stale、既知comparison、既知上流target、verdict=`accept`、reviewer/timestamp妥当 | `reviewed` | 対象だけにreviewer/timestamp/verdict/noteを設定。これで上流4対象が揃えばsatisfactionを`unreviewed`へ導出更新 | 条件別に`review_session_not_started`、`review_session_stale`、`review_target_unknown`、`review_verdict_invalid`、`reviewer_required`、`reviewed_at_invalid`、`review_transition_not_allowed` |
| 上流4対象 | `reviewed` | `accept_review_target` | なし。二重承認は暗黙の上書きにしない | 変更なし | なし | `review_transition_not_allowed` |
| satisfaction | `not_eligible` | `review_satisfaction` | 上流4対象reviewedではないため常に不可 | 変更なし | なし | `review_satisfaction_not_eligible` |
| satisfaction | `unreviewed` | `review_satisfaction` | activeかつnot stale、上流4対象reviewed、verdictが許可3値、reviewer/timestamp妥当 | `reviewed` | human satisfactionの派生元となるverdict等をsatisfaction targetだけに設定 | 条件別に`review_session_stale`、`review_satisfaction_not_eligible`、`review_verdict_invalid`、`reviewer_required`、`reviewed_at_invalid` |
| satisfaction | `reviewed` | `review_satisfaction` | なし。別verdictへの暗黙上書きは不可 | 変更なし | なし | `review_transition_not_allowed` |
| 上流4対象 | `unreviewed` | `reset_review_target` | activeかつnot stale、既知comparison/target | `unreviewed` | 成功no-op。`changed:false`、同一session参照、revision/target/metadata不変、global代入なし | session/target不正時は対応コード |
| 上流4対象 | `reviewed` | `reset_review_target` | activeかつnot stale、既知comparison/target | `unreviewed` | 対象の4メタ値をnull化し、satisfactionを`not_eligible`へ戻して4メタ値もnull化 | session/target不正時は対応コード |
| satisfaction | `unreviewed`または`reviewed` | `reset_review_target` | activeかつnot stale、既知comparison | 上流4対象reviewedなら`unreviewed`、それ以外は`not_eligible` | satisfactionの4メタ値をnull化 | session/target不正時は対応コード |
| active session | `active` | `invalidate_review_session` | reason/epoch/timestampが妥当 | `stale` | targetを変更せず`stale_runtime`だけを設定 | 不正入力なら`review_transition_not_allowed`または`reviewed_at_invalid` |
| stale session | `stale` | `invalidate_review_session` | sessionが存在 | `stale` | 成功no-op。`changed:false`、同一session参照、revision/target/最初のstale理由不変、global代入なし | sessionなしなら`review_session_not_started` |
| active session | `active` | `discard_review_session` | sessionが存在 | sessionなし | snapshot参照とoverlayをメモリから破棄。出力・入力・照合状態は変更しない | sessionなしなら`review_session_not_started` |
| stale session | `stale` | transition全般（破棄を除く） | なし | 変更なし | なし | `review_session_stale` |

`discard_review_session`だけはstale sessionにも許可する。未知actionは常に`review_action_unknown`で拒否する。全actionは、入力sessionを変更せず、7節の`ok/changed`三分類を返す純粋reducerへ渡す。成功no-opと失敗はいずれも元session参照を返し、部分更新しない。

## 8. satisfaction依存関係

`deriveSatisfactionEligibility(session, comparisonId)`は、対象comparisonの上流4targetがすべて`status:"reviewed"`かつ`verdict:"accept"`である場合だけ`true`を返す。上流操作後はこの導出値とsatisfaction状態を同じreducer transaction内で同期する。

```text
上流4対象のいずれかが未reviewed
  satisfaction = not_eligible, metadata = all null

上流4対象がすべてreviewed
  satisfactionがnot_eligibleなら unreviewedへ自動遷移
  satisfactionがunreviewed/reviewedならその状態を維持
```

`deriveHumanSatisfaction(session, comparisonId)`は次を返す。

| satisfaction状態/verdict | 派生値 |
|---|---|
| `reviewed` / `accept` | immutable record setの`automatic_judgement.satisfied` |
| `reviewed` / `override_satisfied` | `true` |
| `reviewed` / `override_unsatisfied` | `false` |
| その他 | `null` |

この派生値はoverlayへ保存しない。`automatic_judgement`の`state`、`satisfied`、`judgement_source`、`human_confirmed`を変更しない。`deriveHumanSatisfaction()`は構造的に有効なactive／stale sessionの両方で、保存済みsatisfaction targetと読取り専用snapshotから同じ値を派生する。stale化は操作を禁止するが、保存済みレビュー結果の読取り派生を無効化しない。`deriveAllReviewed(session, comparisonId)`も構造的に有効なactive／stale sessionの両方で、5対象すべてが`reviewed`なら`true`を返し、保存フィールドにはしない。`deriveSatisfactionEligibility()`だけは操作可否を表すため、stale sessionでは`false`とする。

## 9. reset・stale・破棄

上流4対象のresetは、対象を`unreviewed`へ戻し、その`reviewer`、`reviewed_at`、`verdict`、`note`をnull化する。同じ原子操作内でsatisfactionを`not_eligible`へ戻し、その4メタ値もnull化する。これにより、過去のsatisfaction verdictが上流承認解除後に残ることを構造的に防ぐ。

satisfactionだけのresetでは、上流4対象がすべてreviewedなら`unreviewed`、そうでなければ`not_eligible`とし、4メタ値をnull化する。resetは明示操作だけで行い、履歴や監査イベントは残さない。

stale化は`invalidateReviewSession()`だけがsessionを読取専用表示へ移す状態変更であり、自動破棄ではない。入力変更、binding再読込、再照合開始、relation変更の各handlerは、7.1節のとおりepoch増加、transition token失効、session無効化CASを元データ変更より先に完了しなければならない。通常transitionがdigest待機中でもinvalidationを待たせず、stale commitによるsession参照/revision更新を優先する。stale sessionから値をコピーする操作は提供しない。破棄はsessionとsnapshot参照をメモリから除去する。reset履歴、stale履歴、破棄履歴の永続化はB-5対象である。

## 10. automatic judgementとの分離

rc2の`automatic_judgement`は自動pipelineの結果であり、B-4aの人間判断とは別レイヤーである。

- `accept`は自動判定の承認であり、人間派生値は`automatic_judgement.satisfied`を参照する。
- `override_satisfied`と`override_unsatisfied`はoverlayの最終判断だけを変更する。
- いずれのverdictでも`automatic_judgement`、`numeric_comparison`、`auto_applicability`、`comparison_input`を変更しない。
- 人間派生値を既存JSON/Excel/RO-Crateの既存欄へ代入しない。

現行rc2では全comparisonに`numeric_comparison`と`automatic_judgement`が必須である。旧rc1の`comparison === null`から`satisfaction.not_applicable`を作る分岐は設けない。

## 11. UI契約

UIは既存relationレビューUI、数量レビューUIとは別の「比較artifactレビュー」領域に置き、既存のJSON A／JSON B／照合情報の色体系を維持する。

| UI要素 | 表示・操作契約 |
|---|---|
| レビュー開始ボタン | sessionなし・preflight可能時にだけ明示開始。active/stale sessionがある間は暗黙置換せず、明示的discardを案内する。busy/stale/invalidでもhandlerはcoordinator/reducer境界を通し、失敗理由をstatusへ表示 |
| セッション破棄ボタン | active/stale sessionを明示破棄。確認UIの要否は実装レビューで決めるが、破棄以外の副作用は禁止 |
| 5対象の状態表示 | `not_eligible`、`unreviewed`、`reviewed`をtargetごとに表示。保存していない派生値は「派生」と分かる表示にする |
| 上流4対象の承認ボタン | `unreviewed`時だけ操作可能。数量値等の編集UIは置かない |
| satisfaction操作 | eligibility成立時だけaccept／override satisfied／override unsatisfiedを提示 |
| reset操作 | target単位の明示操作。上流reset時にsatisfactionも無効化されることを事前に示す |
| status領域 | 成功、stale、invalid、busy、diagnostic codeと安全な要約を`textContent`で表示 |

ボタンのdisabled属性は誤操作防止の補助にすぎず、transition関数が同じ前提条件を再検査する。失敗時は既存sessionを部分変更せず、statusだけを更新する。外部文字列はHTMLとして挿入せず、status、reviewer、noteを表示する場合も`textContent`を使う。

## 12. 診断コード

| code | 発生条件 | severity | UI表示方針 |
|---|---|---|---|
| `review_session_not_started` | sessionを要するaction時にsessionがない | error | レビュー開始を促し、対象操作を実行しない |
| `review_session_stale` | stale session、またはsource identity不一致を検出しactive→stale invalidation CASを完了したtransition要求 | error | 変更原因を一般化して示し、明示破棄後の新session開始を促す |
| `review_artifact_invalid` | producer不完全、record set欠落、browser validator例外/invalid | error | schema/semantic件数と安全な主要コードを示し、sessionを作らない |
| `review_artifact_identity_mismatch` | identity要素欠落、不正、digest不一致、現在artifactとの不一致 | error | artifactが一致しないことを示し、移植せず再生成を促す |
| `review_target_unknown` | comparisonまたは5対象の識別子が存在しない | error | 対象不明として操作を拒否。入力値をHTML表示しない |
| `review_action_unknown` | action typeが既知集合にない | error | 未対応操作として拒否 |
| `review_transition_not_allowed` | 現状態からactionが許可されない、二重承認など | warning | 現状態と許可操作を簡潔に示す |
| `review_satisfaction_not_eligible` | 上流4対象reviewed前のsatisfaction操作 | warning | 未承認の上流targetを示す |
| `review_verdict_invalid` | targetに許されないverdict、上流targetへのoverride/correct | error | 許可値を示し拒否 |
| `reviewer_required` | reviewerが非文字列、空、またはtrim後空 | error | reviewer入力を求める |
| `reviewed_at_invalid` | canonical UTC形式でない、または実在しない日時 | error | 時刻生成失敗として再試行を促す |
| `review_session_busy` | `activeMatchingJob`実行中、開始処理重複、またはsource identity不変の通常transition同士がsession参照/revision/tokenで競合 | warning | 完了を待つか再試行するよう示し、処理を重ねない。source staleには使用しない |

diagnosticは制御フローに使える安定codeを持ち、UI文言は別マッピングとする。内部例外、ファイルパス、入力本文、stack traceは通常UIへ出さない。

## 13. セキュリティ／fail-closed条件

- reducerは未知action、未知target、未知comparison、不正verdict、追加の不正状態を既定許可しない。
- session開始と各transitionの双方でsession statusとartifact identityを確認する。
- active/stale sessionが存在する間の再開始を拒否し、新sessionによるoverlayの暗黙置換を禁止する。
- async開始処理は開始tokenとsource contextをprepare時に捕捉し、commit直前にlive stateを再取得する。prepare時の参照だけを再利用して再照合したことにしてはならない。
- producer record setはclone直後・validator前・最初のawait前にdeepFreezeし、exact frozen snapshotを検証、digest、保持する3経路は同一参照に固定する。検証済みフラグや独立したvalidation resultを別record setへ流用できないAPIにする。
- binding identityは現行bindingに存在すると仮定せず、binding generationとexact frozen binding snapshotのraw digestから導出する。開始公開前とtransition commit前にbinding参照、generation、digest、identityをすべて再確認する。
- actionを適用する前に全入力を検証し、成功時だけ新stateを一括返す。
- 通常transitionはsession参照、session ID、session revision、source epoch、transition token、active status、binding 4要素を同期CASし、不一致のreducer結果を公開しない。
- comparison更新は指定された`comparisonId`のcloneだけに限定し、他comparisonのdeep equalityを維持する。
- reducerはrecord setを更新引数に含めず、automatic judgement参照は読取り専用snapshot accessor経由とする。
- `note`と`reviewer`は実装時に長さ上限を定め、表示は`textContent`とする。コード実行、HTML、URLとして解釈しない。
- digest計算で循環参照、非有限数、`undefined`、関数、symbol等を検出した場合はidentity生成を拒否する。
- B-4aのoverlayをdownload、Web Storage、IndexedDB、URL、通信へ渡すコード経路を作らない。
- session stale eventとtransitionが競合した場合はinvalidationがtokenを失効させ、session revisionを進める。古いtransitionはCASに失敗し、承認をcommitしない。

## 14. 将来のテスト・バグ注入計画

> **B-4a Stage 1実装時のexact record・純粋性契約（2026-07-23）**：純粋coreが受理する初期入力、marker、snapshot identity、session、comparison、target、action、invalidation payload、`stale_runtime`の固定recordは、prototypeが`Object.prototype`または`null`であり、`Reflect.ownKeys()`が契約上のstring keyだけと完全一致し、各必須keyがenumerableなdata propertyであるものに限定する。non-enumerableな必須property、getter/setter、追加hidden own property、symbol own property、custom prototypeは、値のgetterを実行する前にfail closedで拒否する。動的`comparisons`コンテナも同じprototype制約を持ち、全own keyを`Reflect.ownKeys()`で直接走査して、enumerableなstring data property、有効な`cmp-v1:` ID、valid comparison値であることを検査する。初期`comparisonIds`は標準prototypeの1件以上のdense arrayに限定し、全indexのown enumerable data descriptor、ID形式、重複なしを明示走査して、生成後のcomparison件数が入力長と一致しなければ拒否する。
>
> 失敗と成功no-opは元sessionと同一参照を返すが、結果wrapperだけをshallow freezeし、入力sessionへrecursive freezeを伝播させない。`changed:true`操作はcore自身が生成したrecursive frozen sessionだけに許可し、構造的に有効でも可変なsessionで承認、reset、discard、active→stale等の変更が必要なら、元sessionのJSON、全descriptor、freeze状態を変えず`review_artifact_invalid/error`で拒否する。正式sessionではmarker、snapshot、非対象comparisonおよび変更対象comparison内の非対象targetの参照同一性を維持してcopy-on-writeする。diagnostics配列と各diagnosticは毎回新規生成してfreezeする。一般構造不正は`review_artifact_invalid/error`、markerまたはsnapshot identity不正は`review_artifact_identity_mismatch/error`、状態上許可されない操作は`review_transition_not_allowed/warning`、invalidationの`occurredAt`不正は`reviewed_at_invalid/error`へ固定し、code/severity/detailはcore内の単一定数表から生成する。

### 14.1 恒久検査

B-4a実装時に次を追加し、その時点でリポジトリに存在し変更の影響を受ける全検査も実行する。

- 純粋reducerのNode検査
- 同じ初期stateとaction列から同じstateになる決定性（時刻・session IDは入力として固定）
- 未知action/target、invalid verdict、二重承認等のfail closedと入力非変更
- upstream resetによるsatisfactionの`not_eligible`化とverdict消去
- satisfactionだけのresetとeligibility再導出
- comparison間の状態分離と非対象comparisonのdeep equality
- stale sessionでdiscard以外の全transition拒否
- artifact identity構成要素ごとの不一致検出
- 元traceのrequirement/actual dataset signatureが同じでも、sidecarのproperty候補導出結果、interval semantics候補、またはrulesetが異なる各ケースで`binding_snapshot_digest`と`binding_identity`が異なること
- binding開始・解除・再読込ごとの`binding_generation`増加、非同期binding identity公開直前のgeneration再照合、safe integer超過時のfail closed
- canonical JSON内の`"a  b"`と`"a b"`、NFKC差、前後空白が異なるrecord set/relation snapshotでraw digestが異なること
- 現行`canonicalJson()`の実効出力を正本とし、固定ベクトル`{"10":"a","2":"b"}`がNode/browser双方で`{"2":"b","10":"a"}`、raw SHA-256 `b6e3a5de6007a9d717e70a63d7a5925fbad17a4c8b911a64354b0adf21956d06`になること
- `generated_at`だけが異なる再生成物をlive source marker比較へ使わず、入力不変のtransitionがstaleにならないこと
- exact snapshot Aの`valid:true`をsnapshot Bへ流用できず、validator入力・digest対象・保持snapshotが同一であること
- validatorがexact snapshotを書き換えようとしても、validator呼出し前のrecursive freezeにより変更不能で、検証後digestと保持snapshotが不変であること
- async digest待機中の入力、relation、binding、matching generation変更、および開始処理重複が公開直前再照合でsession非公開になること
- active/stale sessionがある状態の`start_review_session`が`review_transition_not_allowed`となり、既存overlayがdeep equalityで不変であること
- epoch増加と`invalidate_review_session`が元データ変更より先に実行され、active→stale、stale→stale冪等、target不変になること
- `unreviewed`上流targetの冗長resetが`ok:true/changed:false`となり、session参照、revision、全target、metadataを変更せず、globalへ代入しないこと
- `stale → stale` invalidationが`ok:true/changed:false`となり、session参照、revision、全target、最初のstale理由を変更せず、globalへ代入しないこと
- sessionを保持する`changed:true` transitionだけが新session参照を返して`session_revision`を1増加し、成功no-opと失敗は同一session参照・revision不変になること
- live marker、epoch、generation、binding、dataset、relationの各source identity不一致をtransition中に検出した場合、専用invalidation CASがactive sessionをstaleへcommitしてから`review_session_stale`を返し、activeのまま残さないこと
- source identity不変でsession参照/revision/tokenだけが競合した通常transitionは、現行sessionを変更せず`review_session_busy`または明示的再試行要求となること
- live marker/binding digest待機中に入力変更とinvalidationをcommitした場合、古いtransitionのsession参照/revision/epoch/token CASが失敗し、stale sessionをactive reviewed sessionへ復活させないこと
- `automatic_judgement`、`numeric_comparison`、rc2 record setのbyte/digest不変
- 既存trace-comparison JSON downloadへoverlayが漏れないこと
- 既存Excel／RO-Crateへoverlayが漏れないこと
- レビュー未操作時および操作後の既存照合・表示・出力挙動不変
- 実Chromiumで開始、承認、override、reset、stale、破棄、disabled表示、statusの`textContent`更新
- 実Chromiumのpage error 0件

### 14.2 バグ注入

B-4a Stage 1では、従来の失敗/no-op recursive freeze、hidden/symbol/prototype、diagnostic mappingの注入に加え、(a)`changed:true`結果で共有子へrecursive freezeを再導入する、(b)fixed recordのdescriptor検査をown key存在検査だけへ後退させる、(c)動的`comparisons`検査を`Object.entries()`だけへ後退させる、(d)`comparisonIds`検査をholeをスキップする`some()`/`forEach()`だけへ後退させる、の4分類を追加する。それぞれ、可変sessionでのaccept／active→stale不変検査、non-enumerable/getter/setter専用検査、comparisons hidden/accessor専用検査、dense array専用検査が直接失敗しなければならない。

読取り派生については、`deriveHumanSatisfaction()`または`deriveAllReviewed()`へ`session_status === 'active'`限定ガードを再導入する退行も独立分類として注入する。stale化前後でhuman satisfactionとall reviewedが同じ値を返す専用assertionが直接失敗し、操作可否を表す`deriveSatisfactionEligibility()`のstale=`false`は維持されなければならない。

action診断は制御フロー契約として構造不正と意味的不明を分離する。own `type` propertyが存在しない場合、およびenumerable data propertyの未知文字列の場合だけ`review_action_unknown/error`とする。`type`がaccessor、non-enumerable、非文字列の場合、ならびに既知actionの必須property不足・余分なproperty・型不正は`review_transition_not_allowed/warning`とする。既知actionの`comparison_id`／`target`が契約どおり文字列であり、その識別子だけが未知の場合に限り`review_target_unknown/error`とする。descriptor検査はgetter/setterを実行せずに完了しなければならない。恒久検査の成功件数`passed`と登録総件数`total`は別々に管理する。

開発者AIがプロトコルv2に従い、push対象worktreeではなくdisposable worktreeまたは一時コピーで、次を1件ずつ注入する。

1. satisfaction eligibilityガード削除
2. upstream reset時のsatisfaction無効化削除
3. stale sessionガード削除
4. `automatic_judgement`上書き混入
5. 既存rc2 downloadへのoverlay混入
6. `comparison_id`だけで旧overlayを再利用
7. raw SHA-256を`v12HashParts()`へ戻し、連続空白が異なるrecord setを同一視
8. session公開直前のtoken/epoch/live source再照合を削除
9. record set Aのvalidator結果をrecord set Bのsession作成へ流用
10. transition時にproducerを再実行し、`generated_at`差で誤stale化
11. source変更handlerのepoch増加または`invalidate_review_session`呼出しを削除
12. `binding_identity`をdataset signatureだけから作り、同じtraceでsidecar候補/rulesetが異なるbindingを同一視
13. exact snapshotの`deepFreeze()`をvalidator後へ移し、validator内の書換えをdigest/sessionへ反映
14. transition commit直前のsession参照/revision/epoch/token/binding再照合を削除し、digest待機中の入力変更後に古い承認でstale sessionを復活
15. active/stale session存在時の開始拒否を削除し、新sessionで既存overlayを暗黙置換
16. no-opでもrevision `+1`を要求またはglobal代入し、冗長reset/stale→staleで参照・revision・最初のstale理由を変更
17. `canonicalJson()`固定ベクトルを中間`.sort()`順の`{"10":"a","2":"b"}`として独自直列化し、現行関数の実効byte列/digestからdrift
18. source identity不一致時の`commitSourceInvalidation()`を削除し、transitionを拒否してもglobal sessionをactiveのまま残す

各注入は「注入→専用assertionの失敗確認→復元→空diff確認」を完結させ、複数注入を同時に残さない。セッション中断後は未復元を前提に、最初にworking treeと対象行を検査する。全注入後に通常の全回帰を再実行し、復元後の`git diff --exit-code`等を証跡へ含める。開発者AIが全回帰、注入、完全復元を担当し、Claude CodeはApprove済みパッチの同一性確認・適用・指定された最小受入検査・forceなしpushだけを担当する。

## 15. B-4b未解決事項

B-4bへ分離し、B-4aには混ぜない項目は次のとおり。

- 数量抽出結果の訂正
- property mappingの別concept選択
- interval semantics候補の変更
- comparison modeの変更
- 訂正後の単位変換再計算
- 訂正後のnumeric comparison再計算
- 訂正後のautomatic judgement再計算
- `correct` verdictとcorrected valueの表現
- 訂正前後の監査証跡

B-4bでは、訂正した上流値から下流結果を同じtransactionで再生成し、完全な依存整合性検証に成功するまで新結果を公開しない設計が必要である。上流値だけを訂正し、古い`numeric_comparison`または`automatic_judgement`を残す中間状態・保存状態は構造的に禁止する。

未解決事項は、訂正artifactの新Schema/version、元rc2 snapshotとの関係、再計算producerの信頼境界、訂正値の型とprovenance、再検証失敗時のrollback、B-5監査イベントとの接続である。

## 16. B-5への引き渡し事項

B-4aではreview overlayを次のいずれにも保存しない。

- 既存trace-comparison rc2 JSON
- Excel
- RO-Crate
- `localStorage`
- `IndexedDB`
- URL
- 別JSONファイル
- サーバー

B-5では、保存用artifactのSchema/version、artifact identityの再検証、監査イベント、reset/stale/破棄履歴、再読込、複数レビュアー、署名・権限、競合解決、旧artifactからの明示的migration、retentionを設計する。B-5の保存形式を決める際もrc2へ暗黙にフィールドを追加せず、新Schema版または明示的な別artifactとする。B-4a overlayのruntime例を、そのまま永続形式として採用したものとは解釈しない。
