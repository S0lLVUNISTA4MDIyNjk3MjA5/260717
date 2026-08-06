# P2-A3 browser-memory 測定報告

Checkpoint 2 成果物 / 設計契約 S18.4 の測定 matrix 実測結果と、入力上限の提案。

本書には private 本文も実 file path も記載しない。測定入力はすべて synthetic で、リポジトリ外に
生成し commit していない。

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
| 8 | adapter上限到達（700p PDF ×2） | 2 | 1,252,710 | 626,355 | 11,163 | — | — | — | — | — | 183 | × | **安全な失敗**（重複 source 検出） |
| 9 | P2-A2 projection上限到達（20k行 XLSX） | 1 | 5,865,975 | 5,865,975 | 3,565 | — | — | — | — | — | 107 | × | **安全な失敗**（projection validation） |

> ケース 8 は同一ファイルを 2 回指定したため、adapter 上限より先に重複 `source_document_id`
> 検出が働いた。重複検出そのものが期待どおり run 全体を拒否しており、安全な失敗である。

### 3.1 境界探索（追加測定）

| ケース | 入力bytes | ingest ms (3回) | heap MB | 応答 | 結果 |
|---|---|---|---|---|---|
| PDF 0.63MB（700ページ / 17,501 unit / 34,300 候補） | 626,355 | 8,266 / 7,676 / 7,984 | 121–167 | ○ | **成功（3/3）** |
| XLSX 0.93MB（3,500行） | 930,310 | 5,448 / 5,082 / 4,860 | 124–131 | × | 安全な失敗 |
| XLSX 1.85MB（7,000行） | 1,845,666 | 26,073 / 11,709 / 10,944 | 180–224 | × | 安全な失敗 |
| XLSX 3.68MB（14,000行） | 3,676,272 | 24,366 / 22,115 | 252–419 | × | **不安定（タイムアウト）** |

**失敗境界**：単一 XLSX で 3.68 MB（heap 419 MB）到達時に、処理は完了せず後続の
ページ読込がタイムアウトした。**browser の完全クラッシュ（タブの異常終了）は観測していない。**
1.85 MB までは、遅い（最大 26 秒）ものの必ず content-free な安全失敗で停止した。

### 3.2 測定中に発見・修正した実装問題

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

### 4.1 根拠と安全余裕

| 上限 | 根拠 | 安全余裕 |
|---|---|---|
| `MAX_FILE_BYTES` 1 MB | 直下の 0.63 MB（dense PDF・17,501 unit）が **3/3 成功・応答維持** | 不安定点 3.68 MB に対し **約 3.7 倍下** |
| `MAX_TOTAL_SELECTED_BYTES` 2 MB | 複数ファイル成功の実測最大は 251 KB。総量はメモリを直接押し上げるため単一上限とは独立に設定 | 不安定点 3.68 MB に対し **約 1.8 倍下** |
| `MAX_FILE_COUNT` 20 | 20 件（distinct）が **3/3 成功・応答維持**（ingest 10.6–11.4 秒） | 実測成功値と同値。件数はメモリよりも時間に効くため、時間側の余裕で担保 |

- **未測定値は採用していない。** 撤回済みの 512 MB は使用していない。
- **最大成功値をそのまま上限にしていない**（`MAX_FILE_BYTES` は最大成功 0.63 MB より上だが、
  不安定点からは 3.7 倍下に置いている）。
- **標準サンプル（合計 31 KB）は総量上限の約 1/65** で、十分下回る。
- **上限直前の試験が複数回成功する**：0.63 MB PDF が 3/3 成功。
- **上限超過の事前拒否が機能する**：3.68 MB の XLSX を選択して解析開始した場合、
  `File.arrayBuffer()` を呼ばずに **53 ms で拒否**し、heap は 18 MB にとどまった
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
content-free なエラーで停止すること——が必須である。上記 9 ケース中、成功 4 件・安全な失敗 4 件・
不安定 1 件であり、**不安定だった 1 件（5 MB 級）は提案上限で事前拒否される**。

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
