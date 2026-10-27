#!/usr/bin/env python3
"""P2-A3 synthetic sample PDF generator (deterministic).

Generates the standard train-HVAC requirement spec sample and the two edge-case PDFs used by
the P2-A3 candidate review UI. All content is fully synthetic: no real company, vehicle,
product, project, or person appears anywhere in this file.

Determinism: reportlab's Canvas(invariant=1) fixes the creation timestamp, the document ID and
the producer string, so running this script twice produces byte-identical PDFs. No other
metadata is written. Verify with generate + sha256sum into two separate empty directories, or
run verify_samples.js.

Usage:
    python3 generate_train_hvac_pdf_samples.py [output_root]

output_root defaults to the directory containing this script. Files are written to
<output_root>/standard/ and <output_root>/edge_cases/.

Dependencies: reportlab only (already used by the existing PDF fixture generator). No new
package dependency is introduced.
"""
import os
import sys

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

FONT = 'HeiseiKakuGo-W5'
HEADING_SIZE = 14
BODY_SIZE = 11
LEFT = 72
TOP = 800
# Gap between separate paragraph blocks. The PDF adapter keeps these apart, so each becomes its
# own BODY_STATEMENT unit.
BLOCK_GAP = 26
# Gap between wrapped lines *inside* one paragraph block. Measured against the adapter: at this
# spacing the lines are joined into a single normalised statement, which is what makes the NB-01
# fixture reproduce a real newline-boundary over-capture rather than a simple non-detection.
WRAP_GAP = 16

# ---- standard sample: requirement specification -------------------------------------------
# Rule coverage carried by this document:
#   TERM_STRUCTURAL_HEADING       chapter headings
#   TERM_EXPLICIT_QUOTED          quoted terms and the quoted alias inside each defined-as
#   ALIAS_EXPLICIT_DEFINED_AS     Japanese "以下「X」という" and English 'hereinafter "X"'
#   ALIAS_EXPLICIT_PARENTHETICAL  "名称（略称）"
# The alias FACU is deliberately defined against two different canonicals (chapter 2) so the
# sample always contains exactly one alias conflict.
STANDARD_PAGES = [
    ('第1章 適用範囲', [
        '本仕様書は、架空の鉄道車両用空調装置に関する設計要件を定めるものである。',
        '温度制御装置（以下「TCU」という）は、車内設定温度を制御する。',
        '送風機制御装置（FCU）は、送風量を段階的に調整する。',
        '「車内設定温度」は運転台から変更できる。',
    ]),
    ('第2章 用語の定義', [
        '外気導入制御装置（以下「FACU」という）は、外気の導入量を調整する。',
        'Fresh Air Control Unit (hereinafter "FACU") regulates the outside air intake.',
        '換気ユニット（以下「EVU」という）は、車内の換気を担う。',
        '圧縮機制御装置（以下「CCU」という）は、冷媒の圧縮行程を制御する。',
    ]),
    ('第3章 性能要件', [
        '冷房能力は定格条件において規定値を満たすこと。',
        '暖房能力は定格条件において規定値を満たすこと。',
        '「定格条件」は第5章に定める試験条件をいう。',
        '車内設定温度の制御範囲は付表による。',
    ]),
    ('第4章 制御機能', [
        'TCUは車内設定温度に基づき冷房能力を調整する。',
        'FCUは送風量を三段階で切り替える。',
        'FACUは外気の導入量を連続的に制御する。',
        '電源制御装置（PCU）は各制御装置へ電力を供給する。',
    ]),
    ('第5章 試験方法', [
        '「試験モード」では保護機能の一部を無効化できる。',
        '定格条件における冷房能力を測定する。',
        '定格条件における暖房能力を測定する。',
        '送風制御ユニット（BCU）は予備品として試験に用いる。',
    ]),
    ('第6章 保守・点検', [
        'TCUの点検周期は定期検査に合わせる。',
        'FCUは消耗品を含むため、定期交換が必要である。',
        'FACUのフィルタは定期清掃を行う。',
    ]),
    ('第7章 付表', [
        '付表の機器一覧および性能確認記録は別冊の設計資料による。',
        '本仕様書に定めのない事項は、別途協議のうえ決定する。',
    ]),
]

# ---- edge case: alias conflict --------------------------------------------------------------
# Two different canonicals define the same alias, in Japanese and in English, so the extraction
# core must report exactly one conflict and must not auto-resolve it.
ALIAS_CONFLICT_PAGES = [
    ('第1章 定義', [
        '制御弁A（以下「CV」という）は冷媒回路に設置する。',
        '制御弁B（以下「CV」という）は空気回路に設置する。',
        'Damper Control Unit (hereinafter "DCU") controls the air damper.',
        '減衰制御装置（以下「DCU」という）は振動を抑制する。',
        '「制御弁A」と「制御弁B」は別の機器である。',
    ]),
]

# ---- edge case: newline boundary (NB-01) ----------------------------------------------------
# The English defined-as canonical sits at the start of a line whose preceding line ends with a
# short phrase. After the adapter's newline normalisation the two can end up in one normalised
# string, which is the NB-01 over-capture condition the reviewers are asked to classify.
# A block given as a list of strings is drawn with WRAP_GAP spacing, so the adapter joins the
# lines into one normalised statement.
NEWLINE_BOUNDARY_PAGES = [
    ('第1章 記載例', [
        # Over-capture case: the line break falls between a short lead-in phrase and the
        # canonical, and there is no strong sentence separator to stop the match, so the
        # canonical absorbs "Test rig note". This is the NB-01 condition.
        [
            'Test rig note Reference Cooling Unit',
            '(hereinafter "RCU") is a fictitious placeholder component.',
        ],
        # Contrast case: the same layout, but the preceding sentence ends with a full stop, so
        # the canonical stops at the boundary and stays exactly "Sample Heating Unit".
        [
            'Prior sentence ends here. Sample Heating Unit',
            '(hereinafter "SHU") is also fictitious.',
        ],
        '「参照冷却装置」は試験装置の呼称である。',
    ]),
]


def draw_document(path, pages, title):
    """Each body entry is either a string (one paragraph block) or a list of strings (one
    paragraph block whose lines are wrapped at WRAP_GAP, which the adapter joins)."""
    c = canvas.Canvas(path, pagesize=A4, invariant=1)
    c.setTitle(title)
    c.setAuthor('P2-A3 synthetic sample generator')
    c.setSubject('Fully synthetic train HVAC sample - no real product information')
    c.setCreator('generate_train_hvac_pdf_samples.py')
    for heading, blocks in pages:
        y = TOP
        c.setFont(FONT, HEADING_SIZE)
        c.drawString(LEFT, y, heading)
        y -= BLOCK_GAP + 6
        c.setFont(FONT, BODY_SIZE)
        for block in blocks:
            lines = block if isinstance(block, list) else [block]
            for index, line in enumerate(lines):
                c.drawString(LEFT, y, line)
                y -= WRAP_GAP if index < len(lines) - 1 else BLOCK_GAP
        c.showPage()
    c.save()


def main():
    pdfmetrics.registerFont(UnicodeCIDFont(FONT))
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    standard = os.path.join(root, 'standard')
    edge = os.path.join(root, 'edge_cases')
    os.makedirs(standard, exist_ok=True)
    os.makedirs(edge, exist_ok=True)

    targets = [
        (os.path.join(standard, 'train_hvac_requirement_spec_sample.pdf'), STANDARD_PAGES,
         '鉄道車両用空調装置 要求仕様書（synthetic sample）'),
        (os.path.join(edge, 'alias_conflict_sample.pdf'), ALIAS_CONFLICT_PAGES,
         'Alias conflict edge case（synthetic sample）'),
        (os.path.join(edge, 'newline_boundary_sample.pdf'), NEWLINE_BOUNDARY_PAGES,
         'Newline boundary edge case（synthetic sample）'),
    ]
    for path, pages, title in targets:
        draw_document(path, pages, title)
        print('wrote', path)


if __name__ == '__main__':
    main()
