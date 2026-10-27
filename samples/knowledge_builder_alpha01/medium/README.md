# Knowledge Data Builder — 中規模評価サンプル

**目的**: 性能ストレステストではありません。Node / Relation Candidateが増えたときに、
検索・フィルタ・未処理表示・一括操作によって「人が実際に触る件数」を減らせるかを
評価するためのサンプルです（Knowledge Data Builder α0.1.1 改定指示 §10-15）。

既存の簡易サンプル（`samples/hvac_trace_sample_small/`）は基本操作確認・初見利用者への
説明・Smoke Test用として引き続き使用してください。中規模評価にはこちらを使用してください。

## ファイル

| ファイル | 内容 |
|---|---|
| `JSON_A_medium_customer_requirements_trace.json` | 文書A（requirement側）。pdf producer形式。80件 |
| `JSON_B_medium_design_review_trace.json` | 文書B（design側）。excel producer形式。100件 |
| `tag_vocabulary_medium.json` | このサンプル専用のタグ辞書（10カテゴリ）。**「共有タグ辞書」欄で読み込んでください** |
| `expected_relations.json` | 評価用ground truth（後述）。通常実行の入力ファイルではありません |
| `generate_medium_sample.js` | このサンプルを生成したスクリプト（再現性のため同梱） |

## 規模

- 文書A 内容Node: 80件 / 文書B 内容Node: 100件
- Structural Node（document + section）: 文書A・Bそれぞれ16件（章1 + 節15）
- 全体Node数: 212件
- Relation Candidate生成数（現行engineでの実測値）: 234件
- ground truthの正しい関連（`expected_relations.json`）: 62件

## タグについて

既定のタグ辞書（`trace-domain-ja`）ではなく、このサンプル専用の10カテゴリ
（温度・圧力・電源・冷房能力・騒音・質量・寸法・保守・安全・試験）を使用しています。
「1. データを読み込む」の「共有タグ辞書」欄で `tag_vocabulary_medium.json` を指定してから
文書A/Bを読み込んでください。指定しない場合、これらのタグが未登録タグ扱いになり
`tag_not_in_vocabulary` の警告が多数出ます（保存は可能ですが見づらくなります）。

## 意図的に含めたケース

単純な行数コピーによる水増しはせず、カテゴリごとに以下を意図的に作り込んでいます。
評価者は候補一覧・Knowledge Graphで実際にこれらのケースがどう扱われるかを確認してください。

- **同じタグで正しく関連するNode**: 各カテゴリの主要項目（温度の使用範囲、圧力の給水圧力等）
- **同じタグだが実際には関連しないNode**: 各カテゴリに数件ずつ配置（ノイズ候補として出現する）
- **表現違い**: 要求側「〜とすること」、設計側「〜する設計とする」等、文体を意図的に変えている
- **略語**: `cooling-eer`。要求側は「エネルギー消費効率」と明記、設計側は「EER」のみ表記
- **同義語**: `maint`カテゴリ。要求側「保守」、設計側「メンテナンス」
- **文章は似ているが対象部品が異なるNode**: `acoustic-bearing`（軸受）と`acoustic-fanmotor`
  （ファンモーター）。どちらも「〜から異音が発生しないこと」という似た文型だが対象部品が違う
- **タグ不足のNode**: `power-earth` / `power-leak-breaker` / `safety-electric-shock`は
  本来「安全」タグも付与されるべき内容だが、意図的に単一タグのみ付与している
- **タグ未設定のNode**: 各カテゴリに1件ずつ`tags:[]`のNodeを配置（`__notag__`系のid）
- **1要求 → 複数設計項目**: `safety-electric-shock`は`enclosure-grounding`と
  `leak-current-breaker`の2つの設計項目で満たされる
- **複数要求 → 1設計項目**: `test-final-inspection-electric`と`test-final-inspection-leak`は
  どちらも`test-final-inspection-procedure`という1つの設計項目で満たされる
- **文書内の階層（2段階）**: 章「要求仕様」の下に節（カテゴリ）、一部カテゴリ
  （温度・電源・寸法・安全・試験）はさらに小節（例: 温度→使用時/保管時）で分割している

## expected_relations.json（ground truth）の使い方

**評価者が最初からこれを見ながら操作するためのものではありません。** 評価が終わった後、
以下の確認に使ってください。

1. Candidate生成結果に、`expected_relations.json`記載の正しい関連がどれだけ含まれていたか（再現率）
2. 採用したEdgeが、実際に正しい関連と一致していたか
3. 逆に、誤って採用してしまった候補（False Positive）や、候補にすら出てこなかった正しい関連
   （False Negative）がなかったか

### 参考: 現行engineでの既知のFalse Negative

`generate_medium_sample.js`と同時に確認した実測値として、以下の2件は現行のCandidate Engine
（タグ一致＋文字列類似度、上位3件まで）では候補に出てきません。意図的に残した限界事例です。

- `req-press-notag` → `design-press-notag`（タグ未設定同士で、かつ文章の類似度も低いケース）
- `req-safety-electric-shock` → `design-safety-leak-current-breaker`
  （1要求に対する2つ目の正解。上位3件の枠に入らなかった）

これらが実際に候補一覧に出てこないことを確認できれば、それ自体がこのサンプルの評価として
正しい結果です（「タグも文章も似ていないと現状のCandidate Engineでは拾えない」という
現状の限界を示すため）。

## 再生成する場合

```
node samples/knowledge_builder_alpha01/medium/generate_medium_sample.js
```

`JSON_A_*` / `JSON_B_*` / `expected_relations.json` を再生成します（`tag_vocabulary_medium.json`
は手動管理のため上書きされません）。
