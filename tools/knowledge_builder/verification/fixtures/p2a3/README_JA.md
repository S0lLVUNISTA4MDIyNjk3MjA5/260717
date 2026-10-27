# P2-A3 verification fixtures

**検証専用**のfixtureです。サンプルデータ（`samples/p2a3/`）とは目的が異なるため分離しています。

## encrypted_sample.pdf

暗号化PDFがUIで安全に分類されることを確認するためのfixture。完全synthetic（実在企業・製品・案件・
人名を含まない）。

- 固定パスワード: `p2a3-synthetic-fixture`
  （保護目的ではなく、暗号化状態を再現するためのものなのでここに記載しています）
- 生成: `python3 generate_encrypted_sample.py [出力パス]`（reportlab の `StandardEncryption`）
- **deterministic ではありません。** reportlab は暗号化時にランダムな file key を埋め込むため、
  再生成すると別のbytesになります。そのため生成物をcommitし、SHA-256を `MANIFEST.sha256` に固定しています。
- 期待挙動: production browser pipeline で `PDF_ENCRYPTED` に分類され、候補は一切表示されず、
  既存 session / Evidence Index / Review State は不変。file名・password・native Error・stack・path は非表示。

## 検証

```bash
sha256sum -c MANIFEST.sha256
node ../../private_dictionary_candidate_review_ui_verification.js
```
