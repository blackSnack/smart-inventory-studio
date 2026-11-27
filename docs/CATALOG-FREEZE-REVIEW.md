# STD-01 private pre-freeze proposal review (#6)

After the existing core build, prepare a private JSON file bound to the exact catalog bytes in catalog/SHA256SUMS. Use the existing anonymous coverage aggregate (CATALOG-COVERAGE.md), with explicit category mappings and operator-confirmed visibility. For every category and field pair in the proposed catalog (including unused catalog categories), record independently inspected supplier or manufacturer evidence and exact semantic review. Example fragment (synthetic placeholders only; not a valid complete proposal):

```json
{"catalogVersion":"0.4.0-draft","catalogSha256":"<actual hash>","visibilityConfirmed":true,"coverage":{"catalogVersion":"0.4.0-draft","catalogSha256":"<actual hash>","categories":[{"categoryRef":"cat-1","partCount":2,"catalogKey":"resistor.smd"}]},"fieldReviews":[{"categoryKey":"resistor.smd","fieldKey":"rated_voltage","reviewed":true,"type":"number","unit":"V","nullable":true,"semantics":"rating","sourceLabel":"Voltage Rating","rawEvidence":"<actual source observation>","sourceUrl":"https://example.test/source","locator":"<exact location>","observedDate":"2026-01-01","conditions":""}],"exclusions":[]}
```

Record known applicable conditions in conditions; a conditioned field requires nonempty conditions and string representation. A measured observation must never be treated as a catalog rating or nominal definition. Field definitions with existing semantic annotations must match. Review actual source, alias and unit meaning, unknown handling and applicability before setting reviewed=true. The tool cannot inspect the source or verify the operator claim. For an explicitly reviewed unmapped category use an exclusion record with categoryRef, reviewed:true and a nonempty reason; unknown/typo catalog keys must be corrected, not excluded. Exclusions remain unmapped and are not approvals to omit them in production.

```sh
node tools/check-catalog-freeze.mjs <private-review.json>
```

Exit 0 = proposal-ready structural evidence; 2 = incomplete, 1 = invalid/stale review. Reports contain field/category keys and counts, not raw evidence or private IDs. No network request or catalog modification is made. A ready proposal is not catalog v1.0 freeze or production authorization; independently confirm actual inventory completeness, source and semantic evidence, exclusions and exact hash under G2. Keep the input and report private. The existing catalog remains a draft.
