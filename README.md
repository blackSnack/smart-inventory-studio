# Smart Inventory Studio

An open-source, mobile-first electronic component inventory client with pluggable inventory and AI providers, visual storage management, and human-reviewed receiving.

**Status: development preview.** React PWA supports synthetic workflows and opt-in read-only provider/AI draft checks; production writes and physical-device acceptance are pending. No inventory, personal configuration, tokens or private environment snapshots belong in this public repository.

## Preview

[Try the public demo](https://blacksnack.github.io/smart-inventory-studio/), or open `index.html` in a browser. The demo uses synthetic data and browser-local storage. The GitHub Pages workflow publishes the HTML demo and the separate [React Studio preview](https://blacksnack.github.io/smart-inventory-studio/react-preview/), not source or operational records. The React preview uses synthetic fixtures and a scoped offline shell; real API integration and device acceptance remain pending.

## Core checks

Use Node.js 22 and the pinned TypeScript dependency. Run `npm ci --ignore-scripts`, then `npm run check`. The isolated browser smoke test uses Python Playwright; see the CI configuration. Environment provisioning is the maintainer's responsibility.

## Architecture and operations

- [Architecture and implementation specification](docs/ARCHITECTURE.md)
- [Local inventory migration and acceptance guide](docs/LOCAL-AGENT-EXECUTION.md)
- [Shared catalog seed](catalog/electronic-parts.json): draft, not approved for production migrations.
- [Release and update workflow](docs/RELEASE.md)
- [Delivery roadmap](docs/ROADMAP.md)
- [Contributing and release gates](CONTRIBUTING.md)

Primary compatibility target: InvenTree 0.16.7 / API 232; InvenTree 1.7.4 / API 570 remains a regression target. Actual API and device verification is required. See the [API 232 compatibility audit](docs/INVENTREE-API232-COMPATIBILITY.md). Other providers may be added through the domain boundary. Production migration, upgrade and write operations require explicit authorization. See LICENSE for licensing; third-party source materials remain subject to their own terms.
