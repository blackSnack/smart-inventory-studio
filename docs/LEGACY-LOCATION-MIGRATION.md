# Legacy location migration preparation (software only)
Issue #17. No actual InvenTree calls are made by this planner.
1. Local operator obtains a private read-only snapshot of location IDs, names, parents, structural status, and cabinet-root Metadata. Never commit production IDs or data.
2. Build the physical layout and explicitly bind every defined compartment to an existing leaf ID. Whole drawers and split compartments are supported; no inference from existing names. Unbound locations require a separate reviewed mapping.
3. previewLegacyMigration validates one-to-one binding, root ancestry, leaf status, existing references, sibling names and existing managed metadata. Initial import is the only mode; previously managed cabinets use the revisioned editor.
4. Review the old/new names, original IDs, parents, and metadata. Physically confirm the labels before approving.
5. planLegacyMigration recomputes from a fresh snapshot and rejects stale review. Abstract rename-location operations target the original ID, require the expected old name/parent, and do not move or recreate stock. Metadata update is last and has expected original metadata and expected renamed leaves. Transport must verify all preconditions/readbacks, respect capability and operation journal, and never retry ambiguous mutations blindly.
6. verifyLegacyMigration checks all IDs, parents, structural status, names and metadata against the before/after snapshots. It does not assert stock item quantities: actual inventory stock reference/conservation must be checked privately in #23 before production rollout.
Real schema, credentials, API PATCH behavior and physical acceptance remain deferred. The planner deliberately rejects unknown, ambiguous or incomplete mappings rather than inventing coordinates.
