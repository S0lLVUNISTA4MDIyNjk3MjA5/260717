Private Dictionary Matching Integration Contract 0.1 (P2-A4 Checkpoint 1)
============================================================================

P2-A4「Private Dictionary Application / Matching Integration」の設計契約。**Checkpoint 1では
実装しない。** 本書はscope・architecture・data contractを固定するための設計文書であり、
`tools/knowledge_builder/core/*`・`tools/knowledge_builder/ui/*`・matching tool一式（
`tools/json_ab_trace_matching_tool_v12.1.15.html` ほか、
`p2a4_matching_integration_current_state_analysis.md` §20記載の全ファイル）は本Checkpointで
一切変更していない。実装事実は `p2a4_matching_integration_current_state_analysis.md` を参照。

**R1改訂**: Checkpoint 1-R1にて、Promotion input contract（S6.1-S6.3）、統合点の一本化（S3/S4）、
`private_dictionary_learning_core.js` をSource of TruthとしたDictionary resolutionの再設計
（S13）、Dictionary Snapshotのwrapper化（S5、独自の辞書本文schemaを廃止）、Conflict種別の区別
（S12.A/S12.B）、Snapshot selection/pinningの矛盾解消（S14）を反映。変更点は各節に(R1-n)として
明記する。

---

## S0. 目的とKPI（要約。詳細は acceptance plan 側）

P2-A3で人間がレビュー・承認した辞書知識を、照合ツールが**読み取り専用**で再利用し、
「同じ意味判断を辞書レビューと照合レビューで二重に人間へ求めない」ことを実現する。

主KPI: **duplicate semantic decision count = 0**（詳細は acceptance plan §該当）。

---

## S1. 最重要設計原則（禁止事項の要約）

- 照合のたびに辞書レビューを要求しない（§8 二重承認禁止）。
- 辞書判断（dictionary decision）と照合判断（comparison decision）は別の承認操作（§4）。
- 辞書一致だけを理由にcomparisonを無条件AUTO ACCEPTしない（§4、NG-10）。
- UI/詳細テーブル/Knowledge GraphがDictionary Resolverを独自に再実行しない（S9, NG-5）。
- P2-A3 private Review Workbookをmatching engineが直接読まない（S10, NG-1）。
- ACCEPTをその場でACTIVEへ自動昇格しない（S11, NG-2）。
- 最新版辞書を暗黙参照せず、1 matching sessionは1 Dictionary Snapshotへpinする（S14, NG-6）。
- unresolved ConflictからDictionary Resolverが任意canonicalを自動選択しない（S17, NG-7）。
- invalid Snapshotを部分適用しない（S15, NG-8）。
- original TraceRecordの文字列を破壊的に上書きしない（S9, NG-9）。

---

## S2. 辞書判断と照合判断の分離（§7設計原則）

| | Dictionary decision | Comparison decision |
|---|---|---|
| 例 | 「コンプレッサ」は「圧縮機」の別名である | この案件で要求仕様の「圧縮機能力」と設計レビューの「コンプレッサ能力」は対応している |
| 所有者 | 辞書メンテナンス（P2-A3レビュー→promotion） | 照合作業（matching tool review session） |
| 対象 | 語・概念（term-level） | 2つのTraceRecordの対応関係（record-pair-level） |
| 承認頻度 | 1回（Dictionary Snapshotへ確定後は再承認しない） | matching sessionごと（同じ語でも案件が変われば別判断） |
| 既存実装 | `private_dictionary_learning_core.js`（P2-A1, read-only） | `trace_comparison_review_state_core.js`（read-only） |

この2つは**別のUI操作・別のデータ構造**として維持する。辞書ACCEPTがcomparison ACCEPTを
自動生成することはなく、逆にcomparison ACCEPTが辞書へ書き戻ることもない。

---

## S3. Target Architecture（全体像）

```text
P2-A3 Review Artifact (private_dictionary_candidate_review.xlsx)
        |
        v
Promotion Validator                      <- Checkpoint 1では未実装。契約のみ(S11)。
        |  (conflict/duplicate/scope validation, fail-closed)
        v
Immutable Dictionary Snapshot            <- 生成物。schema契約はS6。
        |  (versioned, content-addressed, never overwritten)
        v
Snapshot Loader                          <- matching tool起動時にロード。1 session = 1 snapshot固定(S14)。
        |
        v
Dictionary Resolver                      <- 独立layer。TraceRecordを書き換えない(S9)。
        |
        v
Resolution Sidecar                       <- annotation。original TraceRecordとは別object。
        |
        v
Existing Matching Engine                 <- 既存実装(read-only)。matchLogicへの追加入力信号として
        |                                    Resolution Sidecarを参照する(S13)。
        |  matchLogic / buildTraceMatrixRows() 等、現状のまま。
        v
Comparison Result                        <- 既存のtraceMatrixRows / rc2 record_set。
        |
        |  --- ここから先はmatching結果に一切影響しない (R1-2) ---
        v
Provenance Binding (display only)        <- Comparison Resultへ、対応するResolution Annotationを
        |                                    "参照として"添えるだけの処理。matchingを再実行しない。
        |                                    matching input・comparison scoreを一切変更しない。
        v
Review UI / Detail Table / Graph / Excel <- 既存実装(read-only)。表示のみ、再計算しない(S16)。
```

**統合点は1箇所のみ**（current-state-analysis §19表の#1行、R1-2で確定）: Dictionary Resolverが
matching結果に実際に影響しうるのは、`matchPlmParts()`/`buildTraceMatrixRows()` 呼び出し**前**の
1箇所だけである。comparison生成後に行う処理（上図「Provenance Binding」）はUI表示・Excel export用の
注記であり、**matching inputではない**。current-state-analysis の初版（Checkpoint 1）に
「comparison生成後・review開始前」を統合点として並記した記述があったが、これはmatching結果への
影響経路と表示専用の経路を混同させる曖昧な記述であったため撤回し、上記の通り単一の統合点へ
限定する（current-state-analysis §19表も同様に修正済み）。

Unknown / Conflict の扱い（matchingを止めない。S16, S17参照）:

```text
Unknown term (辞書未収載) / Dictionary Conflict (未解決)
        |
        v
matchingを停止しない。baseline matching logicのまま継続。
        |
        v
Dictionary maintenance queue へ収集（Checkpoint 1ではcontractのみ、queue実装なし）
        |
        v
後日、辞書メンテナンス画面でまとめてreview（P2-A3拡張 or 別画面。将来slice）
```

---

## S4. Dictionary Resolver（独立layerとしての設計）

**責務**: 承認済みDictionary Snapshotを用いて、TraceRecord中の語をcanonical termへ解決し、
**別objectとして** annotationを生成する。TraceRecordそのものは変更しない。

**なぜsidecar方式を採るか（既存schema拡張との比較）**:

| 観点 | 既存TraceRecord schemaへfield追加 | sidecar / annotation方式(採用) |
|---|---|---|
| 後方互換性 | rc2 schema・既存validator・既存Excel exportすべてに影響。read-only制約に抵触するリスク | 既存schemaは無changeのまま。read-only境界を守れる |
| 再現性(replay) | original textが失われるとreplay不能になる恐れ | original TraceRecordは不変のまま保持されるので常にreplay可能 |
| provenance追跡 | どのfieldが辞書由来か曖昧になりやすい | resolution recordが独立しているためprovenanceが自己完結 |
| UI利用性 | 既存UI/graphがdictionary由来fieldをそのまま表示に使ってしまうリスク（S16のUI境界違反を誘発） | 既存UIは何も変えずに済み、新規表示だけがsidecarを読む設計にできる |
| payload size | 小さい（field追加のみ） | 追加のsidecar objectがある分やや大きいが、既存artifactのサイズ制約(P2-A3 60MB等)とは別artifactなので独立に管理可能 |

結論: **sidecar方式を採用する。** 理由は上表の「後方互換性」「replay可能性」「read-only境界の
維持」が本統合で最優先だから。

**Resolution Annotation の最小構成案**:

```json
{
  "original_term": "コンプレッサ",
  "resolved_canonical": "圧縮機",
  "resolution_type": "APPROVED_ALIAS",
  "dictionary_entry_id": "pde-<hex32>",
  "dictionary_snapshot_id": "dsnap-<hex32>",
  "dictionary_wrapper_sha256": "<hex64>",
  "scope": "PROJECT",
  "status": "ACTIVE"
}
```

`resolution_type` の候補値（初期案）: `EXACT_CANONICAL` / `APPROVED_ALIAS` / `UNKNOWN_TERM` /
`DICTIONARY_CONFLICT`。UNKNOWN_TERM/DICTIONARY_CONFLICTの場合、`resolved_canonical` は
`null`（未解決のまま。S16, S17）。

**Original TraceRecordへの書き込みは一切行わない。** Resolverの出力は
「TraceRecord識別子 → Resolution Annotation」のmap（Resolution Sidecar）として保持し、
既存matching engineへは**追加input**として渡す（既存の `traceMatrixRows` 生成ロジック自体は
変更しない。統合候補点は current-state-analysis §19の表を参照）。

**Resolution Sidecarには2つの使われ方があり、明確に区別する（R1-2）:**

1. **matching input としての利用（唯一の実効経路）**: `matchPlmParts()`/`buildTraceMatrixRows()`
   呼び出し**前**にResolution Sidecarを生成し、既存 `matchLogic` への追加入力信号として渡す
   （S13）。ここでのみDictionary resolutionがcomparison結果に影響しうる。
2. **display/provenance binding としての利用（comparison生成後）**: 既に確定した
   Comparison Resultへ、対応するResolution Annotationを**参照として**添えるだけの処理
   （S3のProvenance Binding node）。これは(1)と同じResolution Sidecarを再利用してよいが、
   **matching自体を再実行せず、comparison score・matching結果を一切変更しない**。UI/Excel export
   がdictionary由来の根拠を表示するための binding に過ぎない。

この2つを同一の処理と混同すると「comparison生成後に辞書を反映した」という誤った実装
（事実上のAUTO ACCEPTや無自覚なmatching再計算）を招く。実装Checkpointでは、この2つの利用を
コード上も別関数として分離することを推奨する（unresolved design questionではなく、確定方針）。

---

## S5. Dictionary Snapshot Contract案（R1-4: P2-A1 canonical schemaのwrapperとして再定義）

**目的**: matching engineがP2-A3のReview Workbook（可変・人間作業中の成果物）を直接読むことを
禁止し（NG-1）、別工程で生成されたimmutableな正式artifactのみを読ませる。

**R1-4の方針転換**: Checkpoint 1初版は独自のcanonical entry/alias schemaをSnapshot内に
再定義していたが、これは `private_dictionary_learning_core.js` が既に持つ
`schema_version: 'private-dictionary-overlay/1.0'`（current-state-analysis §18.1で実装確認済み）
と**第二の正本**を作ることになり、R1-3の「P2-A1をSource of Truthとする」方針に反する。
Dictionary Snapshotは**辞書本文を新たに定義しない**。既存の `private-dictionary-overlay/1.0`
payload（1つ以上のscope layerの `serializeValidatedPrivateDictionary()` 出力そのもの）を
**そのまま包む wrapper artifact** として定義し直す。

**S5.1 Snapshot Wrapper Schema**（Checkpoint 1で定義する項目。実装はしない）:

| field | 内容 | 備考 |
|---|---|---|
| `wrapper_schema_version` | 例 `private-dictionary-snapshot-wrapper/0.1` | wrapper自体のschema。辞書本文のschemaとは別軸 |
| `snapshot_id` | 例 `dsnap-<hex32>` | 内容に依存しない発番（重複禁止の識別子） |
| `dictionary_payload` | **`private-dictionary-overlay/1.0` の辞書本体そのもの**（1 scope layer分、`validatePrivateDictionary()` で検証可能な構造） | 第二の正本を作らない。P2-A1の既存構造をそのまま埋め込む |
| `dictionary_payload_sha256` | `hashPrivateDictionaryCanonical(dictionary_payload)` の出力 | **P2-A1の既存関数をそのまま呼び出す**（下記S5.2） |
| `wrapper_sha256` | wrapper全体のcanonical serializationのSHA-256 | S5.2のhash projection参照 |
| `snapshot_version` | 単調増加の版番号（wrapper発行ごと） | rollback対象の識別に使う(S12) |
| `scope` | `dictionary_payload.scope` と一致必須（`PROJECT`、初期実装はS7参照） | 二重管理を避けるため、wrapperのscope fieldはpayload内scopeのミラーとしてのみ存在し、検証時に不一致ならreject |
| `snapshot_status` | Snapshot自体のstatus（`ACTIVE`/`SUPERSEDED` 等、S8参照） | **entry単位の`status`（P2-A1既存）とは別軸**。entry単位statusは`dictionary_payload`内にP2-A1契約のまま存在する |
| `provenance` | 生成元の追跡情報 | 下記S9参照 |
| `source_review_artifact_identity` | 元になったP2-A3 Review Workbookの識別（file名ではなくSHA-256等） | 実体は含めない（S17でprivacy検討） |
| `promotion_record_identity` | S6のPromotion Validatorが生成した記録への参照 | |
| `source_commit` | 生成時のrepository commit SHA | 再現性のため |
| `conflict_state` | このSnapshotに含まれなかった未解決Conflictの要約（件数のみ等。個別内容はSnapshotに含めない方針、S17） | S12のB類（layer merge時lookup conflict）とは別。S5.3参照 |
| `supersedes` | 直前のsnapshot_idへの参照 | rollback chainの構成(S16) |
| `rollback_target` | 明示的にrollbackされた場合の遡及先 | |

**S5.2 Hash Projection（完全固定）**:

`wrapper_sha256` の対象・非対象を明確に分離する。

- **hash対象外**: `wrapper_sha256` 自身（自己参照不可）、生成時刻に相当するあらゆるtimestamp
  field（wrapperにtimestamp fieldそのものを持たせない方針とする）。
- **`snapshot_id` の扱い**: hash対象**外**。発番方式（乱数/連番等）に依存する識別子であり、
  同一内容のwrapperを再生成した場合でもsnapshot_idは異なりうる（発行のたびに新規発番される
  ため）。内容の同一性は`dictionary_payload_sha256`で判定する。
- **`snapshot_version` の扱い**: hash対象**外**。versionは「この内容が何回目の発行か」という
  外部的な連番であり、内容そのものではない。
- **`provenance` の扱い**: hash対象**外**。`source_commit`等の生成環境情報は再現性の記録目的で
  あり、辞書内容の同一性判定には使わない。
- **`supersedes`/`rollback_target` の扱い**: hash対象**外**。version chain上のリンク情報であり、
  chainの前後関係が変わってもwrapperの中身（辞書内容）が同じならhashは変わらない設計とする。
- **hash対象**: `wrapper_schema_version`、`dictionary_payload`（＝`private-dictionary-overlay/1.0`
  の内容全体。実質的には`dictionary_payload_sha256`と同じ内容を指すため冗長を避け、
  `wrapper_sha256`の対象は`dictionary_payload_sha256`（stringとして）を含める形とし、
  `dictionary_payload`自体を二重にhashしない）、`scope`、`snapshot_status`、
  `source_review_artifact_identity`、`promotion_record_identity`、`conflict_state`。
- **key ordering**: `private_dictionary_learning_core.js` の `canonicalJson()`
  （`tools/quantity_sidecar_binding_core.js` L122-128と共通実装のパターン）と同じ規則 —
  objectのkeyを`Object.keys(value).sort()`でordinal順に再帰ソートしてから`JSON.stringify()`。
- **array ordering**: 配列はsortしない。呼び出し側が意味のある順序（例:
  `serializeValidatedPrivateDictionary()`がentry_idのordinal順に事前sortする、というP2-A1の
  既存パターン）で構築してから渡す。wrapper側で新たに配列を持つ場合も同じ規律を適用する。
- **UTF-8 serialization rule**: `JSON.stringify()`した文字列を`TextEncoder().encode()`で
  UTF-8 bytesにし、SHA-256 hexを取る — P2-A1の`hashPrivateDictionaryCanonical()`（L741-745）と
  完全に同じ手順。

**P2-A1関数の直接再利用（推奨、実装Checkpointでの指針）**: `dictionary_payload_sha256`は
**新規実装せず** `hashPrivateDictionaryCanonical(dictionary_payload)` をそのまま呼び出す。
`wrapper_sha256`についても、wrapper用のcanonical構造体を組んだ上で同じ`canonicalJson()` +
SHA-256の手順を再利用し、独自のhashアルゴリズムを新設しない。

**S5.3 SnapshotとConflictの関係（R1-5、詳細はS12参照）**: wrapperの`conflict_state`は
「Promotion Validatorが**このSnapshotの生成をブロックした**内部不整合」（S12 A類）の要約のみを
指す。複数scope layerを`mergeDictionaryLayers()`でmergeする際に生じるlookup conflict（S12 B類）
は、そもそもSnapshot単体（1 scope layer分の`private-dictionary-overlay/1.0`）には存在しない概念
であり、merge時点（matching tool起動時、複数Snapshotを束ねる段階）で毎回計算される。
`conflict_state`フィールドとB類conflictを混同しない。

---

## S6. Promotion Boundary

P2-A3の `ACCEPT` を無条件でSnapshotのACTIVE entryへ昇格させない（NG-2）。

```text
P2-A3 review decision (ACCEPT/REJECT/UNCERTAIN/UNREVIEWED, per candidate)
        |
        v
Promotion Validator          <- 未実装。Checkpoint 1は契約のみ。
        |
        |  自動promotion対象外(最低限):
        |    - REJECT
        |    - UNCERTAIN
        |    - UNREVIEWED
        |    - unresolved Conflict由来のcandidate
        |
        v
Conflict / duplicate / scope validation   <- fail-closed。ACCEPTのみでもscope衝突・
        |                                     canonical衝突があれば昇格させない。
        v
Dictionary Snapshot build
        |
        v
Explicit activation           <- 人間による明示操作。自動ではない。
```

### S6.1 Promotion Validator Input Contract（R1-1）

P2-A3 Review Artifactが持つ3つの独立した判断集合を、**個別の入力**としてPromotion Validatorへ
渡す。1つの承認状態から他を推定してはならない。

| input | 由来 | 意味 |
|---|---|---|
| `candidate_decisions` | P2-A3 private Review Workbook「Candidates」sheet | canonical candidate単位のACCEPT/REJECT/UNCERTAIN/UNREVIEWED |
| `alias_decisions` | 同「Aliases」sheet | alias candidate単位のACCEPT/REJECT/UNCERTAIN/UNREVIEWED（**canonicalのdecisionとは独立**） |
| `conflict_resolutions` | 同「Alias Conflicts」sheet | conflict単位の resolution（`UNRESOLVED`/`SELECT_CANONICAL`/`REJECT_ALL`/`CONTEXT_DEPENDENT`/`UNCERTAIN`、P2-A3既存contract準拠） |

**Candidate ACCEPTからAlias ACCEPTを推定してはならない**（P2-A3設計原則「canonicalをACCEPTしても
aliasは自動ACCEPTされない」をPromotion層でも維持する）。

### S6.2 Alias promotion eligibility（最低要件）

あるaliasがpromotion対象となるには、次を**すべて**満たす必要がある。

1. `alias_decisions` において、そのalias自身が`ACCEPT`であること。
2. そのaliasに対応するcanonical candidateが、`candidate_decisions`において**それ自体も
   promotion eligible**であること（すなわちcanonical側も`ACCEPT`かつS6.3のconflict validationを
   通過していること）。canonicalがpromotion対象外であれば、そのaliasも対象外とする
   （canonicalが存在しないaliasは意味を持たないため）。
3. 当該aliasに関連するunresolved conflictが存在しないこと（S6.3参照）。

### S6.3 Conflict resolution enumごとのpromotion eligibility

P2-A3の`conflict_resolutions`は次のenumを持つ（既存contract準拠）。各値ごとのpromotion可否を
明示する。

| `resolution` | promotion対象か | 理由 |
|---|---|---|
| `UNRESOLVED` | **対象外** | 未解決。当該conflictに関わる全candidateをpromotion対象から除外する |
| `SELECT_CANONICAL` | 選択された`selected_candidate_id`のcandidateのみ**条件付きで対象**（当該candidate自身のACCEPT状態・S6.2の要件を別途満たす必要がある） | 選択されなかった他のconflicting candidateは対象外のまま |
| `REJECT_ALL` | **対象外**（関与する全candidateを除外） | 人間が明示的に「いずれも採用しない」と判断した結果 |
| `CONTEXT_DEPENDENT` | **対象外** | 文脈依存と判断されており、辞書全体で一意に正式化できる状態ではない |
| `UNCERTAIN` | **対象外** | 判断保留 |

### S6.4 Promotion Validatorの最小責務（設計のみ）

1. 入力: P2-A3 private Review Workbookの候補群（ACCEPT decisionのみ抽出）。
2. scope衝突検出: 同一canonical termが異なるscopeで矛盾する定義を持たないか。
3. canonical衝突検出: 既存Snapshot中のcanonical/aliasと矛盾しないか
   （例: 既にalias Aとして承認済みの語を、別candidateがcanonical Bとして提案していないか）。
4. いずれかの検証に失敗した場合、当該candidateのみを除外するか、Promotion全体をfail-closedで
   停止するかは、対象のconflict種別ごとに検討する必要がある（unresolved design question。
   §28相当、完了報告に列挙）。
5. 成功したcandidateのみでSnapshotをbuildし、`Explicit activation` は別の人間操作
   （自動実行しない）とする。

---

## S7. Scope設計（初期実装の推奨）

将来的候補: `SESSION` / `PROJECT` / `DOMAIN`（`private_dictionary_learning_core.js` の
`PRIVATE_SCOPE_VALUES`・`SCOPE_PRIORITY` と整合、S8参照）。

**Checkpoint 1推奨: 最初の実装sliceは `PROJECT` scopeのみ許可する。**

理由（blast radius比較）:

| scope | blast radius | 初期実装での適否 |
|---|---|---|
| `SESSION` | 単一の候補レビューセッション内のみ。他案件へ影響しない代わりに、re-use価値がP2-A4の目的（人間判断回数削減）に対して薄い | KPI（duplicate semantic decision削減）への寄与が小さいため見送り |
| `PROJECT` | 特定案件内の照合作業へ限定される。誤った辞書知識が昇格しても影響範囲が1案件に収まる | **推奨**。KPI寄与とblast radiusのバランスが最も良い |
| `DOMAIN` | 複数案件・組織横断で再利用される。誤りの影響が広範囲 | 初期実装では見送り。PROJECT scopeでの運用実績を積んでから段階導入 |

`PROJECT-first` の段階導入とする。`DOMAIN` は将来slice（P2-A4後続Checkpoint）で、PROJECT運用の
実績・Conflict発生率等を踏まえて再検討する。

---

## S8. Status Lifecycle（既存契約との整合）

**Checkpoint 1推奨: 新しい語彙を発明せず、`private_dictionary_learning_core.js` が既に
契約化している状態機械をそのまま採用する**（current-state-analysis §18参照）。

```text
PROBATION → ACTIVE → OBSERVING → QUARANTINED / RETIRED
PROBATION → QUARANTINED
PROBATION → RETIRED
QUARANTINED → ACTIVE / OBSERVING / RETIRED
OBSERVING → ACTIVE / QUARANTINED / RETIRED
```

（`ALLOWED_TRANSITIONS` は `private_dictionary_learning_core.js` L175-180 と完全一致させる。）

P2-A4指示書が例示した `APPROVED_FOR_PROMOTION` のような中間状態は、既存の `PROBATION` と
`ACTIVE` の間に新設せず、**Promotion Validatorの検証結果（pass/fail）をSnapshot生成の
gateとして扱う**ことで代替する。理由: 同じ概念（「まだ正式でない」→「正式」）に対して
2つの矛盾した状態機械（既存の学習core側 vs 新設のmatching integration側）を並立させると、
将来どちらが正典かの混乱を招く。既存契約（P2-A1で既に固定済み）を優先する。

`RETIRED`/`QUARANTINED` エントリはSnapshotの `ACTIVE` entry集合から除外される
（`private_dictionary_learning_core.js` の既存lookup優先度ロジックと同じ扱い）。

---

## S9. Provenance

Dictionary resolutionのprovenanceは必須。最低限、matching resultから「なぜこのtermがこの
canonicalへ解決されたのか」を追跡できること。

**必須項目（S4のResolution Annotationと重複するが、provenance専用の観点でここに列挙）**:

- `resolution_type`
- `dictionary_entry_id`
- `dictionary_snapshot_id`
- `dictionary_wrapper_sha256`
- `original_term`（原文そのまま。破壊しない = NG-9）
- `canonical_term`
- `alias_rule_id`（P2-A3の `rule_ids` 契約と対応させる）
- `scope`
- `status`

**Privacyとのバランス**: これらのfieldはtermの文字列そのものを含むため、P2-A2/P2-A3の
private/shareable境界（S12）を継承する必要がある。matching result内部（loopback-only、
private運用が前提）ではfull provenanceを保持してよいが、Excel export（S15、matching tool側の
main結果Workbookは既にsource contentを含む設計のため元々privacy境界が緩い — current-state-analysis
§12参照）へ出す場合は、shareする対象・粒度を別途検討する必要がある（unresolved design question）。

---

## S10. Error Model / Invalid Snapshot

**Error boundary基本方針**（既存matching engineのfail-closed思想を踏襲、
current-state-analysis §14参照）:

```text
validate snapshot
        |
        v
build complete resolver          <- 全体が成功して初めて次へ進む。
        |
        v
atomic activation                <- 部分的なresolverを外部へ晒さない。
        |
        v
matching開始
```

validation失敗後にpartial resolverを残してはならない（既存 `preflightJsonGraph()` /
`validateTraceComparisonRecordSet()` の「例外を投げず型付きdiagnosticsを返す、しかし
部分結果は決して外に出さない」という既存パターンと同じ設計にする）。

**Invalid Snapshot時の挙動 — 2案比較**:

| 案 | 内容 | 評価 |
|---|---|---|
| A: 照合自体を停止 | Snapshot hash不一致・schema不正等を検出したら、matching実行そのものをblockする | 安全側だが、辞書機能とは無関係な通常照合作業まで止めてしまう。matching toolは元々辞書なしでも成立するtoolであるため過剰 |
| B: 辞書を無効化し、ユーザーへ明示した上で既存matchingだけで続行（推奨） | Dictionary Resolverを丸ごとbypassし、既存の `matchLogic` ベースの照合のみで動作継続。画面上に明示的な警告を出す | matching toolの既存の自律性（辞書なしでも動く設計）を尊重しつつ、silent fallbackにならないよう警告を必須にする |

**推奨: B。** ただし「辞書を無効化」は**全か無か**の単位で行う。「一部のdictionary entryだけ
適用して続行」は明確に禁止する（NG-8）。Invalid Snapshotの原因（hash不一致/schema不正/
内部conflict）を問わず、Resolver自体を有効化しないという一段階の判断のみを許可する。

---

## S11. Unknown Termの扱い

```text
unknown term（Dictionary Snapshotに未収載）
        |
        v
matchingは既存logicで継続（baselineのまま。停止しない）
        |
        v
unknown candidateを収集（session内メモリ、Checkpoint 1では永続queueなし）
        |
        v
辞書メンテナンスqueueへ（将来slice。Checkpoint 1ではcontractのみ）
        |
        v
後日まとめてreview（P2-A3拡張 or 別画面）
```

Checkpoint 1でのcontract定義（queue実装はしない）:

- unknown termは `resolution_type: UNKNOWN_TERM` のResolution Annotationとしてのみ記録される。
- unknown termがあることを理由に当該TraceRecordの照合そのものをblockしない。
- 収集されたunknown term一覧は、matching sessionの成果物（既存のcomparison result等）とは
  **別artifact**として想定する（将来の辞書メンテナンスqueueの入力形式は後続Checkpointで設計）。

---

## S12. Conflictの扱い（R1-5: 2種類のconflictを区別）

**2つの異なるconflictを混同しない。**

### S12.A 内部不整合Snapshot（Promotion時に生成してはいけないもの）

Promotion Validatorがscope衝突・canonical衝突（S6.3参照）を検出した場合、そのcandidateを
含んだSnapshotを**そもそも生成しない**。これはSnapshot生成前のgateであり、以下のS12.Bとは
別の話である。「1つのSnapshotが内部矛盾を持つ状態で発行される」ことは常に禁止する
（invalid snapshotの一種、S10参照）。

### S12.B Layer merge時のlookup conflict（既存P2-A1 contractの局所化semanticsをそのまま継承）

複数のscope layer（例: PROJECT snapshotとSTANDARD辞書）を`mergeDictionaryLayers()`で束ねる際、
異なるcanonical keyへ解決される同一lookup keyが生じることがある。これはSnapshot単体の不整合
ではなく、**複数の正しいSnapshotを組み合わせた結果として実行時に生じる**もので、matching tool
起動時（Snapshot Loaderの段階）に検出される。

P2-A1既存contract（`detectDictionaryLookupConflicts()`/`mergeDictionaryLayers()`、
current-state-analysis §18.1で実装確認済み）が既に持つsemanticsをそのまま継承する:

- conflict recordを生成する（`{code:'DICTIONARY_LOOKUP_CONFLICT', normalized_key_token,
  entry_refs[]}`。`normalized_key_token`は元の語を露出しないhash — S17 privacy要件と整合）。
- **conflicted lookup keyだけ**が`effective_vocabulary`から除外される
  （`mergeDictionaryLayers()`内部で `if (conflictedKeys.has(...)) continue;` により
  canonical・alias双方について局所的にskipされることを実装で確認済み）。
- 他の非conflict entryはそのまま`effective_vocabulary`で利用可能。
- 任意のcanonicalを選ばない（NG-7と一致）。

Dictionary Resolverが実際にconflicted keyへ遭遇した場合の挙動:

```text
resolution_type: DICTIONARY_CONFLICT
dictionary resolution: not applied（resolved_canonical = null）
matching: baseline logic continues（辞書なしと同じ経路で照合は進む）
human: 必要なcomparisonだけ確認（辞書由来の追加確認は要求しない）
dictionary maintenance: conflict candidateとして後処理（P2-A3側のAlias Conflict機構を再利用）
```

**「1 conflictでDictionary全体を無効化」と混同しない。** S12.Bのconflictは`effective_vocabulary`
全体を無効化するものではなく、**該当lookup keyのみ**を対象から除外する。これに対し、S10で
定義した「invalid Snapshot」（hash不一致・schema不正等、Snapshot自体が壊れているケース）は
Snapshot全体レベルの問題であり、S12.Bの局所的なlookup conflictとは扱いのレベルが異なる
（invalid Snapshotの場合はS10の「案B: 辞書を無効化」が適用され、Resolver全体を無効化する。
S12.Bは個々のlookup keyの除外に留まり、Resolver自体は有効なまま動作し続ける）。

**全体停止は行わない。** 局所的なConflictがmatching session全体をblockしない構成を原則とする
（P2-A3が既にAlias Conflictをlocalなresolutionとして扱っている設計思想と一貫させる）。

---

## S13. Dictionary Matchの意味づけ（既存matching scoreへの入力方法）

Dictionary resolutionは「comparisonの証拠の1つ」であり、**Dictionary exact/alias一致だけを
理由にcomparisonを無条件で一致扱いにしてはならない**（NG-10）。

既存 `matchLogic`（current-state-analysis §5）が既に手法別スコア（完全一致/コード一致/synonym/
自動synonym/fuzzy/vector/partial）を持っている。Dictionary resolutionは、この既存スコア体系に
**新しい入力信号を1つ追加する**形で統合することを推奨する。

**R1-3: `private_dictionary_learning_core.js` の `effective_vocabulary`（`mergeDictionaryLayers()`
の出力）をこの入力信号のSource of Truthとする。**
`matchLogic.synonymMap`（利用者が手元で編集するad hocな辞書、current-state-analysis §15）と
`effective_vocabulary`（P2-A3で人間が正式承認し、Promotion Validatorを経た正式辞書）は**出自が
異なる別概念**であり、正式辞書を`matchLogic.synonymMap`へ直接書き込む/マージする設計は
**採用しない**（既存の利用者編集可能なsynonymMapへ正式辞書を混入させると、(a) 利用者が
無自覚に正式辞書entryを上書き・削除できてしまう、(b) 正式辞書とad hoc辞書の出自が区別できなく
なりprovenanceが壊れる、という2つの問題を招くため）。

新しい入力信号（案）:

- `deterministic normalization`: Resolverが`effective_vocabulary.aliases`を用いて確定させた
  `canonical_term` を、既存の`normalizeForMatch()`の前処理段階でオプション適用可能にする
  （既存正規化ロジックは変更しない。追加inputとして扱う）。
- `canonical identity` / `alias identity`: `matchLogic`内に**新しいカテゴリ**
  （例: `dictionary`）として追加し、既存の`synonym`/`synonymAuto`カテゴリとは独立に扱う。
  スコアリングでの重み付けは後続Checkpointで具体設計する。
- `provenance`: matchの根拠として `根拠` 列相当（既存の証跡表示機構）へ追加表示する。

**既存の opt-in tag機構（`evaluateTagMatch()`/`buildTagIndex()`、`matchInitialTags()`との整合）**:
現状のtag機構は`shared/tag_vocabulary.json`（flat、scope/statusなし）を用いる別系統であり、
P2-A3/P2-A1の`effective_vocabulary`とは出自が異なる。P2-A4の初期実装で
`effective_vocabulary`をtag機構側へ統合するか、`matchLogic`側の新カテゴリとして独立させるかは
**Checkpoint 1では決定しない**（unresolved design question、S23参照）。安易にtag機構の
`allowed_tags`へ`effective_vocabulary.allowed_tags`をマージする設計は、P2-A1契約から逸脱する
可能性があるため、次Checkpointで`matchInitialTags()`の実装を直接確認したうえで判断する。

**具体的なスコア係数・statusごとの重み付けはCheckpoint 1では決定しない**
（unresolved design question）。ここで固定するのは「Dictionary一致は既存スコア体系への
入力信号の一つであり、matching結果を直接決定する特別ルールにはしない」という原則のみ。

---

## S14. Immutable Snapshot / Session Pinning（R1-6: 自動読込と暗黙latest禁止の矛盾を解消）

1回のmatching sessionでは1つのDictionary Snapshotへpinする。照合途中に辞書が更新されても、
そのsessionは同じSnapshotを使い続ける（NG-6）。

**矛盾の所在**: S20（通常照合時のUX目標）は「Dictionary Snapshot自動読込」を理想としているが、
これを「起動時にrepository/storage上のlatestなsnapshotを探索して読み込む」設計にすると、
「最新版辞書を暗黙参照しない」というS1/NG-6の原則に反する。この2つは矛盾していたため、
R1-6にて解消する。

**解消方針: 自動読込は許すが、「探索」ではなく「事前に固定されたpin先の解決」とする。**

```text
project configuration                <- 案件ごとの設定ファイル（matching tool起動時に読む）。
        |                               ここに「使うべきsnapshotの厳密な指定」を事前に書いておく。
        v
exact snapshot identity + SHA        <- 例: { "dictionary_snapshot_id": "dsnap-<hex32>",
        |                                     "dictionary_wrapper_sha256": "<hex64>" }
        v
Snapshot Loader                      <- project configurationが指す正確な1つのsnapshotのみを
        |                               読み込む。指定と異なる内容が見つかった場合は
        |                               S10の invalid Snapshot 扱い（hash不一致）とする。
        v
matching session開始（自動、人間操作なし）
```

- **禁止**: 実行時に「その時点でのlatest」をstorage/repositoryから検索して選択するロジック
  （例: 「最新のsnapshot_versionを持つものを使う」という動的探索）。
- **許可**: project configurationという**事前に人間が明示的に設定した**pinning元から、
  1つの厳密なsnapshot identity（`snapshot_id` + hash）を読み取り、それをそのままLoaderへ渡す
  こと。この設定自体を更新する（新しいsnapshotへpin先を切り替える）操作は、辞書メンテナンス側の
  明示的な人間操作であり、matching session開始時に自動で行われるものではない。
- これにより、S20の「Dictionary Snapshot自動読込」（＝通常作業者は辞書UIを開かなくてよい）と
  「暗黙のlatest参照禁止」は両立する: 自動なのは「project configurationを読んでpin先を解決する
  こと」であり、「pin先そのものを動的に決めること」ではない。

matching resultへ最低限残す情報:

- `dictionary_snapshot_id`
- `dictionary_wrapper_sha256`（S5.1の`wrapper_sha256`。旧`dictionary_snapshot_sha256`から
  命名をS5のwrapper契約と整合させた）
- `snapshot_version`

既存のreview session（`trace_comparison_review_session_core.js`）が持つ
`snapshot_identity` fieldと概念的に同種の仕組みであり、同じ命名規則・同じ「stale検出」の
考え方（既存sessionのstale化ロジックと平行する設計）を踏襲することを推奨する。project
configuration自体が変更された場合（pin先切り替え）も、進行中のsessionは古いsnapshotのまま
staleにはならず、**次回session開始時からのみ**新しいpin先が適用される（NG-6と整合）。

---

## S15. Replay / Reproducibility

同一の `TraceRecordSet A` / `TraceRecordSet B` / `Dictionary Snapshot` / matching configuration
を使えば、同じdictionary resolutionおよびcomparison inputを再現できる設計とする。

- 辞書の「最新版」を暗黙に参照する設計は禁止（NG-6と表裏一体、S14のpinning方式で担保）。
- Snapshotが`wrapper_sha256`/`dictionary_payload_sha256`によりcontent-addressableであること
  （S5.2）が、再現性の基盤となる。
- 既存matching tool側の `requirement_dataset_signature` / `actual_dataset_signature`
  （`QA-SHA256:<hex64>`、current-state-analysis §13）と同様に、Dictionary Snapshotのsignatureも
  matching resultのprovenanceへ含める。

---

## S16. Rollback

Dictionary Snapshotは上書き更新ではなく、versioned immutable artifactとする（S5の
`supersedes`/`rollback_target` field）。

- 誤った辞書知識を登録した場合、前Snapshotへ戻せる: 新しいSnapshotを生成する代わりに、
  `rollback_target` を持つ新Snapshot（実質的には「前バージョンへの参照を持つ新レコード」）を
  発行する。**既存Snapshotを書き換えない**（immutabilityの原則を破らない）。
- 既存の照合結果は、実行時にpinされた `dictionary_snapshot_id` を保持しているため
  （S14）、rollback後も過去の照合結果はそのsnapshotのまま再現できる
  — rollbackは未来のmatching sessionにのみ影響し、過去の結果を書き換えない。

---

## S17. Privacy

P2-A2/P2-A3のprivacy境界を維持する。禁止事項は据え置き:

- external AI upload
- cloud dictionary sync
- telemetry
- private source textの外部送信

**Dictionary Snapshotへ原文Evidenceを丸ごと含めるべきか**は慎重に検討する必要がある。
推奨方針: 正式辞書（Snapshot）には**必要最小限のprovenanceのみ**を保持し、private source
document本文（P2-A3の `Evidence Index` が持つexcerpt等）は埋め込まない。Snapshotの
`source_review_artifact_identity`（S5）はfile内容ではなく識別子（例: SHA-256）のみを持つ。

matching tool側のExcel export（現状source contentをそのまま含む設計、current-state-analysis
§12）へdictionary情報を出す場合も、private dictionary termsを不用意にshareable相当の出力へ
露出させない設計とする（S18参照）。

---

## S18. Matching Integration Contract（Excel export / UI境界）

**Graph / Detail Table**: Dictionary Resolverを再実行しない。matching coreが確定した
`resolution result` / `comparison result` を表示するだけ（NG-5）。graph側独自のcanonical
再選定は禁止。既存の `b4bProjectionCache` パターン（current-state-analysis §16, §17）と
同じ「単一計算点・全renderer読み取り専用」の設計を、新設するresolution表示にも適用する。

**Excel export**: 将来的に、次を出力できる設計を検討する。

- dictionary used / not used（このmatching sessionで辞書が有効だったか）
- dictionary version
- snapshot ID
- resolution type

ただし、private dictionary termsをshareable相当のoutputへ不用意に露出させない
（既存matching tool Excel exportはsource contentを含む設計のため、辞書由来の追加列を
どのsheetへどう出すかは慎重に検討し、既存のB-4b「必要最小限のみ」思想
— `trace_comparison_review_export_core.js` の attested-artifact-onlyパターン — を踏襲する）。

---

## S19. HUMAN-01/02/03の統合設計への反映

P2-A3人間評価で延期されたUX要件を、統合UI設計の正式要求としてここに記載する
（Checkpoint 1では設計のみ。UI実装はしない）。

**HUMAN-01**: 専門語は「日本語主表記 + 英語括弧併記」とする。

例: 候補（Candidate）/ 代表語（Canonical）/ 別名（Alias）/ 競合（Conflict）/
採用（ACCEPT）/ 却下（REJECT）/ 保留（UNCERTAIN）/ 未判定（UNREVIEWED）。

P2-A4統合UI（将来Checkpoint）でこの表記規則を新規UI要素すべてに適用する。

**HUMAN-02**: ボタン名だけで機能を理解できることを基本とし、1行の補助説明を添える。
private保存／resume／shareable保存の違いを明示する。P2-A4統合時に private
Dictionary Snapshot操作・照合session操作のボタン名を設計する際も同じ基準を適用する
（例:「辞書を照合ツールへ読み込む」等、目的語を明示した動詞句を優先する）。

**HUMAN-03**: 各フィルタ・プルダウンについて「何を絞り込むのか」「各選択肢が何を意味するのか」を
UIまたは統合マニュアルで説明可能にする。対象例: 判定 / 出典 / Rule / 属性 / 並び替え。
Dictionary resolution状態（`resolution_type` 等）を新たにfilter対象へ追加する際も同基準を適用する。

---

## S20. 通常照合時のUX目標（S1の再確認）

```text
照合開始
        |
        v
Dictionary Snapshot自動読込
        |
        v
既知語は自動resolution（人間操作なし）
        |
        v
matching実行（既存logic、変更なし）
        |
        v
要確認comparisonだけ表示
```

通常作業者は原則として辞書UIを開かなくてよい。辞書メンテナンスは別画面／別mode／別workflowと
して分離する（Promotion Validator・Snapshot生成・Conflict解消はP2-A3側の別ワークフロー）。

---

## S21. Non-goals（本Checkpoint、および統合初期sliceの対象外）

- automatic dictionary promotion（ACCEPTの自動ACTIVE化）
- ACTIVE dictionary registration の実装
- PROJECT / DOMAIN promotion の実装
- production dictionary merge
- dictionary rollback の実コード
- dictionary snapshot applicationのmatching engineへの実配線
- matching-tool側の実UI変更
- Advanced private JSON / Markdown export
- public release

---

## S22. 採用しないarchitecture（NG一覧）

| ID | 内容 | 本設計での対処 |
|---|---|---|
| NG-1 | P2-A3 private Workbookをmatching engineが直接読む | S3: Promotion Validator → Snapshotを経由必須 |
| NG-2 | ACCEPTしたcandidateをその場でACTIVEへ自動登録 | S6: Explicit activationを別処理として分離 |
| NG-3 | matching実行のたびに辞書レビューを要求 | S14, S20: Snapshotをsession開始時に一度読み込み、以降は自動 |
| NG-4 | Alias承認とcomparison承認で同じ意味判断を二重に要求 | S2, S8(=S1指す二重承認禁止): dictionary decisionとcomparison decisionを分離 |
| NG-5 | UI/graphがdictionary resolutionを独自再計算 | S18: 単一計算点・全renderer読み取り専用 |
| NG-6 | 最新版dictionaryを暗黙参照し、過去結果を再現できない | S14, S15: Snapshot pinning + content-addressable hash |
| NG-7 | unresolved Conflictから任意canonicalを選択 | S12: resolved_canonical=null、baseline matching継続 |
| NG-8 | invalid Snapshotの一部だけ適用 | S10: 全か無かのresolver有効化 |
| NG-9 | original TraceRecord文字列を上書きしprovenanceを失う | S4: sidecar方式、原文は不変 |
| NG-10 | Dictionary exact matchだけでcomparisonを無条件AUTO ACCEPT | S13: 既存スコア体系への入力信号の一つとして扱う |

---

## S23. Unresolved Design Questions（次Checkpointへの持ち越し事項）

1. Promotion Validatorがscope/canonical衝突を検出した際、「該当candidateのみ除外」か
   「Promotion全体を停止」かの粒度（S6.4）。
2. Dictionary一致信号を既存 `matchLogic` スコア体系へどの重みで統合するか（S13）。
3. Excel exportにおけるdictionary情報の具体的な列設計・sheet配置（S18）。
4. Unknown term収集queueの永続化形式・辞書メンテナンス画面との具体的な接続方法（S11）。
5. Conflict candidateをP2-A3のAlias Conflict機構へどう還流させるか、双方向のデータフロー
   （S12.B）。
6. matching tool側テキスト照合の comparison ID（現状formalな契約なし、
   current-state-analysis §4）と、Resolution Annotationの紐付けキーをどう設計するか
   — 数量subsystemの `comparison_id` 契約とは別に検討が必要。
7.（R1で追加）`effective_vocabulary` を既存 opt-in tag機構（`evaluateTagMatch()` /
   `buildTagIndex()` / `matchInitialTags()`）へどう接続するか。`matchLogic`側に独立カテゴリを
   新設する案とtag機構統合案のどちらが既存契約との整合性が高いか、次Checkpointで
   `matchInitialTags()`の実装を直接確認したうえで判断する（S13）。
8.（R1で追加）Snapshot wrapperの`wrapper_sha256`計算における、`dictionary_payload`の扱いの
   具体的なcanonical構造体定義（`dictionary_payload_sha256`という文字列をhash対象に含める案を
   S5.2で提示したが、実装Checkpointでの正式なフィールド列挙・型定義はまだ確定していない）。
9.（R1で追加）project configuration（S14のpinning元）の具体的な格納場所・形式
   （案件ごとのファイル、matching tool起動時の読み込み経路等）は未設計。
