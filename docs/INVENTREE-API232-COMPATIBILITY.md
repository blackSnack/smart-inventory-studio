# InvenTree API 232 compatibility audit (#157)

Target: InvenTree 0.16.7 / API 232, alongside existing 1.7.4 / API 570. The local read probe returned 200 for identity, roles, part, category, parameter template/value, stock and location. This is not write or browser acceptance.

## Tagged server contracts

- [Part endpoints](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/part/api.py) and [serializers](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/part/serializers.py): legacy PartParameterTemplate has no enabled/model_type/selectionlist fields; it is intrinsically scoped to Part and has checkbox/choices. Legacy parameter values use part/template/data; category associations use parameter_template and parameter_template_detail. No modern note field. Legacy scalar semantics still require explicit review.
- [Stock endpoints](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/stock/api.py), [serializers](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/stock/serializers.py), [model](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/stock/models.py): stock transfer POST supports items[].pk, items[].quantity, location; optional fields batch/status/packaging, not merge. Model move splits on partial quantity, relocates on full quantity. Do not send modern merge:false as if enforced. Validate exact lineage and quantity, server settings, target occupancy, and failure/readback behavior before enabling.
- Generic metadata view exists in [API source](https://github.com/inventree/InvenTree/blob/0.16.7/src/backend/InvenTree/InvenTree/api.py); concrete routing and access still require schema/runtime confirmation.

## This increment

Schema-selected legacy parameter search and category association readers, preserving modern routes and fail-closed schema checks. Synthetic regression coverage only until CI completes. No write gate changed. No claim of full application support.

## Remaining acceptance

| Workflow | 232 server evidence | Studio status |
|---|---|---|
| Identity, roles, part/category/stock/location reads | local 200 | runtime PWA not verified |
| Parameter filter/search, category mapping | tagged source; main parameter endpoints local 200 | this increment; CI pending |
| Part detail/parameters and supplier/manufacturer data | parameter shape differs; other contracts require audit | pending |
| Category creation, part creation, receiving, template creation and parameter changes | list/create and detail APIs in tagged source | write payload/schema and readback pending |
| Source links, image upload and attachment detail | route and representation not yet checked | pending |
| Cabinet metadata read/write, location creation/rename, batch construction | location APIs and generic metadata implementation exist | concrete schema/OPTIONS and metadata preservation pending |
| Full and partial transfers; split/merge cabinet layout | native transfer and split implemented; no per-item merge flag | version-specific safety contract, isolated test pending |

BrowserNativeWorkflow and native acceptance paths still require 1.7.4 / 570. Keep this restriction until full 232 contracts and safety tests are implemented. Do not broaden production authorization, catalog freeze, target binding or operation journal. Existing connection/persistence work in #155/PR #156 remains separate. No production writes or upgrade performed. Issue #157 stays open; real integration/device acceptance #23/#24 stays open.
