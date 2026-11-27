# Local anonymous category coverage (#6)
This read-only tool prepares the category-coverage evidence for STD-01. It does not inspect a server, fetch products, create templates, freeze the catalog or certify individual field mappings. It accepts only explicit, anonymized aggregates from the user-authorized local agent. Counts refer to distinct Part records, not StockItem records or quantities. Include an opaque category for uncategorized Parts; assign each Part to exactly one leaf category to avoid counting ancestors twice. The caller is responsible for completeness of the actual snapshot.
 
After the existing core build (`npm run build:core`), create a private JSON file outside the repository with this shape (synthetic example; replace the hash with the actual value in catalog/SHA256SUMS):
 
```json
{"catalogVersion":"0.3.0-draft","catalogSha256":"<64 lowercase hex characters>","categories":[{"categoryRef":"cat-1","partCount":2,"catalogKey":"resistor.smd"},{"categoryRef":"cat-2","partCount":3,"catalogKey":null}]}
```
 
Run `node tools/catalog-coverage.mjs /private/aggregate.json > /private/category-coverage.json` using the locally chosen paths. The tool verifies catalog bytes against the manifest and requires the mapping input to reference the same version and hash. It rejects extra fields, duplicate opaque category refs, negative/fractional counts and unsafe totals. No network requests or writes to inventory are performed.
 
- `mapped`: explicit key exists; not evidence that field semantics or the source category are correct.
- `unmapped`: no mapping supplied; `unknown_catalog_key`: supplied key missing from this catalog.
- `fully_mapped` requires every row mapped and a nonempty Part baseline. `empty_baseline` has null coverage percentage.
- Even 100% Part coverage requires source and field review and separate G2 approval. The output always sets productionApproval=false.
 
Keep both aggregate input and output private; no real inventory, category names, IDs or output reports in GitHub. A local agent may use the result to prepare the proposed catalog extension and unresolved-category list. Do not use historical chat inventory numbers as acceptance evidence.
