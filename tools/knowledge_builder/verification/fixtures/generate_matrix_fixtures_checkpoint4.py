#!/usr/bin/env python3
# Generates the .pdf matrix fixtures used by knowledge_builder_input_matrix_checkpoint4.js
# (Alpha 0.2.0 Checkpoint 4 - full 9-combination input matrix evaluation).
# matrix_doc_a.pdf / matrix_doc_b.pdf carry the SAME 3 statements (per document, one per line)
# that matrix_doc_a.xlsx / matrix_doc_b.xlsx and matrix_doc_a_trace.json / matrix_doc_b_trace.json
# also carry (see checkpoint4_matrix_expected.json for the exact strings and
# generate_matrix_fixtures_checkpoint4.js for why the "項目: X / 内容: Y / 区分: Z" shape was
# chosen - it is exactly what excel_direct_adapter.js's deriveText() produces from a 3-column row).
# Each line is short enough (well under matchFixedHeadingLine's 60-char trailing-title threshold
# for headings, and containing no chapter/numbered-heading marker) to stay a plain paragraph, not
# get mis-detected as a heading; each of the 3 lines per document is placed far enough apart
# vertically to stay 3 separate (non-merged) paragraphs per pdf_direct_adapter.js's
# shouldMergeLines() gap heuristic.
# Re-run this script to regenerate the fixtures deterministically if content changes.
# Run: python3 tools/knowledge_builder/verification/fixtures/generate_matrix_fixtures_checkpoint4.py
import os

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# 是正: DOC_A/DOC_B の内容はcheckpoint4_matrix_expected.jsonの正本と一致させる
# (このスクリプトとcheckpoint4_matrix_expected.json、他2形式のgeneratorの4箇所で値を重複定義
# している。内容を変更する場合は4箇所すべてを揃えて更新すること)。
DOC_A_LINES = [
    '項目: 表面温度 / 内容: 通常運転時の表面温度は60度以下とする / 区分: 温度管理',
    '項目: 動作音 / 内容: 通常運転時の動作音は45dB以下とする / 区分: 静音性',
    '項目: 設置環境 / 内容: 屋内の乾燥した場所に設置することを前提とする / 区分: 設置条件',
]
DOC_B_LINES = [
    '項目: 筐体表面温度 / 内容: 通常運転時の筐体表面温度を60度以下に維持する設計とする / 区分: 温度管理',
    '項目: 運転音 / 内容: 通常運転時の運転音を45dB以下に抑える設計とする / 区分: 静音性',
    '項目: 設置場所 / 内容: 屋内の乾燥した場所への設置を前提とした構造とする / 区分: 設置条件',
]


def build(path, lines):
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont('HeiseiKakuGo-W5', 10)
    y = 780
    for line in lines:
        c.drawString(72, y, line)
        y -= 100  # 十分な行間(段落結合されないよう大きく離す)
    c.save()


def main():
    build(os.path.join(OUT_DIR, 'matrix_doc_a.pdf'), DOC_A_LINES)
    build(os.path.join(OUT_DIR, 'matrix_doc_b.pdf'), DOC_B_LINES)
    print('Generated: matrix_doc_a.pdf, matrix_doc_b.pdf')


if __name__ == '__main__':
    main()
