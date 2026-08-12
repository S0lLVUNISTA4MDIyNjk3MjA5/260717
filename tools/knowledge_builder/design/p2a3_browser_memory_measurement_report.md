# P2-A3 browser-memory 測定報告

Checkpoint 2 成果物 / 設計契約 S18.4 の測定 matrix 実測結果と、入力上限の提案。

本書には private 本文も実 file path も記載しない。測定入力はすべて synthetic で、リポジトリ外に
生成し commit していない（例外：暗号化 PDF fixture のみ、生成が非決定的なため
`verification/fixtures/p2a3/` に commit している。中身は synthetic な 1 ページ資料）。

**改訂履歴**

| 版 | 内容 |
|---|---|
| Checkpoint 2 | 初版。9 ケース matrix と上限提案。 |
| Checkpoint 2-R1 | 結果区分を 6 種に厳密化。ケース 8 を「別 guard 先行」と再分類し、adapter 上限に**実際に到達する**ケース 8a/8b を追加測定。提案上限直前（単一 0.91 MB / 合計 1.84 MB）の 3 回成功を追加測定。暗号化 PDF を本番 browser pipeline で測定。 |

---

## 0. 結果区分の定義（本書で使用する 6 分類）

本書の「結果」欄は、以下のいずれか 1 つだけを取る。**目的の limit に到達しないまま別の guard が
先に発火したケースを、その limit 試験の成功として数えてはならない。**

| 区分 | 意味 |
|---|---|
| **成功** | run が完走し、session が更新され、完走後も UI が応答した。 |
| **分類済み安全失敗** | run が `{uiCode, count}` で停止した。uiCode は意図した分類であり、native Error / message / stack を含まない。既存 session・Evidence Index・Review State は不変。UI は応答を維持。 |
| **入力事前拒否** | `limits.js` の pre-read 検査が metadata だけで拒否した。`File.arrayBuffer()` は呼ばれていない。 |
| **不安定** | クラッシュはしないが、処理が実用時間内に確定せず、後続操作がタイムアウトした。 |
| **browser crash** | タブ／レンダラが異常終了した。**本書の全測定で 1 件も観測していない。** |
| **別guard先行（未測定）** | 目的の limit に到達する前に別の guard が発火した。**その limit については未測定**であり、成功にも安全失敗にも数えない。 |

---

## 1. 測定環境

| 項目 | 値 |
|---|---|
| OS | Linux 6.18.5-fc-v18 |
| architecture | x86_64 |
| browser | Chromium（Playwright 同梱ビルド、`/opt/pw-browsers/chromium`） |
| browser version | Playwright bundled build（起動 flag: `--enable-precise-memory-info`） |
| Node.js | v22.22.2 |
| CPU | コンテナ割り当て（専有コア数は非公開環境のため不定） |
| 利用可能メモリ | コンテナ割り当て。上限は環境依存のため絶対値としては扱わない |

**測定は Chromium のみで実施した。**Windows の Edge / Chrome、macOS Safari は未検証。

---

## 2. 測定方法

- 本番 UI（`server.js` + `index.html`）を `127.0.0.1` の動的 port で起動し、Playwright で実操作。
- ファイルは実際の `<input type="file">` へ `setInputFiles` で与え、「解析開始」を押下。
- 計測点
  - `ingestMs` … `browser_ingest.run()` の所要時間（読込 → SHA-256 → adapter → projection →
    validation → 抽出 → Evidence Index）
  - `renderMs` … 抽出完了から dashboard / table / alias / conflict の初回描画完了まで
  - `wallMs` … 「解析開始」押下から status が確定するまでの実時間
  - `usedHeapMB` … `performance.memory.usedJSHeapSize`（Chromium 限定指標）
  - `responsive` … 完了後に tab 切替を 5 秒以内に 2 回操作できたか
- 主要測定点は 3 回実行し、ばらつきを記録。
- 大型 synthetic 入力はリポジトリ外に生成し、commit していない。

---

## 3. matrix 結果（S18.4 の 9 ケース）

| # | ケース | files | 入力bytes | 最大単一 | ingest ms (3回) | render ms | candidates | alias | conflict | units | heap MB | 応答 | 結果 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | PDF単体（標準sample） | 1 | 7,341 | 7,341 | 564 / 618 / 617 | 15–17 | 22 | 6 | 1 | 33 | 18–21 | ○ | **成功** |
| 2 | XLSX単体（標準sample） | 1 | 24,043 | 24,043 | 79 / 81 / 79 | 15–23 | 26 | 0 | 0 | 292 | 17–20 | ○ | **成功** |
| 3 | PDF＋XLSX混在（標準sample） | 2 | 31,384 | 24,043 | 580 / 738 / 600 | 22–33 | 40 | 6 | 1 | 325 | 17–22 | ○ | **成功** |
| 4 | 複数PDF（20p/60p/200p） | 3 | 251,087 | 178,142 | 4,464 / 4,241 / 4,446 | 96–116 | 9,800 | 4,800 | 0 | 7,003 | 65–88 | ○ | **成功** |
| 5 | 複数XLSX（2k行＋5k行） | 2 | 2,042,378 | 1,455,259 | 10,692 / 8,729 / 8,931 | — | — | — | — | — | 81–89 | × | **安全な失敗**（P2-A2 projection validation） |
| 6 | 最大ファイル数近傍（20件） | 20 | 117,510 | 5,922 | 11,445 / 11,014 / 10,576 | 58–63 | 4,100 | 2,000 | 0 | 2,120 | 25 | ○ | **成功** |
| 7 | 合計byte数近傍（0.6MB PDF＋4.4MB XLSX） | 2 | 5,010,450 | 4,384,095 | 25,573 / 24,813 | — | — | — | — | — | 229–246 | × | **不安定**（25秒級、後続ページ読込がタイムアウト） |
| 8 | ~~adapter上限到達（700p PDF ×2）~~ | 2 | 1,252,710 | 626,355 | 11,163 | — | — | — | — | — | 183 | ○ | **別guard先行（未測定）** |
| 8a | adapter上限ちょうど（`MAX_PAGES` = 2,000ページ） | 1 | — | — | 39,872 | — | — | — | — | 50,000 | 356 | ○ | **成功** |
| 8b | adapter上限超過（2,001ページ） | 1 | — | — | 40,610 | — | — | — | — | — | 361 | ○ | **分類済み安全失敗**（`PDF_LIMIT_EXCEEDED`） |
| 9 | P2-A2 projection上限到達（20k行 XLSX） | 1 | 5,865,975 | 5,865,975 | 3,565 | — | — | — | — | — | 107 | ○ | **分類済み安全失敗**（projection validation） |

#### ケース 8 の再分類（R1）

初版のケース 8 は**同一ファイルを 2 回指定**していたため、PDF adapter の `MAX_PAGES` に到達する
前に重複 `source_document_id` 検出が run 全体を拒否していた。重複検出自体は期待どおりの挙動だが、
**これは adapter 上限の試験としては未測定**である。したがって R1 では区分を
「別guard先行（未測定）」へ改め、adapter 上限に実際に到達するケース 8a / 8b を新設した。

ケース 8a / 8b は、UI の `MAX_FILE_BYTES` pre-read guard（提案 1 MB）が 2,000 ページ PDF より
先に発火するため、**本番 `browser_ingest.run()` を browser 上で直接呼ぶ**経路で測定した。
adapter・projection・抽出は本番と同一コードである。

- **8a（2,000ページ＝上限ちょうど）**：adapter は拒否せず run が完走。50,000 statement を
  取り込み、既存 session は差し替えるまで不変、完走後も UI は応答した。
- **8b（2,001ページ＝上限超過）**：`page_count_limit_exceeded` を送出し、UI は
  `PDF_LIMIT_EXCEEDED` に分類した。送出された値の実測形状は
  `keys: "uiCode,count"` / `isError: false` / `hasMessage: false` / `hasStack: false`。
  既存 session・Evidence Index・記録済み ACCEPT 判定はいずれも不変で、UI は応答を維持した。

これらは恒久 check として `harness_driver.js` に組み込み、UI verification から毎回実行される。

### 3.1 提案上限直前の再現性測定（R1・合否 gate）

契約 S18.4 が要求する「提案上限の 90% 以上で 3 回連続成功」を、**提案値そのものに対して**測定した。

| ケース | 対象上限 | 入力 | 上限比 | ingest ms (3回) | render ms | candidates | units | heap MB | 応答 | 結果 |
|---|---|---|---|---|---|---|---|---|---|---|
| A | `MAX_FILE_BYTES` 1 MB | 単一 PDF 0.91 MB（dense） | **90.9%** | 6,156 / 6,809 / 6,281 | 226–360 | 32,500 | 16,901 | 55–142 | ○ | **成功（3/3）** |
| B | `MAX_TOTAL_SELECTED_BYTES` 2 MB | distinct PDF 3 件 計 1.84 MB | **91.9%** | 13,525 / 19,574 / 14,102 | 523–533 | 66,000 | 34,323 | 143–164 | ○ | **成功（3/3）** |
| C | `MAX_FILE_COUNT` 20 | distinct PDF 20 件 | **100%** | 11,445 / 11,014 / 10,576 | 58–63 | 4,100 | 2,120 | 25 | ○ | **成功（3/3）** |

ケース B は **3 件とも内容の異なる PDF** を使用しており、重複 `source_document_id` 検出は
発火していない（＝別guard先行ではない）。ケース C も 20 件すべて distinct である。

→ 3 上限すべてで「90% 以上 × 3 回成功」を満たしたため、提案値 1 MB / 2 MB / 20 を維持する。

### 3.2 暗号化 PDF（R1・本番 pipeline 実測）

Node 側の分類 unit test では不十分なため、**synthetic な暗号化 PDF fixture を browser 上の
本番 `browser_ingest.run()` に通して**測定した。

| 項目 | 実測 |
|---|---|
| fixture | `verification/fixtures/p2a3/encrypted_sample.pdf`（1 ページ、synthetic 本文、パスワード保護） |
| 分類 | `PDF_ENCRYPTED` |
| 送出値の形状 | `keys: "uiCode,count"` / `isError: false` / `hasMessage: false` / `hasStack: false` |
| 既存 session | 不変 |
| 既存 Evidence Index | 不変 |
| 記録済み ACCEPT 判定 | 不変 |
| 完走後の応答 | ○ |
| 結果 | **分類済み安全失敗** |

fixture は reportlab の暗号化が非決定的（毎回異なる byte 列になる）ため、生成 script
（`generate_encrypted_sample.py`）とともに **byte 単位で commit** し、`MANIFEST.sha256` で固定した。
SHA-256 は `a33e9c678d321cf1bda4e85e9386784791725b23db384b4e104dea689b0ae54b`。

### 3.3 境界探索（不安定点の特定）

| ケース | 入力bytes | ingest ms (3回) | heap MB | 応答 | 結果 |
|---|---|---|---|---|---|
| PDF 0.63MB（700ページ / 17,501 unit / 34,300 候補） | 626,355 | 8,266 / 7,676 / 7,984 | 121–167 | ○ | **成功（3/3）** |
| XLSX 0.93MB（3,500行） | 930,310 | 5,448 / 5,082 / 4,860 | 124–131 | ○ | **分類済み安全失敗** |
| XLSX 1.85MB（7,000行） | 1,845,666 | 26,073 / 11,709 / 10,944 | 180–224 | ○ | **分類済み安全失敗** |
| XLSX 3.68MB（14,000行） | 3,676,272 | 24,366 / 22,115 | 252–419 | × | **不安定** |

**不安定点**：単一 XLSX 3.68 MB（heap 419 MB）で処理が確定せず、後続のページ読込がタイムアウト
した。**browser crash（タブ／レンダラの異常終了）は本書の全測定を通じて 0 件である。**
1.85 MB までは、遅い（最大 26 秒）ものの必ず content-free な分類済み安全失敗で停止した。

なお 3.68 MB のケースは、提案上限を適用した本番 UI では **入力事前拒否** になる（§4.1 参照）。

### 3.4 測定中に発見・修正した実装問題

初回測定でケース 4 が `render 4,116–4,876 ms`・`responsive: false` となった。原因は 2 点。

1. 候補行ごとに `alias_candidates` を線形走査していたため、描画が O(候補数 × alias数) だった。
2. alias tab が alias を無制限に DOM へ描画していた（4,800 行）。

alias を canonical 単位で 1 度だけ index 化し、alias tab にも候補と同じ pagination を入れた結果、
ケース 4 は `render 96–116 ms`・`responsive: true` へ改善した（wall 8.9 秒 → 4.6 秒）。

---

## 4. 提案する入力上限

```text
MAX_FILE_BYTES            = 1 MB      (1,048,576)
MAX_TOTAL_SELECTED_BYTES  = 2 MB      (2,097,152)
MAX_FILE_COUNT            = 20
```

R1 の再測定でも値は変わらない。**変更したのは値ではなく根拠である**——初版は「最大成功値
0.63 MB」からの外挿で 1 MB を提案していたが、R1 では提案値の 90% 以上を直接測定して裏づけた。

### 4.1 根拠と安全余裕（R1 再測定後）

| 上限 | 上限直前の実測 | 上限比 | 結果 | 不安定点 3.68 MB からの余裕 |
|---|---|---|---|---|
| `MAX_FILE_BYTES` 1 MB | 単一 PDF 0.91 MB（dense・16,901 unit） | 90.9% | **成功 3/3・応答維持** | 約 3.7 倍下 |
| `MAX_TOTAL_SELECTED_BYTES` 2 MB | distinct PDF 3 件 計 1.84 MB（34,323 unit） | 91.9% | **成功 3/3・応答維持** | 約 1.8 倍下 |
| `MAX_FILE_COUNT` 20 | distinct PDF 20 件 | 100% | **成功 3/3・応答維持** | 時間側の余裕で担保（ingest 10.6–11.4 秒） |

- **未測定値は採用していない。** 撤回済みの 512 MB は使用していない。
- **「別guardが先に発火したケース」を上限試験の成功として数えていない。** ケース A / B / C は
  いずれも distinct な入力で、重複 `source_document_id` 検出は発火していない。
- **最大成功値をそのまま上限にしていない**（1 MB は成功実測 0.91 MB より上、不安定点からは 3.7 倍下）。
- **標準サンプル（合計 31 KB）は総量上限の約 1/65** で、十分下回る。
- **上限超過の事前拒否が機能する**：3.68 MB の XLSX を選択して解析開始した場合、
  `File.arrayBuffer()` を呼ばずに **53 ms で入力事前拒否**し、heap は 18 MB にとどまった
  （拒否しない場合は 419 MB まで上昇していた）。既存 Review State も変更されない。

### 4.2 制約

- **Chromium 実測のみ。** 他 browser では境界が異なる可能性がある。
- 上限は byte 数で表現しているが、実際の負荷を決めるのは**内容の密度**である。
  同じ 1 MB でも、画像主体の PDF は軽く、セルが密な XLSX は重い。密な XLSX は総量上限の
  手前で P2-A2 の bound（`MAX_CHILDREN_PER_PARENT` 等）に達し、**安全に失敗する**。
  これは仕様どおりの挙動であり、完走しないこと自体は不合格ではない。
- `performance.memory` は Chromium 限定指標であり、他 browser では取得できない。

### 4.3 合否の考え方（契約 S18.4）

完走することは必須ではない。**安全に失敗すること**——クラッシュせず、Review State を壊さず、
content-free な `{uiCode, count}` で停止すること——が必須である。

#### 全測定ケースの区分別集計（R1 時点）

| 区分 | 件数 | 該当 |
|---|---|---|
| 成功 | 8 | 1, 2, 3, 4, 6, 8a, A, B（C はケース 6 と同一測定） |
| 分類済み安全失敗 | 5 | 5, 8b, 9, XLSX 0.93MB, XLSX 1.85MB／暗号化 PDF |
| 入力事前拒否 | 1 | XLSX 3.68MB（提案上限適用時） |
| 不安定 | 2 | 7（5 MB 級）, XLSX 3.68MB（上限非適用時） |
| **browser crash** | **0** | — |
| 別guard先行（未測定） | 1 | 旧ケース 8 → 8a / 8b で測定し直し済み |

不安定に分類された 2 件はいずれも 3.5 MB 超であり、**提案上限では入力事前拒否になる**。
`MAX_FILE_BYTES` / `MAX_TOTAL_SELECTED_BYTES` / `MAX_FILE_COUNT` の 3 上限すべてで
「提案値の 90% 以上 × 3 回連続成功」を満たしたため、提案値の引き下げは行わない。

---

## 5. 再現コマンド

```bash
# UI 側の検証（Node 静的検査＋純関数＋Chromium での byte 一致検証）
node tools/knowledge_builder/verification/private_dictionary_candidate_review_ui_verification.js

# 本番 UI の手動起動（測定はこの画面に対して実施した）
node tools/knowledge_builder/ui/private_dictionary_candidate_review_ui/server.js
```

測定用の大型 synthetic 入力はリポジトリ外に生成した（reportlab / vendored SheetJS を使用、
新規 package 依存なし）。生成条件は本書 §3 の各ケース欄に記載したページ数・行数・列数のとおり。

---

## 6. Checkpoint 2 レビューでの決定事項

本書の提案値は **提案**であり、正式な配布上限としての承認は Checkpoint 2 レビューで行う。
承認まで、この上限で正式配布は行わない。
