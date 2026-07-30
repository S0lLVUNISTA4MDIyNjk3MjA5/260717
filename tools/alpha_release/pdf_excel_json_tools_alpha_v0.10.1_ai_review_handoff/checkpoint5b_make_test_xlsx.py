#!/usr/bin/env python3
"""Build a minimal single-sheet .xlsx test fixture for Checkpoint 5B.

Usage: checkpoint5b_make_test_xlsx.py <out_path> <cell_mode>

cell_mode controls how the D2 cell ("内容", the one column-under-test that
is also a member of the trace profile's text_columns) is represented in the
raw sheet XML, so each of the required boundary conditions can be produced
byte-exactly (SheetJS's own parsing behavior for each case is what the
Playwright test actually exercises -- this script only controls the input):

  missing   -- the <c> element for D2 is entirely absent from the row
  empty     -- an inlineStr cell with an empty string
  nulltoken -- an inlineStr cell containing the literal text "NULL"
               (matches the tool's default null-token list)
  zero      -- a numeric cell with value 0
  boolfalse -- a boolean cell (t="b") with value 0 (i.e. Excel FALSE)
  normal    -- an inlineStr cell with an ordinary non-empty string
"""
import sys
import zipfile

CELL_XML = {
    'missing': '',
    'empty': '<c r="D2" t="inlineStr"><is><t></t></is></c>',
    'nulltoken': '<c r="D2" t="inlineStr"><is><t>NULL</t></is></c>',
    'zero': '<c r="D2" t="n"><v>0</v></c>',
    'boolfalse': '<c r="D2" t="b"><v>0</v></c>',
    'normal': '<c r="D2" t="inlineStr"><is><t>通常の内容です</t></is></c>',
}

CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>'''

RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''

WORKBOOK_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>'''

WORKBOOK = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="検証項目" sheetId="1" r:id="rId1"/></sheets>
</workbook>'''


def build(cell_mode):
    d2 = CELL_XML[cell_mode]
    sheet = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E2"/><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>No</t></is></c><c r="B1" t="inlineStr"><is><t>分類</t></is></c><c r="C1" t="inlineStr"><is><t>項目</t></is></c><c r="D1" t="inlineStr"><is><t>内容</t></is></c><c r="E1" t="inlineStr"><is><t>備考</t></is></c></row>
<row r="2"><c r="A2" t="n"><v>1</v></c><c r="B2" t="inlineStr"><is><t>設備</t></is></c><c r="C2" t="inlineStr"><is><t>境界値テスト行</t></is></c>{d2}<c r="E2" t="inlineStr"><is><t>備考テキスト</t></is></c></row>
</sheetData></worksheet>'''
    return sheet


def main():
    out_path, cell_mode = sys.argv[1], sys.argv[2]
    if cell_mode not in CELL_XML:
        raise SystemExit(f'unknown cell_mode: {cell_mode}')
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', CONTENT_TYPES)
        z.writestr('_rels/.rels', RELS)
        z.writestr('xl/workbook.xml', WORKBOOK)
        z.writestr('xl/_rels/workbook.xml.rels', WORKBOOK_RELS)
        z.writestr('xl/worksheets/sheet1.xml', build(cell_mode))


if __name__ == '__main__':
    main()
