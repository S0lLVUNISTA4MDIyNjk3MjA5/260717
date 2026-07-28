# B-4b Checkpoint 3 設計案（Rev.6・実装完了版）: レビュー済みprojectionの正式エクスポート接続

状態: **実装完了（未commit・未push）**。B-4b Checkpoint 3 Design Gate。Rev.4
（Conditional Approve、実装契約として固定）どおりに実装した上で、実装・実測テストの過程で
判明した事項（「Rev.5: 実装で判明した事項」）、および2回のRequest Changes（実装Request
Changes round 2・round 3）で指摘された正式artifact境界のBlockerを反映した最終版
（下記「Rev.6: Request Changes round 2/3で指摘された事項」）。
Node検証69/69・Playwright検証42/42（新規）・既存Checkpoint 2 Playwright検証53/53（無変更・
回帰なし）まで実測済み。commit/pushはまだ行っていない（レビュー待ち）。

## Rev.5: 実装で判明した事項（設計を裏切らない範囲での実装時発見）

設計（Rev.4）そのものの方針・アーキテクチャは変更していない。以下は、実際にHTMLへ配線し
実ブラウザで検証する過程で判明した、設計時には見えていなかった実装上の詳細である。

| # | 判明事項 | 対応 |
|---|---|---|
| 発見1 | `addJsonSheet`/`writeWorkbook`は、設計時に想定していたような素朴なグローバル関数ではなく、Stage 2R-D（V11.17、行列/RO-Crate機能。B-4bとは無関係の既存機能）専用の別IIFE内のprivate関数だった。 | そのIIFEが既に公開している`window.__v1117`（既存の診断/流用面）へ、この2関数を追記するだけで対応した(§1・§5.2)。既存の関数本体・他のexportは変更していない。 |
| 発見2 | 実際のrc2 `actual_ref`には、設計時の想定（`trace_id`/`matcher_id`/`quantity_id`の3フィールドのみ）に加えて、実測で`source_row`という4件目のフィールドが付くことがあった。 | 当初は単一の`validRef()`を、3フィールド版と`source_row`付き4フィールド版の両方を受理するよう修正した。§3の決定（`source_row`は出力へ含めない）は変更せず、artifact構築時に明示的に3フィールドだけをコピーする形で維持した。**Rev.6で判明**: この単一`validRef()`は`requirement_ref`側にも`source_row`混入・空文字列IDを許してしまう抜け穴を持っていた（Request Changes round 3 Blocker 1）。`validRequirementRef()`/`validActualRef()`への分離により是正済み（Rev.6の表を参照）。 |
| 発見3 | `captureReviewedExportState()`が必ず呼ぶ`recomputeAndCacheProjection()`は、呼ばれるたび`ensureLazyTabRendered()`経由の非同期detail table再描画を起こし、その間`activeMatchingJob`を実測約450ms占有する。一方`buildReviewedExportArtifact()`自体は数ms程度で終わるため、CAS再確認時に自分自身の再描画がまだ終わっていないことがある。 | §5④のCAS再確認の直前に、`activeMatchingJob`がnullに戻るまで(上限付きで)待つ処理を`b4bBuildArtifactOrNull()`に追加した。これは「本当にレビュー状態が変わった」ことと「自分の呼び出しが誘発した描画がまだ終わっていない」ことを区別するためのもので、CAS自体の判定基準(§0.2のリスト)は変更していない。 |
| 発見4 | ボタンの有効/無効表示のためだけに`captureReviewedExportState()`を(タイマー等で)頻繁に呼ぶと、そのたびに上記の再描画が発生し、Checkpoint 2自身の一連の操作(例: discard直後にstart reviewを押し直す)と衝突して、Checkpoint 2の既存53件のPlaywright検証を不安定にすることが実測で判明した。 | 表示専用の読み取りだけの新規bridge関数`peekReviewedExportReady()`を追加した(§0.2)。これは`recomputeAndCacheProjection()`を呼ばない(=再描画を新たに起こさない)、`b4bProjectionCache.status`等を読むだけの純粋な参照読み取りであり、cache参照そのものは公開しない(booleanのみ返す)。ボタン表示の更新はこちらだけを使い、実際のexport実行(クリック時)は引き続き`captureReviewedExportState()`(常にrecomputeする、既存契約どおり)を使う。 |

上記に加え、次の実装バグも実測で見つけて修正した(設計そのものの変更ではない):
JSON/Excelクリックハンドラの`finally`が、ハンドラ自身が設定した成功/失敗/中止の最終メッセージを
`b4bReviewedExportRefreshUi()`の「保存できます。」等で即座に上書きしてしまっていた
(ユーザーが結果メッセージを実質見られない実装バグ)。`keepStatusText`引数を追加し、
クリックハンドラのfinallyから呼ぶ場合はボタンのdisabled状態だけを更新し、テキストは
上書きしないよう修正した。

## Rev.6: Request Changes round 2/3で指摘された事項（正式artifact境界の是正）

Rev.5実装をレビューした独立レビュアーから2回のRequest Changesを受け、正式artifact
（JSON/Excel共通の中間表現）の境界に実際に存在した抜け穴を是正した。設計そのものの
アーキテクチャ（runtime bridge・CAS・WeakMap・2段階のcore分離）は変更していない。

| # | 指摘（round） | 対応 |
|---|---|---|
| Blocker 1 (round 2) | `buildReviewedExcelSheets(artifact)`が、`buildReviewedExportArtifact()`を経由しない手組みの偽artifact（フィールド値だけ改変したコピーを含む）を無条件に信頼していた。 | 私的`WeakSet`（`attestedArtifacts`）による**attestation**を追加した。`buildReviewedExportArtifact()`が実際に生成したartifactオブジェクトそのものだけがこの集合に登録され、`buildReviewedExcelSheets()`は登録済みでない限り（deep-equalなコピーであっても）拒否する。加えて、`validArtifactShape()`をkeyの存在確認だけでなく全フィールドの型・形式・enumを検査する形へ拡張し、attestation（オブジェクト同一性）とexact structure検査（値の妥当性）の**両方**を要求する多層防御とした。 |
| Blocker 2 (round 2) | `recordSet.provenance.requirement_dataset_signature`/`actual_dataset_signature`/`recordSet.display_context.matching_dataset_signature`と、`session.live_source_marker`の対応する3フィールドとの相互一致を検査していなかった。`computeSnapshotIdentity()`は`live_source_marker.value`＋`schema_version`＋recordSet全体のダイジェストを結び付けるだけで、個々のsignatureサブフィールド同士の一致までは検査しない。 | identity再検証の直後に、3組のsignatureを厳密比較するfail-closed検査（`review_artifact_identity_mismatch`）を追加した（§5(b)）。 |
| Blocker 3 (round 2) | Playwright検証が、`stale`/`error`/レビュー開始in-flight/レビュー遷移in-flightの4状態のうち1状態（未レビュー）しか検査していなかった。加えて、cancel時のdownload件数・`#dlDetailExcelBtn`回帰・Review Metadata集計4項目・真のbefore/after不変検査が抜けていた。 | 4状態すべてを実UI経由（ファイル再選択によるstale化、`TraceComparisonReviewProjectionCore`のwindow差し替えによるerror化、実際の`startReviewSession()`/`accept_review_target`呼び出し中のマイクロタスクポーリングによるin-flight観測）で検証するテストを追加。cancel時`page.on('download')`で0件を確認、`#dlDetailExcelBtn`回帰、Metadata 4項目集計parity、export開始前・JSON export後・Excel export後の**3点**比較（2点比較では検出できない「JSON export自体がrecordSetを変える」ケースをカバー）を追加した。 |
| Blocker 1 (round 3) | JSON builder（`buildReviewedExportArtifact()`）とExcel adapter（`buildReviewedExcelSheets()`）とで、`requirement_ref`/`actual_ref`のref契約が食い違っていた。builder側が使っていた単一の`validRef()`は、空文字列のIDや（`requirement_ref`側の）`source_row`混入を許容してしまい、それらを含むrc2 recordからでも`buildReviewedExportArtifact()`が`ok:true`を返せてしまう一方、artifact側の`validArtifactRef()`はより厳格（3フィールドexact・非空文字列必須）だったため、builderが成功させたはずのartifactをExcel adapterが拒否する、という契約不整合があった。 | `validRef()`を`validRequirementRef(value)`（3フィールドexact・非空文字列必須。`source_row`は非対象）と`validActualRef(value)`（同条件＋`source_row`任意・整数必須）へ分離し、builder自身がこの2つを呼ぶよう修正した。これにより`buildReviewedExportArtifact()`の成功artifactは、その場でBuilder自身がExcel adapterと同じref契約を満たすことを保証する（builder成功⇒Excel adapter成功、を恒久テストで確認）。 |
| Blocker 2 (round 3) | `generated_at`/`started_at`/`reviewed_at`等の正式タイムスタンプ検証が正規表現のみで、`2026-99-99T99:99:99.999Z`のような暦上存在しない日時を受理してしまっていた。 | `canonicalTimestamp(value)`ヘルパーを追加し、正規表現に加えて`new Date(value).toISOString() === value`によるround-trip検査（Stage 1の`structurallyUsableSession()`と同じ意味の検査）を要求するよう統一した。`generatedAt`・`artifact.generated_at`・review targetの`reviewed_at`・`review_session.started_at`のすべてで同じヘルパーを使う。 |
| Blocker 3 (round 3) | テスト専用の`validArtifactShapeForTesting`が、製品のbrowser公開面（`window.TraceComparisonReviewExportCore`）に含まれてしまっていた。Checkpoint 3の正式契約は`buildReviewedExportArtifact`/`buildReviewedExcelSheets`の2関数のみであるべき。 | UMDファクトリへ`isCommonJsTestEnvironment`フラグ（`typeof module === 'object' && !!module.exports`）を追加し、Node/CommonJS環境（`require()`経由）でのみ`__test: { validArtifactShape }`を公開面へ追加するよう変更した。browser（`<script src>`）読込み経路ではこのフラグが常に`false`になるため、`window.TraceComparisonReviewExportCore`は`EXPORT_CORE_VERSION`/`ARTIFACT_VERSION`/`COMPARISON_ROW_KEYS`/`buildReviewedExportArtifact`/`buildReviewedExcelSheets`の5キーのみを持つ（Node側で`vm`モジュールにより実ソースをbrowser相当の条件下で実行し、キー集合を直接検査する恒久テストを追加した）。 |
| 設計書不整合 | 設計書（Rev.5時点）がNode 33/33・Playwright 27/27という古いテスト件数のまま、かつ§0.1が実際には5項目あるものを「次の4点」と表記していた。 | 本Rev.6で実測件数（Node 69/69・Playwright 42/42）へ更新し、§0.1の項目数表記も修正した。 |

Base: `af1d025322fc34f71879d0069d6dc47411566a03`（B-4b Checkpoint 2、frozen）。
Checkpoint 1（`c0909632aff63c1a0385c4c65c0b63cd2b857285`）・Checkpoint 2ともfrozenのまま、
既存core（`trace_comparison_review_state_core.js`/`trace_comparison_review_session_core.js`/
`trace_comparison_review_projection_core.js`）、およびCheckpoint 2のHTMLロジックの
**既存の行**（`recomputeAndCacheProjection()`・`b4bProjectionCache`・detail/graphの
読み取り専用装飾など）は一切書き換えない。ただし本設計では、Checkpoint 2のIIFE内へ
**最小の追記**（`captureReviewedExportState`/`reviewedExportStateStillCurrent`/
`peekReviewedExportReady`の3関数＋新しいwindow公開1個）を行うことをBlocker 1の対応として
明示する（§0.2で理由と範囲を明記。既存行は1行も変更・削除しない）。

## Rev.4での変更点（Conditional Approveの5条件＋frozen例外の明記）

| # | 指摘 | 対応箇所 |
|---|---|---|
| 条件1 | 変更予定HTMLにexport core本体のscript読込みが抜けている | §0.1を4項目に再構成（(a)script読込み追加） |
| 条件2 | runtime bridgeが`b4bProjectionCache`全体（`Map`を含む可変オブジェクト）を公開しており、新しいmutation面になる | §0.2改訂（`projected`/`session`/`recordSet`のみ公開、cache参照・epochはprivate `WeakMap`にCASトークンとして隠す） |
| 条件3 | session構造不正とstaleを一律`review_session_stale`にしていた。identity検証失敗も一律`review_artifact_invalid`へ変換していた | §5(a)(b)改訂（session null/undefined/構造不正→`review_artifact_invalid`、構造正常だが非active→`review_session_stale`。identity検証自体の失敗は既存APIのdiagnosticをそのまま保持し、値不一致のみ`review_artifact_identity_mismatch`） |
| 条件4 | `artifactToExcelSheets()`が入力artifactを無条件に信頼する公開APIだった | §5・§8改訂（`buildReviewedExcelSheets(artifact)`へ改名、`{ok,sheets,diagnostics}`形式でexact structure検査を内蔵、`buildReviewedExportArtifact()`を経由しない偽artifactからのExcel生成を拒否） |
| 条件5 | parity検査が一部フィールドのみで、quantity ID取り違え・reviewer混入・Metadata欠落等を検出できない | §9・§10改訂（39列全体＋Review Metadata全項目のparity検査、SheetJS SHA-256のNode事前検証、`sheet_to_json({raw:true, defval:null})`固定） |
| frozen例外の明記 | runtime bridge追加とCheckpoint 2 frozen原則の関係が曖昧 | §0.2に「禁止事項」を明記（`recomputeAndCacheProjection()`本体・`b4bProjectionCache`形状・既存diagnostics API・detail/graph renderer・coordinator/core本体はいずれも変更禁止） |

Rev.3からの主要変更点（既にApprove済みのアーキテクチャ）は§0.2〜§9の該当箇所にそのまま残る。

## 0. 目的・正本構造の再確認

Checkpoint 2で確定した構造:

```
coordinator
  ↓
recomputeAndCacheProjection()
  ↓
単一 projectionCache（matcherAIndex/matcherBIndex/matcherPairIndexを含む）
  ↓
detail table / graph（読むだけ）
```

Checkpoint 3はこれを**そのまま維持**したまま、末端にexport経路を追加する:

```
automatic rc2 (coordinator.getRecordSetSnapshot())
        +
validated review session (coordinator.getReviewSession())
        ↓
Checkpoint 1 projection (TraceComparisonReviewProjectionCore.projectEffectiveReviewedResultSet)
        ↓
Checkpoint 2 projectionCache（既存、無変更）
        ↓
Checkpoint 2への最小runtime bridge（新設、§0.2）
        ↓
Checkpoint 3 export adapter（新規）
        ├─ reviewed JSON
        └─ reviewed Excel
```

export adapterは**projectionCacheが既に確定した値だけを読み、何も再計算・再判定しない**。
automatic側の既存export（`downloadTraceComparisonRecordSet`/`#traceComparisonDownloadBtn`）と
既存Excel export（`exportDetailWorkbook`/`exportTraceWorkbook`）は**無変更**のまま維持し、
レビュー済み成果物は別ボタン・別ファイルとして追加する。

## 0.1 変更予定ファイル

```
tools/trace_comparison_review_export_core.js              (新規。Checkpoint 3のpure export core)
tools/json_ab_trace_matching_tool_v12.1.15.html            (追記のみ、次の5点):
  (a) <script src="./trace_comparison_review_export_core.js"></script> の追加
      （既存のreview core 3本 —
        trace_comparison_review_state_core.js /
        trace_comparison_review_session_core.js /
        trace_comparison_review_projection_core.js — の読込み行の直後に追加する。
        現在のHTMLはCheckpoint 2までの3 coreしかロードしておらず、本Rev.4で
        4本目のscript読込みを追記する）
  (b) Checkpoint 2 IIFE内への§0.2 runtime bridge追記
      （captureReviewedExportState/reviewedExportStateStillCurrent/
        peekReviewedExportReadyの3関数。peekReviewedExportReadyはRev.5で判明した
        実装事項4への対応として追加。既存行は1行も変更していない）
  (e) Stage 2R-D IIFE（V11.17、行列/RO-Crate機能。B-4bとは無関係の既存機能、
      `window.__v1117`公開面を持つ）の`window.__v1117 = Object.freeze({...})`へ、
      `addJsonSheet`/`writeWorkbook`の2つを追記（Rev.5で判明した実装事項1への対応。
      既存のプロパティ・関数本体は変更していない）
  (c) 末尾に新しいCheckpoint 3 script block追加
  (d) レビュー済み成果物パネルのHTML追加(§4)
tools/design_notes/b4b_checkpoint3_export_design.md         (本ファイル)
tools/design_notes/trace_comparison_review_export_core_verification.js  (新規、Node検証)
tools/design_notes/b4b_checkpoint3_export_ui_verification.js            (新規、Playwright検証)
```

**新規fixtureファイルは不要**と判断する。理由（§9.3で詳述）: リポジトリ調査の結果、
`tools/design_notes/package.json`は既に`xlsx: "0.18.5"`をdevDependencyとして固定しており
（`package-lock.json`commit済み、`npm ci`で再現）、かつ`tools/design_notes/
quantity_annotation_excel_xlsx_verification.js`が、まさに同じ問題（製品HTMLがCDNから
SheetJSを読み込むが、Playwrightはネットワーク遮断方針）に対して、`page.route()`で
CDN URLをローカルの`require.resolve('xlsx/dist/xlsx.full.min.js')`へ差し替える方式を
**既に確立済み**であることを確認した。Checkpoint 3のPlaywright検証もこの既存パターンを
そのまま踏襲するため、新しいバイナリ/フェイクを追加コミットする必要がない。

## 0.2 Checkpoint 2 IIFEへの最小runtime bridge追記（Blocker 1対応）

`tools/json_ab_trace_matching_tool_v12.1.15.html`のCheckpoint 2スクリプト（12683行の
`<script>`〜13249行の`</script>`、IIFE本体は12692〜13248行）を実際に読み直した結果、
Rev.2が前提としていた

```js
b4bProjectionCache
b4bCoordinator
recomputeAndCacheProjection()
```

は、いずれもこのIIFEの中に閉じたprivate変数・関数であり、IIFE外（=新設するCheckpoint 3の
別scriptブロック）から直接参照できない。IIFE外に公開されているのは13239行の

```js
window.__b4bCheckpoint2Diagnostics = Object.freeze({
  coordinator: () => b4bCoordinator,
  projectionCache: () => b4bProjectionCache,
  recompute: () => recomputeAndCacheProjection(),
  renderSessionPanel: () => b4bRenderSessionPanel()
});
```

だけであり、これはコメントに明記されている通り「検査・受入試験用の読み取り専用診断API」
であって、製品機能（export）がこれを呼び出すことは設計しない（テスト専用の裏口を製品機能の
正式経路にしてしまうと、テストが緩んだ時に製品も一緒に壊れるため）。

したがって、Checkpoint 3では**Checkpoint 2 IIFEの既存行を1行も変更・削除せず**、
既存の`window.__b4bCheckpoint2Diagnostics = ...`定義の直後、
`recomputeAndCacheProjection();`呼び出しより前）に、新しい3関数
（`captureReviewedExportState`/`reviewedExportStateStillCurrent`/`peekReviewedExportReady`。
最後の1つはRev.5で実装時に追加、実装事項4参照）の定義と、新しい
`window`公開1個だけを**追記**する。

**Conditional Approve条件2対応**: 当初案は`captureReviewedExportState()`の戻り値に
`cache: b4bProjectionCache`を含めていたが、`b4bProjectionCache`には`matcherAIndex`/
`matcherBIndex`/`matcherPairIndex`という`Map`が含まれており、トップレベルを
`Object.freeze()`してもMapの中身は不変化されない。正式製品APIとしてcache全体を返すと、
Checkpoint 3の利用者がdetail/graph用indexを書き換えられる新しいmutation面になってしまう。
これを避けるため、**bridge外へ公開してよい値は`projected`・`session`・`recordSet`の3つのみ**
とし、cache参照と`reviewSourceEpoch`はbridge内部の`WeakMap`にCASトークンとして隠す。

```js
// ─── Checkpoint 3向け正式runtime bridge。__b4bCheckpoint2Diagnosticsとは別物で、
//     製品機能(export)が実際に依存する唯一の公開面とする。
//     cache参照(matcherAIndex/matcherBIndex/matcherPairIndexというMapを含む可変オブジェクト)
//     とreviewSourceEpochは公開せず、WeakMapへ内部CASトークンとして隠す。 ───
const b4bReviewedExportCaptures = new WeakMap();

function captureReviewedExportState() {
  const err = b4bPreconditionError();
  if (err) return Object.freeze({ ok:false, code:'review_export_not_ready', detail:err });
  if (b4bCoordinator.isReviewStartInFlight() || b4bCoordinator.isReviewTransitionInFlight()) {
    return Object.freeze({
      ok:false, code:'review_export_not_ready', detail:'レビュー操作の処理中です。'
    });
  }
  // 唯一のprojection計算窓口を必ず経由してcacheを最新化してからcaptureする。
  recomputeAndCacheProjection();
  const cache = b4bProjectionCache;
  if (cache.status !== 'ready') {
    return Object.freeze({
      ok:false, code:'review_export_not_ready', detail:'projectionCacheがready状態ではありません。'
    });
  }
  const session = b4bCoordinator.getReviewSession();
  const recordSet = b4bCoordinator.getRecordSetSnapshot();
  const reviewSourceEpoch = b4bCoordinator.getReviewSourceEpoch();
  // 公開する capture オブジェクトには projected/session/recordSet の3つだけを載せる。
  const capture = Object.freeze({ ok:true, projected: cache.projected, session, recordSet });
  // cache参照・epochはWeakMap側にのみ保持する(captureそのものをキーにするため、
  // captureが外部でGCされればエントリも自然に消える)。
  b4bReviewedExportCaptures.set(capture, { cache, session, recordSet, reviewSourceEpoch });
  return capture;
}

function reviewedExportStateStillCurrent(capture) {
  if (!capture || capture.ok !== true) return false;
  const refs = b4bReviewedExportCaptures.get(capture);
  if (!refs) return false;  // このIIFEが発行したcaptureでなければ無条件にfalse
  if (b4bPreconditionError() !== null) return false;
  if (b4bCoordinator.isReviewStartInFlight() || b4bCoordinator.isReviewTransitionInFlight()) return false;
  if (b4bProjectionCache !== refs.cache) return false;
  if (b4bProjectionCache.status !== 'ready') return false;
  if (b4bCoordinator.getReviewSession() !== refs.session) return false;
  if (b4bCoordinator.getRecordSetSnapshot() !== refs.recordSet) return false;
  if (b4bCoordinator.getReviewSourceEpoch() !== refs.reviewSourceEpoch) return false;
  return true;
}

// 表示専用の読み取りだけのpeek(cache参照・session参照は一切公開しない、booleanのみ返す)。
// captureReviewedExportState()と違い、recomputeAndCacheProjection()を呼ばない
// (=既存のensureLazyTabRendered()経由の非同期再描画を新たに起こさない)。
// b4bRenderSessionPanel()が呼ばれた時点でCheckpoint 2側のrecomputeAndCacheProjection()は
// 既に実行済みでb4bProjectionCacheは最新のため、ボタンの有効/無効という表示目的だけなら
// 読み直すだけで十分であり、再計算は不要。UIの定期/イベント駆動更新はこちらだけを使い、
// 実際のexport実行(クリック時)は引き続きcaptureReviewedExportState()を使う(実装事項4、Rev.5)。
function peekReviewedExportReady() {
  if (b4bPreconditionError() !== null) return false;
  if (b4bCoordinator.isReviewStartInFlight() || b4bCoordinator.isReviewTransitionInFlight()) return false;
  return b4bProjectionCache.status === 'ready';
}

window.TraceComparisonReviewRuntime = Object.freeze({
  captureReviewedExportState,
  reviewedExportStateStillCurrent,
  peekReviewedExportReady
});
```

- `captureReviewedExportState()`/`reviewedExportStateStillCurrent()`は既存の
  `b4bPreconditionError()`・`b4bCoordinator`・`b4bProjectionCache`・
  `recomputeAndCacheProjection()`を**呼ぶだけ**で、これらの実装には一切手を入れない。
- `getReviewSourceEpoch()`・`isReviewStartInFlight()`・`isReviewTransitionInFlight()`は
  Checkpoint 2完成時点で既に`b4bCoordinator`が公開しているメソッドであり
  （`trace_comparison_review_session_core.js` 1377〜1383行）、Checkpoint 3のために
  coordinator/session core側へ新しいメソッドを追加する必要はない。
- `cache`/`session`/`recordSet`は、いずれもCheckpoint 2までの実装で「遷移のたびに新しい
  frozenオブジェクトへ丸ごと差し替える（部分mutationしない）」契約になっている
  （projectionCacheの陳腐化検出、およびStage 1のsession不変更新パターンがこの前提の上に
  既に成立している）。そのため参照の`===`比較だけで状態変化を健全に判定できる。
- CAS強度はWeakMap導入前と変わらない（比較対象は同じ4値: cache参照・session参照・
  recordSet参照・reviewSourceEpoch）。変わるのは「これらのうちcache参照とepochを、
  製品APIの戻り値としては公開せず、bridge内部だけで保持する」という公開面の範囲だけである。
- `window.__b4bCheckpoint2Diagnostics`は変更しない（既存のテスト・受入検証はそのまま動く）。
  `window.TraceComparisonReviewRuntime`は新設の別オブジェクトであり、Checkpoint 3の
  export adapterだけがこれを呼ぶ。

### Checkpoint 2 frozen原則との関係（明示的な位置付け）

Checkpoint 2の判定・projection・renderer契約はfrozenのままである。Checkpoint 3は
Checkpoint 2の確定済み状態を安全にcaptureするため、Checkpoint 2 IIFEの末端に
**read-onlyなbridgeだけ**を追加する。この追加が許される範囲は次の3条件を満たす場合に
限る: 既存行を1行も変更・削除しない、既存の公開diagnostics API（`window.
__b4bCheckpoint2Diagnostics`）を変更しない、追記する関数は既存の公開/準公開メソッドを
呼ぶだけで新しい判定ロジックを持たない（Rev.5で`peekReviewedExportReady()`を1関数追加した
が、これも既存の`b4bPreconditionError()`/`b4bCoordinator`/`b4bProjectionCache`を
読むだけで、新しい判定ロジックは持たない。実装事項4への対応、§0.2参照）。

同様に、V11.17 Stage 2R-D IIFE（B-4bとは無関係の既存機能）についても、既存行は1行も
変更・削除せず、既存の`window.__v1117`公開面へ`addJsonSheet`/`writeWorkbook`の2関数を
追記するだけに留める（実装事項1への対応、§0.1・§1参照）。

次は明示的に禁止する（Checkpoint 3のどの実装作業でも行わない）:

- `recomputeAndCacheProjection()`本体の変更
- `b4bProjectionCache`形状の変更
- 既存diagnostics API（`window.__b4bCheckpoint2Diagnostics`）の変更
- detail/graph rendererの変更
- coordinator/core（`trace_comparison_review_state_core.js`/
  `trace_comparison_review_session_core.js`/`trace_comparison_review_projection_core.js`）の変更

## 1. 既存export関数の調査結果（流用可否の切り分け）

本ツールを調査した結果、Excel出力は歴史的経緯で複数系統が併存しており、現在実際に
動いているのは`intercept()`によるcapture-phase上書き経由の系統だけである。

| 関数/仕組み | 状態 | 流用可否 |
|---|---|---|
| `downloadText(filename, text, mime)`（既存、JSON等テキスト保存の共通ヘルパー） | 現役 | **流用可**。reviewed JSON保存にそのまま使う。jobを要求しない（既存の`downloadTraceComparisonRecordSet`もjob無しで直接呼んでいる）。 |
| `downloadBlob(name, blob)`（既存、バイナリ保存の共通ヘルパー。`URL.revokeObjectURL`の後始末付き） | 現役 | **流用可**。`writeWorkbook()`経由でreviewed Excel保存の最終書き出しに使う。 |
| `addJsonSheet(wb, name, rows)`（現行`exportDetailWorkbook`/`exportTraceWorkbook`が使う、行配列→シート変換＋列幅自動調整＋シート名31文字切り詰め） | 現役 | **流用可**。reviewed Excelの各シート生成に使う。新しい類似ヘルパーを増やさない。**Rev.5判明**: この関数はV11.17 Stage 2R-D専用の別IIFE（11220〜11790行）内のprivate関数であり、他のscriptブロックから直接は参照できない。既存の`window.__v1117`公開面へこの関数を追記し、Checkpoint 3からは`__v1117.addJsonSheet(...)`として呼ぶ（実装は無変更、公開面だけ追加）。 |
| `beginMatchingJob`/`updateMatchingProgress`/`finishMatchingJob`/`failMatchingJob`/`assertMatchingNotCancelled`/`MatchingCancelledError`（既存job lifecycle一式、1933〜2016行） | 現役 | **流用可・必須**。`writeWorkbook()`はjob引数を要求し内部で`assertMatchingNotCancelled`を呼ぶため、reviewed Excel側も同じlifecycleに従う（§5.2で詳述）。これらは`addJsonSheet`/`writeWorkbook`とは異なる、素の`<script>`ブロック（1633〜9383行、IIFEでラップされていない）に属しており、真にグローバルなため直接参照できる。 |
| `writeWorkbook(wb, filename, job)`（`XLSX.write(...,{bookType:'xlsx',type:'array',compression:true})` → `downloadBlob`） | 現役 | **流用可**。ワークブック確定後の書き出しに使う。単純なserializerではなくjob付きの非同期関数である点に注意（§5.2）。**Rev.5判明**: `addJsonSheet`と同じくV11.17 Stage 2R-D IIFE内のprivate関数であり、`__v1117.writeWorkbook(...)`として呼ぶ。 |
| `addWorkbookSheet(wb, name, rows)`（`bindStage2RExports`専用の類似ヘルパー） | **死んでいる**（`intercept`により上書きされ呼ばれない旧経路） | 流用しない（死んだ経路に依存すると混乱するため）。 |
| `exportDetailWorkbook`/`exportTraceWorkbook`本体（`機械判定`/`有効判定`/`レビュー判定`等、Phase 7のeffective-mode判定列を含む行を組み立てるロジック） | 現役だが対象外の判定系統 | **流用しない・混在させない**。これはPhase 7の手動トレース関係レビュー（B-4a/B-4bの数量比較レビューとは無関係、設計書§0で既に区別済み）の判定であり、reviewed Excelの列にPhase 7由来の値を混ぜると「どちらの判定か」が読み手に分からなくなる。reviewed Excelは`projectionCache`由来の値のみで構成する。ただしjob lifecycleの**使い方**（beginMatchingJob→...→writeWorkbook→finishMatchingJob、catchでfailMatchingJob）は、この2関数と同じ形をそのまま踏襲する（§5.2）。 |
| `generateTraceComparisonRecordSet`（automatic rc2生成） | 現役、automatic exportが使う | **呼び出さない**。reviewed exportは`coordinator.getRecordSetSnapshot()`が既に保持する確定済みsnapshotを読むだけで、これを再生成・再検証しない（再生成するとCheckpoint 2のsingle-source原則に反する）。 |

列名・シート名の慣例（調査結果）: 既存シートは日本語名（`照合結果一覧`・`レビュー反映トレース`等、
Excelのシート名31文字制限に`.slice(0,31)`で対応）、識別子列は`A_ID`/`B_ID`のようなASCII、
複数シート構成の最後に`Settings`（英語、バージョン・出力日時等のメタ情報）を置く慣例がある。
reviewed Excelもこれに合わせ、シート名は日本語（`レビュー済み比較`等）、列見出しは
契約フィールド名に準じたASCII/スネークケースまたは分かりやすい日本語ラベルの併記とし、
メタ情報シートは`Settings`ではなく`Review Metadata`という新シート名にする
（automatic側の`Settings`シートと混同させないため、意図的に区別する）。

## 2. reviewed JSON artifactの正式構造

`TraceComparisonReviewProjectionCore`の実ファイルを再確認した結果、
`projectEffectiveComparisonResult`が返す`result`の実フィールド名は
`automatic`（`state`/`satisfied`/`judgement_source`/`human_confirmed`）・`review_overlay`・
`effective_satisfaction`・`satisfaction_eligible`・`all_reviewed`・`session_context`
である（`trace_comparison_review_projection_core.js` 196〜208行）。

exportの契約フィールド名は、rc2 record自体が既に使っている`automatic_judgement`という
名前に合わせる（rc2 recordの`automatic_judgement`と同じ4サブフィールド、値は
`projected.result.comparisons[id].automatic`をそのままコピーするだけで、**値の再計算・
再解釈は一切行わない**。フィールド名だけをexport契約の語彙に統一する）。

`review_session`は、`trace_comparison_review_state_core.js`の`createInitialReviewSessionState`
（154行）が確定させているsession本体のフィールド集合（`overlay_version, session_id,
session_status, session_revision, started_at, started_by, stale_runtime, live_source_marker,
snapshot_identity, comparisons`）のうち、`stale_runtime`（exportはready＝active session時のみ
なので常に`null`で情報量がない、§6）と`comparisons`（`session.comparisons`はレビュー入力の
生データであり、top-levelの`comparisons[]`が既により豊富な形でこれを包含している。二重に
載せると「どちらが正か」の曖昧さを生むため含めない）を除く全フィールドをそのまま転記する。

**`live_source_marker`・`snapshot_identity`の値・prefixは、実ファイルを再確認して
正確な契約に修正する**（Rev.2の例は簡略化しすぎており、`overlay_version`の値や
prefix文字列が実際のコードと一致していなかった）。

- `overlay_version`の正式値: `trace_comparison_review_state_core.js` 9行の
  `OVERLAY_VERSION = 'b4-review-overlay/1.0-runtime'`。数値ではなく、この文字列をそのまま転記。
- `live_source_marker.value`の正式prefix: `trace_comparison_review_session_core.js` 24行の
  `LIVE_SOURCE_MARKER_PREFIX = 'b4-live-source-v1:'`。形式は`b4-live-source-v1:<64桁小文字hex>`。
- `snapshot_identity.value`の正式prefix: 同ファイル25行の
  `SNAPSHOT_IDENTITY_PREFIX = 'b4-snapshot-v1:'`。形式は`b4-snapshot-v1:<64桁小文字hex>`。
- `live_source_marker`の正式フィールド集合は11個であり（`validLiveSourceMarker`、同ファイル
  366〜383行）、一部だけの例示ではなく全フィールドをそのまま転記する契約とする:
  `value, review_source_epoch, matching_run_id, matching_generation, binding_generation,
  binding_snapshot_digest, binding_identity, requirement_dataset_signature,
  actual_dataset_signature, matching_dataset_signature, relation_snapshot_digest`

```jsonc
{
  "artifact": "trace-comparison-reviewed/1.0",
  "generated_at": "2026-07-28T00:00:00.000Z",           // 生成時に決まる唯一の可変項目
  "generator": { "tool": "json_ab_trace_matching_tool_v12.1.15.html", "version": "12.1.15" },

  "source_identity": {
    // coordinator.getRecordSetSnapshot()のprovenance/sourceをそのまま転記(再計算なし)
    "schema_version": "trace-comparison/1.0-rc2",
    "requirement_trace_file": "...",
    "actual_trace_file": "...",
    "requirement_dataset_signature": "QA-SHA256:...",
    "actual_dataset_signature": "QA-SHA256:...",
    "matching_dataset_signature": "DS:..."               // display_context由来、既存rc2と同じ値
  },

  "review_session": {
    // coordinator.getReviewSession()から、stale_runtime/comparisonsを除く全フィールドを転記。
    // live_source_marker/snapshot_identityは値の再計算をせずオブジェクトをそのままコピーする。
    "overlay_version": "b4-review-overlay/1.0-runtime",
    "session_id": "...",
    "session_status": "active",             // exportはready(=active)時のみなので常にこの値
    "session_revision": 3,
    "started_at": "...",
    "started_by": "...",
    "live_source_marker": {
      "value": "b4-live-source-v1:9f1c2a...(64桁小文字hex)",
      "review_source_epoch": 2,
      "matching_run_id": 5,
      "matching_generation": 5,
      "binding_generation": 3,
      "binding_snapshot_digest": "SHA-256:...(64桁小文字hex)",
      "binding_identity": "b4-binding-v1:...(64桁小文字hex)",
      "requirement_dataset_signature": "QA-SHA256:...",
      "actual_dataset_signature": "QA-SHA256:...",
      "matching_dataset_signature": "DS:...",
      "relation_snapshot_digest": "SHA-256:...(64桁小文字hex)"
    },
    "snapshot_identity": {
      "value": "b4-snapshot-v1:...(64桁小文字hex)",
      "schema_version": "trace-comparison/1.0-rc2",
      "record_set_digest": "SHA-256:...(64桁小文字hex)"
    }
  },

  "comparisons": [
    {
      "comparison_id": "cmp-v1:...",
      // 識別のためのorientation列。recordSetからそのまま転記、判定は含まない。
      "requirement_ref": { "trace_id": "...", "matcher_id": "...", "quantity_id": "..." },
      "actual_ref": { "trace_id": "...", "matcher_id": "...", "quantity_id": "..." },

      "automatic_judgement": {
        "state": "satisfied",                // projected.automatic.stateのコピー
        "satisfied": true,                    // projected.automatic.satisfiedのコピー
        "judgement_source": "automatic_pipeline",
        "human_confirmed": false
      },
      "review_overlay": {
        "quantity_extraction": { "status": "reviewed", "reviewer": "...", "reviewed_at": "...", "verdict": "accept", "note": null },
        "property_mapping":    { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
        "interval_semantics":  { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
        "comparison_mode":     { "status": "unreviewed", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null },
        "satisfaction":        { "status": "not_eligible", "reviewer": null, "reviewed_at": null, "verdict": null, "note": null }
      },
      "satisfaction_eligible": false,        // projectedの値をそのままコピー
      "effective_satisfaction": null,        // projectedの値をそのままコピー(null≠undefined、後述)
      "all_reviewed": false                  // projectedの値をそのままコピー
    }
  ]
}
```

`comparisons`の並び順は`recordSet.comparisons`（rc2生成時に`compareComparisonRecords`で
既に安定ソート済み、`quantity_sidecar_binding_core.js` 2823行）の配列順をそのまま使う。
`Object.keys(projected.result.comparisons)`（projectionの戻り値はcomparison_idをキーとする
オブジェクト）は使わない。理由は2つ: (1) オブジェクトキー順への依存を避け、rc2が既に
確定した唯一の順序契約に一本化する、(2) `recordSet.comparisons`の各要素から
`requirement_ref`/`actual_ref`のorientation列も同時に取れる。

**`session_context`（projectionの`present`/`status`）はexport契約に含めない**。exportは
`ready`状態でのみ許可する設計（§6）であるため、`present`は常に`true`・`status`は常に
`'active'`固定になり、契約に含めても情報量がない。ただしこの値自体は§7.3の境界検証で
（含めないからこそ、含めない前提が本当に成立しているかを）内部的に検査する。

## 3. Excel sheet/column構造

2 sheet構成とする。

### Sheet 1: `レビュー済み比較`（1 comparison_id = 1 row）

| 列 | 内容 |
|---|---|
| `comparison_id` | |
| `requirement_trace_id` / `requirement_matcher_id` / `requirement_quantity_id` | orientation、`requirement_ref`より |
| `actual_trace_id` / `actual_matcher_id` / `actual_quantity_id` | orientation、`actual_ref`より |
| `automatic_state` / `automatic_satisfied` / `automatic_judgement_source` / `automatic_human_confirmed` | `automatic_judgement`の4フィールド |
| `quantity_extraction_status` / `_reviewer` / `_reviewed_at` / `_verdict` / `_note` | |
| `property_mapping_status` / `_reviewer` / `_reviewed_at` / `_verdict` / `_note` | |
| `interval_semantics_status` / `_reviewer` / `_reviewed_at` / `_verdict` / `_note` | |
| `comparison_mode_status` / `_reviewer` / `_reviewed_at` / `_verdict` / `_note` | |
| `satisfaction_status` / `_reviewer` / `_reviewed_at` / `_verdict` / `_note` | |
| `satisfaction_eligible` | |
| `effective_satisfaction` | |
| `all_reviewed` | |

`requirement_quantity_id`/`actual_quantity_id`（quantity_pair traceability列）を含め、
5項目 × 5フィールド = 25列 + orientation 6列 + automatic 4列 + satisfaction系3列 +
`comparison_id` = **39列**。

`actual_ref.source_row`は**含めない（非対象）**と明示的に決定する。理由: `source_row`は
`actual_ref`にオプショナルで存在する場合としない場合があり、"ある時だけ列に値が入り、
無い時は空欄になる"という曖昧な扱いを持ち込むと、境界の型を契約として固定するという
§7の趣旨と矛盾する。`comparison_id`だけで各行を一意に追跡できるため、`source_row`は
reviewed成果物の識別には不要と判断する。将来これが必要になった場合は、別途「任意フィールド
として省略可能である」ことを契約に明記した上で追加する、Checkpoint 3の範囲外の変更とする。

`note`はセル内の生テキストをそのまま出す（改行を含みうるため、既存の`formatCellMultiline`
相当の扱いに合わせるかは実装時に既存Excel出力の折返し設定を踏襲する）。`null`は空セル、
`false`/`true`は真偽値としてそのまま出力し、「承認済み」「不一致」等の意味変換した文言へ
書き換えない（値そのものを出す。判定はしない）。

### Sheet 2: `Review Metadata`

`artifact`/`generated_at`/`generator`/`source_identity`の各フィールド、
`review_session`の各フィールド（`live_source_marker`/`snapshot_identity`は
ネストしたオブジェクトなので、key/valueの1行にはせず、それぞれのサブフィールドを
`live_source_marker.value`のようなドット区切りキー名で個別行として展開する。
これで11＋3フィールドがすべて監査可能な形でシートに現れる）、
`comparisons.length`（件数）、`comparisons.filter(all_reviewed).length`
（全項目レビュー済み件数）、`comparisons.filter(effective_satisfaction===true/false/null).length`
（内訳集計、表示用の**単純集計**であり新しい判定ではない）を、key/valueの2列で列挙する。

両シートとも、JSON artifactを**1回構築した後にその内容をそのまま行配列へ変換するだけ**で
作る（§5のデータフロー参照）。Excel側で`projectionCache`や`recordSet`を再度読み直したり、
JSONと別々に値を算出したりしない。

## 4. automatic exportとのUI上の分離方法

既存の「trace-comparison成果物（opt-in）」パネル（`#traceComparisonDownloadBtn`）、
既存のExcel出力ボタン（`#downloadExcelBtn`/`#dlDetailExcelBtn`）は無変更のまま維持する。

Checkpoint 2の「数量比較レビュー（B-4b, Checkpoint 2・opt-in）」パネル
（`#b4bReviewSessionPanel`）の直後に、新しい`output-group`を追加する:

```
┌─ 数量比較レビュー（B-4b, Checkpoint 2・opt-in）── 無変更 ──┐
│ [未レビュー/レビュー中/古い] reviewer入力 [開始][破棄]        │
└──────────────────────────────────────────┘
┌─ レビュー済み成果物（B-4b, Checkpoint 3・opt-in）── 新規 ──┐
│ 状態: レビュー中のsessionから生成します（ready時のみ有効）。 │
│ [レビュー済みJSON保存] [レビュー済みExcel保存]               │
│ ステータス: ...                                              │
└──────────────────────────────────────────┘
```

見出しに「自動照合成果物」「レビュー済み成果物」の対比を明記し、ボタン文言にも
「レビュー済み」を必ず含める（`レビュー済みJSON保存`/`レビュー済みExcel保存`）ことで、
既存の`trace-comparison JSONを生成・検証して保存`・`照合結果一覧Excel出力`との
取り違えを防ぐ。ダウンロードされるファイル名にも`_reviewed`サフィックスを付ける
（例: `${graphNameOrDefault()}_trace_comparison_reviewed.json`/`.xlsx`）。

## 5. projectionCache → exportまでのデータフロー

Checkpoint 3のHTML側（新しいscript block）は、§0.2で追記する
`window.TraceComparisonReviewRuntime`だけを使い、`b4bCoordinator`/`b4bProjectionCache`/
`recomputeAndCacheProjection()`へ直接触れない。identity再検証・境界検証・artifact構築は
**すべて`TraceComparisonReviewExportCore.buildReviewedExportArtifact()`という単一のasync pure
core呼び出しの内部**で行う（Blocker 3対応: 検証層をHTML/UIとcoreの2箇所に分けない）。

```
① capture（UI側、同期。§0.2のruntime bridgeを呼ぶだけ）:
   const captured = window.TraceComparisonReviewRuntime.captureReviewedExportState();
   if (!captured.ok) → 中止(§6、captured.code === 'review_export_not_ready')
   // captured は §0.2 のとおり {ok, projected, session, recordSet} のみを持つ
   // (cache参照・reviewSourceEpochはbridge内部のWeakMapに隠されており、ここでは見えない)。

② build（UI側は呼ぶだけ。中身は全てexport core内部、非同期）:
   const built = await TraceComparisonReviewExportCore.buildReviewedExportArtifact({
     recordSet: captured.recordSet,
     session: captured.session,
     projected: captured.projected,
     generatedAt: new Date().toISOString(),
     generator: { tool:'json_ab_trace_matching_tool_v12.1.15.html', version:'12.1.15' }
   });
   if (!built.ok) → 中止(§8 fail-closed。built.diagnostics[0].codeは
     review_artifact_invalid / review_artifact_identity_mismatch / review_session_stale のいずれか)

③ CAS再確認（UI側、同期。§0.2のruntime bridgeを呼ぶだけ）:
   if (!window.TraceComparisonReviewRuntime.reviewedExportStateStillCurrent(captured)) {
     → 中止(review_session_stale相当)。ダウンロードは実行しない。
       UIには「レビュー中に状態が変わったため保存を中止しました。もう一度お試しください。」
       を表示する。
   }

④ ③を通過した場合のみダウンロードを実行する（§5.1・§5.2）。
```

`buildReviewedExportArtifact()`の内部（②の中身、export core自身の責務）は次の順で行う。
いずれも「受け取った値の構造・型を検査する」だけで、値の再計算・再判定は一切しない。
**Conditional Approve条件3対応**: session構造不正とstale、およびidentity検証失敗の
diagnostics変換を、次のとおり分ける（当初案は前者を一律`review_session_stale`、
後者を一律`review_artifact_invalid`へ丸めてしまっており、失敗理由が判別できなくなっていた）。

```
(a) session構造検証（構造の問題とstaleを分ける）:
    session === null または session === undefined
      → review_artifact_invalid
        (「レビュー未開始」と「レビューあり」の区別はcaptureReviewedExportState()の
         review_export_not_ready判定で既に排除済みだが、core自身も引数の型を信頼せず
         同じ結論を独立に出す)
    TraceComparisonReviewStateCore.structurallyUsableSession(session) !== true
      → review_artifact_invalid
        (sessionの形そのものが契約と一致しない = artifactとしての入力自体が不正)
    上記を満たした上で session.session_status !== 'active'
      → review_session_stale
        (形は正しいが、staleなsessionからexportしようとしている = §6の
         「stale状態はexport不可」という業務ルール上の拒否)

(b) snapshot identity再検証（Blocker 2対応、失敗理由を保持する）:
    const identity = await TraceComparisonReviewSessionCore.computeSnapshotIdentity({
      exactRecordSetSnapshot: recordSet,
      liveSourceMarker: session.live_source_marker
    });
    identity.ok !== true の場合:
      computeSnapshotIdentity()自身が返したdiagnostics[0]（code/severity/detailとも
      review_artifact_invalid または review_artifact_identity_mismatch のいずれかである
      ことは既存API自身の契約により保証されている）を、変換せずそのまま
      buildReviewedExportArtifact()の返り値へ転記する。一律review_artifact_invalidへ
      丸めない。
    identity.ok === true だが
      canonicalJson(identity.value) !== canonicalJson(session.snapshot_identity) の場合:
      review_artifact_identity_mismatch
      （1フィールドの部分一致ではなく、value/schema_version/record_set_digestの
      3フィールドをcanonical JSON文字列として完全一致比較する。この関数は既存の
      hash/identityアルゴリズムを一切再実装せず、Checkpoint 2/session coreが既に
      公開しているcomputeSnapshotIdentity()をそのまま呼ぶだけ）。
    canonicalJsonは、export coreのUMDファクトリへ既存coreと同じ注入パターンで渡す
    QuantitySidecarBinding.canonicalJsonをそのまま使う（新しい正規化関数を作らない）。
(c) 境界検証（§7、Blocker 3の追加明確化分を含む）。
(d) artifact構築（§2の契約どおり、値はすべてコピーのみ）。
```

**重要**: `buildReviewedExportArtifact()`は`recordSet`/`session`/`projected`を
**引数として受け取るだけ**で、内部で`TraceComparisonReviewProjectionCore`を呼び直さない。
projectionの再計算は`recomputeAndCacheProjection()`の1箇所だけ、という既存の単一source原則を
export層まで継承する。同様に`buildReviewedExcelSheets()`（§5.2・§8）は`artifact`を
行配列化するだけで、`automatic_judgement`や`review_overlay`の値を一切書き換えない。

JSON生成・Excel生成はともに`artifact`という**単一の中間表現**を経由するため、
両者が値について食い違うことは構造的にありえない（§9で恒久検査する）。

### 5.1 JSON経路（jobを使わない）

既存の`downloadTraceComparisonRecordSet`と同様、JSON保存はjob lifecycleを使わない
（`beginMatchingJob`を呼ばない）。③のCAS再確認を通過したら、その場で
`downloadText(filename, JSON.stringify(artifact, null, 2), 'application/json')`
（既存ヘルパーを再利用）を呼ぶだけで完結する。

### 5.2 Excel経路とjob lifecycle（設計整合修正）

`writeWorkbook(wb, filename, job)`（11661行）は単純なserializerではなく、`job`引数を要求し、
内部で`assertMatchingNotCancelled(job)`・`updateMatchingProgress(job, {...})`・
`await yieldToUi(0)`を行う。既存の`exportDetailWorkbook`/`exportTraceWorkbook`は
`beginMatchingJob → (シート組立) → writeWorkbook → finishMatchingJob`、
catchで`failMatchingJob` + `MatchingCancelledError`判定、という形を取っている
（11670〜11705行）。reviewed Excelもこれと同じ形をそのまま踏襲する。

ここで、`activeMatchingJob`は**ツール全体で単一のグローバルslot**であり
（`beginMatchingJob`は`activeMatchingJob = job`で無条件に上書きする、1953〜1963行）、
`b4bPreconditionError()`は`if (activeMatchingJob) return '...busy...'`を最初に検査する
（12736行）。したがって、③のCAS再確認（`reviewedExportStateStillCurrent()`が内部で
`b4bPreconditionError() === null`を要求する）より**前**に自分自身のExcel jobを開始すると、
自分の`activeMatchingJob`によって自分自身の再確認が「busy」として失敗する自己矛盾が起きる。

これを避けるため、Excel経路のjob開始は**必ず③のCAS再確認を通過した後**に行う、という
順序をCheckpoint 3の固定契約とする:

```
① capture → ② build（core内部、job不要） → ③ CAS再確認（job無し状態で判定）
  ↓ ③通過
④ built2 = TraceComparisonReviewExportCore.buildReviewedExcelSheets(built.artifact);
   // 同期・純粋。artifact自身のexact structureを検査するfail-closed API（§8、条件4対応）。
   if (!built2.ok) → 中止(§8 fail-closed。built2.diagnostics[0].codeは
     review_artifact_invalid のいずれか。ここで初めて失敗するのは、buildReviewedExportArtifact()
     が返したはずのartifactを、呼び出し側が誤った値にすり替えて渡した場合など、
     本来到達しないはずの経路の防御である)
  ↓ ④通過(built2.ok === true)
⑤ job = beginMatchingJob('レビュー済みExcel生成中', '生成中止')
⑥ try {
     const wb = XLSX.utils.book_new();
     built2.sheets.forEach(s => __v1117.addJsonSheet(wb, s.sheetName, s.rows));       // 既存ヘルパー(§0.1(e)でwindow.__v1117へ追記済み)
     await __v1117.writeWorkbook(wb, `${safeFileName(graphNameOrDefault())}_trace_comparison_reviewed_V12_1_15.xlsx`, job);
     finishMatchingJob(job, 'レビュー済みExcel保存完了');
   } catch (err) {
     failMatchingJob(job);
     if (!(err instanceof MatchingCancelledError)) { console.error(err); alert('レビュー済みExcel出力エラー: ' + err.message); }
   }
```

UIは必ず`buildReviewedExportArtifact()`（① ok:true artifact）→`buildReviewedExcelSheets()`
（④ ok:true sheets）→`addJsonSheet`/`writeWorkbook`、という順序を通す。この順序を
飛ばして`buildReviewedExcelSheets()`を単独で（`buildReviewedExportArtifact()`を経由しない
任意のオブジェクトを渡して）呼び出すコードパスは実装しない。

④⑤⑥の間で③の状態（session/recordSet/cache参照）を再度読み直すことはしない。理由:
`artifact`は③通過時点で既に境界検証済み・`Object.freeze`された**その時点のスナップショット**
であり、その後ライブのsession/recordSetが変化しても、既に確定した`artifact`オブジェクト
自体は影響を受けない（reviewed exportの意味論自体が「その時点のスナップショットを固定して
出力する」ことである）。③以降で扱うべき残りのリスクは「ユーザーがキャンセルボタンを押す」
ことだけであり、これは`writeWorkbook`内部の`assertMatchingNotCancelled`/
`MatchingCancelledError`という既存の仕組みがそのまま処理する（新しい仕組みを追加しない）。

## 6. ready/stale/error/unavailableのexport可否

| `captureReviewedExportState()`の結果 | export可否 | UI表示 |
|---|---|---|
| `ok:false, code:'review_export_not_ready'`（`b4bPreconditionError()`が非null、in-flight中、または`b4bProjectionCache.status !== 'ready'`のいずれか） | 不可 | `captured.detail`をそのまま表示するか、状態別に「レビューを開始すると保存できます。」「レビューが古くなっています。」「投影に失敗しているため保存できません。」等へ振り分ける。 |
| `ok:true` | **可**（続けて②③を実行し、③で不一致なら download 直前で中止） | ボタン有効 |

ボタンの有効/無効はUI側の事前ガードに過ぎない。実際の許可判定は
`captureReviewedExportState()`・`buildReviewedExportArtifact()`・
`reviewedExportStateStillCurrent()`の3箇所で独立に行われる。UI側の無効化を誤って外しても
これらが順に拒否する（Checkpoint 2で確立した「UIの無効化はcoreの契約を上書きしない」原則を
踏襲）。`review_export_not_ready`は`captureReviewedExportState()`（runtime bridge、UI寄りの
事前条件）専用の診断コードであり、`buildReviewedExportArtifact()`（export core）の
`diagnostics[].code`としては使わない（§8）。

stale状態のexportを「監査用に残したい」という将来要求が出た場合は、Checkpoint 3の
範囲外の別機能として扱う（§11）。

## 7. 境界検証（型検査・undefined拒否・exact structure）と`automatic_judgement`不変保証

`projected`はprojectionCacheが既に計算した信頼できる値だが、「信頼している」ことと
「境界で検査しない」ことは別である。`buildReviewedExportArtifact()`は以下を**すべて構造・
型の検査として**行う（値の再計算・再判定は一切行わない）。

### 7.1 ID集合の三者一致

- `recordSetComparisonIdSet(recordSet)`・`sessionComparisonIdSet(session)`・
  `Object.keys(projected.result.comparisons)`の3つの集合が完全一致することを検査する
  （Checkpoint 1 projection coreの`recordSetComparisonIdSet`/`sessionComparisonIdSet`/
  `sameIdSet`と同じ判定関数を、export core側でも同じ実装方針で用いる）。
- 不一致の場合は`review_artifact_identity_mismatch`でfail-closed。

### 7.2 構造一致検査（automatic_judgement / review_overlay）

- `recordSet.comparisons`の各要素について、`projected.result.comparisons[id].automatic`と
  当該要素の`automatic_judgement`の4フィールドが完全に一致することを検査する。
- `session.comparisons[id]`と`projected.result.comparisons[id].review_overlay`が
  （5項目×5フィールドすべて）完全に一致することを検査する。
- 不一致はprojectionCacheが古い/破損したrecordSet・sessionから計算されたことを意味するため
  `review_artifact_identity_mismatch`でfail-closed。**この比較は値の等価性チェックであり、
  どちらの値が正しいかを判定・再計算するものではない。**

### 7.3 session_contextの整合確認

- `projected.result.comparisons[id].session_context`が全件`{present:true, status:'active'}`
  であることを検査する（§2で契約から除外した理由の裏付け）。これ以外の値であれば
  `review_artifact_invalid`でfail-closed。

### 7.4 型の厳格検査・`undefined`拒否

- `effective_satisfaction`は`true`/`false`/`null`の3値以外を許容しない
  （`typeof`と`===`による厳格比較。truthy/falsyな判定はしない）。
- `satisfaction_eligible`・`all_reviewed`は`typeof value === 'boolean'`を要求する。
- `review_overlay`各ターゲットの`status`/`reviewer`/`reviewed_at`/`verdict`/`note`、
  および`artifact`トップレベル・`source_identity`・`review_session`の全フィールドについて、
  `value === undefined`であるものが1つでもあれば`review_artifact_invalid`でfail-closed。
  `null`は正当な値として許可し、`undefined`だけを拒否する。

### 7.5 `automatic_judgement`不変保証

- `buildReviewedExportArtifact()`は`recordSet`/`session`/`projected`のいずれも変更しない
  （引数を読むだけの純関数。Checkpoint 1 projection core・Checkpoint 2の
  `recomputeAndCacheProjection()`と同じ契約）。
- 返す`artifact`は`Object.freeze`（ネストしたオブジェクト・配列も含めて再帰的に凍結）する。
- `automatic_judgement`はprojectionの`automatic`フィールドの4値をそのままコピーするのみで、
  比較・判定・書き換えを一切行わない。
- 検証手段: Node側で、`recordSet`のcanonical JSON（`QuantitySidecarBinding.canonicalJson`）を
  `buildReviewedExportArtifact()`呼び出し前後で比較し完全一致することを確認する。加えて、
  生成された`artifact.comparisons[].automatic_judgement`の値が、対応する
  `recordSet.comparisons[].automatic_judgement`の値と完全一致することを1件ずつ検査する。

### 7.6 exact structure検査（境界検証の追加明確化）

`projected`について、少なくとも次をexact own enumerable data recordとして検査する。
Checkpoint 1 projection coreが既に使っているローカルヘルパー（`object`/`record`/
`enumerableDataDescriptor`/`exactDataRecord`、`Reflect.ownKeys`でsymbolキーも拾った上で
`typeof key !== 'string'`なら拒否、`Object.getPrototypeOf(value)`が`Object.prototype`か
`null`以外なら拒否、というプロトタイプ検査を含む）と同じ実装方針をexport core側でも用いる
（新しい検査方式を独自に作らない）。配列（`recordSet.comparisons`・`diagnostics`等）については
`trace_comparison_review_session_core.js`の`denseArray`（144行、own enumerable index keyが
`length`個ちょうど存在し、末尾に`length`自身のキーがあることを要求、疎配列・カスタム
prototypeの配列を拒否）と同じ判定方針を用いる。

```
projected:            exactly {ok, result, diagnostics}
projected.result:     exactly {comparisons}
各comparison:          exactly {automatic, review_overlay, effective_satisfaction,
                                satisfaction_eligible, all_reviewed, session_context}
automatic:             exactly {state, satisfied, judgement_source, human_confirmed}
review_overlay:        exactly 5 target(quantity_extraction/property_mapping/
                                interval_semantics/comparison_mode/satisfaction)
  各target:            exactly {status, reviewer, reviewed_at, verdict, note}
session_context:       exactly {present, status}
```

次を拒否対象として明示する: extra own property（契約にないフィールドの混入）、
missing property（欠落）、symbol property、accessor property（getter/setter経由の値）、
custom prototype（`Object.create(x)`等でプレーンオブジェクトでないもの）、sparse array
（歯抜け配列）、`undefined`値（§7.4）。

## 8. `buildReviewedExportArtifact()`の返り値形式（成功/失敗）

既存core群（projection core・session core）と同じ`{ok, ..., diagnostics}`形状に統一する。

- 成功: `{ ok:true, artifact:<再帰的にObject.freeze済み>, diagnostics:[] }`
- 失敗: `{ ok:false, artifact:null, diagnostics:[{code, severity, detail}] }`

`diagnostics[].code`は、既存coreが既に定義しているコードで意味が合う場合はそちらを
再利用し、本当に既存にない意味の場合のみ新規コードを追加する。**`review_export_not_ready`は
export core自身の診断コードには含めない**（Blocker 3対応: これは`projectionCache.status`という
UIレイヤーの状態を指す診断であり、export coreは`projectionCache`を引数として受け取らない
ため、coreの語彙として持つこと自体が層の混同になる。この診断は§0.2の
`captureReviewedExportState()`が返す`code`としてのみ存在する）。

| code | 意味 | 発生元 | 既存/新規 |
|---|---|---|---|
| `review_artifact_invalid` | `session`が`null`/`undefined`、`structurallyUsableSession(session)!==true`、`recordSet`/`projected`/`artifact`自体の構造不正、`undefined`混入、`session_context`不整合、exact structure違反、`computeSnapshotIdentity()`自身がこのcodeで失敗した場合など（§5(a)(b)） | `buildReviewedExportArtifact()`（export core） | 既存（projection core）を再利用 |
| `review_artifact_identity_mismatch` | comparison_id集合不一致、automatic_judgement/review_overlay構造不一致、snapshot_identity再検証の値不一致（`canonicalJson`完全一致比較で不一致）、または`computeSnapshotIdentity()`自身がこのcodeで失敗した場合（§5(b)） | `buildReviewedExportArtifact()`（export core） | 既存（projection core）を再利用 |
| `review_session_stale` | `session`の構造自体は正しい（`structurallyUsableSession(session)===true`）が`session.session_status!=='active'`（§5(a)、条件3対応: 構造不正とstaleを区別する） | `buildReviewedExportArtifact()`（export core） | 既存（session core）を再利用 |
| `review_export_not_ready` | `b4bPreconditionError()`が非null、start/transition in-flight中、または`projectionCache.status!=='ready'`（§6） | `captureReviewedExportState()`（runtime bridge、§0.2） | **新規**。既存コードは「projectionが古い/エラー」ではなく「artifact/sessionの構造」を指すものしかなく、意味が異なるため新設する。exportCore自身の診断語彙には含めない。 |

### `buildReviewedExcelSheets(artifact)`の返り値形式（条件4対応、新設）

当初案の`artifactToExcelSheets(artifact)`は、入力を無条件に信頼する同期関数であり、
「正式成果物を作る公開API」としては`buildReviewedExportArtifact()`を経由しない
偽artifact（テストや将来の誤用で直接組み立てられたオブジェクト）からもExcel rowsを
生成できてしまう欠陥があった。これを避けるため、`buildReviewedExcelSheets(artifact)`
という名前のfail-closed APIへ変更する。

- 成功: `{ ok:true, sheets:[{sheetName, rows}, {sheetName, rows}], diagnostics:[] }`
- 失敗: `{ ok:false, sheets:null, diagnostics:[{code, severity, detail}] }`

この関数は呼び出しの冒頭で、渡された`artifact`が§2の契約どおりの構造
（`artifact`/`generated_at`/`generator`/`source_identity`/`review_session`/`comparisons`の
exact structure、`comparisons`の各要素が§2のフィールドをexactに持つこと、`denseArray`と
同じ判定方針での配列健全性）を満たすかを検査し、満たさない場合は`review_artifact_invalid`で
`ok:false`を返す。この検査は`buildReviewedExportArtifact()`内部の§7境界検証と同じ
ヘルパー関数群（`exactDataRecord`等）を再利用し、別の判定方式を新設しない。

検査を通過した場合のみ、artifactの値をそのまま行配列へ変換する（値の再計算・再解釈は
一切行わない）。UIは必ず`buildReviewedExportArtifact()`（ok:true artifact）→
`buildReviewedExcelSheets()`（ok:true sheets）→`addJsonSheet`/`writeWorkbook`の順で呼ぶ
（§5.2）。`artifactToExcelSheets`という名前の、検証を行わない同期ヘルパーは公開しない
（実装上、`buildReviewedExcelSheets`の内部でのみ使うprivateな行配列変換ロジックとして
残す場合はexportしない）。

## 9. JSON/Excel parity保証

§5のとおりJSON・Excelは共に`artifact`という単一の中間表現を経由するため、構造的に
値が分岐しない設計だが、これを「たまたま一致している」ではなく恒久検査で担保する。

**条件5対応**: 当初のparity検査は`automatic_judgement`・一部の`review_overlay`フィールド・
`satisfaction`系のみを対象としており、次のような誤配線を検出できなかった: quantity IDの
左右取り違え、reviewerの別targetへの混入、`reviewed_at`の欠落、`note`の欠落または列ずれ、
`live_source_marker`のMetadata欠落、`snapshot_identity`のMetadata誤転記。Rev.4では
`レビュー済み比較`シートの**39列すべて**と`Review Metadata`シートの全項目をparity対象に
拡張する。

### 9.1 Node側（構造検査のみ、39列全体）

`buildReviewedExcelSheets(artifact).sheets`が返す行配列（`[{sheetName, rows}, ...]`）から、
comparison_idごとに§3の**39列すべて**（`comparison_id`、`requirement_trace_id`/
`requirement_matcher_id`/`requirement_quantity_id`、`actual_trace_id`/`actual_matcher_id`/
`actual_quantity_id`、`automatic_*`の4列、5項目×5フィールドの25列、`satisfaction_eligible`/
`effective_satisfaction`/`all_reviewed`）を再構成し、同じ`artifact`のJSON側の対応する値と
1列ずつ比較する。ここではExcelバイナリを生成・読み戻しせず、「行配列オブジェクトとして
見たときの値」を比較する。特に次の取り違えパターンを固定テストケースとして持つ:
`requirement_quantity_id`と`actual_quantity_id`が入れ替わっていないか、ある項目の
`reviewer`/`reviewed_at`/`verdict`/`note`が別項目の列へ混入していないか。

`Review Metadata`シートについても、`artifact`/`generated_at`/`generator.tool`/
`generator.version`・`source_identity`の全フィールド・`review_session`の
`overlay_version`/`session_id`/`session_status`/`session_revision`/`started_at`/
`started_by`・`live_source_marker`の11フィールド（ドット区切りキー、§3）・
`snapshot_identity`の3フィールド・`comparisons.length`を、同じ`artifact`のJSON側の値と
1行ずつ比較する。

### 9.2 Playwright側（実バイナリ往復検査、39列＋Metadata全項目）

実際に生成された`.xlsx`をブラウザ内で製品と同じ`XLSX`（`XLSX.read`）で読み戻す。読み戻しは
次のオプションを固定する（実装・テストの両方でこの呼び出し形を用いる）:

```js
XLSX.utils.sheet_to_json(sheet, { raw: true, defval: null });
```

`raw:true`で型変換（数値/真偽値の文字列化）を避け、`defval:null`で「セルが存在しない」を
明示的に`null`として拾う（Excelにセルが存在しない場合とJSON側の`null`を同じ意味として
扱うための正規化。値の意味を変える正規化ではない）。

`レビュー済み比較`シートの各行から**39列すべて**を再構成し、同じ`artifact`のJSON側の値と
比較する（9.1のNode側検査と同じ列セット・同じ取り違えパターンを、実バイナリで再検証する）。
`Review Metadata`シートについても9.1と同じ全項目（`live_source_marker`の11フィールド・
`snapshot_identity`の3フィールドを含む）を、実バイナリ読み戻し経由で比較する。

比較は**値**で行い、表示文言（Excel側のセルの見た目の書式等）は対象にしない。
「JSON側は`null`、Excel側は空セル」という表現の違いは、読み戻し時に空セルを`null`へ
正規化してから比較する（Excel自体に`null`型が存在しないための必要な正規化であり、
値の意味を変える正規化ではない）。

### 9.3 オフラインSheetJS供給の確定（設計整合修正）

リポジトリを調査した結果、この問題への解答は**既に確立済みのパターンを流用する**ことに
決定する。新規fixtureは追加しない。

- 製品HTML（`json_ab_trace_matching_tool_v12.1.15.html` 55行）は
  `<script src="https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js"></script>`
  でSheetJSをCDNから読み込む（バージョン番号はURLに含まれない）。
- `tools/design_notes/package.json`は`xlsx: "0.18.5"`をdevDependencyとして固定し、
  `package-lock.json`をコミット済みで`npm ci`により再現可能にしている
  （`quantity_annotation_excel_xlsx_verification.js`が既にこの依存を使用中）。
  ローカルにインストールされた実体は`tools/design_notes/node_modules/xlsx/dist/
  xlsx.full.min.js`（`require.resolve('xlsx/dist/xlsx.full.min.js')`で解決可能）で、
  現在のSHA-256は`c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99`
  （881,727 bytes）。`npm ci`が`package-lock.json`のintegrity hashで検証するため、
  この値は「観測結果の記録」であり、改めて本設計書がpinする一次ソースは
  `package.json`の`"xlsx": "0.18.5"`（キャレット等の範囲指定なし）と
  `package-lock.json`そのものとする。
- `quantity_annotation_excel_xlsx_verification.js`は、まさに同じ問題（製品HTMLがCDNから
  SheetJSを読み込むが、Playwrightはネットワーク遮断方針）に対し、
  `page.route('**://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', route =>
  route.fulfill({ status:200, contentType:'application/javascript',
  body: fs.readFileSync(require.resolve('xlsx/dist/xlsx.full.min.js')) }))`
  という形で、CDN URLへのリクエストをローカルの同一バージョンへ差し替える方式を
  **既に確立済み**である（=選択肢A「既存のローカルvendored SheetJSをテスト時だけroute
  して使用」を採用する）。
- Checkpoint 3の新規Playwrightファイル（`b4b_checkpoint3_export_ui_verification.js`）も
  同じ方式を踏襲するが、ルーティング対象URLは**製品HTML自身が実際に要求するURL**に
  合わせる必要がある。`json_ab_trace_matching_tool_v12.1.15.html`の`<script src>`は
  バージョン番号を含まない`https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js`
  であるため、`page.route('**://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', ...)`
  （`xlsx@0.18.5`ではなく`xlsx`のまま）でこの完全一致URLを差し替え、fulfillする本体は
  `quantity_annotation_excel_xlsx_verification.js`と同じく
  `require.resolve('xlsx/dist/xlsx.full.min.js')`から読む。
- テストは`require('xlsx/package.json').version === '0.18.5'`（Node側）と
  `await page.evaluate(() => XLSX.version) === '0.18.5'`（ブラウザ側、route差し替え経由）の
  両方を検査し、Node/ブラウザ双方が同一バージョンのSheetJSで動いていることを
  `quantity_annotation_excel_xlsx_verification.js`と同じ形で確認する。
- 無制限にCDNへ接続するテストは行わない（既存の`page.route('https://**/*', ...)`汎用遮断
  方針の中で、この1URLだけを明示的にfulfillする、Checkpoint 2のfake cytoscape fixtureと
  同じ形）。
- **条件5対応（SheetJS SHA-256の事前検証）**: `package-lock.json`は`xlsx@0.18.5`の
  tarball自体のintegrity hashを既に固定しているが、それとは別に、Playwright起動前の
  Node側検査として、実際にrouteで配信するファイルそのもの
  （`require.resolve('xlsx/dist/xlsx.full.min.js')`が指す実体）のSHA-256を計算し、
  本設計書に記録した値
  `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99`と一致することを
  確認する。この検査は`trace_comparison_review_export_core_verification.js`
  （Node側検証、§10）の冒頭で行い、不一致であればテスト自体をfail-closedで停止する
  （`npm ci`後にファイルが差し替わっていないことの二重確認であり、
  package-lock.jsonのintegrity検証を置き換えるものではなく、それに加えて行う）。

## 10. Node / Playwrightテスト計画

### Node（新規 `tools/design_notes/trace_comparison_review_export_core_verification.js`）

Checkpoint 1 projection core検証と同じスタイル（`assert`ベースの軽量harness、
2回独立実行での決定論性確認）で、最低限:

- `session===null`・`session===undefined`・`structurallyUsableSession(session)!==true`な
  不正入力で、いずれも`ok:false`・`review_artifact_invalid`でfail-closedになること
  （§5(a)、条件3対応: 構造不正はstaleと異なるcodeになることの確認）
- 構造は正しい（`structurallyUsableSession(session)===true`）が
  `session_status==='stale'`の入力で`ok:false`・`review_session_stale`でfail-closedに
  なること（§5(a)、構造不正のケースとcodeが違うことを1つのテスト内で対比確認する）
- `computeSnapshotIdentity()`が`review_artifact_invalid`で失敗する入力
  （例: `live_source_marker`の形状を壊す）で、`buildReviewedExportArtifact()`が
  そのcode/severity/detailをそのまま転記すること（一律`review_artifact_invalid`への
  丸めではなく、実際に転記されていることをdetailの内容比較で確認する）（§5(b)）
- `computeSnapshotIdentity()`が`review_artifact_identity_mismatch`で失敗する入力で、
  同様にそのcodeがそのまま転記されること（§5(b)）
- `session`と`recordSet`のcomparison_id集合が一致しない不正入力でfail-closed
  （`review_artifact_identity_mismatch`）になること（§7.1）
- `recordSet`の`automatic_judgement`と`projected.automatic`をわざと食い違わせた入力で
  fail-closed（`review_artifact_identity_mismatch`）になること（§7.2、automatic側改ざん検知）
- `session.comparisons[id]`と`projected.review_overlay`をわざと食い違わせた入力で
  fail-closedになること（§7.2、overlay側改ざん検知）
- `projected`側の`comparisons`に`recordSet`側に存在しないcomparison_idを混入させた入力、
  および`recordSet`側にあって`projected`側に無い入力の両方でfail-closedになること（§7.1）
- `session_context`が`{present:true, status:'active'}`以外の入力でfail-closedになること（§7.3）
- `review_overlay`の各フィールド・`effective_satisfaction`等に`undefined`を混入させた
  入力でfail-closed（`review_artifact_invalid`）になること（§7.4）
- `projected`の各層にextra property（例: `projected.result.comparisons[id]`へ契約にない
  キーを追加）を混入させた入力でfail-closedになること（§7.6）
- `automatic`から1フィールドを欠落させた入力でfail-closedになること（§7.6）
- `review_overlay`の各targetへextra propertyを混入させた入力でfail-closedになること（§7.6）
- `session_context`へextra propertyを混入させた入力でfail-closedになること（§7.6）
- `projected`のいずれかのフィールドをaccessor property（getter）に置き換えた入力で
  fail-closedになること（§7.6）
- `projected`のいずれかの層にsymbol keyを追加した入力でfail-closedになること（§7.6）
- `computeSnapshotIdentity()`の再検証結果が`session.snapshot_identity`と食い違う入力で
  fail-closed（`review_artifact_identity_mismatch`）になること（canonicalJson全体比較、
  1フィールドだけ変えたケースと3フィールド全部変えたケースの両方）
- 正常系で`artifact`の全フィールドが期待どおり・`automatic_judgement`がrecordSetの値と
  完全一致すること
- `effective_satisfaction`が`null`のケースと`false`のケースを区別して保持すること
  （Checkpoint 1で確立した`null`≠`undefined`の意味をexport層が潰さないことの検証）
- 同一入力を2回与えて`generated_at`以外が完全一致すること（決定論性）
- `recordSet`/`session`/`projected`が呼び出し前後でcanonical JSON不変であること（純粋性）
- `buildReviewedExcelSheets(artifact)`が返す`sheets`から、artifactの全comparisonが
  過不足なく、**39列すべて**について再構成できること（§9.1のparity検査。取り違え検知用に、
  `requirement_quantity_id`/`actual_quantity_id`を意図的に入れ替えた期待値、および
  ある項目の`reviewer`を別項目の列へ混入させた期待値との不一致を検出できることも確認する）
- `buildReviewedExcelSheets(artifact)`が返す`Review Metadata`相当の行から、
  `live_source_marker`の11フィールド・`snapshot_identity`の3フィールドを含む全項目が
  artifactの値と一致すること（§9.1）
- `buildReviewedExportArtifact()`を経由しない、手組みの偽`artifact`
  （§2の契約と一見似ているが1フィールド値だけ異なる、またはexact structureを満たさない
  もの）を直接`buildReviewedExcelSheets()`へ渡すと`ok:false`・`review_artifact_invalid`で
  fail-closedになること（条件4対応: fail-closedなExcel adapterであることの直接検証）
- SheetJS SHA-256事前検証（§9.3）: `require.resolve('xlsx/dist/xlsx.full.min.js')`の
  実体のSHA-256が設計書記載値と一致することをテスト冒頭で確認すること
- Rev.6追加（Request Changes round 2, Blocker 1）: `buildReviewedExportArtifact()`を
  経由しない偽artifact、および1フィールドだけ改変したexact-shapeなコピーが、
  `buildReviewedExcelSheets()`からattestation（`WeakSet`同一性）により拒否されること
- Rev.6追加（Request Changes round 2, Blocker 2）: `recordSet.provenance`/
  `display_context`の3つのdataset signatureそれぞれを`session.live_source_marker`と
  意図的に食い違わせた入力（他はすべてidentity検証を通過する程度に整合済み）で
  `review_artifact_identity_mismatch`によりfail-closedになること（3signature個別）
- Rev.6追加（Request Changes round 3, Blocker 1）: `requirement_ref`/`actual_ref`の
  各IDを空文字列にした入力、`requirement_ref`へ`source_row`を混入させた入力がいずれも
  builder段階で`review_artifact_invalid`によりfail-closedになること。また`actual_ref`に
  正当な整数`source_row`がある場合はbuilderが成功し、その成功artifactが
  `buildReviewedExcelSheets()`でも必ず成功すること（builder/adapter contract parity）
- Rev.6追加（Request Changes round 3, Blocker 2）: `generatedAt`/`artifact.generated_at`
  が暦上存在しない日時（`2026-99-99T99:99:99.999Z`）・非閏年の2月29日で拒否され、
  閏年の2月29日は受理されること（`canonicalTimestamp`のround-trip検査）
- Rev.6追加（Request Changes round 3, Blocker 3）: 実ソースファイルを`vm`モジュールで
  `module`未定義のbrowser相当条件下で実行し、`window.TraceComparisonReviewExportCore`が
  `EXPORT_CORE_VERSION`/`ARTIFACT_VERSION`/`COMPARISON_ROW_KEYS`/
  `buildReviewedExportArtifact`/`buildReviewedExcelSheets`の5キーちょうどを持ち、
  `__test`を持たないこと

### Playwright（既存 `tools/design_notes/b4b_checkpoint2_ui_verification.js`とは別ファイルで
新規 `tools/design_notes/b4b_checkpoint3_export_ui_verification.js`、既存45+8=53件は無変更のまま
維持し、新規ファイルを追加する）

- `window.TraceComparisonReviewRuntime`が公開されており、`window.__b4bCheckpoint2Diagnostics`
  とは別オブジェクトであることの確認（§0.2の回帰検査）
- `review_export_not_ready`に該当する各状態（未開始/古い/エラー/in-flight中）で
  レビュー済み保存ボタンが無効化されていること
- `ready`状態でJSON保存→ダウンロードされたJSONをパースし、§2の契約フィールドが
  揃っていること（`live_source_marker`の11フィールド・`snapshot_identity`の3フィールドを
  含む）・`comparisons`が`recordSet.comparisons`と同じ順序であること
- `ready`状態でExcel保存→§9.3の方式でルーティングしたSheetJSにより
  `XLSX.utils.sheet_to_json(sheet, { raw:true, defval:null })`（§9.2で固定した呼び出し形）
  で読み戻し、`レビュー済み比較`・`Review Metadata`の2シートが存在し、
  `レビュー済み比較`が39列であることを確認する
- Excel保存の一連の流れで`beginMatchingJob`/`finishMatchingJob`相当の進捗UI
  （`#matchProgressPanel`）が表示・消滅すること、Excel生成中の中止ボタンで
  `MatchingCancelledError`となりダウンロードが行われないこと（§5.2）
- 同一projectionからのJSON/Excel実バイナリ往復parity検査（§9.2、39列すべて＋
  `Review Metadata`全項目、`generated_at`除く。特に`requirement_quantity_id`/
  `actual_quantity_id`の左右取り違え、`reviewer`の別項目混入、`reviewed_at`欠落、
  `note`の欠落・列ずれ、`live_source_marker`/`snapshot_identity`のMetadata欠落・誤転記が
  無いことを固定ケースとして確認する）
- 4項目承認・satisfaction確定後にexportし、`review_overlay`/`effective_satisfaction`が
  UI操作を反映していること
- export操作の前後で`coordinator.getRecordSetSnapshot()`のcanonical JSONが不変であること
  （automatic不変、Checkpoint 2と同じ手法）
- レビュー済み保存ボタン押下直後（②の非同期区間中を狙って）にレビュー操作やsession破棄を
  行い、CAS不一致で保存が中止されダウンロードが発生しないこと（§5③、
  `reviewedExportStateStillCurrent()`がfalseになる経路の確認を含む）
- 既存の自動照合exportボタン（`#traceComparisonDownloadBtn`/`#downloadExcelBtn`/
  `#dlDetailExcelBtn`）がCheckpoint 3追加前と同じ挙動のままであることを確認する回帰検査
- 全経路でpage error・console errorが0件

## 11. 明示的な非対象

- quantity値・property値等の訂正、correct verdict、correct artifact相当の機能
- 訂正後の下流再計算（数値比較・充足判定の再実行）
- レビューsessionの保存/復元（reviewed JSONの再importによるsession復元を含む）
- server保存・バックエンド送信
- 認証・アクセス制御
- 複数人での同時編集
- PDF出力
- B-5に相当する範囲
- PDF/Excel α版ツールへの変更
- automatic rc2 artifactの仕様変更（`generateTraceComparisonRecordSet`・既存の
  automatic export・rc2 schemaは無変更のまま）
- stale sessionの監査用exportモード（将来必要になれば別機能として設計する）
- Phase 7（手動トレース関係編集・一括レビュー等）の判定をreviewed exportへ混在させること
- `actual_ref.source_row`のreviewed成果物への追加（§3で非対象と決定、将来必要になれば
  「省略可能フィールド」であることを契約に明記した別変更として扱う）
- `window.TraceComparisonReviewRuntime`以外の形でCheckpoint 2 IIFE内部状態へアクセスする
  経路の追加（§0.2で追記する3関数〈captureReviewedExportState/
  reviewedExportStateStillCurrent/peekReviewedExportReady〉＋1公開以外、
  Checkpoint 2側への変更は行わない）

## 12. 実装完了・実測結果

- Node検証（`trace_comparison_review_export_core_verification.js`）: **69/69 成功**
  （実際のStage 1/2/Checkpoint 1 coreを使い、hash的に整合したrecordSet/session/projected
  fixtureを構築した上での検証。§7.1〜§7.6・§5(a)(b)・determinism・purity・
  `buildReviewedExcelSheets`の39列parity・fail-closed性に加え、Rev.6のBlocker 1〜3対応
  ―― attestation・3組signature一致・builder側ref分離（空文字列ID・requirement_ref
  への`source_row`混入拒否・builder成功⇒Excel adapter成功の恒久確認）・
  `canonicalTimestamp`の暦妥当性検査（閏日を含む）・browser公開面の`vm`によるexact key
  set検査（`__test`が含まれないことの確認）を含む）。
- Playwright新規検証（`b4b_checkpoint3_export_ui_verification.js`）: **42/42 成功**
  （実データでの読込→照合→レビュー開始→4項目+satisfaction承認→JSON/Excel export→
  実バイナリ39列+Review Metadata 4集計項目を含む全項目parity→job中止時download 0件→
  CAS abort→既存自動export回帰〈`#traceComparisonDownloadBtn`/`#downloadExcelBtn`/
  `#dlDetailExcelBtn`〉、stale/error/レビュー開始in-flight/レビュー遷移in-flightの
  4状態すべての実UI経由検証、export開始前・JSON export後・Excel export後の3点比較による
  真のbefore/after不変検査、page/console error 0件を含む）。
- 既存Checkpoint 2 Playwright検証（`b4b_checkpoint2_ui_verification.js`）: **53/53 成功、
  無変更・回帰なし**（Checkpoint 3追加後も再実行して確認）。
- 3スイートとも複数回連続実行して安定することを確認済み。
- commit/pushは未実施（レビュー待ち）。`git status --porcelain`は新規/変更ファイルのみを
  示し、想定外の差分はない。
