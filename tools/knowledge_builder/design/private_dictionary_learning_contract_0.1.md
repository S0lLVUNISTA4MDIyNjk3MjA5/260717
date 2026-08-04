# Private Dictionary Learning Contract 0.1（P2-A1 提案）

**状態**: 提案 / レビュー待ち（未実装・未固定）
**方針**: P2-A1は「非公開辞書のデータ契約とpure関数境界」だけを固定する。抽出・matching統合・
自動学習policyは一切含まない。
**作成日**: 2026-08-04
**先行調査**: P2-A1 Step 3 (read-only architecture reconnaissance, HEAD `3f23e67`)
**訂正1 (Step 4R)**: §7の全角スペース(U+3000)に関する誤記述を訂正
（NFKCが`<wide> 0020`としてU+3000をU+0020へ変換するため、既存`normalize()`だけで
連続空白圧縮の要件を満たす。追加ラッパー計画は削除）。§4のRETIRED/rollback記述を
明確化（RETIREDはentry状態遷移の終端であり、rollbackはentry単位の遷移ではなく
version/snapshot全体の復元操作であることを明記）。
**訂正2 (Step 4R2)**: private dictionaryを既存`tag_vocabulary`へ重ねる
「tag vocabulary overlay」として意味を固定。STANDARD入力contract
（`createStandardDictionaryLayerView()`）を新設。lookup key／conflict範囲を
canonical-canonical／canonical-alias／alias-aliasの3分類で固定。
`mergeDictionaryLayers()`の戻り値schemaを固定。canonical fingerprintの算法を
`hashParts()`から「canonical UTF-8 bytesへの直接SHA-256」へ訂正。lookup key hashの
機密上の限界を明記し`normalized_key_token`へ改称。opaque IDを正規表現でvalidation
可能にした。parse/validation境界（byte制限・duplicate key等）を補強。
`source.kind`と初期statusの整合を修正。memory lifetimeをfail-closed化し、
reset APIを実体としては持たない設計へ修正。§23をStep 4 design-onlyの未実装と
P2-A1全体の未実装へ分離。
**訂正3 (Step 4R3)**: private dictionary snapshotのvalidationが`source.kind`
だけを理由に`status`を制限していた誤りを修正（以前`PROBATION`から`ACTIVE`へ
正当に昇格したentryを再importできなくなる問題を解消。initialization policy
（新規entry生成時のみ`DOCUMENT_EXTRACTED`／`SYSTEM_DERIVED`を`PROBATION`固定）は
P2-A2へ分離）。canonical対canonicalの比較が性質上conflictを生まないことを明記し
（§8.2.1）、conflict recordのcodeを`DICTIONARY_ALIAS_CONFLICT`から
`DICTIONARY_LOOKUP_CONFLICT`へ改称。verification項目#49をstateful性を前提と
しない形（core exports no stateful reset or persistence API）へ差し替え、
DOMAIN/PROJECT再import等のsession統合検査はP2-A2 deferred verificationへ移動。
`createStandardDictionaryLayerView()`をfail-closed化（不正なtag_vocabularyを
黙って空へ変換しない）。`dictionary_fingerprint`の算出方法を
`await hashPrivateDictionaryCanonical(dictionary)`の1通りに一意化し、関連する
`createPrivateDictionaryLayerView()`／`normalizePrivateDictionary()`／
`hashPrivateDictionaryCanonical()`を`async`と明記。
**訂正4 (Step 5)**: STANDARD fingerprintを既存`KnowledgeStore`の正式方式
（`hashParts("tag-vocabulary-v1", [canonicalJson(payload)])`）と整合させ、
`vocabulary_sha256`欠落時（`DEFAULT_TAG_VOCABULARY`を含む）は再計算した
fingerprintを使用、供給された`vocabulary_sha256`が存在する場合は再計算値との
完全一致を要求するfail-closed契約へ修正（§5.6.1）。内部layer viewの
`entry_id`を`entry_ref_id`へ改称し、STANDARD entry用の決定的ID導出方式
（`std-`prefix、§5.6.2）を新設。conflict recordの参照fieldも
`entry_ref_id`（`^(pde|std)-[0-9a-f]{32}$`）へ統一。`hashParts()`が
非同期であることに整合させ、`createStandardDictionaryLayerView()`／
`detectDictionaryLookupConflicts()`／`mergeDictionaryLayers()`／
`createSanitizedLearningSummary()`を`async`化し、`createSanitizedLearningSummary()`
は外部から渡されたfingerprintを信用せず内部で再計算する契約へ修正。
`serializePrivateDictionaryCanonical()`の戻り値を「textまたはbytes」から
「canonical JSON string」の1通りへ一意化。§10のvalidation条件番号の欠番
（28→30）を連番（28→29）へ整理。Verification Planへ#60-#65を追加し、
計65項目とした。

---

## 1. Purpose

P2-A1が対象とするのは次に限定する。

- 非公開辞書（private dictionary）のデータ契約
- **private dictionaryは、既存`tag_vocabulary`へ重ねる「tag vocabulary overlay」
  として定義する**（詳細は§3参照）
- deterministic normalization（正規化キーの決定的な導出規則）
- fail-closed validation（allowlistで拒否条件を明示し、不明な形は常に拒否する）
- dictionary layer統合（STANDARD/DOMAIN/PROJECT/SESSION の合成規則）
- lookup keyとconflict範囲の固定（canonical-canonical／canonical-alias／
  alias-aliasの3分類、§8参照）
- canonical serialization（byte-identicalな出力）とcanonical fingerprint
  （canonical UTF-8 bytesへの直接SHA-256、§13参照）
- Knowledge JSONへ格納するsanitized binding（`dataset.extensions.dictionary_binding`）
- sanitized learning summary（辞書本文を含まない集計出力）
- import/exportの純関数境界（filesystem/Blob/download非依存のpure API）
- 後続自動学習(P2-B/P2-C)が利用する状態contract（status enumと許可遷移）

### Tag Vocabulary Overlayとしての性質（明記）

- **private dictionaryは独立した全文検索辞書ではない**。既存`tag_vocabulary`
  （`{allowed_tags, aliases}`）と同じ形（canonical tag + aliasの対応関係）を
  DOMAIN/PROJECT/SESSION layerとして重ねるものであり、まったく別の検索機構では
  ない。
- **`relation_candidate_engine.js`へ直接synonym scoreを渡す辞書ではない**。
  P2-A1が生成するのはあくまでpureな`effective_vocabulary`（§14参照）というview
  であり、matching engineのscoring入力を新設・変更するものではない。
- 後続（P2-A2以降）では、`effective_vocabulary`を`matchInitialTags()`
  （`excel_direct_adapter.js`/`pdf_direct_adapter.js`）へ渡すことを想定する。
  P2-A1では**この接続は行わない**。
- Candidate scoreへ影響しうるのは、あくまで**Nodeへ付与されたtagを介した間接影響**
  である（`relation_candidate_engine.js`の`tagOverlap()`は既にNode.tagsを見ている
  ため、tag付与結果が変われば間接的にoverlapが変わりうる、という既存の仕組みの
  延長でしかない）。
- **score formula自体（`0.6 * textSim + (overlap.length ? 0.4 : 0)`等）は
  P2-A1では変更しない**。

### P2-A1では実装対象外（明記）

次はP2-A1のcore/verification/design、いずれにも含めない。

- PDF／Excelからの語句抽出
- alias推定（類似度・編集距離・AI推定を含む一切の自動alias生成）
- matchingへの適用（`matchInitialTags()`／`relation_candidate_engine.js`への接続）
- Candidate score変更
- utility計測（実測ロジック。`utility.*` fieldは"型と初期値0"の契約のみ固定する）
- 自動昇格policy（PROBATION→ACTIVE等をいつ行うかの判断基準）
- 自動隔離policy（ACTIVE→QUARANTINED等をいつ行うかの判断基準）
- rollback実行（rollbackはentry単位の状態遷移ではなく、辞書version/snapshot全体の
  復元操作である。§4.1でこの区別とAPI名を定義するが、実行ロジックは実装しない）
- UI import/export（ファイル選択・download呼び出し）
- 自動保存
- 永続化（localStorage/sessionStorage/IndexedDB等、いかなる形でも）

---

## 2. Human/System Boundary

### 人が明示的に行う操作

- PDF／Excel import（既存境界。変更なし）
- private dictionary import
- Knowledge JSON export（既存境界。変更なし）
- private dictionary export
- learning summary export

### システムが将来、自動実行する処理（P2-A2以降）

- 語句抽出
- SESSION辞書登録
- 辞書適用前後比較
- utility計測
- PROJECT辞書への昇格
- 隔離
- rollback

### P2-A1 coreの責務境界

P2-A1 coreはファイル選択やdownloadを**開始しない**。呼出側（将来のUI層）から渡された
JSON textまたはplain objectだけを処理する。これは既存の`core/*.js`全体の設計方針
（§14参照。UMDのpureモジュールはbrowser/Node双方から呼べるが、FileReader/Blob等の
ブラウザ専用APIには一切触れない）と同一である。

---

## 3. Dictionary Layers

正式なlayerを次の4つとする。

| Layer | 意味 | 変更主体 |
|---|---|---|
| `STANDARD` | 既存`tag_vocabulary`相当の、製品が既定で持つ語彙 | 製品配布物 |
| `DOMAIN` | 業種・案件横断で共有される辞書 | 人（import） |
| `PROJECT` | 案件単位の辞書。昇格された学習結果を含みうる（P2-B/P2-C以降） | 人（import）／将来は自動昇格 |
| `SESSION` | 現在の作業セッションに閉じた一時辞書 | 将来は自動学習（P2-A2以降） |

### 3.1 各entryが表す意味（tag vocabulary overlayとして）

| field | 意味 |
|---|---|
| `canonical_term` | canonical tagの表示値（既存`tag_vocabulary.allowed_tags`の1要素に相当） |
| `aliases[]` | 入力文書内の表記からcanonical tagへ解決する別表記（既存`tag_vocabulary.aliases`の`{alias: canonical}`対応に相当） |

### 3.2 statusごとのeffective vocabularyへの参加

| status | 参加するeffective vocabulary |
|---|---|
| `ACTIVE` | 通常の`effective_vocabulary`（allowed_tags/aliases）へ参加する |
| `PROBATION` | 通常の`effective_vocabulary`へは参加しない。Trial用の`effective_vocabulary`
  （P2-B以降のcounterfactual matching専用）だけへ参加予定 |
| `OBSERVING` | 通常のeffective vocabularyへ参加しない |
| `QUARANTINED` | 通常のeffective vocabularyへ参加しない |
| `RETIRED` | 通常のeffective vocabularyへ参加しない |

DOMAIN／PROJECT／SESSIONのACTIVE entryは、`STANDARD`に存在しない**新しいcanonical
tagも追加可能**とする（`effective_vocabulary.allowed_tags`は、STANDARD由来の
canonical tag集合と、DOMAIN/PROJECT/SESSIONのACTIVE entryが導入する新規canonical
tag集合の**和集合**になる。§14.4参照）。

ただしP2-A1では、`effective_vocabulary`を実際にadapterやmatching engineへ**接続しない**
（§1参照）。P2-A1が生成するのは、pureな`effective_vocabulary` view（§14.4のmerge結果
schema）までである。

### lookup priority

```
SESSION > PROJECT > DOMAIN > STANDARD
```

上位layerほど優先してlookupされる。ただし**priorityは無条件上書きを意味しない**。

### Conflict規則（layer統合時の概要。詳細は§8）

同じnormalized lookup keyが異なるnormalized canonical keyへ対応する場合:

1. 一方を黙って採用しない（priority順で自動的に片方を握りつぶさない）
2. conflict recordを生成する（§9）
3. 衝突keyは統合後のeffective vocabularyから除外する
4. 元entryは失わない
5. `STANDARD`は絶対に変更しない

同じnormalized lookup keyが同じnormalized canonical keyへ対応する場合は、conflictでは
なく**重複mappingの決定的な統合**として扱う（§8.5）。

---

## 4. Dictionary Status

正式enum:

```
PROBATION | ACTIVE | OBSERVING | QUARANTINED | RETIRED
```

P2-A1では**状態値と許可遷移だけ**を定義する。自動昇格・自動隔離を決めるscore threshold・
policyはP2-B/P2-C以降の責務であり、ここでは定義しない。

### 各状態がactive lookupへ参加するか

| status | 通常lookup参加 | 備考 |
|---|---|---|
| `PROBATION` | 参加しない | 後続Trial処理（P2-B、counterfactual matching等）でのみ使用予定 |
| `ACTIVE` | **参加する**（唯一） | |
| `OBSERVING` | 参加しない | 観察対象だが、まだ本番lookupには使わない |
| `QUARANTINED` | 参加しない | 隔離済み |
| `RETIRED` | 参加しない | 恒久的に不使用。物理削除はしない |

物理削除は通常処理としない。RETIREDはentryを保持したまま無効化する状態であり、
状態そのものと状態遷移の記録は別レイヤに置く（`status`の変更は
`validateDictionaryStateTransition(previous, next)`を経由する契約とし、遷移の
履歴保持そのもの（誰が・いつ）はP2-A1のdictionary schema本体には含めない。呼出側の
operation historyに委ねる設計とし、これは既存`KnowledgeStore`のoperations[]と同じ
「状態そのものではなく遷移の記録は別レイヤに置く」方針に合わせたものである）。

**RETIREDは通常のentry state transitionにおいて終端(terminal)であり、
RETIREDから他状態への直接遷移は許可しない**（下記の許可遷移案の通り、RETIREDを
`previous`とする遷移はallowlistに一切存在しない）。以前の状態への「復帰」は、
下記§4.1の**rollback**（entry単位の状態遷移ではなく、辞書version/snapshot全体の
復元操作）を通じてのみ行う。「以前の状態を追跡可能」という記述は、rollbackが
version/snapshot単位で過去の状態を復元できることを指すのであって、RETIREDという
entry状態からの直接遷移を許可する趣旨ではない。

### 許可遷移案

```
PROBATION  -> ACTIVE
PROBATION  -> QUARANTINED
PROBATION  -> RETIRED

ACTIVE     -> OBSERVING
ACTIVE     -> QUARANTINED
ACTIVE     -> RETIRED

OBSERVING  -> ACTIVE
OBSERVING  -> QUARANTINED
OBSERVING  -> RETIRED

QUARANTINED -> ACTIVE
QUARANTINED -> OBSERVING
QUARANTINED -> RETIRED

RETIRED    -> (遷移なし。終端状態)
```

`QUARANTINED -> ACTIVE`／`QUARANTINED -> OBSERVING`は、隔離判断が誤りだったと
人（または将来のP2-C policy）が個別entry単位で判断した場合の**通常の状態遷移**
であり、§4.1のrollback（version/snapshot全体の復元）とは別の概念である。両者を
同じ「rollback」という言葉で呼ぶと、entry単位の遷移とversion単位の復元が混同される
ため、本設計書では区別して扱う。

自己遷移（同一状態への遷移）は許可遷移に含めない（no-opは呼出側でstatus比較により
判定すべきで、`validateDictionaryStateTransition()`は「意味のある遷移」だけを扱う）。

上記に定義されていない`(previous, next)`の組み合わせは**すべてfail-closedで拒否**する
（`validateDictionaryStateTransition()`はallowlistの逆引きであり、未列挙の組は例外なく
invalidとする。将来の状態遷移追加は、このallowlistへの追加としてのみ行う）。
`RETIRED`を`previous`とするいかなる組み合わせも、このallowlistへは追加しない
（RETIREDを終端状態として維持することは、本Contractの固定事項とする）。

### 4.1 Rollback（entry状態遷移とは別の概念）

**rollbackはentry単位の状態遷移ではない。** rollbackは、私的辞書の**以前のcanonical
dictionary versionまたはsnapshot全体**を復元する操作であり、上記「許可遷移案」の
allowlistとは独立した、別の操作契約として扱う。

- rollbackの対象は「1つのentryの`status`」ではなく、「ある時点でexportされた
  canonical dictionary全体（§13のcanonical serialization、および§6のversion/
  snapshotの単位）」である。
- rollback後の各entryの状態は、**復元されたversion/snapshotにその時点で記録されて
  いた状態**となる。これは「RETIREDのentryを個別にACTIVEへ戻す」という遷移とは
  異なり、「dictionary全体を過去のある一貫した状態へ丸ごと差し替える」操作である。
  結果として、あるentryが復元後にRETIREDから別の状態へ変わって見えることはあるが、
  それは「RETIRED状態からの遷移が発生した」のではなく「別のversion/snapshotに
  置き換わった」ことによる。
- P2-A1では**rollback実行は実装しない**。P2-A1が固定するのはあくまで
  「dictionary版のcanonical serialization（§13）とcanonical fingerprint（§13）で、
  ある時点のversionを一意に識別・再現できる」という、rollbackが将来成立するための
  **contractの土台**だけである。version/snapshotの保存形式・保存タイミング・実際の
  復元処理そのものはP2-A1の範囲外とする。
- rollbackの実行ロジック（どのversionへ戻すかの選択、実際の復元処理、復元後の
  operation history記録）は**P2-Cで実装予定**とする（§22 Deferred Work参照）。

---

## 5. Dictionary Schema

### 5.1 最上位schema（export/import用、`private-dictionary-overlay/1.0`）

```json
{
  "schema_version": "private-dictionary-overlay/1.0",
  "dictionary_id": "opaque string",
  "version": "string",
  "scope": "DOMAIN | PROJECT | SESSION",
  "entries": [ /* §5.2 */ ]
}
```

`scope`に`STANDARD`は含めない。STANDARDは既存`tag_vocabulary`の責務であり、本Contractの
`entries[]`形式では表現しない（§3参照。STANDARDは§5.6の変換契約を通じてのみ
内部viewへ現れる）。

### 5.2 entry schema

```json
{
  "entry_id": "opaque string",
  "canonical_term": "display string",
  "aliases": ["display string"],
  "status": "PROBATION | ACTIVE | OBSERVING | QUARANTINED | RETIRED",
  "source": {
    "kind": "IMPORTED | DOCUMENT_EXTRACTED | SYSTEM_DERIVED",
    "content_included": false
  },
  "utility": {
    "exposure_count": 0,
    "match_opportunity_count": 0,
    "candidate_gain": 0,
    "ranking_gain": 0,
    "candidate_noise_increase": 0,
    "alias_conflict_count": 0,
    "document_support_count": 0
  }
}
```

### 5.3 追加要件

- `canonical_term`と`aliases`は表示値（人間可読な原文）を保持する。
- normalized keyは表示値と**分離**する。normalized keyはlookup/conflict検出専用の
  内部値であり、`canonical_term`/`aliases`という表示用fieldとは別に扱う（内部viewでの
  正式なfield名は§5.5の`canonical_key`/`aliases[].key`）。
- normalized keyは`normalize()`（§7で選定したSource of Truth）を用いて**決定的に
  導出**し、canonical export（§13のcanonical serialization対象）へは**重複保存
  しない**（同じ入力から同じnormalized keyが再現できるため、保存する情報量が
  増えない。かつ、保存すると正規化ロジック改訂時にstale化するリスクを持つ）。
- `utility`配下の値はすべて**非負のsafe integer**とする
  （`Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER`）。合計演算の
  overflowについては§10.6参照。
- **unknown fieldsの扱い**: 拒否する。private dictionary本体はallowlist schemaで
  fail-closedにする（既存Knowledge Data Contractの`extensions`とは対照的な設計
  判断。理由は§10参照）。

### 5.4 ID and Version Format（opaque IDのvalidation可能な形式）

「private termを含めない」という運用依存だけでは不足するため、次の形式を固定する。

| field | 正規表現 | 理由 |
|---|---|---|
| `dictionary_id` | `^pdict-[0-9a-f]{32}$` | 固定prefix + 16進数32桁（128bit相当）に限定することで、顧客名・製品名・型式・辞書語句を直接埋め込めない形式にする |
| `entry_id` | `^pde-[0-9a-f]{32}$` | 同上 |
| `version` | `^(0|[1-9][0-9]{0,15})$` | 10進非負整数の文字列表現のみ許可（先頭ゼロ・16桁超・符号・小数を拒否） |
| `dictionary_fingerprint` / `sha256` | `^[0-9a-f]{64}$` | SHA-256の64桁小文字16進のみ許可 |

これらのvalidationは§10 Validation Modelのfail-closed条件へ追加する。conflict record
への`entry_ref_id`掲載（§9.3）は、private dictionary由来の場合この`entry_id`の
形式validationを通過した場合だけに限定する（STANDARD由来の`entry_ref_id`は
§5.6.2の別形式`^std-[0-9a-f]{32}$`に従う）。

### 5.5 Internal Dictionary Layer View（正規化済み内部表現）

private dictionary本体（§5.1/§5.2）およびSTANDARD（既存`tag_vocabulary`）は、いずれも
次の共通内部view形式へ変換されたうえでmerge処理（§14.4）へ渡される。

```json
{
  "scope": "STANDARD | DOMAIN | PROJECT | SESSION",
  "dictionary_fingerprint": "64 lowercase hex",
  "entries": [
    {
      "entry_ref_id": "opaque safe id",
      "canonical_display": "display string",
      "canonical_key": "derived normalized key",
      "aliases": [
        { "display": "display string", "key": "derived normalized key" }
      ],
      "status": "ACTIVE | ...",
      "source_kind": "STANDARD | IMPORTED | DOCUMENT_EXTRACTED | SYSTEM_DERIVED"
    }
  ]
}
```

（フィールド名は`entry_id`ではなく**`entry_ref_id`**とする。既存STANDARD
vocabularyには`entry_id`という概念自体が存在しないため、内部layer viewの汎用
fieldはprivate dictionaryのentry由来か、STANDARDのcanonical tag由来かを問わず
共通に扱える名前へ揃える。導出方法は§5.6/§5.7参照）

この内部viewは**exportされない**（§5.1の`private-dictionary-overlay/1.0`schemaとは
別物であり、normalized keyを表示値と混在させたまま外部へ出す形式ではない。§13の
canonical export本体には現れない、あくまで処理中の中間表現）。

### 5.6 `createStandardDictionaryLayerView(tagVocabulary)` — STANDARD変換契約

既存`tag_vocabulary`を§5.5の内部layer viewへ変換する。**この関数は`async`とする**
（fingerprint再計算のため`hashParts()`を呼ぶ。§5.6.1参照）。

```
async function createStandardDictionaryLayerView(tagVocabulary)
```

変換規則:

- `allowed_tags`の各値を`canonical_display`とする（`canonical_key`は`normalize()`で
  導出）。
- `aliases[alias] = canonicalTag`の対応関係を、`canonicalTag`と一致する
  `canonical_display`を持つentryの`aliases[]`要素（`{display: alias, key: normalize(alias)}`）
  として変換する。
- STANDARD entryは**すべて`status: "ACTIVE"`**とする。
- `dictionary_fingerprint`は§5.6.1の再計算契約に従う（`vocabulary_sha256`を
  無条件に使うのではない）。
- 各entryの`entry_ref_id`は§5.6.2の`std-`prefix方式で導出する。
- **入力`tagVocabulary`を変更しない**（読み取りのみ、mutationなし。fingerprintの
  書き戻しも行わない、§5.6.1）。
- **`DEFAULT_TAG_VOCABULARY`を変更しない**（HTML側の定数はP2-A1のいかなる関数からも
  書き換えの対象にしない）。
- **STANDARDのexport schemaを`private-dictionary-overlay/1.0`へ変換しない**。
- **STANDARD viewは内部処理専用**（`mergeDictionaryLayers()`への入力としてのみ
  使う。単体でexportされる出口を持たない）。

`createStandardDictionaryLayerView(tagVocabulary)`は**fail-closedとする**（既存
`matchInitialTags()`の寛容なfallback挙動——`tagVocabulary.allowed_tags || []`・
`tagVocabulary.aliases || {}`のように、欠落・不正形式を黙って空へ丸める——を、
この新規変換関数へは持ち込まない。**既存`matchInitialTags()`自体の寛容な挙動は
変更しない**。P2-A1の新規変換関数だけをfail-closedにする、という区別を維持する）。

既存`tag_vocabulary`のvalidation委譲先: **現行コードベースには、`tag_vocabulary`
自体の形を検証する専用のvalidator関数は存在しない**（`matchInitialTags()`は
防御的デフォルトで読むだけ、`knowledge_store.js`の`validateDataset()`も
`tag_not_in_vocabulary`警告を出すだけで、`tag_vocabulary`自体の構造検証はしない）。
したがって`createStandardDictionaryLayerView()`は、**既存のどの関数にも委譲せず、
次のvalidationを自身の内部で行う**（専用のpublic APIを別途増やす必要はなく、この
関数の内部validationとして実装してよい）。

fail-closedで拒否する条件（`createStandardDictionaryLayerView()`内部）:

- rootがplain objectでない
- `schema`が非空stringでない
- `vocabulary_id`が非空stringでない
- `vocabulary_version`が非空stringでない
- `allowed_tags`が配列でない
- `allowed_tags`の各要素が非空stringでない
- normalized allowed tagの重複（`normalize()`後のcanonical keyが複数の
  `allowed_tags`要素で一致する）
- `aliases`がplain objectでない
- alias keyが非空stringでない
- alias targetが非空stringでない
- alias targetが`allowed_tags`のいずれのcanonical displayへも解決できない
  （aliasの対応先が存在しないcanonical tagを指している）
- `vocabulary_sha256`が**存在する場合**、64文字lowercase hex（`^[0-9a-f]{64}$`）
  でない、または§5.6.1の再計算fingerprintと不一致（`vocabulary_sha256`が
  **存在しない場合**はこの条件の対象外。§5.6.1参照）
- forbidden property name（`__proto__`/`prototype`/`constructor`。§10.3と同じ規則）
- getter／setterなど非data property
- sparse array
- §12のinput limitを超過

**unknown top-level fieldの扱い**: 上記allowlist（`schema`/`vocabulary_id`/
`vocabulary_version`/`allowed_tags`/`aliases`/`vocabulary_sha256`）以外の
top-level fieldが存在しても、`createStandardDictionaryLayerView()`は**拒否しない**
（既存`tag_vocabulary`は`knowledge-data/0.1`側の`extensions`同様、将来fieldの
追加余地を持つ既存契約であり、P2-A1がSTANDARD側に新しいallowlist制約を課すことは
既存契約への遡及的な変更になるため）。unknown top-level fieldは単に無視し、
`entries[]`への変換には使わない。

**入力`tagVocabulary`オブジェクトを変更しない**（validationも§5.6.1の
fingerprint再計算も読み取りのみで行う）。

#### 5.6.1 STANDARD fingerprintの算出契約（既存KnowledgeStoreとの整合）

現行`DEFAULT_TAG_VOCABULARY`には`vocabulary_sha256`が存在しない。既存
`knowledge_store.js`の正式方式は次の通りである（`computeTagVocabularySha256()`）。

canonical payload（既存と同じfield構成・同じ順序）:

```json
{ "schema": "...", "vocabulary_id": "...", "vocabulary_version": "...",
  "allowed_tags": [...], "aliases": { } }
```

fingerprint算出:

```
computedFingerprint = await hashParts(
  "tag-vocabulary-v1",
  [canonicalJson(canonicalPayload)]
)
```

（これは既存`tools/knowledge_builder/core/knowledge_store.js`の
`computeTagVocabularySha256()`と**同一の算法**であり、STANDARD側では独自の
第2実装を作らない。§7.2/§13.2で確立した「既存の正規化・hash基盤は無改変で
再利用する」という方針をSTANDARDにも適用する）

`createStandardDictionaryLayerView()`はこのcomputed fingerprintを常に計算した
うえで、次のいずれかを適用する。

- **`vocabulary_sha256`が欠落している場合**（`DEFAULT_TAG_VOCABULARY`を含む）:
  - computed fingerprintを`dictionary_fingerprint`として使用する
  - `vocabulary_sha256`欠落を理由に拒否しない（`DEFAULT_TAG_VOCABULARY`を含む
    既存辞書を拒否してはならない）
  - **入力objectへfingerprintを書き戻さない**（`tagVocabulary.vocabulary_sha256 = ...`
    のような代入は行わない）
- **`vocabulary_sha256`が存在する場合**:
  - 64文字lowercase hex（`^[0-9a-f]{64}$`）であることを確認する
  - computed fingerprintと**完全一致**することを確認する
  - 不一致であれば**fail-closedで拒否**する（黙ってcomputed側を優先しない。
    供給された`vocabulary_sha256`が信頼できない値である可能性を示すため、
    受理しない）

**private dictionaryのfingerprint契約（§13.1、SHA-256(canonical UTF-8 bytes)の
直接算出）とSTANDARDのfingerprint契約（本節、`hashParts("tag-vocabulary-v1", ...)`）
は、算法が異なる別の契約であり、混同しない。**

| 対象 | fingerprint算法 |
|---|---|
| private dictionary（DOMAIN/PROJECT/SESSION） | `SHA-256(canonical UTF-8 bytes)`（§13.1、`hashParts()`不使用） |
| STANDARD（既存tag_vocabulary） | `hashParts("tag-vocabulary-v1", [canonicalJson(payload)])`（既存`knowledge_store.js`と同一算法） |

#### 5.6.2 STANDARD entryの`entry_ref_id`

既存STANDARD vocabularyには`entry_id`という概念が存在しないため、STANDARD由来の
entryには専用の導出規則を用いる。

```
entry_ref_id = "std-" + (
  await hashParts(
    "private-dictionary-standard-entry-v1",
    [dictionary_fingerprint, canonical_key]
  )
).slice(0, 32)
```

形式: `^std-[0-9a-f]{32}$`

要件:

- **同じSTANDARD vocabularyと同じcanonical keyからは常に同じID**（決定的導出。
  `dictionary_fingerprint`と`canonical_key`だけを入力とする純関数）。
- 入力には**canonical displayではなくnormalized canonical keyを使用**する
  （表示値のtrivialな表記ゆれでIDが変わらないようにするため）。
- raw termを`entry_ref_id`へ直接埋め込まない（`hashParts()`の出力を経由するため、
  `canonical_key`の文字列がIDへそのまま現れない）。
- STANDARD入力（`tagVocabulary`）へIDを書き戻さない。
- canonical group統合（§8.6）後も、元の`entry_ref_id`をprovenanceとして保持する。
- ordinal orderingへ利用可能（`^std-[0-9a-f]{32}$`は他の`entry_ref_id`形式と
  同様、単純な文字列比較でordinal sortできる）。

### 5.7 `createPrivateDictionaryLayerView(dictionary)` — private dictionary変換契約

§10で validation済みの private dictionary（§5.1形式）を§5.5の内部layer viewへ
変換する。**この関数はfingerprint算出のため非同期(`async`)とする**（§5.7.1参照）。

```
async function createPrivateDictionaryLayerView(dictionary)
```

- `entries[].canonical_term` → `canonical_display`、`normalize(canonical_term)` →
  `canonical_key`
- `entries[].aliases[]`の各要素 → `{display: alias, key: normalize(alias)}`
- `entries[].entry_id`（§5.4の`^pde-[0-9a-f]{32}$`形式でvalidation済み） →
  そのまま`entry_ref_id`として使う（`entry_ref_id = validated entry_id`。
  private dictionary本体のexport schema側の`entry_id` fieldは変更しない。
  内部layer viewの参照field名だけが`entry_ref_id`である）
- `entries[].status` → そのまま`status`
- `entries[].source.kind` → `source_kind`
- 表示値（`canonical_term`/`aliases`の元の文字列）は内部viewの`display`側にも保持
  したまま渡す（§5.3「表示値を破壊しないこと」）。入力`dictionary`オブジェクト
  自体は変更しない。

#### 5.7.1 `dictionary_fingerprint`の算出方法（一意化。曖昧な複数候補を廃止）

private dictionary layer viewの`dictionary_fingerprint`は、**必ず次の1つの方法で
算出する**（「`dictionary_id`/`version`から導出される、または canonical
serializationから導出される」という複数候補の曖昧な表現は誤りであり、削除する）。

```
dictionary_fingerprint = await hashPrivateDictionaryCanonical(dictionary)
```

- `dictionary_id`や`version`から`dictionary_fingerprint`を導出**しない**
  （§5.4のID formatは識別用の別concernであり、fingerprintの入力ではない）。
- **STANDARDだけは例外**として、§5.6.1の`hashParts("tag-vocabulary-v1", ...)`
  方式で`dictionary_fingerprint`を算出する（STANDARDは
  `hashPrivateDictionaryCanonical()`の対象である`private-dictionary-overlay/1.0`
  schemaを持たないため、この関数を適用できない。§5.6.1の表で両契約を対比する）。
- `hashPrivateDictionaryCanonical()`（§13.1）は`serializePrivateDictionaryCanonical()`
  の呼び出しを含むため、`createPrivateDictionaryLayerView()`もこれに連動して
  `async`となる。

### 5.8 `source.kind`とstatusの整合

**private dictionaryファイル（§5.1形式）は「現在状態を保存したsnapshot」である。**
`source.kind`はentryの**出自**を表し、`status`はentryの**現在状態**を表す、という
互いに独立した2つの軸であり、`source.kind`だけを理由に現在`status`を制限しては
ならない。以前のセッションで`PROBATION`から`ACTIVE`へ正当に昇格した
`DOCUMENT_EXTRACTED`／`SYSTEM_DERIVED`由来のentryを、再importできなくなるような
制約を課すことは誤りである。

#### 5.8.1 private dictionary snapshotのvalidation（`validatePrivateDictionary()`）

| `source.kind` | 許可される`status` |
|---|---|
| `IMPORTED` | 正式enum（§4）のすべての`status`を許可 |
| `DOCUMENT_EXTRACTED` | 正式enum（§4）のすべての`status`を許可 |
| `SYSTEM_DERIVED` | 正式enum（§4）のすべての`status`を許可 |

すなわち、`validatePrivateDictionary(input)`は、`source.kind`の値によって
`status`の許容範囲を狭めない。§4の正式enumに含まれる`status`であれば、
`source.kind`が何であっても受理する。

#### 5.8.2 新規候補生成時のinitialization policy（P2-A2以降）

P2-A2以降で、抽出・自動生成によって**新しいentryを生成する瞬間だけ**、次の
initial status制約を適用する。

| `source.kind`（新規生成時） | initial `status` |
|---|---|
| `DOCUMENT_EXTRACTED` | 必ず`PROBATION` |
| `SYSTEM_DERIVED` | 必ず`PROBATION` |

このinitialization policyは、**private dictionaryファイル全体のvalidation規則
ではなく、新規entry生成というイベントに紐づく規則**であり、実装は**P2-A2へ延期
する**。P2-A1の`validatePrivateDictionary()`は、この規則を検査**しない**
（`DOCUMENT_EXTRACTED`／`SYSTEM_DERIVED`の`ACTIVE`を拒否しない。§8.7、および
§10.1の削除された旧項目16の説明を参照）。

`source.content_included`が意味するのは次の不在の確認であり、これらが
`entry.source`へ**含まれていないこと**を指す。

- source document本文
- evidence excerpt
- locator
- file name
- sheet name

**`canonical_term`と`aliases`自体がない、という意味ではない**（`canonical_term`/
`aliases`はentryの必須表示値であり、常に存在する。`content_included:false`が
禁止するのは、それを超えた"生の原文コンテキスト"の混入である）。

---

## 6. Timestamp and Determinism

`Date.now()`・`new Date()`など、実行時刻依存値をpure core内で**生成しない**。

`created_at`／`updated_at`のようなfieldを将来採用する場合:

- **caller-suppliedに限定する**（pure coreが自ら時刻を生成しない。呼出側が渡した値を
  そのまま保持するだけ）。
- **canonical content hashの対象外**とする（§13のcanonical payloadには含めない）。
- 同じ意味内容から同じcanonical bytesが得られることを壊さない。

### 採用方針

- P2-A1 canonical dictionary本体へ**自動timestampを入れない**。
- export UIが後続で外側のenvelope（canonical dictionary本体を包む、export専用の
  ラッパーオブジェクト）へtimestampを付ける設計とする。P2-A1のcore関数群
  （§14）はこのenvelope自体を扱わない。
- canonical fingerprintは**timestampを除いたcanonical payload**から計算する
  （§13参照）。

---

## 7. Normalization Source of Truth

### 7.1 候補の実際の定義・export・依存方向の確認結果

**`tools/quantity_sidecar_binding_core.js:117`（`normalize()`の実体定義）**:

```javascript
function normalize(value) {
  return String(value == null ? '' : value).normalize('NFKC').replace(/\r\n?/g, '\n')
    .split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n').replace(/[ \t]+/g, ' ').trim();
}
```

**`tools/knowledge_builder/core/id_hash_utils.js:22-23`（再export、実装なし）**:

```javascript
const Binding = resolveBindingCore(); // require('../../quantity_sidecar_binding_core.js')
const { normalize, hashParts, canonicalJson, computeRecordContentHash } = Binding;
```

`id_hash_utils.js`のファイル冒頭コメント自身が明記している通り、これは
「`tools/quantity_sidecar_binding_core.js`の`normalize`/`hashParts`/`canonicalJson`/
`computeRecordContentHash`を**無改変で再利用**する。独自の第2実装はExport/Sidecar
binding算法からのdriftを避けるため行わない」という既存方針である。2つの候補は
競合する別実装ではなく、**同一実装への2つの参照経路**である。

### 7.2 採用するfunction/path

**`tools/quantity_sidecar_binding_core.js`の`normalize()`を正式なSource of Truthとする。**

アクセス経路は`tools/knowledge_builder/core/id_hash_utils.js`が再exportする`normalize`
束縛を経由する（`knowledge_builder/core/*.js`は慣例として`quantity_sidecar_binding_core.js`
を直接requireせず、`id_hash_utils.js`経由で参照する。既存`relation_candidate_engine.js`／
`knowledge_store.js`はいずれも`id_hash_utils.js`をrequireし、
`quantity_sidecar_binding_core.js`を直接requireしない、という既存依存方向と揃える）。

将来実装する`private_dictionary_learning_core.js`も同じ経路
（`require('./id_hash_utils.js')`のresolveパターン）で`normalize`を取得する設計とする。

### 7.3 正確なnormalization規則

`normalize(value)`は次を順に適用する。

1. `value == null`なら空文字列、そうでなければ`String(value)`
2. `.normalize('NFKC')` — Unicode正規化形式NFKC（正準分解+互換分解 → 正準合成）
3. `.replace(/\r\n?/g, '\n')` — CRLFまたは単独CRをLFへ統一
4. 各行末の半角space/tabを除去（行単位、`split('\n')`→`replace(/[ \t]+$/g,'')`→`join('\n')`）
5. `.replace(/[ \t]+/g, ' ')` — 半角space/tabの連続を単一半角spaceへ圧縮
6. `.trim()` — 先頭・末尾の空白除去

### 7.4 個別要件との対応

| 要件 | 既存`normalize()`の挙動 | 判定 |
|---|---|---|
| NFKC採否 | 採用（明示的に`.normalize('NFKC')`を呼ぶ） | 満たす |
| case folding採否 | **行わない**（`.toLowerCase()`等を含まない） | 意図的に不採用（§7.5参照） |
| 全角／半角 | NFKCの互換分解が及ぶ範囲（英数字・一部記号）のみ統一される | 部分的に満たす |
| CRLF／LF | 明示的にLFへ統一 | 満たす |
| 前後空白 | `trim()`で除去 | 満たす |
| 連続空白 | 満たす。全角スペース(U+3000 IDEOGRAPHIC SPACE)はUnicodeの互換分解表で
  `<wide> 0020`と定義されており、`.normalize('NFKC')`の時点でASCII space(U+0020)へ
  変換される。したがって後続の「ASCII space/tabの連続を1つへ圧縮」処理がU+3000にも
  そのまま適用され、全角スペースの連続・全角スペースと半角スペースの混在のいずれも
  単一半角spaceへ正しく圧縮される（`'　　abc　'.normalize('NFKC').replace(/[ \t]+/g,' ')`
  `=== ' abc '`で実機確認済み） | 満たす |
| ハイフン種別 | NFKCが及ぶ範囲のみ（例: 全角ハイフンマイナスU+FF0Dは
  ASCIIハイフンマイナスU+002Dへ変換される）。**長音記号(U+30FC)・各種ダッシュ
  (U+2010-U+2015)・全角チルダ等はNFKCの対象外で、統一されない** | 部分的に満たす（意図的、§7.5） |
| 括弧種別 | NFKCが及ぶ範囲のみ（例: 全角丸括弧U+FF08/FF09はASCII丸括弧へ変換される）。
  **日本語鉤括弧「」『』・隅付き括弧【】等はNFKCの対象外で、統一されない** | 部分的に満たす（意図的、§7.5） |

### 7.5 意図的に統一しない理由（"日本語と英語を無条件に同一視しないこと"）

case foldingとハイフン/括弧の全種統一を既存`normalize()`が行わないことは、**欠陥ではなく
本Contractにとって望ましい性質**として扱う。

- case foldingを行わないことで、大文字・小文字が意味を持つ型式・製品コード等を
  誤って同一視しない。
- 全角/半角の英数字・ASCII互換記号だけをNFKCで統一し、日本語の長音記号・鉤括弧等を
  ASCII記号へ統一しないことで、**表記体系の異なる用語同士を「似ているから」という
  理由だけで無条件に同一視しない**（§8で禁止する「類似文字列だけでaliasとする」と
  同じ精神）。

したがって、`pdf_direct_adapter.js`の`foldForTagCompare()`（既存のtag-vocabulary
alias照合専用の追加case-folding処理）は、P2-A1の`normalize()`とは**別物**として扱い、
P2-A1では**再利用しない**。

### 7.6 差分の再評価: 既存関数は要件を満たす（Step 4Rでの訂正）

Step 4時点の本設計書は、全角スペース(U+3000)がNFKCで変換されないという誤った前提の
もと、既存`normalize()`とは別の追加ラッパーを新設する計画を記載していたが、これは
誤りであり、Step 4Rで訂正済みである。U+3000は`<wide> 0020`としてNFKCの時点でU+0020へ
変換されるため、既存`normalize()`だけで連続空白の要件（§7.4）を満たす。これを理由と
する追加ラッパー・第2正規化実装は不要であり、計画から削除済みである。

### 7.7 `normalizeDictionaryKey()`という名前を残す場合の扱い

P2-A1の設計として、private dictionary専用のnormalized key導出には
`normalizeDictionaryKey(value)`という名前を予約してよいが、**P2-A1の範囲では
既存`normalize()`への単純な委譲に限定し、追加の変換を一切行わない**。

```
normalizeDictionaryKey(value) := normalize(value)
```

次を変換しない判断は、§7.5の理由により維持する。

- case folding
- すべてのhyphen／dash統一（NFKCの互換分解が及ぶ範囲を除く）
- 日本語括弧の独自統一（NFKCの互換分解が及ぶ範囲を除く）
- 日本語と英語の同一視

---

## 8. Alias Semantics

alias関係が表すのは次だけとする。

```
alias display string → canonical display string
```

### 禁止（aliasの成立条件として使わない）

- 同一段落に出現しただけでaliasとする
- 部分一致だけでaliasとする
- 類似文字列だけでaliasとする
- scoreが高いだけでaliasとする

### 8.1 lookup keyの定義

`ACTIVE`entryがlookupへ提供するkeyは次の**双方**である。

- `canonical_term`のnormalized key（`canonical_key`）
- 各aliasのnormalized key（`aliases[].key`）

### 8.2 lookup key比較の対象範囲（3分類）

lookup key同士の比較として観測する組み合わせは次の3つである。

1. **canonical対canonical** — あるentryの`canonical_key`が、別entryの
   `canonical_key`と一致する
2. **canonical対alias** — あるentryの`canonical_key`が、別entryの
   `aliases[].key`と一致する
3. **alias対alias** — あるentryの`aliases[].key`が、別entryの`aliases[].key`と
   一致する

ただし、この3分類は**観測対象の分類**であって、判定結果がすべて同じというわけでは
ない（§8.2.1参照）。

#### 8.2.1 canonical対canonicalは構造上conflictにならない

**canonical対canonicalの比較は、性質上conflictを生まない。**

- 2つのentryの`canonical_key`が**同じ**であれば、その時点で「lookup key」と
  「解決先canonical key」が両方とも一致している（`canonical_key`自身が、その
  entryのlookup keyであると同時に解決先canonical keyでもあるため）。これは
  §8.4の「同一lookup keyが同一canonical keyへ解決される」場合そのものであり、
  **conflictではなくcanonical group統合**（§8.6）の対象になる。
- 2つのentryの`canonical_key`が**異なれば**、そもそも同じlookup keyを比較して
  いないため（比較しているlookup key文字列自体が違う）、「同じlookup keyが
  異なるcanonical keyへ解決される」という§8.5のconflict条件に該当しようがない。

したがって、**canonical対canonicalという組み合わせだけからconflict recordが
生成されることはない**。この分類は、常に「同一canonical group統合」
（同じ場合）または「無関係（異なる場合、比較対象外）」のいずれかに帰着する。

#### 8.2.2 canonical対alias・alias対aliasはconflictになりうる

**canonical対alias**、および**alias対alias**の比較では、同じlookup key文字列が、
（一方はentryの`canonical_key`として、他方はentryの`aliases[].key`として、
またはそれぞれのalias同士として）**異なるcanonical keyへ解決される**ことが
起こりうる（例: entry Xの`canonical_key`が"K"であり、entry Yの`aliases[].key`も
たまたま"K"だが、entry Yの`canonical_key`はentry Xと異なる、というケース）。
この場合が§8.5の**conflict**条件に該当する。

判定・扱いの規則そのもの（同一canonical keyなら統合、異なるcanonical keyなら
conflict）は、canonical/aliasという役割の違いによって変えない。ただし
§8.2.1の理由により、**実際にconflictとして現れうるのはcanonical対alias・
alias対aliasの2分類だけ**である。

### 8.3 同一entry内で拒否する条件（単一辞書内部の矛盾、invalid）

- 空alias（正規化後に空文字列になるaliasを含む）
- `canonical_term`とのnormalized重複（aliasが実質的にcanonicalと同じ表記）
- alias同士のnormalized重複（同一entry内で同じnormalized keyを持つaliasが複数）

これらは§10のvalidationで**invalidとして拒否**する（validation errorであり、
conflict recordの対象ではない）。

### 8.4 同一normalized lookup keyが同一normalized canonical keyへ解決される場合
（重複、conflictではない）

複数entry間（同一辞書内の別entry、または複数layer統合時）で、同じnormalized lookup
keyが、結果として**同じ**normalized canonical keyへ解決される場合:

- conflictとして扱わない
- 重複mappingとして**deterministicに統合**する
- 統合時、aliasesは重複除外する（同じnormalized keyのalias表示値が複数layerで
  与えられても、統合結果のalias集合には1つだけ現れる。どの表示値を残すかは§8.6の
  「最上位layerの表示値を採用、同順位はordinal順」という規則を準用する）
- **入力entryは変更しない**（統合は出力側の話であり、各layerの元entryオブジェクトを
  書き換えない）

### 8.5 同一normalized lookup keyが異なるnormalized canonical keyへ解決される場合
（conflict）

複数entry間で、同じnormalized lookup keyが、**異なる**normalized canonical keyへ
解決される場合:

- conflict recordを生成する（§9）
- 統合後のlookupから、そのnormalized lookup keyを除外する
- priorityの高いlayerの解決結果を黙って採用しない（priorityは他の非衝突keyの
  優先順位付けにのみ使う。衝突したkeyそのものには使わない）

### 8.6 同一normalized canonical keyを持つentryが複数layerにある場合（canonical group統合）

同一normalized canonical keyを持つentryが複数layer（例: DOMAINとPROJECTの双方に
同じcanonical tagのentryが存在する）にある場合（§8.2.1の「canonical対canonicalで
`canonical_key`が同じ」場合を含む）:

- それらを**1つのcanonical group**として統合する
- `canonical_display`（表示値）は、**最上位layer**（§3のlookup priority
  `SESSION > PROJECT > DOMAIN > STANDARD`）の表示値を採用する
- 同順位の場合（同一layer内に複数の候補がある異常系。通常は§8.3のentry内重複拒否で
  発生しないが、canonical group統合ロジック自体の決定性を保証するために規定する）は
  **ordinal順**で決定する
- `aliases`は**全layerから安全に統合**する（§8.4の重複除外規則に従い、同じ
  normalized keyのaliasは1つにまとめる）
- **元entryとprovenance（`source_kind`・所属layerの`scope`）は保持する**
  （統合結果のcanonical groupが、どのlayerのどのentryに由来するかを追跡できる形を
  維持し、統合によって出自情報を握りつぶさない）

### 8.7 `source.kind`とstatusの整合（§5.8参照）

alias関係は暗黙の推定では成立しない。私的辞書のvalidation自体
（`validatePrivateDictionary()`）は、§5.8.1の通り`source.kind`によって
`status`を制限しない（`PROBATION`から正当に`ACTIVE`へ昇格した
`DOCUMENT_EXTRACTED`／`SYSTEM_DERIVED`由来のentryも、snapshotとして
問題なく再import・再検証できる）。一方、P2-A2以降で**新規にentryを生成する
瞬間**には、§5.8.2の通り`DOCUMENT_EXTRACTED`／`SYSTEM_DERIVED`のinitial
statusを`PROBATION`に固定する（このinitialization policyの実装自体は
P2-A2へ延期する）。

---

## 9. Conflict Record

```json
{
  "code": "DICTIONARY_LOOKUP_CONFLICT",
  "normalized_key_token": "non-reversible, but not a confidentiality guarantee",
  "entry_refs": [
    {
      "dictionary_fingerprint": "opaque value",
      "entry_ref_id": "opaque value",
      "scope": "PROJECT"
    }
  ]
}
```

（field名は`entry_id`ではなく**`entry_ref_id`**とする。private dictionary export
本体の`entry_id` field自体は変更しない。conflict recordが参照するのは§5.5の内部
layer viewの`entry_ref_id`であり、STANDARD由来（`^std-[0-9a-f]{32}$`）と private
dictionary由来（`^pde-[0-9a-f]{32}$`）の両方を統一的に指せる名前が必要なため
改称する）

### 9.1 要件と設計

- **raw aliasをconflict recordへ入れない**。表示値は一切含めない。
- **canonical termを入れない**。同上。
- **source document名を入れない**。
- **normalized keyそのものを入れず、`normalized_key_token`（§9.2参照）だけにする**。
- `entry_refs[].entry_ref_id`は、§9.3の形式（`^(pde|std)-[0-9a-f]{32}$`）を
  満たす場合のみ掲載する。
- **deterministic orderingを定義する**: `entry_refs[]`は
  `(scope, dictionary_fingerprint, entry_ref_id)`の辞書式（ordinal, ロケール非依存）
  順でソートする。同一の複数conflict recordが生成される場合、record自体の並び順は
  `normalized_key_token`のordinal順とする。

### 9.2 `normalized_key_token`の生成規則と機密上の限界

**旧称`normalized_key_hash`を`normalized_key_token`へ改称する**（「復元不能なので
安全」という誤解を避けるため）。

生成規則（`hashParts()`は`async`関数のため、`normalized_key_token`の生成も
`await`を伴う。§14の`detectDictionaryLookupConflicts(layerViews)`が`async`である
理由の1つはこれである）:

```
normalized_key_token = await hashParts(
  "private-dictionary-lookup-key-v1",
  [normalizedKey]
)
```

（既存`hashParts()`／`id_hash_utils.js`経由の基盤を利用する。名前空間文字列
`"private-dictionary-lookup-key-v1"`により、他の用途のhashParts呼び出しと衝突しない
ようにする。§13で述べる通り、**canonical dictionary fingerprintの計算にはこの
`hashParts()`ベースの方式を使わない**——両者は別の算法・別の用途である）

機密上の限界（**断定しない**）:

- `normalized_key_token`は、**normalized lookup key文字列を直接復元できない**という
  意味で非可逆だが、これを「安全である」と断定しない。
- **一般的な用語**（頻出する技術用語・型式表記等）は、既知語彙に対する
  辞書攻撃（総当たりでよく使われる語をhash化し、一致するtokenを探す）によって
  **推測される可能性がある**。
- したがって`normalized_key_token`はP2-A1では**メモリ内のconflict record専用**とし、
  次のいずれにも出力しない。
  - Knowledge binding（§15）
  - sanitized learning summary（§16）
  - private dictionary export（§5.1のexport schema）
- raw aliasをそのまま記録するよりは漏えいを抑えるが、**機密性を保証する暗号化ではない**。
- 将来、audit export等でこのtokenを含める必要が生じた場合は、**別途threat modelを
  必要とする**（P2-A1の範囲では、この判断自体を行わない）。

### 9.3 `entry_ref_id`のconflict recordへの掲載条件

conflict recordの`entry_refs[].entry_ref_id`は、次のいずれかの形式を満たす場合の
みに掲載する。

```
^(pde|std)-[0-9a-f]{32}$
```

- `pde-`prefix: private dictionary由来。§5.4のID format
  （`^pde-[0-9a-f]{32}$`）のvalidationを通過した`entry_id`をそのまま
  `entry_ref_id`として使う（§5.7）。
- `std-`prefix: STANDARD由来。§5.6.2の決定的導出方式で生成された
  `entry_ref_id`（`^std-[0-9a-f]{32}$`）を使う。

いずれの場合も、形式検証を通過しないentry自体は§10（private dictionary側）または
§5.6（STANDARD側）のvalidationでfail-closedに拒否されるため、通常の処理経路で
conflict recordの`entry_ref_id`にprivate termを含む文字列が紛れ込むことはない、
という設計上の前提を明示する。

---

## 10. Validation Model

fail-closedで拒否する条件（最低限、allowlist方式）。

### 10.1 構造・型

| # | 条件 |
|---|---|
| 1 | rootがplain objectでない（配列・null・プリミティブ・class instance等） |
| 2 | `schema_version`が`"private-dictionary-overlay/1.0"`と不一致 |
| 3 | `dictionary_id`欠落、または§5.4の形式(`^pdict-[0-9a-f]{32}$`)に不一致 |
| 4 | `scope`が`DOMAIN`/`PROJECT`/`SESSION`のいずれでもない |
| 5 | `version`欠落、または§5.4の形式(`^(0|[1-9][0-9]{0,15})$`)に不一致 |
| 6 | `entries`が配列でない |
| 7 | `entry_id`欠落、または§5.4の形式(`^pde-[0-9a-f]{32}$`)に不一致 |
| 8 | `entry_id`重複（同一辞書内） |
| 9 | `canonical_term`が空文字列（正規化後を含む） |
| 10 | `aliases`が配列でない |
| 11 | `aliases[]`中に空alias |
| 12 | normalized alias重複（同一entry内、§8.3） |
| 13 | canonicalとaliasのnormalized重複（同一entry内、§8.3） |
| 14 | `status`が正式enum（§4）のいずれでもない |
| 15 | `source.kind`が`IMPORTED`/`DOCUMENT_EXTRACTED`/`SYSTEM_DERIVED`のいずれでもない |
| 16 | `source.content_included`が`false`以外 |
| 17 | `utility`欠落 |
| 18 | `utility.*`が負数 |
| 19 | `utility.*`が非整数 |
| 20 | `utility.*`がNaN／Infinity |

**削除された旧項目16について**: 「`source.kind`が`DOCUMENT_EXTRACTED`または
`SYSTEM_DERIVED`にもかかわらず`status`が`PROBATION`以外」という条件は、Step 4R3で
削除した（§5.8/§8.7参照）。private dictionaryファイルは現在状態のsnapshotであり、
`source.kind`（出自）だけを理由に現在`status`を制限すると、以前正当に`PROBATION`
から`ACTIVE`へ昇格したentryを含むsnapshotをvalidation不能にしてしまうため、誤りで
あった。この制約は、new-entry-creation時のみ適用される別のinitialization policy
（§5.8.2、P2-A2で実装）へ置き換えた。

### 10.2 構造的安全性（すべての階層で適用）

| # | 条件 |
|---|---|
| 21 | 循環参照（cyclic reference） |
| 22 | 最大入力制限超過（§12） |
| 23 | forbidden property name（`__proto__` / `prototype` / `constructor`。全階層） |
| 24 | unsupported type（`function` / `symbol` / `bigint` 等、JSON表現を持たない型） |
| 25 | sparse array（穴あき配列） |
| 26 | arrayの非index own property（`arr.foo = 1`のような、数値indexでも`length`でもない
    own propertyを持つ配列を拒否。JSON textからは通常発生しないが、plain objectを
    直接渡す経路（§10.4）では発生しうるため明示的に検査する） |
| 27 | getter／setterなど非data property（plain dataのみ許可） |
| 28 | 対象objectの`Object.getPrototypeOf(...)`が`Object.prototype`または`null`
    以外 |

### 10.3 forbidden property name（§10.2 #23の詳細）

```
__proto__
prototype
constructor
```

これらは**全階層で拒否する**（top-level直下だけでなく、`entries[]`要素・
`source`・`utility`・将来追加される任意のnestedオブジェクトすべてに対し、
再帰的なwalkの中でキー名チェックを行う）。

### 10.4 parse／text入力に固有のfail-closed条件

| # | 条件 |
|---|---|
| 29 | UTF-8 BOM（`EF BB BF`で始まるJSON text）を拒否する |
| 30 | duplicate JSON object key（同一objectリテラル内で同じキーが複数回出現する
    JSON text）を拒否する。標準`JSON.parse()`のlast-value-wins挙動へ**任せない**
    （§10.5参照） |
| 31 | 最大JSON UTF-8 bytes（§12）超過を、`parsePrivateDictionaryJson(text)`が
    **`TextEncoder`で実測したbyte数**をもとに判定する |

### 10.5 duplicate keyの検出方針

`JSON.parse()`単体は、同一objectリテラル内に重複キーが存在しても構文エラーにせず、
最後に出現した値で上書きする（last-value-wins）。これはfail-closedの原則に反する
（入力の一部が黙って捨てられる）ため、`parsePrivateDictionaryJson(text)`は
**duplicate-key検出可能な方法**（重複キーを検知できるカスタムJSON parser、または
`JSON.parse()`の前に行う軽量scanner）でJSON textを走査し、重複キーが1件でもあれば
入力全体をfail-closedで拒否する契約とする。標準`JSON.parse()`をそのまま最終手段
として使う実装は、この契約を満たさない。

### 10.6 utility合計時のoverflow

`utility.*`の個々の値は§5.3で`Number.isInteger(v) && v >= 0 && v <=
Number.MAX_SAFE_INTEGER`を満たす必要があるが、これは**単一値の範囲**の話であり、
複数entryにまたがる合計（例: `createSanitizedLearningSummary()`の
`utility_totals.*`、§16）を計算する際に、合計値が`Number.MAX_SAFE_INTEGER`を
超えるoverflowが起こりうる。P2-A1のcontractとして、**合計演算がoverflowする入力は
fail-closedで拒否する**（黙って`Number.MAX_SAFE_INTEGER`を超えた不正確な合計値を
返さない）。

---

## 11. Error Sanitization

errorは次の形式に**限定**する。

```json
{
  "code": "DICTIONARY_ALIAS_DUPLICATE",
  "path": "$.entries[3].aliases[2]"
}
```

### 禁止（error object内に含めない）

- `canonical_term`
- alias
- raw input
- source text
- file name
- sheet name
- customer name
- model number
- `JSON.stringify(input)`
- thrown valueの無加工表示（`String(err)`や`err.message`をそのまま含む等）

### path規則

- 配列indexと**allowlisted field名**のみ使用可能。
- **dynamic object keyの値はpathへ含めない**。

### parse errorの専用形式

`parsePrivateDictionaryJson(text)`がJSON構文エラーを検出した場合のerrorは、
次の形式に**限定**する。

```json
{
  "code": "DICTIONARY_JSON_SYNTAX_INVALID",
  "path": "$"
}
```

**native `JSON.parse()`が投げる`SyntaxError`の`message`（例: 何文字目でエラーか、
入力の断片を含むことがある）や、入力そのものの断片を、無加工でこのerrorへ転送
しない**。native errorはcatchした上で、上記の固定形式へ変換してから返す。

`code`の名前空間は、conflict record用（`DICTIONARY_LOOKUP_CONFLICT`）と
validation/parse error用（`DICTIONARY_ALIAS_DUPLICATE`、
`DICTIONARY_JSON_SYNTAX_INVALID`等）で分ける。

---

## 12. Input Limits

| 上限 | 値（提案） | 理由 |
|---|---|---|
| maximum JSON UTF-8 bytes | 2,097,152 (2 MiB) | private dictionaryは単一案件・単一セッションの補助辞書であり、既存の
  Knowledge JSON本体より大きくなる想定がない |
| maximum entries | 5,000 | 1案件で人・システムが実用的に管理・レビューできるterm数の上限として |
| maximum aliases per entry | 32 | 1つのcanonical termに対する表記ゆれの現実的な数 |
| maximum total aliases | 20,000 | conflict検出等のO(N)処理のNを直接抑えるため |
| maximum term length | 256 UTF-16 code units | 異常に長い文字列を早期にfail-closedで弾く |
| maximum nesting depth | 6 | 非循環だが異常に深いネストも上限で弾く |
| maximum dictionary layers | 4 | §3の4layerに固定 |
| maximum conflict records | 10,000 | conflict record自体の肥大化を打ち切る |

すべての上限超過は**partial acceptしない**。1件でも超過があれば、辞書全体を
fail-closedで拒否する。

上限値はP2-A1実装時に、`private_dictionary_learning_core.js`内の**一箇所に集約した
定数群**として定義する設計とする。

### 12.1 byte制限の測定責務の分離（parse vs. validate）

- `parsePrivateDictionaryJson(text)`は、入力が**JSON text（`string`）**であるため、
  `TextEncoder`でUTF-8 byte数を実測してから、最大JSON UTF-8 bytesの上限（§12表）を
  超えていないかを判定できる。これは`parsePrivateDictionaryJson()`の責務とする。
- 一方、`validatePrivateDictionary(input)`は**plain objectを直接受け取る**関数であり、
  **元のJSON textが存在しない（呼出側がtextを経由せず、既にparse済みのobjectを
  直接渡すケースがありうる）ため、元テキストのbyte数を確認できない**。
- したがって、`validatePrivateDictionary(input)`がobjectを直接受け取るケースでは、
  次の**両方**を確認する契約とする。
  1. **structural limits**（§12表のentries数・aliases数・term長・nesting深度等、
     objectの構造だけから直接数えられる上限）
  2. **canonical serialized byte limit**（`serializePrivateDictionaryCanonical(input)`
     で一度canonical化した上でのUTF-8 byte数が、最大JSON UTF-8 bytesの上限を
     超えていないかの再チェック。元テキストのbyte数とは厳密には一致しないが、
     objectを経由する入力経路でも同じ上限を実効的に強制するための代替手段とする）
- この非対称性（parseはtext実測、validateは構造+再serializeでの推定）は、
  P2-A1の設計として明示的に許容する。

---

## 13. Canonical Serialization

固定する規則:

- UTF-8
- BOMなし
- LF（CRLFを含まない）
- object keyは**ordinal順**
- `entries[]`は`entry_id`のordinal順
- `aliases[]`はnormalized key、次にdisplay valueのordinal順
- layer一覧は固定priority順（`SESSION, PROJECT, DOMAIN, STANDARD`）
- utility fieldの順序はcanonical key sortingへ従う
- JSONへ`NaN`／`Infinity`／`undefined`を許可しない
- **canonical bytesへ実行時timestampを含めない**（§6）
- 同じ意味内容から**byte-identical**な出力を得る
- **`sha256`／`dictionary_fingerprint` field自身はhash対象へ含めない**（自己参照を
  避ける）

### 13.1 Canonical Dictionary Fingerprintの算法（`hashParts()`は使用しない）

**canonical dictionary fingerprint = SHA-256(canonical UTF-8 bytes)** とする。

```
async function hashPrivateDictionaryCanonical(input):
  1. text := serializePrivateDictionaryCanonical(input)   // §13本文の規則でcanonical化したJSON text
  2. bytes := new TextEncoder().encode(text)               // UTF-8 bytes化
  3. digestBytes := await SHA-256(bytes)                    // canonical UTF-8 bytesへ直接SHA-256
  4. return 64桁lowercase hex文字列（digestBytesを16進変換）
```

`async`とする理由: Node側の`crypto.createHash('sha256')...digest('hex')`自体は同期
APIだが、Browser側の`crypto.subtle.digest('SHA-256', bytes)`は**Promiseを返す
非同期API**であるため、両環境で同一のシグネチャ（`await hashPrivateDictionaryCanonical(...)`
という呼び出し方）に揃えるために`async`関数として定義する。

- **Node**: `crypto.createHash('sha256').update(bytes).digest('hex')`
- **Browser**: `crypto.subtle.digest('SHA-256', bytes)`の結果を16進文字列へ変換

**同じbytesからNode／Browserで同じhash文字列になることを要求する**（両者とも標準の
SHA-256アルゴリズムをbytesへ直接適用するだけであり、実装依存の差異が入り込む余地は
ない）。

### 13.2 既存`hashParts()`との明確な分離

既存`hashParts(namespace, parts)`（`quantity_sidecar_binding_core.js`）は:

```javascript
async function hashParts(namespace, parts) {
  return sha256([namespace, ...parts.map(normalize)].join(String.fromCharCode(0)));
}
```

すなわち、**namespace文字列を追加し、各partへ`normalize()`を再適用してから
NUL文字(`\0`)区切りで連結し、その結果へSHA-256する**。これは
**canonical UTF-8 bytesへの直接SHA-256とは異なる値**になる（namespace分の追加入力と、
`parts`への`normalize()`再適用があるため）。

したがって:

- **canonical dictionary fingerprintの計算には`hashParts()`を使用しない**
  （§13.1の直接SHA-256方式を使う）。
- 既存`hashParts()`は、次の用途に限り引き続き使用してよい。
  - namespaced internal ID（例: 将来`entry_id`/`dictionary_id`の実際の値を
    id128()相当の方式で生成する場合の内部計算）
  - internal lookup key token（§9.2の`normalized_key_token`）
- **ただし、いかなる場合もcanonical dictionary fingerprintには`hashParts()`を
  使用禁止とする**。

### 13.3 既存`canonicalJson()`を再利用する場合のarray順序の扱い

既存`quantity_sidecar_binding_core.js`の`canonicalValue()`/`canonicalJson()`は
**objectのkeyをsortする**が、**arrayの要素順序はsortしない**（配列のcanonical順序は
呼出側の責務、`canonicalJson()`はkeyのsortだけを保証する、という既存の役割分担）。

```
serializePrivateDictionaryCanonical(input):
  1. 呼出側(このモジュール内)が entries[] を entry_id のordinal順に事前ソートする
  2. 各entry内の aliases[] を (normalized key, display value) のordinal順に事前ソートする
  3. ソート済みの構造を canonicalJson() （既存、id_hash_utils.js経由）へ渡す
     -> canonicalJson() がobject keyのソートを行い、最終的なJSON文字列を返す
  4. timestamp等、hash対象外のfieldは (3) より前の段階で構造から除外しておく
```

`canonicalJson()`自体には手を入れない。

---

## 14. Import/Export Pure Boundary

P2-A1で**後続実装予定**（このStepでは実装しない）のpure API責務を次のように定義する。

| 関数名 | async | 責務 |
|---|---|---|
| `parsePrivateDictionaryJson(text)` | 不要 | JSON textをparseし、plain objectを返す。§10.4/§10.5の
  BOM/duplicate-key/byte-limitを含め検査し、構文エラーは§11の
  `DICTIONARY_JSON_SYNTAX_INVALID`でfail-closedに例外化する |
| `validatePrivateDictionary(input)` | 不要 | §10の全条件をplain objectに対して検査し、
  `{valid, errors}`（`errors`は§11形式の配列）を返す |
| `normalizePrivateDictionary(input)` | **必要**
  （`layer_view`側で`dictionary_fingerprint`を算出するため） | §14.1参照 |
| `createPrivateDictionaryLayerView(dictionary)` | **必要**
  （§5.7.1の`hashPrivateDictionaryCanonical()`呼び出しを含むため） | §5.7参照。
  validate済みのprivate dictionaryを内部layer view（§5.5）へ変換する |
| `createStandardDictionaryLayerView(tagVocabulary)` | **必要**
  （§5.6.1の`hashParts("tag-vocabulary-v1", ...)`によるfingerprint再計算、
  §5.6.2の`hashParts("private-dictionary-standard-entry-v1", ...)`による
  `entry_ref_id`導出、いずれも`hashParts()`経由で非同期のため） | §5.6参照。
  既存`tag_vocabulary`を内部layer view（§5.5）へ変換する |
| `serializePrivateDictionaryCanonical(input)` | 不要 | §13のcanonical serializationを行い、
  **canonical JSON string**を返す（§14.2参照。text/bytesの選択式ではない） |
| `hashPrivateDictionaryCanonical(input)` | **必要**
  （Browser側`crypto.subtle.digest()`がPromiseを返すため、Node/Browser双方で
  同一の`async`シグネチャに揃える） | §13.1のcanonical fingerprint算法
  （`hashParts()`不使用の直接SHA-256）を適用する |
| `mergeDictionaryLayers(layerViews)` | **必要**
  （内部で`await detectDictionaryLookupConflicts(layerViews)`を呼ぶため） | §14.4参照 |
| `detectDictionaryLookupConflicts(layerViews)` | **必要**
  （§9.2の`normalized_key_token`生成が`await hashParts(...)`を要するため） |
  §8.2〜§8.6のlookup key conflict検出だけを行う純関数（旧
  `detectAliasConflicts(entries)`から改称。単一辞書のentries[]ではなく、複数layerの
  内部view配列を受け取る責務であることを名前で明示する） |
| `createKnowledgeDictionaryBinding(metadata)` | 不要 | §15のallowlist copyを行い、
  `dataset.extensions.dictionary_binding`へ格納可能な最小metadataオブジェクトを返す |
| `createSanitizedLearningSummary(dictionary)` | **必要**
  （内部で`await hashPrivateDictionaryCanonical(dictionary)`を呼び、
  `dictionary_fingerprint`を自ら再計算するため。§14.5参照） | §16のsanitized
  summaryを生成する |
| `validateDictionaryStateTransition(previous, next)` | 不要 | §4の許可遷移allowlistに対し
  `(previous, next)`を検査し、有効/無効を返す |

async性の一覧（§14.2の境界と合わせて実装時に固定する）:

```
async function normalizePrivateDictionary(input)
async function createPrivateDictionaryLayerView(dictionary)
async function createStandardDictionaryLayerView(tagVocabulary)
async function hashPrivateDictionaryCanonical(input)
async function detectDictionaryLookupConflicts(layerViews)
async function mergeDictionaryLayers(layerViews)
async function createSanitizedLearningSummary(dictionary)
```

async化する理由（対象ごと）:

| 関数 | asyncな理由 |
|---|---|
| `createStandardDictionaryLayerView` | STANDARD fingerprint計算（§5.6.1）、STANDARD entry_ref_id計算（§5.6.2） |
| `createPrivateDictionaryLayerView` | private dictionary fingerprint計算（§5.7.1） |
| `normalizePrivateDictionary` | 内部で`createPrivateDictionaryLayerView()`を呼ぶため |
| `hashPrivateDictionaryCanonical` | private dictionary fingerprint計算そのもの |
| `detectDictionaryLookupConflicts` | normalized_key_token計算（§9.2） |
| `mergeDictionaryLayers` | 内部で`detectDictionaryLookupConflicts()`を呼ぶため |
| `createSanitizedLearningSummary` | summary用private dictionary fingerprintの再計算（§14.5） |

上記7関数以外（`parsePrivateDictionaryJson`／`validatePrivateDictionary`／
`serializePrivateDictionaryCanonical`／`createKnowledgeDictionaryBinding`／
`validateDictionaryStateTransition`）は同期関数（`async`不要）とする。

### 14.1 `normalizePrivateDictionary(input)`の戻り値schema

**この関数は`async`とする**（`layer_view`側の`dictionary_fingerprint`算出のため、
内部で`createPrivateDictionaryLayerView()`／`hashPrivateDictionaryCanonical()`を
呼ぶ）。

```
async function normalizePrivateDictionary(input)
```

```json
{
  "dictionary": "<validated display-value-preserving copy>",
  "layer_view": "<derived internal view>"
}
```

- `dictionary`: 入力を検証済みの状態でコピーしたもの。**表示値
  (`canonical_term`/`aliases`)は変更しない**（§5.3「表示値を破壊しないこと」）。
  normalized keyはここには混入させない。
- `layer_view`: §5.5の内部view形式（`createPrivateDictionaryLayerView()`相当の
  導出結果）。

**normalized keyをprivate dictionary export本体（`dictionary`側）へ混入させない**
（normalized keyは`layer_view`側にのみ現れる）。

### 14.2 境界の固定

- `parsePrivateDictionaryJson(text)`は**JSON textを受け取る**（`text: string`）。
- `serializePrivateDictionaryCanonical(input)`の戻り値は**canonical JSON string
  （UTF-8へ変換する前のJavaScript string）に一意化する**（「textまたはbytes」という
  選択式にしない）。
  - BOMなし
  - 改行を含める場合はLF
  - `JSON.stringify`相当のcompact JSON（§13の規則に従ったkey/array順序）
  - このstringをUTF-8 bytesへ変換する処理は`hashPrivateDictionaryCanonical()`が
    内部で`TextEncoder`を用いて行う（§13.1）。`serializePrivateDictionaryCanonical()`
    自身はbytes化しない。
  - file export時の`Blob`化は**P2-A2側の責務**とする（P2-A1のこの関数はstringを
    返すだけで、`Blob`/download等のbrowser APIには一切触れない）。
- **filesystem、Blob、download、FileReaderを扱わない**。

### 14.3 このStepでは実装しない

上記の**関数名とその責務を設計として固定する**に留め、実装は行わない。

### 14.4 `mergeDictionaryLayers(layerViews)`の戻り値schema

**この関数は`async`とする**（内部で`await detectDictionaryLookupConflicts(layerViews)`
を呼び、その結果（conflict一覧と`normalized_key_token`）を使って
`effective_vocabulary`／`conflicts`／`excluded_lookup_key_tokens`を組み立てる）。

```
async function mergeDictionaryLayers(layerViews)
```

```json
{
  "effective_vocabulary": {
    "allowed_tags": [],
    "aliases": {}
  },
  "conflicts": [],
  "excluded_lookup_key_tokens": [],
  "source_fingerprints": []
}
```

要件:

- `effective_vocabulary.allowed_tags`は、各canonical group（§8.6）の
  `canonical_display`を、**canonical normalized key、次にdisplayのordinal順**で
  並べた配列とする。STANDARD由来のcanonical tag集合と、DOMAIN/PROJECT/SESSIONの
  ACTIVE entryが導入する新規canonical tag集合の**和集合**になる（§3.2）。
- `effective_vocabulary.aliases`は、**alias displayからcanonical displayへの
  mapping**（既存`tag_vocabulary.aliases`と同じ`{alias: canonical}`形）とする。
- **同一display aliasが複数存在する場合もnormalized keyで衝突判定する**（表示値の
  文字列一致ではなく、§8.1のnormalized keyで判定する。表示値のバリエーション
  （表記ゆれ）が異なっていても、normalized keyが一致すれば§8.4/§8.5の対象となる）。
- **conflict keyは`effective_vocabulary`へ含めない**（§8.5で除外されたkeyは、
  `allowed_tags`にも`aliases`にも現れない）。
- `excluded_lookup_key_tokens`は、§8.5により除外された各normalized lookup keyの
  `normalized_key_token`（§9.2の生成規則）を、ordinal順に並べた配列とする（衝突した
  raw keyそのものではなく、tokenとして保持する。§9.2の機密上の限界と同じ制約を
  ここでも適用する）。
- `source_fingerprints`は、入力`layerViews`のうち実際に使われたlayerの
  `dictionary_fingerprint`を、**scope priority順**（`SESSION, PROJECT, DOMAIN,
  STANDARD`）に並べた配列とする。
- **入力`layerViews`（layer配列・entry配列・alias配列）を変更しない**（読み取り専用）。
- **戻り値も決定的な順序**を持つ（同じ入力からは常に同じ出力配列順序）。
- **STANDARD inputを変更しない**（`createStandardDictionaryLayerView()`の出力を
  そのまま読むだけで、書き換えない）。

### 14.5 `createSanitizedLearningSummary(dictionary)`のfingerprint再計算契約

**この関数は`async`とする。** `dictionary_fingerprint`（§16）は、呼出側から
渡された未検証の値をそのまま信用せず、**関数内部で
`await hashPrivateDictionaryCanonical(dictionary)`を実行して自ら再計算する**。

```
async function createSanitizedLearningSummary(dictionary)
```

理由: `dictionary_fingerprint`は、辞書の内容を一意に識別するための値であり
（§13.1）、外部から渡された値をそのまま使うと、呼出側の実装ミスや改ざんにより、
`dictionary`の実際の内容と一致しないfingerprintがsummaryへ紛れ込む余地が生まれる。
canonical fingerprintの計算コスト自体は軽い（`serializePrivateDictionaryCanonical()`
+ SHA-256）ため、`createSanitizedLearningSummary()`は常に自分自身で
`dictionary`から再計算し、外部入力のfingerprintを受け取らない・信用しない設計とする。

---

## 15. Knowledge JSON Boundary

配置場所は次に**限定**する。

```
dataset.extensions.dictionary_binding
```

`Node.extensions`や`Edge.extensions`へは配置しない。

### 許可field

```json
{
  "dictionary_id": "opaque string",
  "version": "string",
  "scope": "PROJECT",
  "sha256": "64 lowercase hex",
  "entry_count": 0,
  "content_included": false
}
```

`effective_vocabulary`（§14.4のmerge結果）は、Knowledge bindingへ**含めない**
（bindingはあくまで「このdatasetがどのdictionaryを参照したか」を示す最小metadataで
あり、`effective_vocabulary`の実体や`normalized_key_token`のようなmerge処理の
中間生成物は一切含めない）。

### 禁止field

- `canonical_term`
- `aliases`
- `entries`
- source text
- document name
- locator
- customer
- model
- original input
- learning audit details
- `normalized_key_token`（§9.2で規定した通り、Knowledge bindingへは出力しない）

### allowlist copyの必要性

既存`knowledge-data/0.1`の`extensions`は**validation対象外**であるため、もし
`createKnowledgeDictionaryBinding()`が入力objectを検証なしにそのまま
`dataset.extensions.dictionary_binding`へ代入する実装になっていた場合、辞書本体が
Knowledge JSON export経由でそのまま漏れてしまう経路になり得る。

したがって`createKnowledgeDictionaryBinding(metadata)`は、**入力objectをそのまま
返さない**。上記「許可field」のみを1つずつ明示的にコピーするallowlist copyとして
設計する。

`dataset`へ実際に接続する処理（`dataset.extensions.dictionary_binding = ...`という
代入そのもの）は**P2-A2以降**とする。

---

## 16. Sanitized Learning Summary

summaryへ**辞書本文を含めない**。

```json
{
  "schema_version": "dictionary-learning-summary/1.0",
  "dictionary_fingerprint": "sha256",
  "entry_count": 0,
  "status_counts": {
    "PROBATION": 0,
    "ACTIVE": 0,
    "OBSERVING": 0,
    "QUARANTINED": 0,
    "RETIRED": 0
  },
  "utility_totals": {
    "exposure_count": 0,
    "match_opportunity_count": 0,
    "candidate_gain": 0,
    "ranking_gain": 0,
    "candidate_noise_increase": 0,
    "alias_conflict_count": 0,
    "document_support_count": 0
  },
  "raw_terms_included": false
}
```

`dictionary_id`は案件名を含む可能性があるため、sanitized summaryでは**原則として
出力せず**、canonical dictionaryのfingerprint（§13.1）を`dictionary_fingerprint`
として使用する。

**`normalized_key_token`もsanitized summaryへは出力しない**（§9.2）。summaryは
集計値（件数・合計）のみであり、いかなるlookup key由来の値も含まない。

---

## 17. Security Boundary

次を設計上**禁止**する。

- fetch
- XMLHttpRequest
- WebSocket
- EventSource
- sendBeacon
- telemetry
- analytics
- localStorage
- sessionStorage
- IndexedDB
- File System Access API
- 自動download
- 自動clipboard書込み
- consoleへの辞書内容出力
- errorへの辞書内容出力（§11で規定済み）

private dictionaryはメモリ内に保持し、**人が明示exportしない限り永続化しない**。

Step 3の調査で確認した既存runtime（`core/*.js`・HTML本体）は、この境界を既に
満たしている。P2-A1の新規core`private_dictionary_learning_core.js`も、既存core群と
同じ制約（UMD wrapper + pure function、副作用なし）で実装する設計とし、この境界を
継承する。

---

## 18. Memory Lifetime

### 18.1 P2-A1 coreはstateful session managerではない

P2-A1 core自体は、SESSION/PROJECT/DOMAIN辞書を内部に保持し続ける**stateful
session manager ではない**。P2-A1が提供するのは§14の一連のpure関数群であり、
いずれも入力を受け取って新しいimmutableな値（`dictionary`／`layer_view`／
merge結果等）を返すだけで、呼出しの間で状態を保持しない。

- memory lifetime policy（下記表）は**設計として残す**（将来、呼出側／UI層が
  実際にSESSION辞書等をどう保持・破棄すべきかの指針として）。
- UI eventからのreset呼出し（実際のイベントハンドラ配線）は**P2-A2へ延期**する。
- **P2-A1のpublic APIへ、実体を持つreset関数（例:
  `resetSessionDictionary()`のような、内部状態を書き換えるstateful関数）を
  追加しない**。
- P2-A1は**immutableなdictionary／layer viewを返すだけ**である。
- 「reset」は、P2-A1 coreの関数呼び出しによってではなく、**呼出側が保持している
  参照を破棄する**ことによって行われる（例えば、呼出側の状態管理コードが
  `sessionDictionary = null`のように、それまで保持していた戻り値への参照を
  手放すだけで完結する。P2-A1 core内部にはそもそも破棄すべき状態がない）。

### 18.2 Memory lifetime policy（呼出側が従うべき指針。P2-A1のAPI契約ではない）

| イベント | SESSIONを破棄 | PROJECT importを維持 | 全辞書を破棄 |
|---|---|---|---|
| 新しい作業セッション開始時 | する | する（維持） | しない |
| datasetリセット時 | する | する（維持） | しない |
| DOMAINまたはPROJECTを再import | **する**（SESSIONを破棄する。加えて、derived
  layer view・merge cache・（将来保持している場合の）counterfactual結果もすべて
  無効化する。理由: SESSION学習結果はそれまでのDOMAIN／PROJECTを前提にしており、
  base dictionaryが変わった後もSESSION側を維持することは、無効な前提に基づいた
  学習結果を使い続けることになるため） | しない（再importされた対象そのものは
  新しい内容へ置き換わる） | しない |
| SESSIONを再import | 既存SESSIONを新しい**valid**なSESSIONへ**置換**する
  （破棄してから空にするのではなく、新しい有効なSESSIONで直ちに差し替える） |
  する（PROJECT／DOMAINは維持） | しない |
| 明示的な学習リセット時 | する | しない（この操作自体がPROJECT/SESSION双方を
  対象にする明示操作であるため） | する |
| ページ終了時 | する（メモリ上の状態のため、明示exportしていなければ内容は失われる） |
  -（メモリごと消える） | する（結果的に） |
| fatal validation error発生時 | §18.3参照（atomic no-op。SESSIONを自動破棄しない） |
  する | しない |

### 18.3 fatal validation error時の atomic no-op 契約

fatal validation errorが発生した場合、P2-A1のpure関数群は次を満たす**atomic
no-op**として振る舞う。

- **rejected inputを保持しない**（呼出元へエラーを返すだけで、拒否した入力を
  内部のどこにも保存しない）。
- **accepted dictionary stateを変更しない**（既に有効と判定されている状態が
  あれば、それは一切書き換わらない。もともとP2-A1 coreはstatefulではないため
  「変更しない」というのは、呼出側が保持している既存の有効な値への参照が、
  P2-A1の関数呼び出し自体によって書き換えられることはない、という意味）。
- **SESSIONを自動消去しない**（fatal validation errorが発生したという事実だけを
  理由に、呼出側のSESSION状態を自動的に破棄する副作用をP2-A1側からは起こさない。
  破棄するかどうかは、常に呼出側の判断とする）。
- **error inputの部分適用をしない**（entries[]の一部だけを取り込む、といった
  中途半端な適用は行わない。全部拒否のみ）。
- **atomic no-op**（成功か、完全な失敗（無変化）かのいずれかのみで、中間状態が
  生じない）。
- **raw rejected inputをdiagnostic用に保存しない**（§11のerror sanitizationと
  同じ理由。エラー診断のために生入力を内部へ保持する、という設計は取らない）。

---

## 19. Backward Compatibility

- `knowledge-data/0.1` schema versionは**変更しない**。
- old datasetは`dictionary_binding`なしで**有効**（従来通り）。
- `dictionary_binding`は`dataset.extensions`内の**任意metadata**。
- 既存`tag_vocabulary`とは**別契約**（§3参照。STANDARDは既存`tag_vocabulary`の責務のまま。
  `createStandardDictionaryLayerView()`は既存`tag_vocabulary`を**読むだけ**で、
  書き換えない）。
- `DEFAULT_TAG_VOCABULARY`を**変更しない**。
- adaptersを**変更しない**（`excel_direct_adapter.js`／`pdf_direct_adapter.js`／
  `trace_json_adapter.js`、いずれも無変更）。
- matching scoreを**変更しない**（`relation_candidate_engine.js`は無変更）。
- `effective_vocabulary`をmatching/adapterへ接続する配線は**P2-A2以降**
  （§1/§3参照。P2-A1では生成するだけで、どこにも渡さない）。
- frozen evaluation baselineを**変更しない**。
- `alpha_next_p1`packageを**変更しない**。

### 正直に記載する制約

`extensions`が自由形式であるため、**P2-A1単独では第三者コードによるprivate term混入を
全面的には防げない**。`dataset.extensions.dictionary_binding`はvalidation対象外の
自由領域に置かれる以上、`createKnowledgeDictionaryBinding()`を経由しない別のコードが、
許可field以外の内容を書き込むことを、Knowledge Data Contract 0.1自体の検証ルール
（`validateDataset()`）は防げない。

**P2-A2以降の公式接続経路では、`createKnowledgeDictionaryBinding()`のような
sanitized constructorだけを使用する必要がある。**

---

## 20. Planned File Set

**new（後続実装時。このStepでは作成しない）**:

- `tools/knowledge_builder/core/private_dictionary_learning_core.js`
- `tools/knowledge_builder/verification/private_dictionary_learning_core_verification.js`

**current Step（このStepで修正する唯一のファイル）**:

- `tools/knowledge_builder/design/private_dictionary_learning_contract_0.1.md`

既存runtime file（adapters／`knowledge_store.js`／`relation_candidate_engine.js`／
HTML／`quantity_sidecar_binding_core.js`／`id_hash_utils.js`）は**P2-A1では変更しない
予定**とする。

---

## 21. Verification Plan

後続（P2-A1実装Step）で必要となるtest項目を、設計段階で列挙する。

1. valid dictionary PASS
2. malformed schema reject
3. duplicate entry_id reject
4. normalized alias duplicate reject
5. canonical／alias collision reject
6. invalid status reject
7. invalid state transition reject
8. negative utility reject
9. non-integer utility reject
10. NaN／Infinity reject
11. `content_included=true` reject
12. forbidden property at every depth reject
13. `Object.prototype` pollutionなし
14. cyclic object reject
15. sparse array reject
16. getter／setter reject
17. oversized input reject（§12の各上限、1つずつ）
18. same input gives byte-identical canonical serialization
19. semantically equivalent ordering gives same canonical bytes
20. same canonical bytes gives same fingerprint
21. layer collision does not silently overwrite
22. conflict record contains no raw terms
23. QUARANTINED excluded from active lookup
24. RETIRED excluded from active lookup
25. STANDARD input remains unmodified
26. Knowledge binding contains allowlisted metadata only
27. Knowledge binding contains no terms
28. sanitized summary contains no terms
29. error contains code/path only
30. no network primitive
31. no persistence primitive
32. no console output from core
33. input objects are not mutated
34. same inputs produce deterministic conflict ordering
35. canonical hash is SHA-256 of exact UTF-8 bytes
36. canonical hash is not `hashParts()` output
37. Node and Browser hashing produce same result
38. STANDARD tag vocabulary converts to immutable STANDARD layer view
39. new ACTIVE private canonical term enters effective allowed_tags
40. same normalized canonical key merges into one canonical group without conflict
41. canonical-alias conflict detected
42. alias-alias conflict detected
43. same key to same canonical deduplicates without conflict
44. ID format violation rejected
45. version format violation rejected
46. duplicate JSON key rejected
47. UTF-8 byte limit enforced before parse
48. utility totals overflow rejected
49. core exports no stateful reset or persistence API
50. fatal validation failure is atomic no-op
51. persisted DOCUMENT_EXTRACTED ACTIVE snapshot is accepted
52. persisted SYSTEM_DERIVED ACTIVE snapshot is accepted
53. normalized key token absent from binding and summary
54. effective vocabulary ordering is deterministic
55. merge result contains no excluded conflicted key
56. normalized internal fields absent from canonical export
57. malformed STANDARD vocabulary is rejected, not converted to empty
58. STANDARD alias target outside allowed_tags is rejected
59. invalid STANDARD vocabulary_sha256 is rejected
60. DEFAULT_TAG_VOCABULARY without vocabulary_sha256 is accepted using recomputed fingerprint
61. supplied STANDARD vocabulary_sha256 mismatch is rejected
62. STANDARD entry_ref_id is deterministic and matches ^std-[0-9a-f]{32}$
63. conflict detection and merge await async normalized_key_token generation
64. createSanitizedLearningSummary recomputes private dictionary fingerprint
65. serializePrivateDictionaryCanonical returns canonical JSON string, not environment-dependent bytes

項目40注記: §8.2.1の通り、canonical対canonicalの比較はconflictを生まない（同じ
canonical keyなら統合、異なるcanonical keyなら比較対象外）。したがって
「canonical-canonical collision detected」という旧項目は誤った前提（この組み合わせ
からconflictが生じる）に基づいており、削除・置換した。

項目49注記: P2-A1 coreはstateful session managerではない（§18.1）。したがって
「DOMAIN/PROJECT re-import invalidates SESSION contract」は、statefulな
session管理を前提とする検査であり、pureなP2-A1 core単体では実行できない。
P2-A1で検査可能なのは、core自身が状態を保持しない・入力を変更しない・validation
失敗時に戻り値を生成しない・呼出側の既存objectを変更しない・rejected inputを
保存しない、という性質だけである。

項目51/52注記: §5.8.1の通り、private dictionary snapshotのvalidationは
`source.kind`によって`status`を制限しない。以前のセッションで正当に`PROBATION`
から`ACTIVE`へ昇格した`DOCUMENT_EXTRACTED`／`SYSTEM_DERIVED`由来entryを含む
snapshotは、再importで正しく受理されなければならない。

### 21.1 P2-A2 deferred verification（P2-A1のverification planには含めない）

次は、statefulなsession/state統合が前提となるため、P2-A2以降のUI/state
integration verificationへ委譲する。P2-A1のverification planには含めない。

- DOMAIN再import clears SESSION and derived caches
- PROJECT再import clears SESSION and derived caches
- valid SESSION reimport atomically replaces previous SESSION
- invalid reimport preserves previous accepted state
- newly created DOCUMENT_EXTRACTED entry starts as PROBATION
- newly created SYSTEM_DERIVED entry starts as PROBATION

これらはP2-A2で、新規entry生成のinitialization policy（§5.8.2）と、実際の
session state管理が実装された後に検証する。

これら（#1-#65、および§21.1を除く）はすべて、既存
`tools/knowledge_builder/verification/`の`assert()`ヘルパー + PASS/FAIL集計 +
`process.exit(failures?1:0)`という規約に従ったNode-only verificationとして
実装する想定とする。

---

## 22. Deferred Work

### P2-A2

- document term extraction
- alias candidate extraction
- SESSION dictionary population
- private dictionary UI import/export
- `dataset.extensions.dictionary_binding` wiring
- `effective_vocabulary`を`matchInitialTags()`へ渡す配線
- UI eventからのreset呼出し配線（§18.1）

### P2-B

- baseline/trial counterfactual matching
- exposure/opportunity/gain/noise measurement
- utility accumulation
- promotion recommendation

### P2-C

- automatic PROJECT promotion
- automatic quarantine
- anomaly detection
- rollback実行（§4.1のversion/snapshot復元操作の実装）
- exception notification
- learning stop switch

---

## 23. Explicitly Not Implemented

### A. Step 4（design-only）で未実装

このStep（および先行するStep 4/4R）で作成したのは設計書1ファイルのみであり、次は
一切含まない。

- core code
- verification code
- fixtures
- commit
- push

### B. P2-A1全体（後続の実装Stepを含む）で未実装

P2-A1が今後core/verificationを実装した場合でも、次はP2-A1のスコープ外のまま
実装しない。

- UI
- document extraction
- matching integration
- Candidate score変更
- utility実測
- automatic promotion policy
- automatic quarantine policy
- rollback execution
- persistence
- external AI
- external communication
