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

**R2改訂**: Checkpoint 1-R2にて、以下を反映。変更点は各節に(R2-n)として明記する。

- S13: `matchInitialTags()`（matching tool内には存在せず、実際は無関係な別tool系統
  `excel_direct_adapter.js`/`pdf_direct_adapter.js`の同名関数であることが判明）への言及、
  および「`matchLogic`へ新しい独立カテゴリを追加する」という未確定推奨を撤回し、実コード確認済みの
  `_tagInfo`/`buildTagIndex()`/`evaluateTagMatch()`/`matchPlmParts()` chainへの拡張として
  再定義（R2-1）。
- S4.1（新設）: Resolution provenanceのSource of Truthを、既存P2-A1出力（layerViews/
  `mergeDictionaryLayers()`）から構築する方式（Option B）として確定（R2-2）。**R3-1で撤回・
  Option Aへ変更（下記R3改訂参照）。**
- S5.1/S5.2: `wrapper_sha256` を `wrapper_integrity_sha256` へ改称し、`dictionary_payload_sha256`
  との責務分離を明確化。全fieldのhash対象/対象外を表形式で確定（R2-3）。
- S5.1/S5.4（新設）: `snapshot_status` をimmutable wrapperから分離し、別の
  Snapshot Activation Recordへ移動（R2-4）。
- S6.4/S6.3: S6.4をS6.1の3-input契約と一致させ、`SELECT_CANONICAL`の意味を訂正（R2-5）。
- S9: `alias_rule_id` の扱いをS4.1の結論に合わせて訂正（R2-2）。

**R3改訂**: Checkpoint 1-R3にて、以下を反映。変更点は各節に(R3-n)として明記する。

- S4.1: R2版のOption B（P2-A4側でlayerView/mergeの出力を突き合わせてprovenance indexを
  再構築する方式）を撤回。`mergeDictionaryLayers()`（L1164-1231）の内部実装を再確認した結果、
  `entry_ref_id`はcanonical/aliasのpriority選択過程で破棄され、外部からの復元は
  P2-A1のscope priority/tie-break semanticsの再実装を要することが判明したため。代わりに
  Option A（P2-A1 coreへ`mergeDictionaryLayersWithProvenance()`という追加pure APIを後続
  実装Checkpointで追加し、既存`mergeDictionaryLayers()`と同じ内部計算からprovenance_indexを
  副産物として持ち帰る）を採用。duplicate同一canonicalマッピングのprovenanceは単一
  `selected_entry_ref_id`とし、`effective_vocabulary`の単一選択結果と1:1に対応させる（R3-1）。
- S5.1/S5.2: `wrapper_integrity_sha256`の対象を、`snapshot_id`/`snapshot_version`/
  `supersedes`/`rollback_target`を含む**自己参照field以外の全immutable field**へ拡張
  （従来はcontent-addressability目的でこれらを対象外としていたが、その責務は
  `dictionary_payload_sha256`が既に単独で担うため、`wrapper_integrity_sha256`は純粋な
  改ざん検知に特化させ、対象外fieldを残さない設計へ改めた）（R3-2）。
- S4/S13: `_tagInfo.approvedDict`の生成・合成規則を実コード（`buildRowTagInfo()`/
  `composeFinalTags()`/`buildTagDisplayMap()`/`buildTagIndex()`/`evaluateTagMatch()`等）に
  基づき10項目で確定（R3-3）。

**R4改訂**: Checkpoint 1-R4にて、以下を反映。変更点は各節に(R4-n)として明記する。

- S10.1（新設）: Snapshot Loaderのhash validation順序を10ステップで正式contract化。
  格納された`dictionary_payload_sha256`を無検証のままwrapper integrity hash inputとして
  信用しない、という制約を明記（R4-1）。
- S13.1: `_tagInfo.approvedDict`のtokenization規則をP2-A4 0.1として完全固定
  （scalar=value全体、array=要素ごと、object=対象外、delimiter split/substring/fuzzy/AI推定
  すべて禁止）。S23旧#13を解決済みへ移動（R4-3）。

**Checkpoint 2**（設計文書の変更なし）: `mergeDictionaryLayersWithProvenance()`を
`private_dictionary_learning_core.js`へadditive pure APIとして実装し、S4.1（R3-1）で
決定したOption Aを完了した（commit `95df19f9d0a6764baff051934bb59b806fd924c6`）。
既存`mergeDictionaryLayers()`の戻り値はbit-for-bit不変。S23旧#11をこのCheckpointで
解決済みへ移動する（下記）。

**Checkpoint 3A改訂**: S5.5（新設）でSnapshot Wrapper 0.1の正確なfield contract
（型・format・PROJECT-only制約・builder入力/loader返り値のfield集合の違い・今回のscope外事項）
を正式固定した。実装は`private_dictionary_snapshot_core.js`（Checkpoint 3B）で行う。

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
  "wrapper_integrity_sha256": "<hex64>",
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

### S4.1 Resolution Annotation Provenance Source of Truth（R2-2で新設、R3-1で全面改訂）

S4の「Resolution Annotation の最小構成案」は `dictionary_entry_id`/`scope`/`status` 等の
provenance fieldを含むが、**これらは`effective_vocabulary`単体からは復元できない**。
`effective_vocabulary`（`mergeDictionaryLayers()`の出力）は
`{allowed_tags:[canonical表示名の配列], aliases:{alias表示名→canonical表示名}}` という
**flatなマッピング**であり（current-state-analysis §18.1）、entry識別子・scope・statusは
含まれない。Resolverがprovenance付きのResolution Annotationを生成するには、
`effective_vocabulary`とは別に、これらの識別情報を保持する仕組みが必要である。

**R3-1: R2版のOption B（P2-A4側でlayerView/merge出力を突き合わせてprovenance indexを
再構築する）を撤回する。** `private_dictionary_learning_core.js`（L1164-1231）の
`mergeDictionaryLayers()`実装を再度直接読解した結果、次の事実を確認した:

- canonical選択: `canonicalGroups`は`canonical_key`ごとに全layerの候補（`status==='ACTIVE'`かつ
  非conflictのみ）を`candidates`配列へ集約した後、`priority`（`SCOPE_PRIORITY`のindex、小さいほど
  優先）→ 同点なら`ordinalCompare(display)`で**sortし、`candidates[0]`のみを採用する**
  （L1194-1201）。**採用元の`entry_ref_id`はこの時点で`candidates`配列から破棄され、
  `effective_vocabulary.allowed_tags`には表示名しか残らない。**
- alias選択: `group.aliasMap`は同一`alias.key`について「priorityがより小さい、または同点なら
  displayのordinal順がより小さい」候補で**逐次上書き**する（L1186-1189, `if (!existing ||
  priority < existing.priority || ...)`）。この時点でも`{priority, display}`のみが保持され、
  `entry_ref_id`は保持されない。

つまり、**`effective_vocabulary`のどのcanonical/alias表示名がどのlayer（＝どの`entry_ref_id`）
に由来するかを決定するロジックは、`mergeDictionaryLayers()`内部の`candidates`/`aliasMap`の
sort・上書き処理そのもの**であり、外部からlayerViewと`effective_vocabulary`を単純に
突き合わせるだけでは、複数layerが同一canonical_key/alias keyを主張するケース（同一canonicalを
SESSION/PROJECT両方が定義している等）で**どちらが採用されたかを一意に復元できない**
（表示名が同じ場合はなおさら区別不能）。R2版のOption Bは、この事実を確認しないまま
「layerViewとeffective_vocabularyを机上で対応付けられる」と誤って前提していた。正確な
`entry_ref_id`復元のためには、P2-A4側で`SCOPE_PRIORITY`の優先順位比較と`ordinalCompare`
tie-breakを**再実装**する必要があり、これはR1-3で確定した「P2-A1のmerge/conflict/priority
semanticsをP2-A4側で再実装しない」という原則に反する。よってOption Bは撤回する。

**採用方針: Option A（P2-A1 coreへadditive pure APIを後続実装Checkpointで追加する）。**

```text
private_dictionary_learning_core.js の新規export（概念、実装はしない）:

mergeDictionaryLayersWithProvenance(layerViews)
  -> {
       effective_vocabulary,          // 既存 mergeDictionaryLayers() と完全に同じ値・同じ計算
       conflicts,                     // 同上
       excluded_lookup_key_tokens,    // 同上
       source_fingerprints,           // 同上
       provenance_index: {            // 新規。同一のcanonicalGroups/aliasMap計算過程から
         canonical: {                 // 副産物として生成する（計算をやり直さない）
           "<canonical_key>": {
             selected_entry_ref_id, selected_scope, selected_status,
             selected_dictionary_fingerprint, resolution_kind: "canonical"
           }, ...
         },
         alias: {
           "<alias_key>": {
             selected_entry_ref_id, selected_scope, selected_status,
             selected_dictionary_fingerprint, canonical_key, resolution_kind: "alias"
           }, ...
         }
       }
     }
```

- **既存`mergeDictionaryLayers()`の公開契約・戻り値は一切変更しない。** 新APIは既存関数を
  置き換えるのではなく、**同じ内部計算（`canonicalGroups`の構築・sort・`aliasMap`の逐次上書き）を
  1回だけ実行し、その計算過程で自然に確定する「どのentryが勝者だったか」という情報を
  追加で持ち帰る**設計とする。既存`mergeDictionaryLayers()`は内部で新APIを呼び、
  `provenance_index`を捨てて元の戻り値のみを返す薄いwrapperとして再実装してもよい
  （後続Checkpointの実装判断。既存の`effective_vocabulary`/`conflicts`等の値がbit-for-bit
  変化しないことが必須要件）。
- P2-A4側（Resolver）は`mergeDictionaryLayersWithProvenance()`を呼ぶだけであり、
  **priority比較・tie-break・conflict除外のロジックを一切再実装しない**。R1-3/R2-2で確定した
  「P2-A1をSource of Truthとする」原則をR3でむしろ強化する結果となる。

**duplicate同一canonicalマッピングのprovenance契約（単一selected ref vs. contributing refs配列）**:

既存`mergeDictionaryLayers()`自身の意味論が、そもそも**常に単一勝者を選択する**設計である
（`candidates[0]`のみ採用、`aliasMap`は逐次上書きで最終的に1件のみ残る）。
`effective_vocabulary`自体も、あるcanonical_key/alias keyに対して**複数の表示名を同時に
公開することはない**（1 key = 1 display）。したがって、provenance側だけが「寄与した全entry」を
複数値として公開すると、`effective_vocabulary`（単一選択の結果）とprovenance
（複数候補の集合）の間で対応関係が崩れ、「このcanonical表示名の出自はこのentryである」という
1:1の主張ができなくなる。

**R3-1の結論: 必須契約は単一`selected_entry_ref_id`とする**（`effective_vocabulary`の
選択結果と1:1に対応させる）。これにより、同一canonical_keyを複数layerが主張する場合でも、
provenance_indexは常に「実際に採用された1件」のみを指し、曖昧さを生まない。

任意（optional）の拡張として、`canonicalGroups`/`aliasMap`は勝者選択の前に全候補
（`candidates`配列全体）を既に計算済みであるため、非採用の候補（shadowed candidates）を
`shadowed_entry_refs`のような**補助的・非必須のfield**として同時に公開すること自体は
将来のCheckpointで検討してよい（辞書メンテナンスUIでの「他layerにも同名candidateがあった」
という監査表示に使える可能性がある）。ただし、これはResolution Annotation/Provenanceの
**必須field(S9)には含めない**。必須契約は単一selected refのみで完結させる。

**`alias_rule_id`の処遇（訂正）**: S4/S9のResolution Annotation/Provenance必須項目案に
`alias_rule_id`（「P2-A3の`rule_ids`契約と対応させる」）が挙がっていたが、
`private_dictionary_learning_core.js`の`ALLOWLISTED_FIELD_NAMES`（R1で確認済み）を確認した結果、
**`rule_id`/`rule_ids`に相当するfieldは存在しない**。つまりP2-A1の正式schema（
`private-dictionary-overlay/1.0`）を経由した時点で、どのP2-A3抽出ruleに由来するcandidateだったか
という情報は失われる（P2-A1はrule起源を保持しない設計になっている）。

このため、**`alias_rule_id`をResolution Annotationの必須fieldから外す**（推測値を生成しない
という原則、R1-2/R2directive「never generate a guessed value」に従う）。rule起源の追跡が
将来的に必要になった場合は、Resolution Annotationとは別に、Promotion Validatorが
Promotion実行時点で生成する**独立したcontent-addressed「Promotion Provenance Artifact」**
（`candidate_id`/`alias_id` → 由来ruleの記録）を新設し、Snapshot wrapperの
`promotion_record_identity`（S5.1）経由で参照可能にする、という設計を候補として残す
（具体的なartifact schemaは後続Checkpointで設計。unresolved design question、S23参照）。
**現時点で`alias_rule_id`に推測値・ダミー値を割り当てることはしない。**

### S4.2 Dictionary Resolver Pure Core（Checkpoint 6で正式固定）

S4/S4.1の設計を、`tools/knowledge_builder/core/private_dictionary_resolver_core.js`として
実装・確定した。Checkpoint 3の`PrivateDictionarySnapshotCore.loadDictionarySnapshotWrapper()`と
P2-A1の`createPrivateDictionaryLayerView()`/`mergeDictionaryLayersWithProvenance()`のみを
使うpure orchestration層であり、winner選択・conflict判定・ハッシュ計算のいずれも独自実装しない。

**Resolver Input 0.1**（`private-dictionary-resolution-input/0.1`）: トップレベルは
`{schema_version, snapshot_wrapper, terms}`の3 fieldのみ、追加field禁止。`snapshot_wrapper`は
Checkpoint 3の`private-dictionary-snapshot-wrapper/0.1`そのものであり、Resolverは格納payloadを
一切信用せず必ず`loadDictionarySnapshotWrapper()`を通す。`terms`はTraceRecord非依存の文字列配列
（Resolverはfield名・tokenization一切を知らない。TraceRecord→terms変換は別Checkpointの責務）。
`terms.length`上限50000（`RESOLVER_TERMS_LIMIT_EXCEEDED`）、各term長1-256文字。入力順序を
出力annotation順序としてそのまま維持し、duplicate termも1件ずつ独立にresolveする（dedupe/reorder
しない）。

**Batch Output 0.1**（`private-dictionary-resolution-batch/0.1`）: `{schema_version,
snapshot_binding, annotations}`。`snapshot_binding`は`{snapshot_id, snapshot_version,
wrapper_integrity_sha256, dictionary_payload_sha256, dictionary_id, dictionary_version, scope}`
であり、すべて`validatedSnapshot`からの値コピーのみ（再hash禁止）。`annotations[i]`は
`terms[i]`への解決結果であり、`annotations.length === terms.length`必須。

**exact whole-term規則**: 入力term全体を`KnowledgeIdHashUtils.normalize()`した1つのkeyのみで
lookupする。substring・prefix/suffix・delimiter split（comma/slash/whitespace tokenization含む）・
fuzzy・edit distance・stemming・AI推定・semantic similarity・synonymMap・regex検索は一切行わない
（Checkpoint 6は厳密exact-match resolverとして固定する）。

**normalize Source of Truth**: `KnowledgeIdHashUtils.normalize()`のみを使用し、P2-A2の
`foldComparisonKey()`やRule Extraction独自normalizer、独自lower-case/trim処理を一切使わない。

**canonical/alias precedence**: normalizedKeyに対し、(1) `provenance_index.canonical`に存在すれば
`EXACT_CANONICAL`、(2) canonicalになく`provenance_index.alias`に存在すれば`APPROVED_ALIAS`、
(3) いずれにも存在しないがP2-A1 Layer View上のACTIVE lookup keyだった場合は`DICTIONARY_CONFLICT`、
(4) それ以外は`UNKNOWN_TERM`。canonicalを必ずaliasより先に評価する。

**P2-A1 provenance Source of Truth**: `provenance_index.canonical[key].selected_entry_ref_id`/
`provenance_index.alias[key].selected_entry_ref_id`のみをwinner／alias-source識別子として使用し、
Resolver自身が`entries`配列のfirst/last・表示名sort等からwinnerを選ぶことは一切しない。同一
normalized canonical keyを複数ACTIVE entryが持つ場合でも、layer entries配列の走査順序に
resolution結果が依存しないことをNode検証（G/H項目）で確認済み。

**alias source entry vs canonical display winner**: APPROVED_ALIASの`dictionary_entry_id`は
「そのaliasを提供したentry（alias source）」であり、`resolved_canonical`は
`provenance_index.canonical[alias provenanceのcanonical_key]`が指す**canonical表示winner entry**の
`canonical_display`である。alias source entry自身の`canonical_display`を`resolved_canonical`へ
誤用しない（両者が異なるentryになるケースをNode検証I項目で確認済み）。

**UNKNOWN_TERM**: 辞書に存在しないtermはResolver全体のerrorではなく、正常な解決結果の1種として
返す（`resolved_canonical`/`dictionary_entry_id`/`scope`/`status`はすべて`null`）。matchingを
止めるかどうかは呼び出し側（次Checkpoint）の責務。

**DICTIONARY_CONFLICT**: P2-A1がconflictとして`effective_vocabulary`／`provenance_index`から
除外したlookup keyについても、Resolver全体のerrorにはしない。該当termのみ
`resolution_type: DICTIONARY_CONFLICT`（全fieldnull）とし、conflictの判定はP2-A1が生成した
layer viewのACTIVE entryが持つlookup keyの単純membership集合（`activeLookupKeys`）と
provenance_indexの不在の組み合わせのみで行う。P2-A1のconflict grouping/winner選択algorithmを
Resolver側で再実装することはしない。

**conflict local continuation**: 同一batch内に conflict term と正常解決可能な term が混在しても、
1件のconflictがbatch全体を無効化しない。conflict term以外は通常どおり解決される。

**snapshot binding**: `annotations[i].dictionary_snapshot_id`/`wrapper_integrity_sha256`は
常に`validatedSnapshot.snapshot_id`/`wrapper_integrity_sha256`（Resolver自身の再hash禁止）。

**atomicity**: Checkpoint 3/4/5と同一原則。関数開始時の同期phaseで`root`/`schema_version`/
`snapshot_wrapper` reference/`terms`配列をdescriptor-based安全readでcaptureし、Snapshot Loader
呼び出しをResolver自身の最初の`await`より前に開始する。caller inputをawait後に再readしない。

**fail-closed**: 依存先（Snapshot Loader/`createPrivateDictionaryLayerView`/
`mergeDictionaryLayersWithProvenance`/`normalize`）のsync throw・Promise reject・malformed
return・hostile Proxy returnは、いずれもnative Error/message/stack/causeを外部へ一切漏らさず、
固定の`{code, path}`（`RESOLVER_SNAPSHOT_LOAD_FAILED`/`RESOLVER_LAYER_VIEW_FAILED`/
`RESOLVER_MERGE_FAILED`/`RESOLVER_NORMALIZATION_FAILED`/`RESOLVER_CONTEXT_BINDING_MISMATCH`等）
へsanitizeする。caught valueの内容（`.code`/`.path`含む）を信用して再throwすることはしない
（Checkpoint 5-R2で確定したComposition core同水準のfail-closed境界を、Resolverでも独立実装した）。

**PROJECT-only**: Checkpoint 6では`validatedSnapshot.scope === 'PROJECT'`のみを受理する。
SESSION/DOMAIN/STANDARD scopeのSnapshotは`RESOLVER_SCOPE_UNSUPPORTED`で拒否し、今回は実装しない
（multi-layer runtime統合は別Checkpointの対象、S23参照）。

**今回実装しないもの（Checkpoint 6のスコープ外、明示）**: TraceRecord→terms抽出（field/row
tokenization）、`_tagInfo.approvedDict`生成・matching tool統合、UI/Excel/graph、unknown term
queueの永続化、Snapshot Activation Record・project configuration・latest snapshot選択・rollback、
STANDARD/DOMAIN/SESSION layerの実行時統合、P2-A3 Review State→Promotion Input adapter。

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

**S5.1 Snapshot Wrapper Schema**（Checkpoint 1で定義する項目。実装はしない。R2-3/R2-4で改訂）:

| field | 内容 | 備考 |
|---|---|---|
| `wrapper_schema_version` | 例 `private-dictionary-snapshot-wrapper/0.1` | wrapper自体のschema。辞書本文のschemaとは別軸 |
| `snapshot_id` | 例 `dsnap-<hex32>` | 内容に依存しない発番（重複禁止の識別子） |
| `dictionary_payload` | **`private-dictionary-overlay/1.0` の辞書本体そのもの**（1 scope layer分、`validatePrivateDictionary()` で検証可能な構造） | 第二の正本を作らない。P2-A1の既存構造をそのまま埋め込む |
| `dictionary_payload_sha256` | `hashPrivateDictionaryCanonical(dictionary_payload)` の出力 | **辞書内容の同一性のみ**を表す。P2-A1の既存関数をそのまま呼び出す（下記S5.2）。**この値の責務は「同じ辞書内容なら同じhash」のみであり、wrapper全体の改ざん検知を兼任しない（R2-3）** |
| `wrapper_integrity_sha256` | wrapper artifact全体（自己参照field除く）のcanonical serializationのSHA-256 | **（R2-3で`wrapper_sha256`から改称）** wrapperの**改ざん検知**専用。`dictionary_payload_sha256`とは責務が異なる別hash。S5.2のhash projection参照 |
| `snapshot_version` | 単調増加の版番号（wrapper発行ごと） | rollback対象の識別に使う(S12) |
| `scope` | `dictionary_payload.scope` と一致必須（`PROJECT`、初期実装はS7参照） | 二重管理を避けるため、wrapperのscope fieldはpayload内scopeのミラーとしてのみ存在し、検証時に不一致ならreject |
| `provenance` | 生成元の追跡情報 | 下記S9参照 |
| `source_review_artifact_identity` | 元になったP2-A3 Review Workbookの識別（file名ではなくSHA-256等） | 実体は含めない（S17でprivacy検討） |
| `promotion_record_identity` | S6のPromotion Validatorが生成した記録への参照 | |
| `source_commit` | 生成時のrepository commit SHA | 再現性のため |
| `conflict_state` | このSnapshotに含まれなかった未解決Conflictの要約（件数のみ等。個別内容はSnapshotに含めない方針、S17） | S12のB類（layer merge時lookup conflict）とは別。S5.3参照 |
| `supersedes` | 直前のsnapshot_idへの参照 | rollback chainの構成(S16) |
| `rollback_target` | 明示的にrollbackされた場合の遡及先 | |

**（R2-4で削除）`snapshot_status`はwrapperから除去した。** 理由・移動先はS5.4参照。

**S5.2 Hash Projection（完全固定、R2-3で全field網羅の表へ改訂、R3-2で対象範囲を拡張）**:

2つのhashは責務が異なる。

- **`dictionary_payload_sha256`**: 「同じ辞書内容（`dictionary_payload`）なら常に同じhash」を
  保証する。`hashPrivateDictionaryCanonical(dictionary_payload)`をそのまま呼び出すのみで、
  wrapperの他fieldには一切依存しない。**content-addressability（同一内容なら同一hash）の責務は
  この値が単独で担う。**
- **`wrapper_integrity_sha256`**: wrapper artifact全体（自分自身を除く、immutable fieldの
  すべて）の改ざん検知を担う。1 byteでもimmutable fieldが変化すればこの値も変化しなければ
  ならない。**R3-2で方針を明確化: content-addressabilityの責務は`dictionary_payload_sha256`が
  既に単独で担っているため、`wrapper_integrity_sha256`はそれと責務を分担する必要がなく、
  純粋な改ざん検知に特化させてよい。したがって、自己参照field（`wrapper_integrity_sha256`
  自身）を除く、immutableなwrapper fieldを一つも対象外にしない。** R2-3版では
  `snapshot_id`/`snapshot_version`/`supersedes`/`rollback_target`を「発番・連番・リンク情報で
  内容そのものではない」という理由で対象外としていたが、これは「hashは内容の同一性判定にのみ
  使う」という前提に立った場合の理由付けであり、`wrapper_integrity_sha256`の真の責務
  （wrapper全体の改ざん検知）とは無関係だった。**これらのfieldが改ざん・すり替えされても
  検知できないのは改ざん検知hashとして不完全であるため、R3-2でこの4 fieldも対象へ含める。**

以下、S5.1の全fieldについてhash対象（`wrapper_integrity_sha256`計算への算入）可否とその理由を
明示する。

| field | hash対象 | 理由 |
|---|---|---|
| `wrapper_schema_version` | 対象 | wrapper構造自体の版。変化すれば別構造として区別すべき改ざん相当の変化 |
| `snapshot_id`（R3-2で対象化） | 対象 | 発番方式に依存する識別子だが、`wrapper_integrity_sha256`の責務は改ざん検知であり内容同一性判定ではない（それは`dictionary_payload_sha256`の責務）。`snapshot_id`が別の値へすり替えられた場合も検知できるべきであるため対象に含める |
| `dictionary_payload` | 対象（`dictionary_payload_sha256`という文字列として算入） | payload全体を二重にhashするのを避けるため、`dictionary_payload`そのものではなく、既に計算済みの`dictionary_payload_sha256`の値（string）をhash入力へ含める。これにより`dictionary_payload`の改変は必ず`wrapper_integrity_sha256`へ波及する |
| `dictionary_payload_sha256` | 対象（上記と同一の算入経路） | 同上 |
| `wrapper_integrity_sha256` | **対象外（自己参照不可）** | 自身のhash値をhash対象に含めることはできない。全immutable field中で対象外となるのはこのfieldのみ |
| `snapshot_version`（R3-2で対象化） | 対象 | 外部連番であっても、`snapshot_version`が改ざんされれば版数の偽装（例: 古いversionを新しいと詐称）を検知できなくなるため対象に含める |
| `scope` | 対象 | `dictionary_payload.scope`のミラー。scopeの改ざんはPROJECT/DOMAIN境界という重大な意味変化のため、検知対象に含める |
| `provenance` | 対象 | 生成元追跡情報そのものが改ざん検知の主対象（誰がいつ生成したかの偽装を防ぐ） |
| `source_review_artifact_identity` | 対象 | 由来artifactのすり替え検知のため |
| `promotion_record_identity` | 対象 | 同上 |
| `source_commit` | 対象 | 誤った/偽装されたcommitへのすり替え防止のため、改ざん検知対象に含める（生成環境情報だが、値そのものの真正性は保証したいため`provenance`とは別に明示算入する） |
| `conflict_state` | 対象 | S12.Aの「内部不整合Snapshotは生成しない」保証に関わる要約。改ざんされるとその保証が無意味化するため対象に含める |
| `supersedes`（R3-2で対象化） | 対象 | version chain上のリンク情報だが、改ざんされればrollback chainの完全性（S16）が偽装されうるため対象に含める |
| `rollback_target`（R3-2で対象化） | 対象 | 同上。明示的rollback先の偽装を検知できる必要がある |
| `snapshot_status`（R2-4で削除） | 該当なし | wrapper本体から除去されたため、そもそも`wrapper_integrity_sha256`の算入対象になり得ない。運用上の活性化状態はS5.4のSnapshot Activation Record側で別管理し、そちらはimmutable wrapperのhash対象ではない（可変値のため） |

**R3-2で確定した性質**: 上表の通り、**自己参照field（`wrapper_integrity_sha256`自身）を除く
immutable wrapper fieldは1つも対象外に残らない。** これにより「1 byteでもimmutable field
（`wrapper_integrity_sha256`以外のいずれか）が変化すれば、`wrapper_integrity_sha256`も
必ず変化する」という性質が、例外なく成立する。同時に、`snapshot_id`/`snapshot_version`等が
異なるだけの2つのwrapper（`dictionary_payload`は同一）は、`dictionary_payload_sha256`は
一致するが`wrapper_integrity_sha256`は不一致になる — これは責務分離の意図した挙動であり、
矛盾ではない（`dictionary_payload_sha256`＝内容同一性、`wrapper_integrity_sha256`＝
artifact全体の完全性、という異なる問いに答えるため）。

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
`wrapper_integrity_sha256`についても、wrapper用のcanonical構造体（上表の「対象」fieldのみを
含む）を組んだ上で同じ`canonicalJson()` + SHA-256の手順を再利用し、独自のhashアルゴリズムを
新設しない。

**S5.3 SnapshotとConflictの関係（R1-5、詳細はS12参照）**: wrapperの`conflict_state`は
「Promotion Validatorが**このSnapshotの生成をブロックした**内部不整合」（S12 A類）の要約のみを
指す。複数scope layerを`mergeDictionaryLayers()`でmergeする際に生じるlookup conflict（S12 B類）
は、そもそもSnapshot単体（1 scope layer分の`private-dictionary-overlay/1.0`）には存在しない概念
であり、merge時点（matching tool起動時、複数Snapshotを束ねる段階）で毎回計算される。
`conflict_state`フィールドとB類conflictを混同しない。

### S5.5 Snapshot Wrapper 0.1 Field Contract（Checkpoint 3Aで正式固定）

S5.1で定義したwrapper fieldの**正確な型・format**をここで固定する。実装（Checkpoint 3B、
`tools/knowledge_builder/core/private_dictionary_snapshot_core.js`）はこの表を正本とする。

**top-level fields**: 以下14個のみ。additional property禁止。`snapshot_status`は含めない
（S5.4参照）。

| field | 型・format | 備考 |
|---|---|---|
| `wrapper_schema_version` | 完全一致文字列 `"private-dictionary-snapshot-wrapper/0.1"` | |
| `snapshot_id` | `^dsnap-[0-9a-f]{32}$` | **caller-supplied。Snapshot core内部では自動発番しない**（`Math.random()`/`crypto.randomUUID()`/`Date.now()`等からの暗黙生成禁止）。発番方法自体は後続Checkpointの対象 |
| `dictionary_payload` | valid `private-dictionary-overlay/1.0` object | P2-A1 `validatePrivateDictionary()`で検証する。第二schemaを作らない |
| `dictionary_payload_sha256` | `^[0-9a-f]{64}$` | `hashPrivateDictionaryCanonical(dictionary_payload)`の出力そのもの |
| `wrapper_integrity_sha256` | `^[0-9a-f]{64}$` | S5.2のhash projection参照 |
| `snapshot_version` | `Number.isSafeInteger(value) && value >= 1` | 今回のcoreは単一artifactの型検証のみ行い、**「単調増加履歴」そのものは検証しない**（後続Checkpointの対象） |
| `scope` | 完全一致文字列 `"PROJECT"` | **P2-A4初期sliceでは`PROJECT`のみ許可**（S7の`PROJECT-first`方針と整合）。`DOMAIN`/`SESSION` snapshotは今回生成・受理禁止。さらに`wrapper.scope === dictionary_payload.scope`必須（不一致はreject） |
| `provenance` | `{ generated_at, generator }`（他field禁止） | `generated_at`: `YYYY-MM-DDTHH:mm:ss.sssZ`形式のcanonical UTC timestamp文字列、**caller supplied**（Snapshot core内部で現在時刻を生成しない）。`generator`: `{ tool, version }`（他field禁止）、両方non-empty string |
| `source_review_artifact_identity` | `{ sha256 }`（他field禁止） | `sha256`は64 lowercase hex。**file nameやprivate termをidentityに使わない** |
| `promotion_record_identity` | `{ sha256 }`（他field禁止） | `sha256`は64 lowercase hex。Checkpoint 4で`private_dictionary_promotion_core.js`が算出方法を正式固定した（S6.5.9）。Checkpoint 3時点ではPromotion Validator未実装のためsynthetic value（呼び出し側が用意した仮値）を許容していたが、Checkpoint 4以降は`promoteReviewedCandidatesToProjectDictionary()`の出力をこのfieldへ渡せる。ただしCheckpoint 4では`buildDictionarySnapshotWrapper()`自体は呼び出さない（接続は後続Checkpoint） |
| `source_commit` | `^[0-9a-f]{40}$` | 生成時のrepository commit SHA |
| `conflict_state` | `{ unresolved_count }`（他field禁止） | `unresolved_count`は non-negative safe integer。**private candidate名・alias名・conflict本文は一切含めない**（S17） |
| `supersedes` | `null` または有効な`snapshot_id` format | `supersedes !== snapshot_id`必須（自己参照禁止）。**chain全体の存在確認・循環検査は今回対象外**（後続Checkpoint） |
| `rollback_target` | `null` または有効な`snapshot_id` format | `rollback_target !== snapshot_id`必須（自己参照禁止）。circular/existence検査は同上、今回対象外 |

**builder入力（`buildDictionarySnapshotWrapper()`）の項目**: 上記14 fieldのうち
`wrapper_schema_version`/`scope`/`dictionary_payload_sha256`/`wrapper_integrity_sha256`の
4つを**除いた10 field**（`dictionary_payload`/`snapshot_id`/`snapshot_version`/`provenance`/
`source_review_artifact_identity`/`promotion_record_identity`/`source_commit`/
`conflict_state`/`supersedes`/`rollback_target`）をcallerから受け取る。`wrapper_schema_version`
は固定文字列としてbuilder自身が設定し、`scope`は検証済み`dictionary_payload.scope`から導出し、
両hashはbuilder自身が計算する（**caller supplied hashは受け取らない**）。

**loaderの返り値（`loadDictionarySnapshotWrapper()`）**: `wrapper_schema_version`を除いた
**13 field**の deep-frozen "validated snapshot handle"。S10.1 step10（Checkpoint 3の境界）は
「validated snapshotを返せる状態になる」ところまでであり、Dictionary Resolver自体は
Checkpoint 3の対象外（S13/S13.1参照、Resolverの実装は後続Checkpoint）。

**Checkpoint 3の明示的スコープ外事項**（S17参照、S21のNon-goalsへも波及）:

- raw JSON textの受け取り・parse（loaderはobjectを受ける。file I/Oも対象外）
- `snapshot_version`のchain monotonicity検証（版番号が本当に単調増加しているかの検証）
- `supersedes`/`rollback_target`が指すsnapshot chain全体の存在確認・循環検査
- Promotion Validator・Snapshot Activation Record・project configuration・Dictionary Resolver
  の実装（いずれも未実装のまま）

### S5.4 Snapshot Activation Record（R2-4で新設: immutable wrapperと可変運用状態の分離）

R1版のS5.1は`snapshot_status`（`ACTIVE`/`SUPERSEDED`等）をwrapper内fieldとして定義していたが、
これは「Dictionary Snapshotはversioned immutable content artifactである」という設計原則（S16）
と**矛盾する**。immutableと宣言したwrapperの中に「現在の運用状態」という時間とともに変化する
値を同居させると、(a) 同じ`snapshot_id`のwrapperが発行後に書き換わってよいのか曖昧になる、
(b) `wrapper_integrity_sha256`が可変fieldを含んでしまうと、運用状態が変わるたびにhashが変わり、
「wrapperのcontent-addressabilityは辞書内容に対して安定である」という前提（S15）が崩れる、
という2つの問題を招く。

**解消方針**: Snapshot wrapper本体は**完全にimmutableな内容artifact**とする
（`snapshot_status`を持たない）。「現在どのSnapshotが有効か」という運用状態は、wrapperとは
**別の、変更可能な小さいレコード**として管理する。

```json
{
  "activation_record_schema_version": "private-dictionary-snapshot-activation/0.1",
  "dictionary_snapshot_id": "dsnap-<hex32>",
  "wrapper_integrity_sha256": "<hex64>",
  "activation_status": "ACTIVE",
  "updated_by": "<human operator識別子>"
}
```

- `activation_status`候補値: `ACTIVE` / `SUPERSEDED` / `ROLLED_BACK`。
- このレコードは**書き換え可能**（Activation自体は運用上のbookkeepingであり、immutable
  contentではない）。書き換えの都度、新しいSnapshotが生成されるわけではない。
- **matching sessionのSnapshot Loaderは、このActivation Recordを検索して「現在ACTIVEな
  snapshotを探す」ことはしない。** それはS14が禁止する「暗黙のlatest探索」の再導入になる。
  Snapshot Loaderは常にS14のproject configurationが指す**厳密なsnapshot identity**のみを読む。
  Activation Recordは、辞書メンテナンス側UI（P2-A3拡張、将来slice）が「このsnapshotは既に
  supersededである」等を人間へ表示するための**監査・表示専用**の情報であり、matching session
  の挙動には一切影響しない。
- P2-A1既存のentry単位status（`PROBATION`/`ACTIVE`/`OBSERVING`/`QUARANTINED`/`RETIRED`、S8）
  とは**完全に別軸**である。entry単位statusは`dictionary_payload`内（P2-A1契約のまま、
  wrapperの中のimmutable content）に存在し続ける。Activation Recordが管理するのは
  「Snapshotという単位そのものの選択状態」であり、Snapshot内の個々のentryの状態ではない。

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

### S6.3 Conflict resolution enumごとのpromotion eligibility（R2-5で`SELECT_CANONICAL`行を訂正）

P2-A3の`conflict_resolutions`は次のenumを持つ（既存contract準拠）。各値ごとのpromotion可否を
明示する。

| `resolution` | promotion対象か | 理由 |
|---|---|---|
| `UNRESOLVED` | **対象外** | 未解決。当該conflictに関わる全candidateをpromotion対象から除外する |
| `SELECT_CANONICAL` | 選択された`selected_candidate_id`は**条件付きで対象**（S6.2の要件を別途満たす必要がある）。**選択されなかった他のconflicting candidateは、この解決だけを理由に対象外にはしない**（各candidate自身の`candidate_decisions`の状態に従い、S6.2の要件を独立に満たせばpromotion対象となりうる） | R2-5で訂正: `private_dictionary_candidate_review_ui_contract_0.1.md`（L205-260）が定義する`conflict_resolutions`schemaを確認した結果、`SELECT_CANONICAL`は「選択されたcandidateへalias対応関係を割り当てる」ことのみを意味し、非選択candidateの`candidate_decisions`そのものを書き換える・無効化するという契約は存在しない。conflict resolution UIの実装（`onConflictSelect()`相当のhandler）も、選択操作でaliasのcanonical割り当てを更新するのみで、非選択candidateのACCEPT/REJECT状態には触れない。これを根拠なく「対象外」とみなすことは、P2-A3契約にない除外をPromotion層が勝手に発明することになるため訂正した |
| `REJECT_ALL` | **対象外**（関与する全candidateを除外） | 人間が明示的に「いずれも採用しない」と判断した結果 |
| `CONTEXT_DEPENDENT` | **対象外** | 文脈依存と判断されており、辞書全体で一意に正式化できる状態ではない |
| `UNCERTAIN` | **対象外** | 判断保留 |

**補足（R2-5）**: `SELECT_CANONICAL`の下で非選択candidateが独立にpromotion対象となりうる場合でも、
そのcandidateが選択されたcanonicalと**同一のlookup key/canonical_keyを主張する**なら、
Promotion Validatorのcanonical衝突検出（S6.4手順3）により別途弾かれる可能性がある。つまり
「conflict resolution自体は非選択candidateを除外しない」ことと「canonical衝突検証で結果的に
弾かれることがある」ことは別の話であり、両者を混同しない。

### S6.4 Promotion Validatorの最小責務（設計のみ、R2-5でS6.1と不整合だった記述を修正）

1. 入力: **S6.1の3つの独立した入力集合**（`candidate_decisions`/`alias_decisions`/
   `conflict_resolutions`）。（R2-5で訂正: 旧版は「ACCEPT decisionのみ抽出」という
   S6.1と矛盾する簡略化された記述だったが、S6.1が定めた3-input契約と完全に一致させた。
   「ACCEPTのみ抽出すればよい」という含意は撤回する — alias eligibility（S6.2）と
   conflict resolution（S6.3）の判定には、`alias_decisions`と`conflict_resolutions`の
   実際の内容が不可欠であり、`candidate_decisions`のACCEPTのみでは判定できない）。
2. scope衝突検出: 同一canonical termが異なるscopeで矛盾する定義を持たないか。
3. canonical衝突検出: 既存Snapshot中のcanonical/aliasと矛盾しないか
   （例: 既にalias Aとして承認済みの語を、別candidateがcanonical Bとして提案していないか）。
4. いずれかの検証に失敗した場合、当該candidateのみを除外するか、Promotion全体をfail-closedで
   停止するかは、対象のconflict種別ごとに検討する必要がある（unresolved design question。
   §28相当、完了報告に列挙）。
5. 成功したcandidateのみでSnapshotをbuildし、`Explicit activation` は別の人間操作
   （自動実行しない）とする。

### S6.5 Promotion Input 0.1 / Promotion Record 0.1 Contract（Checkpoint 4で正式固定）

S6.1-S6.4の設計方針を、実装（`tools/knowledge_builder/core/private_dictionary_promotion_core.js`）
が正本とする具体的なschemaとして固定する。**P2-A3 ACCEPT ≠ その場で自動ACTIVE登録**であり、
本節が定めるPromotion Validator/Materializerが、review eligibility・identity/set consistency・
conflict validation・既存PROJECT dictionaryとの整合・formal payload materializationのすべてを
PASSした場合だけ、新規/更新entryをstatus `ACTIVE`としてformal payloadへ反映する。Snapshot build /
activationは今回のscope外のまま（S5.5参照、後続Checkpointで接続する）。

#### S6.5.1 UI非依存の原則

Promotion coreは`tools/knowledge_builder/ui/*`（`review_state.js`/`private_review_import.js`/
`private_review_export.js`を含む）へ**productionとして依存しない**。P2-A3 runtimeのReview State
は現在ID-keyed mapを内部表現として使うが、Promotion coreはそれを直接入力契約にはしない。後続の
UI adapterがReview Stateから生成できる、UI非依存の正規化済み入力として**Promotion Input 0.1**を
定義する。

#### S6.5.2 Promotion Input 0.1

schema: `private-dictionary-promotion-input/0.1`。top-level fieldはadditional property禁止。

| field | 内容 |
|---|---|
| `schema_version` | 完全一致文字列 `"private-dictionary-promotion-input/0.1"` |
| `evaluation` | P2-A2 `private-dictionary-candidate-evaluation/0.1` Evaluation object（production codeは変更しない。candidate/alias IDの再生成禁止） |
| `review_binding` | `{ review_schema_version, extraction_schema_version, source_fingerprints }`（下記） |
| `candidate_decisions` | `[{ candidate_id, decision }]`（sorted array。`decision ∈ {UNREVIEWED, ACCEPT, REJECT, UNCERTAIN}`。`reason_code`/`note`/`decided_at`はPromotion semanticsへ入力しない — P2-A3 private Workbook側に残す） |
| `alias_decisions` | `[{ alias_candidate_id, decision }]`（同上のdecision enum。Candidate decisionからの推定禁止） |
| `conflict_resolutions` | `[{ conflict_id, resolution, selected_candidate_id }]`（`resolution ∈ {UNRESOLVED, SELECT_CANONICAL, REJECT_ALL, CONTEXT_DEPENDENT, UNCERTAIN}`。`SELECT_CANONICAL`以外では`selected_candidate_id === null`必須。`SELECT_CANONICAL`では`evaluation.conflicts[].conflicting_candidate_ids`の1件でなければならない） |
| `base_snapshot` | `null`（新規PROJECT dictionary）または Checkpoint 3の正式Snapshot Wrapper 0.1。`null`でない場合、必ず`PrivateDictionarySnapshotCore.loadDictionarySnapshotWrapper()`を通す。stored payloadを直接信用しない。Promotion core自身がsnapshot integrity logicを再実装しない |
| `target_dictionary_id` | `^pdict-[0-9a-f]{32}$`。caller supplied。自動random発番禁止。`base_snapshot !== null`の場合、`target_dictionary_id === base dictionary_payload.dictionary_id`必須 |
| `target_version` | P2-A1 version contract（`^(0|[1-9][0-9]{0,15})$`）に従うdecimal string。初回（`base_snapshot === null`）は`"1"`必須。既存PROJECT dictionary更新時は`base dictionary_payload.version + 1`必須。version incrementはNumber coercionによるprecision lossを避けた安全なdecimal-string処理で行い、P2-A1の16桁上限を超える場合failする |
| `source_review_artifact_identity` | `{ sha256 }`（64 lowercase hex）。元P2-A3 private Review Workbookのidentity。filenameは含めない。Promotion core自身はWorkbook bytesを読まない |
| `source_commit` | `^[0-9a-f]{40}$` |

**review_binding**:

```json
{
  "review_schema_version": "private-dictionary-candidate-review/0.1",
  "extraction_schema_version": "private-dictionary-candidate-evaluation/0.1",
  "source_fingerprints": [ { "source_document_id": "...", "document_fingerprint": "..." } ]
}
```

`review_binding.source_fingerprints`は`evaluation.source_fingerprints`と**完全set一致**必須
（`{source_document_id, document_fingerprint}`の組で比較する。file nameはidentityに使わない）。
`review_binding.extraction_schema_version === evaluation.schema_version`必須。

#### S6.5.3 Review / Evaluation identity consistencyの独立検証

Promotion coreはP2-A3 importerを信用するだけでなく、次を**独立して**検証する（P2-A3側で
すでに検証されていたとしても、Promotion core自身が同じ保証を再確認する。fail-closed）。

- `candidate_decisions`のID set === `evaluation.candidates`のID set（missing/extra/duplicate reject）
- `alias_decisions`のID set === `evaluation.alias_candidates`のID set（同上）
- `conflict_resolutions`のID set === `evaluation.conflicts`のID set（同上）
- `review_binding.source_fingerprints` === `evaluation.source_fingerprints`（完全set一致）
- `review_binding.extraction_schema_version` === `evaluation.schema_version`
- `evaluation.candidates[]`/`evaluation.alias_candidates[]`は`scope === "SESSION"`かつ
  `status === "PROBATION"`必須（P2-A2 contractどおり）。異なる場合はfail-closed

#### S6.5.4 Candidate / Alias promotion eligibility（S6.2/S6.3の実装確定）

**Candidateの基本条件**: `decision === ACCEPT`のみpromotion候補。`REJECT`/`UNCERTAIN`/
`UNREVIEWED`は**local exclusion**（errorではない）。ただしConflictによりcandidateがblockされる
場合はConflict semantics（S6.3）を優先する。

**Conflict semantics（S6.3をそのまま実装。resolution enumごとの挙動）**:

| resolution | 挙動 |
|---|---|
| `UNRESOLVED` | 当該conflictの`conflicting_candidate_ids`全件をpromotion candidateから除外。unresolved-for-promotionとしてcount |
| `REJECT_ALL` | `conflicting_candidate_ids`全件を除外。人間による明示rejectのため、unresolved_countには含めない |
| `CONTEXT_DEPENDENT` | 関与candidateをpromotion対象外。formal dictionaryへ一意化しない。unresolved-for-promotionとしてcount |
| `UNCERTAIN` | 関与candidateをpromotion対象外。unresolved-for-promotionとしてcount |
| `SELECT_CANONICAL` | `selected_candidate_id`へのalias mapping生成可能。ただし選択candidate自身がCandidate ACCEPTかつ他のblocking conflictに阻害されていない場合のみ。**非選択candidateは、選ばれなかったことだけを理由にpromotion対象外にしない**（S6.3の既存訂正どおり、各自の`candidate_decisions`と他Conflictの状態で独立判定する — 恒久検査として固定） |

candidateが複数Conflictに関与し、1つでもblocking resolution（`UNRESOLVED`/`REJECT_ALL`/
`CONTEXT_DEPENDENT`/`UNCERTAIN`）に入っていれば、そのcandidateはpromotion対象外。

**Alias promotion eligibility**: 通常`alias_candidate`は次の全条件必須。

1. `alias_decision === ACCEPT`
2. `canonical_candidate_id`が存在する
3. canonical candidate自身がpromotion eligible

Candidate ACCEPTからAlias ACCEPTを推定してはならない。alias ACCEPTでもcanonicalが
REJECT/UNCERTAIN/UNREVIEWED/blocking conflictの場合、aliasはlocal exclusion。

P2-A2はconflicted aliasについて通常`alias_candidate`を生成せず、`evaluation.conflicts[]`へ
分離する。そのため`SELECT_CANONICAL`のconflictは通常`alias_decisions`を要求しない。人間の
`SELECT_CANONICAL`そのものが、そのconflict aliasについての明示判断であり、`alias_display →
selected candidate canonical`のmappingとして扱う。

#### S6.5.5 Formal normalization Source of Truth

Promotion coreのconflict判定は独自normalizerを作らない。必ず`KnowledgeIdHashUtils.normalize`
を使用する。P2-A2の`foldComparisonKey`をformal dictionary conflict判断へ再利用しない
（formal P2-A1 dictionaryのnormalized keyは`KnowledgeIdHashUtils.normalize`がSource of Truthで
あり、P2-A2の抽出段階normalizerとは別物として扱う）。

#### S6.5.6 既存PROJECT dictionaryとの整合

`base_snapshot === null`: 新規PROJECT dictionaryを作る。`base_snapshot !== null`:
Snapshot Loaderで検証済みの`dictionary_payload`をbaseとする（`schema_version:
private-dictionary-overlay/1.0`、`scope: PROJECT`必須）。既存entryは原則そのまま保持し、
Promotionを理由に`status`/`source.kind`/`utility`/canonical display/`entry_id`を書き換えない。

**既存ACTIVE canonicalへの再遭遇**: ACCEPT candidateのformal normalized canonical keyが、
baseの既存ACTIVE canonicalと同一なら、新entryを重複生成せず既存の`entry_id`/`canonical_term`/
`source`/`utility`/`status`を維持する（`existing_entry_candidate`として扱う）。当該candidateへ
ACCEPTされた新aliasがある場合のみ、既存ACTIVE entryの`aliases`を拡張できる。accepted candidate
自身を理由にcanonical displayを置換しない。追加aliasも存在せずsemantic changeがゼロなら、その
candidateはno-op。

**既存ACTIVE canonical winnerのSource of Truth（Checkpoint 4-R1で確定）**: base PROJECT
dictionaryの同一normalized canonical keyへ複数のACTIVE entryが対応しうる状況（本来生じるべき
ではないが、base自体が別経路で構築された場合に備える）で、どのentryを「その正式canonical」として
再利用するかは、Promotion core自身のwinner選択algorithm（scope priority・display ordinal
tie-break・ACTIVE-only・conflict除外等）を独自実装しない。必ず
`PrivateDictionaryLearningCore.createPrivateDictionaryLayerView(baseDictionaryPayload)` →
`mergeDictionaryLayersWithProvenance([layerView])` を呼び出し、
`provenance_index.canonical[normalizedKey].selected_entry_ref_id` が指すentryを、base
dictionary entries配列から引き戻して再利用する。これはP2-A1自身の`effective_vocabulary`が
その正規化keyへ解決する時と**完全に同一のentry**であり、base entries配列内の出現順序（走査順の
「最後に見つかったもの」等）に依存しない。

**新entry ID**: 新しいformal entryだけ、
`entry_id = "pde-" + await KnowledgeIdHashUtils.id128("private-dictionary-promotion-entry-id-v1",
[target_dictionary_id, candidate_id])`とする。term文字列をIDへ直接埋め込まない
（candidate_idから決定的に導出する）。同じ`target_dictionary_id + candidate_id`なら常に同じ
`entry_id`。`id128`のfailure/invalid returnはsanitized fail-closedとする。

**新entry materialization**: `status: "ACTIVE"`、`source: { kind: "DOCUMENT_EXTRACTED",
content_included: false }`。`utility`は`candidate.metrics.exposure_count →
exposure_count`、`candidate.metrics.document_support_count → document_support_count`、
`candidate.metrics.alias_conflict_count → alias_conflict_count`のmappingのみ行い、P2-A2が
unmeasuredと定義する`match_opportunity_count`/`candidate_gain`/`ranking_gain`/
`candidate_noise_increase`はP2-A1の「utility initial value = 0」契約どおり0とする（推測値の
生成禁止）。既存entryへaliasを追加する場合は既存utilityを一切変更しない。

#### S6.5.7 Formal collision policy（local exclusion vs global fail-closed。S23旧#1を解決）

local review exclusion（`REJECT`/`UNCERTAIN`/`UNREVIEWED`/blocking P2-A3 Conflict）は、当該
candidate/aliasだけpromotionされず、Promotion全体は続行可能。一方、formal dictionaryへ適用した
結果**意味が一意に決まらない**場合はglobal fail-closedとする。任意のcanonicalを勝手に選ばない。

- 2つの別ACCEPT candidateが`KnowledgeIdHashUtils.normalize`後に同一canonical keyになる →
  `PROMOTION_CANONICAL_COLLISION`
- accepted candidate canonicalが既存ACTIVE alias keyと衝突する → `PROMOTION_ALIAS_COLLISION`系
- accepted aliasが別canonicalのcanonical/aliasと衝突する → 同上
- 同一normalized alias keyがpromotion batch内で異なるcanonicalへ向く → 同上

**P2-A1 conflict semanticsの再利用**: 最終payload構築後、必ず
`PrivateDictionaryLearningCore.validatePrivateDictionary()`を通す。さらに
`createPrivateDictionaryLayerView()`→`detectDictionaryLookupConflicts([layerView])`を利用し、
formal PROJECT layer内にlookup conflictが残っていないことを確認する。Promotion core独自に
P2-A1のalias/canonical conflict algorithmをコピーして再実装しない。`conflicts.length > 0`なら
Promotion全体をfail-closedする（`PROMOTION_DICTIONARY_CONFLICT`）。

#### S6.5.8 No-change behavior

Promotion処理後、base dictionaryとsemantic payloadが同一、または初回でeligible candidateが0
なら、`PROMOTION_NO_CHANGES`としてfailする。versionだけを上げた空Snapshot候補を作らない。

#### S6.5.9 Promotion Record 0.1

Snapshot wrapperの`promotion_record_identity`（S5.5）へ将来そのまま渡せる、content-addressed
Promotion Recordを生成する。schema: `private-dictionary-promotion-record/0.1`。PRIVATE internal
artifactであり、raw term/alias/note/reason/evidence excerpt/filenameは一切含めない。

```json
{
  "schema_version": "private-dictionary-promotion-record/0.1",
  "source_review_artifact_sha256": "...",
  "review_decision_fingerprint": "...",
  "source_commit": "...",
  "base_snapshot_id": null,
  "base_wrapper_integrity_sha256": null,
  "base_dictionary_payload_sha256": null,
  "target_dictionary_id": "pdict-...",
  "target_dictionary_version": "1",
  "eligible_candidate_ids": [],
  "created_entry_candidate_ids": [],
  "existing_entry_candidate_ids": [],
  "applied_alias_candidate_ids": [],
  "applied_conflict_ids": [],
  "no_op_alias_candidate_ids": [],
  "excluded_counts": {
    "candidate_not_accepted": 0,
    "candidate_conflict_blocked": 0,
    "alias_not_accepted": 0,
    "alias_canonical_ineligible": 0,
    "conflict_not_promotable": 0
  },
  "unresolved_conflict_count": 0,
  "output_dictionary_payload_sha256": "...",
  "content_included": false
}
```

ID配列はordinal sort。`base_snapshot === null`ではbase 3 field（`base_snapshot_id`/
`base_wrapper_integrity_sha256`/`base_dictionary_payload_sha256`）は`null`。`content_included`
は常に`false`。`excluded_counts`の各fieldはnon-negative safe integer。

**`unresolved_count`の意味**: `UNRESOLVED`/`CONTEXT_DEPENDENT`/`UNCERTAIN`のconflict件数のみ。
`REJECT_ALL`は人間により解決済みのrejectなのでunresolved_countへ含めない。`SELECT_CANONICAL`も
resolutionとしては解決済みなので含めない。

**Review Decision Fingerprint**: Promotion RecordはWorkbook SHAだけにsemantic decision identity
を依存させない。次のprojectionをcanonical sort後、`KnowledgeIdHashUtils.canonicalJson()`で
canonical化し、`await KnowledgeIdHashUtils.hashParts("private-dictionary-promotion-review-decision-v1",
[canonicalJsonProjection])`（64 lowercase hex）で算出する。raw note/reason/termは含めない。

```json
{
  "review_schema_version": "...",
  "extraction_schema_version": "...",
  "source_fingerprints": [],
  "candidate_decisions": [],
  "alias_decisions": [],
  "conflict_resolutions": []
}
```

**Promotion Record Identity**: `promotion_record_identity.sha256 = await
KnowledgeIdHashUtils.hashParts("private-dictionary-promotion-record-v1",
[KnowledgeIdHashUtils.canonicalJson(promotionRecord)])`（64 lowercase hex）。production側で
独自SHA/canonicalizerを新設しない。

#### S6.5.10 Public API・出力・次Checkpointへの接続

原則1 public APIのみ: `async function promoteReviewedCandidatesToProjectDictionary(input)`。
戻り値（全体deep-freeze）:

```json
{
  "dictionary_payload": {},
  "dictionary_payload_sha256": "...",
  "promotion_record": {},
  "promotion_record_identity": { "sha256": "..." },
  "conflict_state": { "unresolved_count": 0 },
  "source_review_artifact_identity": { "sha256": "..." },
  "source_commit": "..."
}
```

`result.dictionary_payload`は`validatePrivateDictionary()`をPASSし、
`result.dictionary_payload_sha256 === hashPrivateDictionaryCanonical(result.dictionary_payload)`
を満たす。この戻り値は、次Checkpointで
`PrivateDictionarySnapshotCore.buildDictionarySnapshotWrapper({ dictionary_payload:
result.dictionary_payload, promotion_record_identity: result.promotion_record_identity,
source_review_artifact_identity: result.source_review_artifact_identity, source_commit:
result.source_commit, conflict_state: result.conflict_state, ... })`へそのまま接続可能な形に
揃えてある。ただし**Checkpoint 4では`buildDictionarySnapshotWrapper()`を呼ばない**
（Snapshot buildはまだ行わない。S6の全体図参照）。

#### S6.5.11 明示的に実装しないもの（Checkpoint 4のNon-goals）

P2-A3 Workbook parser・P2-A3→Promotion Input UI adapter・Snapshot build・Snapshot Activation
Record・project configuration・`snapshot_id`/`snapshot_version`発番・Dictionary Resolver・
`approvedDict`・matching配線・UI/Excel/graph/unknown queue・HUMAN-01/02/03 UX改善・DOMAIN scope
promotion・automatic retirement/quarantine・rollback。

#### S6.5.12 Atomicity・structural safety・error contract

Promotion coreもasync boundaryを持つため、Checkpoint 3-R1/R2と同じatomicity原則を継承する。
caller-owned inputをawait後に再読しない。最初の同期phaseで、Promotion semanticsに必要な
evaluation/review/metadataをdescriptor-based安全readで内部plain snapshotへcopyする。
`base_snapshot`についてはSnapshot Loader自身のatomic captureを利用し、Promotion functionが
最初のawaitへ到達する前にbase Snapshot Loaderを呼び出し、Loader側の同期captureを開始させる。
以後、caller input本体・`candidate_decisions`/`alias_decisions`/`conflict_resolutions`の各
input arrayを再readしない。

structural safety（Proxy trap・accessor・symbol key・unexpected non-enumerable・custom
prototype・cycle・sparse/hostile array・unknown field）はfail-closed。private termをpath/error
へ含めない。`evaluation`は今回利用するfieldだけをdescriptor-based allowlist readする
（`evidence_refs`の内容をPromotion coreへコピーする必要はない）。

外部throwは`Object.freeze({code, path})`のみ（Error instance/message/stack/cause/private value
禁止）。最低限のerror code一覧: `PROMOTION_ROOT_INVALID`/`PROMOTION_UNKNOWN_FIELD`/
`PROMOTION_SCHEMA_VERSION_INVALID`/`PROMOTION_EVALUATION_INVALID`/
`PROMOTION_REVIEW_BINDING_INVALID`/`PROMOTION_SOURCE_MISMATCH`/
`PROMOTION_CANDIDATE_SET_MISMATCH`/`PROMOTION_ALIAS_SET_MISMATCH`/
`PROMOTION_CONFLICT_SET_MISMATCH`/`PROMOTION_DECISION_INVALID`/`PROMOTION_RESOLUTION_INVALID`/
`PROMOTION_SELECTED_CANDIDATE_INVALID`/`PROMOTION_SCOPE_STATUS_INVALID`/
`PROMOTION_TARGET_DICTIONARY_ID_INVALID`/`PROMOTION_TARGET_VERSION_INVALID`/
`PROMOTION_BASE_SNAPSHOT_INVALID`/`PROMOTION_BASE_DICTIONARY_MISMATCH`/
`PROMOTION_CANONICAL_COLLISION`/`PROMOTION_ALIAS_COLLISION`/`PROMOTION_DICTIONARY_CONFLICT`/
`PROMOTION_ENTRY_ID_GENERATION_FAILED`/`PROMOTION_PAYLOAD_INVALID`/`PROMOTION_HASH_FAILED`/
`PROMOTION_NO_CHANGES`/`PROMOTION_DEPENDENCY_RESOLUTION_FAILED`/
`PROMOTION_STRUCTURAL_SAFETY_VIOLATION`/`PROMOTION_NORMALIZATION_FAILED`。pathはallowlisted
static field/indexのみ。canonical/aliasをpathへ入れない。Snapshot/P2-A1/id-hash dependencyの
native exceptionや内部codeをそのまま外へ転送しない。

**`PROMOTION_NORMALIZATION_FAILED`（Checkpoint 4-R1で新設）**: `KnowledgeIdHashUtils.normalize()`
（§S6.5.5のFormal normalization Source of Truth。materialization全体を通じてcanonical/alias
key比較に使う）自身がthrow/reject/非string returnした場合に限り使用する専用code。この失敗は
`PROMOTION_DEPENDENCY_RESOLUTION_FAILED`（モジュール解決自体の失敗専用、起動時のみ）とも
`PROMOTION_HASH_FAILED`（review decision fingerprint / promotion record identityの
canonicalJson→hashParts pipeline専用）とも意味が異なるため、両者と区別して一本化する。

**Privacy**: Promotion Recordへ含めてよいのはopaque IDs/hashes/counts/schema・version/source
commitのみ。canonical term・alias term・review note・reason note・evidence excerpt・filename・
sheet・page content・raw source・private normalized termは含めない。`dictionary_payload`自体は
PRIVATE。Promotion RecordもPRIVATEだが`content_included: false`を維持する。console出力・
network・filesystem・localStorage・sessionStorage・IndexedDB禁止。

**Explicit activation禁止（S6.5.11と重複整理）**: 今回生成するのはformal dictionary payload +
promotion recordまで。Snapshot Activation Record作成・ACTIVE snapshot selector変更・project
configuration変更・latest snapshot探索・rollback実行・filesystem保存・auto-download・UI state
変更は禁止。`entry.status === ACTIVE`と「Snapshotが現在選択されている」は別概念であり、混同しない。

### S6.6 Promotion → Snapshot Composition Contract（Checkpoint 5で正式固定）

`tools/knowledge_builder/core/private_dictionary_promotion_snapshot_composition_core.js`は、
Checkpoint 4の`PrivateDictionaryPromotionCore.promoteReviewedCandidatesToProjectDictionary()`と
Checkpoint 3の`PrivateDictionarySnapshotCore.buildDictionarySnapshotWrapper()`/
`loadDictionarySnapshotWrapper()`を「接続」するpure orchestration coreである。新しい辞書semantic
algorithm（candidate/alias eligibility、conflict resolution、existing ACTIVE winner、
normalization、hash、Promotion Record identity、wrapper integrity hash、Snapshot Loader
validation、P2-A1 conflict detection）は一切再実装しない。Composition coreのproduction
dependencyは`PrivateDictionaryPromotionCore`と`PrivateDictionarySnapshotCore`の2つのみで、
P2-A1（`private_dictionary_learning_core.js`）や`id_hash_utils.js`をCompositionから直接requireし
ない（orchestration layerであり、semantic/hash layerではないため）。

**Composition Input 0.1**: schema
`private-dictionary-promotion-snapshot-composition-input/0.1`。top-levelは`schema_version`/
`promotion_input`/`snapshot_metadata`の3 fieldのみ、additional field禁止。

- `promotion_input`: Checkpoint 4 `private-dictionary-promotion-input/0.1`そのもの。Composition
  自身はその内部（`candidate_decisions`/`evaluation`等）をrecursiveに解析せず、root descriptorから
  1回だけ読んだopaque referenceとしてPromotion Coreへそのまま渡す。Promotion Core自身のatomic
  capture/structural safetyへ委ねる。
- `snapshot_metadata`: `{ snapshot_id, snapshot_version, provenance }`のみ、additional field禁止。
  `snapshot_id`/`snapshot_version`/`provenance`はいずれもCheckpoint 3 Builder契約そのまま・
  caller supplied（Compositionでの自動発番・現在時刻生成は禁止）。Compositionは
  descriptor-based safe captureでhostile Proxy/accessor/symbol key/unknown fieldを拒否するが、
  format/timestamp妥当性等の詳細field validationはCheckpoint 3 Builderへ委譲し、timestamp
  parser等を独自実装しない。

**Public API**: 原則1 export、`async function
promoteReviewedCandidatesAndBuildSnapshot(input)`。戻り値（全体deep-freeze）:
`{ promotion_result, snapshot_wrapper, validated_snapshot }`。各coreの戻り値をそのまま保持し
（既に各core側でdeep-freeze済みのため再clone不要）、Compositionはpublic schema artifactではなく
in-memory composition handleとして扱う。

**Promotion result → Snapshot Builder input mapping**: Promotion成功結果
(`promotionResult`)を唯一のSource of Truthとし、以下をSnapshot Builderへ渡す。

```json
{
  "dictionary_payload": "promotionResult.dictionary_payload",
  "snapshot_id": "snapshotMetadata.snapshot_id",
  "snapshot_version": "snapshotMetadata.snapshot_version",
  "provenance": "snapshotMetadata.provenance",
  "source_review_artifact_identity": "promotionResult.source_review_artifact_identity",
  "promotion_record_identity": "promotionResult.promotion_record_identity",
  "source_commit": "promotionResult.source_commit",
  "conflict_state": "promotionResult.conflict_state",
  "supersedes": "promotionResult.promotion_record.base_snapshot_id",
  "rollback_target": null
}
```

`dictionary_payload`/`source_review_artifact_identity`/`promotion_record_identity`/
`source_commit`/`conflict_state`/`supersedes`/`rollback_target`はcallerから再入力させない
（Promotion結果とCompositionの固定`null`だけがSource of Truth）。

**`supersedes`の唯一のSource of Truth**: callerからsupersedesを受け取らず、
`promotionResult.promotion_record.base_snapshot_id`をそのまま使う。初回promotion
（`base_snapshot_id === null`）→`supersedes === null`。既存Snapshotからのpromotion
（`base_snapshot_id === dsnap-...`）→`supersedes`は同一snapshot_id。caller が任意のsupersedesを
指定できる経路は存在しない。

**`rollback_target`**: Checkpoint 5では常に`null`固定。caller inputにも含めない。rollback
semanticsは未実装のまま先取りしない。

**`snapshot_version`**: caller-supplied、`Number.isSafeInteger(value) && value >= 1`
（Checkpoint 3契約そのまま）。`dictionary_payload.version`と同一視しない。base
`snapshot_version + 1`を強制しない。snapshot chain monotonicity検証はCheckpoint 3から引き続き
未解決・別sliceのまま（automatic発番・latest lookupも今回対象外）。

**3段階のbinding consistency gate**（いずれも独自hash再計算禁止、値比較のみ。§13-27参照）:

1. *Promotion result consistency gate*（Builderを呼ぶ前）: `dictionary_payload_sha256`と
   `promotion_record.output_dictionary_payload_sha256`、`dictionary_payload.dictionary_id`/
   `version`と`promotion_record.target_dictionary_id`/`target_dictionary_version`、
   `source_review_artifact_identity.sha256`と`promotion_record.source_review_artifact_sha256`、
   `conflict_state.unresolved_count`と`promotion_record.unresolved_conflict_count`、
   `source_commit`と`promotion_record.source_commit`の一致を検査する。不一致は
   `COMPOSITION_PROMOTION_BINDING_MISMATCH`でfail-closed、Builderを呼ばない。
2. *Snapshot Builder result consistency gate*（Loaderを呼ぶ前）: Builderが返す
   `dictionary_payload_sha256`/`source_review_artifact_identity.sha256`/
   `promotion_record_identity.sha256`/`source_commit`/`conflict_state.unresolved_count`が
   `promotionResult`の対応値と一致し、`supersedes === promotionResult.promotion_record
   .base_snapshot_id`、`rollback_target === null`、`snapshot_id`/`snapshot_version`が
   `snapshotMetadata`の値と一致し、`scope === "PROJECT"`であることを検査する。不一致は
   `COMPOSITION_SNAPSHOT_BINDING_MISMATCH`でfail-closed、Loaderを呼ばない。
3. *Loader round-trip gate*（成功handle返却前）: Builder成功だけでComposition成功にせず、必ず
   `loadDictionarySnapshotWrapper()`を通す。Loaderが返す値がPromotion結果・wrapperの対応値と
   すべて一致することを検査する（`dictionary_payload_sha256`/`wrapper_integrity_sha256`/
   `snapshot_id`/`snapshot_version`/`scope`/`source_review_artifact_identity.sha256`/
   `promotion_record_identity.sha256`/`source_commit`/`conflict_state.unresolved_count`/
   `supersedes`/`rollback_target`）。不一致は`COMPOSITION_LOAD_BINDING_MISMATCH`。

**Payload identity / Promotion Record identityの三者一致**: `promotionResult
.dictionary_payload_sha256`・`snapshotWrapper.dictionary_payload_sha256`・
`validatedSnapshot.dictionary_payload_sha256`（および`promotion_record
.output_dictionary_payload_sha256`）の完全一致でpayload identityを固定する。Composition自身は
dictionary payload hashを計算しない。同様に`promotion_record_identity`もCheckpoint 4の結果を
Builder/Loaderへそのまま渡し、Composition側で再hashしない。

**Failure stage order**: (1) root/snapshot_metadata capture → (2) Promotion Core呼び出し開始
（Composition自身の最初のawaitより前）→ (3) Promotion await → (4) Promotion binding gate →
(5) Snapshot Builder → (6) Builder binding gate → (7) Snapshot Loader → (8) Loader binding gate
→ (9) 成功handle返却。Promotion binding mismatch時にBuilderを呼ばない。Builder mismatch時に
Loaderを呼ばない。partial handle返却禁止。

**Atomicity**: Checkpoint 3-R1/R2・Checkpoint 4-R1と同じ原則を継承する。Composition関数開始時の
同期phaseでroot/`schema_version`/`promotion_input`参照/`snapshot_metadata`を安全captureし、
caller inputをawait後に再readしない。Promotion Core呼び出しはComposition自身の最初のawaitより
前に開始し、Promotion Core自身の同期atomic captureがComposition呼び出し元へcontrolが戻る前に
開始できる構造にする。

**VALID SNAPSHOT CANDIDATE ≠ ACTIVE SELECTED SNAPSHOT**: SnapshotがBuild/Load成功することと、
「このSnapshotを現在ACTIVEとして選択する」ことは別概念。今回の成功結果は妥当な
Snapshot候補（VALID SNAPSHOT CANDIDATE）であり、Activation Record・active snapshot
selector・project configuration・latest snapshot探索・rollback実行はCheckpoint 5の対象外
のまま。

**Error contract**: 外部throwは`Object.freeze({code, path})`のみ。最低限のcode一覧:
`COMPOSITION_ROOT_INVALID`/`COMPOSITION_UNKNOWN_FIELD`/`COMPOSITION_SCHEMA_VERSION_INVALID`/
`COMPOSITION_SNAPSHOT_METADATA_INVALID`/`COMPOSITION_STRUCTURAL_SAFETY_VIOLATION`/
`COMPOSITION_DEPENDENCY_RESOLUTION_FAILED`/`COMPOSITION_PROMOTION_FAILED`/
`COMPOSITION_PROMOTION_BINDING_MISMATCH`/`COMPOSITION_SNAPSHOT_BUILD_FAILED`/
`COMPOSITION_SNAPSHOT_BINDING_MISMATCH`/`COMPOSITION_SNAPSHOT_LOAD_FAILED`/
`COMPOSITION_LOAD_BINDING_MISMATCH`。Promotion内部の`PROMOTION_*`・Snapshot内部の`SNAPSHOT_*`を
そのまま外部へ透過させない。pathはstatic allowlisted pathのみ、canonical/aliasを含めない。

**Promotion → Snapshot接続の解決**: S23には「Promotion → Snapshot connection」という単独の
未解決項目としては存在していなかったが（Checkpoint 3/4はそれぞれSnapshot buildを明示的に
scope外としていたのみ）、本節により、Promotion結果からSnapshot Wrapperを構築しLoaderで検証する
までの接続契約自体をCheckpoint 5で確定・解決した。ただし`snapshot_id`/`snapshot_version`の
発番方式・chain monotonicity検証、Snapshot Activation Record、rollback、Dictionary Resolverは
引き続き未解決のまま維持する（S23旧#10・#11・#12参照）。

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
- `dictionary_entry_id`（S4.1（R3-1）のOption A: `mergeDictionaryLayersWithProvenance()`
  `provenance_index`の`selected_entry_ref_id`）
- `dictionary_snapshot_id`
- `wrapper_integrity_sha256`（S5.2、旧`dictionary_wrapper_sha256`表記から改称。R2-3）
- `original_term`（原文そのまま。破壊しない = NG-9）
- `canonical_term`
- `scope`
- `status`

**（R2-2で削除）`alias_rule_id`は必須項目から外した。** P2-A1の正式schema
（`ALLOWLISTED_FIELD_NAMES`）にrule起源を保持するfieldが存在しないため、推測値を割り当てず
必須項目としない（詳細な経緯・代替案はS4.1参照）。

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

### S10.1 Snapshot Loader Validation Order（R4-1で新設）

「validate snapshot」（上図）の内部を、次の**10ステップの厳密な順序**として正式contract化する。
実装Checkpointはこの順序を変更してはならない。

```text
1. wrapper構造validation
   （S5.1のSnapshot Wrapper Schemaに沿ったfield構成・型チェック。不正ならINVALID SNAPSHOT）
        |
        v
2. dictionary_payloadをP2-A1 validatePrivateDictionary()相当で検証
   （private_dictionary_learning_core.jsの既存validation関数をそのまま呼ぶ。再実装しない）
        |
        v
3. dictionary_payloadから hashPrivateDictionaryCanonical() で payload SHAを再計算
   （wrapperに格納された値をそのまま信用せず、Loader自身が入力から独立に計算する）
        |
        v
4. 再計算したpayload SHAと、wrapperに格納された dictionary_payload_sha256 を比較
        |
        v
5. 不一致 → INVALID SNAPSHOT（S10案B: 辞書無効化、以降のstepへ進まない）
        |  （一致した場合のみ次へ進む）
        v
6. 再計算したpayload SHA（stepで得た値。wrapper格納値ではなく、stepで独立に検証済みの値）を
   用いてwrapper integrity projection（S5.2のhash対象fieldのcanonical構造体）を構築する
        |
        v
7. 構築したprojectionから wrapper_integrity_sha256 を再計算する
        |
        v
8. 再計算したwrapper_integrity_sha256と、wrapperに格納された wrapper_integrity_sha256 を比較
        |
        v
9. 不一致 → INVALID SNAPSHOT（S10案B、以降のstepへ進まない）
        |  （一致した場合のみ次へ進む）
        v
10. 両hash（payload・wrapper integrity）のvalidationが成功した場合のみ、
    Dictionary Resolverの構築を開始する（S10「build complete resolver」以降へ進む）
```

**必須制約**: wrapperに格納された`dictionary_payload_sha256`の値そのものを、
`wrapper_integrity_sha256`のhash input（S5.2の「`dictionary_payload_sha256`という文字列として
算入」）として**無検証のまま信用してはならない**。step6の「wrapper integrity projectionの構築」
には、必ずstep3で**Loader自身が独立に再計算した**payload SHA（＝step4で一致検証済みの値）を
使う。もしstep6でwrapper格納値の`dictionary_payload_sha256`をそのまま使ってしまうと、
攻撃者（またはbit破損）が`dictionary_payload`と格納済み`dictionary_payload_sha256`を**両方**
一貫して改ざんした場合（R4-2 Case B）でも、`wrapper_integrity_sha256`の再計算がその改ざん済み
値を正として使ってしまい、改ざんを見逃す可能性がある。step3で独立再計算した値をstep6で使う
ことで、`dictionary_payload`自体の改ざん（Case A）と、payload+格納hashの同時改ざん（Case B）の
**両方**を、それぞれ異なるstepで確実に検知できる設計とする。

**partial resolver禁止**: 10ステップのいずれかでINVALID SNAPSHOTと判定された場合、
それまでに構築しかけたResolver状態を一切外部（matching engine・UI）へ渡さない。既存の
「例外を投げず型付きdiagnosticsを返す、しかし部分結果は決して外に出さない」パターン
（`preflightJsonGraph()`等、current-state-analysis §14参照）をそのまま踏襲する。

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

## S13. Dictionary Matchの意味づけ（既存matching scoreへの入力方法）（R2-1で全面改訂）

Dictionary resolutionは「comparisonの証拠の1つ」であり、**Dictionary exact/alias一致だけを
理由にcomparisonを無条件で一致扱いにしてはならない**（NG-10）。この原則は変更しない。

**R2-1: R1版の記述を撤回する。** R1版は「`matchLogic`内に新しい独立カテゴリ（例: `dictionary`）を
追加する」ことを推奨し、その判断根拠として`matchInitialTags()`という関数の実装確認を次Checkpoint
の条件としていた。Checkpoint 1-R2で`tools/json_ab_trace_matching_tool_v12.1.15.html`を直接
grep・読解した結果、**`matchInitialTags()`はこのmatching tool内には存在しない**
（同ファイルを`matchInitialTags`/`InitialTag`で全文検索してゼロ件）。

**訂正内容の正確な記述**: `matchInitialTags()`という同名関数自体はコードベース上に実在するが、
それは`tools/knowledge_builder/core/excel_direct_adapter.js`（L396）/`pdf_direct_adapter.js`
（L532）という、matching toolとは無関係な**別tool系統**（Excel/PDFからKnowledge Node/Relation
graphを構築する入力adapter）に属する同名関数であり、セル/段落からNodeの初期tagを決定する処理
である（current-state-analysis §15.1で確認事実として記録済み）。P2-A4が対象とするのは
TraceRecord同士のPLM-vs-要求仕様comparisonを行うmatching toolであり、この別系統の
`matchInitialTags()`とは無関係。存在しない関数を前提に設計を進めることは「推測で
architectureを書く」ことになるため、ここで訂正する。

**確定した実際のtag matching pipeline**（current-state-analysis §15.1で実コード確認済み）:

```text
buildRowTagInfo() / annotateTraceTags()   <- matching開始前、各TraceRecord rowへ
        |                                    _tags / _tagInfo を事前付与する前処理
        v
_tagInfo = { explicit, dict, code, manualAdd, manualRemove }   <- row単位、source別のtag集合
        |     (.dict は synonymBaseTagsForText() 経由でのみ生成 = matchLogic.synonymMapが唯一の
        |      入力。P2-A1 effective_vocabulary を読む経路は現状ゼロ)
        v
buildTagIndex()                            <- 全rowのtag文書頻度indexを構築（高頻度tagの枝刈り）
        |
        v
evaluateTagMatch()                         <- 2 row間のtag集合をDice係数で比較しtag-scoreを算出
        |
        v
matchPlmParts()                            <- comparison生成の唯一のentry point。
                                               tagSettings.useForMatchingが有効な場合のみ
                                               tag-scoreを評価し、既存conventional score（通常
                                               テキスト照合score）とtag-scoreを**max選択**で統合
                                               （加算・重み付け合成ではない。同値時はconventional
                                               scoreを優先）。
```

**R2-1の結論: `effective_vocabulary → tag resolution → existing tag evidence → existing
matching` は、既存のP2-A1契約を変更せずに接続できる。** 具体的な拡張点は
`matchLogic`への新カテゴリ追加ではなく、既存 `_tagInfo` の5 source（`.explicit`/`.dict`/`.code`/
`.manualAdd`/`.manualRemove`）に**新しいsibling source**（例: `.approvedDict`）を追加することで
ある。

- 既存の `_tagInfo.dict`（ad hoc `matchLogic.synonymMap` 由来）と、新設する
  `_tagInfo.approvedDict`（`effective_vocabulary` 由来、P2-A3で人間が正式承認しPromotion
  Validatorを経た正式辞書）を**別sourceとして区別する**。理由はR1-3で述べた通り: 正式辞書を
  ad hoc辞書（`synonymMap`）へ直接マージすると、(a) 利用者が無自覚に正式辞書entryを
  上書き・削除できてしまう、(b) 正式辞書とad hoc辞書の出自が区別できなくなりprovenanceが
  壊れる。`_tagInfo`が元々source別にtagを保持する設計であるため、この区別は既存構造の
  自然な延長として表現できる（新しいtop-level機構を作る必要がない）。
- `buildTagIndex()`/`evaluateTagMatch()`が読む実効tag集合の決定ロジック
  （`tagSourceSetForRow()`/`tagIsDictOnlyHighFrequency()`/`effectiveNonCodeTagSet()`）へ、
  新設する`.approvedDict` sourceを組み込む。これにより、正式辞書由来のtag一致は既存の
  tag-score（Dice係数）へ反映され、`matchPlmParts()`の既存max選択ロジックを**そのまま**
  通過する。新しいスコア合成ロジックを追加する必要はない。
- `dictionary_entry_id`/`scope`/`status`等のprovenance情報は、tag集合そのものには含まれない
  （tagはtext表示名の集合でしかないため）。tag-scoreへの寄与とprovenance追跡は別軸であり、
  provenance側はResolution Sidecar（S4）/ Resolution Annotation Provenance（S4.1）が担う。
  tag-score計算経路とprovenance記録経路は独立して動作してよい。

**この結論は「P2-A1契約改訂が必要」ではなく「matching-tool側の拡張が可能」であることを意味する。**
`private_dictionary_learning_core.js`（P2-A1 core）は`effective_vocabulary`という既に消費可能な
形でSource of Truthを提供済みであり、**この結論のためにP2-A1 core側の変更は一切不要**。
必要なのはmatching tool側（`tools/json_ab_trace_matching_tool_v12.1.15.html`）に
`_tagInfo.approvedDict`という新sourceを追加する実装のみであり、これは**後続の実装
Checkpointで行う**（Checkpoint 1-R2は設計のみで、この変更を含め一切のコード変更を行わない）。

**旧`deterministic normalization`案の扱い**: R1版で挙げた「Resolverが確定させた`canonical_term`を
`normalizeForMatch()`の前処理段階でオプション適用する」案は、tag経路とは別の追加入力候補として
引き続き検討対象とするが、具体的な適用要否・実装方法は後続Checkpointで判断する
（unresolved design question、S23参照）。

**具体的なスコア係数・statusごとの重み付け（`.approvedDict` sourceがtag-scoreへどの程度
寄与するか）はCheckpoint 1-R2でも決定しない**（unresolved design question）。ここで固定するのは
「Dictionary一致は既存tag-score経由の入力信号の一つであり、matching結果を直接決定する特別ルールに
はしない」という原則と、「拡張点は`_tagInfo`の新sibling sourceであり、P2-A1契約改訂を要しない」
という接続方式の2点のみ。

### S13.1 `_tagInfo.approvedDict` 生成・合成規則（R3-3で新設、R5/Checkpoint 7で実装反映）

**Checkpoint 6との責務分離（明記）**: Dictionary Resolver（S4.2、
`private_dictionary_resolver_core.js`）と、本S13.1が定義する`_tagInfo.approvedDict`の
tokenization/合成規則は**別責務**である。Resolverは「1つのresolution単位として既に切り出された
文字列（term）→ canonical/alias解決」のみを行う純粋coreであり、TraceRecordのfield値から
どうtermを切り出すか（本S13.1のtokenization規則）や、matching tool側の`_tagInfo`への実際の
組み込み・スコア合成は一切知らない。Checkpoint 6では、本S13.1が定義するmatching tool統合
（`_tagInfo.approvedDict`の実装・`composeFinalTags()`等への配線）はまだ実装しない
（S23参照。Resolver pure coreの実装のみがCheckpoint 6のスコープ）。

`_tagInfo.approvedDict`という新sourceを追加すること自体はS13で確定した。R3-3では、その
生成規則・既存パイプラインへの合成規則を、以下の実コード（`tools/json_ab_trace_matching_tool_v12.1.15.html`）
を直接確認したうえで10項目固定する: `buildRowTagInfo()`(L4400)、`composeFinalTags()`(L4336)、
`buildTagDisplayMap()`(L4355)、`computeHighFrequencyDictionaryTags()`(L4461)、
`tagSourceSetForRow()`(L5396)、`tagIsDictOnlyHighFrequency()`(L5400)、
`effectiveNonCodeTagSet()`(L5406)、`buildTagIndex()`(L5423)、`evaluateTagMatch()`(L5460)、
`candidateEntriesForSys()`(L5561)、`tagSourcesFor()`(L5940)、`synonymBaseTagsForText()`(L4304)。

**1. `effective_vocabulary`からapprovedDict tagを生成する正確な一致規則**（R4-3でtokenization
規則を0.1として完全固定）:
既存`.dict`の生成元`synonymBaseTagsForText()`は、`tagSourceText()`が返す**複数fieldを
連結した1つの長いtext**に対し、`compiledSynonymIndex()`/`synonymGroupsForText()`で
正規化済みtermの**部分文字列出現**（`n.startsWith(t.term, i)`を全開始位置iで走査、L4144-4160）
を検出する方式である。これは`matchLogic.synonymMap`に固有の索引（`compiledSynonymIndex()`）
に依存しており、`effective_vocabulary`に対してこの索引をそのまま再利用することはできない
（索引がsynonymMap専用に構築されているため）。

R3-3では、`.dict`と同じ「連結text中の部分文字列出現」方式を`effective_vocabulary`へそのまま
横展開せず、**より保守的な規則**を採用することとした。R4-3で、この規則を**P2-A4 0.1として
field型ごとに完全固定**する。`tagSourceFields()`が返す各field名について、`row[field]`の
**生の値**（`tagSourceText()`のように連結する前の値）を型ごとに次のように扱う
（`tagSourceText()`のL4287-4297自体が、array要素を個別に`normalizeText()`して`parts`へ
push し、object型を`typeof value !== 'object'`のguardで暗黙的に除外している既存の型別扱いと
整合させた設計）:

- **scalar（string/number等、arrayでもobjectでもない値）**: field値**全体を1つのvalue**として
  正規化し、`effective_vocabulary`のcanonical/alias displayと比較する。**value内部を
  delimiter（`/`・`、`・`,`等）で分割してからそれぞれ比較する処理は、P2-A4 0.1では
  一切行わない**（delimiter split禁止）。
- **Array**: 既存`tagSourceText()`が配列要素を個別に`parts`へpushする扱い（L4292-4293）と
  整合させ、**配列の各要素を個別のvalueとして**扱い、要素ごとに独立して正規化・比較する
  （1要素内でのdelimiter分割は行わない。要素そのものが1つのvalueである）。
- **object**: `tagSourceText()`が`typeof value !== 'object'`のguardでobject値を暗黙的に
  除外している既存パターンと同様、**approvedDict resolutionの対象外**とする（object値を
  文字列化して比較する処理は行わない）。

**2. canonical exact / approved aliasの正規化規則**:
`.dict`と同じ正規化primitive（`normalizeForMatch()`、`normalizeTagValue()`）を再利用する。
新しい正規化ロジックは追加しない。

- **canonical exact**: 「normalized whole value == `normalizeForMatch(canonical display)`」
  （`effective_vocabulary.allowed_tags`のいずれか）。
- **approved alias**: 「normalized whole value == `normalizeForMatch(alias display)`」
  （`effective_vocabulary.aliases`のkeyのいずれか）で判定し、hitした場合
  `effective_vocabulary.aliases`の対応するcanonical displayをtag値として採用する
  （`effective_vocabulary.aliases`が`{alias表示名→canonical表示名}`という向きであることに
  整合、current-state-analysis §18.1）。

いずれも**「normalized whole value」全体**に対する等価比較のみであり、value内の一部分だけが
一致するケース（例: `"prefix" + alias + "suffix"`という連結文字列や、`"alias1 / alias2"`という
delimiter区切り文字列）は、上記1のscalar規則により**一致しない**（P2-A4 0.1では不一致として
扱う。将来のtokenization対応は別version/別sliceで検討する）。

**3. substring / fuzzy / AI推定の要否**: **禁止する（P2-A4 0.1で完全固定）。** 上記1の通り、
`.dict`が採用する「連結text中の部分文字列出現」方式は、正式に承認された辞書由来のtagとしては
再現率（recall）を過剰に広げ、意図しない文脈への誤付与（false positive）を招くリスクがある。
approvedDictはP2-A3レビュー→Promotion Validatorを経た正式知識であるため、ad hoc辞書より
**高い精度（precision）を優先**する設計とし、value全体の完全一致のみを許可する。
**substring一致（部分文字列出現）・delimiter split後の部分一致・fuzzy一致（編集距離等）・
AI推定は、P2-A4 0.1では一切行わない。** これはunresolved design questionではなく、
**0.1の確定contract**である（将来的にscore係数（S13のunresolved design question）と
合わせてtokenization方式自体を再検討してよいが、それは別version/別sliceの対象とする）。

**4. `composeFinalTags()`でのsource priority**: 既存の`ordered`配列構築順序
（`manualAdd, explicit, dict, code`、L4338-4343）へ、`approvedDict`を**`explicit`と`dict`の間**
に挿入する（`manualAdd, explicit, approvedDict, dict, code`）。理由: `explicit`は人間が明示的に
付与したtag（最高信頼）、`approvedDict`はP2-A3レビューを経た正式知識（次に高い信頼）、
`dict`は利用者が手元で自由編集できるad hoc辞書（未レビュー）であるため、
`maxTagsPerRow`による切り詰め（L4344-4351の`if (out.length >= maxTags) break;`）が発生した際、
正式辞書由来のtagがad hoc辞書由来のtagより優先的に残るようにする。

**5. `manualRemove`の適用可否**: **適用する（既存挙動をそのまま継承）。**
`composeFinalTags()`の除外処理（`removed = new Set(uniqueNormalizedTags(info?.manualRemove
|| []))`、L4337）は`ordered`配列全体に対してsource非依存に適用されるため、`approvedDict`を
`ordered`へ追加するだけで自動的にmanualRemoveの対象になる。特別扱い・除外規則の追加は不要
であり、「人間が最終的に常に上書きできる」という既存の原則をapprovedDictにも一貫させる。

**6. `maxTagsPerRow`との関係**: **専用の予約枠は設けない。** approvedDictも他sourceと同じ
`ordered`配列・同じ`maxTagsPerRow`上限（既定16、設定範囲1-100、L4175-4193）を共有する。
専用枠を設けると新しい設定項目が必要になり複雑化するため、4で定めたsource priorityによる
保護のみで足りるとする。

**7. high-frequency pruningのapprovedDictへの適用**: **`.dict`と対称に適用する。**
`tagIsDictOnlyHighFrequency()`（L5400-5404）は現状「`sources.has('dict')` かつ
`explicit`/`manual`/`code`のいずれでもない」場合のみ高頻度枝刈りの対象とする。
`approvedDict`も「利用者が個別に選んだわけではない、辞書由来の一括付与」という性質は
`dict`と同じであり、高頻度出現時にDice scoreの識別力を落とす点も変わらない。よって
判定を「`sources.has('dict') || sources.has('approvedDict')` かつ `explicit`/`manual`/`code`の
いずれでもない」へ拡張する（`dict`と`approvedDict`のいずれか一方のみに由来する高頻度tagも、
両方に由来する高頻度tagも、同様に枝刈り対象とする）。`explicit`/`manual`/`code`から同時に
由来する場合は、既存同様に枝刈りしない。

**8. `buildTagIndex()` documentFrequencyへのapprovedDict算入**: 7と対応し、
`documentFrequency`の集計元（現状`row?._tagInfo?.dict`のみ、L5432-5435）を
`row._tagInfo.dict`と`row._tagInfo.approvedDict`の**和集合**（1行内の重複は`Set`で除去）へ
拡張する。`highFrequencyRatio`等の閾値設定・計算式（L5436-5437）はそのまま流用し、
approvedDict専用の別閾値は新設しない。

**9. `_tagDisplayMap`でのcanonical表示**: `buildTagDisplayMap()`（L4355-4372）は現状、
`.dict`由来tagの表示名を`Object.keys(matchLogic.synonymMap || {})`を再走査して解決している
（L4363-4366）。`effective_vocabulary`は`matchLogic.synonymMap`に一切書き込まないため
（NG-10 / S13本文の原則）、`approvedDict`由来tagの表示名は**別の解決ステップ**として、
`effective_vocabulary.allowed_tags`（canonical表示名）と`effective_vocabulary.aliases`の
key（alias表示名）を走査し、`info.approvedDict`に含まれるtagについてのみ
`map[key] = display`を設定する（既存の「keyが未設定の場合のみ設定、先勝ち」ルール
（L4360）をそのまま踏襲）。

**10. stats/evidenceでのad hoc dictとapprovedDictの識別**: `tagSourcesFor()`（L5940-5947）へ
`if ((info.approvedDict || []).includes(tag)) sources.push('approvedDict');`を追加するだけで、
`annotationTagHtml()`（表示class・title tooltip、L5949-5955）や`tagSourceSetForRow()`
（`tagIsDictOnlyHighFrequency()`等が内部で使う判定、L5396-5398）は**変更なしで自動的に
approvedDictを識別可能になる**（既存機構がsource文字列の集合として汎用的に設計されているため）。
一方、`currentTagCoverageStats()`/`tagMatchSummaryHtml()`（L5498-5523）は現状`.dict`のみを
件数集計しており、`.approvedDict`を独立した内訳として表示するには**別途集計ロジックの追加**
（後続実装Checkpointの対象）が必要である。この10項目はいずれも**設計方針の固定のみ**であり、
実装（matching tool側コード変更）はCheckpoint 1-R3の対象外。

**正式辞書を`matchLogic.synonymMap`へ書き込まない、既存tag score計算式
（`getScore('tag') * dice`、L5486）を変更しない、という2点は、上記10項目のいずれによっても
変更されない。**

**R5（Checkpoint 7）追記: 実装で確定した「比較主体」の訂正。** 上記1-3はR3-3/R4-3時点で
「matching toolが`effective_vocabulary`のcanonical/alias displayと直接比較する」という書き方で
固定されたが、Checkpoint 6でDictionary Resolver pure core（S4.2、
`private_dictionary_resolver_core.js`の`resolveDictionaryTerms()`）が実装されたことにより、
Checkpoint 7の実装はこの直接比較を**行わない**。実際の経路は次の通りである:

```text
row[field]の生の値                    <- 上記1のtokenization規則（scalar/array/objectの
        |                                扱い、delimiter split禁止、部分文字列不一致）は
        |                                そのまま維持。ここが変わったわけではない。
        v
term一覧（whole-value単位）
        |
        v
PrivateDictionaryResolverCore.resolveDictionaryTerms()   <- Checkpoint 6のResolver pure core
        |                                                    （唯一のcanonical/alias解決経路）
        v
Resolution Annotation（per-term、resolution_type +
resolved_canonical を含む）
        |
        v
resolution_type === EXACT_CANONICAL または APPROVED_ALIAS の場合のみ、
annotation.resolved_canonical を normalizeTagValue() へ通した値を
_tagInfo.approvedDict へ追加する（UNKNOWN_TERM/DICTIONARY_CONFLICTは追加しない）
```

matching tool自身は`effective_vocabulary.allowed_tags`/`effective_vocabulary.aliases`を
**一度も直接スキャンしない**（`dictionary_payload.entries`の走査、canonical/alias文字列の
自前比較、conflict判定の再実装はいずれも行わない — これはSource of Truth境界として
Checkpoint 7の静的検証テストでも確認済みである）。上記2「正規化規則」・3
「substring/fuzzy/AI推定の禁止」は、比較の実行主体がResolver側に移った後も、
**Resolver内部の正規化・厳密一致判定として**そのまま踏襲されている
（Resolverは`normalizeForMatch()`相当の正規化＋whole-value完全一致のみを行い、
substring/delimiter分割/fuzzy/AI推定のいずれも行わない設計のまま）。すなわち1-3が
定めた「何を一致とみなすか」という規則自体は不変であり、変わったのは「誰がその比較を
実行するか」（matching tool自身→Resolver pure core）のみである。

上記4-10（source priority、manualRemove適用、maxTagsPerRow共有、high-frequency pruning、
documentFrequency算入、`_tagDisplayMap`表示解決、stats/evidence識別）は実装のまま10項目
すべてが確定通りにCheckpoint 7で実装された。9の表示解決は、`effective_vocabulary.allowed_tags`/
`aliases`を直接走査する代わりに、Resolverが返すResolution Annotationの`resolved_canonical`を
そのままtag表示名として採用する形で実現されており、9が定めた「先勝ちで未設定のみ設定」規則も
維持されている。10で「後続実装Checkpointの対象」とされていた`currentTagCoverageStats()`/
`tagMatchSummaryHtml()`への`approvedDict`独立集計も、Checkpoint 7で実装された
（`approvedDictTags`をstatsへ追加、`tagMatchSummaryHtml()`が`approvedDictionaryStatusHtml()`を
併記）。

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
        |                                     "wrapper_integrity_sha256": "<hex64>" }
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
- `wrapper_integrity_sha256`（S5.1の同名field。旧`dictionary_snapshot_sha256`→
  `dictionary_wrapper_sha256`（R1）→`wrapper_integrity_sha256`（R2-3）と、S5のwrapper契約の
  改訂に合わせて命名を追従させてきた）
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
- **（R3-2で訂正）** content-addressability（同一辞書内容なら同一hash）は`dictionary_payload_sha256`
  が単独で担う。`wrapper_integrity_sha256`はR3-2で全immutable fieldを対象化したため、
  `snapshot_id`等の発番ごとに変化する値を含み、**同一辞書内容のSnapshotを再発行しても
  `wrapper_integrity_sha256`自体は一致しない**（改ざん検知が責務であり、内容同一性の判定は
  `dictionary_payload_sha256`の役割）。再現性の基盤となるのは、S14のpinningが
  `dictionary_snapshot_id` + `wrapper_integrity_sha256`という**厳密な1つのwrapper artifact**を
  指すこと自体であり、Loaderが指定と異なる内容を検出した場合はS10のinvalid Snapshot扱いと
  なることで担保される（S5.2）。
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

**R2で解決した項目（旧番号を維持し、解決済みとして記録する）**:

- 旧#7（R1で追加）: `effective_vocabulary` を既存tag機構（`evaluateTagMatch()`/`buildTagIndex()`）
  へどう接続するかは、R2-1で**解決した**。接続点は`matchLogic`への独立カテゴリ新設ではなく、
  `_tagInfo`への新sibling source（`.approvedDict`）追加である（S13）。なお前提としていた
  `matchInitialTags()`はmatching tool内には存在せず、無関係な別tool系統
  （`excel_direct_adapter.js`/`pdf_direct_adapter.js`）の同名関数であったことを確認した
  （current-state-analysis §15.1）。
- 旧#8（R1で追加）: Snapshot wrapperのhash計算における`dictionary_payload`の扱いは、R2-3で
  **解決した**。`dictionary_payload_sha256`（内容同一性専用）と`wrapper_integrity_sha256`
  （wrapper全体の改ざん検知専用）を分離し、全fieldのhash対象/対象外を表で確定した（S5.2）。
  **R3-2でさらに、`wrapper_integrity_sha256`の対象範囲を`snapshot_id`/`snapshot_version`/
  `supersedes`/`rollback_target`を含む全immutable fieldへ拡張し、対象外fieldを自己参照field
  以外ゼロにした。**

**R3で解決した項目**:

- Resolution provenanceのSource of Truth（R2で「Option B」として一旦解決したが、
  `mergeDictionaryLayers()`の内部実装（priority選択・tie-break後に`entry_ref_id`が破棄される
  こと）を再確認した結果、Option Bでは正確な復元にP2-A1のmerge semantics再実装が必要になる
  ことが判明したため、R3-1で**Option Aへ変更**して再解決した。P2-A1 coreへ
  `mergeDictionaryLayersWithProvenance()`という追加pure APIを後続Checkpointで実装する方針とし、
  duplicate同一canonicalマッピングのprovenanceは単一`selected_entry_ref_id`とする（S4.1）。
- `_tagInfo.approvedDict`の生成・合成規則10項目（一致規則・正規化・source priority・
  manualRemove適用・maxTagsPerRow・high-frequency pruning・display解決・stats識別）を
  実コード確認済みの既存関数を根拠にR3-3で確定した（S13.1）。

**Checkpoint 2で解決した項目**:

- 旧#11（R3-1で追加）: `mergeDictionaryLayersWithProvenance()`をP2-A1 coreへ実装するタイミング、
  および既存`mergeDictionaryLayers()`を薄いwrapperとして再実装するか独立実装のまま維持するかは、
  P2-A4 Checkpoint 2（commit `95df19f9d0a6764baff051934bb59b806fd924c6`）で**解決した**。
  既存の`canonicalGroups`/`aliasMap`計算を`computeDictionaryLayerMerge()`という単一の内部helperへ
  抽出し、`mergeDictionaryLayers()`はこのhelperを呼び出す薄いwrapper（元の4 fieldのみ返す）へ
  再実装し、`mergeDictionaryLayersWithProvenance()`も同じhelperを呼んで`provenance_index`を
  追加で返す。既存`mergeDictionaryLayers()`の戻り値がbit-for-bit不変であることは
  Node検証（P2-A4 Checkpoint2-A、canonical文字列比較）で確認済み。

**R4で解決した項目**:

- 旧#13（R3-3で追加）: `_tagInfo.approvedDict`のtokenization（field値内部の分割要否）は、
  R4-3で**P2-A4 0.1として完全固定し解決した**。scalar値はvalue全体を1つのvalueとして扱い
  delimiter分割を行わない、array値は既存`tagSourceText()`の型別扱い（L4287-4297）と整合させ
  各要素を個別valueとして扱う、object値はapprovedDict resolution対象外とする。substring・
  fuzzy・AI推定も明示的に禁止した（S13.1項目1-3）。将来的なdelimiter/tokenization対応は
  別version/別sliceの対象として切り離した。
- Snapshot Loaderのhash validation順序（新規）: wrapper構造validation →
  `validatePrivateDictionary()`相当の`dictionary_payload`検証 → payload SHA再計算 →
  格納`dictionary_payload_sha256`との比較 → 不一致ならINVALID → 再計算済みpayload SHAを
  用いたwrapper integrity projection構築 → `wrapper_integrity_sha256`再計算 → 格納値との比較 →
  不一致ならINVALID → 両hash成功後のみResolver構築、という10ステップの厳密な順序をR4-1で
  新設・確定した（S10.1）。格納された`dictionary_payload_sha256`を無検証のままwrapper hash
  inputとして信用しない、という制約も明記した。

**Checkpoint 4で解決した項目**:

- 旧#1（Checkpoint 1で追加）: Promotion Validatorがscope/canonical衝突を検出した際の粒度
  （「該当candidateのみ除外」か「Promotion全体を停止」か）は、Checkpoint 4
  （`private_dictionary_promotion_core.js`）で**解決した**。local review exclusion
  （REJECT/UNCERTAIN/UNREVIEWED/blocking P2-A3 Conflict）とformal dictionary structural
  conflict（別ACCEPT candidateが正規化後同一canonical keyになる等）を明確に区別し、前者は
  当該candidate/aliasのみ除外してPromotion全体は続行、後者はPromotion全体をfail-closedで
  停止する、という二層のpolicyとして確定した（S6.5.7）。
- 旧#8（R2-2で追加）: 「Promotion Provenance Artifact」の具体的なschemaは、Checkpoint 4で
  **Promotion Record 0.1**として解決した（S6.5.9）。content-addressing方式（`canonicalJson()`
  → `hashParts()`）、`promotion_record_identity`との参照関係（Snapshot wrapperの
  `promotion_record_identity`フィールドへ`promotion_record`自身のcontent hashを渡す）、
  および semantic decision identity を Workbook SHA から独立させる `review_decision_fingerprint`
  の算出方法を含め、すべて確定した。実装が本当に必要だったかという以前の留保も、Checkpoint 4の
  要求により本Checkpointで実装対象として確定した。

**残存・新規の未解決事項**:

1.（旧#2、R2-1で範囲を再確定）`_tagInfo.approvedDict`（正式辞書由来のtag source）が既存
   tag-score（Dice係数）へどの重みで寄与するか、具体的な係数設計は未確定（S13）。接続方式
   そのものはR2-1で確定済みだが、係数は引き続き次Checkpointで設計する。
2.（旧#3）Excel exportにおけるdictionary情報の具体的な列設計・sheet配置（S18）。
3.（旧#4）Unknown term収集queueの永続化形式・辞書メンテナンス画面との具体的な接続方法（S11）。
4.（旧#5）Conflict candidateをP2-A3のAlias Conflict機構へどう還流させるか、双方向のデータフロー
   （S12.B）。
5.（旧#6）matching tool側テキスト照合の comparison ID（現状formalな契約なし、
   current-state-analysis §4）と、Resolution Annotationの紐付けキーをどう設計するか
   — 数量subsystemの `comparison_id` 契約とは別に検討が必要。
6.（旧#7）project configuration（S14のpinning元）の具体的な格納場所・形式
   （案件ごとのファイル、matching tool起動時の読み込み経路等）は未設計。
7.（旧#9、R2-1で追加）旧`deterministic normalization`案（Resolverが確定させた`canonical_term`を
   `normalizeForMatch()`前処理段階へオプション適用する）の採否・具体的な適用方法（S13）。
   `_tagInfo.approvedDict`経路とは独立した追加入力候補として残るが、Checkpoint 1-R2では
   決定しない。
8.（旧#10、R2-4で追加）Snapshot Activation Record（S5.4）の具体的な永続化場所・schema・
   project configuration（S14）との関係の詳細設計（同一artifactに統合するか、別artifactとして
   分離を維持するか）は未設計。
9.（旧#11、R3-1で追加）`shadowed_entry_refs`（非採用candidateの補助的な公開）を実装するか否か、
   実装する場合の具体的なschemaは未設計（S4.1、必須契約ではなくoptional拡張として位置づけ）。
10.（旧#12、Checkpoint 3で追加）`snapshot_id`の発番方式は未設計（S5.5で「caller-supplied、
    Snapshot core内部で自動発番しない」ことのみ確定。`dsnap-<hex32>`という発番元をどこで・どう
    決定するかは後続Checkpointの対象）。
11.（旧#13、Checkpoint 3で追加）`snapshot_version`のchain monotonicity検証（版番号が実際に単調
    増加しているかの検証）、および`supersedes`/`rollback_target`が指すsnapshot chain全体の存在
    確認・循環検査は、Checkpoint 3のSnapshot core（単一artifactの型検証のみ）では対象外のまま
    （S5.5）。いつ・どの層（Snapshot core自体か、それとも呼び出し側か）で検証するかは未設計。
12.（旧#14、Checkpoint 3で追加）Dictionary Resolver（Snapshotから実際にterm解決を行う層）は
    Checkpoint 3で未実装のまま。loaderは「validated snapshot handle」を返すところまでが境界
    （S5.5、S10.1 step10）であり、S4のResolver設計との接続方法は後続Checkpointで具体化する。
13.（Checkpoint 4で追加）Promotion Input 0.1をP2-A3 Review State/Workbookから実際に生成する
    UI adapterの具体的な実装方法・接続点（S6.5.1）は未設計。今回は「UI非依存の入力契約」の
    固定のみが対象で、adapter自体は次Checkpoint以降の対象。

**Checkpoint 6で解決した項目**:

- 旧#12（Checkpoint 3で追加）: Dictionary Resolver（Snapshotから実際にterm解決を行う層）は、
  Checkpoint 6（`private_dictionary_resolver_core.js`）で**解決した**。Snapshot Loader→
  P2-A1 Private Layer View→`mergeDictionaryLayersWithProvenance()`→exact whole-term解決→
  Resolution Annotation batchという接続をpure coreとして固定した（S4.2）。ただし以下は
  引き続き未解決のまま残る（新規項目として下記14-19に追加）。

**残存・新規の未解決事項（Checkpoint 6時点、続き）**:

14. P2-A3 Review State→Promotion Input adapter（旧#13と同一、未解決のまま）。
15. Snapshot Activation Record・project configuration・latest snapshot選択（旧#8/#6と同一、
    未解決のまま）。
16. `snapshot_version`のchain monotonicity検証・rollback chain全体の存在確認/循環検査
    （旧#11と同一、未解決のまま）。
17. STANDARD/DOMAIN/SESSION多layerの実行時統合（Resolverは今回PROJECT scopeのみを受理し、
    multi-layer構成でのSCOPE_PRIORITY実行時マージは対象外のまま、S4.2）。
18. `_tagInfo.approvedDict`のmatching tool統合（S13.1の生成規則自体はR3-3/R4-3で確定済みだが、
    実際の配線・スコア係数はCheckpoint 6でも未実装のまま、旧#1と同一）。
19. Excel export列設計・unknown term queueの永続化・HUMAN-01/02/03（旧#2/#3、current-state-analysis
    HUMAN項目と同一、未解決のまま）。

**Checkpoint 7で解決した項目**:

- 項目18（Checkpoint 6で追加）: `_tagInfo.approvedDict`のmatching tool統合（実際の配線）は、
  Checkpoint 7で**解決した**。`tools/json_ab_trace_matching_tool_v12.1.15.html`へ
  `private_dictionary_resolver_core.js`等4つのCheckpoint 3-6 pure coreをscriptとして追加し、
  TraceRecord → `tagSourceFields(schemaName)` → whole-value term抽出（S13.1項目1の規則を
  そのまま維持） → `PrivateDictionaryResolverCore.resolveDictionaryTerms()` → Resolution
  Annotation → `resolved_canonical`を`normalizeTagValue()`へ通した値 → `_tagInfo.approvedDict`
  → `composeFinalTags()`/`buildTagIndex()`/`evaluateTagMatch()`という経路を実装した
  （実装詳細はS13.1のR5追記を参照）。既存comparison review平面（accept/reject決定）には
  一切接続せず、dictionary一致がcomparisonを自動acceptすることはない。
- 項目1（旧#2、R2-1で範囲確定、Checkpoint 6時点でも未確定のまま残存）: `_tagInfo.approvedDict`が
  既存tag-score（Dice係数）へどの重みで寄与するかは、Checkpoint 7で**「専用の重み付けを設けない」
  という方針として解決した**。`approvedDict`は`dict`と同じ`_tags`配列（source非依存）へ合流し、
  `evaluateTagMatch()`のスコア式`getScore('tag') * dice`（L5803）はCheckpoint 7で一切変更していない
  （静的検証テストで`getScore('approvedDict')`等の専用score/method tokenが存在しないことを確認
  済み）。document frequency算入・high-frequency pruningも`dict`と対称に`dict ∪ approvedDict`の
  和集合として扱う（S13.1項目7・8）。「正式辞書由来だからより高いスコアを与える」という設計は
  0.1では採用せず、将来的に必要になった場合は別version/別sliceで再検討する。

---

## S24. Checkpoint 8: P2-A3 Review State → Promotion Input Adapter

S6.5.1で示した「未設計」だった接続点（旧#13/#14, S23参照）をP2-A4 Checkpoint 8で解決する。
対象は下記の一本のboundaryのみ:

```text
P2-A2 Evaluation + P2-A3 Review State
        |
        v
tools/knowledge_builder/core/private_dictionary_review_promotion_adapter_core.js
  buildPromotionInputFromReview(input)
        |
        v
private-dictionary-promotion-input/0.1  (S6.5.2契約と完全一致)
```

Promotion / Snapshot / Resolver / Matching integrationは一切変更しない。本Checkpointの
Adapterは「PromotionがPromotion Input 0.1として受理できる形へreview stateを翻訳し、
review↔evaluation bindingを検証するboundary」であり、Promotion自身が持つ意味判断
（winner選択・conflict解決・materialization・Snapshot整合性）を一切再実装しない。

### S24.1 なぜ新規coreか

`private_dictionary_promotion_core.js`はS6.5.1で明記した通り`tools/knowledge_builder/ui/*`
へproductionとして依存しない。P2-A3のReview State（`review_state.js`）はID-keyed mapを
内部表現として使うUIランタイム状態であり、Promotion Inputの`candidate_decisions`等が要求する
「sorted array」形式とは異なる。この変換・bindingの検証を担う層が存在しなかった
（S23旧#13/#14）。新規pure core `private_dictionary_review_promotion_adapter_core.js`が
この変換のみを担当する。

### S24.2 Adapter Input契約（design-first、0.1として固定）

Adapter InputはP2-A3 UI runtime stateと同型だが、Adapter core自身は`tools/knowledge_builder/ui/*`
を一切require/importしない（review_state.jsのモジュール参照ではなく、その出力shapeを
仕様として踏襲するのみ）。

```text
{
  evaluation,              // P2-A2 Evaluation object（opaque single-read reference。
                           //   Promotion Input `evaluation` へそのまま伝播。フィールドの
                           //   再生成・再検証はAdapterのbinding検査に必要な最小限のみ）
  review_state: {
    review_schema_version,        // 'private-dictionary-candidate-review/0.1'
    extraction_schema_version,    // == evaluation.schema_version
    source_fingerprints,          // [{source_document_id, document_fingerprint}]
    candidate_decisions,          // { [candidate_id]: {decision, reason_code, note, decided_at} }
    alias_decisions,              // { [alias_candidate_id]: {...} }
    conflict_resolutions,         // { [conflict_id]: {resolution, selected_candidate_id, reason_code, note, decided_at} }
    reviewer_notes                // { session_note }
  },
  base_snapshot,           // null または opaque Snapshot Wrapper reference（Adapterは
                           //   フィールドを一切読まない。Promotion呼び出し時に
                           //   PrivateDictionarySnapshotCore.loadDictionarySnapshotWrapper()
                           //   へそのまま渡る前提。null-or-not以外の判定をAdapterで行わない）
  target_dictionary_id,    // caller-controlled string（Promotion契約のDICTIONARY_ID_RE検証）
  target_version,          // caller-controlled string（Promotion契約のVERSION_RE検証）
  source_commit            // caller-controlled string（Promotion契約のHEX40_RE検証）
}
```

`source_review_artifact_identity`はAdapter Inputに**含めない**（S24.4参照。callerが
自由入力する設計を明示的に禁止するP2-A4 Checkpoint 8指示§8/§9のため）。`base_snapshot`の
latest探索・project config探索・時刻/random由来のID生成はAdapter内で一切行わない
（caller明示入力のみ）。

### S24.3 Adapter Output契約

`private-dictionary-promotion-input/0.1`（Promotion Input 0.1、S6.5.2）と完全一致する
fresh・frozen objectを返す。Adapter専用の中間formatは作らない。top-level keyは
`INPUT_ROOT_KEYS`（Promotion core側の定数、S6.5.2）と同一の10 fieldのみ。

### S24.4 Review Artifact Identity（Checkpoint 8の中心設計判断）

S6.5.2は`source_review_artifact_identity.sha256`を「元P2-A3 private Review Workbookの
identity」と定義しているが、Adapter pure coreはWorkbook（.xlsx）を一切parseしない
（Checkpoint 8指示§6）。調査の結果、P2-A3側にはWorkbookバイト列のsha256を計算する
pure coreレベルのAPIが存在しない（`browser_ingest.js`の`sha256Hex()`はWebCrypto依存の
browser-onlyヘルパーであり、かつ用途は入力ドキュメントのingestであってreview artifact
identityではない）。「既存identity verification APIを再利用する」という指示§9の前提条件
（そのAPIが存在すること）が成立しないため、指示§6が明示的に許可する「最小のcore-facing
capture境界を設計する」を適用する。

**確定した設計**: Adapterは`source_review_artifact_identity.sha256`を**caller入力として
受理しない**。Adapter自身が、実際に受け取ったreview_state（S24.2の構造化capture後の値、
`reason_code`/`note`/`decided_at`/`reviewer_notes`を含む全項目）から、既存の共有hash
primitive `KnowledgeIdHashUtils.hashParts()`（Promotion/Snapshot/Resolverが自身の
identity計算に使うのと同じ関数。§1.3のnormalization/hash契約を独自に再実装しない原則を
踏襲）を使って**決定論的に算出する**。namespace文字列は
`'private-dictionary-review-promotion-adapter-artifact-v1'`固定とし、Promotion自身が
算出する`review_decision_fingerprint`（namespace
`'private-dictionary-promotion-review-decision-v1'`、`reason_code`/`note`/`decided_at`/
`reviewer_notes`を含まない意思決定のみの射影）とは意図的に異なるnamespace・異なる射影
内容にする（両者を同一視・redundant化しない）。

この設計により、指示§9の禁止事項「review artifact A + source_review_artifact_identity of B」
は構造的に発生し得ない: identityは常に、Adapterが実際に変換したreview_stateの内容から
その場で計算される値であり、callerが無関係な値を混入させる余地がない。

### S24.5 Evaluation binding（Adapter独自の全集合検証）

Promotion core自身も`checkIdentityConsistency()`でreview/evaluation bindingを独立検証する
（S6.5.3）が、これはPromotion Inputの`candidate_decisions`配列（既にAdapterが構築済み）と
`evaluation`の突合であり、Adapterが「P2-A3 review stateのID-keyed mapとP2-A2 evaluationの
対応」を配列化する**前**の整合性は検証しない。Adapterは配列を組み立てる前に、独自に
次を検証する（一致しない場合`REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH`で
fail-closed、片方向のみの検証は行わない）:

- `review_state.review_schema_version === 'private-dictionary-candidate-review/0.1'`
- `review_state.extraction_schema_version === evaluation.schema_version`
- `review_state.source_fingerprints`と`evaluation.source_fingerprints`の完全set一致
  （`{source_document_id, document_fingerprint}`の組で比較）
- `Object.keys(review_state.candidate_decisions)`と`evaluation.candidates[].candidate_id`の
  完全set一致（reviewに余分/不足いずれもreject）
- `Object.keys(review_state.alias_decisions)`と`evaluation.alias_candidates[].alias_candidate_id`
  の完全set一致
- `Object.keys(review_state.conflict_resolutions)`と`evaluation.conflicts[].conflict_id`の
  完全set一致

この検証のために、Adapterは`evaluation`から`schema_version`/`source_fingerprints`/
`candidates[].candidate_id`/`alias_candidates[].alias_candidate_id`/`conflicts[].conflict_id`
のみを安全構造読み取り（hostile-input対応のsafe descriptor read、既存4 core共通のR1-1
パターンを本coreでも独立実装 — このパターン自体は「Promotion意味論」ではなく本セッション
全coreに共通する汎用hostile-input防御であり、S21のNo-goal対象外）する。P2-A2 evaluationの
完全なschema検証（残りのfield）はPromotion自身が実施するため、Adapterはこの最小集合以外を
一切読まない。

### S24.6 Decision projection規則

`evaluation.candidates`を`candidate_id`昇順sort（Promotion既存の`ordinalCompare`と同じ
文字列比較、S6.5.9 `canonicalCandidateDecisions()`と同一sort rule）した順に、
`review_state.candidate_decisions[candidate_id].decision`を`DECISION_VALUES`
（`UNREVIEWED/ACCEPT/REJECT/UNCERTAIN`、Promotion契約と同一のenum定数をAdapter内に
literalとして固定）で検証したうえで`{candidate_id, decision}`へ射影する。alias/conflictも
同型（`alias_candidate_id`昇順、`conflict_id`昇順）。`conflict_resolutions`は
`resolution ∈ RESOLUTION_VALUES`、`SELECT_CANONICAL`の場合のみ`selected_candidate_id`が
非null文字列（かつ`conflicting_candidate_ids`に含まれる値であることまでは検証しない —
それはPromotion自身の`PROMOTION_SELECTED_CANDIDATE_INVALID`/materialization責務であり、
S24.5と同じ理由でAdapterは形式のみを見る）、それ以外は`null`固定という構造規則のみを
検証する。`reason_code`/`note`/`decided_at`はPromotion Inputへ一切コピーしない
（S6.5.2の既存contract通り）。UNREVIEWED/UNCERTAINの自動変換、conflictの
`selected_candidate_id`推測はいずれも行わない。

### S24.7 Trust boundary / Error contract

既存4 core（Promotion/Snapshot/Resolver/Matching integration R1-R4）と同じsanitized
`{code, path}`のみを外部へ返す。message/stack/cause/raw値は一切含めない。全ての
構造読み取り（root入力・review_state・evaluationのbinding用最小集合）は呼び出し開始時点で
同期的に完了し（§25 atomic capture patternの踏襲）、以降の非同期処理は
identity計算の`KnowledgeIdHashUtils.hashParts()`呼び出し1箇所のみであり、その入力は
既にcaptureされたcanonical JSON文字列のみである（caller inputの再読み取りは発生しない）。

Error code allowlist（8種、design-firstで固定）:

| code | 意味 |
|---|---|
| `REVIEW_PROMOTION_ADAPTER_ROOT_INVALID` | Adapter Input root自体が不正な形状 |
| `REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID` | `review_state`が構造的に不正（map形状・decision/resolution enum・selected_candidate_id極性を含む） |
| `REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID` | `evaluation`がbinding検証に必要な最小形状すら満たさない |
| `REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH` | S24.5の6項目のいずれかが不一致 |
| `REVIEW_PROMOTION_ADAPTER_TARGET_INVALID` | `target_dictionary_id`/`target_version`/`source_commit`の形式不正 |
| `REVIEW_PROMOTION_ADAPTER_BASE_SNAPSHOT_INVALID` | `base_snapshot`が`null`でも安全な参照でもない |
| `REVIEW_PROMOTION_ADAPTER_HASH_FAILED` | identity計算（`canonicalJson`/`hashParts`）の失敗 |
| `REVIEW_PROMOTION_ADAPTER_DEPENDENCY_FAILED` | `KnowledgeIdHashUtils`依存解決の失敗 |

### S24.8 Non-goals（本Checkpoint）

Promotionの実行・Snapshot生成・Snapshot Activation・Matching配線は行わない。Workbook
parse（SheetJS/FileReader/Blob/browser UI）はAdapter pure coreに一切持ち込まない。
HUMAN-01/02/03（日本語UI文言改善）はUI integration checkpointへ委譲し、本Checkpointには
含めない。

### S24.9 Checkpoint 8-R1 追補: evaluation/base_snapshot atomic capture（MAJOR-01是正）

Checkpoint 8初期実装は`review_state`側のみfresh captureし、`evaluation`と非null
`base_snapshot`はcaller-owned raw referenceのまま成功output（Promotion Input 0.1の
`evaluation`/`base_snapshot`フィールド）へ格納していた。独立レビューでMAJOR-01として
指摘され、本追補でこれを是正する。S24.1〜S24.8の決定事項（review artifact identity設計、
evaluation binding方式、decision projection規則、Promotion Input 0.1 shape、error
sanitization方針）はいずれも変更しない。

**是正内容**:

- `output.evaluation`は常に`input.evaluation`と異なる参照になる。非null
  `output.base_snapshot`は常に`input.base_snapshot`と異なる参照になる（`null`は`null`の
  ままpass-through）。これにより、callerが呼び出し直後に自身の`evaluation`/
  `base_snapshot`オブジェクトを変更しても、Adapterの成功結果は一切影響を受けない
  （既存4 coreが確立したatomic capture / TOCTOU防止規律を、`evaluation`/`base_snapshot`
  にも適用する）。

- **structural capture（構造的複製）とsemantic validation（意味検証）の責務分離**:
  Adapterは`captureStructuralValue()`という汎用・非semantic的な再帰copierを新設した。
  これは`null`/文字列/真偽値/有限数値/安全なplain object/安全なplain arrayという
  JSON互換の値treeを、field名や意味を一切解釈せずfresh・frozen・same-realmな複製へ
  変換するだけの関数であり、`evaluation`固有のfield（`canonical_term`/`metrics`/
  `rule_ids`/`evidence_refs`等）にもSnapshot wrapper固有のfield（`dictionary_payload`/
  `snapshot_id`等）にも一切依存しない。P2-A2 EvaluationやSnapshot wrapperの意味論的
  schema検証は本Checkpoint以前と変わらず、Promotion core / Snapshot core自身
  （Adapterの呼び出し先ではなく、Adapterの出力を受け取った**後で**caller側が呼ぶ）の
  排他的責務のままである。S24.5のevaluation binding最小集合検証（`captureEvaluationBindingSlice()`）
  は、この構造的複製が完了した**後**の安全な複製値に対して行うよう変更した
  （生のcaller参照への再読み取りを発生させないため）。

- `evaluation`のcapture結果は、そのままではPromotion Inputの`evaluation`フィールドに
  必要な全fieldを失わずに保持する（S24.5の最小bindingスライスだけを保持する方式には
  戻さない）。これにより、Adapter出力を実際の（変更していない）Promotion coreへ渡した
  ときの意味論的検証・materializationが従来通り成功することを維持する。

- 非null`base_snapshot`も同じ`captureStructuralValue()`を通す。`null`はそのまま`null`。
  captureされた値がsafe plain objectであることの最小gate（Promotion自身が
  `PrivateDictionarySnapshotCore.loadDictionarySnapshotWrapper()`を呼ぶ前に行うのと同じ
  最小チェック）はcapture後の値に対して引き続き行うが、Snapshot wrapperのfield意味論
  （`wrapper_schema_version`のformatや`snapshot_id`のhash整合性等）はAdapterが検証しない
  という既存方針は変わらない。latest/active Snapshotやproject config検索も引き続き
  行わない。

- 単一読み取り（single-read）/TOCTOU規律は`captureStructuralValue()`にも適用される:
  到達可能な各値は、既存の安全descriptor読み取りprimitive
  （`Object.getOwnPropertyDescriptor`ベースの`readOwnDataProperty()`等、S24.5と同一の
  R1-1パターン）を通じて**最大1回**だけ読み取られる。読み取り後に`captureEvaluationBindingSlice()`
  がbinding最小集合を導出する際は、captureされた安全な複製に対する通常のproperty
  accessのみを行い、caller所有の生参照を再度読み取ることはない。

- capture結果（`evaluation`・非null`base_snapshot`とその配下の全nested object/array）は
  `Object.freeze()`により全階層でfrozenとなり、外部から見て不変となる。

**この追補が変更しないもの（既存Checkpoint 8決定の継続）**: review artifact identity設計
（S24.4、caller入力として受理しない・content-derived・`hashParts`再利用・専用namespace・
Promotionの`review_decision_fingerprint`との分離）はそのまま。evaluation binding
（S24.5の6項目・両方向set一致）・decision projection規則（S24.6）・Promotion Input 0.1
shape（S24.3）・sort規則・error sanitization方針（S24.7、code一覧は既存8種のまま
追加なし — 新しいfailureは既存の`REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID`/
`REVIEW_PROMOTION_ADAPTER_BASE_SNAPSHOT_INVALID`を再利用し、専用codeを新設しない）は
一切変更しない。

---

## S25. Checkpoint 9: Snapshot Activation Record / Explicit Project Snapshot Pin

旧#8（S5.4、R2-4で新設）・旧#10（S23）・旧#15（S23 Checkpoint 6追記）で繰り返し
「未設計」として持ち越されていた事項を、P2-A4 Checkpoint 9で解決する。対象は
新規pure core 1本（`tools/knowledge_builder/core/private_dictionary_snapshot_activation_core.js`）
のみで、既存core（Snapshot/Promotion/Composition/Resolver/Adapter/Learning/Rule
Extraction）・Checkpoint 7 matching tool HTML・P2-A3 UI/coreはいずれも変更しない。

### S25.1 なぜ2つのartifactに分離するか（S5.4の原則を継承）

S5.4が既に確定した「immutable Snapshot wrapperと可変運用状態を同居させない」という
原則を、Checkpoint 9ではさらに一歩進め、**「可変運用状態」自体を2つの別責務へ分離する**。

```text
Immutable Snapshot（S5、変更禁止）
       │
       ├── Snapshot Activation Record   … 辞書運用上のlifecycle状態（監査・表示専用）
       │
       └── Project Snapshot Pin         … matchingが読むexplicit selection（再現性の根拠）
```

理由: S5.4は当初「ACTIVEなsnapshotを表す1つのレコード」だけを想定していたが、
S14/NG-6が確定した「matchingは常にproject configurationが指す厳密なsnapshot identityを
pinする（探索しない）」という要件と、S5.4の「Activation Recordは監査・表示専用であり
matching selectorにしてはいけない」という要件は、**責務としては同じ`activation_status`
概念に見えても実際には別の質問に答えている**:

- Activation Record「このSnapshotは辞書運用上、今ACTIVE/SUPERSEDED/ROLLED_BACKの
  どれか」 → 複数snapshotが並行してACTIVE以外の状態を持ちうる、辞書メンテナ向けの
  監査ログ的record。
- Project Snapshot Pin「このPROJECTが次回matching sessionで使う、厳密に1つの
  snapshot identity」 → matching engineの入力そのもの。ACTIVE Activation Recordを
  検索して自動選択することは、S14/NG-6が禁止する「暗黙のlatest探索」の再導入になる。

両者を1つのartifactに統合すると、「ACTIVEと表示されているものが自動的にmatchingへ
反映される」という暗黙連動を実装しやすくなってしまい、S14の原則を壊す誘惑を生む。
2つの別artifact・別schema・別public APIとして分離することで、この誘惑を構造的に
排除する（S25.4で恒久検査として固定）。

### S25.2 Snapshot Activation Record 0.1（S5.4を正式化）

schema: `private-dictionary-snapshot-activation/0.1`

| field | 型・format | 備考 |
|---|---|---|
| `activation_record_schema_version` | 完全一致文字列 `"private-dictionary-snapshot-activation/0.1"` | |
| `dictionary_snapshot_id` | `^dsnap-[0-9a-f]{32}$` | 対象SnapshotのSource of Truthは必ず実際の`PrivateDictionarySnapshotCore.loadDictionarySnapshotWrapper()`成功結果から読む。caller自由入力は許可しない（S25.5） |
| `wrapper_integrity_sha256` | `^[0-9a-f]{64}$` | 同上。S5.1の同名fieldと同じ値（改ざん検知hashそのもの） |
| `activation_status` | `"ACTIVE"` \| `"SUPERSEDED"` \| `"ROLLED_BACK"` | S5.4のenumをそのまま採用 |
| `updated_by` | non-empty string、1〜200文字 | human operator識別子。private termではない。emailやOS username等のPII形式を強制しない、また自動取得もしない（caller必須supply） |
| `updated_at` | `YYYY-MM-DDTHH:mm:ss.sssZ`（S5.5 `provenance.generated_at`と同一format・同一validation方式）、canonical UTC timestamp | **R1追加**: S5.4簡易案にはtimestampがなかったが、監査可能性のため追加する。`Date.now()`/`new Date()`からの自動生成は禁止 — caller supplied必須（Snapshot core `provenance.generated_at`と同じ思想） |

**identity追加要否の検討（§8指示への回答）**: `dictionary_snapshot_id` + `wrapper_integrity_sha256`
の2つで、対象Snapshotの完全なcontent-addressable識別として十分である。
`wrapper_integrity_sha256`は既にS5.2でwrapper全fieldの改ざん検知hashとして定義済みであり、
Activation Record自身に**新しいcontent hashを追加する必要はない**（§24方針を継承:
新hash種類を不用意に増やさない）。Activation Record自体のcontent hash（例:
「このrecord自身のidentity」）も0.1では導入しない — recordは
`(dictionary_snapshot_id, activation_status, updated_at)`の組で十分に一意に追跡でき、
`KnowledgeIdHashUtils`を持ち込む新しい理由がないため（S25.7）。

**含めないfield（S27 privacyの帰結、および責務分離の帰結）**: `canonical_term`/
`alias_term`/`reason note`/`workbook filename`/`dictionary_id`/`dictionary_version`/
`scope`。dictionary_id/version/scopeはProject Snapshot Pin側の責務であり、Activation
Recordは「Snapshotという単位そのもの」をsnapshot_id + hashのみで指す（S5.4の元設計を
維持）。

### S25.3 Project Snapshot Pin 0.1（新設）

schema: `private-dictionary-project-snapshot-pin/0.1`

```json
{
  "schema_version": "private-dictionary-project-snapshot-pin/0.1",
  "project_id": "<caller supplied opaque non-empty identifier>",
  "snapshot_binding": {
    "snapshot_id": "dsnap-<hex32>",
    "snapshot_version": 1,
    "wrapper_integrity_sha256": "<hex64>",
    "dictionary_payload_sha256": "<hex64>",
    "dictionary_id": "pdict-<hex32>",
    "dictionary_version": "<decimal string>",
    "scope": "PROJECT"
  }
}
```

`snapshot_binding`の7 fieldは、Checkpoint 7 matching tool HTML
（`captureApprovedDictBatchBinding()`、`tools/json_ab_trace_matching_tool_v12.1.15.html`
L3481-3512）およびResolver core（`resolveDictionaryTerms()`内の`snap`構築、
`private_dictionary_resolver_core.js` L419-437）が既に確立した同一7-field形状・同一format
規則（`dsnap-<hex32>`/`pdict-<hex32>`/hex64×2/safe integer≥1/decimal string/`"PROJECT"`
固定）を踏襲する。**Checkpoint 7 matching tool HTMLを本coreのproduction dependencyには
しない**（指示§11: matching HTMLをpure coreから`require`/読み込みしてはいけない）ため、
format validator自体は本core内に独立実装する。これは既存の「各coreが同じ汎用
hostile-input防御パターンを独立して持つ」規律（Resolver/Promotion/Composition/Adapter
がそれぞれ独自にR1-1構造読み取りprimitiveを持つのと同じ理由）の延長であり、
「Promotion/Resolver意味論の再実装」ではない — 対象はあくまで7 fieldの**形式**
（正規表現・型）のみで、dictionary resolution/promotion判定ロジックは一切含まない。
drift防止のため、7 fieldの意味的Source of TruthはこのCheckpoint 7 HTML/Resolverが
確立した契約であることを本節に明記し、値そのものは必ずSnapshot Loaderの検証済み結果
から導出する（caller直接入力を許可しない、S25.5）。

`dictionary_id`/`dictionary_version`は`validated.dictionary_payload.dictionary_id`/
`validated.dictionary_payload.version`から読む（P2-A1 `validatePrivateDictionary()`が
既に`^pdict-[0-9a-f]{32}$`/`^(0|[1-9][0-9]{0,15})$`を保証済みだが、本coreでも
defense-in-depthとして同じformatを再チェックする — P2-A1のschema検証ロジック自体を
再実装するわけではなく、既に信頼できる文字列に対する単純な形式再確認である）。

**Project Pinには`dictionary_payload`を一切保持しない**（指示§9・§12）。

### S25.4 責務分離の恒久固定（ACTIVE ≠ matching selected）

次を本coreの構造として固定する（指示§14の恒久検査）:

- `buildSnapshotActivationRecord()`/`transitionSnapshotActivation()`は、Project Snapshot
  Pinを一切参照・生成・変更しない。
- `buildProjectSnapshotPin()`は、Snapshot Activation Recordを一切参照・生成・変更しない。
- 3つの公開APIはいずれも、他方のartifactをinput/outputに含まない。両者を結びつける
  操作（「このsnapshotをACTIVEにしたら自動でPROJECT Pinも切り替える」等）は本
  Checkpointのpure core内には実装しない。将来必要になった場合は、明示的な上位
  orchestration層（このpure core自体ではない）として別途設計する（S25.9）。

### S25.5 Snapshot Wrapper binding（Source of Truthの一本化）

3つの公開APIはいずれも`snapshot_wrapper`という生の（caller-owned、potentially hostile）
参照を受け取るが、**caller supplied 7-fieldや`dictionary_snapshot_id`/
`wrapper_integrity_sha256`を個別input fieldとして直接受理しない**。必ず
`PrivateDictionarySnapshotCore.loadDictionarySnapshotWrapper(snapshot_wrapper)`
（Checkpoint 3、無改変）を呼び出し、その成功結果（deep-frozen validated snapshot
handle、13 field）からのみ`dictionary_snapshot_id`（`validated.snapshot_id`）・
`wrapper_integrity_sha256`・`snapshot_version`・`dictionary_payload_sha256`・
`dictionary_id`（`validated.dictionary_payload.dictionary_id`）・`dictionary_version`
（`validated.dictionary_payload.version`）・`scope`を導出する。Loaderが失敗した場合
（構造不正・hash不一致・scope不一致等、理由を問わず）、本coreは`ACTIVATION_SNAPSHOT_INVALID`
/`PROJECT_PIN_SNAPSHOT_INVALID`という自coreの分離されたerror codeへ変換する
（Snapshot coreの内部SNAPSHOT_*コードや native Error/messageを一切外部へ漏らさない
— Resolver/Promotion/Compositionが自coreのLoader呼び出し失敗を各々`RESOLVER_SNAPSHOT_LOAD_FAILED`
/`PROMOTION_BASE_SNAPSHOT_INVALID`等へ変換するのと同じ規律）。

`snapshot_wrapper`自体の深いstructural captureは本coreでは行わない（Loader自身が
Checkpoint 3のR1-1パターンで独立してatomic captureを行うため、二重にcloneする必要が
ない）。本coreが独自にatomic captureを行うのは、Loaderへ渡さない他のcaller-owned入力
（`current_record`・`history`配列）のみである（S25.8）。

### S25.6 Activation Transition（S16再確認、design-firstで固定）

指示§18は最低限「no record→ACTIVE」「ACTIVE→SUPERSEDED」「SUPERSEDED→ROLLED_BACK」の
3遷移を求めた。S16のrollback設計（「immutable Snapshotは書き換えない。rollbackは
`rollback_target`を持つ新Snapshotの発行として表現する」）を踏まえ、Activation Record
のtransitionは**単一snapshot_idのレコード自身のstatus遷移のみ**を扱い、複数snapshotに
またがる暗黙連動（「XがROLLED_BACKになったら自動でYがACTIVEになる」等）は行わない
（S25.4と同じ理由）。

確定した遷移graph（0.1、closed set）:

```text
(no record) --build--> ACTIVE
ACTIVE      --transition--> SUPERSEDED
ACTIVE      --transition--> ROLLED_BACK
SUPERSEDED  --transition--> ROLLED_BACK
```

`SUPERSEDED`/`ROLLED_BACK`は本0.1ではterminal（そこからの再遷移は許可しない）。
「一度SUPERSEDEDになったsnapshotを再度ACTIVEに戻す」操作（＝rollback先として再選択
する）は、**同じrecordを書き換えるのではなく、同じ`dictionary_snapshot_id`に対して
新しいActivation Record（新しい`buildSnapshotActivationRecord()`呼び出し、
activation_status=ACTIVE）を発行する**ことで表現する（immutable Snapshotが
再発行ではなく新規発行で表現されるのと対称的な設計 — 既存recordを書き換えて
「なかったこと」にしない、監査trail優先）。

`ACTIVE→ROLLED_BACK`を指示の最低3遷移に追加した理由: 誤ったSnapshotをACTIVE化した
直後に是正する運用（「SUPERSEDEDを経由させず直接ROLLED_BACKにする」）は現実的な
運用シナリオであり、これを禁止すると「一度SUPERSEDEDにしてからROLLED_BACKにする」
という不自然な2段階操作を運用側に強制することになる。`SUPERSEDED→ROLLED_BACK`は
指示通り維持する（後から遡って「あのsnapshotは実はrollback chainの一部だった」と
audit的に印を付け直す場合に用いる）。

**単純なenum書換えにしない**（指示§18）: `transitionSnapshotActivation()`は
(a) 現在の`current_record`を構造的に検証し、(b) 新たに渡された`snapshot_wrapper`を
実Loaderで再検証し、(c) 検証済みsnapshotのidentity（`snapshot_id`+
`wrapper_integrity_sha256`）が`current_record`のそれと**完全一致することを要求**し
（一致しない場合`ACTIVATION_BINDING_MISMATCH`でfail-closed — 「別snapshotへ
すり替えてstatusだけ変える」ことを構造的に禁止する）、(d) 遷移graph上の合法な
edgeであることを検証し、(e) それら全てが通った場合のみ新しいrecordを生成する。
「どのrecordがどのSnapshotを指すか」は常にidentity一致検証によって明確である。

### S25.7 Snapshot chain consistency（S23旧#11、Checkpoint 9でどこまで閉じるか）

`transitionSnapshotActivation()`は任意（optional、`null`可）の`history`引数を受け付ける。
`history`は呼び出し側が持つ、**既に検証済みのlightweight snapshot chain summary**の配列
（`{dictionary_snapshot_id, snapshot_version, supersedes, rollback_target}`、各要素は
S5.5と同一format規則で本coreが構造検証する）であり、pure coreがrepository/storageから
探索することはない（指示§19の禁止事項通り）。

`history`が渡された場合、遷移対象のsnapshot（今回のLoader検証結果自身の`snapshot_id`/
`snapshot_version`/`supersedes`/`rollback_target`を「candidate」として`history`へ合成
した集合）に対し、次を検証する（いずれか違反時`ACTIVATION_HISTORY_INVALID`）:

1. `dictionary_snapshot_id`の重複がないこと。
2. 各要素の`supersedes`が非nullの場合、集合内に存在する別要素を指し、かつその
   参照先の`snapshot_version`が自身の`snapshot_version`より真に小さいこと
   （monotonicity — S23旧#11「snapshot_version monotonicity」「supersedes existence」を
   同時に閉じる）。
3. 各要素の`rollback_target`が非nullの場合、集合内に存在する別要素を指すこと
   （rollback target consistency）。
4. `supersedes`辺で構成される有向グラフに循環がないこと（DFS + 再帰stackによる
   cycle detection、S23旧#11「cycle detection」を閉じる）。

`history`が`null`の場合はこれらのchain検証をスキップする（従来通り、単一recordの
status遷移とidentity一致のみを検証）。これにより、S23旧#11は「chain全体の検証は
callerが明示的に提供した場合にのみ、pure coreとして厳密に閉じられる」という形で
Checkpoint 9として解決する。`history`を伴わない呼び出しでは、chain全体の整合性は
引き続き上位（呼び出し側）の責務のまま未解決）。`supersedes`/`rollback_target`の
自己参照禁止自体は、Loaderが呼ぶSnapshot core自身の`checkChainRef()`で既に閉じている
（`supersedes !== snapshot_id`、`rollback_target !== snapshot_id`、S5.5）ため、本coreで
重複実装しない。

### S25.8 Atomic capture / trust boundary

Checkpoint 8-R1までに確立したatomic capture水準を維持する。`input`root、
`current_record`、`history`配列とその各要素は、呼び出し開始時点で同期的に
（`await`前に）一度だけ安全なdescriptor読み取り経由で読み、以降再読しない。
`snapshot_wrapper`はS25.5の通りLoaderへ生参照のまま渡す（Loader自身がR1-1
パターンで独立atomic captureを行うため）。hostile Proxy（`getOwnPropertyDescriptor`
trap）・accessor property・symbol key・`__proto__`/`prototype`/`constructor`・sparse
array・custom prototype・循環構造は、既存4+1 core（Snapshot/Resolver/Promotion/
Composition/Adapter）と同じ独立コピーのR1-1系chokepoint関数でfail-closedする。
出力（Activation Record / Project Snapshot Pin）はいずれもfresh・deep-frozen objectで
あり、caller-owned inputへのaliasを一切持たない。

### S25.9 Persistence boundary（指示§17）

本coreはformal state artifact（Activation Record / Project Snapshot Pin）の
validation/build/transitionのみを扱う。`localStorage`/`sessionStorage`/`IndexedDB`/
filesystem/network/ダウンロードは一切実装しない。実際の永続化先（project設定ファイル、
DB、ブラウザstorage等）は後続Checkpointで別のstorage adapter層として分離する。この
分離により、`formal state`（本core）と`storage technology`（未実装）を独立に保つ
（S14が既に「project configurationの具体的格納場所は未設計のまま」としていたのと
同じ切り分け）。

### S25.10 Privacy（S17を継承）

Activation Record / Project Snapshot Pinのいずれにも、`canonical_term`/`alias_term`/
`original_term`/`source excerpt`/`reviewer note`/`reason note`/`workbook filename`/
`sheet`/`page text`/`evidence text`を含めない。許容するのはopaque ID・hash・version・
scope・lifecycle status・operator識別子・caller supplied timestampのみ（指示§27）。
`project_id`はcaller supplied opaque識別子であり、そこにprivate termを混入させない
運用上の責務はcaller側にある（pure coreは文字列の中身の意味を検査できないため、
構造的強制はできない — これは本coreの限界として明記する）。

### S25.11 Error contract

専用namespace（9種、design-firstで固定。指示§26の例示から、実際に使用しない
`PROJECT_PIN_BINDING_MISMATCH`/`PROJECT_PIN_HISTORY_INVALID`は採用しない —
Project Pinには「既存pinとの比較」も「history」概念もないため）:

| code | 意味 |
|---|---|
| `ACTIVATION_ROOT_INVALID` | Activation Record系入力（`buildSnapshotActivationRecord`/`transitionSnapshotActivation`のinput root、`current_record`の形状、`updated_by`/`updated_at`のformat等）が不正 |
| `ACTIVATION_SNAPSHOT_INVALID` | `snapshot_wrapper`が実Loaderで検証失敗 |
| `ACTIVATION_STATUS_INVALID` | `activation_status`/`new_status`が許可されたenum値でない、または`buildSnapshotActivationRecord`に`ACTIVE`以外が渡された |
| `ACTIVATION_TRANSITION_INVALID` | `(current_record.activation_status, new_status)`がS25.6の遷移graph上の合法なedgeでない |
| `ACTIVATION_BINDING_MISMATCH` | 再検証した`snapshot_wrapper`のidentityが`current_record`のそれと不一致 |
| `ACTIVATION_HISTORY_INVALID` | `history`の形状不正、重複、非monotonic、rollback_target不整合、循環のいずれか |
| `ACTIVATION_DEPENDENCY_FAILED` | `PrivateDictionarySnapshotCore`依存解決の失敗（Activation/Pin両系で共有） |
| `PROJECT_PIN_INVALID` | Project Pin系input root形状、または`project_id`のformat不正 |
| `PROJECT_PIN_SNAPSHOT_INVALID` | `snapshot_wrapper`が実Loaderで検証失敗（Pin側） |

外部へ返すのは常に`{code, path}`のみ。native Error/message/stack/cause/private
dictionary term/filename/secret markerは一切含めない。

### S25.12 Non-goals（本Checkpoint）

Project Snapshot Pin → matching session `setSnapshot()`のruntime配線は行わない
（後続Checkpoint、指示§16）。Activation RecordとProject Pinを結ぶ上位orchestration
（S25.4）は行わない。storage adapter実装（S25.9）は行わない。HUMAN-01/02/03の
UI適用は行わない（指示§33）。Checkpoint 7 matching tool HTML・P2-A3 UI/coreの変更は
行わない。

### S25.13 Checkpoint 9-R1 追補: history atomic capture（MAJOR-01是正）

Checkpoint 9初期実装は`transitionSnapshotActivation()`のroot入力
（`current_record`/`snapshot_wrapper`/`new_status`/`updated_by`/`updated_at`/`history`）を
`captureOwnedObject()`で同期的にcaptureしていたが、これは`history`という**参照**を
captureしたに過ぎなかった。`history`配列自体・各要素・各要素のfield
（`dictionary_snapshot_id`/`snapshot_version`/`supersedes`/`rollback_target`）の実際の
読み取りは、`validateHistoryChain()`内部の`captureOwnedArray()`/`captureOwnedObject()`
呼び出しまで遅延しており、この呼び出しは`await loadValidatedSnapshot(...)`（実Snapshot
Loader呼び出し）の**後**に発生していた。これは独立レビューでMAJOR-01として指摘された。

**問題**: callerが`transitionSnapshotActivation(input)`呼び出し直後（Loaderのawaitが
pendingの間）に`input.history[0].snapshot_version`等を書き換えると、その書き換え後の
値でchain検証が行われてしまい、S25.8が要求する「call開始時点でのatomic capture・
caller mutation isolation・await後の再read禁止」に違反していた。

**是正内容**: `history`のstructural capture（hostile-input防御・format validation・
fresh representation生成）と、chain semantic validation（monotonicity・existence・
cycle detection）を明確に2つの関数へ分離した。

- `captureHistory(historyRaw)`: `transitionSnapshotActivation()`の同期phase内、
  `await loadValidatedSnapshot(...)`より**前**に呼び出す。`history === null`ならそのまま
  `null`を返す。非nullの場合、配列自体・各要素・各要素の4 fieldを、既存の安全
  descriptor読み取りprimitive（`readOwnDataProperty()`等、S25.8と同一のR1-1
  chokepoint）経由で**最大1回**読み取り、fresh・deeply-frozen・alias-freeな
  representationを返す。format検証（`SNAPSHOT_ID_RE`/safe integer/chain-ref format）も
  ここで行う（caller-owned生参照に触れる箇所はこの関数のみ）。
- `validateHistoryChain(capturedHistory, candidate)`: `captureHistory()`が返した
  representationのみを読む。caller所有の生`history`参照を一切読まない（間接的にも）。
  monotonicity・supersedes/rollback_target存在確認・循環検出は変更なし（S25.7の
  規則は据え置き）。`await`後に呼び出しても、既にcaptureされたデータしか参照しない
  ためTOCTOU窓を再度開かない。

`transitionSnapshotActivation()`本体では、`root.history`から`historyCaptured =
captureHistory(root.history)`を、`current_record`検証・`new_status`/transition
graph検証・`updated_by`/`updated_at`検証と同じ同期phase内（`await
loadValidatedSnapshot(...)`より前）で呼び出すよう変更した。以降このfunctionは
`root.history`を二度と読まず、`historyCaptured`のみを使用する（`await`を跨いでも
不変）。

**変更しないもの**: transition graph（`(no record)→ACTIVE`/`ACTIVE→SUPERSEDED`/
`ACTIVE→ROLLED_BACK`/`SUPERSEDED→ROLLED_BACK`、terminal status semantics）、
monotonicity/supersedes存在確認/rollback_target存在確認/cycle detectionの規則、
Project Pin schema、Snapshot Activation Record schema、`updated_at`/`updated_by`
契約、Snapshot Loader binding（S25.5、`snapshot_wrapper`自体は引き続きLoader自身の
atomic captureに委譲し、本coreで二重cloneしない）、no-latest semantics、privacy、
error sanitization方針（新規error codeなし、既存`ACTIVATION_HISTORY_INVALID`を
そのまま使用）は、いずれも一切変更しない。`captureHistory()`/`validateHistoryChain()`
はいずれも公開APIへ追加しない（引き続き`buildSnapshotActivationRecord`/
`transitionSnapshotActivation`/`buildProjectSnapshotPin`の3関数のみが公開API、
指示§7の「巨大なutility API群は公開しない」方針を維持）。

---

## S26. Checkpoint 10: Project Snapshot Pin → Matching Session Explicit Runtime Wiring

S25で確定した`private-dictionary-project-snapshot-pin/0.1`を、Checkpoint 7の
`PrivateDictionaryMatchingSession`へ明示的に接続するruntime boundaryを固定する。
対象は`tools/json_ab_trace_matching_tool_v12.1.15.html`のみ。Checkpoint 9
Activation coreおよびその他保護対象coreは変更しない。

### S26.1 責務

```text
Project Snapshot Pin（caller供給） + Snapshot Wrapper（caller供給）
        ↓
pre-bind formal Pin gate（Checkpoint 9 buildProjectSnapshotPin()を再利用し再検証）
        ↓
既存 setApprovedDictionarySnapshotForMatching()（Checkpoint 7、契約不変）
        ↓
post-bind exact binding一致確認
        ↓
matching session ready
```

Activation Recordはmatching selectorとして一切参照しない（S25.1/S25.4の原則を
継承）。latest/newest/max-version探索、project_idによるSnapshot探索、filesystem/
localStorage/sessionStorage/IndexedDB/network lookupのいずれも実装しない
（persistent storage/UI selectorはCheckpoint 10の対象外、後続Checkpoint）。

### S26.2 Public API（additive extension）

既存`PrivateDictionaryMatchingSession`（`setSnapshot`/`clearSnapshot`/`getStatus`）の
契約は一切変更しない。新規operationを1つだけ追加する:

```js
PrivateDictionaryMatchingSession.setProjectPin({ project_pin, snapshot_wrapper })
```

内部関数名: `setApprovedDictionaryProjectPinForMatching(input)`（既存命名規則
`setApprovedDictionary...ForMatching`を踏襲）。戻り値は成功時
`approvedDictionaryMatchingStatus()`と同一shape。失敗時は`{code}`のみのsanitized
errorをthrowする（既存`setSnapshot`が状態mutationで失敗を表現するのとは異なり、
S26.5のtransaction semantics上、pre-bind失敗は「状態遷移なし」を意味するため
throwで表現する方が自然であり、`getStatus()`is a独立した問い合わせ経路として
残る）。

### S26.3 Runtime input（探索なし、二入力必須）

`project_pin`と`snapshot_wrapper`は両方callerが明示的に供給する。Project Pinには
`dictionary_payload`が含まれない（S25.3）ため、Pin単体からSnapshotを復元・探索する
ことは構造的に不可能。本coreはfilesystem/localStorage/sessionStorage/IndexedDB/
network/GitHub/Activation Record参照によるSnapshot探索を一切行わない。

### S26.4 Pre-bind formal Pin gate

1. `input.project_pin`を同期的に安全capture（新設`capturePrivateDictionaryProjectPin()`、
   root形状 = 完全一致3 key、`schema_version`固定文字列一致、`project_id`
   非空・上限200文字、`snapshot_binding`はCheckpoint 7既存
   `captureApprovedDictBatchBinding()`（7-field format、無改変で再利用）。
2. `PrivateDictionarySnapshotActivationCore.buildProjectSnapshotPin({ project_id:
   capturedPin.project_id, snapshot_wrapper })`（Checkpoint 9、無改変）を呼び出し、
   実Snapshot Loaderで検証済みのformal Pinを**再生成**する。
3. caller供給Pin（step 1でcapture済み）とregenerated Pin（step 2の結果）を、
   `schema_version`/`project_id`/7-field bindingの全項目についてexact equality
   比較する（既存`approvedDictBindingsEqual()`を7-field比較に再利用）。1
   fieldでも不一致ならfail-closed（新規`APPROVED_DICT_PROJECT_PIN_MISMATCH`）。

これによりSnapshot/dictionary意味論の再実装を避ける — 実際の検証は常にCheckpoint 9
`buildProjectSnapshotPin()`経由の実Snapshot Loaderが行う。

### S26.5 Existing setSnapshot delegation / post-bind gate / transaction semantics

Pre-bind gateを通過した場合のみ、既存`setApprovedDictionarySnapshotForMatching(snapshot_wrapper)`
（Checkpoint 7、契約無変更）へ委譲する。formal Pin検証だけでsessionをactiveにしない
（Resolver-backed empty-batch Loader検証を必ず経由、S26.6参照）。

委譲成功後、`getStatus()`相当の戻り値`snapshotBinding`とPre-bind gateで検証済みの
Pin `snapshot_binding`が完全一致することを再確認する（post-bind gate）。不一致
（dependency drift等の理論上のケース）ならfail-closedし、`clearApprovedDictionarySnapshotForMatching()`
相当の操作で今回の部分commitをクリアする。

Transaction semantics（3ケース、恒久固定）:

```text
OLD ACTIVE --pre-bind failure--------------------> OLD ACTIVE unchanged
OLD ACTIVE --pre-bind success, setSnapshot success-> NEW ACTIVE
OLD ACTIVE --pre-bind success, setSnapshot/post-bind failure-> INACTIVE fail-closed
```

pre-bind失敗時は`approvedDictionaryRuntime`を一切mutateしない（revisionも進めない
— 「操作の試行」自体はsessionの意味論的commitmentではないため。§S26.8のrace
protectionとも整合する）。pre-bind成功後にsetSnapshot/post-bindのいずれかが
失敗した場合は、既存sessionを保持する選択肢を取らない（「無効なreplacement
要求のために有効なsessionを破壊しない」原則は、あくまでpre-bind段階でのみ適用
され、一度実際のbind処理へ進んだ後の失敗は明示的にinactiveへfail-closedする —
旧sessionのSnapshot wrapper参照を安全に保持したままrollbackする設計は複雑さに
見合わないため、Checkpoint 10では先取りしない）。

### S26.6 Snapshot Wrapper lifetime / caller alias isolation（最重要指摘への対処）

指示§20-22で指摘された通り、既存Checkpoint 7の`setApprovedDictionarySnapshotForMatching()`
は成功時にcaller供給`snapshotWrapper`の**生参照**をsession stateへ保持しており
（後続の実term解決呼び出し、L3722で再利用される）、Pin確立後にcallerが元の
wrapper objectをmutationすると、そのsessionが後続matchingで使用する意味内容が
変化しうるという問題があった。

**是正**: `setApprovedDictionarySnapshotForMatching()`内部に、caller供給
`snapshotWrapper`を関数の最初（Resolver呼び出しより前、同期的）で汎用構造capture
する処理を追加する。新設`captureApprovedDictSnapshotWrapperForSession()`は、
Adapter core（Checkpoint 8-R1）の`captureStructuralValue()`と同じ技法の独立コピー
（本ファイル独自実装）: `null`/文字列/真偽値/有限数値/安全なplain object/安全な
plain arrayのみを許容し、function/symbol/bigint/accessor/hostile Proxy/循環参照/
深さ超過を`APPROVED_DICT_RESOLUTION_FAILED`でfail-closedしつつ、fresh・
deep-frozen・alias-freeな複製を返す。**単純に`Object.freeze(生wrapper)`する
ことは行わない**（caller-owned objectを変更してはいけないため）。

以降、Resolver検証呼び出し・session state保存の両方でこの`capturedWrapper`
（生`snapshotWrapper`ではなく）を使用する。これにより、`setProjectPin`成功後に
callerが元の`snapshot_wrapper`をmutationしても、sessionが保持し後続matching
resolutionで使用する意味内容は一切変化しない。

この修正は`setApprovedDictionarySnapshotForMatching()`の**契約**
（引数shape・返り値shape・error code・Resolver-backed検証経路）を一切変更しない
内部実装の強化であり、既存Checkpoint 7 verification（215 PASS/0 FAIL）の
挙動には影響しない（有効なwrapperをcall後にmutationしないという既存test群の
前提は、この修正下でも従来通り成功する）。

Snapshot Loaderが返すvalidated handle（13 field、`wrapper_schema_version`を
含まない）をそのままResolver inputへ再利用できるとは仮定しない（S5.5参照、
Loaderのvalidated handleとwrapper自体はfield構成が異なる）。本coreはSnapshot
core/Resolver coreのhash/schema semanticsを一切再実装しない — 汎用構造capture
はJSON互換の値treeを意味非依存に複製するのみである。

### S26.7 Error contract

matching HTML既存の`APPROVED_DICT_ERROR_CODE_ALLOWLIST`（sanitized codeのみを
UI/statusへ出す既存原則、Checkpoint 7-R1）に、Project Pin専用の4 codeを追加する:

| code | 意味 |
|---|---|
| `APPROVED_DICT_PROJECT_PIN_INVALID` | `project_pin`のroot/schema/7-field bindingが形式的に不正 |
| `APPROVED_DICT_PROJECT_PIN_MISMATCH` | pre-bind: caller供給PinとSnapshot Loaderから再生成したformal Pinが不一致（Snapshot自体の検証失敗を含む） |
| `APPROVED_DICT_PROJECT_PIN_BIND_FAILED` | 既存`setSnapshot`委譲の失敗、またはrace検出によるabort |
| `APPROVED_DICT_PROJECT_PIN_POST_BIND_MISMATCH` | post-bind: session確立後のbindingがPinと不一致 |

既存4 code（`APPROVED_DICT_RESOLVER_UNAVAILABLE`/`APPROVED_DICT_RESOLUTION_FAILED`/
`APPROVED_DICT_BINDING_MISMATCH`/`APPROVED_DICT_SESSION_CHANGED`）は変更しない。
Activation core/Snapshot core内部codeの透過、native Error/message/stack/cause/
private dictionary term/filenameの漏洩は一切禁止（既存原則を継承）。

### S26.8 Atomic capture / race protection

`input.project_pin`は関数開始時点、最初の`await`（`buildProjectSnapshotPin()`呼び出し）
より前に完全captureする。以降`input`/`input.project_pin`を再readしない。

Race protection: 関数開始時に`revisionAtStart = approvedDictionaryRuntime.revision`を
同期capture。pre-bind gate通過後・既存`setSnapshot`委譲の直前に
`approvedDictionaryRuntime.revision !== revisionAtStart`を再確認し、変化していれば
（自身の非同期pre-bind検証中に別operationが既にsessionをcommit済みという意味）
`APPROVED_DICT_PROJECT_PIN_BIND_FAILED`でabortし、委譲を行わない（＝他operationの
新しいcommitmentを上書きしない）。既存`annotateAllTraceTags`の`revisionAtStart`
チェック（L3806/3896）と同じ設計思想を踏襲する。委譲呼び出し自体の内部await中に
発生する残余のrace windowは、既存`setSnapshot`自体の契約（無条件commit）を変更
できない制約下では完全には閉じられない ── この残余範囲は既存コードベースが
同種のrace（長時間実行中のmatching resolutionに対するrevisionチェック）に対して
採用している水準と同じ許容範囲として明記する。

### S26.9 No persistence / No UI selector

localStorage/sessionStorage/IndexedDB/filesystem/FileReader/Blob download/network/
project config file I/Oは一切実装しない。Snapshot選択ダイアログ・Project選択UI・
Activation管理UI・file picker・自動起動時loadも実装しない。Project Snapshot Pin
のpersistence adapterおよびUI selectorは後続Checkpointの対象。

### S26.10 Script dependency / load order

`private_dictionary_snapshot_activation_core.js`をformal browser dependencyとして
`<script src>`へ追加する。既存`private_dictionary_snapshot_core.js`（Activation
coreの唯一の依存）より後、Resolver core等の既存Checkpoint 3-6 scriptと同じ並びで
追加し、既存load orderを破壊しない。

### S26.11 Checkpoint 10-R1 追補: commit-instant race guard（MAJOR-01是正）

Checkpoint 10初期実装のS26.8 race guardは、`setApprovedDictionaryProjectPinForMatching()`
が`revisionAtStart`を関数開始時に同期captureし、**既存`setSnapshot()`委譲の直前で
一度だけ**再確認していた。しかし委譲先の既存`setApprovedDictionarySnapshotForMatching()`
自身は、その内部Resolver呼び出し（`terms:[]`のempty-batch検証）の`await`完了後、
staleness確認なしに無条件で`approvedDictionaryRuntime`へcommitしていた。このため、

1. operation Aが委譲直前のrevision確認を通過する
2. operation Aの委譲先（`setSnapshot`相当）内部でResolver呼び出しの`await`が
   pendingになっている間に、operation Bが独立にpre-bind〜bindまで完了し、先に
   commitする（revisionが進む）
3. operation Aの遅延していたResolver呼び出しが後から完了し、staleness再確認
   なしにそのままcommitしてしまい、Bの新しいcommitmentを上書きする

という競合が理論上・実際に成立し得た（独立レビューでMAJOR-01として指摘）。
S26.8が要求する「非同期operation completion orderによるstale commitを防ぐ」が、
委譲先関数自身の内部awaitをまたぐrace windowに対しては閉じられていなかった。

**是正内容**: 既存`setApprovedDictionarySnapshotForMatching(snapshotWrapper)`の
実装本体を、新設した内部helper`bindApprovedDictionarySnapshotForMatching(snapshotWrapper,
expectedRevision)`へ切り出した。

- `expectedRevision`が`undefined`の場合（`setSnapshot()`自身からの呼び出し、常に
  この形）、完了時に**無条件でcommitする** — Checkpoint 10-R1以前と完全に同一の
  挙動であり、`setSnapshot()`の公開契約（引数shape・返り値shape・error code・
  Resolver-backed検証経路）は一切変更しない。
- `expectedRevision`が明示的に渡された場合（`setApprovedDictionaryProjectPinForMatching()`
  からの呼び出しのみ）、成功・失敗いずれのcommit分岐の**直前**
  （`approvedDictionaryRuntime`への代入の直前、間に`await`を挟まない同期地点）で
  `approvedDictionaryRuntime.revision !== expectedRevision`を再確認する。不一致
  なら`approvedDictionaryRuntime`へ一切書き込まず`{ stale: true }`を返す。この
  再確認は「委譲先関数自身のResolver `await`が完了した直後」に行われるため、
  S26.8が閉じられなかったrace windowを正しく検出できる。

`setApprovedDictionaryProjectPinForMatching()`は、委譲直前の高速fail（既存の
`revisionAtStart`比較、無駄なResolver往復を避けるための早期チェック、維持）に
加えて、`bindApprovedDictionarySnapshotForMatching(rawSnapshotWrapper,
revisionAtStart)`という形で同じtokenを委譲先へ渡すよう変更した。委譲結果が
`{ stale: true }`の場合は`APPROVED_DICT_PROJECT_PIN_BIND_FAILED`でfail-closedし、
`approvedDictionaryRuntime`には一切触れない（＝他operationの新しいcommitmentを
上書きしない）。

**変更しないもの**: transition graph・pre-bind formal Pin gate・post-bind gate・
error code一覧（新規codeは追加せず、既存`APPROVED_DICT_PROJECT_PIN_BIND_FAILED`を
再利用）・`clearSnapshot()`契約・Activation Record非依存の原則・no-latest原則・
persistence境界・`setSnapshot()`の公開契約は、いずれも一切変更しない。R1は
commit-instant race guardの追加のみに限定される。

---

## S27. Checkpoint 11: Project Snapshot Pin Persistence Artifact / Storage-Neutral Codec

S25で確定した`private-dictionary-project-snapshot-pin/0.1`を、プロセス終了後も
安全に持ち越せるstorage-neutral artifact boundaryとして固定する。対象は新規
pure core 1本（`tools/knowledge_builder/core/private_dictionary_project_snapshot_pin_persistence_core.js`）
のみ。既存core・Checkpoint 10 matching tool HTMLはいずれも変更しない。

### S27.1 責務分離

```text
formal Project Snapshot Pin semantics（Checkpoint 9、無変更）
        ↕ 別責務
storage technology（未実装、後続Checkpoint）
        ↕ 別責務
Checkpoint 11: canonical serialization / strict parsing / structural
               validation / formal Pinへのrebinding / tamper detection
```

Checkpoint 11 pure coreが行うのはcanonical serialization・strict load・
structural validation・formal Pinとのbinding再検証・tamper detection・
fresh/frozen出力のみ。filesystem/localStorage/sessionStorage/IndexedDB/
network/GitHub/database/browser download/OS path/自動起動時loadは一切
実装しない（S26.9と同じ境界をPersistence artifactにも適用）。

### S27.2 Persistence Artifact 0.1 schema

schema: `private-dictionary-project-snapshot-pin-persistence/0.1`

```json
{
  "artifact_schema_version": "private-dictionary-project-snapshot-pin-persistence/0.1",
  "project_pin": {
    "schema_version": "private-dictionary-project-snapshot-pin/0.1",
    "project_id": "<caller supplied opaque non-empty identifier, ≤200文字>",
    "snapshot_binding": {
      "snapshot_id": "dsnap-<hex32>",
      "snapshot_version": 1,
      "wrapper_integrity_sha256": "<hex64>",
      "dictionary_payload_sha256": "<hex64>",
      "dictionary_id": "pdict-<hex32>",
      "dictionary_version": "<decimal string>",
      "scope": "PROJECT"
    }
  }
}
```

Project Snapshot Pin（S25.3）をそのままthin envelopeへ包むのみで、独自形式への
変形・追加metadataは一切持たない。`dictionary_payload`・`effective_vocabulary`・
`entries`等のSnapshot本文、およびSnapshot Wrapperそのものは絶対に含めない
（S27.9）。

### S27.3 Public API

```js
async function serializeProjectSnapshotPin({ project_pin, snapshot_wrapper })
// -> string（canonical JSON、決定論的）

async function loadProjectSnapshotPin({ serialized, snapshot_wrapper })
// -> private-dictionary-project-snapshot-pin/0.1 formal Pin（fresh・frozen）
```

公開APIはこの2関数のみ。中間・専用のPersistence専用object型はruntimeへ渡さない
（S27.8）。

### S27.4 Canonicalization（決定論的serialization）

新規canonical JSON実装は行わない。既存`KnowledgeIdHashUtils.canonicalJson()`
（`tools/quantity_sidecar_binding_core.js`のkey-sort再帰実装、Promotion/Snapshot/
Adapter/Activation各coreが自身のidentity計算に既に使っている共通primitive）を
そのまま再利用する。これにより、同一Pinのserializeは常にbyte-for-byte同一
出力になり、property insertion順序が異なる論理的に等価な入力からも同一output
が得られる（`canonicalJson`が`Object.keys().sort()`で再帰的にkeyをordinal順
整列するため）。

### S27.5 Strict parsing / duplicate-key policy

`JSON.parse()`は`{"a":1,"a":2}`のようなduplicate keyを黙って後勝ちで受理して
しまうため、load境界のstrict/reproducible性を担保できない。指示§18の選択肢A
（duplicate keyを検出できるstrict parser）を採用する。

本artifactのgrammarは小さく（最大3階層のplain object、array・巨大な自由形式
文字列を含まない）、汎用JSON5/コメント/trailing comma対応の大規模parserは
不要なため、**標準JSON grammarのみを受理する専用recursive-descent parser**
（`strictJsonParseForPersistenceArtifact()`）をこのcore内に独立実装する。

- objectの各key出現をobjectごとに独立した`Set`で追跡し、同一object内で
  同じkeyが2回出現した時点でreject（`PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID`）。
  ネストしたobject間（例: `project_pin`と`snapshot_binding`）では互いに
  独立してkey追跡するため、異なる階層で同名keyが出現しても誤検出しない。
- 受理するのは標準JSON grammar（object/string/number/true/false/null。
  array parsingもgrammar完全性のため実装するが、本artifactの正常な内容には
  一切出現しない）のみ。comment・trailing comma・`NaN`/`Infinity`/`undefined`/
  BigInt・単一引用符文字列はいずれも構文エラーとしてreject。
- object key書き込みは`__proto__`/`prototype`/`constructor`を明示的に
  rejectしてから行う（prototype pollution防止、既存4+ coreと同じ規律）。

### S27.6 Size limit

64 KiB（65536 byte、UTF-8）をserialized入力の上限とする。正常なformal Pin
（project_id最大200文字 + 7-field binding）は数百byte程度に収まるため、
十分な余裕を確保しつつDoS的な巨大入力を`PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID`
でfail-closedする。チェックはparse着手前（文字列長・UTF-8 byte数の計測のみ）
に行う。

### S27.7 Formal Pin rebinding（Source of Truthの一本化）

serialize/loadいずれも、caller供給Pinをそのまま信用しない。両方とも:

1. caller供給`project_pin`（serialize）または保存artifact内`project_pin`
   （load）をformat検証のうえcapture。
2. `PrivateDictionarySnapshotActivationCore.buildProjectSnapshotPin({
   project_id: capturedPin.project_id, snapshot_wrapper })`
   （Checkpoint 9、無改変）を呼び出し、実Snapshot Loader経由でformal Pinを
   **再生成**する。
3. captureしたPinと再生成Pinを、`schema_version`/`project_id`/7-field
   binding全項目についてexact equality比較する。1 fieldでも不一致なら
   `PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH`でfail-closed。

serializeは「invalid/tamperedなPinを正式なPersistence Artifactとして書き出さない」
ことを、loadは「保存後に改ざんされたartifactを正式なPinとして受理しない」こと
を、同じ再生成・比較ロジックで担保する。Snapshot/dictionary意味論はこのcore
内で一切再実装しない — 実Loaderが常にSource of Truthである。

load成功時に返す値は、この再生成ステップで得られた`regeneratedPin`
（Activation core自身が既にfresh・frozen・alias-freeに構築した値）をそのまま
返す。Persistence core独自の複製・再構築は行わない（S27.8）。

### S27.8 Fresh / frozen / no runtime auto-bind

load結果はActivation coreの`buildProjectSnapshotPin()`が返す値そのもの
（既にfresh・deep-frozen・alias-free、S25.3の保証をそのまま継承）。
Persistence core独自の中間表現をruntimeへ渡すことはしない。

`loadProjectSnapshotPin()`の成功だけで、Checkpoint 10
`PrivateDictionaryMatchingSession.setProjectPin()`を自動的に呼び出すことは
しない。runtime bindingは常にcaller（呼び出し側）が明示的に行う
（本coreはpureで、matching runtimeへの依存を一切持たない）。

### S27.9 Privacy / No Snapshot payload

Persistence Artifactへ含めてよいのは、artifact schema version・
project_id・snapshot identity（ID/hash/version/scope）のみ。
`dictionary_payload`・`effective_vocabulary`・`entries`・`canonical_term`・
`alias_term`・`original_term`・review note・evidence・source excerpt・
workbook filenameは一切含めない。Snapshot Wrapper自体もPersistence Artifact
へ埋め込まない（Project Pin persistenceとSnapshot artifact persistenceは
別責務のまま）。

### S27.10 Activation非依存 / Cross-Snapshot mismatch

Activation Record（`activation_status`/ACTIVE/SUPERSEDED/ROLLED_BACK）は
serialize/loadいずれの条件にもしない（S25.1/S25.4/S26の原則を継承）。
保存されたPin Aに対し、callerが異なるSnapshot Bを渡してloadした場合、
BがAより新しいversionであっても、Bのdictionary_idが一致していても、Activation
状態がACTIVEであっても、S27.7のexact equality比較により必ずreject する
（latest/newest/max-version探索は一切行わない）。

### S27.11 Atomic capture / mutation isolation

`project_pin`（serialize）は最初の`await`（`buildProjectSnapshotPin()`呼び出し）
より前に、既存4+ coreと同じ独立実装のR1-1 chokepoint関数群
（`captureOwnedObject`等、single-read・hostile Proxy対応）で完全captureする。
以降caller供給`project_pin`を再readしない。`snapshot_wrapper`はCheckpoint 9
`buildProjectSnapshotPin()`/実Snapshot Loader自身のatomic captureに委譲し、
本coreで二重cloneしない（S25.5/S26.6と同じ方針）。`serialized`
（load入力）は文字列primitiveであり、JS文字列は不変のため、一度読み取れば
以降のmutationを気にする必要がない。

### S27.12 Error contract

専用namespace（6種、design-firstで固定）:

| code | 意味 |
|---|---|
| `PROJECT_PIN_PERSISTENCE_ROOT_INVALID` | serialize/load呼び出しのinput root形状が不正 |
| `PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID` | `serialized`が文字列でない、malformed JSON、duplicate key、oversized |
| `PROJECT_PIN_PERSISTENCE_PIN_INVALID` | Pin/snapshot_bindingの構造・format不正（key不足・余剰・primitive format違反） |
| `PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH` | captured/storedPinと実Loader再生成Pinの不一致 |
| `PROJECT_PIN_PERSISTENCE_SNAPSHOT_INVALID` | `buildProjectSnapshotPin()`/実Snapshot Loaderの検証失敗 |
| `PROJECT_PIN_PERSISTENCE_DEPENDENCY_FAILED` | `PrivateDictionarySnapshotActivationCore`依存解決の失敗 |

外部へ返すのは常に`{code, path}`のみ。native Error/message/stack/cause/
serialized private data/filename/filesystem path/dictionary termは一切
含めない。

### S27.13 Non-goals（本Checkpoint）

localStorage/sessionStorage/IndexedDB/FileReader/Blob/`URL.createObjectURL`/
filesystem/network/GitHub API/database実装は行わない。Checkpoint 10 matching
tool HTMLの変更は行わない（interoperability検証はverification側でHTMLを
読み込んで実施）。HUMAN-01/02/03のUI適用は行わない。

### S27.14 Checkpoint 11-R1 追補: project_id tamper遮断（MAJOR-01是正）

独立レビューで、`project_id`単体の改ざんを検出できない設計になっている点を
MAJOR-01として指摘された。原因: `project_id`はPin内で唯一、Snapshot自身が
証明できないopaque caller-supplied identifierであり（S25.3）、
`buildProjectSnapshotPin()`はcaller供給`project_id`をそのままformal Pinへ
反映するため、保存artifact内の`project_id`をA→Bへ書き換えても、Bを使って
Source of Truthが再生成され、S27.7のexact equality比較が「成功」してしまう
（Snapshot binding側の7 fieldは実Loaderという独立したSource of Truthを持つが、
project_idにはそれが存在しないため、同じ再生成・比較ロジックでは
tamper detectionにならない）。

是正: `project_id`のSource of TruthをPersistence Artifact自身ではなく
**caller側（呼び出し時点でのproject configuration/呼び出しコンテキスト）**
に置く。両公開関数に必須引数`expected_project_id`を追加した:

```js
async function serializeProjectSnapshotPin({ project_pin, snapshot_wrapper, expected_project_id })
async function loadProjectSnapshotPin({ serialized, snapshot_wrapper, expected_project_id })
```

- `expected_project_id`は他の入力と同じcaptureOwnedObject経路（root key必須、
  欠落時は`undefined`captureされ、後続のformat検証で必ず`PROJECT_PIN_
  PERSISTENCE_ROOT_INVALID`としてfail-closedする既存の"欠落key→undefined、
  format検証が唯一のreject箇所"という規律を継続）で受け取る。
- capture済みPin（serialize）/保存Pin（load）の`project_id`と
  `expected_project_id`のexact equalityを、**S27.7 Snapshot rebinding
  （`buildProjectSnapshotPin()`呼び出し・実Loaderへの`await`）より前**に
  検証する。不一致は`PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH`
  （path: `$.expected_project_id`）でfail-closedし、Snapshot Loaderへは
  一切到達しない。既存の7-field binding equality比較（S27.7）は変更せず、
  project identity検証は独立した先行ゲートとして追加した。
- 新しいerror codeは追加していない（既存6種のまま）。project identity
  不一致とSnapshot identity不一致は、いずれも「このartifactはcallerが
  期待するidentityを指していない」という同種の失敗として
  `PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH`に統合した。
- 効果: 保存artifact内の`project_id`をA→Bへ書き換えても、caller側が
  `expected_project_id: "A"`を指定し続ける限り必ずreject される。
  Bとしてloadを成功させるには、caller自身が`expected_project_id: "B"`を
  明示的に渡す必要がある - この場合はcaller自身が「B用としてload/serialize
  したい」と明示的に宣言したことになり、それはtamperではなくcallerの
  正当な入力である（project_idはこの層では引き続きcaller-assertedな
  opaque identifierのままであり、それ自体を暗号学的に証明する仕組みは
  本Checkpointの対象外）。
- Snapshot binding側のtamper detection（S27.7、7 fields）・cross-Snapshot
  mismatch（S27.10）・atomic capture（S27.11）・privacy（S27.9）・
  Activation非依存（S27.10）・storage技術の非実装（S27.1/S27.13）は
  いずれも無変更。

verification側は、旧AH（「project_id改ざんはexpected behaviorとしてload
成功する」）を「`expected_project_id`不一致時は改ざんをrejectする」検証へ
置き換え、以下のR1項目を追加した: stored project_id改ざん→reject /
`expected_project_id`一致→load成功 / `expected_project_id`不一致→
sanitized failure / project_id不一致時はSnapshot Loaderまで進まない
（実Loaderに到達する前にreject、副作用なし）/ Snapshot bindingが正しくても
project identity不一致ならreject / Checkpoint 10 `setProjectPin()`へ渡す
loaded Pinの`project_id`がcaller期待値と一致することの確認 /
`expected_project_id`欠落時のROOT_INVALID。

## S29. Checkpoint 12: Project Snapshot Pin Browser File Adapter / Explicit Save-Load Flow

Checkpoint 11のstorage-neutral persistence codec（S27、無変更）を、ブラウザ上で
明示的にfile保存・file読込するUser Flowへ接続する。対象はmatching tool HTML
（`tools/json_ab_trace_matching_tool_v12.1.15.html`）への追加のみ。Checkpoint 11
pure core・Checkpoint 10 runtime API（`setSnapshot`/`setProjectPin`/
`clearSnapshot`/`getStatus`の契約）はいずれも無変更。

### S29.1 責務分離（3層）

```text
A. File I/O                 (Blob / URL.createObjectURL / <a download> /
                              File.text() - 本HTML内、既存downloadText()を再利用)
        ↕ 別責務
B. Persistence validation    (Checkpoint 11 serializeProjectSnapshotPin() /
                              loadProjectSnapshotPin() - 無改変、意味論の
                              再実装なし)
        ↕ 別責務
C. Runtime bind               (Checkpoint 10 PrivateDictionaryMatchingSession.
                              setProjectPin() - 無改変。明示Apply操作からのみ
                              呼ばれる)
```

File選択（Load）だけではCへは一切進まない。B（validated Pin）で止まり、
Cへ進むのはユーザーの明示Apply操作のみ（S29.4）。

### S29.2 Save flow

Source of Truthは常にCheckpoint 11 `serializeProjectSnapshotPin()`。UI側では
独自JSON.stringifyでのartifact生成・Pin schema再構築・Snapshot binding再計算・
hash再計算のいずれも行わない。

```text
[UI] Project ID入力（expected_project_id、テキスト入力、fileから読み取らない）
        +
[Runtime] 現在アクティブな照合セッションのSnapshot Wrapper
        （approvedDictionaryRuntime.snapshotWrapper - ユーザーが以前
          setSnapshot/setProjectPinで明示的に設定した「現在の」Snapshot。
          "latest"/ACTIVE検索ではなく、単に現在の照合セッションの状態を
          そのままsaveする、という意味の明示ソース）
        ↓
[Checkpoint 9] buildProjectSnapshotPin({project_id: expected_project_id,
                                          snapshot_wrapper}) （無改変、
                既存approvedDictProjectPinActivationCore()を再利用）
        ↓ formal Pin
[Checkpoint 11] serializeProjectSnapshotPin({project_pin, snapshot_wrapper,
                                               expected_project_id}) （無改変）
        ↓ canonical serialized string
[UI] downloadText()（本HTML既存ヘルパー、Blob/URL.createObjectURL/<a download>）
```

現在の照合セッションが非activeの場合（`approvedDictionaryRuntime.active ===
false`）、Save操作自体を不可とする（Snapshot源がないため）。この設計判断は、
Checkpoint 12がSnapshot file adapterを新設しない（scope外）という制約下での
唯一の現実的なSnapshot Wrapper供給源が「現在アクティブな照合セッション自身」
であることに基づく - これはlatest/ACTIVE検索ではなく、ユーザー自身が既に
明示的に選択済みの状態を再利用するだけである。

### S29.3 Load flow

```text
[UI] ユーザーが1個のfileを選択（<input type=file>）
        ↓
[UI] File.text()（native、UI側でJSON.parseしない）
        ↓ serialized string
[Checkpoint 11] loadProjectSnapshotPin({serialized, snapshot_wrapper,
                                          expected_project_id}) （無改変）
        ↓ validated formal Pin（fresh/frozen、Activation coreがgenerateした
          そのままの値）
[UI] projectPinFileUiState.validatedProjectPin へ格納
        （Runtimeへは進まない。S29.4の明示Apply待ち）
```

`expected_project_id`はUI側のProject ID入力欄（S29.2と同一入力）から供給し、
fileの`project_id`内容から自動設定しない（Checkpoint 11-R1、S27.14の
trust boundaryを継続）。`snapshot_wrapper`は現在アクティブな照合セッションの
Snapshot Wrapper（S29.2と同一ソース）。いずれもfile内容からの自動探索・
latest探索・Activation Record探索は行わない。

### S29.4 Explicit Apply flow（no auto-bind）

file load成功（validated Pin保有）は、それだけではRuntimeへ一切影響しない。
`PrivateDictionaryMatchingSession.setProjectPin()`（Checkpoint 10、無改変）は
ユーザーが明示的に「照合セッションに適用」ボタンを押した場合のみ呼ばれる。

```text
[UI] 「照合セッションに適用」ボタンクリック
        ↓
validatedProjectPin（load済み）+ 現在の照合セッションのSnapshot Wrapper
   （Apply時点で再取得 - Loadした時点のWrapperをキャッシュして使い回さない）
        ↓
[Checkpoint 10] PrivateDictionaryMatchingSession.setProjectPin({project_pin,
                 snapshot_wrapper}) （無改変 - pre-bind gate/post-bind gate/
                 commit-instant race guardをそのまま再利用）
        ↓
status（active/snapshotBinding） または sanitized error
```

Apply時にCheckpoint 10が改めてformal bindingを検証する（S29.7の再検証）ため、
UI側はload済みPinを無条件にsessionへcommitしない。

### S29.5 async race protection（UI層、Checkpoint 10自身のrace guardとは別）

UI状態`projectPinFileUiState`は単調増加する`generation`カウンタを持つ。
以下いずれかが発生すると`generation`をインクリメントする:

- 新しいfile load操作の開始
- Project ID（expected_project_id）入力欄の変更

Load操作は開始時に`myGeneration`/`expectedProjectIdAtStart`を捕獲し、
Checkpoint 11 `loadProjectSnapshotPin()`のawait完了後、以下のいずれかが
真なら**結果を`projectPinFileUiState`へ一切commitしない**（成功・失敗いずれの
表示も更新しない、サイレントに破棄）:

- `projectPinFileUiState.generation !== myGeneration`（別のfile選択操作が
  後から開始された - File A/Bのrace、§32相当）
- 現在のProject ID入力値が`expectedProjectIdAtStart`と異なる（load中に
  project contextが変わった、§33相当）
- `approvedDictionaryRuntime.revision`がload開始時の値と異なる（load中に
  現在のSnapshotが変わった、§34相当。Checkpoint 10が既に持つ
  revisionカウンタをそのまま再利用し、独自の類似カウンタを新設しない）

「最後に開始されたfile選択操作が勝つ」（latest **explicit file-selection**
operation wins）であり、Snapshotの"latest version"選択とは無関係。

Apply操作も、開始時の`projectPinFileUiState.generation`を捕獲し、
Checkpoint 10 `setProjectPin()`のawait完了後に`generation`が変わっていれば
（Apply中に新しいfileがloadされた）、その完了結果を`APPLIED`として
commitしない（新しいfileのUI状態を古いApplyの結果で上書きしない）。
ただしsession自体のcommit可否はCheckpoint 10自身のcommit-instant race guard
（Checkpoint 10-R1、無変更）が排他的に決定する - UI層のgeneration破棄は
「表示の使い回し」を防ぐだけで、Checkpoint 10のsession-levelの正しさには
一切関与しない。

### S29.6 stale state表示（Snapshot/Project変更時、S18/S19相当）

load成功後、Apply前にSnapshotまたはProject IDが変更された場合:

- `projectPinFileUiState`自体は破棄しない（保持したまま）
- 表示上「stale」（現在の設定と一致しない）と明示する
  （`loadedExpectedProjectId !== 現在のProject ID` または
  `!approvedDictBindingsEqual(loadedSnapshotBinding, 現在のsnapshotBinding)`
  - 両関数ともCheckpoint 10の既存比較ロジックを再利用）
- Apply操作自体はUI側で無効化される（ボタンdisabled）だけでなく、たとえ
  実行されてもCheckpoint 10 `setProjectPin()`自身のformal binding比較で
  必ずrejectされる（S29.4の再検証、二重防御）

silent rebinding（loaded Pinを新Snapshotへ黙って追随させる）は行わない。

### S29.7 Apply前の再検証（Checkpoint 10への委譲）

Apply操作は、load済みPinを信用してsessionへ直接commitしない。必ず
Checkpoint 10 `setProjectPin()`を経由し、Checkpoint 10自身がformal Pin
regeneration + exact equality比較を再度行う。Load時点からApply時点までの
任意の時間経過・状態変化に対し、最終的な正しさの保証はCheckpoint 10の
既存gate（pre-bind/post-bind/commit-instant race guard）が担う。

### S29.8 file形式・size

- 保存形式: UTF-8 JSON text（Checkpoint 11の`serializeProjectSnapshotPin()`
  出力そのまま）。MIME: `application/json`。
- 拡張子: `.json`を推奨するが、`accept=".json,application/json"`は
  ブラウザ側のUI-levelな絞り込みに過ぎず、意味validationの一部ではない。
  拡張子が異なっていてもCheckpoint 11 codecが受理すれば読み込める
  （拡張子はsecurity boundaryではない、§12の指示どおり）。
- filename: UX目的のmetadataであり、formal identityではない。
  `private_dictionary_project_pin_<sanitized-project-id>.json`
  （project_idを`[^A-Za-z0-9_-]`除去・80文字までtruncate）を推奨形式とし、
  project_idが得られない場合は固定名`private_dictionary_project_snapshot_pin.json`
  にfallbackする。load時、filenameからproject_id/snapshot_idを復元・信用
  しない（`sourceFileName`はdisplay onlyでformal Pinへは一切含めない、S29.9）。
- size: UI側で`File.size > 65536`ならfast rejectする（Checkpoint 11自身の
  64 KiB上限、S27.6と同じ値で二重境界を作る。UI側のfast rejectは
  Checkpoint 11自身のvalidationを省略する目的ではなく、単なる早期UXの
  ためのfront gateであり、Checkpoint 11自身のsize/strict parse/duplicate-key
  検証は常にそのまま呼ばれる）。

### S29.9 UI保持state

load成功時にUI側が保持するのは最小限:

```js
{
  generation, status,            // 'NOT_LOADED' | 'VALIDATED' | 'INVALID' | 'APPLIED'
  validatedProjectPin,           // Checkpoint 11 load()の戻り値そのもの（再構築しない）
  sourceFileName,                // display only。formal Pinへは追加しない
  loadedSnapshotBinding,         // stale判定用（S29.6）。Checkpoint 11 Pinの
                                  // snapshot_bindingそのもの
  loadedExpectedProjectId,       // stale判定用（S29.6）
  lastErrorCode                  // sanitizedコードのみ
}
```

raw serialized text（file内容そのもの）はload処理完了後、長期保持しない
（一時変数としてのみ使用し、UI stateへは格納しない）。

### S29.10 startup挙動

tool起動時、`projectPinFileUiState`は`{generation:0, status:'NOT_LOADED',
validatedProjectPin:null, ...}`で初期化する。前回file・前回project・前回
Snapshotの自動loadは一切行わない。localStorage/sessionStorage/IndexedDBは
使用しない（今回のpersistent mediumはuser-explicit fileのみ、S26.9/S27.1の
方針を継続）。

### S29.11 privacy / error表示

Checkpoint 11/10が投げる`{code, path}`はそのままUIへ出さず、専用の
sanitized allowlist経由でuser-facing日本語メッセージへ変換する
（未知コードは汎用メッセージへfallback、既存`approvedDictSanitizeErrorCode()`
と同じ規律）。UI状態へ出してよいのは`project_id`/`snapshot_id`/
`snapshot_version`/`dictionary_id`/`dictionary_version`/`scope`/
sanitized error categoryのみ。dictionary canonical term/alias term/
raw artifact text/Snapshot payload/native Error.message/stack/
filesystem pathは一切出さない。

### S29.12 UI status model

`未読込` → `Pinファイル検証済み`（stale表示ありうる） → `Session適用済み`
の3状態を明確に区別する。「fileを読み込んだ」ことと「照合セッションへ
適用済み」を混同しない表示文言とする。

### S29.13 Activation非依存 / no-latest（継続）

Activation Record（ACTIVE/SUPERSEDED/ROLLED_BACK）はCheckpoint 12でも
matching selectorとして一切使わない。Snapshotの"latest"/"newest"探索も
行わない（現在アクティブな照合セッションのSnapshotをそのまま使うのみ）。

### S29.14 Comparison semantics / Unknown-Conflict非変更

score式・approvedDict bonus・AUTO ACCEPT・comparison review・tag priority・
Resolver semantics・UNKNOWN_TERM/DICTIONARY_CONFLICTのmatching継続挙動は
一切変更しない。Checkpoint 12はconfiguration I/Oのみ。

### S29.15 P2-A4 Exit Criteria棚卸し

**CLOSED:**
- P2-A1 provenance（Knowledge Data Contract 0.1 core）
- Snapshot（Checkpoint 3〜3-R系）
- Promotion（Checkpoint 4系）
- Composition（Checkpoint 5系）
- Resolver（Checkpoint 6系）
- Matching Integration（Checkpoint 7系）
- Review → Promotion Adapter
- Activation / Project Pin（Checkpoint 9・9-R1）
- Project Pin Runtime（Checkpoint 10・10-R1）
- Project Pin Persistence Codec（Checkpoint 11・11-R1）

**Checkpoint 12（本Checkpoint）:**
- explicit browser file save/load/apply flow（Project Snapshot Pin）

**Remaining（未着手、後続Checkpointへ）:**

| 項目 | 分類 |
|---|---|
| provenance display/export（Knowledge Graph側のUI表示・エクスポート） | MUST-CLOSE |
| HUMAN-01/02/03 UI convergence（P2-A3既存UI全体の文言・表示規約統一） | MUST-CLOSE |
| end-to-end integrated acceptance / clean regression（全Checkpoint通しのE2E受入） | MUST-CLOSE |
| privacy/regression closure（最終的な横断privacy監査） | MUST-CLOSE |
| unknown/conflict maintenance queue persistence（UNKNOWN_TERM/DICTIONARY_CONFLICTの永続queue化） | FUTURE SLICE |
| STANDARD/DOMAIN/SESSION layers（辞書layer階層の完全実装） | FUTURE SLICE |

### S29.16 Scope triage根拠

MUST-CLOSEとした項目は、いずれもP2-A4のスコープ内で既に部分的に実装済みの
機能（provenance fieldはSnapshot/Pin schemaに既に存在、UI文言はCheckpoint 12
自身が新規追加分について先行対応済み、regressionは各Checkpointで継続実施済み）
の「仕上げ」であり、新規アーキテクチャ層の追加を伴わない。

FUTURE SLICEとした2項目は、既存designで意図的に「本Checkpointの対象外
（non-goal）」と明記され続けてきた新規機能（S25.13「latest/newest選択は
一切行わない」という設計原則そのものと矛盾しうる永続queueや、S25で
「STANDARD/DOMAIN/SESSION層は本Checkpointでは実装しない」と明記された
multi-layer機構）であり、既存designとの矛盾はない。

### S29.17 Checkpoint 12-R1 追補: Apply pre-gateの欠落（MAJOR-01是正）

独立レビューで、`applyLoadedProjectSnapshotPinToMatchingSession()`が
Project ID変更後のstale Pinを遮断できていない点をMAJOR-01として指摘された。

原因: Checkpoint 10 `setProjectPin()`はPinとSnapshotのformal binding整合性
のみを検証し、「Checkpoint 12 UIが現在どのProject IDを選択しているか」を
一切知らない。そのため、load後にUI側のProject ID入力だけが変更され
Snapshotが変わらない場合、`isProjectPinFileLoadedPinStale()`はstaleと
正しく判定してApplyボタンをdisabledにするが、Apply本体
（`applyLoadedProjectSnapshotPinToMatchingSession()`）自体にはこの
staleness checkが存在せず、ボタンのdisabled状態を経由せず直接呼び出された
場合（診断hook・将来の別UI経路等）、load時のPin（古いProject ID向け）が
現在のSnapshotとの整合性だけでCheckpoint 10を通過してしまいうる。

是正: `applyLoadedProjectSnapshotPinToMatchingSession()`本体の先頭、
Checkpoint 10 `setProjectPin()`を呼ぶより前に、`isProjectPinFileLoadedPinStale()`
と同じ判定基準（loaded Pinの`project_id`/`loadedExpectedProjectId`が現在の
UI Project ID入力と一致するか、`loadedSnapshotBinding`が現在の
`approvedDictionaryRuntime.snapshotBinding`と一致するか - 既存
`approvedDictBindingsEqual()`を再利用）による同期的なfail-closed pre-gateを
追加した。不一致の場合、既存`PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH`
コードで即座にreject し、Checkpoint 10 `setProjectPin()`へは一切到達しない
（新しいerror codeは追加していない）。

これにより、staleと判定される条件は「UI表示の可否」と「Apply本体の可否」の
両方で完全に同一の基準（project_id一致 + Snapshot binding一致）を共有する
ようになり、ボタンのdisabled状態を迂回して直接呼び出しても同じ結果になる。
Checkpoint 10自身のformal binding検証（Snapshot mismatch検出）は既存のまま
維持しており、pre-gateはそれを置き換えるものではなく、Project ID変更という
Checkpoint 10の関知しない軸を追加でfail-closedするものである。

verification側は、旧項目R（「現在のProject IDでApply成功」という誤った
期待）を「Project ID変更後の直接Applyはpre-gateでreject」へ修正し、以下の
R1項目を追加した: Project A load→UI Project Bへ変更→直接Apply→
ok:false（BINDING_MISMATCH）/ 直接Apply時もCheckpoint 10 `setProjectPin()`
が一切呼ばれないことの確認（呼び出し検知） / Project ID変更だけでは
session revision/stateが不変であることの確認 / Snapshot変更後の直接Apply
もpre-gateでreject（Checkpoint 10へ到達する前に判定） / stale状態では
Applyボタンがdisabledであることの確認 / 診断hookから直接呼び出しても
rejectされることの確認 / 現在のProject ID・Snapshotがloaded Pinと一致する
場合は従来どおりApply成功することの確認（回帰）。

## S30. Checkpoint 13: Approved Dictionary Resolution Provenance Projection

Checkpoint 7で照合時に生成済みの`row._approvedDictResolution`（non-enumerable
row sidecar、無変更）を唯一のSource of Truthとして、照合結果一覧/Detail・
Knowledge Graph・Excel exportへDictionary Resolution provenanceを表示・
出力する。本Checkpointは表示専用projectionであり、Dictionary Resolverの
再実行・matching scoreの変更・comparisonの再生成はいずれも行わない。

### S30.1 Provenance Source of Truth

`row._approvedDictResolution`（`applyApprovedDictionaryTags()`が
`setHiddenRowProp()`で設定済み、Checkpoint 7/7-R1〜R4、無変更）のみ。

```
{
  schema_version: 'private-dictionary-row-resolution-sidecar/0.1',
  snapshot_binding: { snapshot_id, snapshot_version, wrapper_integrity_sha256,
                       dictionary_payload_sha256, dictionary_id,
                       dictionary_version, scope },   // APPROVED_DICT_BINDING_FIELDS、無変更
  annotations: [ { original_term, resolved_canonical, resolution_type,
                    dictionary_entry_id, dictionary_snapshot_id,
                    wrapper_integrity_sha256, scope, status }, ... ]
                    // APPROVED_DICT_ANNOTATION_FIELDS（8 field）、無変更
}
```

annotationに「どのJSON fieldから抽出したか（source field）」は
Checkpoint 7の正式contractに存在しない（`approvedDictionaryTermsForRow()`は
term文字列のみをResolverへ渡し、由来fieldを`termEntries`/annotationいずれ
にも保持しない）。指示§8は「検討してください」であり必須ではないため、
存在しないfieldを新規生成しない原則（§6/指示§8末尾）により、Checkpoint 13
のprojection/Excelには「source field」列を含めない。

### S30.2 Projection helper（唯一の解釈点）

`projectApprovedDictionaryResolutionProvenance(row)`（matching HTML内、
private関数）を新設し、Detail/Graph/Excelの全てがこの関数の返り値のみを
読む。sidecar構造の解釈はこの関数1箇所に集約する（duplicate semantic
interpretation count = 0）。

返り値（fresh・deep-frozen・raw row/sidecarとのalias無し、§34）:

```js
{
  available: boolean,       // sidecar自体が有効なformal shapeで存在するか
  snapshotBinding: { ... } | null,
  counts: { annotationCount, exactCount, aliasCount, unknownCount, conflictCount },
  annotations: [ { original_term, resolved_canonical, resolution_type,
                    dictionary_entry_id, dictionary_snapshot_id,
                    wrapper_integrity_sha256, scope, status }, ... ]
                    // 8-field contractそのまま、source order維持（§35）
}
```

実装は、既存`APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION`/
`APPROVED_DICT_BINDING_FIELDS`/`APPROVED_DICT_ANNOTATION_FIELDS`/
`APPROVED_DICT_RESOLUTION_TYPES`（いずれもCheckpoint 7の既存定数、無変更）
を再利用し、独自のfield一覧を新規定義しない。読み取りは全て
try/catch + 1-shot読み取りでhostile getter/malformed shapeに対しfail-safe
とし（§25/§26）、異常時は`available:false`の同一unavailable objectへ
fallbackする（native Error/message/stackは一切伝播しない）。

### S30.3 No Resolver rerun / no matching recomputation

projection helperはPrivateDictionaryResolverCore/PrivateDictionarySnapshot
ActivationCoreを一切呼ばない。dictionary_payload/effective_vocabulary探索・
canonical再計算・alias再判定・conflict再判定・fuzzy補完は行わない。
matching score（`confidence`/`matchMethod`等）・comparison review state
（レビュー判定/レビューコメント）・`_tagInfo`/`_tags`/`_tagDisplayMap`は
一切参照・変更しない。

### S30.4 Zero-annotation / missing-sidecar semantics

- sidecar自体が存在しない（`row._approvedDictResolution`が未設定）:
  `available:false`。「辞書照合情報なし (No dictionary resolution
  provenance)」として表示（§11）。comparison/errorにはしない。
- sidecarは存在するが`annotations.length === 0`かつ`snapshot_binding`が
  存在する: `available:true, counts.annotationCount:0`。「Snapshotは使用
  されたが対象語なし」として、`available:false`と明確に区別する（§12）。

### S30.5 Resolution type表示

内部enum（`EXACT_CANONICAL`/`APPROVED_ALIAS`/`UNKNOWN_TERM`/
`DICTIONARY_CONFLICT`）は無変更。表示ラベルのみ日本語first + English併記
（§9固定）:

| enum | 表示 |
|---|---|
| EXACT_CANONICAL | 正規語完全一致 (Exact Canonical) |
| APPROVED_ALIAS | 承認済み別名 (Approved Alias) |
| UNKNOWN_TERM | 辞書未登録 (Unknown Term) |
| DICTIONARY_CONFLICT | 辞書競合 (Dictionary Conflict) |

### S30.6 A/B mapping（既存identityのみ使用）

既存「照合結果一覧」は`buildDetailRows`/`buildDetailRowsPlm`という名前で
ファイル内に複数回定義される（V11→V12→Phase 7の段階的上書きアーキテ
クチャ - 後方の`関数名 = function(...){...}`再代入が実際に呼ばれる版で
あり、最初のtextual定義は死コード）。実際に呼ばれる版
（`buildDetailRows = function(sysList, plmList){...}`/
`buildDetailRowsPlm = function(sysList, plmList){...}`）は
`relationRowsByA(aId)`/`relationRowsByB(bId)`と`currentActiveFromRows(all)`
が返すtrace-matrix-review由来の`current`配列（`A_ID`/`B_ID`フィールドを
持つ、`matchPlmParts()`の浅いcloneや`buildReverseIndex()`の`hits`とは
別物）を用いて描画される。そのため以下の既存・無変更のlookup機構を使う:

- JSON A基準（`buildDetailRows`）: sys row（`item`）はループ変数として
  そのまま参照可能 - 追加lookup不要（`'辞書解決A'`）。matched B側は
  `current`の各行が持つ`B_ID`から、既存`rowSourceMaps()`
  （`currentSourceMaps(mergedResult.sysList, mergedResult.plmList)`の
  ラッパー、既存・無変更）が返す`{a,b}` Mapのうち`b`で元`plmList`row
  を引く（`rowSourceMaps().b.get(r['B_ID'])?.row`、fuzzy lookupではなく
  既存canonical identityによる厳密lookup、§36）。
- JSON B基準（`buildDetailRowsPlm`）: plm row（`item`）はループ変数として
  そのまま参照可能 - 追加lookup不要（`'辞書解決B'`）。matched A側は
  `current`の各行が持つ`A_ID`から、同じ`rowSourceMaps()`の`a`で元
  `sysList`row を引く（`rowSourceMaps().a.get(r['A_ID'])?.row`）。
- Knowledge Graph: `buildGraphElements`/`buildGraphElementsPlm`が
  ノードの`detail`フィールドへ`item`/`srcB`（元row参照）をそのまま格納
  済み（既存、無変更）。`data.detail._approvedDictResolution`を直接読める
  ため追加lookupは不要。group/overview-groupノード（`data.type ===
  'group'`または`'overview-group'`、集約row）はprovenance表示対象外
  とする（実rowではなく集約構造のため）。

配列index単独をidentityとして扱うことは行わない。表示labelやcanonical
termでのlookupも行わない（§36）。

### S30.7 Detail表現

既存「照合結果一覧」table（`renderDetailTableFull()`、`detailRows`）へ、
`buildDetailRows`/`buildDetailRowsPlm`が返す各row objectへ新規key
`'辞書解決A'`/`'辞書解決B'`を追加する形で実装する（既存の
`detailShowSourceColsToggle`/`detailShowReviewColsToggle`と同型の第3の
toggle`detailShowDictResolutionColsToggle`で既定非表示、`
isDetailColumnHiddenByDefault()`へ分岐追加）。

- JSON A基準row: `'辞書解決A'` = sys row 1件のcompact summary。
  `'辞書解決B'` = matched B row群それぞれのcompact summaryを`'\n'`で
  連結（既存の複数値列 `'照合JSON B表示名一覧'`等と同じ表示規約）。
- JSON B基準row: `'辞書解決B'` = plm row 1件のcompact summary。
  `'辞書解決A'` = A hits群それぞれのcompact summaryを`'\n'`で連結。

compact summary文字列の形式（例）:
`正規語2 / 別名1 / 未登録1 / 競合0`（`counts`からの単純集計、§16）。
sidecarなし: `辞書照合情報なし`。annotations=0だがsidecar有り:
`Snapshot使用・対象語なし`。

Detail table側のセルは既存tooltipパターン
（`title="${escapeHtml(val)}"`、`renderDetailTableFull()`の全列共通
処理）によりcompact summary文字列自体をtitleとしても提示するが、これは
表示中のcompact summary文字列の再掲であり、annotation単位の詳細
（original_term/resolved_canonical等）を追加提示するものではない -
Detail table自体には新規モーダル/別パネルは追加しない
（HUMAN-02/03全面改修はCheckpoint 14）。annotation単位の詳細は
Knowledge Graph node detail panel（S30.8、`original_term → 
resolved_canonical [type]`を1行ずつ）と、Excel専用sheet「辞書照合根拠」
（S30.9B、annotationごとに1 row）の2箇所で確認できる設計とし、Detail
table自身はrow-level集計のcompact summaryのみを担う。

### S30.8 Graph表現

`renderNodeDetailPanel()`/`formatNodeDetail(data)`（既存、node tap時に
呼ばれる）へ、`data.type`が`'requirement'`または`'part'`のときのみ、
`data.detail`（元row参照）から`projectApprovedDictionaryResolutionProvenance()`
を呼び、以下を追記する:

- 辞書解決サマリー（compact summary、§S30.7と同一文字列）
- Snapshot version（`snapshotBinding.snapshot_version`、存在する場合のみ）
- annotation詳細（`original_term → resolved_canonical (resolution type表示)`
  を1行ずつ、`annotations`のsource順のまま）

node identity/edge identity/edge score/edge existenceはいずれも変更しない
（§17）。provenanceを理由にnodeをmergeしない、新edgeを生成しない、
Graph用にResolverを再実行しない。badge等の視覚的追加は行わず、既存の
テキストベースdetail panel（`detailArea.textContent`）へ追記するのみ。

### S30.9 Excel表現

`exportDetailWorkbook()`（既存「照合結果一覧Excel出力」、無改変の
呼び出し構造を維持）に対し:

A. compact summary columns: S30.7で`detailRows`（=`buildDetailRows`/
   `buildDetailRowsPlm`の返り値）へ追加済みの`'辞書解決A'`/`'辞書解決B'`
   列が、既存のexport処理（`_`prefix列を除去するのみで他は素通し）に
   よってそのまま既存sheet「照合結果一覧」へ出力される - Excel専用の
   追加コードは不要。

B. 専用sheet「辞書照合根拠 (Dictionary Resolution Provenance)」を新設。
   annotationごとに1 rowを基本とする（§21）。row identity単位で一意に
   出す（§22推奨方針を採用 - comparisonごとの重複出力はしない。理由:
   Dictionary resolutionはrow-level factであり、comparison-level
   evidenceではないため、§23の区別と整合する）。`mergedResult.sysList`/
   `mergedResult.plmList`を直接1回ずつ走査し、それぞれのrowの
   `_approvedDictResolution`をprojectionしてannotation単位で展開する
   （comparisonの数に依存しない）。

   列（既存identityのみ使用、推測生成なし、§21）:
   `side`（'JSON A' / 'JSON B'）、`row_id`（`sysRowId(item,idx)`または
   `plmUniqueKey(plm,idx)` - 既存canonical row identity、常に非null）、
   `trace_id`（`item.trace_id`/`plm.trace_id`、無ければ空欄 - 推測生成
   しない）、`original_term`、`resolution_type`（表示ラベル併記）、
   `resolved_canonical`、`snapshot_id`、`snapshot_version`、
   `dictionary_id`、`dictionary_version`、`scope`。

   comparison_idは含めない（row-level sheetとcomparison-level sheet
   「照合結果一覧」は別概念であり、§23により意図的に混同しない。
   comparison文脈が必要な場合は既存`matcher_a_id`/`matcher_b_id`
   （＝本sheetの`row_id`と同一値）で照合結果一覧側と付き合わせられる
   ため、別途mapping sheetは新設しない）。

annotations=0のrow・sidecarなしrowもexport成功する（row自体は出力せず
skip - annotation-level sheetのため、0件のrowは自然に現れない。row-level
のavailable/zero区別はcompact summary column側（A項目）で確認する設計と
する）。

private dictionary payload全体（`effective_vocabulary`/`entries`/
review note/private workbook内容）は一切含めない（§28/§29/AG/AH）。

### S30.10 row-level vs comparison-level semantics

Dictionary resolution provenance（1 row × 1 Snapshot bindingの下で
確定したannotation集合）はrow-level factであり、同一rowが複数の
comparison（`traceMatrixRows`の複数エントリ）に参加してもprovenance
自体は不変・単一である。Excel provenance sheetはrow identity単位で
1回だけ出力し、comparison参加回数に応じて重複させない（§30.9B）。
一方、Detail table（`buildDetailRows`/`buildDetailRowsPlm`）はcomparison
単位（1 A行×matched B行群）で描画されるため、そこでのcompact summary
表示は「そのcomparisonが参照するA/B row(群)のprovenance」であり、
row-level factをcomparison文脈へ射影した表示に過ぎない（意味の混同では
ない - S30.7の複数値連結がまさにこの射影）。

### S30.11 Snapshot identity表示

既定表示: `snapshot_id`/`snapshot_version`/`dictionary_id`/
`dictionary_version`/`scope`。hashは既定では出さず、Graph detail panelの
annotation詳細やExcel provenance sheetでのみ`wrapper_integrity_sha256`を
必要に応じて確認可能とする（`dictionary_payload_sha256`はsidecarの
`snapshot_binding`に含まれるためsheetへ列として出力可能- Detail
compact summaryへは出さない）。表示のためのhash再計算は一切行わない
（sidecarに格納済みの値をそのまま使う）。

### S30.12 Privacy

sidecarの外側にあるdictionary payload全体・review note・private workbook
内容は一切表示/exportしない。表示可能なのはそのrowのannotationに含まれる
`original_term`/`resolved_canonical`等、8-field contractの範囲のみ（§28）。
Excel exportはユーザー明示操作（既存「照合結果一覧Excel出力」ボタン）
時のみ - 自動/バックグラウンドexportは追加しない（§29）。

### S30.13 Malformed sidecar fallback（R1: atomic fail-closed検証）

`projectApprovedDictionaryResolutionProvenance()`はhostile
getter/malformed annotation/getter throwいずれに対してもtry/catchで
`available:false`のfallback objectへ落ち、native Error.message等を
一切伝播しない。Detail render/Graph render/Excel exportいずれも、
1件の異常sidecarが全体のrenderingをクラッシュさせない（try/catchは
projection helper内で完結させ、呼び出し側は常に安全な戻り値のみを
受け取る設計とする）。

**R1（独立レビュー指摘MAJOR-01への対応）**: 初版実装は個々の
malformed annotationを`continue`でskipし、残った有効なannotationだけで
`available:true`のprojectionを構築していた。これは、formal sidecarの
一部が破損している事実を隠したまま「利用可能な監査情報」として
表示・Excel出力してしまう問題があった（例: EXACT_CANONICAL 1件 +
破損したDICTIONARY_CONFLICT 1件を持つsidecarが、後者を黙って
落として「正規語1 / 競合0」と表示されてしまう）。

R1では、formal sidecarを**atomic provenance artifact**として扱う。
以下のいずれかが不正な場合、annotation単位のskipではなく**row
projection全体**を`available:false`とする:

- `snapshot_binding`が非object、またはいずれかのfieldの型が不正
- `annotations`が非array
- `annotations`のいずれか1件でも非object、fieldの型が不正、または
  `resolution_type`が`APPROVED_DICT_RESOLUTION_TYPES`に含まれない

また、「sidecarが一度も付与されていない（辞書機能未使用、正常な状態）」
と「sidecarは存在するが形式が不正（異常な状態）」を明確に区別する:

- sidecarが`undefined`（プロパティ自体が存在しない、getter throwでも
  ない）→ `available:false, malformed:false` →
  「辞書照合情報なし (No dictionary resolution provenance)」
- sidecarが存在するが読み取り不能/形式不正（getter throw含む）→
  `available:false, malformed:true` →
  「辞書照合情報を表示できません (Dictionary provenance unavailable)」

`_approvedDictResolution`プロパティ自体の読み取りが例外を投げる場合
（プロパティは概念上存在するがhostile）も`malformed:true`側へ分類する
- 「読み取れない」と「一度も処理されていない」を混同しない。

annotations=[]（Snapshot使用・対象語なし、S30.4）は本fallbackの対象
ではない - formal shapeとして正しく空配列であるケースは引き続き
`available:true`。

**R2（独立レビュー指摘MAJOR-02への対応）**: R1時点のbinding検証は
各fieldの**型**（string/number）のみを確認しており、Checkpoint 7が
固定した7-field formal contract（`snapshot_id`は`dsnap-<hex32>`、
`snapshot_version`はsafe integer >= 1、`wrapper_integrity_sha256`/
`dictionary_payload_sha256`は`hex64`、`dictionary_id`は
`pdict-<hex32>`、`dictionary_version`は先頭0なし最大16桁の10進数
文字列（または`"0"`）、`scope`は`PROJECT`固定）までは検証していな
かった。型だけ正しいformat違反のbinding（例:
`snapshot_id:"x"`, `scope:"DOMAIN"`）でも`available:true`を通過して
しまう欠陥があった。

R2では、この7-field formal formatの検証を独自に再実装せず、既存
Checkpoint 7-R4の`captureApprovedDictBatchBinding(rawBinding)`
（本HTML内、無変更、対応するCheckpoint 7の215件回帰スイートで
既に検証済み）をそのまま呼び出す形に変更した。この関数は
`SNAPSHOT_ID_RE`/`HEX64_RE`/`checkSnapshotVersion`
（`private_dictionary_snapshot_core.js`由来）、`DICTIONARY_ID_RE`/
`VERSION_RE`（`private_dictionary_learning_core.js`由来）を
`APPROVED_DICT_SNAPSHOT_ID_PATTERN`等として本HTML内に転記した
既存定数を用いる - 新規のformat定義や2つ目のformat contractコピーを
作らない。`captureApprovedDictBatchBinding()`が`null`を返した場合
（7 fieldのいずれか1つでもformal format違反）、projection全体を
`available:false, malformed:true`とする（R1のatomicity原則の延長）。

annotation側の`dictionary_entry_id`（`pde-<hex32>`）等のより深い
format検証（`captureApprovedDictAnnotation()`が実装済み）は、R2の
指摘範囲外（MAJOR-02はbinding限定）であり、本ラウンドでは変更しない。

### S30.14 Reproducibility

projection結果はrow._approvedDictResolutionの内容のみに依存し、現在の
`approvedDictionaryRuntime`（session live state）を一切参照しない
（§37/AJ/AK）。同一`mergedResult`（同一row参照群）から呼び出す限り、
projection結果は常に同一値を返す（§38）。Snapshot switch後も、既存
comparison resultのprovenance表示は元rowのsidecarのまま変わらない。

### S30.15 Verification matrix概要

Projection（A-K）/No recomputation（L-O）/Detail（P-T）/Graph（U-Z）/
Excel（AA-AI）/Staleness・reproducibility（AJ-AL）/Hostile（AM-AO）/
Existing semantics（AP-AT）の45項目区分を
`private_dictionary_resolution_provenance_projection_verification.js`
（新規）へ実装する。real dependency path
（実Snapshot→実setSnapshot/setProjectPin→実Checkpoint 7 matching
resolution→実`_approvedDictResolution`→Checkpoint 13 projection→
Detail/Graph/Excel）を最低1本、EXACT_CANONICAL/APPROVED_ALIASを実
Resolver outputから生成して通す。

### S30.16 P2-A4 Exit Criteria更新（Checkpoint 13 CLOSED後）

**CLOSED（追加）:**
- provenance display/export（本Checkpoint）

**Remaining MUST-CLOSE:**
- HUMAN-01/02/03 UI convergence（P2-A3既存UI全体の文言・表示規約統一、
  Checkpoint 14）
- integrated E2E acceptance / clean regression（全Checkpoint通しの
  E2E受入）
- privacy/regression closure（最終的な横断privacy監査）

**FUTURE SLICE（無変更）:**
- persistent unknown/conflict maintenance queue
- STANDARD/DOMAIN/SESSION full layers

既存S29.15/S29.16の分類（Checkpoint 12時点）と矛盾しない - 「provenance
display/export」はCheckpoint 12時点でRemaining MUST-CLOSEに数えられて
おらず、Checkpoint 13で新たにCLOSEDへ追加されるのみで、他項目の分類は
変更しない。

## S31 Checkpoint 14: HUMAN-01/02/03 UI Convergence
### （P2-A3 Candidate Review UI + Matching Integration Terminology Cleanup）

Checkpoint 14はUI/UX収束のみを目的とする。辞書判定ロジック・
Promotion・Snapshot・Resolver・Matching score・Comparison review
semanticsは一切変更しない。表示文言・helper text・ボタン名称・
verificationのみを対象とする。

### S31.1 対象範囲の確定

固定pre-head `45d296a9719fa68b00adfeaf9ce3da79e3da5c2e` 上で調査した
結果、対象は以下に確定する。

**P2-A3 Candidate Review UI**（実際に稼働している方 - 検証されない
mock版 `tools/knowledge_builder/ui/p2a3_candidate_review_mock/` は
対象外）:
`tools/knowledge_builder/ui/private_dictionary_candidate_review_ui/`
配下の `index.html`, `dom.js`, `table_view.js`, `alias_view.js`,
`conflict_view.js`, `evidence_panel.js`, `app.js`。

`review_state.js`（DECISIONS/RESOLUTIONS/REASON_CODESの内部enum定義と
reducer本体）は review core semantics であり**変更しない** - 同ファイル
冒頭のコメントが既に「Values stored are the fixed English enums from
the contract; Japanese appears only in the view layer」と明記しており、
表示ラベルはview層（今回touchするファイル）へ寄せる設計方針と一致する。
`private_review_export.js`/`private_review_import.js`/
`shareable_summary_export.js`/`workbook_contract.js`/`workbook_cells.js`
/`workbook_validation.js`（Workbook I/Oとschema）も**変更しない**（schema
やprivacy boundaryを変えないため）。

**matching tool側**（`tools/json_ab_trace_matching_tool_v12.1.15.html`）:
Checkpoint 12 Project Pin UI（`Project設定 (Project Pin)`/`照合セッション
に適用 (Apply to Matching Session)`）とCheckpoint 13 provenance UI
（`正規語完全一致 (Exact Canonical)`/`承認済み別名 (Approved Alias)`/
`辞書未登録 (Unknown Term)`/`辞書競合 (Dictionary Conflict)`/`辞書解決
(Dictionary Resolution)`）はいずれも既に日本語first + English併記で、
本Checkpointの用語集（S31.2）と整合している（`正規語`/`別名`/`競合`の
語根がP2-A3側と一致）。**再変更しない** - 無意味な再変更の禁止（§5）に
従う。よってmatching HTMLの変更は本Checkpointでは発生しない。

### S31.2 Canonical display glossary（用語集）

P2-A3とmatching toolの双方で共通して使う表示用語を固定する。internal
term列はenum/schema値であり**変更しない**。表示形式は「日本語（English
companion）」の順で統一する。

| internal term | user-facing 日本語 | English companion | meaning |
|---|---|---|---|
| （candidate種別: `evaluation.candidates`） | 正規語候補 | Canonical Candidate | 辞書の正規語となりうる候補語 |
| （candidate種別: `evaluation.alias_candidates`） | 別名候補 | Alias Candidate | 正規語候補とは独立に採否判断する別名候補 |
| （candidate種別: `evaluation.conflicts`） | 競合 | Conflict | 同一別名が複数の正規語候補を指し、人間の解決が必要な状態 |
| `ACCEPT` | 承認 | ACCEPT | レビュー担当者がこの候補を採用と判断した状態 |
| `REJECT` | 却下 | REJECT | レビュー担当者がこの候補を不採用と判断した状態 |
| `UNCERTAIN` | 保留 | UNCERTAIN | 判断を保留した状態（採否未確定） |
| `UNREVIEWED` | 未判定 | UNREVIEWED | まだ人間の判断が一度も行われていない状態（既定値） |
| `UNRESOLVED`（conflict resolution） | 未解決 | UNRESOLVED | 競合がまだ解決されていない状態 |
| `SELECT_CANONICAL`（conflict resolution） | 正規語を選択 | Select Canonical | 競合する正規語候補のうち1件を選ぶ解決 |
| APPROVED_ALIAS（Checkpoint 7/13既存） | 承認済み別名 | Approved Alias | 人間レビュー済みaliasとして正式に使用可能 |
| DICTIONARY_CONFLICT（Checkpoint 7/13既存） | 辞書競合 | Dictionary Conflict | 辞書上で一意に解決できない |
| EXACT_CANONICAL（Checkpoint 7/13既存） | 正規語完全一致 | Exact Canonical | 入力語が正規語自体と完全一致 |
| UNKNOWN_TERM（Checkpoint 7/13既存） | 辞書未登録 | Unknown Term | 辞書に該当エントリなし |
| （Project Snapshot Pin、Checkpoint 9-12既存） | Project設定 | Project Pin | このプロジェクトで使う辞書Snapshotの固定情報 |
| （dictionary snapshot wrapper、Checkpoint 3以降既存） | 辞書Snapshot | Snapshot | 辞書の特定バージョンの固定スナップショット |
| （P2-A3 private resume artifact） | レビュー作業（の保存ファイル） | Review Progress | reviewer decisions・private note・進捗を含む非公開ファイル |
| （P2-A3 shareable summary artifact） | 共有用レビュー集計 | Shareable Review Summary | 件数集計のみを含む共有可能なファイル |

enumと表示用語の混同を避けるため: 上記表の「internal term」列が
enum文字列そのものである行（`ACCEPT`等）は、表示側でも常にその
英大文字綴りをEnglish companionとして使う（"Accepted"のような別の
英語表現へ言い換えない）。これは実際にWorkbookへ書き出される値
（`private_review_export.js`のCandidates/Aliasesシート等）と表示が
食い違わないようにするための意図的な選択であり、§7の推奨候補
（"Accepted"等）から離れる部分だが、実データとの一致を優先した。

「未判定」は既存コードベースで既に使われているJapanese語彙であり
（`index.html`のUNREVIEWEDオプション表示、§7推奨の新語「未レビュー」
ではなく）、Checkpoint 14では既存語彙を保持しつつEnglish companion
`(UNREVIEWED)`のみを追加する - 無用な語彙変更を避ける。

### S31.3 HUMAN-01対象語 / 対象外語の確定

**対象**（Private Dictionary contract上の専門語、P2-A3 UI内で発見した
英語のみ表示箇所）:
- Alias（タブ・表見出し・stat card・filter option・panel note・
  bulk button・decisionSegment tooltip等、複数箇所）
- Conflict（同上）
- Canonical（alias-tabの表見出し、conflict_view.jsのRESOLUTION_LABELS内
  "canonicalを選択"の"canonical"）
- ACCEPT/REJECT/UNCERTAIN（dashboard stat・filter option・bulk button・
  decisionSegment・confirm dialog・toast）
- UNREVIEWED（既にJP表示あり、English companionのみ追加）

**対象外**（意図的に変更しない、理由付き）:
- `Rule`（field label/table header）・`RULE_LABELS`の各値（構造KEY等）:
  抽出ruleの内部分類名であり、HUMAN-01の対象語リストに明示されて
  おらず、§8「一般ユーザーに価値が薄い通常語まで機械的に二言語化
  しない」に該当。
- `Scope`/`Status`ラベルおよびその値`SESSION`/`PROBATION`
  （evidence_panel.js meta、alias_view.js列）: 対象語リストの
  `Active`/`Superseded`/`Rolled Back`はSnapshotのライフサイクル状態
  （別のenum系列、Checkpoint 6/9の`private_dictionary_snapshot_
  activation_core.js`が扱うactivation lifecycle）であり、
  `SESSION`/`PROBATION`（P2-A3候補のpromotion scope/status、
  `workbook_contract.js`のSCOPE_VALUE/STATUS_VALUE）とは別概念。
  今回のP2-A3 UI調査では`Active`/`Superseded`/`Rolled Back`という
  文字列そのものは一切出現しない（別のUI/画面に属する）ため、
  該当箇所が存在せず対応不要。
- Candidate: 表示文言としては既に「候補」（日本語）で統一済み。
  `candidate_id`等はaudit専用の折り畳みセクション内の生ID表示であり、
  ラベルprose文言ではないため対象外（rawなIDをbilingual化する意味が
  ない）。
- `Resolution`: P2-A3側では「conflict resolution」という語のUI表示は
  RESOLUTION_LABELS配列を通してのみ発生し、既に全選択肢が日本語
  ラベル（未解決/canonicalを選択/すべて却下/文脈依存/判断保留）。
  "canonicalを選択"の"canonical"のみS31.2の用語集に合わせて
  「正規語（canonical）を選択」へ修正する。

### S31.4 用語集の一元化（実装方針）

`dom.js`へ新規 `DECISION_LABELS`（`{ACCEPT, REJECT, UNCERTAIN,
UNREVIEWED}` → 表示文字列のfrozen map）を追加する。`dom.js`は
`table_view.js`/`alias_view.js`/`conflict_view.js`/`app.js`いずれよりも
先に読み込まれる最も基礎的な共有moduleであり（`index.html`の
script順）、依存方向を逆転させない。`decisionSegment()`の
aria-label/titleと、`app.js`のconfirm dialog文言・toast文言が同じ
mapを参照する。`index.html`内の静的markup（dashboard stat・filter
option・bulk button）は既存の実装パターン（`RULE_LABELS`はJS駆動だが
個々の静的文言はHTML直書きのままという既存の混在パターン）を踏襲し、
静的文字列として直接書き換える（巨大なi18n基盤は導入しない、§8）。

### S31.5 HUMAN-02: private save/resume semantics

実装（`app.js`/`private_review_export.js`/`private_review_import.js`
調査結果）を根拠とする:

- 保存artifact（`export-private-button`が生成する
  `WorkbookContract.PRIVATE_FILE_NAME`）は candidate/alias/conflictの
  reviewer decision・reason_code・**note（reviewer private note、
  最大2000文字）**・schema version・evidence参照・source document
  fingerprintを含む、`review_state.js`のreviewer判断層
  （working state）をそのまま書き出したprivate working artifactである
  （`private_review_export.js`のbuildCandidatesRows等が`d.note`を
  そのまま出力）。
- 「レビューを再開」ボタン（`resume-button`）は実際には**file load
  operation**である: `startResumeFlow()`が`resume-input`（hidden file
  input）のクリックを発火し、`handleResumeFile()`が選択された
  `.xlsx`を`PrivateReviewImport.validateAndBuildPendingReviewState()`
  で検証・変換したうえで`app.session.reviewState`**のみ**を置換する
  （evaluation/evidenceIndex/source fingerprintsは一切変更しない -
  「人間判断層だけを入れ替える」という既存不変条件、コメントに
  明記済み）。
- 既存実装は既に「未保存のレビュー結果があります」confirm dialog
  （`app.dirty`が真の場合のみ表示、`startResumeFlow()`内）で
  destructive load操作であることを警告している。この既存confirm
  dialogの機構自体は変更しない（新しいstate machineを作らない、
  §15）が、文言をより明示的にする。

**新ボタン名称・説明**（表示文言のみ変更、`id`/handler名は変更しない）:

| 要素 | 旧文言 | 新文言 |
|---|---|---|
| `export-private-button` | レビュー結果をExcel保存 | レビュー作業を保存（Save Review Progress） |
| `resume-button` | レビューを再開 | 保存したレビュー作業を読み込んで再開（Resume from Saved File） |

常時表示のexplanatory text（title属性だけに頼らない、§25/S31.9）を
`topbar`直下・`privacy-bar`の近傍に新設する短い説明ブロックとして
追加する: 「レビュー作業を保存」「保存したレビュー作業を読み込んで
再開」の2ボタンについて、これらが reviewer decisions・private
note・進捗を含む非公開ファイル（LOCAL PRIVATE）であり、共有用の
集計ファイルとは別物であることを常時読めるテキストで明示する。

resume時のconfirm dialog文言（`app.js` `startResumeFlow()`内）も
「現在の未保存レビュー結果は、読み込んだレビュー結果で置き換え
られます。」から、load操作であることがより明確な文言へ調整する
（既存confirm機構は維持、文言のみ）。

### S31.6 HUMAN-02: shareable summary semantics

実装（`shareable_summary_export.js`調査結果）を根拠とする:

- `export-shareable-button`が生成する
  `WorkbookContract.SHAREABLE_FILE_NAME`は、`buildAllowlistProjection()`
  という**allowlist方式**（生のevaluation/reviewStateを直接読まず、
  明示的に許可したfieldのみを新規projectionへ集める設計、raw
  objectをfilterする方式ではない）で構築される。ファイル冒頭コメントが
  明示的に禁止しているフィールド: `candidate_id`, `alias_candidate_id`,
  `conflict_id`, `selected_candidate_id`, `source_unit_id`,
  `provenance_ref_id`, canonical term, alias term, file name, sheet
  name, PDF/Excel本文, evidence excerpt, **reviewer note**, private
  path, source_kind。含まれるのは件数集計（Summary/Decisions/Reason
  Codes/Rules/Conflict Resolutions）と`{source_document_id,
  document_fingerprint}`のみ。
- 既存実装は既にconfirm dialog（`exportShareableSummaryWorkbook()`
  内）で「このファイルは共有用集計です。キーワード、alias、file名、
  evidence、レビューコメントは含みません。」と明示している。この
  文言は正確（実装のallowlistと一致）であり、大きな変更は不要。

**新ボタン名称・説明**:

| 要素 | 旧文言 | 新文言 |
|---|---|---|
| `export-shareable-button` | 共有用サマリーをExcel保存 | 共有用レビュー集計をExcel保存（Export Shareable Review Summary） |

常時表示のexplanatory textで、これが「共有用の件数集計のみ」であり
「作業再開用の非公開ファイルではない」ことを明示する（S31.5の
private側explanatory textと対になる形で配置する）。

### S31.7 private vs shareable の視覚・意味上の区別

既存レイアウト（`topbar-right`のボタン列 + `privacy-bar`）の範囲内で
対応する（大幅な画面再設計はしない、§14/§26）。具体的には:

`privacy-bar`の直後に新しい `<div class="workbook-help" role="note">`
ブロックを追加し、2つの短い段落で区別する:
- A. 作業継続用（非公開）: 「レビュー作業を保存」「保存したレビュー
  作業を読み込んで再開」の2ボタンの説明。reviewer decisions・
  private note・進捗を含み、外部共有を想定しない旨。
- B. 共有用（集計のみ）: 「共有用レビュー集計をExcel保存」ボタンの
  説明。件数集計のみで再開不可、共有前提である旨。

色のみに依存せず（§25/AK）、テキストで常時明示する。既存
`.privacy-bar`パターン（アイコン + 短い説明paragraph、role="note"）を
再利用し、新しいCSSフレームワークは導入しない。

### S31.8 Filter option inventory（P2-A3 candidates panel）

実装（`table_view.js` `selectRows()`、`index.html`該当箇所）を
Source of Truthとする。predicateは一切変更しない（§18）。

| dropdown | option value | 現行label | 新label | predicate（要約） |
|---|---|---|---|---|
| `f-decision` | ALL | すべて | すべて（変更なし） | フィルタなし |
| `f-decision` | UNREVIEWED | 未判定 | 未判定（UNREVIEWED） | `decision === 'UNREVIEWED'`（未設定時の既定値も含む） |
| `f-decision` | ACCEPT | ACCEPT | 承認（ACCEPT） | `decision === 'ACCEPT'` |
| `f-decision` | REJECT | REJECT | 却下（REJECT） | `decision === 'REJECT'` |
| `f-decision` | UNCERTAIN | UNCERTAIN | 保留（UNCERTAIN） | `decision === 'UNCERTAIN'` |
| `f-source` | ALL/PDF/EXCEL | すべて/PDF由来/Excel由来 | 変更なし | `sourceKindsOf(c,index).has(view.source)` |
| `f-rule` | ALL + 各rule | すべて + RULE_LABELS | 変更なし（対象外、S31.3） | `c.rule_ids.indexOf(view.rule) !== -1` |
| `f-flag` | ALL | すべて | すべて（変更なし） | フィルタなし |
| `f-flag` | ALIAS | Aliasあり | 別名候補あり（Alias） | `aliasTermsFor(c,evaluation).length > 0` |
| `f-flag` | CONFLICT | Conflictあり | 競合あり（Conflict） | `c.metrics.alias_conflict_count > 0` |
| `f-sort` | conflict | Conflict優先 | 競合優先（Conflict Priority） | 表示順のみ、絞り込みではない |

各filterのhuman-readable説明（helper text、常時表示、tooltipのみに
閉じない）を`toolbar`直下に短い説明リストとして追加する。例:

- 判定（Decision）: 「未判定（UNREVIEWED）」＝まだ人間の判断が確定
  していない候補のみ表示。「承認（ACCEPT）」「却下（REJECT）」
  「保留（UNCERTAIN）」＝それぞれの判定が確定した候補のみ表示。
- 属性（Attribute）: 「別名候補あり（Alias）」＝別名候補を1件以上
  伴う正規語候補のみ表示。「競合あり（Conflict）」＝複数の正規語候補
  が競合し人間による解決が必要な別名を伴う候補のみ表示。

f-decision/f-flagの各説明は`selectRows()`の実predicateから直接
書き起こしたものであり、predicate自体は変更しない。verification
（S31.11）で表示説明と実predicate結果の一致を確認する。

Alias/Conflictタブ自体には状態filterが存在しない（既存仕様どおり、
変更しない）。

### S31.9 Empty state / current filter visibility

`index.html`の`#empty`（候補0件）・`#alias-empty`・`#conflict-empty`
文言は既に「該当する候補がありません。」等が存在する。HUMAN-03の
要求（§20: 壊れたと誤解させない）に対し、現行文言で十分明確なため
そのまま維持する。current filter visibility（§21）は、既存の
`<select>`のselected valueがそのまま現在のfilter状態を表しており、
複数filterが同時に有効な場合でも各`<select>`を見れば分かるため、
追加UIは不要と判断する（既存で充足）。

### S31.10 Cross-tool terminology整合の確認結果

matching tool（`tools/json_ab_trace_matching_tool_v12.1.15.html`）を
grepで確認した結果:
- `正規語`/`別名`/`競合`の語根は、S31.2用語集のP2-A3側表示と完全に
  一致している（`正規語完全一致 (Exact Canonical)`/`承認済み別名
  (Approved Alias)`/`辞書競合 (Dictionary Conflict)`等）。
- `Project設定 (Project Pin)`/`照合セッションに適用 (Apply to
  Matching Session)`（Checkpoint 12）は既に日本語first + English
  併記。
- 「Alias: P2-A3 = 別称、Matching = 別名」のような訳語の揺れは
  存在しない（P2-A3は本Checkpoint以前は英語のみ表示だったため、
  そもそも「別称」という訳語自体が存在しなかった - 揺れの実例は
  発見されなかったが、S31.2の用語集を固定することで将来の訳語追加
  時の揺れを防止する）。

結論: matching tool側の変更は不要（§5/S31.1で確定済み）。

### S31.11 Verification matrix概要

新規 `private_dictionary_ui_terminology_convergence_verification.js`
（Node、`private_dictionary_candidate_review_ui_verification.js`と
同じsandbox/静的解析パターンを踏襲）で、Checkpoint 14 request §36の
A-AO区分を実装する。主要な検証方針:

- HUMAN-01（A-G）: `index.html`/`dom.js`/`table_view.js`/
  `alias_view.js`/`conflict_view.js`/`evidence_panel.js`/`app.js`の
  静的ソーススキャンで、対象語（S31.3）が「日本語（English）」の
  companionパターンで出現することを確認。内部enum配列
  （`review_state.js`のDECISIONS等）が不変であることをbyte比較で
  確認。
- HUMAN-02 private save/resume（H-O）: 実際に
  `PrivateReviewExport.buildPrivateReviewWorkbookBytes()`→
  `PrivateReviewImport.validateAndBuildPendingReviewState()`の
  round-tripをNode側で実行し、旧UI変更前の既存fixtureに対しても
  成功することを確認（artifact schemaは無変更のため、Checkpoint 14
  前後で同一workbookが読める）。
- HUMAN-02 shareable export（P-T）: `buildAllowlistProjection()`の
  出力キー集合が変更されていないことを確認、`reviewer note`が
  出力に含まれないことを確認。
- HUMAN-03 filters（U-AD）: `table_view.js`の`selectRows()`を実際に
  呼び出し、各filter optionの実predicate結果とS31.8の説明文言が
  記述する集合が一致することをデータ駆動で確認（未判定filterに
  reviewed itemが混入しない等）。
- Compatibility（AE-AJ）: 既存
  `private_dictionary_candidate_review_ui_verification.js`/
  `private_dictionary_candidate_review_workbook_verification.js`/
  Checkpoint 13 provenance verification/Checkpoint 12 verificationを
  無改変のまま再実行し、regression 0を確認。
- Privacy/accessibility（AK-AO）: 新設のexplanatory
  text/helper textのソースを静的スキャンし、reviewer note・
  dictionary term payload・file名・filesystem path・native Errorの
  文字列が新規に出現しないことを確認。

Browser verificationは実Chromium/Playwrightで
`private_dictionary_candidate_review_ui_verification.js`が既に持つ
browser half（既存パターン）を土台に、Checkpoint 14固有のUI要素
（新ボタン文言、explanatory text、filter説明）を追加確認する。

### S31.12 P2-A4 Exit Criteria更新（Checkpoint 14 CLOSED後）

**CLOSED（追加）:**
- HUMAN-01/02/03 UI convergence（本Checkpoint）

**Remaining MUST-CLOSE:**
- integrated E2E acceptance / clean regression（全Checkpoint通しの
  E2E受入）
- privacy/regression closure（最終的な横断privacy監査）
- human real-machine acceptance（実機での人間受入確認、S31.13の
  チェックリストを用いた5-10分の確認作業）

**FUTURE SLICE（無変更）:**
- persistent unknown/conflict maintenance queue
- STANDARD/DOMAIN/SESSION full layers

既存S30.16の分類（Checkpoint 13時点）と矛盾しない -
「HUMAN-01/02/03 UI convergence」はCheckpoint 13時点でRemaining
MUST-CLOSEに数えられており、Checkpoint 14で新たにCLOSEDへ移動する
のみで、他項目の分類は変更しない。

### S31.13 Human向け受入チェックリスト（5-10分）

Checkpoint 14完了時、人間レビュー担当者が以下を実機（実Chromium）で
確認できる:

1. P2-A3 Candidate Review画面を開き、topbar右側の3ボタンの文言を読む
   だけで「レビュー作業を保存」「保存したレビュー作業を読み込んで
   再開」「共有用レビュー集計をExcel保存」の役割の違いが分かるか。
2. privacy-barの下に表示される作業継続用（非公開）/共有用（集計のみ）
   の説明を読み、private save/resumeとshareable exportを混同しない
   ことを確認できるか。
3. 候補タブのfilter説明（判定/属性）を読まずにdropdown選択肢だけを
   見た場合と、説明を読んだ場合とで理解度に差が出るか（説明の効果
   確認）。
4. dashboard・タブ・table見出しの「別名（Alias）」「競合（Conflict）」
   「正規語（Canonical）」の日本語と英語が対応していることを確認
   できるか。
5. 一括ACCEPT等のconfirm dialogの文言が、実際の操作内容（判定の
   上書き、辞書への自動登録はしない）と一致しているか。

いずれも「はい」であれば受入合格とする。
