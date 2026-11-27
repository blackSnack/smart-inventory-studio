# QA-01 remaining native operations — unified local acceptance (#23)

Operator-only test runner for a disposable InvenTree 1.7.4 / API 570 instance on an explicit loopback IP and port. Never point it at production, including a production tunnel. No setup, host scan, migration or mutation is initiated automatically. Existing fixture open() continues requiring HTTPS .test and injected fetch; the native entry does not change PWA capabilities. The user must verify disposability, exclusive access, complete visibility and actual operation/physical/reference evidence.

## Single CLI
After the existing core build, provide the authorized isolated token privately using STUDIO_INVENTREE_ISOLATED_TOKEN. Use an existing restricted private directory outside the repository. Prepare one operation at a time (stable unique operation ID, private operation JSON):

```sh
node tools/check-native-operations.mjs --prepare http://127.0.0.1:8123/ <local-instance-label> <private-operation.json> <private-preparation.json>
```

Preparation reads actual version/auth identity/schema/catalog and operation baselines. Existing checked adapter logic is run with a dispatcher that captures its proposed exact mutation without forwarding it. The saved private file includes operation payload, exact write body, read digests and additional conservation snapshots. It is not approval; the catalog stays draft. Read digests are intentionally strict; a change (including visible response ordering) can require renewed review. Do not retry unknown operations using a new preparation or ID.

After independent inspection, use the displayed exact preparation SHA-256 in a private approval JSON:

```json
{"approvedPreparationSha256":"<exact preparation SHA-256>","disposableInstanceConfirmed":true,"writeAuthorized":true,"visibilityConfirmed":true,"exclusiveAccessConfirmed":true,"operationReviewed":true,"physicalAndReferenceReviewConfirmed":true}
```

```sh
node tools/check-native-operations.mjs --execute-isolated-write <private-preparation.json> <private-approval.json> <private-journal-directory>
node tools/check-native-operations.mjs --observe-only <private-preparation.json> <private-approval.json> <private-journal-directory>
```

The runner repeats exact reads and compares the actor, schema/catalog hash, approved payload and method/path/body before a single mutation. A durable exclusive reservation is written before the request; acknowledgement is stored separately. Same target/instance/operation ID cannot be reserved twice even with a different preparation hash. Keep the same target, label, ID and private directory. No blind resend; a response lost after write remains unknown even if observed state matches. Observe-only never sends a write. File flush is not a guarantee against filesystem loss or power failure; keep files private, use restricted Windows ACLs. Exit 0 = selected operation readback verified, not server audit attribution; 2 = unknown/blocked; 1 = preflight failure. Check native audit separately.

## Input operation shapes
Every operation is {"id":"unique-test-id","kind":"...","payload":{...}}. Examples use synthetic IDs and labels; replace with actual dedicated test records and review. For dependent operations use one preparation at a time, after the previous operation is verified and its native IDs are known.

| kind | payload (required fields) | checked outcome |
|---|---|---|
| create-category | expectedAbsent:true, name, description, parentId (string or null), structural | unique sibling, new ID, existing definitions unchanged |
| create-parameter-template | expectedAbsent:true, name, description, units, modelType:"part.part", fieldType:"string" | new enabled scalar text template, global/name collision rejected |
| associate-category-template | categoryId, templateId, categoryKey, fieldKey, reviews (array of templateId/name/unit/type/confirmed:true) | catalog-backed direct mapping, leaf category, no ancestor duplicate, empty default, prior associations unchanged |
| create-location | expectedAbsent:true, physicalConfirmed:true, parentId (string or null), parentName (string or null), name, description, structural | new ID, unchanged tree, empty new location |
| rename-location | locationId, expectedParentId, expectedName, name | same leaf ID and parent, no sibling collision, exact reviewed stock unchanged |
| update-location-metadata | locationId, expectedMetadata, metadata, expectedLeaves (locationId/parentId/name) | planner-compatible cabinet binding, preserve unrelated keys/stock; initial or next managed revision without removing prior leaf references |
| transfer-stock | physicalConfirmed:true, sourceId, targetId, stockItemId, partId, quantity (decimal string), splitConfirmed:true for partial | reads source/target baselines; whole ID retained or exact remainder/new linked child; no automatic merge, stock lifecycle/batch/lineage preserved |

Use the current catalog manifest for explicit association mapping. Template creation supports scalar text definitions only; other semantics need separate reviewed mapping. The metadata input should come from the existing cabinet/legacy planner; managed revision requires both bindings valid against current tree and no prior leaf reference removal. This is not a destructive restructure, a stock merge/delete operation, or an unrestricted schema/metadata editor. Transfer only supports existing ordinary unallocated stock and nonserialized split; no direct mutation of arbitrary stock fields. Physical movement must be confirmed by operator. Multiple steps are not a server transaction. Never treat a partial sequence as fully complete.

## Verification and handoff
Existing native receipt, Part create and enrichment tools remain available. Synthetic end-to-end tests exercise every remaining operation, stale evidence, lost response, exact wire constraints, conservation and durable recovery. No real instance requests are made by repository CI. Actual #23 integration, permission-denial cases on the real server, native audit, backup/restore and production authorization remain local. PWA real writes remain disabled until the separate gates are satisfied; this runner is not a production UI integration claim.
