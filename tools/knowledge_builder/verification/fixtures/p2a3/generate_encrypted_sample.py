#!/usr/bin/env python3
"""Generates a fully synthetic ENCRYPTED PDF fixture for P2-A3 verification.

No real company, product, project or person appears. The password is fixed and published here
on purpose: the fixture exists to prove the UI classifies an encrypted PDF safely, not to protect
anything.

Determinism: reportlab's encryption embeds a randomly generated file key, so the output is NOT
byte-deterministic. The SHA-256 of the committed fixture is recorded in MANIFEST.sha256 and the
fixture is committed rather than regenerated per run.
"""
import os, sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib import pdfencrypt
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

PASSWORD = 'p2a3-synthetic-fixture'
pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'encrypted_sample.pdf')
enc = pdfencrypt.StandardEncryption(PASSWORD, canPrint=0, canModify=0, canCopy=0, canAnnotate=0)
c = canvas.Canvas(out, pagesize=A4, encrypt=enc, invariant=1)
c.setTitle('Encrypted synthetic fixture')
c.setFont('HeiseiKakuGo-W5', 12)
c.drawString(72, 780, '第1章 暗号化サンプル')
c.drawString(72, 750, '架空機器（以下「ANY」という）は暗号化PDF検証用の架空語である。')
c.save()
print('wrote', out)
