# Studio Workspace — UI contract

Status: project-owned baseline; the requested external article https://zacharyzhang.com/blog/ai-frontend-design-rules could not be retrieved on this audit run. Do not attribute these rules to its author. Reconcile article-specific requirements when the text is available.

## Product hierarchy
A mobile-first working inventory, not a marketing dashboard. Preserve Studio warm paper/green palette and one header with version top right. Home: global search, two 112px receipt actions, cabinet list. No KPI or explanatory cards. Four navigation destinations; receiving is a dedicated workflow. One dominant commit action per decision stage, secondary choices visibly subordinate. Never obscure unknown identity, mixed bins, uncommitted writes, or failures.

## Reusable controls
Use source-owned Button, Panel, Modal, SearchField, PartCard and ParameterFilter. Radix Dialog/Slot, Tailwind and Lucide are existing dependencies, not a claim of full shadcn installation. Primary receipt actions are deliberate large exceptions; ordinary controls min 44px, 16px input text, compact secondary actions. Default button type=button; forms opt into submit. Focus visible; keyboard supported. Avoid nested decorative cards, duplicate status text and unbounded dropdowns. Use semantic labels and accessible names. Search on all eligible records, paginate rendering, preserve known/unknown separation. Part rows expose distinguishing specs, identity and stock, not just names. Expand detailed fields on demand. Do not introduce new dependencies for cosmetic effects.

## Tokens
Canvas #F4F2EB; paper #FFFEF9; ink #293B31; primary #3E5E4C; muted #526659; line #DEDFD3; sage #E4E9DD; warning #80591F. Spacing 4/8px; control radius 8px, surface radius 12px, dialog 16px. Body text 14–16px; metadata 12px; form input 16px minimum. Color is supplementary to explicit state text. Respect safe area, user zoom and reduced motion. Local matrix scroll only.

## Acceptance
Verify rendered layouts at 320/375/390/430/768/1280 widths; no horizontal page overflow, overlap, inaccessible focus, or broken back/clear actions. Empty/searching/error states must differ. Test search combinations, fold/unfold, confirmation and quantity conservation. Preserve existing domain/operation journals and release gates. Capture actual representative mobile and desktop screenshots and inspect before calling a visual audit complete; source review or geometry alone is not visual acceptance. Native iOS keyboard/picker and real backend remain separate acceptance.
