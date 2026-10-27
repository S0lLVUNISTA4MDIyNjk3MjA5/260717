#!/usr/bin/env python3
# Generates trial_guide.pdf for the Alpha 0.2.0 Checkpoint 5 limited human trial package.
# 1-2 pages, minimal screenshot (current alpha screen), reportlab + HeiseiKakuGo-W5 (same
# pattern used throughout this project). See tools/knowledge_builder/trial/README source
# for the Checkpoint 5 instruction this content is derived from.
# Run: python3 tools/knowledge_builder/trial/generate_trial_guide.py
import os

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.utils import ImageReader

pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
SCREENSHOT = '/tmp/claude-0/-home-user-260717/07479cce-1d01-5a9a-a4a6-55bbe6ef4541/scratchpad/screen_step1.png'

LEFT = 56
RIGHT_LIMIT = 540
TOP = 800


def draw_wrapped(c, text, x, y, font='HeiseiKakuGo-W5', size=10, leading=15, max_chars=42):
    c.setFont(font, size)
    line = ''
    for ch in text:
        line += ch
        if len(line) >= max_chars:
            c.drawString(x, y, line)
            y -= leading
            line = ''
    if line:
        c.drawString(x, y, line)
        y -= leading
    return y


def heading(c, text, y, size=13):
    c.setFont('HeiseiKakuGo-W5', size)
    c.drawString(LEFT, y, text)
    return y - 20


def para(c, lines, y, size=10, leading=15):
    for text in lines:
        y = draw_wrapped(c, text, LEFT, y, size=size, leading=leading)
    return y


def main():
    path = os.path.join(OUT_DIR, 'trial_package', 'trial_guide.pdf')
    c = canvas.Canvas(path, pagesize=A4)

    # --- Page 1 ---
    y = TOP
    c.setFont('HeiseiKakuGo-W5', 16)
    c.drawString(LEFT, y, 'Knowledge Builder Tool 試用ガイド (Alpha 0.2.0)')
    y -= 28

    y = heading(c, '■ この試用の目的', y)
    y = para(c, [
        '本ツールを実際に操作していただき、業務での使い勝手・分かりにくい操作・不自然だと',
        '感じた変換結果・Relation CandidateやKnowledge Graphの印象を記録していただくことが',
        '目的です。正式な設計判断や成果物として採用するかどうかを決めるための評価ではありません。',
        'また、「決まった正解を見つけ出す」テストでもありません。触っていて感じたことを',
        'そのまま記録してください。',
    ], y)
    y -= 6

    y = heading(c, '■ ケースA: PDF x Excel', y)
    y = para(c, [
        '文書A: 鉄道車両用空調装置 顧客要求仕様書 (PDF)',
        '文書B: 空調装置 設計レビュー表 (Excel)',
        'PDFの要求項目とExcelの設計項目を関連付けられるか、PDFの原文・ページやExcelの',
        'シート・行・セル範囲を確認できるかを試してください。',
    ], y)
    y -= 6

    y = heading(c, '■ ケースB: PDF x PDF', y)
    y = para(c, [
        '文書A: 鉄道車両用空調装置 顧客要求仕様書 (PDF、ケースAと同じファイル)',
        '文書B: 空調装置ユニット 購入仕様書 (PDF)',
        'PDF同士の見出し・段落の分割が自然に見えるか、画面やGraph上で文書A/Bを区別できるか、',
        '購入仕様と顧客要求の対応候補が理解しやすいかを試してください。',
    ], y)
    y -= 6

    y = heading(c, '■ 進め方(概要)', y)
    y = para(c, [
        '1. knowledge_builder_tool_v0.2.0-alpha.html をブラウザで開く',
        '2. 試用するケースのフォルダから、文書A・文書Bのファイルを指定する',
        '3. プレビューを確認し、取り込み(Ingest)を実行する',
        '4. Step 2 で原文・出典・タイトル・タグを確認する(タグは空の項目があります)',
        '5. Relation Candidate(関連候補)を生成し、いくつか確認・承認/却下してみる',
        '6. Knowledge Graphを表示し、フィルタを試す',
        '7. Knowledge JSONを保存する',
        '8. trial_feedback.xlsx に感想を記入する',
    ], y)

    # screenshot on page 1 if it fits, else move to page 2
    if os.path.exists(SCREENSHOT):
        img = ImageReader(SCREENSHOT)
        iw, ih = img.getSize()
        target_w = RIGHT_LIMIT - LEFT
        target_h = target_w * ih / iw
        if y - target_h < 60:
            c.showPage()
            y = TOP
            c.setFont('HeiseiKakuGo-W5', 12)
            c.drawString(LEFT, y, '■ 画面イメージ(文書A/B読み込み画面)')
            y -= 20
        else:
            y -= 10
            c.setFont('HeiseiKakuGo-W5', 12)
            c.drawString(LEFT, y, '■ 画面イメージ(文書A/B読み込み画面)')
            y -= 20
        c.drawImage(img, LEFT, y - target_h, width=target_w, height=target_h)
        y = y - target_h - 20

    # --- attention points ---
    if y < 260:
        c.showPage()
        y = TOP

    y = heading(c, '■ 特に見ていただきたい点', y)
    y = para(c, [
        '・Relation Candidateは、人が確認を始めるための「たたき台」として役立つか',
        '・PDFの分割結果、Excelの行の読み取り結果は、内容として自然に見えるか',
        '・Knowledge Graphの表示は、内容を把握する助けになるか、複雑すぎないか',
        '・操作の中で、意味が分からなかった用語や、迷った操作はなかったか',
    ], y)
    y -= 6

    y = heading(c, '■ 記録していただきたいこと', y)
    y = para(c, [
        '・完了できたかどうか、所要時間',
        '・迷った操作、理解できなかった用語',
        '・不自然だと感じた変換結果や、不要に感じた情報',
        '・途中で詰まった場合は、その状況をそのまま(無理に解決しようとせず)記録してください',
        '・良かった点・使いにくかった点は、trial_feedback.xlsx に記入してください',
    ], y)

    c.save()
    print('Generated: trial_package/trial_guide.pdf')


if __name__ == '__main__':
    main()
