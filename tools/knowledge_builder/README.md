# Knowledge Data Builder — α0.1.1（早期評価用）

**状態**: 早期評価用の動作物。正式な設計判断・成果物提出には使用しないでください。
**準拠Contract**: `design/knowledge_data_contract_0.1.md`（Knowledge Data Contract 0.1。α0.1.1では変更していません）

このディレクトリは Knowledge Data Builder の最初の評価可能な動作物（α0.1）を、人手評価結果を
受けて改定したものです（α0.1.1）。既存α版ファイル・配布ZIP（`tools/alpha_release/`、
`tools/release/`配下）は**一切変更していません**。この配下は新規系統です。

## α0.1.1での変更点（人手評価4件への対応）

α0.1の限定人手評価で次の4点が指摘され、α0.1.1で対応しました。今回のテーマは
**「Node/Relationの件数が増えても、人が全件を手作業で確認・編集しなくてよいUIへ改善すること」**
と、**「Node/Relation/Edge/Knowledge Graphの意味と作業内容を、初見の評価者でも理解できるように
すること」**です。機能追加ではなく、この2点に直接関係する改善のみを行っています。

1. 「Node一覧・修正」が何をする画面か分かりにくい
   → 「2. ノードを確認・修正（Knowledge Nodes）」に改称し、画面上に日本語の説明文を追加
2. 「Relation Candidate生成 → Edge採用/削除 → Relation一覧」が日本語として理解しにくい
   → 「3. 文書間の関連を確認（Relations / Edges）」に改称。ボタンも「関連候補を自動生成」、
   lifecycle表示も「候補(candidate)」「採用済み(active)」「却下(rejected)」の日本語主体表示へ変更
3. Node/Relation Candidateが増えると個別確認・編集作業の負荷が高い
   → Node一覧・Relation一覧の両方に検索・絞り込み・複数選択・一括操作（タグ一括追加/削除、
   候補の一括採用/一括却下）を追加。Relation一覧はSource Node単位でグループ化し、
   初期表示は「未処理候補のみ」に限定
4. Knowledge Graphの「構造Edge（contains）も表示」の意味が伝わらない
   → 「文書内の階層関係も表示」に改称し、「文書間の関連」と色分けする凡例を追加

## このα0.1.1の範囲

含むもの（α0.1から変更なし）:

1. 既存Trace JSON投入(PDF/Excel構造化JSON) — 既存PDF/Excelツールが出力した trace JSON
   （`_trace_records[]`を持つ既存形式）を読み込む。**PDF/Excelの解析自体は追加していません**。
   既存ツールで一度エクスポートしたJSONファイルをこのツールへ読み込ませてください。
2. Node生成 — Trace JSON Adapter が document/section/内容Node（requirement/design_item）を生成
3. Node確認・修正 — node_type / 本文(text) / タグの編集（今回から検索・絞り込み・複数選択・
   タグ一括追加/削除を追加）
4. 文書間の関連の自動候補生成 — 既存タグの一致・文字列類似度に基づく semantic candidate edge の生成
5. Edge採用/却下 — candidateをactive/rejectedへ（今回から複数選択・一括採用/一括却下を追加）
6. Relation一覧 — Edgeの根拠(evidence)・信頼度・stale状態の確認（今回からSource Node単位で
   グループ化、状態フィルタ、検索を追加）
7. 簡易Knowledge Graph — SVGによる読み取り専用の可視化（今回から「文書内の階層関係」と
   「文書間の関連」を用語・色分けで区別）
8. Knowledge JSON保存 — Knowledge Data Contract 0.1形式でのJSON出力
9. 作業量サマリ（α0.1.1で追加） — 全Node数・人が確認したNode数・個別修正したNode数・
   関連候補総数・人が個別判断した候補数・一括採用/却下件数・最終採用済みEdge数を表示

意図的に含まないもの(次段階以降の課題。α0.1.1でも先回りして追加していません):

- Ontologyに基づくnode_type/relation_type自動判定(現状は文書役割による既定値＋人手修正)
- Quantity compatibility / Property Resolution / Semantic reasoningを統合したrelation_type
  自動分類。このツールは`related_to`(semantic)と`contains`(structural)のみ自動生成する。
  タグ一致・文字列類似度だけでは「関係がありそう」までしか判定できず「要求を満足している」
  とまでは判定できないため、`satisfied_by`/`implemented_by`/`verified_by`への分類・昇格は
  それらの判定要素を追加した後段のCheckpointへ持ち越す
- 本格的なAIによるSemantic Tagging、AI Agentによる自律編集
- 完全なQuantity統合(数量抽出との連携。`quantities`は常に空配列)
- Graph DB / Vector DB、PDF/Excel直接取込の統合、1000件級の性能最適化
- Human/AIレビュー確定(`review.human`/`review.ai`)のUI(内部engineには実装済み。
  `core/knowledge_store.js`の`reviewHuman`/`reviewAI`参照。UIへの露出は評価結果を見てから)

### Structural Node(document/section)とlegacy Trace互換性

`document`/`section`のStructural Nodeは既存TraceRecordSetに対応するレコードを持たない
(既存Exportは内容行のみを`_trace_records[]`として持ち、章/節そのものは別レコードにならない)。
これらのNodeは**`export_binding: null`**として生成され、既存Sidecar/照合ツールとのbinding
互換性を一切主張しない。`export_binding`が非nullの値を持つのは、既存TraceRecordの
`trace_id`/`content_hash`をそのまま引き継ぐ内容Node（requirement/design_item等）のみ。

## 使い方

1. `ui/knowledge_builder_tool_v0.1.1-alpha.html` をブラウザで直接開く(サーバ不要)
2. 「1. データを読み込む」の「文書A(requirement側)」「文書B(design側)」に、既存PDF/Excel
   ツールが出力したtrace JSONファイルを指定する。動作確認用の小規模サンプルとして
   `samples/hvac_trace_sample_small/JSON_A_customer_requirements_trace.json` /
   `JSON_B_design_review_trace.json`(リポジトリ直下)がそのまま使える。件数が増えたときの
   絞り込み・一括操作を評価する場合は下記の中規模サンプルを使うこと
3. 「読み込んでノードを生成」→「2. ノードを確認・修正」に一覧が表示される
4. 必要なら検索・文書/種別/タグ/状態での絞り込みを使い、内容・種別・タグに誤りがある項目
   だけ修正する。複数Nodeを選択してタグを一括追加/削除できる
5. 「3. 文書間の関連を確認」で「関連候補を自動生成」→ 初期表示は「未処理候補のみ」。
   Source Node単位でグループ化されて表示される。各行の「採用」「却下」、または複数選択して
   一括採用/一括却下できる
6. 「4. ナレッジグラフを確認」で全体像を確認する。「文書間の関連」と「文書内の階層関係」は
   色分け・チェックボックスで区別されている(初期状態では階層関係は非表示)
7. 「5. ナレッジデータを保存」でKnowledge Data Contract 0.1形式のJSONをダウンロードする。
   同じ画面に作業量サマリ（人が実際に触った件数の目安）を表示する

## 中規模評価サンプル（件数が増えたときの評価用）

`samples/knowledge_builder_alpha01/medium/` に、Node/Relation Candidateが増えたときの
絞り込み・一括操作の効果を評価するための中規模サンプル（文書A 80件・文書B 100件・
関連候補約230件規模）を同梱しています。使い方・意図的に含めたケース（同義語・略語・
タグ不足・1要求→複数設計項目等）・評価用ground truth(`expected_relations.json`)の使い方は
`samples/knowledge_builder_alpha01/medium/README.md` を参照してください。

## 評価していただきたい観点（α0.1.1）

1. どこで何をする画面か理解できるか
2. 日本語主体でNode/Relation/Edge/Graphの概念を理解できるか
3. 必要なNodeへ絞り込めるか(検索・文書/種別/タグ/状態フィルタ)
4. 複数Nodeを一括操作できるか(タグ一括追加/削除)
5. 未処理のRelation Candidateへ絞り込めるか
6. 複数Candidateを一括採用/一括却下できるか
7. Knowledge Graph上の「文書内の階層関係」と「文書間の関連」を区別できるか
8. Knowledge JSONを保存できるか

自動Semantic Tagging(Knowledge Builder自身によるタグ自動生成)、`satisfied_by`等の強い
Relationの自動判定は今回のα0.1.1にも含まれないため評価対象外です。次Checkpoint以降で
別途評価します。

## 内部構成

```
core/
  id_hash_utils.js            ID・hash算出(§6.5/§6.6/§8)。既存quantity_sidecar_binding_core.js
                               のnormalize/hashParts/canonicalJson/computeRecordContentHashを再利用
  trace_json_adapter.js        既存trace JSON → KnowledgeNode/構造Edge(§10.1 Adapter)
  relation_candidate_engine.js タグ一致・文字列類似度によるsemantic candidate生成(§4.5)
  knowledge_store.js           Node/Edge編集・lifecycle・review・operation historyのreducer(§6.4)
verification/
  knowledge_builder_core_verification.js         Node.js検証(losslessness・dual-hash・stale判定等)
  knowledge_builder_ui_smoke_test.js              Playwright検証(小規模サンプルでのUI一連操作)
  knowledge_builder_medium_sample_smoke_test.js   Playwright検証(中規模サンプルでの規模・一括操作)
  (いずれもNODE_PATH="$(npm root -g)"が必要なものはPlaywright使用箇所のみ)
ui/
  knowledge_builder_tool_v0.1.1-alpha.html  評価用ブラウザツール本体
design/
  knowledge_data_contract_0.1.md          Knowledge Data Contract 0.1(設計文書。α0.1.1では未変更)
```

## 検証の実行方法

```
node tools/knowledge_builder/verification/knowledge_builder_core_verification.js
NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_ui_smoke_test.js
NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_medium_sample_smoke_test.js
```

いずれもリポジトリ直下の既存サンプル(`samples/hvac_trace_sample_small/`)または
`samples/knowledge_builder_alpha01/medium/`を読み込むだけで、既存ファイルへの書き込みは
行いません。
