# Alpha Release Report — JSON A/B トレース照合ツール V12.2.0-alpha.1

本リリースはAlpha Release Gate 1（Checkpoint 0〜4）を通じて構築した、既存のB-4b機能・照合ロジック・Schema・B-4b APIを一切変更しない、パッケージング専用のα版です。branch `release/v12.2.0-alpha.1`。

**commitトレーサビリティ（役割別）:**

```text
配布内容・文書の基線commit:
227731a550aab39046fa37c58e82978edf7dfecb
（version harmonization + Chromium限定検証の文書化まで）

ZIP packaging初回実装commit:
b295826（旧SHA-256 20933ffba0...は失効、本レポート内で失効を明記）

ZIP再現性・展開後package verification確定commit:
7f61d254568e3d033cb0c2db0adad4660a48c2a7
（現在の正本ZIP SHA-256 a63539456f...はこのcommit時点の実装による）

最終PR head:
PR #6のGitHub metadataを正本とする（本レポート自身を含む後続commitはPR側で確認）
```

## Alpha release browser status

```text
CONDITIONAL GO

Verified:
Playwright bundled Chromium (実行ファイル: /opt/pw-browsers/chromium-1194/chrome-linux/chrome,
version: Chromium 141.0.7390.37, OS: Ubuntu 24.04.4 LTS)

Not verified before release:
Google Chrome
Microsoft Edge

Risk disposition:
実Chrome／Edge試験を限定α評価へ移管する。README/KNOWN_LIMITATIONSに
Chromium限定検証であることを明記済み。BROWSER_VALIDATION_REPORT.mdを
配布物へ同梱し、α版利用者からの評価結果を収集する。
```

**Checkpoint 3: α版条件付き完了**（実Chrome／Edge事前検証はα版では免除。β版移行前には両ブラウザでの実機試験が必須 — 詳細は`docs/KNOWN_LIMITATIONS.md`および本レポート末尾を参照）。

## Checkpoint別 結果サマリ

| Checkpoint | 内容 | 結果 |
|---|---|---|
| 0 | 依存関係・基線調査 | 承認済み |
| 1 | オフラインパッケージング・vendor library化 | 承認済み(20回連続実行含む安定性確認済み) |
| 2 | 版数統一・ユーザードキュメント | 承認済み(commit `93b426e3`) |
| 3A | package verification | 完了(374/374) |
| 3B | ChromiumオフラインE2E | 完了(88/88 × 3回連続) |
| 3C | クリーンルーム(空白パス・日本語パス) | 完了(35/35 × 2回) |
| 3D | 実Chrome／Edge事前検証 | α版では免除、リリース後評価へ移管 |
| 3 全体 | | **α版条件付き完了** |
| 4 | 最終ZIP作成・本レポート | 完了(本Request Changes対応版) |

## 検証結果一覧

| 項目 | 結果 |
|---|---|
| package verification(dist直下) | 374/374 |
| package verification(ZIP展開物に対して) | 374/374 |
| Chromium offline E2E | 88/88 × 3回連続 |
| clean-room verification(空白パス・日本語パス) | 35/35 × 2回連続 |
| runtime smoke | 19/19 |
| version verification | 35/35 |
| network-isolated build(`unshare -n`) | exit 0 |
| build再現性(2回build内容一致) | バイト完全一致 |
| **ZIP再現性(2回build+package内容がZIP自体としてバイト完全一致)** | **SHA-256一致・`cmp`終了コード0** |
| 既存B-4b回帰(state/session/projection/export) | 77/77・152/152・32/32・69/69 |
| 既存UI回帰(CP2/CP3) | 53/53・42/42 |
| browser download / Excel xlsx | 31/31・47/47 |
| 外部ネットワーク要求 | 0件(記録・遮断とも) |
| pageerror / console error | 各0件 |
| git diff --check / git status | 問題なし |
| ZIP round-trip検証(展開→バイト比較) | 23ファイル完全一致 |
| ZIP entry構成 | 全23件が`trace-matching-tool-v12.2.0-alpha.1/`配下、余分entry(`__MACOSX`等)0件 |

## 配布物

```text
dist/trace-matching-tool-v12.2.0-alpha.1.zip
```

**ファイル件数の内訳（正確な表記）:**

```text
配布物総ファイル数: 23
SHA256SUMS.txt登録件数: 22
SHA256SUMS.txt自身: 登録対象外
```

- **ZIPサイズ**: 764,510 bytes
- **ZIP SHA-256**: `a63539456ff2903c2f333db6d2265e4db2e203fcf6fd264910d477aee7347cd1`
- **SHA256SUMS.txt自身のSHA-256**: `a11f38c785b998c577b16c0fcff55741e50ab44193b5136dbf0bc73c79f4d2fc`
- 内容: `trace-matching-tool-v12.2.0-alpha.1/`配下、配布物総ファイル数23(うちSHA256SUMS.txt登録件数22)
- 生成コマンド: `node tools/release/build_alpha_release.js && node tools/release/package_alpha_zip.js`
- 再現性対応: 全ファイルのmtimeをビルド時に固定値へ正規化し、zip entryを明示的にsortした相対パスリストで`zip -X -D`投入することで、ZIP自体のバイト列を2回のフルビルド間で完全一致させている(`package_alpha_zip.js`のFIXED_TIMESTAMP機構)。
- 検証: (1) ZIPを展開し`dist/`の全23ファイルとバイト完全一致、(2) 独立した2回のフルビルド+packaging間でZIP自体がSHA-256一致・`cmp`終了コード0、(3) ZIPを新規一時ディレクトリへ展開し`alpha_release_package_verification.js --root=<展開先>`で374/374 —以上すべて`package_alpha_zip.js`が単一実行で自動検証する。

**旧SHA-256の失効について**: 前回報告した`20933ffba04717804d9a5bf5b509b90402f4810765a674de9af58cb0ac9dac8e`（サイズ764,988 bytes）はZIP自体の再現性が未実証だったため失効。上記の値を正本とする。

### distディレクトリのSHA-256(SHA256SUMS.txt対象22ファイル、SHA256SUMS.txt自身は含まない)

```
55a4c707d29a46a72a4cd444424623bfa829197ac003d8a9bae53afd172e33f4  BROWSER_VALIDATION_REPORT.md
f3ac9ebbd27e410b92ca17bd0dfa980e610e4508f7f4713427c29b98f1ddbdbb  KNOWN_LIMITATIONS.md
941e613f64bcb4d1def29dd8699332f4230e80c54f0fb8a52b5dd73e649b5d68  README_ja.md
b18459dc23469e1601fc9a7fa9e58eb895a7753a34d5065d256170919707a90d  THIRD_PARTY_LICENSES.md
5a146ce768e219c5c02d75a2e079080859c43c3a5efd5cd35f927e70d699a00e  json_ab_trace_matching_tool_v12.2.0-alpha.1.html
ac2a446d6e1b489d9568def4ba7790ab81f5023ebba335d49a77dbff1960232e  licenses/cytoscape-3.26.0-MIT.txt
afb804e4ef33cdafae12af8bcfc43ff2c817c47fdd5b8f00c7b2efc599ec8b71  licenses/tiny-segmenter-0.2.0-npm-MIT.txt
f515f7b94186cec29a228fd7caa3e9e969fd0e1f28e2849a236a36cb8bd5eccd  licenses/tiny-segmenter-original-BSD-3-Clause.txt
3a63cc817e1c3789c59c35d2f39f3031761fdec786cf43084b49518551cfe998  licenses/tiny-segmenter-original-notice.txt
4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64  licenses/xlsx-0.18.5-Apache-2.0.txt
37ed58d294f044922922bf8e01c671acfee13c91c030885af2aea9ca03c156a9  runtime/cytoscape-3.26.0.min.js
9a4fd54706426fe534f9c79e69f77f0bb37dd222e5cc2b29d68138f8cfd58885  runtime/json_schema_minivalidator.js
cc1e9f8b3c0d7c9a6641d29e444045dc210a2d4421f2c246d495ec80f42008e9  runtime/quantity_annotation_schema_v1.browser.js
84144dbdc5c6c0cd8e719ce282260d13b1f4624ecdf3ea0ef8ff86117ed2243a  runtime/quantity_sidecar_binding_core.js
91beda36fe50aa9dc90798f2124a38b45beedcf845120fa4f5550229ef8ebe8d  runtime/tiny-segmenter-0.2.0.js
0b0ddbb8addc621a258f0f297e383132c7b990e4251d65b03684084631622a0e  runtime/trace_comparison_record_set_validator.js
172467d513853e9dc691d1268f77aa6093876c09e004958c03a0f042011ab4cc  runtime/trace_comparison_review_export_core.js
d7ff1ac0bb82d80c77c5181b949a51adb3b12a8976c51ac4e96de8661ea2bfb0  runtime/trace_comparison_review_projection_core.js
c1809c0bd26fd5975e7347d0fc84246470c4776237a2dabb07908f67d39ae2c6  runtime/trace_comparison_review_session_core.js
61bd4a27eb6fda80266c9237eead286b9f473511958bb42ac8107bc7b5e29841  runtime/trace_comparison_review_state_core.js
7bae2eedd7624b884466c4009c5ee97490367d40e3d123f4a86cc2cc63e69b0b  runtime/trace_comparison_schema_v2.browser.js
c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99  runtime/xlsx-0.18.5.full.min.js
```

## 既知の残留リスク

1. **実Chrome／実Microsoft Edge未検証**（本レポート最大の既知リスク）。Checkpoint 3の判断により、α版に限りリリース後の限定評価へ移管。β版移行前には両ブラウザでの実機試験が必須条件（本ドキュメント末尾「β版への移行条件」参照）。
2. TinySegmenter原実装のライセンス全文は、原URL(chasen.org)がこのビルド環境から到達不能なため、SPDX/OSI標準BSD-3-Clauseテンプレートを著作権表示のみ埋めて収録している(`THIRD_PARTY_LICENSES.md`に明記済み)。
3. Windows実行環境固有の問題(パス長制限、ロケール、ファイルロック挙動等)は本環境(Linux)では検証できていない。

## β版への移行条件(再掲)

β版へ進む前に、実Windows環境で次を必須とする。

- 実Google Chromeで主要シナリオ成功
- 実Microsoft Edgeで主要シナリオ成功
- 両ブラウザの正式JSON parity成功
- 両ブラウザの正式Excel parity成功
- file://起動成功
- 外部通信0件
- 重大console error 0件

α版利用者からの報告だけでβ版合格にしてはならない。開発側または指定試験担当者による再現可能な試験記録が必要。

## 禁止事項(継続)

本リリースはα版限定評価用であり、次を実施していない。

- mainへのmerge
- Git tag作成
- GitHub Release作成
- 外部への一般公開
- 「正式版」または「β版」としての表記
