# InvenTree API 232 compatibility audit (#157)

Target: InvenTree 0.16.7 / API 232, alongside existing 1.7.4 / API 570. The local read probe returned 200 for identity, roles, part, category, parameter template/value, stock and location. This is not write or browser acceptance.

## Tagged server contracts

- [Part endpoints](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/part/api.py) and [serializers](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/part/serializers.py): legacy PartParameterTemplate has no enabled/model_type/selectionlist fields; it is intrinsically scoped to Part and has checkbox/choices. Legacy parameter values use part/template/data; category associations use parameter_template and parameter_template_detail. No modern note field. Legacy scalar semantics still require explicit review.
- [Stock endpoints](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/stock/api.py), [serializers](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/stock/serializers.py), [model](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/stock/models.py): stock transfer POST supports items[].pk, items[].quantity, location; optional fields batch/status/packaging, not merge. Model move splits on partial quantity, relocates on full quantity. Do not send modern merge:false as if enforced. Validate exact lineage and quantity, server settings, target occupancy, and failure/readback behavior before enabling.
- Location-specific metadata route is declared in the tagged [stock API](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/stock/api.py): /api/stock/location/{id}/metadata/. The read adapter now selects that route if declared. Attachment list/create and link/file representation are present in [common API](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/common/api.py) and [serializer](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/common/serializers.py); runtime permission and model choices still need verification.

## This increment

Schema-selected legacy parameter search, catalog details, category association and location metadata readers, preserving modern routes and fail-closed schema checks. Synthetic regression coverage only until CI completes. No write gate changed. No claim of full application support.

## Remaining acceptance

| Workflow | 232 server evidence | Studio status |
|---|---|---|
| Identity, roles, part/category/stock/location reads | local 200 | runtime PWA not verified |
| Parameter filter/search, category mapping | tagged source; main parameter endpoints local 200 | this increment; CI pending |
| Part detail/parameters and supplier/manufacturer data | parameter shape differs; company/attachment APIs exist | read adapter implemented; runtime pending |
| Category creation, part creation, receiving, template creation and parameter changes | list/create and detail APIs in tagged source | write payload/schema and readback pending |
| Source links, image upload and attachment detail | attachment list/create and link/file fields present | actual image upload and link write pending |
| Cabinet metadata read/write, location creation/rename, batch construction | location APIs and location-specific metadata exist | read adapter implemented; OPTIONS and write preservation pending |
| Full and partial transfers; split/merge cabinet layout | native transfer and split implemented; no per-item merge flag | version-specific safety contract, isolated test pending |

BrowserNativeWorkflow and native acceptance paths still require 1.7.4 / 570. Keep this restriction until full 232 contracts and safety tests are implemented. Do not broaden production authorization, catalog freeze, target binding or operation journal. Existing connection/persistence work in #155/PR #156 remains separate. No production writes or upgrade performed. Issue #157 stays open; real integration/device acceptance #23/#24 stays open.

## Official schema audit: API 232 is the primary acceptance baseline

Pinned upstream [API 232 OpenAPI export](https://github.com/inventree/schema/blob/01ae6b95d4ba6083b79de63e2615dca9cdfa75f7/export/232/api.yaml), blob e42da2e7e576be99f871374318ba925920884684; [0.16.7 API version source](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/InvenTree/api_version.py) confirms 232. The archived export contains 291 paths and 616 HTTP operations. The [machine-extracted audit matrix](verification/inventree-api232-schema-audit.json) checks 36 relevant read/write operation contracts (including proposed image and record merge, separate from cabinet layout merge): all 36 methods/routes declared; 4 entries have schema-level discrepancies or extra required fields. The export is not the user's server schema.

- Manufacturer/supplier detail query flags and supplier_detail are implemented in tagged source but not fully advertised in the exported schema. Validate actual returned company IDs and details; missing evidence is not an empty company.
- Stock filters part, include_variants, location, cascade are implemented in StockList despite being omitted in the schema. Require exact row scope and pagination tests; no silently widened scope.
- Part creation schema lists minimum_stock as required (model default 0). Explicitly validate reviewed default and request contract before writes.
- StockItem lacks in_stock in its response; the server implements a separate in_stock filter and model lifecycle predicate. Do not set in_stock=true by default or filter away rows during baseline collection. Verify lifecycle membership, allocations, reference fields and lineage against the actual instance. Location lacks exclude_from_stock; do not default to false to satisfy a modern guard.
- Stock quantity and allocated are number/double in the old schema; transfer quantity is a decimal string with up to 5 decimal places. Preserve safe integer and exact decimal invariants; block unsupported precision. No per-item merge flag. Stock record merge is a separate endpoint, not layout merge.
- Metadata field is unconstrained JSON in the schema; require object shape, namespace isolation and full readback. Images/attachments have declared routes; multipart and actual file behavior need isolated runtime tests.
- Existing API 570 schema/authorization gates remain intact; 232 native writes must get their own reviewed contract. A route or field declaration never authorizes a write.

Offline reproduction with the actual instance's read-only JSON schema: `node scripts/audit-inventree-api232.mjs local-schema.json`. Reports SHA-256, all 36 operation results, per-field status/type, filters, content type and extra required fields; exit 2 for gaps, 1 for malformed/wrong-version input, 0 for declaration checks only. Does not access a network or grant writes. Keep local schema and credentials out of version control; upload only sanitized evidence if required. Official matrix was extracted from upstream YAML with targeted indentation inspection, not a general YAML validator. The new offline JSON audit and synthetic tests are committed; CI and actual instance evidence remain pending.
