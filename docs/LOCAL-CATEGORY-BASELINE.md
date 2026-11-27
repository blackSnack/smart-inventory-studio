# MIG-01: read-only local category membership candidate (#22, #6)

After the existing core build, use a user-approved read-only token in the current process environment variable STUDIO_INVENTREE_READ_TOKEN, and an existing private directory outside the repository:

```sh
node tools/collect-category-baseline.mjs --allow-network <approved-https-base> <private-directory>/category-baseline.local.json
```

Only explicit HTTPS and a new output file are accepted. No environment scanning, installation, writes to InvenTree, arbitrary links or credentials in logs. The command probes the existing OpenAPI GET declarations and reads the Part and Category collections twice using the same read transport as the app. It checks unique IDs, parent references, tree cycles, explicit null categories, dangling references and stable direct membership between the two passes. Every visible Part is counted once; direct memberships on ancestor/structural categories are flagged for local review, empty leaf categories included, uncategorized Parts grouped separately. No stock quantity or Part identity/name is exported. Do not treat this projection as a full migration/backup snapshot.

The output has two sections: privateCategoryReview contains actual category IDs/names and hierarchy for the local operator; aggregate contains only opaque refs, direct Part counts and null mappings. Never commit either section or the full output. Windows operators must also ensure the private directory's ACL is restricted. Copy only aggregate into a separate private file, review against the local category tree, fill catalogKey explicitly and run the existing tools/catalog-coverage.mjs as described in CATALOG-COVERAGE.md. Never infer mappings from names. Use uncategorizedRef to identify the opaque uncategorized group. The result is a stable-visible candidate, not an atomic snapshot, proof of full visibility, catalog freeze, backup or production approval. Independently confirm permissions and total visible inventory before relying on coverage. Full data and backup collection remain local per LOCAL-AGENT-EXECUTION.md.

For local integration, run the existing contract probe first; compare actual version/schema/auth and address any missing declarations. This command can be run afterward without changing the catalog or server. Synthetic tests exercise direct membership, privacy projection, changing membership, corrupt references, and the actual read transport. No actual inventory is accessed by repository tests.
