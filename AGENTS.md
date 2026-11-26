# Agent engineering rules

- Human maintains the development environment. Do not scan host/network, install or repair tools, or modify host configuration without authorization. Report missing prerequisites.
- Preserve the domain/provider boundary; make minimal focused diffs. Do not change protocols, architecture, workflows or gates without explicit approval.
- Maintain Studio design tokens and reusable components; normal success low-noise, errors and physical confirmation explicit, accessibility preserved.
- Use risk-based focused tests. Distinguish implementation, build, test, deployment and real-device acceptance. Report actual evidence.
- No production credentials or user data in source, logs or artifacts. No production migration, inventory writes or upgrade without explicit authorization. CI uses synthetic data only.
- Work via issues and PRs; inspect exact head and required checks before merge. Do not bypass or weaken checks.

- For UI changes read `DESIGN.md` first; use shared controls, preserve confirmed workflow and verify affected rendered states. Do not claim external-rule compliance or visual/real-device acceptance without evidence.
