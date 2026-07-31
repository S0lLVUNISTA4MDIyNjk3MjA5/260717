# Knowledge Data Builder — α0.1（早期評価用）

**状態**: 早期評価用の動作物。正式な設計判断・成果物提出には使用しないでください。
**準拠Contract**: `design/knowledge_data_contract_0.1.md`（Knowledge Data Contract 0.1）

このディレクトリは Knowledge Data Builder の Phase 0（Contract）に続く、最初の評価可能な
動作物です。既存α版ファイル・配布ZIP（`tools/alpha_release/`、`tools/release/`配下）は
**一切変更していません**。この配下は新規系統です。

## このα0.1の範囲

含むもの:

1. PDF/Excel投入 — 既存PDF/Excelツールが出力した trace JSON（`_trace_records[]`を持つ既存形式）
   を読み込む。**PDF/Excelの解析自体は再実装していません**。既存ツールで一度エクスポートした
   JSONファイルをこのツールへ読み込ませてください。
2. Node生成 — Trace JSON Adapter が document/section/内容Node（requirement/design_item）を生成
3. Node一覧・修正 — node_type / 本文(text) / タグの編集
4. Relation Candidate生成 — タグ一致・文字列類似度に基づく semantic candidate edge の生成
5. Edge採用/削除 — candidateをactive/rejectedへ
6. Relation一覧 — Edgeの根拠(evidence)・信頼度・stale状態の確認
7. 簡易Knowledge Graph — SVGによる読み取り専用の可視化
8. Knowledge JSON保存 — Knowledge Data Contract 0.1形式でのJSON出力

意図的に含まないもの(次段階以降の課題):

- Ontologyに基づくnode_type/relation_type自動判定(現状は文書役割による既定値＋人手修正)
- `related_to`/`implemented_by`/`verified_by`を含む完全なRelation語彙の自動生成
  (このα0.1は `satisfied_by`(semantic)と`contains`(structural)のみ自動生成する)
- AI Agentによる自律編集
- 完全なQuantity統合(数量抽出との連携。`quantities`は常に空配列)
- Human/AIレビュー確定(`review.human`/`review.ai`)のUI(内部engineには実装済み。
  `core/knowledge_store.js`の`reviewHuman`/`reviewAI`参照。UIへの露出は評価結果を見てから)

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
- 自動生成されたタグは有用か
- Relation Candidateは妥当か(明らかに無関係なペアが多すぎないか)
- Edgeのevidence(根拠)は理解できるか(「なぜこの候補が出たか」が読み取れるか)
- 編集操作は最小限か(本文修正・種別変更・タグ追加削除で十分か、他に必要な操作はあるか)
- Knowledge Graphは設計理解の助けになるか

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
