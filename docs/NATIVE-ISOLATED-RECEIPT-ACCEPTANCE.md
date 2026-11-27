# QA-01 local disposable-instance receipt acceptance (#23)

This opt-in operator tool is not used by the PWA or fixture router. It supports one ordinary existing-Part receipt into one leaf of a disposable InvenTree 1.7.4/API 570 instance on an explicitly specified loopback IP and port. Never point it at production, including a tunnel/proxy to production; a loopback address cannot itself establish disposability. Prepare dedicated test records and ensure exclusive access, complete visibility and physical/identity review. Use a user-authorized isolated token, not production credentials. HTTP is allowed only on loopback. No service setup or command is run automatically.

After the existing core build, set STUDIO_INVENTREE_ISOLATED_TOKEN privately and use an existing private directory outside the repository. Prepare with:

```sh
node tools/check-native-receipt.mjs --prepare http://127.0.0.1:8123/ <local-instance-label> <part-id> <leaf-id> <quantity> <private-preparation.json>
```

This checks version, authenticated read, schema declarations/hash and two stable visible receipt snapshots. Review the saved file (private Part, location and stock data). Prepare a separate private approval JSON only after explicitly checking the actual conditions. Copy the exact preparation SHA-256 displayed by the prepare command; approval of a different preparation is rejected:

```json
{"approvedPreparationSha256":"<exact preparation SHA-256>","disposableInstanceConfirmed":true,"writeAuthorized":true,"visibilityConfirmed":true,"exclusiveAccessConfirmed":true,"identityConfirmed":true,"physicalSpaceConfirmed":true}
```

Only after isolated write authorization:

```sh
node tools/check-native-receipt.mjs --execute-isolated-write <private-preparation.json> <private-approval.json> <private-journal-directory>
```

The exact schema hash and candidate are rechecked before a write-once reservation. One native POST is sent; exact returned StockItem ID and scope are checked, then readback verifies the new record and unchanged prior stock. An unknown outcome never triggers a retry. Preserve the same journal directory and preparation; never delete a reservation or create a new preparation to retry an unresolved write. Files are created exclusively and flushed; this is not a guarantee against filesystem loss or power failure. Restrict Windows ACLs and keep all files private.

```sh
node tools/check-native-receipt.mjs --observe-only <private-preparation.json> <private-approval.json> <private-journal-directory>
```

Observe-only cannot send POST. Exit 0 means the selected acknowledgement/readback checks match, not production approval or full server audit attribution; 2 means unknown/blocked, 1 means invalid input or preflight failure. Independently inspect native server audit and evidence, and retain unresolved operations blocked. This is one receipt acceptance case, not certification of every #23 operation. Tests use injected responses and temporary synthetic journal files; no actual service requests or writes are made by repository CI.
