# 同梱ライブラリ (Vendored library): PDF.js

このディレクトリには、Knowledge Data Builder Alpha 0.2.0 Checkpoint 3a (`core/pdf_direct_adapter.js`)
が実行時に読み込むPDF.jsを、CDN参照なしでローカル同梱しています。読み込み元は
`tools/alpha_release/pdf_excel_json_tools_alpha_v0.10.1_ai_review_handoff/pdf_tool/vendor/pdfjs/`
にある、既存PDF→JSON変換α版ツールが実際に検証済みの同一コピーです（本ディレクトリはその単純な
ファイルコピーであり、中身は一切変更していません。既存コピー側のvendorも本作業では変更していません）。

## PDF.js (pdfjs-dist)

| 項目 | 値 |
|---|---|
| バージョン | 3.11.174 |
| 取得元(既存コピーの記録による) | npm registry (`https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-3.11.174.tgz`) の `build/`・`cmaps/`・`standard_fonts/` |
| ライセンス | Apache License 2.0（`pdfjs-LICENSE.txt` に全文同梱） |
| 同梱ファイル | `pdf.min.js`、`pdf.worker.min.js`、`cmaps-data.js`・`fonts-data.js`（CMap・標準フォントをBase64埋め込みしたもの）、`alpha-local-factories.js`（file://実行時のCORS制約を回避するローカル読込ファクトリ）、`cmaps/`（169ファイル、Adobe CMap、`cmaps/LICENSE`同梱）、`standard_fonts/`（Foxit/Liberationフォント、`LICENSE_FOXIT`・`LICENSE_LIBERATION`同梱） |

`alpha-local-factories.js`はブラウザの`window`/`atob`を前提に実装されています。Node環境で
`pdf_direct_adapter.js`の純関数テストを実行する場合は、`globalThis.window = globalThis`という
最小限のシムを与えるだけで、この同じファイルがブラウザと同一の`AlphaLocalCMapReaderFactory`/
`AlphaLocalStandardFontDataFactory`として動作することを確認済みです(Node標準の`atob`グローバルを
利用。追加のポリフィルは不要)。ファイル自体・pdf.js本体・cmaps/standard_fontsのデータは無改変です。

## SHA-256 (このディレクトリ内の主要ファイル)

```
623ad090f430bb267dbe45e43c7543782c7622d439db1b026971819897feea82  alpha-local-factories.js
c1cbd511f3dd16b82dc7e424406f8e9bba2f33fc424f80af290bf1cdcc4f4999  cmaps-data.js
2c85d8915e2921efd4107663ba8af885890d2576d61cabf53278cf1637ec7d39  fonts-data.js
5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946  pdf.min.js
feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b  pdf.worker.min.js
0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594  pdfjs-LICENSE.txt
```

上記は`sha256sum <file>`で算出したもので、`tools/alpha_release/.../pdf_tool/vendor/pdfjs/`にある
同名ファイルとバイト一致することを`diff -rq`で確認済みです(差分なし)。`cmaps/`・`standard_fonts/`
配下の個別ファイルも同様にコピー元とバイト一致します。

## CDN参照の禁止

`core/pdf_direct_adapter.js`は`https://`等のネットワークURLを一切参照せず、pdf.jsのロードは常に
この`vendor/pdfjs/`配下の相対パスから行います。`file://`起動でも動作します(Checkpoint 3aの
Node向け純関数テストで実証済み。ブラウザでのfile://動作はCheckpoint 3bのUI接続時に確認します)。

## 本Checkpointで意図的に同梱していないもの

- Tesseract.js等のOCRライブラリ: 対象外(画像PDF・スキャンPDFはOCR非対応)。
- tiny-segmenter: Checkpoint 3aのタグ付与は既存Excel直接入力Adapterと同じ完全一致/明示alias一致の
  みで、形態素解析を用いないため同梱していません。
