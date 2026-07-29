# サードパーティライセンス — V12.2.0-alpha.1

本配布物は、以下4区分の第三者ソフトウェアを同梱しています。各ライセンス原文は`licenses/`フォルダに同梱しています。

## 1. Cytoscape.js 3.26.0

- 著作権表示: `Copyright (c) 2016-2023, The Cytoscape Consortium.`
- ライセンス: MIT
- 配布元: npm registry (`cytoscape@3.26.0`)
- ライセンス原文: `licenses/cytoscape-3.26.0-MIT.txt`

## 2. SheetJS xlsx 0.18.5

- 著作権表示: `Copyright (C) 2012-present SheetJS LLC`
- ライセンス: Apache License 2.0
- 配布元: npm registry (`xlsx@0.18.5`)
- ライセンス原文: `licenses/xlsx-0.18.5-Apache-2.0.txt`

## 3. TinySegmenter npm package 0.2.0

npmで配布されている`tiny-segmenter@0.2.0`パッケージ自体の再パッケージ化に対するライセンス表示です。下記4節の「元実装」とは別レイヤーとして記録します。

- 著作権表示: パッケージ同梱`LICENSE`ファイルの記載のとおり(`Copyright (c) 2016 绝云`)
- ライセンス: MIT
- 配布元: npm registry (`tiny-segmenter@0.2.0`)
- ライセンス原文: `licenses/tiny-segmenter-0.2.0-npm-MIT.txt`

## 4. Original TinySegmenter implementation

配布JavaScript本体(`tiny-segmenter-0.2.0.js`)自身のヘッダーコメントが示す、原実装のライセンスです。

- 著作権表示: `Copyright (c) 2008 Taku Kudo <taku@chasen.org>`
- ライセンス: New BSD License(SPDX識別子: `BSD-3-Clause`)
- 原文ヘッダー(4行、verbatim): `licenses/tiny-segmenter-original-notice.txt`
- ライセンス全文: `licenses/tiny-segmenter-original-BSD-3-Clause.txt`

**制約事項**: 原ヘッダーが参照する`http://chasen.org/~taku/software/TinySegmenter/LICENCE.txt`は、本配布物のビルド環境からアクセスできなかった(ネットワークegress許可リストに`chasen.org`が含まれていない)ため、原文そのものを取得できていない。`licenses/tiny-segmenter-original-BSD-3-Clause.txt`に収録した全文は、著作権表示(`Copyright (c) 2008, Taku Kudo`)以外の条件・免責条項をSPDX/OSIの標準BSD-3-Clauseテンプレートから複製したものであり、原URLから取得したものではない。この点はファイル冒頭にも明記している。
