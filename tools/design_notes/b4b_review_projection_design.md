# B-4b Checkpoint 1: 読取り専用レビュー投影層の設計

## 0. 位置づけ

`b4_review_state_transition_design.md` §2は、B-4bを「人間による数量、property、interval semantics、
comparison modeの訂正と、訂正後の下流再計算」と定義し、§15で訂正artifactのSchema・再計算・rollback等を
未解決事項として残した。本書はその「訂正」機能そのものではなく、訂正機能が依存する**前提**——自動照合
結果（rc2 record）とB-4aのreview overlay（`trace_comparison_review_state_core.js`が管理する
session.comparisons）を、どちらも変更せずに1つの「有効なレビュー済み結果」として合成して読み出す、
read-onlyのprojection層——を設計・実装する。B-4bの最初の実装単位（Checkpoint 1）と位置づける。

本書は設計とNode検査済みの純粋coreだけを扱う。HTML、UIには一切触れない。既存ファイルのうち
`trace_comparison_review_session_core.js`（Stage 3）と`quantity_sidecar_binding_core.js`は無改変
のまま一切触れない。`trace_comparison_review_state_core.js`（Stage 1）は、既存関数の本体・振る舞いを
一切変更せず、投影層が呼び出すために必要な2つの既存内部関数（`structurallyUsableSession`、
`sessionIdentityInvalid`）を公開APIオブジェクトへ追加exportする最小限の変更（`git diff`で2行のみ）
だけを行った（レビュー修正、6節参照）。値の訂正（`correct` verdict、訂正後の下流再計算）は本書の
対象外のままとし、`b4_review_state_transition_design.md` §15の未解決事項である。

## 1. 何を投影するか

- **自動側（変更不可・入力）**：`quantity_sidecar_binding_core.js`の`generateTraceComparisonRecordSet()`
  が生成し、browser validatorで検証済みのrc2 record set。特に各comparisonの`automatic_judgement`
  （`{state, satisfied, judgement_source:'automatic_pipeline', human_confirmed:false}`、常に
  `human_confirmed:false`のまま）と、rc2生成時点の初期`review`（`b4_review_state_transition_design.md`
  §3が述べるとおり、B-3生成時点の初期状態のみを表し、以後書き換えられない）。
- **overlay側（変更不可・入力）**：`trace_comparison_review_state_core.js`が管理する
  review session（`null`、または`session_status`が`active`/`stale`の構造的に有効なsession）。
  `session.comparisons[comparisonId]`が、rc2生成時点の初期`review`と同型の、現在の実際のレビュー状態
  （`quantity_extraction`/`property_mapping`/`interval_semantics`/`comparison_mode`/`satisfaction`）
  を持つ。
- **出力（新規・投影結果）**：上記2つを読むだけで導出する「有効なレビュー済み結果」。自動側・overlay側
  のどちらのオブジェクトも書き換えない。投影結果自体を保存・永続化する経路は設けない（B-5対象）。

## 2. 入力契約

### 2.1 `projectEffectiveComparisonResult(recordSet, session, comparisonId)`

| 引数 | 型 | 契約 |
|---|---|---|
| `recordSet` | rc2 record set | `{ comparisons: Array<record> }`の形の、呼出し元が既に検証・freeze済みのオブジェクト。本関数はこれを**再検証しない**（browser validatorによる完全なschema/semantic検証は呼出し元の責務。本関数が読むのは`comparison_id`と`automatic_judgement`の2フィールドのみで、それぞれ構造的に最小限の型検査を行う）。破壊的変更は一切行わない（内部で読み取るだけで、複製もしない） |
| `session` | review session または `null` | `null`＝sessionが一度も開始されていない、または`discard_review_session`で破棄済み。非`null`の場合は`TraceComparisonReviewStateCore.transitionReviewState`等が返す、構造的に有効なsessionオブジェクト（`session_status`が`active`または`stale`）を想定する。本関数は`session`の構造検査を独自に再実装せず、`TraceComparisonReviewStateCore.structurallyUsableSession(session)`（Stage 1が`transitionReviewState`/`invalidateReviewSession`自身の入口ガードとして既に使っている正本の検査関数）を追加exportして呼び出す（レビュー修正、6節参照）。非`null`かつ構造的に無効な`session`はfail closedとする（`review_artifact_invalid`または`review_artifact_identity_mismatch`。判定はStage 1自身の`sessionIdentityInvalid()`と同じ基準を使う） |
| `comparisonId` | 文字列 | `recordSet.comparisons`内のいずれかの`comparison_id`と一致することを期待する非空文字列 |

呼出し元が満たすべき前提（本関数は強制できないため明記するだけ）：
- `recordSet`は、`session`が非`null`の場合、その`session`を開始した際に検証したのと**同一の**rc2
  record set（同一参照または内容的に同一のsnapshot）であること。`session.snapshot_identity`との
  digest突き合わせは本関数の責務としない（それは`coordinateReviewTransition()`層など、既にsource
  identityを扱う既存coordinatorの責務であり、本関数は「渡された2つの入力をそのまま合成する」ことに
  責務を限定する。詳細は9節「非対象」参照）。

### 2.2 `projectEffectiveReviewedResultSet(recordSet, session)`

`recordSet.comparisons`内の全`comparison_id`について2.1を呼び出す便宜関数。`comparisons`が配列でない、
または1件以上のcomparisonの`comparison_id`が文字列でない場合は、個々の結果ではなく関数全体として
`ok:false`を返す（部分的な投影結果を返さない）。

## 3. 出力契約

### 3.1 単一comparisonの投影結果

```javascript
{
  ok: true,
  comparison_id: "cmp-v1:...",
  result: {
    automatic: {
      state: "satisfied" | "not_satisfied" | "needs_confirmation",
      satisfied: true | false | null,
      judgement_source: "automatic_pipeline",
      human_confirmed: false
    },
    review_overlay: {
      quantity_extraction: { status, reviewer, reviewed_at, verdict, note },
      property_mapping:    { status, reviewer, reviewed_at, verdict, note },
      interval_semantics:  { status, reviewer, reviewed_at, verdict, note },
      comparison_mode:     { status, reviewer, reviewed_at, verdict, note },
      satisfaction:        { status, reviewer, reviewed_at, verdict, note }
    },
    effective_satisfaction: true | false | null,
    satisfaction_eligible: boolean,
    all_reviewed: boolean,
    session_context: {
      present: boolean,
      status: "active" | "stale" | null
    }
  },
  diagnostics: []
}
```

失敗時（`comparison_id`が`recordSet`に存在しない、`recordSet`/`automatic_judgement`が構造的に不正、
`session`が非`null`かつ構造的に無効、`session`と`recordSet`のcomparison ID集合が一致しない、等）：

```javascript
{ ok: false, comparison_id, result: null, diagnostics: [{ code, severity, detail }] }
```

`comparison_id`は、呼出し時に渡された`comparisonId`引数がそれ自体すでに非空文字列である場合だけその
値をそのまま返し、そうでない場合（非文字列、空文字列）は`null`とする。呼出し元は、渡した
`comparisonId`が文字列であった場合、失敗理由の種類（session由来か、recordSet由来か）に関わらず
常に同じ値が返ることを期待してよい。

診断コードは`trace_comparison_review_state_core.js`の`DIAGNOSTICS`と語彙を共有する
（`review_target_unknown`＝comparison未存在または`comparisonId`引数自体が非文字列、
`review_artifact_invalid`＝record set構造不正、または`session`が`undefined`、または`session`が
構造的に不正だが`live_source_marker`/`snapshot_identity`自体は妥当、
`review_artifact_identity_mismatch`＝`session`の`live_source_marker`/`snapshot_identity`自体が
構造的に不正、または`session`と`recordSet`のcomparison ID集合が一致しない）ことで、既存UIの
診断コード分岐をそのまま再利用できるようにする。新規コードは追加しない。

`session`引数の扱い（レビュー修正、公開契約の明確化）：

| `session`の値 | 扱い |
|---|---|
| `null`（明示的） | 「sessionが一度も開始されていない、または破棄済み」を表す唯一の値。この場合だけ`record.review`へfallbackする |
| `undefined`（未指定・省略を含む） | 公開契約上「sessionなし」とは扱わない。`review_artifact_invalid`でfail closedする（fallbackしない） |
| 非`null`かつ非`undefined` | `TraceComparisonReviewStateCore.structurallyUsableSession()`で構造検証し、失敗ならfail closed。構造的に有効でも、`recordSet.comparisons`の全`comparison_id`集合と`session.comparisons`のキー集合が完全に一致しない場合（recordSet側の余分・session側の余分のいずれも）は`review_artifact_identity_mismatch`でfail closedする |

### 3.2 各フィールドの意味と導出

| フィールド | 導出方法 | 備考 |
|---|---|---|
| `automatic.*` | `record.automatic_judgement`をそのまま読み取ったコピー（参照は返さない。凍結した浅いコピーを返し、呼出し元が書き換えても入力recordへ影響しない） | 4フィールドを再計算・再判定しない。純粋なecho |
| `review_overlay.*` | `session === null`の場合だけ、**rc2 record自身の`record.review`**（B-3生成時点の初期値、`b4_review_state_transition_design.md` §3参照）を返す。`session`が非`null`（構造的に有効）の場合は必ず`session.comparisons[comparisonId]`を返す。同じrecord setから正しく開始されたsessionは、その時点の全`comparison_id`を初期化済みのため、非`null` sessionで対象comparisonIdが欠落することはrecordSetとsessionの不一致であり、`record.review`へのfallbackは行わずfail closedする（`review_artifact_identity_mismatch`。レビュー修正blocker 2、4.7節） | `record.review`へのfallbackは`session === null`の場合だけに限定する。overlay不在時に独自の初期値定数を再定義しない点は変更なし（producerが既に書き込んでいる初期値を単一の正本として使う） |
| `effective_satisfaction` | `TraceComparisonReviewStateCore.deriveHumanSatisfaction(session, comparisonId, recordSet)`をそのまま呼び出す。`session`が`null`の場合はStage 1 coreの契約どおり`null`を返す | Stage 1の導出ロジックを再実装しない。investigate済みの`deriveHumanSatisfaction`をそのまま利用（8.2節参照） |
| `satisfaction_eligible` | `session`が`null`なら`false`。非`null`なら`TraceComparisonReviewStateCore.deriveSatisfactionEligibility(session, comparisonId)` | 同上、既存導出関数を再利用 |
| `all_reviewed` | `session`が`null`なら`false`。非`null`なら`TraceComparisonReviewStateCore.deriveAllReviewed(session, comparisonId)` | 同上 |
| `session_context.present` | `session !== null` | sessionが一度も開始されていない状態と、破棄された状態はどちらも`present:false`になる（4.7節discardケース参照） |
| `session_context.status` | `session === null`なら`null`。非`null`なら`session.session_status`（`"active"`または`"stale"`） | UIが「未確認」と「stale」を区別して表示するための情報 |

## 4. 代表ケース（固定・Node検査対象）

以下はすべて`tools/design_notes/trace_comparison_review_projection_core_verification.js`で固定検査する。
各ケースの入力（record・session）はテストファイル内に固定fixtureとして定義し、`TraceComparisonReviewStateCore`
の実関数（`createInitialReviewSessionState`/`transitionReviewState`/`invalidateReviewSession`）を実際に
呼び出して構築する（投影層のテストのために独自にoverlay状態を手組みしない。これにより、投影層が
「実際にStage 1 coreが生成し得る状態」だけを入力として検証する）。

### 4.1 review未実施

session開始直後（`createInitialReviewSessionState`の結果そのまま、いかなる`accept_review_target`等も
未実行）。期待：`review_overlay`の5対象すべてが初期値（上流4対象`unreviewed`、satisfaction
`not_eligible`）、`effective_satisfaction:null`、`satisfaction_eligible:false`、`all_reviewed:false`、
`session_context:{present:true, status:'active'}`。

### 4.2 upstream 4項目承認済み

4件の`accept_review_target`（`quantity_extraction`/`property_mapping`/`interval_semantics`/
`comparison_mode`、いずれも`verdict:'accept'`）を順に適用した後。期待：上流4対象が`reviewed`、
satisfactionは自動的に`not_eligible`→`unreviewed`へ遷移済み、`effective_satisfaction:null`
（まだsatisfaction自体は未reviewed）、`satisfaction_eligible:true`、`all_reviewed:false`
（satisfactionがまだunreviewedのため5対象全部には届いていない）。

### 4.3 satisfaction review済み（3 verdict）

4.2の状態からさらに`review_satisfaction`を適用。3つのverdictをそれぞれ独立したfixtureで固定する。

| verdict | `record.automatic_judgement.satisfied` | 期待`effective_satisfaction` |
|---|---|---|
| `accept` | `true` | `true`（自動判定をそのまま採用） |
| `accept` | `false` | `false`（自動判定をそのまま採用。acceptは常に自動側の値を反映することを別途固定） |
| `override_satisfied` | （任意、`false`で固定） | `true`（自動側の値を無視してoverride） |
| `override_unsatisfied` | （任意、`true`で固定） | `false`（同上） |

いずれの場合も`all_reviewed:true`（5対象すべてreviewed）、`satisfaction_eligible:true`を固定する。

### 4.4 reset

4.2の状態から、上流対象1件（`quantity_extraction`）へ`reset_review_target`を適用した直後。期待：
`quantity_extraction`が`unreviewed`かつメタ4項目`null`に戻り、`b4_review_state_transition_design.md`
§9の規則どおりsatisfactionも`not_eligible`へ戻り（4項目`null`）、`satisfaction_eligible:false`、
`effective_satisfaction:null`、`all_reviewed:false`へ戻ることを固定する。

### 4.5 stale session

4.3（`accept`＋自動判定`true`）の状態から`invalidateReviewSession()`を適用しstale化した直後。期待：
`session_context:{present:true, status:'stale'}`、`review_overlay`は直前の値（satisfaction
`reviewed`/`accept`等）をそのまま保持、`effective_satisfaction`・`all_reviewed`は
`b4_review_state_transition_design.md` §8が明記する「stale sessionでも保存済みレビュー結果の
読取り派生は無効化しない」との規定どおり、active時と同じ値を返す。一方`satisfaction_eligible`は
同節の規定どおりstale sessionでは常に`false`（操作可否を表すため）。

### 4.6 discard済み

`transitionReviewState(session, {type:'discard_review_session'})`の結果（`session:null`）を投影層へ
渡す。期待：`review_overlay`は当該comparisonの`record.review`（rc2初期値）そのもの、
`effective_satisfaction:null`、`satisfaction_eligible:false`、`all_reviewed:false`、
`session_context:{present:false, status:null}`。4.1（review未実施、session存在かつ初期値）とは
`session_context.present`が異なる点、および`review_overlay`の値の出どころ（session由来かrecord由来か）
が異なる点を、テストで明示的に区別して固定する（同じ初期値に見えても、経路が異なることを検査する）。

### 4.7 追加：不正入力（fail-closed）

- 存在しない`comparisonId`を渡す → `ok:false`、`review_target_unknown`
- `recordSet.comparisons`が配列でない、または対象recordに`automatic_judgement`が欠落 →
  `ok:false`、`review_artifact_invalid`
- 構造的に無効な`session`を渡す → `ok:false`。診断コードはStage 1自身の`sessionIdentityInvalid()`と
  同じ基準で選択する。`{session_status:'active'}`だけのような、必須フィールドの大半を欠く/
  `session_status`だけが不正で`live_source_marker`・`snapshot_identity`自体は妥当な場合は
  `review_artifact_invalid`、`live_source_marker`または`snapshot_identity`自体が構造的に不正な
  場合は`review_artifact_identity_mismatch`（レビュー修正blocker 1、4種のfixtureで固定）。

### 4.8 追加：recordSetとsessionのcomparison ID不一致（blocker 2）

同一record setから正しく開始されたsessionは、その時点の全`comparison_id`をsession開始時に初期化
済みである（`createInitialReviewSessionState`の契約）。したがって、非`null`かつ構造的に有効な
sessionで、`recordSet.comparisons`中のあるcomparison_idが`session.comparisons`に存在しない状況は、
「まだレビューされていない」ではなく「recordSetとsessionが対応していない」ことを意味する。

- 単一comparison投影（`projectEffectiveComparisonResult`）で、sessionに存在しないcomparison_idを
  指定 → `ok:false`、`review_artifact_identity_mismatch`（`record.review`へのfallbackは行わない）
- 全comparison投影（`projectEffectiveReviewedResultSet`）で、recordSet中の1件でもsessionに存在
  しないcomparison_idがあれば、呼出し全体を`ok:false`とする（他のcomparisonの投影結果を部分的に
  返さない。3.2節`projectEffectiveReviewedResultSet`の既存契約と整合）
- 対照として、`session === null`の場合は同じcomparison_idでも`record.review`へのfallbackが正しい
  動作であることを別途固定する（fallbackが許されるのは`session === null`の場合だけであることを
  明確に区別する）

## 5. 純粋性・非破壊の検査方針

- 投影関数呼び出しの前後で、`recordSet`・`session`のいずれも参照の同一性・内容（`canonicalJson`相当の
  深い等価性、または`JSON.stringify`による比較で十分）が変化しないことを固定検査する。
- `Object.freeze`済みの`recordSet`・`session`を入力に使い、投影関数が内部で`freeze`済みオブジェクトへの
  書込みを試みた場合に（strict modeの）例外が発生する状況を作ることで、書込み志向のコードが紛れ込んで
  いないことを間接的に補強する。
- 戻り値`result`自体も`Object.freeze`し、呼出し元が誤って書き換えても入力・内部状態に影響しないことを
  固定する。

## 6. 実装配置

- `tools/trace_comparison_review_projection_core.js`（新規）：Node/browser共有の純粋core。
  `trace_comparison_review_state_core.js`と同じUMDパターン（`module.exports`と
  `globalThis.TraceComparisonReviewProjectionCore`の両対応）を踏襲する。`TraceComparisonReviewStateCore`
  を`require`（Node）または`globalThis.TraceComparisonReviewStateCore`（browser、既存3ファイルが
  同一ページへ`<script>`で並ぶ前提）から取得して呼び出す。取得できない場合は投影関数自体が
  `ok:false`／`review_artifact_invalid`相当で拒否する（無言でロジックを複製しない）。
- `tools/trace_comparison_review_state_core.js`（既存・レビュー修正で最小限のexport追加）：
  内部関数`structurallyUsableSession`・`sessionIdentityInvalid`（既に`transitionReviewState`/
  `invalidateReviewSession`自身が使っている正本の検査関数）を、モジュール末尾の公開APIオブジェクトへ
  2キー追加しただけ。既存の関数本体・振る舞いは一切変更していない（`git diff --stat`で
  `2 insertions(+), 1 deletion(-)`、内訳は既存最終行への末尾カンマ追加1行＋新規行1行のみであることを
  確認済み）。この変更を反映し、Stage 1恒久検査（77件）・Stage 2+3恒久検査（152件）を再実行し、両方
  とも全件成功することを確認した。
- `tools/design_notes/trace_comparison_review_projection_core_verification.js`（新規）：Node検査。
  4節の全ケース＋5節の純粋性検査を実施する。

## 7. 対象外（B-4b以降・本checkpointでは着手しない）

- `b4_review_state_transition_design.md` §15に列挙された、訂正（`correct` verdict）・訂正後の
  下流再計算・訂正artifactのSchema設計。
- HTML/UIへの接続（既存3ツールのボタン・表示への配線）。
- 投影結果の永続化・エクスポート（B-5領域）。
- PDF→JSON／Excel→JSON α版への変更（別backlogとして扱う。本checkpointでは一切触れない）。

## 8. 参考：既存coreとの役割分担

| 層 | 責務 | 本書での扱い |
|---|---|---|
| `quantity_sidecar_binding_core.js` | 自動照合結果（rc2 record set）の生成 | 無改変・入力としてのみ参照 |
| `trace_comparison_review_state_core.js`（Stage 1） | overlayの純粋state遷移・導出関数 | 既存関数は無改変。`structurallyUsableSession`/`sessionIdentityInvalid`を公開APIへ2キー追加exportのみ（6節参照） |
| `trace_comparison_review_session_core.js`（Stage 3） | session開始・transition・invalidationの非同期coordinator、CAS | 無改変・関与しない（投影層はsession生成後のsnapshotだけを読む） |
| `trace_comparison_review_projection_core.js`（本書、新規） | 自動結果＋overlayを合成した読取り専用の「有効なレビュー済み結果」の算出 | 新規実装対象 |

投影層はStage 1の`deriveHumanSatisfaction`等を**置き換えず**、それらを内部で呼び出して1つの
まとまった読み取り専用ビューへ整形するだけの薄い合成層である。Stage 1の導出ロジック自体に変更は
加えない。
