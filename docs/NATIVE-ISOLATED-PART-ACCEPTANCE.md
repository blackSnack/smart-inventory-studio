# QA-01 native partial Part creation (#23)

Explicitly authorized disposable local InvenTree 1.7.4/API 570 only, not PWA or production, including a production tunnel. Same loopback IP/port, private directory, token, exact preparation hash and write-once evidence requirements as NATIVE-ISOLATED-RECEIPT-ACCEPTANCE.md. Use a unique test IPN and reviewed existing nonstructural category. The supported operation is one new Partial Part with zero stock, not an exact manufacturer/supplier identity, parameter or link creation.

Prepare a private fields JSON containing exactly ipn, categoryId (string), categoryName, name, description, units; e.g. synthetic values FIX-001, 7, Resistors, Fixture resistor, Partial, pcs. Run after the existing core build:

```sh
node tools/check-native-part-create.mjs --prepare http://127.0.0.1:8123/ <local-instance-label> <private-fields.json> <private-preparation.json>
```

Preparation checks native version/auth/schema, category identity and exact IPN absence twice. Review actual visibility, new independent identity and exclusive access; use private approval JSON only after explicit isolated write authorization:

```json
{"approvedPreparationSha256":"<exact preparation SHA-256>","disposableInstanceConfirmed":true,"writeAuthorized":true,"visibilityConfirmed":true,"exclusiveAccessConfirmed":true,"identityConfirmed":true,"newPartConfirmed":true}
```

```sh
node tools/check-native-part-create.mjs --execute-isolated-write <private-preparation.json> <private-approval.json> <private-journal-directory>
node tools/check-native-part-create.mjs --observe-only <private-preparation.json> <private-approval.json> <private-journal-directory>
```

Recheck before one POST, explicitly disable copy_category_parameters, retain exact returned Part ID and check list/detail, stock and parameter records. A correlated acknowledgement is required; matching IPN alone never certifies creation. No blind resend, keep the same files/directory, do not regenerate an unresolved operation. The shared write-once local evidence store's legacy stockId field stores the acknowledged record ID; the preparation kind/hash distinguishes Part creation from receipt. Exit 0 means selected readback verified, not native server audit attribution or production permission; 2 unknown/blocked; 1 preflight failure. No actual local connection or write in repository CI; tests use injected responses. This does not complete all #23 acceptance.
