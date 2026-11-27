# Production native authorization (#23 / #22 / #6)

The browser has a production path behind existing local gates. It is not enabled by a successful read-only connection or a write-capable token. The bundled catalog must be explicitly frozen at v1.0 and approved for production. The user must verify underlying local evidence and separately authorize the exact production target. No production inventory, server address, account identifier, token, or private evidence belongs in Git. Browser-side approval cannot replace native server role permissions, backup/restore, native audit, or operator-controlled exclusive windows.

The private local Agent may generate the following **authorization record only after actual checks and approval**, never from synthetic CI. SHA-256 values refer to actual private evidence files; do not fabricate them. Catalog SHA-256 here is the canonical snapshotKey hash of the validated catalog (not the raw-byte catalog/SHA256SUMS digest, which remains a separate release artifact). Exact HTTPS origin with root path and deployed schema byte digest are required. Actor ID is the authenticated native user PK as a string. Approval ID is the user-approved production change authorization reference. Record every operation's actual permissions; GET/OPTIONS declarations alone are insufficient.

```json
{
 "version":1,"targetBase":"https://<approved-inventory-host>/",
 "softwareVersion":"1.7.4","apiVersion":570,"actorId":"<actual native user PK>",
 "schemaSha256":"<actual schema SHA-256>","catalogVersion":"1.0.0","catalogSha256":"<canonical approved catalog SHA-256>",
 "approvalId":"<approved change reference>","productionWriteAuthorized":true,"exclusiveWindowConfirmed":true,
 "evidence":{"environment":"<sha256>","backupRestore":"<sha256>","catalogFreeze":"<sha256>","isolatedAcceptance":"<sha256>","permissionsVisibility":"<sha256>","referencesAndAudit":"<sha256>"},
 "operationPermissions":{"part-create":true,"category-create":true,"template-create":true,"category-association":true,"parameter-create":true,"parameter-update":true,"source-create":true,"stock-create":true,"location-create":true,"location-rename":true,"metadata-update":true,"stock-transfer":true}
}
```

Only after evidence review, select formal production writing in settings, enter the approved address and token, import this private file and confirm the exact authorization. Every operation separately presents its input, fresh baseline and confirmation. A changed actor/schema/catalog or evidence scope blocks execution. A successful response/readback is not an unrestricted grant or proof of audit attribution. Recovery is observation-only. The shared catalog is currently a draft, so production cannot be activated with this release. No gate is satisfied by sample data. Local isolated acceptance remains loopback-only.
