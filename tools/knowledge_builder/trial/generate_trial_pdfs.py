#!/usr/bin/env python3
# Generates the 2 PDF documents used by the Alpha 0.2.0 Checkpoint 5 limited human trial
# package (train HVAC unit development scenario - realistic content, NOT the Checkpoint 4
# machine-evaluation matrix fixtures). See tools/knowledge_builder/trial/reference/
# expected_observations.md for which items are meant to correspond across documents.
# Run: python3 tools/knowledge_builder/trial/generate_trial_pdfs.py
import os

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# ---- 文書A: 鉄道車両用空調装置 顧客要求仕様書(2章、12項目) ----
CUSTOMER_REQUIREMENTS = [
    ('第2章 環境性能要求', None),
    ('2.1 車室温度', '冷房時の車室内温度は、外気温35℃の条件において27℃以下とすること。'),
    ('2.2 冷房能力', '定格冷房能力は6.5kW以上を確保すること。'),
    ('2.3 暖房能力', '外気温-10℃の条件においても、車室内温度を18℃以上に維持できる暖房能力を有すること。'),
    ('2.4 騒音', '定格運転時における車室内騒音値は65dB(A)以下とすること。'),
    ('2.5 電源条件', '電源はDC100Vとし、電圧変動プラスマイナス20%の範囲で正常に動作すること。'),
    ('2.6 振動', '走行時に発生する振動(5Hzから150Hz、最大2G)に対して機能及び性能を維持すること。'),
    ('2.7 除湿性能', '高湿度環境(相対湿度85%)においても、車室内相対湿度を60%以下に制御できることが望ましい。'),
    ('第3章 保守・安全要求', None),
    ('3.1 保守性', 'フィルタの交換は工具を使用せず、10分以内に実施できる構造とすること。'),
    ('3.2 安全性', '内部部品への接触を防止する保護構造を有し、感電及び火傷のおそれがないこと。'),
    ('3.3 質量', '本体質量は250kg以下とすること。'),
    ('3.4 耐久性', '設計寿命は15年、走行距離換算で600万kmとすること。'),
    ('3.5 電磁両立性', '車両制御機器への電磁干渉を防止するため、関連するEMC規格に準拠すること。'),
]

# ---- 文書B(ケースB): 鉄道車両用空調装置 購入仕様書(3章、13項目) ----
PURCHASE_SPECIFICATION = [
    ('第1章 総則', None),
    ('1.1 適用範囲', '本仕様書は、鉄道車両用空調装置(以下「本装置」という)の購入仕様について定める。'),
    ('1.2 参照規格', '本装置の設計及び製造にあたっては、関連する鉄道車両用機器規格に準拠すること。'),
    ('第2章 性能仕様', None),
    ('2.1 温度性能', '冷房定格能力6.8kW以上とし、外気温35℃時に車室内温度27℃以下を達成できること。'),
    ('2.2 暖房性能', '外気温-10℃の条件下で、車室内温度18℃以上を確保する暖房性能を有すること。'),
    ('2.3 騒音性能', '定格運転時の騒音値は64dB(A)以下とし、静粛性に配慮した設計とすること。'),
    ('2.4 除湿性能', '高湿度環境における車室内相対湿度の制御方法については、別途協議のうえ決定する。'),
    ('第3章 電気・構造・保守仕様', None),
    ('3.1 電源仕様', '入力電源はDC100Vとし、許容電圧変動範囲は定格のプラスマイナス20%とすること。'),
    ('3.2 外形・質量', '本体質量は255kg以下とし、外形寸法は別紙図面によるものとする。'),
    ('3.3 耐振動構造', '鉄道車両特有の振動環境(5Hzから150Hz)に対し、共振を避ける構造設計とすること。'),
    ('3.4 保守性', 'フィルタは工具を使用せずに交換可能な構造とし、交換時間は10分以内を目安とする。'),
    ('3.5 検査項目', '納入前検査として、性能試験、絶縁抵抗試験及び耐電圧試験を実施すること。'),
    ('3.6 保証期間', '本装置の保証期間は、納入後2年間とする。'),
    ('3.7 電磁両立性', '車両制御機器へ影響を与えないよう電磁ノイズ対策を実施すること。詳細は別途協議する。'),
]


def build(path, items):
    c = canvas.Canvas(path, pagesize=A4)
    y = 780
    page_top = 780
    bottom_margin = 60
    for heading, body in items:
        needed = 34 if body else 24
        if y < bottom_margin + needed:
            c.showPage()
            y = page_top
        c.setFont('HeiseiKakuGo-W5', 12 if body is None else 10)
        c.drawString(72, y, heading)
        y -= 24
        if body:
            c.setFont('HeiseiKakuGo-W5', 10)
            c.drawString(72, y, body)
            y -= 34
        else:
            y -= 10  # 章見出しの直後は詰め気味にする(通常文書らしい体裁)
    c.save()


def main():
    build(os.path.join(OUT_DIR, 'train_hvac_customer_requirements.pdf'), CUSTOMER_REQUIREMENTS)
    build(os.path.join(OUT_DIR, 'train_hvac_unit_purchase_specification.pdf'), PURCHASE_SPECIFICATION)
    print('Generated: train_hvac_customer_requirements.pdf, train_hvac_unit_purchase_specification.pdf')


if __name__ == '__main__':
    main()
