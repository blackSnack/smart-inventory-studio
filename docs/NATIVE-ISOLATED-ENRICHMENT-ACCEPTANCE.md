# QA-01 native reviewed source link and missing parameter acceptance (#23)

Operator-only, explicit disposable loopback InvenTree 1.7.4/API 570. Do not use production, including a production tunnel. Follow the private directory, token, exact preparation hash, exclusive access and write-once evidence requirements in NATIVE-ISOLATED-RECEIPT-ACCEPTANCE.md. Use dedicated reviewed test records and real source evidence. This command never contacts the referenced source URL and does not download PDFs/images or upload files.

Private input JSON supports one of these shapes (synthetic examples):

```json
{"kind":"source","partId":"42","ipn":"FIX-001","url":"https://example.test/datasheet","comment":"Reviewed datasheet"}
```
```json
{"kind":"parameter","partId":"42","ipn":"FIX-001","templateId":"5","templateName":"Resistance","units":"Ω","value":"10kΩ","evidence":[{"url":"https://example.test/spec","locator":"table"}]}
```

Parameter mode accepts only an existing enabled native scalar template with reviewed direct mapping and either a missing record (POST) or empty record (PATCH preserves note). It refuses all nonempty existing values, duplicates, unsafe URLs and scope/identity drift. Operator must independently verify category/template mapping and value/source semantics; declarations are not permission or semantic proof.

```sh
node tools/check-native-enrichment.mjs --prepare http://127.0.0.1:8123/ <local-instance-label> <private-fields.json> <private-preparation.json>
```

Review exact preparation and independent evidence; authorize only the disposable write with separate private approval:

```json
{"approvedPreparationSha256":"<exact preparation SHA-256>","disposableInstanceConfirmed":true,"writeAuthorized":true,"visibilityConfirmed":true,"exclusiveAccessConfirmed":true,"identityConfirmed":true,"sourceReviewed":true,"fieldMappingConfirmed":true}
```

```sh
node tools/check-native-enrichment.mjs --execute-isolated-write <private-preparation.json> <private-approval.json> <private-journal-directory>
node tools/check-native-enrichment.mjs --observe-only <private-preparation.json> <private-approval.json> <private-journal-directory>
```

The exact schema and baseline are rechecked before a write-once reservation. Native acknowledged record ID is stored in the shared local evidence store, then exact readback checks prior attachments or parameter value/note. No automatic replay, no arbitrary endpoints or production permission. Keep the same preparation and private journal directory, never regenerate unknown operations. Exit 0 is selected readback, not native audit attribution; 2 unknown/blocked; 1 preflight failure. Tests use synthetic injected responses only. Actual source review, server audit and remaining #23 operations are separate.
