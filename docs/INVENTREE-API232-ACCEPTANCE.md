# API 232 actual-instance acceptance (#157)

Primary target: InvenTree 0.16.7 / API 232. Use only a maintainer-provisioned disposable instance with an explicit loopback IP and port, an authorized test token and dedicated records. Never use a production tunnel. Do not install, upgrade, scan or reconfigure the host as part of this test. Keep credentials, actual schema, journals and private evidence outside Git.

## Preflight

Confirm version and authenticated actor, exact deployed schema, actual permissions/visibility, exclusive access, backup/restore and physical/reference constraints. Run the offline schema audit against the locally exported JSON: `node scripts/audit-inventree-api232.mjs <private-schema.json>`. Review declaration gaps with the tagged implementation and actual responses; do not treat GET/OPTIONS as permission to write. Run core checks with the repository's existing build environment.

Use [browser isolated acceptance](BROWSER-NATIVE-ACCEPTANCE.md), or the existing [native operation runner](NATIVE-ISOLATED-OPERATIONS-ACCEPTANCE.md) and [receipt runner](NATIVE-ISOLATED-RECEIPT-ACCEPTANCE.md). Part and enrichment runners use the same prepare/approval/execute/observe workflow. Each operation requires its own approved exact preparation; use native IDs from verified readback for dependent steps. Never retry an unresolved write or change its ID to bypass reservation.

## Cases

| ID | Action | Acceptance |
|---|---|---|
| 01 | Read identity, roles, parts, categories, parameter templates/values, stock and locations | Exact actor, version pair, scope, pagination and quantities; compare native UI |
| 02 | Search by category, parameters and stock location | Correct results; unknown values remain unknown; no silently widened filters |
| 03 | Read manufacturer/supplier links, details and attachments | Exact native IDs, source links and detail response shape |
| 04 | Create a dedicated test category and scalar template, associate reviewed catalog field | Unique IDs; exact template association; unchanged prior definitions |
| 05 | Create a dedicated ordinary Part | Exact IPN/category/fields and minimum_stock=0; verify new ID and absence of unexpected stock |
| 06 | Write reviewed scalar parameter, update it, add a source link | Exact values and attachment target; no synthetic note or binary upload |
| 07 | Create cabinet with dedicated leaf locations A/B/C and managed metadata, rename an empty leaf | Exact IDs/parentage and namespace preservation; no unexpected stock |
| 08 | Receive separate ordinary StockItems of 60 and 40 into A, then append 20 as a separate receipt | Three verified native IDs; A=120, B=C=0; all prior rows preserved |
| 09 | Move the complete 40 record from A to B | Same StockItem ID; A=80, B=40; total=120 |
| 10 | Split B within one reviewed cabinet migration into two compartments of 15/25 | Remainder and linked child verified; no merge flag; total=120; existing reference preserved |
| 11 | Merge the layout compartments into C using whole linked records within the reviewed migration | A=80, C=40; all stock IDs/lineage preserved; old empty leaves retired without deleting native stock records; unrelated metadata unchanged |
| 12 | Reopen browser and inspect operation journal, native UI and audit | Verified operations not replayed; outstanding work explicitly blocked/read-only; native audit actor/operations match |

Cases 10–11 require a supported planner topology and operator review of actual physical compartments. Do not attempt to split an already-linked child as a new independent migration. If the real topology or references do not permit the plan, record blocked rather than modifying native rows manually.

Failure tests: synthetic CI injects lost acknowledgement, stale baseline, ignored filters, unsupported precision, changed schema/actor, external ancestry and unauthorized production activation. On a disposable instance, test denied permissions and stale baselines only with explicitly reviewed test records; do not intentionally disrupt a real service. Observe-only must never mutate or resend. Compare API 570 regression tests separately.

## Evidence and gate

For every case record pass/fail/blocked, exact commit, software/API version, actual schema digest, anonymized native IDs or private references, before/after counts, journal result and native audit attribution. Record device/browser/CORS/local-network evidence separately (#23/#24). No case may be marked passed merely because a fixture passed. Binary image upload, supplier/manufacturer identity creation, stock-record merge/delete and unrestricted category reparenting are outside the current write adapter scope.

Production remains gated by frozen catalog, HTTPS, private deployment evidence, native permissions and independent approval. No production data may be modified by this acceptance.
