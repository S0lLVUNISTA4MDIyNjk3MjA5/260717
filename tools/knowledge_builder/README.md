# Knowledge Data Builder — α0.1（早期評価用）

**状態**: 早期評価用の動作物。正式な設計判断・成果物提出には使用しないでください。
**準拠Contract**: `design/knowledge_data_contract_0.1.md`（Knowledge Data Contract 0.1）

このディレクトリは Knowledge Data Builder の Phase 0（Contract）に続く、最初の評価可能な
動作物です。既存α版ファイル・配布ZIP（`tools/alpha_release/`、`tools/release/`配下）は
**一切変更していません**。この配下は新規系統です。

## このα0.1の範囲

含むもの:

1. 既存Trace JSON投入(PDF/Excel構造化JSON) — 既存PDF/Excelツールが出力した trace JSON
   （`_trace_records[]`を持つ既存形式）を読み込む。**PDF/Excelの解析自体は追加していません**。
   既存ツールで一度エクスポートしたJSONファイルをこのツールへ読み込ませてください。
2. Node生成 — Trace JSON Adapter が document/section/内容Node（requirement/design_item）を生成
3. Node一覧・修正 — node_type / 本文(text) / タグの編集
4. Relation Candidate生成 — 既存タグの一致・文字列類似度に基づく semantic candidate edge の生成
5. Edge採用/削除 — candidateをactive/rejectedへ
6. Relation一覧 — Edgeの根拠(evidence)・信頼度・stale状態の確認
7. 簡易Knowledge Graph — SVGによる読み取り専用の可視化
8. Knowledge JSON保存 — Knowledge Data Contract 0.1形式でのJSON出力

意図的に含まないもの(次段階以降の課題):

- Ontologyに基づくnode_type/relation_type自動判定(現状は文書役割による既定値＋人手修正)
- Quantity compatibility / Property Resolution / Semantic reasoningを統合したrelation_type
  自動分類。このα0.1は`related_to`(semantic)と`contains`(structural)のみ自動生成する。
  タグ一致・文字列類似度だけでは「関係がありそう」までしか判定できず「要求を満足している」
  とまでは判定できないため、`satisfied_by`/`implemented_by`/`verified_by`への分類・昇格は
  それらの判定要素を追加した後段のCheckpointへ持ち越す
- AI Agentによる自律編集
- 完全なQuantity統合(数量抽出との連携。`quantities`は常に空配列)
- 自動Semantic Tagging(Knowledge Builder自身によるタグ自動生成)。今回は既存Trace JSONの
  タグをKnowledge Nodeへ引き継いでいるのみで、タグそのものはKnowledge Builderが生成した
  ものではない。自動Semantic Taggingは次Checkpoint以降の評価対象とする
- Human/AIレビュー確定(`review.human`/`review.ai`)のUI(内部engineには実装済み。
  `core/knowledge_store.js`の`reviewHuman`/`reviewAI`参照。UIへの露出は評価結果を見てから)

### Structural Node(document/section)とlegacy Trace互換性

`document`/`section`のStructural Nodeは既存TraceRecordSetに対応するレコードを持たない
(既存Exportは内容行のみを`_trace_records[]`として持ち、章/節そのものは別レコードにならない)。
これらのNodeは**`export_binding: null`**として生成され、既存Sidecar/照合ツールとのbinding
互換性を一切主張しない。`export_binding`が非nullの値を持つのは、既存TraceRecordの
`trace_id`/`content_hash`をそのまま引き継ぐ内容Node（requirement/design_item等）のみ。

## 使い方

1. `ui/knowledge_builder_tool_v0.1-alpha.html` をブラウザで直接開く(サーバ不要)
2. 「文書A(requirement側)」「文書B(design側)」に、既存PDF/Excelツールが出力した
   trace JSONファイルを指定する。動作確認用サンプルとして
   `samples/hvac_trace_sample_small/JSON_A_customer_requirements_trace.json` /
   `JSON_B_design_review_trace.json`(リポジトリ直下)がそのまま使える
3. 「取込してNode生成」→ Node一覧が表示される
4. Node一覧で本文・種別・タグを修正できる(編集は即座にrevision/knowledge_hashへ反映される)
5. 「Relation Candidateを生成」→ Relation一覧にcandidate edgeが表示される
6. 各行の「採用」「削除」でlifecycleを確定する
7. 「簡易Knowledge Graph」でNode/Edgeの全体像を確認する
8. 「Knowledge JSONを保存」でKnowledge Data Contract 0.1形式のJSONをダウンロードする

## 評価していただきたい観点

- Node粒度は適切か(段落単位・行単位が細かすぎる/粗すぎることはないか)
- Node編集操作は最小限か(本文修正・種別変更・タグ追加削除で十分か、他に必要な操作はあるか)
- 既存タグを用いたRelation Candidateは妥当か(明らかに無関係なペアが多すぎないか)
- Edge evidence(根拠)は理解できるか(「なぜこの候補が出たか」が読み取れるか)
- Candidate採用/却下操作は使いやすいか
- Relation一覧は見やすいか
- Knowledge Graphは設計理解の助けになるか

自動Semantic Tagging(Knowledge Builder自身によるタグ自動生成)は今回のα0.1に含まれない
ため評価対象外。次Checkpoint以降で別途評価する。

## 内部構成

```
core/
  id_hash_utils.js            ID・hash算出(§6.5/§6.6/§8)。既存quantity_sidecar_binding_core.js
                               のnormalize/hashParts/canonicalJson/computeRecordContentHashを再利用
  trace_json_adapter.js        既存trace JSON → KnowledgeNode/構造Edge(§10.1 Adapter)
  relation_candidate_engine.js タグ一致・文字列類似度によるsemantic candidate生成(§4.5)
  knowledge_store.js           Node/Edge編集・lifecycle・review・operation historyのreducer(§6.4)
verification/
  knowledge_builder_core_verification.js  Node.js検証(losslessness・dual-hash・stale判定等)
  knowledge_builder_ui_smoke_test.js      Playwright検証(UI一連操作。要 NODE_PATH="$(npm root -g)")
ui/
  knowledge_builder_tool_v0.1-alpha.html  評価用ブラウザツール本体
design/
  knowledge_data_contract_0.1.md          Knowledge Data Contract 0.1(設計文書)
```

## 検証の実行方法

```
node tools/knowledge_builder/verification/knowledge_builder_core_verification.js
NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_ui_smoke_test.js
```

いずれもリポジトリ直下の既存サンプル(`samples/hvac_trace_sample_small/`)を読み込むだけで、
既存ファイルへの書き込みは行いません。
