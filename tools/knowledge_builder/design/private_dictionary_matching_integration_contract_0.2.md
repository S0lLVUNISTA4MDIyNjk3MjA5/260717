Private Dictionary Matching Integration Contract 0.2 — Controlled Delimiter Fallback
=====================================================================================

状態: Human承認済み仕様（2026-10-06のHuman指示本文が根拠）。通常のdictionary matching correctness機能である。

## S0. 0.1との関係（継承と変更点）

- 本書は `private_dictionary_matching_integration_contract_0.1.md`（以下「0.1」）を**基礎として継承**する。
  本書が明示的に上書きしない0.1の規定（S1〜S32、S30.17 Addendumを含む）は、すべて0.2でも**そのまま有効**である。
- **0.1は変更しない。** 0.1はdelimiter splitを行わない既存contract（whole-value only）として、
  historical / baseline contractのまま保存する。0.1のS13.1（項目1〜3の「delimiter split禁止」）、S4.2、S23等の
  記述は書き換えない。
- 版の関係:
  - 0.1 = whole-value only
  - 0.2 = **whole-value first, UNKNOWN_TERM fallback split**（controlled delimiter fallback）
- 0.2が上書きするのは、0.1 S13.1のうち「scalar値の内部でdelimiter分割を行わない」（項目1・項目3の
  delimiter split禁止）の一点だけである。その上書きは本書S1〜S9が定める**条件付きfallbackに限る**。
  0.1が禁止する他の事項（substring一致、prefix/suffix、fuzzy、edit distance、stemming、AI推定、
  semantic similarity、synonymMap、regex検索）は0.2でも**禁止のまま**である。
- **Resolver core（S4.2、`private_dictionary_resolver_core.js`）は変更しない。** Resolverは引き続き
  「1つのresolution単位として切り出された文字列（term）」のexact whole-term解決のみを行い、
  field名もtokenizationも知らない。0.2のsplitはmatching tool側のterm切り出し（TraceRecord→terms変換、
  0.1 S13.1の責務領域）で行い、Resolverへは通常のtermとして渡す。`KnowledgeIdHashUtils.normalize()`
  も変更しない。

## S1. 基本原則: Whole-value first, UNKNOWN_TERM fallback split

最初からtokenizeしてはならない。field値（既存のsupported valueの1単位）ごとの処理順序は次のとおり:

1. 既存どおり、whole-valueを（0.1と同じ規則で抽出し）Resolverへ渡す。
2. whole-valueのresolution結果を確認する。
3. whole-valueが解決できた（`EXACT_CANONICAL` / `APPROVED_ALIAS`）場合: その結果をそのまま採用する（splitしない）。
4. whole-valueが`DICTIONARY_CONFLICT`の場合: その結果をそのまま採用する（splitしない）。
   Conflictはdictionary側の意味上の問題として保持し、delimiter fallbackで回避しない。
5. whole-valueが`UNKNOWN_TERM`の場合**のみ**、delimiter fallbackを検討する。
6. S3のdelimiterを含み、S5の条件（non-empty token 2件以上）を満たす場合のみsplitする。
7. 各tokenを既存Resolverで個別に解決する。
8. S6の採用条件を満たした場合のみ、whole-valueのannotationをtoken resultsへ置き換える。
9. 採用条件を満たさない場合は、元のwhole-value `UNKNOWN_TERM`を保持する。

例: `I/O`がdictionary上のterm（canonical/alias）としてwhole-valueで解決できるなら、`I`・`O`へ分割しない。

## S2. 対象とするvalue

- 対象は0.1 S13.1がsupportedとする値に限る（scalar、およびarrayの各要素）。object値は引き続き対象外。
- **scalar**: delimiter fallbackの対象。
- **array**: 0.1どおり要素ごとに独立したvalueとして扱い、**各要素に対して**S1（whole-value first →
  UNKNOWN fallback split）を適用する。1要素のfallbackは他の要素に影響しない。
- **長さ制約**: 既存のvalue制約を弱めない。現在supported valueとして扱われるwhole-value（空白のみでなく、
  Resolverのterm長制約1〜256文字を満たすもの）だけがfallback対象である。256文字超としてskipされるvalueを、
  「splitすれば短くなる」ことを理由に新たな処理対象へ昇格させてはならない。各tokenもResolverの既存term制約を
  満たす必要がある（whole-valueが制約内であり、tokenはその部分文字列であるため、trim後のnon-empty tokenは満たす）。

## S3. 許可delimiter（この集合のみ）

| 区分 | 文字 |
|---|---|
| ASCII | `/` `,` `;` |
| 全角 / 日本語 | `／` `、` `，` `；` |

上記7文字**だけ**をdelimiterとする。次はdelimiterとして扱わない:
空白のみでのsplit、tab、hyphen、underscore、colon、中黒`・`、括弧類、その他の任意の句読点、
NLP tokenization。**改行も0.2ではdelimiterに含めない。**

**escape syntaxは定義しない。** `\/`・quoted string・escaped comma等の特別処理は導入しない。
ただしS1がwhole-value firstであるため、delimiterを含む正式termがdictionaryに存在する場合は
whole-value resolutionが優先される。

## S4. Split前のnormalization / trim

- split前に、NFKC等の新しいpre-split normalizationを追加しない。処理は
  `Raw supported value → whole-value Resolver → UNKNOWN_TERMの場合のみliteral delimiter split → trim →
  tokenごとに既存Resolver` とする。全角delimiterは、S3の集合に明示的に含めることで扱う。
- split後の各tokenには、言語/runtime標準のleading/trailing whitespace trim（`String.prototype.trim`）を適用する。
  **内部whitespaceは保持する。** 例: `"motor / pump"` → `"motor"`, `"pump"`。
  `"high pressure pump"`は内部のspaceでsplitしない。

## S5. Empty token と split成立条件

- `motor//pump`・`/motor`・`pump/`等で生じるempty token（trim後に空）は**skip**する。empty tokenをResolverへ渡さない。
- skip後に残るnon-empty tokenが**2件未満**の場合、tokenizationを成立させず、元のwhole-value `UNKNOWN_TERM`を保持する。
  例: `motor/` → non-empty tokenは`motor`のみ → fallback不成立 → 元の`motor/` UNKNOWN_TERMを保持。

## S6. Tokenization採用条件

whole-valueが`UNKNOWN_TERM`でsplitを行った場合でも、常にtoken resultsへ置き換えてはならない。
**splitしたtokenのうち、少なくとも1件が`UNKNOWN_TERM`以外**（`EXACT_CANONICAL` / `APPROVED_ALIAS` /
`DICTIONARY_CONFLICT`）になった場合だけ、tokenized resolutionを採用する。

| 例 | token結果 | 判定 |
|---|---|---|
| `motor / pump` | motor=RESOLVED, pump=RESOLVED | token results採用 |
| `motor / unknown-x` | motor=RESOLVED, unknown-x=UNKNOWN_TERM | token results採用。UNKNOWN_TERM queueへは`unknown-x`のみ |
| `foo / bar` | foo=UNKNOWN, bar=UNKNOWN | **採用しない。** 元の`foo / bar`をwhole-value UNKNOWN_TERM 1件として保持 |
| token A=DICTIONARY_CONFLICT, token B=UNKNOWN_TERM | — | 採用して構わない。Conflictは既存Resolver semanticsのまま保持し、自動選択しない |

採用された場合、そのwhole-valueについては元のwhole-value annotationを**token annotationsで置き換える**
（whole-valueのUNKNOWN_TERM annotationは残さない）。

## S7. Duplicate / Ordering

- **dedupしない。** 0.1 S4.2と同じく、duplicate termも入力順のまま1件ずつ独立したoccurrenceとして保持する。
  例: `motor / motor` → motor occurrence 1、motor occurrence 2（provenance上も2件）。
  Resolver自身の既存dedup semanticsは変更しない（Resolverはdedupしない）。
- token順序はsource value内の出現順とする。複数fieldの場合は既存の`tagSourceFields()` / extraction orderingを維持する。
  **sortを追加しない。** tokenはその元のwhole-valueの位置に置き換わり、前後の項目の順序は変わらない。

## S8. Provenance

- **`source_field`**: Source Field Attribution（S30.17）の`annotation_source_fields[]`をそのまま利用する。
  同一field（同一whole-value）から生成されたtokenは、すべてそのfieldを`source_field`として保持する。
  新しいfield attribution方式は追加しない。
- **`original_term`**: tokenized resolutionが採用された場合、各Resolver annotationの`original_term`は
  **Resolverへ実際に渡されたsplit token**である（Resolverの`annotation.original_term === 入力term`の
  既存contractと整合）。whole source valueを`original_term`へ残してはならない。whole source value自体は
  既存のsource row / source fieldから追跡可能である。tokenizationが採用されなかった場合は、従来どおり
  whole-valueが`original_term`である。
- annotation schema（Resolverの8 field）、row sidecarの形、projection、Excel列は変更しない。
  新しい恒久的なexternal schema（token index / character offset / span等）は導入しない。
  tokenization結果は内部的な一時構造としてのみ扱う。

## S9. UNKNOWN_TERM Review Queue

前slice（0.1 S30.17.2）のReview Queueをそのまま使用する。専用のtokenizerは作らない（tokenization logicは1つ）。
- tokenized resultが採用された場合: `UNKNOWN_TERM`のtokenのみがqueueへ流れる（`source_field`は元fieldを保持）。
- 全tokenが`UNKNOWN_TERM`でtokenization不採用の場合: 元のwhole-valueが1件のUNKNOWN_TERMとしてqueueへ出る。
- queueの永続化形式は引き続き未確定（PERSISTENCE CONTRACT NOT SUFFICIENTLY FIXED）であり、本書は定義しない。

## S10. Matching impact boundary

- tokenizationによりdictionary resolution結果が変われば、`_tagInfo.approvedDict`を経由して
  既存のtag matching結果（pair等）が変化し得る。これは**0.2の意図された機能変更**として認める。
  tokenization対象fixtureについて「pairが絶対に変化しない」ことは要求しない。
- 許容される変化は、**dictionaryから供給される既存tag inputが、0.2のresolutionによって増えること**に起因する
  結果変化だけである。
- 次は変更しない（変更禁止）: scoring formula、ranking algorithm、ACCEPT/REJECT algorithm、semantic matching
  algorithm、canonical matching algorithm、tag matching algorithm自体、Resolver semantics（canonical/alias
  precedence、conflict判定、UNKNOWN_TERM判定条件）、review state。
- tokenization対象でない入力（delimiterを含まない値、whole-valueが解決された値等）は、0.1と同一の結果となる。

## S11. Scope外（0.2でも対象外）

nested object handling、`table_row`、`source_record`、STANDARD/DOMAIN/SESSION layer integration、
dictionary auto-feedback、auto-learning、queue persistence format、辞書への自動登録・承認。

## S12. 0.1の規定のうち0.2で歴史的状態となるもの

0.1 S13.1項目1・3の「delimiter split禁止」およびS23「R4で解決した項目」の対応記述は、0.1 baselineの状態を
表すものとして保存される。0.2以降の実装では本書S1〜S10が優先する。0.1の挙動（whole-valueのみ）を固定する
既存の検証（例: Checkpoint 7検証のcomma-delimited whole valueがsplitされないことを確認する項目）は、
0.1 baselineの証跡であり、0.2実装後はこの変更に対応する後継検証で置き換えられる。
