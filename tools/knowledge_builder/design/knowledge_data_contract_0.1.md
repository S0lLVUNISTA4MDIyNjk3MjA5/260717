# Knowledge Data Contract 0.1（Phase 0 提案）

**状態**: 提案 / レビュー待ち（未実装・未固定）
**方針**: α版最小コア。後方拡張可能。
**作成日**: 2026-07-31

---

## 0. 本Contractの設計方針

Knowledge Data Builder はα版であり、**将来仕様を網羅した完全な基盤設計よりも、人が実データを
投入して Node生成・Edge生成・修正・グラフ確認を実際に評価できる動作物の早期提供を優先する。**

したがって本Contractは次の原則で設計する。

| 原則 | 具体化 |
|---|---|
| **最小必須** | 評価ループ（Drop → Node → Edge → 修正 → Graph）に不可欠なfieldのみ必須にする |
| **後方拡張可能** | 将来fieldは *予約名* として §11 に列挙し、追加が破壊的変更にならないようにする |
| **enumは追加で拡張** | `node_type` / `relation_type` 等は値の追加のみで拡張し、構造は変えない |
| **逃げ道を常に持つ** | 全オブジェクトに `extensions`（自由形・validation対象外）を置く |
| **迷ったら後回し** | 評価で必要性が実証されていないものは 0.1 に入れない |

**0.1で固定するのは「壊すと後で高くつくもの」だけ**である。具体的には
ID規則・provenance・content_hash・レビューの人/AI分離・既存Export互換境界の5点。
それ以外は評価結果を見て 0.2 以降で段階的に強化する。

---

## 1. 既存実装の調査結果と互換性制約（変更不可の事実）

設計判断の前提として、既存実装を実際に確認した結果を示す。**これらは推測ではなく実コードの引用**
であり、Knowledge Contract を拘束する。

### 1.1 content_hash の入力fieldは producer で分岐する（最重要）

`tools/quantity_sidecar_binding_core.js` `computeRecordContentHash()`（162行目）:

```javascript
// PDF側（source_raw_text を持つ）
input = { trace_id, source_raw_text, tags }
// Excel側（source_record を持つ）
input = { trace_id, source_record, source_record_display, tags, source_row }
return hashParts('content-hash-v1', [canonicalJson(input)]);
```

**帰結**: 既存 Quantity Sidecar / 照合ツールへ再Exportする限り、Knowledge Node は
以下を**逐語保持**しなければならない。失うと `content_hash` が変わり binding が fail-closed する。

| producer | 逐語保持が必須 |
|---|---|
| PDF | `trace_id`, `source_raw_text`, `tags` |
| Excel | `trace_id`, `source_record`, `source_record_display`, `tags`, `source_row` |

これは「Nodeは正規化済み本文だけ持てばよい」という設計を**禁止**する。
→ §6.1 `provenance.verbatim` を必須fieldにする根拠。

### 1.2 dataset_signature は trace_id ソート順に依存する

`computeDatasetSignature()`（156行目）は `trace_id` 昇順ソート後に
`hashParts('dataset-signature-v1', [canonicalJson(sorted)])`。`trace_id` 重複は例外送出。

**帰結**: `trace_id` は Node から決定的に復元できなければならない。→ §3 `export_binding.trace_id` 必須。

### 1.3 正規化・ハッシュ契約は固定済み

```javascript
normalize(v)  = NFKC → CRLF正規化 → 行末空白除去 → 連続空白圧縮 → trim   // "v12-normalize-v1"
hashParts(ns, parts) = sha256([ns, ...parts.map(normalize)].join('\0'))
```

**帰結**: 新規ハッシュも**この実装を再利用**する。独自正規化を新規に作らない（drift防止）。

### 1.4 既存ID契約

| ID | 規則 |
|---|---|
| `quantity_id` | `q-` + SHA-256先頭128bit（32桁hex） |
| `dataset_signature` | `QA-SHA256:` + 64桁hex |
| 連結方式 | UTF-8 netstring `<byte長>:<値>,`（任意文字列の区切り衝突回避のため。実装コメント2429行目に明記） |

### 1.5 既存レビューfieldの実値

実装で確認した値域:
- `review_status`: `unreviewed` / `reviewed` / `needs_fix` / `excluded`
- AI metadata 5項目: `ai_reviewed` / `ai_reviewed_at` / `ai_review_method` / `ai_review_model` / `ai_review_comment`
- 既存B-4レビュー共通target形: `{status, reviewer, reviewed_at, verdict, note}`

→ §7 ReviewState はこれらと1対1で写像できる形にする。

---

## 2. 0.1 のスコープ

### 2.1 含むもの（最小コア）

- `KnowledgeNode` / `KnowledgeEdge` / `KnowledgeDataSet` の必須構造
- ID規則・content_hash定義
- provenance（元文書への遡及）
- 人/AIレビューの分離と stale 判定
- Actor と最小Operation History
- 既存 TraceRecordSet / Quantity Sidecar との境界
- Validation（fail-closed）

### 2.2 含まないもの（0.2以降。§11に予約名を列挙）

Matching Profile本体schema / confidence threshold / Ontology語彙定義 /
Graph DB・Vector DBストレージ形式 / 自動設計 / AI Agent自律変更 /
Word対応 / PLM・CAD連携 / クラウド化 / 共同編集 / UI schema

---

## 3. KnowledgeNode 0.1

### 3.1 必須構造（これだけ）

```jsonc
{
  "node_id":     "kn-<32桁hex>",           // 必須。決定的（§8）
  "node_type":   "requirement",             // 必須。enum（§3.2）
  "text":        "空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。",  // 必須
  "title":       "使用環境",                 // 必須（null許容）
  "tags":        ["使用温度"],               // 必須（空配列可）
  "unregistered_tags": [],                  // 必須（空配列可）
  "semantics":   { /* §6.2 */ },            // 必須
  "quantities":  [ /* §6.3 */ ],            // 必須（空配列可）
  "parent_node_id": "kn-...",               // 必須（null許容）
  "provenance":  { /* §6.1 */ },            // 必須
  "revision":    { /* §6.5 */ },            // 必須
  "review":      { /* §7 */ },              // 必須
  "export_binding": {                       // 必須（§1.2 互換性要件）
    "trace_id": "req-use-temperature"
  },
  "confidence":  0.91,                      // 必須。0..1。例外レビュー選別用（指示§16）
  "extensions":  {}                         // 必須（空オブジェクト可）。自由形
}
```

**0.1で意図的に外したもの**（§11に予約）: `text_parts` / `key_text` / `hierarchy.path` /
`hierarchy.ordinal` / `confidence` の内訳分解。
評価で必要性が判明した時点で追加する（追加は非破壊）。

### 3.2 `node_type`（0.1のenum）

| node_type | 意味 |
|---|---|
| `document` | 文書そのもの（Structural） |
| `section` | 章・節・シート（Structural） |
| `requirement` | 要求事項 |
| `design_item` | 設計項目 |
| `verification_item` | 検証・試験項目 |
| `statement` | 上記に分類しきれない意味単位（フォールバック） |

`document` / `section` は Structural Node、他は意味単位。同一schemaで表現し `node_type` で区別する。
将来の `function` / `constraint` / `interface` / `test_case` / `part` / `parameter` 等は
**enum追加のみ**で拡張する。

---

## 4. KnowledgeEdge 0.1

### 4.1 必須構造

```jsonc
{
  "edge_id":           "ke-<32桁hex>",     // 必須。決定的（§8）
  "source_node_id":    "kn-...",            // 必須
  "target_node_id":    "kn-...",            // 必須
  "relation_category": "semantic",          // 必須 "structural" | "semantic"（§4.3）
  "relation_type":     "satisfied_by",      // 必須。enum（§4.2）
  "lifecycle":         "active",            // 必須 "candidate" | "active" | "rejected"（§4.4）
  "confidence":        0.89,                // 必須。0..1
  "evidence":          { /* §4.5 */ },      // 必須
  "generation":        { /* §4.6 */ },      // 必須
  "revision":          { /* §6.5 */ },      // 必須
  "review":            { /* §7 */ },        // 必須
  "extensions":        {}                   // 必須
}
```

**0.1で意図的に外したもの**（§11に予約）: `direction`（0.1は全て有向）/
`comparison`（数量比較結果の埋め込み。0.1は `evidence.features` に含める）。

### 4.2 `relation_type`（0.1のenum）

| relation_type | category |
|---|---|
| `related_to` | semantic |
| `satisfied_by` | semantic |
| `implemented_by` | semantic |
| `verified_by` | semantic |
| `contains` | structural |
| `belongs_to` | structural |

将来拡張（0.1では受け付けない）: `requires`, `derived_from`, `allocated_to`, `depends_on`,
`constrains`, `conflicts_with`, `references`, `supersedes`。

`relation_type` ↔ `relation_category` の対応は上表で固定し、validationで整合を検査する。

### 4.3 Structural と Semantic の分離（指示§7）

同一schemaを使い `relation_category` で区別する。

| | structural | semantic |
|---|---|---|
| 生成 | Structuring Engine（決定的） | Relation Engine（規則＋AI） |
| `confidence` | 常に `1.0` | 0..1 |
| `lifecycle` | 常に `active` | `candidate` → `active`/`rejected` |
| 文書をまたぐ | またがない | またぐ |
| review | `not_applicable` | 必要 |

上4条件はvalidationでfail-closed検査する（§9）。

### 4.4 `lifecycle`（Candidate と Edge の区別。指示§18）

| lifecycle | 意味 | Graph既定表示 | Export |
|---|---|---|---|
| `candidate` | Relation Engine生成の候補。未採用 | 別レイヤー | 含めない |
| `active` | 確定Edge（自動昇格または採用） | 表示 | 含める |
| `rejected` | 却下。再生成抑止のため保持 | 非表示 | 含めない |

**設計判断（要レビュー）**: 別コレクションに分けず単一schemaの `lifecycle` で区別する。
理由は (a) ID規則・validation・履歴を一本化できる (b) 昇格がfield更新のみで済み `rejected`
の履歴も自然に残る (c) schema二重定義を避けられる。別コレクション方式が望ましければ差し戻し希望。

**`active` であることと「確認済み」は別状態**（指示§18末尾）。高confidence候補の自動昇格は
`lifecycle:"active"` かつ `review.*.status:"unreviewed"` で表す。自動昇格でも
`generation.generated_by` / `confidence` / `evidence` は必ず残す。

### 4.5 `evidence` — Matching Features（指示§8）

**`matching_key` という単一項目は持たない。** 実際に寄与したFeatureを列挙する。

```jsonc
"evidence": {
  "matching_profile_id": "mp-default-v1",   // 必須（null許容）
  "features": [                              // 必須（1件以上）
    { "feature": "semantic_tag",       "detail": {"matched":["使用温度"]},          "effect": "supports" },
    { "feature": "property_concept",   "detail": {"concept_id":"temperature.operating"}, "effect": "supports" },
    { "feature": "quantity_dimension", "detail": {"dimension":"temperature",
                                                   "result":"satisfied"},            "effect": "supports" },
    { "feature": "text_similarity",    "detail": {"score":0.61},                     "effect": "supports" }
  ]
}
```

`feature` enum（0.1）: `subject` / `property_concept` / `quantity_dimension` / `unit` /
`semantic_tag` / `hierarchy` / `text_similarity` / `manual`
`effect` enum: `supports` / `opposes`（既存 `evidenceItem` と語彙統一）

**0.1では `weight` / `contribution` を必須にしない**（§11予約）。α評価に必要なのは
「何を根拠にこのEdgeができたか」が読めることであり、重み配分の妥当性評価は Phase 4 の課題。

`matching_profile_id` は参照のみ。Profile本体schemaは Phase 4 で確定する。

### 4.6 `generation`

```jsonc
"generation": {
  "generated_by": { /* §6.4 Actor */ },      // 必須
  "generated_at": "2026-07-31T00:05:00.000Z",// 必須
  "engine":       "relation-engine",          // 必須
  "source_node_content_hash": "<64桁hex>",   // 必須（§6.5 stale判定用）
  "target_node_content_hash": "<64桁hex>"    // 必須（同上）
}
```

---

## 5. KnowledgeDataSet 0.1

```jsonc
{
  "schema_version": "knowledge-data/0.1",    // 必須（const）
  "dataset_id":     "kd-<32桁hex>",          // 必須
  "generated_at":   "2026-07-31T00:00:00.000Z",  // 必須
  "generator":      { "tool": "...", "version": "..." },  // 必須（既存generatorと同形）
  "provenance": {                             // 必須
    "hash_algorithm":    "SHA-256",           // const（既存と同一）
    "id_hash_algorithm": "SHA-256/128",       // const（既存と同一）
    "normalization":     "v12-normalize-v1",  // const（既存と同一。§1.3）
    "ruleset_version":   { }                  // 必須（空オブジェクト可）。engine別の版数
  },
  "sources":        [ /* §5.1 */ ],           // 必須
  "tag_vocabulary": { /* §5.2 */ },           // 必須
  "nodes":          [ /* §3 */ ],             // 必須
  "edges":          [ /* §4 */ ],             // 必須
  "operations":     [ /* §6.4 */ ],           // 必須（空配列可）
  "diagnostics":    [ /* §9.3 */ ],           // 必須（空配列可）
  "extensions":     {}                        // 必須
}
```

### 5.1 SourceDocument

```jsonc
{
  "source_document_id": "sd-<32桁hex>",       // 必須
  "file_name":      "customer_hvac_requirements.pdf",  // 必須
  "producer":       "pdf",                     // 必須 "pdf" | "excel"
  "content_digest": "<64桁hex>",               // 必須。実ファイルのSHA-256
  "document_number":"CHV-REQ-001",             // 必須（null許容）
  "revision":       "Rev. A",                  // 必須（null許容）
  "ingested_at":    "2026-07-31T00:00:00.000Z",// 必須
  "extensions":     {}
}
```

`content_digest` を必須にする理由: `revision`（"Rev. A"）は文書側の申告値で改訂検出に使えない。
実ファイルのdigestを持つことで §6.5 の stale 判定へ接続できる。

### 5.2 tag_vocabulary

既存 `shared/tag_vocabulary.json`（`trace-tag-vocabulary/1.0`）を**そのまま埋め込む**。

```jsonc
{
  "schema":             "trace-tag-vocabulary/1.0",
  "vocabulary_id":      "trace-domain-ja",
  "vocabulary_version": "1.0.0",
  "allowed_tags":       ["安全","性能","機能","品質","インターフェース","製造","検査","保守"],
  "aliases":            {},
  "vocabulary_sha256":  "<64桁hex>"
}
```

既存契約どおり `vocabulary_sha256` は**キャッシュせず出力時点の有効タグ集合から再計算**する。
辞書ファイル本体には含めない（自己参照回避）。

---

## 6. 共通型

### 6.1 SourceReference（provenance）— 必須概念（指示§4）

```jsonc
"provenance": {
  "source_document_id": "sd-<32桁hex>",       // 必須
  "producer":  "pdf",                          // 必須 "pdf" | "excel"
  "locator": {                                 // 必須。kindによる判別可能な共用体
    "kind":         "pdf",
    "page":         2,                         // 必須
    "source_path":  "$.sections[0].content[0]",// 必須
    "section_id":   "sec-2-1",                 // 必須（null許容）
    "section_number":"2.1",                    // 必須（null許容）
    "section_title":"使用環境",                 // 必須（null許容）
    "block_id":     "block-2-1-1"              // 必須（null許容）
    // kind == "excel" の場合:
    // { "kind":"excel", "sheet":"設計検討表", "row":5, "source_path":"$._trace_records[0]" }
  },
  "verbatim": {                                // 必須。§1.1 互換性要件
    "source_raw_text": "空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。"
    // producer=="excel" の場合:
    // { "source_record": {...}, "source_record_display": null, "source_row": 5 }
  },
  "extensions": {}
}
```

**`verbatim` を必須にする理由**（重要）: §1.1 のとおり既存 `computeRecordContentHash()` は
この値をそのままハッシュ入力に使う。原文を捨てる設計にすると既存Exportが**構造的に不可能**になる。
`text`（表示・解析用）と `provenance.verbatim`（原文）は**別field**であり混同してはならない。

### 6.2 SemanticAttributes（0.1は最小）

```jsonc
"semantics": {
  "subject":        { "text": "空調ユニット", "concept_id": null },   // 必須（値はnull許容）
  "property":       { "text": "周囲温度", "concept_id": "temperature.operating" }, // 必須（同上）
  "statement_type": "constraint",             // 必須。enum
  "derived_by":     { /* §6.4 Actor */ },     // 必須
  "extensions":     {}
}
```

`statement_type` enum（0.1）: `constraint` / `capability` / `behavior` / `structure` /
`procedure` / `information`

**0.1で意図的に外したもの**（§11予約）: `modality`（shall/should/may）/ `polarity` /
`conditions` / semantics内の個別confidence。
これらは意味解析の精度評価が始まってから追加する方が、値域を実データに合わせられる。

**意味付与が未実施の表現**: `semantics: {}` ではなく
`subject.text: null`, `property.text: null`, `statement_type: "information"` とする。
Node Table のフィルタ・ソートが常に同じ形を仮定できるようにするため。

`concept_id` は既存 `propertyResolution.concept_id` と**同じ名前空間**を使う。
候補列挙（`candidates[]`）は Node に持たせない — property resolution は「2つのNodeを比較する文脈」で
確定する情報であり、既存実装でも comparison record 側にある。

### 6.3 Quantity — 既存契約をそのまま埋め込む

**再定義しない。** 既存 `quantity-annotation/1.0-rc1` の analysis 構造をそのまま使う。

```jsonc
"quantities": [
  {
    "quantity_id":     "q-<32桁hex>",         // 既存規則
    "source_field":    "trace_text",
    "occurrence_index": 0,
    "source_span":     { "start": 12, "end": 27 },
    "normalized_text": "0 °Cから50 °C",
    "quantity":        { /* 既存 quantityRecord をそのまま */ },
    "interval_semantics_candidates": [ /* 既存 */ ]
    // is_condition_value / source_representation / source_value_text も既存どおり任意
  }
]
```

`quantity` 内部は既存契約のまま:
- 判別可能な共用体 `kind:"interval"{lower,upper}` | `kind:"alternatives"{options,selection_semantics}`
  （`alternatives` は「12/15 kW」等で**実際に生成される**ため削ってはならない。既存schemaに明記あり）
- `unit:{source,canonical,dimension,standard_ref?}` / `extraction:{confidence,warnings[]}`
- `intervalBound:{value,inclusive}`（null許容）

**方針**: 将来 Sidecar を「内部モデルからのExport形式」へ寄せる（指示§12）が、0.1では
**内部表現を既存sidecar recordと一致させる**。既存 `quantity_sidecar_binding_core.js` を
Quantity Engine の参照実装としてそのまま呼び出せ、変換ロジックを新規に書かずに済むため。
Sidecar固有fieldは `quantities[]` の中に閉じ込め、Nodeの他fieldへ漏らさない。

### 6.4 Actor と Operation History（指示§13）

```jsonc
// Actor
{
  "type": "ai",                  // 必須 "human" | "ai" | "ai_agent"
  "id":   "relation-engine",     // 必須。非空文字列
  "model": "claude-opus-5"       // 任意
}
```

Human / AI / AI Agent は**編集主体として同等**に扱う。タグ体系を分けない。
違いは `actor.type` としてのみ記録する。

```jsonc
// OperationRecord（0.1は最小）
{
  "operation_id": "op-<32桁hex>",   // 必須
  "sequence":     42,                // 必須。DataSet内で1始まり単調増加
  "command_type": "ADD_TAG",         // 必須。enum
  "actor":        { /* Actor */ },   // 必須
  "occurred_at":  "2026-07-31T00:00:00.000Z",  // 必須
  "target_kind":  "node",            // 必須 "node" | "edge"
  "target_id":    "kn-...",          // 必須
  "before_hash":  "<64桁hex|null>",  // 必須
  "after_hash":   "<64桁hex|null>",  // 必須
  "params":       { }                // 必須（空オブジェクト可）
}
```

`command_type` enum（0.1）と content_hash への影響:

| command_type | content_hashを変えるか |
|---|---|
| `CREATE_NODE` / `CREATE_EDGE` | 生成 |
| `UPDATE_NODE_TEXT` | **変える** |
| `ADD_TAG` / `REMOVE_TAG` | **変える** |
| `SET_QUANTITY` / `REMOVE_QUANTITY` | **変える** |
| `CHANGE_PROPERTY` | **変える** |
| `CHANGE_RELATION` | **変える** |
| `PROMOTE_CANDIDATE` / `REJECT_CANDIDATE` | 変えない |
| `REVIEW_HUMAN` / `REVIEW_AI` / `RESET_REVIEW` | **変えない** |
| `DELETE_NODE` / `DELETE_EDGE` | 削除 |

**`REVIEW_*` は `before_hash === after_hash` になる。** これが §7.2「生成・編集 ≠ 確認」を
機械的に検査可能にする（§9 の V-R3）。

### 6.5 Revision と stale semantics（指示§19）

```jsonc
"revision": {
  "content_revision": 5,                 // 必須。1始まり単調増加
  "content_hash":     "<64桁hex>",       // 必須
  "updated_by":       { /* Actor */ },   // 必須
  "updated_at":       "2026-07-31T00:00:00.000Z"  // 必須
}
```

**content_hash の定義**:

```
Node: hashParts('knowledge-node-content-v1',
        [canonicalJson({ node_type, text, title, semantics, tags, quantities, parent_node_id })])
Edge: hashParts('knowledge-edge-content-v1',
        [canonicalJson({ source_node_id, target_node_id, relation_category, relation_type })])
```

`provenance` / `review` / `revision`自身 / `confidence` / `extensions` は**入力に含めない**。
理由:
- `review` を含めると「確認したら内容が変わったことになり」レビューが即stale化する
- `provenance.ingested_at` 等は再取込のたびに変わり、不要なstale化を招く
- `confidence` を含めると、AIの再評価でconfidenceだけ変わってもEdgeがstale化する（§12論点2）

**Edge の stale 判定**:

```
edge_stale(edge) := edge.generation.source_node_content_hash != node(source).revision.content_hash
                 || edge.generation.target_node_content_hash != node(target).revision.content_hash
```

指示§19の例（Requirement Rev.5 → satisfied_by → Design Rev.8 で Requirement が Rev.6 になったら
Edge を stale にして Relation Engine で再評価）はこの定義で成立する。

**revision番号ではなく content_hash で判定する理由**: 再取込で revision番号がリセットされても
内容が同じなら stale にならない。内容が実際に変わった場合のみ stale になる。
指示§15「Drop → Build Knowledge」の再実行を安全にする。

**stale は保存fieldではなく導出値**とする。保存すると更新漏れで嘘をつく。
stale Edge は自動削除せず、Relation Engine の再評価対象としてマークするのみ。

---

## 7. ReviewState — 「編集」と「確認」の分離（指示§14）

### 7.1 構造（Node / Edge 共通）

```jsonc
"review": {
  "human": {
    "status":      "unreviewed",  // 必須 "unreviewed"|"reviewed"|"needs_fix"|"excluded"|"not_applicable"
    "verdict":     null,          // 必須。null|"accept"|"reject"
    "actor":       null,          // 必須。null|Actor
    "reviewed_at": null,          // 必須。null|canonical UTC timestamp
    "note":        null,          // 必須。null|string
    "reviewed_content_hash": null // 必須。null|64桁hex（§7.3）
  },
  "ai": {
    "status":      "unreviewed",  // 必須（同上）
    "verdict":     null,
    "actor":       null,          // Actor（type は "ai" | "ai_agent"）
    "reviewed_at": null,
    "note":        null,
    "reviewed_content_hash": null,
    "method":      null,          // 必須。null|string（既存 ai_review_method 相当）
    "model":       null           // 必須。null|string（既存 ai_review_model 相当）
  }
}
```

### 7.2 「生成」は「確認」ではない（本Contractの中核）

- **AIがNodeを生成しても `review.ai.status` は `unreviewed`** である。生成の事実は
  `revision.updated_by` と Operation History にのみ記録され、`review` に影響しない。
- **AIがEdgeを生成しても `review.ai.status` は `unreviewed`** である。
  `lifecycle:"active"` への自動昇格も確認ではない。
- `review.*.status` を `reviewed` にできるのは `REVIEW_HUMAN` / `REVIEW_AI` コマンドのみ。

### 7.3 レビューの stale 判定

`reviewed_content_hash` はレビュー時点の `revision.content_hash` を記録する。

```
review_stale(target, track) := review[track].status == "reviewed"
                            && review[track].reviewed_content_hash != target.revision.content_hash
```

stale レビューを**自動で `unreviewed` へ戻さない**。`reviewed` のまま stale を導出値として提示する。
既存B-4設計が「stale sessionでも保存済みレビュー結果は保持する」方針であり、それと整合させるため。

### 7.4 既存fieldとの写像

| 既存 trace record field | 本Contract |
|---|---|
| `review_status` | `review.human.status` |
| `ai_reviewed`(boolean) | `review.ai.status`（`true`→`reviewed`, `false`→`unreviewed`） |
| `ai_reviewed_at` | `review.ai.reviewed_at` |
| `ai_review_method` | `review.ai.method` |
| `ai_review_model` | `review.ai.model` |
| `ai_review_comment` | `review.ai.note` |

値域 `unreviewed`/`reviewed`/`needs_fix`/`excluded` は §1.5 で確認した実値。
`not_applicable` のみ structural edge 用に新規追加。

---

## 8. ID規則

既存 `SHA-256/128`（先頭128bit＝32桁hex）方式を継承。連結は §1.4 の理由により UTF-8 netstring。

```
netstring(v) = `${utf8ByteLength(v)}:${v},`
id128(ns, parts) = sha256([ns, ...parts.map(p => normalize(netstring(p)))].join('\0')).slice(0,32)
```

| ID | prefix | namespace | 入力parts |
|---|---|---|---|
| `dataset_id` | `kd-` | `knowledge-dataset-id-v1` | `[generator.tool, generator.version, ソート済みsources[].content_digest]` |
| `source_document_id` | `sd-` | `knowledge-source-id-v1` | `[producer, file_name, content_digest]` |
| `node_id` | `kn-` | `knowledge-node-id-v1` | `[source_document_id, locator_canonical]` |
| `edge_id` | `ke-` | `knowledge-edge-id-v1` | `[source_node_id, target_node_id, relation_category, relation_type]` |
| `operation_id` | `op-` | `knowledge-operation-id-v1` | `[dataset_id, sequence, command_type, target_id]` |
| `quantity_id` | `q-` | （既存のまま） | （既存のまま。**変更しない**） |

`locator_canonical`:
```
pdf   : "pdf|page=<page>|path=<source_path>"
excel : "excel|sheet=<sheet>|row=<row>|path=<source_path>"
```

**node_id を決定的にする理由**: 同じ文書を再取込すると同じ node_id が再現される。これにより
再取込しても Edge の参照が壊れず、文書改訂時は「同じ位置のNodeの内容が変わった」＝ content_hash
変化として §6.5 の Edge stale 判定が正しく働く。

節の挿入等で位置が変わると別Nodeになる。0.1ではこれを許容し、位置非依存の同一性追跡は
将来課題とする（§12論点3）。

---

## 9. Validation（0.1で必須のもののみ）

既存schemaと同じく **fail-closed**。`extensions` のみ自由形を許す。

### 9.1 構造検査（JSON Schema）

| ID | 規則 |
|---|---|
| S-1 | 全必須fieldの存在。`additionalProperties:false`（`extensions` 除く） |
| S-2 | ID形式: `kn-`/`ke-`/`sd-`/`kd-`/`op-`/`q-` + 32桁hex |
| S-3 | hash形式: 64桁hex |
| S-4 | timestamp: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`（既存rc2と同一） |
| S-5 | `confidence` は 0..1 |
| S-6 | enum: `node_type`/`relation_type`/`relation_category`/`lifecycle`/`statement_type`/`feature`/`effect`/`command_type`/`status` |
| S-7 | `provenance.locator` は `kind` による判別可能な共用体 |
| S-8 | `provenance.verbatim` が producer に対応（pdf→`source_raw_text` 必須、excel→`source_record`+`source_row` 必須） |

### 9.2 意味検査（semantic validator）

| ID | 規則 | 根拠 |
|---|---|---|
| V-1 | `node_id` / `edge_id` / `export_binding.trace_id` に重複0件 | §8, §1.2 |
| V-2 | `edge.source_node_id` / `target_node_id` が実在 | 参照整合 |
| V-3 | `node.provenance.source_document_id` が実在 | 参照整合 |
| V-4 | `parent_node_id` が実在（null除く）かつ循環なし | 構造整合 |
| V-5 | `node_id` / `edge_id` が §8 で再計算した値と一致 | ID決定性 |
| V-6 | `revision.content_hash` が §6.5 で再計算した値と一致 | 改竄検出 |
| V-7 | `relation_type` と `relation_category` の対応が §4.2 の表と一致 | §4.3 |
| V-C1 | `structural` → `lifecycle=="active"` | §4.3 |
| V-C2 | `structural` → `confidence==1.0` | §4.3 |
| V-C3 | `structural` → 両端Nodeの `source_document_id` が同一 | §4.3 |
| V-R1 | `status=="reviewed"` → `actor`/`reviewed_at`/`reviewed_content_hash` が非null | §7 |
| V-R2 | `status!="reviewed"` → `verdict==null` | §7 |
| V-R3 | `command_type` が `REVIEW_*` の operation は `before_hash===after_hash` | **§7.2の機械的検査** |
| V-R4 | `review.ai.actor.type` ∈ {`ai`,`ai_agent`}、`review.human.actor.type` == `human` | §6.4 |
| V-O1 | `operations[].sequence` が1始まりで欠番・重複なし | §6.4 |
| V-T1 | `tags` の各要素が `tag_vocabulary.allowed_tags` に存在。無いものは `unregistered_tags` へ | 既存タグ契約 |
| V-E1 | `evidence.features` が1件以上 | §4.5 |

### 9.3 diagnostics

既存 `diagnosticItem`（`{code, severity}` 必須）と同形。

```jsonc
{ "code":"node_id_mismatch", "severity":"error",
  "target_kind":"node", "target_id":"kn-...", "detail":"..." }
```

`severity`: `error`（fail-closed）/ `warning`（継続・要確認表示）/ `info`

---

## 10. 既存 TraceRecordSet / Quantity Sidecar との境界（指示§15）

### 10.1 位置づけ

```
              ┌───────────────────────────┐
 PDF/Excel ─▶ │ Knowledge Data (内部正本)  │ ─▶ Knowledge JSON (knowledge-data/0.1)
 既存Trace ─▶ │                            │ ─▶ TraceRecordSet (chapter-section-trace-v1 / 1.1)
   JSON       │                            │ ─▶ Quantity Sidecar (quantity-annotation/1.0-rc1)
              └───────────────────────────┘ ─▶ Excel
```

- **Knowledge Data が内部正本**。
- **TraceRecordSet / Quantity Sidecar は Export形式**であり、既存α版3ツールとの互換境界。
- 既存 Trace JSON を**入力**として取り込む Adapter も用意する（既存資産の再利用）。

### 10.2 Node → TraceRecord 写像

| TraceRecord field | Knowledge Node |
|---|---|
| `trace_id` | `export_binding.trace_id` |
| `parent_id` | `parent_node_id` に対応するNodeの `export_binding.trace_id` |
| `trace_title` / `trace_text` | `title` / `text` |
| `source_file`/`source_page`/`source_path`/`source_kind`/`source_section_id`/`source_section_title`/`source_block_id` | `provenance.locator` |
| `source_sheet`/`source_row`/`source_record` | `provenance.locator` / `provenance.verbatim` |
| `source_raw_text` | `provenance.verbatim.source_raw_text` |
| `review_status` | `review.human.status` |
| `tags` / `unregistered_tags` | 同名 |
| `ai_reviewed`他5項目 | `review.ai.*`（§7.4） |
| `trace_content` / `trace_key_text` / `trace_category` | §11予約。0.1では Adapter が保持した元値を `extensions` 経由で往復させる |

### 10.3 互換性の必達条件

Export した TraceRecordSet / Quantity Sidecar は、既存 `quantity_sidecar_binding_core.js` が
**`ready===true` かつ `diagnostics` 0件で bind できなければならない**。

1. `export_binding.trace_id` が元の `trace_id` と完全一致（§1.2）
2. `provenance.verbatim` が原文を逐語保持（§1.1）
3. `tags` の内容が保存される（content_hash 入力のため）
4. Excel側は `source_record` の全キー・値が保存される
5. ハッシュ計算は既存 `normalize`/`hashParts`/`canonicalJson` を**再利用**（§1.3）

### 10.4 検証方針（Phase 2 で実施）

既存fixture（`samples/hvac_trace_sample_small/JSON_A|B_*.json`、
`pdf_tool/samples/sample_expected_*.json`、`excel_tool/samples/sample_expected_trace.json`）で
**round-trip 検査**を必須とする。

```
既存Trace JSON ─(Adapter)→ Knowledge Data ─(Export)→ Trace JSON'
   検査: Trace JSON == Trace JSON'（canonical一致）
   検査: dataset_signature 一致
   検査: 全record の content_hash 一致
```

これが通らない限り Phase 2 は完了としない。

---

## 11. 拡張予約（0.2以降。**予約名のみ確保**）

以下は 0.1 では**実装しないが、名前と置き場所だけ予約**する。追加時に破壊的変更にならないよう
現時点で衝突を避ける。

### Node
`text_parts` / `key_text` / `hierarchy.path` / `hierarchy.ordinal` /
`confidence_breakdown{structuring, semantic}` / `aliases` / `external_ids`

### Edge
`direction`（0.1は全て有向）/ `comparison{quantity_comparison_ref, result, detail}` /
`evidence.features[].weight` / `evidence.features[].contribution` / `evidence.notes`

### Semantics
`modality`（shall/should/may/informative/unknown）/ `polarity` / `conditions[]` /
`subject.confidence` / `property.confidence` / `property.candidates[]`

### relation_type 追加予定
`requires` / `derived_from` / `allocated_to` / `depends_on` / `constrains` /
`conflicts_with` / `references` / `supersedes`

### node_type 追加予定
`function` / `constraint` / `interface` / `test_case` / `part` / `parameter`

### その他
Matching Profile 本体schema / confidence threshold定義 / `trace_category` 写像表 /
Ontology語彙定義 / Node identity across restructuring（位置非依存の同一性追跡）

---

## 12. レビューしていただきたい論点

1. **§4.4 lifecycle方式** — Candidate と Edge を別コレクションに分けず単一schemaの `lifecycle`
   field で区別する案。指示§18の「区別」を満たすと考えるが、別コレクションを意図されていた
   場合は差し戻し希望。
2. **§6.5 content_hash の入力範囲** — `review`/`provenance`/`confidence` を除外した。
   特に `confidence` 除外（AIが再評価してconfidenceだけ変わってもEdgeをstaleにしない）の是非。
3. **§8 node_id の決定性** — 位置ベース（`source_path`）とし、節の挿入で node_id が変わることを
   0.1では許容した点の是非。
4. **§6.3 Quantity の内部表現** — 既存 sidecar record と一致させた。将来の分離余地を
   `extensions` のみに頼る点の是非。
5. **§7.3 stale レビューを自動で `unreviewed` へ戻さない**方針の是非。
6. **§11 の予約範囲が妥当か** — 0.1 から外しすぎ／残しすぎがないか。特に `modality` を
   0.1 から外した判断（要求文の shall/should 判別を初期評価で見たい場合は 0.1 へ戻す）。

---

## 13. 次Phaseへの引き渡し

本Contract承認後、Phase 1（State Core）で以下を実装する。

1. `knowledge_data_schema_0.1.json`（JSON Schema、§9.1）
2. `knowledge_data_semantic_validator.js`（§9.2、fail-closed）
3. `knowledge_store.js` / `knowledge_command_engine.js`（§6.4、純粋reducer方式）
4. ID/hash ユーティリティ（既存 `normalize`/`hashParts`/`canonicalJson` を再利用）
5. 上記のNode検証（既存 design_notes の検証スクリプト方式を踏襲）

**既存α版ファイル・配布ZIPは一切変更しない。** Knowledge Data Builder は
`tools/knowledge_builder/` 配下の新規系統として実装する。

Remote tag / GitHub Release / Public release は引き続き HOLD。
「3ツール完全互換」という表現は使用しない。
