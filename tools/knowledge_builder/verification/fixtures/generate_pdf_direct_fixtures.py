#!/usr/bin/env python3
# Generates the .pdf fixtures used by pdf_direct_adapter_verification.js (Alpha 0.2.0
# Checkpoint 3a). Written in Python (reportlab) rather than Node because no PDF-writing
# library is vendored/available in this repo's Node toolchain, while reportlab (with
# built-in CID font support for Japanese text via HeiseiKakuGo-W5, a standard PDF CJK font
# that does not require font embedding) was confirmed available and sufficient, including
# for encrypted-PDF generation (reportlab.lib.pdfencrypt.StandardEncryption).
# Re-run this script to regenerate the fixtures deterministically if their content needs to
# change; the resulting .pdf files are committed alongside this generator (same convention
# as generate_excel_direct_fixtures.js and samples/knowledge_builder_alpha01/medium/generate_medium_sample.js).
# Run: python3 tools/knowledge_builder/verification/fixtures/generate_pdf_direct_fixtures.py
import os

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.pdfencrypt import StandardEncryption

pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))

OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def new_canvas(path, encrypt=None):
    return canvas.Canvas(path, pagesize=A4, encrypt=encrypt)


def line(c, x, y, text, size=12):
    c.setFont('HeiseiKakuGo-W5', size)
    c.drawString(x, y, text)


# ---- fixture 1: 1ページ、見出しなし、2段落(段落間は大きな空白で明確に分離) ----
def build_fixture_1():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_1_no_heading_two_paragraphs.pdf')
    c = new_canvas(path)
    line(c, 72, 760, 'この文書には見出しがありません。')
    line(c, 72, 745, '最初の段落の二行目です。')
    line(c, 72, 650, '二番目の段落です。ここは最初の段落から十分離れています。')
    c.save()
    return path


# ---- fixture 2: 1ページ、番号付き見出し2件 ----
def build_fixture_2():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_2_numbered_headings.pdf')
    c = new_canvas(path)
    line(c, 72, 780, '1. 概要')
    line(c, 72, 750, 'これは概要section配下の段落です。')
    line(c, 72, 735, 'この行は前の行と結合されます。')
    line(c, 72, 690, '1.2 適用範囲')
    line(c, 72, 660, 'これは適用範囲section配下の段落です。')
    c.save()
    return path


# ---- fixture 3: 2ページ、ページごとに見出しと段落(ページを越えて段落結合しないことを確認) ----
def build_fixture_3():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_3_two_pages_heading_each.pdf')
    c = new_canvas(path)
    line(c, 72, 780, '第1章 総則')
    line(c, 72, 750, 'これは第1章の段落です。')
    c.showPage()
    line(c, 72, 780, '第2章 適用範囲')
    line(c, 72, 750, 'これは第2章の段落です。')
    c.save()
    return path


# ---- fixture 4: 見出し前に本文が存在(synthetic「本文」section用) ----
def build_fixture_4():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_4_body_before_heading.pdf')
    c = new_canvas(path)
    line(c, 72, 800, 'この行は最初の見出しより前にある本文です。')
    line(c, 72, 700, '1. 概要')
    line(c, 72, 670, 'これは見出しの後の段落です。')
    c.save()
    return path


# ---- fixture 5: 短い行だが見出しではない(固定パターンに一致しない短文) ----
def build_fixture_5():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_5_short_line_not_heading.pdf')
    c = new_canvas(path)
    line(c, 72, 780, '1. 概要')
    line(c, 72, 750, '通常の段落です。')
    line(c, 72, 650, '以上')
    c.save()
    return path


# ---- fixture 6: 一部空白ページを含む(3ページ中、中間ページが完全に空白) ----
def build_fixture_6():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_6_blank_page.pdf')
    c = new_canvas(path)
    line(c, 72, 780, '1. 概要')
    line(c, 72, 750, '1ページ目の段落です。')
    c.showPage()
    # 2ページ目: 完全に空白(テキストなし)
    c.showPage()
    line(c, 72, 780, '2. 続き')
    line(c, 72, 750, '3ページ目の段落です。')
    c.save()
    return path


# ---- fixture 7: 全ページ画像／テキストなし(全ページ空白) ----
def build_fixture_7():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_7_all_blank.pdf')
    c = new_canvas(path)
    c.showPage()
    c.showPage()
    c.save()
    return path


# ---- fixture 8: 壊れたPDF(有効なPDFバイト列ではない) ----
def build_fixture_8():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_8_corrupted.pdf')
    with open(path, 'wb') as f:
        f.write(b'%PDF-1.4\nThis is not a valid PDF body. \x00\x01\x02 garbage bytes.\n%%EOF')
    return path


# ---- fixture 9: 同じ文面でフォントサイズだけ異なる(見出し判定がフォントサイズに依存しないこと) ----
def build_fixture_9():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_9_same_text_diff_fontsize.pdf')
    c = new_canvas(path)
    # 大きなフォントだが固定パターンに一致しないタイトル行(見出し化されてはいけない)
    line(c, 72, 780, '会社案内', size=24)
    line(c, 72, 740, '本文段落です。')
    # 小さなフォントでも番号付きパターンに一致する行(見出し化されるべき)
    line(c, 72, 650, '1. 概要', size=8)
    line(c, 72, 620, 'この段落は小さいフォントの見出しの下に属します。')
    c.save()
    return path


# ---- fixture 10: 共通タグ辞書一致を含むPDF(完全一致は付与、部分一致は付与しないことを確認) ----
def build_fixture_10():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_10_tag_match.pdf')
    c = new_canvas(path)
    line(c, 72, 780, '1. 分類')
    line(c, 72, 750, '安全')
    line(c, 72, 650, '2. 説明')
    line(c, 72, 620, 'この装置は安全性能を重視する設計です。')
    c.save()
    return path


# ---- fixture 11 (追加): 暗号化PDF(パスワード要求) ----
def build_fixture_11():
    path = os.path.join(OUT_DIR, 'pdf_direct_fixture_11_encrypted.pdf')
    enc = StandardEncryption('secret123', canPrint=1)
    c = new_canvas(path, encrypt=enc)
    line(c, 72, 780, '1. 概要')
    line(c, 72, 750, '暗号化されたPDFの段落です。')
    c.save()
    return path


def main():
    paths = [
        build_fixture_1(), build_fixture_2(), build_fixture_3(), build_fixture_4(),
        build_fixture_5(), build_fixture_6(), build_fixture_7(), build_fixture_8(),
        build_fixture_9(), build_fixture_10(), build_fixture_11(),
    ]
    for p in paths:
        print('Generated:', os.path.basename(p))


if __name__ == '__main__':
    main()
