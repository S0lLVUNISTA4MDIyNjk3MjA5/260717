P2-A4 Matching Integration — Acceptance Plan (Checkpoint 1 draft)
====================================================================

本書はP2-A4統合が実装された後（後続Checkpoint）に実施する受け入れ検証の**計画**である。
Checkpoint 1では実装を伴わないため、本書自体もplanのみであり、実測値は含まない。
KPI・test caseの具体的な数値目標や合否基準は、実装Checkpointの内容が固定された時点で
再確認・必要に応じて改訂する。

**R1改訂**: Checkpoint 1-R1にて、単一の複合fixtureを4種類（approved alias / unknown-only /
conflict-only / invalid snapshot）へ分離し（S1.1）、`total comparisons == baseline`要求の
適用範囲をunknown-only/conflict-only fixtureに限定、approved alias fixtureはfalse-positive/
false-negative評価で扱うよう修正（S1.2）。

**R2改訂**: Checkpoint 1-R2にて、contract文書R2改訂（S13/S4.1/S5.2/S5.4/S6.3-S6.4）に対応する
7件の検証項目をS11として新設した（R2-6）。

**R3改訂**: Checkpoint 1-R3にて、contract文書R3改訂（S4.1のOption A変更、S5.2の
`wrapper_integrity_sha256`対象範囲拡張、S13.1新設）に対応してS11の項目#2-4を修正し、
approvedDict tag挙動・duplicate mapping provenanceに関する項目#8-13を新設した（R3-4）。

---

## S1. 検証の基本方針

機能PASSだけでは不十分とする。P2-A4の目的（辞書レビューと照合レビューの二重判断を無くし、
人間の判断回数を減らすこと）が実際に達成されたかを、**同一demo datasetに対する
「Dictionaryなし」と「Dictionaryあり」の比較実験**で計測する。

比較実験の前提:

- 同一の `TraceRecordSet A` / `TraceRecordSet B`（既存matching toolの標準demo、または
  P2-A3標準sample train_hvac系列から作成する新規demo dataset。両方を検討し、後続Checkpointで
  確定する）。
- 同一のmatching configuration。
- Dictionaryありの場合、S1.1のfixture分離方針に従う（R1-7: 単一の複合fixtureで全ケースを
  同時に混在させない）。

### S1.1 Acceptance fixtureの分離（R1-7）

Checkpoint 1初版は「approved alias 1件・unresolved conflict 1件・unknown term 1件を含む
単一の複合fixture」を想定していたが、これは(a) baseline比較の基準（total comparisons一致）を
alias fixtureにまで一律適用してしまう、(b) 各ケースの効果が互いに干渉し評価しづらい、という
問題があるため、**最低4種類の独立したfixtureへ分離する**。

| fixture | 内容 | 目的 |
|---|---|---|
| approved alias fixture | `effective_vocabulary`に承認済みaliasを含み、対応するTraceRecordペアが存在する | dictionary併用によるmatching改善効果の評価 |
| unknown-only fixture | 辞書に存在しない語のみを含み、conflict・aliasは含まない | unknown termがmatchingを妨げないことの検証 |
| conflict-only fixture | S12.Bのlookup conflictを意図的に発生させる語のみを含む | conflictの局所化（全体無効化しないこと）の検証 |
| invalid snapshot fixture | hash不一致・schema不正等、壊れたwrapperを意図的に用意する | S10の「案B: 辞書無効化+続行」の検証 |

### S1.2 baseline一致要求の適用範囲（R1-7）

**`total comparisons == baseline`（dictionaryなし実行と同数）を要求するのは、unknown-only
fixtureとconflict-only fixtureに限定する。** これらのfixtureでは辞書はbaseline matching
ロジックへfallbackするだけなので、comparison件数はdictionaryの有無に関わらず一致するはずであり、
一致しなければ「辞書がbaseline matchingへ意図せず影響している」というregressionを意味する。

**approved alias fixtureにはこの要求を適用しない。** 辞書によってmatching結果が実際に改善される
ことこそがP2-A4の目的であるため、comparison数や各comparisonの順位（rank/score）が
dictionaryなしの場合と変わることを**許容する**。approved alias fixtureの評価は、件数一致では
なく、事前に用意した**正解セット（どのTraceRecordペアが本来対応すべきか、人手で確定した
ground truth）に対するfalse-positive/false-negative comparison count**（S2の#11, #12）で行う。

---

## S2. 計測KPI一覧（P2-A4指示書§19準拠）

| # | metric | 定義 | 計測タイミング |
|---|---|---|---|
| 1 | total comparisons | matching engineが生成したcomparison record総数 | dictionaryなし/あり各実行後 |
| 2 | dictionary exact resolutions | `resolution_type=EXACT_CANONICAL` の件数 | dictionaryあり実行後 |
| 3 | approved alias resolutions | `resolution_type=APPROVED_ALIAS` の件数 | dictionaryあり実行後 |
| 4 | unresolved dictionary conflicts | `resolution_type=DICTIONARY_CONFLICT` の件数 | dictionaryあり実行後 |
| 5 | unknown terms | `resolution_type=UNKNOWN_TERM` の件数 | dictionaryあり実行後 |
| 6 | comparison review required count | review UIで人間確認が必要と表示されたcomparison件数 | 両方の実行後、比較 |
| 7 | dictionary review required count | 辞書メンテナンス側で人間確認が必要とされたentry件数 | dictionaryあり実行後（P2-A3側の既存計測を再利用） |
| 8 | human click count | comparison review完了までに要した実クリック数 | Playwright等での実操作計測（両方の実行で比較） |
| 9 | duplicate semantic decision count | **同じ辞書知識を辞書レビューと照合レビューで2回判断させた件数**（独立metric、下記S3参照） | dictionaryあり実行後 |
| 10 | matching work blocked count | Dictionary layerのerror等でmatching作業自体が止まった回数 | 両方の実行、特にinvalid snapshot fixtureで |
| 11 | false-positive comparison count | 辞書一致を理由に誤って一致扱いされたcomparison件数 | 既知の正解セットに対する評価 |
| 12 | false-negative comparison count | 辞書があれば見つけられたはずなのに見逃されたcomparison件数 | 同上 |

---

## S3. duplicate semantic decision count（独立metric）の測定方法

**目標値: 0。**

定義: あるcanonical/alias対応関係について、(a) P2-A3の候補レビューでACCEPT判断が既に行われており
かつ(b) それがDictionary Snapshotへ昇格済み（S13相当のACTIVE）であるにもかかわらず、
(c) 照合review画面で同じ「この語は同じ意味か」という質問が再度人間へ提示された件数。

測定方法（案）:

1. Dictionary Snapshot中のACTIVE alias/canonical一覧を固定する。
2. matching sessionを実行し、review UIで人間へ提示された確認項目のうち、
   「対応するTraceRecordペアの語彙が(1)のACTIVE集合に完全一致し、かつ照合UIの提示内容が
   `resolved_canonical` と `original_term` の対応関係の是非のみを問うもの」を検出する。
3. 該当件数をカウントする。0件であることを確認する。

**注意**: 「2つのTraceRecordが対応関係にあるか」（comparison decision）は辞書一致と無関係に
毎回問われてよい。duplicate semantic decisionは**あくまで語の意味対応そのものの再質問**を
指し、record-pair対応の確認とは区別する（contract S2参照）。この区別を検証用fixtureの
設計時に明確にする。

---

## S4. Unknown / Conflict caseの検証

S1.1で分離した`unknown-only fixture`と`conflict-only fixture`を個別に用いる（approved alias
fixtureとは混在させない）。

- unknown-only fixtureで、matchingが**停止しない**ことを確認する。
- conflict-only fixtureで、S12.Bの局所化semantics（conflicted lookup keyのみ除外、
  他のnon-conflict entryは利用可能、任意canonicalを選ばない）が実際に機能することを確認する。
- 両fixtureとも、`total comparisons` が dictionary無効時と同数であることを確認する
  （S1.2の適用範囲どおり、これら2 fixtureにのみ本要求を課す。＝辞書layerの有無がbaseline
  matching結果件数に影響を与えない）。
- Conflict candidateがP2-A3のAlias Conflict機構へ正しく還流されること（設計はcontract §23の
  unresolved question 5を参照。具体的な確認方法は後続Checkpointで確定）。

---

## S5. Privacy tests

- private source document本文がDictionary Snapshotへ含まれていないことを、実際に生成された
  Snapshotファイルへ対しprivate marker走査（P2-A3で確立した手法 — SheetJS round-trip +
  Python stdlib zipfile相当の二重scanパターン）を適用して確認する。
- matching tool側のExcel exportへ辞書情報を出力する場合、private dictionary termsが
  shareable相当の出力へ意図せず混入していないことを確認する。
- Dictionary Resolver / Snapshot Loaderが外部AI・cloud・telemetryへの通信を一切行わないことを
  静的scan（既存P2-A2/P2-A3で確立したstatic security scanパターンの再利用）で確認する。

---

## S6. Deterministic Replay tests

- 同一の `TraceRecordSet A/B` + `Dictionary Snapshot` + matching configurationで2回実行し、
  dictionary resolution結果（Resolution Sidecar）が完全に一致することを確認する
  （P2-A3/P2-A4の既存build-A/build-B比較パターンと同種）。
- Dictionary Snapshotの `snapshot_sha256` が、生成のたびに同一内容なら同一hashになることを
  確認する（timestampをhash対象に含めていないことの直接検証）。

---

## S7. Rollback tests

- 誤ったSnapshotを`rollback_target`で前バージョンへ差し戻した後、新しいmatching sessionが
  正しい（rollback後の）Snapshotをpinすることを確認する。
- rollback前に実行済みだった過去のmatching resultが、rollback後も当時pinしていた
  `dictionary_snapshot_id`のまま変化しないこと（過去結果の非破壊性）を確認する。

---

## S8. Invalid Snapshot / Error Boundary tests

- hash不一致・schema不正・内部conflictのある壊れたSnapshot fixtureに対し、contract S10の
  「案B: 辞書を無効化し、ユーザーへ明示した上で既存matchingだけで続行」が実際に発動し、
  (a) matching自体は継続すること、(b) 辞書無効化が画面に明示されること、(c) 一部の
  dictionary entryだけが適用されるケースが存在しないこと、を確認する。

---

## S9. HUMAN-01〜03 Acceptance

- **HUMAN-01**: 統合UIの新規UI要素において、専門語が「日本語主表記 + 英語括弧併記」で
  表示されていることを、対象語彙リスト（候補/代表語/別名/競合/採用/却下/保留/未判定）に対する
  網羅チェックで確認する。
- **HUMAN-02**: 新規追加されるボタン（Dictionary Snapshot読込・辞書メンテナンス起動等）が、
  ボタン名単独で機能を理解できるか、または1行の補助説明を伴っているかをUIレビューで確認する。
- **HUMAN-03**: 新規追加されるfilter（resolution_type等）に、絞り込み内容の説明がUIまたは
  統合マニュアルに存在することを確認する。

---

## S10. Future Windows Integration Acceptance（将来課題）

- 統合後のmatching tool（Windows実行を含む）で、P2-A3同様のWindows No-Install packaging・
  x64/ARM64 runtime整合性チェックが必要になるかどうかは、matching toolの現行配布形態
  （単一HTMLファイル、ローカルbrowser実行）を踏まえて後続Checkpointで検討する。
- P2-A3のWindows実機受け入れ（現状 `PENDING HUMAN / INTEGRATION ACCEPTANCE`）と、
  P2-A4統合後のmatching tool側のWindows実機受け入れは、**別々の受け入れ項目として管理する**
  （一方のPASSが他方を代替しない）。

---

## S11. Contract R2/R3改訂に対応する検証項目（R2-6で新設、R3-4で追記・修正）

Checkpoint 1-R2/R3で行ったcontract文書の改訂（S13/S13.1/S4.1/S5.2/S5.4/S6.3-S6.4）に対応する
検証項目を追加する。いずれも実装Checkpointでverification scriptへ落とし込む**計画**であり、
本Checkpointでは実測しない。

**R3-4での修正点**: #2/#3をS4.1のR3-1改訂（Option A採用）に合わせて修正、#4を
S5.2のR3-2改訂（`wrapper_integrity_sha256`対象範囲の拡張）に合わせて修正。#8以降をR3-4で新設。

| # | 検証項目 | 対応するcontract節 | 検証方法（案） |
|---|---|---|---|
| 1 | 正式辞書（`effective_vocabulary`由来の情報）が`matchLogic.synonymMap`へ一切混入しないこと | S13（R2-1） | Resolver実行前後で`matchLogic.synonymMap`のkey集合を比較し、差分がないことを確認する。また`_tagInfo.approvedDict`のsource実装が`synonymMap`へ書き込むcode pathを持たないことを静的確認する |
| 2（R3-4で修正） | P2-A1 `mergeDictionaryLayersWithProvenance()`が返す`effective_vocabulary`が、既存`mergeDictionaryLayers()`の戻り値とbyte/deterministicに一致すること | S4.1（R3-1） | 同一のlayerViews入力に対し、(a) 既存`mergeDictionaryLayers()`を直接呼んだ結果の`effective_vocabulary`と、(b) 新設`mergeDictionaryLayersWithProvenance()`が返す`effective_vocabulary`を、`canonicalJson()`でcanonical化した文字列同士で完全一致比較する。1文字でも異なれば新APIが既存契約を壊したとみなしFAILとする |
| 3（R3-4で修正） | Resolution provenance（`provenance_index`）が決定的に再現可能であること | S4.1（R3-1） | 同一のlayerViews入力で`mergeDictionaryLayersWithProvenance()`を2回呼び、`provenance_index.canonical`/`provenance_index.alias`の`selected_entry_ref_id`/`selected_scope`/`selected_status`/`selected_dictionary_fingerprint`が完全一致することを確認する（S6 Deterministic Replay testsと同種の手法） |
| 4（R3-4で修正） | immutable wrapper fieldの1byte改変で`wrapper_integrity_sha256`が変化すること（対象外fieldがゼロであることの実証） | S5.2（R3-2） | S5.1の全immutable field（`wrapper_schema_version`/`snapshot_id`/`dictionary_payload_sha256`/`snapshot_version`/`scope`/`provenance`/`source_review_artifact_identity`/`promotion_record_identity`/`source_commit`/`conflict_state`/`supersedes`/`rollback_target`の12種、`wrapper_integrity_sha256`自身を除く）それぞれについて個別に1byte改変し、そのすべてで`wrapper_integrity_sha256`が変化することを確認する。1つでも変化しないfieldがあればFAILとする（R3-2で「対象外fieldをゼロにする」とした契約の直接検証） |
| 5 | 同一のdictionary payloadから同一の`dictionary_payload_sha256`が得られること | S5.2（R2-3） | 同じ`dictionary_payload`を異なるwrapper metadata（異なる`snapshot_id`/`snapshot_version`等）で2つのwrapperへ包み、`dictionary_payload_sha256`が2つとも一致することを確認する。R3-2により`wrapper_integrity_sha256`は`snapshot_id`等の差により**必ず異なる**ことも合わせて確認し（R2-6版では「異なるmetadataでも同一になりうる」余地があったが、R3-2でこの余地は排除された）、2つのhashの責務分離を実証する |
| 6 | project configurationのsnapshot pin先切り替えが進行中sessionへ影響しないこと | S14/S5.4（R2-4） | snapshot Aへpinされた状態でmatching sessionを開始し、途中でproject configurationのpin先をsnapshot Bへ切り替える。進行中sessionの`dictionary_snapshot_id`/`wrapper_integrity_sha256`がsnapshot Aのまま変化しないこと、かつ次回session開始時にのみsnapshot Bが適用されることを確認する |
| 7 | `SELECT_CANONICAL`が非選択candidateを誤って除外・無効化しないこと | S6.3（R2-5） | conflict-only fixture（S1.1）に2件以上のconflicting candidateを含め、`SELECT_CANONICAL`で1件を選択した後、非選択candidateが独立した`candidate_decisions`の状態（ACCEPT等）に従ってpromotion対象と判定されうることを確認する（`SELECT_CANONICAL`という解決自体を理由に強制的に対象外化されていないことを検証する） |
| 8（R3-4で新設） | duplicate同一canonicalマッピングでもprovenanceが曖昧にならないこと | S4.1（R3-1） | 同一canonical_keyを2つ以上のlayer（例: SESSIONとPROJECT両方）が主張するfixtureを用意し、`provenance_index.canonical["<key>"].selected_entry_ref_id`が、`SCOPE_PRIORITY`上位1件（同点ならordinal順で先頭）の`entry_ref_id`と一致し、かつ常に単一値（配列でない）であることを確認する |
| 9（R3-4で新設） | approvedDict由来tagがhigh-frequency pruningの対象になること | S13.1項目7/8 | `_tagInfo.approvedDict`にのみ由来する高頻度tag（`highFrequencyRatio`閾値以上の行で出現）を含むfixtureを用意し、`buildTagIndex()`の`ignoredForPruning`に含まれ、`effectiveNonCodeTagSet()`から除外されることを確認する。同一tagが同時に`explicit`にも由来する場合は除外されない（既存`.dict`の挙動と対称であること）ことも確認する |
| 10（R3-4で新設） | approvedDictのsource priorityが`composeFinalTags()`の切り詰めで機能すること | S13.1項目4 | `maxTagsPerRow`を小さく設定したfixtureで、`explicit`/`approvedDict`/`dict`/`code`が競合する場合に、`approvedDict`由来tagが`dict`由来tagより優先して残ることを確認する（S13.1で定めた`manualAdd, explicit, approvedDict, dict, code`の順序を直接検証する） |
| 11（R3-4で新設） | approvedDict由来tagに対する`manualRemove`の適用 | S13.1項目5 | approvedDict由来のtagを`manualRemove`で指定した場合、`composeFinalTags()`の最終`_tags`から除外されることを確認する（他sourceと同じ除外挙動であることの直接検証） |
| 12（R3-4で新設） | `maxTagsPerRow`境界でのapprovedDict扱い | S13.1項目6 | `maxTagsPerRow`ちょうどの件数・1件超過の境界値fixtureで、approvedDict専用の予約枠が存在しない（他sourceと同じ共有上限に従う）ことを確認する |
| 13（R3-4で新設） | approvedDictとad hoc dictのprovenance分離（stats/evidence） | S13.1項目10 | 同一tagが`.dict`のみ／`.approvedDict`のみ／両方、の3パターンでfixtureを用意し、`tagSourceSetForRow()`の返す集合がそれぞれ正しく`dict`/`approvedDict`/両方を含むこと、`evaluateTagMatch()`のevidenceから当該sharedTagの由来source集合を辿れることを確認する |

---

## S12. 本Checkpointでの結論

Checkpoint 1では上記すべてが**計画のみ**であり、実測・実装は行っていない。後続Checkpointで
Dictionary Resolver・Promotion Validator・Snapshot生成が実装された時点で、本書のtest caseを
具体的なverification scriptへ落とし込む。
