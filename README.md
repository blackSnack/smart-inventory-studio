# Smart Inventory Studio

An open-source, mobile-first electronic component inventory client with pluggable inventory and AI providers, visual storage management, and human-reviewed receiving.

**Status: v0.1 development seed / simulated UI prototype.** The preview does not access real inventory or AI APIs. It is not yet an installable PWA; React/shadcn integration, live write adapters and mobile acceptance are future implementation work. No inventory, personal configuration, tokens or private environment snapshots belong in this public repository.

## Preview

Open `index.html` in a browser. The demo uses synthetic data and browser-local storage. The GitHub Pages workflow publishes only this demo, not the source or operational records.

## Core checks

Use Node.js 22 and the pinned TypeScript dependency. Run `npm install --ignore-scripts` (or `npm ci --ignore-scripts` when a lockfile is present), then `npm run check`. The isolated browser smoke test uses Python Playwright; see the CI configuration. Environment provisioning is the maintainer's responsibility.

## Architecture and operations

- [Architecture and implementation specification](docs/ARCHITECTURE.md)
- [Local inventory migration and acceptance guide](docs/LOCAL-AGENT-EXECUTION.md)
- [Shared catalog seed](catalog/electronic-parts.json): draft, not approved for production migrations.
- [Contributing and release gates](CONTRIBUTING.md)

Inventory target: InvenTree 1.7.4, subject to actual API and device verification. Other providers may be added through the domain boundary. Production migration, upgrade and write operations require explicit authorization. See LICENSE for licensing; third-party source materials remain subject to their own terms.
