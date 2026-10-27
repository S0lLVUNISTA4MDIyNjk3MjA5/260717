# Reviewer RA-QB04

L3-2 Thread A の live-browser activation / Explainability 用 Reviewer-owned fixture です。

確認対象:
- browserでcanonical role/bridge modulesが実際にロードされること
- unique canonical propertyがlive Quantity property resolutionに反映されること
- whitespace-only propertyはcanonicalとして使用しないこと
- ambiguous propertyはfirst-adoptせずlegacy fallbackすること
- 日本語業務列名「設計項目」は現行の保守的registryでは自動property分類されないため、安全なlegacy fallbackとして扱うこと
- bridge unavailableでもQuantity semanticsを壊さないこと
- Human向けにcanonical/legacyのどちらを使ったかとfallback理由が確認できること

QB04-04を通すために日本語列名heuristicを追加してはいけません。
