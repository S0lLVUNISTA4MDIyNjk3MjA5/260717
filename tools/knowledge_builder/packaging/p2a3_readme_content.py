#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P2-A3 packaged distribution - README content, single source for .md and .html.

The content lives once, as plain Python data (a list of (heading, blocks) tuples), and
render_markdown() / render_html() below both derive from that same list. This is the
"generated from the same content source" requirement without needing a Markdown parser
or any third-party dependency: there is no conversion step to keep in sync, because
there is only one source structure and two renderers for it.

A block is either a plain string (rendered as a paragraph) or a list of strings
(rendered as a bullet list).
"""

TITLE = "P2-A3 非公開辞書候補レビューUI - 利用ガイド"

SECTIONS = [
    ("1. このツールは何をするものか", [
        "このツールは、PDF/Excel形式の入力文書から抽出した用語・数量候補を、人間が画面上で確認し "
        "ACCEPT / REJECT / UNCERTAIN のいずれかを判定するための、非公開のローカル候補レビューツールです。",
        "判定結果は「候補レビュー」の記録であり、正式な辞書への登録・適用ではありません。このツール自身は "
        "辞書の PROJECT / DOMAIN スコープや ACTIVE 状態を一切変更しません。",
    ]),
    ("2. 「非公開（LOCAL PRIVATE）」の意味", [
        "このツールが処理する入力文書の内容・抽出結果・候補・判定内容は、すべてこのPCのブラウザメモリ上でのみ "
        "扱われます。起動している間、外部のサーバーやクラウドサービスへ内容が送信されることはありません。",
        "「非公開」はこのツール自身の設計上の制約であり、PC自体のセキュリティ（マルウェア対策・ディスク暗号化・"
        "アクセス権限など）を代替するものではありません。取り扱う文書の機密性に応じて、通常のPC管理と同様の注意"
        "を継続してください。",
    ]),
    ("3. 外部AI・クラウドサービスは一切使用しません", [
        "抽出・候補生成・判定支援のいずれの処理も、このPC上のブラウザ内でのみ実行されます。外部の生成AI API、"
        "クラウド解析サービス、テレメトリ、使用状況の外部送信は組み込まれていません。",
        "ツールが開くのは起動時にこのPC自身（127.0.0.1）へ接続するブラウザタブのみで、それ以外の通信先へ"
        "接続することはありません。",
    ]),
    ("4. 対応している入力形式", [
        ["PDF（.pdf） - テキストを含む仕様書・要件文書",
         "Excel（.xlsx） - 表形式の設計レビュー・数量一覧"],
        "画像のみのスキャンPDF（テキスト層を持たないもの）は、テキストを抽出できないため、候補が得られないか"
        "極端に少なくなります。事前にOCR等でテキスト層を持つPDFに変換したものを用意してください。",
    ]),
    ("5. Windowsでの起動方法", [
        ["配布された ZIP ファイルを、右クリック →「すべて展開...」で任意のフォルダーへ展開します。"
         "ZIPファイルをダブルクリックして中身をそのまま実行しないでください。",
         "展開してできたフォルダーを開き、start_review_ui.cmd をダブルクリックします。",
         "コマンドプロンプトの黒い画面が開き、続けて既定のブラウザが自動的に開きます。ブラウザが開かない"
         "場合は、黒い画面に表示されている http://127.0.0.1:～ のアドレスを手動でブラウザに貼り付けてください。"],
        "この start_review_ui.cmd は、このフォルダー以外の場所には何も書き込みません。インストーラーでは"
        "ないため、レジストリ変更やスタートメニューへの登録も行いません。",
    ]),
    ("6. 抽出に必要な条件", [
        "候補抽出は、入力文書に含まれるテキスト（PDFのテキスト層、またはExcelのセル値）から行われます。"
        "画像として埋め込まれた文字や、手書き文字はテキストとして認識されません。",
        ["PDFはテキスト層を持つものを使用してください。",
         "このツール自身にはOCR機能はありません。画像のみのスキャンPDF等、テキスト層を持たないPDFから"
         "文字を読み取ることはできません。",
         "暗号化・パスワード保護されたPDFは処理できません。事前にパスワードを解除したファイルを"
         "用意してください。"],
        "画像のみのスキャンPDF（テキスト層を持たないもの）を扱う必要がある場合は、事前にOCR等でテキスト層を"
        "付与したPDFに変換したものを用意してください。",
        "極端に用語密度が低い文書や、表構造が崩れているExcelでは、候補が生成されない、または少なくなる"
        "ことがあります。これはツールの不具合ではなく、入力側のテキスト情報量に依存する制約です。",
    ]),
    ("7. PDF / Excel の選択", [
        "画面上部の入力選択で、レビュー対象とする PDF または Excel ファイルを選びます。付属の samples "
        "フォルダーには、動作確認用のサンプル入力（train_hvac_requirement_spec_sample.pdf / "
        "train_hvac_design_review_sample.xlsx）が同梱されています。",
        "選択できる合計サイズ・ファイル数・単一ファイルサイズには上限があります（17章参照）。上限を超える"
        "選択は、ファイルの中身を読み込む前の時点で拒否されます。",
    ]),
    ("8. 解析（抽出）の実行", [
        "入力を選択すると、ブラウザ内で抽出処理が実行されます。処理中は画面に進捗が表示されます。処理は"
        "すべてこのタブの中で完結し、ファイルの内容がこのPC外へ出ることはありません。",
    ]),
    ("9. 候補・別名（alias）・競合の確認", [
        "抽出結果は「候補」「別名候補」「競合」の3つの区分で一覧表示されます。各行には根拠となる入力文書上の"
        "位置（エビデンス）が付随します。",
        "各行を ACCEPT / REJECT / UNCERTAIN のいずれかに判定できます。判定は候補レビューの記録であり、"
        "辞書への反映は行われません。",
        "canonical（代表語）を ACCEPT しても、その alias（別名）が自動的に ACCEPT されることはありません。"
        "alias は個別に判定してください。",
    ]),
    ("10. エビデンス（根拠）表示", [
        "各候補・別名・競合の行から、抽出元となった入力文書上の該当箇所（ページ・セル等）を確認できます。"
        "判定に迷う場合は、必ずエビデンスを確認してから判定してください。",
    ]),
    ("11. 非公開Excel（private Workbook）への保存", [
        "画面の保存操作から、現在の判定状態を含む非公開の Excel ファイル "
        "（private_dictionary_candidate_review.xlsx）としてこのPCへダウンロードできます。",
        "このファイルには候補・別名・競合の内容や判定理由など、詳細な情報がすべて含まれます。このファイルは"
        "そのまま社外・第三者と共有しないでください（14章参照）。",
    ]),
    ("12. 再開（resume）", [
        "保存した非公開Excel（private_dictionary_candidate_review.xlsx）を、画面の読み込み操作から選択する"
        "ことで、レビューの続きを再開できます。",
        "再開時には、読み込んだファイルの内容が現在の抽出結果と矛盾しないか検証されます。矛盾がある場合"
        "（元の入力文書が変わっている場合など）は、再開せずにエラーとして扱われます。",
    ]),
    ("13. 共有可能Excel（shareable Workbook）への保存", [
        "画面の保存操作から、判定件数などの集計値のみを含む共有可能な Excel ファイル "
        "（shareable_review_summary.xlsx）を書き出せます。個々の候補語・別名語・競合内容・エビデンスの"
        "内容は含まれません。",
        "共有可能Excelを書き出す際は、保存前に内容のプレビューが表示されます。内容を必ず確認したうえで、"
        "共有してよいと判断できる場合にのみ保存・共有してください。共有可能Excelという名前は「自動的に"
        "安全である」ことを意味するものではなく、共有前の人間による確認は常に必要です。",
    ]),
    ("14. 非公開Excelと共有可能Excelの違い", [
        "private_dictionary_candidate_review.xlsx（非公開）は、候補・別名・競合の詳細内容とエビデンスを"
        "すべて含みます。レビューを再開するために必要な情報が入っているため、社外・第三者へは共有しない"
        "でください。",
        "shareable_review_summary.xlsx（共有可能）は、件数などの集計値のみを含む、内容を含まないファイル"
        "です。どの語が候補になったか、どの候補が競合したか、といった具体的な内容は含まれません。",
        "この2つのファイルは用途が異なります。レビューの再開には非公開Excelが必要で、共有可能Excelでは"
        "再開できません。",
    ]),
    ("15. SESSION / PROBATION（辞書境界の説明）", [
        "このツールが生成する候補・別名は、常に scope=SESSION・status=PROBATION として扱われます。これは"
        "「このレビューセッション内の、まだ正式採用されていない候補」であることを示す固定値です。",
        "このツールの ACCEPT 判定は、候補レビューの記録を残すだけであり、辞書の PROJECT / DOMAIN スコープ"
        "への昇格や、ACTIVE状態への変更、正式な辞書登録を一切行いません。辞書への正式な反映は、このツール"
        "の範囲外の、別工程・別ツールでの人間の判断を経て行われるものです。",
    ]),
    ("16. 終了方法", [
        "起動時に開いたコマンドプロンプトの黒い画面を閉じるか、その画面上で Ctrl+C を押すことで、ローカル"
        "サーバーを終了できます。ブラウザのタブを閉じるだけではサーバープロセスは終了しません。",
    ]),
    ("17. 入力の上限", [
        ["単一ファイルの上限：約 1 MB",
         "選択ファイル合計の上限：約 2 MB",
         "同時に選択できるファイル数の上限：20 ファイル"],
        "この上限は、ブラウザ内での安定動作が実測で確認された範囲に基づく事前の安全側の値です。上限を超える"
        "選択は、ファイルの中身を読み込む前の時点で拒否され、どのファイルが原因かではなく件数のみが表示"
        "されます。",
    ]),
    ("18. レビューWorkbookの上限", [
        "非公開Excel（private_dictionary_candidate_review.xlsx）を読み込んで再開する際のファイルサイズ"
        "上限は約 60 MB です。",
        "この60MBという値は、実測で確認された「安定して動作する上限」を示す性能保証ではありません。あくまで"
        "ファイルを読み込む前に拒否するための安全側の上限値であり、実際に不安定になる境界は未測定です。"
        "また、この上限はChromiumベースのブラウザ（Google Chrome / Microsoft Edge）での測定に基づくもので、"
        "Windows実機でのEdge/Chromeおよび macOS の Safari では、まだ個別の実機検証を行っていません。",
    ]),
    ("19. うまく動かないときは", [
        ["ブラウザが自動的に開かない：黒い画面に表示されているアドレス（http://127.0.0.1:～）を手動で"
         "ブラウザに貼り付けてください。",
         "start_review_ui.cmd を実行してもすぐ画面が閉じる：エラーメッセージが表示されている場合は、その"
         "内容を控えてください。多くの場合、対応していないCPUアーキテクチャ（32bit版Windows等）や、"
         "同梱ランタイムの破損（ZIPを正しく展開せずに実行した等）が原因です。",
         "「対応していないアーキテクチャ」と表示される：このツールは64bit版Windows（x64 / ARM64）のみに"
         "対応しています。32bit版Windowsでは動作しません。",
         "候補が全く出てこない：入力文書にテキスト情報がない（画像のみのスキャンPDF等）可能性があります。"
         "6章を参照してください。",
         "再開時にエラーになる：読み込んだ非公開Excelが、現在選択している入力文書と対応していない可能性が"
         "あります。同じ入力文書の組み合わせで保存したファイルを使用してください。"],
    ]),
    ("20. このバージョンで未対応の機能", [
        ["詳細な監査用途のJSON/Markdownエクスポート（candidate_evaluation.json / candidate_review.md / "
         "review_session.json）は、このリリース候補には含まれません。通常運用は本ガイドで説明した非公開"
         "Excel保存・再開と共有可能Excel保存で完結します。",
         "辞書への正式登録・PROJECT/DOMAINスコープの変更・ACTIVE状態への昇格・ロールバックは、このツールの"
         "範囲外です。",
         "外部AI・クラウド連携は組み込まれておらず、今後もこのツール単体には追加されません。"],
    ]),
    ("21. ライセンス", [
        "このツールは Node.js ランタイムおよび複数のオープンソースライブラリ（SheetJS、PDF.js）を同梱して"
        "配布しています。各ソフトウェアのライセンス全文は、このパッケージ内の licenses フォルダーに収録"
        "されています。",
        "本パッケージは社内配布の Internal release candidate であり、一般公開版（GitHub Release等）では"
        "ありません。",
    ]),
]


def render_markdown():
    lines = [f"# {TITLE}", ""]
    for heading, blocks in SECTIONS:
        lines.append(f"## {heading}")
        lines.append("")
        for block in blocks:
            if isinstance(block, list):
                for item in block:
                    lines.append(f"- {item}")
                lines.append("")
            else:
                lines.append(block)
                lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _escape(text):
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


_HTML_HEAD = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  body {{ font-family: "Yu Gothic", "Meiryo", sans-serif; max-width: 880px; margin: 2em auto;
         padding: 0 1.5em; line-height: 1.8; color: #1a1a1a; background: #ffffff; }}
  h1 {{ font-size: 1.6em; border-bottom: 3px solid #333; padding-bottom: 0.3em; }}
  h2 {{ font-size: 1.2em; margin-top: 2em; border-left: 6px solid #555; padding-left: 0.5em; }}
  p {{ margin: 0.6em 0; }}
  ul {{ margin: 0.4em 0; padding-left: 1.6em; }}
  li {{ margin: 0.3em 0; }}
</style>
</head>
<body>
<h1>{title}</h1>
"""

_HTML_FOOT = """</body>
</html>
"""


def render_html():
    parts = [_HTML_HEAD.format(title=_escape(TITLE))]
    for heading, blocks in SECTIONS:
        parts.append(f"<h2>{_escape(heading)}</h2>")
        for block in blocks:
            if isinstance(block, list):
                parts.append("<ul>")
                for item in block:
                    parts.append(f"<li>{_escape(item)}</li>")
                parts.append("</ul>")
            else:
                parts.append(f"<p>{_escape(block)}</p>")
    parts.append(_HTML_FOOT)
    return "\n".join(parts)


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "html":
        sys.stdout.write(render_html())
    else:
        sys.stdout.write(render_markdown())
