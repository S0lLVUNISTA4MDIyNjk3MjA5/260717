Private Dictionary Matching Integration Contract 0.3 — Explicit Nested Dictionary Projection
==============================================================================================

状態: Human承認済み仕様（2026-10-06のHuman指示本文D1〜D8、およびselection mechanismに関するHuman決定
「Option 1: session-scoped host API」が根拠）。通常のdictionary matching correctness機能である。

## S0. 0.1 / 0.2との関係（継承と変更点）

- 本書は `private_dictionary_matching_integration_contract_0.2.md`（以下「0.2」）を**基礎として継承**し、0.2を通じて
  `private_dictionary_matching_integration_contract_0.1.md`（以下「0.1」）を継承する。本書が明示的に上書きしない
  0.1 / 0.2の規定は、すべて0.3でも**そのまま有効**である。
- **0.1 / 0.2は変更しない。** 0.1はwhole-value only、0.2はcontrolled delimiter fallbackのhistorical / baseline contractとして
  保存する。0.1 / 0.2の記述の意味は書き換えない。
- 0.3が追加するのは **Explicit Nested Dictionary Projection** のみである:
  トップレベルfieldに加えて、`source_record` / `table_row` の**直下1階層**にある、**Human/userが明示的に選択した列**の
  string / finite number値を、private dictionary resolutionの入力termとして供給する。
- 0.1 S13.1の「object値はapprovedDict resolution対象外」は、**トップレベルの値**については変更されない。
  `source_record` / `table_row` というobject**そのもの**は、0.3でも引き続きtermにならない（S6）。
  0.3が許すのは、そのobjectの直下にある明示選択済みのscalar列値だけである。
- Resolver core（0.1 S4.2）、`KnowledgeIdHashUtils.normalize()`、Resolver annotationの8 field、matching score、
  candidate ranking、ACCEPT / REJECT、semantic matching、canonical matching、review stateは変更しない。

## S1. 範囲（D1）

- nested値を利用するのは **private dictionary resolutionのみ**である。
- 次は**対象外**（0.3では行わない）: semantic matchingのfield candidate生成（`availableJsonKeys`・key-pair自動推定・
  direct field matchingへのnested列の追加）、canonical matching（数量sidecar contextの一階層射影は参考前例にすぎず、
  canonical matchingへnested値を投入しない）、score formula、ranking、ACCEPT / REJECT、review-state semantics。
- nested値のdictionary resolutionにより既存の`_tagInfo.approvedDict` tagが増え、その既存tag入力を通じて照合結果が
  変化し得ることは認める（0.2 S10と同じ境界）。matching algorithm自体は変更しない。

## S2. 対象container・depth・許可value（D2）

- 対象container（origin）は **`source_record`** と **`table_row`** の2つだけである。
- depthは **直下1階層のみ**。再帰は禁止する。nested arrayは扱わない。
- 許可value: **string** と **finite number**（`Number.isFinite`がtrue）のみ。
- 対象外（そのfieldだけをskipする）: boolean、null、undefined、object、array、array of object、function、
  その他のcomplex value、非有限number（NaN / Infinity）。
- 既存のトップレベルarrayのsemantics（0.1 S13.1、0.2 S2）は変更しない。

## S3. Explicit allowlist（D3・D5）

- nested objectのすべての列を自動で読むことは**禁止**する（automatic column discovery禁止）。
  対象列は **Human/userが明示的に選択した列だけ**である。
- allowlistの各itemは、少なくとも次の2つを区別できなければならない:
  - **origin**: `source_record` または `table_row`
  - **field**: 元の列名そのもの（exact column name）
  origin + fieldを1本のdotted path文字列（例: `source_record.Part Name`）へ**潰してはならない**。
- **ordering**: nested列の抽出順序は、**allowlistでHuman/userが指定した順序**とする。alphabetical sortを加えない。
  `Object.keys()`の偶然の順序に依存しない。`table_headers`は元表の順序を示すprovenanceとして参照してよいが、
  `table_headers`に存在するだけで自動的に対象にしてはならず、dictionary extractionの順序はallowlist指定順を優先する。
- トップレベルfield（`tagSourceFields()`）の抽出順序は0.1 / 0.2のまま変更しない。nested列の抽出は、
  既存のトップレベル抽出の**後に**、allowlist順で行う。

### S3.1 Selection mechanism: session-scoped host API（Human決定: Option 1）

リポジトリ内に再利用可能な既存のnested列選択機構は存在しない（`availableJsonKeys`・key-pair選択は
トップレベルfield専用）。そこで0.3の**正式な選択機構**を、`PrivateDictionaryMatchingSession`上の
**session-scoped host API**とする。このAPIがexplicit allowlistを設定する唯一の経路である。

- **API**: `PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(items)`。
  既存のsession APIの命名（`setSnapshot` / `setProjectPin` / `clearSnapshot` / `getStatus`）に従う。
  同義のAPI（別名・別経路）は作らない。読み出しは既存の`getStatus()`の拡張ではなく、
  同APIの返却値（設定後の正規化済みallowlist）で確認できる。
- **item shape**: 各itemは **`origin`** と **`field`** の2つだけを持つ `{ origin, field }`。
  追加のpropertyを持つitemは不正とする（黙って無視しない）。
- **許可origin**: `source_record` と `table_row` のみ。トップレベルfieldは**このAPIでは設定できない**
  （`top_level`はorigin不正）。トップレベル抽出（`tagSourceFields()`）は0.1 / 0.2のまま変更しない。
- **fail-closed validation（set時）**: 次のいずれかがあればallowlist全体を拒否し、**既存のallowlistを変更しない**
  （部分適用なし）。
  - `items`が配列でない
  - itemがplain objectでない／`origin`または`field`以外のpropertyを持つ
  - `origin`が許可originでない
  - `field`が文字列でない、空文字列、または空白のみ
  - **`origin + field`が重複**（黙ってdedupしない。重複は不正）
  新しい文字種の制限は追加しない（列名に`.`等を含んでよい）。`field`は元の列名をそのまま保持する
  （trim・正規化・小文字化をしない）。
- **空list**: `[]`は有効であり、**nested projectionを無効にする**（既定状態と同じ）。
  allowlistが空のとき、照合結果（pair / method / score / ranking / ACCEPT・REJECT / `approvedDict` tag / row sidecar /
  queue item / canonical / review state）は0.2と**byte-identical**でなければならない。唯一の差は、projection・Excel・
  queue sheetが追加属性`source_origin`（全て`top_level`）を持つことだけである（S9）。
- **順序**: 配列の順序がそのまま抽出順序である。sort、object key順、`table_headers`による並べ替え、
  dedup後の並べ替えを行わない。
- **ownership / lifecycle**: allowlistは**session-local**な状態である。既定は空。setterで変更でき、
  sessionとともに消える。別のsessionへ継承しない。setterは入力配列の**防御コピー**を保持し（freezeする）、
  呼び出し側が後から元の配列やitemを変更しても挙動は変わらない。setterの呼び出しはsnapshotの設定・解除
  （`setSnapshot` / `setProjectPin` / `clearSnapshot`）とは独立であり、snapshotの状態を変えない。
  設定されたallowlistは**次回のmatching実行**から有効である（setter自体は再照合を起動しない）。
  setterの結果が**実際に内容を変える**場合のみ、snapshot変更と同様に既存の照合結果をstale（再照合が必要）として扱う。
  同一内容の再設定は変更ではない。1回のmatching実行は、開始時点のallowlistを使用する。実行中にallowlistが変更された
  場合、その実行の結果は（snapshot変更時と同様に）破棄され、部分的な混在状態を残さない。
  setterは設定後の（freezeされた）allowlistを返す。plain objectの判定はrealm非依存（prototypeがnullまたはroot prototype）とする。
- **永続化しない**: config / profile schema、localStorage、profile JSON、review artifact、その他いかなる永続化も行わない。
  **0.3にselection UIは無い**。**automatic column discovery（自動列探索）は行わない**。
  allowlistに無い列は、nested objectに存在してもdictionary resolutionの入力にならない。

### S3.2 Allowlist mutation semantics（Human承認）

nested allowlistはdictionary Resolverへ供給する入力集合を変える。したがって、**意味内容が実際に変化**した場合、
既に計算済みのdictionary / matching由来の結果を現行のものとして残してはならない。

- **semantic change → 既存の導出結果をstale化する。** stale化は、Snapshot変更時と同じ**既存の**無効化機構
  （`markTraceTagsDirty` / `tagIndexCache`の破棄 / `markTraceMatrixStale`）をそのまま再利用する。
  新しい独立のinvalidation frameworkは作らない。
- **同一allowlistの再設定は no-op** である（stale化しない・cacheを破棄しない）。
- **順序は意味内容の一部**である。要素が同じでも順序が変わればsemantic changeとして扱う（stale化する）。
- `[]` → `[]` は変化ではない。populated → `[]` は変化である。`[]` → populated は変化である。
- **invalid setter callは状態を変えない**（S3.3）。stale化もしない。
- 1回のmatching実行は開始時点のallowlistを使い、実行中に変更された場合はその実行結果を破棄する（S3.1）。

### S3.3 Validation failure semantics（Human承認）

- invalid inputでは、**`APPROVED_DICT_NESTED_ALLOWLIST_INVALID`** をcodeとして持つErrorを**throw**する。
  これは正式仕様であり、既存のsetter（`setSnapshot` / `setProjectPin`）のerror convention
  （`code`付きError、messageは入力を含まない）に従う。
- **atomic rejection**: 一部のitemだけを採用する部分適用は禁止する。fail-closed。
- **previous valid allowlistを保持**する。
- derived state（row sidecar / `_tagInfo` / warning code等）を変更しない。**stale化もしない。**

### S3.4 Selection UI binding / read accessor（Human承認・UI bindingのみ。core semanticsは変更しない）

**Read accessor.** `PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist()` は、現在sessionに設定されている
ordered allowlistを返す**read-only**のAPIである（Selection UIがHost側の変更と同期するための用途）。
- 順序・origin・exact fieldを保持する。呼び出しごとに**新しい複製**を返し、呼び出し側が返却値を変更しても
  session stateは変わらない（内部参照を返さない）。
- nested projection allowlist専用であり、Snapshot / Pin / Resolver / status / tag / profileの状態を含めない。
  `getStatus()`のshapeは変更しない。同義のAPIは作らない。永続化しない。

**Selection UI（setter / getterのfront endであり、新しい意味を持たない）。**
- 配置: 「入力・実行」領域の辞書Snapshot / Project Pin設定の隣にある、折りたたみ式の小panel。session-onlyであることを表示する
  （logic profile / profile JSON / localStorage / review artifact / export workbook / 永続設定には保存されない）。
- 候補列: 読み込み済みの**全row（JSON A、続いてJSON B）を1回走査**したunionで、`source_record` / `table_row`それぞれの
  own enumerable keyを、**初出順**（row順 → rowごとのkey出現順）で列挙する。先頭N行・120行制限・alphabetical sort・
  `table_headers`起点の列挙は行わない。候補にはorigin、exact field、出現row数、supported value（string / finite number）row数、
  A/B側の存在を持たせる。表示順はallowlist順とは別である。
- 選択不可の候補: supported value数が0の列、およびsetterが拒否する空・空白のみの列名は、非表示にせず**選択不可**として理由付きで表示する。
  同名fieldでもoriginが違えば別候補。identityは`origin + exact field`（dotted pathやtrim名にしない。sideを含めない）。
- 選択: 明示的なcheckboxのみ（自動選択・全列選択なし）。選択中リストは順序番号・origin・fieldを示し、▲ / ▼ / 削除を持つ
  （先頭の▲・末尾の▼は無効）。同一identityを重複して追加できず、UIからはsetterが受理するallowlistだけを構築する。
- 適用: 編集中のdraftは「適用」で**1回だけ**setterへ渡す。「クリア」は`[]`の適用と同義。**自動再照合はしない**
  （S3.2の既存stale / 無効化機構をそのまま使う）。setterがthrowした場合、適用済み表示は変えず、codeに基づく簡潔なエラーのみ表示する。
- 同期: UI refresh時に適用済みallowlistをgetterから読み直す。編集中にHostが変更した場合は、draftを保持したまま外部変更を表示する。
- reload: 候補は再列挙するが、**適用済みallowlistは自動削除しない**。新しい入力に無いitemは選択中リストに残し、
  「現在の入力には存在しない」と表示する。後で同じidentityが現れれば同一itemとして扱う。
- 前提: Snapshot未設定やタグ生成条件の不成立でもUIは操作可能で、「現在の設定では照合結果へ反映されない」旨を表示する。
- 永続化・side別allowlistは行わない。

## S4. Provenance（D4・D6・D7）

- 各nested由来annotationは、既存のSource Field Attribution（0.1 S30.17）の `annotation_source_fields[]` と同様に、
  `annotations[]`とindex対応する並行属性で出所を持つ。
- **`source_field`**: 内側の**元の列名そのもの**。dotted pathを`source_field`に格納しない
  （列名に`.`が含まれ得ること、トップレベルfieldとの衝突、既存の数量sidecar contextにorigin分離の前例があることによる）。
- **`source_origin`**: 出所のcontainerを表す別属性。値は次の3つ:
  - `top_level` — トップレベルfield（0.1 / 0.2の既存挙動。既存のtop-level annotationの既定値）
  - `source_record`
  - `table_row`
  既存の数量sidecar contextは同趣旨の属性を`projection_origin`（`'top_level' | 'source_record'`）と呼ぶ。
  語彙の重複を避けるため、`source_origin`は`projection_origin`と**同じ値の語彙**（`top_level` / `source_record`）に
  `table_row`を加えたものとし、同義のfieldを複数作らない。
- provenance identityは **`source_origin + source_field`** である。同名の列でも、origin違い
  （`source_record.name` / `table_row.name` / トップレベル`name`）は**別のsource**であり、混線させない。
  トップレベルfieldの命名・semanticsはnested projectionのために変更しない。
- **sidecar表現**: row sidecar（`_approvedDictResolution`）の`annotation_source_fields[]`に加えて、
  `annotations[]`・`annotation_source_fields[]`とindex対応する並行配列 **`annotation_source_origins[]`**
  （値は`top_level` / `source_record` / `table_row`）を持つ。Resolverの8 field annotation contractは変更しない。
  **row内にtop_level以外のoriginを持つannotationが1件以上ある場合にのみ**`annotation_source_origins[]`を持つ。
  それ以外（allowlistが空、または対象列からtermが得られなかったrow）のsidecarは0.2と同一の形のままとし、
  配列を持たない。
- **legacy**: `annotation_source_origins[]`を持たないsidecarは、全annotationを`top_level`として扱う
  （この配列を持たないsidecarはnested projection導入前、またはnested由来annotationを含まないsidecarであり、
  top_levelとして安全に解釈できる場合に限る）。nested由来のprovenanceを推測で補わない。
  配列が存在する場合は、`annotations[]`と同じ長さで、各値が上記3値のいずれかでなければならない。
  違反するsidecarはprojectionで**atomicにmalformed**として扱う（既存の`annotation_source_fields[]`と同じ扱い）。
- nested由来のannotationについて、最低限次を追跡できること: side、row_id、trace_id、source_origin、source_field、
  original_term、resolution_type、resolved_canonical、snapshot identity、scope。
- `original_term`の意味は0.2 S8のまま（Resolverへ実際に渡したterm。0.2のfallbackが採用されたときはsplit token）。
  nested値の元の値全体は、既存のrow / `source_origin` / `source_field`から追跡可能である。

## S5. Value semantics と衝突・失敗時の挙動（D6・D7）

- **string**: 既存のtop-level dictionary termと同じく扱う。**finite number**: `String(value)`による通常の決定的文字列表現。
- **null / undefined**: skip。**空文字列 / 空白のみ**: 既存top-level dictionary semanticsと同じくskip。
  **256文字超**: 既存の制約を維持してskip（nestedであることを理由に緩和しない）。boolean: 対象外（skip）。
- **allowlistされたfieldがそのrowに存在しない**: そのfieldをskipする。rowを拒否しない。
- **allowlistされたfieldのvalueが対象外型**（object / array / boolean等）: そのfieldだけをskipする。
  既存のskip accountingがあれば再利用する。
- **同名の列**: `source_record.name`と`table_row.name`、およびトップレベル`name`とnested `name`は、originが異なるため
  **共存可能**であり、互いを置き換えない。
- **予約された技術field**: 既存contractに明確なreserved ruleがあればそれに従う。明確なruleが無い場合、新しい
  reserved denylistを推測で作らない（allowlistが明示選択であることが、技術列の混入を防ぐ主たる手段である）。

## S6. termにしてはならないもの

次は禁止する: `source_record` / `table_row`のobjectそのもののterm化、`JSON.stringify(source_record)` /
`JSON.stringify(table_row)`、object key名そのもののdictionary term化、keyとvalueの自動連結。
dictionary termになるのは、**明示allowlistされたfieldのsupported scalar value**だけである。

## S7. 0.2との統合（処理順序）

nestedから取得したsupported scalar valueには、0.2の既存処理をそのまま適用する:

```
explicit nested extraction (allowlist order, one level)
  → whole-value Resolver
  → UNKNOWN_TERMの場合のみ 0.2のdelimiter fallback
  → annotations
  → provenance (source_origin / source_field)
  → UNKNOWN_TERM Review Queue
```

nested専用のdelimiter / tokenizationを作らない。tokenization logicは0.2の1つだけである。

## S8. UNKNOWN_TERM Review Queue

nested由来の`UNKNOWN_TERM`も、既存のReview Queue（0.1 S30.17.2）へ流す。別queueは作らない。
queue itemで`source_origin`と`source_field`を追跡できること。queueのidentityは0.1 S30.17.2の定義
（side、row_id、source_field、original_term、occurrence_index）に`source_origin`を加えて、origin違いの同名列を区別する。
queueの永続化形式は引き続き未確定（PERSISTENCE CONTRACT NOT SUFFICIENTLY FIXED）であり、本書は定義しない。

## S9. 表示（Detail / Graph / Excel）

nested annotationについて、Humanが少なくとも origin / field / original term / resolution を判別できるようにする。
既存のprojectionで自然に追加できる場合のみ変更し、必要最小限に留める。大規模なUI変更は行わない。
`辞書照合根拠` sheetの既存列の位置は変更しない（`source_origin`は末尾に追加）。`辞書未登録語` sheetも同様に`source_origin`を末尾に追加する。

- **projection**: 各annotationが`source_field`に加えて`source_origin`を持つ（legacy sidecarは`top_level`）。
- **Detail / Graph**: `top_level`の表示は0.2と同一（origin表記を加えない）。nested annotationのみ、Detailは
  `origin:<source_origin> field:<source_field>`、Graphは`由来元: <source_origin> 由来項目: <source_field>`を示す。
- **UNKNOWN_TERM queue panel**: nestedのoccurrenceは`<source_origin> / <source_field>`で表示する（top_levelは従来どおり
  field名のみ）。queue itemは`source_origin`を持つ。occurrence_idは、top_levelでは0.2と同一の形式、nestedでは末尾に
  originを追加した形式とする（identity = side, row_id, source_origin, source_field, original_term, occurrence_index）。

## S10. Matching impact boundary

- 許容される変化は、**明示選択されたnested列のdictionary解決により、既存の`approvedDict` tag入力が増えること**に
  起因する結果変化だけである。
- 変更禁止: scoring formula、ranking algorithm、ACCEPT / REJECT algorithm、semantic matching algorithm、
  canonical matching algorithm、tag matching algorithm自体、Resolver semantics、review state。
- nested projectionを利用しない入力（allowlistが空、または対象列が無い場合）は、0.2と同一の結果となる。

## S11. Scope外（0.3でも対象外）

nested array、object arrayの再帰、boolean、複数階層、nested列のsemantic / canonical matching、自動列探索、
selection UI、allowlistの永続化（config / profile schema / localStorage / profile JSON / review artifact）、
STANDARD/DOMAIN/SESSION layer integration、
dictionary auto-feedback、auto-learning、queue persistence format、辞書への自動登録・承認。
